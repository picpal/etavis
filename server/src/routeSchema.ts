/**
 * /route 요청 검증. 앱이 보내는 값도 믿지 않는다 — 좌표 범위·개수·모드를 여기서 자른다.
 * 카카오 자동차 길찾기: 경유지 ≤ 5 → points는 2~7개.
 */
export type RoutePoint = { lat: number; lng: number };
export type RouteRequest = {
  points: RoutePoint[];
  mode: 'car';
  /** YYYYMMDDHHMM (KST). 있으면 미래운행정보 길찾기 */
  departAt?: string;
  polyline: boolean;
};

const MAX_POINTS = 7;

function parsePoint(raw: unknown): RoutePoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function parseRouteRequest(raw: unknown): RouteRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.points) || r.points.length < 2 || r.points.length > MAX_POINTS) return null;
  const points: RoutePoint[] = [];
  for (const p of r.points) {
    const pt = parsePoint(p);
    if (!pt) return null;
    points.push(pt);
  }
  if (r.mode !== undefined && r.mode !== 'car') return null;
  let departAt: string | undefined;
  if (r.departAt !== undefined) {
    if (typeof r.departAt !== 'string' || !/^\d{12}$/.test(r.departAt)) return null;
    departAt = r.departAt;
  }
  return { points, mode: 'car', departAt, polyline: r.polyline === true };
}
