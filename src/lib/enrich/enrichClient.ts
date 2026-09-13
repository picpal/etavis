/**
 * 앱 → 서버 /enrich. 실패는 던지지 않고 빈 결과다 —
 * 보강은 있으면 좋은 것이지 계획을 막을 이유가 아니다.
 */
import type { EnrichPlace, EnrichResponse, PlaceSignals } from './types';

/**
 * 호출자가 이번 한 번에 허용하는 시간. runPlan 이 파이프라인 잔여 예산에서
 * 계산해 슬롯 수로 나눠 준다 — 고정값이면 슬롯이 늘 때 파이프라인 예산을 넘긴다.
 */
export type EnrichOpts = { timeoutMs?: number };

export type EnrichFn = (
  places: EnrichPlace[],
  opts?: EnrichOpts,
) => Promise<Record<string, PlaceSignals>>;

/**
 * 호출자가 시간을 안 주면 쓰는 값. 정상 경로에서는 runPlan 이 언제나 준다 —
 * 이 값은 목·테스트용 안전망이다.
 *
 * runPlan.ts 가 업종 슬롯을 순차로 부른다(월 예산 카운터의 예약이 실제 지출을
 * 반영하려면 같은 계획 안에서 /enrich 호출이 겹치면 안 된다 — 겹치면 여러 요청이
 * 같은 카운터 값을 동시에 읽고 각자 예약해 실효 상한이 슬롯 수만큼 불어난다).
 * 이 타임아웃을 "최적화"한답시고 슬롯 호출을 다시 병렬 map으로 되돌리지 말 것 —
 * 그러면 예산 카운터가 다시 겹쳐 슬롯 수만큼 새는 결함(최종 브랜치 리뷰 Critical 1)이
 * 되살아난다.
 */
const DEFAULT_TIMEOUT_MS = 4_000;
/**
 * 서버 마감을 클라이언트 abort 보다 이만큼 앞당긴다. 서버가 먼저 정리하고 부분
 * 결과를 돌려줘야 한다 — abort 가 먼저 터지면 다 끝난 신호까지 통째로 버린다.
 */
const SERVER_MARGIN_MS = 300;

export function serverEnrichFn(opts: {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  timeoutMs?: number;
  /** 테스트용 주입. 기본 globalThis.fetch — serverProvider.ts와 같은 자리 */
  fetchFn?: typeof fetch;
}): EnrichFn {
  const fetchFn = opts.fetchFn ?? fetch;
  return async (places, callOpts) => {
    if (places.length === 0) return {};
    const timeoutMs = callOpts?.timeoutMs ?? opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const budgetMs = Math.max(1, timeoutMs - SERVER_MARGIN_MS);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${opts.baseUrl.replace(/\/$/, '')}/enrich`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-token': opts.appToken,
          'x-device-id': opts.deviceId,
        },
        body: JSON.stringify({ places, budgetMs }),
        signal: ctrl.signal,
      });
      if (!res.ok) return {};
      const body = (await res.json()) as Partial<EnrichResponse>;
      // 콘솔 일일 할당량을 아직 못 걸어서(설계 §9) /enrich의 월 900회 카운터가 유일한
      // 방어선인데, budget을 화면 어디에도 보여주지 않으면 소진 여부를 관찰할 방법이
      // 없다. 개발 메뉴 화면은 없으니 __DEV__ 콘솔 로그 한 줄로 대신한다.
      // typeof 가드는 이 파일을 순수하게 유지한다(Node 테스트 환경엔 __DEV__가 없다).
      if (typeof __DEV__ !== 'undefined' && __DEV__ && body.budget) {
        console.log(`[enrich] googleUsed=${body.budget.googleUsed} googleLeft=${body.budget.googleLeft}`);
      }
      return body.results && typeof body.results === 'object' ? body.results : {};
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  };
}
