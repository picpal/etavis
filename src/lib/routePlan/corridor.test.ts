import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline } from '../geo';
import {
  corridorLegM, destinationPoint, estimateA, estimateB, estimateC, originPoint, projectOnCorridor,
} from './corridor';

// 동서로 뻗은 10km 직선. 위도 37.5에서 경도 0.1136° ≈ 10km
const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const poly = buildPolyline([O, D], 32);

test('경로 위 중간점은 s≈0.5, y≈0', () => {
  const mid = { latitude: 37.5, longitude: 127.0568 };
  const p = projectOnCorridor(poly, mid);
  assert.ok(Math.abs(p.s - 0.5) < 0.02, `s=${p.s}`);
  assert.ok(Math.abs(p.y) < 50, `y=${p.y}`);
});

test('왼쪽(북쪽)은 y>0, 오른쪽(남쪽)은 y<0', () => {
  const north = projectOnCorridor(poly, { latitude: 37.509, longitude: 127.0568 });
  const south = projectOnCorridor(poly, { latitude: 37.491, longitude: 127.0568 });
  assert.ok(north.y > 800 && north.y < 1200, `north y=${north.y}`);
  assert.ok(south.y < -800 && south.y > -1200, `south y=${south.y}`);
});

test('역주행 leg는 같은 거리라도 벌점이 붙는다', () => {
  const a = { x: 2000, y: 0, s: 0.2 };
  const b = { x: 5000, y: 0, s: 0.5 };
  assert.equal(corridorLegM(a, b), 3000);
  assert.equal(corridorLegM(b, a), 3000 + 1500);
});

test('추정기 A/B/C — 경로 위 후보는 직행과 거의 같다', () => {
  const L = 10_000;
  const mid = { latitude: 37.5, longitude: 127.0568 };
  const seqA = [originPoint(), projectOnCorridor(poly, mid), destinationPoint(L)];
  const a = estimateA(seqA);
  const b = estimateB([O, mid, D]);
  assert.ok(Math.abs(a - L) < 200, `A=${a}`);
  assert.ok(Math.abs(b - L) < 200, `B=${b}`);
  assert.ok(Math.abs(estimateC(a, b) - L) < 200);
});
