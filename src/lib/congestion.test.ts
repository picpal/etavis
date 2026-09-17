/**
 * 가 본 곳 판정 — 화면(A9 시트)과 리듀서가 같은 답을 봐야 한다.
 * 한쪽만 넓혔다가 제보가 조용히 버려진 적이 있다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasVisitedStop } from './congestion';

test('지금 서 있는 경유지는 가 본 곳이다', () => {
  assert.equal(hasVisitedStop(1, 1, true), true);
});

test('아직 도착 전이면(체류 아님) 같은 자리라도 가 본 곳이 아니다', () => {
  assert.equal(hasVisitedStop(1, 1, false), false);
});

test('이미 지나온 경유지는 떠났어도 가 본 곳이다 — 붐볐는지는 그때가 제일 잘 안다', () => {
  assert.equal(hasVisitedStop(0, 1, false), true);
  assert.equal(hasVisitedStop(0, 2, true), true);
});

test('앞으로 갈 경유지는 가 본 곳이 아니다 — 가보지 않은 곳의 혼잡도는 제보가 아니라 소음이다', () => {
  assert.equal(hasVisitedStop(2, 1, true), false);
  assert.equal(hasVisitedStop(1, 0, false), false);
});

test('목록에 없는 경유지(-1)는 가 본 곳이 아니다', () => {
  assert.equal(hasVisitedStop(-1, 3, true), false);
});
