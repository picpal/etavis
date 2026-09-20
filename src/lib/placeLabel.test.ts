import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelForSlot } from './placeLabel.ts';

test('라벨이 비어 있으면 슬롯 기본값을 넣는다', () => {
  assert.equal(labelForSlot('', 'home'), '집');
  assert.equal(labelForSlot('', 'work'), '회사');
  assert.equal(labelForSlot('   ', 'home'), '집');
});

test('자동으로 채워진 라벨은 슬롯을 바꾸면 따라간다', () => {
  // 실제로 겪은 버그: 집을 먼저 고르면 라벨이 '집'으로 차고, 그 뒤 회사로 바꿔도
  // 라벨이 '집'으로 남아 내 장소 목록에 "집"이 두 개 보였다.
  assert.equal(labelForSlot('집', 'work'), '회사');
  assert.equal(labelForSlot('회사', 'home'), '집');
});

test('사람이 직접 쓴 라벨은 건드리지 않는다', () => {
  // '본가'라고 적어 둔 걸 슬롯 바꿨다고 '회사'로 갈아치우면 남의 글을 지우는 것이다.
  assert.equal(labelForSlot('본가', 'work'), '본가');
  assert.equal(labelForSlot('단골 미용실', 'home'), '단골 미용실');
});

test('직접 입력 슬롯에서는 라벨을 그대로 둔다', () => {
  assert.equal(labelForSlot('집', null), '집');
  assert.equal(labelForSlot('', null), '');
});
