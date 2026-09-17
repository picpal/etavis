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

test('primary 가 던지면 추정으로 강등하고 source 는 estimate (enabled: true)', async () => {
  const estimate = mockRouteProvider();
  const p = fallbackRouteProvider({ primary: throwing(new Error('server route 429')), estimate, enabled: true });
  const r = await p.route([A, B], 600, 'car');
  assert.equal(r.source, 'estimate');
  assert.equal(estimate.calls, 1);
  assert.ok(r.durationMin > 0);
  assert.equal(r.sections.length, 1);
});

test('429 만이 아니라 모든 실패에서 강등한다 — 502·타임아웃·잘못된 모양 (enabled: true)', async () => {
  for (const err of [new Error('server route 502'), new Error('server route: bad shape'), new DOMException('aborted', 'AbortError')]) {
    const estimate = mockRouteProvider();
    const p = fallbackRouteProvider({ primary: throwing(err), estimate, enabled: true });
    const r = await p.route([A, B], 600, 'car');
    assert.equal(r.source, 'estimate', `${err} 에서 강등하지 않았다`);
  }
});

test('강등 사유를 onFallback 으로 넘긴다 — 화면이 아니라 로그로 간다 (enabled: true)', async () => {
  const seen: unknown[] = [];
  const p = fallbackRouteProvider({
    primary: throwing(new Error('boom')),
    estimate: mockRouteProvider(),
    enabled: true,
    onFallback: e => seen.push(e),
  });
  await p.route([A, B], 600, 'car');
  assert.equal(seen.length, 1);
  assert.match(String(seen[0]), /boom/);
});

test('경유지가 있어도 sections 개수가 맞는다 (enabled: true)', async () => {
  const p = fallbackRouteProvider({ primary: throwing(new Error('x')), estimate: mockRouteProvider(), enabled: true });
  const mid: LatLng = { latitude: 37.52, longitude: 126.90 };
  const r = await p.route([A, mid, B], 600, 'car');
  assert.equal(r.sections.length, 2);
});

// --- enabled: false / 미지정 — 네이티브 기본값. I1: 라우팅 폴백 회귀 방지 ---

test('enabled 가 없으면(네이티브 기본값) primary 가 던져도 그대로 던진다 — 추정으로 안 내려간다', async () => {
  const estimate = mockRouteProvider();
  const err = new Error('server route 502');
  const p = fallbackRouteProvider({ primary: throwing(err), estimate });
  await assert.rejects(() => p.route([A, B], 600, 'car'), err);
  assert.equal(estimate.calls, 0);
});

test('enabled: false 면 primary 가 던져도 그대로 던진다 — 추정으로 안 내려간다', async () => {
  const estimate = mockRouteProvider();
  const err = new Error('server route timeout');
  const p = fallbackRouteProvider({ primary: throwing(err), estimate, enabled: false });
  await assert.rejects(() => p.route([A, B], 600, 'car'), err);
  assert.equal(estimate.calls, 0);
});

test('enabled 가 false/미지정이면 반환값이 primary 그 자체다 — 감싸지 않는다', () => {
  const primary: RouteProvider = { async route() { throw new Error('unused'); } };
  const estimate = mockRouteProvider();
  assert.equal(fallbackRouteProvider({ primary, estimate }), primary);
  assert.equal(fallbackRouteProvider({ primary, estimate, enabled: false }), primary);
});

test('enabled: true 면 primary 를 그대로 반환하지 않는다 — 감싸서 강등 로직을 태운다', () => {
  const primary: RouteProvider = { async route() { throw new Error('unused'); } };
  const estimate = mockRouteProvider();
  assert.notEqual(fallbackRouteProvider({ primary, estimate, enabled: true }), primary);
});
