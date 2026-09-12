/**
 * 앱 → 서버 /enrich. 실패는 던지지 않고 빈 결과다 —
 * 보강은 있으면 좋은 것이지 계획을 막을 이유가 아니다.
 */
import type { EnrichPlace, EnrichResponse, PlaceSignals } from './types';

export type EnrichFn = (places: EnrichPlace[]) => Promise<Record<string, PlaceSignals>>;

/**
 * 슬롯 하나당 이만큼만 기다린다 — 계획 전체 12초 예산의 일부일 뿐, 그 예산 자체가
 * 아니다. runPlan.ts가 업종 슬롯을 순차로 부르므로(월 예산 카운터의 예약이 실제
 * 지출을 반영하려면 같은 계획 안에서 /enrich 호출이 겹치면 안 된다 — 겹치면 여러
 * 요청이 같은 카운터 값을 동시에 읽고 각자 예약해 실효 상한이 슬롯 수만큼 불어난다)
 * 업종 슬롯이 3개면 이 타임아웃만으로 최대 7.5초가 나갈 수 있다. 이 타임아웃을
 * "최적화"한답시고 슬롯 호출을 다시 병렬 map으로 되돌리지 말 것 — 그러면 예산
 * 카운터가 다시 겹쳐 슬롯 수만큼 새는 결함(최종 브랜치 리뷰 Critical 1)이 되살아난다.
 */
const DEFAULT_TIMEOUT_MS = 2_500;

export function serverEnrichFn(opts: {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  timeoutMs?: number;
  /** 테스트용 주입. 기본 globalThis.fetch — serverProvider.ts와 같은 자리 */
  fetchFn?: typeof fetch;
}): EnrichFn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = opts.fetchFn ?? fetch;
  return async places => {
    if (places.length === 0) return {};
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
        body: JSON.stringify({ places }),
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
