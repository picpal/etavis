/**
 * Workers 프록시(/transit)를 부르는 대중교통 RouteProvider — 5단계.
 *
 * - 2점(직행)만 서버. 1위 itinerary 를 RouteResult 로 바꾼다. 폴리라인은 출발지·정류장·목적지 —
 *   직선이 아니라 실제 탄 경로라서 회랑 검색이 역 주변을 본다(6단계 앵커의 재료).
 * - 3점 이상(경유 조합)은 아직 추정 공급자(목)로 위임한다. 플래너가 이 차이를 provider_direct_only 로 드러낸다.
 * - 서버 실패는 throw 하지 않고 추정으로 폴백한다. 직행 실패로 계획 전체가 죽는 것보다
 *   "추정"이라고 정직하게 말하고 계획을 세우는 게 낫다. 폴백은 onFallback 으로 로그에 남긴다.
 */
import type { ServerProviderOptions } from './serverProvider';
import type { LatLng, Mode, RouteProvider, RouteResult, TransitItinerary } from './types';

export type TransitProviderOptions = ServerProviderOptions & {
  estimate: RouteProvider;
  onFallback?: (err: unknown) => void;
};

/** 하루 분 → ISO(UTC). 지금보다 2분 이상 뒤일 때만 — 서버 스키마가 과거 시각을 거절한다 */
export function departAtIso(departAtMin: number, now: Date): string | undefined {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (departAtMin - nowMin < 2) return undefined;
  const d = new Date(now);
  d.setHours(Math.floor(departAtMin / 60), departAtMin % 60, 0, 0);
  return d.toISOString();
}

type TransitResponse = { provider?: string; source?: string; itineraries?: TransitItinerary[] };

function isItinerary(x: unknown): x is TransitItinerary {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.durationMin === 'number' && typeof r.distanceM === 'number' && Array.isArray(r.legs);
}

/** 1위 itinerary → RouteResult. 폴리라인은 출발지·정류장(연속 중복 제거)·목적지 */
export function itineraryToRoute(it: TransitItinerary, origin: LatLng, destination: LatLng, all: TransitItinerary[]): RouteResult {
  const pts: LatLng[] = [origin];
  const push = (p: LatLng) => {
    const last = pts[pts.length - 1];
    if (last.latitude !== p.latitude || last.longitude !== p.longitude) pts.push(p);
  };
  for (const l of it.legs) {
    if (l.kind !== 'transit') continue;
    if (!Number.isFinite(l.from?.lat) || !Number.isFinite(l.from?.lng) || !Number.isFinite(l.to?.lat) || !Number.isFinite(l.to?.lng)) {
      throw new Error('transit leg 좌표 없음');
    }
    push({ latitude: l.from.lat, longitude: l.from.lng });
    push({ latitude: l.to.lat, longitude: l.to.lng });
  }
  push(destination);
  const distanceKm = it.distanceM / 1000;
  return { durationMin: it.durationMin, distanceKm, polyline: pts, sections: [{ durationMin: it.durationMin, distanceKm }], source: 'provider', transit: all };
}

export function transitRouteProvider(opts: TransitProviderOptions): RouteProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const now = opts.now ?? (() => new Date());
  return {
    async route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult> {
      if (mode !== 'transit') throw new Error(`transit route: ${mode} 미지원`);
      if (points.length !== 2) return opts.estimate.route(points, departAtMin, mode);
      const [origin, destination] = points;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await Promise.race([
          fetchFn(`${opts.baseUrl}/transit`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-app-token': opts.appToken, 'x-device-id': opts.deviceId },
            body: JSON.stringify({
              origin: { lat: origin.latitude, lng: origin.longitude },
              destination: { lat: destination.latitude, lng: destination.longitude },
              departAt: departAtIso(departAtMin, now()),
            }),
            signal: ctrl.signal,
          }),
          new Promise<never>((_, rej) => {
            ctrl.signal.addEventListener('abort', () => rej(new Error('transit timeout')));
          }),
        ]);
        if (!res.ok) throw new Error(`transit ${res.status}`);
        const data = (await res.json()) as TransitResponse;
        const list = Array.isArray(data.itineraries) ? data.itineraries.filter(isItinerary) : [];
        if (list.length === 0) throw new Error('transit: itineraries 없음');
        const route = itineraryToRoute(list[0], origin, destination, list);
        return data.source === 'estimate' ? { ...route, source: 'estimate' } : route;
      } catch (e) {
        opts.onFallback?.(e);
        return opts.estimate.route(points, departAtMin, mode);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
