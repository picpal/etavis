/**
 * 들른 곳 판정 — 화면(A9 시트)과 리듀서가 같은 답을 봐야 한다.
 * 한쪽만 넓혔다가 제보가 조용히 버려진 적이 있다.
 *
 * 예전엔 인덱스(`stopIdx < passedCount`)로 판단했다. 스쳐 지나간 경유지도
 * passedCount 를 올리기 때문에, 차로 옆을 지나가기만 해도 가 본 곳이 됐다.
 * 이제 기준은 판정부가 체류 시간으로 확정해 준 id 집합 하나뿐이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasVisitedStop } from './congestion';

test('방문 집합에 있는 경유지는 들른 곳이다', () => {
  assert.equal(hasVisitedStop('s1', ['s1', 's2']), true);
});

test('지나오기만 한 경유지는 들른 곳이 아니다 — 지금 서 있어도 체류를 채워야 방문이다', () => {
  assert.equal(hasVisitedStop('s2', ['s1']), false);
});

test('방문 기록이 비어 있으면 아무 곳도 들른 곳이 아니다', () => {
  assert.equal(hasVisitedStop('s1', []), false);
});

test('목록에 없는 id 는 들른 곳이 아니다', () => {
  assert.equal(hasVisitedStop('없는곳', ['s1', 's2']), false);
});
