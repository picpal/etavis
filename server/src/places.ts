/**
 * 카카오 로컬 장소 검색 프록시 — 키를 가리고 바깥 응답을 중계한다.
 *
 * 왜 필요한가: src/lib/places.ts 가 dapi.kakao.com 을 클라이언트에서 직접 불렀다.
 * guard 를 안 거치고, 카카오 REST 키는 도메인 제한이 안 걸린다 — 공개 웹 번들에
 * 박히면 누구나 무제한으로 쓴다. 키 회전은 해결책이 아니다(새 키도 똑같이 박힌다).
 *
 * 얇게 간다. 검색어 정규화(planSearch)·업종 필터(keepPlace)는 클라이언트에 남는다 —
 * 순수 함수이고 테스트가 이미 있다. 여기서는 키·상한·캐시만 맡는다.
 *
 * KAKAO_LOCAL_KEY 는 developers.kakao.com 키다. KAKAO_MOBILITY_KEY(길찾기)와 다르다.
 */
import type { PlacesRequest } from './placesSchema';

export const KAKAO_LOCAL_BASE = 'https://dapi.kakao.com';

/** 장소 검색은 길찾기보다 훨씬 덜 변한다. 하루면 충분하다 */
export const PLACES_TTL_S = 24 * 60 * 60;

export function kakaoLocalUrl(req: PlacesRequest, base = KAKAO_LOCAL_BASE): string {
  const params = new URLSearchParams({ query: req.query, size: String(req.size) });
  if (req.categoryCode) params.set('category_group_code', req.categoryCode);
  if (req.x !== undefined && req.y !== undefined) {
    params.set('x', String(req.x));
    params.set('y', String(req.y));
    if (req.sortByDistance) params.set('sort', 'distance');
    if (req.radius !== undefined) params.set('radius', String(req.radius));
  }
  return `${base}/v2/local/search/${req.kind}.json?${params}`;
}

/** 좌표는 4자리(약 11m)로 깎는다. routeCacheKey 와 같은 규칙 */
export function placesCacheKey(req: PlacesRequest): string {
  const g = (n: number | undefined) => (n === undefined ? '-' : n.toFixed(4));
  return `places:${req.kind}:${req.query}:${g(req.x)},${g(req.y)}:${req.radius ?? '-'}:${req.size}:${req.categoryCode ?? '-'}`;
}

export type PlacesEnv = {
  KAKAO_LOCAL_KEY: string;
  CACHE: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl: number }): Promise<void> };
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * 캐시 적중이면 그 응답, 아니면 null.
 *
 * 밖으로 뺀 이유: index.ts 가 **일일 상한보다 먼저** 이걸 부른다. 적중은 카카오에
 * 한 푼도 안 나가는데 예산을 먹으면 안 되기 때문이다. 그러고 나서 handlePlaces 에
 * `cacheChecked` 로 알려 주면 같은 키를 두 번 읽지 않는다.
 */
export async function cachedPlaces(req: PlacesRequest, env: PlacesEnv): Promise<Response | null> {
  const hit = await env.CACHE.get(placesCacheKey(req));
  return hit ? new Response(hit, { headers: JSON_HEADERS }) : null;
}

export async function handlePlaces(
  req: PlacesRequest,
  env: PlacesEnv,
  deps: { fetch: typeof fetch; cacheChecked?: boolean },
): Promise<Response> {
  // 키 없음과 상류 장애를 섞지 않는다 — 섞으면 배포 사고를 장애로 오진한다
  if (!env.KAKAO_LOCAL_KEY) return json({ error: 'places unavailable' }, 501);

  const key = placesCacheKey(req);
  if (!deps.cacheChecked) {
    const hit = await cachedPlaces(req, env);
    if (hit) return hit;
  }

  /* deps.fetch(...) 로 바로 부르면 안 된다. 그러면 this 가 deps 객체가 되고,
     Workers 의 fetch 는 전역 this 를 요구해 "Illegal invocation" 으로 던진다.
     목 fetch 는 this 를 안 보므로 단위 테스트가 이걸 못 잡는다 — 실제로 키가
     들어와 이 줄에 처음 닿은 날 500 으로 터졌다(그전엔 위 501 에서 먼저 반환됐다).
     참조를 떼어 호출하면 this 가 undefined 가 되고, 그건 Workers 가 받아준다.
     enrich.ts·transit.ts 는 deps.fetch 를 위치 인자로 내려보내서 원래 안전하다. */
  const doFetch = deps.fetch;
  const res = await doFetch(kakaoLocalUrl(req), {
    headers: { Authorization: `KakaoAK ${env.KAKAO_LOCAL_KEY}` },
  });
  if (!res.ok) return json({ error: 'upstream', status: res.status }, 502);

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return json({ error: 'unparseable' }, 502);
  }
  const documents = (raw as { documents?: unknown[] })?.documents ?? [];
  const body = JSON.stringify({ documents });
  // 성공만 캐시한다. 실패를 캐시하면 일시적 장애가 TTL 내내 굳는다
  await env.CACHE.put(key, body, { expirationTtl: PLACES_TTL_S });
  return new Response(body, { headers: JSON_HEADERS });
}
