/**
 * 오케스트레이터. 설계 0~7단계 중 API가 필요한 부분을 provider로 돌린다.
 *
 *   직행 1회 → 회랑 투영 → 열거·추정 → 시드 R회(V=1은 SINGLE_R회) 병렬 실측
 *   → section에서 leg 학습 → 전체 재채점 → 조건부 2라운드 → Q=3 → 슬롯 status
 *
 * 대중교통만 호출 셈법이 다르다 — 공급자가 경유지를 못 받아 안 하나가 구간 수만큼 나간다.
 * 그래서 시드 수와 2라운드 추가분이 `transitBudget.ts` 의 예산(직행 포함 10회)에 묶인다.
 */
import { polylineLengthM } from '../geo';
import { destinationPoint, estimateA, estimateB, estimateC, originPoint, projectOnCorridor, type CorridorPoint } from './corridor';
import { enumeratePlans, totalVisits } from './enumerate';
import { DEST_ID, LegStore, learnLegs, ORIGIN_ID } from './legs';
import { allClosedAtArrival, estimateLegKm, scorePlan, type ScoreContext, type Scored } from './score';
import { pickOptions, pickSeeds, round2Plan, type Ranked } from './select';
import { TRANSIT_SEED_BUDGET, transitCallCost } from './transitBudget';
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
  // 대중교통은 공급자가 경유지를 못 실어 구간마다 한 번씩 나간다(transitProvider) —
  // 자동차는 경유지를 그대로 싣고 route() 한 번이면 /route 한 번이다.
  const transit = input.mode === 'transit';
  const legIds = (visits: Visit[]) => {
    const ids = [ORIGIN_ID, ...visits.map(v => v.candidate.id), DEST_ID];
    return ids.slice(1).map((to, i) => `${ids[i]}>${to}`);
  };
  /** 이번 파도에서 부르기로 이미 잡아 둔 구간. 파도가 끝나면 비운다 */
  let waveLegs = new Set<string>();
  /**
   * 이 안을 재는 데 **새로** 드는 공급자 호출 수.
   *
   * 대중교통은 구간마다 한 번이지만, 같은 파도(한 번의 Promise.all) 안에서 여러 안이
   * 공유하는 구간은 공급자가 동시 요청을 하나로 합쳐 한 번만 나간다. 그래서 이미 잡아 둔
   * 구간은 0으로 센다 — V=2 에서 `O→c1` 을 세 안이 공유하면 3회가 아니라 1회다.
   * 파도가 바뀌면(2라운드) 코얼레싱이 안 되므로 waveLegs 를 비우고 전액으로 다시 센다.
   */
  const callCost = (visits: Visit[]): number => {
    if (!transit) return 1;
    return new Set(legIds(visits).filter(k => !waveLegs.has(k))).size;
  };
  /** 경유 조합이 더 쓸 수 있는 공급자 호출 수. 직행 몫은 이미 빠져 있다 */
  let callBudget = transit ? TRANSIT_SEED_BUDGET : Infinity;
  let apiCalls = 0;
  let measuredCount = 0; // 성공한 라우팅 호출 수(직행 포함) — call() 성공 시마다 +1
  const call = async (visits: Visit[], cost = callCost(visits)) => {
    apiCalls += cost; // 실제로 나간 요청 수다 — 로그가 사용량을 축소해서 말하면 안 된다
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
  // 시드는 대중교통도 자동차와 같은 수로 **시도**한다 — 실제로 몇 안이 실측되는지는
  // 구간 중복을 뺀 예산이 정한다(transitBudget.ts). V=1 은 겹치는 구간이 없어 4안,
  // V=2 는 첫 경유지를 공유하면 4안까지 들어온다.
  const seeds = V === 0 ? [] : pickSeeds(ranked, V === 1 ? SINGLE_R : R);
  /** 예산으로는 한 안도 못 재는 경유지 수(대중교통 V≥9). 실측은 포기하되 계획까지 잃지는 않는다 —
      추정 점수로 안을 세우고 출처를 낮춘다. 일부만 못 재는 경우와 달리 실측·추정이 섞이지 않는다 */
  const noSeedFitsBudget = transit && transitCallCost(V) > TRANSIT_SEED_BUDGET;
  const measured: Scored[] = [];
  if (V === 0) measured.push(scorePlan([], ctx)); // 직행이 곧 계획. 이미 실측됐다
  const legErrors: { measuredMin: number; estimatedMin: number }[] = [];
  let seedEstimated = false; // 시드 중 하나라도 추정이면 true
  const measure = async (visits: Visit[]) => {
    // 예산이 모자라면 이 안은 실측하지 않는다 — 추정으로 남고, 실측한 안이 하나라도 있으면
    // 그쪽이 채점에서 이긴다. 2라운드 추가분이 여기서 걸린다(시드는 seedR 로 이미 맞춰 뽑았다)
    const cost = callCost(visits);
    if (cost > callBudget) {
      if (noSeedFitsBudget) { seedEstimated = true; measured.push(scorePlan(visits, ctx)); }
      return;
    }
    // await 앞에서 깎고 잡아 둔다 — 같은 파도의 다른 measure 가 같은 예산·같은 구간을 두 번 쓰지 못하게
    callBudget -= cost;
    for (const k of legIds(visits)) waveLegs.add(k);
    const est = scorePlan(visits, ctx); // 실측 전 추정 — 오차 계산용
    let route;
    try {
      route = await call(visits, cost);
    } catch {
      return; // 시드 하나 실패는 그 안만 버린다. 직행은 위에서 이미 성공했다
    }
    if (route.source !== 'provider') seedEstimated = true;
    const ids = [ORIGIN_ID, ...visits.map(v => v.candidate.id), DEST_ID];
    learnLegs(legs, ids, route, input.departAtMin, visits.map(v => v.dwellMin), input.mode);
    route.sections.forEach((sec, i) => {
      if (est.unknownLegs > 0) legErrors.push({ measuredMin: sec.durationMin, estimatedMin: est.legsMin[i] });
    });
    measured.push(scorePlan(visits, ctx));
  };
  /** 한 파도 = 한 번의 Promise.all. 공급자의 구간 코얼레싱이 이 경계 안에서만 듣는다 */
  const runWave = async (batch: Visit[][]) => {
    waveLegs = new Set();
    await Promise.all(batch.map(measure));
  };
  await runWave(seeds);

  // 4. 재채점 · 5. 2라운드
  if (V >= 2) {
    const rescored = plans.map(v => scorePlan(v, ctx));
    const r2 = round2Plan({ measured, rescored, legErrors, arriveByMin: input.arriveByMin, directMin });
    await runWave(r2.extra);
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

  // 직행이 공급자여도 시드가 추정이면 도착 시각의 대부분이 추정이다 — 그걸 provider 라 부르면 화면이 거짓말한다
  const timingSource: PlanResult['timingSource'] =
    direct.source !== 'provider' ? 'estimate' : seedEstimated ? 'provider_direct_only' : 'provider';
  return { directMin, directKm, options, alternatives, slotStatus, apiCalls, rescore, legTable, measuredCount, timingSource };
}
