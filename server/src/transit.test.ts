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

test('키 없으면 500 — 공급자를 안 부르고 일일 카운터도 안 건드린다', async () => {
  const e = { CACHE: kv(), RATE: kv() }; // GOOGLE_ROUTES_KEY·GOOGLE_PLACES_KEY 둘 다 없음
  const { f, calls } = fakeFetch(200, fixture);
  const res = await handleTransit(body, e, { fetch: f, now });
  assert.equal(res.status, 500);
  assert.equal(((await res.json()) as { error: string; provider: string }).provider, 'google');
  assert.equal(calls.length, 0);
  assert.equal(e.RATE.m.size, 0);
});

test('alternatives 는 캐시 키에서 빠진다 — 3개로 받은 뒤 1개 요청은 상류를 다시 안 부르고 자른다', async () => {
  const e = env();
  const { f, calls } = fakeFetch(200, fixture);
  const r1 = await handleTransit(body, e, { fetch: f, now });
  assert.equal(r1.status, 200);
  const j1 = (await r1.json()) as { itineraries: unknown[] };
  assert.equal(j1.itineraries.length, 2); // 픽스처엔 중복 제거 후 2개뿐이라 기본값(3)도 2개까지만 옴

  const r2 = await handleTransit({ ...body, alternatives: 1 }, e, { fetch: f, now });
  assert.equal(r2.status, 200);
  const j2 = (await r2.json()) as { itineraries: unknown[] };
  assert.equal(j2.itineraries.length, 1);
  assert.equal(calls.length, 1); // 캐시 히트 — 상류를 다시 안 부름
});
