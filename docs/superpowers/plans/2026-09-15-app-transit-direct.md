# 앱 transitProvider — 직행만 공급자로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대중교통 모드의 **직행(2점) 실측**을 서버 `/transit`에서 받는다. 경유지 조합(3점 이상)은 아직 목 추정이다. 그 사실을 출처 `provider_direct_only`로 구분해 화면이 "직행은 시간표 조회 · 경유 추가시간은 추정"이라고 말한다. 직행 응답의 정류장 좌표로 회랑 폴리라인을 만들어 이후 앵커(6단계)의 재료로 쓴다.

**Architecture:** `RouteProvider` 구현체 하나(`transitRouteProvider`)를 추가한다. 2점이면 `/transit` → 1위 itinerary를 `RouteResult`로 바꾼다(`source: 'provider'`, 폴리라인 = 출발지·정류장들·목적지). 3점 이상이면 주입받은 추정 공급자(목)로 넘긴다. 서버 실패는 추정으로 **폴백**하고 로그를 남긴다 — 직행 실패로 계획 전체가 죽지 않게. 플래너는 직행이 provider인데 시드가 estimate면 `timingSource = 'provider_direct_only'`. `timingCopy`가 그 값에 맞는 문구를 낸다. 화면은 손대지 않는다(2단계에서 `timingCopy` 하나로 모았다).

**Tech Stack:** TypeScript, React Native(Expo), node:test via `tsx`(`npm test`), `npx tsc --noEmit`. 실 응답 픽스처는 서버 테스트의 정규화 결과를 앱 픽스처로 옮긴다(아래 Task 3 픽스처).

**Spec:** `docs/대중교통-경로-단계계획.md` 5단계. 서버 계약: `docs/superpowers/plans/2026-09-15-transit-proxy.md`(요청 `{origin:{lat,lng},destination:{lat,lng},departAt?,alternatives?,preferSubway?}`, 응답 `{provider,source:'provider',itineraries:[{durationMin,distanceM,legs:[walk|transit]}]}`).

## Global Constraints

- `npm test` 전부 PASS, `npx tsc --noEmit` 0.
- 커밋 메시지 한국어, `feat:`/`fix:` 접두, 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 파일 이름으로 스테이징, `git add -A` 금지.
- 단계 원칙: 경유지 조합 계산·회랑 검색·앵커에는 손대지 않는다. **직행 실측과 출처 표시**만.
- 화면 파일(`src/screens/*`)은 손대지 않는다. 문구는 `src/lib/timingCopy.ts`에서만.
- 문구(정확히):
  - 배너(provider_direct_only, transit): `직행은 시간표 조회 · 경유 추가시간은 추정`
  - 1안 근거(provider_direct_only): `직행은 실측, 경유는 추정으로 계산한 경로예요`
  - 입력 안내(transit): `대중교통 직행은 시간표 기준 · 경유지 추가시간은 아직 추정이에요`
  - 입력 안내(walk): `도보 시간은 아직 추정이에요 · 도착 시각은 참고만` (기존 문구에서 대중교통을 뺀 것)
- 타임아웃 8초(`serverProvider`와 같은 근거). 서버 실패·타임아웃·모양 불량은 **throw 하지 않고 추정으로 폴백**, `onFallback(err)` 호출.

---

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/routePlan/types.ts` | 타입 | `TimingSource`에 `provider_direct_only`, `TransitStop/TransitLeg/TransitItinerary`, `RouteResult.transit?` |
| `src/lib/timingCopy.ts` (+test) | 문구 | `provider_direct_only` 분기, `introCopy` 3모드 |
| `src/lib/routePlan/plan.ts` (+test) | 플래너 | `timingSource` 3값 산출 |
| `src/lib/routePlan/transitProvider.ts` (+test, 신규) | `/transit` 공급자 | 2점 실측·폴리라인·폴백·3점 위임 |
| `src/lib/routePlan/fixtures/transit-sinjeong.json` (신규) | 서버 정규화 응답 픽스처 | 테스트 재료 |
| `src/state/planFlowProvider.tsx` | 배선 | `hybridProvider`에 transit 분기, 로그 ep |

---

### Task 1: 타입 + 문구

**Files:**
- Modify: `src/lib/routePlan/types.ts:54`(TimingSource), `:~60`(RouteResult), `src/lib/timingCopy.ts`
- Test: `src/lib/timingCopy.test.ts`

**Interfaces (Produces):**
```ts
export type TimingSource = 'provider' | 'provider_direct_only' | 'estimate';
export type TransitStop = { name: string; lat: number; lng: number };
export type TransitLeg =
  | { kind: 'walk'; durationMin: number; distanceM: number }
  | { kind: 'transit'; mode: 'SUBWAY' | 'BUS' | 'TRAIN' | 'OTHER'; line: string; from: TransitStop; to: TransitStop; durationMin: number; stops: number | null; departAt: string | null; arriveAt: string | null };
export type TransitItinerary = { durationMin: number; distanceM: number; legs: TransitLeg[] };
// RouteResult 에 추가: /** 대중교통 직행일 때 서버가 준 경로들(1위가 [0]). 앵커(6단계)의 재료 */ transit?: TransitItinerary[];
```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/timingCopy.test.ts`에 추가:

```ts
test('직행만 실측(provider_direct_only) — 약·전용 배너·판정 안 함', () => {
  assert.deepEqual(timingCopy('provider_direct_only', 'transit'), { approx: '약 ', banner: '직행은 시간표 조회 · 경유 추가시간은 추정', showVerdict: false });
});

test('입력 화면 안내 — 대중교통은 직행 실측 사실을 말한다', () => {
  assert.equal(introCopy('transit'), '대중교통 직행은 시간표 기준 · 경유지 추가시간은 아직 추정이에요');
  assert.equal(introCopy('walk'), '도보 시간은 아직 추정이에요 · 도착 시각은 참고만');
  assert.equal(introCopy('car'), '직선거리가 아니라 실제 소요시간으로 계산해요');
});

test('1안 근거 — 직행만 실측', () => {
  assert.equal(rationaleCopy('provider_direct_only', 3), '직행은 실측, 경유는 추정으로 계산한 경로예요');
});
```

기존 `입력 화면 안내는 모드별` 테스트의 transit·walk 기대 문자열은 새 문구로 바꾼다(그 테스트가 위 새 테스트와 겹치면 위 것으로 대체).

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/timingCopy.test.ts` → 새 3개 FAIL(타입 오류가 아니라 값 불일치).

- [ ] **Step 3: 구현**

`src/lib/routePlan/types.ts`: `TimingSource` 주석과 유니온:
```ts
/** 시간의 출처. provider = 전부 공급자 응답, provider_direct_only = 직행만 공급자·경유 조합은 추정(대중교통 5단계), estimate = 하버사인 목 */
export type TimingSource = 'provider' | 'provider_direct_only' | 'estimate';
```
`RouteResult` 위에 `TransitStop`·`TransitLeg`·`TransitItinerary`를 위 Interfaces 그대로 추가하고 `RouteResult`에 `transit?: TransitItinerary[];` 필드(주석 포함).

`src/lib/timingCopy.ts`:
```ts
const BANNER_DIRECT_ONLY: Record<Mode, string> = {
  transit: '직행은 시간표 조회 · 경유 추가시간은 추정',
  walk: '직행은 실측 · 경유 추가시간은 추정',
  car: '직행은 실측 · 경유 추가시간은 추정',
};

export function timingCopy(source: TimingSource | undefined, mode: Mode, legEstimated = false): TimingCopy {
  if (source === 'provider') return { approx: legEstimated ? '약 ' : '', banner: null, showVerdict: true };
  // 직행만 실측 — 도착 시각의 대부분이 추정이라 판정은 안 한다. 다만 배너는 무엇이 실측인지 말한다
  if (source === 'provider_direct_only') return { approx: '약 ', banner: BANNER_DIRECT_ONLY[mode], showVerdict: false };
  // 출처를 못 밝히면 추정이다 — 목 데이터셋(timingSource 없음)이 여기 온다
  return { approx: '약 ', banner: BANNER[mode], showVerdict: false };
}

const INTRO: Record<Mode, string> = {
  car: '직선거리가 아니라 실제 소요시간으로 계산해요',
  transit: '대중교통 직행은 시간표 기준 · 경유지 추가시간은 아직 추정이에요',
  walk: '도보 시간은 아직 추정이에요 · 도착 시각은 참고만',
};
export function introCopy(mode: Mode): string { return INTRO[mode]; }

export function rationaleCopy(source: TimingSource, measuredCount: number): string {
  if (source === 'provider') return `실측 ${measuredCount}회로 확인한 경로예요.`;
  if (source === 'provider_direct_only') return '직행은 실측, 경유는 추정으로 계산한 경로예요';
  return '추정으로 계산한 경로예요 · 실측 전';
}
```

- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit` (walk/car 의 BANNER_DIRECT_ONLY 는 이번 단계에 도달하지 않지만 Record 완전성을 위해 둔다).

- [ ] **Step 5: 커밋**
```bash
git add src/lib/routePlan/types.ts src/lib/timingCopy.ts src/lib/timingCopy.test.ts
git commit -m "feat: 출처에 provider_direct_only — 직행만 실측일 때의 문구와 대중교통 경로 타입

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 플래너 — 직행만 provider면 provider_direct_only

**Files:**
- Modify: `src/lib/routePlan/plan.ts:76-90`(measure), `:179`
- Test: `src/lib/routePlan/plan.test.ts`

**Interfaces:** Consumes Task 1 `TimingSource`. Produces: `PlanResult.timingSource` 3값.

- [ ] **Step 1: 실패하는 테스트** — `plan.test.ts` 끝에:

```ts
test('timingSource — 직행만 provider 고 시드가 estimate 면 provider_direct_only', async () => {
  const mock = mockRouteProvider();
  const directOnly = { route: async (...args: Parameters<typeof mock.route>) => {
    const r = await mock.route(...args);
    return args[0].length === 2 ? { ...r, source: 'provider' as const } : r; // 3점 이상은 mock 그대로(estimate)
  } };
  const r = await plan(base([slot('a', [on, near])]), directOnly);
  assert.equal(r.timingSource, 'provider_direct_only');
  // 경유지가 없으면 직행이 곧 계획 — provider
  const r0 = await plan(base([]), directOnly);
  assert.equal(r0.timingSource, 'provider');
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/routePlan/plan.test.ts` → 새 테스트 FAIL(`provider` ≠ `provider_direct_only`).

- [ ] **Step 3: 구현** — `plan.ts`: `measure` 안에서 성공한 `route`의 출처를 모은다. `const measured: Scored[] = [];` 옆에 `let seedEstimated = false;` 를 두고, `learnLegs(...)` 직전에 `if (route.source !== 'provider') seedEstimated = true;`. `:179`를:

```ts
  // 직행이 공급자여도 시드가 추정이면 도착 시각의 대부분이 추정이다 — 그걸 provider 라 부르면 화면이 거짓말한다
  const timingSource: PlanResult['timingSource'] =
    direct.source !== 'provider' ? 'estimate' : seedEstimated ? 'provider_direct_only' : 'provider';
```

- [ ] **Step 4: 통과 확인** — `npm test && npx tsc --noEmit`. 기존 `timingSource — 목이면 estimate, 공급자가 provider 를 찍으면 provider` 테스트(시드까지 provider 로 찍는 stamped)는 그대로 PASS 여야 한다.

- [ ] **Step 5: 커밋**
```bash
git add src/lib/routePlan/plan.ts src/lib/routePlan/plan.test.ts
git commit -m "feat(routePlan): 직행만 공급자면 timingSource 를 provider_direct_only 로

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: transitRouteProvider — /transit 직행 실측, 폴리라인, 폴백

**Files:**
- Create: `src/lib/routePlan/transitProvider.ts`, `src/lib/routePlan/fixtures/transit-sinjeong.json`
- Test: `src/lib/routePlan/transitProvider.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, `RouteProvider`, `RouteResult`, `ServerProviderOptions`(from `./serverProvider`).
- Produces:
  ```ts
  export type TransitProviderOptions = ServerProviderOptions & { estimate: RouteProvider; onFallback?: (err: unknown) => void };
  export function departAtIso(departAtMin: number, now: Date): string | undefined; // 지금보다 2분 이상 뒤일 때만
  export function itineraryToRoute(it: TransitItinerary, origin: LatLng, destination: LatLng, all: TransitItinerary[]): RouteResult;
  export function transitRouteProvider(opts: TransitProviderOptions): RouteProvider;
  ```

픽스처 `src/lib/routePlan/fixtures/transit-sinjeong.json` — 서버 `/transit`의 실제 응답 형식(2026-09-15 운영 curl). 아래 내용을 그대로 저장한다(1위만 실 값, 2위는 축약):

```json
{"provider":"google","source":"provider","itineraries":[
 {"durationMin":23.6,"distanceM":7218,"legs":[
  {"kind":"walk","durationMin":6.4,"distanceM":379},
  {"kind":"transit","mode":"SUBWAY","line":"5호선","from":{"name":"목동","lat":37.526097,"lng":126.864538},"to":{"name":"여의도","lat":37.521624,"lng":126.924221},"durationMin":11,"stops":6,"departAt":"2026-09-16T00:47:00Z","arriveAt":"2026-09-16T00:58:00Z"},
  {"kind":"walk","durationMin":2.1,"distanceM":79},
  {"kind":"transit","mode":"SUBWAY","line":"9호선","from":{"name":"여의도","lat":37.521624,"lng":126.924221},"to":{"name":"국회의사당","lat":37.528143,"lng":126.917856},"durationMin":1,"stops":1,"departAt":"2026-09-16T01:01:00Z","arriveAt":"2026-09-16T01:02:00Z"},
  {"kind":"walk","durationMin":3.2,"distanceM":164}]},
 {"durationMin":40.1,"distanceM":8874,"legs":[
  {"kind":"walk","durationMin":6.4,"distanceM":379},
  {"kind":"transit","mode":"SUBWAY","line":"5호선","from":{"name":"목동","lat":37.526097,"lng":126.864538},"to":{"name":"여의나루","lat":37.527124,"lng":126.932901},"durationMin":14,"stops":7,"departAt":"2026-09-16T00:37:00Z","arriveAt":"2026-09-16T00:51:00Z"},
  {"kind":"walk","durationMin":1.6,"distanceM":91},
  {"kind":"transit","mode":"BUS","line":"10","from":{"name":"여의나루역","lat":37.52705,"lng":126.93245},"to":{"name":"국회의사당역.국민은행","lat":37.52814,"lng":126.91786},"durationMin":4.7,"stops":null,"departAt":null,"arriveAt":null},
  {"kind":"walk","durationMin":2.3,"distanceM":138}]}]}
```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/routePlan/transitProvider.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { departAtIso, itineraryToRoute, transitRouteProvider } from './transitProvider';
import type { RouteProvider, RouteResult } from './types';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/transit-sinjeong.json', import.meta.url), 'utf8'));
const O = { latitude: 37.5246, longitude: 126.8607 };
const D = { latitude: 37.5295, longitude: 126.9187 };
const now = () => new Date(2026, 8, 16, 9, 0, 0); // 2026-09-16 09:00 로컬

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown } | Promise<never>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const estimateStub = (): RouteProvider & { calls: number } => {
  const s = { calls: 0, async route(points: { latitude: number; longitude: number }[]): Promise<RouteResult> {
    s.calls++;
    return { durationMin: 99, distanceKm: 9, polyline: points, sections: points.slice(1).map(() => ({ durationMin: 1, distanceKm: 1 })), source: 'estimate' };
  } };
  return s;
};
const mk = (fn: typeof fetch, extra: Partial<Parameters<typeof transitRouteProvider>[0]> = {}) =>
  transitRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'dev1', fetchFn: fn, now, estimate: estimateStub(), ...extra });

test('departAtIso — 지금이면 undefined, 2분 이상 뒤면 그 시각의 ISO(UTC)', () => {
  assert.equal(departAtIso(9 * 60, now()), undefined);
  assert.equal(departAtIso(9 * 60 + 1, now()), undefined);
  const iso = departAtIso(9 * 60 + 30, now());
  assert.ok(iso);
  assert.equal(new Date(iso!).getTime(), new Date(2026, 8, 16, 9, 30, 0).getTime());
});

test('itineraryToRoute — 시간·거리·정류장 폴리라인·source', () => {
  const r = itineraryToRoute(fixture.itineraries[0], O, D, fixture.itineraries);
  assert.equal(r.durationMin, 23.6);
  assert.equal(r.distanceKm, 7.218);
  assert.equal(r.source, 'provider');
  assert.deepEqual(r.sections, [{ durationMin: 23.6, distanceKm: 7.218 }]);
  // 출발지 → 목동 → 여의도 → 국회의사당 → 목적지. 여의도는 하차·승차가 같은 점이라 한 번만
  assert.deepEqual(r.polyline.map(p => [p.latitude, p.longitude]), [
    [37.5246, 126.8607], [37.526097, 126.864538], [37.521624, 126.924221], [37.528143, 126.917856], [37.5295, 126.9187],
  ]);
  assert.equal(r.transit?.length, 2);
});

test('2점 — /transit 을 부르고 1위 경로를 RouteResult 로', async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: fixture }));
  const p = mk(fn);
  const r = await p.route([O, D], 9 * 60 + 30, 'transit');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.test/transit');
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.origin, { lat: 37.5246, lng: 126.8607 });
  assert.deepEqual(body.destination, { lat: 37.5295, lng: 126.9187 });
  assert.ok(typeof body.departAt === 'string');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-app-token'], 'T');
  assert.equal(r.durationMin, 23.6);
  assert.equal(r.source, 'provider');
  assert.equal(r.polyline[1].latitude, 37.526097);
});

test('3점 이상 — 서버를 부르지 않고 추정 공급자로 위임한다', async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: fixture }));
  const est = estimateStub();
  const p = mk(fn, { estimate: est });
  const r = await p.route([O, { latitude: 37.52, longitude: 126.9 }, D], 9 * 60, 'transit');
  assert.equal(calls.length, 0);
  assert.equal(est.calls, 1);
  assert.equal(r.source, 'estimate');
});

test('서버 실패·모양 불량·타임아웃은 추정으로 폴백하고 onFallback 을 부른다', async () => {
  const errs: unknown[] = [];
  const est = estimateStub();
  const bad = mk(fakeFetch(() => ({ status: 502, body: { error: 'upstream' } })).fn, { estimate: est, onFallback: e => errs.push(e) });
  const r1 = await bad.route([O, D], 9 * 60, 'transit');
  assert.equal(r1.source, 'estimate');
  const shape = mk(fakeFetch(() => ({ status: 200, body: { provider: 'google', itineraries: [] } })).fn, { estimate: est, onFallback: e => errs.push(e) });
  const r2 = await shape.route([O, D], 9 * 60, 'transit');
  assert.equal(r2.source, 'estimate');
  const hang = mk(fakeFetch(() => new Promise<never>(() => {})).fn, { estimate: est, onFallback: e => errs.push(e), timeoutMs: 20 });
  const r3 = await hang.route([O, D], 9 * 60, 'transit');
  assert.equal(r3.source, 'estimate');
  assert.equal(errs.length, 3);
  assert.equal(est.calls, 3);
});

test('대중교통 외 모드는 거절', async () => {
  const p = mk(fakeFetch(() => ({ status: 200, body: fixture })).fn);
  await assert.rejects(() => p.route([O, D], 540, 'car'), /transit/);
});
```

- [ ] **Step 2: 실패 확인** — `npx tsx --test src/lib/routePlan/transitProvider.test.ts` → 모듈 없음 FAIL.

- [ ] **Step 3: 구현** — `src/lib/routePlan/transitProvider.ts`:

```ts
/**
 * Workers 프록시(/transit)를 부르는 대중교통 RouteProvider — 5단계.
 *
 * - 2점(직행)만 서버. 1위 itinerary 를 RouteResult 로 바꾼다. 폴리라인은 출발지·정류장·목적지 —
 *   직선이 아니라 실제 탄 경로라서 회랑 검색이 역 주변을 본다(6단계 앵커의 재료).
 * - 3점 이상(경유 조합)은 아직 추정 공급자(목)로 위임한다. 플래너가 이 차이를 provider_direct_only 로 드러낸다.
 * - 서버 실패는 throw 하지 않고 추정으로 폴백한다. 직행 실패로 계획 전체가 죽는 것보다
 *   "추정"이라고 정직하게 말하고 계획을 세우는 게 낫다. 폴백은 onFallback 으로 로그에 남긴다.
 */
import type { ServerProviderOptions } from './serverProvider';
import type { LatLng, Mode, RouteProvider, RouteResult, TransitItinerary } from './types';

export type TransitProviderOptions = ServerProviderOptions & {
  estimate: RouteProvider;
  onFallback?: (err: unknown) => void;
};

/** 하루 분 → ISO(UTC). 지금보다 2분 이상 뒤일 때만 — 서버 스키마가 과거 시각을 거절한다 */
export function departAtIso(departAtMin: number, now: Date): string | undefined {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (departAtMin - nowMin < 2) return undefined;
  const d = new Date(now);
  d.setHours(Math.floor(departAtMin / 60), departAtMin % 60, 0, 0);
  return d.toISOString();
}

type TransitResponse = { provider?: string; source?: string; itineraries?: TransitItinerary[] };

function isItinerary(x: unknown): x is TransitItinerary {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.durationMin === 'number' && typeof r.distanceM === 'number' && Array.isArray(r.legs);
}

/** 1위 itinerary → RouteResult. 폴리라인은 출발지·정류장(연속 중복 제거)·목적지 */
export function itineraryToRoute(it: TransitItinerary, origin: LatLng, destination: LatLng, all: TransitItinerary[]): RouteResult {
  const pts: LatLng[] = [origin];
  const push = (p: LatLng) => {
    const last = pts[pts.length - 1];
    if (last.latitude !== p.latitude || last.longitude !== p.longitude) pts.push(p);
  };
  for (const l of it.legs) {
    if (l.kind !== 'transit') continue;
    push({ latitude: l.from.lat, longitude: l.from.lng });
    push({ latitude: l.to.lat, longitude: l.to.lng });
  }
  push(destination);
  const distanceKm = it.distanceM / 1000;
  return { durationMin: it.durationMin, distanceKm, polyline: pts, sections: [{ durationMin: it.durationMin, distanceKm }], source: 'provider', transit: all };
}

export function transitRouteProvider(opts: TransitProviderOptions): RouteProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const now = opts.now ?? (() => new Date());
  return {
    async route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult> {
      if (mode !== 'transit') throw new Error(`transit route: ${mode} 미지원`);
      if (points.length !== 2) return opts.estimate.route(points, departAtMin, mode);
      const [origin, destination] = points;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${opts.baseUrl}/transit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-token': opts.appToken, 'x-device-id': opts.deviceId },
          body: JSON.stringify({
            origin: { lat: origin.latitude, lng: origin.longitude },
            destination: { lat: destination.latitude, lng: destination.longitude },
            departAt: departAtIso(departAtMin, now()),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`transit ${res.status}`);
        const data = (await res.json()) as TransitResponse;
        const list = Array.isArray(data.itineraries) ? data.itineraries.filter(isItinerary) : [];
        if (list.length === 0) throw new Error('transit: itineraries 없음');
        return itineraryToRoute(list[0], origin, destination, list);
      } catch (e) {
        opts.onFallback?.(e);
        return opts.estimate.route(points, departAtMin, mode);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
```

`fetchFn`이 `AbortController` 신호를 무시하는 테스트 스텁(`hang`)에서도 타임아웃이 동작해야 하므로, `fetchFn(...)`을 `Promise.race([fetchFn(...), new Promise<never>((_, rej) => { ctrl.signal.addEventListener('abort', () => rej(new Error('transit timeout'))); })])`로 감싼다.

- [ ] **Step 4: 통과 확인** — `npx tsx --test src/lib/routePlan/transitProvider.test.ts && npm test && npx tsc --noEmit`.

- [ ] **Step 5: 커밋**
```bash
git add src/lib/routePlan/transitProvider.ts src/lib/routePlan/transitProvider.test.ts src/lib/routePlan/fixtures/transit-sinjeong.json
git commit -m "feat(routePlan): transitRouteProvider — 대중교통 직행을 /transit 으로 실측, 정류장 폴리라인, 추정 폴백

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 배선 — hybridProvider 에 transit 분기, 로그 ep

**Files:**
- Modify: `src/state/planFlowProvider.tsx:43-56`(timedRoute), `:85-101`(hybridProvider), `:103-117`(pickProvider)

- [ ] **Step 1: 구현**

`timedRoute`: 로그의 `ep`를 모드로 가른다 — `const ep = mode === 'transit' ? '/transit' : '/route';` 두 `logTrack` 호출의 `ep: '/route'`를 `ep`로.

`hybridProvider(server, transit, mock)`:
```ts
/**
 * 모드별 공급자. 자동차는 카카오(/route), 대중교통은 직행만 Google(/transit)이고 경유 조합은
 * transitProvider 안에서 목으로 위임된다. 도보는 아직 목. 출처는 결과의 source 가 말한다.
 */
function hybridProvider(server: RouteProvider, transit: RouteProvider, mock: RouteProvider): RouteProvider {
  return {
    route: (points, departAtMin, mode) =>
      (mode === 'car' ? server : mode === 'transit' ? transit : mock).route(points, departAtMin, mode),
  };
}
```
`pickProvider`: 서버가 있으면
```ts
const mock = mockRouteProvider();
const transit = transitRouteProvider({
  baseUrl, appToken, deviceId, estimate: mock,
  // 폴백은 화면엔 '추정' 배너로만 보인다 — 왜 폴백했는지는 로그에만 남긴다
  onFallback: e => logTrack({ k: 'net', ep: '/transit', ms: 0, ok: false, d: { points: 2, mode: 'transit', err: String(e).slice(0, 120) } }),
});
return { provider: hybridProvider(serverRouteProvider({ baseUrl, appToken, deviceId }), transit, mock), ... };
```
import 추가: `import { transitRouteProvider } from '../lib/routePlan/transitProvider';`. 파일 머리 주석의 "서버는 자동차만 받는다" 문단을 "자동차는 /route, 대중교통 직행은 /transit, 나머지는 추정"으로 고친다.

- [ ] **Step 2: 확인** — `npx tsc --noEmit && npm test`. 화면 코드 변경 없음(`git diff --stat`에 `src/screens` 없음).

- [ ] **Step 3: 커밋**
```bash
git add src/state/planFlowProvider.tsx
git commit -m "feat: 대중교통 직행을 /transit 으로 배선 — 경유 조합은 아직 추정, 폴백은 로그로

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 시뮬레이터 확인 (컨트롤러)

Debug 빌드(Metro HMR). 같은 OD(내 위치=여의도 → 회사=신정동), 올리브영 1곳, 마감 있음.

| # | 케이스 | 기대(사실 확인) |
|---|---|---|
| 1 | 대중교통 입력 | 안내 "대중교통 직행은 시간표 기준 · 경유지 추가시간은 아직 추정이에요" |
| 2 | 대중교통 추천 | 헤더 "직행 N분"이 같은 시각 운영 `/transit` curl 의 1위 `durationMin`과 ±2분. "약 HH:MM 도착", 배너 "직행은 시간표 조회 · 경유 추가시간은 추정", 여유/늦어요 없음 |
| 3 | 트랙 로그 | `"ep":"/transit"` ok:true 1건(직행), 경유 조합은 서버 호출 없음 |
| 4 | 대중교통 진행중 | "약 N분", 배너 동일, 여유/초과 없음 |
| 5 | 자동차 | 2단계와 동일(약 없음·여유 표시·배너 없음) — 회귀 없음 |
| 6 | 서버 폴백 | `.env` 의 SERVER_URL 을 잠깐 틀리게 하지 않고, 기기 비행기모드 대신 **서버 `/transit`이 401 이 되는 토큰**으로는 재현이 어렵다 → 단위 테스트(폴백 3케이스)로 갈음하고 여기서는 확인하지 않는다. 대신 로그에 폴백이 없는지만 본다 |

## 완료 기준 (5단계 게이트)

1. `npm test` 전부 PASS, `npx tsc --noEmit` 0. 새 테스트: 문구 3 + 플래너 1 + 공급자 6.
2. Task 5 표 1~5 사실 확인(스크린샷 + 트랙 로그 줄).
3. `src/screens` 변경 0.
