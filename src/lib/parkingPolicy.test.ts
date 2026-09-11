import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyParkingPolicy, parkingRank } from './parkingPolicy.ts';

const c = (id: string, parking?: '가능' | '어려움' | '없음') => ({ id, parking });
const ids = (xs: { id: string }[]) => xs.map(x => x.id);

test('자동차: 주차 없음은 빠지고, 가능 → 모름 → 어려움 순. 같은 등급은 원래 순서', () => {
  const list = [c('a', '어려움'), c('b'), c('c', '없음'), c('d', '가능'), c('e'), c('f', '가능')];
  assert.deepEqual(ids(applyParkingPolicy(list, 'car')), ['d', 'f', 'b', 'e', 'a']);
});

test('도보·대중교통은 손대지 않는다', () => {
  const list = [c('a', '없음'), c('b', '가능')];
  assert.deepEqual(ids(applyParkingPolicy(list, 'walk')), ['a', 'b']);
  assert.deepEqual(ids(applyParkingPolicy(list, 'transit')), ['a', 'b']);
});

test('전부 모르면(실제 검색) 순서가 그대로다', () => {
  const list = [c('a'), c('b'), c('c')];
  assert.deepEqual(ids(applyParkingPolicy(list, 'car')), ['a', 'b', 'c']);
});

test('parkingRank: 가능 0 < 모름 1 < 어려움 2 < 없음 3', () => {
  assert.equal(parkingRank('가능'), 0);
  assert.equal(parkingRank(undefined), 1);
  assert.equal(parkingRank('어려움'), 2);
  assert.equal(parkingRank('없음'), 3);
});
