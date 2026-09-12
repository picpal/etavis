/**
 * 장소 검색 — 제공자 추상화.
 *
 * 분기 기준은 사용자 국적이 아니라 **검색 대상 좌표**다.
 * 한국에 있으면서 나리타공항을 찍을 수 있으니, 기준 위치가 한국 안이면 국내 제공자,
 * 밖이면 글로벌 제공자를 쓴다.
 *
 * 지금은 백엔드가 없어 목 카탈로그로 응답하지만, 화면이 기대하는 계약은 실제와 같다.
 * 실제 연동 시 getProvider()의 반환만 갈아끼우면 화면은 손대지 않아도 된다.
 */
import Constants from 'expo-constants';
import { LatLng } from '../data/mockData';
import { haversineM } from './geo';
import type { PlaceCandidate } from './routePlan/types';

export type Place = {
  id: string;
  name: string;
  /** 사람이 읽는 주소 — 결과 행의 부제로 쓴다 */
  address: string;
  coord: LatLng;
};

export type ProviderKey = 'kakao' | 'google' | 'mock';

export interface PlaceSearchProvider {
  readonly key: ProviderKey;
  /** near가 주어지면 가까운 순으로 정렬한다. radiusM이 있으면 그 안으로 가둔다(구글은 아직 무시) */
  search(query: string, near: LatLng | null, radiusM?: number): Promise<Place[]>;
}

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
 * 이 좌표를 검색하려면 어느 제공자를 써야 하는지.
 * 실제 붙일 때의 후보:
 *   kakao  — 카카오 로컬 keyword.json. REST 키로 클라이언트 직접 호출 가능, 좌표가 WGS84 그대로.
 *   google — Places Text Search. 결제수단 등록이 필요하다.
 * (네이버는 시크릿 헤더가 필요해 서버를 하나 두지 않으면 앱에서 직접 못 부른다.)
 */
export function regionProviderKey(near: LatLng | null): Exclude<ProviderKey, 'mock'> {
  return near && isInKorea(near) ? 'kakao' : 'google';
}

/* ── 목 카탈로그 ────────────────────────────────────────────────
   주소는 실제 도로명 대신 행정구역 수준으로만 적었다. 목 데이터가
   정확한 척하면 나중에 실제 응답과 섞였을 때 구분이 안 된다.        */

const CATALOG: Place[] = [
  { id: 'p-pyeongchang-st', name: '평창역', address: '강원특별자치도 평창군 용평면', coord: { latitude: 37.6015, longitude: 128.6836 } },
  { id: 'p-alpensia', name: '알펜시아 리조트', address: '강원특별자치도 평창군 대관령면', coord: { latitude: 37.6553, longitude: 128.6773 } },
  { id: 'p-oakvalley', name: '오크밸리 리조트', address: '강원특별자치도 원주시 지정면', coord: { latitude: 37.3236, longitude: 127.8283 } },
  { id: 'p-gangneung-st', name: '강릉역', address: '강원특별자치도 강릉시 교동', coord: { latitude: 37.7639, longitude: 128.899 } },
  { id: 'p-sokcho', name: '속초해수욕장', address: '강원특별자치도 속초시 조양동', coord: { latitude: 38.1908, longitude: 128.6008 } },
  { id: 'p-wonju-st', name: '원주역', address: '강원특별자치도 원주시 무실동', coord: { latitude: 37.3222, longitude: 127.9202 } },
  { id: 'p-seoul-st', name: '서울역', address: '서울특별시 중구 봉래동2가', coord: { latitude: 37.5547, longitude: 126.9707 } },
  { id: 'p-gangnam-st', name: '강남역', address: '서울특별시 강남구 역삼동', coord: { latitude: 37.4979, longitude: 127.0276 } },
  { id: 'p-hongdae', name: '홍대입구역', address: '서울특별시 마포구 동교동', coord: { latitude: 37.5572, longitude: 126.9245 } },
  { id: 'p-coex', name: '코엑스', address: '서울특별시 강남구 삼성동', coord: { latitude: 37.5126, longitude: 127.0588 } },
  { id: 'p-ifc', name: 'IFC몰 여의도', address: '서울특별시 영등포구 여의도동', coord: { latitude: 37.5254, longitude: 126.9256 } },
  { id: 'p-namsan', name: 'N서울타워', address: '서울특별시 용산구 용산동2가', coord: { latitude: 37.5512, longitude: 126.9882 } },
  { id: 'p-gyeongbok', name: '경복궁', address: '서울특별시 종로구 세종로', coord: { latitude: 37.5796, longitude: 126.977 } },
  { id: 'p-starfield-hanam', name: '스타필드 하남', address: '경기도 하남시 신장동', coord: { latitude: 37.5451, longitude: 127.224 } },
  { id: 'p-pangyo-st', name: '판교역', address: '경기도 성남시 분당구 백현동', coord: { latitude: 37.3947, longitude: 127.1112 } },
  { id: 'p-icn', name: '인천국제공항 제1터미널', address: '인천광역시 중구 운서동', coord: { latitude: 37.4602, longitude: 126.4407 } },
  { id: 'p-gmp', name: '김포공항', address: '서울특별시 강서구 공항동', coord: { latitude: 37.5586, longitude: 126.7906 } },
  { id: 'p-daejeon-st', name: '대전역', address: '대전광역시 동구 정동', coord: { latitude: 36.3315, longitude: 127.4344 } },
  { id: 'p-busan-st', name: '부산역', address: '부산광역시 동구 초량동', coord: { latitude: 35.1151, longitude: 129.0413 } },
  { id: 'p-haeundae', name: '해운대해수욕장', address: '부산광역시 해운대구 우동', coord: { latitude: 35.1587, longitude: 129.1604 } },
  { id: 'p-songjeong-st', name: '광주송정역', address: '광주광역시 광산구 송정동', coord: { latitude: 35.1394, longitude: 126.7913 } },
  { id: 'p-cju', name: '제주국제공항', address: '제주특별자치도 제주시 용담2동', coord: { latitude: 33.5104, longitude: 126.4914 } },
  // 해외 — 좌표가 한국 밖이면 글로벌 제공자로 붙을 자리
  { id: 'p-nrt', name: '나리타 국제공항', address: '일본 지바현 나리타시', coord: { latitude: 35.772, longitude: 140.3929 } },
  { id: 'p-tokyo-st', name: '도쿄역', address: '일본 도쿄도 지요다구', coord: { latitude: 35.6812, longitude: 139.7671 } },
  { id: 'p-kix', name: '간사이 국제공항', address: '일본 오사카부 이즈미사노시', coord: { latitude: 34.4342, longitude: 135.2328 } },
  { id: 'p-sin', name: '싱가포르 창이공항', address: '싱가포르 창이', coord: { latitude: 1.3644, longitude: 103.9915 } },
  // 시뮬레이터에서 '후보 30개' 화면을 만들기 위한 목. 좌표는 서교동·동교동 일대
  { id: 'p-hd-01', name: '목베이커리 서교점', address: '서울 마포구 서교동', coord: { latitude: 37.5533, longitude: 126.9220 } },
  { id: 'p-hd-02', name: '목카페 동교', address: '서울 마포구 동교동', coord: { latitude: 37.5561, longitude: 126.9236 } },
  { id: 'p-hd-03', name: '목빵집 홍대입구역점', address: '서울 마포구 동교동', coord: { latitude: 37.5572, longitude: 126.9250 } },
  { id: 'p-hd-04', name: '목디저트 합정', address: '서울 마포구 서교동', coord: { latitude: 37.5497, longitude: 126.9139 } },
  { id: 'p-hd-05', name: '목커피 상수', address: '서울 마포구 상수동', coord: { latitude: 37.5478, longitude: 126.9224 } },
  { id: 'p-hd-06', name: '목브런치 연남', address: '서울 마포구 연남동', coord: { latitude: 37.5601, longitude: 126.9256 } },
  { id: 'p-hd-07', name: '목베이커리 망원', address: '서울 마포구 망원동', coord: { latitude: 37.5561, longitude: 126.9100 } },
  { id: 'p-hd-08', name: '목카페 홍대정문앞아주긴이름점', address: '서울 마포구 서교동', coord: { latitude: 37.5518, longitude: 126.9253 } },
  { id: 'p-hd-09', name: '목빵 서교', address: '서울 마포구 서교동', coord: { latitude: 37.5540, longitude: 126.9201 } },
  { id: 'p-hd-10', name: '목케이크 동교', address: '서울 마포구 동교동', coord: { latitude: 37.5585, longitude: 126.9270 } },
  { id: 'p-hd-11', name: '목커피 서교2', address: '서울 마포구 서교동', coord: { latitude: 37.5525, longitude: 126.9188 } },
  { id: 'p-hd-12', name: '목디저트 상수2', address: '서울 마포구 상수동', coord: { latitude: 37.5489, longitude: 126.9240 } },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

const SEARCH_LATENCY = 220;

const mockProvider: PlaceSearchProvider = {
  key: 'mock',
  search(query, near, radiusM) {
    const q = norm(query);
    return new Promise(resolve => {
      setTimeout(() => {
        if (!q) return resolve([]);
        let hits = CATALOG.filter(p => norm(p.name).includes(q) || norm(p.address).includes(q));
        if (!near) return resolve(hits);
        if (radiusM != null) hits = hits.filter(p => haversineM(near, p.coord) <= radiusM);
        resolve(
          [...hits].sort((a, b) => haversineM(near, a.coord) - haversineM(near, b.coord)),
        );
      }, SEARCH_LATENCY);
    });
  },
};

/* ── 카카오 로컬 API ──────────────────────────────────────────
   REST 키를 Authorization 헤더에 담아 클라이언트에서 바로 부른다.
   좌표가 WGS84 그대로라 변환이 필요 없다. 일 10만 건 무료.
   키는 app.json의 extra.kakaoRestKey — 앱 번들에 들어가므로 추출이 가능하다.
   실서비스로 가면 프록시 서버를 두는 게 맞다.                      */

export const kakaoRestKey: string = (Constants.expoConfig?.extra?.kakaoRestKey as string | undefined)?.trim() ?? '';

/** 장소(POI) 검색 결과 */
type KakaoKeywordDoc = {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  x: string; // 경도
  y: string; // 위도
};

/** 주소 검색 결과 — road_address.building_name에 건물 이름이 들어 있다 */
type KakaoAddressDoc = {
  address_name: string;
  road_address?: { address_name: string; building_name?: string } | null;
  x: string;
  y: string;
};

async function kakaoFetch(kind: 'keyword' | 'address', params: URLSearchParams) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${kind}.json?${params}`, {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
  });
  if (!res.ok) throw new Error(`kakao ${kind} ${res.status}`);
  return res.json();
}

const kakaoProvider: PlaceSearchProvider = {
  key: 'kakao',
  async search(query, near, radiusM) {
    const keywordParams = new URLSearchParams({ query, size: '15' });
    // 기준 좌표를 주면 카카오가 가까운 순으로 정렬해 준다.
    // 국내 좌표일 때만 넘긴다 — 해외에 있으면서 한국 장소를 찾는 경우 거리순이 무의미하다
    if (near && isInKorea(near)) {
      keywordParams.set('x', String(near.longitude));
      keywordParams.set('y', String(near.latitude));
      keywordParams.set('sort', 'distance');
      // 회랑 검색은 반지름으로 가둔다. 카카오 상한 20km
      if (radiusM != null) keywordParams.set('radius', String(Math.min(20000, Math.round(radiusM))));
    }

    /*
      장소명과 주소를 둘 다 받는다.
      키워드 검색만으로도 주소를 넣으면 그 자리의 매장들이 나오지만, POI가 없는
      순수 주소(주택가·펜션 등)는 못 찾는다. 주소 검색이 그 구멍을 메운다.
      대신 표시는 항상 장소명 우선 — 주소 결과도 building_name이 있으면 그걸 쓴다.
    */
    const [keyword, address] = await Promise.all([
      kakaoFetch('keyword', keywordParams),
      // 주소 검색은 보조라, 실패해도 장소 결과는 살린다
      kakaoFetch('address', new URLSearchParams({ query, size: '5' })).catch(() => ({ documents: [] })),
    ]);

    const places: Place[] = ((keyword.documents ?? []) as KakaoKeywordDoc[]).map(d => ({
      id: `kakao-${d.id}`,
      name: d.place_name,
      address: d.road_address_name || d.address_name,
      coord: { latitude: Number(d.y), longitude: Number(d.x) },
    }));

    // 같은 주소를 이미 장소로 찾았으면 주소 결과는 버린다 (강남파이낸스센터가 두 번 나오지 않게)
    const seen = new Set(places.map(p => p.address));
    for (const d of (address.documents ?? []) as KakaoAddressDoc[]) {
      const road = d.road_address?.address_name || d.address_name;
      if (seen.has(road)) continue;
      seen.add(road);
      places.push({
        id: `kakao-addr-${d.x},${d.y}`,
        name: d.road_address?.building_name || road,
        address: road,
        coord: { latitude: Number(d.y), longitude: Number(d.x) },
      });
    }
    return places;
  },
};

/* ── Google Places (New) Text Search ─────────────────────────
   POST places:searchText. 키는 헤더(X-Goog-Api-Key), 필요한 필드만 FieldMask로 받는다.
   카카오와 달리 결제수단 등록이 필요하다.                          */

const GOOGLE_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location';

export const googlePlacesKey: string =
  (Constants.expoConfig?.extra?.googlePlacesKey as string | undefined)?.trim() ?? '';

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
};

const googleProvider: PlaceSearchProvider = {
  key: 'google',
  async search(query, near) {
    const body: Record<string, unknown> = { textQuery: query, languageCode: 'ko', maxResultCount: 15 };
    if (near) {
      // 반경은 '이 근처를 우선' 정도의 힌트다. 결과를 그 안으로 가두지는 않는다
      body.locationBias = { circle: { center: { latitude: near.latitude, longitude: near.longitude }, radius: 20000 } };
    }
    const res = await fetch(GOOGLE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': googlePlacesKey,
        'X-Goog-FieldMask': GOOGLE_FIELDS,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`google ${res.status}`);
    const json = (await res.json()) as { places?: GooglePlace[] };
    return (json.places ?? [])
      .filter(p => p.location)
      .map(p => ({
        id: `google-${p.id}`,
        name: p.displayName?.text ?? p.formattedAddress ?? '',
        address: p.formattedAddress ?? '',
        coord: { latitude: p.location!.latitude, longitude: p.location!.longitude },
      }));
  },
};

/**
 * 검색 제공자 — 현재 위치가 국내면 카카오, 해외면 구글.
 *
 * 국내 POI는 카카오가 더 촘촘하고(지점명·상호), 해외는 카카오가 사실상 비어 있다.
 * 해외에 있으면서 한국 장소를 찾는 경우도 구글이 한국을 커버하므로 막히지 않는다.
 * 쓸 키가 없으면 조용히 목으로 떨어진다 — 키 없이도 화면은 그대로 동작해야 한다.
 */
export function getProvider(near: LatLng | null): PlaceSearchProvider {
  const wanted = regionProviderKey(near);
  if (wanted === 'kakao' && kakaoRestKey) return kakaoProvider;
  if (wanted === 'google' && googlePlacesKey) return googleProvider;
  // 원하는 쪽 키가 없으면 있는 쪽이라도 쓴다 (해외에서 구글 키가 없을 때 등)
  if (kakaoRestKey) return kakaoProvider;
  if (googlePlacesKey) return googleProvider;
  return mockProvider;
}

/** 플래너용 검색 함수 — Place를 PlaceCandidate로. hours는 아직 없다(다음 계획) */
export function planSearchFn(): (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]> {
  return async (query, near, radiusM) => {
    const places = await getProvider(near).search(query, near, radiusM);
    return places.map(p => ({ id: p.id, name: p.name, coord: p.coord, address: p.address }));
  };
}
