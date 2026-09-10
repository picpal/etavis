import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, polylineLengthM } from '../geo';
import { projectOnCorridor } from './corridor';
import { DEST_ID, LegStore, ORIGIN_ID } from './legs';
import { allClosedAtArrival, isOpenAt, scorePlan, type ScoreContext } from './score';
import type { PlaceCandidate, Visit } from './types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km 동쪽
const poly = buildPolyline([O, D], 32);
const L = polylineLengthM(poly);
const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: { latitude: 37.5, longitude: 127.0568 } };
const c2: PlaceCandidate = { id: 'c2', name: 'c2', coord: { latitude: 37.5, longitude: 127.0852 } };
const cp = new Map([[c1.id, projectOnCorridor(poly, c1.coord)], [c2.id, projectOnCorridor(poly, c2.coord)]]);

function ctx(legs = new LegStore()): ScoreContext {
  return {
    origin: O, destination: D, corridorLengthM: L, rhoMinPerKm: 2, mode: 'car', departAtMin: 480, legs,
    corridorOf: id => cp.get(id)!,
  };
}
const v = (c: PlaceCandidate, dwellMin = 10): Visit => ({ slotId: c.id, candidate: c, dwellMin });

test('추정만으로 채점 — 경로 위 후보 1곳: 이동 ≈ 20분 + 체류 10분', () => {
  const s = scorePlan([v(c1)], ctx());
  assert.equal(s.unknownLegs, 2);
  assert.ok(Math.abs(s.totalMin - 30) < 1.5, `total=${s.totalMin}`);
  assert.equal(s.arrivals.length, 2);
  assert.ok(Math.abs(s.arrivals[0] - 490) < 1);
  assert.ok(Math.abs(s.arrivals[1] - 510) < 1.5);
});

test('실측 leg가 있으면 그 값을 쓰고 unknownLegs가 준다', () => {
  const legs = new LegStore();
  legs.add(ORIGIN_ID, 'c1', 'car', { durationMin: 13, distanceKm: 5, departAtMin: 480 });
  const s = scorePlan([v(c1)], ctx(legs));
  assert.equal(s.unknownLegs, 1);
  assert.equal(s.legsMin[0], 13);
  assert.equal(s.arrivals[0], 493);
});

test('불확실성은 합산된다', () => {
  const legs = new LegStore();
  legs.add(ORIGIN_ID, 'c1', 'car', { durationMin: 20, distanceKm: 5, departAtMin: 470 }); // Δ10 → 2분
  legs.add('c1', DEST_ID, 'car', { durationMin: 10, distanceKm: 5, departAtMin: 510 });    // c1 출발 = 480+20+10
  const s = scorePlan([v(c1)], ctx(legs));
  assert.equal(s.unknownLegs, 0);
  assert.equal(s.uncertaintyMin, 2);
});

test('두 곳 — 순서대로 도착시각이 누적된다', () => {
  const s = scorePlan([v(c1), v(c2, 5)], ctx());
  assert.equal(s.arrivals.length, 3);
  assert.ok(s.arrivals[0] < s.arrivals[1] && s.arrivals[1] < s.arrivals[2]);
});

test('isOpenAt — hours 없으면 열림, 자정 넘는 영업시간 처리', () => {
  assert.equal(isOpenAt(c1, 100), true);
  const day = { ...c1, hours: { openMin: 600, closeMin: 1320 } };
  assert.equal(isOpenAt(day, 599), false);
  assert.equal(isOpenAt(day, 600), true);
  assert.equal(isOpenAt(day, 1320), false);
  const night = { ...c1, hours: { openMin: 1200, closeMin: 120 } };
  assert.equal(isOpenAt(night, 30), true);
  assert.equal(isOpenAt(night, 600), false);
});

test('allClosedAtArrival — 도착 시각 기준', () => {
  const closed = { ...c1, hours: { openMin: 600, closeMin: 1320 } };
  const s = scorePlan([v(closed)], ctx()); // 도착 ≈ 490 < 600
  assert.equal(allClosedAtArrival(s), true);
});
