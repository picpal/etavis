/**
 * Workers 프록시(/transit)를 부르는 대중교통 RouteProvider — 5단계 직행, 7단계 구간 실측.
 *
 * - Google Routes TRANSIT 은 경유지를 못 받는다(카카오모빌리티 자동차는 5개까지 받는다).
 *   그래서 N점 경로는 **구간마다 2점씩 쪼개 병렬로** 부르고 `sections` 를 구간별로 채운다.
 *   추정으로 3점 경로를 비교하던 시절엔 순위가 뒤집혔다 — 2026-09-16 실측에서 추정 1위가
 *   실측 2위였고 격차는 0.2분 → 5.7분이었다(`docs/transit-추정-오차.md`).
 * - `source` 는 강등만 받는다. **구간 하나라도 실측이 아니면 전체가 `'estimate'`**.
 *   하나라도 추정인 합계를 실측이라 부르면 화면이 거짓말을 한다.
 * - 서버 실패는 throw 하지 않는다. 그 구간만 추정으로 채우고(살아남은 구간의 실측은 버리지 않는다)
 *   전체를 추정으로 강등한다. 폴백 사유는 onFallback 으로 로그에만 남는다.
 * - 호출 예산은 `transitBudget.ts` 한 곳에 있다. 상한(`maxLegs`)까지만 실측하고 남는 구간은
 *   추정으로 채운다 — **잰 구간을 버리지 않는다.** 그 결과의 `source` 는 위 규칙대로 `'estimate'` 고,
 *   쓸 수 있는 실측은 그대로 `sections` 에 남는다.
 *
 * 알려진 한계: 구간을 병렬로 부르므로 **모든 구간이 계획의 출발 시각으로 조회된다.**
 * 두 번째 구간의 실제 출발은 (1구간 소요 + 체류) 뒤라 시간표·배차가 다를 수 있다.
 * 순차 호출로 시각을 밀면 벽시계가 구간 수만큼 늘고(구간당 1.7~2.5초) 체류시간은
 * 공급자가 알지도 못한다. 확정 1안만 실제 출발 시각으로 다시 재는 건 9단계다.
 */
import type { ServerProviderOptions } from './serverProvider';
import { TRANSIT_MAX_LEGS_PER_ROUTE } from './transitBudget';
import type { LatLng, Mode, RouteProvider, RouteResult, TransitItinerary } from './types';

export type TransitProviderOptions = ServerProviderOptions & {
  estimate: RouteProvider;
  onFallback?: (err: unknown) => void;
  /** route() 한 번이 **실측할** 구간 수 상한. 남는 구간은 추정으로 채운다. 기본 TRANSIT_MAX_LEGS_PER_ROUTE */
  maxLegs?: number;
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

/**
 * 구간별 RouteResult 를 경로 하나로 잇는다.
 *
 * - `sections[i]` 는 i번째 구간 전체다 — 구간 응답의 durationMin·distanceKm 을 그대로 쓴다.
 * - 폴리라인은 이어 붙이고 이음매의 중복점을 지운다(`itineraryToRoute` 와 같은 방식).
 * - `transit`(대안 itinerary)은 담지 않는다. 그 필드의 뜻은 "이 OD 전체의 대안 경로들"인데,
 *   구간이 여럿이면 그런 건 없다 — 구간별 2위끼리 이어 붙인 여정은 공급자가 준 적 없는
 *   지어낸 경로다. 구간별 대안을 합치는 건 8단계(대안 itinerary 병합)의 일이고 모양도 다르다.
 */
export function joinLegRoutes(parts: RouteResult[]): RouteResult {
  const polyline: LatLng[] = [];
  for (const part of parts) {
    for (const p of part.polyline) {
      const last = polyline[polyline.length - 1];
      if (!last || last.latitude !== p.latitude || last.longitude !== p.longitude) polyline.push(p);
    }
  }
  const sections = parts.map(p => ({ durationMin: p.durationMin, distanceKm: p.distanceKm }));
  return {
    durationMin: sections.reduce((s, x) => s + x.durationMin, 0),
    distanceKm: sections.reduce((s, x) => s + x.distanceKm, 0),
    polyline,
    sections,
    // 전부 provider 여야 provider. 강등은 받아들이고 승격은 못 한다
    source: parts.every(p => p.source === 'provider') ? 'provider' : 'estimate',
  };
}

export function transitRouteProvider(opts: TransitProviderOptions): RouteProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const now = opts.now ?? (() => new Date());
  const maxLegs = opts.maxLegs ?? TRANSIT_MAX_LEGS_PER_ROUTE;
  /** 진행 중인 구간 조회. 시드 여러 안이 같은 구간을 동시에 물으면 요청은 한 번만 나간다 */
  const inflight = new Map<string, Promise<RouteResult>>();

  /** 구간 하나를 서버에 묻는다. 실패하면 throw — 폴백은 부르는 쪽이 정한다 */
  const fetchLeg = async (origin: LatLng, destination: LatLng, departAtMin: number): Promise<RouteResult> => {
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
    } finally {
      clearTimeout(timer);
    }
  };

  /** 실패하면 그 구간만 추정으로 채운다. 같은 구간의 동시 요청은 하나로 합친다 */
  const measureLeg = (origin: LatLng, destination: LatLng, departAtMin: number, mode: Mode): Promise<RouteResult> => {
    const key = `${origin.latitude},${origin.longitude}>${destination.latitude},${destination.longitude}@${departAtMin}`;
    const shared = inflight.get(key);
    if (shared) return shared;
    const p = fetchLeg(origin, destination, departAtMin).catch(e => {
      opts.onFallback?.(e);
      return opts.estimate.route([origin, destination], departAtMin, mode);
    });
    inflight.set(key, p);
    // 응답이 오면 바로 지운다 — 다음 계획은 그때의 시간표를 다시 물어야 한다
    void p.then(() => inflight.delete(key));
    return p;
  };

  return {
    async route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult> {
      if (mode !== 'transit') throw new Error(`transit route: ${mode} 미지원`);
      const legCount = points.length - 1;
      if (legCount < 1) return opts.estimate.route(points, departAtMin, mode);
      if (legCount > maxLegs) {
        // 예산이 닿는 데까지만 실측하고 나머지는 추정으로 둔다. 전체를 추정으로 떨어뜨리면
        // 이미 살 수 있었던 실측까지 버리는 것이다 — 채점은 구간마다 따로 본다(score.ts)
        opts.onFallback?.(new Error(`transit: 구간 ${legCount}개 > 예산 ${maxLegs}개 — 앞 ${maxLegs}개만 실측`));
      }
      const parts = await Promise.all(points.slice(1).map((to, i) =>
        i < maxLegs
          ? measureLeg(points[i], to, departAtMin, mode)
          : opts.estimate.route([points[i], to], departAtMin, mode)));
      // 직행(2점)은 5단계 그대로 — transit(대안 itinerary)과 정류장 폴리라인을 그대로 들고 나간다
      return legCount === 1 ? parts[0] : joinLegRoutes(parts);
    },
  };
}
