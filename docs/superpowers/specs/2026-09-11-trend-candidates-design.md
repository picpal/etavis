# 트렌드 후보 — 업종 검색일 때 인기·최신 언급으로 추천

작성 2026-09-11. "홍대 빵집"처럼 범용 단어로 말하면 회랑 안에 수십 곳이 잡히는데, 지금은 경로에서 가까운 순 8곳만 이름으로 나열한다. 도심에서는 후보끼리 추가시간 차이가 2~5분뿐이라 시간·거리 정렬은 변별력이 없다. 남는 축은 사용자 취향인데 그걸 대신할 신호(평점·최근 언급)를 붙여 상위 몇 곳을 추천한다.

## 왜

- 2026-09-11 논의: 후보 시트의 정렬 3개(추가시간·주차·거리) 중 추가시간과 거리는 순서가 거의 같고, 주차는 실검색에서 전부 '모름'이다. 사실상 축이 하나다.
- 도심 업종 검색은 후보가 많고 브랜드가 다양해 칩·세그먼트로는 못 담는다.
- 사용자 요구: 블로그·인스타·지도 평점을 종합해 최대 30곳 안에서 추천. 인스타와 카카오맵 평점은 공식 API가 없어 **네이버 블로그 + 구글 Places**로 대체한다.

## 범위

들어가는 것

- 카카오 회랑 검색 후보 상한 8 → **30** (업종 슬롯만).
- Workers `/enrich`: 후보별 네이버 블로그 최근 언급 + 구글 평점·리뷰 수·영업시간. KV 캐시.
- 순수 점수 모듈 `src/lib/trendScore.ts`와 동일 매장 매칭 `src/lib/placeMatch.ts`.
- 후보 시트: 정렬 탭을 `추천 · 추가시간 · 주차(자동차만)`으로. 거리 탭 제거. 카드에 근거 한 줄, 상위에 "요즘 인기" 배지. 기본 5개 + 더 보기.
- 추출 결과의 `kind`(brand/category/specific)를 칩 → PlanRequest → Slot까지 전달.
- 서버·키가 없을 때의 목 보강(시뮬레이터 검증용).

건드리지 않는 것

- 플래너의 경로 목적함수(시간 기반). 트렌드는 **후보 순서와 기본 선택**에만 관여한다.
- 추출 프롬프트·케이스. `kind`는 이미 스키마에 있다.
- 지역 앵커("강남 가는 길에 **홍대** 빵집"). §10.
- 체험단·광고 글 필터. §10.

## 0. 용어와 트리거

- **업종 슬롯**: 추출 `kind === 'category'`인 경유지. "빵집", "카페", "밥집".
- **브랜드/특정 슬롯**: `kind === 'brand' | 'specific'`. "파리바게트", "성심당 본점". 지금 흐름 그대로(추가시간순, 상한 8 유지 안 함 → 30으로 통일하되 보강은 안 함).
- 보강은 **업종 슬롯이고 회랑 검색 후보가 4개 이상**일 때만 돈다. 3개 이하는 순서를 바꿔봐야 의미가 없고 구글 호출만 나간다.

`kind` 전달 경로: `server/src/schema.ts`(있음) → `src/lib/intent.ts`(있음) → `plan.tsx` 칩 `{ kind: 'stop', stopKind: 'brand'|'category'|'specific' }`(추가) → `usePlanRequest.ts` `stops[].stopKind`(추가) → `runPlan.ts` `Slot.stopKind`(추가). 목 추출(`intent.ts`)은 이미 `kind`를 만든다. 칩이 `stopKind`를 모르면(옛 상태) `'category'`로 본다.

## 1. 후보 수집 — 최대 30개

`src/lib/corridorSearch.ts` `searchAlong`

- 지금: 5개 샘플 점에서 검색, 반지름 확장, 결과를 합쳐 반환. `runPlan`이 8개로 자른다.
- 바꿈: 샘플 점 결과를 id로 중복 제거하고, **회랑에서 벗어난 거리(cross-track) 오름차순**으로 정렬해 30개까지 반환한다. `runPlan`의 `.slice(0, 8)`은 `.slice(0, 30)`으로.
- 카카오는 요청당 15개다. 샘플 5점 × 15 = 최대 75개 중 30개를 고르므로 페이지 추가 호출은 하지 않는다. 카카오 호출 수는 지금과 같다.
- 플래너는 후보마다 추정(하버사인)만 하고 실측은 시드 + 2라운드 추가분만 하므로, 30개로 늘려도 `/route` 호출은 늘지 않는다. `runPlan.test.ts`에 "후보 30개여도 measuredCount는 8개 때와 같다"를 넣는다.

`PlaceCandidate`에 `address?: string`을 추가한다. 카카오 `address_name`("서울 마포구 서교동 395-17")이 그대로 들어온다. 보강 질의어의 동네 이름은 여기서 뽑는다 — 역지오코딩 없음.

## 2. 서버 `/enrich`

`server/src/index.ts`에 경로 추가. 기존 `/route`와 같은 게이트(APP_TOKEN, 기기 rate limit). `PER_MIN['/enrich'] = 10` — 계획 하나에 슬롯 수만큼(≤5) 나간다.

### 요청

```ts
type EnrichRequest = {
  places: { id: string; name: string; address: string; lat: number; lng: number }[]; // ≤ 30
};
```

`server/src/enrichSchema.ts`에서 검증: 배열 1~30, 이름 1~60자, 주소 0~120자, 좌표 한국 바운딩 박스 안. 벗어나면 422.

### 응답

```ts
type EnrichResponse = {
  results: Record<string, PlaceSignals>;   // 요청 id → 신호. 없으면 키 자체가 없음
  budget: { googleUsed: number; googleLeft: number }; // 이달 사용/잔여. 화면엔 안 보이고 개발 메뉴에만
};
type PlaceSignals = {
  blog?: { count90d: number; latestDaysAgo: number | null; weighted: number; source: 'naver' | 'kakao' }; // weighted = Σ exp(-age/45)
  google?: { rating: number; ratingCount: number; hours?: { openMin: number; closeMin: number } | null; matchedName: string };
  fetchedAt: string; // ISO
};
```

부분 실패는 실패가 아니다. 블로그만 오고 구글이 없어도 200이다.

### 2.1 네이버 블로그 검색 (NAVER API HUB)

- `GET https://naverapihub.apigw.ntruss.com/search/v1/blog?query=<이름 동네>&sort=date&display=100`
- 헤더 `X-NCP-APIGW-API-KEY-ID: <NCP_API_KEY_ID>`, `X-NCP-APIGW-API-KEY: <NCP_API_KEY>`
- 네이버 클라우드 플랫폼 계정이 필요하다. 개발자센터(developers.naver.com)의 옛 `openapi.naver.com/v1/search/blog.json`은 **2026-07-30 신규 신청 마감**이라 새로 발급받을 수 없다. 기존 발급분은 2027-06-30까지 유예.
- **질의어는 카카오 `place_name` 그대로다.** 동네 이름을 붙이지 않는다. 근거는 §2.1.3 실측.
- 응답: `total`(전 기간 총 건수), `items[]`의 `postdate`(YYYYMMDD), `title`, `description`, `bloggername`.
- `postdate`로 90일 안 글만 센다. `weighted = Σ exp(-ageDays / 45)`, 상한 100. `total`은 전 기간이라 buzz 값 자체에는 쓰지 않는다 — 오래된 맛집이 요즘 뜨는 곳을 이기면 안 된다.
- **`total > 20000`이면 그 후보의 `blog`을 버린다.** 이름이 너무 일반적이어서 전국 집계가 잡힌 것이다("파리바게트" 289,993, "연남동 카페" 235,904). 실제 단일 지점은 훨씬 작다(올리브영 홍대점 466, 아오이토리 4,862).
- 쿼터: 일 25,000회, 월 775,000회. 콘솔 Application 화면에서 실시간으로 보인다. 현재 한시 무료이며 유료 전환이 예고돼 있다.
- 2026-09-12 스모크 테스트로 엔드포인트·헤더·응답 필드를 실제 호출해 확인했다(status 200).
- 캐시 KV `blog:<kakaoId>` **24시간**.

#### 2.1.1 약관 확인 결과 (2026-09-11, 원문 확인)

`네이버 클라우드 플랫폼 AI·Naver API 서비스 이용약관` v6.0(적용일자 2025-03-20) 원문을 받아 확인했다.

- **검색 API 특약은 없다.** "부가 조항 — 개별 API별 특약 조건"에 있는 건 Maps·Papago·CLOVA 셋뿐이다. 언론이 보도한 "가공 없이 노출·순위 변조 금지·AI 활용 금지"(2026-09-07 시행)는 **developers.naver.com의 `NAVER API 서비스 이용약관`** 것이고, 우리가 쓸 ncloud HUB 약관에는 없다.
- 적용되는 건 일반 조항 제5조 ⑧뿐이다. "'고객'은 '회사'의 사전 동의 없이 '본 서비스'의 결과 데이터를 본 약관에서 허용한 범위를 넘어서서 무단으로 복제, 저장, 가공, 배포하거나 제3자에게 제공해서는 안됩니다."
- Maps 특약은 저장·DB화를 **명시적으로** 금지한다("값을 리턴 받는 즉시 1회 자신의 서비스에서 사용하는 것만 허용"). 검색에는 그런 특약이 없다. 네이버가 저장을 막고 싶을 때는 따로 쓴다는 뜻이므로, 일반 조항만으로 모든 캐시가 금지된다고 읽기는 어렵다.

**그래서 이렇게 한다.** 원문 기준으로 막는 조항이 없으므로 진행한다. 다만 제5조 ⑧이 남아 있으니 다음을 지킨다.

1. 캐시는 24시간을 넘기지 않는다. 영구 저장·DB화를 하지 않는다.
2. 응답 원문(제목·본문·링크)을 화면에 재배포하지 않는다. 화면에 나가는 건 파생 수치("최근 블로그 12건")뿐이다.
3. 결과 데이터를 모델 학습에 쓰지 않는다.
4. 유료 전환 공지가 뜨면 단가를 확인하고 재검토한다.

> 위 1~3은 약관이 요구해서가 아니라, 요구할 여지를 없애기 위한 선택이다. 애매함이 남으면 네이버 클라우드에 문의한다.

#### 2.1.3 질의어 형태 — 실측 근거 (2026-09-12)

처음에는 `${동네} ${이름}`으로 설계했다가 실제로 호출해 보고 뒤집었다. **행정동 이름은 블로그 글에 거의 쓰이지 않는다.** 블로거는 "서교동"이 아니라 "홍대", "합정", "망원"이라고 쓴다. 그래서 동네를 붙이면 건수가 20분의 1로 뭉개진다.

`weighted` = 90일 안 글의 `Σ exp(-age/45)`. 같은 날 측정.

| 상호 | `동네 + 이름` | 이름만(카카오 지점명 형태) |
|---|---|---|
| 아오이토리 | 1.5 | **34.8** |
| 쿠리노키제빵 | 1.2 | **8.3** |
| 베이글랜드 | 1.4 (서교동) | **11.8** (홍대점) |
| 파리바게트 | 0.0 (서교동) | 97.2 — 전국 집계라 무의미 |

카카오 `place_name`은 체인이면 이미 지점형("베이글랜드 홍대점")이고 독립 매장이면 그 자체로 고유하다("아오이토리"). 그래서 **그대로 쓰는 게 정답**이고, 전국 집계로 새는 경우만 `total > 20000`으로 걸러낸다.

지점형 체인 실측: 올리브영 홍대점 14.2 · 다이소 홍대점 2.9 · 폴바셋 홍대점 1.6 · 스타벅스 홍대점 1.1 · 파리바게트 홍대점 0.0.

시골은 0이 나온다(평창군 용평면 카페 0.0). §3의 "80% 이상 0이면 buzz 축 폐기" 규칙이 이걸 받는다.

#### 2.1.2 보조 — 카카오(다음) 블로그 검색

네이버 계정을 아직 못 만든 동안의 대체이자, 티스토리 계열 보완재다.

- `GET https://dapi.kakao.com/v2/search/blog?query=...&sort=recency&size=50`, 헤더 `Authorization: KakaoAK <KAKAO_REST_KEY>`. 카카오 개발자센터에서 **다음 검색** 활성화 필요.
- `documents[].datetime`(ISO 8601)으로 같은 방식의 `weighted`를 만든다.
- 다음 색인은 `blog.naver.com` 커버리지가 얕아 한국 지역업체 언급이 **과소집계**된다. 네이버가 붙으면 이쪽은 끈다.

`/enrich`는 `NCP_API_KEY_ID`가 있으면 네이버를, 없으면 카카오를 쓴다. `PlaceSignals.blog`에 `source: 'naver' | 'kakao'`를 실어 개발 메뉴에서 어느 쪽인지 보이게 한다.

**구글 Custom Search는 설계에 넣지 않는다.** 신규 고객 접수가 중단됐고 2027-01-01 종료 예정이다.

### 2.2 구글 Places (New)

- `POST https://places.googleapis.com/v1/places:searchText`
- 헤더 `X-Goog-Api-Key: <GOOGLE_PLACES_KEY>`(secret), `X-Goog-FieldMask: places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.regularOpeningHours`
- 바디 `{ textQuery: "<이름> <동네>", languageCode: "ko", locationBias: { circle: { center, radius: 300 } }, maxResultCount: 3 }`
- **rating·userRatingCount·regularOpeningHours는 Enterprise SKU**. 월 1,000회 무료, 초과 시 자동 과금. 그래서:
  - 캐시 KV `google:<kakaoId>` **14일**.
  - 슬롯당 구글 조회는 **블로그+경로 적합도 상위 10개만**(§3 1차 점수). 나머지는 `google` 없이 반환.
  - 월 예산 카운터 KV `google:budget:<YYYY-MM>`. **900**에 닿으면 이달은 구글을 건너뛴다(캐시 적중은 계속). 응답 `budget`에 실린다.
  - 운영자는 Cloud Console 할당량에서 Places API **일일 상한 40**을 건다. 코드 카운터가 실패해도 이걸로 막힌다(§9).
- 응답 3개 중 `placeMatch`(§2.3)로 하나를 고른다. 못 고르면 `google` 없음.
- `regularOpeningHours.periods[0]`에서 오늘 요일의 open/close를 분으로 바꿔 `hours`. 24시간이면 `{0, 1440}`. 없으면 null.

### 2.3 동일 매장 매칭 `src/lib/placeMatch.ts` (순수, 서버·앱 공용)

```ts
export function normalizeName(s: string): string;
// 공백·괄호·특수문자 제거, "점"/"지점"/"본점" 접미 제거, 영문 소문자.
// "파리바게트 홍대점" → "파리바게트홍대", "PARIS BAGUETTE 서교점" → "parisbaguette서교"
export function matchPlace(
  target: { name: string; lat: number; lng: number },
  cands: { name: string; lat: number; lng: number }[],
): number | null; // 인덱스
```

규칙, 순서대로:

1. 거리 150m 초과는 탈락.
2. 정규화 이름이 같으면 채택.
3. 한쪽이 다른 쪽을 포함(접두 일치 4자 이상)하면 채택. "파리바게트홍대" ⊂ "파리바게트홍대입구역".
4. 남은 것 중 거리 60m 이내가 **정확히 하나**면 채택(지점명만 다른 경우).
5. 아니면 null.

테스트 케이스는 §8.

## 3. 점수 `src/lib/trendScore.ts`

```ts
export type TrendInput = {
  id: string;
  addedMin: number;                  // 플래너 추정(현재 경로 대비)
  blog?: { weighted: number };
  google?: { rating: number; ratingCount: number };
};
export type TrendScored = { id: string; score: number; fit: number; quality: number | null; buzz: number | null; reasons: string[] };
export function scoreTrend(inputs: TrendInput[]): TrendScored[]; // score 내림차순, 동률은 addedMin 오름차순
```

- `fit = 1 − clamp(addedMin / maxAdded, 0, 1)`, `maxAdded = max(입력의 addedMin, 10)`. 전부 +3분이면 전부 0.7이고 차이는 다른 축이 만든다.
- `quality = (rating / 5) × min(1, log10(1 + ratingCount) / log10(201))`. 리뷰 200개에서 포화. 리뷰 3개 5.0 = 0.60, 리뷰 300개 4.4 = 0.88.
- `buzz = min(1, log10(1 + weighted) / log10(11))`. weighted 10이면 1.0.
  선형 `weighted/20`은 실측 분포와 맞지 않아 버렸다. 실제 단일 매장의 weighted는 0~35에 몰려 있어(§2.1.3) 20으로 나누면 대부분 0.1 미만이 되고 축이 사실상 죽는다. 로그를 쓰면 0.6→0.20, 1.5→0.38, 2.3→0.50, 8.3→0.93로 실제 값이 전 구간에 퍼진다.
- 가중치 `fit 0.4 · quality 0.35 · buzz 0.25`. 없는 축은 빼고 남은 가중치를 합이 1이 되게 다시 나눈다. 셋 다 없으면 `fit`만.
- 슬롯 후보의 80% 이상이 `weighted === 0`이면 그 슬롯에서 buzz 축을 버린다. 색인 공백을 "인기 없음"으로 오해하지 않기 위해서다. 카카오 보조 경로(§2.1.2)에서 특히 자주 걸린다.
- **1차 점수**(구글 조회 대상 고르기): `fit 0.6 · buzz 0.4`. 서버가 아니라 앱이 계산해 `/enrich`를 두 번 부르지 않도록, 서버가 블로그를 먼저 다 받은 뒤 같은 식으로 상위 10개를 골라 구글을 부른다. 식은 `trendScore.ts`를 서버가 import한다(`server/src`는 `../../src/lib`를 이미 참조하는 패턴이 있는지 확인, 없으면 복사하고 파일 머리에 원본 경로를 적는다).
- `reasons`: 있는 것만, 이 순서. `구글 4.5 (320)` · `최근 블로그 12건` · `+4분`. 카드 부제에 " · "로 잇는다.
- **요즘 인기** 배지: `buzz ≥ 0.6` 이고 순위 3위 안.

## 4. 플래너와 기본 선택

플래너는 지금처럼 시간으로 경로를 고른다. 업종 슬롯에서 트렌드 1위가 시간 1위와 다를 때만 개입한다.

- `runPlan`: 보강 결과를 받으면 `Slot.candidates[i].signals`에 붙이고 플래너를 돌린다.
- 결과가 나온 뒤 업종 슬롯마다 `scoreTrend`로 순위를 낸다. 1위 후보가 현재 선택과 다르고, **그 후보로 바꿔도 `rescore` 도착이 마감 안**(마감 없으면 총 +10분 이내)이면 `SET_OVERRIDE`로 바꾼다. 아니면 시간 1위 그대로.
- 즉 헤드라인 경로와 시트의 "추천"이 같은 매장을 가리킨다. 지금 A5의 경유지 카드가 보여주는 매장 = 시트 1위.

## 5. 화면 — 후보 시트

`src/sheets/CandidateSheet.tsx`, `src/lib/candidateRank.ts`

- `CANDIDATE_SORTS = ['추천', '추가시간', '주차']`. 주차 탭은 `mode === 'car'`일 때만 렌더. 브랜드·특정 슬롯(신호 없음)은 '추천' 탭을 숨기고 '추가시간'이 기본.
- '추천' 정렬 = `score` 내림차순. `Candidate`에 `trend?: { score; reasons; hot: boolean }` 추가(`planFlowBridge.ts`에서 채움).
- 카드 부제(`note`)는 지금 "화장품 · 경로에서 1.1km". 업종 슬롯은 `reasons.join(' · ')`로 바꾼다. 신호가 하나도 없으면 지금 문구.
- "요즘 인기" 배지: 이름 오른쪽, `color.greenBg` 바탕 `color.green` 글자, 도착 배지와 같은 모양. 카드당 배지는 최대 1개 — 현재 경로 배지(`recommended`)와 겹치면 "요즘 인기"가 이긴다.
- 목록은 **5개**까지 보이고 그 아래 "N곳 더 보기" 행. 누르면 30개까지 펼친다. 시트를 다시 열면 5개로 돌아간다.
- 최대 케이스 시뮬레이터 확인: 후보 30개 + 더 보기 펼침, 이름 20자, reasons 3개 다 있는 카드, 자동차/대중교통 탭 차이, 신호 전무(브랜드 슬롯).

## 6. 실패와 폴백

| 상황 | 동작 |
|---|---|
| 서버 없음(usingServer=false) | 목 보강(§7) |
| `/enrich` 2.5초 초과·5xx | 보강 없이 진행. 시트는 추가시간순, '추천' 탭 없음. 진행 화면 문구 변화 없음 |
| 일부 후보만 신호 | 있는 축만으로 점수(§3). 없는 후보는 `fit`만이라 아래로 간다 |
| 구글 예산 소진 | 블로그+fit만. 개발 메뉴에 `구글 0/900` 표시 |
| 네이버 429 | 그 후보 `blog` 없음. 재시도 안 함 |

`/enrich`는 계획 타임아웃 12초 안에서 회랑 검색 직후, 플래너 전에 부른다. 슬롯별 병렬. 2.5초 자체 타임아웃은 계획 전체 12초와 별개다.

## 7. 목 보강

`src/lib/enrich/mockEnrich.ts`: 이름 해시로 결정적 신호를 만든다. 이름에 "카페"·"베이커리"가 있으면 blog weighted 5~25, rating 3.8~4.7, count 20~400. 시뮬레이터에서 §5 최대 케이스를 만들 수 있어야 한다. 목 카탈로그에 홍대 근처 빵집·카페 12곳을 추가한다(주소에 "서교동"·"동교동" 포함).

## 8. 테스트 (`npm test`)

- `trendScore.test.ts`: 축 누락 시 재정규화, 리뷰 포화, 동률 → addedMin, 전부 같은 addedMin이면 quality가 순서를 정함, 1차 점수 상위 10 선별.
- `placeMatch.test.ts`: 정규화("파리바게트 홍대점"="PARIS BAGUETTE 홍대"), 포함 일치, 150m 밖 탈락, 60m 안 유일 채택, 60m 안 둘이면 null.
- `corridorSearch.test.ts`: 중복 제거 + cross-track 정렬 + 30 상한.
- `runPlan.test.ts`: 업종 슬롯만 보강 호출, 후보 3개면 호출 안 함, 보강 타임아웃 시 결과는 나옴, 30개여도 measuredCount 불변, 트렌드 1위가 마감 안이면 override·밖이면 유지.
- `server/src/enrich.test.ts`: 스키마 422, 블로그 파싱(postdate → weighted), 구글 매칭 실패 시 키 없음, 예산 900 도달 시 구글 건너뜀(KV 목).
- `candidateRank.test.ts`: '추천' 정렬, 주차 탭 car 한정.

## 9. 운영 요건

### 구글 (2026-09-11 콘솔에서 확인·설정 완료)

프로젝트 `My First Project`(project-940ef3e9-568b-4ddf-82a), 결제 계정 `내 결제 계정`(01DCE2-8227F6-3EC5C2).

- Places API (New) 사용 설정됨.
- API 키 `etavia-places` 생성. **API 제한 = Places API (New) 하나**, 애플리케이션 제한 = 없음(Workers는 고정 IP가 없어 IP 제한을 걸면 막힌다). 콘솔 사용자 인증 정보에서 "키 표시"로 값을 볼 수 있다.
- 기존 `Maps Platform API Key`는 35개 API가 열려 있다. 이 앱은 쓰지 않으므로 사용자가 삭제하는 게 좋다(미조치).
- 예산 `etavia` 생성: 월 ₩10,000, 임계값 50·90·100%, 이메일 알림. **"기타 절감" 체크 해제** — 무료 크레딧이 사용량을 가리지 않고 총액 기준으로 알림이 뜬다.

**일일 상한은 아직 걸지 못했다.** 계정이 무료 체험판(₩414,984 크레딧·90일)이라 할당량 페이지의 "할당량 수정"이 비활성이다. 예산의 "지출 한도 적용"(미리보기)은 실제로 사용을 중지시키지만 대상이 Cloud Run·Cloud Run Functions·Gemini API·Vertex AI 4개뿐이라 Places에는 쓸 수 없다.

체험판 동안은 사용료가 크레딧에서 차감되고, 크레딧 소진·90일 경과 시 계정이 정지될 뿐 카드에 자동 청구되지 않는다. 위험은 유료 전환 이후에 생긴다.

> **유료 전환("업그레이드") 직후 반드시 할 것.** 콘솔 → Google Maps Platform → 할당량 → API를 Places API (New)로 선택 → 이름 필터 `SearchTextRequest per day` → 행 선택 → 할당량 수정 → **40**. 현재 기본값은 75,000/일이다. 이걸 걸기 전에는 앱 쪽 월 900회 카운터(§2.2)가 유일한 방어선이다.

### 네이버 클라우드

- 네이버 클라우드 플랫폼 계정 생성 → NAVER API HUB → 검색(블로그) 이용 신청. Classic/VPC 환경에서 쓴다.
- 발급되는 Client ID·Secret이 `NCP_API_KEY_ID`·`NCP_API_KEY`다.
- 현재 한시 무료. 유료 전환 공지가 뜨면 §2.1.1 4번에 따라 재검토한다.

### 카카오 (보조)

- 카카오 개발자센터 → 내 애플리케이션 → **다음 검색** 활성화. 로컬 검색과 같은 REST 키를 쓴다.
- 쿼터 수치는 공개돼 있지 않다. 무료이고 일·월 한도가 있다.

### Workers

```
npx wrangler secret put GOOGLE_PLACES_KEY
npx wrangler secret put NCP_API_KEY_ID
npx wrangler secret put NCP_API_KEY
npx wrangler secret put KAKAO_REST_KEY   # 보조 경로용
npx wrangler kv namespace create CACHE   # RATE와 별개
```

### 호출 수

계획 하나(업종 슬롯 3개, 후보 30개씩, 캐시 없음): 카카오 로컬 15회(변화 없음) · 블로그 90회 · 구글 30회 · `/enrich` 3회. 같은 동네를 다시 계획하면 구글은 0회.

개발 중에는 구글 무료분(월 1,000회)이 30번 남짓의 새 지역 계획으로 소진된다. 캐시 14일이 이걸 막는 유일한 장치이므로 KV 없이는 돌리지 않는다.

## 10. 미루는 것 (NEXT.md에 적는다)

- 지역 앵커: `stops[].area`를 추출 스키마에 넣고 회랑 검색 중심을 그 지역으로. 케이스 시트에 "강남 가는 길에 홍대 빵집" 류를 넣고 프롬프트 v4로.
- 체험단 필터: 블로그 제목·요약의 "체험단·협찬·제공받아" 글 제외.
- A2 되묻기: 업종 슬롯이고 후보 ≥ 15면 "정해둔 곳 있어요?" 한 번.
- 네이버 플레이스 평점: 공식 API 없음. 상황 바뀌면 구글 대신.
- 인스타그램·쓰레드: 공식 API로 상호별 언급 수를 셀 수 없다. 인스타 해시태그 검색은 7일 30개 태그 한도라 후보 30곳에 못 쓰고, 쓰레드 키워드 검색은 토픽 태그 기준 알고리즘 정렬이라 전수 집계가 안 된다. 상황이 바뀌면 `blog` 자리에 공급자만 더한다.
