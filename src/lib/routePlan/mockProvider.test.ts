import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider, segmentsIntersect } from './mockProvider';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km

test('직행 — 우회율 1.3, 2분/km', async () => {
  const p = mockRouteProvider({ minPerKm: 2, circuity: 1.3 });
  const r = await p.route([O, D], 480, 'car');
  assert.ok(Math.abs(r.distanceKm - 13) < 0.2, `km=${r.distanceKm}`);
  assert.ok(Math.abs(r.durationMin - 26) < 0.4);
  assert.equal(r.sections.length, 1);
  assert.equal(p.calls, 1);
  assert.ok(r.polyline.length > 2);
});

test('경유지 — section이 points-1개, 합이 total', async () => {
  const p = mockRouteProvider();
  const mid = { latitude: 37.51, longitude: 127.05 };
  const r = await p.route([O, mid, D], 480, 'car');
  assert.equal(r.sections.length, 2);
  const sum = r.sections.reduce((s, x) => s + x.durationMin, 0);
  assert.ok(Math.abs(sum - r.durationMin) < 1e-9);
});

test('장벽을 가로지르는 leg는 penaltyKm가 붙는다', async () => {
  // 남북으로 놓인 "강" — 경도 127.05
  const barrier = { a: { latitude: 37.4, longitude: 127.05 }, b: { latitude: 37.6, longitude: 127.05 }, penaltyKm: 5 };
  const plain = mockRouteProvider({ minPerKm: 2, circuity: 1 });
  const river = mockRouteProvider({ minPerKm: 2, circuity: 1, barrier });
  const a = await plain.route([O, D], 480, 'car');
  const b = await river.route([O, D], 480, 'car');
  assert.ok(Math.abs(b.distanceKm - a.distanceKm - 5) < 1e-6);
});

test('segmentsIntersect', () => {
  assert.equal(segmentsIntersect(O, D, { latitude: 37.4, longitude: 127.05 }, { latitude: 37.6, longitude: 127.05 }), true);
  assert.equal(segmentsIntersect(O, D, { latitude: 37.6, longitude: 127.0 }, { latitude: 37.6, longitude: 127.1 }), false);
});
