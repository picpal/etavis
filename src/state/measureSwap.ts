/**
 * 교체 시트에서 고른 매장의 **두 구간만** 다시 재는 일(설계 6단계). 플래너의
 * `PlanResult.measureSwap` 을 언제 부르고, 응답이 왔을 때 그걸 화면에 반영해도 되는지를 정한다.
 *
 * React 를 안 문다. 실제로 틀리는 자리는 렌더가 아니라 "불러도 되나 · 늦게 온 응답을 버리나"
 * 두 판단이고, 그 둘을 화면 안에 두면 A5 와 A6 가 각자 다르게 틀린다 —
 * 한 곳만 고쳐 다른 화면이 거짓말하는 것이 이 코드베이스의 단골 결함이다.
 */
import type { PlanResult, TimingSource, Visit } from '../lib/routePlan/types';

/**
 * 이 계획에서 고른 매장을 재면 '약'이 실제로 지워지나.
 *
 * **`provider_direct_only` 에서는 부르지 않는다.** 그 계획은 직행만 실측이고 경유 구간 시드가
 * 전부 추정이라, `rescoreFrom` 의 관문(`hit && b.legCls[k] === 'measured'`)이 기준 안 쪽에서
 * 막힌다 — 두 번을 쓰고도 후보 카드의 등급은 'estimated' 그대로다. 플래너는 일부러 안 막았다:
 * "잴 수 있나"는 플래너의 질문이고 "재서 무엇이 달라지나"는 화면의 질문이라 여기서 가른다.
 * `estimate`(목·폴백)도 같은 이유로 제외한다.
 *
 * 두 번째 조건은 **바뀌는 두 구간 말고 남은 구간이 이미 전부 실측인가**다. V≥3 처럼 시드 예산이
 * 모자라 다른 구간이 추정으로 남은 안은, 이 둘을 재도 배너의 '약'이 그대로라 돈만 나간다.
 * `rescore` 는 공짜다(저장소 조회뿐).
 */
export function shouldMeasureSwap(
  result: Pick<PlanResult, 'rescore' | 'timingSource'>,
  visits: Visit[],
  idx: number,
): boolean {
  if (!visits[idx]) return false;
  if (!measurableSource(result.timingSource)) return false;
  const { legCls } = result.rescore(visits);
  return legCls.every((c, k) => c === 'measured' || k === idx || k === idx + 1);
}

const measurableSource = (s: TimingSource | undefined): boolean => s === 'provider' || s === 'provider_legs';

export type SwapMeasurer = {
  /**
   * 고르기 하나를 잰다. `visits` 는 **교체가 반영된 뒤의** 방문 배열이고 `idx` 는 그 자리다.
   * 돌려주는 값은 "이번 응답을 화면에 반영했나"다 — 자격이 없거나, 예산·공급자가 못 재 줬거나,
   * 그 사이에 사용자가 또 골라 늦은 응답이 된 경우 전부 false 다.
   */
  measure: (result: PlanResult, visits: Visit[], idx: number) => Promise<boolean>;
};

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
}): SwapMeasurer {
  let seq = 0;
  return {
    measure: async (result, visits, idx) => {
      if (!shouldMeasureSwap(result, visits, idx)) return false;
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
