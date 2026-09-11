/**
 * planFlow ↔ 기존 스토어 사이의 변환. 전부 순수 함수.
 *   effectiveVisits  — 안(案)에 매장 오버라이드를 적용하고 시간을 다시 낸다
 *   slotCandidates   — 슬롯 하나의 교체 후보 목록. 지금 고른 안 기준으로 매번 다시 낸다
 *   optionTitle      — 카드 제목은 규칙이 아니라 "무엇이 다른가"
 *   toLegacyPlan     — 확정 순간 StopState[] + key:'live' Dataset. A6 이후는 이걸로 그대로 돈다
 * SLOT_STATUS_TEXT/HELP — 슬롯 status 표시 문구. 화면 여러 곳(추천 카드·교체 시트)이 같이 쓴다
 */
import { formatDistanceM } from '../lib/geo';
import type { Candidate, Dataset, RouteOption, Stop } from '../data/mockData';
import { isOpenAt } from '../lib/routePlan/score';
import type { Alternative, PlanOption, PlanResult, Rescored, Slot, SlotStatus, Visit } from '../lib/routePlan/types';
import type { PlanFlowState } from './planFlow';
import type { ApplyLivePayload, StopState } from './plan';

export const SLOT_STATUS_TEXT: Partial<Record<SlotStatus, string>> = {
  far: '멀리 있음',
  none: '못 찾음',
  closed: '마감',
  short: '일부만',
};

export const SLOT_STATUS_HELP: Partial<Record<SlotStatus, string>> = {
  far: '경로 근처에 없어 멀리 있는 곳으로 잡았어요.',
  none: '경로 15km 안에서 못 찾았어요. 다른 말로 적어 보세요.',
  closed: '도착할 때쯤 문을 닫아요.',
  short: '말한 개수만큼 못 찾았어요.',
};

// 반올림을 먼저 한다 — 시는 내림, 분은 반올림하면 599.7이 "9:00"(10:00이어야 한다)이 된다
const toHHMM = (min: number) => {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 오버라이드 id는 slots에서 푼다. result.alternatives는 옵션 0 기준이라
 * 2·3안에서 고른 후보가 거기 없으면 교체가 그냥 먹히지 않았다.
 */
export function effectiveVisits(
  result: PlanResult,
  slots: Slot[],
  optionIdx: number,
  overrides: Record<number, Record<string, string>>,
): { visits: Visit[]; timing: Rescored; option: PlanOption } {
  const option = result.options[optionIdx] ?? result.options[0];
  const ov = overrides[optionIdx] ?? {};
  const visits = option.visits.map(v => {
    const candId = ov[v.slotId];
    if (!candId || candId === v.candidate.id) return v;
    const cand = slots.find(s => s.id === v.slotId)?.candidates.find(c => c.id === candId);
    return cand ? { ...v, candidate: cand } : v;
  });
  // result.rescore가 유일한 시간 산출원 — 실측 leg가 있으면 실측, 없으면 추정(estimated로 드러난다)
  return { visits, timing: result.rescore(visits), option };
}

export function optionTitle(result: PlanResult, idx: number): string {
  if (idx === 0) return '가장 빠름';
  const best = result.options[0];
  const me = result.options[idx];
  if (!me) return '';
  for (const v of me.visits) {
    const b = best.visits.find(x => x.slotId === v.slotId);
    if (b && b.candidate.id !== v.candidate.id) return `${b.candidate.name} 대신 ${v.candidate.name}`;
  }
  const order = (o: PlanOption) => o.visits.map(v => v.slotId).join('>');
  if (order(me) !== order(best)) return '순서 바꿈';
  return `${idx + 1}번째로 빠름`;
}

/** 1안과 무엇이 다른가 — 카드 제목은 차이만 말한다 */
export type OptionDiff =
  | { kind: 'best' }
  /** 바뀐 매장 전부. 제목은 첫 곳 + '외 N곳' */
  | { kind: 'swap'; swaps: { from: string; to: string }[] }
  | { kind: 'order' }
  | { kind: 'rank' };

export function optionDiff(result: PlanResult, idx: number): OptionDiff {
  if (idx === 0) return { kind: 'best' };
  const best = result.options[0];
  const me = result.options[idx];
  if (!me) return { kind: 'rank' };
  const swaps: { from: string; to: string }[] = [];
  for (const v of me.visits) {
    const b = best.visits.find(x => x.slotId === v.slotId);
    if (b && b.candidate.id !== v.candidate.id) swaps.push({ from: b.candidate.name, to: v.candidate.name });
  }
  if (swaps.length > 0) return { kind: 'swap', swaps };
  const order = (o: PlanOption) => o.visits.map(v => v.slotId).join('>');
  if (order(me) !== order(best)) return { kind: 'order' };
  return { kind: 'rank' };
}

/**
 * 한글 조사 — 받침에 따라 을/를, 으로/로. 마지막 글자가 한글이 아니면(숫자·영문) 받침 없는 쪽.
 * "올리브영을(를)" 같은 괄호 표기는 애플 한국어 UI에 없다.
 */
export function josa(word: string, pair: '을/를' | '으로/로' | '이/가'): string {
  const ch = word.charCodeAt(word.length - 1) - 0xac00;
  const hangul = ch >= 0 && ch < 11172;
  const jong = hangul ? ch % 28 : 0;
  const has = jong !== 0;
  if (pair === '을/를') return has ? '을' : '를';
  if (pair === '이/가') return has ? '이' : '가';
  // 으로/로 — ㄹ받침은 '로'
  return has && jong !== 8 ? '으로' : '로';
}

function openStateOf(c: { hours?: { openMin: number; closeMin: number } }, arrivalMin: number): Stop['openState'] {
  if (!c.hours) return 'open';
  if (!isOpenAt(c as never, arrivalMin)) return 'closed';
  const untilClose = ((c.hours.closeMin - arrivalMin) % 1440 + 1440) % 1440;
  return untilClose <= 30 ? 'closing_soon' : 'open';
}
const openNoteOf = (state: Stop['openState']) =>
  state === 'closed' ? '영업 종료 · 선택 불가' : state === 'closing_soon' ? '곧 마감' : '영업 중';

export function alternativeToCandidate(alt: Alternative, slotQuery: string, arrivalMin: number, dwellMin: number): Candidate {
  const openState = openStateOf(alt.candidate, arrivalMin);
  return {
    id: alt.candidate.id,
    name: alt.candidate.name,
    // 1km 미만은 m로 — '0km'는 거리를 말하지 않는다
    note: `${slotQuery} · 경로에서 ${formatDistanceM(alt.detourKm * 1000)}${alt.estimated ? ' · 추정' : ''}`,
    addedMin: Math.round(alt.addedMin),
    detourKm: round1(alt.detourKm),
    arriveAt: toHHMM(arrivalMin),
    dwellMin,
    parking: alt.candidate.parking ?? '가능',
    openState,
    openNote: openNoteOf(openState),
    disabled: openState === 'closed',
    coord: alt.candidate.coord,
  };
}

export function chosenToCandidate(v: Visit, slotQuery: string, arrivalMin: number): Candidate {
  const openState = openStateOf(v.candidate, arrivalMin);
  return {
    id: v.candidate.id, name: v.candidate.name, note: `${slotQuery} · 현재 경로`, addedMin: 0, detourKm: 0,
    arriveAt: toHHMM(arrivalMin), dwellMin: v.dwellMin, parking: v.candidate.parking ?? '가능',
    openState, openNote: openNoteOf(openState), recommended: true, coord: v.candidate.coord,
  };
}

/**
 * visits[idx] 슬롯의 교체 후보 목록 — 지금 고른 안(visits/timing) 기준.
 * 현재 매장이 맨 앞(recommended), 나머지는 그 자리에 끼워 넣고 rescore해 추가시간을 낸다.
 * result.alternatives를 쓰면 안 된다 — 그건 옵션 0 기준이라
 * 2·3안에서는 같은 매장이 두 번 뜨거나 진짜 대안이 빠진다.
 */
export function slotCandidates(
  result: PlanResult,
  slots: Slot[],
  visits: Visit[],
  idx: number,
  timing: Rescored,
): Candidate[] {
  const v = visits[idx];
  if (!v) return [];
  const slot = slots.find(s => s.id === v.slotId);
  const query = slot?.query ?? '';
  const arrive = timing.arrivals[idx];
  const seen = new Set<string>([v.candidate.id]);
  const list: Candidate[] = [chosenToCandidate(v, query, arrive)];
  for (const cand of slot?.candidates ?? []) {
    if (seen.has(cand.id)) continue;
    seen.add(cand.id);
    const swapped = visits.map((vv, j) => (j === idx ? { ...vv, candidate: cand } : vv));
    const swappedTiming = result.rescore(swapped);
    const alt: Alternative = {
      slotId: v.slotId,
      candidate: cand,
      addedMin: swappedTiming.totalMin - timing.totalMin,
      detourKm: Math.max(0, swappedTiming.distanceKm - timing.distanceKm),
      estimated: swappedTiming.estimated,
    };
    list.push(alternativeToCandidate(alt, query, arrive + alt.addedMin, v.dwellMin));
  }
  return list;
}

export function toLegacyPlan({ flow, departMin }: { flow: PlanFlowState; departMin: number }): ApplyLivePayload {
  const { result, request, slots } = flow;
  if (!result || !request) throw new Error('toLegacyPlan: 결과가 없다');
  const { visits, timing } = effectiveVisits(result, slots, flow.selectedOptionIdx, flow.overrides);
  const queryOf = (slotId: string) => slots.find(s => s.id === slotId)?.query ?? '';

  // stops — 방문 순서대로. leg는 timing(effectiveVisits의 rescore)의 도착시각·legsKm에서 그대로
  let clock = departMin;
  const stops: StopState[] = visits.map((v, i) => {
    const arrive = timing.arrivals[i];
    const legMin = Math.round(arrive - clock);
    const legKm = round1(timing.legsKm[i] ?? 0);
    clock = arrive + v.dwellMin;
    const openState = openStateOf(v.candidate, arrive);
    return {
      id: v.slotId, baseId: v.slotId, name: v.candidate.name, category: queryOf(v.slotId), coord: v.candidate.coord,
      dwellMin: v.dwellMin, arriveAt: toHHMM(arrive), legMin, legKm, openState,
      openNote: `체류 ${v.dwellMin}분 · ${openNoteOf(openState)}`, tasks: [],
      replaceDeltaMin: 0, selectedCandidateId: v.candidate.id,
    };
  });

  // legs — 슬롯 id 기준 전체 쌍(재정렬 지원). result.legTable에 기대지 않고 rescore로 직접 낸다 —
  // 오버라이드로 옵션 밖 후보가 들어와도(legTable에 없는 후보) 빠지는 leg가 없다
  const legs: NonNullable<Dataset['legs']> = {};
  for (const v of visits) {
    const single = result.rescore([v]);
    legs[`origin>${v.slotId}`] = { min: Math.round(single.arrivals[0] - departMin), km: round1(single.legsKm[0] ?? 0) };
    legs[`${v.slotId}>dest`] = { min: Math.round(single.arrivals[1] - (single.arrivals[0] + v.dwellMin)), km: round1(single.legsKm[1] ?? 0) };
  }
  for (const a of visits) {
    for (const b of visits) {
      if (a.slotId === b.slotId) continue;
      const pair = result.rescore([a, b]);
      legs[`${a.slotId}>${b.slotId}`] = { min: Math.round(pair.arrivals[1] - (pair.arrivals[0] + a.dwellMin)), km: round1(pair.legsKm[1] ?? 0) };
    }
  }
  legs['origin>dest'] = { min: Math.round(result.directMin), km: round1(result.directKm) };

  // candidates — A5 교체 시트와 같은 함수로 낸다. 화면과 확정본이 다른 목록을 보면 안 된다
  const candidates: Dataset['candidates'] = {};
  visits.forEach((v, i) => {
    candidates[v.slotId] = slotCandidates(result, slots, visits, i, timing);
  });

  const options: RouteOption[] = result.options.map((o, i) => ({
    id: `live-${i}`,
    title: optionTitle(result, i),
    badge: i === 0 ? '검증한 안 중 최선' : undefined,
    totalMin: Math.round(o.totalMin),
    deltaMin: Math.round(o.deltaMin),
    stopNames: [request.originName, ...o.visits.map(v => v.candidate.name), request.destinationName],
    rationale: i === 0 ? `실측 ${result.measuredCount}회로 확인한 경로예요.` : optionTitle(result, i),
    recommended: i === 0,
  }));

  const totalMin = Math.round(timing.totalMin);
  const dataset: Dataset = {
    key: 'live',
    label: '실제 계획',
    origin: { name: request.originName, note: '', coord: request.origin, departAt: toHHMM(departMin) },
    destination: { name: request.destinationName, coord: request.destination, arriveAt: toHHMM(departMin + totalMin) },
    directMin: Math.round(result.directMin),
    mode: request.mode,
    arriveByLabel: request.arriveByMin == null ? '도착 시각 상관없어요' : `오늘 ${toHHMM(request.arriveByMin).padStart(5, '0')}까지`,
    userMessage: '',
    options,
    stops: stops.map(({ baseId: _b, replaceDeltaMin: _r, selectedCandidateId: _s, ...rest }) => rest),
    candidates,
    totals: { totalMin, deltaMin: totalMin - Math.round(result.directMin), stopCount: stops.length },
    legs,
  };

  return { stops, dataset, departMin, selectedOptionId: `live-${flow.selectedOptionIdx}` };
}
