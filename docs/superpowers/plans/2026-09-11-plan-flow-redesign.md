# Plan Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계획 흐름(A2 칩 → A3 계산 → A5 추천 → A4 교체)을 플래너 타입 위에 새로 만들고, 확정 순간 기존 스토어로 변환한다.

**Architecture:** 새 스토어 `planFlow`(순수 리듀서 + Provider의 `runPlan` 파이프라인)가 검색·계산·선택·교체를 담는다. 화면 A3·A5·A4는 `usePlanFlow()`를 읽는다. 확정 시 `toLegacyPlan()`이 `StopState[]`와 `key:'live'` Dataset을 만들어 기존 `plan.tsx`의 `APPLY_LIVE`로 넘긴다. A6 이후는 그대로.

**Tech Stack:** React Native(Expo 57), TypeScript strict, `tsx --test`. 기존 컴포넌트(`Card`·`PrimaryButton`·`Sheet`·`NavHeader`·`TabBar`·`SegmentControl`·`MicroLabelRow`)와 토큰(`color`·`type`)만 쓴다.

**Spec:** `docs/superpowers/specs/2026-09-11-plan-flow-redesign-design.md`

## Global Constraints

- 시간은 분, 하루 기준 분(0~1439)은 `Min` 접미. 화면 표기는 `toHHMM(min).padStart(5,'0')`.
- "최적"이라 쓰지 않는다. "검증한 안 중 최선".
- 추정치는 `약` 접두 또는 `estimated` 플래그로 드러낸다. 실측과 섞어서 숨기지 않는다.
- 자동 재계산 금지. 칩이 바뀌면 `RESET` + 배너.
- A6·추적·알림·지도 핸드오프(`TimelineScreen`·`TabStubScreens`·`tracker.tsx`·`mapLinks.ts`)는 A4 호출부 한 줄 외에 건드리지 않는다.
- 테스트: `npm test`. 커밋 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 새 파일은 상단 주석으로 "왜"를 적는다(저장소 관행).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/routePlan/plan.ts` (수정) | `direct` 옵션, `rescore`, `legTable`, `measuredCount` |
| `src/lib/routePlan/types.ts` (수정) | `PlanResult`에 위 세 필드 |
| `src/state/planFlow.ts` | 타입·초기값·순수 리듀서·`requestKey` |
| `src/state/runPlan.ts` | 파이프라인. 의존(provider·search·dispatch·now)을 주입받아 테스트 가능 |
| `src/state/planFlowProvider.tsx` | Context. 공급자 선택(.env), `usePlanFlow()` |
| `src/state/planFlowBridge.ts` | `effectiveVisits`, `optionTitle`, `alternativeToCandidate`, `toLegacyPlan` |
| `src/state/plan.tsx` (수정) | `APPLY_LIVE` 액션과 `applyLive()` |
| `src/sheets/CandidateSheet.tsx` (교체) | props 기반. 스토어를 읽지 않는다 |
| `src/screens/CalculatingScreen.tsx` (교체) | 실제 단계 진행 |
| `src/screens/OptionsScreen.tsx` (교체) | 답 먼저 |
| `src/screens/PlanScreen.tsx` (수정) | 칩 status·액션 시트·RESET |
| `src/screens/ErrorScreen.tsx` (수정) | 재시도·직행 진행 |
| `src/screens/TimelineScreen.tsx` (수정, 한 곳) | 새 CandidateSheet props |
| `App.tsx` (수정) | `PlanFlowProvider` |

---

### Task 1: 플래너 추가분 — direct 재사용, rescore, legTable, measuredCount

**Files:**
- Modify: `src/lib/routePlan/types.ts`
- Modify: `src/lib/routePlan/plan.ts`
- Test: `src/lib/routePlan/plan.test.ts` (추가)

**Interfaces:**
- Produces:
  - `plan(input, provider, opts?: { R?; beamWidth?; direct?: RouteResult })`
  - `PlanResult.rescore(visits: Visit[]): Rescored` with `type Rescored = { totalMin: number; arrivals: number[]; distanceKm: number; estimated: boolean }`
  - `PlanResult.legTable: Record<string, { min: number; km: number; measured: boolean }>` — 키 `'O>c1'`, `'c1>D'`
  - `PlanResult.measuredCount: number` — 성공한 라우팅 호출 수(직행 포함)

- [ ] **Step 1: 실패하는 테스트 추가** (`plan.test.ts` 끝에)

```ts
test('direct 옵션 — 직행을 다시 부르지 않는다', async () => {
  const p = mockRouteProvider();
  const direct = await p.route([O, D], 480, 'car');
  const r = await plan(base([slot('a', [on])]), p, { direct });
  assert.equal(r.apiCalls, 1); // 후보 1개 실측만
  assert.equal(r.directMin, direct.durationMin);
  assert.equal(r.measuredCount, 2); // 직행 + 1
});

test('rescore — 실측 leg면 estimated=false, 없으면 true', async () => {
  const r = await plan(base([slot('a', [on, near])]), mockRouteProvider());
  const best = r.options[0].visits;
  const same = r.rescore(best);
  assert.equal(same.estimated, false);
  assert.ok(Math.abs(same.totalMin - r.options[0].totalMin) < 1e-9);
  const unknown = r.rescore([{ ...best[0], candidate: far }]);
  assert.equal(unknown.estimated, true);
  assert.equal(unknown.arrivals.length, 2);
});

test('legTable — 선택 후보 × 양끝의 완전 표, 실측 여부 표시', async () => {
  const b1 = c('b1', at(37.5, 127.09));
  const r = await plan(base([slot('a', [on, near]), slot('b', [b1])]), mockRouteProvider(), { R: 4 });
  const ids = new Set<string>();
  for (const o of r.options) for (const v of o.visits) ids.add(v.candidate.id);
  const nodes = ['O', ...ids, 'D'];
  for (const a of nodes) for (const b of nodes) {
    if (a === b || a === 'D' || b === 'O') continue;
    assert.ok(r.legTable[`${a}>${b}`], `missing ${a}>${b}`);
  }
  assert.equal(r.legTable['O>on'].measured, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/plan.test.ts`
Expected: 3 fail (`direct` 무시로 apiCalls 2, `rescore is not a function`, `legTable` undefined)

- [ ] **Step 3: types.ts에 필드 추가**

`PlanResult` 끝에:

```ts
  /** 실측 leg가 있으면 실측, 없으면 추정으로 임의 방문 순서를 다시 채점한다(교체 시트용) */
  rescore: (visits: Visit[]) => Rescored;
  /** 선택된 후보 전부 × 출발·도착의 leg 표. 키 'O>c1' · 'c1>D'. 확정 변환이 쓴다 */
  legTable: Record<string, { min: number; km: number; measured: boolean }>;
  /** 성공한 라우팅 호출 수(직행 포함). "실측 6회" */
  measuredCount: number;
```

그리고 `PlanResult` 위에:

```ts
export type Rescored = { totalMin: number; arrivals: number[]; distanceKm: number; estimated: boolean };
```

- [ ] **Step 4: plan.ts 수정**

시그니처와 직행:

```ts
export async function plan(
  input: PlanInput,
  provider: RouteProvider,
  opts: { R?: number; beamWidth?: number; direct?: RouteResult } = {},
): Promise<PlanResult> {
  ...
  // 0. 직행 — 파이프라인이 이미 실측했으면 재사용
  const direct = opts.direct ?? (await call([]));
```

`return` 직전에:

```ts
  const rescore = (visits: Visit[]): Rescored => {
    const s = scorePlan(visits, ctx);
    return { totalMin: s.totalMin, arrivals: s.arrivals, distanceKm: s.distanceKm, estimated: s.unknownLegs > 0 };
  };

  // leg 표 — 옵션·완화안에 등장한 후보 전부 × 양끝
  const nodeIds = new Set<string>();
  const nodeCoord = new Map<string, LatLng>([[ORIGIN_ID, input.origin], [DEST_ID, input.destination]]);
  const nodeCp = new Map<string, CorridorPoint>([[ORIGIN_ID, originPoint()], [DEST_ID, destinationPoint(L)]]);
  for (const o of [...chosen, ...(relaxed ? [relaxed] : [])]) {
    for (const v of o.visits) {
      nodeIds.add(v.candidate.id);
      nodeCoord.set(v.candidate.id, v.candidate.coord);
      nodeCp.set(v.candidate.id, corridor.get(v.candidate.id)!);
    }
  }
  const nodes = [ORIGIN_ID, ...nodeIds, DEST_ID];
  const legTable: PlanResult['legTable'] = {};
  for (const a of nodes) for (const b of nodes) {
    if (a === b || a === DEST_ID || b === ORIGIN_ID) continue;
    const hit = legs.lookup(a, b, input.mode, input.departAtMin);
    if (hit) legTable[`${a}>${b}`] = { min: hit.durationMin, km: hit.distanceKm, measured: true };
    else {
      const km = estimateLegKm(nodeCoord.get(a)!, nodeCoord.get(b)!, nodeCp.get(a)!, nodeCp.get(b)!);
      legTable[`${a}>${b}`] = { min: km * ctx.rhoMinPerKm, km, measured: false };
    }
  }

  return { directMin, directKm, options, relaxed, alternatives, slotStatus, apiCalls, rescore, legTable, measuredCount: measured.length + 1 };
```

import에 `estimateLegKm`(score.ts), `Rescored`·`LatLng`(types) 추가. `relaxed`가 `Scored`가 아니라 `PlanOption`이므로 `o.visits`만 쓰면 된다.

`measured.length + 1`: 직행은 항상 성공(실패면 throw). 시드 실패는 `measured`에 안 들어간다.

- [ ] **Step 5: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/plan.test.ts && npx tsc --noEmit -p .`
Expected: 14 pass, tsc 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/routePlan/types.ts src/lib/routePlan/plan.ts src/lib/routePlan/plan.test.ts
git commit -m "플래너 — direct 재사용, rescore, legTable, measuredCount

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: planFlow 리듀서

**Files:**
- Create: `src/state/planFlow.ts`
- Test: `src/state/planFlow.test.ts`

**Interfaces:**
- Produces:
  - `type Phase`, `type PlanRequest`, `type PlanFlowState`, `type PlanFlowAction`, `type ProgressKey = 'direct'|'search'|'measure'|'select'`
  - `initialPlanFlow: PlanFlowState`
  - `requestKey(r: PlanRequest): string`
  - `planFlowReducer(state, action): PlanFlowState`
  - `isBusy(phase: Phase): boolean`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlanFlow, isBusy, planFlowReducer, requestKey, type PlanRequest } from './planFlow';
import type { PlanResult } from '../lib/routePlan/types';

const req: PlanRequest = {
  origin: { latitude: 37.5, longitude: 127 }, destination: { latitude: 37.6, longitude: 127.1 },
  originName: '집', destinationName: '회사', mode: 'car', arriveByMin: 540, departAtMin: 480,
  stops: [{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false }], order: 'auto',
};
const result = { options: [], alternatives: [], slotStatus: {}, apiCalls: 1, directMin: 20, directKm: 10, measuredCount: 1, legTable: {}, rescore: () => ({ totalMin: 0, arrivals: [], distanceKm: 0, estimated: true }) } as unknown as PlanResult;

test('START → direct, progress 4단계 미완', () => {
  const s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  assert.equal(s.phase, 'direct');
  assert.equal(s.progress.length, 4);
  assert.ok(s.progress.every(p => !p.done));
  assert.equal(s.request, req);
});

test('PROGRESS가 단계를 완료시키고 phase를 옮긴다', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'PROGRESS', key: 'direct', detail: '직행 20분' });
  assert.equal(s.phase, 'searching');
  assert.equal(s.progress[0].done, true);
  assert.equal(s.progress[0].detail, '직행 20분');
  s = planFlowReducer(s, { type: 'PROGRESS', key: 'search', detail: '올리브영 4곳' });
  assert.equal(s.phase, 'measuring');
  s = planFlowReducer(s, { type: 'RESULT', result });
  assert.equal(s.phase, 'ready');
  assert.ok(s.progress.every(p => p.done));
  assert.equal(s.selectedOptionIdx, 0);
});

test('FAIL은 어느 단계에서든 failed', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'FAIL', error: { kind: 'direct', message: 'x' } });
  assert.equal(s.phase, 'failed');
  assert.equal(s.error?.kind, 'direct');
});

test('진행 중 같은 요청 START는 무시, 다른 요청은 새로 시작', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'PROGRESS', key: 'direct' });
  const again = planFlowReducer(s, { type: 'START', request: { ...req } });
  assert.equal(again, s);
  const other = planFlowReducer(s, { type: 'START', request: { ...req, arriveByMin: 600 } });
  assert.equal(other.phase, 'direct');
});

test('SET_OVERRIDE는 안별로 누적, RESET은 초기값', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'RESULT', result });
  s = planFlowReducer(s, { type: 'SET_OVERRIDE', optionIdx: 0, slotId: 's-1', candidateId: 'c2' });
  s = planFlowReducer(s, { type: 'SET_OVERRIDE', optionIdx: 1, slotId: 's-1', candidateId: 'c3' });
  assert.deepEqual(s.overrides, { 0: { 's-1': 'c2' }, 1: { 's-1': 'c3' } });
  assert.equal(planFlowReducer(s, { type: 'RESET' }), initialPlanFlow);
});

test('requestKey는 좌표·모드·마감·출발·칩·순서를 본다', () => {
  assert.equal(requestKey(req), requestKey({ ...req, originName: '다른이름' }));
  assert.notEqual(requestKey(req), requestKey({ ...req, stops: [] }));
  assert.notEqual(requestKey(req), requestKey({ ...req, mode: 'walk' }));
});

test('isBusy', () => {
  assert.equal(isBusy('idle'), false);
  assert.equal(isBusy('searching'), true);
  assert.equal(isBusy('ready'), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/state/planFlow.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 계획 흐름 상태 — 순수 리듀서. 파이프라인(runPlan)이 액션을 순서대로 보낸다.
 * 입력(출발·목적지·모드·마감·칩)은 기존 스토어(plan.tsx)가 갖고, 여기엔 계산 시점의 스냅샷만 있다.
 * 스펙: docs/superpowers/specs/2026-09-11-plan-flow-redesign-design.md
 */
import type { LatLng, Mode, PlanResult, Slot } from '../lib/routePlan/types';

export type Phase = 'idle' | 'direct' | 'searching' | 'measuring' | 'ready' | 'failed';
export type ProgressKey = 'direct' | 'search' | 'measure' | 'select';

export type PlanRequest = {
  origin: LatLng;
  destination: LatLng;
  originName: string;
  destinationName: string;
  mode: Mode;
  arriveByMin: number | null;
  departAtMin: number;
  /** 칩에서. id는 칩 id 그대로 — 슬롯 status를 칩에 되돌릴 때 쓴다 */
  stops: { id: string; query: string; count: number; flexible: boolean; openNow: boolean }[];
  order: 'auto' | 'locked';
};

export type PlanFlowError = { kind: 'direct' | 'search' | 'measure' | 'timeout'; message: string };

export type PlanFlowState = {
  phase: Phase;
  progress: { key: ProgressKey; label: string; detail?: string; done: boolean }[];
  request: PlanRequest | null;
  slots: Slot[];
  result: PlanResult | null;
  selectedOptionIdx: number;
  overrides: Record<number, Record<string, string>>;
  error: PlanFlowError | null;
};

export type PlanFlowAction =
  | { type: 'START'; request: PlanRequest }
  | { type: 'PROGRESS'; key: ProgressKey; detail?: string }
  | { type: 'SLOTS'; slots: Slot[] }
  | { type: 'RESULT'; result: PlanResult }
  | { type: 'FAIL'; error: PlanFlowError }
  | { type: 'SELECT_OPTION'; idx: number }
  | { type: 'SET_OVERRIDE'; optionIdx: number; slotId: string; candidateId: string }
  | { type: 'RESET' };

const STEPS: { key: ProgressKey; label: string }[] = [
  { key: 'direct', label: '직행 시간 확인' },
  { key: 'search', label: '경로 주변 검색' },
  { key: 'measure', label: '실제 이동시간 계산' },
  { key: 'select', label: '추천 경로 정리' },
];

export const initialPlanFlow: PlanFlowState = {
  phase: 'idle',
  progress: [],
  request: null,
  slots: [],
  result: null,
  selectedOptionIdx: 0,
  overrides: {},
  error: null,
};

export const isBusy = (phase: Phase): boolean =>
  phase === 'direct' || phase === 'searching' || phase === 'measuring';

/** 이름은 표시용이라 뺀다. 같은 키면 같은 계산이다 */
export function requestKey(r: PlanRequest): string {
  const c = (p: LatLng) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
  const stops = r.stops.map(s => `${s.query}×${s.count}${s.flexible ? '' : '!'}${s.openNow ? '?' : ''}`).join('|');
  return [c(r.origin), c(r.destination), r.mode, r.arriveByMin ?? '-', r.departAtMin, r.order, stops].join('#');
}

const PHASE_AFTER: Record<ProgressKey, Phase> = {
  direct: 'searching',
  search: 'measuring',
  measure: 'measuring',
  select: 'ready',
};

export function planFlowReducer(state: PlanFlowState, action: PlanFlowAction): PlanFlowState {
  switch (action.type) {
    case 'START': {
      if (isBusy(state.phase) && state.request && requestKey(state.request) === requestKey(action.request)) return state;
      return {
        ...initialPlanFlow,
        phase: 'direct',
        request: action.request,
        progress: STEPS.map(s => ({ ...s, done: false })),
      };
    }
    case 'PROGRESS': {
      const idx = STEPS.findIndex(s => s.key === action.key);
      return {
        ...state,
        phase: PHASE_AFTER[action.key],
        progress: state.progress.map((p, i) =>
          i < idx ? { ...p, done: true } : i === idx ? { ...p, done: true, detail: action.detail ?? p.detail } : p,
        ),
      };
    }
    case 'SLOTS':
      return { ...state, slots: action.slots };
    case 'RESULT':
      return {
        ...state,
        phase: 'ready',
        result: action.result,
        selectedOptionIdx: 0,
        overrides: {},
        error: null,
        progress: state.progress.map(p => ({ ...p, done: true })),
      };
    case 'FAIL':
      return { ...state, phase: 'failed', error: action.error };
    case 'SELECT_OPTION':
      return { ...state, selectedOptionIdx: action.idx };
    case 'SET_OVERRIDE': {
      const cur = state.overrides[action.optionIdx] ?? {};
      return {
        ...state,
        overrides: { ...state.overrides, [action.optionIdx]: { ...cur, [action.slotId]: action.candidateId } },
      };
    }
    case 'RESET':
      return initialPlanFlow;
    default:
      return state;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/state/planFlow.test.ts`
Expected: 7 pass

- [ ] **Step 5: 커밋**

```bash
git add src/state/planFlow.ts src/state/planFlow.test.ts
git commit -m "planFlow 리듀서 — 단계 전이, 재진입 무시, 안별 오버라이드

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: runPlan 파이프라인

**Files:**
- Create: `src/state/runPlan.ts`
- Test: `src/state/runPlan.test.ts`

**Interfaces:**
- Consumes: `plan`, `mockRouteProvider`(테스트), `searchAlong`·`initialRadiusM`·`maxRadiusM`(corridorSearch), `PlanFlowAction`
- Produces:
  - `type RunPlanDeps = { provider: RouteProvider; search: SearchFn; dispatch: (a: PlanFlowAction) => void; timeoutMs?: number }`
  - `runPlan(request: PlanRequest, deps: RunPlanDeps): Promise<void>` — 예외를 던지지 않는다. 실패는 `FAIL`로
  - `dwellFor(query: string): number`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM } from '../lib/geo';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import type { PlaceCandidate } from '../lib/routePlan/types';
import type { SearchFn } from '../lib/corridorSearch';
import { dwellFor, runPlan } from './runPlan';
import type { PlanFlowAction, PlanRequest } from './planFlow';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const catalog: PlaceCandidate[] = [
  { id: 'oy1', name: '올리브영 A', coord: at(37.5, 127.05) },
  { id: 'oy2', name: '올리브영 B', coord: at(37.505, 127.07) },
  { id: 'pb1', name: '파리바게뜨 A', coord: at(37.5, 127.09) },
];
const search: SearchFn = async (q, near, r) =>
  catalog.filter(c => c.name.startsWith(q) && haversineM(near, c.coord) <= r);
const req = (stops: PlanRequest['stops'], extra: Partial<PlanRequest> = {}): PlanRequest => ({
  origin: O, destination: D, originName: '집', destinationName: '회사', mode: 'car',
  arriveByMin: null, departAtMin: 480, stops, order: 'auto', ...extra,
});
const collect = () => {
  const actions: PlanFlowAction[] = [];
  return { actions, dispatch: (a: PlanFlowAction) => { actions.push(a); } };
};

test('정상 — START·PROGRESS×3·SLOTS·RESULT 순서, 직행은 한 번만', async () => {
  const provider = mockRouteProvider();
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false }, { id: 's-2', query: '파리바게뜨', count: 1, flexible: true, openNow: false }]), { provider, search, dispatch });
  const types = actions.map(a => a.type);
  assert.deepEqual(types.slice(0, 2), ['START', 'PROGRESS']);
  assert.ok(types.includes('SLOTS'));
  assert.equal(types[types.length - 1], 'RESULT');
  const result = (actions[actions.length - 1] as { type: 'RESULT'; result: { apiCalls: number; measuredCount: number } }).result;
  assert.equal(provider.calls, result.apiCalls + 1); // 직행 1 + 플래너 호출
  assert.equal(result.measuredCount, provider.calls);
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { id: string; searchStatus?: string; candidates: unknown[] }[] }).slots;
  assert.equal(slots[0].id, 's-1');
  assert.equal(slots[0].candidates.length, 2);
  assert.equal(slots[0].searchStatus, 'ok');
});

test('검색 0건 슬롯은 none으로 남고 계획은 진행된다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', query: '없는가게', count: 1, flexible: true, openNow: false }]), { provider: mockRouteProvider(), search, dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { searchStatus?: string }[] }).slots;
  assert.equal(slots[0].searchStatus, 'none');
  assert.equal(actions[actions.length - 1].type, 'RESULT');
});

test('직행 실패 → FAIL(direct)', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([]), { provider: { route: () => Promise.reject(new Error('down')) }, search, dispatch });
  const last = actions[actions.length - 1];
  assert.equal(last.type, 'FAIL');
  assert.equal((last as { type: 'FAIL'; error: { kind: string } }).error.kind, 'direct');
});

test('타임아웃 → FAIL(timeout)', async () => {
  const slow = { route: () => new Promise<never>(() => {}) };
  const { actions, dispatch } = collect();
  await runPlan(req([]), { provider: slow, search, dispatch, timeoutMs: 30 });
  const last = actions[actions.length - 1] as { type: 'FAIL'; error: { kind: string } };
  assert.equal(last.type, 'FAIL');
  assert.equal(last.error.kind, 'timeout');
});

test('PROGRESS search detail은 "올리브영 2곳 · 파리바게뜨 1곳"', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false }, { id: 's-2', query: '파리바게뜨', count: 1, flexible: true, openNow: false }]), { provider: mockRouteProvider(), search, dispatch });
  const p = actions.find(a => a.type === 'PROGRESS' && a.key === 'search') as { detail?: string };
  assert.equal(p.detail, '올리브영 2곳 · 파리바게뜨 1곳');
});

test('dwellFor — 카테고리 기본값', () => {
  assert.equal(dwellFor('스타벅스'), 5);
  assert.equal(dwellFor('편의점'), 3);
  assert.equal(dwellFor('이마트'), 15);
  assert.equal(dwellFor('올리브영'), 10);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 계획 파이프라인 — 직행 실측 → 슬롯별 회랑 검색 → plan(). 액션을 순서대로 보낸다.
 * 예외를 밖으로 던지지 않는다. 실패는 전부 FAIL 액션이다.
 * 의존(공급자·검색·dispatch)을 주입받아 목으로 시험한다.
 */
import { initialRadiusM, maxRadiusM, searchAlong, type SearchFn } from '../lib/corridorSearch';
import { plan } from '../lib/routePlan/plan';
import type { RouteProvider, RouteResult, Slot } from '../lib/routePlan/types';
import type { PlanFlowAction, PlanRequest } from './planFlow';

export type RunPlanDeps = {
  provider: RouteProvider;
  search: SearchFn;
  dispatch: (a: PlanFlowAction) => void;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 12_000;

/** 체류시간 기본값 — 할 일이 생기면 A9에서 바뀐다. 목 데이터와 같은 수준 */
const DWELL: [RegExp, number][] = [
  [/편의점|CU|GS25|세븐일레븐|이마트24/i, 3],
  [/카페|커피|스타벅스|스벅|투썸|메가|컴포즈|빽다방/i, 5],
  [/약국|은행|ATM|우체국|주유소|충전/i, 5],
  [/빵집|베이커리|파리바게뜨|파바|뚜레쥬르/i, 5],
  [/마트|이마트|홈플러스|롯데마트|코스트코|다이소/i, 15],
];
export function dwellFor(query: string): number {
  for (const [re, min] of DWELL) if (re.test(query)) return min;
  return 10;
}

class Timeout extends Error {}

export async function runPlan(request: PlanRequest, deps: RunPlanDeps): Promise<void> {
  const { provider, search, dispatch } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  dispatch({ type: 'START', request });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout('timeout')), timeoutMs);
  });
  const race = <T,>(p: Promise<T>) => Promise.race([p, deadline]);

  try {
    // 0. 직행 — 폴리라인이 회랑 검색과 플래너 둘 다에 필요하다
    let direct: RouteResult;
    try {
      direct = await race(provider.route([request.origin, request.destination], request.departAtMin, request.mode));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'direct', message: String(e) } });
      return;
    }
    dispatch({ type: 'PROGRESS', key: 'direct', detail: `직행 ${Math.round(direct.durationMin)}분` });

    // 0.5 회랑 검색 — 슬롯별 병렬
    const rho = direct.durationMin / Math.max(direct.distanceKm, 0.1);
    const slack = request.arriveByMin == null ? null : request.arriveByMin - request.departAtMin - direct.durationMin;
    const poly = direct.polyline.length >= 2 ? direct.polyline : [request.origin, request.destination];
    let slots: Slot[];
    try {
      slots = await race(Promise.all(request.stops.map(async st => {
        const found = await searchAlong(
          poly, st.query,
          { need: Math.max(1, st.count), initialRadiusM: initialRadiusM(request.mode), maxRadiusM: maxRadiusM(request.mode, slack, rho) },
          search,
        );
        return {
          id: st.id, query: st.query, candidates: found.candidates.slice(0, 8), dwellMin: dwellFor(st.query),
          count: Math.max(1, st.count), flexible: st.flexible, openNow: st.openNow, searchStatus: found.status,
        } satisfies Slot;
      })));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'search', message: String(e) } });
      return;
    }
    dispatch({ type: 'SLOTS', slots });
    dispatch({ type: 'PROGRESS', key: 'search', detail: slots.map(s => `${s.query} ${s.candidates.length}곳`).join(' · ') });

    // 1~6. 플래너
    let result;
    try {
      result = await race(plan(
        { origin: request.origin, destination: request.destination, departAtMin: request.departAtMin,
          arriveByMin: request.arriveByMin ?? undefined, mode: request.mode, slots, order: request.order },
        provider, { direct },
      ));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'measure', message: String(e) } });
      return;
    }
    dispatch({ type: 'PROGRESS', key: 'measure', detail: `실측 ${result.measuredCount}회` });
    dispatch({ type: 'RESULT', result });
  } catch (e) {
    if (e instanceof Timeout) dispatch({ type: 'FAIL', error: { kind: 'timeout', message: '12초 안에 끝나지 않았어요' } });
    else dispatch({ type: 'FAIL', error: { kind: 'measure', message: String(e) } });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/state/runPlan.test.ts && npx tsc --noEmit -p .`
Expected: 6 pass, tsc 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/state/runPlan.ts src/state/runPlan.test.ts
git commit -m "runPlan 파이프라인 — 직행·회랑 검색·플래너, 타임아웃, 실패는 FAIL로

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 브리지 — effectiveVisits · optionTitle · alternativeToCandidate · toLegacyPlan, 그리고 APPLY_LIVE

**Files:**
- Create: `src/state/planFlowBridge.ts`
- Test: `src/state/planFlowBridge.test.ts`
- Modify: `src/state/plan.tsx` (타입·액션·api 3곳)

**Interfaces:**
- Produces (bridge):
  - `effectiveVisits(result, optionIdx, overrides): { visits: Visit[]; timing: Rescored; option: PlanOption }` — 오버라이드 반영. 없으면 `timing`은 옵션 값 그대로(`estimated:false`)
  - `optionTitle(result, idx): string`
  - `alternativeToCandidate(alt, slotQuery, arrivalMin): Candidate`
  - `chosenToCandidate(visit, slotQuery, arrivalMin): Candidate` — 현재 선택 후보(`recommended:true`, addedMin 0)
  - `toLegacyPlan(args: { flow: PlanFlowState; departMin: number }): ApplyLivePayload`
- Produces (plan.tsx):
  - `export type ApplyLivePayload = { stops: StopState[]; dataset: Dataset; departMin: number; selectedOptionId: string }`
  - `PlanApi.applyLive(payload: ApplyLivePayload): void`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { plan } from '../lib/routePlan/plan';
import type { PlaceCandidate, Slot } from '../lib/routePlan/types';
import { effectiveVisits, optionTitle, toLegacyPlan } from './planFlowBridge';
import { initialPlanFlow, planFlowReducer, type PlanFlowState, type PlanRequest } from './planFlow';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, name: string, coord: { latitude: number; longitude: number }, extra: Partial<PlaceCandidate> = {}): PlaceCandidate => ({ id, name, coord, ...extra });
const slots: Slot[] = [
  { id: 's-1', query: '올리브영', dwellMin: 10, count: 1, flexible: true, openNow: false, searchStatus: 'ok',
    candidates: [c('oy1', '올리브영 A', at(37.5, 127.05)), c('oy2', '올리브영 B', at(37.505, 127.07)), c('oy3', '올리브영 C', at(37.45, 127.06), { hours: { openMin: 600, closeMin: 1320 } })] },
  { id: 's-2', query: '파리바게뜨', dwellMin: 5, count: 1, flexible: true, openNow: false, searchStatus: 'ok',
    candidates: [c('pb1', '파리바게뜨 A', at(37.5, 127.09)), c('pb2', '파리바게뜨 B', at(37.495, 127.08))] },
];
const req: PlanRequest = { origin: O, destination: D, originName: '집', destinationName: '회사', mode: 'car', arriveByMin: 560, departAtMin: 480, stops: slots.map(s => ({ id: s.id, query: s.query, count: 1, flexible: true, openNow: false })), order: 'auto' };

async function ready(): Promise<PlanFlowState> {
  const result = await plan({ origin: O, destination: D, departAtMin: 480, arriveByMin: 560, mode: 'car', slots, order: 'auto' }, mockRouteProvider());
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'SLOTS', slots });
  return planFlowReducer(s, { type: 'RESULT', result });
}

test('effectiveVisits — 오버라이드 없으면 옵션 그대로, 있으면 rescore', async () => {
  const s = await ready();
  const plain = effectiveVisits(s.result!, 0, {});
  assert.equal(plain.timing.estimated, false);
  assert.equal(plain.timing.totalMin, s.result!.options[0].totalMin);
  const swapped = effectiveVisits(s.result!, 0, { 0: { 's-1': 'oy2' } });
  assert.equal(swapped.visits.find(v => v.slotId === 's-1')!.candidate.id, 'oy2');
  assert.ok(swapped.timing.totalMin !== plain.timing.totalMin);
});

test('optionTitle — 1안은 가장 빠름, 후보 다르면 "대신", 순서만 다르면 순서 바꿈', async () => {
  const s = await ready();
  assert.equal(optionTitle(s.result!, 0), '가장 빠름');
  for (let i = 1; i < s.result!.options.length; i++) {
    const t = optionTitle(s.result!, i);
    assert.ok(/대신|순서 바꿈|번째로 빠름/.test(t), t);
  }
});

test('toLegacyPlan — stops·legs·candidates·options가 기존 형식으로', async () => {
  const s = await ready();
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  assert.equal(p.stops.length, 2);
  assert.equal(p.stops[0].baseId, p.stops[0].id);
  assert.match(p.stops[0].arriveAt, /^\d{1,2}:\d{2}$/);
  assert.equal(p.stops[0].tasks.length, 0);
  assert.equal(p.dataset.key, 'live');
  assert.equal(p.dataset.directMin, Math.round(s.result!.directMin));
  // legs — origin>슬롯, 슬롯>슬롯, 슬롯>dest 전부
  const ids = p.stops.map(st => st.baseId);
  assert.ok(p.dataset.legs![`origin>${ids[0]}`]);
  assert.ok(p.dataset.legs![`${ids[0]}>${ids[1]}`]);
  assert.ok(p.dataset.legs![`${ids[1]}>dest`]);
  assert.ok(p.dataset.legs![`origin>${ids[1]}`], '역순 재정렬용 leg');
  // candidates — 선택된 곳은 recommended, 마감은 disabled
  const oy = p.dataset.candidates['s-1'];
  assert.ok(oy.find(x => x.recommended));
  assert.equal(oy.find(x => x.name === '올리브영 C')?.disabled, true);
  assert.equal(p.dataset.options.length, s.result!.options.length);
  assert.equal(p.dataset.options[0].stopNames[0], '집');
  assert.equal(p.selectedOptionId, p.dataset.options[0].id);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/state/planFlowBridge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: plan.tsx에 페이로드 타입·액션·api 추가**

`StopState` 정의 아래:

```ts
/** 확정 경계 — planFlow가 만든 계획을 기존 스토어 형식으로. 만드는 쪽은 planFlowBridge.ts */
export type ApplyLivePayload = {
  stops: StopState[];
  dataset: Dataset;
  departMin: number;
  selectedOptionId: string;
};
```

`Action` 유니온에 `| { type: 'APPLY_LIVE'; payload: ApplyLivePayload }`. 리듀서 `case 'APPLY_OPTION'` 위에:

```ts
    case 'APPLY_LIVE': {
      const { stops, dataset, departMin, selectedOptionId } = action.payload;
      return {
        ...state,
        dataset,
        options: dataset.options,
        selectedOptionId,
        optionOverrides: {},
        stopCount: null,
        planConfirmed: true,
        departMin,
        ...computeChain(stops, dataset, departMin),
      };
    }
```

`PlanApi`에 `applyLive: (payload: ApplyLivePayload) => void;`, api 객체에 `applyLive: payload => dispatch({ type: 'APPLY_LIVE', payload }),`.

- [ ] **Step 4: 브리지 구현**

```ts
/**
 * planFlow ↔ 기존 스토어 사이의 변환. 전부 순수 함수.
 *   effectiveVisits  — 안(案)에 매장 오버라이드를 적용하고 시간을 다시 낸다
 *   optionTitle      — 카드 제목은 규칙이 아니라 "무엇이 다른가"
 *   toLegacyPlan     — 확정 순간 StopState[] + key:'live' Dataset. A6 이후는 이걸로 그대로 돈다
 */
import type { Candidate, Dataset, RouteOption, Stop } from '../data/mockData';
import { isOpenAt } from '../lib/routePlan/score';
import type { Alternative, PlanOption, PlanResult, Rescored, Visit } from '../lib/routePlan/types';
import type { PlanFlowState } from './planFlow';
import type { ApplyLivePayload, StopState } from './plan';

const toHHMM = (min: number) => `${Math.floor(min / 60) % 24}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function effectiveVisits(
  result: PlanResult,
  optionIdx: number,
  overrides: Record<number, Record<string, string>>,
): { visits: Visit[]; timing: Rescored; option: PlanOption } {
  const option = result.options[optionIdx] ?? result.options[0];
  const ov = overrides[optionIdx] ?? {};
  if (Object.keys(ov).length === 0) {
    return { visits: option.visits, timing: { totalMin: option.totalMin, arrivals: option.arrivals, distanceKm: option.distanceKm, estimated: false }, option };
  }
  const visits = option.visits.map(v => {
    const candId = ov[v.slotId];
    if (!candId) return v;
    const alt = result.alternatives.find(a => a.slotId === v.slotId && a.candidate.id === candId);
    return alt ? { ...v, candidate: alt.candidate } : v;
  });
  return { visits, timing: result.rescore(visits), option };
}

export function optionTitle(result: PlanResult, idx: number): string {
  if (idx === 0) return '가장 빠름';
  const best = result.options[0];
  const me = result.options[idx];
  if (!me) return '';
  for (const v of me.visits) {
    const b = best.visits.find(x => x.slotId === v.slotId);
    if (b && b.candidate.id !== v.candidate.id) return `${b.candidate.name} 대신 ${v.candidate.name}`;
  }
  const order = (o: PlanOption) => o.visits.map(v => v.slotId).join('>');
  if (order(me) !== order(best)) return '순서 바꿈';
  return `${idx + 1}번째로 빠름`;
}

function openStateOf(c: { hours?: { openMin: number; closeMin: number } }, arrivalMin: number): Stop['openState'] {
  if (!c.hours) return 'open';
  if (!isOpenAt(c as never, arrivalMin)) return 'closed';
  const untilClose = ((c.hours.closeMin - arrivalMin) % 1440 + 1440) % 1440;
  return untilClose <= 30 ? 'closing_soon' : 'open';
}
const openNoteOf = (state: Stop['openState']) =>
  state === 'closed' ? '영업 종료 · 선택 불가' : state === 'closing_soon' ? '곧 마감' : '영업 중';

export function alternativeToCandidate(alt: Alternative, slotQuery: string, arrivalMin: number, dwellMin: number): Candidate {
  const openState = openStateOf(alt.candidate, arrivalMin);
  return {
    id: alt.candidate.id,
    name: alt.candidate.name,
    note: `${slotQuery} · 경로에서 ${round1(alt.detourKm)}km${alt.estimated ? ' · 추정' : ''}`,
    addedMin: Math.round(alt.addedMin),
    detourKm: round1(alt.detourKm),
    arriveAt: toHHMM(arrivalMin),
    dwellMin,
    parking: alt.candidate.parking ?? '가능',
    openState,
    openNote: openNoteOf(openState),
    disabled: openState === 'closed',
    coord: alt.candidate.coord,
  };
}

export function chosenToCandidate(v: Visit, slotQuery: string, arrivalMin: number): Candidate {
  const openState = openStateOf(v.candidate, arrivalMin);
  return {
    id: v.candidate.id, name: v.candidate.name, note: `${slotQuery} · 현재 경로`, addedMin: 0, detourKm: 0,
    arriveAt: toHHMM(arrivalMin), dwellMin: v.dwellMin, parking: v.candidate.parking ?? '가능',
    openState, openNote: openNoteOf(openState), recommended: true, coord: v.candidate.coord,
  };
}

export function toLegacyPlan({ flow, departMin }: { flow: PlanFlowState; departMin: number }): ApplyLivePayload {
  const { result, request, slots } = flow;
  if (!result || !request) throw new Error('toLegacyPlan: 결과가 없다');
  const { visits, timing } = effectiveVisits(result, flow.selectedOptionIdx, flow.overrides);
  const queryOf = (slotId: string) => slots.find(s => s.id === slotId)?.query ?? '';
  const idOf = (candId: string) => visits.find(v => v.candidate.id === candId)?.slotId;

  // stops — 방문 순서대로. leg는 도착시각 차에서
  let clock = departMin;
  const stops: StopState[] = visits.map((v, i) => {
    const arrive = timing.arrivals[i];
    const legMin = Math.round(arrive - clock);
    const legKey = `${i === 0 ? 'O' : visits[i - 1].candidate.id}>${v.candidate.id}`;
    const legKm = round1(result.legTable[legKey]?.km ?? 0);
    clock = arrive + v.dwellMin;
    const openState = openStateOf(v.candidate, arrive);
    return {
      id: v.slotId, baseId: v.slotId, name: v.candidate.name, category: queryOf(v.slotId), coord: v.candidate.coord,
      dwellMin: v.dwellMin, arriveAt: toHHMM(arrive), legMin, legKm, openState,
      openNote: `체류 ${v.dwellMin}분 · ${openNoteOf(openState)}`, tasks: [],
      replaceDeltaMin: 0, selectedCandidateId: v.candidate.id,
    };
  });

  // legs — legTable의 후보 id를 슬롯 id로 (선택된 후보만). 양끝은 origin/dest
  const legs: NonNullable<Dataset['legs']> = {};
  const mapId = (id: string) => (id === 'O' ? 'origin' : id === 'D' ? 'dest' : idOf(id));
  for (const [key, leg] of Object.entries(result.legTable)) {
    const [a, b] = key.split('>');
    const ma = mapId(a);
    const mb = mapId(b);
    if (!ma || !mb) continue;
    legs[`${ma}>${mb}`] = { min: Math.round(leg.min), km: round1(leg.km) };
  }
  legs['origin>dest'] = { min: Math.round(result.directMin), km: round1(result.directKm) };

  // candidates — 슬롯마다 현재 선택 + 대안
  const candidates: Dataset['candidates'] = {};
  visits.forEach((v, i) => {
    const arrive = timing.arrivals[i];
    candidates[v.slotId] = [
      chosenToCandidate(v, queryOf(v.slotId), arrive),
      ...result.alternatives.filter(a => a.slotId === v.slotId).map(a => alternativeToCandidate(a, queryOf(v.slotId), arrive + a.addedMin, v.dwellMin)),
    ];
  });

  const options: RouteOption[] = result.options.map((o, i) => ({
    id: `live-${i}`,
    title: optionTitle(result, i),
    badge: i === 0 ? '검증한 안 중 최선' : undefined,
    totalMin: Math.round(o.totalMin),
    deltaMin: Math.round(o.deltaMin),
    stopNames: [request.originName, ...o.visits.map(v => v.candidate.name), request.destinationName],
    rationale: i === 0 ? `실측 ${result.measuredCount}회로 확인한 경로예요.` : optionTitle(result, i),
    recommended: i === 0,
  }));

  const totalMin = Math.round(timing.totalMin);
  const dataset: Dataset = {
    key: 'live',
    label: '실제 계획',
    origin: { name: request.originName, note: '', coord: request.origin, departAt: toHHMM(departMin) },
    destination: { name: request.destinationName, coord: request.destination, arriveAt: toHHMM(departMin + totalMin) },
    directMin: Math.round(result.directMin),
    mode: request.mode,
    arriveByLabel: request.arriveByMin == null ? '도착 시각 상관없어요' : `오늘 ${toHHMM(request.arriveByMin).padStart(5, '0')}까지`,
    userMessage: '',
    options,
    stops: stops.map(({ baseId: _b, replaceDeltaMin: _r, selectedCandidateId: _s, ...rest }) => rest),
    candidates,
    totals: { totalMin, deltaMin: totalMin - Math.round(result.directMin), stopCount: stops.length },
    legs,
  };

  return { stops, dataset, departMin, selectedOptionId: `live-${flow.selectedOptionIdx}` };
}
```

`Dataset`에 `label`·`userMessage` 등 필수 필드가 더 있으면(타입 오류로 드러난다) 빈 문자열로 채운다.

- [ ] **Step 5: 통과 확인**

Run: `npx tsx --test src/state/planFlowBridge.test.ts && npx tsc --noEmit -p .`
Expected: 3 pass, tsc 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/state/planFlowBridge.ts src/state/planFlowBridge.test.ts src/state/plan.tsx
git commit -m "확정 경계 — toLegacyPlan과 APPLY_LIVE. A6 이후는 실측 leg로 그대로 돈다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: PlanFlowProvider

**Files:**
- Create: `src/state/planFlowProvider.tsx`
- Modify: `App.tsx`

**Interfaces:**
- Produces: `PlanFlowProvider`, `usePlanFlow(): { state: PlanFlowState; start(request): void; select(idx): void; setOverride(idx, slotId, candId): void; reset(): void; isStale(request): boolean }`

- [ ] **Step 1: 구현**

```tsx
/**
 * planFlow Context. 공급자 선택은 여기서만 한다:
 *   .env에 SERVER_URL·APP_TOKEN이 있으면 Workers /route, 없으면 목 라우팅(haversine 추정).
 * 장소 검색은 places.ts의 planSearchFn(카카오 키 있으면 카카오, 없으면 목 카탈로그).
 */
import React, { createContext, useContext, useMemo, useReducer, useRef } from 'react';
import Constants from 'expo-constants';
import { planSearchFn } from '../lib/places';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { serverRouteProvider } from '../lib/routePlan/serverProvider';
import type { RouteProvider } from '../lib/routePlan/types';
import { initialPlanFlow, isBusy, planFlowReducer, requestKey, type PlanFlowState, type PlanRequest } from './planFlow';
import { runPlan } from './runPlan';

type PlanFlowApi = {
  state: PlanFlowState;
  start: (request: PlanRequest) => void;
  select: (idx: number) => void;
  setOverride: (optionIdx: number, slotId: string, candidateId: string) => void;
  reset: () => void;
  /** 결과가 있는데 지금 입력과 다르면 true — A5 배너 */
  isStale: (request: PlanRequest) => boolean;
  /** 실측인가 추정인가 — 화면 문구용 */
  usingServer: boolean;
};

const Ctx = createContext<PlanFlowApi | null>(null);

function pickProvider(): { provider: RouteProvider; usingServer: boolean } {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
  const baseUrl = extra.serverUrl?.trim();
  const appToken = extra.appToken?.trim();
  if (baseUrl && appToken) {
    const deviceId = Constants.sessionId ?? 'unknown';
    return { provider: serverRouteProvider({ baseUrl, appToken, deviceId }), usingServer: true };
  }
  return { provider: mockRouteProvider(), usingServer: false };
}

export function PlanFlowProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(planFlowReducer, initialPlanFlow);
  const stateRef = useRef(state);
  stateRef.current = state;
  const deps = useMemo(() => ({ ...pickProvider(), search: planSearchFn() }), []);

  const api = useMemo<PlanFlowApi>(() => ({
    state,
    start: request => {
      const cur = stateRef.current;
      if (isBusy(cur.phase) && cur.request && requestKey(cur.request) === requestKey(request)) return;
      void runPlan(request, { provider: deps.provider, search: deps.search, dispatch });
    },
    select: idx => dispatch({ type: 'SELECT_OPTION', idx }),
    setOverride: (optionIdx, slotId, candidateId) => dispatch({ type: 'SET_OVERRIDE', optionIdx, slotId, candidateId }),
    reset: () => dispatch({ type: 'RESET' }),
    isStale: request => !!state.request && requestKey(state.request) !== requestKey(request),
    usingServer: deps.usingServer,
  }), [state, deps]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlanFlow(): PlanFlowApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlanFlow must be used within PlanFlowProvider');
  return ctx;
}
```

`App.tsx`: `import { PlanFlowProvider } from './src/state/planFlowProvider';` 그리고 `<PlanProvider>` 바로 안쪽에 `<PlanFlowProvider>` … `</PlanFlowProvider>`로 감싼다(TrackerProvider 바깥).

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit -p .`
Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/state/planFlowProvider.tsx App.tsx
git commit -m "PlanFlowProvider — 공급자 선택(.env)과 usePlanFlow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 요청 조립 훅과 A3 계산 화면 교체

**Files:**
- Create: `src/state/usePlanRequest.ts`
- Rewrite: `src/screens/CalculatingScreen.tsx`

**Interfaces:**
- Produces: `usePlanRequest(): PlanRequest | null` — 기존 스토어 + GPS에서 조립. 출발·목적지 좌표가 없으면 null

- [ ] **Step 1: 훅**

```ts
/**
 * 기존 스토어(입력)에서 PlanRequest를 조립한다. planFlow는 입력을 갖지 않는다.
 * 출발 좌표: 사용자가 고른 곳 → GPS → (없으면 null: 계산 불가)
 */
import { useMemo } from 'react';
import { useCurrentPlace } from '../lib/currentPlace';
import { usePlan } from './plan';
import type { PlanRequest } from './planFlow';

const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export function usePlanRequest(): PlanRequest | null {
  const { state, originDisplay, destinationDisplay } = usePlan();
  const here = useCurrentPlace();
  const origin = state.originCoord ?? here.coord ?? null;
  const destination = state.destinationCoord ?? state.dataset.destination.coord;
  return useMemo(() => {
    if (!origin || !destination) return null;
    const stops = state.chips
      .filter(c => c.kind === 'stop')
      .map(c => ({ id: c.id, query: c.kind === 'stop' ? c.queries[0] : '', count: 1, flexible: true, openNow: false }));
    return {
      origin, destination, originName: originDisplay, destinationName: destinationDisplay,
      mode: state.mode, arriveByMin: state.arriveByMin, departAtMin: nowMin(), stops, order: 'auto',
    };
    // departAtMin은 렌더마다 바뀌면 안 된다 — 분이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude, state.chips, state.mode, state.arriveByMin, originDisplay, destinationDisplay, Math.floor(Date.now() / 60000)]);
}
```

칩의 `count`는 지금 칩이 하나씩 복제돼 들어오므로(APPLY_INTENT가 count만큼 칩을 만든다) 1로 둔다. 같은 검색어 칩이 두 개면 슬롯도 두 개가 되고, 플래너의 중복 금지가 서로 다른 지점을 고른다.

- [ ] **Step 2: A3 교체**

```tsx
/** A3 — 계산 중. 진행 바는 실제 단계(직행 → 검색 → 실측 → 정리)에 묶인다. ready면 A5, failed면 A8 */
import React, { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { usePlanFlow } from '../state/planFlowProvider';
import { usePlanRequest } from '../state/usePlanRequest';
import { Card } from '../components/common';
import { CheckMark } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Calculating'>;

/** 결과가 더 빨라도 이만큼은 보여준다 — 깜빡이면 계산한 것 같지 않다 */
const MIN_SHOW_MS = 1200;

function PulseRing() {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(0.35, { duration: 600, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) })), -1);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: color.primary }, style]} />;
}

export function CalculatingScreen({ navigation }: Props) {
  const { state, start } = usePlanFlow();
  const request = usePlanRequest();
  const enteredAt = useRef(Date.now());

  useEffect(() => {
    if (request) start(request);
    // 진입 시 한 번. 칩이 바뀌면 A2가 RESET하고 여기로 다시 온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.phase !== 'ready' && state.phase !== 'failed') return;
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - enteredAt.current));
    const t = setTimeout(() => navigation.replace(state.phase === 'ready' ? 'Options' : 'Error'), wait);
    return () => clearTimeout(t);
  }, [state.phase, navigation]);

  const done = state.progress.filter(p => p.done).length;
  const pct = state.progress.length ? Math.round((done / state.progress.length) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="경로 계산 중" onBack={() => navigation.goBack()} right={{ label: '취소', tint: color.muted, onPress: () => navigation.goBack() }} />
      <View style={{ flex: 1, paddingTop: 18, paddingHorizontal: 20, gap: 16 }}>
        <Card style={{ padding: 20, gap: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View style={{ gap: 5 }}>
              <Text style={[type.labelPlain, { color: color.muted }]}>{request ? `경유지 ${request.stops.length}곳` : '위치 확인 중'}</Text>
              <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 30, lineHeight: 30, letterSpacing: -0.6, color: color.ink }}>{pct}%</Text>
            </View>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: color.skeleton, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color.primary }} />
          </View>
          <View style={{ gap: 14 }}>
            {state.progress.map((step, i) => {
              const active = !step.done && (i === 0 || state.progress[i - 1].done);
              return (
                <View key={step.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: step.done || active ? 1 : 0.45 }}>
                  {step.done ? (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' }}><CheckMark /></View>
                  ) : active ? <PulseRing /> : (
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: color.stroke }} />
                  )}
                  <Text style={{ flex: 1, fontFamily: active ? 'Pretendard-Medium' : 'Pretendard-Regular', fontSize: 15, lineHeight: 20, color: active ? color.ink : color.body }}>
                    {step.label}
                    {step.detail ? <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.ink }}> {step.detail}</Text> : null}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
        {!request && (
          <Text style={[type.caption, { color: color.amberDeep, textAlign: 'center' }]}>출발지 위치를 아직 못 잡았어요. 잠시 뒤 다시 시도해 주세요.</Text>
        )}
      </View>
      <BottomInputBar placeholder="조건을 더 말해보세요" sendEnabled={false} editable={false} />
      <TabBar />
    </View>
  );
}
```

`calcSteps`를 더는 아무도 안 쓰면 `mockData.ts`에서 지운다(tsc가 알려주지 않으므로 grep).

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit -p . && grep -rn "calcSteps" src | wc -l`
Expected: tsc 출력 없음, 0

- [ ] **Step 4: 커밋**

```bash
git add src/state/usePlanRequest.ts src/screens/CalculatingScreen.tsx src/data/mockData.ts
git commit -m "A3 계산 화면 — 실제 단계에 묶인 진행 바, 요청 조립 훅

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: A4 후보 시트를 props 기반으로

**Files:**
- Rewrite: `src/sheets/CandidateSheet.tsx`
- Modify: `src/screens/TimelineScreen.tsx:339-344`

**Interfaces:**
- Produces: `CandidateSheet({ visible, title, candidates: Candidate[], currentId?, onPick, onClose })`. `candidates`는 `arriveAt`이 채워진 `Candidate`(mockData 타입). 정렬·필터는 `rankCandidates` 그대로.

- [ ] **Step 1: 시트 교체**

기존 파일에서 바꾸는 것만:
- props 타입을 `{ visible: boolean; title: string; candidates: Candidate[]; currentId?: string; onPick: (candidateId: string) => void; onClose: () => void }`로.
- `usePlan()`·`state.dataset`·`stopNow`·`arriveFor`·`lastRef`·`effBaseId` 전부 제거. `candidates`는 prop, `currentId`는 prop.
- 헤더 `{(current ?? recommended).name} 교체` → `{title}`.
- `arriveFor(cand)` → `cand.arriveAt`.
- `추정` 표시: `cand.note.includes('추정')`이면 `+{addedMin}분` 앞에 `약 `.
- `Sheet visible={visible}`.
- `expandedId` 초기화 트리거는 `visible`이 true로 바뀔 때.

- [ ] **Step 2: A6 호출부**

`TimelineScreen.tsx`의 `<CandidateSheet baseId=… currentCandidateId=… onPick onClose />`를:

```tsx
      <CandidateSheet
        visible={!!candidateStop}
        title={`${candidateStop?.name ?? ''} 교체`}
        candidates={(candidateStop ? state.dataset.candidates[candidateStop.baseId] ?? [] : []).map(c => ({
          ...c,
          // 목 데이터의 아침 시각 대신 지금 경로의 도착시각 + 후보 간 차이
          arriveAt: candidateStop ? toHHMM(toMin(candidateStop.arriveAt) + (c.addedMin - (currentCand?.addedMin ?? 0))) : c.arriveAt,
        }))}
        currentId={candidateCurrentId}
        onPick={candId => candidateStop && replaceStop(candidateStop.id, candId)}
        onClose={() => setCandidateStopId(null)}
      />
```

`currentCand`는 그 위에서 `const currentCand = candidateStop ? (state.dataset.candidates[candidateStop.baseId] ?? []).find(c => c.id === candidateCurrentId) : undefined;`. `toHHMM`·`toMin`은 `../state/plan`에서 import(이미 있으면 그대로).

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit -p .`
Expected: `OptionsScreen.tsx`의 옛 props 호출만 오류(Task 8에서 사라진다). 그 외 없음.

- [ ] **Step 4: 커밋** (Task 8과 함께 — OptionsScreen이 깨진 상태로 커밋하지 않는다)

---

### Task 8: A5 추천 화면 교체 — 답 먼저

**Files:**
- Rewrite: `src/screens/OptionsScreen.tsx`

**Interfaces:**
- Consumes: `usePlanFlow`, `usePlanRequest`, `effectiveVisits`·`optionTitle`·`alternativeToCandidate`·`chosenToCandidate`·`toLegacyPlan`, `usePlan().applyLive`, `CandidateSheet`(새 props)

- [ ] **Step 1: 화면**

```tsx
/** A5 — 추천. 답(제시간 도착 여부)이 맨 위, 3안은 그 아래. "최적"이 아니라 "검증한 안 중 최선" */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { usePlan, toHHMM } from '../state/plan';
import { usePlanFlow } from '../state/planFlowProvider';
import { usePlanRequest } from '../state/usePlanRequest';
import { alternativeToCandidate, chosenToCandidate, effectiveVisits, optionTitle, toLegacyPlan } from '../state/planFlowBridge';
import type { SlotStatus } from '../lib/routePlan/types';
import { Card, haptic, PrimaryButton } from '../components/common';
import { Chevron, DottedLineH, Hairline } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { TabBar } from '../components/TabBar';
import { CandidateSheet } from '../sheets/CandidateSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Options'>;

const hhmm = (min: number) => toHHMM(min).padStart(5, '0');
const STATUS_TEXT: Partial<Record<SlotStatus, string>> = { far: '멀리 있음', none: '못 찾음', closed: '마감', late: '늦음', short: '일부만' };

export function OptionsScreen({ navigation }: Props) {
  const flow = usePlanFlow();
  const request = usePlanRequest();
  const { applyLive } = usePlan();
  const { state } = flow;
  const result = state.result;
  const [pickSlot, setPickSlot] = useState<string | null>(null);

  const current = useMemo(
    () => (result ? effectiveVisits(result, state.selectedOptionIdx, state.overrides) : null),
    [result, state.selectedOptionIdx, state.overrides],
  );
  if (!result || !current || !state.request) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />
        <Text style={[type.body, { color: color.muted, padding: 20 }]}>계산된 경로가 없어요. 계획 화면에서 다시 시작해 주세요.</Text>
        <TabBar />
      </View>
    );
  }

  const req = state.request;
  const arriveMin = req.departAtMin + current.timing.totalMin;
  const slack = req.arriveByMin == null ? null : req.arriveByMin - arriveMin;
  const late = slack != null && slack < 0;
  const approx = current.timing.estimated || !flow.usingServer ? '약 ' : '';
  const stale = request ? flow.isStale(request) : false;

  const slotQuery = (id: string) => state.slots.find(s => s.id === id)?.query ?? '';
  const pickIdx = current.visits.findIndex(v => v.slotId === pickSlot);
  const pickVisit = pickIdx >= 0 ? current.visits[pickIdx] : null;
  const pickArrive = pickIdx >= 0 ? current.timing.arrivals[pickIdx] : 0;
  const sheetCands = pickVisit
    ? [chosenToCandidate(pickVisit, slotQuery(pickVisit.slotId), pickArrive),
       ...result.alternatives.filter(a => a.slotId === pickVisit.slotId).map(a => alternativeToCandidate(a, slotQuery(a.slotId), pickArrive + a.addedMin, pickVisit.dwellMin))]
    : [];

  const confirm = () => {
    applyLive(toLegacyPlan({ flow: state, departMin: req.departAtMin }));
    navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Today' }] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}>
        {stale && (
          <Pressable onPress={() => { haptic(); flow.reset(); navigation.replace('Calculating'); }}
            style={{ backgroundColor: color.amberBg, borderRadius: 14, padding: 14 }}>
            <Text style={[type.body, { color: color.amberDeep }]}>조건이 바뀌었어요 · 다시 계산</Text>
          </Pressable>
        )}

        {/* 1. 판정 카드 — 답 먼저 */}
        <Card elevated style={{ padding: 20, gap: 8 }}>
          {slack == null ? (
            <Text style={[type.displayXL, { color: color.ink }]}>{approx}{hhmm(arriveMin)} 도착</Text>
          ) : late ? (
            <Text style={[type.displayXL, { color: color.amberDeep }]}>지금 출발해도 {approx}{Math.round(-slack)}분 늦어요</Text>
          ) : (
            <Text style={[type.displayXL, { color: color.ink }]}>들렀다 가도 {approx}{hhmm(arriveMin)} 도착</Text>
          )}
          <Text style={[type.body, { color: slack != null && !late ? color.green : color.muted }]}>
            {slack == null ? `직행보다 +${Math.round(current.timing.totalMin - result.directMin)}분` : late ? `마감 ${hhmm(req.arriveByMin!)}` : `${Math.round(slack)}분 여유`}
          </Text>
          {late && result.relaxed && (
            <Pressable onPress={() => { haptic(); /* 완화안 선택 = 그 슬롯을 빼고 재계산 */ flow.reset(); navigation.navigate('Plan'); }}>
              <Text style={[type.body, { color: color.primary }]}>
                {slotQuery(result.relaxed.droppedSlotId)}을(를) 빼면 {hhmm(req.departAtMin + result.relaxed.totalMin)} 도착 · {Math.round(req.arriveByMin! - (req.departAtMin + result.relaxed.totalMin))}분 여유 → 계획에서 빼기
              </Text>
            </Pressable>
          )}
          <Text style={[type.caption, { color: color.muted }]}>
            {flow.usingServer ? `검증한 안 중 최선 · 실측 ${result.measuredCount}회` : '서버 없이 추정한 값이에요'}
          </Text>
        </Card>

        {/* 2. 경유지 행 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {current.visits.map(v => {
            const alts = result.alternatives.filter(a => a.slotId === v.slotId).length;
            const st = result.slotStatus[v.slotId];
            const suffix = st && st !== 'ok' ? ` · ${STATUS_TEXT[st]}` : '';
            return (
              <Pressable key={v.slotId} disabled={alts === 0} onPress={() => { haptic(); setPickSlot(v.slotId); }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: color.surface, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 17, color: st && st !== 'ok' ? color.amberDeep : color.body }}>{v.candidate.name}{suffix}</Text>
                {alts > 0 && <Chevron size={7} thickness={2} color={color.muted} dir="down" />}
              </Pressable>
            );
          })}
        </View>

        {/* 3. 3안 */}
        <Text style={[type.label, { color: color.muted }]}>직행 {Math.round(result.directMin)}분 기준 · {result.options.length}개 안</Text>
        {result.options.map((o, i) => {
          const selected = i === state.selectedOptionIdx;
          const eff = effectiveVisits(result, i, state.overrides);
          const names = [req.originName, ...eff.visits.map(v => v.candidate.name), req.destinationName];
          const pre = eff.timing.estimated ? '약 ' : '';
          return (
            <Pressable key={i} onPress={() => { if (!selected) { haptic(); flow.select(i); } }}>
              <Card elevated={selected} style={{ padding: selected ? 20 : 18, gap: selected ? 16 : 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={[type.labelPlain, { color: color.muted }]}>{optionTitle(result, i)}</Text>
                    <Text style={[selected ? type.displayXL : type.statL, { color: color.ink }]}>{pre}{Math.round(eff.timing.totalMin)}분</Text>
                  </View>
                  <Text style={[selected ? type.stat : type.statS, { color: color.amber }]}>+{Math.round(eff.timing.totalMin - result.directMin)}분</Text>
                </View>
                {selected && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {names.map((_, k) => (
                        <React.Fragment key={k}>
                          {k > 0 && <DottedLineH />}
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k === names.length - 1 ? color.green : color.primary }} />
                        </React.Fragment>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
                      {names.map((n, k) => (
                        <Text key={k} numberOfLines={1} style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 16, color: color.muted, textAlign: k === 0 ? 'left' : k === names.length - 1 ? 'right' : 'center' }}>{n}</Text>
                      ))}
                    </View>
                    <Hairline />
                    <Text style={[type.body, { color: color.body }]}>
                      {eff.visits.map((v, k) => `${v.candidate.name} ${hhmm(eff.timing.arrivals[k])}`).join(' → ')} → {hhmm(req.departAtMin + eff.timing.totalMin)}
                    </Text>
                  </>
                )}
              </Card>
            </Pressable>
          );
        })}

        {/* 4. 조건 완화 — 늦을 때만, 3안과 분리 */}
        {late && result.relaxed && (
          <View style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.stroke, borderRadius: 20, padding: 18, gap: 8 }}>
            <Text style={[type.labelPlain, { color: color.muted }]}>조건 완화 · {slotQuery(result.relaxed.droppedSlotId)} 제외</Text>
            <Text style={[type.statL, { color: color.ink }]}>{Math.round(result.relaxed.totalMin)}분 · {hhmm(req.departAtMin + result.relaxed.totalMin)} 도착</Text>
            <Text style={[type.caption, { color: color.muted }]}>필수 경유지가 아니면 이 안이 마감을 지켜요. 계획 화면에서 칩을 빼면 이 안으로 다시 계산해요.</Text>
          </View>
        )}
      </ScrollView>

      <View style={{ backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.hairline, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}>
        <PrimaryButton label={`${hhmm(arriveMin)} 도착 경로로 계속`} chevron height={56} borderRadius={18} onPress={confirm} />
        <Pressable onPress={() => { haptic(); navigation.navigate('Plan'); }} hitSlop={{ top: 8, bottom: 12, left: 20, right: 20 }}>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
            확정 전이라 언제든 대화로 바꿀 수 있어요 · <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.primary }}>대화로 바꾸기</Text>
          </Text>
        </Pressable>
      </View>
      <TabBar />

      <CandidateSheet
        visible={!!pickVisit}
        title={`${pickVisit?.candidate.name ?? ''} 교체`}
        candidates={sheetCands}
        currentId={pickVisit?.candidate.id}
        onPick={candId => pickSlot && flow.setOverride(state.selectedOptionIdx, pickSlot, candId)}
        onClose={() => setPickSlot(null)}
      />
    </View>
  );
}
```

`color.amberBg`·`color.amberDeep`·`color.stroke`는 기존 화면이 이미 쓴다. 없는 토큰이 있으면 tsc가 알려준다 — 가장 가까운 기존 토큰으로 바꾼다.

`?pick=1` 딥링크 자동 오픈은 뺀다(개발용이었고, 새 화면은 칩 탭으로 바로 열린다).

- [ ] **Step 2: 타입 검사와 전체 테스트**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc 출력 없음, 전부 pass

- [ ] **Step 3: 커밋** (Task 7 포함)

```bash
git add src/sheets/CandidateSheet.tsx src/screens/TimelineScreen.tsx src/screens/OptionsScreen.tsx
git commit -m "A5 추천 화면 — 답 먼저, 3안은 차이로 제목, 조건 완화 분리. A4는 props 기반

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: A2 칩 status·액션 시트·RESET, A8 재시도

**Files:**
- Modify: `src/screens/PlanScreen.tsx`
- Modify: `src/screens/ErrorScreen.tsx`

- [ ] **Step 1: PlanScreen**

1. import: `import { usePlanFlow } from '../state/planFlowProvider';` `import type { SlotStatus } from '../lib/routePlan/types';`
2. 컴포넌트 안: `const flow = usePlanFlow();` `const [chipMenu, setChipMenu] = useState<string | null>(null);`
3. 칩 status: `const statusOf = (chipId: string): SlotStatus | undefined => flow.state.result?.slotStatus[chipId];` — 슬롯 id가 칩 id다(Task 6 훅).
4. 칩 렌더: `onPress`를 `removeChip` 대신 `chip.kind === 'stop' ? setChipMenu(chip.id) : removeChip(chip.id)`로. 라벨 뒤에 status 접미:

```tsx
{chip.kind === 'stop' && statusOf(chip.id) && statusOf(chip.id) !== 'ok' ? ` · ${STATUS_TEXT[statusOf(chip.id)!]}` : ''}
```

(`STATUS_TEXT`는 OptionsScreen과 같은 표. `src/state/planFlowBridge.ts`로 옮겨 `export const SLOT_STATUS_TEXT`로 공유한다.)

5. `removeChip` 호출 뒤에는 항상 `flow.reset()`. `applyChat` 안 `applyIntent(intent)` 뒤에도 `flow.reset()`.
6. 액션 시트 — 파일 끝 `</Sheet>` 뒤에:

```tsx
      <Sheet visible={!!chipMenu} onClose={() => setChipMenu(null)}>
        <View style={{ padding: 20, gap: 10 }}>
          <Text style={[type.titleL, { color: color.ink }]}>{state.chips.find(c => c.id === chipMenu)?.label}</Text>
          {chipMenu && statusOf(chipMenu) && statusOf(chipMenu) !== 'ok' && (
            <Text style={[type.body, { color: color.muted }]}>{SLOT_STATUS_HELP[statusOf(chipMenu)!]}</Text>
          )}
          <PrimaryButton label="이 경유지 빼기" height={52} borderRadius={16} onPress={() => { if (chipMenu) removeChip(chipMenu); flow.reset(); setChipMenu(null); }} />
          <Pressable onPress={() => { haptic(); setChipMenu(null); }} style={{ minHeight: 52, borderRadius: 16, backgroundColor: color.track, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[type.btn, { color: color.body }]}>그대로 둘게요</Text>
          </Pressable>
        </View>
      </Sheet>
```

`SLOT_STATUS_HELP`(bridge에 export): `{ far: '경로 근처에 없어 멀리 있는 곳으로 잡았어요.', none: '경로 15km 안에서 못 찾았어요. 다른 말로 적어 보세요.', closed: '도착할 때쯤 문을 닫아요.', late: '들르면 마감을 못 지켜요.', short: '말한 개수만큼 못 찾았어요.' }`.

7. `impossible` 사전 체크 블록(`startSearch`의 if문과 `impossible` state·Sheet)은 제거한다. 판정은 A5가 실측으로 한다. `startSearch`는 `navigation.navigate('Calculating')`만.

- [ ] **Step 2: ErrorScreen**

- import `usePlanFlow`. `const flow = usePlanFlow();`
- 제목 `연결이 불안정해요` 아래 본문을 `flow.state.error?.kind === 'timeout' ? '12초 안에 계산이 끝나지 않았어요.' : '이동시간을 계산하지 못했어요.'`로.
- `다시 계산` 버튼: `flow.reset(); navigation.replace('Calculating');` (A3가 다시 start한다).
- 두 번째 버튼(`Timeline`으로 가던 것)은 `직행으로 진행`: `navigation.navigate('Plan')`으로 바꾸고 라벨을 `조건 바꾸기`로. 직행 자동 진행은 칩을 다 뺀 뒤 계산하는 것과 같으므로 별도 경로를 만들지 않는다.
- 고정 문구 `사람 적은 카페로 바꿔줘` 버블과 `planRows`는 목 잔재다 — 버블은 지우고, `planRows`는 `flow.state.request`가 있으면 요청의 경유지 검색어로, 없으면 빈 배열.

- [ ] **Step 3: 타입 검사와 전체 테스트**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc 출력 없음, 전부 pass

- [ ] **Step 4: 커밋**

```bash
git add src/screens/PlanScreen.tsx src/screens/ErrorScreen.tsx src/state/planFlowBridge.ts
git commit -m "A2 칩 status·액션 시트·RESET, A8 재시도 연결

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 시뮬레이터 확인과 기록

**Files:**
- Modify: `docs/NEXT.md`, `README.md`(화면 흐름 표 A3·A5 행)

- [ ] **Step 1: 시뮬레이터**

Metro가 떠 있으면 앱을 다시 띄운다(`xcrun simctl launch <udid> com.etavia.app` 또는 패널에서). 흐름: A1에서 목적지 선택 → 계획 만들기 → A2에 "올리브영 들르고 빵집" 입력 → 계산하기 → A3 단계가 실제로 바뀌는지 → A5 판정 카드·칩·3안 → 칩 탭 → A4 → 대안 선택 → 총시간 갱신 → CTA → 진행중 탭에 경유지 2개.
목 라우팅(서버 없음)이라 판정 카드에 "서버 없이 추정한 값이에요"가 보여야 한다. 스크린샷 3장(A3·A5·A4)을 `docs/screens/`에 남기지 말고 세션 스크래치에만.

- [ ] **Step 2: NEXT.md** §5 "남은 앱 작업"에 추가

```markdown
- **계획 흐름 재설계(2026-09-11)** — A2 칩 status·A3 실제 단계·A5 답 먼저·A4 props가 `planFlow` 스토어 위에서 돈다.
  확정 시 `toLegacyPlan`으로 기존 스토어에 넣는다. 스펙 `docs/superpowers/specs/2026-09-11-plan-flow-redesign-design.md`.
  남은 것: 2라운드 백그라운드 갱신(3초 예산), A6 이후의 이름 부분일치 잔재, 칩 `다른 종류로` 액션, 대중교통·도보 실측.
```

README `동작하는 것` 표의 A3·A5 행을 새 동작으로 고친다(문장 두 개면 된다).

- [ ] **Step 3: 커밋**

```bash
git add docs/NEXT.md README.md
git commit -m "NEXT.md·README — 계획 흐름 재설계 반영

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**

| 스펙 절 | 태스크 |
|---|---|
| 1 상태 planFlow | 2, 5 |
| 2 파이프라인(직행 재사용·검색·타임아웃·최소 표시) | 3, 6 |
| 3 플래너 추가분 | 1 |
| 4 A2 칩 status·액션 시트 | 9 (`다른 종류로`는 입력창 포커스뿐이라 이번엔 빼고 NEXT.md에 기록) |
| 4 A3 실제 단계 | 6 |
| 4 A5 답 먼저·경유지 행·3안 차이 제목·완화 카드·CTA·stale 배너 | 8 |
| 4 A4 props·추정 표시 | 7 |
| 5 확정 경계 | 4 |
| 6 실패·fallback | 3, 5, 9 |
| 7 테스트 | 1~4 단위, 10 시뮬레이터 |

**Placeholder scan:** 없음.

**Type consistency:** `PlanRequest.stops[].id` = 칩 id = 슬롯 id = `slotStatus` 키 (Task 6 훅 → Task 3 슬롯 → Task 8·9 조회). `effectiveVisits` 반환 `{visits, timing, option}`을 Task 4·8이 같은 이름으로 쓴다. `CandidateSheet` props(`visible,title,candidates,currentId,onPick,onClose`)를 Task 7 정의·Task 7(A6)·Task 8(A5)이 같게 쓴다. `Rescored`는 Task 1 types.ts 정의를 Task 4가 import.

**알려진 약점:** Task 8의 완화안 탭은 "계획 화면으로 돌아가 칩을 빼라"로 유도한다. 스펙은 "탭하면 완화안 선택"이라 했지만, 완화안을 확정하려면 칩 상태와 어긋난 계획이 남는다. 칩을 빼고 재계산하는 쪽이 일관된다. 스펙 문구를 구현 후 이렇게 고친다.
