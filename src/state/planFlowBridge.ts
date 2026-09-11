/**
 * planFlow ↔ 기존 스토어 사이의 변환. 전부 순수 함수.
 *   effectiveVisits  — 안(案)에 매장 오버라이드를 적용하고 시간을 다시 낸다
 *   optionTitle      — 카드 제목은 규칙이 아니라 "무엇이 다른가"
 *   toLegacyPlan     — 확정 순간 StopState[] + key:'live' Dataset. A6 이후는 이걸로 그대로 돈다
 * SLOT_STATUS_TEXT/HELP — 슬롯 status 표시 문구. 화면 여러 곳(추천 카드·교체 시트)이 같이 쓴다
 */
import type { Candidate, Dataset, RouteOption, Stop } from '../data/mockData';
import { isOpenAt } from '../lib/routePlan/score';
import type { Alternative, PlanOption, PlanResult, Rescored, SlotStatus, Visit } from '../lib/routePlan/types';
import type { PlanFlowState } from './planFlow';
import type { ApplyLivePayload, StopState } from './plan';

export const SLOT_STATUS_TEXT: Partial<Record<SlotStatus, string>> = {
  far: '멀리 있음',
  none: '못 찾음',
  closed: '마감',
  late: '늦음',
  short: '일부만',
};

export const SLOT_STATUS_HELP: Partial<Record<SlotStatus, string>> = {
  far: '경로 근처에 없어 멀리 있는 곳으로 잡았어요.',
  none: '경로 15km 안에서 못 찾았어요. 다른 말로 적어 보세요.',
  closed: '도착할 때쯤 문을 닫아요.',
  late: '들르면 마감을 못 지켜요.',
  short: '말한 개수만큼 못 찾았어요.',
};

const toHHMM = (min: number) => `${Math.floor(min / 60) % 24}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function effectiveVisits(
  result: PlanResult,
  optionIdx: number,
  overrides: Record<number, Record<string, string>>,
): { visits: Visit[]; timing: Rescored; option: PlanOption } {
  const option = result.options[optionIdx] ?? result.options[0];
  const ov = overrides[optionIdx] ?? {};
  if (Object.keys(ov).length === 0) {
    return { visits: option.visits, timing: { totalMin: option.totalMin, arrivals: option.arrivals, distanceKm: option.distanceKm, estimated: false }, option };
  }
  const visits = option.visits.map(v => {
    const candId = ov[v.slotId];
    if (!candId) return v;
    const alt = result.alternatives.find(a => a.slotId === v.slotId && a.candidate.id === candId);
    return alt ? { ...v, candidate: alt.candidate } : v;
  });
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
    note: `${slotQuery} · 경로에서 ${round1(alt.detourKm)}km${alt.estimated ? ' · 추정' : ''}`,
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

export function toLegacyPlan({ flow, departMin }: { flow: PlanFlowState; departMin: number }): ApplyLivePayload {
  const { result, request, slots } = flow;
  if (!result || !request) throw new Error('toLegacyPlan: 결과가 없다');
  const { visits, timing } = effectiveVisits(result, flow.selectedOptionIdx, flow.overrides);
  const queryOf = (slotId: string) => slots.find(s => s.id === slotId)?.query ?? '';
  const idOf = (candId: string) => visits.find(v => v.candidate.id === candId)?.slotId;

  // stops — 방문 순서대로. leg는 도착시각 차에서
  let clock = departMin;
  const stops: StopState[] = visits.map((v, i) => {
    const arrive = timing.arrivals[i];
    const legMin = Math.round(arrive - clock);
    const legKey = `${i === 0 ? 'O' : visits[i - 1].candidate.id}>${v.candidate.id}`;
    const legKm = round1(result.legTable[legKey]?.km ?? 0);
    clock = arrive + v.dwellMin;
    const openState = openStateOf(v.candidate, arrive);
    return {
      id: v.slotId, baseId: v.slotId, name: v.candidate.name, category: queryOf(v.slotId), coord: v.candidate.coord,
      dwellMin: v.dwellMin, arriveAt: toHHMM(arrive), legMin, legKm, openState,
      openNote: `체류 ${v.dwellMin}분 · ${openNoteOf(openState)}`, tasks: [],
      replaceDeltaMin: 0, selectedCandidateId: v.candidate.id,
    };
  });

  // legs — legTable의 후보 id를 슬롯 id로 (선택된 후보만). 양끝은 origin/dest
  const legs: NonNullable<Dataset['legs']> = {};
  const mapId = (id: string) => (id === 'O' ? 'origin' : id === 'D' ? 'dest' : idOf(id));
  for (const [key, leg] of Object.entries(result.legTable)) {
    const [a, b] = key.split('>');
    const ma = mapId(a);
    const mb = mapId(b);
    if (!ma || !mb) continue;
    legs[`${ma}>${mb}`] = { min: Math.round(leg.min), km: round1(leg.km) };
  }
  legs['origin>dest'] = { min: Math.round(result.directMin), km: round1(result.directKm) };

  // candidates — 슬롯마다 현재 선택 + 대안
  const candidates: Dataset['candidates'] = {};
  visits.forEach((v, i) => {
    const arrive = timing.arrivals[i];
    candidates[v.slotId] = [
      chosenToCandidate(v, queryOf(v.slotId), arrive),
      ...result.alternatives.filter(a => a.slotId === v.slotId).map(a => alternativeToCandidate(a, queryOf(v.slotId), arrive + a.addedMin, v.dwellMin)),
    ];
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
