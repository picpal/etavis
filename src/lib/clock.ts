/**
 * 하루 안의 시각 표기. **구현이 하나여야 한다.**
 *
 * 예전에 `plan.tsx`와 `planFlowBridge.ts`가 각자 `toHHMM`을 갖고 있었고, 둘의
 * 동작이 달랐다 — 하나는 반올림을 하고 시를 0으로 채웠고, 다른 하나는 둘 다
 * 하지 않았다. 그래서 같은 계획이 화면마다 다른 시각을 말했다.
 * 호출부들은 저마다 `.padStart(5, '0')`을 붙여 그 차이를 덮고 있었다.
 */

/**
 * 자정 기준 분 → `HH:MM`.
 *
 * **반올림을 먼저 한다.** 시를 내림하고 분을 따로 반올림하면 599.7이
 * `09:00`이 된다 — `10:00`이어야 한다.
 *
 * 소수를 그대로 받는 것이 요점이다. 경로 계산은 `25.716분` 같은 값을 내고,
 * 구간마다 반올림해 더하면 누적 오차로 도착 시각이 통째로 밀린다.
 * 정밀한 값으로 누적하다가 **표기할 때 한 번만** 반올림한다.
 */
export const toHHMM = (min: number): string => {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** `HH:MM` → 자정 기준 분. `8:11`처럼 0이 없어도 받는다 */
export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** 지금 시각(자정 기준 분) */
export const nowMin = (): number => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
