import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNear, matchesNear, nearFromCarry, resolveNear } from './nearSide.ts';
import type { LatLng } from './routePlan/types.ts';

/** 위도 37.5 위의 동서 직선. 127.0 이 출발지, 127.1 이 목적지 — 경도가 곧 진행률이다 */
const at = (lng: number): LatLng => ({ latitude: 37.5, longitude: lng });
const poly: LatLng[] = [at(127.0), at(127.1)];
const c = (id: string, lng: number) => ({ id, coord: at(lng) });
const startSide = c('s1', 127.01); // s ≈ 0.1
const middle = c('m1', 127.05);    // s ≈ 0.5
const endSide = c('e1', 127.09);   // s ≈ 0.9

test("matchesNear — 'any' 는 어디든 통과한다", () => {
  assert.equal(matchesNear('any', 0), true);
  assert.equal(matchesNear('any', 0.5), true);
  assert.equal(matchesNear('any', 1), true);
});

test("matchesNear — end 는 0.6 부터, start 는 0.4 까지. 가운데는 어느 쪽도 아니다", () => {
  assert.equal(matchesNear('end', 0.6), true);
  assert.equal(matchesNear('end', 0.59), false);
  assert.equal(matchesNear('start', 0.4), true);
  assert.equal(matchesNear('start', 0.41), false);
  // 0.5 는 양쪽 다 거절한다 — 애매한 자리를 양쪽에 다 넣으면 제약이 아니게 된다
  assert.equal(matchesNear('end', 0.5), false);
  assert.equal(matchesNear('start', 0.5), false);
});

test("applyNear('end') — 목적지 쪽 후보만 남는다", () => {
  const r = applyNear([startSide, middle, endSide], 'end', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['e1']);
  assert.equal(r.relaxed, false);
});

test("applyNear('start') — 출발지 쪽 후보만 남는다", () => {
  const r = applyNear([startSide, middle, endSide], 'start', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1']);
  assert.equal(r.relaxed, false);
});

test("applyNear('any') — 손대지 않는다", () => {
  const r = applyNear([startSide, middle, endSide], 'any', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1', 'm1', 'e1']);
  assert.equal(r.relaxed, false);
});

test('그쪽에 한 곳도 없으면 전부 남기고 relaxed — 경유지가 증발하면 안 된다', () => {
  const r = applyNear([startSide, middle], 'end', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1', 'm1'], '제약을 풀고 되돌린다');
  assert.equal(r.relaxed, true);
});

test('순서를 보존한다 — 앞 단계(주차 정책)가 매긴 우선순위를 뒤집지 않는다', () => {
  const e2 = c('e2', 127.08);
  const r = applyNear([e2, endSide], 'end', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['e2', 'e1']);
});

test('후보가 아예 없으면 relaxed 는 false — 못 찾은 것과 밀려난 것은 다른 사건이다', () => {
  const r = applyNear([], 'end', poly);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.relaxed, false);
});

test('폴리라인이 2점 미만이면 진행률을 못 잰다 — 조용히 통과시킨다', () => {
  const r = applyNear([startSide, endSide], 'end', [at(127.0)]);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1', 'e1']);
  assert.equal(r.relaxed, false, '못 잰 걸 "못 찾았다"고 말하면 거짓말이 된다');
});

test('nearFromCarry — 대중교통에서 커피는 end. 들고 탈 수 없다', () => {
  assert.equal(nearFromCarry('transit', ['카페'], '커피 사기'), 'end');
  assert.equal(nearFromCarry('transit', ['꽃집'], ''), 'end');
});

test('nearFromCarry — 차·도보는 표를 읽지 않는다. 들고 갈 수 있다', () => {
  assert.equal(nearFromCarry('car', ['카페'], '커피 사기'), 'any');
  assert.equal(nearFromCarry('walk', ['카페'], '커피 사기'), 'any');
});

test('nearFromCarry — 들고 타기 어려운 품목이 없으면 any', () => {
  assert.equal(nearFromCarry('transit', ['약국'], '약 사기'), 'any');
  assert.equal(nearFromCarry('transit', ['카페'], '결혼식 전에 기다리기'), 'any',
    '앉는 카페는 물성 신호가 아니다 — 그건 체류시간 축(다음 단계)이 볼 일이다');
});

test('resolveNear — 사용자가 말한 위치가 물성 표를 이긴다', () => {
  assert.equal(resolveNear('start', 'transit', ['카페'], '커피 사기'), 'start');
  assert.equal(resolveNear('end', 'car', ['약국'], '약 사기'), 'end');
});

test('resolveNear — 말하지 않았으면 물성 표로 떨어진다', () => {
  assert.equal(resolveNear('any', 'transit', ['카페'], '커피 사기'), 'end');
  assert.equal(resolveNear(undefined, 'transit', ['카페'], '커피 사기'), 'end');
  assert.equal(resolveNear(undefined, 'transit', ['약국'], '약 사기'), 'any');
});
