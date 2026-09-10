/**
 * 오케스트레이터. 설계 0~7단계 중 API가 필요한 부분을 provider로 돌린다.
 *
 *   직행 1회 → 회랑 투영 → 열거·추정 → 시드 R회(V=1은 전부) 병렬 실측
 *   → section에서 leg 학습 → 전체 재채점 → 조건부 2라운드 → Q=3 → 슬롯 status
 */
import { polylineLengthM } from '../geo';
import { destinationPoint, estimateA, estimateB, estimateC, originPoint, projectOnCorridor, type CorridorPoint } from './corridor';
import { enumeratePlans, totalVisits } from './enumerate';
import { DEST_ID, LegStore, learnLegs, ORIGIN_ID } from './legs';
import { allClosedAtArrival, scorePlan, type ScoreContext, type Scored } from './score';
import { pickOptions, pickSeeds, round2Plan, type Ranked } from './select';
import type { Alternative, PlanInput, PlanOption, PlanResult, RouteProvider, SlotStatus, Visit } from './types';

const DEFAULT_R = 4;
const BEAM_FULL_UPTO = 3;
const BEAM_WIDTH = 64;

export async function plan(
  input: PlanInput,
  provider: RouteProvider,
  opts: { R?: number; beamWidth?: number } = {},
): Promise<PlanResult> {
  const R = opts.R ?? DEFAULT_R;
  let apiCalls = 0;
  const call = async (visits: Visit[]) => {
    apiCalls++;
    const points = [input.origin, ...visits.map(v => v.candidate.coord), input.destination];
    return provider.route(points, input.departAtMin, input.mode);
  };

  // 0. 직행
  const direct = await call([]);
  const directMin = direct.durationMin;
  const directKm = direct.distanceKm;
  const legs = new LegStore();
  learnLegs(legs, [ORIGIN_ID, DEST_ID], direct, input.departAtMin, [], input.mode);

  // 회랑 투영 — 후보마다 한 번
  const poly = direct.polyline.length >= 2 ? direct.polyline : [input.origin, input.destination];
  const L = polylineLengthM(poly);
  const corridor = new Map<string, CorridorPoint>();
  for (const s of input.slots) for (const c of s.candidates) if (!corridor.has(c.id)) corridor.set(c.id, projectOnCorridor(poly, c.coord));
  const ctx: ScoreContext = {
    origin: input.origin, destination: input.destination, corridorLengthM: L,
    rhoMinPerKm: directMin / Math.max(directKm, 0.1), mode: input.mode, departAtMin: input.departAtMin, legs,
    corridorOf: id => corridor.get(id)!,
  };

  // 1·2. 열거 + 추정
  const V = totalVisits(input.slots);
  const beam = V <= BEAM_FULL_UPTO ? Infinity : opts.beamWidth ?? BEAM_WIDTH;
  const partial = (seq: Visit[]) => scorePlan(seq, ctx).totalMin;
  const plans = enumeratePlans(input.slots, input.order, partial, beam);
  const ranked: Ranked[] = plans.map(visits => {
    const cps = [originPoint(), ...visits.map(v => corridor.get(v.candidate.id)!), destinationPoint(L)];
    const coords = [input.origin, ...visits.map(v => v.candidate.coord), input.destination];
    const dwell = visits.reduce((s, v) => s + v.dwellMin, 0);
    const a = (estimateA(cps) / 1000) * ctx.rhoMinPerKm + dwell;
    const b = (estimateB(coords) / 1000) * ctx.rhoMinPerKm + dwell;
    return { visits, estA: a, estB: b, estC: estimateC(a, b) };
  });

  // 3. 1라운드 실측
  const seeds = V === 0 ? [] : V === 1 ? ranked.map(r => r.visits) : pickSeeds(ranked, R);
  const measured: Scored[] = [];
  if (V === 0) measured.push(scorePlan([], ctx)); // 직행이 곧 계획. 이미 실측됐다
  const legErrors: { measuredMin: number; estimatedMin: number }[] = [];
  const measure = async (visits: Visit[]) => {
    const est = scorePlan(visits, ctx); // 실측 전 추정 — 오차 계산용
    const route = await call(visits);
    const ids = [ORIGIN_ID, ...visits.map(v => v.candidate.id), DEST_ID];
    learnLegs(legs, ids, route, input.departAtMin, visits.map(v => v.dwellMin), input.mode);
    route.sections.forEach((sec, i) => {
      if (est.unknownLegs > 0) legErrors.push({ measuredMin: sec.durationMin, estimatedMin: est.legsMin[i] });
    });
    measured.push(scorePlan(visits, ctx));
  };
  await Promise.all(seeds.map(measure));

  // 4. 재채점 · 5. 2라운드
  if (V >= 2) {
    const rescored = plans.map(v => scorePlan(v, ctx));
    const r2 = round2Plan({ measured, rescored, legErrors, arriveByMin: input.arriveByMin, directMin });
    await Promise.all(r2.extra.map(measure));
  }
  // 실측된 계획을 최신 leg로 다시 채점(2라운드가 leg를 더 알았을 수 있다)
  const finalMeasured = measured.map(m => scorePlan(m.visits, ctx));

  // 6. 선택
  const toOption = (s: Scored): PlanOption => ({
    visits: s.visits,
    totalMin: s.totalMin,
    deltaMin: s.totalMin - directMin,
    arrivals: s.arrivals,
    slackMin: input.arriveByMin == null ? null : input.arriveByMin - s.arrivals[s.arrivals.length - 1],
    distanceKm: s.distanceKm,
  });
  const chosen = pickOptions(finalMeasured, directMin, 3);
  const options = chosen.map(toOption);
  const best = chosen[0];

  // 7. 조건 완화안 — arriveBy 위반이면 가장 비싼 슬롯을 빼고 1회 실측
  let relaxed: PlanResult['relaxed'];
  const late = best != null && input.arriveByMin != null && best.arrivals[best.arrivals.length - 1] > input.arriveByMin;
  if (late && best.visits.length > 0) {
    const bySlot = new Map<string, Visit[]>();
    for (const v of best.visits) bySlot.set(v.slotId, [...(bySlot.get(v.slotId) ?? []), v]);
    let worst: { slotId: string; visits: Visit[]; totalMin: number } | null = null;
    for (const slotId of bySlot.keys()) {
      const rest = best.visits.filter(v => v.slotId !== slotId);
      const est = scorePlan(rest, ctx);
      if (!worst || est.totalMin < worst.totalMin) worst = { slotId, visits: rest, totalMin: est.totalMin };
    }
    if (worst) {
      const route = await call(worst.visits);
      learnLegs(legs, [ORIGIN_ID, ...worst.visits.map(v => v.candidate.id), DEST_ID], route, input.departAtMin, worst.visits.map(v => v.dwellMin), input.mode);
      relaxed = { ...toOption(scorePlan(worst.visits, ctx)), droppedSlotId: worst.slotId };
    }
  }

  // 대안 — 1안에서 슬롯 하나만 바꿔 채점
  const alternatives: Alternative[] = [];
  if (best) {
    for (const slot of input.slots) {
      const idx = best.visits.findIndex(v => v.slotId === slot.id);
      if (idx < 0) continue;
      for (const cand of slot.candidates) {
        if (best.visits.some(v => v.candidate.id === cand.id)) continue;
        const swapped = best.visits.map((v, i) => (i === idx ? { ...v, candidate: cand } : v));
        const s = scorePlan(swapped, ctx);
        alternatives.push({
          slotId: slot.id, candidate: cand,
          addedMin: s.totalMin - best.totalMin,
          detourKm: Math.max(0, s.distanceKm - best.distanceKm),
          estimated: s.unknownLegs > 0,
        });
      }
    }
  }

  // 슬롯 status
  const slotStatus: Record<string, SlotStatus> = {};
  for (const slot of input.slots) {
    if (slot.candidates.length === 0) { slotStatus[slot.id] = 'none'; continue; }
    if (slot.searchStatus === 'far' || slot.searchStatus === 'short') { slotStatus[slot.id] = slot.searchStatus; continue; }
    const ofSlot = best ? best.visits.map((v, i) => ({ v, i })).filter(x => x.v.slotId === slot.id) : [];
    if (best && ofSlot.length && allClosedAtArrival({ ...best, visits: ofSlot.map(x => x.v), arrivals: ofSlot.map(x => best.arrivals[x.i]) })) {
      slotStatus[slot.id] = 'closed'; continue;
    }
    if (relaxed && relaxed.droppedSlotId === slot.id) { slotStatus[slot.id] = 'late'; continue; }
    slotStatus[slot.id] = 'ok';
  }

  return { directMin, directKm, options, relaxed, alternatives, slotStatus, apiCalls };
}
