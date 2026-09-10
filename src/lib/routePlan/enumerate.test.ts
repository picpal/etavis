import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCandidates, enumeratePlans, totalVisits } from './enumerate';
import type { PlaceCandidate, Slot, Visit } from './types';

const c = (id: string): PlaceCandidate => ({ id, name: id, coord: { latitude: 0, longitude: 0 } });
const slot = (id: string, ids: string[], extra: Partial<Slot> = {}): Slot => ({
  id, query: id, candidates: ids.map(c), dwellMin: 5, count: 1, flexible: true, openNow: false, ...extra,
});
const key = (p: Visit[]) => p.map(v => v.candidate.id).join('>');
const noScore = () => 0;

test('V = Σcount', () => {
  assert.equal(totalVisits([slot('a', ['a1']), slot('b', ['b1'], { count: 3 })]), 4);
});

test('flexible=false는 첫 후보로 고정', () => {
  const s = slot('a', ['a1', 'a2'], { flexible: false });
  assert.deepEqual(effectiveCandidates(s).map(x => x.id), ['a1']);
});

test('슬롯 2개 × 후보 2개, auto → 2·2·2! = 8개', () => {
  const plans = enumeratePlans([slot('a', ['a1', 'a2']), slot('b', ['b1', 'b2'])], 'auto', noScore, Infinity);
  assert.equal(plans.length, 8);
  assert.ok(plans.some(p => key(p) === 'b2>a1'));
});

test('locked면 슬롯 순서 고정 → 4개', () => {
  const plans = enumeratePlans([slot('a', ['a1', 'a2']), slot('b', ['b1', 'b2'])], 'locked', noScore, Infinity);
  assert.equal(plans.length, 4);
  assert.ok(plans.every(p => p[0].slotId === 'a' && p[1].slotId === 'b'));
});

test('count=3은 같은 슬롯에서 서로 다른 3곳, 중복 없음', () => {
  const plans = enumeratePlans([slot('a', ['a1', 'a2', 'a3', 'a4'], { count: 3 })], 'auto', noScore, Infinity);
  // C(4,3) × 3! = 24
  assert.equal(plans.length, 24);
  for (const p of plans) assert.equal(new Set(p.map(v => v.candidate.id)).size, 3);
});

test('beam은 부분 점수 낮은 쪽을 남긴다', () => {
  // 점수 = 후보 id 끝자리 합. a1,b1 조합이 최선
  const score = (seq: Visit[]) => seq.reduce((s, v) => s + Number(v.candidate.id.slice(1)), 0);
  const plans = enumeratePlans([slot('a', ['a1', 'a9']), slot('b', ['b1', 'b9'])], 'auto', score, 1);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].map(v => v.candidate.id).sort(), ['a1', 'b1']);
});

test('빈 슬롯은 건너뛴다', () => {
  const plans = enumeratePlans([slot('a', []), slot('b', ['b1'])], 'auto', noScore, Infinity);
  assert.equal(plans.length, 1);
  assert.equal(key(plans[0]), 'b1');
});
