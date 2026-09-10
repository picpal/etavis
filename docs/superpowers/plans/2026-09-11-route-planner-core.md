# Route Planner Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라우팅 API 없이 node 테스트로 검증되는 순수 플래너 모듈 `src/lib/routePlan/`과 회랑 검색 모듈을 만든다. 설계 문서의 1·1.5단계.

**Architecture:** 공급자(`RouteProvider`)를 인터페이스로 두고 목 공급자(haversine × 우회율, 선택적 "강" 장벽)로 알고리즘 전체를 시험한다. 직행 1회 → 회랑 투영 추정 → 조합 열거 → R회 실측 → section에서 leg 학습 → 전체 재채점 → 조건부 2라운드 → Q=3 선택 → 슬롯 status. 회랑 검색은 장소 검색 함수를 주입받아 확대 루프만 담당한다.

**Tech Stack:** TypeScript(strict), `node:test` + `tsx`, 기존 `src/lib/geo.ts`(haversineM, crossTrack, buildPolyline).

**Spec:** `docs/최적경로-설계.md`

## Global Constraints

- 시간은 **분 단위 정수/실수**, 좌표는 `{ latitude, longitude }`(기존 `LatLng`). 거리는 함수 이름에 단위를 붙인다(`…M`, `…Km`).
- 추정치로 후보를 **삭제하지 않는다.** 순위만 매긴다.
- `V = Σcount`. 같은 place id는 한 계획에 한 번만.
- 호출 수는 `PlanResult.apiCalls`로 항상 드러낸다. V=1: 직행 1 + 후보 전부. V≥2: 직행 1 + R=4 (+2~3 조건부) (+1 조건 완화안).
- 테스트는 `npm test`(= `tsx --test 'src/**/*.test.ts'`). 테스트 파일은 `*.test.ts`, tsc 검사 대상에서 제외돼 있다.
- 커밋 메시지는 한국어 한 줄 + 본문, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- UI(`OptionsScreen`, `CandidateSheet`, `plan.tsx`)는 **이 계획에서 건드리지 않는다.** 그건 다음 계획이다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/routePlan/types.ts` | 입력·출력·공급자 인터페이스. 런타임 코드 없음 |
| `src/lib/routePlan/corridor.ts` | 폴리라인 투영(`s`, 부호 있는 `y`), 추정 leg 거리 `g`, 추정기 A/B/C |
| `src/lib/routePlan/enumerate.ts` | count 확장, 중복 금지, locked 부분 순서, beam 열거 |
| `src/lib/routePlan/legs.ts` | leg 저장소(출발시각 차 규칙), route 응답에서 leg 학습 |
| `src/lib/routePlan/score.ts` | 실측+추정 혼합 채점, 누적 도착시각, 영업시간 검사 |
| `src/lib/routePlan/select.ts` | 시드 R개 선택, 2라운드 트리거, Q=3 Jaccard 선택 |
| `src/lib/routePlan/mockProvider.ts` | 테스트용 라우팅 공급자(우회율, 장벽, 호출 카운트) |
| `src/lib/routePlan/plan.ts` | 오케스트레이터 `plan(input, provider)` |
| `src/lib/corridorSearch.ts` | 회랑 5점 검색 + 확대 루프 + 검색 status |

각 파일 옆에 같은 이름의 `*.test.ts`.

---

### Task 1: 테스트 러너를 tsx로

**Files:**
- Modify: `package.json` (scripts.test, devDependencies)

**Interfaces:**
- Produces: `npm test`가 확장자 없는 import를 가진 `.ts`를 실행한다.

- [ ] **Step 1: tsx 설치**

```bash
npm i -D tsx
```

- [ ] **Step 2: 스크립트 교체**

`package.json`의 `"test": "node --test 'src/**/*.test.ts'"` 를 아래로 바꾼다.

```json
"test": "tsx --test 'src/**/*.test.ts'"
```

- [ ] **Step 3: 기존 테스트가 여전히 통과하는지**

Run: `npm test`
Expected: `ℹ pass 7` / `ℹ fail 0`

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json
git commit -m "테스트 러너를 tsx로 — 확장자 없는 import를 node --test가 못 풀어서

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 타입 정의

**Files:**
- Create: `src/lib/routePlan/types.ts`

**Interfaces:**
- Produces: 아래 타입 전부. 이후 모든 태스크가 이 이름을 그대로 쓴다.

- [ ] **Step 1: 타입 파일 작성**

```ts
/**
 * 최적 경로 플래너의 계약. 런타임 코드 없음.
 * 설계: docs/최적경로-설계.md
 */
import type { LatLng } from '../../data/mockData';

export type { LatLng };
export type Mode = 'car' | 'walk' | 'transit';

/** 장소 검색에서 온 후보 한 곳 */
export type PlaceCandidate = {
  id: string;
  name: string;
  coord: LatLng;
  /** 분 단위 하루 시각. 없으면 항상 열려 있다고 본다 */
  hours?: { openMin: number; closeMin: number };
  parking?: '가능' | '어려움' | '없음';
};

/** 검색 단계가 붙이는 상태. 플래너는 이걸 슬롯 status로 승격한다 */
export type SearchStatus = 'ok' | 'far' | 'none' | 'short';

export type Slot = {
  id: string;
  query: string;
  candidates: PlaceCandidate[];
  dwellMin: number;
  /** 같은 종류를 몇 곳. 기본 1 */
  count: number;
  /** false면 candidates[0] 한 곳으로 고정 */
  flexible: boolean;
  openNow: boolean;
  searchStatus?: SearchStatus;
};

export type PlanInput = {
  origin: LatLng;
  destination: LatLng;
  /** 하루 기준 분(0~1439) */
  departAtMin: number;
  arriveByMin?: number;
  mode: Mode;
  slots: Slot[];
  order: 'auto' | 'locked';
};

export type RouteSection = { durationMin: number; distanceKm: number };
export type RouteResult = {
  durationMin: number;
  distanceKm: number;
  polyline: LatLng[];
  /** points.length - 1 개. 경유지 사이 구간 */
  sections: RouteSection[];
};

export interface RouteProvider {
  /** points[0]=출발, 마지막=도착, 사이가 경유지(≤5) */
  route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult>;
}

/** 계획 속 한 방문 */
export type Visit = { slotId: string; candidate: PlaceCandidate; dwellMin: number };

export type SlotStatus = 'ok' | 'far' | 'none' | 'closed' | 'late' | 'short';

export type PlanOption = {
  visits: Visit[];
  totalMin: number;
  deltaMin: number;
  /** 각 방문의 도착 시각(분), 마지막은 목적지 */
  arrivals: number[];
  /** arriveBy 대비 여유. arriveBy 없으면 null */
  slackMin: number | null;
  distanceKm: number;
};

export type Alternative = {
  slotId: string;
  candidate: PlaceCandidate;
  /** 1안 대비 추가 시간 */
  addedMin: number;
  detourKm: number;
  /** 실측 leg가 없어 추정치인가 */
  estimated: boolean;
};

export type PlanResult = {
  directMin: number;
  directKm: number;
  options: PlanOption[];
  /** arriveBy 위반 시 가장 비싼 슬롯을 뺀 안 */
  relaxed?: PlanOption & { droppedSlotId: string };
  alternatives: Alternative[];
  slotStatus: Record<string, SlotStatus>;
  apiCalls: number;
};
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit -p .`
Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/routePlan/types.ts
git commit -m "플래너 타입 — 입력·출력·RouteProvider 계약

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 회랑 투영과 추정기

**Files:**
- Create: `src/lib/routePlan/corridor.ts`
- Test: `src/lib/routePlan/corridor.test.ts`

**Interfaces:**
- Consumes: `crossTrack`, `haversineM`, `polylineLengthM` from `../geo`
- Produces:
  - `type CorridorPoint = { x: number; y: number; s: number }` (m, 부호 있는 m, 0~1)
  - `projectOnCorridor(poly: LatLng[], p: LatLng): CorridorPoint`
  - `corridorLegM(a: CorridorPoint, b: CorridorPoint): number` — `g(u,v)`
  - `estimateA(seq: CorridorPoint[]): number`, `estimateB(seq: LatLng[]): number`, `estimateC(a: number, b: number): number` (전부 m)
  - `originPoint(): CorridorPoint`, `destinationPoint(lengthM: number): CorridorPoint`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline } from '../geo';
import {
  corridorLegM, destinationPoint, estimateA, estimateB, estimateC, originPoint, projectOnCorridor,
} from './corridor';

// 동서로 뻗은 10km 직선. 위도 37.5에서 경도 0.1136° ≈ 10km
const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const poly = buildPolyline([O, D], 32);

test('경로 위 중간점은 s≈0.5, y≈0', () => {
  const mid = { latitude: 37.5, longitude: 127.0568 };
  const p = projectOnCorridor(poly, mid);
  assert.ok(Math.abs(p.s - 0.5) < 0.02, `s=${p.s}`);
  assert.ok(Math.abs(p.y) < 50, `y=${p.y}`);
});

test('왼쪽(북쪽)은 y>0, 오른쪽(남쪽)은 y<0', () => {
  const north = projectOnCorridor(poly, { latitude: 37.509, longitude: 127.0568 });
  const south = projectOnCorridor(poly, { latitude: 37.491, longitude: 127.0568 });
  assert.ok(north.y > 800 && north.y < 1200, `north y=${north.y}`);
  assert.ok(south.y < -800 && south.y > -1200, `south y=${south.y}`);
});

test('역주행 leg는 같은 거리라도 벌점이 붙는다', () => {
  const a = { x: 2000, y: 0, s: 0.2 };
  const b = { x: 5000, y: 0, s: 0.5 };
  assert.equal(corridorLegM(a, b), 3000);
  assert.equal(corridorLegM(b, a), 3000 + 1500);
});

test('추정기 A/B/C — 경로 위 후보는 직행과 거의 같다', () => {
  const L = 10_000;
  const mid = { latitude: 37.5, longitude: 127.0568 };
  const seqA = [originPoint(), projectOnCorridor(poly, mid), destinationPoint(L)];
  const a = estimateA(seqA);
  const b = estimateB([O, mid, D]);
  assert.ok(Math.abs(a - L) < 200, `A=${a}`);
  assert.ok(Math.abs(b - L) < 200, `B=${b}`);
  assert.ok(Math.abs(estimateC(a, b) - L) < 200);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/corridor.test.ts`
Expected: FAIL — `Cannot find module './corridor'`

- [ ] **Step 3: 구현**

```ts
/**
 * 직행 폴리라인 기준 회랑 좌표.
 * x = 진행 거리(m), y = 부호 있는 수직 거리(m, 진행 방향 왼쪽이 +), s = x/L.
 * 설계 2단계 — 추정기 A(회랑), B(haversine), C(결합).
 */
import { crossTrack, haversineM, polylineLengthM } from '../geo';
import type { LatLng } from './types';

export type CorridorPoint = { x: number; y: number; s: number };

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** 부호: 선분 a→b 기준으로 p가 왼쪽이면 +1 */
function sideSign(a: LatLng, b: LatLng, p: LatLng): 1 | -1 {
  const k = Math.cos(toRad(a.latitude));
  const abx = toRad(b.longitude - a.longitude) * k;
  const aby = toRad(b.latitude - a.latitude);
  const apx = toRad(p.longitude - a.longitude) * k;
  const apy = toRad(p.latitude - a.latitude);
  return abx * apy - aby * apx >= 0 ? 1 : -1;
}

export function projectOnCorridor(poly: LatLng[], p: LatLng): CorridorPoint {
  const L = polylineLengthM(poly);
  const ct = crossTrack(p, poly);
  const a = poly[ct.index];
  const b = poly[Math.min(poly.length - 1, ct.index + 1)];
  return { x: ct.progressM, y: sideSign(a, b, p) * ct.distanceM, s: L === 0 ? 0 : ct.progressM / L };
}

export const originPoint = (): CorridorPoint => ({ x: 0, y: 0, s: 0 });
export const destinationPoint = (lengthM: number): CorridorPoint => ({ x: lengthM, y: 0, s: 1 });

/** g(u,v) = |p(u)−p(v)| + 0.5·max(0, x(u)−x(v)) — 역주행 벌점 */
export function corridorLegM(a: CorridorPoint, b: CorridorPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y) + 0.5 * Math.max(0, a.x - b.x);
}

export function estimateA(seq: CorridorPoint[]): number {
  let sum = 0;
  for (let i = 0; i < seq.length - 1; i++) sum += corridorLegM(seq[i], seq[i + 1]);
  return sum;
}

export function estimateB(seq: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < seq.length - 1; i++) sum += haversineM(seq[i], seq[i + 1]);
  return sum;
}

export const estimateC = (a: number, b: number): number => 0.35 * a + 0.65 * b;

/** 미사용 경고 방지용 재수출 — 다른 모듈이 R를 쓸 일은 없다 */
export const EARTH_RADIUS_M = R;
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/corridor.test.ts`
Expected: 4 pass

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/corridor.ts src/lib/routePlan/corridor.test.ts
git commit -m "회랑 투영과 추정기 A/B/C — 부호 있는 수직거리, 역주행 벌점

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 조합 열거

**Files:**
- Create: `src/lib/routePlan/enumerate.ts`
- Test: `src/lib/routePlan/enumerate.test.ts`

**Interfaces:**
- Consumes: `Slot`, `Visit`, `PlaceCandidate` from `./types`
- Produces:
  - `enumeratePlans(slots: Slot[], order: 'auto' | 'locked', partialScore: (seq: Visit[]) => number, beamWidth: number): Visit[][]`
  - `totalVisits(slots: Slot[]): number` (= V)
  - `effectiveCandidates(slot: Slot): PlaceCandidate[]` (flexible=false면 첫 하나)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCandidates, enumeratePlans, totalVisits } from './enumerate';
import type { PlaceCandidate, Slot, Visit } from './types';

const c = (id: string): PlaceCandidate => ({ id, name: id, coord: { latitude: 0, longitude: 0 } });
const slot = (id: string, ids: string[], extra: Partial<Slot> = {}): Slot => ({
  id, query: id, candidates: ids.map(c), dwellMin: 5, count: 1, flexible: true, openNow: false, ...extra,
});
const key = (p: Visit[]) => p.map(v => v.candidate.id).join('>');
const noScore = () => 0;

test('V = Σcount', () => {
  assert.equal(totalVisits([slot('a', ['a1']), slot('b', ['b1'], { count: 3 })]), 4);
});

test('flexible=false는 첫 후보로 고정', () => {
  const s = slot('a', ['a1', 'a2'], { flexible: false });
  assert.deepEqual(effectiveCandidates(s).map(x => x.id), ['a1']);
});

test('슬롯 2개 × 후보 2개, auto → 2·2·2! = 8개', () => {
  const plans = enumeratePlans([slot('a', ['a1', 'a2']), slot('b', ['b1', 'b2'])], 'auto', noScore, Infinity);
  assert.equal(plans.length, 8);
  assert.ok(plans.some(p => key(p) === 'b2>a1'));
});

test('locked면 슬롯 순서 고정 → 4개', () => {
  const plans = enumeratePlans([slot('a', ['a1', 'a2']), slot('b', ['b1', 'b2'])], 'locked', noScore, Infinity);
  assert.equal(plans.length, 4);
  assert.ok(plans.every(p => p[0].slotId === 'a' && p[1].slotId === 'b'));
});

test('count=3은 같은 슬롯에서 서로 다른 3곳, 중복 없음', () => {
  const plans = enumeratePlans([slot('a', ['a1', 'a2', 'a3', 'a4'], { count: 3 })], 'auto', noScore, Infinity);
  // C(4,3) × 3! = 24
  assert.equal(plans.length, 24);
  for (const p of plans) assert.equal(new Set(p.map(v => v.candidate.id)).size, 3);
});

test('beam은 부분 점수 낮은 쪽을 남긴다', () => {
  // 점수 = 후보 id 끝자리 합. a1,b1 조합이 최선
  const score = (seq: Visit[]) => seq.reduce((s, v) => s + Number(v.candidate.id.slice(1)), 0);
  const plans = enumeratePlans([slot('a', ['a1', 'a9']), slot('b', ['b1', 'b9'])], 'auto', score, 1);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].map(v => v.candidate.id).sort(), ['a1', 'b1']);
});

test('빈 슬롯은 건너뛴다', () => {
  const plans = enumeratePlans([slot('a', []), slot('b', ['b1'])], 'auto', noScore, Infinity);
  assert.equal(plans.length, 1);
  assert.equal(key(plans[0]), 'b1');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/enumerate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 방문 순열 열거. V ≤ 3은 전수(beamWidth=Infinity), V ≥ 4는 beam.
 * 상태 = (지금까지 순서, 쓴 후보 id, 슬롯별 남은 방문 수).
 */
import type { PlaceCandidate, Slot, Visit } from './types';

export function effectiveCandidates(slot: Slot): PlaceCandidate[] {
  if (!slot.flexible && slot.candidates.length > 0) return [slot.candidates[0]];
  return slot.candidates;
}

export function totalVisits(slots: Slot[]): number {
  return slots.reduce((n, s) => n + (s.candidates.length ? Math.max(1, s.count) : 0), 0);
}

type State = { seq: Visit[]; used: Set<string>; remain: number[] };

export function enumeratePlans(
  slots: Slot[],
  order: 'auto' | 'locked',
  partialScore: (seq: Visit[]) => number,
  beamWidth: number,
): Visit[][] {
  const active = slots.filter(s => s.candidates.length > 0);
  const V = totalVisits(active);
  let frontier: State[] = [{ seq: [], used: new Set(), remain: active.map(s => Math.max(1, s.count)) }];

  for (let depth = 0; depth < V; depth++) {
    const next: State[] = [];
    for (const st of frontier) {
      // locked: 남은 첫 슬롯만. auto: 남은 모든 슬롯
      const slotIdx = st.remain.map((r, i) => (r > 0 ? i : -1)).filter(i => i >= 0);
      const choices = order === 'locked' ? slotIdx.slice(0, 1) : slotIdx;
      for (const i of choices) {
        const slot = active[i];
        for (const cand of effectiveCandidates(slot)) {
          if (st.used.has(cand.id)) continue;
          const remain = st.remain.slice();
          remain[i]--;
          next.push({
            seq: [...st.seq, { slotId: slot.id, candidate: cand, dwellMin: slot.dwellMin }],
            used: new Set([...st.used, cand.id]),
            remain,
          });
        }
      }
    }
    if (next.length > beamWidth) {
      next.sort((a, b) => partialScore(a.seq) - partialScore(b.seq));
      next.length = beamWidth;
    }
    frontier = next;
  }
  // 같은 슬롯 count>1은 순서가 달라도 같은 집합 → 순열 그대로 둔다(순서가 곧 경로)
  return frontier.map(s => s.seq);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/enumerate.test.ts`
Expected: 7 pass

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/enumerate.ts src/lib/routePlan/enumerate.test.ts
git commit -m "조합 열거 — count 확장, 중복 금지, locked, beam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: leg 저장소와 학습

**Files:**
- Create: `src/lib/routePlan/legs.ts`
- Test: `src/lib/routePlan/legs.test.ts`

**Interfaces:**
- Consumes: `Mode`, `RouteResult` from `./types`
- Produces:
  - `class LegStore { add(fromId, toId, mode, leg: { durationMin, distanceKm, departAtMin }): void; lookup(fromId, toId, mode, departAtMin): { durationMin, distanceKm, uncertaintyMin } | null; size: number }`
  - `learnLegs(store: LegStore, pointIds: string[], route: RouteResult, departAtMin: number, dwellsMin: number[], mode: Mode): void` — `dwellsMin`은 경유지별(길이 = pointIds.length − 2)
  - 상수 `ORIGIN_ID = 'O'`, `DEST_ID = 'D'`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEST_ID, LegStore, learnLegs, ORIGIN_ID } from './legs';

test('출발시각 차 ≤5분이면 그대로', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  const got = s.lookup('a', 'b', 'car', 504);
  assert.deepEqual(got, { durationMin: 10, distanceKm: 4, uncertaintyMin: 0 });
});

test('5~15분이면 불확실성 max(1, 0.1×leg)', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 30, distanceKm: 12, departAtMin: 500 });
  assert.equal(s.lookup('a', 'b', 'car', 512)!.uncertaintyMin, 3);
  s.add('c', 'd', 'car', { durationMin: 4, distanceKm: 1, departAtMin: 500 });
  assert.equal(s.lookup('c', 'd', 'car', 512)!.uncertaintyMin, 1);
});

test('>15분이면 미실측', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  assert.equal(s.lookup('a', 'b', 'car', 520), null);
});

test('방향과 모드가 다르면 다른 leg', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  assert.equal(s.lookup('b', 'a', 'car', 500), null);
  assert.equal(s.lookup('a', 'b', 'walk', 500), null);
});

test('도보는 시각 차를 무시한다', () => {
  const s = new LegStore();
  s.add('a', 'b', 'walk', { durationMin: 10, distanceKm: 0.8, departAtMin: 500 });
  assert.equal(s.lookup('a', 'b', 'walk', 700)!.uncertaintyMin, 0);
});

test('가장 가까운 시각의 실측을 고른다', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  s.add('a', 'b', 'car', { durationMin: 14, distanceKm: 4, departAtMin: 530 });
  assert.equal(s.lookup('a', 'b', 'car', 528)!.durationMin, 14);
});

test('learnLegs — section마다 출발시각을 누적(이동 + dwell)해서 넣는다', () => {
  const s = new LegStore();
  learnLegs(
    s, [ORIGIN_ID, 'c1', 'c2', DEST_ID],
    { durationMin: 30, distanceKm: 12, polyline: [], sections: [
      { durationMin: 10, distanceKm: 4 }, { durationMin: 8, distanceKm: 3 }, { durationMin: 12, distanceKm: 5 },
    ] },
    480, [15, 5], 'car',
  );
  assert.equal(s.size, 3);
  assert.equal(s.lookup(ORIGIN_ID, 'c1', 'car', 480)!.durationMin, 10);
  // c1 출발 = 480 + 10 + 15 = 505
  assert.equal(s.lookup('c1', 'c2', 'car', 505)!.uncertaintyMin, 0);
  // c2 출발 = 505 + 8 + 5 = 518
  assert.equal(s.lookup('c2', DEST_ID, 'car', 518)!.durationMin, 12);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/legs.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * leg 저장소. 설계 4단계의 재사용 규칙:
 *   자동차  Δ≤5분 그대로 · 5~15분 불확실성 max(1, 0.1×leg) · >15분 미실측
 *   도보    시각 무시
 * 키는 (from, to, mode). 같은 키에 여러 시각의 실측이 쌓일 수 있다.
 */
import type { Mode, RouteResult } from './types';

export const ORIGIN_ID = 'O';
export const DEST_ID = 'D';

export type MeasuredLeg = { durationMin: number; distanceKm: number; departAtMin: number };
export type LegLookup = { durationMin: number; distanceKm: number; uncertaintyMin: number };

const EXACT_MIN = 5;
const PROVISIONAL_MIN = 15;

export class LegStore {
  private map = new Map<string, MeasuredLeg[]>();

  private key(from: string, to: string, mode: Mode) {
    return `${from}>${to}|${mode}`;
  }

  get size(): number {
    let n = 0;
    for (const v of this.map.values()) n += v.length;
    return n;
  }

  add(from: string, to: string, mode: Mode, leg: MeasuredLeg): void {
    const k = this.key(from, to, mode);
    const list = this.map.get(k) ?? [];
    list.push(leg);
    this.map.set(k, list);
  }

  lookup(from: string, to: string, mode: Mode, departAtMin: number): LegLookup | null {
    const list = this.map.get(this.key(from, to, mode));
    if (!list || list.length === 0) return null;
    const best = list.reduce((a, b) =>
      Math.abs(b.departAtMin - departAtMin) < Math.abs(a.departAtMin - departAtMin) ? b : a,
    );
    const delta = Math.abs(best.departAtMin - departAtMin);
    if (mode === 'walk' || delta <= EXACT_MIN) {
      return { durationMin: best.durationMin, distanceKm: best.distanceKm, uncertaintyMin: 0 };
    }
    if (delta <= PROVISIONAL_MIN) {
      return {
        durationMin: best.durationMin,
        distanceKm: best.distanceKm,
        uncertaintyMin: Math.max(1, 0.1 * best.durationMin),
      };
    }
    return null;
  }
}

/** route 응답의 section을 leg로 쪼개 넣는다. 출발시각은 이동 + dwell을 누적한다 */
export function learnLegs(
  store: LegStore,
  pointIds: string[],
  route: RouteResult,
  departAtMin: number,
  dwellsMin: number[],
  mode: Mode,
): void {
  let clock = departAtMin;
  for (let i = 0; i < route.sections.length; i++) {
    const sec = route.sections[i];
    store.add(pointIds[i], pointIds[i + 1], mode, {
      durationMin: sec.durationMin,
      distanceKm: sec.distanceKm,
      departAtMin: clock,
    });
    clock += sec.durationMin + (dwellsMin[i] ?? 0);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/legs.test.ts`
Expected: 7 pass

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/legs.ts src/lib/routePlan/legs.test.ts
git commit -m "leg 저장소 — 출발시각 차 규칙과 section 학습

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 채점 — 실측+추정 혼합, 도착시각, 영업시간

**Files:**
- Create: `src/lib/routePlan/score.ts`
- Test: `src/lib/routePlan/score.test.ts`

**Interfaces:**
- Consumes: `LegStore`, `ORIGIN_ID`, `DEST_ID` from `./legs`; `CorridorPoint`, `corridorLegM`, `originPoint`, `destinationPoint` from `./corridor`; `haversineM` from `../geo`
- Produces:
  - `type ScoreContext = { origin: LatLng; destination: LatLng; corridorOf: (id: string) => CorridorPoint; corridorLengthM: number; rhoMinPerKm: number; mode: Mode; departAtMin: number; legs: LegStore }`
  - `type Scored = { visits: Visit[]; totalMin: number; distanceKm: number; arrivals: number[]; unknownLegs: number; uncertaintyMin: number; legsMin: number[] }`
  - `scorePlan(visits: Visit[], ctx: ScoreContext): Scored`
  - `estimateLegKm(from: LatLng, to: LatLng, cFrom: CorridorPoint, cTo: CorridorPoint): number` — `C` 추정 (km)
  - `isOpenAt(c: PlaceCandidate, minuteOfDay: number): boolean`
  - `allClosedAtArrival(scored: Scored): boolean`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, polylineLengthM } from '../geo';
import { projectOnCorridor } from './corridor';
import { DEST_ID, LegStore, ORIGIN_ID } from './legs';
import { allClosedAtArrival, isOpenAt, scorePlan, type ScoreContext } from './score';
import type { PlaceCandidate, Visit } from './types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km 동쪽
const poly = buildPolyline([O, D], 32);
const L = polylineLengthM(poly);
const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: { latitude: 37.5, longitude: 127.0568 } };
const c2: PlaceCandidate = { id: 'c2', name: 'c2', coord: { latitude: 37.5, longitude: 127.0852 } };
const cp = new Map([[c1.id, projectOnCorridor(poly, c1.coord)], [c2.id, projectOnCorridor(poly, c2.coord)]]);

function ctx(legs = new LegStore()): ScoreContext {
  return {
    origin: O, destination: D, corridorLengthM: L, rhoMinPerKm: 2, mode: 'car', departAtMin: 480, legs,
    corridorOf: id => cp.get(id)!,
  };
}
const v = (c: PlaceCandidate, dwellMin = 10): Visit => ({ slotId: c.id, candidate: c, dwellMin });

test('추정만으로 채점 — 경로 위 후보 1곳: 이동 ≈ 20분 + 체류 10분', () => {
  const s = scorePlan([v(c1)], ctx());
  assert.equal(s.unknownLegs, 2);
  assert.ok(Math.abs(s.totalMin - 30) < 1.5, `total=${s.totalMin}`);
  assert.equal(s.arrivals.length, 2);
  assert.ok(Math.abs(s.arrivals[0] - 490) < 1);
  assert.ok(Math.abs(s.arrivals[1] - 510) < 1.5);
});

test('실측 leg가 있으면 그 값을 쓰고 unknownLegs가 준다', () => {
  const legs = new LegStore();
  legs.add(ORIGIN_ID, 'c1', 'car', { durationMin: 13, distanceKm: 5, departAtMin: 480 });
  const s = scorePlan([v(c1)], ctx(legs));
  assert.equal(s.unknownLegs, 1);
  assert.equal(s.legsMin[0], 13);
  assert.equal(s.arrivals[0], 493);
});

test('불확실성은 합산된다', () => {
  const legs = new LegStore();
  legs.add(ORIGIN_ID, 'c1', 'car', { durationMin: 20, distanceKm: 5, departAtMin: 470 }); // Δ10 → 2분
  legs.add('c1', DEST_ID, 'car', { durationMin: 10, distanceKm: 5, departAtMin: 500 });    // Δ0
  const s = scorePlan([v(c1)], ctx(legs));
  assert.equal(s.unknownLegs, 0);
  assert.equal(s.uncertaintyMin, 2);
});

test('두 곳 — 순서대로 도착시각이 누적된다', () => {
  const s = scorePlan([v(c1), v(c2, 5)], ctx());
  assert.equal(s.arrivals.length, 3);
  assert.ok(s.arrivals[0] < s.arrivals[1] && s.arrivals[1] < s.arrivals[2]);
});

test('isOpenAt — hours 없으면 열림, 자정 넘는 영업시간 처리', () => {
  assert.equal(isOpenAt(c1, 100), true);
  const day = { ...c1, hours: { openMin: 600, closeMin: 1320 } };
  assert.equal(isOpenAt(day, 599), false);
  assert.equal(isOpenAt(day, 600), true);
  assert.equal(isOpenAt(day, 1320), false);
  const night = { ...c1, hours: { openMin: 1200, closeMin: 120 } };
  assert.equal(isOpenAt(night, 30), true);
  assert.equal(isOpenAt(night, 600), false);
});

test('allClosedAtArrival — 도착 시각 기준', () => {
  const closed = { ...c1, hours: { openMin: 600, closeMin: 1320 } };
  const s = scorePlan([v(closed)], ctx()); // 도착 ≈ 490 < 600
  assert.equal(allClosedAtArrival(s), true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/score.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 계획 하나의 채점. 실측 leg는 실측값, 없는 leg만 추정치(C 추정 × ρ).
 * 도착시각을 누적하고 영업시간을 그 시각으로 검사한다. 설계 4단계.
 */
import { haversineM } from '../geo';
import { corridorLegM, destinationPoint, estimateC, originPoint, type CorridorPoint } from './corridor';
import { DEST_ID, LegStore, ORIGIN_ID } from './legs';
import type { LatLng, Mode, PlaceCandidate, Visit } from './types';

export type ScoreContext = {
  origin: LatLng;
  destination: LatLng;
  corridorOf: (id: string) => CorridorPoint;
  corridorLengthM: number;
  /** 분/km. 직행 실측에서 온다 */
  rhoMinPerKm: number;
  mode: Mode;
  departAtMin: number;
  legs: LegStore;
};

export type Scored = {
  visits: Visit[];
  totalMin: number;
  distanceKm: number;
  /** 방문별 도착, 마지막은 목적지 */
  arrivals: number[];
  unknownLegs: number;
  uncertaintyMin: number;
  legsMin: number[];
};

export function estimateLegKm(from: LatLng, to: LatLng, cFrom: CorridorPoint, cTo: CorridorPoint): number {
  return estimateC(corridorLegM(cFrom, cTo), haversineM(from, to)) / 1000;
}

export function scorePlan(visits: Visit[], ctx: ScoreContext): Scored {
  const ids = [ORIGIN_ID, ...visits.map(v => v.candidate.id), DEST_ID];
  const coords = [ctx.origin, ...visits.map(v => v.candidate.coord), ctx.destination];
  const cps = [originPoint(), ...visits.map(v => ctx.corridorOf(v.candidate.id)), destinationPoint(ctx.corridorLengthM)];

  let clock = ctx.departAtMin;
  let distanceKm = 0;
  let unknownLegs = 0;
  let uncertaintyMin = 0;
  const arrivals: number[] = [];
  const legsMin: number[] = [];

  for (let i = 0; i < ids.length - 1; i++) {
    const hit = ctx.legs.lookup(ids[i], ids[i + 1], ctx.mode, clock);
    let legMin: number;
    if (hit) {
      legMin = hit.durationMin;
      distanceKm += hit.distanceKm;
      uncertaintyMin += hit.uncertaintyMin;
    } else {
      const km = estimateLegKm(coords[i], coords[i + 1], cps[i], cps[i + 1]);
      legMin = km * ctx.rhoMinPerKm;
      distanceKm += km;
      unknownLegs++;
    }
    legsMin.push(legMin);
    clock += legMin;
    arrivals.push(clock);
    if (i < visits.length) clock += visits[i].dwellMin;
  }

  return { visits, totalMin: clock - ctx.departAtMin, distanceKm, arrivals, unknownLegs, uncertaintyMin, legsMin };
}

export function isOpenAt(c: PlaceCandidate, minuteOfDay: number): boolean {
  if (!c.hours) return true;
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const { openMin, closeMin } = c.hours;
  if (openMin <= closeMin) return m >= openMin && m < closeMin;
  return m >= openMin || m < closeMin; // 자정을 넘는 영업
}

/** 계획의 모든 방문지가 도착 시각에 닫혀 있나 */
export function allClosedAtArrival(s: Scored): boolean {
  if (s.visits.length === 0) return false;
  return s.visits.every((v, i) => !isOpenAt(v.candidate, s.arrivals[i]));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/score.test.ts`
Expected: 6 pass

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/score.ts src/lib/routePlan/score.test.ts
git commit -m "계획 채점 — 실측·추정 혼합, 누적 도착시각, 영업시간 검사

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 선택 — 시드 R개, 2라운드 트리거, Q=3

**Files:**
- Create: `src/lib/routePlan/select.ts`
- Test: `src/lib/routePlan/select.test.ts`

**Interfaces:**
- Consumes: `Visit` from `./types`; `Scored` from `./score`
- Produces:
  - `type Ranked = { visits: Visit[]; estA: number; estB: number; estC: number }` (전부 분)
  - `planKey(visits: Visit[]): string` — `'c1>c2'`
  - `jaccard(a: Iterable<string>, b: Iterable<string>): number`
  - `candidateSet(v: Visit[]): Set<string>`, `legSet(v: Visit[]): Set<string>` ('O>c1', 'c1>D' …)
  - `pickSeeds(ranked: Ranked[], R: number): Visit[][]` — C 상위 2 + A 1위 + B 1위 + overlap 최저로 채움
  - `deltaMaxMin(directMin: number): number` — `clamp(0.15·direct, 2, 8)`
  - `marginMin(directMin: number): number` — `max(2, 0.08·direct)`
  - `pickOptions(measured: Scored[], directMin: number, q: number): Scored[]`
  - `type Round2Input = { measured: Scored[]; rescored: Scored[]; legErrors: { measuredMin: number; estimatedMin: number }[]; arriveByMin?: number; directMin: number }`
  - `round2Plan(input: Round2Input): { extra: Visit[][]; reason: string | null }` — 추가 실측 대상(최대 3)

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateSet, deltaMaxMin, jaccard, legSet, marginMin, pickOptions, pickSeeds, planKey, round2Plan, type Ranked,
} from './select';
import type { PlaceCandidate, Visit } from './types';
import type { Scored } from './score';

const c = (id: string): PlaceCandidate => ({ id, name: id, coord: { latitude: 0, longitude: 0 } });
const vs = (...ids: string[]): Visit[] => ids.map(id => ({ slotId: id[0], candidate: c(id), dwellMin: 5 }));
const ranked = (ids: string[], a: number, b: number, cc: number): Ranked => ({ visits: vs(...ids), estA: a, estB: b, estC: cc });
const scored = (ids: string[], totalMin: number, extra: Partial<Scored> = {}): Scored => ({
  visits: vs(...ids), totalMin, distanceKm: 0, arrivals: [], unknownLegs: 0, uncertaintyMin: 0, legsMin: [], ...extra,
});

test('planKey · 집합', () => {
  assert.equal(planKey(vs('a1', 'b1')), 'a1>b1');
  assert.deepEqual([...candidateSet(vs('a1', 'b1'))], ['a1', 'b1']);
  assert.deepEqual([...legSet(vs('a1', 'b1'))], ['O>a1', 'a1>b1', 'b1>D']);
});

test('jaccard', () => {
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(jaccard([], []), 0);
});

test('pickSeeds — C 상위 2, A 1위, B 1위, 나머지는 overlap 최저', () => {
  const r = [
    ranked(['a1', 'b1'], 30, 30, 30),
    ranked(['a1', 'b2'], 31, 31, 31),
    ranked(['a2', 'b1'], 10, 50, 36),  // A 1위
    ranked(['a2', 'b2'], 50, 10, 36),  // B 1위
    ranked(['b1', 'a1'], 33, 33, 33),
  ];
  const seeds = pickSeeds(r, 4).map(planKey);
  assert.deepEqual(seeds, ['a1>b1', 'a1>b2', 'a2>b1', 'a2>b2']);
});

test('pickSeeds — A/B 1위가 C 상위와 겹치면 overlap 최저로 채운다', () => {
  const r = [
    ranked(['a1', 'b1'], 10, 10, 10),
    ranked(['a1', 'b2'], 11, 11, 11),
    ranked(['a2', 'b2'], 30, 30, 30),
    ranked(['b1', 'a1'], 12, 12, 12), // a1,b1과 후보 집합 동일
  ];
  const seeds = pickSeeds(r, 4).map(planKey);
  assert.equal(seeds.length, 4);
  assert.equal(seeds[2], 'a2>b2'); // 겹침이 가장 적은 안이 먼저
});

test('deltaMax · margin', () => {
  assert.equal(deltaMaxMin(20), 3);
  assert.equal(deltaMaxMin(5), 2);
  assert.equal(deltaMaxMin(100), 8);
  assert.equal(marginMin(20), 2);
  assert.equal(marginMin(50), 4);
});

test('pickOptions — Δmax 밖은 제외, 겹침 패널티로 다양성', () => {
  const m = [
    scored(['a1', 'b1'], 40),
    scored(['b1', 'a1'], 41),   // 같은 후보, 순서만 다름
    scored(['a2', 'b2'], 42),   // 후보 전부 다름
    scored(['a1', 'b2'], 60),   // 직행 30 → Δmax 4.5 밖
  ];
  const picked = pickOptions(m, 30, 3).map(s => planKey(s.visits));
  assert.equal(picked[0], 'a1>b1');
  assert.equal(picked[1], 'a2>b2');
  assert.equal(picked.length, 3);
});

test('pickOptions — 3개가 안 되면 억지로 만들지 않는다', () => {
  const picked = pickOptions([scored(['a1'], 40), scored(['a2'], 60)], 30, 3);
  assert.equal(picked.length, 1);
});

test('round2Plan — leg 오차 비율 > 1.6이면 미실측 1개 도전자 상위 2', () => {
  const measured = [scored(['a1', 'b1'], 40), scored(['a1', 'b2'], 44), scored(['a2', 'b1'], 46)];
  const rescored = [
    ...measured,
    scored(['a2', 'b2'], 41, { unknownLegs: 1 }),
    scored(['b2', 'a2'], 43, { unknownLegs: 1 }),
    scored(['b1', 'a2'], 42, { unknownLegs: 2 }),
  ];
  const r = round2Plan({
    measured, rescored, directMin: 30,
    legErrors: [{ measuredMin: 10, estimatedMin: 5 }], // 2.0 > 1.6
  });
  assert.deepEqual(r.extra.map(planKey), ['a2>b2', 'b2>a2']);
  assert.ok(r.reason);
});

test('round2Plan — 트리거 없으면 빈 배열', () => {
  const measured = [scored(['a1'], 40), scored(['a2'], 50), scored(['a3'], 55)];
  const r = round2Plan({ measured, rescored: measured, directMin: 30, legErrors: [{ measuredMin: 10, estimatedMin: 10 }] });
  assert.deepEqual(r.extra, []);
  assert.equal(r.reason, null);
});

test('round2Plan — 유효 실측 < 3이면 탐색안(미실측 leg 최다) 하나 더', () => {
  const measured = [scored(['a1', 'b1'], 40)];
  const rescored = [
    ...measured,
    scored(['a1', 'b2'], 42, { unknownLegs: 1 }),
    scored(['a2', 'b2'], 45, { unknownLegs: 2 }),
  ];
  const r = round2Plan({ measured, rescored, directMin: 30, legErrors: [] });
  assert.equal(r.extra.length, 2);
  assert.deepEqual(r.extra.map(planKey), ['a1>b2', 'a2>b2']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/select.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 시드 선택(3단계), 2라운드 트리거(5단계), Q=3 선택(6단계).
 */
import { DEST_ID, ORIGIN_ID } from './legs';
import type { Scored } from './score';
import type { Visit } from './types';

export type Ranked = { visits: Visit[]; estA: number; estB: number; estC: number };

export const planKey = (visits: Visit[]): string => visits.map(v => v.candidate.id).join('>');

export function candidateSet(v: Visit[]): Set<string> {
  return new Set(v.map(x => x.candidate.id));
}

export function legSet(v: Visit[]): Set<string> {
  const ids = [ORIGIN_ID, ...v.map(x => x.candidate.id), DEST_ID];
  const out = new Set<string>();
  for (let i = 0; i < ids.length - 1; i++) out.add(`${ids[i]}>${ids[i + 1]}`);
  return out;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function overlap(a: Visit[], b: Visit[]): number {
  return 0.6 * jaccard(candidateSet(a), candidateSet(b)) + 0.4 * jaccard(legSet(a), legSet(b));
}

export function pickSeeds(ranked: Ranked[], R: number): Visit[][] {
  const byC = [...ranked].sort((a, b) => a.estC - b.estC);
  const byA = [...ranked].sort((a, b) => a.estA - b.estA);
  const byB = [...ranked].sort((a, b) => a.estB - b.estB);
  const chosen: Visit[][] = [];
  const seen = new Set<string>();
  const push = (r?: Ranked) => {
    if (!r) return;
    const k = planKey(r.visits);
    if (seen.has(k) || chosen.length >= R) return;
    seen.add(k);
    chosen.push(r.visits);
  };
  push(byC[0]);
  push(byC[1]);
  push(byA[0]);
  push(byB[0]);
  // 부족분: C 상위 20개 중 기존 선택과 겹침이 가장 적은 안
  const pool = byC.slice(0, 20).filter(r => !seen.has(planKey(r.visits)));
  while (chosen.length < R && pool.length) {
    pool.sort((a, b) => {
      const oa = Math.max(...chosen.map(c => overlap(a.visits, c)));
      const ob = Math.max(...chosen.map(c => overlap(b.visits, c)));
      return oa - ob || a.estC - b.estC;
    });
    push(pool.shift());
  }
  return chosen;
}

export const deltaMaxMin = (directMin: number): number => Math.min(8, Math.max(2, 0.15 * directMin));
export const marginMin = (directMin: number): number => Math.max(2, 0.08 * directMin);

/** 1안 = 최단. 이후 T + max_q(Δmax·overlap) 최소를 반복 선택 */
export function pickOptions(measured: Scored[], directMin: number, q: number): Scored[] {
  if (measured.length === 0) return [];
  const sorted = [...measured].sort((a, b) => a.totalMin - b.totalMin);
  const dmax = deltaMaxMin(directMin);
  const pool = sorted.filter(s => s.totalMin <= sorted[0].totalMin + dmax);
  const out: Scored[] = [pool[0]];
  const rest = pool.slice(1);
  while (out.length < q && rest.length) {
    rest.sort((a, b) => score(a) - score(b));
    out.push(rest.shift()!);
  }
  return out;

  function score(p: Scored) {
    return p.totalMin + dmax * Math.max(...out.map(s => overlap(p.visits, s.visits)));
  }
}

export type Round2Input = {
  measured: Scored[];
  rescored: Scored[];
  legErrors: { measuredMin: number; estimatedMin: number }[];
  arriveByMin?: number;
  directMin: number;
};

export function round2Plan(input: Round2Input): { extra: Visit[][]; reason: string | null } {
  const { measured, rescored, legErrors, arriveByMin, directMin } = input;
  const mu = marginMin(directMin);
  const measuredKeys = new Set(measured.map(m => planKey(m.visits)));
  const unmeasured = rescored.filter(r => !measuredKeys.has(planKey(r.visits))).sort((a, b) => a.totalMin - b.totalMin);
  const sortedMeasured = [...measured].sort((a, b) => a.totalMin - b.totalMin);

  const ratios = legErrors
    .filter(e => e.measuredMin >= 3)
    .map(e => Math.max(e.measuredMin / e.estimatedMin, e.estimatedMin / e.measuredMin));
  const maxRatio = ratios.length ? Math.max(...ratios) : 1;
  const sumM = legErrors.reduce((s, e) => s + e.measuredMin, 0);
  const wape = sumM > 0 ? legErrors.reduce((s, e) => s + Math.abs(e.measuredMin - e.estimatedMin), 0) / sumM : 0;
  const third = sortedMeasured[2]?.totalMin;
  const challenger = unmeasured.find(u => u.unknownLegs === 1 && third != null && u.totalMin <= third + mu);
  const best = sortedMeasured[0];
  const nearDeadline =
    arriveByMin != null && best != null && Math.abs(best.arrivals[best.arrivals.length - 1] - arriveByMin) <= mu;
  const fewValid = measured.length < 3;

  const reasons: string[] = [];
  if (maxRatio > 1.6) reasons.push(`leg 오차 ${maxRatio.toFixed(2)}`);
  if (wape > 0.25) reasons.push(`WAPE ${wape.toFixed(2)}`);
  if (challenger) reasons.push('도전자');
  if (nearDeadline) reasons.push('마감 경계');
  if (fewValid) reasons.push('유효 실측 부족');
  if (reasons.length === 0) return { extra: [], reason: null };

  const oneUnknown = unmeasured.filter(u => u.unknownLegs === 1);
  const base = (oneUnknown.length ? oneUnknown : unmeasured.filter(u => u.unknownLegs <= 2)).slice(0, 2);
  const extra = base.map(s => s.visits);
  if (maxRatio > 2.0 || wape > 0.4 || fewValid) {
    const chosen = new Set(extra.map(planKey));
    const explorer = [...unmeasured]
      .filter(u => !chosen.has(planKey(u.visits)))
      .sort((a, b) => b.unknownLegs - a.unknownLegs || a.totalMin - b.totalMin)[0];
    if (explorer) extra.push(explorer.visits);
  }
  return { extra, reason: reasons.join(' · ') };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/select.test.ts`
Expected: 10 pass

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/select.ts src/lib/routePlan/select.test.ts
git commit -m "선택 — 시드 R개, 2라운드 트리거, Q=3 Jaccard 다양성

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 목 라우팅 공급자

**Files:**
- Create: `src/lib/routePlan/mockProvider.ts`
- Test: `src/lib/routePlan/mockProvider.test.ts`

**Interfaces:**
- Consumes: `RouteProvider`, `RouteResult`, `LatLng`, `Mode` from `./types`; `haversineM`, `buildPolyline` from `../geo`
- Produces:
  - `type MockRouteOptions = { minPerKm?: number; circuity?: number; barrier?: { a: LatLng; b: LatLng; penaltyKm: number } }`
  - `mockRouteProvider(opts?: MockRouteOptions): RouteProvider & { calls: number; log: LatLng[][] }`
  - `segmentsIntersect(p1, p2, p3, p4: LatLng): boolean`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider, segmentsIntersect } from './mockProvider';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km

test('직행 — 우회율 1.3, 2분/km', async () => {
  const p = mockRouteProvider({ minPerKm: 2, circuity: 1.3 });
  const r = await p.route([O, D], 480, 'car');
  assert.ok(Math.abs(r.distanceKm - 13) < 0.2, `km=${r.distanceKm}`);
  assert.ok(Math.abs(r.durationMin - 26) < 0.4);
  assert.equal(r.sections.length, 1);
  assert.equal(p.calls, 1);
  assert.ok(r.polyline.length > 2);
});

test('경유지 — section이 points-1개, 합이 total', async () => {
  const p = mockRouteProvider();
  const mid = { latitude: 37.51, longitude: 127.05 };
  const r = await p.route([O, mid, D], 480, 'car');
  assert.equal(r.sections.length, 2);
  const sum = r.sections.reduce((s, x) => s + x.durationMin, 0);
  assert.ok(Math.abs(sum - r.durationMin) < 1e-9);
});

test('장벽을 가로지르는 leg는 penaltyKm가 붙는다', async () => {
  // 남북으로 놓인 "강" — 경도 127.05
  const barrier = { a: { latitude: 37.4, longitude: 127.05 }, b: { latitude: 37.6, longitude: 127.05 }, penaltyKm: 5 };
  const plain = mockRouteProvider({ minPerKm: 2, circuity: 1 });
  const river = mockRouteProvider({ minPerKm: 2, circuity: 1, barrier });
  const a = await plain.route([O, D], 480, 'car');
  const b = await river.route([O, D], 480, 'car');
  assert.ok(Math.abs(b.distanceKm - a.distanceKm - 5) < 1e-6);
});

test('segmentsIntersect', () => {
  assert.equal(segmentsIntersect(O, D, { latitude: 37.4, longitude: 127.05 }, { latitude: 37.6, longitude: 127.05 }), true);
  assert.equal(segmentsIntersect(O, D, { latitude: 37.6, longitude: 127.0 }, { latitude: 37.6, longitude: 127.1 }), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/mockProvider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 테스트용 라우팅 공급자. haversine × 우회율, 선택적 장벽(강)을 가로지르면 penaltyKm.
 * 장벽은 "추정기가 틀리는 동네"를 흉내 낸다 — 2라운드 트리거를 시험하는 데 쓴다.
 */
import { buildPolyline, haversineM } from '../geo';
import type { LatLng, Mode, RouteProvider, RouteResult } from './types';

export type MockRouteOptions = {
  minPerKm?: number;
  circuity?: number;
  barrier?: { a: LatLng; b: LatLng; penaltyKm: number };
};

const orient = (p: LatLng, q: LatLng, r: LatLng) =>
  (q.longitude - p.longitude) * (r.latitude - p.latitude) - (q.latitude - p.latitude) * (r.longitude - p.longitude);

export function segmentsIntersect(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function mockRouteProvider(opts: MockRouteOptions = {}): RouteProvider & { calls: number; log: LatLng[][] } {
  const minPerKm = opts.minPerKm ?? 2;
  const circuity = opts.circuity ?? 1.3;
  const barrier = opts.barrier;
  const self = {
    calls: 0,
    log: [] as LatLng[][],
    async route(points: LatLng[], _departAtMin: number, _mode: Mode): Promise<RouteResult> {
      self.calls++;
      self.log.push(points);
      const sections = [];
      for (let i = 0; i < points.length - 1; i++) {
        let km = (haversineM(points[i], points[i + 1]) / 1000) * circuity;
        if (barrier && segmentsIntersect(points[i], points[i + 1], barrier.a, barrier.b)) km += barrier.penaltyKm;
        sections.push({ distanceKm: km, durationMin: km * minPerKm });
      }
      return {
        durationMin: sections.reduce((s, x) => s + x.durationMin, 0),
        distanceKm: sections.reduce((s, x) => s + x.distanceKm, 0),
        polyline: buildPolyline(points, 16),
        sections,
      };
    },
  };
  return self;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/mockProvider.test.ts`
Expected: 4 pass

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/mockProvider.ts src/lib/routePlan/mockProvider.test.ts
git commit -m "목 라우팅 공급자 — 우회율·장벽·호출 카운트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 오케스트레이터 `plan()`

**Files:**
- Create: `src/lib/routePlan/plan.ts`
- Create: `src/lib/routePlan/index.ts` (재수출)
- Test: `src/lib/routePlan/plan.test.ts`

**Interfaces:**
- Consumes: 앞선 태스크 전부
- Produces:
  - `plan(input: PlanInput, provider: RouteProvider, opts?: { R?: number; beamWidth?: number }): Promise<PlanResult>`
  - `index.ts`가 `plan`, 모든 타입, `mockRouteProvider`를 재수출

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from './mockProvider';
import { plan } from './plan';
import type { PlaceCandidate, PlanInput, Slot } from './types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km 동쪽
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, coord: { latitude: number; longitude: number }, extra: Partial<PlaceCandidate> = {}): PlaceCandidate =>
  ({ id, name: id, coord, ...extra });
const slot = (id: string, candidates: PlaceCandidate[], extra: Partial<Slot> = {}): Slot =>
  ({ id, query: id, candidates, dwellMin: 10, count: 1, flexible: true, openNow: false, ...extra });
const base = (slots: Slot[], extra: Partial<PlanInput> = {}): PlanInput =>
  ({ origin: O, destination: D, departAtMin: 480, mode: 'car', slots, order: 'auto', ...extra });

// 회랑 위(on), 살짝 북쪽(near), 멀리 남쪽(far)
const on = c('on', at(37.5, 127.05));
const near = c('near', at(37.505, 127.07));
const far = c('far', at(37.45, 127.06));

test('V=1 — 후보 전부 실측, 1안은 회랑 위 후보, apiCalls = 1 + K', async () => {
  const p = mockRouteProvider();
  const r = await plan(base([slot('a', [far, near, on])]), p);
  assert.equal(r.apiCalls, 4);
  assert.equal(r.options[0].visits[0].candidate.id, 'on');
  assert.ok(r.directMin > 0);
  assert.equal(r.options[0].deltaMin, r.options[0].totalMin - r.directMin);
  assert.equal(r.slotStatus.a, 'ok');
});

test('V=1 — 대안은 실측값이라 estimated=false, addedMin은 1안 대비', async () => {
  const r = await plan(base([slot('a', [far, near, on])]), mockRouteProvider());
  const alts = r.alternatives.filter(x => x.slotId === 'a');
  assert.equal(alts.length, 2);
  assert.ok(alts.every(x => !x.estimated && x.addedMin > 0));
  assert.ok(alts.find(x => x.candidate.id === 'far')!.addedMin > alts.find(x => x.candidate.id === 'near')!.addedMin);
});

test('V=2 — 직행 1 + R=4, 옵션 ≤ 3, 후보가 겹치지 않는 안이 섞인다', async () => {
  const p = mockRouteProvider();
  const b1 = c('b1', at(37.5, 127.09));
  const b2 = c('b2', at(37.495, 127.08));
  const r = await plan(base([slot('a', [on, near, far]), slot('b', [b1, b2])]), p, { R: 4 });
  assert.ok(r.apiCalls >= 5 && r.apiCalls <= 8, `calls=${r.apiCalls}`);
  assert.ok(r.options.length >= 1 && r.options.length <= 3);
  assert.equal(r.options[0].visits.length, 2);
  // 모든 옵션은 실측된 것 — arrivals가 채워져 있다
  for (const o of r.options) assert.equal(o.arrivals.length, 3);
});

test('장벽(강) — 추정이 틀리면 2라운드가 돈다', async () => {
  // 회랑 남쪽에 강. near2는 강 건너라 추정보다 훨씬 오래 걸린다
  const barrier = { a: at(37.49, 126.9), b: at(37.49, 127.2), penaltyKm: 8 };
  const across = c('across', at(37.485, 127.05)); // 강 건너, 회랑에 가까워 보임
  const b1 = c('b1', at(37.5, 127.09));
  const b2 = c('b2', at(37.505, 127.085));
  const p = mockRouteProvider({ barrier });
  const r = await plan(base([slot('a', [across, near, on, far]), slot('b', [b1, b2])]), p, { R: 4 });
  assert.ok(r.apiCalls > 5, `2라운드 없이 끝남: calls=${r.apiCalls}`);
  assert.notEqual(r.options[0].visits[0].candidate.id, 'across');
});

test('arriveBy 위반 — late 상태와 조건 완화안', async () => {
  const p = mockRouteProvider({ minPerKm: 2, circuity: 1 });
  // 직행 ≈ 20분. 480 출발, 505 마감. far는 dwell 10 + 우회로 늦는다
  const r = await plan(base([slot('a', [far], { dwellMin: 10 })], { arriveByMin: 505 }), p);
  assert.equal(r.slotStatus.a, 'late');
  assert.ok(r.relaxed);
  assert.equal(r.relaxed!.droppedSlotId, 'a');
  assert.equal(r.relaxed!.visits.length, 0);
  assert.ok(r.options[0].slackMin! < 0);
});

test('전부 마감 — closed 상태, 계획은 그래도 나온다', async () => {
  const closed = c('closed', at(37.5, 127.05), { hours: { openMin: 600, closeMin: 1320 } });
  const r = await plan(base([slot('a', [closed])]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'closed');
  assert.equal(r.options.length, 1);
});

test('빈 슬롯 — none, 나머지로 계획', async () => {
  const r = await plan(base([slot('a', []), slot('b', [on])]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'none');
  assert.equal(r.slotStatus.b, 'ok');
  assert.equal(r.options[0].visits.length, 1);
});

test('검색 status far/short는 그대로 승격', async () => {
  const r = await plan(base([slot('a', [far], { searchStatus: 'far' }), slot('b', [on], { searchStatus: 'short', count: 2 })]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'far');
  assert.equal(r.slotStatus.b, 'short');
});

test('슬롯이 하나도 없으면 직행만', async () => {
  const p = mockRouteProvider();
  const r = await plan(base([]), p);
  assert.equal(r.apiCalls, 1);
  assert.equal(r.options.length, 1);
  assert.equal(r.options[0].visits.length, 0);
  assert.equal(r.options[0].deltaMin, 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/plan.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 오케스트레이터. 설계 0~7단계 중 API가 필요한 부분을 provider로 돌린다.
 *
 *   직행 1회 → 회랑 투영 → 열거·추정 → 시드 R회(V=1은 전부) 병렬 실측
 *   → section에서 leg 학습 → 전체 재채점 → 조건부 2라운드 → Q=3 → 슬롯 status
 */
import { polylineLengthM } from '../geo';
import { destinationPoint, estimateA, estimateB, estimateC, originPoint, projectOnCorridor, type CorridorPoint } from './corridor';
import { enumeratePlans, totalVisits } from './enumerate';
import { DEST_ID, LegStore, learnLegs, ORIGIN_ID } from './legs';
import { allClosedAtArrival, scorePlan, type ScoreContext, type Scored } from './score';
import { pickOptions, pickSeeds, planKey, round2Plan, type Ranked } from './select';
import type { Alternative, PlanInput, PlanOption, PlanResult, RouteProvider, SlotStatus, Visit } from './types';

const DEFAULT_R = 4;
const BEAM_FULL_UPTO = 3;
const BEAM_WIDTH = 64;

export async function plan(
  input: PlanInput,
  provider: RouteProvider,
  opts: { R?: number; beamWidth?: number } = {},
): Promise<PlanResult> {
  const R = opts.R ?? DEFAULT_R;
  let apiCalls = 0;
  const call = async (visits: Visit[]) => {
    apiCalls++;
    const points = [input.origin, ...visits.map(v => v.candidate.coord), input.destination];
    return provider.route(points, input.departAtMin, input.mode);
  };

  // 0. 직행
  const direct = await call([]);
  const directMin = direct.durationMin;
  const directKm = direct.distanceKm;
  const legs = new LegStore();
  learnLegs(legs, [ORIGIN_ID, DEST_ID], direct, input.departAtMin, [], input.mode);

  // 회랑 투영 — 후보마다 한 번
  const poly = direct.polyline.length >= 2 ? direct.polyline : [input.origin, input.destination];
  const L = polylineLengthM(poly);
  const corridor = new Map<string, CorridorPoint>();
  for (const s of input.slots) for (const c of s.candidates) if (!corridor.has(c.id)) corridor.set(c.id, projectOnCorridor(poly, c.coord));
  const ctx: ScoreContext = {
    origin: input.origin, destination: input.destination, corridorLengthM: L,
    rhoMinPerKm: directMin / Math.max(directKm, 0.1), mode: input.mode, departAtMin: input.departAtMin, legs,
    corridorOf: id => corridor.get(id)!,
  };

  // 1·2. 열거 + 추정
  const V = totalVisits(input.slots);
  const beam = V <= BEAM_FULL_UPTO ? Infinity : opts.beamWidth ?? BEAM_WIDTH;
  const partial = (seq: Visit[]) => scorePlan(seq, ctx).totalMin;
  const plans = enumeratePlans(input.slots, input.order, partial, beam);
  const ranked: Ranked[] = plans.map(visits => {
    const cps = [originPoint(), ...visits.map(v => corridor.get(v.candidate.id)!), destinationPoint(L)];
    const coords = [input.origin, ...visits.map(v => v.candidate.coord), input.destination];
    const dwell = visits.reduce((s, v) => s + v.dwellMin, 0);
    const a = (estimateA(cps) / 1000) * ctx.rhoMinPerKm + dwell;
    const b = (estimateB(coords) / 1000) * ctx.rhoMinPerKm + dwell;
    return { visits, estA: a, estB: b, estC: estimateC(a, b) };
  });

  // 3. 1라운드 실측
  const seeds = V === 1 ? ranked.map(r => r.visits) : pickSeeds(ranked, R);
  const measured: Scored[] = [];
  const legErrors: { measuredMin: number; estimatedMin: number }[] = [];
  const measure = async (visits: Visit[]) => {
    const est = scorePlan(visits, ctx); // 실측 전 추정 — 오차 계산용
    const route = await call(visits);
    const ids = [ORIGIN_ID, ...visits.map(v => v.candidate.id), DEST_ID];
    learnLegs(legs, ids, route, input.departAtMin, visits.map(v => v.dwellMin), input.mode);
    route.sections.forEach((sec, i) => {
      if (est.unknownLegs > 0) legErrors.push({ measuredMin: sec.durationMin, estimatedMin: est.legsMin[i] });
    });
    measured.push(scorePlan(visits, ctx));
  };
  await Promise.all(seeds.map(measure));

  // 4. 재채점 · 5. 2라운드
  if (V >= 2) {
    const rescored = plans.map(v => scorePlan(v, ctx));
    const r2 = round2Plan({ measured, rescored, legErrors, arriveByMin: input.arriveByMin, directMin });
    await Promise.all(r2.extra.map(measure));
  }
  // 실측된 계획을 최신 leg로 다시 채점(2라운드가 leg를 더 알았을 수 있다)
  const finalMeasured = measured.map(m => scorePlan(m.visits, ctx));

  // 6. 선택
  const toOption = (s: Scored): PlanOption => ({
    visits: s.visits,
    totalMin: s.totalMin,
    deltaMin: s.totalMin - directMin,
    arrivals: s.arrivals,
    slackMin: input.arriveByMin == null ? null : input.arriveByMin - s.arrivals[s.arrivals.length - 1],
    distanceKm: s.distanceKm,
  });
  const chosen = pickOptions(finalMeasured, directMin, 3);
  const options = chosen.map(toOption);
  const best = chosen[0];

  // 7. 조건 완화안 — arriveBy 위반이면 가장 비싼 슬롯을 빼고 1회 실측
  let relaxed: PlanResult['relaxed'];
  const late = best != null && input.arriveByMin != null && best.arrivals[best.arrivals.length - 1] > input.arriveByMin;
  if (late && best.visits.length > 0) {
    const bySlot = new Map<string, Visit[]>();
    for (const v of best.visits) bySlot.set(v.slotId, [...(bySlot.get(v.slotId) ?? []), v]);
    let worst: { slotId: string; visits: Visit[]; totalMin: number } | null = null;
    for (const slotId of bySlot.keys()) {
      const rest = best.visits.filter(v => v.slotId !== slotId);
      const est = scorePlan(rest, ctx);
      if (!worst || est.totalMin < worst.totalMin) worst = { slotId, visits: rest, totalMin: est.totalMin };
    }
    if (worst) {
      const route = await call(worst.visits);
      learnLegs(legs, [ORIGIN_ID, ...worst.visits.map(v => v.candidate.id), DEST_ID], route, input.departAtMin, worst.visits.map(v => v.dwellMin), input.mode);
      relaxed = { ...toOption(scorePlan(worst.visits, ctx)), droppedSlotId: worst.slotId };
    }
  }

  // 대안 — 1안에서 슬롯 하나만 바꿔 채점
  const alternatives: Alternative[] = [];
  if (best) {
    for (const slot of input.slots) {
      const idx = best.visits.findIndex(v => v.slotId === slot.id);
      if (idx < 0) continue;
      for (const cand of slot.candidates) {
        if (best.visits.some(v => v.candidate.id === cand.id)) continue;
        const swapped = best.visits.map((v, i) => (i === idx ? { ...v, candidate: cand } : v));
        const s = scorePlan(swapped, ctx);
        const prev = idx === 0 ? input.origin : best.visits[idx - 1].candidate.coord;
        const next = idx === best.visits.length - 1 ? input.destination : best.visits[idx + 1].candidate.coord;
        alternatives.push({
          slotId: slot.id, candidate: cand,
          addedMin: s.totalMin - best.totalMin,
          detourKm: Math.max(0, s.distanceKm - best.distanceKm),
          estimated: s.unknownLegs > 0,
        });
        void prev; void next;
      }
    }
  }

  // 슬롯 status
  const slotStatus: Record<string, SlotStatus> = {};
  for (const slot of input.slots) {
    if (slot.candidates.length === 0) { slotStatus[slot.id] = 'none'; continue; }
    if (slot.searchStatus === 'far' || slot.searchStatus === 'short') { slotStatus[slot.id] = slot.searchStatus; continue; }
    const visitsOfSlot = best ? best.visits.map((v, i) => ({ v, i })).filter(x => x.v.slotId === slot.id) : [];
    if (best && visitsOfSlot.length && allClosedAtArrival({ ...best, visits: visitsOfSlot.map(x => x.v), arrivals: visitsOfSlot.map(x => best.arrivals[x.i]) })) {
      slotStatus[slot.id] = 'closed'; continue;
    }
    if (relaxed && relaxed.droppedSlotId === slot.id) { slotStatus[slot.id] = 'late'; continue; }
    slotStatus[slot.id] = 'ok';
  }

  return { directMin, directKm, options, relaxed, alternatives, slotStatus, apiCalls };
}
```

`index.ts`:

```ts
export { plan } from './plan';
export { mockRouteProvider } from './mockProvider';
export type * from './types';
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/routePlan/plan.test.ts`
Expected: 9 pass. 실패하면 **알고리즘이 아니라 테스트 좌표를 먼저 의심**하지 말 것 — 좌표는 설계대로 놓였다. `across` 케이스가 2라운드 없이 끝나면 `legErrors`가 비었는지(추정 `unknownLegs`가 0이면 오차를 안 넣는다) 확인.

- [ ] **Step 5: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 pass, tsc 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/routePlan/plan.ts src/lib/routePlan/index.ts src/lib/routePlan/plan.test.ts
git commit -m "플래너 오케스트레이터 — 직행·시드·leg 학습·2라운드·Q=3·슬롯 status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 회랑 검색과 확대

**Files:**
- Create: `src/lib/corridorSearch.ts`
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: `pointAtProgress`, `polylineLengthM`, `haversineM` from `./geo`; `PlaceCandidate`, `SearchStatus`, `LatLng` from `./routePlan/types`
- Produces:
  - `type SearchFn = (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]>`
  - `type CorridorSearchOptions = { need: number; initialRadiusM: number; maxRadiusM: number; samples?: number; farRadiusM?: number }`
  - `searchAlong(poly: LatLng[], query: string, opts: CorridorSearchOptions, search: SearchFn): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number }>`
  - `initialRadiusM(mode: Mode): number` — car 2000 / walk 500 / transit 800
  - `maxRadiusM(mode: Mode, slackMin: number | null, rhoMinPerKm: number): number` — `min(절대상한, slack/(2ρ) km)`; 절대상한 car 15000 / walk 2000 / transit 3000

- [ ] **Step 1: 실패하는 테스트**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, haversineM } from './geo';
import { initialRadiusM, maxRadiusM, searchAlong, type SearchFn } from './corridorSearch';
import type { PlaceCandidate } from './routePlan/types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km
const poly = buildPolyline([O, D], 32);
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });

/** 카탈로그에서 반지름 안의 것만 돌려주는 검색 함수 + 호출 기록 */
function catalogSearch(catalog: PlaceCandidate[]) {
  const calls: { near: { latitude: number; longitude: number }; radiusM: number }[] = [];
  const fn: SearchFn = async (_q, near, radiusM) => {
    calls.push({ near, radiusM });
    return catalog.filter(c => haversineM(near, c.coord) <= radiusM);
  };
  return { fn, calls };
}

test('반지름 상수', () => {
  assert.equal(initialRadiusM('car'), 2000);
  assert.equal(initialRadiusM('walk'), 500);
  assert.equal(maxRadiusM('car', null, 2), 15000);
  // 여유 20분, ρ=2분/km → 우회 10km → r 5km
  assert.equal(maxRadiusM('car', 20, 2), 5000);
  assert.equal(maxRadiusM('walk', 100, 12), 2000);
});

test('회랑 5점에서 찾고 place id로 합친다', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.5, 127.05) }; // 중간
  const { fn, calls } = catalogSearch([c1]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.candidates.map(c => c.id), ['c1']);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(c => c.radiusM === 2000));
});

test('없으면 반지름을 2배씩 넓혀 찾는다', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.53, 127.05) }; // 북쪽 3.3km
  const { fn, calls } = catalogSearch([c1]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(r.radiusM, 4000);
  assert.equal(calls.length, 10);
});

test('상한까지 없고 더 멀리엔 있으면 far — 가장 가까운 3곳', async () => {
  const farOnes = [1, 2, 3, 4].map(i => ({ id: `f${i}`, name: `f${i}`, coord: at(37.5 + 0.2 * i, 127.05) })); // 22km+
  const { fn } = catalogSearch(farOnes);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 4000, farRadiusM: 100_000 }, fn);
  assert.equal(r.status, 'far');
  assert.deepEqual(r.candidates.map(c => c.id), ['f1', 'f2', 'f3']);
});

test('아예 없으면 none', async () => {
  const { fn } = catalogSearch([]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.equal(r.status, 'none');
  assert.deepEqual(r.candidates, []);
});

test('need=3인데 2개뿐이면 short', async () => {
  const two = [at(37.5, 127.03), at(37.5, 127.08)].map((coord, i) => ({ id: `s${i}`, name: `s${i}`, coord }));
  const { fn } = catalogSearch(two);
  const r = await searchAlong(poly, 'q', { need: 3, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.equal(r.status, 'short');
  assert.equal(r.candidates.length, 2);
});

test('결과는 회랑에서 가까운 순', async () => {
  const cat = [
    { id: 'off', name: 'off', coord: at(37.515, 127.05) },
    { id: 'on', name: 'on', coord: at(37.5, 127.06) },
  ];
  const { fn } = catalogSearch(cat);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.deepEqual(r.candidates.map(c => c.id), ['on', 'off']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

```ts
/**
 * 회랑 검색 — 직행 폴리라인 위 5개 점에서 찾고, 없으면 반지름을 2배씩 넓힌다.
 * 상한까지 없으면 가장 가까운 곳을 far로 넣는다. 설계 0.5단계.
 * 검색 함수는 주입받는다(places.ts는 expo-constants를 물고 있어 node 테스트가 못 읽는다).
 */
import { crossTrack, pointAtProgress, polylineLengthM } from './geo';
import type { LatLng, Mode, PlaceCandidate, SearchStatus } from './routePlan/types';

export type SearchFn = (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]>;

export type CorridorSearchOptions = {
  need: number;
  initialRadiusM: number;
  maxRadiusM: number;
  samples?: number;
  /** far 단계에서 한 번 더 찾을 반지름. 카카오 로컬 상한 20km */
  farRadiusM?: number;
};

const INITIAL: Record<Mode, number> = { car: 2000, walk: 500, transit: 800 };
const ABS_MAX: Record<Mode, number> = { car: 15000, walk: 2000, transit: 3000 };

export const initialRadiusM = (mode: Mode): number => INITIAL[mode];

/** 추정 우회 ≈ 2r·ρ 가 여유를 넘지 않게. 여유가 없으면 절대 상한 */
export function maxRadiusM(mode: Mode, slackMin: number | null, rhoMinPerKm: number): number {
  const abs = ABS_MAX[mode];
  if (slackMin == null || slackMin <= 0) return abs;
  const bySlack = (slackMin / (2 * rhoMinPerKm)) * 1000;
  return Math.min(abs, Math.round(bySlack));
}

export async function searchAlong(
  poly: LatLng[],
  query: string,
  opts: CorridorSearchOptions,
  search: SearchFn,
): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number }> {
  const samples = opts.samples ?? 5;
  const L = polylineLengthM(poly);
  const points: LatLng[] = [];
  for (let i = 0; i < samples; i++) points.push(pointAtProgress(poly, (L * i) / (samples - 1)).point);

  const byCorridor = (list: PlaceCandidate[]) =>
    [...list].sort((a, b) => crossTrack(a.coord, poly).distanceM - crossTrack(b.coord, poly).distanceM);

  const merge = (lists: PlaceCandidate[][]) => {
    const seen = new Map<string, PlaceCandidate>();
    for (const l of lists) for (const c of l) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()];
  };

  let radiusM = opts.initialRadiusM;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = merge(await Promise.all(points.map(p => search(query, p, r))));
    if (found.length >= opts.need) return { candidates: byCorridor(found), status: 'ok', radiusM: r };
    if (r >= opts.maxRadiusM) break;
    radiusM = Math.min(opts.maxRadiusM, r * 2);
  }
  if (found.length > 0) return { candidates: byCorridor(found), status: 'short', radiusM };

  // 상한까지 0건 — 더 멀리 한 번만 보고 가장 가까운 3곳
  const farR = opts.farRadiusM ?? 20_000;
  if (farR > opts.maxRadiusM) {
    const far = merge(await Promise.all(points.map(p => search(query, p, farR))));
    if (far.length > 0) return { candidates: byCorridor(far).slice(0, 3), status: 'far', radiusM: farR };
  }
  return { candidates: [], status: 'none', radiusM };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: 7 pass

- [ ] **Step 5: places.ts 검색 계약에 반지름 추가**

`src/lib/places.ts`의 `PlaceSearchProvider.search` 시그니처를 `search(query: string, near: LatLng | null, radiusM?: number): Promise<Place[]>`로 바꾸고,
- `mockProvider`: `radiusM`이 있고 `near`가 있으면 `haversineM(near, p.coord) <= radiusM`로 거른다.
- `kakaoProvider`: `near`가 국내이고 `radiusM`이 있으면 `keywordParams.set('radius', String(Math.min(20000, Math.round(radiusM))))`.
- google 공급자: 이 계획에서는 `radiusM`을 무시한다(다음 계획에서 `locationRestriction`).

`Place`를 `PlaceCandidate`로 바꾸는 어댑터를 `places.ts` 끝에 추가:

```ts
/** 플래너용 검색 함수 — Place를 PlaceCandidate로. hours는 아직 없다(다음 계획) */
export function planSearchFn(): (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]> {
  return async (query, near, radiusM) => {
    const places = await getProvider(near).search(query, near, radiusM);
    return places.map(p => ({ id: p.id, name: p.name, coord: p.coord }));
  };
}
```

(`getProvider`는 파일에 이미 있다. `PlaceCandidate`는 `./routePlan/types`에서 type import.)

- [ ] **Step 6: 타입 검사와 전체 테스트**

Run: `npx tsc --noEmit -p . && npm test`
Expected: tsc 출력 없음, 전부 pass

- [ ] **Step 7: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts src/lib/places.ts
git commit -m "회랑 검색과 확대 — 5점 검색, 2배 확대, far/none/short, 검색 반지름 계약

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: NEXT.md 갱신

**Files:**
- Modify: `docs/NEXT.md` (§3 "최적 경로 계산")

- [ ] **Step 1: §3 끝의 "구현 순서는 설계 문서 끝에 있다" 문단 아래에 추가**

```markdown
**2026-09-11 구현 상태:** 1·1.5단계 완료 — `src/lib/routePlan/`(plan·corridor·enumerate·legs·score·select·mockProvider)과
`src/lib/corridorSearch.ts`. `npm test`로 목 공급자 기준 전 단계가 돈다. 아직 UI·서버에 연결 안 됨.
다음: Workers `/route` 프록시(카카오 쿼터 확인 먼저) → `OptionsScreen`·`CandidateSheet` 연결.
```

- [ ] **Step 2: 커밋**

```bash
git add docs/NEXT.md
git commit -m "NEXT.md — 플래너 1·1.5단계 완료 기록

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**

| 설계 절 | 태스크 |
|---|---|
| 0 직행 실측, ρ = directMin/directKm | 9 |
| 0.5 회랑 검색·확대·far/none/short | 10 |
| 1 후보 정리(count, 중복 금지, flexible) | 4 |
| 2 추정 A/B/C, 역주행 벌점, beam | 3, 4, 9 |
| 3 V=1 전부 / V≥2 R=4 시드 | 7, 9 |
| 4 leg 재사용 규칙, 누적 도착시각, 영업시간 | 5, 6 |
| 5 2라운드 트리거 | 7, 9 |
| 6 Q=3 Δmax·Jaccard, 조건 완화안 분리 | 7, 9 |
| 7 확정 시 dwell 재실측 | **이 계획 밖** — 확정은 UI 이벤트. 다음 계획 |
| 못 찾았을 때 status 6종 | 9, 10 |
| 캐시 TTL·좌표 5자리 키 | **이 계획 밖** — 실제 공급자가 붙을 때. LegStore는 세션 내 저장소 |
| 대중교통 순차 실측 | **이 계획 밖** |

**Placeholder scan:** 없음. 모든 코드 단계에 코드가 있다.

**Type consistency:** `Scored`(score.ts) ↔ select.ts·plan.ts에서 같은 필드 사용. `SearchStatus`는 types.ts에 정의, corridorSearch.ts가 import. `Ranked`는 select.ts 정의, plan.ts가 import. `learnLegs(store, pointIds, route, departAtMin, dwellsMin, mode)` 인자 순서가 Task 5·9에서 동일.

**알려진 약점:** Task 9의 `alternatives` 계산에서 `prev`/`next`는 쓰지 않는다(`void`). 구현자는 그 두 줄과 `void` 줄을 지워도 된다. `detourKm`는 거리 차로 정의했다 — 설계의 "경로에서 벗어나는 거리"와 같은 뜻이다.
