/**
 * 카카오 키워드 검색 파라미터를 만든다.
 *
 * `places.ts` 에서 떼어낸 이유는 둘이다. 하나는 그 파일이 `expo-constants` 를 물고 있어
 * node 테스트에서 로드되지 않는다는 것(그래서 `places.test.ts` 가 없다). 다른 하나는
 * **여기에 버그가 살았다는 것** — 정렬 규칙은 테스트가 붙는 자리에 있어야 한다.
 *
 * 무엇이 깨졌었나: 국내 좌표면 무조건 `sort=distance` 를 붙였고, `size=15` 와 겹쳐
 * 카카오가 '가장 가까운 15건'만 돌려줬다. 서울시청에서 '강남역'을 치면 9km 떨어진
 * 강남역은 그 15건 안에 못 들어오고, 대신 몇백 미터 안의 엉뚱한 업소가 목록을 채웠다.
 * 해외(`isInKorea` 가 false)에서는 이 블록을 건너뛰어 관련도순이 되는 바람에
 * **국외에서만 제대로 동작하는** 검색이 됐다.
 */
import type { LatLng } from '../data/mockData';

/** 한국 본토 + 제주 + 울릉/독도를 덮는 대략적 바운딩 박스 */
const KR_BBOX = { minLat: 33.0, maxLat: 38.7, minLng: 124.5, maxLng: 132.0 };

export function isInKorea(p: LatLng): boolean {
  return (
    p.latitude >= KR_BBOX.minLat &&
    p.latitude <= KR_BBOX.maxLat &&
    p.longitude >= KR_BBOX.minLng &&
    p.longitude <= KR_BBOX.maxLng
  );
}

/**
 * 이 검색이 무엇을 찾는가. 정렬과 반경이 여기서 갈린다.
 *
 * - `byName` — 사용자가 **이름을 쳐서** 목적지를 찾는다. 관련도순이어야 한다.
 *   목적지는 회랑 밖에 있는 게 정상이라 반경도 걸지 않는다.
 * - `nearby` — 경로 주변에서 **경유지 후보**를 훑는다. 거리순이 맞고 반경으로 가둔다.
 *
 * 기본값을 두지 않는다. 한 `search` 를 두 용도가 나눠 쓰다가 한쪽 규칙이 다른 쪽을
 * 덮어써서 생긴 버그라, 호출부가 어느 쪽인지 **말하게** 만든다.
 */
export type SearchIntent = 'byName' | 'nearby';

/** 카카오 반경 상한 */
const MAX_RADIUS_M = 20000;

/** 한 번에 받아올 건수 */
const SIZE = 15;

export function keywordParams(args: {
  query: string;
  near: LatLng | null;
  intent: SearchIntent;
  radiusM?: number;
  categoryCode?: string | null;
}): URLSearchParams {
  const params = new URLSearchParams({ query: args.query, size: String(SIZE) });
  if (args.categoryCode) params.set('category_group_code', args.categoryCode);

  // 해외에 있으면서 한국 장소를 찾는 경우엔 좌표 자체가 쓸모없다 — 거리도 정렬도 무의미하다
  if (!args.near || !isInKorea(args.near)) return params;

  // 좌표는 두 용도 모두에 넘긴다. 이름 검색에서도 같은 이름이 여럿일 때
  // 가까운 쪽을 위로 올려 주는 힌트가 된다 — 정렬을 갈아엎지는 않는다
  params.set('x', String(args.near.longitude));
  params.set('y', String(args.near.latitude));

  if (args.intent === 'nearby') {
    params.set('sort', 'distance');
    if (args.radiusM != null) params.set('radius', String(Math.min(MAX_RADIUS_M, Math.round(args.radiusM))));
  }

  return params;
}
