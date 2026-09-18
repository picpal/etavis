/**
 * /places 요청 검증. 앱이 보내는 값도 믿지 않는다 — 인젝션 방어선은 프롬프트가 아니라 스키마다.
 *
 * 이 프록시는 카카오 로컬 전용이라 좌표를 한국 bbox 로 가둔다.
 * 검색어 정규화(planSearch)와 업종 필터(keepPlace)는 클라이언트에 남는다 —
 * src/lib/placeQuery.ts 의 순수 함수이고 이미 테스트가 있다.
 */
export type PlacesRequest = {
  kind: 'keyword' | 'address';
  query: string;
  x?: number;
  y?: number;
  radius?: number;
  size: number;
  categoryCode?: string;
  sortByDistance: boolean;
};

/** src/lib/places.ts 의 KR_BBOX 와 같은 범위 */
const KR_BBOX = { minLat: 33.0, maxLat: 38.7, minLng: 124.5, maxLng: 132.0 };
const MAX_QUERY = 40;
const MAX_SIZE = 15;
/** 카카오 로컬 radius 상한 */
const MAX_RADIUS = 20000;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parsePlacesRequest(raw: unknown): PlacesRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.kind !== 'keyword' && r.kind !== 'address') return null;

  if (typeof r.query !== 'string') return null;
  const query = r.query.trim();
  if (!query || query.length > MAX_QUERY) return null;

  let x: number | undefined;
  let y: number | undefined;
  if (r.x !== undefined || r.y !== undefined) {
    const nx = Number(r.x);
    const ny = Number(r.y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    if (ny < KR_BBOX.minLat || ny > KR_BBOX.maxLat || nx < KR_BBOX.minLng || nx > KR_BBOX.maxLng) return null;
    x = nx;
    y = ny;
  }

  let radius: number | undefined;
  if (r.radius !== undefined) {
    const n = Number(r.radius);
    if (!Number.isFinite(n) || n <= 0) return null;
    radius = Math.round(clamp(n, 1, MAX_RADIUS));
  }

  const size = r.size === undefined ? MAX_SIZE : Math.round(clamp(Number(r.size) || 1, 1, MAX_SIZE));

  let categoryCode: string | undefined;
  if (r.categoryCode !== undefined) {
    if (typeof r.categoryCode !== 'string' || !/^[A-Z]{2}\d$/.test(r.categoryCode)) return null;
    categoryCode = r.categoryCode;
  }

  /* 정렬 기준은 클라이언트가 말한다. 좌표 유무로 정하던 때는 이름 검색과 회랑 검색이
     같은 규칙을 썼고, 좌표를 주는 순간 거리순이 강제돼 정확히 일치하는 목적지가
     '가까운 15건' 밖으로 밀려났다(src/lib/placesParams.ts).
     필드가 없으면 예전대로 좌표 유무로 정한다 — 이미 배포된 앱이 그렇게 보낸다 */
  const sortByDistance = typeof r.sortByDistance === 'boolean' ? r.sortByDistance : x !== undefined;

  return { kind: r.kind, query, x, y, radius, size, categoryCode, sortByDistance };
}
