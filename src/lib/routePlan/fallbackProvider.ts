/**
 * RouteProvider 하나를 감싸 실패 시 추정 공급자로 강등한다.
 *
 * 왜 필요한가: `/route` 가 던지면 `runPlan` 이 계획 전체를 FAIL(direct) 로 끝낸다.
 * 공개 데모에서는 일일 상한·502·타임아웃 중 하나만 걸려도 심사자가 오류 화면을 본다.
 * 상한은 피해를 묶는 장치여야지 가용성 차단 스위치여선 안 된다.
 *
 * 429 만 잡지 않는다 — 4주 동안 더 자주 오는 건 502 와 타임아웃이다.
 * 강등 사유는 onFallback 으로만 나간다. 이 모듈은 순수해야 한다(node 테스트가 닿는다)
 * — trackLog 는 expo-file-system 을 물기 때문에 여기서 부르면 안 된다.
 *
 * transitProvider 의 estimate/onFallback 과 같은 계약이다.
 */
import type { LatLng, Mode, RouteProvider, RouteResult } from './types';

export type FallbackProviderOptions = {
  primary: RouteProvider;
  /** 강등 대상. source 를 'estimate' 로 내는 공급자여야 한다 */
  estimate: RouteProvider;
  onFallback?: (err: unknown) => void;
};

export function fallbackRouteProvider(opts: FallbackProviderOptions): RouteProvider {
  return {
    async route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult> {
      try {
        return await opts.primary.route(points, departAtMin, mode);
      } catch (e) {
        opts.onFallback?.(e);
        return opts.estimate.route(points, departAtMin, mode);
      }
    },
  };
}
