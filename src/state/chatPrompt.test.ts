import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantSay, calcPromptVisible, HEARD_TEXT, NOTHING_HEARD_TEXT, promptKind } from './chatPrompt';

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

test('아무것도 못 잡았으면 알아들은 척하지 않는다', () => {
  // 실기기: 음성 오인식 '요 DJ Font 스파리 호호호'로 칩이 하나도 안 생겼는데
  // 화면은 "틀린 건 지워주세요"라고 했다 — 지울 것이 없다
  assert.equal(assistantSay({ reply: null, chipCount: 0 }), NOTHING_HEARD_TEXT);
});

test('칩이 비어도 서버가 할 말이 있으면 그게 우선이다', () => {
  // 되묻기·거절은 못 알아들은 게 아니다. 덮으면 사용자가 답할 질문이 사라진다
  assert.equal(assistantSay({ reply: '어느 지점이요?', chipCount: 0 }), '어느 지점이요?');
});

test('칩이 있으면 지우라고 안내한다 — 지울 것이 실제로 있다', () => {
  assert.equal(assistantSay({ reply: null, chipCount: 2 }), HEARD_TEXT);
});

test("칩이 0이면 '준비됐어요'라고 묻지 않는다 — 준비된 조건이 없다", () => {
  assert.equal(promptKind({ chatLength: 3, chipCount: 0 }), 'direct');
});

test('첫 진입(대화 0)은 지금처럼 직행 줄 하나', () => {
  assert.equal(promptKind({ chatLength: 0, chipCount: 0 }), 'direct');
});

test('말이 오갔고 건진 것도 있을 때만 경로를 찾자고 묻는다', () => {
  assert.equal(promptKind({ chatLength: 2, chipCount: 1 }), 'calculate');
});
