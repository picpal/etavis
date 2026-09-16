import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcPromptVisible } from './chatPrompt';

test('추출이 도는 동안에는 경로 찾기를 보여주지 않는다', () => {
  // 2026-09-16 시뮬레이터: "알아듣는 중이에요…" 아래에 "조건은 준비됐어요"가 같이 떠 있었다.
  // 그때 누르면 방금 말한 경유지가 빠진 채로 계산이 시작된다
  assert.equal(calcPromptVisible({ pending: true, chatLength: 1, dismissedAt: -1 }), false);
});

test('추출이 끝나면 다시 보여준다', () => {
  assert.equal(calcPromptVisible({ pending: false, chatLength: 1, dismissedAt: -1 }), true);
});

test("'아직이요'로 미룬 뒤에는 새 메시지가 와야 다시 묻는다", () => {
  assert.equal(calcPromptVisible({ pending: false, chatLength: 2, dismissedAt: 2 }), false);
  assert.equal(calcPromptVisible({ pending: false, chatLength: 3, dismissedAt: 2 }), true);
});

test('미룬 뒤 새 메시지를 보내도, 추출 중이면 아직 아니다', () => {
  // pending 이 dismissedAt 보다 뒤에 걸린다 — 두 조건을 or 로 쓰면 이 케이스가 샌다
  assert.equal(calcPromptVisible({ pending: true, chatLength: 3, dismissedAt: 2 }), false);
});

test('대화가 없어도 직행은 찾을 수 있다', () => {
  /* 이때 화면에 뜨는 건 어시스턴트 말풍선이 아니라 조용한 줄 하나다(PlanScreen.DirectPrompt).
     듣지도 않고 "조건은 준비됐어요"라고 말하면 앞뒤가 안 맞는다. 보여주느냐(여기)와
     무엇을 보여주느냐(화면)는 다른 판단이라, 이 규칙은 그대로 둔다 */
  assert.equal(calcPromptVisible({ pending: false, chatLength: 0, dismissedAt: -1 }), true);
});
