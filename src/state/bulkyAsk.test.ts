import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkyAsks, bulkyChipId, BULKY_YES, BULKY_NO } from './bulkyAsk';
import type { IntentChip } from './plan';

const stop = (over: Partial<Extract<IntentChip, { kind: 'stop' }>> = {}): IntentChip => ({
  id: 's-1', kind: 'stop', label: '마트', queries: ['마트'],
  stopKind: 'category', openNow: false, flexible: true, near: 'any', ...over,
} as IntentChip);

test('짐이 생기는 업종이면 묻는다', () => {
  const asks = bulkyAsks([stop()], 'walk');

  assert.equal(asks.length, 1);
  assert.equal(asks[0].field, 'load:s-1');
  assert.deepEqual(asks[0].options, [BULKY_YES, BULKY_NO]);
});

test('자동차면 묻지 않는다 — 트렁크에 실으니 답이 계획을 안 바꾼다', () => {
  assert.deepEqual(bulkyAsks([stop()], 'car'), []);
});

test('이미 답한 칩은 다시 묻지 않는다', () => {
  assert.deepEqual(bulkyAsks([stop({ loadAfter: 'hard' })], 'walk'), []);
  assert.deepEqual(bulkyAsks([stop({ loadAfter: 'none' })], 'walk'), []);
});

test('짐이 안 생기는 업종은 묻지 않는다 — 안 물어도 되는 걸 물으면 소음이다', () => {
  assert.deepEqual(bulkyAsks([stop({ id: 's-2', queries: ['올리브영'], label: '올리브영' })], 'walk'), []);
});

test('여러 칩이면 각각 묻는다', () => {
  const asks = bulkyAsks([stop(), stop({ id: 's-9', queries: ['정육점'], label: '정육점' })], 'transit');

  assert.deepEqual(asks.map(a => a.field), ['load:s-1', 'load:s-9']);
});

test('field 에서 칩 id 를 되꺼낸다', () => {
  assert.equal(bulkyChipId('load:s-1'), 's-1');
  assert.equal(bulkyChipId('stop:마트'), null);
});
