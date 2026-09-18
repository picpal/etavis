/**
 * `추천 순서 | 최단 시간` 탭의 상태.
 *
 * 탭은 **늘 보인다.** 짐이 있을 때만 띄우던 시절엔, 같은 말을 해도 어떤 날은 탭이
 * 있고 어떤 날은 없었다 — 판정(`loadAfter`)이 흔들리기 때문이다. 화면이 흔들리면
 * 사용자는 자기가 뭘 잘못 눌렀는지 의심한다. 그래서 자리는 고정하고, 가리킬 안이
 * 없을 때는 그 사실을 문구로 말한다.
 */
export function recommendTabState(
  comfortIdx: number | null,
  selectedIdx: number,
): { target: number; value: 0 | 1; sameAsFast: boolean } {
  /* null 은 짐을 안 쟀다는 뜻이고 0 은 최단안이 곧 편한 안이라는 뜻이다. 원인은
     다르지만 화면이 할 일은 같다 — 가리킬 다른 안이 없다 */
  const sameAsFast = comfortIdx == null || comfortIdx === 0;
  if (sameAsFast) return { target: 0, value: 0, sameAsFast: true };
  return { target: comfortIdx, value: selectedIdx === comfortIdx ? 0 : 1, sameAsFast: false };
}
