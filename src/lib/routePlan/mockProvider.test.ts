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

// 모드별 추정 — 대중교통·도보가 자동차 속도로 계산돼 실제보다 짧게 나오던 문제
import { estimateSectionMin } from './mockProvider';

test('자동차는 km × minPerKm 그대로', () => {
  assert.equal(estimateSectionMin(1, 'car', 2), 2);
});

test('도보는 12분/km', () => {
  assert.equal(estimateSectionMin(1, 'walk', 2), 12);
});

test('대중교통은 접근·대기 8분 + 25km/h 차내, 5km 넘으면 환승 5분', () => {
  assert.ok(Math.abs(estimateSectionMin(3, 'transit', 2) - 15.2) < 1e-9);
  assert.ok(Math.abs(estimateSectionMin(8, 'transit', 2) - 32.2) < 1e-9);
});

test('대중교통이라도 아주 짧으면 걷는 시간을 넘지 않는다', () => {
  assert.equal(estimateSectionMin(0.5, 'transit', 2), 6);
});

test('공급자가 transit 모드면 구간마다 고정 접근·대기 시간이 붙는다', async () => {
  const p = mockRouteProvider({ circuity: 1 });
  const a = { latitude: 37.5, longitude: 127 };
  const b = { latitude: 37.5, longitude: 127.0341 }; // 약 3km 동쪽
  const c = { latitude: 37.5, longitude: 127.0682 };
  const car = await p.route([a, b, c], 480, 'car');
  const tr = await p.route([a, b, c], 480, 'transit');
  assert.equal(tr.sections.length, 2);
  // 자동차 ≈ 2분/km × 6km = 12분, 대중교통 ≈ 2 × (8 + 3 × 2.4) ≈ 30분
  assert.ok(car.durationMin > 11 && car.durationMin < 13, `car ${car.durationMin}`);
  assert.ok(tr.durationMin > 29 && tr.durationMin < 32, `transit ${tr.durationMin}`);
  assert.ok(Math.abs(tr.sections[0].durationMin - tr.sections[1].durationMin) < 0.5);
});

test('도보는 우회율 1.2를 기본으로 쓴다', async () => {
  const p = mockRouteProvider();
  const a = { latitude: 37.5, longitude: 127 };
  const b = { latitude: 37.5, longitude: 127.01137 }; // 약 1km
  const w = await p.route([a, b], 480, 'walk');
  assert.ok(w.distanceKm > 1.15 && w.distanceKm < 1.25, `km ${w.distanceKm}`);
  assert.ok(Math.abs(w.durationMin - w.distanceKm * 12) < 1e-9);
});
