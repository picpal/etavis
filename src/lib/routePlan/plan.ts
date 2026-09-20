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
import { allClosedAtArrival, comfortMin, estimateLegKm, scorePlan, type ScoreContext, type Scored } from './score';
import { pickOptions, pickSeeds, planKey, round2Plan, type Ranked } from './select';
import { TRANSIT_SEED_BUDGET, transitCallCost } from './transitBudget';
import type { Alternative, LatLng, PlaceCandidate, PlanInput, PlanOption, PlanResult, Rescored, RescoredFrom, RouteProvider, RouteResult, SlotStatus, TimeClass, Timed, Visit } from './types';

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
  /**
   * 짐을 재야 할 계획인가. 태그가 없거나 자동차면 **계산을 통째로 건너뛴다** —
   * `burdenMin` 이 0 이라 순위가 지금과 같고, 계획마다 scorePlan 을 한 번 더
   * 도는 비용도 안 낸다. 실사용 대부분이 이쪽이다.
   */
  const burdened = input.mode !== 'car'
    && input.slots.some(s => s.loadBefore === 'hard' || s.loadAfter === 'hard');
  const tags = new Map(input.slots.map(s => [s.id, {
    loadBefore: s.loadBefore ?? 'none', loadAfter: s.loadAfter ?? 'none', needWhen: s.needWhen ?? 'unknown',
  }]));

  const ctx: ScoreContext = {
    origin: input.origin, destination: input.destination, corridorLengthM: L,
    rhoMinPerKm: directMin / Math.max(directKm, 0.1), mode: input.mode, departAtMin: input.departAtMin, legs,
    corridorOf: id => corridor.get(id)!,
    tagsOf: burdened ? id => tags.get(id) : undefined,
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
    // 추정 단계에서도 scorePlan 이 legsMin 을 낸다(없는 leg 는 추정으로 채운다).
    // 그래서 실측 전에도 짐 시간을 알 수 있고, 시드가 그걸 보고 고를 수 있다.
    const burdenMin = burdened ? scorePlan(visits, ctx).burdenMin : 0;
    return { visits, estA: a, estB: b, estC: estimateC(a, b), burdenMin };
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
  /** 시드 중 하나라도 구간을 쪼개 이어 붙였으면 true — 나중 구간이 잘못된 출발 시각으로 조회됐다는 뜻 */
  let seedLegJoined = false;
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
    if (route.legJoined) seedLegJoined = true;
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

  /**
   * `추천 순서` 가 가리킬 자리. 짐을 안 재는 계획이면 `null`.
   * `0` 이면 최단안이 곧 편한 안이라 두 기준이 같은 안을 가리킨다 — 그 판정은 화면이 한다.
   */
  const comfortBest = burdened
    ? [...finalMeasured].sort((a, b) => comfortMin(a) - comfortMin(b))[0]
    : undefined;
  const ci = comfortBest
    ? chosen.findIndex(s => planKey(s.visits) === planKey(comfortBest.visits))
    : -1;
  const comfortIdx = ci >= 0 ? ci : null;

  // 슬롯 status
  const slotStatus: Record<string, SlotStatus> = {};
  for (const slot of input.slots) {
    // 반드시 0건 검사보다 먼저 본다 — 못 본 슬롯도 후보가 0건이라,
    // 순서를 바꾸면 'none'(= 찾아봤는데 없음)이 덮어쓰면서
    // 아예 검색한 적 없는 곳을 "못 찾았다"고 말하게 된다
    if (slot.searchStatus === 'unchecked') { slotStatus[slot.id] = 'unchecked'; continue; }
    if (slot.candidates.length === 0) { slotStatus[slot.id] = 'none'; continue; }
    if (slot.searchStatus === 'far' || slot.searchStatus === 'short') { slotStatus[slot.id] = slot.searchStatus; continue; }
    const ofSlot = best ? best.visits.map((v, i) => ({ v, i })).filter(x => x.v.slotId === slot.id) : [];
    if (best && ofSlot.length && allClosedAtArrival({ ...best, visits: ofSlot.map(x => x.v), arrivals: ofSlot.map(x => best.arrivals[x.i]) })) {
      slotStatus[slot.id] = 'closed'; continue;
    }
    slotStatus[slot.id] = 'ok';
  }

  /** 교체 시트는 회랑에 없던 후보도 넣을 수 있다 — 그 자리에서 투영한 회랑점까지 아는 ctx */
  const ctxFor = (visits: Visit[]): ScoreContext => {
    const localCps = new Map<string, CorridorPoint>();
    for (const v of visits) if (!corridor.has(v.candidate.id)) localCps.set(v.candidate.id, projectOnCorridor(poly, v.candidate.coord));
    return { ...ctx, corridorOf: id => corridor.get(id) ?? localCps.get(id)! };
  };
  const rescore = (visits: Visit[]): Rescored => {
    const s = scorePlan(visits, ctxFor(visits));
    return { totalMin: s.totalMin, arrivals: s.arrivals, distanceKm: s.distanceKm, estimated: s.unknownLegs > 0, legsKm: s.legsKm, legCls: s.legCls };
  };

  /**
   * 같은-자 차이. 안 바뀐 구간은 기준 값·등급 그대로 베끼고, 바뀐 구간만 다시 낸다:
   *   둘 다 실측         → M_new,  Δ = M_new − M_old               (measured)
   *   아니면             → E_new·E_old 를 **같은 추정기**(km × ρ)로 내고 Δ = E_new − E_old,
   *                        값 = max(E_new, M_old + Δ)              (estimated)
   * 대중교통 실측엔 구간마다 접근·대기 8분이 들어 있고 km × ρ 엔 없다. 그래서 실측 합계에서
   * 추정 합계를 빼면 홍대 안 300m 옆 후보가 −32분이 됐다(2026-09-20). 같은 자로 잰 두 값의
   * 차는 그 계통 오차가 서로 지워져 "약 +1분"이 된다. 상수로 보정하지 않는다 —
   * 구간 오차는 한쪽으로 쏠린 게 아니라 흩어져 있어 보정해도 RMSE 9% 다(docs/transit-추정-오차.md).
   * `max(E_new, …)` 하한은 음수 구간을 막는 것이지 보정이 아니다.
   *
   * 도착 차이·총합 차이는 (새 시계 − 기준 시계) 로 낸다 — 안 바뀐 구간을 그대로 베꼈으니
   * 정확히 바뀐 구간들의 Δ 합(+ 체류 차이)이고, 여행 전체 차이를 한 지점에 더할 자리가 없다(21:58).
   */
  const rescoreFrom = (base: Visit[], visits: Visit[]): RescoredFrom => {
    if (base.length !== visits.length) throw new Error(`rescoreFrom: 방문 수가 다르다(${base.length}≠${visits.length}) — 교체만 잰다`);
    const rctx = ctxFor([...base, ...visits]);
    const b = scorePlan(base, rctx);
    const idsOf = (vs: Visit[]) => [ORIGIN_ID, ...vs.map(v => v.candidate.id), DEST_ID];
    const coordsOf = (vs: Visit[]) => [input.origin, ...vs.map(v => v.candidate.coord), input.destination];
    const cpsOf = (vs: Visit[]) => [originPoint(), ...vs.map(v => rctx.corridorOf(v.candidate.id)), destinationPoint(L)];
    const bIds = idsOf(base), nIds = idsOf(visits);
    const bCoords = coordsOf(base), nCoords = coordsOf(visits);
    const bCps = cpsOf(base), nCps = cpsOf(visits);
    const lower = (a: TimeClass, c: TimeClass): TimeClass => (a === 'estimated' || c === 'estimated' ? 'estimated' : 'measured');

    let clock = input.departAtMin;
    let distanceKm = 0;
    let changedCls: TimeClass = 'measured'; // 지금까지 바뀐 구간들의 최저 등급. 바뀐 게 없으면 차이 0 은 정확하다
    const arrivals: number[] = [];
    const legsKm: number[] = [];
    const legCls: TimeClass[] = [];
    const dArrivals: Timed[] = [];
    for (let k = 0; k < nIds.length - 1; k++) {
      const same = bIds[k] === nIds[k] && bIds[k + 1] === nIds[k + 1];
      let min: number, km: number, cls: TimeClass;
      if (same) {
        min = b.legsMin[k]; km = b.legsKm[k]; cls = b.legCls[k];
      } else {
        const hit = legs.lookup(nIds[k], nIds[k + 1], input.mode, clock);
        if (hit && b.legCls[k] === 'measured') {
          min = hit.durationMin; km = hit.distanceKm; cls = 'measured';
        } else {
          const eNewKm = estimateLegKm(nCoords[k], nCoords[k + 1], nCps[k], nCps[k + 1]);
          const eOldKm = estimateLegKm(bCoords[k], bCoords[k + 1], bCps[k], bCps[k + 1]);
          // 기준이 추정이면 b.legsMin[k] = E_old 라 그대로 E_new 가 된다
          min = Math.max(eNewKm * ctx.rhoMinPerKm, b.legsMin[k] + (eNewKm - eOldKm) * ctx.rhoMinPerKm);
          km = Math.max(eNewKm, b.legsKm[k] + (eNewKm - eOldKm));
          cls = 'estimated';
        }
        changedCls = lower(changedCls, cls);
      }
      distanceKm += km;
      clock += min;
      arrivals.push(clock);
      legsKm.push(km);
      legCls.push(cls);
      dArrivals.push({ min: clock - b.arrivals[k], cls: changedCls });
      if (k < visits.length) clock += visits[k].dwellMin;
    }
    const totalMin = clock - input.departAtMin;
    return {
      totalMin, arrivals, distanceKm, legsKm, legCls,
      estimated: legCls.some(c => c === 'estimated'),
      delta: { totalMin: { min: totalMin - b.totalMin, cls: changedCls }, arrivals: dArrivals },
    };
  };

  const alternativeAt = (base: Visit[], idx: number, candidate: PlaceCandidate): Alternative => {
    const v = base[idx];
    if (!v) throw new Error(`alternativeAt: idx ${idx} 가 기준 안 밖이다`);
    const swapped = base.map((vv, i) => (i === idx ? { ...vv, candidate } : vv));
    const r = rescoreFrom(base, swapped);
    // 도착의 등급은 그 지점까지의 구간 전부가 정한다 — 앞에 추정 구간이 있으면 실측 구간을 바꿔도 '약'이다
    const arriveCls: TimeClass = r.legCls.slice(0, idx + 1).some(c => c === 'estimated') ? 'estimated' : 'measured';
    const cp = corridor.get(candidate.id) ?? projectOnCorridor(poly, candidate.coord);
    return {
      slotId: v.slotId, candidate,
      addedMin: r.delta.totalMin,
      arriveMin: { min: r.arrivals[idx], cls: arriveCls },
      detourKm: Math.abs(cp.y) / 1000,
    };
  };

  // 대안 — 1안에서 슬롯 하나만 바꿔 관문으로 잰다
  const alternatives: Alternative[] = [];
  if (best) {
    for (const slot of input.slots) {
      const idx = best.visits.findIndex(v => v.slotId === slot.id);
      if (idx < 0) continue;
      for (const cand of slot.candidates) {
        if (best.visits.some(v => v.candidate.id === cand.id)) continue;
        alternatives.push(alternativeAt(best.visits, idx, cand));
      }
    }
  }

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

  // 직행이 공급자여도 시드가 추정이면 도착 시각의 대부분이 추정이다 — 그걸 provider 라 부르면 화면이 거짓말한다.
  // 전부 실측이어도 구간을 쪼개 이어 붙였으면 한 단계 낮춘다(provider_legs): 구간을 병렬로 불러
  // 2구간 이후도 계획의 출발 시각으로 조회됐다. 체류 뒤의 배차는 다르고, 그 위에서 "3분 여유"를
  // 말하면 뒤집힐 수 있다. 쪼갰는지는 공급자만 안다 — 여기서 mode·V 로 추측하면 공급자가
  // 경유지를 한 번에 받게 되는 날 조용히 거짓말이 된다(자동차 카카오가 이미 그렇다).
  const timingSource: PlanResult['timingSource'] =
    direct.source !== 'provider' ? 'estimate'
      : seedEstimated ? 'provider_direct_only'
        : seedLegJoined ? 'provider_legs' : 'provider';
  return { directMin, directKm, options, comfortIdx, alternatives, slotStatus, apiCalls, rescore, rescoreFrom, alternativeAt, legTable, measuredCount, timingSource };
}
