# 추적기 묶음 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 도착·출발 판정을 순수 모듈로 빼서 3샘플·정지·정확도 규칙으로 바꾸고, 실기기 추적 로그를 남겨 내려받을 수 있게 한다.

**Architecture:** `src/lib/arrival.ts`가 GPS 한 건과 계획 컨텍스트를 받아 `arrive/depart/skip` 이벤트를 내는 순수 단계 함수다. `tracker.tsx`는 이 함수를 부르고 dispatch·알림·로그만 한다. 로그는 `trackLogFormat.ts`(순수)와 `trackLog.ts`(expo-file-system 파일 I/O, expo-sharing 내보내기)로 나눈다.

**Tech Stack:** Expo SDK 57 (expo-location, expo-file-system 신 API `File`/`Directory`/`Paths`, expo-sharing), React Native, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-11-tracker-arrival-design.md`

## Global Constraints

- 순수 로직은 `src/lib/`에 두고 React·expo를 import하지 않는다. `npm test`(`tsx --test 'src/**/*.test.ts'`)에 포함.
- 테스트 파일은 `./x.ts`처럼 확장자를 붙여 import한다(기존 `candidateRank.test.ts` 방식). `node:test` + `node:assert/strict`.
- 새 파일은 "왜"를 말하는 머리 주석으로 시작. 주석·커밋은 한국어. 커밋 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `git add -A` 금지. 파일을 이름으로 스테이징한다. `node_modules`는 절대 커밋하지 않는다(워크트리의 `node_modules`는 심링크다).
- Expo SDK 57 문서(`https://docs.expo.dev/versions/v57.0.0/`)의 API만 쓴다. `expo-file-system/legacy`는 쓰지 않는다.
- `ios/` 디렉터리는 건드리지 않는다(빌드 시 prebuild가 다시 만든다).
- 건드리지 않는 것: 이탈(offroute) 판정 규칙, 시뮬레이션 틱 생성, `plan.tsx` 리듀서, 알림 문구.
- 타입 검사: `npx tsc --noEmit -p .` 가 깨끗해야 한다.

---

## 파일 구조

| 파일 | 역할 | Task |
|---|---|---|
| `src/lib/arrival.ts` (신규) | 도착·출발 판정 순수 함수, 프로필 | 1 |
| `src/lib/arrival.test.ts` (신규) | 위 시험 | 1 |
| `src/lib/trackLogFormat.ts` (신규) | 이벤트 타입, 파일명·보관·직렬화·상한 순수 함수 | 2 |
| `src/lib/trackLogFormat.test.ts` (신규) | 위 시험 | 2 |
| `src/lib/trackLog.ts` (신규) | 큐·배치 append·보관·내보내기·지우기 (파일 I/O) | 3 |
| `scripts/tracklog-timeline.mjs` (신규) | 내려받은 JSONL을 타임라인으로 펼치는 node 스크립트 | 3 |
| `package.json`, `package-lock.json` | expo-file-system, expo-sharing 추가 | 3 |
| `src/lib/backgroundLocation.ts` | 리스너가 `Fix`(정확도·속도 포함)를 넘긴다 | 4 |
| `src/state/tracker.tsx` | 지오펜스 → `stepArrival`, 모드 복귀, 로그 호출 | 4 |
| `src/sheets/DevSheet.tsx` | "추적 로그" 카드 | 5 |

Task 1과 2는 서로 독립이라 병렬 가능. 3은 2 뒤, 4는 1·3 뒤, 5는 3·4 뒤.

---

### Task 1: 도착·출발 판정 모듈 `arrival.ts`

**Files:**
- Create: `src/lib/arrival.ts`
- Test: `src/lib/arrival.test.ts`

**Interfaces:**
- Consumes: `haversineM(a: LatLng, b: LatLng): number` from `src/lib/geo.ts`; `LatLng` from `src/data/mockData.ts`.
- Produces (Task 4가 쓴다):
  - `type Fix = LatLng & { accuracyM?: number | null; speedMps?: number | null }`
  - `type Point = { id: string; coord: LatLng }`
  - `type TravelMode = 'car' | 'walk' | 'transit'`
  - `profileFor(sim: boolean, mode: TravelMode): ArrivalProfile`
  - `initialArrivalState: ArrivalState`
  - `stepArrival(state: ArrivalState, fix: Fix, ctx: ArrivalContext): ArrivalStep`
  - `type ArrivalEvent = { kind: 'arrive' | 'depart' | 'skip'; id: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/arrival.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialArrivalState,
  profileFor,
  stepArrival,
  type ArrivalContext,
  type ArrivalState,
  type Fix,
  type Point,
} from './arrival.ts';
import type { LatLng } from '../data/mockData.ts';

// 여의도 올리브영 근처. 북쪽으로 m미터 이동 = 위도 + m/111320
const O: LatLng = { latitude: 37.5219, longitude: 126.9245 };
const north = (p: LatLng, m: number): LatLng => ({ latitude: p.latitude + m / 111_320, longitude: p.longitude });

const T: Point = { id: 'olive', coord: O };
const N: Point = { id: 'hcard', coord: north(O, 200) };
const D: Point = { id: 'D', coord: north(O, 3000) };

const fix = (p: LatLng, speedMps: number | null = 0.5, accuracyM: number | null = 30): Fix => ({ ...p, speedMps, accuracyM });
const car = profileFor(false, 'car');
const walk = profileFor(false, 'walk');

/** 샘플을 순서대로 넣고 단계 결과 배열을 돌려준다 */
function run(fixes: Fix[], ctx: ArrivalContext, s: ArrivalState = initialArrivalState) {
  const out = [];
  for (const f of fixes) {
    const r = stepArrival(s, f, ctx);
    s = r.state;
    out.push(r);
  }
  return out;
}
const kinds = (r: ReturnType<typeof stepArrival>) => r.events.map(e => `${e.kind}:${e.id}`);

test('프로필: car 150/250, walk·transit 80, sim 400/600 1샘플', () => {
  assert.equal(car.arriveBaseM, 150);
  assert.equal(car.departBaseM, 250);
  assert.equal(car.arriveSamples, 3);
  assert.equal(car.departSamples, 2);
  assert.equal(car.maxAccuracyM, 100);
  assert.equal(car.stationaryMps, 2);
  assert.equal(walk.arriveBaseM, 80);
  assert.equal(walk.stationaryMps, 1);
  assert.equal(profileFor(false, 'transit').arriveBaseM, 80);
  const sim = profileFor(true, 'car');
  assert.equal(sim.arriveBaseM, 400);
  assert.equal(sim.departBaseM, 600);
  assert.equal(sim.arriveSamples, 1);
  assert.equal(sim.departSamples, 1);
  assert.equal(sim.maxAccuracyM, null);
});

test('지나치기: 반경 안이라도 속도 8m/s면 도착 아님', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: walk };
  const rs = run([fix(north(O, 40), 8), fix(north(O, 20), 8), fix(north(O, 60), 8)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], []]);
});

test('도착: 반경 안 연속 3샘플 + 정지 → 3번째에서 arrive', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(north(O, 40)), fix(north(O, 30)), fix(north(O, 35))], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
  assert.equal(rs[2].state.arrivedId, 'olive');
});

test('도착: 중간에 반경 밖 샘플이 끼면 처음부터 다시 센다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(north(O, 40)), fix(north(O, 30)), fix(north(O, -400)), fix(north(O, 20)), fix(north(O, 10))], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], [], [], []]);
  assert.equal(rs[4].state.arriveStreak, 2);
});

test('정확도: 100m 넘는 샘플은 무시하고 streak을 유지한다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(north(O, 40)), fix(north(O, 30), 0.5, 180), fix(north(O, 30)), fix(north(O, 35))], ctx);
  assert.equal(rs[1].ignored, 'accuracy');
  assert.equal(rs[1].state.arriveStreak, 1);
  assert.deepEqual(rs.map(kinds), [[], [], [], ['arrive:olive']]);
});

test('정확도: 반경보다 나쁘면(100m 이하) 반경을 정확도만큼 넓힌다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: walk };
  // walk 반경 80m인데 정확도 95m — 90m 지점도 반경 안으로 친다
  const r = stepArrival(initialArrivalState, fix(north(O, 90), 0.5, 95), ctx);
  assert.equal(r.arriveR, 95);
  assert.equal(r.state.arriveStreak, 1);
});

test('출발 반경 = 다음 지점 거리/2 (200m면 100m), 밖 2샘플이면 depart', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  // 남쪽(다음 지점 반대편)으로 130m — 옛 반경 250m로는 영영 출발이 안 잡히던 거리
  const rs = run([fix(north(O, -130), 3), fix(north(O, -130), 3)], ctx, s);
  assert.ok(Math.abs(rs[0].departR - 100) < 1);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive']]);
  assert.equal(rs[1].state.departedId, 'olive');
});

test('출발 반경은 50m 바닥, 250m 천장', () => {
  const near: Point = { id: 'n', coord: north(O, 60) };
  const far: Point = { id: 'f', coord: north(O, 5000) };
  const a = stepArrival(initialArrivalState, fix(O), { target: T, next: near, atStop: true, profile: car });
  assert.equal(a.departR, 50);
  const b = stepArrival(initialArrivalState, fix(O), { target: T, next: far, atStop: true, profile: car });
  assert.equal(b.departR, 250);
  const c = stepArrival(initialArrivalState, fix(O), { target: T, next: null, atStop: true, profile: car });
  assert.equal(c.departR, 250);
});

test('선행 도착: 체류 중에 다음 지점 반경 안 3샘플 → depart + arrive', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  const at = north(O, 190);
  const rs = run([fix(at), fix(at), fix(at)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], [], ['depart:olive', 'arrive:hcard']]);
});

test('선행 도착: 체류 전이면 skip + arrive (순서 강제 해제)', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const at = north(O, 190);
  const rs = run([fix(at), fix(at), fix(at)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['skip:olive', 'arrive:hcard']]);
});

test('두 반경이 겹치면 더 가까운 쪽으로 센다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  // target에서 60m, next에서 140m — 둘 다 150m 안이지만 target이 가깝다
  const rs = run([fix(north(O, 60)), fix(north(O, 60)), fix(north(O, 60))], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
});

test('목적지: 경유지가 끝나면 target=D, next=null로 도착을 잡는다', () => {
  const ctx: ArrivalContext = { target: D, next: null, atStop: false, profile: car };
  const at = north(O, 3010);
  const rs = run([fix(at), fix(at), fix(at)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:D']]);
});

test('target이 없으면 아무 이벤트도 없다', () => {
  const r = stepArrival(initialArrivalState, fix(O), { target: null, next: null, atStop: false, profile: car });
  assert.deepEqual(r.events, []);
  assert.equal(r.distToTargetM, null);
});

test('중복: 이미 도착을 낸 지점은 dispatch 반영 전 샘플에서 다시 내지 않는다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(O), fix(O), fix(O), fix(O), fix(O)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive'], [], []]);
});

test('중복: 이미 출발을 낸 지점은 다시 내지 않는다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  const rs = run([fix(north(O, -130), 3), fix(north(O, -130), 3), fix(north(O, -130), 3)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive'], []]);
});

test('속도를 모르면(null) 멈춘 것으로 본다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const rs = run([fix(O, null), fix(O, null), fix(O, null)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
});

test('sim 프로필: 1샘플로 도착, 속도 검사 없음, 정확도 무시 없음', () => {
  const sim = profileFor(true, 'car');
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: sim };
  const r = stepArrival(initialArrivalState, fix(north(O, 300), 25, 500), ctx);
  assert.equal(r.ignored, null);
  assert.equal(r.arriveR, 500); // 정확도가 반경보다 나쁘면 반경이 그만큼 넓어진다
  assert.deepEqual(kinds(r), ['arrive:olive']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/arrival.test.ts`
Expected: FAIL — `./arrival.ts` 모듈을 찾지 못함.

- [ ] **Step 3: 구현**

`src/lib/arrival.ts`:

```ts
/**
 * 도착·출발 판정 — 순수 함수. GPS 한 건과 계획 컨텍스트를 받아 이벤트를 낸다.
 *
 * 왜: 실기기에서 1샘플 즉시 판정이 지나치는 역을 '도착'으로 봤고, 출발 반경 250m가
 * 200m 떨어진 다음 지점을 영영 못 잡았다. 규칙을 React 밖으로 빼서 npm test로 고정한다.
 *
 * 규칙 (스펙 docs/superpowers/specs/2026-09-11-tracker-arrival-design.md §1)
 *   0. target 없음 → 이벤트 없음
 *   1. accuracy > maxAccuracyM → 샘플 무시 (streak 유지)
 *   2. 멈춤 = 속도 모름 또는 속도 < stationaryMps
 *   3. 다음 지점 반경 안 + 더 가까움 + 멈춤 연속 N샘플 → depart|skip(target) + arrive(next)
 *   4. target 반경 안 + 멈춤 연속 N샘플 → arrive(target)
 *   5. 체류 중 target 반경 밖 연속 M샘플 → depart(target)
 */
import { haversineM } from './geo';
import type { LatLng } from '../data/mockData';

export type Fix = LatLng & {
  /** 수평 정확도(m). 없으면 null */
  accuracyM?: number | null;
  /** m/s. 모르면 null (iOS의 -1은 호출자가 null로 바꾼다) */
  speedMps?: number | null;
};

export type Point = { id: string; coord: LatLng };

export type TravelMode = 'car' | 'walk' | 'transit';

export type ArrivalProfile = {
  /** 도착 반경 하한 */
  arriveBaseM: number;
  /** 출발 반경 상한 */
  departBaseM: number;
  /** 반경 안 연속 샘플 수 */
  arriveSamples: number;
  /** 반경 밖 연속 샘플 수 */
  departSamples: number;
  /** 이보다 나쁜 샘플은 무시. null이면 무시 안 함 */
  maxAccuracyM: number | null;
  /** 이 속도 미만이어야 '멈춤' */
  stationaryMps: number;
};

const LIVE_CAR: ArrivalProfile = {
  arriveBaseM: 150,
  departBaseM: 250,
  arriveSamples: 3,
  departSamples: 2,
  maxAccuracyM: 100,
  stationaryMps: 2,
};
/* 보행 속도가 1.2~1.5m/s라 2로 두면 가게 앞을 지나가는 것도 '멈춤'이 된다 */
const LIVE_SLOW: ArrivalProfile = { ...LIVE_CAR, arriveBaseM: 80, stationaryMps: 1 };
/* 시뮬레이션은 틱당 700m를 움직여 반경 안에 두 번 들어오지 않는다 — 1샘플, 속도·정확도 검사 없음 */
const SIM: ArrivalProfile = {
  arriveBaseM: 400,
  departBaseM: 600,
  arriveSamples: 1,
  departSamples: 1,
  maxAccuracyM: null,
  stationaryMps: Infinity,
};

export function profileFor(sim: boolean, mode: TravelMode): ArrivalProfile {
  if (sim) return SIM;
  return mode === 'car' ? LIVE_CAR : LIVE_SLOW;
}

/** 두 지점이 100m 안쪽이면 출발 반경은 여기서 멈춘다 */
export const DEPART_FLOOR_M = 50;

export type ArrivalState = {
  /** 연속 카운트가 붙은 지점 id */
  streakId: string | null;
  arriveStreak: number;
  departStreak: number;
  /** 이미 도착 이벤트를 낸 지점 — dispatch 반영 전 샘플의 중복 방지 */
  arrivedId: string | null;
  /** 이미 출발 이벤트를 낸 지점 */
  departedId: string | null;
};

export const initialArrivalState: ArrivalState = {
  streakId: null,
  arriveStreak: 0,
  departStreak: 0,
  arrivedId: null,
  departedId: null,
};

export type ArrivalEvent =
  | { kind: 'arrive'; id: string }
  | { kind: 'depart'; id: string }
  /** 도착을 못 본 채 다음 지점에 도착 → 지나간 것으로 처리 */
  | { kind: 'skip'; id: string };

export type ArrivalContext = {
  /** stops[passedCount] ?? 목적지. 목적지까지 끝났으면 null */
  target: Point | null;
  /** stops[passedCount+1] ?? 목적지. target이 목적지면 null */
  next: Point | null;
  /** target에 체류 중인가 */
  atStop: boolean;
  profile: ArrivalProfile;
};

export type ArrivalStep = {
  state: ArrivalState;
  events: ArrivalEvent[];
  /** 샘플을 버렸으면 이유 */
  ignored: 'accuracy' | null;
  distToTargetM: number | null;
  distToNextM: number | null;
  arriveR: number;
  departR: number;
};

export function stepArrival(state: ArrivalState, fix: Fix, ctx: ArrivalContext): ArrivalStep {
  const { target, next, atStop, profile } = ctx;
  const arriveR = Math.max(profile.arriveBaseM, fix.accuracyM ?? 0);
  const gap = target && next ? haversineM(target.coord, next.coord) : null;
  const departR = gap == null ? profile.departBaseM : Math.min(profile.departBaseM, Math.max(DEPART_FLOOR_M, gap / 2));
  const distToTargetM = target ? haversineM(fix, target.coord) : null;
  const distToNextM = next ? haversineM(fix, next.coord) : null;
  const base = { ignored: null as ArrivalStep['ignored'], distToTargetM, distToNextM, arriveR, departR };
  const quiet = (s: ArrivalState): ArrivalStep => ({ ...base, state: s, events: [] });

  // 0. 갈 곳이 없다
  if (!target || distToTargetM == null) return quiet(state);

  // 1. 정확도 필터 — 나쁜 샘플은 없던 것으로
  if (profile.maxAccuracyM != null && fix.accuracyM != null && fix.accuracyM > profile.maxAccuracyM) {
    return { ...quiet(state), ignored: 'accuracy' };
  }

  // 2. 멈춤 — 속도를 모르면 멈춘 것으로 본다(연속 샘플 규칙이 남아 있다)
  const speed = fix.speedMps;
  const stationary = speed == null || speed < 0 || speed < profile.stationaryMps;

  // 3. 다음 지점 선행 도착 — 두 반경이 겹치면 더 가까운 쪽이 이긴다
  if (next && distToNextM != null && distToNextM < arriveR && distToNextM < distToTargetM && stationary) {
    const streak = (state.streakId === next.id ? state.arriveStreak : 0) + 1;
    if (streak >= profile.arriveSamples) {
      return {
        ...base,
        state: { streakId: null, arriveStreak: 0, departStreak: 0, arrivedId: next.id, departedId: target.id },
        events: [{ kind: atStop ? 'depart' : 'skip', id: target.id }, { kind: 'arrive', id: next.id }],
      };
    }
    return quiet({ ...state, streakId: next.id, arriveStreak: streak, departStreak: 0 });
  }

  // 4. target 도착
  if (!atStop) {
    if (state.arrivedId === target.id) return quiet(state);
    const inside = distToTargetM < arriveR && stationary;
    const streak = inside ? (state.streakId === target.id ? state.arriveStreak : 0) + 1 : 0;
    if (inside && streak >= profile.arriveSamples) {
      return {
        ...base,
        state: { ...state, streakId: null, arriveStreak: 0, departStreak: 0, arrivedId: target.id },
        events: [{ kind: 'arrive', id: target.id }],
      };
    }
    return quiet({ ...state, streakId: target.id, arriveStreak: streak, departStreak: 0 });
  }

  // 5. target 출발
  if (state.departedId === target.id) return quiet(state);
  const outside = distToTargetM > departR;
  const streak = outside ? (state.streakId === target.id ? state.departStreak : 0) + 1 : 0;
  if (outside && streak >= profile.departSamples) {
    return {
      ...base,
      state: { ...state, streakId: null, arriveStreak: 0, departStreak: 0, departedId: target.id },
      events: [{ kind: 'depart', id: target.id }],
    };
  }
  return quiet({ ...state, streakId: target.id, departStreak: streak, arriveStreak: 0 });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/arrival.test.ts && npx tsc --noEmit -p .`
Expected: 17 pass, tsc 출력 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/arrival.ts src/lib/arrival.test.ts
git commit -m "도착·출발 판정 순수 모듈 — 3샘플·정지·정확도 규칙, 다음 지점 선행 도착

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 추적 로그 순수 부분 `trackLogFormat.ts`

**Files:**
- Create: `src/lib/trackLogFormat.ts`
- Test: `src/lib/trackLogFormat.test.ts`

**Interfaces:**
- Consumes: 없음.
- Produces (Task 3·4·5가 쓴다):
  - `type TrackEvent` (아래 유니언)
  - `KEEP_DAYS = 7`, `CAP_BYTES = 2 * 1024 * 1024`
  - `fileNameFor(d: Date): string` → `track-YYYYMMDD.jsonl` (로컬 날짜)
  - `isTrackFile(name: string): boolean`
  - `pruneList(names: string[], today: Date, keepDays?: number): string[]` → 지울 이름들
  - `serialize(event: TrackEvent, now: Date): string` → `{"t":..., "k":..., ...}\n`
  - `overCap(bytes: number, cap?: number): boolean`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/trackLogFormat.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP_BYTES, KEEP_DAYS, fileNameFor, isTrackFile, overCap, pruneList, serialize } from './trackLogFormat.ts';

test('파일명은 로컬 날짜 기준 track-YYYYMMDD.jsonl', () => {
  // 로컬 자정 직후 — UTC로 바꾸면 전날이 될 수 있는 시각
  const d = new Date(2026, 8, 11, 0, 10);
  assert.equal(fileNameFor(d), 'track-20260911.jsonl');
  assert.equal(fileNameFor(new Date(2026, 0, 5)), 'track-20260105.jsonl');
});

test('isTrackFile은 우리 파일만 고른다', () => {
  assert.equal(isTrackFile('track-20260911.jsonl'), true);
  assert.equal(isTrackFile('track-export.jsonl'), false);
  assert.equal(isTrackFile('notes.txt'), false);
});

test('pruneList: 7일보다 오래된 파일만 지운다 (오늘 포함 7일 보관)', () => {
  const today = new Date(2026, 8, 11);
  const names = [
    'track-20260911.jsonl',
    'track-20260905.jsonl', // 6일 전 — 남는다
    'track-20260904.jsonl', // 7일 전 — 지운다
    'track-20260801.jsonl',
    'other.txt',
  ];
  assert.deepEqual(pruneList(names, today), ['track-20260904.jsonl', 'track-20260801.jsonl']);
  assert.equal(KEEP_DAYS, 7);
});

test('serialize: t와 k가 앞에 오고 한 줄 JSON + 개행', () => {
  const now = new Date(2026, 8, 11, 9, 41, 3, 120);
  const line = serialize({ k: 'fix', lat: 37.5, lng: 126.9, acc: 30, spd: null, src: 'fg' }, now);
  assert.ok(line.endsWith('\n'));
  const obj = JSON.parse(line);
  assert.equal(obj.k, 'fix');
  assert.equal(obj.src, 'fg');
  assert.equal(obj.spd, null);
  assert.ok(obj.t.startsWith('2026-09-11T09:41:03.120'));
  // 로컬 오프셋이 붙는다 (+09:00 같은 형태). Z가 아니다
  assert.match(obj.t, /[+-]\d{2}:\d{2}$/);
  assert.deepEqual(Object.keys(obj).slice(0, 2), ['t', 'k']);
});

test('overCap: 2MB 이상이면 true', () => {
  assert.equal(CAP_BYTES, 2 * 1024 * 1024);
  assert.equal(overCap(CAP_BYTES - 1), false);
  assert.equal(overCap(CAP_BYTES), true);
  assert.equal(overCap(10, 5), true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/trackLogFormat.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/lib/trackLogFormat.ts`:

```ts
/**
 * 추적 로그의 순수 부분 — 이벤트 타입, 파일명, 보관, 직렬화, 상한.
 *
 * 왜: 실기기에서 도착 오판이 나면 화면 캡처로 원인을 추측해야 했다. 기기에 판정 근거를
 * 남겨 내려받는다. 파일 I/O는 trackLog.ts에 두고, 여기는 node 테스트가 닿는 부분만 둔다.
 */

export const KEEP_DAYS = 7;
export const CAP_BYTES = 2 * 1024 * 1024;

export type TrackEvent =
  | { k: 'fix'; lat: number; lng: number; acc: number | null; spd: number | null; src: 'fg' | 'bg' | 'sim' }
  | {
      k: 'geofence';
      target: string | null;
      next: string | null;
      dTarget: number | null;
      dNext: number | null;
      arriveR: number;
      departR: number;
      ignored: string | null;
      events: string[];
      atStop: boolean;
    }
  | { k: 'track'; from: string; to: string; crossTrack: number; progress: number }
  | { k: 'mode'; from: string; to: string; via: 'setMode' | 'keepPlan' | 'dismissOffRoute' | 'auto' | 'anchor' }
  | {
      k: 'plan';
      origin: { lat: number; lng: number };
      dest: { lat: number; lng: number };
      stops: { id: string; name: string; lat: number; lng: number }[];
      mode: string;
      source: 'server' | 'mock';
    }
  | { k: 'notify'; kind: 'arrival' | 'nextLeg' | 'dest'; id: string };

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 로컬 날짜 기준. UTC로 바꾸면 자정 근처 기록이 전날 파일로 간다 */
export function fileNameFor(d: Date): string {
  return `track-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jsonl`;
}

const TRACK_FILE = /^track-\d{8}\.jsonl$/;

export function isTrackFile(name: string): boolean {
  return TRACK_FILE.test(name);
}

/** 지울 파일 이름들 — 오늘 포함 keepDays일보다 오래된 것. 파일명이 정렬 가능해서 문자열 비교로 충분하다 */
export function pruneList(names: string[], today: Date, keepDays = KEEP_DAYS): string[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (keepDays - 1));
  const keepFrom = fileNameFor(cutoff);
  return names.filter(n => isTrackFile(n) && n < keepFrom);
}

/** ISO 8601에 로컬 오프셋을 붙인다 — 분석할 때 한국 시각 그대로 읽히게 */
function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function serialize(event: TrackEvent, now: Date): string {
  const { k, ...rest } = event;
  return JSON.stringify({ t: localIso(now), k, ...rest }) + '\n';
}

export function overCap(bytes: number, cap = CAP_BYTES): boolean {
  return bytes >= cap;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/trackLogFormat.test.ts && npx tsc --noEmit -p .`
Expected: 5 pass, tsc 깨끗.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/trackLogFormat.ts src/lib/trackLogFormat.test.ts
git commit -m "추적 로그 순수 부분 — 이벤트 타입·일별 파일명·7일 보관·직렬화·2MB 상한

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 파일 I/O `trackLog.ts` + 의존성 + 분석 스크립트

**Files:**
- Create: `src/lib/trackLog.ts`
- Create: `scripts/tracklog-timeline.mjs`
- Modify: `package.json`, `package-lock.json` (expo-file-system, expo-sharing)

**Interfaces:**
- Consumes (Task 2): `TrackEvent`, `fileNameFor`, `isTrackFile`, `pruneList`, `serialize`, `overCap` from `./trackLogFormat`.
- Produces (Task 4·5가 쓴다):
  - `logTrack(e: TrackEvent): void` — 동기, 절대 던지지 않음
  - `listTrackLogs(): Promise<{ name: string; bytes: number }[]>`
  - `exportTrackLogs(): Promise<'shared' | 'empty' | 'unavailable'>`
  - `clearTrackLogs(): Promise<void>`

- [ ] **Step 1: 의존성 설치**

```bash
npx expo install expo-file-system expo-sharing
```

`package.json`에 `"expo-file-system": "~57.x"`, `"expo-sharing": "~57.x"`가 들어갔는지 확인. `ios/`가 바뀌었으면 되돌린다(`git checkout -- ios` — 워크트리에는 없을 수도 있다).

설치 후 신 API 시그니처를 실제 타입으로 확인한다:

```bash
grep -n "append\|write(" node_modules/expo-file-system/build/ExpoFileSystem.types.d.ts | head
grep -n "class Paths\|static get document\|static get cache" node_modules/expo-file-system/build/*.d.ts | head
```

`File.write(content, { append: true })`가 없으면 `const prev = f.exists ? await f.text() : ''; f.write(prev + lines)`로 대체한다.

- [ ] **Step 2: 구현**

`src/lib/trackLog.ts`:

```ts
/**
 * 실기기 추적 로그 — 문서 폴더에 일별 JSONL로 남기고 개발 메뉴에서 내보낸다.
 *
 * 왜: 도착 오판을 화면 캡처로 추측하지 않으려고. 로컬 전용이고 7일·2MB로 자른다.
 * logTrack은 절대 던지지 않는다 — 로그가 추적을 깨면 안 된다.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fileNameFor, isTrackFile, overCap, pruneList, serialize, type TrackEvent } from './trackLogFormat';

const FLUSH_MS = 500;

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** 오늘 파일명 — 날짜가 바뀌면 보관 정리를 다시 돈다 */
let dayName = '';
/** 오늘 파일이 상한을 넘어 더 쓰지 않는 상태 */
let capped = false;

const dir = () => new Directory(Paths.document, 'tracklog');

export function logTrack(e: TrackEvent): void {
  try {
    queue.push(serialize(e, new Date()));
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch {
    // 직렬화 실패는 버린다
  }
}

function flush() {
  timer = null;
  const lines = queue;
  queue = [];
  if (lines.length === 0) return;
  try {
    const d = dir();
    if (!d.exists) d.create();
    const today = new Date();
    const name = fileNameFor(today);
    if (name !== dayName) {
      dayName = name;
      capped = false;
      for (const n of pruneList(d.list().map(i => i.name), today)) {
        try {
          new File(d, n).delete();
        } catch {}
      }
    }
    if (capped) return;
    const f = new File(d, name);
    if (!f.exists) f.create();
    if (overCap(f.size)) {
      capped = true;
      return;
    }
    f.write(lines.join(''), { append: true });
  } catch {
    // 파일 오류는 조용히 — 추적이 우선이다
  }
}

export async function listTrackLogs(): Promise<{ name: string; bytes: number }[]> {
  try {
    const d = dir();
    if (!d.exists) return [];
    return d
      .list()
      .filter(i => isTrackFile(i.name))
      .map(i => ({ name: i.name, bytes: i.size ?? 0 }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch {
    return [];
  }
}

/** 7일치를 하나로 합쳐 공유 시트로 넘긴다 (AirDrop·파일 저장·메일) */
export async function exportTrackLogs(): Promise<'shared' | 'empty' | 'unavailable'> {
  flush();
  const files = await listTrackLogs();
  if (files.length === 0) return 'empty';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const d = dir();
  let all = '';
  for (const { name } of files) all += await new File(d, name).text();
  const out = new File(Paths.cache, 'track-export.jsonl');
  if (out.exists) out.delete();
  out.create();
  out.write(all);
  await Sharing.shareAsync(out.uri, { UTI: 'public.json', mimeType: 'application/json', dialogTitle: '추적 로그 내보내기' });
  return 'shared';
}

export async function clearTrackLogs(): Promise<void> {
  queue = [];
  try {
    const d = dir();
    if (d.exists) d.delete();
  } catch {}
  dayName = '';
  capped = false;
}
```

- [ ] **Step 3: 분석 스크립트**

`scripts/tracklog-timeline.mjs`:

```js
#!/usr/bin/env node
/**
 * 내려받은 추적 로그(JSONL)를 타임라인으로 펼친다. 의존성 없음.
 *
 *   node scripts/tracklog-timeline.mjs track-export.jsonl
 *
 * plan 줄에서 지점 이름을 익히고 geofence·track·mode·notify를 시각순으로 한 줄씩 찍는다.
 * fix는 접어서 이벤트 사이 샘플 수·정확도 범위만 요약한다.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/tracklog-timeline.mjs <file.jsonl>');
  process.exit(1);
}

const rows = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .sort((a, b) => (a.t < b.t ? -1 : 1));

const names = new Map();
const name = id => (id == null ? '-' : (names.get(id) ?? id));
const hm = t => t.slice(11, 19);
const m = v => (v == null ? '-' : `${Math.round(v)}m`);

let fixes = [];
function flushFixes() {
  if (fixes.length === 0) return;
  const acc = fixes.map(f => f.acc).filter(a => a != null);
  const spd = fixes.map(f => f.spd).filter(s => s != null);
  const range = (xs, unit) => (xs.length ? `${Math.min(...xs).toFixed(0)}~${Math.max(...xs).toFixed(0)}${unit}` : '-');
  console.log(`         · fix ${fixes.length}건 (acc ${range(acc, 'm')}, spd ${range(spd, 'm/s')}, src ${[...new Set(fixes.map(f => f.src))].join('/')})`);
  fixes = [];
}

for (const r of rows) {
  if (r.k === 'fix') {
    fixes.push(r);
    continue;
  }
  flushFixes();
  const t = hm(r.t);
  switch (r.k) {
    case 'plan':
      names.set('D', '목적지');
      for (const s of r.stops) names.set(s.id, s.name);
      console.log(`${t} PLAN  ${r.mode} · ${r.source} · 경유 ${r.stops.map(s => s.name).join(' → ')} → 목적지`);
      break;
    case 'geofence': {
      const ev = r.events.length ? `  ⇒ ${r.events.join(', ')}` : '';
      const ig = r.ignored ? `  (무시: ${r.ignored})` : '';
      console.log(`${t} GEO   ${name(r.target)} ${m(r.dTarget)}/${m(r.arriveR)} ${r.atStop ? '체류' : '접근'} · next ${name(r.next)} ${m(r.dNext)} · 출발R ${m(r.departR)}${ig}${ev}`);
      break;
    }
    case 'track':
      console.log(`${t} TRACK ${r.from} → ${r.to} · 경로에서 ${m(r.crossTrack)} · 진행 ${m(r.progress)}`);
      break;
    case 'mode':
      console.log(`${t} MODE  ${r.from} → ${r.to} (${r.via})`);
      break;
    case 'notify':
      console.log(`${t} NOTI  ${r.kind} ${name(r.id)}`);
      break;
    default:
      console.log(`${t} ${r.k}`);
  }
}
flushFixes();
```

동작 확인 — 임시 파일로:

```bash
cat > /tmp/tl.jsonl <<'EOF'
{"t":"2026-09-11T09:40:00.000+09:00","k":"plan","origin":{"lat":1,"lng":1},"dest":{"lat":2,"lng":2},"stops":[{"id":"s1","name":"올리브영","lat":1,"lng":1}],"mode":"transit","source":"mock"}
{"t":"2026-09-11T09:40:05.000+09:00","k":"fix","lat":1,"lng":1,"acc":30,"spd":1.2,"src":"fg"}
{"t":"2026-09-11T09:40:05.001+09:00","k":"geofence","target":"s1","next":"D","dTarget":40,"dNext":900,"arriveR":80,"departR":250,"ignored":null,"events":["arrive:s1"],"atStop":false}
{"t":"2026-09-11T09:40:05.002+09:00","k":"notify","kind":"arrival","id":"s1"}
EOF
node scripts/tracklog-timeline.mjs /tmp/tl.jsonl
```

Expected: PLAN 줄, `· fix 1건`, GEO 줄에 `올리브영 40m/80m 접근 … ⇒ arrive:s1`, NOTI 줄.

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit -p . && npm test`
Expected: 깨끗, 전체 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json src/lib/trackLog.ts scripts/tracklog-timeline.mjs
git commit -m "추적 로그 파일 I/O — 일별 JSONL 배치 기록, 내보내기·지우기, 타임라인 스크립트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

`git show --stat HEAD`로 `node_modules`·`ios/`가 안 들어갔는지 확인한다.

---

### Task 4: `tracker.tsx` 연결 — 판정 교체, 모드 복귀, 로그

**Files:**
- Modify: `src/lib/backgroundLocation.ts` (리스너 타입, 정확도·속도 전달)
- Modify: `src/state/tracker.tsx`

**Interfaces:**
- Consumes (Task 1): `Fix`, `Point`, `profileFor`, `initialArrivalState`, `stepArrival`, `ArrivalState` from `../lib/arrival`.
- Consumes (Task 3): `logTrack` from `../lib/trackLog`. (Task 2): `TrackEvent`는 `logTrack` 인자로 암묵 사용.
- Consumes (기존): `usePlanFlow()` from `./planFlowProvider` → `{ usingServer: boolean }`. TrackerProvider는 PlanFlowProvider 안에 있다(App.tsx).
- Produces: `TrackerApi` 시그니처는 그대로. 동작만 바뀐다.

- [ ] **Step 1: `backgroundLocation.ts` — Fix 전달**

```ts
// import에 추가
import type { Fix } from './arrival';
// LatLng import는 더 이상 안 쓰면 지운다

type Listener = (fix: Fix) => void;
let lastPosition: Fix | null = null;

// defineTask 안
  lastPosition = toFix(last);
  listeners.forEach(l => l(lastPosition!));

// 파일 하단에 export
/** expo-location 객체를 판정 입력으로. iOS는 속도를 모르면 -1을 준다 */
export function toFix(loc: Location.LocationObject): Fix {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  return {
    latitude,
    longitude,
    accuracyM: accuracy ?? null,
    speedMps: speed == null || speed < 0 ? null : speed,
  };
}
```

- [ ] **Step 2: `tracker.tsx` — import와 머리 주석**

머리 주석의 "판정 규칙" 문단 앞에 한 문단 추가:

```
 * 도착·출발은 src/lib/arrival.ts의 stepArrival이 판정한다 —
 *   live: 반경 안 연속 3샘플 + 정지, accuracy > 100m 무시, 출발 반경 = min(250, 다음 지점 거리/2)
 *   sim : 1샘플 (틱당 700m라 연속 샘플이 불가능)
 * 여기서는 이벤트를 dispatch·알림·로그로 옮기기만 한다.
```

import 추가:

```ts
import { initialArrivalState, profileFor, stepArrival, type ArrivalState, type Fix, type Point } from '../lib/arrival';
import { toFix } from '../lib/backgroundLocation';
import { logTrack } from '../lib/trackLog';
import { usePlanFlow } from './planFlowProvider';
```

`ARRIVE_RADIUS_M`·`DEPART_RADIUS_M` 상수와 그 위 주석 블록(“도착·출발 지오펜스 …” 두 문단)을 삭제한다.

- [ ] **Step 3: `tracker.tsx` — 지오펜스 블록을 `stepArrival`로 교체**

`detectRef` 타입과 본문의 지오펜스 부분(`const sim = …`부터 `// 이탈 판정` 직전까지)을 아래로 바꾼다. 이탈 판정 이하는 그대로.

```ts
  const arrivalRef = useRef<ArrivalState>(initialArrivalState);

  const detectRef = useRef<(fix: Fix, src: 'fg' | 'bg' | 'sim', simStuck?: boolean) => void>(() => {});
  detectRef.current = (fix: Fix, src, simStuck = false) => {
    const position: LatLng = { latitude: fix.latitude, longitude: fix.longitude };
    logTrack({ k: 'fix', lat: fix.latitude, lng: fix.longitude, acc: fix.accuracyM ?? null, spd: fix.speedMps ?? null, src });

    // 도착·출발 — 순수 판정에 넘기고 이벤트만 옮긴다
    const { stops, passedCount, atStop, arrivedAtDest } = planRef.current;
    const destPoint: Point = { id: 'D', coord: shift(destCoordRef.current) };
    const targetStop = stops[passedCount];
    const target: Point | null = targetStop
      ? { id: targetStop.id, coord: shift(targetStop.coord) }
      : arrivedAtDest
        ? null
        : destPoint;
    const nextStop = stops[passedCount + 1];
    const next: Point | null = !targetStop ? null : nextStop ? { id: nextStop.id, coord: shift(nextStop.coord) } : destPoint;
    const step = stepArrival(arrivalRef.current, fix, {
      target,
      next,
      atStop,
      profile: profileFor(isSimMode(mode), planRef.current.mode),
    });
    arrivalRef.current = step.state;
    if (step.ignored == null && target) {
      logTrack({
        k: 'geofence',
        target: target.id,
        next: next?.id ?? null,
        dTarget: step.distToTargetM,
        dNext: step.distToNextM,
        arriveR: step.arriveR,
        departR: step.departR,
        ignored: null,
        events: step.events.map(e => `${e.kind}:${e.id}`),
        atStop,
      });
    }
    for (const ev of step.events) {
      if (ev.kind === 'arrive' && ev.id === 'D') {
        actionsRef.current.arriveAtDestination();
        if (!notifiedRef.current.dest) {
          notifiedRef.current.dest = true;
          const p = planRef.current;
          logTrack({ k: 'notify', kind: 'dest', id: 'D' });
          void notifyDestinationArrival(
            destinationDisplay,
            p.arriveByMin == null || toMin(p.destArriveAt) <= p.arriveByMin,
            formatEta(p.destArriveAt),
          );
        }
      } else if (ev.kind === 'arrive') {
        const stop = stops.find(s => s.id === ev.id);
        actionsRef.current.arriveAtStop();
        if (stop && notifiedRef.current.arrived !== stop.id) {
          notifiedRef.current.arrived = stop.id;
          logTrack({ k: 'notify', kind: 'arrival', id: stop.id });
          void notifyArrival(stop.id, stop.name, stop.tasks.length);
        }
      } else if (ev.kind === 'depart') {
        actionsRef.current.departStop();
        if (notifiedRef.current.departed !== ev.id) {
          notifiedRef.current.departed = ev.id;
          const idx = stops.findIndex(s => s.id === ev.id);
          const after = stops[idx + 1];
          logTrack({ k: 'notify', kind: 'nextLeg', id: after?.id ?? 'D' });
          void notifyNextLeg(
            after?.name ?? destinationDisplay,
            formatEta(after?.arriveAt ?? planRef.current.destArriveAt),
            planRef.current.mode === 'transit',
          );
        }
      } else {
        // skip — 도착을 못 본 채 지나간 경유지. 알림 없이 다음으로 넘긴다
        actionsRef.current.departStop();
      }
    }

    // 이탈 판정 — 폴리라인까지 수직거리   (이하 기존 코드, `position` 사용)
```

주의: 이벤트 순서가 `[depart|skip, arrive]`일 때 `departStop()`이 먼저 dispatch돼 `passedCount`가 오른 뒤 `arriveAtStop()`이 오므로 리듀서는 새 target에 `atStop=true`를 건다. 리듀서를 고칠 필요 없다.

- [ ] **Step 4: `tracker.tsx` — 호출부 3곳에 `src` 전달**

- 시뮬레이션 틱: `detectRef.current(position, mode === 'stuck')` → `detectRef.current({ ...position, accuracyM: null, speedMps: null }, 'sim', mode === 'stuck')`
- 배경 구독: `subscribeBackgroundLocation(p => detectRef.current(p))` → `subscribeBackgroundLocation(f => detectRef.current(f, 'bg'))`
- 첫 위치·watch: `detectRef.current({ latitude: first.coords.latitude, longitude: first.coords.longitude })` → `detectRef.current(toFix(first), 'fg')`; watch 콜백도 `detectRef.current(toFix(loc), 'fg')`

- [ ] **Step 5: `tracker.tsx` — 판정 상태 리셋과 모드 로그**

`setMode`:

```ts
  const setMode = (next: SimMode) => {
    logTrack({ k: 'mode', from: mode, to: next, via: 'setMode' });
    arrivalRef.current = initialArrivalState;
    setModeRaw(next);
    // … 기존 본문 그대로
  };
```

자동 시작 effect: `setModeRaw('live'); setTracker(t => ({ ...t, mode: 'live' }));` 앞에 로그와 계획 스냅샷:

```ts
  const { usingServer } = usePlanFlow();
  // (effect 안)
    logTrack({
      k: 'plan',
      origin: { lat: originCoord.latitude, lng: originCoord.longitude },
      dest: { lat: destCoord.latitude, lng: destCoord.longitude },
      stops: state.stops.map(s => ({ id: s.id, name: s.name, lat: s.coord.latitude, lng: s.coord.longitude })),
      mode: state.mode,
      source: usingServer ? 'server' : 'mock',
    });
    logTrack({ k: 'mode', from: mode, to: 'live', via: 'auto' });
    arrivalRef.current = initialArrivalState;
```

effect deps는 `[state.planConfirmed]` 유지 — 나머지는 확정 순간의 값이면 된다(eslint 주석 `// eslint-disable-next-line react-hooks/exhaustive-deps` 추가).

`anchorToMyLocation`: `setModeRaw('live')` 앞에 `logTrack({ k: 'mode', from: mode, to: 'live', via: 'anchor' }); arrivalRef.current = initialArrivalState;`.

- [ ] **Step 6: `tracker.tsx` — ① 모드 복귀**

`keepPlan`과 `dismissOffRoute`에서 `setModeRaw('driving')`을 없앤다. 시뮬레이션 `deviate`만 `driving`으로 — 그대로 두면 계속 벗어난다.

```ts
      keepPlan: () => {
        // 경로로 복귀 — 이탈 상태만 풀고 위치 공급원은 그대로 둔다 (live면 live)
        const next: SimMode = mode === 'deviate' ? 'driving' : mode;
        logTrack({ k: 'mode', from: mode, to: next, via: 'keepPlan' });
        deviationRef.current = 0;
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        if (next !== mode) setModeRaw(next);
        setTracker(t => ({ ...t, mode: next, status: 'moving', etaDeltaMin: 0, offRouteStopId: null }));
      },
      dismissOffRoute: () => {
        const next: SimMode = mode === 'deviate' ? 'driving' : mode;
        logTrack({ k: 'mode', from: mode, to: next, via: 'dismissOffRoute' });
        deviationRef.current = 0;
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        if (next !== mode) setModeRaw(next);
        setTracker(t => ({ ...t, mode: next, status: 'moving', offRouteStopId: null }));
      },
```

`api`의 `useMemo` deps에 `mode`를 추가한다.

- [ ] **Step 7: `tracker.tsx` — status 전이 로그**

`api` useMemo 앞에:

```ts
  // status가 바뀔 때만 한 줄 — setTracker 갱신 함수 안에서 로그하면 StrictMode에서 두 번 찍힌다
  const prevStatusRef = useRef(tracker.status);
  useEffect(() => {
    if (prevStatusRef.current === tracker.status) return;
    logTrack({ k: 'track', from: prevStatusRef.current, to: tracker.status, crossTrack: tracker.crossTrackM, progress: tracker.progressM });
    prevStatusRef.current = tracker.status;
  }, [tracker.status, tracker.crossTrackM, tracker.progressM]);
```

- [ ] **Step 8: 검사**

Run: `npx tsc --noEmit -p . && npm test`
Expected: 깨끗, 전부 통과.

이어서 시뮬레이터로 확인한다(Metro는 :8081에 떠 있다). 개발 메뉴 → `정상 주행`으로 경유지 도착·출발·목적지 도착이 예전처럼 자동 전환되는지, `경로 이탈` → 이탈 시트 → "계획 유지" 뒤 모드가 `정상 주행`(deviate→driving)인지 본다. 시뮬레이터 실행이 불가능한 환경이면 보고서에 "미확인"으로 적는다.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/backgroundLocation.ts src/state/tracker.tsx
git commit -m "추적기 — 도착·출발을 stepArrival로, 이탈 복귀는 모드 유지, 추적 로그 기록

keepPlan·dismissOffRoute가 가상 주행을 켜던 문제를 없앤다. 지오펜스는 3샘플·정지·정확도
규칙의 순수 모듈로 옮기고, 목적지는 마지막 경유지의 next로 미리 본다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 개발 메뉴 "추적 로그" 카드

**Files:**
- Modify: `src/sheets/DevSheet.tsx`

**Interfaces:**
- Consumes (Task 3): `listTrackLogs`, `exportTrackLogs`, `clearTrackLogs` from `../lib/trackLog`.

- [ ] **Step 1: 카드 추가**

import에 `useEffect, useState`와 `Alert`(react-native), 그리고:

```ts
import { clearTrackLogs, exportTrackLogs, listTrackLogs } from '../lib/trackLog';
```

컴포넌트 안, `tracker` 다음:

```ts
  const [logs, setLogs] = useState<{ name: string; bytes: number }[]>([]);
  const refreshLogs = () => {
    void listTrackLogs().then(setLogs);
  };
  useEffect(() => {
    if (visible) refreshLogs();
  }, [visible]);
  const totalKb = Math.round(logs.reduce((a, l) => a + l.bytes, 0) / 1024);
```

"위치 추적" 카드 바로 아래(마지막 안내 문구 위)에:

```tsx
        <Text style={[type.label, { color: color.muted }]}>추적 로그</Text>
        <Card style={{ padding: 14, gap: 10 }}>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
            {logs.length === 0 ? '기록된 로그가 없어요' : `${logs.length}일치 · ${totalKb}KB · 7일 보관 · 로컬에만 남아요`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              disabled={logs.length === 0}
              onPress={async () => {
                haptic();
                const r = await exportTrackLogs();
                if (r === 'unavailable') Alert.alert('공유할 수 없어요', '이 기기에서는 공유 시트를 열 수 없어요');
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: color.primaryTint,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: logs.length === 0 ? 0.4 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 14, color: color.primary }}>내보내기</Text>
            </Pressable>
            <Pressable
              disabled={logs.length === 0}
              onPress={() => {
                haptic();
                Alert.alert('추적 로그 지우기', '7일치 기록을 모두 지워요', [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '지우기',
                    style: 'destructive',
                    onPress: () => {
                      void clearTrackLogs().then(refreshLogs);
                    },
                  },
                ]);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: color.bg,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: logs.length === 0 ? 0.4 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 14, color: color.body }}>지우기</Text>
            </Pressable>
          </View>
        </Card>
```

파일 머리 주석을 `/** 개발 메뉴 — 목 데이터셋 전환 + 계산 실패 토글 + 위치 추적 + 추적 로그 내보내기 (A1 타이틀 길게 눌러 진입) */`로.

- [ ] **Step 2: 검사**

Run: `npx tsc --noEmit -p . && npm test`
Expected: 깨끗.

시뮬레이터에서 개발 메뉴를 열어 카드가 보이고, `정상 주행`을 잠시 돌린 뒤 다시 열면 "1일치 · NKB"로 바뀌는지 본다. 내보내기는 시뮬레이터 공유 시트가 뜨는지까지만. 시뮬레이터가 안 되면 보고서에 "미확인".

- [ ] **Step 3: 커밋**

```bash
git add src/sheets/DevSheet.tsx
git commit -m "개발 메뉴 — 추적 로그 내보내기·지우기 카드

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 자기 검토

- 스펙 §1 판정 모듈·프로필·규칙·시험 → Task 1. §2 tracker 변경(Fix 전달, stepArrival, 이벤트 처리, 리셋, ① 모드 복귀, 상수 삭제, 주석) → Task 4. §3 파일·이벤트·API·순수 부분·기록 지점 → Task 2·3·4. §4 개발 메뉴 → Task 5. §5 스크립트 → Task 3.
- 타입 일치: `Fix`·`Point`·`ArrivalContext`·`ArrivalStep`(Task 1) ↔ Task 4 사용; `TrackEvent` 필드(Task 2) ↔ Task 4의 `logTrack` 호출(`fix`·`geofence`·`track`·`mode`·`plan`·`notify` 모두 유니언 멤버와 같은 키); `exportTrackLogs` 반환 `'shared' | 'empty' | 'unavailable'`(Task 3) ↔ Task 5.
- 플레이스홀더 없음.
