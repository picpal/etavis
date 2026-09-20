/** 내 장소 라벨 — 슬롯(집·회사)을 바꿀 때 라벨을 따라 옮길지 정한다.
 *
 *  자동으로 채워진 라벨만 따라간다. 사람이 '본가'라고 적어 둔 걸 슬롯 바꿨다고
 *  갈아치우면 남이 쓴 글을 지우는 것이다. 반대로 자동으로 찬 '집'을 그대로 두면
 *  회사 슬롯에 "집"이라 적힌 항목이 남는다 — 실제로 목록에 "집"이 두 개 보였다.
 */

export type PlaceSlot = 'home' | 'work' | null;

const DEFAULT_LABEL: Record<'home' | 'work', string> = { home: '집', work: '회사' };

/** 슬롯 기본값으로 자동으로 채워졌던 라벨인가 */
function isAutoFilled(label: string): boolean {
  return Object.values(DEFAULT_LABEL).includes(label);
}

export function labelForSlot(current: string, slot: PlaceSlot): string {
  if (slot === null) return current; // 직접 입력 — 이름은 사람 몫이다
  const trimmed = current.trim();
  if (!trimmed || isAutoFilled(trimmed)) return DEFAULT_LABEL[slot];
  return current;
}
