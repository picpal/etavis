import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleEnrich, type EnrichEnv } from './enrich.ts';

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

test('예산 카운터는 캐시 히트를 세지 않는다 — 신규 호출 수만큼만 오른다', async () => {
  const kv = memKV();
  // k0는 이미 캐시된 것으로 미리 채워둔다 — 이번 요청에서는 캐시 히트라 업스트림을 부르지 않아야 한다
  kv.store.set('gplace:k0', JSON.stringify({
    v: { rating: 4.0, ratingCount: 10, hours: null, matchedName: '가게k0' },
  }));
  const { f, calls } = mockFetch({ google: true });
  const res = await handleEnrich({ places: [place('k0'), place('k1')] }, env(kv), { fetch: f, now: NOW });
  // k0는 캐시 히트, k1만 신규 호출 — 후보는 2곳이지만 실제 업스트림 호출은 1회뿐이다
  assert.equal(calls.google, 1);
  assert.equal(kv.store.get('gbudget:2026-09'), '1');
  const body = await res.json() as { budget: { googleUsed: number } };
  assert.equal(body.budget.googleUsed, 1);
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

  // evil place의 캐시 항목은 예산 키와 별도 키(gplace:evil.id)에 실제 신호 JSON으로 존재해야 한다
  const evilCacheRaw = kv.store.get(`gplace:${evil.id}`);
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
  assert.equal(kv.puts.get('gplace:k0')?.expirationTtl, 1209600);
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

test('루프 중간에 죽어도 예약분은 남는다 — 이미 만든 호출을 잊지 않는다', async () => {
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
  await assert.rejects(handleEnrich({ places }, env(kv), { fetch: f, now: NOW }));

  // 루프는 두 번째 후보에서 죽었다(실제로는 최소 2회 호출이 이미 나갔다). 예약은
  // 루프 시작 전에 attempting.length(3)만큼 이미 적혀 있으므로, 죽더라도 카운터가
  // 0(아무것도 안 쓴 것처럼)으로 남지 않고 예약된 값을 유지해야 한다.
  const stored = Number(kv.store.get('gbudget:2026-09'));
  assert.equal(stored, 3);
});
