import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateSet, deltaMaxMin, jaccard, legSet, marginMin, pickOptions, pickSeeds, planKey, round2Plan, type Ranked,
} from './select';
import type { PlaceCandidate, Visit } from './types';
import { comfortMin, type Scored } from './score';

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

/* 편한 순서 — 짐을 진 시간이 순위에 들어오는 자리.
   시간만 보는 지금 동작은 짐이 없을 때 **한 글자도 안 바뀌어야** 한다. */

test('pickSeeds — 짐이 없으면 지금과 똑같다', () => {
  const r = [
    ranked(['a1', 'b1'], 30, 30, 30),
    ranked(['a1', 'b2'], 31, 31, 31),
    ranked(['a2', 'b1'], 10, 50, 36),
    ranked(['a2', 'b2'], 50, 10, 36),
  ];
  assert.deepEqual(pickSeeds(r, 4).map(planKey), ['a1>b1', 'a1>b2', 'a2>b1', 'a2>b2']);
});

test('pickSeeds — 짐이 있으면 편의 최선이 1번 자리에 온다', () => {
  const r: Ranked[] = [
    { ...ranked(['a1', 'b1'], 30, 30, 30), burdenMin: 20 }, // 거리 최선인데 짐이 많다
    { ...ranked(['a1', 'b2'], 31, 31, 31), burdenMin: 20 },
    { ...ranked(['a2', 'b1'], 10, 50, 36), burdenMin: 20 },
    { ...ranked(['b1', 'a1'], 40, 40, 40), burdenMin: 0 },  // 좀 느려도 짐이 없다
  ];
  const seeds = pickSeeds(r, 4).map(planKey);
  // 40 + 1.5×0 = 40  <  30 + 1.5×20 = 60
  assert.equal(seeds[0], 'b1>a1', '짐을 감안한 최선이 먼저 실측된다');
  assert.equal(seeds[1], 'a1>b1', '순수 최선도 남는다 — 두 토글 다 실측된 안을 가져야 한다');
  assert.equal(seeds.length, 4, '시드 수는 안 는다 — 대중교통 예산이 10콜이다');
});

test('pickOptions — 편의 최선이 컷 밖이면 마지막 자리를 내준다', () => {
  const m = [
    scored(['a1', 'b1'], 40, { burdenMin: 12 }),
    scored(['a2', 'b2'], 44, { burdenMin: 12 }),
    scored(['a3', 'b3'], 47, { burdenMin: 12 }),
    scored(['b1', 'a1'], 52, { burdenMin: 0 }),  // 컷(+8) 밖이지만 짐이 없다
  ];
  const out = pickOptions(m, 60, 3).map(s => planKey(s.visits));
  assert.equal(out.length, 3);
  assert.equal(out[0], 'a1>b1', '1안은 여전히 최단이다 — 이 불변식은 안 깬다');
  assert.ok(out.includes('b1>a1'), '편의 최선이 들어온다');
  assert.ok(!out.includes('a3>b3'), '점수 최하가 밀려난다');
});

test('pickOptions — 편의 최선이 이미 있으면 아무것도 안 바꾼다', () => {
  const m = [
    scored(['a1', 'b1'], 40, { burdenMin: 0 }),
    scored(['a2', 'b2'], 44, { burdenMin: 12 }),
    scored(['a3', 'b3'], 47, { burdenMin: 12 }),
  ];
  const out = pickOptions(m, 60, 3).map(s => planKey(s.visits));
  assert.deepEqual(out, ['a1>b1', 'a2>b2', 'a3>b3']);
});

test('pickOptions — 편의 최선이 너무 멀면 안 넣는다 — 그건 다른 여행이다', () => {
  const m = [
    scored(['a1', 'b1'], 40, { burdenMin: 12 }),
    scored(['a2', 'b2'], 44, { burdenMin: 12 }),
    scored(['a3', 'b3'], 47, { burdenMin: 12 }),
    scored(['b1', 'a1'], 75, { burdenMin: 0 }),  // 최단 +35분
  ];
  const out = pickOptions(m, 60, 3).map(s => planKey(s.visits));
  assert.ok(!out.includes('b1>a1'));
  assert.deepEqual(out, ['a1>b1', 'a2>b2', 'a3>b3']);
});

test('comfortMin — 짐 1분을 이동 1.5분으로 친다', () => {
  assert.equal(comfortMin(scored(['a1'], 40, { burdenMin: 0 })), 40);
  assert.equal(comfortMin(scored(['a1'], 40, { burdenMin: 12 })), 58);
});
