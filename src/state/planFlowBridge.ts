/**
 * planFlow ↔ 기존 스토어 사이의 변환. 전부 순수 함수.
 *   effectiveVisits  — 안(案)에 매장 오버라이드를 적용하고 시간을 다시 낸다
 *   slotCandidates   — 슬롯 하나의 교체 후보 목록. 지금 고른 안 기준으로 매번 다시 낸다
 *   optionTitle      — 카드 제목은 규칙이 아니라 "무엇이 다른가"
 *   toLegacyPlan     — 확정 순간 StopState[] + key:'live' Dataset. A6 이후는 이걸로 그대로 돈다
 *   buildLegs/buildCandidates — 그 Dataset 의 leg 표·후보 목록. 확정 뒤 재측정도 같은 함수를 쓴다
 *   visitsFromStops  — toLegacyPlan 의 역방향. 확정 뒤 화면이 플래너에게 말을 걸 때 쓴다
 * SLOT_STATUS_TEXT/HELP — 슬롯 status 표시 문구. 화면 여러 곳(추천 카드·교체 시트)이 같이 쓴다
 */
import { formatDistanceM } from '../lib/geo';
import { toHHMM } from '../lib/clock';
import type { Candidate, Dataset, RouteOption, Stop } from '../data/mockData';
import { rationaleCopy } from '../lib/timingCopy';
import { isOpenAt } from '../lib/routePlan/score';
import { scoreTrend } from '../lib/trendScore';
import type { Alternative, PlanOption, PlanResult, Rescored, Slot, SlotStatus, TimeClass, Visit } from '../lib/routePlan/types';
import type { PlanFlowState } from './planFlow';
import type { ApplyLivePayload, StopState } from './plan';

export const SLOT_STATUS_TEXT: Partial<Record<SlotStatus, string>> = {
  far: '멀리 있음',
  none: '못 찾음',
  closed: '마감',
  short: '일부만',
  unchecked: '확인 못 함',
};

export const SLOT_STATUS_HELP: Partial<Record<SlotStatus, string>> = {
  far: '경로 근처에 없어 멀리 있는 곳으로 잡았어요.',
  none: '경로 15km 안에서 못 찾았어요. 다른 말로 적어 보세요.',
  closed: '도착할 때쯤 문을 닫아요.',
  short: '말한 개수만큼 못 찾았어요.',
  unchecked: '검색이 실패해서 이 경유지는 못 봤어요. 다시 계산하면 다시 찾아볼게요.',
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

/**
 * 도착 시각의 영업 상태. **시간을 못 받았으면 'open' 이 아니라 'unknown' 이다** —
 * 예전엔 `!c.hours` 를 'open' 으로 돌려, 카카오가 영업시간을 안 준 편의점이 "영업 중"으로
 * 나갔다(2026-09-20). 모르는 것을 안다고 말하는 자리라 시간 값의 '약'과 같은 종류다.
 */
function openStateOf(c: { hours?: { openMin: number; closeMin: number } }, arrivalMin: number): Stop['openState'] {
  if (!c.hours) return 'unknown';
  if (!isOpenAt(c as never, arrivalMin)) return 'closed';
  const untilClose = ((c.hours.closeMin - arrivalMin) % 1440 + 1440) % 1440;
  return untilClose <= 30 ? 'closing_soon' : 'open';
}
const OPEN_NOTE: Record<Stop['openState'], string> = {
  open: '영업 중',
  closing_soon: '곧 마감',
  closed: '영업 종료 · 선택 불가',
  // "확인 못 했다"까지 말한다 — '모름' 한 단어면 무엇을 모르는지가 안 남는다
  unknown: '영업 시간 모름',
};
const openNoteOf = (state: Stop['openState']) => OPEN_NOTE[state];

/**
 * 도착 시각은 `alt.arriveMin` 그대로다 — 여기서 기준 도착에 무언가를 더하지 않는다.
 * 여행 전체 차이를 경유지 한 곳 도착에 더해 출발(22:23)보다 이른 도착(21:58)이 나온 적이 있다(2026-09-20)
 */
export function alternativeToCandidate(alt: Alternative, slotQuery: string, dwellMin: number): Candidate {
  const openState = openStateOf(alt.candidate, alt.arriveMin.min);
  return {
    id: alt.candidate.id,
    name: alt.candidate.name,
    // 1km 미만은 m로 — '0km'는 거리를 말하지 않는다. 추정 여부는 note 에 안 쓴다 —
    // 등급은 `cls` 가 들고 '약'은 timingCopy 가 붙인다. 두 군데서 말하면 한쪽이 틀린다
    // (note 가 trend 근거로 바뀌면 '추정' 글자가 사라졌고, 시트는 그걸 냄새 맡아 '약'을 정했다)
    note: `${slotQuery} · 경로에서 ${formatDistanceM(alt.detourKm * 1000)}`,
    addedMin: Math.round(alt.addedMin.min),
    // 카드의 등급은 하나다 — 추가시간과 도착 중 낮은 쪽. 둘이 갈리면(앞 구간이 추정, 바꾼 구간은 실측)
    // 실측 차이에도 '약'이 붙지만, 반대로 하면 추정 도착이 실측인 척한다
    cls: alt.addedMin.cls === 'estimated' || alt.arriveMin.cls === 'estimated' ? 'estimated' : 'measured',
    detourKm: round1(alt.detourKm),
    arriveAt: toHHMM(alt.arriveMin.min),
    dwellMin,
    parking: alt.candidate.parking ?? '모름',
    openState,
    openNote: openNoteOf(openState),
    disabled: openState === 'closed',
    coord: alt.candidate.coord,
  };
}

export function chosenToCandidate(v: Visit, slotQuery: string, arrivalMin: number, cls: TimeClass): Candidate {
  const openState = openStateOf(v.candidate, arrivalMin);
  return {
    id: v.candidate.id, name: v.candidate.name, note: `${slotQuery} · 현재 경로`, addedMin: 0, detourKm: 0, cls,
    arriveAt: toHHMM(arrivalMin), dwellMin: v.dwellMin, parking: v.candidate.parking ?? '모름',
    openState, openNote: openNoteOf(openState), recommended: true, coord: v.candidate.coord,
  };
}

/**
 * visits[idx] 슬롯의 교체 후보 목록 — 지금 고른 안(visits) 기준.
 * 현재 매장이 맨 앞(recommended), 나머지는 `result.alternativeAt` 이 그 자리에 끼워 넣고 잰다.
 * result.alternatives를 쓰면 안 된다 — 그건 옵션 0 기준이라
 * 2·3안에서는 같은 매장이 두 번 뜨거나 진짜 대안이 빠진다.
 *
 * 기준 안의 `timing` 을 **받지 않는다.** 예전엔 받아서 `swapped.totalMin − timing.totalMin` 을
 * 여기서 뺐고, 기준은 실측·바꾼 안은 추정이라 30곳이 전부 −32분이 됐다(2026-09-20). 차이는
 * 관문(`rescoreFrom`) 안에서 같은 자로만 나고, 여기엔 뺄 재료가 없다
 */
export function slotCandidates(
  result: PlanResult,
  slots: Slot[],
  visits: Visit[],
  idx: number,
): Candidate[] {
  const v = visits[idx];
  if (!v) return [];
  const slot = slots.find(s => s.id === v.slotId);
  const query = slot?.query ?? '';
  const timing = result.rescore(visits);
  // 현재 매장의 도착 등급도 그 지점까지의 구간이 정한다 — 뒤 구간이 추정이어도 앞이 실측이면 실측
  const arriveCls: TimeClass = timing.legCls.slice(0, idx + 1).some(c => c === 'estimated') ? 'estimated' : 'measured';
  const seen = new Set<string>([v.candidate.id]);
  const list: Candidate[] = [chosenToCandidate(v, query, timing.arrivals[idx], arriveCls)];
  for (const cand of slot?.candidates ?? []) {
    if (seen.has(cand.id)) continue;
    seen.add(cand.id);
    list.push(alternativeToCandidate(result.alternativeAt(visits, idx, cand), query, v.dwellMin));
  }

  // 신호가 하나라도 있으면 추천 점수를 붙인다. 없으면 trend 없이 그대로 —
  // 시트가 '추천' 탭을 숨기는 기준이 이것이다.
  const byId = new Map((slot?.candidates ?? []).map(c => [c.id, c]));
  const anySignal = [...byId.values()].some(c => c.signals?.blog || c.signals?.google);
  if (!anySignal) return list;

  const ranked = scoreTrend(list.map(c => {
    const src = byId.get(c.id);
    return {
      id: c.id,
      addedMin: c.addedMin,
      blog: src?.signals?.blog ? { weighted: src.signals.blog.weighted } : undefined,
      blogQueried: src?.signals?.blogQueried,
      google: src?.signals?.google
        ? { rating: src.signals.google.rating, ratingCount: src.signals.google.ratingCount }
        : undefined,
    };
  }));
  const scoreById = new Map(ranked.map(r => [r.id, r]));

  return list.map(c => {
    const r = scoreById.get(c.id);
    if (!r) return c;
    return {
      ...c,
      trend: { score: r.score, reasons: r.reasons, hot: r.hot },
      // 부제를 근거로 바꾼다. 근거가 없으면(이 후보 자신에게 구글·블로그 신호가 둘 다
      // 없음 — 추가시간은 이제 reasons에 안 들어가므로 0이 아니어도 비어 있을 수 있다)
      // 원래 문구를 남긴다
      note: r.reasons.length > 0 ? r.reasons.join(' · ') : c.note,
    };
  });
}

/**
 * 슬롯 id 기준 전체 쌍의 leg 표(재정렬 지원). `result.legTable` 에 기대지 않고 rescore 로 직접 낸다 —
 * 오버라이드로 옵션 밖 후보가 들어와도(legTable 에 없는 후보) 빠지는 leg 가 없다.
 *
 * **분을 반올림하지 않는다.** 이 표는 화면에 바로 나가는 값이 아니라 `computeChain` 이
 * 이어 붙이는 재료다. 구간마다 깎으면 누적 오차로 도착 시각이 밀린다 —
 * 표기용 반올림은 `computeChain` 이 마지막에 한 번만 한다.
 *
 * 확정(`toLegacyPlan`)과 확정 뒤 재측정(`LEGS_LEARNED`)이 **같은 함수**를 쓴다. 두 벌로 두면
 * 한쪽만 고쳐져 A6 가 A5 와 다른 숫자를 말한다 — 이 코드베이스가 반복해서 당한 자리다
 */
export function buildLegs(result: PlanResult, visits: Visit[], timingBase: number): NonNullable<Dataset['legs']> {
  const legs: NonNullable<Dataset['legs']> = {};
  for (const v of visits) {
    const single = result.rescore([v]);
    legs[`origin>${v.slotId}`] = { min: single.arrivals[0] - timingBase, km: round1(single.legsKm[0] ?? 0) };
    legs[`${v.slotId}>dest`] = { min: single.arrivals[1] - (single.arrivals[0] + v.dwellMin), km: round1(single.legsKm[1] ?? 0) };
  }
  for (const a of visits) {
    for (const b of visits) {
      if (a.slotId === b.slotId) continue;
      const pair = result.rescore([a, b]);
      legs[`${a.slotId}>${b.slotId}`] = { min: pair.arrivals[1] - (pair.arrivals[0] + a.dwellMin), km: round1(pair.legsKm[1] ?? 0) };
    }
  }
  legs['origin>dest'] = { min: result.directMin, km: round1(result.directKm) };
  return legs;
}

/** 방문마다의 교체 후보 목록. A5 시트와 같은 함수로 낸다 — 화면과 확정본이 다른 목록을 보면 안 된다 */
export function buildCandidates(result: PlanResult, slots: Slot[], visits: Visit[]): Dataset['candidates'] {
  const candidates: Dataset['candidates'] = {};
  visits.forEach((v, i) => {
    candidates[v.slotId] = slotCandidates(result, slots, visits, i);
  });
  return candidates;
}

/**
 * 확정 뒤 스톱을 계획의 방문으로 되돌린다 — `toLegacyPlan` 의 역방향.
 * 확정 뒤에도 `measureSwap`·재측정은 `Visit[]` 로만 말하는데(플래너 계약), A6 가 들고 있는 건
 * `StopState[]` 뿐이라 여기가 유일한 이음매다.
 *
 * 하나라도 못 풀면 **null** 이다. 목 데이터셋 계획이거나(슬롯이 없다) 계획이 갈아치워진 것이라,
 * 반쯤 푼 배열로 재면 남의 계획 구간을 재고 그 결과를 이 화면에 붙이게 된다
 */
export function visitsFromStops(slots: Slot[], stops: StopState[]): Visit[] | null {
  const out: Visit[] = [];
  for (const s of stops) {
    const slot = slots.find(x => x.id === s.baseId);
    const cand = slot?.candidates.find(c => c.id === s.selectedCandidateId);
    if (!slot || !cand) return null;
    out.push({ slotId: slot.id, candidate: cand, dwellMin: s.dwellMin });
  }
  return out;
}

/**
 * 계획 결과를 기존 스토어 형식으로 옮긴다.
 *
 * `departMin`은 **화면에 쓸 출발 시각**이다. 계산이 기준으로 삼은 시각
 * (`request.departAtMin`)과 다를 수 있다 — 사용자가 A5에서 오래 머물다 확정하면
 * 계산 시작 시각은 이미 과거다. 구간 소요시간은 차이값이라 시계를 옮겨도
 * 그대로 쓸 수 있으므로, 여기서 새 시계에 다시 건다.
 *
 * (교통 상황까지 다시 반영하려면 재계산이 필요하다. 그건 A5의 `isStale` 배너가 맡는다.)
 */
export function toLegacyPlan({ flow, departMin }: { flow: PlanFlowState; departMin: number }): ApplyLivePayload {
  const { result, request, slots } = flow;
  if (!result || !request) throw new Error('toLegacyPlan: 결과가 없다');
  const { visits, timing } = effectiveVisits(result, slots, flow.selectedOptionIdx, flow.overrides);
  const queryOf = (slotId: string) => slots.find(s => s.id === slotId)?.query ?? '';
  /*
    추출이 잡은 용무를 할 일 한 줄로 내린다. **여기가 맞는 자리인 이유**: 이 함수는
    후보가 확정된 visits 로만 돈다 — 수선집이 정해지는 바로 그 순간에 '옷 수선 맡기기'가
    생긴다. 슬롯 단계에서 미리 만들면 장소도 없는 할 일이 먼저 떠 있게 된다.

    한 줄만 만든다. LLM 이 여러 줄을 지어내게 하면 "우유·계란·휴지"처럼 사용자가 말한
    적 없는 목록이 붙는다 — 나머지는 사용자가 시트에서 직접 넣는다.
  */
  const tasksOf = (slotId: string) => {
    const why = slots.find(s => s.id === slotId)?.why?.trim();
    return why ? [{ id: `why-${slotId}`, text: why, done: false }] : [];
  };
  /** timing.arrivals 가 기준으로 삼은 시각. 구간을 차이로 뽑을 때 이걸 써야 한다 */
  const timingBase = request.departAtMin;
  /** 화면 시계와 계산 시계의 차이. 재클럭은 전 구간을 같은 폭으로 민다 */
  const shift = departMin - timingBase;

  // stops — 방문 순서대로. leg는 timing(effectiveVisits의 rescore)의 도착시각·legsKm에서 그대로
  let clock = timingBase;
  const stops: StopState[] = visits.map((v, i) => {
    const arrive = timing.arrivals[i];
    const legMin = arrive - clock;
    const legKm = round1(timing.legsKm[i] ?? 0);
    clock = arrive + v.dwellMin;
    const openState = openStateOf(v.candidate, arrive + shift);
    return {
      id: v.slotId, baseId: v.slotId, name: v.candidate.name, category: queryOf(v.slotId), coord: v.candidate.coord,
      dwellMin: v.dwellMin, arriveAt: toHHMM(arrive + shift), legMin: Math.round(legMin), legKm, openState,
      openNote: `체류 ${v.dwellMin}분 · ${openNoteOf(openState)}`, tasks: tasksOf(v.slotId),
      replaceDeltaMin: 0, selectedCandidateId: v.candidate.id,
    };
  });

  const legs = buildLegs(result, visits, timingBase);
  const candidates = buildCandidates(result, slots, visits);

  const options: RouteOption[] = result.options.map((o, i) => ({
    id: `live-${i}`,
    title: optionTitle(result, i),
    badge: i === 0 ? '검증한 안 중 최선' : undefined,
    totalMin: Math.round(o.totalMin),
    deltaMin: Math.round(o.deltaMin),
    stopNames: [request.originName, ...o.visits.map(v => v.candidate.name), request.destinationName],
    rationale: i === 0 ? rationaleCopy(result.timingSource, result.measuredCount) : optionTitle(result, i),
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
    timingSource: result.timingSource,
    // 오버라이드로 시드 밖 후보가 들어오면 그 구간은 추정이다 — 출처가 실측이어도 확정 뒤 화면은 '약'을 붙여야 한다
    legEstimated: timing.estimated,
    legs,
  };

  return { stops, dataset, departMin, selectedOptionId: `live-${flow.selectedOptionIdx}` };
}
