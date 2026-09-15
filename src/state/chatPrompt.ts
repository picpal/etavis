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
