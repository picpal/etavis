# 6단계 앵커 추출 + 앵커 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대중교통 경유지 후보를 직선 회랑이 아니라 **실제 승차역·환승역·하차역 주변**에서 찾는다.

**Architecture:** 5단계가 서버에서 받아 둔 `RouteResult.transit[0]`(정류장 좌표가 들어 있는 itinerary)에서 앵커(출발지·승차역·환승역·하차역·목적지)를 뽑고, 회랑 샘플 5점 대신 그 앵커들에서 장소를 찾는다. 후보에는 어느 앵커에서 몇 미터 걸어야 하는지(`anchorId`·`anchorWalkM`)를 붙인다. 순위 계산(삽입 비용)은 건드리지 않는다 — 그건 7단계다. 앵커 검색이 한 곳도 못 찾으면 기존 회랑 검색으로 떨어져 오늘보다 나빠지지 않는다.

**Tech Stack:** TypeScript, React Native(Expo SDK 57), node:test + tsx (`npm test`), 순수 함수는 화면 없이 시험한다.

**Spec:** `docs/대중교통-경로-단계계획.md` §6, `docs/최적경로-설계.md`

## Global Constraints

- 스테이징은 파일명을 직접 적는다. `git add -A` / `git add .` **금지** (과거에 node_modules 심링크가 커밋돼 사고가 났다).
- 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 테스트 글로브는 **평면만** 돈다 — `src/**/*.test.ts`. 테스트 파일은 소스 옆에 둔다.
- 완료 게이트: `npm test` 전부 통과 + `npx tsc --noEmit` exit 0.
- 이 단계는 **화면을 바꾸지 않는다**. `src/screens/**` 무변경이 완료 기준이다.
- 순수 로직 파일은 `expo-*`를 import 하지 않는다 — node 테스트가 읽지 못한다(`corridorSearch.ts`가 검색 함수를 주입받는 이유).
- 로그 한 줄의 값 타입은 `LogDetail = Record<string, string | number | boolean | null>` — 중첩 객체·배열을 넣을 수 없다. 이름 목록은 문자열로 합친다.
- API 키 값을 코드·문서·커밋에 절대 넣지 않는다.
- 서브에이전트는 서브에이전트를 만들지 않는다.

---

### Task 1: 검색 호출 수·후보 이름을 로그에 남긴다 (6단계 선행)

지금 `plan.slots` 로그는 `올리브영 30곳`처럼 **개수만** 남는다. 그래서 "목동역 KB가 후보에 들어왔는가"를 로그만 보고 판정할 수 없다. 6단계의 유일한 합격 조건이 그 판정이므로 이게 첫 커밋이다.

**Files:**
- Modify: `src/lib/corridorSearch.ts` (`searchAlong` 반환에 `calls` 추가)
- Modify: `src/lib/routePlan/types.ts` (`Slot`에 `searchRadiusM?`·`searchCalls?`)
- Modify: `src/state/runPlan.ts` (슬롯에 두 값 전달)
- Modify: `src/state/actionLog.ts` (`plan.slots`에 `picks`·`search` 추가)
- Test: `src/lib/corridorSearch.test.ts`, `src/state/actionLog.test.ts`

**Interfaces:**
- Consumes: 기존 `searchAlong(poly, query, opts, search)`, `SearchFn = (query, near, radiusM) => Promise<PlaceCandidate[]>`
- Produces: `searchAlong` 반환 타입 `{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number; calls: number }` — Task 3의 `searchAtAnchors`가 같은 모양을 돌려준다. `Slot.searchRadiusM?: number`, `Slot.searchCalls?: number`.

- [ ] **Step 1: `searchAlong`의 호출 수를 세는 실패 테스트를 쓴다**

`src/lib/corridorSearch.test.ts` 맨 아래에 추가한다. 기존 `catalogSearch` 헬퍼(파일 위쪽)를 그대로 쓴다.

```ts
test('calls — 샘플 5점 × 반지름 회차 수', async () => {
  // 10km 경로 한가운데에 한 곳. 초기 반지름 2000m 로는 못 찾고 4000m 에서 찾는다
  const mid = at(37.5, 127.0568);
  const { fn, calls } = catalogSearch([{ id: 'p1', name: '한곳', coord: mid }]);
  const r = await searchAlong(poly, '카페', { need: 1, initialRadiusM: 2000, maxRadiusM: 8000 }, fn);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.calls, calls.length);
  assert.equal(r.calls % 5, 0, '샘플 5점이 한 회차');
  assert.ok(r.calls >= 5);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — `r.calls`가 `undefined`라 `assert.equal(undefined, N)`에서 깨진다.

- [ ] **Step 3: `searchAlong`이 호출 수를 세게 한다**

`src/lib/corridorSearch.ts`. 반환 타입과 `merge` 호출부를 바꾼다.

함수 시그니처의 반환 타입을 이렇게 바꾼다:

```ts
): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number; calls: number }> {
```

`const samples = opts.samples ?? 5;` 바로 아래에 카운터를 둔다:

```ts
  let calls = 0;
  const countedSearch: SearchFn = (q, near, r) => { calls++; return search(q, near, r); };
```

그리고 함수 본문에서 `search(query, p, r)`·`search(query, p, farR)`를 `countedSearch(...)`로 바꾸고, 모든 `return` 문에 `calls`를 싣는다. 최종 형태의 반환 4곳:

```ts
    if (found.length >= target) return { candidates: byCorridor(found), status: 'ok', radiusM: r, calls };
```
```ts
  if (found.length >= opts.need) return { candidates: byCorridor(found), status: 'ok', radiusM, calls };
  if (found.length > 0) return { candidates: byCorridor(found), status: 'short', radiusM, calls };
```
```ts
    if (far.length > 0) return { candidates: byCorridor(far).slice(0, 3), status: 'far', radiusM: farR, calls };
  }
  return { candidates: [], status: 'none', radiusM, calls };
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: `Slot`에 두 필드를 더한다**

`src/lib/routePlan/types.ts`의 `Slot` 타입, `searchStatus?: SearchStatus;` 바로 아래:

```ts
  /** 마지막으로 쓴 검색 반지름(m). 로그 판정용 */
  searchRadiusM?: number;
  /** 이 슬롯이 부른 장소 검색 횟수. 로그 판정용 */
  searchCalls?: number;
```

- [ ] **Step 6: `runPlan`이 두 값을 슬롯에 싣는다**

`src/state/runPlan.ts`의 슬롯 생성 블록. `searchStatus: found.status,` 뒤에 이어 붙인다:

```ts
          count: Math.max(1, st.count), flexible: st.flexible, openNow: st.openNow, searchStatus: found.status,
          searchRadiusM: found.radiusM, searchCalls: found.calls,
```

- [ ] **Step 7: 로그 형식의 실패 테스트를 쓴다**

`src/state/actionLog.test.ts`에 추가한다. 이 파일의 기존 스타일대로 최소 상태만 만든다.

```ts
test('plan.slots — 후보 이름·반지름·검색 횟수를 남긴다', () => {
  const slots = [{
    id: 'sl-1', query: '올리브영', stopKind: 'category', dwellMin: 10, count: 1,
    flexible: true, openNow: false, searchStatus: 'ok', searchRadiusM: 800, searchCalls: 5,
    candidates: [
      { id: 'k-1', name: '올리브영 목동점', coord: { latitude: 37.5, longitude: 127.0 } },
      { id: 'k-2', name: '올리브영 국회의사당역점', coord: { latitude: 37.52, longitude: 126.91 } },
    ],
  }] as unknown as PlanFlowAction extends never ? never : Parameters<typeof describeFlowAction>[0] extends never ? never : never;
  const log = describeFlowAction({ type: 'SLOTS', slots: slots as never }, flowState());
  assert.equal(log?.a, 'plan.slots');
  assert.equal(log?.d?.found, '올리브영 2곳');
  assert.equal(log?.d?.search, '올리브영 r=800 calls=5');
  assert.equal(log?.d?.picks, '올리브영: 올리브영 목동점, 올리브영 국회의사당역점');
});
```

타입 곡예가 지저분하면 `const slots = [...] as never;`로 단순화해도 된다 — 이 테스트가 보는 건 로그 문자열이다.

- [ ] **Step 8: 실패를 확인한다**

Run: `npx tsx --test src/state/actionLog.test.ts`
Expected: FAIL — `d.search`와 `d.picks`가 `undefined`

- [ ] **Step 9: `plan.slots` 로그를 넓힌다**

`src/state/actionLog.ts`의 `case 'SLOTS':` 전체를 바꾼다. 로그 한 줄이 끝없이 길어지지 않게 자른다 — 슬롯당 후보 30곳이면 이름만 400자 근처다.

```ts
    case 'SLOTS':
      return {
        a: 'plan.slots',
        d: {
          found: action.slots.map(s => `${s.query} ${s.candidates.length}곳`).join(' · '),
          search: action.slots.map(s => `${s.query} r=${s.searchRadiusM ?? 0} calls=${s.searchCalls ?? 0}`).join(' · '),
          // 이름을 전부 남긴다 — "기대한 가게가 후보에 들어왔나"가 6단계의 합격 조건이라
          // 상위 몇 개만 남기면 판정을 못 한다
          picks: cut(action.slots.map(s => `${s.query}: ${s.candidates.map(c => c.name).join(', ')}`).join(' · '), 600),
        },
      };
```

- [ ] **Step 10: 전체 테스트와 타입을 확인한다**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 통과, tsc 출력 0줄

- [ ] **Step 11: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts src/lib/routePlan/types.ts src/state/runPlan.ts src/state/actionLog.ts src/state/actionLog.test.ts
git commit -m "$(cat <<'EOF'
feat(log): 슬롯 로그에 후보 이름·검색 반지름·호출 수 — 앵커 판정의 선행

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: itinerary → 앵커 추출

**Files:**
- Create: `src/lib/routePlan/anchors.ts`
- Create: `src/lib/routePlan/anchors.test.ts`

**Interfaces:**
- Consumes: `TransitItinerary`·`TransitLeg`·`TransitStop`·`LatLng` (`src/lib/routePlan/types.ts`), `haversineM` (`src/lib/geo.ts`)
- Produces:
  ```ts
  export type AnchorKind = 'origin' | 'board' | 'transfer' | 'alight' | 'destination';
  export type Anchor = { id: string; kind: AnchorKind; name: string; coord: LatLng; progressM: number };
  export function extractAnchors(it: TransitItinerary, origin: LatLng, destination: LatLng): Anchor[];
  ```
  Task 3의 `searchAtAnchors`와 Task 4의 `runPlan`이 이 타입을 쓴다.

**왜 이 좌표계인가:** 5단계의 `itineraryToRoute`가 만드는 폴리라인은 정확히 `[출발지, …정류장(연속 중복 제거)…, 목적지]`다. 앵커를 같은 점 목록에서 같은 순서로 뽑으면 `progressM`이 그 폴리라인의 진행 거리와 자동으로 일치한다 — 따로 투영할 필요가 없다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`src/lib/routePlan/anchors.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractAnchors } from './anchors.ts';
import type { TransitItinerary } from './types.ts';

// 픽스처는 readFileSync 로 읽는다 — transitProvider.test.ts 와 같은 방식
const fixture = JSON.parse(readFileSync(new URL('./fixtures/transit-sinjeong.json', import.meta.url), 'utf8')) as { itineraries: TransitItinerary[] };

const O = { latitude: 37.5188, longitude: 126.8575 }; // 신정동 1000-10
const D = { latitude: 37.5285, longitude: 126.9187 }; // 현대카드빌딩 2관

const first = fixture.itineraries[0];

test('환승 1회 — 출발지·승차·환승·하차·목적지 5개', () => {
  const a = extractAnchors(first, O, D);
  assert.deepEqual(a.map(x => x.kind), ['origin', 'board', 'transfer', 'alight', 'destination']);
  assert.deepEqual(a.map(x => x.name), ['출발지', '목동', '여의도', '국회의사당', '목적지']);
  assert.deepEqual(a.map(x => x.id), ['a0', 'a1', 'a2', 'a3', 'a4']);
  // 같은 역에서 갈아타면 정류장이 두 번 나오지만 앵커는 하나다
  assert.equal(a.filter(x => x.name === '여의도').length, 1);
});

test('progressM — 0에서 시작해 단조 증가한다', () => {
  const a = extractAnchors(first, O, D);
  assert.equal(a[0].progressM, 0);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].progressM > a[i - 1].progressM, `${i}번 앵커가 뒤로 갔다`);
});

test('환승 없음 — 승차·하차만', () => {
  const it: TransitItinerary = {
    durationMin: 20, distanceM: 5000,
    legs: [
      { kind: 'walk', durationMin: 5, distanceM: 300 },
      { kind: 'transit', mode: 'SUBWAY', line: '5호선',
        from: { name: '목동', lat: 37.526097, lng: 126.864538 },
        to: { name: '여의도', lat: 37.521624, lng: 126.924221 },
        durationMin: 11, stops: 6, departAt: null, arriveAt: null },
      { kind: 'walk', durationMin: 4, distanceM: 200 },
    ],
  };
  assert.deepEqual(extractAnchors(it, O, D).map(x => x.kind), ['origin', 'board', 'alight', 'destination']);
});

test('대중교통 구간이 없으면 출발지·목적지뿐', () => {
  const it: TransitItinerary = { durationMin: 12, distanceM: 900, legs: [{ kind: 'walk', durationMin: 12, distanceM: 900 }] };
  assert.deepEqual(extractAnchors(it, O, D).map(x => x.kind), ['origin', 'destination']);
});

test('이름이 달라도 200m 안이면 한 환승역', () => {
  const it: TransitItinerary = {
    durationMin: 30, distanceM: 6000,
    legs: [
      { kind: 'transit', mode: 'SUBWAY', line: '5호선',
        from: { name: '목동', lat: 37.526097, lng: 126.864538 },
        to: { name: '여의도', lat: 37.521624, lng: 126.924221 },
        durationMin: 11, stops: 6, departAt: null, arriveAt: null },
      { kind: 'transit', mode: 'SUBWAY', line: '9호선',
        from: { name: '여의도역 9호선', lat: 37.52165, lng: 126.92430 }, // 같은 역, 다른 이름·8m
        to: { name: '국회의사당', lat: 37.528143, lng: 126.917856 },
        durationMin: 1, stops: 1, departAt: null, arriveAt: null },
    ],
  };
  assert.deepEqual(extractAnchors(it, O, D).map(x => x.kind), ['origin', 'board', 'transfer', 'alight', 'destination']);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/routePlan/anchors.test.ts`
Expected: FAIL — `Cannot find module './anchors.ts'`

- [ ] **Step 3: `anchors.ts`를 쓴다**

```ts
/**
 * itinerary → 앵커. 대중교통에서 경유지가 붙을 만한 자리는 직선 위 아무 점이 아니라
 * 내가 실제로 발을 딛는 곳이다 — 출발지·승차역·환승역·하차역·목적지.
 *
 * progressM 은 5단계 itineraryToRoute 가 만드는 폴리라인
 * ([출발지, …정류장(연속 중복 제거)…, 목적지])의 진행 거리와 같은 좌표계다.
 * 같은 점 목록을 같은 순서로 걷기 때문이지, 투영해서 맞추는 게 아니다.
 */
import { haversineM } from '../geo';
import type { LatLng, TransitItinerary, TransitStop } from './types';

export type AnchorKind = 'origin' | 'board' | 'transfer' | 'alight' | 'destination';
export type Anchor = { id: string; kind: AnchorKind; name: string; coord: LatLng; progressM: number };

/** 같은 역인지 — 이름이 같거나 이만큼 안에 있으면 하나로 본다. 환승 통로가 이 정도다 */
const SAME_STOP_M = 200;

const toCoord = (s: TransitStop): LatLng => ({ latitude: s.lat, longitude: s.lng });

export function extractAnchors(it: TransitItinerary, origin: LatLng, destination: LatLng): Anchor[] {
  // 1. 대중교통 구간의 승·하차 정류장을 순서대로 늘어놓고 연속 중복을 접는다
  const stops: TransitStop[] = [];
  const push = (s: TransitStop) => {
    const last = stops[stops.length - 1];
    if (last && (last.name === s.name || haversineM(toCoord(last), toCoord(s)) <= SAME_STOP_M)) return;
    stops.push(s);
  };
  for (const l of it.legs) {
    if (l.kind !== 'transit') continue;
    push(l.from);
    push(l.to);
  }

  // 2. 첫 정류장은 승차, 마지막은 하차, 사이는 전부 환승
  const middle: Anchor[] = stops.map((s, i) => ({
    id: '', // 3에서 붙인다
    kind: (i === 0 ? 'board' : i === stops.length - 1 ? 'alight' : 'transfer') as AnchorKind,
    name: s.name,
    coord: toCoord(s),
    progressM: 0,
  }));

  const all: Anchor[] = [
    { id: '', kind: 'origin', name: '출발지', coord: origin, progressM: 0 },
    ...middle,
    { id: '', kind: 'destination', name: '목적지', coord: destination, progressM: 0 },
  ];

  // 3. id 와 진행 거리를 채운다
  let acc = 0;
  return all.map((a, i) => {
    if (i > 0) acc += haversineM(all[i - 1].coord, a.coord);
    return { ...a, id: `a${i}`, progressM: Math.round(acc) };
  });
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/routePlan/anchors.test.ts`
Expected: PASS 5건

- [ ] **Step 5: 타입 확인 후 커밋**

```bash
npx tsc --noEmit
git add src/lib/routePlan/anchors.ts src/lib/routePlan/anchors.test.ts
git commit -m "$(cat <<'EOF'
feat(routePlan): itinerary 에서 승차·환승·하차 앵커를 뽑는다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 앵커 주변 검색

**Files:**
- Modify: `src/lib/corridorSearch.ts` (`searchAtAnchors` 추가)
- Modify: `src/lib/routePlan/types.ts` (`PlaceCandidate`에 `anchorId?`·`anchorWalkM?`)
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Anchor`, 기존 `SearchFn`·`SearchStatus`·`PlaceCandidate`
- Produces:
  ```ts
  export const ANCHOR_INITIAL_M = 500;
  export const ANCHOR_MAX_M = 1500;
  export type AnchorSearchOptions = { need: number; target?: number; initialRadiusM?: number; maxRadiusM?: number; max?: number };
  export async function searchAtAnchors(
    anchors: Anchor[], query: string, opts: AnchorSearchOptions, search: SearchFn,
  ): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number; calls: number }>;
  ```
  `PlaceCandidate.anchorId?: string`, `PlaceCandidate.anchorWalkM?: number`. Task 4가 둘 다 쓴다.

**반지름을 왜 500/1500 으로 두나:** 역에서 1.5km를 걸으면 그건 더 이상 "역 근처"가 아니라 별개의 경유다. 회랑 검색의 transit 상한(3000m)을 그대로 쓰면 앵커라는 개념이 무의미해진다. 삽입 비용으로 거르는 건 7단계고, 6단계는 후보 생성만 한다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`src/lib/corridorSearch.test.ts` 맨 아래에 추가한다. import 줄에 `searchAtAnchors`·`ANCHOR_INITIAL_M`을 더하고, `Anchor` 타입도 가져온다.

```ts
import { ANCHOR_INITIAL_M, initialRadiusM, maxRadiusM, searchAlong, searchAtAnchors, type SearchFn } from './corridorSearch.ts';
import type { Anchor } from './routePlan/anchors.ts';
```

```ts
const anchors: Anchor[] = [
  { id: 'a0', kind: 'origin', name: '출발지', coord: at(37.5188, 126.8575), progressM: 0 },
  { id: 'a1', kind: 'board', name: '목동', coord: at(37.526097, 126.864538), progressM: 1100 },
  { id: 'a2', kind: 'transfer', name: '여의도', coord: at(37.521624, 126.924221), progressM: 6400 },
  { id: 'a3', kind: 'alight', name: '국회의사당', coord: at(37.528143, 126.917856), progressM: 7300 },
  { id: 'a4', kind: 'destination', name: '목적지', coord: at(37.5285, 126.9187), progressM: 7400 },
];

test('앵커 검색 — 각 앵커에서 한 번씩, 후보에 앵커와 도보 거리가 붙는다', async () => {
  const nearBoard = at(37.5263, 126.8650); // 목동역에서 100m 이내
  const { fn, calls } = catalogSearch([{ id: 'kb', name: '국민은행 목동역점', coord: nearBoard }]);
  const r = await searchAtAnchors(anchors, '국민은행', { need: 1 }, fn);

  assert.equal(r.calls, calls.length);
  assert.equal(r.calls, anchors.length, '앵커마다 한 번');
  assert.ok(calls.every(c => c.radiusM === ANCHOR_INITIAL_M));
  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].anchorId, 'a1');
  assert.ok(r.candidates[0].anchorWalkM! < 200, `도보 ${r.candidates[0].anchorWalkM}m`);
});

test('앵커 검색 — target 에 못 미치면 반지름을 넓힌다', async () => {
  const far = at(37.5300, 126.8700); // 목동역에서 500m 밖, 1000m 안
  const { fn, calls } = catalogSearch([{ id: 'x', name: '먼곳', coord: far }]);
  const r = await searchAtAnchors(anchors, '카페', { need: 1 }, fn);
  assert.equal(r.candidates.length, 1);
  assert.ok(r.radiusM > ANCHOR_INITIAL_M, '넓혔어야 한다');
  assert.equal(r.calls, calls.length);
  assert.equal(r.calls, anchors.length * 2, '두 회차');
});

test('앵커 검색 — 상한까지 0건이면 none', async () => {
  const { fn } = catalogSearch([{ id: 'z', name: '아주먼곳', coord: at(37.6, 127.3) }]);
  const r = await searchAtAnchors(anchors, '카페', { need: 1 }, fn);
  assert.equal(r.status, 'none');
  assert.equal(r.candidates.length, 0);
});

test('앵커 검색 — 여러 앵커에서 같은 id 가 나오면 가까운 앵커로 한 번만', async () => {
  const between = at(37.5249, 126.9210); // 여의도·국회의사당 사이, 국회의사당에 더 가깝다
  const { fn } = catalogSearch([{ id: 'dup', name: '올리브영', coord: between }]);
  const r = await searchAtAnchors(anchors, '올리브영', { need: 1, initialRadiusM: 1200 }, fn);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].anchorId, 'a3');
});

test('앵커 검색 — 도보 거리 오름차순', async () => {
  const { fn } = catalogSearch([
    { id: 'far', name: '먼 올리브영', coord: at(37.5300, 126.8700) },
    { id: 'near', name: '가까운 올리브영', coord: at(37.5263, 126.8650) },
  ]);
  const r = await searchAtAnchors(anchors, '올리브영', { need: 2, initialRadiusM: 1200 }, fn);
  assert.deepEqual(r.candidates.map(c => c.id), ['near', 'far']);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — `searchAtAnchors is not a function`

- [ ] **Step 3: `PlaceCandidate`에 두 필드를 더한다**

`src/lib/routePlan/types.ts`의 `PlaceCandidate`, `signals?: …` 바로 위에:

```ts
  /** 어느 앵커 주변에서 찾았나(6단계). 없으면 회랑 검색으로 찾은 것 */
  anchorId?: string;
  /** 그 앵커에서 여기까지 직선 거리(m). 7단계 삽입 비용의 재료 */
  anchorWalkM?: number;
```

- [ ] **Step 4: `searchAtAnchors`를 쓴다**

`src/lib/corridorSearch.ts` 맨 아래에 추가한다. 파일 위쪽 import에 `haversineM`을 더한다:

```ts
import { crossTrack, haversineM, pointAtProgress, polylineLengthM } from './geo';
import type { Anchor } from './routePlan/anchors';
```

```ts
/** 역에서 이만큼 안이면 "역 근처"다. 초기 반지름 */
export const ANCHOR_INITIAL_M = 500;
/** 여기를 넘으면 역 근처가 아니라 별개의 경유다 — 넓히기를 멈춘다 */
export const ANCHOR_MAX_M = 1500;

export type AnchorSearchOptions = {
  /** 이보다 적으면 short */
  need: number;
  /** 이만큼 모일 때까지 넓힌다. 없으면 need */
  target?: number;
  initialRadiusM?: number;
  maxRadiusM?: number;
  max?: number;
};

/**
 * 앵커 주변 검색 — 직선 위 아무 점이 아니라 실제로 내리는 역에서 찾는다.
 * 후보마다 가장 가까운 앵커와 그 거리를 붙인다. 순위는 여기서 정하지 않는다(7단계).
 */
export async function searchAtAnchors(
  anchors: Anchor[],
  query: string,
  opts: AnchorSearchOptions,
  search: SearchFn,
): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number; calls: number }> {
  const initial = opts.initialRadiusM ?? ANCHOR_INITIAL_M;
  const maxR = Math.max(initial, opts.maxRadiusM ?? ANCHOR_MAX_M);
  const target = Math.max(opts.need, opts.target ?? opts.need);
  const max = opts.max ?? 30;
  let calls = 0;

  /** 후보를 가장 가까운 앵커에 붙인다. 같은 id 가 여러 앵커에서 나오면 가까운 쪽이 이긴다 */
  const attach = (lists: PlaceCandidate[][]) => {
    const best = new Map<string, PlaceCandidate>();
    for (let i = 0; i < lists.length; i++) {
      const a = anchors[i];
      for (const c of lists[i]) {
        const walkM = Math.round(haversineM(a.coord, c.coord));
        const prev = best.get(c.id);
        if (prev && (prev.anchorWalkM ?? Infinity) <= walkM) continue;
        best.set(c.id, { ...c, anchorId: a.id, anchorWalkM: walkM });
      }
    }
    return [...best.values()].sort((x, y) => (x.anchorWalkM ?? 0) - (y.anchorWalkM ?? 0)).slice(0, max);
  };

  let radiusM = initial;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = attach(await Promise.all(anchors.map(a => { calls++; return search(query, a.coord, r); })));
    if (found.length >= target) return { candidates: found, status: 'ok', radiusM: r, calls };
    if (r >= maxR) break;
    radiusM = Math.min(maxR, r * 2);
  }
  if (found.length >= opts.need) return { candidates: found, status: 'ok', radiusM, calls };
  if (found.length > 0) return { candidates: found, status: 'short', radiusM, calls };
  return { candidates: [], status: 'none', radiusM, calls };
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: PASS (기존 + 신규 5건)

- [ ] **Step 6: 전체 테스트·타입 확인 후 커밋**

```bash
npm test && npx tsc --noEmit
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts src/lib/routePlan/types.ts
git commit -m "$(cat <<'EOF'
feat(search): 앵커 주변 검색 — 후보에 앵커와 도보 거리를 붙인다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `runPlan` 배선 — 대중교통이면 앵커로 찾는다

**Files:**
- Modify: `src/state/runPlan.ts`
- Modify: `src/state/actionLog.ts` (`plan.slots`의 `picks`에 앵커 표기)
- Test: `src/state/runPlan.test.ts`, `src/state/actionLog.test.ts`

**Interfaces:**
- Consumes: Task 2 `extractAnchors`, Task 3 `searchAtAnchors`·`ANCHOR_MAX_M`, 기존 `searchAlong`·`RouteResult.transit`
- Produces: 대중교통 슬롯의 `candidates[].anchorId`·`anchorWalkM`가 채워진다. 7단계 삽입 비용이 이 둘을 읽는다.

**폴백을 왜 두나:** 앵커 검색이 0건이면(역세권에 그 업종이 없는 OD) 앵커만 믿었다간 오늘 나오던 후보까지 사라진다. 6단계는 후보를 **늘리는** 단계지 줄이는 단계가 아니다. `none`이면 기존 회랑 검색으로 한 번 더 찾는다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`src/state/runPlan.test.ts` 맨 아래에 추가한다. 이 파일의 기존 헬퍼(목 공급자·목 검색·액션 수집)를 그대로 쓴다 — 파일 위쪽을 먼저 읽고 이름을 맞춘다.

```ts
test('대중교통 — itinerary 가 있으면 앵커에서 찾는다', async () => {
  const board = { latitude: 37.526097, longitude: 126.864538 };
  const nearBoard = { latitude: 37.5263, longitude: 126.8650 };
  const searched: { latitude: number; longitude: number }[] = [];
  const search = async (_q: string, near: { latitude: number; longitude: number }, r: number) => {
    searched.push(near);
    return Math.hypot(near.latitude - nearBoard.latitude, near.longitude - nearBoard.longitude) < 0.01
      ? [{ id: 'kb', name: '국민은행 목동역점', coord: nearBoard }]
      : [];
  };
  const provider = {
    route: async (points: { latitude: number; longitude: number }[]) => ({
      durationMin: 24, distanceKm: 7.2,
      polyline: [points[0], board, points[points.length - 1]],
      sections: points.slice(1).map(() => ({ durationMin: 12, distanceKm: 3.6 })),
      source: 'provider' as const,
      transit: [{
        durationMin: 24, distanceM: 7218,
        legs: [{
          kind: 'transit' as const, mode: 'SUBWAY' as const, line: '5호선',
          from: { name: '목동', lat: 37.526097, lng: 126.864538 },
          to: { name: '국회의사당', lat: 37.528143, lng: 126.917856 },
          durationMin: 12, stops: 6, departAt: null, arriveAt: null,
        }],
      }],
    }),
  };
  const actions: { type: string }[] = [];
  await runPlan(
    { origin: { latitude: 37.5188, longitude: 126.8575 }, destination: { latitude: 37.5285, longitude: 126.9187 },
      departAtMin: 9 * 60, arriveByMin: null, mode: 'transit', order: 'auto',
      stops: [{ id: 'sl-1', query: '국민은행', count: 1, flexible: true, openNow: false, stopKind: 'category' }] } as never,
    { provider: provider as never, search: search as never, dispatch: a => actions.push(a) },
  );

  const slots = (actions.find(a => a.type === 'SLOTS') as { slots: { candidates: { id: string; anchorId?: string; anchorWalkM?: number }[] }[] }).slots;
  assert.equal(slots[0].candidates.length, 1);
  assert.equal(slots[0].candidates[0].anchorId, 'a1', '승차역 앵커에 붙어야 한다');
  assert.ok(slots[0].candidates[0].anchorWalkM! < 200);
  // 검색은 앵커 좌표에서 이뤄졌다 — 직선 위 등간격 5점이 아니다
  assert.ok(searched.some(p => Math.abs(p.latitude - board.latitude) < 1e-6), '승차역에서 찾지 않았다');
});

test('대중교통 — 앵커에서 0건이면 회랑 검색으로 떨어진다', async () => {
  // 앵커(역) 근처엔 없고, 직선 회랑 중간에만 있는 가게
  const onCorridor = { latitude: 37.5235, longitude: 126.8880 };
  const search = async (_q: string, near: { latitude: number; longitude: number }, r: number) =>
    Math.hypot(near.latitude - onCorridor.latitude, near.longitude - onCorridor.longitude) < 0.02 && r >= 2000
      ? [{ id: 'far1', name: '회랑 가게', coord: onCorridor }]
      : [];
  // (provider·runPlan 호출은 위 테스트와 같은 모양으로 구성한다)
  // 기대: SLOTS 의 후보가 1곳이고 anchorId 가 없다(회랑에서 온 것)
});
```

두 번째 테스트의 provider·runPlan 호출부는 첫 테스트를 그대로 복사해 `search`만 바꾼다. 기대값:

```ts
  assert.equal(slots[0].candidates.length, 1);
  assert.equal(slots[0].candidates[0].anchorId, undefined, '회랑에서 온 후보엔 앵커가 없다');
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: FAIL — `anchorId`가 `undefined`(첫 테스트), 두 번째는 후보 0곳

- [ ] **Step 3: `runPlan`이 앵커를 쓰게 한다**

`src/state/runPlan.ts`. import 줄에 더한다:

```ts
import { initialRadiusM, maxRadiusM, searchAlong, searchAtAnchors, ANCHOR_MAX_M, type SearchFn } from '../lib/corridorSearch';
import { extractAnchors, type Anchor } from '../lib/routePlan/anchors';
```

`const poly = direct.polyline.length >= 2 ? …` 바로 아래에 앵커를 만든다:

```ts
    // 대중교통이면 실제 정류장이 앵커다. 공급자가 itinerary 를 안 줬으면(추정 폴백)
    // 앵커도 없다 — 그때는 지금까지처럼 회랑으로 찾는다
    const itinerary = request.mode === 'transit' ? direct.transit?.[0] : undefined;
    const anchors: Anchor[] = itinerary ? extractAnchors(itinerary, request.origin, request.destination) : [];
```

슬롯 생성 블록 안의 `const found = await searchAlong(...)` 를 이렇게 바꾼다:

```ts
        const need = Math.max(1, st.count);
        const target = Math.max(st.count, KC);
        const corridor = () => searchAlong(
          poly, st.query,
          { need, target, initialRadiusM: initialRadiusM(request.mode), maxRadiusM: maxRadiusM(request.mode, slack, rho) },
          search,
        );
        // 앵커가 있으면 역 주변부터. 한 곳도 없으면 오늘 나오던 후보까지 잃지 않게 회랑으로 떨어진다
        let found = anchors.length > 0
          ? await searchAtAnchors(anchors, st.query, {
              need, target,
              maxRadiusM: Math.min(ANCHOR_MAX_M, maxRadiusM(request.mode, slack, rho)),
            }, search)
          : await corridor();
        if (anchors.length > 0 && found.status === 'none') found = await corridor();
```

`dispatch({ type: 'SLOTS', slots });` 바로 위에 앵커를 로그로 남긴다:

```ts
    if (anchors.length > 0) {
      dispatch({ type: 'PROGRESS', key: 'search', detail: `앵커 ${anchors.map(a => a.name).join(' → ')}` });
    }
```

주의: 기존 `dispatch({ type: 'PROGRESS', key: 'search', detail: slots.map(...) })` 줄은 그대로 둔다 — 앵커 줄이 먼저, 후보 개수 줄이 뒤다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: PASS (기존 포함 전부)

- [ ] **Step 5: 로그 `picks`에 앵커를 적는 실패 테스트를 쓴다**

`src/state/actionLog.test.ts`의 Task 1 테스트 아래에 추가한다.

```ts
test('plan.slots — 앵커에서 온 후보는 앵커와 도보 거리를 적는다', () => {
  const slots = [{
    id: 'sl-1', query: '국민은행', stopKind: 'category', dwellMin: 5, count: 1,
    flexible: true, openNow: false, searchStatus: 'ok', searchRadiusM: 500, searchCalls: 5,
    candidates: [{ id: 'kb', name: '국민은행 목동역점', coord: { latitude: 37.52, longitude: 126.86 }, anchorId: 'a1', anchorWalkM: 120 }],
  }] as never;
  const log = describeFlowAction({ type: 'SLOTS', slots } as never, flowState());
  assert.equal(log?.d?.picks, '국민은행: 국민은행 목동역점(a1 120m)');
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx tsx --test src/state/actionLog.test.ts`
Expected: FAIL — `국민은행: 국민은행 목동역점`(앵커 표기 없음)

- [ ] **Step 7: `picks`에 앵커를 적는다**

`src/state/actionLog.ts`의 `case 'SLOTS':`에서 `picks` 줄만 바꾼다:

```ts
          picks: cut(action.slots.map(s => `${s.query}: ${s.candidates.map(c =>
            c.anchorId ? `${c.name}(${c.anchorId} ${c.anchorWalkM ?? 0}m)` : c.name).join(', ')}`).join(' · '), 600),
```

- [ ] **Step 8: 전체 테스트·타입 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 통과, tsc 0줄

- [ ] **Step 9: 화면이 안 바뀌었는지 확인**

Run: `git diff --stat HEAD -- src/screens`
Expected: 빈 출력

- [ ] **Step 10: 커밋**

```bash
git add src/state/runPlan.ts src/state/runPlan.test.ts src/state/actionLog.ts src/state/actionLog.test.ts
git commit -m "$(cat <<'EOF'
feat: 대중교통 경유지를 역 주변에서 찾는다 — 앵커 0건이면 회랑 폴백

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 시뮬레이터 검증 (컨트롤러가 직접 한다)

서브에이전트에게 맡기지 않는다. 화면을 보고 사실로 확인하는 게 이 단계의 합격 조건이다.

**준비**

```bash
xcodebuild -workspace ios/Etavia.xcworkspace -scheme Etavia -configuration Debug \
  -destination "id=32E7E297-E515-478B-8EB4-62E8AF4B069E" -derivedDataPath ./build-sim
xcrun simctl install 32E7E297-E515-478B-8EB4-62E8AF4B069E ./build-sim/Build/Products/Debug-iphonesimulator/Etavia.app
```

Metro가 붙었는지 `/private/tmp/metro.log`의 "iOS Bundled" 줄 수가 늘었는지로 확인한다. Release 번들이 박힌 앱을 보고 판정한 사고가 있었다.

**검증 항목 — 전부 통과해야 다음 단계다**

- [ ] **1. 실패 케이스 재현**: 출발지 `신정동 1000-10`, 목적지 `현대카드빌딩 2관`, 대중교통, 경유지 `국민은행`·`올리브영`.
- [ ] **2. SLOTS 로그의 합격 조건**: 트랙 로그(`.../Documents/tracklog/track-YYYYMMDD.jsonl`)의 `plan.slots` 줄에서 `picks`를 읽는다. **목동역 부근 국민은행과 국회의사당역(또는 목동역) 부근 올리브영이 들어 있어야 한다.** 이게 6단계의 유일한 합격 조건이다.
- [ ] **3. 앵커가 실제 역인가**: `plan.step` 줄의 `앵커 출발지 → 목동 → … → 목적지`가 5단계에서 확인한 경로(5호선 목동 → 여의도 → 9호선 국회의사당)와 같은가.
- [ ] **4. 검색 호출 수**: `plan.slots`의 `search`에서 `calls`가 앵커 수의 배수인가. 반지름이 500에서 시작하는가.
- [ ] **5. 회랑 폴백**: 역세권에 없을 업종(예: `주차장`)으로 한 번 더 돌려 `anchorId` 없는 후보가 나오는지, 후보가 0곳으로 무너지지 않는지 본다.
- [ ] **6. 자동차 회귀**: 같은 OD를 자동차로 돌려 앵커 로그가 없고(`plan.step`에 앵커 줄 없음) 후보·도착 시각이 5단계와 같은지 본다.
- [ ] **7. 화면 무변경**: 추천 화면의 문구·배너가 5단계와 같다. 이 단계는 후보 생성만 바꿨다.

**완료 기준**: 2번이 통과하고, 6번 회귀가 없다. 결과를 `docs/대중교통-경로-단계계획.md` §6에 실측으로 적는다.

---

## Self-Review

**1. 스펙 커버리지** (`docs/대중교통-경로-단계계획.md` §6)

| 스펙 문장 | 태스크 |
|---|---|
| `anchors.ts` — itinerary에서 출발지·승차역·환승역·하차역·목적지 앵커 추출(kind, 진행도, 좌표) | Task 2 |
| `corridorSearch.ts`에 `searchAtAnchors(anchors, query, radius 500m)` | Task 3 (`ANCHOR_INITIAL_M = 500`) |
| `runPlan`은 대중교통이면 직선 회랑 대신 이걸 쓴다 | Task 4 |
| 후보에 `anchorId`·`anchorWalkM`을 붙인다 | Task 3 (타입·부착), Task 4 (실제 배선) |
| 선행: 후보 이름·id와 검색 호출 수(반지름별)를 로그에 — 6단계 첫 커밋 | Task 1 |
| 검증: SLOTS 로그에 목동역 KB·국회의사당역 올리브영 | Task 5 항목 2 |

순위·삽입 비용은 7단계라 여기 없다 — 의도한 범위다.

**2. 플레이스홀더 점검**: Task 4 Step 1의 두 번째 테스트만 "위 테스트와 같은 모양으로 구성한다"라고 적었고, 바꿔야 할 부분(`search`)과 기대값 두 줄을 명시했다. 나머지 코드 블록은 전부 실제 코드다.

**3. 타입 일관성**: `Anchor`는 Task 2가 `src/lib/routePlan/anchors.ts`에 정의하고 Task 3·4가 같은 경로에서 import한다. `searchAtAnchors`의 반환 모양은 Task 1이 `searchAlong`에 맞춰 놓은 `{candidates, status, radiusM, calls}`와 같다 — Task 4가 두 함수를 같은 변수(`found`)에 담을 수 있는 이유다. `ANCHOR_MAX_M`은 Task 3이 export하고 Task 4가 쓴다.
