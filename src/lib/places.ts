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
import { Platform } from 'react-native';
import { LatLng } from '../data/mockData';
import { isInKorea, keywordParams, type SearchIntent } from './placesParams';
import { haversineM } from './geo';
import { isVerifiedCategory, keepPlace, planSearch } from './placeQuery';
import { withMockFallback } from './placesFallback';
import type { PlaceCandidate } from './routePlan/types';

/* 좌표 판정과 정렬 규칙의 출처는 placesParams.ts 하나다 — 호출부는 여기서 가져다 쓴다 */
export { isInKorea, type SearchIntent };

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
  /**
   * `intent` 가 정렬을 가른다 — `byName` 은 관련도순, `nearby` 는 거리순.
   * `radiusM` 은 `nearby` 에서만 쓴다(구글은 아직 무시). 자세한 이유는 `placesParams.ts`.
   */
  search(query: string, near: LatLng | null, intent: SearchIntent, radiusM?: number): Promise<Place[]>;
}

/**
 * 이 좌표를 검색하려면 어느 제공자를 써야 하는지.
 *   kakao  — 카카오 로컬 keyword.json. 키는 서버에만 있고 /places 프록시를 지난다.
 *   google — Places Text Search. **클라이언트 경로는 없앴다**(키가 공개 번들에 박힌다).
 * 지금 getProvider 는 이 판정을 쓰지 않는다 — 해외 공급자를 다시 둘 때의 갈림길로 남겨둔다.
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
  search(query, near, intent, radiusM) {
    const q = norm(query);
    return new Promise(resolve => {
      setTimeout(() => {
        if (!q) return resolve([]);
        let hits = CATALOG.filter(p => norm(p.name).includes(q) || norm(p.address).includes(q));
        // 이름으로 찾을 때는 목도 거리순으로 흔들지 않는다 — 목이 실제와 다르게 굴면
        // 개발 중에는 멀쩡해 보이고 실기에서만 깨진다
        if (!near || intent === 'byName') return resolve(hits);
        if (radiusM != null) hits = hits.filter(p => haversineM(near, p.coord) <= radiusM);
        resolve(
          [...hits].sort((a, b) => haversineM(near, a.coord) - haversineM(near, b.coord)),
        );
      }, SEARCH_LATENCY);
    });
  },
};

/* ── 카카오 로컬 API ──────────────────────────────────────────
   키는 서버에만 있다. 클라이언트는 Workers /places 프록시를 지나고,
   서버가 있는지만 hasServer()로 판정한다 — 카카오 키를 클라이언트
   번들에 넣는 경로는 의도적으로 없앴다(app.config.js도 더 이상
   KAKAO_REST_KEY를 extra에 주입하지 않는다). 좌표는 WGS84 그대로라
   변환이 필요 없다.                                              */

/** 서버가 있으면 카카오 로컬을 쓸 수 있다 — 키는 서버에만 있다 */
const hasServer = (): boolean => {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
  return !!extra.serverUrl?.trim() && !!extra.appToken?.trim();
};

/** 장소(POI) 검색 결과 */
type KakaoKeywordDoc = {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  /** 업종 코드(BK9 은행, PK6 주차장 …). 브랜드 매장은 빈 값일 수 있다 */
  category_group_code?: string;
  /** "금융,보험 > 금융서비스 > 은행 > ATM" 같은 전체 경로 */
  category_name?: string;
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

/**
 * 카카오 로컬 — Workers /places 프록시를 지난다.
 *
 * 예전엔 dapi.kakao.com 을 직접 불렀다. 카카오 REST 키는 도메인 제한이 안 걸려서
 * 공개 웹 번들에 박히면 누구나 무제한으로 쓴다. 이제 키는 서버에만 있고,
 * 이 호출은 guard 의 분당·일일 상한 안으로 들어온다.
 *
 * 5초에 끊는다 — runPlan 의 전체 예산이 12초라 프록시가 느려지면 계획이 통째로 죽는다.
 * 실패는 그대로 던진다. 받아내는 건 placesFallback 의 몫이다(웹에서만).
 */
const PLACES_TIMEOUT_MS = 5000;

async function kakaoFetch(kind: 'keyword' | 'address', params: URLSearchParams) {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
  const baseUrl = extra.serverUrl?.trim();
  const appToken = extra.appToken?.trim();
  if (!baseUrl || !appToken) throw new Error('places: 서버 없음');

  const num = (k: string) => (params.get(k) == null ? undefined : Number(params.get(k)));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLACES_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/places`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-app-token': appToken,
        'x-device-id': Constants.sessionId ?? 'unknown',
      },
      body: JSON.stringify({
        kind,
        query: params.get('query') ?? '',
        x: num('x'),
        y: num('y'),
        radius: num('radius'),
        size: num('size'),
        categoryCode: params.get('category_group_code') ?? undefined,
        /* 정렬 기준을 **말해서** 보낸다. 서버가 좌표 유무로 정하던 때는 이름 검색이
           좌표를 주는 순간 거리순이 돼, 정확히 일치하는 목적지가 '가까운 15건' 밖으로
           밀렸다. 좌표는 관련도 힌트로 계속 넘기므로 둘을 분리할 다른 길이 없다 */
        sortByDistance: params.get('sort') === 'distance',
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`places ${kind} ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

const kakaoProvider: PlaceSearchProvider = {
  key: 'kakao',
  async search(query, near, intent, radiusM) {
    /*
      카카오는 이름만 매칭한다 — "국민은행"에 "국민은행앞1 공영노상주차장"(PK6)과
      "현대그린푸드국민은행 여의도전산센터"(FD6)가 같이 온다. 2026-09-15 시뮬레이터에서
      그 주차장이 1순위 추천이 됐다. 아는 업종이면 코드로 서버에서 거른다.
      모르는 업종(올리브영 같은 브랜드)은 코드 자체가 없어서 찍으면 0건이 된다 — 그래서 null.

      코드로 못 거르는 업종이 더 많다(문구점·꽃집·세탁소·동네 마트는 코드가 빈 값이다).
      그건 응답의 category_name 으로 거른다. '동네 빵집' 처럼 검색어로는 0건인 말도
      여기서 실제 검색어로 옮긴다 — planSearch 가 둘 다 정한다.
    */
    const plan = planSearch(query);
    // 정렬·반경 규칙은 `placesParams.ts` 에 있다 — 국내에서만 이름 검색이 깨지던
    // 버그가 여기 살았고, 테스트가 붙는 자리로 옮겼다
    const params = keywordParams({
      query: plan.query,
      near,
      intent,
      radiusM,
      categoryCode: plan.categoryCode,
    });

    /*
      장소명과 주소를 둘 다 받는다.
      키워드 검색만으로도 주소를 넣으면 그 자리의 매장들이 나오지만, POI가 없는
      순수 주소(주택가·펜션 등)는 못 찾는다. 주소 검색이 그 구멍을 메운다.
      대신 표시는 항상 장소명 우선 — 주소 결과도 building_name이 있으면 그걸 쓴다.
    */
    // 업종을 물었으면 주소 결과는 부르지 않는다 — 카테고리로 거른 것을 뒷문으로 다시 들인다.
    // 주소 검색은 POI 가 없는 순수 주소를 메우는 보조라, 업종 질의에는 쓸모가 없다.
    const isCategoryQuery = isVerifiedCategory(plan);

    const [keyword, address] = await Promise.all([
      kakaoFetch('keyword', params),
      isCategoryQuery
        ? Promise.resolve({ documents: [] })
        : kakaoFetch('address', new URLSearchParams({ query: plan.query, size: '5' })).catch(() => ({ documents: [] })),
    ]);

    const kept = ((keyword.documents ?? []) as KakaoKeywordDoc[]).filter(d =>
      keepPlace(d.place_name, d.category_name, plan),
    );
    const places: Place[] = kept.map(d => ({
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

/* ── 해외 장소 검색 ──────────────────────────────────────────
   구글 Places 직접 호출 경로는 없앴다. 키를 extra 로 주입하면 카카오와
   똑같이 공개 웹 번들에 박히는데(app.config.js 도 더 이상 GOOGLE_PLACES_KEY 를
   주입하지 않는다), 해외 장소 검색은 이 데모의 범위 밖이라 프록시를 새로
   뚫을 이유도 없다. 해외 좌표는 /places 프록시(카카오)를 그대로 지나고,
   서버가 없으면 목으로 떨어진다.                                  */

/**
 * 검색 제공자 — 서버가 있으면 카카오 프록시, 없으면 목.
 *
 * 국내 POI는 카카오가 더 촘촘하고(지점명·상호), 해외는 사실상 비어 있다.
 * 그 빈자리를 메우던 구글 경로는 클라이언트 키를 요구해서 없앴다(위 주석).
 * 서버가 없으면 조용히 목으로 떨어진다 — 키 없이도 화면은 그대로 동작해야 한다.
 */
/**
 * 이번 세션에서 장소 검색이 한 번이라도 목으로 내려갔나.
 *
 * 한 번 서면 안 내린다 — 깜빡이는 배너는 읽히지 않는다. 뜻은 '이 화면의 결과 중
 * 일부는 예시 데이터일 수 있다'이고, 그게 사용자가 알아야 할 전부다.
 */
let searchDegraded = false;
export const isSearchDegraded = () => searchDegraded;

/* 래퍼를 호출마다 새로 만들면 placesFallback 의 회로차단기 상태(downUntil)가 매번
   리셋된다 — planSearchFn 이 반경 루프 라운드마다 getProvider 를 다시 부르므로
   차단기가 프로덕션에서 무력해진다. primary 는 모듈 싱글턴 둘 중 하나라 그걸 키로
   잡아 재사용한다. hasServer() 는 런타임에 안 바뀐다. */
const wrapped = new Map<PlaceSearchProvider, PlaceSearchProvider>();

export function getProvider(_near: LatLng | null): PlaceSearchProvider {
  /* 국내·해외를 가리지 않고 /places 프록시 하나뿐이다. 해외 공급자를 다시 두면
     regionProviderKey(near) 로 여기서 갈라진다. */
  const primary = hasServer() ? kakaoProvider : mockProvider;
  const cached = wrapped.get(primary);
  if (cached) return cached;
  /* 웹 데모에서만 목으로 받아낸다. 네이티브는 실패 배너가 정직하다 — placesFallback.ts 주석 참고.
     DestinationSheet 도 planSearchFn 도 이 함수를 지나므로 배선은 여기 한 곳이면 된다. */
  const result = withMockFallback(primary, mockProvider, {
    enabled: Platform.OS === 'web',
    onFallback: () => {
      searchDegraded = true;
    },
  }) as PlaceSearchProvider;
  wrapped.set(primary, result);
  return result;
}

/** 플래너용 검색 함수 — Place를 PlaceCandidate로. hours는 아직 없다(다음 계획) */
export function planSearchFn(): (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]> {
  return async (query, near, radiusM) => {
    const places = await getProvider(near).search(query, near, 'nearby', radiusM);
    return places.map(p => ({ id: p.id, name: p.name, coord: p.coord, address: p.address }));
  };
}
