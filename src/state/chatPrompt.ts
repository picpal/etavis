/**
 * A2의 '경로 찾기' 프롬프트를 지금 보여도 되는가.
 *
 * `PlanScreen.tsx`를 런타임으로 물지 않으려고 값만 받는다. 테스트가 직접 부른다 —
 * 이 화면에서만 드러난 결함이 이번 단계에 셋이었고(질문 중복 렌더, `chipFor` 오매칭,
 * 그리고 이것) 리뷰는 하나도 못 잡았다. 화면이 "언제 무엇을 보여주나"가 그 셋의
 * 공통점이라, 그 판단만 여기로 꺼낸다.
 *
 * 추출이 도는 동안에는 보이면 안 된다. 그때 누르면 `startSearch`가 곧장
 * `Calculating`으로 넘어가고, 몇 초 뒤 도착한 추출 결과는 이미 떠난 화면에
 * `applyIntent` + `flow.reset()`으로 반영된다 — **사용자가 방금 말한 경유지가
 * 빠진 채로 경로가 계산된다.** 2026-09-16 시뮬레이터에서 "알아듣는 중이에요…"
 * 아래에 "조건은 준비됐어요. 이제 경로를 찾아볼까요?"가 버튼까지 함께 떠 있었다.
 */
export function calcPromptVisible(o: { pending: boolean; chatLength: number; dismissedAt: number }): boolean {
  if (o.pending) return false;
  // '아직이요'로 미룬 시점의 대화 길이 — 새 메시지가 와야 다시 묻는다.
  // 대화가 없을 때(0 > -1)도 참이다 — 직행 경로는 말 없이도 찾을 수 있다
  return o.chatLength > o.dismissedAt;
}

/** 칩이 하나라도 있을 때의 말풍선 — 보여준 칩을 지우라는 안내다 */
export const HEARD_TEXT = '이렇게 알아들었어요. 틀린 건 지워주세요.';

/**
 * 아무것도 못 건졌을 때. 음성 오인식(`요 DJ Font 스파리 호호호`)이 그대로 넘어오면
 * 추출이 비는데, 그때도 화면은 '알아들었어요'라고 말했다 — 지울 칩이 하나도 없는데.
 */
export const NOTHING_HEARD_TEXT = '들를 곳을 못 찾았어요. ‘올리브영 들러서’ 처럼 말해 보세요.';

/**
 * 말풍선에 쓸 한 줄.
 *
 * 서버가 할 말(되묻기·거절)이 있으면 칩이 비어도 그게 우선이다 — 그건 못 알아들은
 * 게 아니라 되묻는 중이라서, 여기서 덮으면 사용자가 답할 질문이 사라진다.
 */
export function assistantSay(o: { reply: string | null; chipCount: number }): string {
  if (o.reply != null) return o.reply;
  return o.chipCount === 0 ? NOTHING_HEARD_TEXT : HEARD_TEXT;
}

/**
 * 프롬프트를 어느 쪽으로 보여줄까. `'direct'`는 '들를 곳 없이 바로 찾기',
 * `'calculate'`는 "조건은 준비됐어요".
 *
 * 칩에는 경유지뿐 아니라 도착 시각·이동수단도 들어간다 — 칩이 0이면 정말로 건진 게
 * 없다는 뜻이다. 말은 했는데 칩이 0인 경우가 여태 둘 사이로 샜다: 준비된 조건이
 * 하나도 없는데 '준비됐다'고 물었다. 직행으로 가는 길은 남기되 거짓말은 안 한다.
 */
export function promptKind(o: { chatLength: number; chipCount: number }): 'direct' | 'calculate' {
  return o.chatLength === 0 || o.chipCount === 0 ? 'direct' : 'calculate';
}
