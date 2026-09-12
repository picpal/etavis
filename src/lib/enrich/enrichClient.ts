/**
 * 앱 → 서버 /enrich. 실패는 던지지 않고 빈 결과다 —
 * 보강은 있으면 좋은 것이지 계획을 막을 이유가 아니다.
 */
import type { EnrichPlace, EnrichResponse, PlaceSignals } from './types';

export type EnrichFn = (places: EnrichPlace[]) => Promise<Record<string, PlaceSignals>>;

/** 계획 전체 12초 안에서 이만큼만 기다린다 */
const DEFAULT_TIMEOUT_MS = 2_500;

export function serverEnrichFn(opts: {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  timeoutMs?: number;
}): EnrichFn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async places => {
    if (places.length === 0) return {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/enrich`, {
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
      return body.results && typeof body.results === 'object' ? body.results : {};
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  };
}
