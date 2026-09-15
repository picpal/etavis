# 서버 `/transit` 프록시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workers 서버에 `/transit` 엔드포인트를 추가한다. 앱이 출발·목적지·출발시각을 보내면 Google Routes(TRANSIT)를 불러 공급자 무관 형식 `TransitItinerary[]`로 돌려준다. 키는 서버에만, 과금 방어선·캐시는 기존 `/route`와 같은 구조. 앱은 아직 연결하지 않는다(5단계).

**Architecture:** `/route`와 같은 4층: 스키마(요청 검증) → 가드(분당·일일 상한, 캐시) → 공급자 어댑터(요청 조립·응답 정규화, 순수 함수) → 핸들러. 공급자는 env `TRANSIT_PROVIDER`로 고르고(기본 `google`), 어댑터 인터페이스 하나를 구현한다. 파일은 기존 관례대로 `server/src/` 평면에 둔다 — 루트 `npm test`의 글로브가 `server/src/*.test.ts`라 하위 폴더 테스트는 돌지 않는다.

**Tech Stack:** Cloudflare Workers(TypeScript), node:test via `tsx`(루트 `npm test`), `npx tsc --noEmit -p server`(서버 타입). 실 공급자 응답 픽스처 `server/fixtures/google-transit-sinjeong.json`(2026-09-15 스파이크에서 캡처, 경로 3개).

**Spec:** `docs/대중교통-경로-단계계획.md` 4단계 + `docs/transit-spike.md`(4단계 반영사항).

## Global Constraints

- 테스트: 루트에서 `npm test`. 서버 타입: `cd server && npx tsc --noEmit`. 둘 다 0.
- 커밋 메시지 한국어, `feat(server):`/`fix(server):` 접두, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 파일 이름으로 스테이징, `git add -A` 금지. `server/fixtures/`는 커밋한다.
- **키는 코드·문서에 절대 넣지 않는다.** 어댑터는 `env.GOOGLE_ROUTES_KEY ?? env.GOOGLE_PLACES_KEY`를 쓴다.
- 앱 코드(`src/`)는 손대지 않는다. 앱 연결은 5단계.
- Google 무료분은 월 1만 회 → 일일 상한 `PER_DAY['/transit'] = 300`. 캐시 TTL `TRANSIT_TTL_S = 600`(10분. 배차가 시각에 묶이므로 짧게. TMAP 24시간 저장 금지 약관도 만족).
- 정규화 규칙(스파이크 발견): 연속 WALK step은 하나로 합친다. 같은 정류장 열(transit leg 마다 `line|from|to`)을 가진 경로는 **가장 빠른 것 하나만** 남긴다. 소요시간 오름차순, `alternatives`(1~3, 기본 3)개로 자른다.
- 응답 형식은 아래 `TransitItinerary`. 앱 `RouteResult`와 다르다 — 정류장 좌표가 필요해서다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `server/src/transitTypes.ts` | 공급자 무관 결과 타입 + 어댑터 인터페이스 |
| `server/src/transitSchema.ts` (+test) | 요청 검증 |
| `server/src/transitGoogle.ts` (+test) | Google Routes 요청 조립·응답 정규화(순수) |
| `server/src/transit.ts` (+test) | 핸들러: 상한 → 캐시 → 공급자 → 검증 → 캐시 |
| `server/src/guard.ts` | `/transit` 상한 상수, `TRANSIT_TTL_S`, `transitCacheKey` |
| `server/src/index.ts` | 라우팅·Env 필드 |
| `server/wrangler.toml` | `TRANSIT_PROVIDER` var, 시크릿 주석 |
| `server/fixtures/google-transit-sinjeong.json` | 실 응답 픽스처(이미 있음) |

---

### Task 1: 타입 + 요청 스키마

**Files:**
- Create: `server/src/transitTypes.ts`, `server/src/transitSchema.ts`
- Test: `server/src/transitSchema.test.ts`

**Interfaces (Produces):**
```ts
// transitTypes.ts
export type LatLng = { lat: number; lng: number };
export type TransitStop = { name: string; lat: number; lng: number };
export type TransitMode = 'SUBWAY' | 'BUS' | 'TRAIN' | 'OTHER';
export type TransitLeg =
  | { kind: 'walk'; durationMin: number; distanceM: number }
  | { kind: 'transit'; mode: TransitMode; line: string; from: TransitStop; to: TransitStop; durationMin: number; stops: number | null; departAt: string | null; arriveAt: string | null };
export type TransitItinerary = { durationMin: number; distanceM: number; legs: TransitLeg[] };
export type TransitProviderId = 'google' | 'tmap' | 'kakao';
export type TransitResponse = { provider: TransitProviderId; source: 'provider'; itineraries: TransitItinerary[] };
export type TransitRequest = { origin: LatLng; destination: LatLng; departAt?: string; alternatives: number; subwayOnly: boolean };
export type TransitNormalizeResult = { ok: true; itineraries: TransitItinerary[] } | { ok: false; code: 'shape' | 'none'; msg: string };
export interface TransitAdapter { id: TransitProviderId; fetchRaw(req: TransitRequest, env: TransitEnv, f: typeof fetch): Promise<Response>; normalize(raw: unknown, req: TransitRequest): TransitNormalizeResult; }
export type TransitEnv = { GOOGLE_ROUTES_KEY?: string; GOOGLE_PLACES_KEY?: string; TMAP_APP_KEY?: string };
// transitSchema.ts
export function parseTransitRequest(raw: unknown, now: Date): TransitRequest | null;
```

- [ ] **Step 1: 실패하는 테스트**

`server/src/transitSchema.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransitRequest } from './transitSchema';

const now = new Date('2026-09-15T03:00:00Z'); // KST 12:00
const o = { lat: 37.5246, lng: 126.8607 };
const d = { lat: 37.5295, lng: 126.9187 };

test('정상 — 기본값 alternatives 3, subwayOnly false, departAt 없음', () => {
  assert.deepEqual(parseTransitRequest({ origin: o, destination: d }, now), { origin: o, destination: d, departAt: undefined, alternatives: 3, subwayOnly: false });
});

test('departAt — ISO 8601, 지금-5분 ~ 7일 안만', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-15T04:00:00Z' }, now)?.departAt, '2026-09-15T04:00:00.000Z');
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-15T02:00:00Z' }, now), null); // 1시간 전
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-30T00:00:00Z' }, now), null); // 15일 뒤
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '내일' }, now), null);
});

test('alternatives 1~3 정수만, subwayOnly 는 불리언만', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: 2 }, now)?.alternatives, 2);
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: 0 }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: 4 }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: '3' }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, subwayOnly: true }, now)?.subwayOnly, true);
  assert.equal(parseTransitRequest({ origin: o, destination: d, subwayOnly: 'yes' }, now), null);
});

test('좌표 범위 밖·문자열·누락은 거절', () => {
  assert.equal(parseTransitRequest({ origin: { lat: 91, lng: 0 }, destination: d }, now), null);
  assert.equal(parseTransitRequest({ origin: { lat: 'a', lng: 1 }, destination: d }, now), null);
  assert.equal(parseTransitRequest({ origin: o }, now), null);
  assert.equal(parseTransitRequest(null, now), null);
});

test('출발·도착이 같은 점이면 거절 — 공급자에 돈 쓸 일이 아니다', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: o }, now), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test server/src/transitSchema.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`server/src/transitTypes.ts`:

```ts
/**
 * /transit 의 공급자 무관 형식. 앱은 이것만 본다 — Google·TMAP·카카오 형식을 모른다.
 * RouteResult(자동차)와 다른 이유: 앵커 모델(6단계)이 승차·환승·하차 정류장 좌표를 쓴다.
 */
export type LatLng = { lat: number; lng: number };
export type TransitStop = { name: string; lat: number; lng: number };
export type TransitMode = 'SUBWAY' | 'BUS' | 'TRAIN' | 'OTHER';
export type TransitLeg =
  | { kind: 'walk'; durationMin: number; distanceM: number }
  | {
      kind: 'transit'; mode: TransitMode; line: string;
      from: TransitStop; to: TransitStop;
      durationMin: number; stops: number | null;
      /** ISO 8601. 공급자가 시간표를 알면 온다 — 재승차 대기 계산(7단계)의 재료 */
      departAt: string | null; arriveAt: string | null;
    };
export type TransitItinerary = { durationMin: number; distanceM: number; legs: TransitLeg[] };
export type TransitProviderId = 'google' | 'tmap' | 'kakao';
/** source 는 항상 provider — 서버는 추정을 만들지 않는다. 앱의 timingSource 가 이걸 받는다 */
export type TransitResponse = { provider: TransitProviderId; source: 'provider'; itineraries: TransitItinerary[] };
export type TransitRequest = {
  origin: LatLng; destination: LatLng;
  /** ISO 8601(UTC). 없으면 지금 */
  departAt?: string;
  /** 돌려줄 경로 수 1~3 */
  alternatives: number;
  /** 지하철·기차만(버스 제외). 스파이크의 '지하철우선' */
  subwayOnly: boolean;
};
export type TransitNormalizeResult =
  | { ok: true; itineraries: TransitItinerary[] }
  | { ok: false; code: 'shape' | 'none'; msg: string };
export type TransitEnv = { GOOGLE_ROUTES_KEY?: string; GOOGLE_PLACES_KEY?: string; TMAP_APP_KEY?: string };
/** 공급자 하나 = 이 둘. 핸들러는 어댑터를 모른다 */
export interface TransitAdapter {
  id: TransitProviderId;
  fetchRaw(req: TransitRequest, env: TransitEnv, f: typeof fetch): Promise<Response>;
  normalize(raw: unknown, req: TransitRequest): TransitNormalizeResult;
}
```

`server/src/transitSchema.ts`:

```ts
/**
 * /transit 요청 검증. 앱이 보내는 값도 믿지 않는다 — 좌표 범위·시각 창·개수를 여기서 자른다.
 */
import type { LatLng, TransitRequest } from './transitTypes';

const PAST_GRACE_MS = 5 * 60 * 1000;
const FUTURE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function parsePoint(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lat = r.lat;
  const lng = r.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function parseTransitRequest(raw: unknown, now: Date): TransitRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const origin = parsePoint(r.origin);
  const destination = parsePoint(r.destination);
  if (!origin || !destination) return null;
  if (origin.lat === destination.lat && origin.lng === destination.lng) return null;

  let departAt: string | undefined;
  if (r.departAt !== undefined) {
    if (typeof r.departAt !== 'string') return null;
    const t = Date.parse(r.departAt);
    if (!Number.isFinite(t)) return null;
    if (t < now.getTime() - PAST_GRACE_MS || t > now.getTime() + FUTURE_MAX_MS) return null;
    departAt = new Date(t).toISOString();
  }

  let alternatives = 3;
  if (r.alternatives !== undefined) {
    if (typeof r.alternatives !== 'number' || !Number.isInteger(r.alternatives) || r.alternatives < 1 || r.alternatives > 3) return null;
    alternatives = r.alternatives;
  }

  let subwayOnly = false;
  if (r.subwayOnly !== undefined) {
    if (typeof r.subwayOnly !== 'boolean') return null;
    subwayOnly = r.subwayOnly;
  }
  return { origin, destination, departAt, alternatives, subwayOnly };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test server/src/transitSchema.test.ts && (cd server && npx tsc --noEmit)`
Expected: 5/5 PASS, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add server/src/transitTypes.ts server/src/transitSchema.ts server/src/transitSchema.test.ts
git commit -m "feat(server): /transit 공급자 무관 타입 + 요청 스키마

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Google Routes 어댑터 — 요청 조립·응답 정규화(순수)

**Files:**
- Create: `server/src/transitGoogle.ts`
- Test: `server/src/transitGoogle.test.ts` (픽스처 `server/fixtures/google-transit-sinjeong.json` 사용)

**Interfaces:**
- Consumes: Task 1 타입.
- Produces: `export const GOOGLE_FIELD_MASK: string`, `export function googleTransitBody(req: TransitRequest): object`, `export function normalizeGoogleTransit(raw: unknown, req: TransitRequest): TransitNormalizeResult`, `export const googleAdapter: TransitAdapter`.

픽스처 사실(테스트 근거): 경로 3개. 0번 1655s(27.6분) 목동→여의도 5호선 + 여의도→국회의사당 9호선. 1번 1415s(23.6분) **같은 정류장 열**, 다른 열차. 2번 2406s(40.1분) 목동→여의나루 5호선 + 버스 `10` 여의나루역→국회의사당역.국민은행(vehicle.type `BUS`). 0번의 첫 transit 전 WALK step 5개 = 316+46+0+0+20 = 382s, 거리 315+64 = 379m(거리 없는 step은 0). 승차 정류장 좌표 37.526097,126.864538.

- [ ] **Step 1: 실패하는 테스트**

`server/src/transitGoogle.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOOGLE_FIELD_MASK, googleTransitBody, normalizeGoogleTransit } from './transitGoogle';
import type { TransitRequest } from './transitTypes';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/google-transit-sinjeong.json', import.meta.url), 'utf8'));
const req: TransitRequest = { origin: { lat: 37.5246, lng: 126.8607 }, destination: { lat: 37.5295, lng: 126.9187 }, departAt: '2026-09-16T00:30:00.000Z', alternatives: 3, subwayOnly: false };

test('요청 본문 — TRANSIT, 대안 요청, 한국어, 출발시각', () => {
  const b = googleTransitBody(req) as Record<string, unknown>;
  assert.equal(b.travelMode, 'TRANSIT');
  assert.equal(b.computeAlternativeRoutes, true);
  assert.equal(b.languageCode, 'ko');
  assert.equal(b.departureTime, '2026-09-16T00:30:00.000Z');
  assert.deepEqual(b.origin, { location: { latLng: { latitude: 37.5246, longitude: 126.8607 } } });
  assert.equal('transitPreferences' in b, false);
});

test('요청 본문 — subwayOnly 면 SUBWAY·TRAIN 만, departAt 없으면 departureTime 없음', () => {
  const b = googleTransitBody({ ...req, departAt: undefined, subwayOnly: true }) as Record<string, unknown>;
  assert.deepEqual(b.transitPreferences, { allowedTravelModes: ['SUBWAY', 'TRAIN'] });
  assert.equal('departureTime' in b, false);
});

test('필드마스크 — 정류장·시각을 받는 데 필요한 필드만', () => {
  for (const f of ['routes.duration', 'routes.distanceMeters', 'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration', 'routes.legs.steps.distanceMeters', 'routes.legs.steps.transitDetails']) {
    assert.ok(GOOGLE_FIELD_MASK.split(',').includes(f), f);
  }
});

test('정규화 — 연속 WALK 합치기, transit leg 정류장·좌표·시각', () => {
  const r = normalizeGoogleTransit(fixture, { ...req, alternatives: 3 });
  assert.ok(r.ok);
  const it = r.itineraries;
  // 중복 정류장 열(0·1번)은 빠른 1번만 → 총 2개, 빠른 순
  assert.equal(it.length, 2);
  assert.equal(it[0].durationMin, 23.6);
  assert.equal(it[1].durationMin, 40.1);
  assert.equal(it[0].distanceM, 7218);
  // 1번 경로: walk(382s→6.4분, 379m) · 5호선 · walk · 9호선 · walk
  assert.deepEqual(it[0].legs.map(l => l.kind), ['walk', 'transit', 'walk', 'transit', 'walk']);
  const w0 = it[0].legs[0];
  assert.ok(w0.kind === 'walk');
  assert.equal(w0.durationMin, 6.4);
  assert.equal(w0.distanceM, 379);
  const t0 = it[0].legs[1];
  assert.ok(t0.kind === 'transit');
  assert.equal(t0.mode, 'SUBWAY');
  assert.equal(t0.line, '5호선');
  assert.equal(t0.from.name, '목동');
  assert.equal(t0.to.name, '여의도');
  assert.equal(t0.from.lat, 37.526097);
  assert.equal(t0.from.lng, 126.864538);
  assert.equal(t0.stops, 6);
  assert.equal(t0.departAt, '2026-09-16T00:47:00Z'); // 1번 경로의 열차
  const t1 = it[0].legs[3];
  assert.ok(t1.kind === 'transit');
  assert.equal(t1.line, '9호선');
  assert.equal(t1.to.name, '국회의사당');
  // 2번 경로: 버스는 BUS
  const bus = it[1].legs.filter(l => l.kind === 'transit')[1];
  assert.ok(bus.kind === 'transit');
  assert.equal(bus.mode, 'BUS');
  assert.equal(bus.line, '10');
});

test('정규화 — alternatives 로 자른다', () => {
  const r = normalizeGoogleTransit(fixture, { ...req, alternatives: 1 });
  assert.ok(r.ok && r.itineraries.length === 1 && r.itineraries[0].durationMin === 23.6);
});

test('정규화 — routes 없음은 none, 모양이 다르면 shape', () => {
  assert.deepEqual(normalizeGoogleTransit({ routes: [] }, req), { ok: false, code: 'none', msg: 'routes 없음' });
  assert.equal(normalizeGoogleTransit(null, req).ok, false);
  assert.equal((normalizeGoogleTransit({ routes: [{ duration: '10s', legs: 'x' }] }, req) as { code: string }).code, 'shape');
});

test('정규화 — transit 정류장에 좌표가 없으면 shape (앵커에 못 쓴다)', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  delete broken.routes[1].legs[0].steps[5].transitDetails.stopDetails.departureStop.location;
  const r = normalizeGoogleTransit(broken, req);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test server/src/transitGoogle.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`server/src/transitGoogle.ts`:

```ts
/**
 * Google Routes API (TRANSIT) — 요청 조립과 응답 정규화. 순수 함수라 node 테스트가 돈다.
 *
 *   POST https://routes.googleapis.com/directions/v2:computeRoutes
 *   헤더 X-Goog-Api-Key, X-Goog-FieldMask. Essentials 월 10,000회 무료(2026-09 요금표).
 *
 * 스파이크(docs/transit-spike.md)에서 확인한 것: 정류장 좌표·도보 시간·배차 반영 모두 온다.
 * 같은 정류장 열의 경로가 열차만 다르게 여러 개 오므로 정류장 열로 중복을 지운다.
 */
import type { TransitAdapter, TransitEnv, TransitItinerary, TransitLeg, TransitMode, TransitNormalizeResult, TransitRequest, TransitStop } from './transitTypes';

export const GOOGLE_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const GOOGLE_FIELD_MASK = [
  'routes.duration', 'routes.distanceMeters',
  'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration', 'routes.legs.steps.distanceMeters',
  'routes.legs.steps.transitDetails',
].join(',');

export function googleTransitBody(req: TransitRequest): object {
  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: req.origin.lat, longitude: req.origin.lng } } },
    destination: { location: { latLng: { latitude: req.destination.lat, longitude: req.destination.lng } } },
    travelMode: 'TRANSIT',
    computeAlternativeRoutes: true,
    languageCode: 'ko',
  };
  if (req.departAt) body.departureTime = req.departAt;
  if (req.subwayOnly) body.transitPreferences = { allowedTravelModes: ['SUBWAY', 'TRAIN'] };
  return body;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** "384s" → 384. 모양이 다르면 null */
function seconds(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?s$/.test(v)) return null;
  return Number(v.slice(0, -1));
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function modeOf(type: unknown): TransitMode {
  if (type === 'SUBWAY') return 'SUBWAY';
  if (type === 'BUS' || type === 'INTERCITY_BUS' || type === 'TROLLEYBUS') return 'BUS';
  if (type === 'HEAVY_RAIL' || type === 'COMMUTER_TRAIN' || type === 'HIGH_SPEED_TRAIN' || type === 'RAIL' || type === 'LONG_DISTANCE_TRAIN' || type === 'METRO_RAIL' || type === 'MONORAIL' || type === 'TRAM') return 'TRAIN';
  return 'OTHER';
}

function stopOf(raw: unknown): TransitStop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ll = ((r.location as Record<string, unknown> | undefined)?.latLng ?? null) as Record<string, unknown> | null;
  const lat = num(ll?.latitude);
  const lng = num(ll?.longitude);
  if (lat == null || lng == null) return null;
  return { name: str(r.name) ?? '', lat, lng };
}

/** step 배열 → leg 배열. 하나라도 모양이 다르면 null */
function legsOf(steps: unknown): TransitLeg[] | null {
  if (!Array.isArray(steps)) return null;
  const legs: TransitLeg[] = [];
  for (const s of steps as Record<string, unknown>[]) {
    const sec = seconds(s.staticDuration);
    if (sec == null) return null;
    const min = sec / 60;
    if (s.travelMode === 'TRANSIT') {
      const td = (s.transitDetails ?? null) as Record<string, unknown> | null;
      const sd = (td?.stopDetails ?? null) as Record<string, unknown> | null;
      const line = (td?.transitLine ?? null) as Record<string, unknown> | null;
      const from = stopOf(sd?.departureStop);
      const to = stopOf(sd?.arrivalStop);
      if (!td || !sd || !from || !to) return null;
      const vehicle = (line?.vehicle ?? null) as Record<string, unknown> | null;
      legs.push({
        kind: 'transit', mode: modeOf(vehicle?.type),
        line: str(line?.nameShort) ?? str(line?.name) ?? '',
        from, to, durationMin: round1(min), stops: num(td.stopCount),
        departAt: str(sd.departureTime), arriveAt: str(sd.arrivalTime),
      });
    } else {
      const dist = num(s.distanceMeters) ?? 0;
      const last = legs[legs.length - 1];
      if (last && last.kind === 'walk') { last.durationMin = round1(last.durationMin + min); last.distanceM += dist; }
      else legs.push({ kind: 'walk', durationMin: round1(min), distanceM: dist });
    }
  }
  // 도보 분은 step 마다 반올림하지 않고 합친 뒤 한 번만 — 위에서 round1 을 누적하면 오차가 쌓인다
  return legs;
}

/** 정류장 열 — 같은 열이면 다른 열차일 뿐이다 */
const sequenceKey = (it: TransitItinerary) =>
  it.legs.filter(l => l.kind === 'transit').map(l => (l.kind === 'transit' ? `${l.line}|${l.from.name}|${l.to.name}` : '')).join('>');

export function normalizeGoogleTransit(raw: unknown, req: TransitRequest): TransitNormalizeResult {
  const routes = (raw as { routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes)) return { ok: false, code: 'shape', msg: 'routes 배열 아님' };
  if (routes.length === 0) return { ok: false, code: 'none', msg: 'routes 없음' };
  const out: TransitItinerary[] = [];
  for (const r of routes as Record<string, unknown>[]) {
    const sec = seconds(r.duration);
    const legsRaw = (r.legs as Record<string, unknown>[] | undefined)?.[0]?.steps;
    const legs = legsOf(legsRaw);
    if (sec == null || !legs) return { ok: false, code: 'shape', msg: 'route 모양' };
    out.push({ durationMin: round1(sec / 60), distanceM: num(r.distanceMeters) ?? 0, legs });
  }
  out.sort((a, b) => a.durationMin - b.durationMin);
  const seen = new Set<string>();
  const dedup = out.filter(it => { const k = sequenceKey(it); if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: true, itineraries: dedup.slice(0, req.alternatives) };
}

export const googleAdapter: TransitAdapter = {
  id: 'google',
  fetchRaw(req, env: TransitEnv, f) {
    const key = env.GOOGLE_ROUTES_KEY ?? env.GOOGLE_PLACES_KEY ?? '';
    return f(GOOGLE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
      body: JSON.stringify(googleTransitBody(req)),
    });
  },
  normalize: normalizeGoogleTransit,
};
```

**도보 반올림 주의**: 위 `legsOf`는 walk 를 합칠 때 `round1(last.durationMin + min)`로 누적 반올림한다. 픽스처의 382s는 316·46·0·0·20 순으로 5.3→6.0→6.0→6.0→6.4 로 끝나 6.4가 되지만, 다른 분할에서는 0.1 오차가 날 수 있다. **초 단위로 누적하고 마지막에 한 번 반올림**하도록 구현할 것: walk leg 를 만들 때 내부적으로 `sec` 합을 들고 있다가(로컬 변수 `walkSec`), transit 을 만나거나 끝날 때 `durationMin = round1(walkSec / 60)`으로 확정한다. 테스트 `w0.durationMin === 6.4`는 382/60 = 6.37 → 6.4 로 어느 쪽이든 같지만, 구현은 초 누적을 택한다.

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test server/src/transitGoogle.test.ts && (cd server && npx tsc --noEmit)`
Expected: 7/7 PASS, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add server/src/transitGoogle.ts server/src/transitGoogle.test.ts server/fixtures/google-transit-sinjeong.json
git commit -m "feat(server): Google Routes TRANSIT 어댑터 — 요청 조립·정규화·정류장 열 중복 제거

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 핸들러 + 가드 + 라우팅

**Files:**
- Create: `server/src/transit.ts`
- Modify: `server/src/guard.ts` (`PER_MIN`, `PER_MIN_IP`, `PER_DAY`에 `/transit` 추가, `TRANSIT_TTL_S`, `transitCacheKey`), `server/src/index.ts` (Env, known, 분기), `server/wrangler.toml`
- Test: `server/src/transit.test.ts`, `server/src/guard.test.ts`(캐시 키 1건 추가)

**Interfaces:**
- Consumes: Task 1·2.
- Produces: `export async function handleTransit(body: unknown, env: TransitHandlerEnv, deps: { fetch: typeof fetch; now: Date }): Promise<Response>`; `export type TransitHandlerEnv = TransitEnv & { CACHE: KVLike; RATE: KVLike; TRANSIT_PROVIDER?: string }`; guard: `TRANSIT_TTL_S = 600`, `transitCacheKey(req: TransitRequest, provider: string): string`.

- [ ] **Step 1: 실패하는 테스트**

`server/src/guard.test.ts` 끝에:

```ts
test('transitCacheKey — 좌표 4자리, 출발 10분 버킷, 옵션·공급자 포함', async () => {
  const { transitCacheKey } = await import('./guard');
  const base = { origin: { lat: 37.52459, lng: 126.86069 }, destination: { lat: 37.52947, lng: 126.91869 }, alternatives: 3, subwayOnly: false };
  const k1 = transitCacheKey({ ...base, departAt: '2026-09-16T00:33:00.000Z' }, 'google');
  const k2 = transitCacheKey({ ...base, departAt: '2026-09-16T00:39:00.000Z' }, 'google');
  const k3 = transitCacheKey({ ...base, departAt: '2026-09-16T00:41:00.000Z' }, 'google');
  assert.equal(k1, 'transit:google:37.5246,126.8607;37.5295,126.9187:2026-09-16T00:3:3:n');
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.notEqual(transitCacheKey(base, 'google'), k1); // now 버킷
  assert.notEqual(transitCacheKey({ ...base, subwayOnly: true }, 'google'), transitCacheKey(base, 'google'));
  assert.notEqual(transitCacheKey(base, 'tmap'), transitCacheKey(base, 'google'));
});
```

`server/src/transit.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleTransit } from './transit';
import { PER_DAY } from './guard';

const fixture = readFileSync(new URL('../fixtures/google-transit-sinjeong.json', import.meta.url), 'utf8');
const now = new Date('2026-09-15T03:00:00Z');
const body = { origin: { lat: 37.5246, lng: 126.8607 }, destination: { lat: 37.5295, lng: 126.9187 }, departAt: '2026-09-15T04:00:00Z' };

function kv() {
  const m = new Map<string, string>();
  return { m, async get(k: string) { return m.get(k) ?? null; }, async put(k: string, v: string) { m.set(k, v); } };
}
function fakeFetch(status: number, text: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const env = () => ({ CACHE: kv(), RATE: kv(), GOOGLE_ROUTES_KEY: 'K' });

test('정상 — 정규화 응답, provider·source 표시, 키는 헤더로만', async () => {
  const e = env();
  const { f, calls } = fakeFetch(200, fixture);
  const res = await handleTransit(body, e, { fetch: f, now });
  assert.equal(res.status, 200);
  const j = await res.json() as { provider: string; source: string; itineraries: { durationMin: number }[] };
  assert.equal(j.provider, 'google');
  assert.equal(j.source, 'provider');
  assert.equal(j.itineraries.length, 2);
  assert.equal(j.itineraries[0].durationMin, 23.6);
  assert.equal(calls.length, 1);
  assert.equal((calls[0].init.headers as Record<string, string>)['X-Goog-Api-Key'], 'K');
  assert.ok(!calls[0].url.includes('K'));
});

test('캐시 — 같은 요청 두 번째는 공급자를 안 부른다', async () => {
  const e = env();
  const { f, calls } = fakeFetch(200, fixture);
  await handleTransit(body, e, { fetch: f, now });
  const res = await handleTransit(body, e, { fetch: f, now });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test('실패는 캐시하지 않는다 — 502 뒤 재시도는 다시 부른다', async () => {
  const e = env();
  const bad = fakeFetch(500, '{"error":{"message":"boom"}}');
  const r1 = await handleTransit(body, e, { fetch: bad.f, now });
  assert.equal(r1.status, 502);
  assert.equal(((await r1.json()) as { detail?: string }).detail, 'boom');
  const good = fakeFetch(200, fixture);
  const r2 = await handleTransit(body, e, { fetch: good.f, now });
  assert.equal(r2.status, 200);
  assert.equal(good.calls.length, 1);
});

test('경로 없음은 422 코드 none, 모양 이상은 422 shape', async () => {
  const e = env();
  const r1 = await handleTransit(body, e, { fetch: fakeFetch(200, '{"routes":[]}').f, now });
  assert.equal(r1.status, 422);
  assert.equal(((await r1.json()) as { code: string }).code, 'none');
  const r2 = await handleTransit(body, e, { fetch: fakeFetch(200, '{"routes":"x"}').f, now });
  assert.equal(r2.status, 422);
});

test('잘못된 요청은 400, 공급자를 안 부른다', async () => {
  const e = env();
  const { f, calls } = fakeFetch(200, fixture);
  const res = await handleTransit({ origin: { lat: 1 } }, e, { fetch: f, now });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('일일 상한 — PER_DAY["/transit"] 을 넘으면 429, 캐시 히트도 카운트한다', async () => {
  const e = env();
  const { f } = fakeFetch(200, fixture);
  const cap = PER_DAY['/transit'];
  assert.equal(cap, 300);
  for (let i = 0; i < cap; i++) assert.equal((await handleTransit(body, e, { fetch: f, now })).status, 200);
  assert.equal((await handleTransit(body, e, { fetch: f, now })).status, 429);
});

test('모르는 공급자는 501 — 조용히 google 로 떨어지지 않는다', async () => {
  const e = { ...env(), TRANSIT_PROVIDER: 'tmap' };
  const res = await handleTransit(body, e, { fetch: fakeFetch(200, fixture).f, now });
  assert.equal(res.status, 501);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test server/src/transit.test.ts server/src/guard.test.ts`
Expected: transit 테스트 전부 FAIL(모듈 없음), guard 새 테스트 FAIL(export 없음).

- [ ] **Step 3: 구현**

`server/src/guard.ts` — 상수 세 곳에 `/transit` 추가:

```ts
export const PER_MIN: Record<string, number> = { '/extract': 10, '/route': 40, '/enrich': 10, '/transit': 20 };
export const PER_MIN_IP: Record<string, number> = { '/extract': 30, '/route': 120, '/enrich': 30, '/transit': 60 };
```

`PER_DAY` 표 주석에 행 추가 `| /transit | Google Routes Essentials 월 10,000 → 일 ≈333 | 초과 $5/1,000 | 300 |` 하고 객체에 `'/transit': 300,`.

파일 끝(`corsHeaders` 앞)에:

```ts
/**
 * /transit 응답 캐시 TTL. 배차가 시각에 묶이므로 짧다(10분). TMAP 약관(24시간 이상 저장 금지)도 만족.
 * 노리는 건 한 계획 안의 재조회 — 6단계가 같은 직행을 지하철우선으로 한 번 더 묻는다.
 */
export const TRANSIT_TTL_S = 600;

/** 좌표 4자리(약 11m), 출발 시각 10분 버킷, 옵션·공급자 포함 */
export function transitCacheKey(req: TransitRequest, provider: string): string {
  const q = (n: number) => n.toFixed(4);
  const pts = `${q(req.origin.lat)},${q(req.origin.lng)};${q(req.destination.lat)},${q(req.destination.lng)}`;
  const depart = req.departAt ? req.departAt.slice(0, 15) : 'now'; // 'YYYY-MM-DDTHH:M' = 10분 버킷
  return `transit:${provider}:${pts}:${depart}:${req.alternatives}:${req.subwayOnly ? 's' : 'n'}`;
}
```

import 추가: `import type { TransitRequest } from './transitTypes';`

`server/src/transit.ts`:

```ts
/**
 * /transit — 대중교통 경로 프록시. /route 와 같은 4층: 스키마 → 상한 → 캐시 → 공급자.
 * 공급자는 env TRANSIT_PROVIDER 로 고른다(기본 google). 앱은 정규화된 형식만 본다.
 */
import { overDailyCap, TRANSIT_TTL_S, transitCacheKey, type KVLike } from './guard';
import { parseTransitRequest } from './transitSchema';
import { googleAdapter } from './transitGoogle';
import type { TransitAdapter, TransitEnv, TransitResponse } from './transitTypes';

export type TransitHandlerEnv = TransitEnv & { CACHE: KVLike; RATE: KVLike; TRANSIT_PROVIDER?: string };

const ADAPTERS: Record<string, TransitAdapter> = { google: googleAdapter };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function upstreamDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    return typeof msg === 'string' ? msg.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

export async function handleTransit(body: unknown, env: TransitHandlerEnv, deps: { fetch: typeof fetch; now: Date }): Promise<Response> {
  const req = parseTransitRequest(body, deps.now);
  if (!req) return json({ error: 'bad request' }, 400);

  const providerId = env.TRANSIT_PROVIDER ?? 'google';
  const adapter = ADAPTERS[providerId];
  // 어댑터가 없으면 google 로 떨어뜨리지 않는다 — 설정 실수가 조용히 다른 공급자 요금이 되면 안 된다
  if (!adapter) return json({ error: 'provider not implemented', provider: providerId }, 501);

  if (await overDailyCap(env.RATE, '/transit', deps.now)) return json({ error: 'daily cap' }, 429);

  const cacheKey = transitCacheKey(req, adapter.id);
  const hit = await env.CACHE.get(cacheKey);
  if (hit !== null) {
    try { return json(JSON.parse(hit)); } catch { /* 깨진 캐시는 새로 받는다 */ }
  }

  const res = await adapter.fetchRaw(req, env, deps.fetch);
  if (!res.ok) return json({ error: 'upstream', status: res.status, detail: await upstreamDetail(res) }, 502);
  let raw: unknown;
  try { raw = await res.json(); } catch { return json({ error: 'unparseable' }, 502); }

  const norm = adapter.normalize(raw, req);
  if (!norm.ok) return json({ error: 'transit', code: norm.code, msg: norm.msg }, 422);

  const out: TransitResponse = { provider: adapter.id, source: 'provider', itineraries: norm.itineraries };
  await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: TRANSIT_TTL_S });
  return json(out);
}
```

`server/src/index.ts`:
- 머리 주석 목록에 `/transit — Google Routes 대중교통(공급자 교체 가능)` 한 줄.
- `Env`에 `GOOGLE_PLACES_KEY` 아래:
  ```ts
  /** Routes API 용 키. 없으면 GOOGLE_PLACES_KEY 를 쓴다(같은 키에 Routes 를 허용해 둔 경우) */
  GOOGLE_ROUTES_KEY?: string;
  /** 대중교통 공급자. google | tmap | kakao. 없으면 google */
  TRANSIT_PROVIDER?: string;
  ```
- import: `import { handleTransit } from './transit';`
- `known` 배열에 `'/transit'` 추가. `/route` 분기 다음 줄에:
  ```ts
  if (url.pathname === '/transit') return handleTransit(gated.body, env, { fetch, now: new Date() });
  ```

`server/wrangler.toml` — `[vars]`에 `TRANSIT_PROVIDER = "google"`, 시크릿 주석에 `#   npx wrangler secret put GOOGLE_ROUTES_KEY   # 없으면 GOOGLE_PLACES_KEY 사용 (같은 키에 Routes API 허용 필요)`.

- [ ] **Step 4: 통과 확인**

Run: `npm test && (cd server && npx tsc --noEmit)`
Expected: 전부 PASS(기존 + 새 테스트 8 + guard 1), tsc 0. `guard.test.ts`의 기존 `PER_DAY` 관련 단언이 있으면 `/transit` 추가로 깨지지 않는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add server/src/transit.ts server/src/transit.test.ts server/src/guard.ts server/src/guard.test.ts server/src/index.ts server/wrangler.toml
git commit -m "feat(server): /transit 엔드포인트 — 상한·캐시·공급자 스위치, Google 어댑터 연결

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 배포 + 실측 (컨트롤러, 사용자 승인 뒤)

- [ ] **Step 1: 로컬 dev 서버로 실측** — `cd server && npx wrangler dev`(`.dev.vars`에 `GOOGLE_ROUTES_KEY`·`APP_TOKEN` 필요 — 파일은 gitignore) 후:

```bash
curl -s -X POST http://localhost:8787/transit -H 'content-type: application/json' -H "x-app-token: $APP_TOKEN" -H 'x-device-id: dev' \
  -d '{"origin":{"lat":37.5246,"lng":126.8607},"destination":{"lat":37.5295,"lng":126.9187}}' | head -c 600
```
기대: `provider:"google"`, `itineraries[0].legs[1].from.name === "목동"`. 두 번째 호출은 KV 캐시 히트(wrangler dev 로그에 Google 호출 없음).

- [ ] **Step 2: 배포** — `npx wrangler deploy`는 공개 서버를 바꾼다. 사용자 승인 뒤 실행. 시크릿 `GOOGLE_ROUTES_KEY`는 사용자가 `npx wrangler secret put GOOGLE_ROUTES_KEY`로 직접 넣거나, `etavia-places` 키에 Routes 가 허용돼 있으면 생략(코드가 `GOOGLE_PLACES_KEY`로 폴백).

- [ ] **Step 3: 운영 curl 1회** — `SERVER_URL/transit`에 같은 요청. 200 + 목동 확인. `/health`도 200.

## 완료 기준 (4단계 게이트)

1. `npm test` 전부 PASS, 서버 `tsc` 0. 새 테스트: 스키마 5 + 어댑터 7 + 핸들러 7 + 가드 1.
2. 로컬 또는 운영 curl 로 실패 케이스가 `목동 → 여의도 → 국회의사당`으로 오고, 두 번째 호출이 캐시 히트.
3. 키가 코드·문서·커밋에 없다(`git log -p main..HEAD | grep -cE 'AIza[0-9A-Za-z_-]{30,}'` 0건).
4. `TRANSIT_PROVIDER=tmap`이면 501(조용한 폴백 없음).
