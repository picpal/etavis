import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEST_ID, LegStore, learnLegs, ORIGIN_ID } from './legs';

test('출발시각 차 ≤5분이면 그대로', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  const got = s.lookup('a', 'b', 'car', 504);
  assert.deepEqual(got, { durationMin: 10, distanceKm: 4, uncertaintyMin: 0 });
});

test('5~15분이면 불확실성 max(1, 0.1×leg)', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 30, distanceKm: 12, departAtMin: 500 });
  assert.equal(s.lookup('a', 'b', 'car', 512)!.uncertaintyMin, 3);
  s.add('c', 'd', 'car', { durationMin: 4, distanceKm: 1, departAtMin: 500 });
  assert.equal(s.lookup('c', 'd', 'car', 512)!.uncertaintyMin, 1);
});

test('>15분이면 미실측', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  assert.equal(s.lookup('a', 'b', 'car', 520), null);
});

test('방향과 모드가 다르면 다른 leg', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  assert.equal(s.lookup('b', 'a', 'car', 500), null);
  assert.equal(s.lookup('a', 'b', 'walk', 500), null);
});

test('도보는 시각 차를 무시한다', () => {
  const s = new LegStore();
  s.add('a', 'b', 'walk', { durationMin: 10, distanceKm: 0.8, departAtMin: 500 });
  assert.equal(s.lookup('a', 'b', 'walk', 700)!.uncertaintyMin, 0);
});

test('가장 가까운 시각의 실측을 고른다', () => {
  const s = new LegStore();
  s.add('a', 'b', 'car', { durationMin: 10, distanceKm: 4, departAtMin: 500 });
  s.add('a', 'b', 'car', { durationMin: 14, distanceKm: 4, departAtMin: 530 });
  assert.equal(s.lookup('a', 'b', 'car', 528)!.durationMin, 14);
});

test('learnLegs — section마다 출발시각을 누적(이동 + dwell)해서 넣는다', () => {
  const s = new LegStore();
  learnLegs(
    s, [ORIGIN_ID, 'c1', 'c2', DEST_ID],
    { durationMin: 30, distanceKm: 12, polyline: [], sections: [
      { durationMin: 10, distanceKm: 4 }, { durationMin: 8, distanceKm: 3 }, { durationMin: 12, distanceKm: 5 },
    ] },
    480, [15, 5], 'car',
  );
  assert.equal(s.size, 3);
  assert.equal(s.lookup(ORIGIN_ID, 'c1', 'car', 480)!.durationMin, 10);
  // c1 출발 = 480 + 10 + 15 = 505
  assert.equal(s.lookup('c1', 'c2', 'car', 505)!.uncertaintyMin, 0);
  // c2 출발 = 505 + 8 + 5 = 518
  assert.equal(s.lookup('c2', DEST_ID, 'car', 518)!.durationMin, 12);
});
