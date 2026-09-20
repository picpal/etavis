/**
 * 교체 시트에서 고른 매장의 **두 구간만** 다시 재는 일(설계 6단계). 플래너의
 * `PlanResult.measureSwap` 을 언제 부르고, 응답이 왔을 때 그걸 화면에 반영해도 되는지를 정한다.
 *
 * React 를 안 문다. 실제로 틀리는 자리는 렌더가 아니라 "불러도 되나 · 늦게 온 응답을 버리나"
 * 두 판단이고, 그 둘을 화면 안에 두면 A5 와 A6 가 각자 다르게 틀린다 —
 * 한 곳만 고쳐 다른 화면이 거짓말하는 것이 이 코드베이스의 단골 결함이다.
 */
import type { PlanResult, Slot, TimingSource, Visit } from '../lib/routePlan/types';
import type { StopState } from './plan';
import { visitsFromStops } from './planFlowBridge';

/**
 * 안 잰 이유. **조용히 아무 일도 안 일어나면 기기에서 원인을 못 짚는다** — A6 가 끝까지 '약'인데
 * `조회 중` 도 안 떠서 이른 `return` 넷 중 어디서 끊겼는지 몰라 하루를 썼다(2026-09-21).
 * 로그 한 줄이 그걸 한 탭에 가른다(`cand.measureSkip`)
 */
export type SwapSkip =
  /** 계획이 없다. 확정 뒤라면 `flow.reset()` 이 결과를 버린 것이다 — 스톱 문제와 **다른 병**이라
   *  이름을 갈라 둔다. 둘을 한 이름으로 묶어 놨다가 기기 로그가 엉뚱한 곳을 가리켰다(2026-09-21) */
  | 'no-plan'
  /** 직행만 실측·추정 계획 — 재도 '약'이 안 지워진다 */
  | 'source-not-measurable'
  /** 기준 안에 추정 구간이 남아 있다 — 이 둘을 사도 배너의 '약'은 그대로다 */
  | 'base-has-estimate'
  | 'idx-out-of-range'
  /** 교체가 아니라 다른 계획이다 */
  | 'length-mismatch'
  /** 그 스톱이 지금 목록에 없다 */
  | 'stop-not-found'
  /** 스톱의 `baseId` 가 이 계획의 슬롯에 없다 — 목 데이터셋 스톱이 섞였다 */
  | 'slot-not-found'
  /** 슬롯은 있는데 그 스톱이 가리키는 후보를 못 찾는다 — `selectedCandidateId` 가 비었거나 남의 것이다 */
  | 'stop-candidate-unknown'
  /** 시트가 넘긴 후보가 슬롯에 없다 */
  | 'candidate-not-in-slot';

/**
 * 이 계획에서 고른 매장을 재면 '약'이 실제로 지워지나.
 *
 * **`provider_direct_only` 에서는 부르지 않는다.** 그 계획은 직행만 실측이고 경유 구간 시드가
 * 전부 추정이라, `rescoreFrom` 의 관문(`hit && b.legCls[k] === 'measured'`)이 기준 안 쪽에서
 * 막힌다 — 두 번을 쓰고도 후보 카드의 등급은 'estimated' 그대로다. 플래너는 일부러 안 막았다:
 * "잴 수 있나"는 플래너의 질문이고 "재서 무엇이 달라지나"는 화면의 질문이라 여기서 가른다.
 * `estimate`(목·폴백)도 같은 이유로 제외한다.
 *
 * 두 번째 조건은 **기준 안의 구간이 전부 실측인가**다. 하나라도 추정이면 두 구간을 사도
 * 배너의 '약'이 그대로라 돈만 나간다(V≥3 처럼 시드 예산이 모자란 안).
 *
 * **반드시 기준 안(`base`)에 묻는다. 바꾼 뒤의 안에 물으면 안 된다.** 바뀐 두 구간이 추정이 되면
 * 그 뒤 구간의 **조회 시각까지 같이 밀리고**, LegStore 의 창은 15분이라(`legs.ts` PROVISIONAL_MIN)
 * 멀쩡히 실측된 구간마저 'estimated' 로 읽힌다. 그걸 관문으로 쓰면 경유지 둘 이상인 계획에서
 * 마지막이 아닌 자리는 **영영 못 잰다** — 기기에서 A6 교체가 끝까지 '약'이었던 원인이다
 * (2026-09-21, 예산은 4가 통째로 남아 있었다). 밀려 보이는 건 아직 안 쟀기 때문이지
 * 그 구간을 못 쟀다는 뜻이 아니다. 같은 이유로 `rescoreFrom` 도 관문을 기준 안(`b.legCls`)에 묻는다.
 *
 * `rescore` 는 공짜다(저장소 조회뿐).
 */
export function swapSkipReason(
  result: Pick<PlanResult, 'rescore' | 'timingSource'>,
  base: Visit[],
  visits: Visit[],
  idx: number,
): SwapSkip | null {
  if (!visits[idx]) return 'idx-out-of-range';
  if (base.length !== visits.length) return 'length-mismatch';
  if (!measurableSource(result.timingSource)) return 'source-not-measurable';
  if (!result.rescore(base).legCls.every(c => c === 'measured')) return 'base-has-estimate';
  return null;
}

export function shouldMeasureSwap(
  result: Pick<PlanResult, 'rescore' | 'timingSource'>,
  base: Visit[],
  visits: Visit[],
  idx: number,
): boolean {
  return swapSkipReason(result, base, visits, idx) === null;
}

/** 재기 하나에 필요한 것 — 바꾸기 전 안, 바꾼 뒤 안, 바뀐 자리 */
export type SwapTarget = { base: Visit[]; visits: Visit[]; idx: number };

/**
 * 확정본(A6)의 "스톱 하나를 이 후보로" 를 플래너가 아는 말로 옮긴다. A5 는 이미 `Visit[]` 를
 * 손에 쥐고 있지만 A6 가 든 건 `StopState[]` 뿐이라, 이 변환이 A6 에만 있는 유일한 구간이고
 * **A5 가 되는데 A6 가 안 될 때 범인은 거의 여기다.** 그래서 실패를 `null` 이 아니라
 * 이유로 돌려준다.
 *
 * `stops` 는 **교체가 리듀서에 닿기 전** 목록이어야 한다 — 그게 곧 기준 안이다.
 */
export function swapTargetFromStops(
  slots: Slot[],
  stops: StopState[],
  stopId: string,
  candidateId: string,
): SwapTarget | SwapSkip {
  const idx = stops.findIndex(s => s.id === stopId);
  if (idx < 0) return 'stop-not-found';
  const base = visitsFromStops(slots, stops);
  // 왜 못 되돌렸는지까지 가른다 — 슬롯이 없는 것과 후보를 못 집는 것은 고치는 자리가 다르다
  if (!base) {
    return stops.some(s => !slots.some(x => x.id === s.baseId)) ? 'slot-not-found' : 'stop-candidate-unknown';
  }
  const cand = slots.find(x => x.id === stops[idx].baseId)?.candidates.find(c => c.id === candidateId);
  if (!cand) return 'candidate-not-in-slot';
  return { base, visits: base.map((v, i) => (i === idx ? { ...v, candidate: cand } : v)), idx };
}

const measurableSource = (s: TimingSource | undefined): boolean => s === 'provider' || s === 'provider_legs';

export type SwapMeasurer = {
  /**
   * 고르기 하나를 잰다. `base` 는 **바꾸기 전** 안, `visits` 는 **교체가 반영된 뒤의** 배열,
   * `idx` 는 바뀐 자리다. 둘 다 필요하다 — 잴 자격은 기준 안이 정하고 잴 대상은 바뀐 안이 정한다.
   * 돌려주는 값은 "이번 응답을 화면에 반영했나"다 — 자격이 없거나, 예산·공급자가 못 재 줬거나,
   * 그 사이에 사용자가 또 골라 늦은 응답이 된 경우 전부 false 다.
   */
  measure: (result: PlanResult, base: Visit[], visits: Visit[], idx: number) => Promise<boolean>;
};

/**
 * A6 가 한 번의 고르기로 재기까지 가는 데 필요한 것 전부를 **한 곳에서** 푼다.
 * 훅은 이걸 부르고 결과를 로그로 흘리는 것 말고 하는 일이 없다 — 분기를 훅 안에 두면
 * node 테스트가 못 닿고, 그 안 닿는 자리에서 조용히 막혔다(2026-09-21).
 */
export function a6SwapTarget(
  flow: { result: PlanResult | null; slots: Slot[] },
  stops: StopState[],
  stopId: string,
  candidateId: string,
): { result: PlanResult; target: SwapTarget } | SwapSkip {
  // 확정하면서 계획을 버렸다면 잴 수단 자체가 없다. 스톱을 못 되돌린 것과 **다른 병**이다
  if (!flow.result) return 'no-plan';
  const target = swapTargetFromStops(flow.slots, stops, stopId, candidateId);
  return typeof target === 'string' ? target : { result: flow.result, target };
}

/**
 * 재기 하나를 관리한다. 화면마다 하나씩 만든다(A5·A6).
 *
 * **경합**: 재는 데 1~3초가 걸리는데 그동안 사용자는 시트에서 다른 곳을 또 고를 수 있다.
 * 표(`seq`)를 하나 두고, 응답이 왔을 때 내 표가 최신이 아니면 **아무것도 안 한다** —
 * 취소(AbortController)가 아니라 폐기다. 이미 나간 `/transit` 은 어차피 과금되고 그 구간은
 * 저장소에 남아 다음 조회를 공짜로 만드니 취소할 이유가 없다. 되돌리면 안 되는 건 **화면**이다:
 * A6 의 반영은 "그 시점 방문 배열로 다시 낸 leg 표·후보 목록"이라, 늦은 응답을 그대로 먹이면
 * 방금 고른 매장이 이전 매장으로 조용히 되돌아간다.
 *
 * `onMeasuring` 도 최신 표만 건드린다. 늦은 응답이 배너의 '조회 중'을 끄면, 진짜로 나가 있는
 * 요청을 없다고 말하게 된다.
 */
export function createSwapMeasurer(opts: {
  onMeasuring: (measuring: boolean) => void;
  /** 두 구간이 실측으로 들어왔다. 파생을 다시 돌려 '약'을 지우는 쪽 */
  onLearned: (visits: Visit[], idx: number) => void;
  /** 안 잰 이유. 로그로만 나간다 — 화면에 띄울 일이 아니다('약'이 남는 게 사용자에게 보이는 전부다) */
  onSkip?: (reason: SwapSkip) => void;
}): SwapMeasurer {
  let seq = 0;
  return {
    measure: async (result, base, visits, idx) => {
      const skip = swapSkipReason(result, base, visits, idx);
      if (skip) { opts.onSkip?.(skip); return false; }
      const mine = ++seq;
      opts.onMeasuring(true);
      let ok = false;
      try {
        ok = await result.measureSwap(visits, idx);
      } catch {
        // 던지지 않기로 한 계약이지만 공급자 교체가 이 약속을 깨도 고르기가 막히면 안 된다.
        // 실패는 '약'이 남는 것일 뿐이라 화면에 에러를 띄우지 않는다
        ok = false;
      }
      if (mine !== seq) return false; // 늦게 온 옛 응답 — 화면은 이미 다른 선택을 보고 있다
      opts.onMeasuring(false);
      if (ok) opts.onLearned(visits, idx);
      return ok;
    },
  };
}
