# 후보 확보 결함 수정 (Kc=8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회랑 검색이 슬롯당 후보 8개를 확보할 때까지 반지름을 넓히되, `short` 판정은 여전히 사용자가 말한 `count` 기준으로만 내린다.

**Architecture:** `searchAlong`의 `need`(확대 목표 겸 판정 기준)를 둘로 나눈다. `target`은 "이만큼 모일 때까지 넓힌다"(기본 8), `need`는 "이보다 적으면 short"(= count). `runPlan`은 `target: max(count, KC)`를 넘긴다. 검색 함수·플래너·화면은 손대지 않는다.

**Tech Stack:** TypeScript, node:test (`npm test` = `tsx --test`). 외부 API 없음 — 검색 함수는 주입.

**Spec:** `docs/대중교통-경로-단계계획.md` 1단계. 배경 설계 `docs/최적경로-설계.md` 0.5단계("최소 Kc 확보가 목표").

## Global Constraints

- 테스트는 `npm test`로 전부 돌린다. 한 파일만 볼 때는 `npx tsx --test src/lib/corridorSearch.test.ts`.
- 커밋 메시지는 한국어, 기존 관례(`fix:`/`feat:`/`docs:` 접두).
- 단계 원칙: 이 계획은 1단계만 다룬다. 대중교통·UI 문구·공급자에 손대지 않는다.
- 커밋 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## 왜 `need`를 그냥 8로 올리면 안 되나

`src/lib/corridorSearch.ts:63`은 `found.length >= opts.need`면 `ok`, 상한까지 넓혀도 못 채우면 `short`를 돌려준다. `short`는 화면에서 "2/3곳" 칩이 된다(`plan.ts:139`가 그대로 slotStatus로 넘긴다). 브랜드 매장이 회랑 15km 안에 3곳뿐인데 `need=8`이면 `short`가 되어 사용자는 "요청한 개수를 못 찾았다"는 거짓 칩을 본다. 그래서 확대 목표와 판정 기준을 분리한다.

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/corridorSearch.ts` | 회랑 검색·확대·status | `target` 옵션 추가. 확대 루프는 `target`, status는 `need` |
| `src/lib/corridorSearch.test.ts` | 검색 단위 테스트 | 케이스 3개 추가 |
| `src/state/runPlan.ts` | 파이프라인 | `KC = 8` 상수, `target: Math.max(count, KC)` 전달 |
| `src/state/runPlan.test.ts` | 파이프라인 테스트 | "후보 2곳이면 상한까지 넓힌다" 케이스 추가 |
| `docs/최적경로-설계.md` | 설계 | 0.5단계 문장을 구현과 맞춤 |

---

### Task 1: `searchAlong`에 `target` 추가 — 확대 목표와 판정 기준 분리

**Files:**
- Modify: `src/lib/corridorSearch.ts:10-17` (옵션 타입), `:55-67` (루프)
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: 기존 `searchAlong(poly, query, opts, search)`, `CorridorSearchOptions`
- Produces: `CorridorSearchOptions.target?: number` — 확대를 멈추는 후보 수. 없으면 `need`와 같다(기존 동작 유지). 반환 타입 변경 없음.

- [ ] **Step 1: 실패하는 테스트 3개 추가**

`src/lib/corridorSearch.test.ts` 끝에 추가:

```ts
test('target — 1곳 찾았어도 target 까지 반지름을 넓힌다', async () => {
  // 2km 안에 1곳, 4km 안에 2곳 더, 8km 안에 5곳 더 = 8곳
  const cat: PlaceCandidate[] = [
    { id: 'a', name: 'a', coord: at(37.5, 127.05) },
    { id: 'b', name: 'b', coord: at(37.53, 127.05) },
    { id: 'c', name: 'c', coord: at(37.47, 127.05) },
    ...[1, 2, 3, 4, 5].map(i => ({ id: `d${i}`, name: `d${i}`, coord: at(37.56, 127.02 + 0.01 * i) })),
  ];
  const { fn, calls } = catalogSearch(cat);
  const r = await searchAlong(poly, 'q', { need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(r.radiusM, 8000);
  assert.equal(r.candidates.length, 8);
  assert.equal(calls.length, 15); // 2km·4km·8km × 5점
});

test('target 을 못 채워도 need 이상이면 ok — short 는 count 기준이다', async () => {
  const three = [127.03, 127.06, 127.09].map((lng, i) => ({ id: `t${i}`, name: `t${i}`, coord: at(37.5, lng) }));
  const { fn, calls } = catalogSearch(three);
  const r = await searchAlong(poly, 'q', { need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 3);
  assert.equal(r.radiusM, 4000); // 상한까지 넓혔다
  assert.equal(calls.length, 10);
});

test('target 없으면 need 가 곧 target — 기존 동작', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.5, 127.05) };
  const { fn, calls } = catalogSearch([c1]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 5);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: 첫 번째 테스트 FAIL — `r.radiusM` 2000 ≠ 8000, `calls.length` 5 ≠ 15. 두 번째 FAIL — `calls.length` 5 ≠ 10. 세 번째는 PASS(기존 동작).

- [ ] **Step 3: 구현**

`src/lib/corridorSearch.ts` 옵션 타입에 추가:

```ts
export type CorridorSearchOptions = {
  /** 이보다 적으면 short. 사용자가 말한 개수(count) */
  need: number;
  /** 이만큼 모일 때까지 반지름을 넓힌다. 없으면 need. 추천·교체 시트는 후보가 많아야 의미가 있다 */
  target?: number;
  initialRadiusM: number;
  maxRadiusM: number;
  samples?: number;
  farRadiusM?: number;
  max?: number;
};
```

루프를 바꾼다(`:55-67`):

```ts
  const target = Math.max(opts.need, opts.target ?? opts.need);
  let radiusM = opts.initialRadiusM;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = merge(await Promise.all(points.map(p => search(query, p, r))));
    if (found.length >= target) return { candidates: byCorridor(found), status: 'ok', radiusM: r };
    if (r >= opts.maxRadiusM) break;
    radiusM = Math.min(opts.maxRadiusM, r * 2);
  }
  if (found.length >= opts.need) return { candidates: byCorridor(found), status: 'ok', radiusM };
  if (found.length > 0) return { candidates: byCorridor(found), status: 'short', radiusM };
```

파일 머리 주석의 "없으면 반지름을 2배씩 넓힌다"를 "target(기본 need)만큼 모일 때까지 2배씩 넓힌다. status는 need 기준"으로 고친다.

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: 전부 PASS. 기존 케이스 중 `need=3인데 2개뿐이면 short`, `없으면 반지름을 2배씩 넓혀 찾는다`(calls 10)도 그대로 PASS여야 한다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts
git commit -m "fix(corridorSearch): 확대 목표(target)와 short 판정(need)을 분리한다

need 하나로 두 역할을 하면 후보를 8개 모으려는 순간 3곳뿐인 브랜드가
전부 short 칩을 단다. 확대는 target, 판정은 count.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `runPlan`이 `target: max(count, 8)`을 넘긴다

**Files:**
- Modify: `src/state/runPlan.ts:23` 근처 상수, `:100` searchAlong 호출
- Test: `src/state/runPlan.test.ts`

**Interfaces:**
- Consumes: Task 1의 `CorridorSearchOptions.target`
- Produces: `export const KC = 8` (다른 곳에서 쓰지 않지만 설계 문서의 이름과 맞춘다)

- [ ] **Step 1: 실패하는 테스트 추가**

`src/state/runPlan.test.ts`의 `req`·`collect` 정의 아래에 추가:

```ts
test('후보가 2곳뿐이면 상한까지 넓혀 찾고 status 는 ok — Kc=8 확보가 목표', async () => {
  // 카탈로그의 올리브영은 2곳(oy1·oy2, 둘 다 회랑 2km 안). target 8을 못 채우니 15km까지 넓힌다
  const radii: number[] = [];
  const spy: SearchFn = async (q, near, r) => { radii.push(r); return search(q, near, r); };
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false, stopKind: 'brand' }]), { provider: mockRouteProvider(), search: spy, dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { searchStatus?: string; candidates: unknown[] }[] }).slots;
  assert.equal(slots[0].searchStatus, 'ok'); // count=1 은 채웠다
  assert.equal(slots[0].candidates.length, 2);
  // 2km → 4km → 8km → 15km, 각 5점
  assert.deepEqual([...new Set(radii)], [2000, 4000, 8000, 15000]);
  assert.equal(radii.length, 20);
  assert.equal(actions[actions.length - 1].type, 'RESULT');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: 새 테스트 FAIL — `radii` 고유값이 `[2000]`, 길이 5. 나머지는 PASS.

- [ ] **Step 3: 구현**

`src/state/runPlan.ts` 상수 블록(`MAX_CANDIDATES` 옆)에 추가:

```ts
/** 슬롯당 확보 목표. 설계 0.5단계의 Kc. 이만큼 모일 때까지 회랑 반지름을 넓힌다 —
    후보가 적으면 추천 점수도 교체 시트도 의미가 없다. short 판정은 count 기준이라 별개 */
export const KC = 8;
```

`:100`의 searchAlong 호출을 바꾼다:

```ts
          { need: Math.max(1, st.count), target: Math.max(st.count, KC), initialRadiusM: initialRadiusM(request.mode), maxRadiusM: maxRadiusM(request.mode, slack, rho) },
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 전부 PASS. 특히 `정상 — START·PROGRESS×3·SLOTS·RESULT 순서` 테스트의 `slots[0].searchStatus === 'ok'`, `candidates.length === 2`가 유지돼야 한다(need/target 분리가 안 됐으면 여기서 `short`로 깨진다).

- [ ] **Step 5: 커밋**

```bash
git add src/state/runPlan.ts src/state/runPlan.test.ts
git commit -m "fix(runPlan): 슬롯당 후보 8개(Kc)를 확보할 때까지 회랑을 넓힌다

설계는 Kc=8 확보가 목표였는데 코드는 count(=1)만 넘겨 800m~2km에서
1곳만 찾으면 멈췄다. 실제 최선이 그 밖이면 후보에 영영 못 들어온다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 설계 문서 정합 + 실기기 확인

**Files:**
- Modify: `docs/최적경로-설계.md:46`

- [ ] **Step 1: 설계 문장 수정**

`:46`의 "슬롯의 `count`만큼(기본 1, 최소 Kc 확보가 목표) 못 찾으면 r을 2배씩 넓힌다"를 아래로 바꾼다:

```
- `Kc=8`(또는 `count`가 더 크면 그 값)이 모일 때까지 r을 2배씩 넓힌다. `short` 판정은 `count` 기준 —
  8개를 못 채워도 `count` 이상이면 `ok`다. (2026-09-15 구현. 그전엔 `count`만 넘겨 1곳에서 멈췄다.)
```

- [ ] **Step 2: 실기기 자동차 회귀 확인 (수동, 판정 기준 명시)**

시뮬레이터 또는 실기기에서 자동차 모드로 "올리브영 들르기" 1건. 트랙 로그(`src/lib/trackLog.ts`가 남기는 `net` 항목)에서:

| 확인 | 기준 |
|---|---|
| 장소 검색 호출 수 | 슬롯당 5의 배수, 최대 20 |
| SLOTS 후보 수 | 이전(보통 1~5)보다 늘거나 같음 |
| 1안 총 소요시간 | 이전 결과와 같거나 짧음 (후보가 늘어 나빠질 수는 없다) |
| 직행→RESULT 시간 | 12초 안 |

이전 결과가 없으면 같은 요청을 이 커밋 이전 빌드에서 한 번 돌려 비교한다. 기준을 하나라도 못 넘으면 Task 2를 되돌리고 원인을 적는다.

- [ ] **Step 3: 커밋**

```bash
git add docs/최적경로-설계.md
git commit -m "docs: 회랑 검색 확대 목표 Kc=8 과 short 판정 분리를 설계에 반영

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 완료 기준 (1단계 게이트)

1. `npm test` 전부 PASS.
2. `corridorSearch.test.ts`에 target 케이스 3개, `runPlan.test.ts`에 확대 케이스 1개가 있고 통과한다.
3. Task 3 Step 2의 표 4항목이 기준 안이다.
4. 이 세 커밋 외에 다른 변경이 섞이지 않았다.

이 게이트를 넘기 전에는 단계 문서의 2단계(출처 표시)에 손대지 않는다.
