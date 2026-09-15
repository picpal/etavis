/**
 * Google Routes API (TRANSIT) — 요청 조립과 응답 정규화. 순수 함수라 node 테스트가 돈다.
 *
 *   POST https://routes.googleapis.com/directions/v2:computeRoutes
 *   헤더 X-Goog-Api-Key, X-Goog-FieldMask. Essentials 월 10,000회 무료(2026-09 요금표).
 *
 * 스파이크(docs/transit-spike.md)에서 확인한 것: 정류장 좌표·도보 시간·배차 반영 모두 온다.
 * 같은 정류장 열의 경로가 열차만 다르게 여러 개 오므로 정류장 열로 중복을 지운다.
 */
import type { TransitAdapter, TransitEnv, TransitItinerary, TransitLeg, TransitMode, TransitNormalizeResult, TransitRequest, TransitStop } from './transitTypes';

export const GOOGLE_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const GOOGLE_FIELD_MASK = [
  'routes.duration', 'routes.distanceMeters',
  'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration', 'routes.legs.steps.distanceMeters',
  'routes.legs.steps.transitDetails',
].join(',');

export function googleTransitBody(req: TransitRequest): object {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: req.origin.lat, longitude: req.origin.lng } } },
    destination: { location: { latLng: { latitude: req.destination.lat, longitude: req.destination.lng } } },
    travelMode: 'TRANSIT',
    computeAlternativeRoutes: true,
    languageCode: 'ko',
  };
  if (req.departAt) body.departureTime = req.departAt;
  if (req.subwayOnly) body.transitPreferences = { allowedTravelModes: ['SUBWAY', 'TRAIN'] };
  return body;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** "384s" → 384. 모양이 다르면 null */
function seconds(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?s$/.test(v)) return null;
  return Number(v.slice(0, -1));
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function modeOf(type: unknown): TransitMode {
  if (type === 'SUBWAY') return 'SUBWAY';
  if (type === 'BUS' || type === 'INTERCITY_BUS' || type === 'TROLLEYBUS') return 'BUS';
  if (type === 'HEAVY_RAIL' || type === 'COMMUTER_TRAIN' || type === 'HIGH_SPEED_TRAIN' || type === 'RAIL' || type === 'LONG_DISTANCE_TRAIN' || type === 'METRO_RAIL' || type === 'MONORAIL' || type === 'TRAM') return 'TRAIN';
  return 'OTHER';
}

function stopOf(raw: unknown): TransitStop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ll = ((r.location as Record<string, unknown> | undefined)?.latLng ?? null) as Record<string, unknown> | null;
  const lat = num(ll?.latitude);
  const lng = num(ll?.longitude);
  if (lat == null || lng == null) return null;
  return { name: str(r.name) ?? '', lat, lng };
}

/**
 * step 배열 → leg 배열. 하나라도 모양이 다르면 null.
 * 연속된 WALK step 은 하나의 walk leg 로 합친다 — 초 단위로 누적하고(walkSec·walkDist)
 * transit 을 만나거나 배열이 끝날 때 한 번만 반올림한다. step 마다 round1 을 누적하면
 * 오차가 쌓인다(예: 316+46+0+0+20=382s 를 5.3→6.0→6.0→6.0→6.4 로 나눠 반올림해도 이 케이스는
 * 우연히 같지만, 다른 분할에서는 0.1분 어긋난다).
 */
function legsOf(steps: unknown): TransitLeg[] | null {
  if (!Array.isArray(steps)) return null;
  const legs: TransitLeg[] = [];
  let walkSec = 0;
  let walkDist = 0;
  let walkOpen = false;
  const closeWalk = () => {
    if (!walkOpen) return;
    legs.push({ kind: 'walk', durationMin: round1(walkSec / 60), distanceM: walkDist });
    walkSec = 0;
    walkDist = 0;
    walkOpen = false;
  };
  for (const s of steps as Record<string, unknown>[]) {
    const sec = seconds(s.staticDuration);
    if (sec == null) return null;
    if (s.travelMode === 'TRANSIT') {
      closeWalk();
      const td = (s.transitDetails ?? null) as Record<string, unknown> | null;
      const sd = (td?.stopDetails ?? null) as Record<string, unknown> | null;
      const line = (td?.transitLine ?? null) as Record<string, unknown> | null;
      const from = stopOf(sd?.departureStop);
      const to = stopOf(sd?.arrivalStop);
      if (!td || !sd || !from || !to) return null;
      const vehicle = (line?.vehicle ?? null) as Record<string, unknown> | null;
      legs.push({
        kind: 'transit', mode: modeOf(vehicle?.type),
        line: str(line?.nameShort) ?? str(line?.name) ?? '',
        from, to, durationMin: round1(sec / 60), stops: num(td.stopCount),
        departAt: str(sd.departureTime), arriveAt: str(sd.arrivalTime),
      });
    } else {
      walkSec += sec;
      walkDist += num(s.distanceMeters) ?? 0;
      walkOpen = true;
    }
  }
  closeWalk();
  return legs;
}

/** 정류장 열 — 같은 열이면 다른 열차일 뿐이다 */
const sequenceKey = (it: TransitItinerary) =>
  it.legs.filter(l => l.kind === 'transit').map(l => (l.kind === 'transit' ? `${l.line}|${l.from.name}|${l.to.name}` : '')).join('>');

export function normalizeGoogleTransit(raw: unknown, req: TransitRequest): TransitNormalizeResult {
  const routes = (raw as { routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes)) return { ok: false, code: 'shape', msg: 'routes 배열 아님' };
  if (routes.length === 0) return { ok: false, code: 'none', msg: 'routes 없음' };
  const out: { sec: number; it: TransitItinerary }[] = [];
  for (const r of routes as Record<string, unknown>[]) {
    const sec = seconds(r.duration);
    // /transit 은 2점 요청만 받으므로 leg 는 항상 하나. 경유지를 받게 되면 여기서 조용히 잘린다
    const legsRaw = (r.legs as Record<string, unknown>[] | undefined)?.[0]?.steps;
    const legs = legsOf(legsRaw);
    if (sec == null || !legs) return { ok: false, code: 'shape', msg: 'route 모양' };
    out.push({ sec, it: { durationMin: round1(sec / 60), distanceM: num(r.distanceMeters) ?? 0, legs } });
  }
  // 반올림 뒤 정렬하면 6초 차이가 동률이 돼 dedup 이 빠른 쪽을 못 고른다
  out.sort((a, b) => a.sec - b.sec);
  const seen = new Set<string>();
  const dedup = out.filter(({ it }) => { const k = sequenceKey(it); if (seen.has(k)) return false; seen.add(k); return true; }).map(({ it }) => it);
  return { ok: true, itineraries: dedup.slice(0, req.alternatives) };
}

export const googleAdapter: TransitAdapter = {
  id: 'google',
  hasKey: (env: TransitEnv) => Boolean(env.GOOGLE_ROUTES_KEY ?? env.GOOGLE_PLACES_KEY),
  fetchRaw(req, env: TransitEnv, f) {
    const key = env.GOOGLE_ROUTES_KEY ?? env.GOOGLE_PLACES_KEY ?? '';
    return f(GOOGLE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
      body: JSON.stringify(googleTransitBody(req)),
    });
  },
  normalize: normalizeGoogleTransit,
};
