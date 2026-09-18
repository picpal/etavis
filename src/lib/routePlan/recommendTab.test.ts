import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendTabState } from './recommendTab';

test('추천안이 따로 있으면 그 인덱스를 가리킨다', () => {
  const s = recommendTabState(2, 0);

  assert.equal(s.target, 2);
  assert.equal(s.sameAsFast, false);
});

test('추천안을 고른 상태면 첫 번째 탭이 켜진다', () => {
  assert.equal(recommendTabState(2, 2).value, 0);
});

test('최단안을 고른 상태면 두 번째 탭이 켜진다', () => {
  assert.equal(recommendTabState(2, 0).value, 1);
});

test('짐을 안 잰 계획이면 가리킬 다른 안이 없다 — 최단안을 그대로 쓴다', () => {
  const s = recommendTabState(null, 0);

  assert.equal(s.sameAsFast, true);
  assert.equal(s.target, 0);
});

test('최단안이 곧 추천안이어도 같은 취급이다 — 원인은 달라도 화면이 할 일은 같다', () => {
  assert.equal(recommendTabState(0, 0).sameAsFast, true);
});

test('두 안이 같으면 추천 탭이 켜진 것으로 본다 — 지금 순서가 추천이기 때문이다', () => {
  assert.equal(recommendTabState(null, 0).value, 0);
});
