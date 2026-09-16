/**
 * 세로 점선 조각의 dash 주기를 조각 높이에 맞춘다.
 *
 * 타임라인 커넥터는 한 줄이 아니라 여러 조각이다 — 행마다 `above`/`below` 가 따로고,
 * 조각 높이는 카드 내용(할 일 칩·안내문)에 따라 제각각이다. 그런데 조각마다
 * 독립된 SVG 라 `strokeDasharray` 의 phase 가 매번 0(온전한 dash)에서 다시 시작한다.
 *
 * 그래서 이음매가 dash 한가운데 떨어지면 두 dash 가 붙어 통짜 선이 되고,
 * 간격 한가운데면 구멍이 된다. 2026-09-16 화면 실측에서 5pt 여야 할 dash 가 9~10pt,
 * 4pt 여야 할 간격이 6pt 로 나왔다. '다음 장소 도착' 때 유난히 보이는 이유는
 * 그때 구간 두 개의 스타일이 한꺼번에 바뀌어 이음매 위치가 통째로 옮겨가기 때문이다.
 *
 * 고치는 방법은 조각마다 주기를 **정수 개** 넣는 것이다. 그러면 모든 조각이
 * phase 0 에서 시작해 phase 0 에서 끝나므로 이음매가 언제나 `간격 → dash` 경계가 된다.
 * 대신 주기가 조각마다 몇 % 씩 달라지는데, 이건 눈에 안 띈다 — 통짜 선과 구멍은 띈다.
 */

/** 디자인 원안의 주기. on:off = 5:4 */
export const DASH_ON = 5;
export const DASH_OFF = 4;
const PERIOD = DASH_ON + DASH_OFF;

export type DashFit = { on: number; off: number };

/**
 * 높이 `height` 안에 5:4 비율을 유지한 채 주기를 정수 개 넣는다.
 * 잴 수 없는 높이(0 이하·NaN)면 null — 부르는 쪽이 아직 그리지 않는다.
 */
export function fitDashV(height: number): DashFit | null {
  if (!Number.isFinite(height) || height <= 0) return null;
  // 한 주기도 못 넣는 짧은 조각이라도 dash 는 하나 그린다 — 안 그리면 거기만 뚫린다
  const periods = Math.max(1, Math.round(height / PERIOD));
  const period = height / periods;
  return { on: (period * DASH_ON) / PERIOD, off: (period * DASH_OFF) / PERIOD };
}
