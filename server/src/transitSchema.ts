/**
 * /transit 요청 검증. 앱이 보내는 값도 믿지 않는다 — 좌표 범위·시각 창·개수를 여기서 자른다.
 */
import type { LatLng, TransitRequest } from './transitTypes';

const PAST_GRACE_MS = 5 * 60 * 1000;
const FUTURE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function parsePoint(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = r.lat;
  const lng = r.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function parseTransitRequest(raw: unknown, now: Date): TransitRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const origin = parsePoint(r.origin);
  const destination = parsePoint(r.destination);
  if (!origin || !destination) return null;
  if (origin.lat === destination.lat && origin.lng === destination.lng) return null;

  let departAt: string | undefined;
  if (r.departAt !== undefined) {
    if (typeof r.departAt !== 'string') return null;
    const t = Date.parse(r.departAt);
    if (!Number.isFinite(t)) return null;
    if (t < now.getTime() - PAST_GRACE_MS || t > now.getTime() + FUTURE_MAX_MS) return null;
    departAt = new Date(t).toISOString();
  }

  let alternatives = 3;
  if (r.alternatives !== undefined) {
    if (typeof r.alternatives !== 'number' || !Number.isInteger(r.alternatives) || r.alternatives < 1 || r.alternatives > 3) return null;
    alternatives = r.alternatives;
  }

  let subwayOnly = false;
  if (r.subwayOnly !== undefined) {
    if (typeof r.subwayOnly !== 'boolean') return null;
    subwayOnly = r.subwayOnly;
  }
  return { origin, destination, departAt, alternatives, subwayOnly };
}
