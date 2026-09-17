import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackRouteProvider } from './fallbackProvider.ts';
import { mockRouteProvider } from './mockProvider.ts';
import type { LatLng, RouteProvider } from './types.ts';

const A: LatLng = { latitude: 37.5271, longitude: 126.9327 };
const B: LatLng = { latitude: 37.5148, longitude: 126.8563 };

const throwing = (err: unknown): RouteProvider => ({
  async route() {
    throw err;
  },
});

test('기본은 primary 를 그대로 쓴다 — 성공하면 추정으로 안 내려간다', async () => {
  const estimate = mockRouteProvider();
  const p = fallbackRouteProvider({
    primary: { async route() { return { durationMin: 42, distanceKm: 9, polyline: [A, B], sections: [{ durationMin: 42, distanceKm: 9 }], source: 'provider' }; } },
    estimate,
  });
  const r = await p.route([A, B], 600, 'car');
  assert.equal(r.durationMin, 42);
  assert.equal(r.source, 'provider');
  assert.equal(estimate.calls, 0);
});

test('primary 가 던지면 추정으로 강등하고 source 는 estimate', async () => {
  const estimate = mockRouteProvider();
  const p = fallbackRouteProvider({ primary: throwing(new Error('server route 429')), estimate });
  const r = await p.route([A, B], 600, 'car');
  assert.equal(r.source, 'estimate');
  assert.equal(estimate.calls, 1);
  assert.ok(r.durationMin > 0);
  assert.equal(r.sections.length, 1);
});

test('429 만이 아니라 모든 실패에서 강등한다 — 502·타임아웃·잘못된 모양', async () => {
  for (const err of [new Error('server route 502'), new Error('server route: bad shape'), new DOMException('aborted', 'AbortError')]) {
    const estimate = mockRouteProvider();
    const p = fallbackRouteProvider({ primary: throwing(err), estimate });
    const r = await p.route([A, B], 600, 'car');
    assert.equal(r.source, 'estimate', `${err} 에서 강등하지 않았다`);
  }
});

test('강등 사유를 onFallback 으로 넘긴다 — 화면이 아니라 로그로 간다', async () => {
  const seen: unknown[] = [];
  const p = fallbackRouteProvider({
    primary: throwing(new Error('boom')),
    estimate: mockRouteProvider(),
    onFallback: e => seen.push(e),
  });
  await p.route([A, B], 600, 'car');
  assert.equal(seen.length, 1);
  assert.match(String(seen[0]), /boom/);
});

test('경유지가 있어도 sections 개수가 맞는다', async () => {
  const p = fallbackRouteProvider({ primary: throwing(new Error('x')), estimate: mockRouteProvider() });
  const mid: LatLng = { latitude: 37.52, longitude: 126.90 };
  const r = await p.route([A, mid, B], 600, 'car');
  assert.equal(r.sections.length, 2);
});
