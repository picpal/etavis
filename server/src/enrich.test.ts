import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEnrich, type EnrichEnv } from './enrich.ts';
import { normalizeName } from '../../src/lib/placeMatch.ts';

function memKV() {
  const m = new Map<string, string>();
  const puts = new Map<string, { expirationTtl?: number } | undefined>();
  return {
    store: m,
    /** 각 키에 마지막으로 전달된 put() 옵션(TTL 등) — TTL 값을 핀 고정하는 데 쓴다 */
    puts,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string, o?: { expirationTtl?: number }) => { m.set(k, v); puts.set(k, o); },
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
  kv.store.set('gbudget:2026-09', '900');
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
  assert.equal(kv.store.get('gbudget:2026-09'), '2');
});

test('두 번째 호출은 캐시에서 — 구글을 다시 부르지 않는다', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch({ google: true });
  await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  const before = calls.google;
  await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(calls.google, before);
});

// --- fix 3 재검토: 조건부 쓰기(current === reserved일 때만 내려쓴다) -----------------
// 처음엔 Math.max(current, used+spent)로 "절대 뒤로 가지 않게" 했었는데, 그러면 겹침이
// 없는 보통의 경우(반복 계획 → 캐시 대부분 적중)조차 current가 늘 이 요청 자신의
// 예약값과 같아 정정이 사실상 죽어 버렸다 — reserved(=used+attempting.length)가 항상
// used+spent보다 크거나 같으니 max가 매번 reserved만 골랐다. 캐시 히트가 대부분인
// 반복 계획에서 카운터가 실제 지출의 몇 배로 부풀어 예산이 실제보다 훨씬 일찍
// 바닥나는(그래서 이 기능이 실제 지출의 몇 배 이르게 조용히 꺼지는) 결과였다.
// 조건부 쓰기 — "내가 방금 쓴 예약이 그대로 남아 있을 때만" 내려쓴다 — 는 겹침이
// 없으면 정확히 실제 지출로 정정하고, 겹치면(다른 요청이 이미 자기 값을 써 놨으면)
// 그 값을 지우지 않는다. 아래 세 테스트가 그 세 갈래를 각각 확인한다.

test('fix3-a: 겹침 없음 + 캐시 히트 있음 → 카운터가 실제 지출로 정정된다', async () => {
  const kv = memKV();
  // k0는 이미 캐시된 것으로 미리 채워둔다 — 이번 요청에서는 캐시 히트라 업스트림을 부르지 않아야 한다
  kv.store.set(`gplace:k0:${normalizeName('가게k0')}`, JSON.stringify({
    v: { rating: 4.0, ratingCount: 10, hours: null, matchedName: '가게k0' },
  }));
  const { f, calls } = mockFetch({ google: true });
  const res = await handleEnrich({ places: [place('k0'), place('k1')] }, env(kv), { fetch: f, now: NOW });
  // k0는 캐시 히트, k1만 신규 호출 — 실제 업스트림 호출은 1회뿐이다
  assert.equal(calls.google, 1);
  // 겹치는 요청이 없으므로 예약(2)이 그대로 남아 있다가 실제 지출(1)로 정정돼야 한다.
  assert.equal(kv.store.get('gbudget:2026-09'), '1', '겹침이 없으면 실제 지출로 내려가야 한다');
  const body = await res.json() as { budget: { googleUsed: number } };
  assert.equal(body.budget.googleUsed, 1);
});

test('fix3-b: 겹침 있음(다른 요청이 그 사이 더 큰 값을 씀) → 내 정정을 건너뛰고 그 값을 지키지 않는다', async () => {
  const kv = memKV();
  const realGet = kv.get.bind(kv);
  const realPut = kv.put.bind(kv);
  let budgetGets = 0;
  kv.get = (async (k: string) => {
    if (k === 'gbudget:2026-09') {
      budgetGets++;
      // 정정 직전 재읽기(2번째 호출) 시점에 "그 사이 겹치는 다른 요청이 실제로 자신의
      // 값(5)을 써 놓았다"를 재현한다 — 페이크 반환값이 아니라 실제 store에 써서,
      // 이 요청이 그 값을 지우지 않는지(진짜로 store에 남는지)를 검증한다.
      if (budgetGets === 2) {
        await realPut(k, '5', { expirationTtl: 1 });
        return '5';
      }
    }
    return realGet(k);
  }) as typeof kv.get;

  const { f } = mockFetch({ google: true });
  const res = await handleEnrich({ places: [place('k0'), place('k1')] }, env(kv), { fetch: f, now: NOW });

  // k0·k1 둘 다 신규 호출(used(0)+spent(2)=2)이라 이 요청 혼자라면 2를 쓰고 싶어 하지만,
  // 재읽은 현재값(5)이 이 요청의 예약(2)과 다르므로 손대지 않고 5가 그대로 남아야 한다.
  assert.equal(kv.store.get('gbudget:2026-09'), '5', '겹치는 다른 요청의 값을 지우면 안 된다');
  const body = await res.json() as { budget: { googleUsed: number } };
  assert.equal(body.budget.googleUsed, 5, '응답도 방금 읽은 최신값(5)을 보고해야 한다');
});

test('fix3-c: 캐시 미스만 있음(정정 불필요) → 카운터는 예약값에 머물고 두 번째 쓰기가 없다', async () => {
  const kv = memKV();
  let budgetPuts = 0;
  const realPut = kv.put.bind(kv);
  kv.put = (async (k: string, v: string, o?: { expirationTtl?: number }) => {
    if (k === 'gbudget:2026-09') budgetPuts++;
    return realPut(k, v, o);
  }) as typeof kv.put;

  const { f } = mockFetch({ google: true });
  const res = await handleEnrich({ places: [place('k0'), place('k1')] }, env(kv), { fetch: f, now: NOW });

  // 캐시 미스만 있으므로 spent === attempting.length(2) — 정정이 필요 없다.
  assert.equal(kv.store.get('gbudget:2026-09'), '2');
  assert.equal(budgetPuts, 1, '예약 쓰기 한 번뿐이어야 한다 — 정정이 불필요하면 두 번째 쓰기가 없어야 한다');
  const body = await res.json() as { budget: { googleUsed: number } };
  assert.equal(body.budget.googleUsed, 2);
});

test('장소 id가 예산 키 모양이어도 카운터를 건드리지 않는다', async () => {
  const kv = memKV();
  const { f } = mockFetch({ google: true });
  // 공격자가 고를 수 있는 place.id — 예산 키(gbudget:2026-09)와 헷갈리게 만든 값
  const evil = place('budget:2026-09');
  const normal = place('k1');
  await handleEnrich({ places: [evil, normal] }, env(kv), { fetch: f, now: NOW });

  // 예산 카운터는 정확히 숫자 문자열이어야 한다 — 두 곳 모두 캐시 미스라 실제 호출 2회
  assert.equal(kv.store.get('gbudget:2026-09'), '2');

  // evil place의 캐시 항목은 예산 키와 별도 키(gplace:evil.id:정규화이름)에 실제 신호 JSON으로 존재해야 한다
  const evilCacheRaw = kv.store.get(`gplace:${evil.id}:${normalizeName(evil.name)}`);
  assert.ok(evilCacheRaw, 'evil place의 캐시가 예산 키에 겹쳐 쓰이지 않아야 한다');
  const parsed = JSON.parse(evilCacheRaw!) as { v: unknown };
  assert.ok(parsed.v && typeof parsed.v === 'object');
});

test('room 이 원하는 후보 수보다 작으면 배열 순서가 아니라 prescore 순위 상위부터 채운다', async () => {
  const kv = memKV();
  kv.store.set('gbudget:2026-09', '895'); // room = 900 - 895 = 5
  const googleQueries: string[] = [];
  const f = (async (u: unknown, init?: unknown) => {
    const url = String(typeof u === 'string' ? u : (u as Request).url ?? u);
    if (url.includes('naverapihub')) {
      const q = new URL(url).searchParams.get('query') ?? '';
      // k10에만 최근 글을 몰아줘서 buzz로 prescore 순위를 역전시킨다(맨 뒤 인덱스인데도 상위권)
      const boosted = q === '가게k10';
      return new Response(JSON.stringify({
        total: 300,
        items: boosted ? Array.from({ length: 15 }, () => ({ postdate: '20260912' })) : [],
      }), { status: 200 });
    }
    const bodyStr = (init as { body?: string } | undefined)?.body ?? '{}';
    const name = (JSON.parse(bodyStr) as { textQuery?: string }).textQuery ?? '';
    googleQueries.push(name);
    return new Response(JSON.stringify({
      places: [{ displayName: { text: name }, location: { latitude: 37.55, longitude: 126.92 }, rating: 4.0, userRatingCount: 50 }],
    }), { status: 200 });
  }) as unknown as typeof fetch;

  // 11곳(prescore 상위 10 제한이 실제로 정렬해서 자르는 경로를 타게)
  const places = Array.from({ length: 11 }, (_, i) => place(`k${i}`));
  await handleEnrich({ places }, env(kv), { fetch: f, now: NOW });

  // prescore 순위(적합도+buzz)는 k0,k1,k2,k3,k10,k4,k5,k6,k7,k8 순 — k9는 하위 10위 밖.
  // room=5 라면 순위 상위 5곳(k0~k3, k10)을 물어야 한다. 배열 순서 그대로 앞 5개
  // (k0~k4)를 자르면 k10 대신 k4가 뽑혀 버린다 — 예산이 부족한 상황일수록 정확해야
  // 하는 지점이라 여기서 틀리면 안 된다.
  assert.equal(googleQueries.length, 5);
  assert.deepEqual(new Set(googleQueries), new Set(['가게k0', '가게k1', '가게k2', '가게k3', '가게k10']));
});

test('블로그 캐시는 24시간(86400초), 구글 캐시는 14일(1209600초) TTL로 저장된다', async () => {
  const kv = memKV();
  const { f } = mockFetch({ google: true });
  await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  assert.equal(kv.puts.get('blog:k0')?.expirationTtl, 86400);
  assert.equal(kv.puts.get(`gplace:k0:${normalizeName('가게k0')}`)?.expirationTtl, 1209600);
});

test('구글 예산 카운터도 TTL로 저장된다 — 월 키가 KV에 무한히 쌓이지 않게', async () => {
  const kv = memKV();
  const { f } = mockFetch({ google: true });
  await handleEnrich({ places: [place('k0')] }, env(kv), { fetch: f, now: NOW });
  const ttl = kv.puts.get('gbudget:2026-09')?.expirationTtl;
  assert.ok(ttl !== undefined && ttl > 31 * 24 * 60 * 60, `한 달(31일)보다는 넉넉해야 하는데 ${ttl}`);
});

test('구글 키가 없으면 구글을 부르지 않는다', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch({ google: true });
  const res = await handleEnrich(
    { places: [place('k0')] },
    env(kv, { GOOGLE_PLACES_KEY: undefined }),
    { fetch: f, now: NOW },
  );
  assert.equal(calls.google, 0);
  const body = await res.json() as { results: Record<string, { google?: unknown }> };
  assert.equal(body.results.k0.google, undefined);
});

test('캐시 쓰기가 실패해도 요청은 200 이고 예약분은 카운터에 남는다', async () => {
  const kv = memKV();
  const { f } = mockFetch({ google: true });
  let gplacePuts = 0;
  const realPut = kv.put.bind(kv);
  // KV 쓰기 장애를 흉내낸다 — 두 번째 구글 캐시 쓰기에서 죽는다(인프라 장애 시뮬레이션)
  kv.put = (async (k: string, v: string, o?: { expirationTtl?: number }) => {
    if (k.startsWith('gplace:')) {
      gplacePuts++;
      if (gplacePuts === 2) throw new Error('KV 쓰기 실패(시뮬레이션)');
    }
    return realPut(k, v, o);
  }) as typeof kv.put;

  const places = Array.from({ length: 3 }, (_, i) => place(`k${i}`));
  // 마감 래퍼가 개별 호출의 실패를 '신호 없음'으로 흡수한다 — 부분 실패는 실패가 아니다.
  // 예전엔 여기서 요청 전체가 죽었다(assert.rejects). 캐시 쓰기 한 번 실패했다고
  // 나머지 두 후보의 신호까지 버릴 이유가 없다.
  const res = await handleEnrich({ places }, env(kv), { fetch: f, now: NOW });
  assert.equal(res.status, 200);
  const body = await res.json() as { results: Record<string, { google?: unknown }> };
  assert.ok(body.results.k0.google, '쓰기가 성공한 후보의 신호는 살아있다');

  // 호출은 3회 다 나갔다(spent 3 == 예약 3). 쓰기가 실패한 후보의 몫도 실제로 과금됐으므로
  // 카운터는 예약값 그대로 남아야 한다 — 지출을 잊으면 안 된다.
  const stored = Number(kv.store.get('gbudget:2026-09'));
  assert.equal(stored, 3);
});

// (예전 "정정이 겹치는 요청의 더 큰 예약을 지우지 않는다" 테스트는 위 fix3-a/b/c로
// 대체됐다 — Math.max 버전을 검증하던 테스트라 조건부 쓰기로 바뀌면서 페이크 get()
// 응답이 실제 store에 반영되지 않는다는 점이 드러났다. fix3-b가 실제 store에 값을
// 써서 같은 시나리오를 물리적으로 더 정확하게 재현한다.)

test('후보가 12곳을 넘으면 블로그는 12곳만 묻는다 — 앞 8곳은 반드시 포함', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch();
  const places = Array.from({ length: 30 }, (_, i) => place(`p${i}`));
  const res = await handleEnrich({ places }, env(kv), { fetch: f, now: NOW });
  assert.equal(calls.naver, 12);
  const body = await res.json() as { results: Record<string, { blogQueried?: boolean }> };
  // 회랑 거리순 앞 8곳은 전부 물어본다
  for (let i = 0; i < 8; i++) assert.equal(body.results[`p${i}`].blogQueried, true, `p${i}`);
  // 나머지 4곳은 뒤쪽에서 고르게 뽑는다 — 가까운 순으로만 몰리지 않는다
  const queried = places.filter(p => body.results[p.id].blogQueried).map(p => p.id);
  assert.equal(queried.length, 12);
  assert.ok(queried.some(id => Number(id.slice(1)) >= 20), `뒤쪽 후보가 없다: ${queried}`);
});

test('후보가 12곳 이하면 전부 묻는다', async () => {
  const kv = memKV();
  const { f, calls } = mockFetch();
  const places = Array.from({ length: 12 }, (_, i) => place(`p${i}`));
  const res = await handleEnrich({ places }, env(kv), { fetch: f, now: NOW });
  assert.equal(calls.naver, 12);
  const body = await res.json() as { results: Record<string, { blogQueried?: boolean }> };
  for (const p of places) assert.equal(body.results[p.id].blogQueried, true);
});

test('블로그를 안 물어본 후보는 blogQueried 가 없다', async () => {
  const kv = memKV();
  const { f } = mockFetch();
  const places = Array.from({ length: 30 }, (_, i) => place(`p${i}`));
  const res = await handleEnrich({ places }, env(kv), { fetch: f, now: NOW });
  const body = await res.json() as { results: Record<string, { blogQueried?: boolean }> };
  const notQueried = places.filter(p => !body.results[p.id].blogQueried);
  assert.equal(notQueried.length, 18);
});

/** 지정한 지연 뒤에 응답하는 목 — 마감 동작을 보려고 쓴다 */
function slowFetch(delayMs: number) {
  const calls = { naver: 0, google: 0 };
  const f = (async (u: unknown) => {
    const url = String(typeof u === 'string' ? u : (u as Request).url ?? u);
    const isNaver = url.includes('naverapihub');
    if (isNaver) calls.naver++; else calls.google++;
    await new Promise(r => setTimeout(r, delayMs));
    if (isNaver) {
      return new Response(JSON.stringify({ total: 300, items: [{ postdate: '20260912' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      places: [{ displayName: { text: '가게p0' }, location: { latitude: 37.55, longitude: 126.92 }, rating: 4.4, userRatingCount: 120 }],
    }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('budgetMs 마감을 넘긴 호출은 버리고 끝난 것만 돌려준다 — 전부 아니면 전무가 아니다', async () => {
  const kv = memKV();
  const { f } = slowFetch(3_000);
  const places = Array.from({ length: 30 }, (_, i) => place(`p${i}`));
  const t0 = Date.now();
  const res = await handleEnrich({ places, budgetMs: 800 }, env(kv), { fetch: f, now: NOW });
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 200);
  assert.ok(elapsed < 1_500, `마감을 못 지켰다: ${elapsed}ms`);
  const body = await res.json() as {
    results: Record<string, { blog?: unknown; blogQueried?: boolean }>;
    budget: { googleUsed: number };
  };
  // 물어본 사실은 남고, 마감에 걸린 신호는 빠진다
  assert.equal(body.results.p0.blogQueried, true);
  assert.equal(body.results.p0.blog, undefined);
  assert.ok(typeof body.budget.googleUsed === 'number');
});

test('budgetMs 가 넉넉하면 느린 응답도 기다린다', async () => {
  const kv = memKV();
  const { f } = slowFetch(200);
  const places = Array.from({ length: 4 }, (_, i) => place(`p${i}`));
  const res = await handleEnrich({ places, budgetMs: 4_000 }, env(kv), { fetch: f, now: NOW });
  const body = await res.json() as { results: Record<string, { blog?: unknown }> };
  assert.ok(body.results.p0.blog, '신호가 와야 한다');
});

test('블로그가 마감을 다 써도 구글 몫은 남는다 — 단계별로 예산을 나눈다', async () => {
  const kv = memKV();
  // 블로그는 마감을 넘기고(1초), 구글은 빠르다. 단계가 나뉘어 있지 않으면
  // 블로그가 예산을 다 먹어 구글이 아예 안 불린다
  const calls = { naver: 0, google: 0 };
  const f = (async (u: unknown) => {
    const url = String(typeof u === 'string' ? u : (u as Request).url ?? u);
    if (url.includes('naverapihub')) {
      calls.naver++;
      await new Promise(r => setTimeout(r, 1_000));
      return new Response(JSON.stringify({ total: 300, items: [{ postdate: '20260912' }] }), { status: 200 });
    }
    calls.google++;
    return new Response(JSON.stringify({
      places: [{ displayName: { text: '가게p0' }, location: { latitude: 37.55, longitude: 126.92 }, rating: 4.4, userRatingCount: 120 }],
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const places = Array.from({ length: 6 }, (_, i) => place(`p${i}`));
  const res = await handleEnrich({ places, budgetMs: 900 }, env(kv), { fetch: f, now: NOW });
  const body = await res.json() as { results: Record<string, { google?: unknown }> };
  assert.ok(calls.google > 0, '구글이 굶었다');
  assert.ok(body.results.p0.google, '구글 신호가 와야 한다');
});
