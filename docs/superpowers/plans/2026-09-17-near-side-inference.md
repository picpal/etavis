# near 축 추론 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경유지를 출발지 쪽에 붙일지 목적지 쪽에 붙일지를 LLM 태그 3개 + 코드 정책으로 정하고, 그 판정이 검색 단계까지 실제로 닿게 한다.

**Architecture:** LLM은 물성·시점 태그(`loadBefore`·`loadAfter`·`needWhen`)만 뱉고 방향은 절대 뱉지 않는다. 방향은 순수 함수 `decideNear`가 정한다. 그 방향을 `searchAlong`·`searchAtAnchors`·30개 컷·`applyNear` 네 자리가 **같은 `matchesNear` 함수**로 공유한다. 완화는 진행률이 아니라 출발지·목적지로부터의 절대 거리 2단계다.

**Tech Stack:** TypeScript, Expo/React Native, Cloudflare Workers(서버), `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-17-near-side-inference-design.md`

## Global Constraints

- 테스트 실행은 `npm test` — `tsx --test 'src/**/*.test.ts' 'server/src/*.test.ts' 'scripts/*.test.mjs'`. 단일 파일은 `npx tsx --test src/lib/nearSide.test.ts`.
- **테스트 파일의 상대 import 는 `.ts` 확장자를 붙인다.** 기존 파일이 전부 그렇게 돼 있다(`import { applyNear } from './nearSide.ts'`).
- `src/lib/intent.ts` 는 **로컬 import 를 추가하지 않는다.** 타입을 인라인으로 쓴다 — `server/run-cases.mjs` 의 flat 컴파일이 로컬 import 를 못 읽는다(파일 주석에 명시).
- `score.ts` 의 목적함수(총 소요시간)는 건드리지 않는다.
- 커밋은 **작업 단위로**. `git add` 에 파일을 명시한다. `git add -A` 금지 — 워크트리의 `node_modules` 심링크가 커밋돼 사고가 난 적이 있다.
- 값 이름은 이 계획 전체에서 고정: `Load = 'none' | 'hard'`, `NeedWhen = 'beforeArrival' | 'afterArrival' | 'unknown'`, `NearSide = 'start' | 'end' | 'any'`.
- `NEAR_RADII_M = [1500, 3000]`, `NEAR_TARGET = 3`, `KC = 8`(기존).

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `server/src/schema.ts` | LLM 응답에서 태그 3개를 검증. `op: 'remove'` 는 태그 무시 | 1 |
| `src/lib/intent.ts` | 로컬 목도 태그를 낸다(보수적 기본값) | 1 |
| `src/lib/nearSide.ts` | `Load`·`NeedWhen` 타입, `decideNear`, `matchesNear`, `applyNear`. **이 설계의 유일한 정책 자리** | 2·3·4 |
| `src/lib/corridorSearch.ts` | 검색이 `side` 를 받아 샘플 구간·앵커·컷에 반영 | 5·6·7 |
| `src/state/plan.tsx` · `planFlow.ts` · `planRequest.ts` · `routePlan/types.ts` | 태그가 칩 → 요청 → 슬롯으로 흐르는 길 | 8 |
| `src/state/planFlow.ts` `requestKey` | 태그 변경이 재계산을 유발하게 | 9 |
| `src/state/runPlan.ts` | 위를 전부 엮고 진단 필드를 슬롯에 붙인다 | 10·11 |
| `src/state/actionLog.ts` | `plan.slots` 로그에 진단을 찍는다 | 10 |
| `server/prompts/extract-intent.md` · `server/src/prompt.ts` | 프롬프트 v10 | 12 |
| `server/case-score.mjs` · `server/prompts/cases.jsonl` | 태그 채점. 없으면 검증이 거짓이 된다 | 13 |
| `server/run-llm.mjs` | 반복 실행 흔들림 측정 + `near` 누락 버그 | 14 |

---

### Task 1: 태그 계약 — 스키마와 로컬 목

**Files:**
- Modify: `server/src/schema.ts:11-21` (`IntentStop`), `server/src/schema.ts:45-74` (`parseStop`)
- Modify: `src/lib/intent.ts:15-32` (`IntentStop`), `src/lib/intent.ts:241`, `:254`, `:348`, `:356`
- Test: `server/src/schema.test.ts`, `src/lib/intent.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 작업)
- Produces: `IntentStop` 에 `loadBefore: 'none'|'hard'`, `loadAfter: 'none'|'hard'`, `needWhen: 'beforeArrival'|'afterArrival'|'unknown'`. 스키마와 목이 같은 모양을 낸다.

- [ ] **Step 1: 스키마 실패 테스트를 쓴다**

`server/src/schema.test.ts` 끝에 추가:

```ts
test('태그 3개를 허용 목록으로 검증한다', () => {
  const got = parseIntent(JSON.stringify({
    stops: [{ queries: ['마트'], loadBefore: 'none', loadAfter: 'hard', needWhen: 'afterArrival' }],
  }));
  assert.equal(got?.stops[0].loadAfter, 'hard');
  assert.equal(got?.stops[0].needWhen, 'afterArrival');
});

test('목록 밖 값은 보수적 기본값으로 떨어진다', () => {
  const got = parseIntent(JSON.stringify({
    stops: [{ queries: ['마트'], loadBefore: '아주무거움', loadAfter: 7, needWhen: null }],
  }));
  assert.equal(got?.stops[0].loadBefore, 'none');
  assert.equal(got?.stops[0].loadAfter, 'none');
  assert.equal(got?.stops[0].needWhen, 'unknown');
});

test('op=remove 의 태그는 읽지 않는다', () => {
  const got = parseIntent(JSON.stringify({
    stops: [{ op: 'remove', queries: ['마트'], loadAfter: 'hard', needWhen: 'afterArrival' }],
  }));
  assert.equal(got?.stops[0].loadAfter, 'none');
  assert.equal(got?.stops[0].needWhen, 'unknown');
});
```

`parseIntent` 가 이 파일에서 이미 import 돼 있는지 확인하고, 없으면 기존 import 줄에 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test server/src/schema.test.ts`
Expected: FAIL — `loadAfter` 가 `undefined`

- [ ] **Step 3: 스키마를 고친다**

`server/src/schema.ts` 의 `IntentStop` 에 추가:

```ts
  /** 경유지까지 들고 가야 하는 것이 있나. 택배 부치기·세탁 맡기기 */
  loadBefore: 'none' | 'hard';
  /** 경유지에서 얻은 것을 대중교통·도보로 들고 이동하기 어려운가 */
  loadAfter: 'none' | 'hard';
  /** 목적지에 닿기 전에 필요한가, 닿은 뒤에 필요한가 */
  needWhen: 'beforeArrival' | 'afterArrival' | 'unknown';
```

`parseStop` 안, `const near = ...` 바로 아래에 추가:

```ts
  // 지울 경유지의 물성은 의미가 없다 — 읽으면 공격면만 는다
  const isRemove = r.op === 'remove';
  const load = (v: unknown): 'none' | 'hard' => (!isRemove && v === 'hard' ? 'hard' : 'none');
  const needWhen = !isRemove && (r.needWhen === 'beforeArrival' || r.needWhen === 'afterArrival')
    ? r.needWhen
    : 'unknown';
```

반환 객체에 `loadBefore: load(r.loadBefore), loadAfter: load(r.loadAfter), needWhen,` 를 넣는다.

- [ ] **Step 4: 스키마 테스트가 통과하는지 본다**

Run: `npx tsx --test server/src/schema.test.ts`
Expected: PASS

- [ ] **Step 5: 로컬 목 실패 테스트를 쓴다**

`src/lib/intent.test.ts` 끝에 추가:

```ts
test('목은 태그를 보수적으로만 낸다', () => {
  const got = extractIntent('마트 들렀다 집에 가자', { currentStops: [] });
  const add = got.stops.find(s => s.op === 'add');
  assert.equal(add?.loadBefore, 'none');
  assert.equal(add?.loadAfter, 'none');
  assert.equal(add?.needWhen, 'unknown');
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx tsx --test src/lib/intent.test.ts`
Expected: FAIL — `loadBefore` 가 `undefined`

- [ ] **Step 7: 로컬 목을 고친다**

`src/lib/intent.ts` 의 `IntentStop` 에 같은 세 필드를 **인라인 리터럴 타입으로** 추가한다(로컬 import 금지 — 파일 주석의 이유 그대로):

```ts
  /** 목은 물성을 추론하지 않는다 — 언제나 보수적 기본값이다. 진짜 판단은 LLM 몫이고,
      목이 찍으면 서버가 죽었을 때 없던 제약이 생긴다 */
  loadBefore: 'none' | 'hard';
  loadAfter: 'none' | 'hard';
  needWhen: 'beforeArrival' | 'afterArrival' | 'unknown';
```

`IntentStop` 리터럴을 만드는 네 자리(`:241`, `:254`, `extractStops` 의 `:348`·`:356`)에 `loadBefore: 'none', loadAfter: 'none', needWhen: 'unknown',` 를 넣는다. `grep -n "near," src/lib/intent.ts` 로 빠진 자리가 없는지 확인한다.

- [ ] **Step 8: 전체 테스트를 돌린다**

Run: `npm test`
Expected: PASS (타입 오류 없음)

- [ ] **Step 9: 커밋**

```bash
git add server/src/schema.ts server/src/schema.test.ts src/lib/intent.ts src/lib/intent.test.ts
git commit -m "feat: 추출에 물성·시점 태그 3개 추가 (스키마 + 로컬 목)"
```

---

### Task 2: `decideNear` — 방향을 정하는 정책

**Files:**
- Modify: `src/lib/nearSide.ts`
- Test: `src/lib/nearSide.test.ts`

**Interfaces:**
- Consumes: Task 1 의 태그 값 집합
- Produces:
  ```ts
  export type Load = 'none' | 'hard';
  export type NeedWhen = 'beforeArrival' | 'afterArrival' | 'unknown';
  export type StopTags = { loadBefore: Load; loadAfter: Load; needWhen: NeedWhen };
  export function decideNear(stated: NearSide | undefined, mode: Mode, tags: StopTags): NearSide;
  ```
  `resolveNear`·`nearFromCarry`·`CARRY` 는 이 작업에서 **삭제된다.** 호출부(`runPlan.ts:116`)는 Task 10 에서 고친다 — 그때까지 타입 오류가 남는다.

- [ ] **Step 1: 판정표 테스트를 쓴다**

`src/lib/nearSide.test.ts` 의 `resolveNear`·`nearFromCarry` 테스트를 지우고 대신 넣는다:

```ts
import { decideNear } from './nearSide.ts';
import type { Load, NeedWhen } from './nearSide.ts';
import type { Mode, NearSide } from './routePlan/types.ts';

const tags = (lb: Load, la: Load, nw: NeedWhen) => ({ loadBefore: lb, loadAfter: la, needWhen: nw });

const TABLE: [string, NearSide | undefined, Mode, Load, Load, NeedWhen, NearSide][] = [
  ['택배 부치고 회사',      undefined, 'transit', 'hard', 'none', 'unknown',       'start'],
  ['걸어가며 먹을 아이스크림', undefined, 'walk',    'none', 'hard', 'beforeArrival', 'start'],
  ['텀블러 커피',           undefined, 'transit', 'none', 'hard', 'beforeArrival', 'start'],
  ['카페에서 충전',         undefined, 'transit', 'none', 'none', 'beforeArrival', 'start'],
  ['우산',                 undefined, 'transit', 'none', 'none', 'beforeArrival', 'start'],
  ['세탁물 맡기고 회사',     undefined, 'transit', 'hard', 'none', 'unknown',       'start'],
  ['장보고 집 (지하철)',     undefined, 'transit', 'none', 'hard', 'afterArrival',  'end'],
  ['장보고 집 (도보)',       undefined, 'walk',    'none', 'hard', 'afterArrival',  'end'],
  ['커피 사서 회사 (말 안 함)', undefined, 'transit', 'none', 'hard', 'unknown',     'end'],
  ['꽃 사서 식장',          undefined, 'transit', 'none', 'hard', 'afterArrival',  'end'],
  ['세탁물 찾아 집',        undefined, 'transit', 'none', 'hard', 'afterArrival',  'end'],
  ['은행',                 undefined, 'transit', 'none', 'none', 'unknown',       'any'],
  ['장보고 집 (자동차)',     undefined, 'car',     'none', 'hard', 'afterArrival',  'any'],
];

for (const [name, stated, mode, lb, la, nw, want] of TABLE) {
  test(`decideNear — ${name} → ${want}`, () => {
    assert.equal(decideNear(stated, mode, tags(lb, la, nw)), want);
  });
}

test('사용자가 말한 위치가 태그를 이긴다', () => {
  assert.equal(decideNear('start', 'transit', tags('none', 'hard', 'afterArrival')), 'start');
  assert.equal(decideNear('end', 'transit', tags('hard', 'none', 'beforeArrival')), 'end');
});

test('자동차여도 사용자가 말했으면 지킨다', () => {
  assert.equal(decideNear('end', 'car', tags('none', 'none', 'unknown')), 'end');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/nearSide.test.ts`
Expected: FAIL — `decideNear is not a function`

- [ ] **Step 3: `decideNear` 를 쓰고 옛 함수를 지운다**

`src/lib/nearSide.ts` 에서 `CARRY`, `nearFromCarry`, `resolveNear` 를 **삭제**하고 넣는다:

```ts
/** 부담의 유무. 정도는 재지 않는다 — '생수 한 병'과 '장바구니 가득'을 나누면 태그가 흔들린다 */
export type Load = 'none' | 'hard';
/** 목적지에 닿기 전에 필요한가, 닿은 뒤에 필요한가 */
export type NeedWhen = 'beforeArrival' | 'afterArrival' | 'unknown';
export type StopTags = { loadBefore: Load; loadAfter: Load; needWhen: NeedWhen };

/**
 * 방향을 정하는 유일한 자리. LLM 은 방향을 뱉지 않는다 — 물성과 시점만 뱉고
 * 여기서 방향이 된다(AGENTS.md: LLM은 '무엇을'만 뽑는다).
 *
 * 분기 순서가 곧 우선순위다.
 * - `loadBefore` 가 `needWhen` 보다 앞인 이유: 택배를 부치러 가면서 도착해서 쓸 것을
 *   같이 사더라도, 상자를 오래 들고 다니는 쪽이 언제나 더 아프다.
 * - `needWhen === 'beforeArrival'` 이 `loadAfter` 보다 앞인 이유: 걸어가며 먹을
 *   아이스크림은 들고 가기 어렵지만 도착 전에 없어진다. 부담이 시점을 무조건 이기면 틀린다.
 * - `mode === 'car'` 는 일찍 빠진다. 차는 near 가 아니라 정차 용이성이 지배 축이고,
 *   그건 다음 단계다. 그래서 "차로 회 포장"을 못 잡는다 — 알려진 한계다(설계 §12).
 */
export function decideNear(stated: NearSide | undefined, mode: Mode, tags: StopTags): NearSide {
  if (stated === 'start' || stated === 'end') return stated;
  if (mode === 'car') return 'any';
  if (tags.loadBefore === 'hard') return 'start';
  if (tags.needWhen === 'beforeArrival') return 'start';
  if (tags.loadAfter === 'hard') return 'end';
  if (tags.needWhen === 'afterArrival') return 'end';
  return 'any';
}
```

`Mode` 는 이미 `./routePlan/types` 에서 import 돼 있다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/lib/nearSide.test.ts`
Expected: PASS. `npm test` 는 아직 `runPlan.ts` 의 타입 오류로 깨진다 — Task 10 에서 닫는다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/nearSide.ts src/lib/nearSide.test.ts
git commit -m "feat: decideNear — 태그로 방향을 정하고 CARRY regex를 버린다"
```

---

### Task 3: `matchesNear` — 진행률이 아니라 절대 거리

**Files:**
- Modify: `src/lib/nearSide.ts`
- Test: `src/lib/nearSide.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `nearSide.ts`
- Produces:
  ```ts
  export const NEAR_RADII_M: readonly number[]; // [1500, 3000]
  export function matchesNear(
    near: NearSide, coord: LatLng, origin: LatLng, destination: LatLng, radiusM: number,
  ): boolean;
  ```
  Task 5·6·7·4 가 **모두 이 함수를 쓴다.** 기준이 갈리면 검색이 채운 것을 필터가 버린다.
  `NEAR_SPLIT_S` 와 옛 `matchesNear(near, s)` 는 삭제된다.

- [ ] **Step 1: 길이 의존성 테스트를 쓴다**

`src/lib/nearSide.test.ts` 에서 `NEAR_SPLIT_S` 를 쓰는 테스트를 지우고 추가:

```ts
import { matchesNear, NEAR_RADII_M } from './nearSide.ts';

/** 위도 37.5 에서 경도 0.01° ≈ 883m */
const at = (lng: number): LatLng => ({ latitude: 37.5, longitude: lng });

test('절대 거리 — 짧은 경로에서 목적지 1km 안은 end 다', () => {
  const o = at(127.0), d = at(127.02); // 약 1.77km
  assert.equal(matchesNear('end', at(127.019), o, d, 1500), true);
  assert.equal(matchesNear('end', at(127.0), o, d, 1500), false);
});

test('절대 거리 — 긴 경로에서 진행률 0.6 지점은 end 가 아니다', () => {
  const o = at(127.0), d = at(127.5); // 약 44km. s=0.6 은 127.3
  assert.equal(matchesNear('end', at(127.3), o, d, 1500), false);
  assert.equal(matchesNear('end', at(127.495), o, d, 1500), true);
});

test('start 는 출발지 기준이다', () => {
  const o = at(127.0), d = at(127.5);
  assert.equal(matchesNear('start', at(127.005), o, d, 1500), true);
  assert.equal(matchesNear('start', at(127.3), o, d, 1500), false);
});

test('any 는 언제나 통과한다', () => {
  assert.equal(matchesNear('any', at(127.3), at(127.0), at(127.5), 1500), true);
});

test('반경 단계는 넓어지는 순서다', () => {
  assert.deepEqual([...NEAR_RADII_M], [1500, 3000]);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/nearSide.test.ts`
Expected: FAIL — 인자 개수가 안 맞음

- [ ] **Step 3: 구현한다**

`src/lib/nearSide.ts` 에서 `NEAR_SPLIT_S` 와 옛 `matchesNear` 를 지우고 넣는다. import 를 `projectOnCorridor` 에서 `haversineM` 으로 바꾼다:

```ts
import { haversineM } from './geo';

/**
 * 완화 단계. 좁은 쪽부터.
 *
 * 왜 진행률(`s`)이 아닌가: `s` 는 비율이라 경로 길이에 따라 뜻이 달라진다.
 * 2km 경로의 `s ≥ 0.6` 은 마지막 800m 지만 40km 경로에서는 마지막 16km 다.
 * 16km 떨어진 마트는 목적지 근처가 아니다.
 *
 * 1500m 은 `corridorSearch.ts` 의 `ANCHOR_MAX_M` 과 같은 값이다 — 거기서 이미
 * "이걸 넘으면 역 근처가 아니라 별개의 경유다"라는 선을 긋고 있다.
 */
export const NEAR_RADII_M = [1500, 3000] as const;

/**
 * 이 후보가 그쪽 끝에 있나. **검색·컷·필터 네 자리가 전부 이 함수를 쓴다** —
 * 기준이 갈리면 검색이 애써 채운 것을 필터가 버린다(설계 §5.1).
 */
export function matchesNear(
  near: NearSide,
  coord: LatLng,
  origin: LatLng,
  destination: LatLng,
  radiusM: number,
): boolean {
  if (near === 'any') return true;
  return haversineM(near === 'end' ? destination : origin, coord) <= radiusM;
}
```

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/lib/nearSide.test.ts`
Expected: PASS (`applyNear` 테스트는 아직 옛 시그니처라 깨진다 — Task 4 에서 닫는다)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/nearSide.ts src/lib/nearSide.test.ts
git commit -m "feat: matchesNear를 진행률에서 절대 거리로"
```

---

### Task 4: `applyNear` — 2단계 완화와 `NEAR_TARGET`

**Files:**
- Modify: `src/lib/nearSide.ts`
- Test: `src/lib/nearSide.test.ts`

**Interfaces:**
- Consumes: Task 3 의 `matchesNear`·`NEAR_RADII_M`
- Produces:
  ```ts
  export const NEAR_TARGET = 3;
  export function applyNear<T extends { coord: LatLng }>(
    candidates: readonly T[], near: NearSide, origin: LatLng, destination: LatLng, need?: number,
  ): { candidates: T[]; relaxed: boolean; radiusM: number | null };
  ```
  **시그니처가 바뀐다** — `poly: LatLng[]` 가 `origin, destination` 으로. 반환에 `radiusM` 이 는다.

- [ ] **Step 1: 완화 테스트를 쓴다**

`src/lib/nearSide.test.ts` 의 기존 `applyNear` 테스트를 새 시그니처로 갈아엎는다:

```ts
import { applyNear, NEAR_TARGET } from './nearSide.ts';

const O = at(127.0);
const D = at(127.5);
/** D 에서 서쪽으로 m 미터쯤 — 경도 0.01° ≈ 883m */
const nearD = (m: number) => at(127.5 - m / 88300);
const c = (id: string, coord: LatLng) => ({ id, coord });

test('그쪽에 충분하면 좁힌 결과를 준다', () => {
  const list = [c('a', nearD(200)), c('b', nearD(400)), c('c', nearD(600)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['a', 'b', 'c']);
  assert.equal(r.relaxed, false);
  assert.equal(r.radiusM, 1500);
});

test('1500m 에 모자라면 3000m 로 넓힌다', () => {
  const list = [c('a', nearD(200)), c('b', nearD(2000)), c('c', nearD(2500)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['a', 'b', 'c']);
  assert.equal(r.radiusM, 3000);
});

// 이 설계의 1순위 동기다. 현행 코드는 여기서 완화를 안 돌린다
test('need=1 이어도 그쪽 후보가 NEAR_TARGET 미만이면 완화한다', () => {
  const list = [c('a', nearD(200)), c('x', at(127.0)), c('y', at(127.01)),
                c('z', at(127.02)), c('w', at(127.03))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.equal(r.relaxed, true);
  assert.equal(r.candidates.length, 5);
  assert.equal(r.radiusM, null);
});

test('후보 총수가 NEAR_TARGET 보다 적으면 near 가 원인이 아니다 — 좁힌 결과를 쓴다', () => {
  const list = [c('a', nearD(200)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['a']);
  assert.equal(r.relaxed, false);
});

test('형제 슬롯이 셋이면 셋을 요구한다', () => {
  const list = [c('a', nearD(200)), c('b', nearD(400)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 3);
  assert.equal(r.relaxed, true); // 그쪽 2개 < 요구 3개, 총수 3개 ≥ 3 이라 예외도 안 걸린다
});

test('any 는 손대지 않는다', () => {
  const list = [c('a', nearD(200)), c('x', at(127.0))];
  const r = applyNear(list, 'any', O, D, 1);
  assert.equal(r.candidates.length, 2);
  assert.equal(r.relaxed, false);
  assert.equal(r.radiusM, null);
});

test('입력 순서를 보존한다 — 앞 단계(주차 정책)의 우선순위를 뒤집지 않는다', () => {
  const list = [c('c', nearD(600)), c('a', nearD(200)), c('b', nearD(400))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['c', 'a', 'b']);
});

test('NEAR_TARGET 은 3 이다', () => {
  assert.equal(NEAR_TARGET, 3);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/nearSide.test.ts`
Expected: FAIL — 인자 개수가 안 맞고 `radiusM` 이 없음

- [ ] **Step 3: 구현한다**

`src/lib/nearSide.ts` 의 `applyNear` 를 통째로 교체한다:

```ts
/**
 * 그쪽 끝에서 이만큼은 있어야 교체 시트가 의미를 갖는다.
 *
 * 왜 1이 아닌가: 현행은 `need = count = 1` 이라 그쪽에 한 곳만 남아도 완화가 안 돌았다.
 * 그 한 곳으로 확정되고 사용자는 대안 없는 추천을 본다 — 정확도보다 신뢰도가 먼저 무너진다.
 */
export const NEAR_TARGET = 3;

/**
 * 후보를 그쪽 끝으로 좁힌다. 반경을 넓혀 가며 요구량을 채우고, 끝내 못 채우면
 * **전부 되돌리고** `relaxed` 를 세운다. 0건이 곧 경유지 증발이라는 걸 2026-09-16 에
 * 한 번 겪었다(`샌드위치 파는 카페` → 0건 → 계획에서 통째로 사라짐).
 *
 * 입력 순서를 보존한다 — 앞 단계(주차 정책)가 매긴 우선순위를 뒤집으면 안 된다.
 *
 * @param need 이 near 를 공유하는 형제 슬롯 수. `runPlan` 이 센다
 * @returns radiusM 어느 단계에서 멈췄나. null 이면 전부 되돌린 것(또는 any)
 */
export function applyNear<T extends { coord: LatLng }>(
  candidates: readonly T[],
  near: NearSide,
  origin: LatLng,
  destination: LatLng,
  need = 1,
): { candidates: T[]; relaxed: boolean; radiusM: number | null } {
  if (near === 'any' || candidates.length === 0) {
    return { candidates: [...candidates], relaxed: false, radiusM: null };
  }
  const target = Math.max(need, NEAR_TARGET);
  // 애초에 후보가 목표보다 적으면 near 가 원인이 아니다 — 최소 need 만 지킨다
  const want = candidates.length < target ? Math.min(need, candidates.length) : target;
  for (const radiusM of NEAR_RADII_M) {
    const kept = candidates.filter(c => matchesNear(near, c.coord, origin, destination, radiusM));
    if (kept.length >= want) return { candidates: kept, relaxed: false, radiusM };
  }
  return { candidates: [...candidates], relaxed: true, radiusM: null };
}
```

`projectOnCorridor` import 가 더 이상 안 쓰이면 지운다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/lib/nearSide.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/nearSide.ts src/lib/nearSide.test.ts
git commit -m "feat: applyNear 2단계 완화 + NEAR_TARGET — need=1 에서도 완화가 돈다"
```

---

### Task 5: 회랑 검색이 `side` 를 안다

**Files:**
- Modify: `src/lib/corridorSearch.ts` (`CorridorSearchOptions`, `searchAlong`)
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: Task 3 의 `matchesNear`·`NEAR_RADII_M`
- Produces: `CorridorSearchOptions` 에 `side?: NearSide`, `origin?: LatLng`, `destination?: LatLng`. `side` 가 `'start'|'end'` 면 `origin`·`destination` 이 **필수**다(없으면 `side` 를 무시한다).

- [ ] **Step 1: 샘플 구간과 target 판정 테스트를 쓴다**

`src/lib/corridorSearch.test.ts` 에 추가:

```ts
import { searchAlong } from './corridorSearch.ts';
import type { PlaceCandidate } from './routePlan/types.ts';

const at = (lng: number) => ({ latitude: 37.5, longitude: lng });
const O = at(127.0), D = at(127.5);
const line = [O, D];

/** 검색 중심 좌표를 기록하는 목 */
function spy(make: (center: { latitude: number; longitude: number }) => PlaceCandidate[]) {
  const centers: number[] = [];
  const fn = async (_q: string, center: { latitude: number; longitude: number }) => {
    centers.push(center.longitude);
    return make(center);
  };
  return { fn, centers };
}

const none = () => [];

test('side=end 면 샘플 점이 후반부에만 찍힌다', async () => {
  const s = spy(none);
  await searchAlong(line, '마트', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'end', origin: O, destination: D,
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.equal(first.length, 5);
  assert.ok(Math.min(...first) >= 127.249, `후반부여야 한다: ${first}`);
  assert.ok(Math.max(...first) <= 127.5);
});

test('side=start 면 전반부에만 찍힌다', async () => {
  const s = spy(none);
  await searchAlong(line, '약국', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'start', origin: O, destination: D,
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.ok(Math.max(...first) <= 127.251, `전반부여야 한다: ${first}`);
});

test('side 를 줘도 라운드당 호출 수는 5회 그대로다', async () => {
  const s = spy(none);
  const r = await searchAlong(line, '마트', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'end', origin: O, destination: D,
  }, s.fn);
  assert.equal(r.calls, 5); // 반경이 상한과 같아 한 라운드만 돈다
});

test('target 을 near 쪽 개수로 센다 — 반대쪽만 8개면 반경을 더 넓힌다', async () => {
  let round = 0;
  const far = (i: number): PlaceCandidate =>
    ({ id: `f${i}`, name: `f${i}`, coord: at(127.0) });       // 전부 출발지 쪽
  const close = (i: number): PlaceCandidate =>
    ({ id: `c${i}`, name: `c${i}`, coord: at(127.495) });      // 목적지에서 약 440m
  const fn = async () => {
    round++;
    // 1라운드는 반대쪽만, 2라운드부터 목적지 쪽이 나온다
    return round <= 5 ? [far(round)] : [far(round), close(round)];
  };
  const r = await searchAlong(line, '마트', {
    need: 1, target: 3, initialRadiusM: 1000, maxRadiusM: 4000,
    side: 'end', origin: O, destination: D,
  }, fn);
  assert.ok(r.calls > 5, `한 라운드로 멈추면 안 된다: ${r.calls}`);
  assert.equal(r.status, 'ok');
});

test('side 가 없으면 지금까지처럼 전 구간에서 찍는다', async () => {
  const s = spy(none);
  await searchAlong(line, '카페', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.ok(Math.min(...first) <= 127.001);
  assert.ok(Math.max(...first) >= 127.499);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — `side` 옵션이 없어 전 구간에서 찍힌다

- [ ] **Step 3: 구현한다**

`src/lib/corridorSearch.ts` 의 `CorridorSearchOptions` 에 추가:

```ts
  /**
   * 어느 쪽 끝을 노릴까. 샘플 구간과 target 판정이 이걸 본다.
   * 'start'|'end' 면 origin·destination 이 있어야 한다 — 없으면 무시한다.
   */
  side?: NearSide;
  origin?: LatLng;
  destination?: LatLng;
```

`NearSide` 를 `./routePlan/types` import 에 추가하고, `matchesNear`·`NEAR_RADII_M` 을 `./nearSide` 에서 import 한다.

`searchAlong` 안에서 샘플 점 생성을 바꾼다:

```ts
  // near 쪽 후보가 나올 구간에서만 찍는다. 점 개수는 그대로라 카카오 호출 수가 늘지 않는다.
  // 경계 0.5 는 완화 경계(절대 거리)와 별개다 — 검색은 넉넉하게, 필터는 좁게
  const sided = opts.side === 'start' || opts.side === 'end';
  const [lo, hi] = opts.side === 'end' ? [0.5, 1] : opts.side === 'start' ? [0, 0.5] : [0, 1];
  const points: LatLng[] = [];
  for (let i = 0; i < samples; i++) {
    const t = lo + ((hi - lo) * i) / (samples - 1);
    points.push(pointAtProgress(poly, L * t).point);
  }
```

target 판정을 바꾼다. `merge` 아래에 추가:

```ts
  /**
   * 반경을 더 넓힐지 판정하는 개수. near 쪽을 노리는 중이면 **그쪽 개수**로 센다.
   * 전체로 세면 "8개 모였으니 그만" 하고 멈춘 뒤 applyNear 가 1개로 깎는다 —
   * 이 설계가 고치려는 바로 그 경로다(설계 §5.1).
   */
  const countForTarget = (list: PlaceCandidate[]) =>
    sided && opts.origin && opts.destination
      ? list.filter(c => matchesNear(opts.side!, c.coord, opts.origin!, opts.destination!, NEAR_RADII_M[0])).length
      : list.length;
```

while 루프 안의 `if (found.length >= target)` 를 `if (countForTarget(found) >= target)` 로 바꾼다. 루프 뒤의 `if (found.length >= opts.need)` 는 **그대로 둔다** — 거기서는 전체를 돌려주고 좁히는 건 `applyNear` 몫이다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts
git commit -m "feat: searchAlong 이 side를 안다 — 샘플 구간 편향 + target을 near 쪽으로"
```

---

### Task 6: 앵커 검색이 `side` 를 안다

**Files:**
- Modify: `src/lib/corridorSearch.ts` (`AnchorSearchOptions`, `searchAtAnchors`)
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: Task 5 의 import, `Anchor`·`AnchorKind` (`routePlan/anchors.ts:17-18`)
- Produces: `AnchorSearchOptions` 에 `side?: NearSide`, `origin?: LatLng`, `destination?: LatLng`

- [ ] **Step 1: 앵커 선택 테스트를 쓴다**

`src/lib/corridorSearch.test.ts` 에 추가:

```ts
import { searchAtAnchors } from './corridorSearch.ts';
import type { Anchor } from './routePlan/anchors.ts';

const anchor = (id: string, kind: Anchor['kind'], lng: number): Anchor =>
  ({ id, kind, name: id, coord: at(lng), progressM: 0 });

const ALL: Anchor[] = [
  anchor('a0', 'origin', 127.0),
  anchor('a1', 'board', 127.01),
  anchor('a2', 'transfer', 127.25),
  anchor('a3', 'alight', 127.49),
  anchor('a4', 'destination', 127.5),
];

test('side=end 면 하차역·목적지 앵커만 조회한다', async () => {
  const seen: string[] = [];
  const fn = async (_q: string, center: { longitude: number }) => {
    seen.push(center.longitude.toFixed(2));
    return [];
  };
  await searchAtAnchors(ALL, '마트', { need: 1, target: 3, side: 'end', origin: O, destination: D }, fn);
  assert.deepEqual(seen.sort(), ['127.49', '127.50']);
});

test('side=start 면 출발지·승차역 앵커만 조회한다', async () => {
  const seen: string[] = [];
  const fn = async (_q: string, center: { longitude: number }) => {
    seen.push(center.longitude.toFixed(2));
    return [];
  };
  await searchAtAnchors(ALL, '약국', { need: 1, target: 3, side: 'start', origin: O, destination: D }, fn);
  assert.deepEqual(seen.sort(), ['127.00', '127.01']);
});

test('그쪽 종류의 앵커가 하나도 없으면 전부 본다 — 좁히다가 0건이 되면 안 된다', async () => {
  const onlyTransfer = [anchor('t', 'transfer', 127.25)];
  let calls = 0;
  const fn = async () => { calls++; return []; };
  await searchAtAnchors(onlyTransfer, '마트', { need: 1, target: 3, side: 'end', origin: O, destination: D }, fn);
  assert.ok(calls > 0, '앵커를 전부 버리면 안 된다');
});

test('side 가 없으면 지금까지처럼 전부 조회한다', async () => {
  let calls = 0;
  const fn = async () => { calls++; return []; };
  await searchAtAnchors(ALL, '카페', { need: 1, target: 3 }, fn);
  assert.equal(calls, 5);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — 앵커를 전부 조회한다

- [ ] **Step 3: 구현한다**

`src/lib/corridorSearch.ts` 의 `AnchorSearchOptions` 에 `side?: NearSide; origin?: LatLng; destination?: LatLng;` 를 추가하고, `searchAtAnchors` 앞에 넣는다:

```ts
/**
 * 어느 쪽 끝일 때 어느 앵커를 보나. `extractAnchors` 가 붙이는 kind 를 그대로 쓴다.
 * `transfer`(환승역)는 어느 쪽도 아니라 any 일 때만 본다 — 환승 지점을 원하는
 * 케이스는 NearSide 3값으로 표현되지 않는다(설계 §12).
 */
const ANCHOR_KINDS: Record<'start' | 'end', readonly Anchor['kind'][]> = {
  end: ['alight', 'destination'],
  start: ['origin', 'board'],
};
```

`Anchor` 는 이미 type import 돼 있다. `searchAtAnchors` 본문 맨 앞에 넣는다:

```ts
  // 그쪽 앵커만 본다 — 앵커당 1콜이라 호출 수도 준다.
  // 다만 그 종류가 하나도 없으면(하차역 없는 itinerary 등) 전부 본다. 좁히다 0건이 되면
  // 회랑 폴백이 돌아 오히려 호출이 는다
  const kinds = opts.side === 'start' || opts.side === 'end' ? ANCHOR_KINDS[opts.side] : null;
  const picked = kinds ? anchors.filter(a => kinds.includes(a.kind)) : anchors;
  const used = picked.length > 0 ? picked : anchors;
```

이후 본문의 `anchors` 참조를 전부 `used` 로 바꾼다 — `attach` 안의 `anchors[i]` 와 while 루프의 `anchors.map(...)` 두 자리다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts
git commit -m "feat: searchAtAnchors 가 side에 맞는 앵커만 본다"
```

---

### Task 7: 30개 컷이 `side` 를 안다

**Files:**
- Modify: `src/lib/corridorSearch.ts` (`byCorridor` in `searchAlong`, `attach` in `searchAtAnchors`)
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: Task 5·6
- Produces: 동작 변경만. 시그니처 변화 없음.

- [ ] **Step 1: 컷 테스트를 쓴다**

```ts
test('컷이 near 쪽을 먼저 채운다 — 반대쪽이 경로에 더 가까워도', async () => {
  // 목적지 쪽 1곳은 경로에서 멀고, 출발지 쪽 3곳은 경로 위에 있다
  const list: PlaceCandidate[] = [
    { id: 'n1', name: 'n1', coord: { latitude: 37.52, longitude: 127.495 } }, // end 쪽, 경로에서 약 2.2km
    { id: 'f1', name: 'f1', coord: at(127.0) },
    { id: 'f2', name: 'f2', coord: at(127.01) },
    { id: 'f3', name: 'f3', coord: at(127.02) },
  ];
  let done = false;
  const fn = async () => { if (done) return []; done = true; return list; };
  const r = await searchAlong(line, '마트', {
    need: 1, target: 1, initialRadiusM: 3000, maxRadiusM: 3000,
    max: 2, side: 'end', origin: O, destination: D,
  }, fn);
  assert.equal(r.candidates[0].id, 'n1', `end 쪽이 먼저여야 한다: ${r.candidates.map(c => c.id)}`);
  assert.equal(r.candidates.length, 2); // 반대쪽도 버리지 않는다 — 완화가 되돌릴 게 있어야 한다
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — `n1` 이 cross-track 순에서 밀려 잘린다

- [ ] **Step 3: 구현한다**

`searchAlong` 의 `byCorridor` 를 바꾼다:

```ts
  /**
   * 경로 근접순으로 자르되, near 쪽을 노리는 중이면 **그쪽을 먼저 채운다.**
   * 반대쪽을 버리지는 않는다 — applyNear 의 완화가 되돌릴 후보가 없으면 완화가 무의미해진다.
   */
  const byCorridor = (list: PlaceCandidate[]) => {
    const sorted = [...list]
      .sort((a, b) => crossTrack(a.coord, poly).distanceM - crossTrack(b.coord, poly).distanceM);
    if (!sided || !opts.origin || !opts.destination) return sorted.slice(0, max);
    const on: PlaceCandidate[] = [];
    const off: PlaceCandidate[] = [];
    for (const c of sorted) {
      const hit = matchesNear(opts.side!, c.coord, opts.origin, opts.destination, NEAR_RADII_M[0]);
      (hit ? on : off).push(c);
    }
    return [...on, ...off].slice(0, max);
  };
```

`searchAtAnchors` 의 `attach` 마지막 줄도 같은 모양으로 바꾼다. 지금은

```ts
    return [...best.values()].sort((x, y) => (x.anchorWalkM ?? 0) - (y.anchorWalkM ?? 0)).slice(0, max);
```

를

```ts
    const sorted = [...best.values()].sort((x, y) => (x.anchorWalkM ?? 0) - (y.anchorWalkM ?? 0));
    if (!kinds || !opts.origin || !opts.destination) return sorted.slice(0, max);
    const on: PlaceCandidate[] = [];
    const off: PlaceCandidate[] = [];
    for (const c of sorted) {
      const hit = matchesNear(opts.side!, c.coord, opts.origin, opts.destination, NEAR_RADII_M[0]);
      (hit ? on : off).push(c);
    }
    return [...on, ...off].slice(0, max);
```

로 바꾼다. 앵커를 이미 좁혔어도 폴백 경로(`picked.length === 0`)에서는 이 컷이 필요하다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts
git commit -m "feat: 30개 컷이 near 쪽을 먼저 채운다"
```

---

### Task 8: 태그가 칩 → 요청 → 슬롯으로 흐른다

**Files:**
- Modify: `src/state/plan.tsx:40-53` (`IntentChip`), `:219-229`, `:647-652`
- Modify: `src/state/planFlow.ts:19` (`PlanRequest['stops']`)
- Modify: `src/state/planRequest.ts:20-38`
- Modify: `src/lib/routePlan/types.ts` (`Slot`)
- Test: `src/state/planRequest.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `IntentStop`, Task 2 의 `Load`·`NeedWhen`
- Produces: `IntentChip`(kind: 'stop') · `PlanRequest['stops'][n]` · `Slot` 이 모두 `loadBefore?: Load; loadAfter?: Load; needWhen?: NeedWhen` 을 갖는다. **전부 optional** — 옛 상태의 칩에는 없다.

- [ ] **Step 1: 전달 테스트를 쓴다**

`src/state/planRequest.test.ts` 에 추가:

```ts
test('칩의 태그가 슬롯으로 그대로 간다', () => {
  const stops = requestStopsFromChips([{
    id: 'c1', kind: 'stop', label: '마트', queries: ['마트'],
    stopKind: 'category', openNow: false, flexible: true, near: 'any',
    loadBefore: 'none', loadAfter: 'hard', needWhen: 'afterArrival',
  }]);
  assert.equal(stops[0].loadAfter, 'hard');
  assert.equal(stops[0].needWhen, 'afterArrival');
});

test('옛 칩에 태그가 없으면 보수적 기본값', () => {
  const stops = requestStopsFromChips([{
    id: 'c1', kind: 'stop', label: '카페', queries: ['카페'],
    stopKind: 'category', openNow: false, flexible: true, near: 'any',
  } as never]);
  assert.equal(stops[0].loadBefore, 'none');
  assert.equal(stops[0].loadAfter, 'none');
  assert.equal(stops[0].needWhen, 'unknown');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/state/planRequest.test.ts`
Expected: FAIL — `loadAfter` 가 `undefined`

- [ ] **Step 3: 네 자리에 필드를 낸다**

`src/lib/routePlan/types.ts` 의 `Slot` 에, `near?: NearSide` 아래:

```ts
  /** 추출이 낸 물성·시점. 방향은 여기서 파생된다 — 진단과 재계산을 위해 슬롯까지 들고 온다.
      추출 시점에 방향을 확정하면 사용자가 모드를 바꿨을 때 다시 계산할 근거가 사라진다 */
  loadBefore?: Load;
  loadAfter?: Load;
  needWhen?: NeedWhen;
```

`import type { Load, NeedWhen } from '../nearSide';` 를 추가한다.

`src/state/plan.tsx` 의 `IntentChip` stop 갈래에, `near: NearSide;` 아래:

```ts
      /** 추출이 낸 물성·시점. 방향(near)은 코드가 이걸로 정한다 */
      loadBefore?: Load;
      loadAfter?: Load;
      needWhen?: NeedWhen;
```

`import type { Load, NeedWhen } from '../lib/nearSide';` 를 추가한다.

칩을 만드는 두 자리(`:219-229` 의 `seedChips`, `:647-652` 의 `chips.push`)에 `loadBefore: st.loadBefore, loadAfter: st.loadAfter, needWhen: st.needWhen,` 를 넣는다.

`src/state/planFlow.ts` 의 `PlanRequest['stops']` 인라인 타입 끝에 `loadBefore?: Load; loadAfter?: Load; needWhen?: NeedWhen` 을 넣고 import 를 추가한다.

`src/state/planRequest.ts` 의 map 반환에, `near:` 아래:

```ts
      // 옛 상태의 칩에는 없다 — stopKind·near 와 같은 방식으로 보수적 기본값을 둔다
      loadBefore: (c.kind === 'stop' ? c.loadBefore : undefined) ?? 'none',
      loadAfter: (c.kind === 'stop' ? c.loadAfter : undefined) ?? 'none',
      needWhen: (c.kind === 'stop' ? c.needWhen : undefined) ?? 'unknown',
```

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/state/planRequest.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/types.ts src/state/plan.tsx src/state/planFlow.ts src/state/planRequest.ts src/state/planRequest.test.ts
git commit -m "feat: 태그가 칩 → 요청 → 슬롯으로 흐른다"
```

---

### Task 9: `requestKey` 가 태그 변경에 반응한다

**Files:**
- Modify: `src/state/planFlow.ts:73-76`
- Test: `src/state/planFlow.test.ts`

**Interfaces:**
- Consumes: Task 8 의 `PlanRequest['stops']`
- Produces: 동작 변경만.

이건 이 설계가 만든 결함이 아니라 **이미 있던 배선 버그**다. `near` 조차 키에 없어서, 태그를 얹으면 곧장 "바꿨는데 안 바뀐다"로 터진다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`src/state/planFlow.test.ts` 에 추가:

```ts
const base = () => ({
  origin: { latitude: 37.5, longitude: 127.0 },
  destination: { latitude: 37.5, longitude: 127.1 },
  originName: '내 위치', destinationName: '집',
  mode: 'transit' as const, arriveByMin: null, departAtMin: 540,
  stops: [{
    id: 'c1', queries: ['마트'], count: 1, flexible: true, openNow: false,
    stopKind: 'category' as const, near: 'any' as const,
    loadBefore: 'none' as const, loadAfter: 'none' as const, needWhen: 'unknown' as const,
  }],
  order: 'auto' as const,
});

test('near 가 바뀌면 다른 요청이다', () => {
  const a = base();
  const b = base();
  b.stops[0].near = 'end';
  assert.notEqual(requestKey(a), requestKey(b));
});

test('태그가 바뀌면 다른 요청이다', () => {
  const a = base();
  const b = base();
  b.stops[0].loadAfter = 'hard';
  assert.notEqual(requestKey(a), requestKey(b));
});

test('같은 값이면 같은 키다', () => {
  assert.equal(requestKey(base()), requestKey(base()));
});
```

`requestKey` 가 import 돼 있는지 확인하고 없으면 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/state/planFlow.test.ts`
Expected: FAIL — 두 키가 같다

- [ ] **Step 3: 구현한다**

`src/state/planFlow.ts` 의 `requestKey` 안 `stops` 줄을 바꾼다:

```ts
  // near 와 태그가 빠져 있었다 — 태그를 바꿔도 같은 요청으로 보고 재계산을 건너뛴다.
  // mode 는 아래 배열에 이미 있으므로, 이것으로 decideNear 의 입력이 전부 키에 들어간다
  const stops = r.stops.map(s =>
    `${s.queries.join('>')}×${s.count}${s.flexible ? '' : '!'}${s.openNow ? '?' : ''}`
    + `@${s.near ?? 'any'}/${s.loadBefore ?? 'none'}/${s.loadAfter ?? 'none'}/${s.needWhen ?? 'unknown'}`,
  ).join('|');
```

`departAtMin` 을 빼는 기존 판단은 그대로 둔다 — 그건 조건이 아니라 시계다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npx tsx --test src/state/planFlow.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/state/planFlow.ts src/state/planFlow.test.ts
git commit -m "fix: requestKey 에 near와 태그를 넣는다 — 바꿔도 안 바뀌던 버그"
```

---

### Task 10: `runPlan` 통합 + 진단 로그

**Files:**
- Modify: `src/state/runPlan.ts:105-200`
- Modify: `src/lib/routePlan/types.ts` (`Slot` 진단 필드)
- Modify: `src/state/actionLog.ts` (`SLOTS` case)
- Test: `src/state/runPlan.test.ts`, `src/state/actionLog.test.ts`

**Interfaces:**
- Consumes: Task 2 `decideNear`, Task 4 `applyNear`(새 시그니처), Task 5·6 검색 옵션, Task 8 슬롯 태그
- Produces: `Slot` 에 `nearSource?: 'stated'|'inferred'|'none'`, `nearBefore?: number`, `nearAfter?: number`, `nearRadiusM?: number|null`, `nearRelaxedRaw?: boolean`

- [ ] **Step 1: 진단 필드 테스트를 쓴다**

`src/state/runPlan.test.ts` 에 추가한다. 파일 상단의 기존 헬퍼(`O`·`D`·`at`·`search`·`req`·`collect`)를 그대로 쓴다. **`req` 의 기본 모드는 `'car'` 라 `decideNear` 가 곧바로 `'any'` 를 낸다 — 반드시 `{ mode: 'transit' }` 를 넘긴다.**

`D` 는 `at(37.5, 127.1136)` 이고 위도 37.5 에서 경도 1° ≈ 88,320m 다. 새 카탈로그를 파일 상단 기존 `catalog` 옆에 둔다:

```ts
/** 목적지(127.1136) 1500m 안에 3곳, 밖에 2곳. near=end 완화 단계를 가르는 배치 */
const martCatalog: PlaceCandidate[] = [
  { id: 'm1', name: '마트 A', coord: at(37.5, 127.1100) }, // D 에서 약 318m
  { id: 'm2', name: '마트 B', coord: at(37.5, 127.1050) }, // 약 760m
  { id: 'm3', name: '마트 C', coord: at(37.5, 127.1000) }, // 약 1,201m
  { id: 'm4', name: '마트 D', coord: at(37.5, 127.0650) }, // 약 4,294m
  { id: 'm5', name: '마트 E', coord: at(37.5, 127.0600) }, // 약 4,736m
  { id: 'k1', name: '약국 A', coord: at(37.5, 127.1105) },
  { id: 'k2', name: '약국 B', coord: at(37.5, 127.0640) },
];
const martSearch: SearchFn = async (q, center, r) =>
  martCatalog.filter(c => c.name.startsWith(q) && haversineM(center, c.coord) <= r);

const slotsOf = (actions: PlanFlowAction[]) =>
  (actions.find(a => a.type === 'SLOTS') as {
    type: 'SLOTS';
    slots: {
      near?: string; nearSource?: string; nearBefore?: number; nearAfter?: number;
      nearRadiusM?: number | null; nearRelaxed?: boolean; nearRelaxedRaw?: boolean;
      candidates: unknown[];
    }[];
  }).slots;
```

테스트 본문:

```ts
test('추론한 방향은 end 이고 nearSource=inferred 로 기록된다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', loadBefore: 'none', loadAfter: 'hard', needWhen: 'afterArrival' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  assert.equal(s.near, 'end');
  assert.equal(s.nearSource, 'inferred');
  assert.equal(s.nearRadiusM, 1500);      // 1500m 안에 3곳이라 첫 단계에서 멈춘다
  assert.equal(s.nearAfter, 3);
  assert.equal(s.nearRelaxed, false);     // 화면은 추론을 사과하지 않는다
  assert.equal(s.nearRelaxedRaw, false);
  assert.ok((s.nearBefore ?? 0) >= 3);
});

test('사용자가 말한 방향은 stated 다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', near: 'end' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  assert.equal(slotsOf(actions)[0].nearSource, 'stated');
});

test('방향이 없으면 nearSource=none 이고 반경도 안 남는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  assert.equal(s.near, 'any');
  assert.equal(s.nearSource, 'none');
  assert.equal(s.nearRadiusM, null);
});

test('추론이 완화돼도 화면 플래그는 안 서고 진단 플래그만 선다', async () => {
  // 기존 catalog 의 올리브영은 127.05·127.07 — D 에서 3,851m·5,616m 라 두 단계 다 못 채운다
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false,
           stopKind: 'brand', loadAfter: 'hard', needWhen: 'afterArrival' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search, dispatch },
  );
  const s = slotsOf(actions)[0];
  assert.equal(s.near, 'end');
  assert.equal(s.nearRelaxed, false);     // 사용자가 말한 게 아니라 사과하지 않는다
  assert.equal(s.nearRelaxedRaw, true);   // 로그는 안다
  assert.equal(s.nearRadiusM, null);
  assert.equal(s.candidates.length, 2);   // 되돌렸으므로 경유지가 증발하지 않는다
});

test('자동차는 태그가 있어도 any 다 — 알려진 한계', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' }]),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  assert.equal(slotsOf(actions)[0].near, 'any');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: FAIL — 컴파일 오류(`resolveNear` 없음) 또는 `nearSource` 가 `undefined`

- [ ] **Step 3: `Slot` 에 진단 필드를 낸다**

`src/lib/routePlan/types.ts` 의 `Slot` 에:

```ts
  /** 방향이 어디서 왔나. 화면은 안 보지만 로그는 본다 */
  nearSource?: 'stated' | 'inferred' | 'none';
  /** applyNear 전 후보 수 */
  nearBefore?: number;
  /** applyNear 후 후보 수 */
  nearAfter?: number;
  /** 어느 완화 단계에서 멈췄나(m). null 이면 전부 되돌렸거나 제약이 없었다 */
  nearRadiusM?: number | null;
  /** 추론까지 포함한 실제 완화 여부. 화면용 nearRelaxed 와 별개다 —
      화면은 사용자가 말한 제약이 안 먹었을 때만 사과하지만, 로그는 전부 봐야 한다 */
  nearRelaxedRaw?: boolean;
```

- [ ] **Step 4: `runPlan` 을 고친다**

`src/state/runPlan.ts` 에서 `resolveNear` import 를 `decideNear` 로 바꾼다.

`slots = await race(...)` 앞에 방향 선계산을 넣는다 — 형제 수(Task 11)를 세려면 전체 방향이 먼저 필요하다:

```ts
      // 방향을 먼저 전부 정한다. 검색이 side 를 받아야 하고(§5), 같은 near 를 가진
      // 형제 수를 세려면(§10) 슬롯 하나만 보고는 알 수 없다
      const decided = request.stops.map(st => ({
        st,
        near: decideNear(st.near, request.mode, {
          loadBefore: st.loadBefore ?? 'none',
          loadAfter: st.loadAfter ?? 'none',
          needWhen: st.needWhen ?? 'unknown',
        }),
      }));
```

`request.stops.map(async st => {` 를 `decided.map(async ({ st, near }) => {` 로 바꾸고, 안쪽의 `const near = resolveNear(...)` 줄을 지운다. 그 자리에:

```ts
        const nearSource: 'stated' | 'inferred' | 'none' =
          near === 'any' ? 'none' : st.near === 'start' || st.near === 'end' ? 'stated' : 'inferred';
```

`corridor()` 와 `searchAtAnchors` 호출에 `side`·`origin`·`destination` 을 넘긴다:

```ts
          const corridor = () => searchAlong(
            poly, query,
            {
              need, target,
              initialRadiusM: initialRadiusM(request.mode),
              maxRadiusM: maxRadiusM(request.mode, slack, rho),
              side: near, origin: request.origin, destination: request.destination,
            },
            search,
          );
          let r = anchors.length > 0
            ? await searchAtAnchors(anchors, query, {
                need, target,
                maxRadiusM: Math.min(ANCHOR_MAX_M, maxRadiusM(request.mode, slack, rho)),
                side: near, origin: request.origin, destination: request.destination,
              }, search)
            : await corridor();
```

`applyNear` 호출과 반환 객체를 바꾼다:

```ts
        const parked = applyParkingPolicy(found.candidates, request.mode);
        const sided = applyNear(parked, near, request.origin, request.destination, nearNeed);
```

(`nearNeed` 는 Task 11 에서 정의한다. 이 작업에서는 임시로 `siblings.get(st.queries.join('|')) ?? 1` 를 쓴다.)

반환 객체의 `near, nearRelaxed: ...` 줄을 이렇게 늘린다:

```ts
          near, nearSource,
          // 사용자가 말한 제약이 안 먹었을 때만 사과한다 — 코드가 물성으로 추론한 제약까지
          // 사과하면, 목적지 얘기를 꺼낸 적 없는 사용자에게 "목적지 쪽엔 없어서"라고 말하게 된다
          nearRelaxed: sided.relaxed && (st.near === 'start' || st.near === 'end'),
          nearRelaxedRaw: sided.relaxed,
          nearBefore: parked.length,
          nearAfter: sided.candidates.length,
          nearRadiusM: sided.radiusM,
          loadBefore: st.loadBefore, loadAfter: st.loadAfter, needWhen: st.needWhen,
```

`queries.length === 0` 조기 반환 갈래에도 `nearSource`, `nearBefore: 0`, `nearAfter: 0`, `nearRadiusM: null`, `nearRelaxedRaw: false` 를 넣는다.

- [ ] **Step 5: 로그를 늘린다**

`src/state/actionLog.ts` 의 `SLOTS` case 에서 `search:` 줄을 바꾼다:

```ts
          // near=end(inf)! 는 '추론한 목적지 쪽인데 그쪽에 없어서 풀었다'는 뜻이다.
          // 8→3 은 applyNear 전후 후보 수, nr= 는 멈춘 완화 단계(m)
          search: action.slots.map(s =>
            `${s.query} near=${s.near ?? 'any'}(${s.nearSource ?? 'none'})${s.nearRelaxedRaw ? '!' : ''}`
            + ` ${s.nearBefore ?? 0}→${s.nearAfter ?? 0} nr=${s.nearRadiusM ?? '-'}`
            + ` r=${s.searchRadiusM ?? 0} calls=${s.searchCalls ?? 0}`).join(' · '),
```

`src/state/actionLog.test.ts` 에 `nearSource`·`nearBefore`·`nearAfter` 가 문자열에 찍히는지 보는 테스트를 추가한다.

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `npm test`
Expected: PASS — 이 작업에서 Task 2 이후로 열려 있던 타입 오류가 전부 닫힌다

- [ ] **Step 7: 커밋**

```bash
git add src/state/runPlan.ts src/state/runPlan.test.ts src/lib/routePlan/types.ts src/state/actionLog.ts src/state/actionLog.test.ts
git commit -m "feat: runPlan 이 decideNear 를 쓰고 검색에 side를 넘긴다 + 진단 로그"
```

---

### Task 11: 형제 슬롯 요구량

**Files:**
- Modify: `src/state/runPlan.ts:107-112`, `:189`
- Test: `src/state/runPlan.test.ts`

**Interfaces:**
- Consumes: Task 10 의 `decided` 배열
- Produces: 동작 변경만.

**순서 규칙은 만들지 않는다.** "마트도 `end`, 약국도 `end`"일 때 방문 순서는 플래너가 총시간으로 최적화하고, 지금 그게 나쁘다는 증거가 없다. 몰림이 실제로 일어나는지는 Task 10 의 로그로 관측된다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`NEAR_TARGET = 3` 이 이미 바닥값이라, 형제 수가 **3을 넘을 때만** 차이가 드러난다. 검색어가 다른 슬롯 둘에 각각 `count: 2` 를 주면 `byNear('end') = 4` 가 되고, `마트` 의 목적지 쪽 후보 3곳으로는 모자라게 된다.

Task 10 의 `martCatalog`·`martSearch`·`slotsOf` 를 그대로 쓴다.

```ts
test('검색어가 달라도 같은 near 를 쓰면 형제로 세어 요구량을 올린다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' },
      { id: 's-2', queries: ['약국'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' },
    ], { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  // 같은 검색어 형제만 세면 need=2 → 요구량 max(2,3)=3 → 목적지 쪽 3곳으로 통과했을 것이다.
  // 같은 near 형제까지 세면 need=4 → 요구량 4 → 3곳으로는 모자라 완화한다
  assert.equal(s.near, 'end');
  assert.equal(s.nearRelaxedRaw, true);
  assert.equal(s.nearRadiusM, null);
});

test('near 가 any 인 슬롯은 형제로 세지 않는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' },
      { id: 's-2', queries: ['약국'], count: 2, flexible: true, openNow: false,
        stopKind: 'category' }, // 태그 없음 → any
    ], { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  // byNear('end') = 2 뿐이라 요구량은 max(2,3)=3 → 목적지 쪽 3곳으로 통과한다
  assert.equal(s.nearRelaxedRaw, false);
  assert.equal(s.nearRadiusM, 1500);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`src/state/runPlan.ts` 의 `siblings` 블록 아래에, `decided` 를 만든 **뒤에** 추가한다:

```ts
      // 같은 near 를 가진 슬롯 수. 기존 siblings 는 같은 '검색어'만 세는데,
      // 검색어가 달라도("마트"·"약국") 같은 쪽 끝을 나눠 가져야 하는 건 같다
      const byNear = new Map<NearSide, number>();
      for (const d of decided) {
        if (d.near === 'any') continue;
        byNear.set(d.near, (byNear.get(d.near) ?? 0) + Math.max(1, d.st.count));
      }
```

`NearSide` 를 `../lib/routePlan/types` import 에 추가한다.

`applyNear` 호출 앞에:

```ts
        // 같은 검색어를 쓰는 형제와 같은 near 를 쓰는 형제 중 큰 쪽을 요구한다
        const sameQuery = siblings.get(st.queries.join('|')) ?? 1;
        const sameNear = near === 'any' ? 1 : byNear.get(near) ?? 1;
        const nearNeed = Math.max(sameQuery, sameNear);
```

Task 10 에서 임시로 넣었던 `siblings.get(...)` 인자를 `nearNeed` 로 바꾼다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/state/runPlan.ts src/state/runPlan.test.ts
git commit -m "feat: 같은 near 를 가진 형제 슬롯 수를 요구량에 반영"
```

---

### Task 12: 프롬프트 v10

**Files:**
- Modify: `server/prompts/extract-intent.md` (헤더, 위치 절, 출력 스키마, 필드 표)
- Modify: `server/src/prompt.ts`
- Test: `server/src/prompt.test.ts`

**Interfaces:**
- Consumes: Task 1 의 태그 값 집합
- Produces: 프롬프트가 태그 3개를 요구한다. 방향은 여전히 추론하지 않는다.

- [ ] **Step 1: 사본 동기화 테스트를 쓴다**

`server/src/prompt.test.ts` 에 추가:

```ts
test('프롬프트가 태그 3개를 요구한다', () => {
  for (const k of ['loadBefore', 'loadAfter', 'needWhen']) {
    assert.ok(SYSTEM_PROMPT.includes(k), `${k} 가 프롬프트에 없다`);
  }
});

test('방향은 여전히 추론하지 않는다고 못 박는다', () => {
  assert.ok(SYSTEM_PROMPT.includes('추론하지 않는다'));
});

test('문서 원본도 태그 3개를 적고 있다 — 사본만 고치면 다음 사람이 원본을 믿는다', () => {
  const md = readFileSync('server/prompts/extract-intent.md', 'utf8');
  assert.ok(md.includes('(v10)'), '문서 헤더가 v10 이 아니다');
  for (const k of ['loadBefore', 'loadAfter', 'needWhen']) {
    assert.ok(md.includes(k), `${k} 가 문서 원본에 없다`);
  }
});
```

`readFileSync` import 가 없으면 `import { readFileSync } from 'node:fs';` 를 추가한다. 테스트는 저장소 루트에서 도는 `tsx --test` 기준이라 상대 경로가 그대로 선다(같은 파일의 기존 테스트가 이미 그렇게 읽고 있으면 그 방식을 따른다).

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test server/src/prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: 문서를 고친다**

`server/prompts/extract-intent.md` 헤더를 바꾼다:

```markdown
# 경유지 의도 추출 프롬프트 (v10)

> 절마다 붙은 `— vN` 은 **이 헤더와 같은 카운터**다. `server/src/prompt.ts` 의 사본도
> 같은 번호를 쓴다. 카운터가 갈리면 원본과 사본이 어긋났는지 판별할 수 없다.
```

위치 절(`### 위치 (near) — v8`)을 `— v10` 으로 올리고, 기존 네 줄은 **그대로 둔 채** 그 아래에 새 절을 붙인다:

```markdown
### 물성과 시점 (`loadBefore` · `loadAfter` · `needWhen`) — v10

**방향(`near`)은 사용자가 말했을 때만. 부담과 시점은 항상 판단한다.**
방향은 코드가 정한다 — 태그로 방향을 암시하려 하지 마라.

- `loadBefore` — 경유지에 **가져가서 맡기거나 넘길 물건**이 있으면 `"hard"`, 아니면 `"none"`.
  부치기·맡기기·반납하기·수선.
- `loadAfter` — 경유지에서 얻은 것을 **대중교통이나 도보로 들고 이동하기 어려우면** `"hard"`,
  아니면 `"none"`. 부피·무게·변질·파손·용기가 모두 여기 들어온다.
- `needWhen` — 목적지에 닿기 **전에** 쓰거나 소비하면 `"beforeArrival"`,
  닿은 **뒤에** 쓰면 `"afterArrival"`. 문장에 근거가 없으면 `"unknown"`.

판단할 수 없으면 `"none"` / `"unknown"` 이다. 찍지 마라 —
틀린 태그는 사용자가 말하지도 않은 제약이 된다.
```

출력 스키마 예시(`"near": "start | end | any"` 가 있는 자리)에 세 줄을 추가한다:

```json
      "near": "start | end | any",
      "loadBefore": "none | hard",
      "loadAfter": "none | hard",
      "needWhen": "beforeArrival | afterArrival | unknown"
```

필드 표에 세 줄을 추가한다:

```markdown
| `loadBefore` | 경유지까지 들고 가야 할 것이 있나 |
| `loadAfter` | 얻은 것을 대중교통·도보로 들고 가기 어려운가 |
| `needWhen` | 목적지 도착 전에 필요한가, 후에 필요한가 |
```

문서의 예시 JSON(`샌드위치 파는 카페` 등) 두 자리에도 세 필드를 추가한다.

- [ ] **Step 4: 사본을 동기화한다**

`server/src/prompt.ts` 머리 주석의 버전 줄을 바꾼다:

```ts
    v10 (2026-09-17) — 물성·시점 태그 3개. 방향은 여전히 코드가 정한다.
    문서(extract-intent.md)와 같은 카운터를 쓴다 */
```

`SYSTEM_PROMPT` 의 `위치(near):` 블록(`prompt.ts:44-49`) 다섯 줄은 **그대로 두고**, 그 아래 `할 일(why):` 앞에 끼워 넣는다:

```
물성과 시점(loadBefore·loadAfter·needWhen):
- 방향(near)은 사용자가 말했을 때만이다. 부담과 시점은 항상 판단한다. 방향은 코드가 정하니 태그로 방향을 암시하려 하지 마라.
- loadBefore: 경유지에 가져가서 맡기거나 넘길 물건이 있으면 "hard", 아니면 "none". 부치기·맡기기·반납하기·수선.
- loadAfter: 경유지에서 얻은 것을 대중교통이나 도보로 들고 이동하기 어려우면 "hard", 아니면 "none". 부피·무게·변질·파손·용기가 모두 여기 들어온다.
- needWhen: 목적지에 닿기 전에 쓰거나 소비하면 "beforeArrival", 닿은 뒤에 쓰면 "afterArrival". 문장에 근거가 없으면 "unknown".
- 판단할 수 없으면 "none"/"unknown"이다. 찍지 마라 — 틀린 태그는 사용자가 말하지도 않은 제약이 된다.
```

마지막 줄의 출력 JSON(`prompt.ts:75`)에서 `"near":"any"` 를 바꾼다:

```
"near":"any","loadBefore":"none","loadAfter":"none","needWhen":"unknown"
```

- [ ] **Step 5: 테스트가 통과하는지 본다**

Run: `npx tsx --test server/src/prompt.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add server/prompts/extract-intent.md server/src/prompt.ts server/src/prompt.test.ts
git commit -m "feat: 프롬프트 v10 — 물성·시점 태그. 버전 카운터도 하나로"
```

---

### Task 13: 채점이 태그를 본다

**Files:**
- Modify: `server/case-score.mjs:12-16` (`CHECKED_KEYS`), `:51-52` 부근
- Modify: `server/prompts/cases.jsonl`
- Modify: `server/run-llm.mjs:103-111` (`toIntent`)
- Test: `npm test` 안의 기존 러너 테스트 + 수동 실행

**Interfaces:**
- Consumes: Task 1 의 태그, Task 12 의 프롬프트
- Produces: 케이스 `expect` 에 `lb`(loadBefore) · `la`(loadAfter) · `nw`(needWhen) 키를 쓸 수 있다.

채점 키가 없으면 태그가 틀려도 통과한다. **AGENTS.md: 러너의 '미검증'을 통과로 세지 말 것.**

- [ ] **Step 1: 채점 키를 추가한다**

`server/case-score.mjs` 의 `CHECKED_KEYS` 배열 끝에 `'lb', 'la', 'nw',` 를 넣는다. `near` 채점 바로 아래에 추가한다:

```js
  // 태그는 add 된 경유지에서만 본다 — remove 의 태그는 스키마가 이미 버린다
  if (e.lb && !got.stops.some(s => s.op !== 'remove' && (s.loadBefore ?? 'none') === e.lb))
    fails.push(`loadBefore≠${e.lb}`);
  if (e.la && !got.stops.some(s => s.op !== 'remove' && (s.loadAfter ?? 'none') === e.la))
    fails.push(`loadAfter≠${e.la}`);
  if (e.nw && !got.stops.some(s => s.op !== 'remove' && (s.needWhen ?? 'unknown') === e.nw))
    fails.push(`needWhen≠${e.nw}`);
```

- [ ] **Step 2: `run-llm.mjs` 의 누락을 고친다**

`toIntent` 의 `stops` map 이 `near` 를 안 옮긴다 — **지금 codex 러너에서는 `near` 기대값이 `'any'` 말고는 절대 통과하지 못한다.** 네 필드를 함께 넣는다:

```js
      openNow: !!s.openNow,
      // near 가 빠져 있었다 — case-score 가 (s.near ?? 'any') 로 읽어서
      // near:'end' 기대값이 구조적으로 통과할 수 없었다
      near: s.near ?? 'any',
      loadBefore: s.loadBefore ?? 'none',
      loadAfter: s.loadAfter ?? 'none',
      needWhen: s.needWhen ?? 'unknown',
```

- [ ] **Step 3: 케이스를 추가한다**

`server/prompts/cases.jsonl` 에 한 줄씩 추가한다. 기대값은 **제품이 어떻게 동작해야 하나**로 쓴다 — 목이 못 하는 것을 빼면 목의 한계를 사양으로 굳히는 것이다(AGENTS.md).

```jsonl
{"g":"near","text":"지하철 타고 가는데 마트 들러서 장 보고 집에 갈게","expect":{"qhas":"마트","la":"hard","nw":"afterArrival"}}
{"g":"near","text":"나가는 길에 우산 하나 사야 해","expect":{"qhas":"우산","la":"none","nw":"beforeArrival"}}
{"g":"near","text":"택배 부치고 회사 가야 해","expect":{"lb":"hard"}}
{"g":"near","text":"세탁물 맡기고 출근할게","expect":{"lb":"hard"}}
{"g":"near","text":"세탁물 찾아서 집에 갈게","expect":{"la":"hard","nw":"afterArrival"}}
{"g":"near","text":"꽃 사서 결혼식장 갈 거야","expect":{"qhas":"꽃","la":"hard","nw":"afterArrival"}}
{"g":"near","text":"걸어가면서 먹을 아이스크림 하나 사자","expect":{"nw":"beforeArrival"}}
{"g":"near","text":"밀폐 텀블러에 커피 받아서 지하철 탈게","expect":{"nw":"beforeArrival"}}
{"g":"near","text":"은행 들렀다 가자","expect":{"lb":"none","la":"none","nw":"unknown"}}
{"g":"near","text":"회사 근처 카페 들렀다 가자","expect":{"near":"end"}}
```

`g` 값이 기존 그룹 이름과 겹치지 않는지 `grep -o '"g":"[^"]*"' server/prompts/cases.jsonl | sort -u` 로 확인한다. 겹치면 새 이름을 쓴다.

- [ ] **Step 4: 목 기준선을 돌린다**

Run: `node server/run-cases.mjs`
Expected: 새 케이스 대부분이 **실패**한다. 목은 태그를 `none`/`unknown` 으로만 내기 때문이다. **이건 나쁜 신호가 아니다** — 목과 LLM 의 격차를 정직하게 드러낸 것이다(AGENTS.md). 기존 케이스의 실패 수가 **늘지 않았는지**만 확인한다.

- [ ] **Step 5: 커밋**

```bash
git add server/case-score.mjs server/prompts/cases.jsonl server/run-llm.mjs
git commit -m "feat: 태그 채점 키 + 케이스 10개. run-llm 의 near 누락도 고친다"
```

---

### Task 14: 흔들림 측정

**Files:**
- Modify: `server/run-llm.mjs`
- Test: 수동 실행

**Interfaces:**
- Consumes: Task 12·13
- Produces: `node server/run-llm.mjs --repeat 3` 가 태그별 일치율을 찍는다.

재는 것은 정답률만이 아니다. 운영 호출은 기본 비결정성을 쓰므로(`server/src/index.ts`), **같은 입력이 같은 태그를 내는가**가 설계의 생사를 가른다.

- [ ] **Step 1: `--repeat` 를 단다**

`server/run-llm.mjs` 의 argv 파싱부(`const gi = argv.indexOf('--group');` 근처)에 추가:

```js
const ri = argv.indexOf('--repeat');
const REPEAT = ri >= 0 ? Math.max(1, Number(argv[ri + 1]) || 1) : 1;
```

`pos` 를 만드는 filter 가 `--repeat` 의 값까지 위치 인자로 오해하지 않도록 조건을 넓힌다:

```js
const skip = new Set([gi, gi + 1, ri, ri + 1].filter(i => i >= 0));
const pos = argv.filter((a, i) => !a.startsWith('--') && !skip.has(i));
```

- [ ] **Step 2: 수집 루프를 회차별로 돌린다**

`const got = {};` 를 `const runs = [];` 로 바꾸고, 기존 배치 루프를 회차 루프로 감싼다:

```js
for (let rep = 0; rep < REPEAT; rep++) {
  const got = {};
  for (let i = 0; i < all.length; i += BATCH) {
    // ...기존 배치 루프 그대로, process.stderr 메시지에 `회차 ${rep + 1}/${REPEAT} · ` 를 앞에 붙인다
  }
  runs.push(got);
}
const got = runs[0]; // 채점은 1회차 기준. 흔들림은 아래에서 따로 센다
```

- [ ] **Step 3: 일치율을 찍는다**

보고 출력부(`for (const [g, v] of Object.entries(sum.byGroup))` 아래)에 추가:

```js
if (REPEAT > 1) {
  const TAGS = ['near', 'loadBefore', 'loadAfter', 'needWhen'];
  const unstable = {};
  for (const t of TAGS) unstable[t] = 0;
  let counted = 0;
  for (const c of all) {
    const vals = runs.map(r => {
      const o = r[c.__i];
      if (!o) return null;
      const s = (o.stops ?? [])[0] ?? {};
      return TAGS.map(t => s[t] ?? '-').join('|');
    });
    if (vals.some(v => v === null)) continue;
    counted++;
    const perTag = TAGS.map((_, k) => new Set(vals.map(v => v.split('|')[k])).size);
    perTag.forEach((n, k) => { if (n > 1) unstable[TAGS[k]]++; });
  }
  console.log(`\n흔들림 (${REPEAT}회 반복 · ${counted}건)`);
  for (const t of TAGS) {
    const pct = counted ? Math.round((unstable[t] / counted) * 100) : 0;
    console.log(`  ${t.padEnd(11)} 불일치 ${unstable[t]}/${counted} (${pct}%)`);
  }
  console.log('  판정: 20% 를 넘으면 설계 §13 의 후퇴(needWhen 제거)를 검토한다');
}
```

- [ ] **Step 4: 돌린다**

Run: `node server/run-llm.mjs --repeat 3 --group near`
Expected: 흔들림 표가 찍힌다. **`needWhen` 불일치율 > 20% 면 멈추고 보고한다** — 설계 §13 의 후퇴(값 4개로 축소)를 검토해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add server/run-llm.mjs
git commit -m "feat: run-llm --repeat 로 태그 흔들림을 잰다"
```

---

### Task 15: 배선 실측과 시뮬레이터 확인

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~14 전부

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: 목 기준선 재확인**

Run: `node server/run-cases.mjs`
Expected: 기존 그룹의 실패 수가 Task 13 때와 같다. `near` 그룹은 목 한계로 실패한다.

- [ ] **Step 3: 서버 실측 (API 과금)**

Run: `node server/run-server-cases.mjs`
Expected: 27개. **배선이 살아 있는지 보는 용도다** — 모델 품질은 Task 14 에서 이미 쟀다. `--all` 은 돌리지 않는다.

- [ ] **Step 4: 시뮬레이터**

앱을 띄우고 대중교통 모드로 "지하철 타고 가는데 마트 들러서 장 보고 집에 갈게"를 넣는다. `trackLog` 를 받아 `plan.slots` 의 `search` 줄을 읽는다.

확인할 것:
- `near=end(inf)` — 추론이 돌았다
- `nearBefore → nearAfter` 가 8→3 같은 모양 — 검색이 near 쪽을 채웠다
- `nr=1500` 또는 `nr=3000` — 완화 단계
- `!` 가 안 붙음 — 완화까지 안 갔다
- 화면에 "목적지 쪽엔 없어서" 문구가 **안 뜬다** — 추론은 사과하지 않는다

`nearBefore → nearAfter` 가 `8→1` 이면 Task 5 의 target 판정이 안 먹은 것이다. `nr=-` 면 완화까지 갔다는 뜻이니 Task 5·7 을 다시 본다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/plans/2026-09-17-near-side-inference.md
git commit -m "docs: near 축 구현 계획 체크 완료"
```

---

## 실행 순서 요약

```
1 계약 ─┬─ 2 decideNear ─ 3 matchesNear ─ 4 applyNear ─┐
        │                                              │
        └─ 12 프롬프트 ─ 13 채점 ─ 14 흔들림           │
                                                       │
        5 searchAlong ─ 6 searchAtAnchors ─ 7 컷 ──────┼─ 10 runPlan ─ 11 형제 ─ 15 검증
                                                       │
        8 배선 ─ 9 requestKey ────────────────────────┘
```

Task 2 부터 Task 10 까지는 `npm test` 가 `runPlan.ts` 의 타입 오류로 깨져 있다. 각 작업의 단일 파일 테스트로 확인하고, Task 10 에서 전체가 닫힌다. 이게 불편하면 Task 2 에서 `resolveNear` 를 `decideNear` 를 부르는 얇은 어댑터로 잠시 남겨도 된다 — 다만 Task 10 에서 반드시 지운다.
