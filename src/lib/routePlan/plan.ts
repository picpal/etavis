/**
 * 오케스트레이터. 설계 0~7단계 중 API가 필요한 부분을 provider로 돌린다.
 *
 *   직행 1회 → 회랑 투영 → 열거·추정 → 시드 R회(V=1은 SINGLE_R회) 병렬 실측
 *   → section에서 leg 학습 → 전체 재채점 → 조건부 2라운드 → Q=3 → 슬롯 status
 */
import { polylineLengthM } from '../geo';
import { destinationPoint, estimateA, estimateB, estimateC, originPoint, projectOnCorridor, type CorridorPoint } from './corridor';
import { enumeratePlans, totalVisits } from './enumerate';
import { DEST_ID, LegStore, learnLegs, ORIGIN_ID } from './legs';
import { allClosedAtArrival, estimateLegKm, scorePlan, type ScoreContext, type Scored } from './score';
import { pickOptions, pickSeeds, round2Plan, type Ranked } from './select';
import type { Alternative, LatLng, PlanInput, PlanOption, PlanResult, Rescored, RouteProvider, RouteResult, SlotStatus, Visit } from './types';

const DEFAULT_R = 4;
const BEAM_FULL_UPTO = 3;
const BEAM_WIDTH = 64;
/** 경유지가 1곳이면 후보 하나하나가 곧 계획이라 전부 실측할 수 있었다.
    후보 상한이 30으로 오르면서 그 전제가 깨졌다 — 실측 예산만 묶는다 */
const SINGLE_R = 8;

export async function plan(
  input: PlanInput,
  provider: RouteProvider,
  opts: { R?: number; beamWidth?: number; direct?: RouteResult } = {},
): Promise<PlanResult> {
  const R = opts.R ?? DEFAULT_R;
  let apiCalls = 0;
  let measuredCount = 0; // 성공한 라우팅 호출 수(직행 포함) — call() 성공 시마다 +1
  const call = async (visits: Visit[]) => {
    apiCalls++;
    const points = [input.origin, ...visits.map(v => v.candidate.coord), input.destination];
    const result = await provider.route(points, input.departAtMin, input.mode);
    measuredCount++;
    return result;
  };

  // 0. 직행 — 파이프라인이 이미 실측했으면 재사용. 재사용도 성공한 실측이니 센다
  const direct = opts.direct ?? (await call([]));
  if (opts.direct) measuredCount++;
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
  const seeds = V === 0 ? [] : pickSeeds(ranked, V === 1 ? SINGLE_R : R);
  const measured: Scored[] = [];
  if (V === 0) measured.push(scorePlan([], ctx)); // 직행이 곧 계획. 이미 실측됐다
  const legErrors: { measuredMin: number; estimatedMin: number }[] = [];
  const measure = async (visits: Visit[]) => {
    const est = scorePlan(visits, ctx); // 실측 전 추정 — 오차 계산용
    let route;
    try {
      route = await call(visits);
    } catch {
      return; // 시드 하나 실패는 그 안만 버린다. 직행은 위에서 이미 성공했다
    }
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
    slotStatus[slot.id] = 'ok';
  }

  const rescore = (visits: Visit[]): Rescored => {
    // 교체 시트는 회랑에 없던 후보도 넣을 수 있다 — 그 자리에서 투영한다
    const localCps = new Map<string, CorridorPoint>();
    for (const v of visits) if (!corridor.has(v.candidate.id)) localCps.set(v.candidate.id, projectOnCorridor(poly, v.candidate.coord));
    const rescoreCtx: ScoreContext = { ...ctx, corridorOf: id => corridor.get(id) ?? localCps.get(id)! };
    const s = scorePlan(visits, rescoreCtx);
    return { totalMin: s.totalMin, arrivals: s.arrivals, distanceKm: s.distanceKm, estimated: s.unknownLegs > 0, legsKm: s.legsKm };
  };

  // leg 표 — 옵션에 등장한 후보 전부 × 양끝
  const nodeIds = new Set<string>();
  const nodeCoord = new Map<string, LatLng>([[ORIGIN_ID, input.origin], [DEST_ID, input.destination]]);
  const nodeCp = new Map<string, CorridorPoint>([[ORIGIN_ID, originPoint()], [DEST_ID, destinationPoint(L)]]);
  for (const o of chosen) {
    for (const v of o.visits) {
      nodeIds.add(v.candidate.id);
      nodeCoord.set(v.candidate.id, v.candidate.coord);
      nodeCp.set(v.candidate.id, corridor.get(v.candidate.id)!);
    }
  }
  const nodes = [ORIGIN_ID, ...nodeIds, DEST_ID];
  const legTable: PlanResult['legTable'] = {};
  for (const a of nodes) for (const b of nodes) {
    if (a === b || a === DEST_ID || b === ORIGIN_ID) continue;
    const hit = legs.lookup(a, b, input.mode, input.departAtMin);
    if (hit) legTable[`${a}>${b}`] = { min: hit.durationMin, km: hit.distanceKm, measured: true };
    else {
      const km = estimateLegKm(nodeCoord.get(a)!, nodeCoord.get(b)!, nodeCp.get(a)!, nodeCp.get(b)!);
      legTable[`${a}>${b}`] = { min: km * ctx.rhoMinPerKm, km, measured: false };
    }
  }

  return { directMin, directKm, options, alternatives, slotStatus, apiCalls, rescore, legTable, measuredCount };
}
