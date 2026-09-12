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
