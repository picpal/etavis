# 계획 흐름 재설계 — 플래너 타입 위에 화면을 다시 만든다

작성 2026-09-11. 결정 세 가지가 전제다.

| 결정 | 선택 |
|---|---|
| 범위 | 계획 흐름(A2 채팅·칩 → A3 계산 → A5 추천 → A4 교체)만. 확정 순간 기존 `StopState[]`로 변환해 A6·추적·알림·지도 핸드오프는 손대지 않는다 |
| 추천 화면 | **답 먼저**. 제시간 도착 여부가 맨 위, 3안 비교는 그 아래 |
| 상태 | 새 스토어 `src/state/planFlow.tsx`. A1 입력(출발·목적지·모드·마감)은 기존 스토어에 남긴다 |

관련: `docs/최적경로-설계.md`(알고리즘·못 찾았을 때 규칙), `src/lib/routePlan/`(플래너), `src/lib/corridorSearch.ts`.

## 왜 갈아엎나

기존 화면은 목 `Dataset`에 묶여 있다. 옵션은 `stopNames` 문자열을 이름 부분일치로 되찾고, 재계산은 목 `legs` 테이블을 본다. 어댑터로 플래너 결과를 그 형식에 욱여넣으면 돌아가긴 하지만, 실측/추정 구분·슬롯 status·조건 완화안처럼 **사용자가 만족할 정보가 형식에 없어 버려진다.** 화면을 플래너 타입 위에 새로 만들면 그 정보가 그대로 화면에 닿는다.

## 1. 상태 — `planFlow`

```ts
type Phase = 'idle' | 'direct' | 'searching' | 'measuring' | 'ready' | 'failed';

type PlanFlowState = {
  phase: Phase;
  /** A3 체크리스트. 단계마다 한 줄 */
  progress: { key: 'direct' | 'search' | 'measure' | 'select'; label: string; detail?: string; done: boolean }[];
  /** 계산을 시작한 입력의 스냅샷. 칩이 바뀌면 stale */
  request: PlanRequest | null;
  slots: Slot[];                       // 검색 결과 + searchStatus
  result: PlanResult | null;
  selectedOptionIdx: number;
  /** 안(案)별 매장 교체: optionIdx → slotId → candidateId */
  overrides: Record<number, Record<string, string>>;
  error: { kind: 'direct' | 'search' | 'measure' | 'timeout'; message: string } | null;
};

type PlanRequest = {
  origin: LatLng; destination: LatLng;
  originName: string; destinationName: string;
  mode: Mode; arriveByMin: number | null; departAtMin: number;
  stops: { id: string; query: string; count: number; flexible: boolean; openNow: boolean }[];  // 칩에서
  order: 'auto' | 'locked';
};
```

액션: `START(request)` · `PROGRESS(step, detail)` · `SLOTS(slots)` · `RESULT(result)` · `FAIL(error)` · `SELECT_OPTION(idx)` · `SET_OVERRIDE(idx, slotId, candId)` · `RESET`.

리듀서는 순수 함수, 파이프라인은 Provider의 `runPlan(request)`이 돌리며 액션을 순서대로 보낸다. 같은 `request`로 두 번 부르면 두 번째는 무시한다(진행 중 재진입 방지).

**입력의 출처.** `PlanRequest`는 A3 진입 시 기존 스토어(`usePlan`)에서 조립한다: 출발 좌표(GPS 또는 `originCoord`), 목적지 좌표, 모드, 마감, 칩(`chips` 중 `kind==='stop'`). 칩·마감·모드가 바뀌면 `request`가 stale이 되고, A5는 "조건이 바뀌었어요 · 다시 계산" 배너를 띄운다. 자동 재계산은 하지 않는다(호출 5~9회짜리 작업을 칩 하나 지울 때마다 돌리지 않는다).

## 2. 파이프라인 — `runPlan`

```
직행 실측 (provider.route, polyline)          → PROGRESS('direct')
슬롯별 회랑 검색 병렬 (searchAlong)             → SLOTS, PROGRESS('search', '올리브영 4곳 · 빵집 6곳')
plan(input, provider)                           → PROGRESS('measure', '실측 6회') → RESULT
```

- 공급자: `.env`에 `SERVER_URL`·`APP_TOKEN`이 있으면 `serverRouteProvider`, 없으면 `mockRouteProvider`. 장소 검색은 `planSearchFn()`(카카오 키 있으면 카카오, 없으면 목 카탈로그).
- 직행 폴리라인은 플래너가 다시 직행을 부르지 않게 `plan()`에 넘긴다 → `plan(input, provider, { direct })` 옵션 추가. 호출 1회 절약.
- 검색 반지름: `initialRadiusM(mode)`, `maxRadiusM(mode, slackMin, ρ)`. ρ는 직행에서.
- 타임아웃 12초. 넘기면 `FAIL('timeout')`. 개별 호출은 4초.
- 최소 표시 1.2초(A3가 깜빡이지 않게). 결과가 더 빠르면 기다린다.

## 3. 플래너에 더하는 것 (`src/lib/routePlan/`)

| 추가 | 왜 |
|---|---|
| `plan(..., { direct?: RouteResult })` | 파이프라인이 이미 실측한 직행을 재사용 |
| `PlanResult.rescore(visits: Visit[]): { totalMin; arrivals; distanceKm; estimated: boolean }` | A4에서 매장을 바꿀 때 그 안의 시간을 다시 낸다. 실측 leg가 있으면 실측, 없으면 추정 + `estimated` |
| `PlanResult.legTable: Record<string, { min: number; km: number; measured: boolean }>` | 확정 변환 시 기존 스토어의 `Dataset.legs`로. 키는 `'O>c1'`·`'c1>D'`. 선택된 후보 전부 × 출발·도착의 완전 표 |
| `PlanResult.measuredCount` | "실측 6회" 표시 |

`rescore`는 `ScoreContext`를 닫아 둔 클로저다. 결과 객체가 함수를 품는 게 어색하면 `PlanSession { result, rescore }`로 감싼다 — 구현 때 정한다.

## 4. 화면

### A2 채팅·칩 (수정)
- 칩에 status 접미. `far` "멀리 있음", `none` "못 찾음", `closed` "마감", `late` "늦음", `short` "2/3곳". 계산 전에는 status 없음.
- 칩 탭 → 작은 액션 시트: `빼기` / `다른 종류로`(입력창에 포커스) / `그대로`. `none`이면 `검색어 고치기`.
- 칩이 바뀌면 `planFlow.RESET`. "계산하기" CTA가 다시 활성.

### A3 계산 중 (교체)
- 진행 바는 실제 단계에 묶인다: 직행 → 검색(슬롯별 "○○ N곳") → 실측(N회) → 정리. 목 `calcSteps` 제거.
- `phase==='ready'`면 A5로, `failed`면 A8로. A8은 `다시 계산`(같은 request로 START)과 `직행으로 진행`(슬롯 없이 START).

### A5 추천 (교체) — 답 먼저
위에서 아래로:
1. **판정 카드**
   - 마감 있음·여유 ≥ 0: `들렀다 가도 8:52 도착` / `8분 여유` (초록)
   - 마감 있음·늦음: `지금 출발해도 6분 늦어요` (앰버) + 조건 완화 한 줄 `올리브영을 빼면 8:49 도착 · 11분 여유` → 탭하면 완화안 선택
   - 마감 없음: `직행보다 +14분 · 8:52 도착`
   - 부제: `검증한 안 중 최선 · 실측 6회`. "최적"이라 쓰지 않는다.
2. **경유지 행** — 1안 방문 순서대로 칩. 후보가 2곳 이상이면 `▾`, status가 있으면 접미. 탭 → A4.
3. **3안 카드** — 선택 카드 확장(총 소요·직행 대비·도착·구간 점선), 나머지 압축. 카드 제목은 규칙이 아니라 차이로: `가장 빠름`, `올리브영 대신 서여의도점`, `순서 바꿈`(겹침 분석에서 무엇이 다른지 뽑는다). 실측 안 된 값이 섞이면 `약` 접두.
4. **조건 완화 카드** — `late`일 때만, 3안과 시각적으로 분리(점선 테두리). 어느 경유지를 뺐는지 명시.
5. CTA `8:52 도착 경로로 계속` → 확정.
6. stale 배너 — 칩이 바뀌었으면 맨 위에 `조건이 바뀌었어요 · 다시 계산`.

### A4 후보 시트 (수정)
- props로 `candidates: Alternative[] + 현재`, `onPick`. 스토어를 직접 읽지 않는다 — A5(planFlow)와 A6(기존 스토어)가 같은 시트를 쓴다.
- 정렬 탭은 지금 그대로(추가시간·주차·거리). 추정치는 `약 +5분`에 점 표시. 마감·선택불가는 이미 빠진다.
- 고르면 `SET_OVERRIDE` → `rescore`로 그 안의 시간 즉시 갱신.

## 5. 확정 경계 — `toLegacyPlan()`

`src/state/planFlowBridge.ts` 순수 함수. 입력: `PlanFlowState` + 선택 안 + 오버라이드. 출력: 기존 스토어의 새 액션 `APPLY_LIVE` 페이로드.

```ts
type ApplyLivePayload = {
  stops: StopState[];       // name·coord·dwellMin·arriveAt·legMin·legKm·openState·openNote·tasks:[]·baseId=slotId
  dataset: Dataset;         // key:'live' — legs(legTable 변환), directMin, candidates(A6 매장 교체용), options, totals
  departMin: number;
};
```

- `Dataset.legs` 키는 `'origin>slotId'`·`'slotId>dest'`로 바꿔 넣는다. 기존 `computeChain`이 그대로 실측값을 쓴다.
- `candidates[slotId]`는 대안을 `Candidate` 형식으로(`addedMin`·`detourKm`·`parking`·`openState`·`disabled`). A6의 매장 교체가 계속 동작한다.
- `tasks`는 빈 배열. 할 일은 A9에서 추가한다. `dwellMin`은 슬롯 기본값(카테고리별 상수, 지금 목과 같은 값)에서 시작.
- 목 데이터셋 3종은 개발 메뉴에 남는다. `APPLY_LIVE` 이후 `SET_DATASET`을 누르면 목으로 돌아간다(개발용).

## 6. 실패와 fallback

| 상황 | 동작 |
|---|---|
| 서버 없음(.env 비어 있음) | 목 라우팅(haversine × 1.3). 화면은 `추정` 표시가 전부에 붙는다 |
| 직행 실패 | `FAIL('direct')` → A8. 재시도 |
| 검색 0건 슬롯 | `none` status. 계획은 나머지로. 설계 문서 "못 찾았을 때" 그대로 |
| 시드 일부 실패 | 플래너가 이미 허용. 실측 횟수만 준다 |
| 12초 초과 | `FAIL('timeout')` → A8 |
| 카카오 429 | 서버가 429 → 공급자 throw → 시드 실패로 흡수. 직행이면 A8 |

## 7. 테스트

- `planFlow` 리듀서: 전이 표(idle→direct→searching→measuring→ready / 어느 단계든 →failed / RESET), 재진입 무시, override 누적.
- `planFlowBridge.toLegacyPlan`: 실측 leg가 `Dataset.legs`에 그대로, 대안이 `Candidate`로, `arriveAt`이 HH:MM, 마감 후보 `disabled`.
- 플래너 추가분: `rescore`가 실측/추정을 구분, `legTable` 완전성((V+2)² 항목), `direct` 옵션이 호출 1회를 줄임.
- 화면: 시뮬레이터에서 목 라우팅 + 카카오 검색으로 A2→A5→A6까지 한 번. A8 경로는 `.env`의 서버 URL을 틀리게 해서.

## 8. 이번에 안 하는 것

- A6 타임라인·진행중 탭·추적·알림·지도 핸드오프 — 변환 경계 뒤. 이름 부분일치 같은 목 잔재는 남는다.
- 2라운드 결과의 백그라운드 갱신(A5 표시 후 승격). 1라운드+2라운드가 끝난 뒤에 A5로 간다. 3초 예산은 다음 작업.
- 대중교통·도보 실측. 추정만.
- 대화 이력 저장.

## 자체 검토

- 플레이스홀더 없음.
- 일관성: A4가 props를 받게 바뀌므로 A6의 `매장 교체` 호출부(`TimelineScreen`)도 props로 바꿔야 한다. 범위 밖 파일이지만 호출부 한 줄이라 포함한다.
- 범위: 계획 하나. 플래너 추가분(3절)은 먼저, 스토어·브리지(1·5절), 화면(4절) 순.
- 모호함: "카드 제목은 차이로"의 규칙은 구현 계획에서 정한다(후보 집합 차 → 브랜드/지점명, 순서 차 → "순서 바꿈", 둘 다 아니면 "N번째로 빠름").
