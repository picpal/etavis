/**
 * '아는 곳' 매칭 — 출발지·목적지 변경에 쓰는 이름 대조 규칙 하나를 여기 둔다.
 *
 * 정규화(공백 제거)한 완전 일치, 아니면 아는 이름이 말로 **시작**하는 경우(말이 2자
 * 이상일 때만). 예전엔 부분문자열을 양방향으로 봤다 — 등록한 장소가 늘면 라벨 '집'이
 * '포장마차집'에 걸려 엉뚱하게 집으로 튄다(짧은 라벨이 긴 말을 삼킨다). 방향을 하나로
 * 줄이면 아는 쪽이 늘 더 긴 문자열이라 짧은 라벨이 남의 말을 삼킬 수 없다.
 * 앞자리 매칭을 두 글자부터 보는 이유: '집' 한 글자가 '집들이 장소'의 앞을 물면 안
 * 된다. 완전 일치는 길이를 안 따진다 — '집'은 그 자체로 등록해 둔 이름이다.
 *
 * `src/state/plan.tsx` 의 `pick()`(REPLACE_STOPS 리듀서)이 이 규칙으로 실제 목적지를
 * 바꾼다. `src/lib/intent.ts` 는 되묻기 여부를 미리 판정할 때 같은 규칙을 써야 한다 —
 * 안 그러면 목은 "아는 곳"이라 답했는데 리듀서는 못 잡아 화면이 아무 반응 없이 끝난다.
 * 다만 intent.ts 는 로컬 import 가 있으면 run-cases.mjs 의 flat 컴파일(tsc 단일 파일)이
 * 안 서므로 이 함수를 가져다 쓰지 못하고, 같은 규칙을 그대로 인라인해 둔다 — 규칙을
 * 바꾸면 두 파일을 같이 고칠 것.
 */
export function findKnownMatch<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  said: string | undefined,
): T | undefined {
  if (!said) return undefined;
  const norm = (s: string) => s.replace(/\s+/g, '');
  const target = norm(said);
  if (!target) return undefined;
  const exact = items.find(it => norm(nameOf(it)) === target);
  if (exact) return exact;
  return target.length >= 2 ? items.find(it => norm(nameOf(it)).startsWith(target)) : undefined;
}
