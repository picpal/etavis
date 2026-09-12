/**
 * /enrich 요청 검증. server/src/schema.ts 와 같은 원칙 —
 * 바깥에서 온 값은 여기를 통과하지 못하면 바깥 API로 나가지 않는다.
 * 검증 없이 넘기면 남의 좌표로 우리 쿼터를 태울 수 있다.
 */

export type EnrichPlace = { id: string; name: string; address: string; lat: number; lng: number };

const MAX_PLACES = 30;
const MAX_NAME = 60;
const MAX_ADDRESS = 120;
const MAX_INPUT_ARRAY = 100; // 입력 배열 크기 상한. 초과하면 검증 없이 null로 거부 — 수천 개 유효하지 않은 항목 반복 방지

/** 한국 본토 + 제주 + 울릉/독도. src/lib/places.ts 의 KR_BBOX 와 같은 값 */
const KR = { minLat: 33.0, maxLat: 38.7, minLng: 124.5, maxLng: 132.0 };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 개별 장소 검증. null 반환 시 검색 API로 보내지 않는다.
 */
function parseOne(raw: unknown): EnrichPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || r.id.trim() === '') return null;
  if (!isStr(r.name) || r.name.trim() === '') return null;
  if (!isNum(r.lat) || !isNum(r.lng)) return null;
  if (r.lat < KR.minLat || r.lat > KR.maxLat || r.lng < KR.minLng || r.lng > KR.maxLng) return null;
  return {
    id: r.id.slice(0, 80),
    name: r.name.slice(0, MAX_NAME),
    address: isStr(r.address) ? r.address.slice(0, MAX_ADDRESS) : '',
    lat: r.lat,
    lng: r.lng,
  };
}

/**
 * /enrich 요청 전체 검증. 30개까지 유효한 장소를 반환하거나, 하나도 없으면 null.
 * places 배열이 MAX_INPUT_ARRAY를 초과하면 내용 검증 없이 null — 쿼터 보호.
 */
export function parseEnrichRequest(raw: unknown): EnrichPlace[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const places = (raw as Record<string, unknown>).places;
  if (!Array.isArray(places)) return null;
  if (places.length > MAX_INPUT_ARRAY) return null;
  const seen = new Set<string>();
  const out: EnrichPlace[] = [];
  for (const p of places) {
    const one = parseOne(p);
    if (!one || seen.has(one.id)) continue;
    seen.add(one.id);
    out.push(one);
    if (out.length >= MAX_PLACES) break;
  }
  return out.length > 0 ? out : null;
}
