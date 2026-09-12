import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverEnrichFn } from './enrichClient.ts';
import type { EnrichPlace, PlaceSignals } from './types.ts';

const place: EnrichPlace = { id: 'p1', name: '카페', address: '서울시 어딘가', lat: 37.5, lng: 127.0 };

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('요청 형식 — /enrich에 헤더·places를 그대로 싣는다', async () => {
  const results: Record<string, PlaceSignals> = { p1: { fetchedAt: 't', google: { rating: 4.5, ratingCount: 10, hours: null, matchedName: '카페' } } };
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: { results, budget: { googleUsed: 1, googleLeft: 99 } } }));
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'dev1', fetchFn: fn });
  const out = await enrich([place]);
  assert.equal(calls[0].url, 'https://x.test/enrich');
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h['x-app-token'], 'T');
  assert.equal(h['x-device-id'], 'dev1');
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.places, [place]);
  assert.deepEqual(out, results);
});

test('빈 places면 fetch를 부르지 않고 빈 결과를 준다', async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: { results: {} } }));
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: fn });
  const out = await enrich([]);
  assert.deepEqual(out, {});
  assert.equal(calls.length, 0);
});

test('응답이 200이 아니면 몸통이 멀쩡해도 빈 결과 — 상태코드를 본다', async () => {
  // body 자체는 유효한 결과 모양이다 — !res.ok 체크가 없으면 이 값이 그대로 나가 버린다
  const goodShapedBody = { results: { p1: { fetchedAt: 't' } }, budget: { googleUsed: 0, googleLeft: 1 } };
  const { fn } = fakeFetch(() => ({ status: 502, body: goodShapedBody }));
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: fn });
  const out = await enrich([place]);
  assert.deepEqual(out, {});
});

test('results 모양이 이상해도(없거나 객체가 아니면) 빈 결과', async () => {
  const { fn } = fakeFetch(() => ({ status: 200, body: { nope: 1 } }));
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: fn });
  const out = await enrich([place]);
  assert.deepEqual(out, {});
});

test('fetch가 던져도 빈 결과 — 던지지 않는다', async () => {
  const throwing = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: throwing });
  await assert.doesNotReject(async () => {
    const out = await enrich([place]);
    assert.deepEqual(out, {});
  });
});

test('2.5초(기본)가 지나면 AbortSignal이 실제로 발동한다 — race가 아니라 abort', async () => {
  let sawSignal: AbortSignal | undefined;
  let abortedAt: 'before-timeout' | 'after-timeout' | 'never' = 'never';
  const hanging = (async (_url: string, init: RequestInit) => {
    sawSignal = init.signal as AbortSignal;
    return new Promise<Response>((resolve, reject) => {
      sawSignal!.addEventListener('abort', () => {
        abortedAt = 'after-timeout';
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }) as unknown as typeof fetch;
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: hanging, timeoutMs: 20 });
  const out = await enrich([place]);
  assert.ok(sawSignal, 'fetch가 AbortSignal을 받아야 한다');
  assert.equal(sawSignal!.aborted, true, '타임아웃 뒤에는 신호가 발동돼 있어야 한다');
  assert.equal(abortedAt, 'after-timeout', 'fetch 쪽 abort 리스너가 실제로 불려야 한다 — race만으로는 이게 안 된다');
  assert.deepEqual(out, {});
});

test('timeoutMs 안에 끝나면 abort는 발동하지 않는다', async () => {
  let sawSignal: AbortSignal | undefined;
  const fast = (async (_url: string, init: RequestInit) => {
    sawSignal = init.signal as AbortSignal;
    return { ok: true, status: 200, json: async () => ({ results: {} }) } as Response;
  }) as unknown as typeof fetch;
  const enrich = serverEnrichFn({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: fast, timeoutMs: 2_500 });
  await enrich([place]);
  assert.equal(sawSignal!.aborted, false);
});
