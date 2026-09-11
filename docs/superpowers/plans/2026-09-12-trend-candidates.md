# 트렌드 후보 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업종 검색("빵집", "카페")일 때 회랑 안 후보 30곳에 블로그 최근 언급·구글 평점을 붙이고, 경로 적합도와 합쳐 룰 기반으로 상위를 추천한다.

**Architecture:** 카카오 로컬이 준 후보를 Workers `/enrich`가 네이버 블로그 검색과 구글 Places로 보강한다. 점수는 순수 함수 `trendScore.ts`가 세 축(fit·quality·buzz)의 가중합으로 내고, 축이 없으면 가중치를 재정규화한다. 한 소스가 죽어도 나머지 축으로 돌아가고, 전부 죽으면 지금과 같은 추가시간순으로 떨어진다. 플래너의 경로 목적함수는 건드리지 않는다.

**Tech Stack:** TypeScript, Expo SDK 57 / React Native, Cloudflare Workers, `tsx --test` (node:test), KV.

**Spec:** `docs/superpowers/specs/2026-09-11-trend-candidates-design.md`

## Global Constraints

- 테스트는 `npm test`(= `tsx --test 'src/**/*.test.ts' 'server/src/*.test.ts'`)로 돌린다. 타입 검사는 `npx tsc --noEmit -p .`. 둘 다 통과해야 커밋한다.
- **`src/lib/` 아래 새 모듈은 순수 함수여야 한다.** `expo-*`나 `Constants`를 import하면 node 테스트가 읽지 못한다. 기존 `corridorSearch.ts`가 검색 함수를 주입받는 것과 같은 이유다.
- 테스트 파일에서 로컬 모듈을 import할 때는 **`.ts` 확장자를 붙인다**(`from './trendScore.ts'`). 기존 테스트 전부 그렇다.
- **LLM은 '무엇을'만 뽑는다.** 점수·순위는 전부 코드가 정한다. 어떤 작업도 LLM에게 순위를 매기게 하지 않는다. (`AGENTS.md`)
- **인젝션 방어선은 스키마다.** 바깥(네이버·구글) 응답은 전부 파싱·검증을 거쳐야 앱에 닿는다.
- 화면에 나가는 건 파생 수치뿐이다. 블로그 제목·본문·링크를 UI에 재배포하지 않는다. 캐시는 24시간(블로그)·14일(구글)을 넘기지 않는다. (스펙 §2.1.1)
- 주석·커밋 메시지·UI 문구는 한국어. 기존 파일의 톤을 따른다.
- **UI를 바꾸는 작업(Task 9, 10)은 시뮬레이터에서 화면을 직접 보고 점검한다.** iPhone 16e UDID `32E7E297-E515-478B-8EB4-62E8AF4B069E`, 번들 `com.etavia.app`. 최대 케이스(후보 30개·이름 20자·reasons 3개·브랜드 슬롯)를 만들어 확인한다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

새로 만드는 것

| 파일 | 책임 |
|---|---|
| `src/lib/trendScore.ts` | 세 축 정규화 + 가중합 + reasons 문구. 순수 |
| `src/lib/trendScore.test.ts` | 위 테스트 |
| `src/lib/placeMatch.ts` | 이름 정규화 + 구글 후보 중 동일 매장 고르기. 순수 |
| `src/lib/placeMatch.test.ts` | 위 테스트 |
| `src/lib/enrich/types.ts` | `PlaceSignals`·`EnrichRequest`·`EnrichResponse` 공용 타입 |
| `src/lib/enrich/blogCount.ts` | postdate 배열 → `{count90d, latestDaysAgo, weighted}`. 순수 |
| `src/lib/enrich/blogCount.test.ts` | 위 테스트 |
| `src/lib/enrich/mockEnrich.ts` | 서버 없을 때 결정적 신호 생성 |
| `src/lib/enrich/enrichClient.ts` | 앱 → `/enrich` 호출. 타임아웃·실패 시 빈 결과 |
| `server/src/enrichSchema.ts` | `/enrich` 요청 검증 |
| `server/src/enrichSchema.test.ts` | 위 테스트 |
| `server/src/naverBlog.ts` | 네이버 HUB 블로그 검색 호출 + 응답 파싱 |
| `server/src/naverBlog.test.ts` | 위 테스트 |
| `server/src/googlePlaces.ts` | 구글 Places searchText 호출 + 응답 파싱 |
| `server/src/googlePlaces.test.ts` | 위 테스트 |
| `server/src/enrich.ts` | `/enrich` 핸들러. 캐시·예산·상위 10 선별 오케스트레이션 |
| `server/src/enrich.test.ts` | 위 테스트 |

고치는 것

| 파일 | 무엇 |
|---|---|
| `src/lib/routePlan/types.ts` | `PlaceCandidate`에 `address?`, `signals?`. `Slot`에 `stopKind` |
| `src/lib/corridorSearch.ts` | `need` 도달 후에도 30개까지 반환 |
| `src/lib/places.ts` | 카카오 `address_name`을 `PlaceCandidate.address`로 |
| `src/state/plan.tsx` | 칩에 `stopKind` |
| `src/state/usePlanRequest.ts` | `stops[].stopKind` |
| `src/state/planFlow.ts` | `PlanRequest.stops[].stopKind` |
| `src/state/runPlan.ts` | 30개 상한, `/enrich` 호출, 트렌드 1위 override |
| `src/state/planFlowProvider.tsx` | `enrich` 의존 주입 |
| `src/data/mockData.ts` | `Candidate.trend?` |
| `src/state/planFlowBridge.ts` | `trend` 채우기, note를 reasons로 |
| `src/lib/candidateRank.ts` | 정렬 탭 `추천·추가시간·주차` |
| `src/sheets/CandidateSheet.tsx` | 추천 탭·요즘 인기 배지·5개+더 보기 |
| `server/src/index.ts` | `/enrich` 라우트, `Env`에 키 3개와 `CACHE` |
| `server/wrangler.toml` | `CACHE` KV 바인딩 |

**의존 순서:** Task 1·2·3(순수 모듈) → 4·5·6(서버) → 7(수집) → 8(앱 연결) → 9·10(화면) → 11(문서).

---

### Task 1: 블로그 건수 집계 `blogCount.ts`

**Files:**
- Create: `src/lib/enrich/blogCount.ts`
- Create: `src/lib/enrich/types.ts`
- Test: `src/lib/enrich/blogCount.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type BlogSignal = { count90d: number; latestDaysAgo: number | null; weighted: number; source: 'naver' | 'kakao' }`
  - `type GoogleSignal = { rating: number; ratingCount: number; hours: { openMin: number; closeMin: number } | null; matchedName: string }`
  - `type PlaceSignals = { blog?: BlogSignal; google?: GoogleSignal; fetchedAt: string }`
  - `type EnrichPlace = { id: string; name: string; address: string; lat: number; lng: number }`
  - `type EnrichRequest = { places: EnrichPlace[] }`
  - `type EnrichResponse = { results: Record<string, PlaceSignals>; budget: { googleUsed: number; googleLeft: number } }`
  - `countBlog(postdates: readonly string[], todayYmd: string, source: 'naver' | 'kakao'): BlogSignal`

- [ ] **Step 1: 공용 타입 파일을 만든다**

`src/lib/enrich/types.ts`:

```ts
/**
 * /enrich 의 요청·응답 계약. 앱과 서버가 같이 읽는다. 런타임 코드 없음.
 * 설계: docs/superpowers/specs/2026-09-11-trend-candidates-design.md §2
 */

/** 블로그 최근 언급. weighted = 90일 안 글의 Σ exp(-age/45) */
export type BlogSignal = {
  count90d: number;
  latestDaysAgo: number | null;
  weighted: number;
  source: 'naver' | 'kakao';
};

/** 구글 Places. hours 는 오늘 요일 기준 분 단위 */
export type GoogleSignal = {
  rating: number;
  ratingCount: number;
  hours: { openMin: number; closeMin: number } | null;
  matchedName: string;
};

export type PlaceSignals = {
  blog?: BlogSignal;
  google?: GoogleSignal;
  /** ISO. 캐시 적중 여부를 개발 메뉴에서 보려고 남긴다 */
  fetchedAt: string;
};

export type EnrichPlace = { id: string; name: string; address: string; lat: number; lng: number };
export type EnrichRequest = { places: EnrichPlace[] };
export type EnrichResponse = {
  results: Record<string, PlaceSignals>;
  budget: { googleUsed: number; googleLeft: number };
};
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/lib/enrich/blogCount.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countBlog } from './blogCount.ts';

test('90일 밖 글은 세지 않는다', () => {
  const r = countBlog(['20260912', '20260101'], '20260912', 'naver');
  assert.equal(r.count90d, 1);
  assert.equal(r.latestDaysAgo, 0);
});

test('오늘 글의 가중치는 1', () => {
  const r = countBlog(['20260912'], '20260912', 'naver');
  assert.ok(Math.abs(r.weighted - 1) < 1e-9);
});

test('45일 전 글의 가중치는 1/e', () => {
  const r = countBlog(['20260729'], '20260912', 'naver');
  assert.ok(Math.abs(r.weighted - Math.exp(-1)) < 1e-3);
});

test('글이 없으면 weighted 0, latestDaysAgo null', () => {
  const r = countBlog([], '20260912', 'naver');
  assert.equal(r.weighted, 0);
  assert.equal(r.count90d, 0);
  assert.equal(r.latestDaysAgo, null);
});

test('망가진 날짜는 무시하고 나머지를 센다', () => {
  const r = countBlog(['', 'x', '20260912', '2026-09-12'], '20260912', 'naver');
  assert.equal(r.count90d, 1);
});

test('미래 날짜는 세지 않는다 — 서버 시계가 어긋나도 가중치가 1을 넘지 않게', () => {
  const r = countBlog(['20261231'], '20260912', 'naver');
  assert.equal(r.count90d, 0);
});

test('source 를 그대로 싣는다', () => {
  assert.equal(countBlog(['20260912'], '20260912', 'kakao').source, 'kakao');
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npx tsx --test src/lib/enrich/blogCount.test.ts`
Expected: FAIL — `Cannot find module './blogCount.ts'`

- [ ] **Step 4: 구현한다**

`src/lib/enrich/blogCount.ts`:

```ts
/**
 * 블로그 글 날짜 목록 → 최근성 신호. 순수 함수라 UI·네트워크 없이 시험한다.
 *
 * 전 기간 총 건수(네이버 total)는 쓰지 않는다. 오래된 맛집이 요즘 뜨는 곳을
 * 이기면 이 기능의 의미가 없다. 90일 창 안에서 최근일수록 크게 센다.
 */
import type { BlogSignal } from './types';

const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 45;
/** 네이버는 display=100, 카카오는 size=50. 어느 쪽이든 이 이상은 안 들어온다 */
const MAX_ITEMS = 100;

/** 'YYYYMMDD' → UTC 자정 ms. 형식이 아니면 null */
function ymdToMs(ymd: string): number | null {
  if (!/^\d{8}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  // Date.UTC 는 2월 30일을 3월 2일로 굴려버린다 — 되돌려 확인한다
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

const DAY_MS = 86_400_000;

export function countBlog(
  postdates: readonly string[],
  todayYmd: string,
  source: 'naver' | 'kakao',
): BlogSignal {
  const today = ymdToMs(todayYmd);
  const ages: number[] = [];
  if (today != null) {
    for (const s of postdates.slice(0, MAX_ITEMS)) {
      const ms = ymdToMs(s);
      if (ms == null) continue;
      const age = Math.round((today - ms) / DAY_MS);
      // 음수(미래)는 버린다. 기기·서버 시계가 어긋나도 가중치가 1을 넘지 않는다
      if (age < 0 || age > WINDOW_DAYS) continue;
      ages.push(age);
    }
  }
  const weighted = ages.reduce((sum, a) => sum + Math.exp(-a / HALF_LIFE_DAYS), 0);
  return {
    count90d: ages.length,
    latestDaysAgo: ages.length ? Math.min(...ages) : null,
    weighted,
    source,
  };
}

/** ISO 8601('2026-09-12T10:00:00.000+09:00') → 'YYYYMMDD'. 카카오 응답용 */
export function isoToYmd(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

/** Date → 'YYYYMMDD' (UTC 기준). 호출부가 '오늘'을 만들 때 쓴다 */
export function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx tsx --test src/lib/enrich/blogCount.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: `isoToYmd` 테스트를 추가한다**

`src/lib/enrich/blogCount.test.ts` 끝에 붙인다:

```ts
import { isoToYmd, toYmd } from './blogCount.ts';

test('ISO 8601 을 YYYYMMDD 로 자른다', () => {
  assert.equal(isoToYmd('2026-09-12T10:00:00.000+09:00'), '20260912');
  assert.equal(isoToYmd('망가진 값'), '');
});

test('Date 를 UTC 기준 YYYYMMDD 로 바꾼다', () => {
  assert.equal(toYmd(new Date(Date.UTC(2026, 8, 2))), '20260902');
});
```

- [ ] **Step 7: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add src/lib/enrich/types.ts src/lib/enrich/blogCount.ts src/lib/enrich/blogCount.test.ts
git commit -m "feat: 블로그 최근 언급 집계 모듈

90일 창 안에서 반감기 45일로 가중한다. 전 기간 총 건수는 쓰지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 동일 매장 매칭 `placeMatch.ts`

구글이 준 후보 중 카카오 매장과 같은 곳을 고른다. 여기서 틀리면 엉뚱한 가게의 평점이 붙는다.

**Files:**
- Create: `src/lib/placeMatch.ts`
- Test: `src/lib/placeMatch.test.ts`

**Interfaces:**
- Consumes: `haversineM` — `src/lib/geo.ts`의 기존 함수. 시그니처 `haversineM(a: LatLng, b: LatLng): number`
- Produces:
  - `normalizeName(s: string): string`
  - `matchPlace(target: MatchPlaceInput, cands: readonly MatchPlaceInput[]): number | null`
  - `type MatchPlaceInput = { name: string; lat: number; lng: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/placeMatch.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPlace, normalizeName } from './placeMatch.ts';

// 위도 37.55 에서 경도 0.001도 ≈ 88m, 위도 0.001도 ≈ 111m
const at = (name: string, dLat = 0, dLng = 0) => ({ name, lat: 37.55 + dLat, lng: 126.92 + dLng });

test('정규화는 공백·특수문자·지점 접미사를 떼고 소문자로', () => {
  assert.equal(normalizeName('파리바게트 홍대점'), '파리바게트홍대');
  assert.equal(normalizeName('PARIS BAGUETTE 홍대'), 'parisbaguette홍대');
  assert.equal(normalizeName('베이글랜드(홍대)'), '베이글랜드홍대');
  assert.equal(normalizeName('쿠리노키 제빵 본점'), '쿠리노키제빵');
});

test('정규화 이름이 같으면 채택한다', () => {
  const i = matchPlace(at('파리바게트 홍대점'), [at('스타벅스 홍대'), at('PARIS BAGUETTE 홍대점')]);
  assert.equal(i, 1);
});

test('접두 일치 4자 이상이면 채택한다', () => {
  const i = matchPlace(at('베이글랜드홍대'), [at('베이글랜드홍대입구역점')]);
  assert.equal(i, 0);
});

test('접두가 3자면 채택하지 않는다 — 우연한 겹침을 막는다', () => {
  const i = matchPlace(at('김밥천국'), [at('김밥나라')]);
  assert.equal(i, null);
});

test('150m 를 넘으면 이름이 같아도 탈락한다', () => {
  const i = matchPlace(at('아오이토리'), [at('아오이토리', 0.002)]); // ≈222m
  assert.equal(i, null);
});

test('이름이 안 맞아도 60m 안에 후보가 정확히 하나면 채택한다', () => {
  const i = matchPlace(at('쿠리노키제빵'), [at('Kurinoki Bakery', 0.0004)]); // ≈44m
  assert.equal(i, 0);
});

test('60m 안에 둘이면 고르지 않는다', () => {
  const i = matchPlace(at('카페'), [at('A', 0.0002), at('B', 0.0003)]);
  assert.equal(i, null);
});

test('후보가 비면 null', () => {
  assert.equal(matchPlace(at('아무개'), []), null);
});

test('이름 일치가 거리 근접보다 우선한다', () => {
  // 0번은 아주 가깝지만 이름이 다르고, 1번은 조금 멀지만 이름이 같다
  const i = matchPlace(at('아오이토리'), [at('다른가게', 0.0001), at('아오이토리', 0.0009)]);
  assert.equal(i, 1);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/placeMatch.test.ts`
Expected: FAIL — `Cannot find module './placeMatch.ts'`

- [ ] **Step 3: 구현한다**

`src/lib/placeMatch.ts`:

```ts
/**
 * 카카오 매장과 구글 장소가 같은 곳인지 판단한다. 순수 함수.
 *
 * 여기서 틀리면 엉뚱한 가게의 평점이 붙는다. 그래서 애매하면 고르지 않는다 —
 * 신호가 없는 건 회복되지만(다른 축으로 점수를 낸다) 틀린 신호는 조용히 순위를 뒤집는다.
 */
import { haversineM } from './geo';

export type MatchPlaceInput = { name: string; lat: number; lng: number };

/** 이름 일치를 인정하는 최대 거리 */
const NAME_MAX_M = 150;
/** 이름이 안 맞아도 '하나뿐이면 그거'로 인정하는 거리 */
const ALONE_MAX_M = 60;
/** 접두 일치로 볼 최소 길이 */
const PREFIX_MIN = 4;

const BRANCH_SUFFIX = /(본점|지점|점)$/;

/**
 * 공백·괄호·특수문자를 지우고, 끝의 지점 접미사를 떼고, 영문은 소문자로.
 * "파리바게트 홍대점" → "파리바게트홍대"
 */
export function normalizeName(s: string): string {
  const stripped = s
    .toLowerCase()
    .replace(/[\s()[\]{}·・,.'"“”‘’\-_/\\&@!?~]/g, '');
  return stripped.replace(BRANCH_SUFFIX, '');
}

function distance(a: MatchPlaceInput, b: MatchPlaceInput): number {
  return haversineM({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
}

/** 한쪽이 다른 쪽으로 시작하고, 짧은 쪽이 PREFIX_MIN 이상이면 같은 이름으로 본다 */
function prefixMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= PREFIX_MIN && long.startsWith(short);
}

export function matchPlace(
  target: MatchPlaceInput,
  cands: readonly MatchPlaceInput[],
): number | null {
  const near = cands
    .map((c, i) => ({ i, c, d: distance(target, c) }))
    .filter(x => x.d <= NAME_MAX_M);
  if (near.length === 0) return null;

  const t = normalizeName(target.name);

  // 1) 정규화 이름이 같다 — 가장 가까운 것
  const exact = near.filter(x => normalizeName(x.c.name) === t).sort((a, b) => a.d - b.d);
  if (exact.length > 0) return exact[0].i;

  // 2) 접두 일치 — 가장 가까운 것
  const prefix = near.filter(x => prefixMatch(normalizeName(x.c.name), t)).sort((a, b) => a.d - b.d);
  if (prefix.length > 0) return prefix[0].i;

  // 3) 이름이 안 맞아도 아주 가까운 곳이 딱 하나면 그거다(지점명 표기만 다른 경우)
  const alone = near.filter(x => x.d <= ALONE_MAX_M);
  if (alone.length === 1) return alone[0].i;

  return null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/placeMatch.test.ts`
Expected: PASS (9 tests)

`haversineM` 은 `src/lib/geo.ts:32` 에 `export function haversineM(a: LatLng, b: LatLng): number` 로 있다(2026-09-12 확인). `LatLng` 는 `{ latitude, longitude }` 이므로 위 구현처럼 변환해 넘긴다.

- [ ] **Step 5: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/placeMatch.ts src/lib/placeMatch.test.ts
git commit -m "feat: 카카오·구글 동일 매장 매칭

애매하면 고르지 않는다. 틀린 신호는 조용히 순위를 뒤집는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 점수 `trendScore.ts`

**Files:**
- Create: `src/lib/trendScore.ts`
- Test: `src/lib/trendScore.test.ts`

**Interfaces:**
- Consumes: Task 1의 `BlogSignal`·`GoogleSignal` (타입만)
- Produces:
  - `type TrendInput = { id: string; addedMin: number; blog?: { weighted: number }; google?: { rating: number; ratingCount: number } }`
  - `type TrendScored = { id: string; score: number; fit: number; quality: number | null; buzz: number | null; reasons: string[]; hot: boolean }`
  - `scoreTrend(inputs: readonly TrendInput[]): TrendScored[]` — score 내림차순, 동률은 addedMin 오름차순
  - `prescore(inputs: readonly TrendInput[]): string[]` — 구글에 물어볼 id를 상위 10개까지

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/trendScore.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prescore, scoreTrend, type TrendInput } from './trendScore.ts';

const inp = (id: string, addedMin: number, extra: Partial<TrendInput> = {}): TrendInput =>
  ({ id, addedMin, ...extra });
const ids = (list: { id: string }[]) => list.map(x => x.id);

test('신호가 하나도 없으면 추가시간이 짧은 순', () => {
  const r = scoreTrend([inp('a', 9), inp('b', 2), inp('c', 5)]);
  assert.deepEqual(ids(r), ['b', 'c', 'a']);
  assert.equal(r[0].quality, null);
  assert.equal(r[0].buzz, null);
});

test('추가시간이 같으면 평점이 순서를 정한다', () => {
  const r = scoreTrend([
    inp('a', 3, { google: { rating: 3.5, ratingCount: 300 } }),
    inp('b', 3, { google: { rating: 4.8, ratingCount: 300 } }),
  ]);
  assert.deepEqual(ids(r), ['b', 'a']);
});

test('리뷰 수가 적으면 높은 평점이 깎인다', () => {
  const r = scoreTrend([
    inp('few', 3, { google: { rating: 5, ratingCount: 3 } }),
    inp('many', 3, { google: { rating: 4.4, ratingCount: 300 } }),
  ]);
  assert.deepEqual(ids(r), ['many', 'few']);
});

test('축이 빠지면 남은 가중치를 다시 나눠 합이 1이 된다', () => {
  // 신호가 전혀 없고 addedMin 이 최댓값이면 fit=0 → score 0
  const [only] = scoreTrend([inp('a', 10)]);
  assert.equal(only.score, 0);
  // fit 이 1(가장 짧음)이고 다른 축이 없으면 score 는 1
  const both = scoreTrend([inp('a', 0), inp('b', 10)]);
  assert.equal(both[0].score, 1);
});

test('후보의 80% 이상이 blog weighted 0 이면 buzz 축을 통째로 버린다', () => {
  const list = [
    inp('a', 3, { blog: { weighted: 0 } }),
    inp('b', 3, { blog: { weighted: 0 } }),
    inp('c', 3, { blog: { weighted: 0 } }),
    inp('d', 3, { blog: { weighted: 0 } }),
    inp('e', 3, { blog: { weighted: 9 } }),
  ];
  const r = scoreTrend(list);
  assert.ok(r.every(x => x.buzz === null), 'buzz 가 전부 null 이어야 한다');
  assert.ok(r.every(x => !x.reasons.some(s => s.includes('블로그'))));
});

test('80% 미만이면 buzz 축을 쓴다', () => {
  const list = [
    inp('a', 3, { blog: { weighted: 0 } }),
    inp('b', 3, { blog: { weighted: 0 } }),
    inp('c', 3, { blog: { weighted: 4 } }),
    inp('d', 3, { blog: { weighted: 9 } }),
    inp('e', 3, { blog: { weighted: 20 } }),
  ];
  const r = scoreTrend(list);
  assert.equal(ids(r)[0], 'e');
  assert.ok(r[0].buzz !== null);
});

test('buzz 는 로그 정규화 — weighted 10 이면 1', () => {
  const r = scoreTrend([
    inp('a', 3, { blog: { weighted: 10 } }),
    inp('b', 3, { blog: { weighted: 2.3 } }),
  ]);
  const a = r.find(x => x.id === 'a')!;
  const b = r.find(x => x.id === 'b')!;
  assert.ok(Math.abs(a.buzz! - 1) < 1e-9);
  assert.ok(b.buzz! > 0.45 && b.buzz! < 0.55, `기대 0.5 근처, 실제 ${b.buzz}`);
});

test('점수가 같으면 추가시간이 짧은 쪽이 먼저', () => {
  const r = scoreTrend([inp('late', 7), inp('early', 7)]);
  // 완전히 같으면 입력 순서가 유지된다(안정 정렬)
  assert.deepEqual(ids(r), ['late', 'early']);
  const r2 = scoreTrend([inp('a', 7), inp('b', 3), inp('c', 7)]);
  assert.equal(ids(r2)[0], 'b');
});

test('reasons 는 있는 신호만 이 순서로 — 평점·블로그·추가시간', () => {
  const [r] = scoreTrend([
    inp('a', 4, { google: { rating: 4.5, ratingCount: 320 }, blog: { weighted: 8 } }),
  ]);
  assert.deepEqual(r.reasons, ['구글 4.5 (320)', '최근 블로그 8건', '+4분']);
});

test('추가시간 0 이면 reasons 에 추가시간을 넣지 않는다', () => {
  const [r] = scoreTrend([inp('a', 0)]);
  assert.deepEqual(r.reasons, []);
});

test('요즘 인기 배지는 buzz 0.6 이상이고 3위 안일 때만', () => {
  const r = scoreTrend([
    inp('a', 3, { blog: { weighted: 20 } }),
    inp('b', 3, { blog: { weighted: 9 } }),
    inp('c', 3, { blog: { weighted: 3 } }),
    inp('d', 3, { blog: { weighted: 0.2 } }),
    inp('e', 3, { blog: { weighted: 0 } }),
  ]);
  assert.equal(r[0].hot, true);
  assert.equal(r[4].hot, false);
  assert.ok(r.filter(x => x.hot).length <= 3);
});

test('prescore 는 fit·buzz 만으로 상위 10개 id 를 준다', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    inp(`p${i}`, i, { blog: { weighted: i === 29 ? 50 : 0 } }));
  const picked = prescore(many);
  assert.equal(picked.length, 10);
  assert.ok(picked.includes('p0'), '추가시간이 가장 짧은 후보는 뽑혀야 한다');
  assert.ok(picked.includes('p29'), '언급이 가장 많은 후보는 뽑혀야 한다');
});

test('prescore 는 후보가 10개 미만이면 전부 준다', () => {
  assert.equal(prescore([inp('a', 1), inp('b', 2)]).length, 2);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/trendScore.test.ts`
Expected: FAIL — `Cannot find module './trendScore.ts'`

- [ ] **Step 3: 구현한다**

`src/lib/trendScore.ts`:

```ts
/**
 * 후보 추천 점수. 순수 함수라 네트워크·UI 없이 시험한다.
 *
 * 한 소스에 기대지 않는다. 세 축(경로 적합도·평점 품질·최근 언급)의 가중합이고,
 * 없는 축은 빼고 남은 가중치를 다시 나눈다. 그래서 블로그가 죽어도, 구글이
 * 예산을 다 써도 순위는 계속 나온다.
 *
 * 순위는 전부 여기서 정한다. LLM은 '무엇을 찾을지'만 뽑는다(AGENTS.md).
 */

export type TrendInput = {
  id: string;
  /** 플래너 추정 — 이 후보로 바꿨을 때 늘어나는 분 */
  addedMin: number;
  blog?: { weighted: number };
  google?: { rating: number; ratingCount: number };
};

export type TrendScored = {
  id: string;
  score: number;
  fit: number;
  quality: number | null;
  buzz: number | null;
  /** 카드 부제에 ' · '로 잇는다 */
  reasons: string[];
  /** '요즘 인기' 배지 */
  hot: boolean;
};

const W_FIT = 0.4;
const W_QUALITY = 0.35;
const W_BUZZ = 0.25;

/** 이 값에서 fit 이 0이 된다. 전부 +3분이면 다 같은 값이라 다른 축이 순서를 만든다 */
const FIT_FLOOR_MIN = 10;
/** 리뷰 이만큼이면 품질 신뢰가 포화 */
const REVIEW_SATURATION = 200;
/** 90일 가중 언급이 이만큼이면 buzz 만점. 실측 분포(0~35) 기준 */
const BUZZ_SATURATION = 10;
/** 후보 중 이 비율 이상이 언급 0이면 색인 공백으로 보고 축을 버린다 */
const BUZZ_BLIND_RATIO = 0.8;
const HOT_BUZZ = 0.6;
const HOT_RANK = 3;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function fitOf(addedMin: number, maxAdded: number): number {
  return clamp01(1 - addedMin / maxAdded);
}

function qualityOf(g: { rating: number; ratingCount: number }): number {
  const trust = Math.min(1, Math.log10(1 + Math.max(0, g.ratingCount)) / Math.log10(1 + REVIEW_SATURATION));
  return clamp01(g.rating / 5) * trust;
}

function buzzOf(weighted: number): number {
  return Math.min(1, Math.log10(1 + Math.max(0, weighted)) / Math.log10(1 + BUZZ_SATURATION));
}

/** 있는 축만 모아 가중평균. 축이 하나도 없으면 fit 만 남으므로 항상 하나는 있다 */
function blend(parts: { w: number; v: number }[]): number {
  const total = parts.reduce((s, p) => s + p.w, 0);
  if (total === 0) return 0;
  return parts.reduce((s, p) => s + p.w * p.v, 0) / total;
}

export function scoreTrend(inputs: readonly TrendInput[]): TrendScored[] {
  if (inputs.length === 0) return [];

  const maxAdded = Math.max(FIT_FLOOR_MIN, ...inputs.map(i => i.addedMin));

  // 블로그 신호를 가진 후보 중 0이 너무 많으면 색인 공백이다.
  // 없는 걸 '인기 없음'으로 읽으면 순위가 거꾸로 간다.
  const withBlog = inputs.filter(i => i.blog);
  const zeros = withBlog.filter(i => i.blog!.weighted === 0).length;
  const buzzBlind = withBlog.length === 0 || zeros / withBlog.length >= BUZZ_BLIND_RATIO;

  const scored = inputs.map((i, idx) => {
    const fit = fitOf(i.addedMin, maxAdded);
    const quality = i.google ? qualityOf(i.google) : null;
    const buzz = !buzzBlind && i.blog ? buzzOf(i.blog.weighted) : null;

    const parts = [{ w: W_FIT, v: fit }];
    if (quality != null) parts.push({ w: W_QUALITY, v: quality });
    if (buzz != null) parts.push({ w: W_BUZZ, v: buzz });

    const reasons: string[] = [];
    if (i.google) reasons.push(`구글 ${i.google.rating.toFixed(1)} (${i.google.ratingCount})`);
    if (buzz != null && i.blog!.weighted > 0) reasons.push(`최근 블로그 ${Math.round(i.blog!.weighted)}건`);
    if (i.addedMin > 0) reasons.push(`+${Math.round(i.addedMin)}분`);

    return { id: i.id, score: blend(parts), fit, quality, buzz, reasons, hot: false, _idx: idx, _added: i.addedMin };
  });

  scored.sort((a, b) => b.score - a.score || a._added - b._added || a._idx - b._idx);

  return scored.map(({ _idx, _added, ...rest }, rank) => ({
    ...rest,
    hot: rest.buzz != null && rest.buzz >= HOT_BUZZ && rank < HOT_RANK,
  }));
}

/** 구글에 물어볼 후보를 고른다 — 경로 적합도와 언급만으로 상위 10개 */
const PRESCORE_TOP = 10;
const PRE_W_FIT = 0.6;
const PRE_W_BUZZ = 0.4;

export function prescore(inputs: readonly TrendInput[]): string[] {
  if (inputs.length <= PRESCORE_TOP) return inputs.map(i => i.id);
  const maxAdded = Math.max(FIT_FLOOR_MIN, ...inputs.map(i => i.addedMin));
  return [...inputs]
    .map((i, idx) => ({
      id: i.id,
      idx,
      added: i.addedMin,
      v: PRE_W_FIT * fitOf(i.addedMin, maxAdded) + PRE_W_BUZZ * buzzOf(i.blog?.weighted ?? 0),
    }))
    .sort((a, b) => b.v - a.v || a.added - b.added || a.idx - b.idx)
    .slice(0, PRESCORE_TOP)
    .map(x => x.id);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/trendScore.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/trendScore.ts src/lib/trendScore.test.ts
git commit -m "feat: 트렌드 점수 — 경로 적합도·평점·최근 언급의 가중합

없는 축은 빼고 가중치를 재정규화한다. 한 소스가 죽어도 순위는 나온다.
후보 80% 이상이 언급 0이면 색인 공백으로 보고 buzz 축을 버린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `/enrich` 요청 스키마

**Files:**
- Create: `server/src/enrichSchema.ts`
- Test: `server/src/enrichSchema.test.ts`

**Interfaces:**
- Consumes: 없음(서버는 `src/lib` 를 import 하지 않는다 — 타입을 자기 파일에 다시 쓴다)
- Produces: `parseEnrichRequest(raw: unknown): EnrichPlace[] | null`, `type EnrichPlace = { id: string; name: string; address: string; lat: number; lng: number }`

`server/src/schema.ts`의 방어 스타일을 그대로 따른다. 바깥에서 온 건 전부 여기를 통과해야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/src/enrichSchema.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnrichRequest } from './enrichSchema.ts';

const p = (over: Record<string, unknown> = {}) =>
  ({ id: 'k1', name: '아오이토리', address: '서울 마포구 서교동 1', lat: 37.55, lng: 126.92, ...over });

test('정상 요청을 통과시킨다', () => {
  const r = parseEnrichRequest({ places: [p()] });
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].name, '아오이토리');
});

test('places 가 없거나 빈 배열이면 null', () => {
  assert.equal(parseEnrichRequest({}), null);
  assert.equal(parseEnrichRequest({ places: [] }), null);
  assert.equal(parseEnrichRequest(null), null);
  assert.equal(parseEnrichRequest('문자열'), null);
});

test('30개를 넘으면 잘라낸다', () => {
  const many = Array.from({ length: 50 }, (_, i) => p({ id: `k${i}` }));
  assert.equal(parseEnrichRequest({ places: many })?.length, 30);
});

test('한국 바깥 좌표는 버린다', () => {
  const r = parseEnrichRequest({ places: [p(), p({ id: 'k2', lat: 48.8, lng: 2.3 })] });
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].id, 'k1');
});

test('좌표가 숫자가 아니면 버린다', () => {
  assert.equal(parseEnrichRequest({ places: [p({ lat: '37.55' })] }), null);
  assert.equal(parseEnrichRequest({ places: [p({ lng: NaN })] }), null);
});

test('이름이 비면 버린다 — 검색어가 없으면 쓸모가 없다', () => {
  assert.equal(parseEnrichRequest({ places: [p({ name: '   ' })] }), null);
});

test('긴 이름·주소는 자른다', () => {
  const r = parseEnrichRequest({ places: [p({ name: 'ㄱ'.repeat(200), address: 'ㄴ'.repeat(300) })] });
  assert.equal(r?.[0].name.length, 60);
  assert.equal(r?.[0].address.length, 120);
});

test('주소는 없어도 된다', () => {
  const r = parseEnrichRequest({ places: [p({ address: undefined })] });
  assert.equal(r?.[0].address, '');
});

test('id 가 중복이면 처음 것만 남긴다', () => {
  const r = parseEnrichRequest({ places: [p(), p({ name: '다른이름' })] });
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].name, '아오이토리');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test server/src/enrichSchema.test.ts`
Expected: FAIL — `Cannot find module './enrichSchema.ts'`

- [ ] **Step 3: 구현한다**

`server/src/enrichSchema.ts`:

```ts
/**
 * /enrich 요청 검증. server/src/schema.ts 와 같은 원칙 —
 * 바깥에서 온 값은 여기를 통과하지 못하면 바깥 API로 나가지 않는다.
 * 검증 없이 넘기면 남의 좌표로 우리 쿼터를 태울 수 있다.
 */

export type EnrichPlace = { id: string; name: string; address: string; lat: number; lng: number };

const MAX_PLACES = 30;
const MAX_NAME = 60;
const MAX_ADDRESS = 120;

/** 한국 본토 + 제주 + 울릉/독도. src/lib/places.ts 의 KR_BBOX 와 같은 값 */
const KR = { minLat: 33.0, maxLat: 38.7, minLng: 124.5, maxLng: 132.0 };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseOne(raw: unknown): EnrichPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || r.id.trim() === '') return null;
  if (!isStr(r.name) || r.name.trim() === '') return null;
  if (!isNum(r.lat) || !isNum(r.lng)) return null;
  if (r.lat < KR.minLat || r.lat > KR.maxLat || r.lng < KR.minLng || r.lng > KR.maxLng) return null;
  return {
    id: r.id.slice(0, 80),
    name: r.name.slice(0, MAX_NAME),
    address: isStr(r.address) ? r.address.slice(0, MAX_ADDRESS) : '',
    lat: r.lat,
    lng: r.lng,
  };
}

export function parseEnrichRequest(raw: unknown): EnrichPlace[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const places = (raw as Record<string, unknown>).places;
  if (!Array.isArray(places)) return null;
  const seen = new Set<string>();
  const out: EnrichPlace[] = [];
  for (const p of places) {
    const one = parseOne(p);
    if (!one || seen.has(one.id)) continue;
    seen.add(one.id);
    out.push(one);
    if (out.length >= MAX_PLACES) break;
  }
  return out.length > 0 ? out : null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test server/src/enrichSchema.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add server/src/enrichSchema.ts server/src/enrichSchema.test.ts
git commit -m "feat: /enrich 요청 스키마

검증 없이 넘기면 남의 좌표로 우리 쿼터를 태울 수 있다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 네이버 블로그 · 구글 Places 클라이언트

두 바깥 API를 각각 파일 하나로. `fetch`를 주입받아 네트워크 없이 시험한다.

**Files:**
- Create: `server/src/naverBlog.ts`, `server/src/googlePlaces.ts`
- Test: `server/src/naverBlog.test.ts`, `server/src/googlePlaces.test.ts`

**Interfaces:**
- Consumes: Task 2의 `matchPlace`. **서버는 `src/lib`를 import 하지 않는다** — `server/src/googlePlaces.ts`가 `../../src/lib/placeMatch`를 상대경로로 import 한다. `server/tsconfig`가 없고 루트 `tsconfig`가 전체를 덮으므로 동작한다. Step 3에서 확인한다.
- Produces:
  - `fetchNaverBlog(name: string, keyId: string, key: string, f: typeof fetch, todayYmd: string): Promise<BlogSignal | null>`
  - `fetchGooglePlace(place: {name, lat, lng}, apiKey: string, f: typeof fetch, todayDow: number): Promise<GoogleSignal | null>`
  - `type BlogSignal`·`type GoogleSignal` — `server/src/enrichTypes.ts`에 둔다(앱의 `src/lib/enrich/types.ts`와 같은 모양, 서버가 앱을 import 하지 않기 위한 사본)

- [ ] **Step 1: 서버쪽 타입 사본을 만든다**

`server/src/enrichTypes.ts`:

```ts
/**
 * /enrich 응답 타입. 원본은 src/lib/enrich/types.ts 이며 내용이 같아야 한다.
 * 서버가 앱 코드를 import 하지 않도록 사본을 둔다 — 앱은 expo 를 물고 있다.
 */
export type BlogSignal = {
  count90d: number;
  latestDaysAgo: number | null;
  weighted: number;
  source: 'naver' | 'kakao';
};
export type GoogleSignal = {
  rating: number;
  ratingCount: number;
  hours: { openMin: number; closeMin: number } | null;
  matchedName: string;
};
export type PlaceSignals = { blog?: BlogSignal; google?: GoogleSignal; fetchedAt: string };
```

- [ ] **Step 2: 네이버 테스트를 쓴다**

`server/src/naverBlog.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNaverBlog, parseNaverBlog } from './naverBlog.ts';

const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

test('postdate 로 90일 안 글을 세고 weighted 를 낸다', () => {
  const r = parseNaverBlog({ total: 400, items: [{ postdate: '20260912' }, { postdate: '20260101' }] }, '20260912');
  assert.equal(r?.count90d, 1);
  assert.ok(Math.abs(r!.weighted - 1) < 1e-9);
  assert.equal(r?.source, 'naver');
});

test('total 이 20000 을 넘으면 전국 집계로 보고 버린다', () => {
  const r = parseNaverBlog({ total: 289993, items: [{ postdate: '20260912' }] }, '20260912');
  assert.equal(r, null);
});

test('total 이 정확히 20000 이면 아직 쓴다', () => {
  const r = parseNaverBlog({ total: 20000, items: [{ postdate: '20260912' }] }, '20260912');
  assert.ok(r !== null);
});

test('응답이 망가지면 null', () => {
  assert.equal(parseNaverBlog(null, '20260912'), null);
  assert.equal(parseNaverBlog({ items: '배열아님' }, '20260912'), null);
  assert.equal(parseNaverBlog({ total: 'x', items: [] }, '20260912'), null);
});

test('글이 하나도 없어도 0 신호를 준다 — 없음과 모름을 구분한다', () => {
  const r = parseNaverBlog({ total: 3, items: [] }, '20260912');
  assert.equal(r?.count90d, 0);
  assert.equal(r?.weighted, 0);
});

test('이름을 그대로 query 로 보낸다 — 동네를 붙이지 않는다', async () => {
  let seen = '';
  const f = (async (url: string | URL) => {
    seen = String(url);
    return new Response(JSON.stringify({ total: 1, items: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchNaverBlog('베이글랜드 홍대점', 'id', 'key', f, '20260912');
  assert.ok(seen.includes(encodeURIComponent('베이글랜드 홍대점')), seen);
  assert.ok(seen.includes('sort=date'));
  assert.ok(seen.includes('display=100'));
});

test('인증 헤더 두 개를 보낸다', async () => {
  let headers: Record<string, string> = {};
  const f = (async (_u: unknown, init?: RequestInit) => {
    headers = (init?.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ total: 1, items: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchNaverBlog('x', 'ID값', 'KEY값', f, '20260912');
  assert.equal(headers['X-NCP-APIGW-API-KEY-ID'], 'ID값');
  assert.equal(headers['X-NCP-APIGW-API-KEY'], 'KEY값');
});

test('429 나 5xx 면 null — 재시도하지 않는다', async () => {
  const f = (async () => new Response('too many', { status: 429 })) as unknown as typeof fetch;
  assert.equal(await fetchNaverBlog('x', 'a', 'b', f, '20260912'), null);
});

test('fetch 가 던져도 null 로 삼킨다', async () => {
  const f = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await fetchNaverBlog('x', 'a', 'b', f, '20260912'), null);
});

test('정상 경로', async () => {
  const r = await fetchNaverBlog('x', 'a', 'b', ok({ total: 10, items: [{ postdate: '20260912' }] }), '20260912');
  assert.equal(r?.count90d, 1);
});
```

- [ ] **Step 3: 네이버 클라이언트를 구현한다**

`server/src/naverBlog.ts`:

```ts
/**
 * NAVER API HUB 블로그 검색.
 *   GET https://naverapihub.apigw.ntruss.com/search/v1/blog
 * 2026-09-12 실제 호출로 엔드포인트·헤더·응답 필드를 확인했다.
 *
 * 질의어는 카카오 place_name 그대로다. 행정동("서교동")을 붙이면 안 된다 —
 * 블로거는 "홍대"라고 쓰지 "서교동"이라고 쓰지 않아서 건수가 20분의 1로 뭉개진다.
 * 실측 근거는 설계 문서 §2.1.3.
 */
import type { BlogSignal } from './enrichTypes';

const ENDPOINT = 'https://naverapihub.apigw.ntruss.com/search/v1/blog';
/** 이보다 크면 단일 지점이 아니라 전국 집계다("파리바게트" 289,993) */
const TOTAL_NATIONAL = 20_000;
const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 45;
const DAY_MS = 86_400_000;

function ymdToMs(ymd: unknown): number | null {
  if (typeof ymd !== 'string' || !/^\d{8}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** 응답 → 신호. 네트워크와 분리해 시험한다 */
export function parseNaverBlog(raw: unknown, todayYmd: string): BlogSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.total !== 'number' || !Number.isFinite(r.total)) return null;
  if (!Array.isArray(r.items)) return null;
  if (r.total > TOTAL_NATIONAL) return null;

  const today = ymdToMs(todayYmd);
  if (today == null) return null;

  const ages: number[] = [];
  for (const it of r.items.slice(0, 100)) {
    const ms = ymdToMs((it as Record<string, unknown>)?.postdate);
    if (ms == null) continue;
    const age = Math.round((today - ms) / DAY_MS);
    if (age < 0 || age > WINDOW_DAYS) continue;
    ages.push(age);
  }
  return {
    count90d: ages.length,
    latestDaysAgo: ages.length ? Math.min(...ages) : null,
    weighted: ages.reduce((s, a) => s + Math.exp(-a / HALF_LIFE_DAYS), 0),
    source: 'naver',
  };
}

export async function fetchNaverBlog(
  name: string,
  keyId: string,
  key: string,
  f: typeof fetch,
  todayYmd: string,
): Promise<BlogSignal | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', name);
  url.searchParams.set('sort', 'date');
  url.searchParams.set('display', '100');
  try {
    const res = await f(url.toString(), {
      headers: { 'X-NCP-APIGW-API-KEY-ID': keyId, 'X-NCP-APIGW-API-KEY': key },
    });
    if (!res.ok) return null; // 429·5xx 는 재시도하지 않는다. 이 후보만 신호가 없을 뿐이다
    return parseNaverBlog(await res.json(), todayYmd);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 네이버 테스트 통과를 확인한다**

Run: `npx tsx --test server/src/naverBlog.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 구글 테스트를 쓴다**

`server/src/googlePlaces.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGooglePlace, parseGooglePlaces } from './googlePlaces.ts';

const target = { name: '아오이토리', lat: 37.55, lng: 126.92 };
const gp = (over: Record<string, unknown> = {}) => ({
  displayName: { text: '아오이토리' },
  location: { latitude: 37.55, longitude: 126.92 },
  rating: 4.5,
  userRatingCount: 320,
  ...over,
});

test('이름·좌표가 맞는 후보의 평점을 가져온다', () => {
  const r = parseGooglePlaces({ places: [gp()] }, target, 5);
  assert.equal(r?.rating, 4.5);
  assert.equal(r?.ratingCount, 320);
  assert.equal(r?.matchedName, '아오이토리');
});

test('매칭에 실패하면 null — 엉뚱한 가게 평점을 붙이지 않는다', () => {
  const far = gp({ displayName: { text: '전혀다른가게' }, location: { latitude: 37.60, longitude: 126.99 } });
  assert.equal(parseGooglePlaces({ places: [far] }, target, 5), null);
});

test('평점이 없으면 null', () => {
  assert.equal(parseGooglePlaces({ places: [gp({ rating: undefined })] }, target, 5), null);
  assert.equal(parseGooglePlaces({ places: [gp({ userRatingCount: undefined })] }, target, 5), null);
});

test('응답이 망가지면 null', () => {
  assert.equal(parseGooglePlaces(null, target, 5), null);
  assert.equal(parseGooglePlaces({ places: '배열아님' }, target, 5), null);
  assert.equal(parseGooglePlaces({ places: [] }, target, 5), null);
});

test('오늘 요일의 영업시간을 분으로 바꾼다', () => {
  const withHours = gp({
    regularOpeningHours: {
      periods: [
        { open: { day: 5, hour: 9, minute: 30 }, close: { day: 5, hour: 21, minute: 0 } },
        { open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 18, minute: 0 } },
      ],
    },
  });
  const r = parseGooglePlaces({ places: [withHours] }, target, 5);
  assert.deepEqual(r?.hours, { openMin: 570, closeMin: 1260 });
});

test('오늘 요일 영업시간이 없으면 hours 는 null', () => {
  const withHours = gp({
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } }] },
  });
  assert.equal(parseGooglePlaces({ places: [withHours] }, target, 5)?.hours, null);
});

test('close 가 없으면 24시간 영업으로 본다', () => {
  const always = gp({ regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } });
  assert.deepEqual(parseGooglePlaces({ places: [always] }, target, 0)?.hours, { openMin: 0, closeMin: 1440 });
});

test('FieldMask 와 키 헤더를 보낸다', async () => {
  let init: RequestInit | undefined;
  const f = (async (_u: unknown, i?: RequestInit) => {
    init = i;
    return new Response(JSON.stringify({ places: [gp()] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchGooglePlace(target, 'KEY값', f, 5);
  const h = (init?.headers ?? {}) as Record<string, string>;
  assert.equal(h['X-Goog-Api-Key'], 'KEY값');
  assert.ok(h['X-Goog-FieldMask'].includes('places.rating'));
  assert.equal(init?.method, 'POST');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.textQuery, '아오이토리');
  assert.equal(body.maxResultCount, 3);
  assert.equal(body.languageCode, 'ko');
});

test('4xx·5xx 면 null', async () => {
  const f = (async () => new Response('quota', { status: 429 })) as unknown as typeof fetch;
  assert.equal(await fetchGooglePlace(target, 'k', f, 5), null);
});

test('fetch 가 던져도 null', async () => {
  const f = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await fetchGooglePlace(target, 'k', f, 5), null);
});
```

- [ ] **Step 6: 구글 클라이언트를 구현한다**

`server/src/googlePlaces.ts`:

```ts
/**
 * 구글 Places (New) Text Search.
 *
 * rating·userRatingCount·regularOpeningHours 는 Enterprise SKU 라 월 1,000회만
 * 무료고 넘으면 자동 과금이다. 그래서 호출부(enrich.ts)가 상위 10곳만 부르고
 * 월 카운터로 막는다. 여기서는 호출 한 번과 파싱만 한다.
 */
import { matchPlace } from '../../src/lib/placeMatch';
import type { GoogleSignal } from './enrichTypes';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK =
  'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.regularOpeningHours';
/** 이 반경 안에서만 찾는다. 동명 매장이 다른 동네에서 잡히는 걸 줄인다 */
const BIAS_RADIUS_M = 300;

type RawPeriodPoint = { day?: unknown; hour?: unknown; minute?: unknown };
type RawPeriod = { open?: RawPeriodPoint; close?: RawPeriodPoint };

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 오늘 요일(0=일)의 영업시간을 분으로. 없으면 null, close 가 없으면 24시간 */
function hoursOf(raw: unknown, todayDow: number): GoogleSignal['hours'] {
  if (!raw || typeof raw !== 'object') return null;
  const periods = (raw as Record<string, unknown>).periods;
  if (!Array.isArray(periods)) return null;
  for (const p of periods as RawPeriod[]) {
    const openDay = num(p?.open?.day);
    if (openDay !== todayDow) continue;
    const oh = num(p.open?.hour) ?? 0;
    const om = num(p.open?.minute) ?? 0;
    const openMin = oh * 60 + om;
    if (!p.close) return { openMin: 0, closeMin: 1440 };
    const ch = num(p.close.hour) ?? 0;
    const cm = num(p.close.minute) ?? 0;
    return { openMin, closeMin: ch * 60 + cm };
  }
  return null;
}

export function parseGooglePlaces(
  raw: unknown,
  target: { name: string; lat: number; lng: number },
  todayDow: number,
): GoogleSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const places = (raw as Record<string, unknown>).places;
  if (!Array.isArray(places) || places.length === 0) return null;

  const cands = places.map(p => {
    const r = p as Record<string, unknown>;
    const loc = (r.location ?? {}) as Record<string, unknown>;
    const dn = (r.displayName ?? {}) as Record<string, unknown>;
    return {
      name: typeof dn.text === 'string' ? dn.text : '',
      lat: num(loc.latitude) ?? 0,
      lng: num(loc.longitude) ?? 0,
    };
  });

  const idx = matchPlace(target, cands);
  if (idx == null) return null;

  const hit = places[idx] as Record<string, unknown>;
  const rating = num(hit.rating);
  const ratingCount = num(hit.userRatingCount);
  if (rating == null || ratingCount == null) return null;

  return {
    rating,
    ratingCount,
    hours: hoursOf(hit.regularOpeningHours, todayDow),
    matchedName: cands[idx].name,
  };
}

export async function fetchGooglePlace(
  target: { name: string; lat: number; lng: number },
  apiKey: string,
  f: typeof fetch,
  todayDow: number,
): Promise<GoogleSignal | null> {
  try {
    const res = await f(ENDPOINT, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        textQuery: target.name,
        languageCode: 'ko',
        maxResultCount: 3,
        locationBias: {
          circle: { center: { latitude: target.lat, longitude: target.lng }, radius: BIAS_RADIUS_M },
        },
      }),
    });
    if (!res.ok) return null;
    return parseGooglePlaces(await res.json(), target, todayDow);
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: 구글 테스트 통과를 확인한다**

Run: `npx tsx --test server/src/googlePlaces.test.ts`
Expected: PASS (10 tests)

`../../src/lib/placeMatch` import 가 `tsx`에서 실패하면(경로 해석 문제), `placeMatch.ts`의 `normalizeName`·`matchPlace`를 `server/src/placeMatch.ts`로 복사하고 파일 머리에 `// 원본: src/lib/placeMatch.ts — 내용이 같아야 한다`를 적는다. `server/src/enrichTypes.ts`와 같은 이유다.

- [ ] **Step 8: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add server/src/enrichTypes.ts server/src/naverBlog.ts server/src/naverBlog.test.ts server/src/googlePlaces.ts server/src/googlePlaces.test.ts
git commit -m "feat: 네이버 블로그·구글 Places 클라이언트

질의어는 카카오 지점명 그대로다. 동네를 붙이면 건수가 20분의 1로
뭉개진다. 구글은 매칭 실패 시 null — 엉뚱한 가게 평점을 붙이지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `/enrich` 핸들러와 라우트

캐시·예산·상위 10 선별을 묶는다. 여기가 구글 과금을 막는 자리다.

**Files:**
- Create: `server/src/enrich.ts`, `server/src/enrich.test.ts`
- Modify: `server/src/index.ts`, `server/wrangler.toml`

**Interfaces:**
- Consumes: Task 4 `parseEnrichRequest`, Task 5 `fetchNaverBlog`·`fetchGooglePlace`, Task 3 `prescore`
- Produces: `handleEnrich(body: unknown, env: EnrichEnv, deps: EnrichDeps): Promise<Response>`
  - `type EnrichDeps = { fetch: typeof fetch; now: Date }`
  - `type EnrichEnv = { CACHE: KVLike; NCP_API_KEY_ID?: string; NCP_API_KEY?: string; GOOGLE_PLACES_KEY?: string }`
  - `type KVLike = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/src/enrich.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEnrich, type EnrichEnv } from './enrich.ts';

function memKV() {
  const m = new Map<string, string>();
  return {
    store: m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v); },
  };
}

const NOW = new Date(Date.UTC(2026, 8, 12)); // 2026-09-12, 토요일
const place = (id: string, name = `가게${id}`) =>
  ({ id, name, address: '서울 마포구 서교동 1', lat: 37.55, lng: 126.92 });

/** 네이버·구글 응답을 URL 로 갈라주는 목 fetch */
function mockFetch(opts: { blogTotal?: number; blogDates?: string[]; google?: boolean } = {}) {
  const calls = { naver: 0, google: 0 };
  const f = (async (u: unknown) => {
    const url = String(typeof u === 'string' ? u : (u as Request).url ?? u);
    if (url.includes('naverapihub')) {
      calls.naver++;
      return new Response(JSON.stringify({
        total: opts.blogTotal ?? 300,
        items: (opts.blogDates ?? ['20260912']).map(d => ({ postdate: d })),
      }), { status: 200 });
    }
    calls.google++;
    if (!opts.google) return new Response('no', { status: 500 });
    return new Response(JSON.stringify({
      places: [{ displayName: { text: '가게k0' }, location: { latitude: 37.55, longitude: 126.92 }, rating: 4.4, userRatingCount: 120 }],
    }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const env = (kv: ReturnType<typeof memKV>, over: Partial<EnrichEnv> = {}): EnrichEnv =>
  ({ CACHE: kv, NCP_API_KEY_ID: 'id', NCP_API_KEY: 'key', GOOGLE_PLACES_KEY: 'gkey', ...over } as EnrichEnv);

test('잘못된 요청은 422', async () => {
  const kv = memKV();
  const res = await handleEnrich({ places: [] }, env(kv), { fetch: mockFetch().f, now: NOW });
  assert.equal(res.status, 422);
});

test('블로그 신호를 담아 200 을 준다', async () => {
  const kv = memKV();
  const { f } = mockFetch();
  const res = await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(res.status, 200);
  const body = await res.json() as { results: Record<string, { blog?: { weighted: number } }> };
  assert.ok(body.results.k0.blog!.weighted > 0);
});

test('두 번째 호출은 캐시에서 — 네이버를 다시 부르지 않는다', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch();
  await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  const before = calls.naver;
  await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(calls.naver, before);
});

test('구글은 상위 10곳까지만 부른다', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch({ google: true });
  const places = Array.from({ length: 25 }, (_, i) => place(`k${i}`));
  await handleEnrich({ places }, env(kv), { fetch: f, now: NOW });
  assert.equal(calls.google, 10);
});

test('구글 월 예산 900 에 닿으면 구글을 건너뛴다', async () => {
  const kv = memKV();
  kv.store.set('google:budget:2026-09', '900');
  const { f, calls } = mockFetch({ google: true });
  const res = await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(calls.google, 0);
  const body = await res.json() as { budget: { googleLeft: number } };
  assert.equal(body.budget.googleLeft, 0);
});

test('구글이 실패해도 블로그 신호로 200 을 준다', async () => {
  const kv = memKV();
  const { f } = mockFetch({ google: false });
  const res = await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(res.status, 200);
  const body = await res.json() as { results: Record<string, { blog?: unknown; google?: unknown }> };
  assert.ok(body.results.k0.blog);
  assert.equal(body.results.k0.google, undefined);
});

test('네이버 키가 없으면 블로그를 부르지 않는다', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch();
  await handleEnrich({ places: [place('k0')] }, env(kv, { NCP_API_KEY_ID: undefined }), { fetch: f, now: NOW });
  assert.equal(calls.naver, 0);
});

test('전국 집계로 보이는 이름은 blog 가 빠진다', async () => {
  const kv = memKV();
  const { f } = mockFetch({ blogTotal: 289993 });
  const res = await handleEnrich({ places: [place('k0', '파리바게트')] }, env(kv), { fetch: f, now: NOW });
  const body = await res.json() as { results: Record<string, { blog?: unknown }> };
  assert.equal(body.results.k0.blog, undefined);
});

test('예산 카운터는 실제 호출 수만큼 오른다', async () => {
  const kv = memKV();
  const { f } = mockFetch({ google: true });
  await handleEnrich({ places: [place('k0'), place('k1')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(kv.store.get('google:budget:2026-09'), '2');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test server/src/enrich.test.ts`
Expected: FAIL — `Cannot find module './enrich.ts'`

- [ ] **Step 3: 구현한다**

`server/src/enrich.ts`:

```ts
/**
 * /enrich — 후보에 바깥 신호를 붙인다.
 *
 * 여기가 구글 과금을 막는 자리다. 세 겹으로 막는다:
 *   1) 캐시(블로그 24시간, 구글 14일)
 *   2) 슬롯당 상위 10곳만 구글에 묻는다(prescore)
 *   3) 월 900회 카운터 — 무료분 1,000회 안에서 멈춘다
 * 콘솔 일일 할당량은 무료 체험판이라 아직 못 걸었다(설계 §9). 그래서 3)이 유일한 코드 방어선이다.
 *
 * 부분 실패는 실패가 아니다. 블로그만 와도 200 이다.
 */
import { parseEnrichRequest, type EnrichPlace } from './enrichSchema';
import { fetchNaverBlog } from './naverBlog';
import { fetchGooglePlace } from './googlePlaces';
import { prescore } from '../../src/lib/trendScore';
import type { BlogSignal, GoogleSignal, PlaceSignals } from './enrichTypes';

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type EnrichEnv = {
  CACHE: KVLike;
  NCP_API_KEY_ID?: string;
  NCP_API_KEY?: string;
  GOOGLE_PLACES_KEY?: string;
};

export type EnrichDeps = { fetch: typeof fetch; now: Date };

const BLOG_TTL_S = 24 * 60 * 60;      // 설계 §2.1.1 — 24시간을 넘기지 않는다
const GOOGLE_TTL_S = 14 * 24 * 60 * 60;
const GOOGLE_MONTHLY_CAP = 900;        // 무료분 1,000 보다 낮게

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const p2 = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
const monthOf = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;

async function cached<T>(
  kv: KVLike,
  key: string,
  ttlS: number,
  make: () => Promise<T | null>,
): Promise<T | null> {
  const hit = await kv.get(key);
  if (hit !== null) {
    try {
      const v = JSON.parse(hit) as { v: T | null };
      return v.v;
    } catch {
      /* 캐시가 깨졌으면 새로 받는다 */
    }
  }
  const made = await make();
  // null 도 캐시한다 — 없는 걸 매번 다시 묻지 않는다
  await kv.put(key, JSON.stringify({ v: made }), { expirationTtl: ttlS });
  return made;
}

export async function handleEnrich(
  body: unknown,
  env: EnrichEnv,
  deps: EnrichDeps,
): Promise<Response> {
  const places = parseEnrichRequest(body);
  if (!places) return json({ error: 'bad request' }, 422);

  const todayYmd = ymdOf(deps.now);
  const todayDow = deps.now.getUTCDay();
  const fetchedAt = deps.now.toISOString();

  // 1) 블로그 — 키가 있을 때만, 전부 병렬
  const blogs = new Map<string, BlogSignal | null>();
  if (env.NCP_API_KEY_ID && env.NCP_API_KEY) {
    const keyId = env.NCP_API_KEY_ID;
    const key = env.NCP_API_KEY;
    await Promise.all(places.map(async p => {
      const sig = await cached(env.CACHE, `blog:${p.id}`, BLOG_TTL_S,
        () => fetchNaverBlog(p.name, keyId, key, deps.fetch, todayYmd));
      blogs.set(p.id, sig);
    }));
  }

  // 2) 구글 — 예산 안에서 상위 10곳만.
  //    addedMin 은 서버가 모른다(플래너가 아직 안 돌았다). 회랑 검색이 이미 회랑
  //    거리순으로 주므로 그 순서를 addedMin 대용으로 쓴다 — prescore 는 순서만 본다.
  const used = Number((await env.CACHE.get(`google:budget:${monthOf(deps.now)}`)) ?? 0);
  let spent = 0;
  const googles = new Map<string, GoogleSignal | null>();

  if (env.GOOGLE_PLACES_KEY && used < GOOGLE_MONTHLY_CAP) {
    const apiKey = env.GOOGLE_PLACES_KEY;
    const wanted = new Set(prescore(places.map((p, i) => ({
      id: p.id,
      addedMin: i,
      blog: blogs.get(p.id) ? { weighted: blogs.get(p.id)!.weighted } : undefined,
    }))));
    const targets = places.filter(p => wanted.has(p.id));
    const room = Math.max(0, GOOGLE_MONTHLY_CAP - used);

    for (const p of targets.slice(0, room)) {
      const before = spent;
      const sig = await cached(env.CACHE, `google:${p.id}`, GOOGLE_TTL_S, async () => {
        spent++; // 캐시 미스일 때만 실제 호출이 나간다
        return fetchGooglePlace({ name: p.name, lat: p.lat, lng: p.lng }, apiKey, deps.fetch, todayDow);
      });
      googles.set(p.id, sig);
      void before;
    }
    if (spent > 0) {
      await env.CACHE.put(`google:budget:${monthOf(deps.now)}`, String(used + spent));
    }
  }

  const results: Record<string, PlaceSignals> = {};
  for (const p of places) {
    const sig: PlaceSignals = { fetchedAt };
    const b = blogs.get(p.id);
    if (b) sig.blog = b;
    const g = googles.get(p.id);
    if (g) sig.google = g;
    results[p.id] = sig;
  }

  return json({
    results,
    budget: { googleUsed: used + spent, googleLeft: Math.max(0, GOOGLE_MONTHLY_CAP - used - spent) },
  });
}

export type { EnrichPlace };
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test server/src/enrich.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 라우트를 붙인다**

`server/src/index.ts`를 세 군데 고친다.

첫째, import 추가(기존 import 블록 끝에):

```ts
import { handleEnrich } from './enrich';
```

둘째, `Env`에 필드 추가(`RATE: KVNamespace;` 바로 위):

```ts
  /** NAVER API HUB 검색(블로그). 네이버 클라우드 콘솔의 Client ID·Secret */
  NCP_API_KEY_ID: string;
  NCP_API_KEY: string;
  /** 구글 Places (New). Places API (New) 하나로만 제한된 키 */
  GOOGLE_PLACES_KEY: string;
  /** 바깥 응답 캐시. RATE 와 별개 — 용도가 섞이면 TTL 을 못 나눈다 */
  CACHE: KVNamespace;
```

셋째, `PER_MIN`에 한 줄 추가:

```ts
const PER_MIN: Record<string, number> = { '/extract': 10, '/route': 40, '/enrich': 10 };
```

넷째, 라우팅(기존 `if (url.pathname !== '/extract' && url.pathname !== '/route')` 줄을 아래로 교체):

```ts
    const known = ['/extract', '/route', '/enrich'];
    if (!known.includes(url.pathname)) return json({ error: 'not found' }, 404);

    const gated = await gate(req, env, url.pathname);
    if (gated instanceof Response) return gated;
    if (url.pathname === '/route') return handleRoute(gated.body, env);
    if (url.pathname === '/enrich') return handleEnrich(gated.body, env, { fetch, now: new Date() });
```

기존의 `const gated = ...`부터 `if (url.pathname === '/route') ...`까지 두 줄은 위 블록으로 대체되므로 중복이 남지 않게 지운다.

- [ ] **Step 6: KV 바인딩을 추가한다**

`server/wrangler.toml`의 기존 `[[kv_namespaces]]` 블록 **아래**에 붙인다:

```toml
# 바깥 응답 캐시 — 블로그 24시간, 구글 14일. RATE 와 용도가 달라 따로 둔다
# npx wrangler kv namespace create CACHE
[[kv_namespaces]]
binding = "CACHE"
id = "여기에_CACHE_KV_ID"
```

- [ ] **Step 7: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add server/src/enrich.ts server/src/enrich.test.ts server/src/index.ts server/wrangler.toml
git commit -m "feat: /enrich 라우트 — 캐시·예산·상위 10 선별

구글 과금을 세 겹으로 막는다. 캐시, 상위 10곳 제한, 월 900회 카운터.
콘솔 일일 할당량은 무료 체험판이라 못 걸어서 이게 유일한 코드 방어선이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 후보 30개 수집과 `stopKind` 전달

**Files:**
- Modify: `src/lib/corridorSearch.ts`, `src/lib/routePlan/types.ts`, `src/lib/places.ts`, `src/state/planFlow.ts`, `src/state/usePlanRequest.ts`, `src/state/plan.tsx`, `src/state/runPlan.ts`
- Test: `src/lib/corridorSearch.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `PlaceCandidate`에 `address?: string`, `signals?: PlaceSignals`
  - `Slot`에 `stopKind: 'brand' | 'category' | 'specific'`
  - `PlanRequest.stops[]`에 `stopKind`
  - `searchAlong(..., opts)` 가 `opts.max` 만큼 반환(기본 30)

- [ ] **Step 1: `corridorSearch` 테스트를 추가한다**

`src/lib/corridorSearch.test.ts` 끝에 붙인다:

```ts
test('need 를 채운 뒤에도 max 까지 준다 — 추천은 후보가 많아야 의미가 있다', async () => {
  const poly = [{ latitude: 37.5, longitude: 127.0 }, { latitude: 37.6, longitude: 127.0 }];
  // 샘플 점마다 12곳씩, 전부 다른 id
  let n = 0;
  const search: SearchFn = async () =>
    Array.from({ length: 12 }, () => {
      n++;
      return { id: `p${n}`, name: `가게${n}`, coord: { latitude: 37.5 + n * 0.0001, longitude: 127.0 } };
    });
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 1000, maxRadiusM: 4000, max: 30 }, search);
  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 30);
});

test('max 가 없으면 30 이 기본', async () => {
  const poly = [{ latitude: 37.5, longitude: 127.0 }, { latitude: 37.6, longitude: 127.0 }];
  let n = 0;
  const search: SearchFn = async () =>
    Array.from({ length: 12 }, () => {
      n++;
      return { id: `q${n}`, name: `가게${n}`, coord: { latitude: 37.5 + n * 0.0001, longitude: 127.0 } };
    });
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 1000, maxRadiusM: 4000 }, search);
  assert.equal(r.candidates.length, 30);
});

test('중복 id 는 한 번만 — 샘플 점이 겹쳐도 같은 가게가 두 번 오지 않는다', async () => {
  const poly = [{ latitude: 37.5, longitude: 127.0 }, { latitude: 37.6, longitude: 127.0 }];
  const search: SearchFn = async () => [
    { id: 'same', name: '한곳', coord: { latitude: 37.55, longitude: 127.0 } },
  ];
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 1000, maxRadiusM: 4000 }, search);
  assert.equal(r.candidates.length, 1);
});
```

파일 위쪽 import 에 `SearchFn` 타입이 없으면 `import { searchAlong, type SearchFn } from './corridorSearch.ts';` 로 맞춘다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: FAIL — `max` 옵션이 없어 타입 에러이거나 길이가 30이 아님

- [ ] **Step 3: `corridorSearch.ts` 를 고친다**

`CorridorSearchOptions`에 한 줄 추가:

```ts
  /** 최대 몇 개까지 돌려줄지. 추천 점수는 후보가 많아야 의미가 있다 */
  max?: number;
```

`searchAlong` 안의 `byCorridor`를 상한까지 자르게 바꾼다. 기존:

```ts
  const byCorridor = (list: PlaceCandidate[]) =>
    [...list].sort((a, b) => crossTrack(a.coord, poly).distanceM - crossTrack(b.coord, poly).distanceM);
```

새로:

```ts
  const max = opts.max ?? 30;
  const byCorridor = (list: PlaceCandidate[]) =>
    [...list]
      .sort((a, b) => crossTrack(a.coord, poly).distanceM - crossTrack(b.coord, poly).distanceM)
      .slice(0, max);
```

`far` 분기의 `.slice(0, 3)`은 그대로 둔다 — 회랑 밖에서 억지로 끌어온 결과라 많이 보여줄 이유가 없다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/corridorSearch.test.ts`
Expected: PASS

- [ ] **Step 5: 타입을 넓힌다**

`src/lib/routePlan/types.ts` — `PlaceCandidate`에 두 줄 추가:

```ts
export type PlaceCandidate = {
  id: string;
  name: string;
  coord: LatLng;
  /** 분 단위 하루 시각. 없으면 항상 열려 있다고 본다 */
  hours?: { openMin: number; closeMin: number };
  parking?: '가능' | '어려움' | '없음';
  /** 카카오 address_name. /enrich 요청에 싣는다 */
  address?: string;
  /** /enrich 가 붙인 바깥 신호. 없으면 보강을 안 했거나 실패한 것 */
  signals?: import('../enrich/types').PlaceSignals;
};
```

`Slot`에 한 줄 추가(`searchStatus?` 위):

```ts
  /** 추출이 정한 경유지 종류. 'category' 일 때만 보강·추천이 돈다 */
  stopKind: 'brand' | 'category' | 'specific';
```

- [ ] **Step 6: 주소를 싣는다**

`src/lib/places.ts`의 `planSearchFn` 안에서 `Place`를 `PlaceCandidate`로 바꾸는 자리에 `address`를 넘긴다. 해당 부분을 `sed -n '255,275p' src/lib/places.ts`로 확인하고, 매핑 객체에 `address: p.address` 를 추가한다.

- [ ] **Step 7: `stopKind` 를 앱 전체로 흘린다**

`src/state/plan.tsx`:
- 칩 타입(27번째 줄 근처)을 바꾼다.
  ```ts
  | { id: string; kind: 'stop'; label: string; queries: string[]; stopKind: 'brand' | 'category' | 'specific' }
  ```
- 칩을 만드는 두 곳(`initState`의 `seedChips.map`, 리듀서의 `chips.push`)에 `stopKind: st.kind` 를 추가한다. `extractIntent`가 주는 `IntentStop.kind`가 그 값이다.

`src/state/planFlow.ts` — `PlanRequest.stops` 타입에 추가:

```ts
  stops: { id: string; query: string; count: number; flexible: boolean; openNow: boolean; stopKind: 'brand' | 'category' | 'specific' }[];
```

`src/state/usePlanRequest.ts` — `.map` 안에 추가:

```ts
      .map(c => ({
        id: c.id,
        query: c.kind === 'stop' ? c.queries[0] : '',
        count: 1,
        flexible: true,
        openNow: false,
        // 옛 상태에 stopKind 가 없을 수 있다 — 업종으로 본다(보강이 도는 쪽이 기본)
        stopKind: (c.kind === 'stop' ? c.stopKind : undefined) ?? 'category',
      }));
```

`src/state/runPlan.ts` — 슬롯을 만드는 자리에서 상한을 30으로 올리고 `stopKind`를 싣는다. 기존 한 줄:

```ts
          id: st.id, query: st.query, candidates: applyParkingPolicy(found.candidates, request.mode).slice(0, 8), dwellMin: dwellFor(st.query),
```

새로:

```ts
          id: st.id, query: st.query, stopKind: st.stopKind,
          candidates: applyParkingPolicy(found.candidates, request.mode).slice(0, MAX_CANDIDATES), dwellMin: dwellFor(st.query),
```

파일 위쪽 `DEFAULT_TIMEOUT_MS` 옆에 상수를 둔다:

```ts
/** 슬롯당 후보 상한. 플래너는 추정만 하므로 늘려도 /route 호출은 안 는다 */
const MAX_CANDIDATES = 30;
```

- [ ] **Step 8: `runPlan` 테스트를 추가한다**

`src/state/runPlan.test.ts` 끝에 붙인다. 기존 테스트의 헬퍼 이름(`ready()` 등)을 먼저 읽고 그 스타일에 맞춘다.

```ts
test('후보가 30개여도 실측 호출 수는 8개일 때와 같다', async () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
    }));
  const run = async (n: number) => {
    let routeCalls = 0;
    const provider = {
      route: async (points: { latitude: number; longitude: number }[]) => {
        routeCalls++;
        return {
          durationMin: 10 * (points.length - 1), distanceKm: 5 * (points.length - 1),
          polyline: points, sections: points.slice(1).map(() => ({ durationMin: 10, distanceKm: 5 })),
        };
      },
    };
    const actions: { type: string }[] = [];
    await runPlan(
      {
        origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.6, longitude: 127.0 },
        originName: '출발', destinationName: '도착', mode: 'car', arriveByMin: null, departAtMin: 540,
        stops: [{ id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: 'category' }],
        order: 'auto',
      },
      { provider, search: async () => make(n), dispatch: a => actions.push(a) },
    );
    assert.ok(actions.some(a => a.type === 'RESULT'), '결과가 나와야 한다');
    return routeCalls;
  };
  assert.equal(await run(30), await run(8));
});
```

- [ ] **Step 9: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

타입 에러가 나는 곳(`Slot`을 만드는 테스트·목 데이터)에 `stopKind: 'category'`를 채운다.

- [ ] **Step 10: 커밋**

```bash
git add src/lib/corridorSearch.ts src/lib/corridorSearch.test.ts src/lib/routePlan/types.ts src/lib/places.ts src/state/plan.tsx src/state/planFlow.ts src/state/usePlanRequest.ts src/state/runPlan.ts src/state/runPlan.test.ts
git commit -m "feat: 후보 30개 수집과 stopKind 전달

플래너는 추정만 하므로 후보를 늘려도 실측 호출은 늘지 않는다.
업종 슬롯을 구분해야 보강을 어디에 돌릴지 정할 수 있다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 앱에서 보강 호출과 기본 선택

**Files:**
- Create: `src/lib/enrich/enrichClient.ts`, `src/lib/enrich/mockEnrich.ts`
- Modify: `src/state/runPlan.ts`, `src/state/planFlowProvider.tsx`
- Test: `src/state/runPlan.test.ts`

**Interfaces:**
- Consumes: Task 1 타입, Task 3 `scoreTrend`
- Produces:
  - `type EnrichFn = (places: EnrichPlace[]) => Promise<Record<string, PlaceSignals>>`
  - `serverEnrichFn(opts: { baseUrl: string; appToken: string; deviceId: string; timeoutMs?: number }): EnrichFn`
  - `mockEnrichFn(): EnrichFn`
  - `RunPlanDeps`에 `enrich?: EnrichFn`

- [ ] **Step 1: 보강 클라이언트를 만든다**

`src/lib/enrich/enrichClient.ts`:

```ts
/**
 * 앱 → 서버 /enrich. 실패는 던지지 않고 빈 결과다 —
 * 보강은 있으면 좋은 것이지 계획을 막을 이유가 아니다.
 */
import type { EnrichPlace, EnrichResponse, PlaceSignals } from './types';

export type EnrichFn = (places: EnrichPlace[]) => Promise<Record<string, PlaceSignals>>;

/** 계획 전체 12초 안에서 이만큼만 기다린다 */
const DEFAULT_TIMEOUT_MS = 2_500;

export function serverEnrichFn(opts: {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  timeoutMs?: number;
}): EnrichFn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async places => {
    if (places.length === 0) return {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/enrich`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-token': opts.appToken,
          'x-device-id': opts.deviceId,
        },
        body: JSON.stringify({ places }),
        signal: ctrl.signal,
      });
      if (!res.ok) return {};
      const body = (await res.json()) as Partial<EnrichResponse>;
      return body.results && typeof body.results === 'object' ? body.results : {};
    } catch {
      return {};
    } finally {
      clearTimeout(timer);
    }
  };
}
```

- [ ] **Step 2: 목 보강을 만든다**

`src/lib/enrich/mockEnrich.ts`:

```ts
/**
 * 서버·키가 없을 때의 보강. 이름 해시로 결정적 값을 만든다 —
 * 시뮬레이터에서 같은 화면이 매번 같게 나와야 디자인을 점검할 수 있다.
 * 실제 값처럼 보이지만 실제가 아니다. source 는 항상 'kakao' 로 둬서
 * 개발 메뉴에서 진짜와 구분된다.
 */
import type { EnrichFn } from './enrichClient';
import type { PlaceSignals } from './types';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** 0~1 사이 결정적 난수 */
const unit = (s: string, salt: string) => (hash(s + salt) % 10_000) / 10_000;

const POPULAR = /카페|커피|베이커리|빵|디저트|브런치/;

export function mockEnrichFn(): EnrichFn {
  return async places => {
    const out: Record<string, PlaceSignals> = {};
    const fetchedAt = new Date().toISOString();
    for (const p of places) {
      const hot = POPULAR.test(p.name);
      const u = unit(p.name, 'blog');
      const weighted = hot ? 5 + u * 20 : u * 6;
      const g = unit(p.name, 'g');
      out[p.id] = {
        fetchedAt,
        blog: {
          weighted,
          count90d: Math.round(weighted * 1.6),
          latestDaysAgo: Math.round(u * 20),
          source: 'kakao',
        },
        // 5곳 중 1곳은 구글 신호가 없다 — 일부만 신호 있는 화면을 볼 수 있어야 한다
        google: hash(p.name) % 5 === 0 ? undefined : {
          rating: Math.round((3.8 + g * 0.9) * 10) / 10,
          ratingCount: 20 + Math.round(g * 380),
          hours: null,
          matchedName: p.name,
        },
      };
    }
    return out;
  };
}
```

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`src/state/runPlan.test.ts` 끝에 붙인다:

```ts
test('업종 슬롯이고 후보가 4개 이상이면 보강을 부른다', async () => {
  const seen: { id: string }[][] = [];
  await runTrend({ stopKind: 'category', n: 6, enrich: async ps => { seen.push(ps); return {}; } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 6);
});

test('브랜드 슬롯이면 보강을 부르지 않는다', async () => {
  let calls = 0;
  await runTrend({ stopKind: 'brand', n: 6, enrich: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
});

test('후보가 3개면 보강을 부르지 않는다 — 순서를 바꿔봐야 의미가 없다', async () => {
  let calls = 0;
  await runTrend({ stopKind: 'category', n: 3, enrich: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
});

test('보강이 실패해도 결과는 나온다', async () => {
  const actions = await runTrend({
    stopKind: 'category', n: 6,
    enrich: async () => { throw new Error('보강 실패'); },
  });
  assert.ok(actions.some(a => a.type === 'RESULT'));
});
```

그리고 같은 파일에 헬퍼를 둔다(기존 헬퍼 스타일을 먼저 읽고 이름이 겹치지 않게 한다):

```ts
async function runTrend(o: {
  stopKind: 'brand' | 'category' | 'specific';
  n: number;
  enrich?: (p: { id: string; name: string; address: string; lat: number; lng: number }[]) => Promise<Record<string, never>>;
}) {
  const provider = {
    route: async (points: { latitude: number; longitude: number }[]) => ({
      durationMin: 10 * (points.length - 1), distanceKm: 5 * (points.length - 1),
      polyline: points, sections: points.slice(1).map(() => ({ durationMin: 10, distanceKm: 5 })),
    }),
  };
  const actions: { type: string }[] = [];
  await runPlan(
    {
      origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.6, longitude: 127.0 },
      originName: '출발', destinationName: '도착', mode: 'car', arriveByMin: null, departAtMin: 540,
      stops: [{ id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: o.stopKind }],
      order: 'auto',
    },
    {
      provider,
      search: async () => Array.from({ length: o.n }, (_, i) => ({
        id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
      })),
      dispatch: a => actions.push(a),
      enrich: o.enrich as never,
    },
  );
  return actions;
}
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npx tsx --test src/state/runPlan.test.ts`
Expected: FAIL — `enrich` 가 `RunPlanDeps`에 없어 타입 에러

- [ ] **Step 5: `runPlan` 에 보강 단계를 넣는다**

`src/state/runPlan.ts` 위쪽에 import 와 상수를 추가한다:

```ts
import type { EnrichFn } from '../lib/enrich/enrichClient';
import { scoreTrend } from '../lib/trendScore';

/** 후보가 이보다 적으면 보강해도 순서가 안 바뀐다 */
const ENRICH_MIN_CANDIDATES = 4;
/** 마감이 없을 때, 트렌드 1위로 바꾸며 허용하는 추가시간 */
const TREND_SWAP_SLACK_MIN = 10;
```

`RunPlanDeps`에 한 줄 추가:

```ts
  /** 후보 보강. 없으면 보강 없이 진행한다 */
  enrich?: EnrichFn;
```

`dispatch({ type: 'SLOTS', slots });` **바로 앞**에 보강 단계를 넣는다:

```ts
    // 0.7 보강 — 업종 슬롯만. 실패해도 계획은 계속 간다
    if (deps.enrich) {
      const need = slots.filter(s => s.stopKind === 'category' && s.candidates.length >= ENRICH_MIN_CANDIDATES);
      if (need.length > 0) {
        try {
          const maps = await Promise.all(need.map(s =>
            deps.enrich!(s.candidates.map(c => ({
              id: c.id, name: c.name, address: c.address ?? '',
              lat: c.coord.latitude, lng: c.coord.longitude,
            })))));
          need.forEach((s, i) => {
            const m = maps[i];
            s.candidates = s.candidates.map(c => (m[c.id] ? { ...c, signals: m[c.id] } : c));
          });
        } catch {
          // 신호가 없을 뿐이다. 화면은 추가시간순으로 떨어진다
        }
      }
    }
```

`slots`가 `const`라 재할당이 막히면 `s.candidates = ...` 대신 `slots = slots.map(...)` 형태로 바꾸고 `let slots`로 선언을 맞춘다(이미 `let slots: Slot[]` 이다).

- [ ] **Step 6: 트렌드 1위로 기본 선택을 옮긴다**

`dispatch({ type: 'RESULT', result });` **바로 앞**에 넣는다:

```ts
    // 업종 슬롯에서 트렌드 1위가 시간 1위와 다르면 바꾼다.
    // 단 마감을 넘기면 안 바꾼다 — 추천은 제시간 도착보다 앞설 수 없다.
    for (const slot of slots) {
      if (slot.stopKind !== 'category') continue;
      const base = result.options[0];
      if (!base) continue;
      const idx = base.visits.findIndex(v => v.slotId === slot.id);
      if (idx < 0) continue;
      const current = base.visits[idx].candidate.id;
      const baseTiming = result.rescore(base.visits);

      const ranked = scoreTrend(slot.candidates.map(c => {
        const swapped = base.visits.map((vv, j) => (j === idx ? { ...vv, candidate: c } : vv));
        const t = result.rescore(swapped);
        return {
          id: c.id,
          addedMin: t.totalMin - baseTiming.totalMin,
          blog: c.signals?.blog ? { weighted: c.signals.blog.weighted } : undefined,
          google: c.signals?.google
            ? { rating: c.signals.google.rating, ratingCount: c.signals.google.ratingCount }
            : undefined,
        };
      }));

      const top = ranked[0];
      if (!top || top.id === current) continue;
      const cand = slot.candidates.find(c => c.id === top.id);
      if (!cand) continue;
      const swapped = base.visits.map((vv, j) => (j === idx ? { ...vv, candidate: cand } : vv));
      const t = result.rescore(swapped);
      const arriveOk = request.arriveByMin == null
        ? t.totalMin - baseTiming.totalMin <= TREND_SWAP_SLACK_MIN
        : request.departAtMin + t.totalMin <= request.arriveByMin;
      if (arriveOk) dispatch({ type: 'SET_OVERRIDE', optionIdx: 0, slotId: slot.id, candidateId: cand.id });
    }
```

타입은 확인했다(2026-09-12). `PlanResult.options: PlanOption[]`(`types.ts:99`), `PlanOption.visits: Visit[]`(`types.ts:67`), `PlanResult.rescore: (visits: Visit[]) => Rescored`(`types.ts:104`). 위 코드가 쓰는 이름 그대로다.

- [ ] **Step 7: 공급자를 붙인다**

`src/state/planFlowProvider.tsx`:

```ts
import { serverEnrichFn, type EnrichFn } from '../lib/enrich/enrichClient';
import { mockEnrichFn } from '../lib/enrich/mockEnrich';
```

`pickProvider()`가 `enrich`도 같이 고르게 바꾼다:

```ts
function pickProvider(): { provider: RouteProvider; usingServer: boolean; enrich: EnrichFn } {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
  const baseUrl = extra.serverUrl?.trim();
  const appToken = extra.appToken?.trim();
  if (baseUrl && appToken) {
    const deviceId = Constants.sessionId ?? 'unknown';
    return {
      provider: serverRouteProvider({ baseUrl, appToken, deviceId }),
      usingServer: true,
      enrich: serverEnrichFn({ baseUrl, appToken, deviceId }),
    };
  }
  return { provider: mockRouteProvider(), usingServer: false, enrich: mockEnrichFn() };
}
```

`start`의 `runPlan` 호출에 `enrich: deps.enrich` 를 추가한다:

```ts
      void runPlan(request, { provider: deps.provider, search: deps.search, enrich: deps.enrich, dispatch });
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add src/lib/enrich/enrichClient.ts src/lib/enrich/mockEnrich.ts src/state/runPlan.ts src/state/runPlan.test.ts src/state/planFlowProvider.tsx
git commit -m "feat: 앱에서 보강 호출하고 트렌드 1위를 기본 선택으로

보강 실패는 계획을 막지 않는다. 트렌드 1위로 바꾸는 건 마감 안일 때만 —
추천은 제시간 도착보다 앞설 수 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 후보 시트 정렬과 배지

**Files:**
- Modify: `src/data/mockData.ts`, `src/lib/candidateRank.ts`, `src/state/planFlowBridge.ts`
- Test: `src/lib/candidateRank.test.ts`

**Interfaces:**
- Consumes: Task 3 `scoreTrend`
- Produces:
  - `Candidate`에 `trend?: { score: number; reasons: string[]; hot: boolean }`
  - `CANDIDATE_SORTS = ['추천', '추가시간', '주차']`
  - `rankCandidates(candidates, sort)` — sort 0 이 추천
  - `sortsFor(mode: 'car' | 'walk' | 'transit', hasTrend: boolean): { label: string; sort: CandidateSort }[]`

- [ ] **Step 1: 테스트를 고쳐 쓴다**

`src/lib/candidateRank.test.ts`의 첫 테스트를 바꾸고 뒤에 추가한다:

```ts
test('탭 라벨은 추천·추가시간·주차', () => {
  assert.deepEqual([...CANDIDATE_SORTS], ['추천', '추가시간', '주차']);
});

test('추천 정렬은 trend.score 내림차순', () => {
  const list = [
    c('a', 5, 1, '가능', { trend: { score: 0.2, reasons: [], hot: false } }),
    c('b', 9, 1, '가능', { trend: { score: 0.9, reasons: [], hot: true } }),
    c('c', 1, 1, '가능', { trend: { score: 0.5, reasons: [], hot: false } }),
  ];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['b', 'c', 'a']);
});

test('trend 가 없는 후보는 추천 정렬에서 뒤로 간다', () => {
  const list = [
    c('a', 5, 1, '가능'),
    c('b', 9, 1, '가능', { trend: { score: 0.3, reasons: [], hot: false } }),
  ];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['b', 'a']);
});

test('주차 탭은 자동차일 때만, 추천 탭은 신호가 있을 때만', () => {
  assert.deepEqual(sortsFor('car', true).map(s => s.label), ['추천', '추가시간', '주차']);
  assert.deepEqual(sortsFor('transit', true).map(s => s.label), ['추천', '추가시간']);
  assert.deepEqual(sortsFor('car', false).map(s => s.label), ['추가시간', '주차']);
  assert.deepEqual(sortsFor('walk', false).map(s => s.label), ['추가시간']);
});
```

파일 위 import 에 `sortsFor` 를 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/candidateRank.test.ts`
Expected: FAIL — `sortsFor` 없음, 라벨 불일치

- [ ] **Step 3: `Candidate` 에 `trend` 를 추가한다**

`src/data/mockData.ts`의 `Candidate` 타입에 한 줄:

```ts
  /** /enrich 신호로 낸 추천 점수. 없으면 보강을 안 했거나 실패한 것 */
  trend?: { score: number; reasons: string[]; hot: boolean };
```

- [ ] **Step 4: `candidateRank.ts` 를 고친다**

```ts
export const CANDIDATE_SORTS = ['추천', '추가시간', '주차'] as const;
export type CandidateSort = 0 | 1 | 2;

const parkingRank: Record<Candidate['parking'], number> = { 가능: 0, 모름: 1, 어려움: 2, 없음: 3 };

const byAdded = (a: Candidate, b: Candidate) => a.addedMin - b.addedMin;
const keyFor: Record<CandidateSort, (c: Candidate) => number> = {
  // 점수는 클수록 좋다 — 다른 축과 방향을 맞추려고 음수로 뒤집는다.
  // trend 가 없으면 2(어떤 점수보다도 큰 값)라 항상 뒤로 간다
  0: c => (c.trend ? -c.trend.score : 2),
  1: c => c.addedMin,
  2: c => parkingRank[c.parking],
};

/**
 * 이 상황에서 보여줄 탭. 고를 수 없는 기준을 탭으로 두면 "왜 안 바뀌지"만 남는다.
 *   주차 — 자동차일 때만 의미가 있다
 *   추천 — 신호가 하나라도 있어야 한다(브랜드 슬롯은 보강을 안 한다)
 */
export function sortsFor(
  mode: 'car' | 'walk' | 'transit',
  hasTrend: boolean,
): { label: (typeof CANDIDATE_SORTS)[number]; sort: CandidateSort }[] {
  const out: { label: (typeof CANDIDATE_SORTS)[number]; sort: CandidateSort }[] = [];
  if (hasTrend) out.push({ label: '추천', sort: 0 });
  out.push({ label: '추가시간', sort: 1 });
  if (mode === 'car') out.push({ label: '주차', sort: 2 });
  return out;
}
```

`isSelectable`·`rankCandidates`는 그대로 둔다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx tsx --test src/lib/candidateRank.test.ts`
Expected: PASS

- [ ] **Step 6: 브리지에서 `trend` 를 채운다**

`src/state/planFlowBridge.ts`의 `slotCandidates`가 목록을 만든 뒤 점수를 붙이게 바꾼다. 함수 마지막 `return list;` 를 아래로 교체한다:

```ts
  // 신호가 하나라도 있으면 추천 점수를 붙인다. 없으면 trend 없이 그대로 —
  // 시트가 '추천' 탭을 숨기는 기준이 이것이다.
  const byId = new Map((slot?.candidates ?? []).map(c => [c.id, c]));
  const anySignal = [...byId.values()].some(c => c.signals?.blog || c.signals?.google);
  if (!anySignal) return list;

  const ranked = scoreTrend(list.map(c => {
    const src = byId.get(c.id);
    return {
      id: c.id,
      addedMin: c.addedMin,
      blog: src?.signals?.blog ? { weighted: src.signals.blog.weighted } : undefined,
      google: src?.signals?.google
        ? { rating: src.signals.google.rating, ratingCount: src.signals.google.ratingCount }
        : undefined,
    };
  }));
  const scoreById = new Map(ranked.map(r => [r.id, r]));

  return list.map(c => {
    const r = scoreById.get(c.id);
    if (!r) return c;
    return {
      ...c,
      trend: { score: r.score, reasons: r.reasons, hot: r.hot },
      // 부제를 근거로 바꾼다. 근거가 없으면(추가시간 0에 신호도 없음) 원래 문구를 남긴다
      note: r.reasons.length > 0 ? r.reasons.join(' · ') : c.note,
    };
  });
```

파일 위 import 에 추가한다:

```ts
import { scoreTrend } from '../lib/trendScore';
```

- [ ] **Step 7: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add src/data/mockData.ts src/lib/candidateRank.ts src/lib/candidateRank.test.ts src/state/planFlowBridge.ts
git commit -m "feat: 후보 시트 추천 정렬

고를 수 없는 기준은 탭으로 두지 않는다. 주차는 자동차일 때만,
추천은 신호가 있을 때만 보여준다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: 후보 시트 화면 — 배지와 더 보기

**시뮬레이터 확인이 필수인 작업이다.** 코드만 보고 "안 깨진다"고 말하지 않는다.

**Files:**
- Modify: `src/sheets/CandidateSheet.tsx`
- Modify: `src/data/mockData.ts` (목 카탈로그 보강)

**Interfaces:**
- Consumes: Task 9 `sortsFor`, `Candidate.trend`
- Produces: 없음(화면이 끝단)

- [ ] **Step 1: 시트에 탭·배지·더 보기를 넣는다**

`src/sheets/CandidateSheet.tsx`를 네 군데 고친다.

첫째, props 에 `mode` 를 받는다. 타입에 한 줄 추가한다:

```ts
  mode: 'car' | 'walk' | 'transit';
```

호출부는 `src/screens/OptionsScreen.tsx:210` 하나뿐이다(2026-09-12 확인). `currentId` 줄 아래에 한 줄 넣는다:

```tsx
        mode={state.mode}
```

`state.mode` 가 그 스코프에 없으면 같은 파일에서 mode 를 가진 변수를 찾아 넘긴다 — `grep -n "mode" src/screens/OptionsScreen.tsx | head`.

둘째, 탭 목록을 상황에 맞게 만든다. `const sorted = useMemo(...)` 위에 넣는다:

```tsx
  // 이 목록에서 고를 수 있는 탭만 만든다
  const hasTrend = shown.candidates.some(c => c.trend);
  const tabs = useMemo(() => sortsFor(mode, hasTrend), [mode, hasTrend]);
  // 탭 구성이 바뀌면 고른 인덱스가 범위를 벗어날 수 있다
  const tabIdx = Math.min(tabIdxRaw, tabs.length - 1);
  const sortIdx = tabs[tabIdx]?.sort ?? 1;
```

기존 `const [sortIdx, setSortIdx] = useState<CandidateSort>(0);` 를 아래로 바꾼다:

```tsx
  const [tabIdxRaw, setTabIdx] = useState(0);
```

`SegmentControl` 의 props 도 맞춘다:

```tsx
            <SegmentControl
              options={tabs.map(t => t.label)}
              value={tabIdx}
              onChange={setTabIdx}
              track={color.track}
              fontSize={14}
              padV={11}
            />
```

시트가 새로 열릴 때 첫 탭으로 되돌린다. 기존 `setExpandedId(null)` 이 있는 `useEffect` 안에 한 줄 추가:

```tsx
      setTabIdx(0);
      setShowAll(false);
```

셋째, 5개까지만 보이고 더 보기를 둔다. `const sorted = useMemo(...)` 아래에 추가:

```tsx
  const [showAll, setShowAll] = useState(false);
  const VISIBLE = 5;
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE);
  const hidden = sorted.length - visible.length;
```

`{sorted.map(cand => {` 를 `{visible.map(cand => {` 로 바꾸고, 그 `.map()` 이 닫힌 직후(ScrollView 안, 목록 끝)에 더 보기 행을 넣는다:

```tsx
            {hidden > 0 && (
              <Pressable
                onPress={() => {
                  haptic();
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowAll(true);
                }}
                style={{ paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={[type.action, { color: color.primary }]}>{hidden}곳 더 보기</Text>
              </Pressable>
            )}
```

넷째, "요즘 인기" 배지를 이름 옆에 넣는다. 펼친 카드와 접힌 카드 **둘 다** 이름 옆 배지 자리를 찾아, `cand.recommended && !isCurrent && <RecommendBadge />` 앞에 넣는다:

```tsx
                          {cand.trend?.hot && <HotBadge />}
                          {cand.trend?.hot ? null : cand.recommended && !isCurrent && <RecommendBadge />}
```

파일 아래쪽, 다른 배지 컴포넌트(`RecommendBadge`·`CurrentBadge`) 옆에 정의한다:

```tsx
/** 최근 블로그 언급이 많고 상위 3위 안인 후보. 도착 배지와 같은 모양 */
function HotBadge() {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: color.greenBg }}>
      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: color.green }}>
        요즘 인기
      </Text>
    </View>
  );
}
```

import 에 `sortsFor` 를 추가하고, `LayoutAnimation`·`Pressable` 이 이미 import 돼 있는지 확인한다.

- [ ] **Step 2: 목 카탈로그에 홍대 매장을 넣는다**

`src/data/mockData.ts`의 `CATALOG`(또는 `src/lib/places.ts`의 목 카탈로그 — `grep -n "const CATALOG" src/lib/places.ts src/data/mockData.ts`로 찾는다)에 서교동·동교동 좌표의 매장 12곳을 추가한다. 이름은 목이라는 게 드러나게 짓는다(실제 상호를 베끼면 목 데이터가 진짜인 척하게 된다).

```ts
  // 시뮬레이터에서 '후보 30개' 화면을 만들기 위한 목. 좌표는 서교동·동교동 일대
  { id: 'p-hd-01', name: '목베이커리 서교점', address: '서울 마포구 서교동', coord: { latitude: 37.5533, longitude: 126.9220 } },
  { id: 'p-hd-02', name: '목카페 동교', address: '서울 마포구 동교동', coord: { latitude: 37.5561, longitude: 126.9236 } },
  { id: 'p-hd-03', name: '목빵집 홍대입구역점', address: '서울 마포구 동교동', coord: { latitude: 37.5572, longitude: 126.9250 } },
  { id: 'p-hd-04', name: '목디저트 합정', address: '서울 마포구 서교동', coord: { latitude: 37.5497, longitude: 126.9139 } },
  { id: 'p-hd-05', name: '목커피 상수', address: '서울 마포구 상수동', coord: { latitude: 37.5478, longitude: 126.9224 } },
  { id: 'p-hd-06', name: '목브런치 연남', address: '서울 마포구 연남동', coord: { latitude: 37.5601, longitude: 126.9256 } },
  { id: 'p-hd-07', name: '목베이커리 망원', address: '서울 마포구 망원동', coord: { latitude: 37.5561, longitude: 126.9100 } },
  { id: 'p-hd-08', name: '목카페 홍대정문앞아주긴이름점', address: '서울 마포구 서교동', coord: { latitude: 37.5518, longitude: 126.9253 } },
  { id: 'p-hd-09', name: '목빵 서교', address: '서울 마포구 서교동', coord: { latitude: 37.5540, longitude: 126.9201 } },
  { id: 'p-hd-10', name: '목케이크 동교', address: '서울 마포구 동교동', coord: { latitude: 37.5585, longitude: 126.9270 } },
  { id: 'p-hd-11', name: '목커피 서교2', address: '서울 마포구 서교동', coord: { latitude: 37.5525, longitude: 126.9188 } },
  { id: 'p-hd-12', name: '목디저트 상수2', address: '서울 마포구 상수동', coord: { latitude: 37.5489, longitude: 126.9240 } },
```

카탈로그 항목 타입에 `address` 가 없으면 그 타입에도 추가한다.

- [ ] **Step 3: 타입 검사와 테스트**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 4: 시뮬레이터를 띄운다**

```bash
cd /Users/picpal/Desktop/workspace/duler && nohup npx expo start --dev-client --port 8081 > /tmp/metro.log 2>&1 &
```

```bash
xcrun simctl launch 32E7E297-E515-478B-8EB4-62E8AF4B069E com.etavia.app
```

앱이 없으면 먼저 설치한다:

```bash
xcrun simctl install 32E7E297-E515-478B-8EB4-62E8AF4B069E ios/build-sim/Build/Products/Debug-iphonesimulator/Etavia.app
```

- [ ] **Step 5: 최대 케이스를 화면으로 확인한다**

`mcp__Claude_Code_iOS_Simulator__control` 의 `attach` 로 패널을 먼저 열고, `screenshot`·`tap` 으로 직접 확인한다. 한글 입력은 클립보드를 쓴다:

```bash
LANG=en_US.UTF-8 xcrun simctl pbcopy 32E7E297-E515-478B-8EB4-62E8AF4B069E <<< "홍대 들러서 빵집이랑 카페 가고 집에 갈래"
```

입력창을 길게 눌러 Paste 한다. 딥링크로 화면에 바로 갈 수도 있다:

```bash
xcrun simctl openurl 32E7E297-E515-478B-8EB4-62E8AF4B069E "etavia://options"
```

확인할 것, 전부 스크린샷을 남긴다:

1. 추천 탭이 첫 탭으로 선택돼 있고, 카드 부제가 "구글 4.4 (210) · 최근 블로그 9건 · +4분" 형태다.
2. 후보 5개 + "N곳 더 보기"가 보인다. 눌러서 30개가 다 나오고 스크롤이 끊기지 않는다.
3. "요즘 인기" 배지가 3개 이하로만 붙고, 이름이 긴 카드(`목카페 홍대정문앞아주긴이름점`)에서 줄바꿈이 깨지지 않는다.
4. 자동차 모드에서 탭이 3개(추천·추가시간·주차), 대중교통에서 2개(추천·추가시간)다. 모드는 칩으로 바꾼다.
5. 브랜드 슬롯("파리바게트")에서는 추천 탭이 없고 부제가 원래 문구다.
6. A5(추천 경로) 화면의 경유지 카드가 시트 1위와 같은 매장을 가리킨다.

- [ ] **Step 6: 화면에서 깨진 것을 고친다**

찾은 문제를 고치고 Step 5를 다시 돌린다. 고친 것과 스크린샷을 보고서에 적는다. 깨진 게 없으면 "확인함"이라고만 적지 말고 **무엇을 어떤 화면에서 봤는지** 적는다.

- [ ] **Step 7: 커밋**

```bash
git add src/sheets/CandidateSheet.tsx src/data/mockData.ts
git commit -m "feat: 후보 시트 요즘 인기 배지와 더 보기

30곳을 한 번에 쏟지 않는다. 5곳 보여주고 나머지는 눌러서 편다.
시뮬레이터에서 최대 케이스(후보 30개·긴 이름·브랜드 슬롯) 확인.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: 문서 정리

**Files:**
- Modify: `docs/NEXT.md`
- Modify: `server/wrangler.toml` (주석)

- [ ] **Step 1: `NEXT.md` 를 고친다**

"§5 남은 앱 작업"에 완료 항목을 적고, 스펙 §10의 미룬 것들을 옮긴다:

```markdown
### 트렌드 후보 추천 (완료 2026-09-12)

업종 검색일 때 후보 30곳에 네이버 블로그 최근 언급·구글 평점을 붙이고
경로 적합도와 합쳐 추천한다. 설계: `docs/superpowers/specs/2026-09-11-trend-candidates-design.md`

**운영 미결**

- 구글 일일 할당량 40을 아직 못 걸었다. 무료 체험판이라 콘솔의 "할당량 수정"이
  비활성이다. **유료 전환 직후 반드시 건다** — 기본값이 75,000/일이다.
  그전까지는 `/enrich` 의 월 900회 카운터가 유일한 방어선이다.
- `server/wrangler.toml` 의 KV id 두 개가 자리표시자다. 배포 전에 채운다.
  `npx wrangler kv namespace create RATE` / `... create CACHE`

**다음에 할 것**

- 지역 앵커: "강남 가는 길에 **홍대** 빵집"을 못 잡는다. `stops[].area` 를 추출
  스키마에 넣고 회랑 검색 중심을 그 지역으로 옮긴다. 케이스 시트에 문장을 넣고
  프롬프트 v4로 간다.
- 체험단 필터: 블로그 제목·요약의 "체험단·협찬·제공받아" 를 뺀다. 지금은
  광고성 글이 buzz 를 부풀린다.
- A2 되묻기: 업종 슬롯이고 후보 15곳 이상이면 "정해둔 곳 있어요?" 를 한 번 묻는다.
- 네이버 HUB 유료 전환 공지가 뜨면 단가를 확인하고 재검토한다.
- 인스타그램·쓰레드는 공식 API 로 상호별 언급 수를 셀 수 없다. 인스타 해시태그
  검색은 7일 30개 태그 한도, 쓰레드 키워드 검색은 토픽 태그 기준 알고리즘
  정렬이라 전수 집계가 안 된다.
```

- [ ] **Step 2: 전체 테스트와 타입 검사**

Run: `npm test && npx tsc --noEmit -p .`
Expected: 전부 PASS

- [ ] **Step 3: 커밋**

```bash
git add docs/NEXT.md
git commit -m "docs: 트렌드 후보 추천 완료와 남은 운영 과제

구글 일일 할당량은 유료 전환 직후 걸어야 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 | 태스크 |
|---|---|
| §0 `kind` 전달 | 7 |
| §1 후보 30개 | 7 |
| §2 `/enrich` 요청·응답 | 4, 6 |
| §2.1 네이버 블로그 | 5 |
| §2.1.2 카카오 보조 | **미구현** — 아래 참고 |
| §2.2 구글 Places·예산 | 5, 6 |
| §2.3 `placeMatch` | 2 |
| §3 점수·prescore·reasons·hot | 3 |
| §4 플래너 기본 선택 | 8 |
| §5 화면 | 9, 10 |
| §6 실패·폴백 | 6, 8 |
| §7 목 보강 | 8, 10 |
| §8 테스트 | 각 태스크 |
| §9 운영 요건 | 6(KV·시크릿), 11(문서) |
| §10 미루는 것 | 11 |

**의도적으로 뺀 것: 카카오 보조 블로그 경로(§2.1.2).** 네이버 HUB 키가 이미 발급돼 저장까지 끝났고(2026-09-12 확인), 카카오 경로는 커버리지가 얕아 실제로 쓸 일이 없다. 공급자 두 개를 처음부터 들고 가면 테스트와 분기만 두 배가 된다. `BlogSignal.source` 필드는 남겨 뒀으므로, 네이버가 유료로 바뀌어 카카오가 필요해지면 `server/src/kakaoBlog.ts` 하나를 추가하고 `enrich.ts`에서 키 유무로 고르면 된다. 이 결정을 Task 11에서 `NEXT.md`에 적는다.

**2. 자리표시자 점검**

"TBD"·"적절히 처리"·"테스트를 작성한다(코드 없이)" 없음. 모든 코드 스텝에 실제 코드가 있다. 다만 세 곳은 **기존 코드를 먼저 읽고 맞추라**고 명시했다: `haversineM` 시그니처(Task 2 Step 4), `PlanResult.options[].visits` 모양(Task 8 Step 6), `CandidateSheet` 호출부(Task 10 Step 1). 이건 자리표시자가 아니라 이 계획이 확인하지 못한 실제 코드에 대한 지시다.

**3. 타입 일관성**

- `BlogSignal`·`GoogleSignal`·`PlaceSignals` 는 `src/lib/enrich/types.ts`(앱)와 `server/src/enrichTypes.ts`(서버)에 같은 모양으로 두 벌 있다. 서버가 expo 를 물면 안 되기 때문이며, 두 파일 머리에 서로를 가리키는 주석을 넣는다.
- `EnrichPlace` 는 앱 `types.ts` 와 서버 `enrichSchema.ts` 양쪽에 있다. 같은 이유.
- `matchPlace`·`prescore` 는 서버가 `../../src/lib/` 에서 직접 import 한다(둘 다 순수 모듈이라 가능). 실패하면 복사로 떨어지는 경로를 Task 5 Step 7에 적었다.
- `CandidateSort` 는 0=추천, 1=추가시간, 2=주차로 바뀐다. `sortsFor` 가 라벨과 인덱스를 같이 주므로 시트는 `CandidateSort` 를 직접 세지 않는다.
- `Slot.stopKind` 는 필수 필드다. 기존 테스트·목에서 `Slot` 을 만드는 모든 곳이 타입 에러가 나므로 Task 7 Step 9에서 일괄로 채운다.
