# 내 장소 묶음 — 최근 목적지 실적재 · 저장한 장소 · 시트 키보드 밀착

작성 2026-09-17. 목적지를 고르는 자리(A1 `DestinationSheet`)가 목 데이터 위에 서 있는 것을
걷어내고, 사용자가 실제로 간 곳과 미리 등록해 둔 곳으로 바꾼다.

## 왜

지금 `어디로 갈까요?` 시트의 '최근 목적지'는 `mockData.ts:474`의 하드코딩 세 줄이다.
회사·집·오크밸리 숙소가 누구 기기에서나 똑같이 뜨고, 내가 어제 간 곳은 어디에도 없다.

거기에 세 가지가 더 얹혀 있다.

1. **빈 상태가 없다.** `recents.length > 0` 조건이라 목록이 비면 그 자리에 아무것도 안
   그려진다. 목 데이터를 걷어내는 순간 첫 실행은 검색창과 푸터 한 줄만 남는다.
2. **자주 가는 곳을 등록할 길이 없다.** 집에 가려고 매번 "여의도 자이"를 검색한다.
3. **키보드가 올라오면 시트 하단이 어색하다.** `Sheet.tsx`가 `bottom: kbHeight`로 키보드
   바로 위에 붙이는데, 시트 하단은 직각이고 iOS 26 키보드 상단은 둥글다. 두 모서리
   사이로 딤이 비쳐 삼각 틈이 생긴다. 붙지도 떨어지지도 않은 모양이다.

## 범위

**한다**

- 저장 계층 `src/lib/placesFormat.ts`(순수) + `src/lib/placesStore.ts`(I/O) 신설
- 최근 목적지를 **계획을 계산한 시점**에 실제로 적재
- 최근이 비었을 때 내 장소 등록으로 잇는 빈 상태
- 내 장소: 집·회사 고정 슬롯 + 자유 목록. 더보기에 화면, 시트에 선택 진입점
- `Sheet.tsx` 키보드 밀착 정리
- 채팅 추출의 `knownPlaces`를 실제 장소로 교체
- `DestinationSheet`에서 검색 로직을 `PlaceSearch`로 떼어낸다(내 장소 추가에서 같이 쓴다)

**안 한다**

- 라우팅·계산 파이프라인, 목 데이터셋, `server/`, 채팅 추출 프롬프트·스키마
- 내 장소 드래그 정렬, 폴더/태그, 클라우드 동기화
- 출발지 쪽 별도 최근 목록 — 목적지 목록을 같이 쓴다

## 1. 저장 계층

`prefs.json`을 늘리지 않는다. `setPref`는 `cache[key] === value` 참조 비교라 배열이면
**매 호출마다 파일을 쓴다**. `READERS`도 스칼라 전제다. 더 큰 이유는 수명이 다르다는
것 — 설정 파일 하나가 깨졌다고 내가 등록해 둔 장소까지 같이 날아가면 안 된다.

`prefs`/`prefsFormat`, `trackLog`/`trackLogFormat`이 쓰는 **순수 포맷 + I/O 분리**를 그대로
따른다. 갈래를 나누는 이유도 같다: `expo-file-system`을 물면 node 테스트가 못 읽는다.

### `src/lib/placesFormat.ts` — 순수

```ts
export type SavedPlace = {
  id: string;
  /** 고정 슬롯 둘. 각각 최대 하나 */
  slot: 'home' | 'work' | null;
  /** 사용자가 붙인 이름. 슬롯이 있으면 기본값 '집'·'회사' */
  label: string;
  /** 검색으로 고른 상호·지명 */
  name: string;
  address: string;
  coord: LatLng;
  createdAt: number;
};

export type RecentPlace = { name: string; address: string; coord: LatLng; usedAt: number };

export type PlacesFile = { saved: SavedPlace[]; recents: RecentPlace[] };

export const EMPTY_PLACES: PlacesFile = { saved: [], recents: [] };
export const RECENT_MAX = 10;
/** 이 거리 안이면 같은 곳으로 본다 */
export const SAME_PLACE_M = 50;

export function parsePlaces(text: string | null | undefined): PlacesFile;
export function serializePlaces(file: PlacesFile): string;
export function upsertRecent(file: PlacesFile, entry: Omit<RecentPlace, 'usedAt'>, at: number): PlacesFile;
export function upsertSaved(file: PlacesFile, place: SavedPlace): PlacesFile;
export function removeSaved(file: PlacesFile, id: string): PlacesFile;
/** 최근 목록에 북마크 배지를 달기 위해 — 좌표로 저장 여부를 본다 */
export function savedAt(file: PlacesFile, coord: LatLng): SavedPlace | undefined;
/** 채팅 추출에 넘길 이름들. label·name 둘 다, 중복 없이 */
export function knownPlaces(file: PlacesFile): { name: string; coord: LatLng }[];
```

규칙:

| 함수 | 규칙 |
|---|---|
| `parsePlaces` | JSON 자체가 깨지면 `EMPTY_PLACES`. 파싱은 됐는데 **원소 하나가 모양이 틀리면 그 원소만 버린다** — 한 줄 깨졌다고 등록해 둔 장소를 다 날리면 안 된다 |
| `upsertRecent` | `haversineM ≤ SAME_PLACE_M`인 기존 항목을 지우고 새 항목을 맨 앞에. 이름·주소는 최신 것으로 갱신된다. `usedAt` 내림차순, 상한 `RECENT_MAX` 초과분 절단 |
| `upsertSaved` | 같은 `id`면 교체. `slot`이 `'home'`·`'work'`면 같은 슬롯을 쥔 다른 항목의 `slot`을 `null`로 내린다 — **집이 둘이 될 수 없다**. 정렬은 home → work → `createdAt` 오름차순 |
| `savedAt` | `SAME_PLACE_M` 기준. 없으면 `undefined` |
| `knownPlaces` | 저장한 장소는 `label`과 `name`이 **각각 한 항목**(둘 다 좌표는 같다) — "집"으로도 "여의도 자이"로도 말이 통해야 한다. 여기에 `recents`의 `name`을 더하고, 같은 문자열은 한 번만 남긴다 |

거리 계산은 `src/lib/geo.ts`의 `haversineM`을 쓴다. 순수 모듈이라 node에서 그대로 읽힌다.

### `src/lib/placesStore.ts` — I/O

문서 폴더의 `places.json` 한 파일. `prefs.ts`와 같은 약속이다: **읽기는 모듈이 처음 읽힐
때 동기로 한 번**, 쓰기는 바뀔 때만, 그리고 **절대 던지지 않는다**.

```ts
export function placesSnapshot(): PlacesFile;
export function subscribePlaces(fn: () => void): () => void;
export function recordRecent(entry: Omit<RecentPlace, 'usedAt'>): void;
export function savePlace(place: SavedPlace): void;
export function removePlace(id: string): void;
export function knownPlacesSnapshot(): { name: string; coord: LatLng }[];
```

- 쓰기가 실패해도 캐시는 갱신한다 — 이번 실행은 살아야 한다(`prefs.ts`와 같다)
- `placesSnapshot()`은 **바뀔 때만 새 객체**를 돌려준다. 렌더마다 새 객체를 주면
  `useSyncExternalStore`가 무한 렌더에 빠진다
- 리듀서(`plan.tsx`)가 동기로 읽어야 해서 훅이 아니라 모듈 getter가 기본이다

### `src/lib/usePlaces.ts`

```ts
export function usePlaces(): PlacesFile;   // useSyncExternalStore(subscribePlaces, placesSnapshot)
```

React 19.2라 `useSyncExternalStore`를 그대로 쓴다. 저장하면 열려 있는 시트·화면이 같이 바뀐다.

## 2. 최근 목적지 적재

### 어디서

`CalculatingScreen`의 `start(request)` 옆, 같은 effect에서 한 번.

여기인 이유: `request`가 생겨야 좌표가 확정되고, 이 화면이 **계산이 실제로 시작되는 유일한
지점**이다. 시트에서 눌렀다가 취소한 목적지는 남지 않는다.

```ts
if (request && !startedRef.current) {
  startedRef.current = true;
  if (state.destinationName && state.destinationCoord) {
    recordRecent({
      name: state.destinationName,
      address: state.destinationAddress ?? '',
      coord: state.destinationCoord,
    });
  }
  start(request);
}
```

`state.destinationName`이 없으면 기록하지 않는다 — 그건 데이터셋 기본 목적지고 사용자가
고른 곳이 아니다. 좌표가 없는 목적지도 기록하지 않는다(이 앱의 기존 규칙과 같다).

### 주소를 들고 다니기

지금 `setDestination(name, coord)`은 주소를 버린다. 최근 목록의 둘째 줄이 주소이므로
`plan.tsx`에 주소 칸을 낸다. 역지오코딩을 새로 부르지 않는다 — 시트에서 고를 때 이미 안다.

| 대상 | 변경 |
|---|---|
| `PlanState` | `destinationAddress: string \| null`, `originAddress: string \| null` 추가 (초깃값 `null`) |
| `SET_DESTINATION` / `SET_ORIGIN` | `address: string \| null` 인자 추가 |
| `setDestination` / `setOrigin` | 세 번째 인자 `address?: string \| null` |
| `SWAP_ENDPOINTS` | 이름·좌표와 함께 주소도 교환. '내 위치'에서 굳힐 때는 `null` |

주소가 빈 문자열인 최근 항목은 목록에서 주소 줄을 비운다(레이아웃은 유지).

### 목 데이터 정리

`mockData.ts`의 `RECENT_DESTINATIONS`와 `RecentDestination` 타입은 마지막에 **지운다**.
지금 참조는 `DestinationSheet`·`plan.tsx`·`PlanScreen` 셋뿐이고 셋 다 이 작업에서 실제
저장소로 바뀐다. 다만 목록의 출처가 바뀌는 건 2단계(`DestinationSheet`)이고 `plan.tsx`·
`PlanScreen`의 `knownPlaces`가 바뀌는 건 5단계라, **상수 제거는 마지막 참조가 사라지는
5단계에서 한다**. 좌표 상수 `HOME`·`OFFICE`·`OAKVALLEY`는 데이터셋이 쓰므로 그대로 둔다.

첫 실행은 빈 목록이다. 시드를 넣지 않는다 — 가 본 적 없는 곳이 '최근'에 있으면 거짓말이다.

## 3. `어디로 갈까요?` 시트

### 내 장소 진입점

타이틀 줄 우측 여백에 아웃라인 칩 `🔖 내 장소`. 출발지 시트에도 같이 둔다 — 집에서
출발하는 경우가 목적지만큼 흔하다.

**시트 위에 시트를 겹치지 않는다.** 딤이 두 겹으로 어두워지고, 드래그-닫기가 어느 시트를
닫는지 모호해진다. 대신 같은 시트 안에서 내용만 바꾼다.

```
view: 'search' | 'saved'   (시트 로컬 상태, 닫으면 'search'로 복귀)
```

`saved` 뷰: 헤더가 `← 내 장소`로 바뀌고 키보드는 내려간다. 집·회사가 맨 위, 그 아래
등록한 장소 목록. 고르면 `search` 뷰와 똑같이 `finish(name, coord, address)`로 끝난다.

저장한 장소가 하나도 없으면 `saved` 뷰는 빈 상태 + `장소 추가` 버튼 → 시트를 닫고
`MyPlaces` 화면으로 간다.

### 최근이 비었을 때

| 조건 | 화면 |
|---|---|
| 집·회사 중 등록 안 된 게 있다 | 안내 문구 + `집 등록` / `회사 등록` 버튼. 누르면 시트를 닫고 `MyPlaces`로 이동(슬롯 프리셋) |
| 둘 다 등록돼 있다 | `내 장소에서 고르기` 한 줄 → `saved` 뷰로 전환 |

문구: "자주 가는 곳을 등록해 두면 여기서 바로 고를 수 있어요"

### 그 밖

- 최근 항목 중 저장해 둔 곳과 좌표가 겹치면 작은 북마크 배지. **숨기지 않는다** —
  방금 다녀온 곳이 목록에서 사라지면 그게 더 이상하다
- 출발지 시트의 라벨 '자주 쓰는 곳'은 실제로 최근 목적지였다. '최근에 쓴 곳'으로 통일한다

## 4. 더보기 → 내 장소

### 진입

`RootStackParamList`에 `MyPlaces: { addSlot?: 'home' | 'work' } | undefined` 추가.
`TabBar`의 `MORE_ITEMS`에 `내 프로필` 아래, `이동 기록` 위로 끼운다.

```ts
{ key: 'places', target: 'MyPlaces', label: '내 장소', note: '집 · 회사 · 자주 가는 곳', icon: 'bookmark' }
```

`TabBar`의 `activeKey` 계산에 `MyPlaces`를 `'more'`로 넣는다. `MyPlaces`는 탭 페이지가
아니므로 `isTabRoute`에는 넣지 않는다(`Settings`와 같은 취급).

### 화면

```
내 장소                                   (NavHeader, 뒤로)
─────────────────────────────────────
 [집]    여의도 자이 · 서울 영등포구       >
 [회사]  + 등록하기                    (점선 테두리)
─────────────────────────────────────
 등록한 장소
 [🔖]   단골 미용실 · 서울 양천구 목동     >
 [🔖]   장모님 댁 · 경기 성남시            >

                        [ + 장소 추가 ]   ← 하단 고정
```

- 집·회사는 비어 있어도 자리를 지킨다. 점선 카드가 "여기 등록하라"는 표시다
- 항목을 누르면 편집 시트. 하단 고정 버튼은 추가 시트
- `addSlot` 파라미터를 받고 들어오면 그 슬롯의 추가 시트를 바로 연다

### 편집 시트 `MyPlaceEditSheet`

| 칸 | 동작 |
|---|---|
| 별칭 | `TextInput`. 비우고 저장하면 고른 장소의 이름을 그대로 쓴다 |
| 장소 | 누르면 `PlaceSearch`로 전환해 다시 고른다. 좌표 없는 결과는 못 고른다 |
| 슬롯 | 추가 시 `집`·`회사`·`직접 입력` 중 선택. 이미 쥔 슬롯을 고르면 "기존 집은 일반 장소로 바뀌어요" 한 줄을 띄운다 |
| 저장 | `savePlace()` |
| 삭제 | 같은 시트 안에서 `정말 지울까요? [취소] [삭제]`로 바뀐다. 네이티브 Alert를 쓰지 않는다 — 앱 톤에서 튄다 |

드래그 정렬은 넣지 않는다. 집·회사가 맨 위로 고정돼 있어 목록이 길어질 일이 잘 없다.

## 5. `PlaceSearch` 추출

`DestinationSheet`가 검색 로직과 화면을 한 파일에 쥐고 있어 내 장소 추가에서 재사용이
안 된다. 이 작업에서 필요한 만큼만 떼어낸다.

`src/components/PlaceSearch.tsx`

```tsx
export function PlaceSearch({
  autoFocus,
  maxHeight,
  onPick,         // (name, coord, address) => void
  onStatusChange, // ({ searching, failed }) => void — 푸터 문구는 부모가 쓴다
}: Props)
```

| 담는 것 | 안 담는 것 |
|---|---|
| 250ms 디바운스 | 최근·내 장소 목록 |
| `reqId` 경합 가드 (늦게 끝난 요청이 최신 결과를 덮지 않게) | `plan` 스토어 연결 |
| `getProvider().search()` 호출 | 시트 레이아웃·푸터 |
| 결과 리스트 렌더 + 거리 표기 | |
| '조회된 결과가 없습니다' / '찾는 중이에요' | |

`DestinationSheet`는 `PlaceSearch` + 최근/내 장소 + `plan` 연결만 남는다.

## 6. 키보드 밀착

`Sheet.tsx` 한 곳이다. 키보드가 올라와 있을 때만:

```ts
const KB_GAP = 8;
// bottom: kbHeight > 0 ? kbHeight + KB_GAP : 0
// borderBottomLeftRadius / borderBottomRightRadius: kbHeight > 0 ? radius.sheet : 0
// maxH = screenH - insets.top - 40 - kbHeight - (kbHeight > 0 ? KB_GAP : 0)
```

좌우 인셋은 주지 않는다. 폭이 바뀌면 안에서 리플로우가 나고, 키보드가 오르내릴 때마다
결과 목록이 다시 흐른다.

`borderRadius`는 `LayoutAnimation` 대상이 아니라 즉시 바뀐다. 키보드가 올라오는 순간이라
눈에 띄지 않는다 — 여기서 Reanimated를 더 물지 않는다.

`Sheet`를 쓰는 모든 시트에 같이 적용된다(`TaskSheet`·`ArriveBySheet` 등). 의도한 것이다.

## 7. 채팅 추출 연결

등록해 둔 "집"이 채팅에서도 통해야 한다.

| 자리 | 지금 | 바뀜 |
|---|---|---|
| `PlanScreen.tsx:350` | `RECENT_DESTINATIONS.map(r => r.name)` | `knownPlacesSnapshot().map(p => p.name)` |
| `plan.tsx:664` `APPLY_INTENT` | `const known = RECENT_DESTINATIONS` | `const known = knownPlacesSnapshot()` |

`plan.tsx`는 리듀서지만 모듈 전역 캐시를 동기로 읽는 건 `prefs.getPref`와 같은 패턴이다.
`plan.test.ts`는 이미 `expo-file-system`을 스텁으로 끼워 두었고, 스텁에서는 `File.exists`가
`undefined`라 `placesStore`가 `EMPTY_PLACES`로 선다 — 테스트가 깨지지 않는다.

**LLM이 좌표를 짓게 하지 않는다.** `knownPlaces`는 이름만 넘기고, 목적지 교체는 지금처럼
좌표를 아는 곳에 매칭됐을 때만 적용한다(`AGENTS.md`의 "LLM은 '무엇을'만 뽑는다").

## 8. 새 아이콘

`primitives.tsx`에 북마크가 없다. `BookmarkIcon({ size, tint, filled })` 하나를 추가한다.
`HeartIcon`이 `filled` 인자를 받는 모양을 그대로 따른다.

## 9. 테스트

`src/lib/placesFormat.test.ts` — `npm test`(tsx node:test)로 돈다.

| 케이스 | 기대 |
|---|---|
| `parsePlaces(null)` / `''` / `'{'` / `'[]'` | `EMPTY_PLACES` |
| 원소 하나에 좌표가 없다 | 그 원소만 버리고 나머지는 남는다 |
| `upsertRecent` 새 항목 | 맨 앞, `usedAt` 내림차순 |
| 49m 떨어진 같은 곳 | 길이 그대로, 이름·주소가 최신 것으로 |
| 51m 떨어진 곳 | 별개 항목 (길이 +1) |
| 11번째 추가 | 길이 10, 가장 오래된 것이 빠진다 |
| `upsertSaved` 같은 `id` | 교체(길이 그대로) |
| 집이 이미 있는데 다른 곳을 집으로 | 기존 집의 `slot`이 `null`로, 집은 하나 |
| 정렬 | home → work → `createdAt` 오름차순 |
| `removeSaved` | 해당 항목만 사라진다 |
| `knownPlaces` | `label`·`name` 둘 다, 중복은 한 번 |

시뮬레이터 확인(메모리 규칙 — UI 변경은 화면을 보고 점검한다):

- 장소 0개 / 1개 / 10개(최대) — 목록이 넘칠 때 스크롤
- 긴 한글 이름·주소의 말줄임
- 한글 입력 중 키보드가 올라온 상태에서 시트 하단 모서리
- 집·회사가 없을 때 / 있을 때 빈 상태 두 갈래

## 10. 단계

메모리 규칙(기능은 한 단계에 하나씩, 상용화 수준까지 만들고 검증한 뒤 다음)대로 나눈다.

| # | 내용 | 검증 |
|---|---|---|
| 1 | `placesFormat` + `placesStore` + `usePlaces`. 화면 변화 없음 | `npm test` |
| 2 | 주소 칸(`plan.tsx`) + 계산 시점 적재 + 최근 목록 실데이터 + 빈 상태 | 시뮬레이터 |
| 3 | `PlaceSearch` 추출 + `MyPlaces` 화면 + 더보기 진입 + 편집 시트 | 시뮬레이터 |
| 4 | 시트의 `내 장소` 칩 + `saved` 뷰 + 저장 배지 | 시뮬레이터 |
| 5 | `Sheet` 키보드 밀착 + `knownPlaces` 교체 + `RECENT_DESTINATIONS` 제거 | 시뮬레이터 + `npm test` |

2단계의 빈 상태 버튼(`집 등록`)은 3단계에서 `MyPlaces` 라우트가 생길 때 연결한다.
그때까지는 문구만 보여준다.
