/**
 * 구글 Places (New) Text Search.
 *
 * rating·userRatingCount·regularOpeningHours 는 Enterprise SKU 라 월 1,000회만
 * 무료고 넘으면 자동 과금이다. 그래서 호출부(enrich.ts)가 상위 10곳만 부르고
 * 월 카운터로 막는다. 여기서는 호출 한 번과 파싱만 한다.
 */
import { matchPlace } from '../../src/lib/placeMatch';
import type { GoogleSignal } from './enrichTypes';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK =
  'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.regularOpeningHours';
/** 이 반경 안에서만 찾는다. 동명 매장이 다른 동네에서 잡히는 걸 줄인다 */
const BIAS_RADIUS_M = 300;

type RawPeriodPoint = { day?: unknown; hour?: unknown; minute?: unknown };
type RawPeriod = { open?: RawPeriodPoint; close?: RawPeriodPoint };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 오늘 요일(0=일)의 영업시간을 분으로. 없으면 null, close 가 없으면 24시간 */
function hoursOf(raw: unknown, todayDow: number): GoogleSignal['hours'] {
  if (!raw || typeof raw !== 'object') return null;
  const periods = (raw as Record<string, unknown>).periods;
  if (!Array.isArray(periods)) return null;
  for (const p of periods as RawPeriod[]) {
    const openDay = num(p?.open?.day);
    if (openDay !== todayDow) continue;
    const oh = num(p.open?.hour) ?? 0;
    const om = num(p.open?.minute) ?? 0;
    const openMin = oh * 60 + om;
    if (!p.close) return { openMin: 0, closeMin: 1440 };
    const ch = num(p.close.hour) ?? 0;
    const cm = num(p.close.minute) ?? 0;
    return { openMin, closeMin: ch * 60 + cm };
  }
  return null;
}

export function parseGooglePlaces(
  raw: unknown,
  target: { name: string; lat: number; lng: number },
  todayDow: number,
): GoogleSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const places = (raw as Record<string, unknown>).places;
  if (!Array.isArray(places) || places.length === 0) return null;

  const cands = places.map(p => {
    const r = p as Record<string, unknown>;
    const loc = (r.location ?? {}) as Record<string, unknown>;
    const dn = (r.displayName ?? {}) as Record<string, unknown>;
    return {
      name: typeof dn.text === 'string' ? dn.text : '',
      lat: num(loc.latitude) ?? 0,
      lng: num(loc.longitude) ?? 0,
    };
  });

  const idx = matchPlace(target, cands);
  if (idx == null) return null;

  const hit = places[idx] as Record<string, unknown>;
  const rating = num(hit.rating);
  const ratingCount = num(hit.userRatingCount);
  if (rating == null || ratingCount == null) return null;

  return {
    rating,
    ratingCount,
    hours: hoursOf(hit.regularOpeningHours, todayDow),
    matchedName: cands[idx].name,
  };
}

export async function fetchGooglePlace(
  target: { name: string; lat: number; lng: number },
  apiKey: string,
  f: typeof fetch,
  todayDow: number,
): Promise<GoogleSignal | null> {
  try {
    const res = await f(ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        textQuery: target.name,
        languageCode: 'ko',
        maxResultCount: 3,
        locationBias: {
          circle: { center: { latitude: target.lat, longitude: target.lng }, radius: BIAS_RADIUS_M },
        },
      }),
    });
    if (!res.ok) return null;
    return parseGooglePlaces(await res.json(), target, todayDow);
  } catch {
    return null;
  }
}
