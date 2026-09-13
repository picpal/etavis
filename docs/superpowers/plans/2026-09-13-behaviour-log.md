# 행동 로그 구현 계획

**Goal:** 사용자가 앱에서 하는 행동을 전부 남겨, 나중에 로그만 보고 무슨 일이 있었는지
재구성하고 기능을 다듬을 수 있게 한다.

## 지금 상태 (2026-09-13 확인)

기록되는 6종(`fix`·`geofence`·`plan`·`mode`·`track`·`notify`)이 전부 `tracker.tsx`
한 곳에서만 나온다. **주행 중이 아니면 아무것도 안 남는다** — 오늘 시뮬레이터에서
계획을 처음부터 끝까지 만들었는데 `track-20260913.jsonl` 파일 자체가 안 생겼다.

`plan.tsx` 액션 30개, `planFlow.ts` 액션 8개 중 로그를 부르는 것은 0개다.

09-12 로그 39줄 중 `fix`+`geofence`가 30줄(77%)이다. 같은 좌표가 5초마다 반복된다.

## Global Constraints

- `npm test` · `npx tsc --noEmit -p .` · `npx tsc --noEmit -p server` 셋 다 통과.
- **`logTrack`은 절대 던지지 않는다.** 로그가 앱을 깨면 안 된다.
- **node 테스트가 닿는 모듈(`src/lib/**`, `src/state/runPlan.ts`)은 `trackLog`를 import 하지 않는다.**
  `trackLog`는 `expo-file-system`을 물고 있어 node 테스트에서 죽는다. 로그 호출은
  `.tsx`(공급자·화면) 층에서만 한다.
- 순수 판단(무엇을 로그로 남길지, 어떻게 줄일지)은 `src/lib/`에 두고 테스트한다.
- 로그는 기기 로컬 전용이다. 사용자가 개발 메뉴에서 직접 내보낼 때만 나간다.

---

### Task 1: 이벤트 타입 확장 — `act` · `net` · `runId`

**Files:** `src/lib/trackLogFormat.ts`, `src/lib/trackLogFormat.test.ts`

두 종류를 더한다.

```ts
/** 사용자 행동. a 는 'plan.start' 같은 점 표기, d 는 한 겹 상세 */
| { k: 'act'; a: string; d?: LogDetail }
/** 바깥 호출 한 번 */
| { k: 'net'; ep: string; ms: number; ok: boolean; d?: LogDetail }
```

`LogDetail = Record<string, string | number | boolean | null>` — 한 겹만. 중첩을 허용하면
줄이 길어져 읽기 어려워진다.

모든 줄에 `r`(runId)을 붙인다. 하루에 계획을 두 번 세우면 어느 줄이 어느 계획 소속인지
지금은 구분이 안 된다. `serialize(event, now, runId)` 로 받는다 — 모듈 전역을 순수 함수에
넣지 않는다.

- [ ] 실패 테스트: `act` 이벤트가 `{t, r, k, a, d}` 순서로 직렬화된다
- [ ] 실패 테스트: `runId` 가 null 이면 `r` 필드를 넣지 않는다(주행 전 이벤트)
- [ ] 실패 테스트: `net` 이벤트 직렬화
- [ ] 구현 · 커밋

---

### Task 2: 소음 줄이기 — `fix` · `geofence` 필터

**Files:** `src/lib/trackLogFormat.ts`, `src/lib/trackLogFormat.test.ts`

`fix` 는 5초/20m 간격이라 30분 주행이면 360줄이다. 판정이 안 바뀌는 줄이 대부분이다.

```ts
/** 마지막으로 남긴 fix 에서 이만큼 움직였거나 시간이 지나야 다시 남긴다 */
export const FIX_MIN_MOVE_M = 15;
export const FIX_MAX_GAP_MS = 30_000;
export function shouldLogFix(prev: FixMark | null, next: FixMark): boolean;

/** geofence 는 판정에 영향을 주는 것이 바뀔 때만. 그 외는 heartbeat 간격으로 */
export const GEOFENCE_MAX_GAP_MS = 30_000;
export function shouldLogGeofence(prev: GeofenceMark | null, next: GeofenceMark): boolean;
```

`geofence` 는 `events` 가 비어있지 않거나, `target`·`atStop` 이 바뀌었으면 무조건 남긴다
(판정이 일어난 순간이다). 아무것도 안 바뀌면 30초에 한 번만.

- [ ] 실패 테스트: 같은 자리에 서 있으면 fix 를 건너뛴다
- [ ] 실패 테스트: 15m 움직이면 남긴다
- [ ] 실패 테스트: 안 움직여도 30초가 지나면 남긴다(멈춰 있다는 사실도 정보다)
- [ ] 실패 테스트: `events` 가 있으면 geofence 를 무조건 남긴다
- [ ] 실패 테스트: `atStop` 이 바뀌면 남긴다
- [ ] 구현 · 커밋

---

### Task 3: 액션 → 로그 변환

**Files:** `src/state/actionLog.ts`(신규), `src/state/actionLog.test.ts`(신규)

리듀서 액션을 로그 한 줄로 옮기는 순수 함수. **여기가 누락을 구조적으로 막는 자리다** —
액션이 리듀서를 통과하면 반드시 이 함수를 지난다.

```ts
export function describePlanAction(a: PlanAction, before: PlanState): ActLog | null;
export function describeFlowAction(a: PlanFlowAction, before: PlanFlowState): ActLog | null;
```

id 만 남기지 않고 **이름을 같이 싣는다** — `before` 상태에서 찾는다. 지금 로그의
`{"k":"notify","id":"s-1"}` 은 어느 가게인지 알려면 위쪽 `plan` 줄과 대조해야 한다.

남길 것(`a` 이름):

| 액션 | `a` | `d` |
|---|---|---|
| SET_DESTINATION / SET_ORIGIN | `dest.set` / `origin.set` | name, hasCoord |
| SWAP_ENDPOINTS | `endpoints.swap` | — |
| SET_MODE / SET_ARRIVE_BY | `mode.set` / `arriveBy.set` | value |
| PUSH_CHAT | `chat.send` | text |
| APPLY_INTENT | `chat.extract` | stops, add, remove, offTopic, ask |
| REMOVE_CHIP | `chip.remove` | kind, label |
| SELECT_OPTION / APPLY_OPTION | `option.select` / `option.apply` | id |
| SET_OPTION_STORE | `cand.replace` | slot, from, to |
| REMOVE_LOCAL / REPLACE_LOCAL / REORDER_LOCAL | `stop.remove` / `stop.replace` / `stop.reorder` | name·from·to |
| APPLY_LIVE | `plan.apply` | stops, arriveAt |
| CONFIRM_PLAN | `plan.confirm` | stops |
| RECALC | `plan.recalc` | — |
| REPORT_STOP_CONGESTION | `congestion.report` | stop, level |
| TOGGLE/ADD/REMOVE/UPDATE_TASK | `task.*` | stop, taskId |
| ARRIVE_AT_STOP / DEPART_STOP / ARRIVE_AT_DESTINATION | `stop.arrive` / `stop.depart` / `dest.arrive` | name |
| SET_DATASET·SET_FAIL_NEXT·SET_DEV_* | `dev.*` | value |

flow 쪽:

| 액션 | `a` | `d` |
|---|---|---|
| START | `plan.start` | stops, mode, arriveBy, order |
| PROGRESS | `plan.step` | key, detail |
| SLOTS | `plan.slots` | 슬롯별 `query=N곳` |
| RESULT | `plan.result` | options, apiCalls, measured, totalMin |
| FAIL | `plan.fail` | kind, message |
| SET_OVERRIDE | `cand.override` | slot, to |
| RESET | `plan.reset` | — |

**채팅 원문을 남긴다.** 추출을 다듬으려면 사용자가 실제로 뭐라고 쳤는지가 제일 값지다.
기기 로컬 전용이고 사용자가 직접 내보낼 때만 나간다 — 파일 머리에 적는다.

- [ ] 실패 테스트: 후보 교체가 id 가 아니라 이름으로 남는다
- [ ] 실패 테스트: 추출 결과가 개수로 요약된다
- [ ] 실패 테스트: 모르는 액션은 null (로그를 안 남긴다)
- [ ] 실패 테스트: `d` 가 한 겹이다(중첩 객체가 안 들어간다)
- [ ] 구현 · 커밋

---

### Task 4: runId 와 dispatch 미들웨어

**Files:** `src/lib/trackLog.ts`, `src/state/planFlowProvider.tsx`, `src/state/plan.tsx`

`trackLog` 에 runId 를 둔다. 순수 함수가 아니라 파일 I/O 쪽이니 여기가 맞다.

```ts
/** 계획 한 번에 하나. 이후 모든 줄에 r 로 붙는다 */
export function newRunId(): string;
export function currentRunId(): string | null;
```

리듀서는 순수해야 한다(React StrictMode 가 개발 중 두 번 부른다 — 리듀서 안에서 로그를
부르면 줄이 두 배가 된다). **dispatch 를 감싼다.**

```ts
const [state, raw] = useReducer(...);
const stateRef = useRef(state); stateRef.current = state;
const dispatch = useCallback((a: Action) => {
  const log = describeXAction(a, stateRef.current);
  if (log) logTrack({ k: 'act', a: log.a, d: log.d });
  raw(a);
}, []);
```

`planFlowProvider` 의 `dispatch` 는 `runPlan` 에도 넘어가므로 계획 생명주기가 전부 잡힌다.
`START` 에서 `newRunId()` 를 부른다.

- [ ] `trackLog` 에 runId · 실패 테스트(같은 호출이 다른 id)
- [ ] 두 공급자에 미들웨어 배선
- [ ] 커밋

---

### Task 5: 바깥 호출 계측 (`net`)

**Files:** `src/state/planFlowProvider.tsx`

`serverProvider`·`enrichClient` 는 node 테스트가 닿으므로 그 안에서 로그를 부르면 안 된다.
`pickProvider()` 가 돌려주는 함수를 **감싸서** 시간을 잰다 — 이 파일은 테스트가 안 닿는다.

```ts
const timed = (ep: string, fn) => async (...args) => {
  const t0 = Date.now();
  try { const r = await fn(...args); logTrack({k:'net', ep, ms: Date.now()-t0, ok: true, d: {...}}); return r; }
  catch (e) { logTrack({k:'net', ep, ms: Date.now()-t0, ok: false, d:{err:String(e).slice(0,120)}}); throw e; }
};
```

`/enrich` 는 신호가 몇 개 붙었는지도 남긴다(`places`, `signals`) — 보강이 왜 비었는지
로그만 보고 알 수 있어야 한다. 오늘 그걸 몰라서 6시간을 썼다.

- [ ] 라우팅·보강 호출 계측
- [ ] 커밋

---

### Task 6: tracker 소음 필터 적용 · 타임라인 스크립트 · 실기 확인

**Files:** `src/state/tracker.tsx`, `scripts/tracklog-timeline.mjs`

- [ ] Task 2 의 필터를 `tracker.tsx` 의 `fix`·`geofence` 호출에 적용
- [ ] 타임라인 스크립트가 `act`·`net` 을 렌더하고, `events` 없는 row 에서 안 죽게 고친다
      (기존 미수정 항목)
- [ ] `npm test` · 타입 검사 양쪽
- [ ] 시뮬레이터에서 계획을 처음부터 끝까지 만들고 `track-YYYYMMDD.jsonl` 을 꺼내,
      **로그만 보고 무슨 일이 있었는지 재구성되는지** 확인한다
- [ ] `NEXT.md` 의 '앱 사용 로그 확인' 항목을 결과로 갱신
