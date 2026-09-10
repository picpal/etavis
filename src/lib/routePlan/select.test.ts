import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateSet, deltaMaxMin, jaccard, legSet, marginMin, pickOptions, pickSeeds, planKey, round2Plan, type Ranked,
} from './select';
import type { PlaceCandidate, Visit } from './types';
import type { Scored } from './score';

const c = (id: string): PlaceCandidate => ({ id, name: id, coord: { latitude: 0, longitude: 0 } });
const vs = (...ids: string[]): Visit[] => ids.map(id => ({ slotId: id[0], candidate: c(id), dwellMin: 5 }));
const ranked = (ids: string[], a: number, b: number, cc: number): Ranked => ({ visits: vs(...ids), estA: a, estB: b, estC: cc });
const scored = (ids: string[], totalMin: number, extra: Partial<Scored> = {}): Scored => ({
  visits: vs(...ids), totalMin, distanceKm: 0, arrivals: [], unknownLegs: 0, uncertaintyMin: 0, legsMin: [], ...extra,
});

test('planKey · 집합', () => {
  assert.equal(planKey(vs('a1', 'b1')), 'a1>b1');
  assert.deepEqual([...candidateSet(vs('a1', 'b1'))], ['a1', 'b1']);
  assert.deepEqual([...legSet(vs('a1', 'b1'))], ['O>a1', 'a1>b1', 'b1>D']);
});

test('jaccard', () => {
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(jaccard([], []), 0);
});

test('pickSeeds — C 상위 2, A 1위, B 1위, 나머지는 overlap 최저', () => {
  const r = [
    ranked(['a1', 'b1'], 30, 30, 30),
    ranked(['a1', 'b2'], 31, 31, 31),
    ranked(['a2', 'b1'], 10, 50, 36),  // A 1위
    ranked(['a2', 'b2'], 50, 10, 36),  // B 1위
    ranked(['b1', 'a1'], 33, 33, 33),
  ];
  const seeds = pickSeeds(r, 4).map(planKey);
  assert.deepEqual(seeds, ['a1>b1', 'a1>b2', 'a2>b1', 'a2>b2']);
});

test('pickSeeds — A/B 1위가 C 상위와 겹치면 overlap 최저로 채운다', () => {
  const r = [
    ranked(['a1', 'b1'], 10, 10, 10),
    ranked(['a1', 'b2'], 11, 11, 11),
    ranked(['a2', 'b2'], 30, 30, 30),
    ranked(['b1', 'a1'], 12, 12, 12), // a1,b1과 후보 집합 동일
  ];
  const seeds = pickSeeds(r, 4).map(planKey);
  assert.equal(seeds.length, 4);
  assert.equal(seeds[2], 'a2>b2'); // 겹침이 가장 적은 안이 먼저
});

test('deltaMax · margin', () => {
  assert.equal(deltaMaxMin(20), 3);
  assert.equal(deltaMaxMin(5), 2);
  assert.equal(deltaMaxMin(100), 8);
  assert.equal(marginMin(20), 2);
  assert.equal(marginMin(50), 4);
});

test('pickOptions — Δmax 밖은 제외, 겹침 패널티로 다양성', () => {
  const m = [
    scored(['a1', 'b1'], 40),
    scored(['b1', 'a1'], 41),   // 같은 후보, 순서만 다름
    scored(['a2', 'b2'], 42),   // 후보 전부 다름
    scored(['a1', 'b2'], 60),   // 직행 30 → Δmax 4.5 밖
  ];
  const picked = pickOptions(m, 30, 3).map(s => planKey(s.visits));
  assert.equal(picked[0], 'a1>b1');
  assert.equal(picked[1], 'a2>b2');
  assert.equal(picked.length, 3);
});

test('pickOptions — 3개가 안 되면 억지로 만들지 않는다', () => {
  const picked = pickOptions([scored(['a1'], 40), scored(['a2'], 60)], 30, 3);
  assert.equal(picked.length, 1);
});

test('round2Plan — leg 오차 비율 > 1.6이면 미실측 1개 도전자 상위 2', () => {
  const measured = [scored(['a1', 'b1'], 40), scored(['a1', 'b2'], 44), scored(['a2', 'b1'], 46)];
  const rescored = [
    ...measured,
    scored(['a2', 'b2'], 41, { unknownLegs: 1 }),
    scored(['b2', 'a2'], 43, { unknownLegs: 1 }),
    scored(['b1', 'a2'], 42, { unknownLegs: 2 }),
  ];
  const r = round2Plan({
    measured, rescored, directMin: 30,
    // 비율 1.8 > 1.6, WAPE = 8/48 = 0.17 ≤ 0.4 → 탐색안은 안 붙는다
    legErrors: [{ measuredMin: 18, estimatedMin: 10 }, { measuredMin: 30, estimatedMin: 30 }],
  });
  assert.deepEqual(r.extra.map(planKey), ['a2>b2', 'b2>a2']);
  assert.ok(r.reason);
});

test('round2Plan — 트리거 없으면 빈 배열', () => {
  const measured = [scored(['a1'], 40), scored(['a2'], 50), scored(['a3'], 55)];
  const r = round2Plan({ measured, rescored: measured, directMin: 30, legErrors: [{ measuredMin: 10, estimatedMin: 10 }] });
  assert.deepEqual(r.extra, []);
  assert.equal(r.reason, null);
});

test('round2Plan — 유효 실측 < 3이면 탐색안(미실측 leg 최다) 하나 더', () => {
  const measured = [scored(['a1', 'b1'], 40)];
  const rescored = [
    ...measured,
    scored(['a1', 'b2'], 42, { unknownLegs: 1 }),
    scored(['a2', 'b2'], 45, { unknownLegs: 2 }),
  ];
  const r = round2Plan({ measured, rescored, directMin: 30, legErrors: [] });
  assert.equal(r.extra.length, 2);
  assert.deepEqual(r.extra.map(planKey), ['a1>b2', 'a2>b2']);
});
