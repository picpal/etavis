/**
 * 주차 정책 — 자동차로 가면 후보를 고를 때 주차 가능 여부를 기본으로 본다.
 *
 * 왜: 차로 들르는데 주차가 안 되는 매장을 추천하면 도착 시각이 맞아도 소용없다.
 * 다만 지금 실제 검색(카카오 로컬)은 주차 정보를 주지 않는다 — 아는 것만 거른다:
 * '없음'으로 알려진 곳은 빼고, '가능'을 앞에, 모르는 곳은 그 다음, '어려움'은 뒤에.
 * 도보·대중교통은 손대지 않는다.
 */
import type { Mode } from './routePlan/types';

export type Parking = '가능' | '어려움' | '없음';

const RANK: Record<Parking | 'unknown', number> = { 가능: 0, unknown: 1, 어려움: 2, 없음: 3 };

export function parkingRank(p: Parking | undefined): number {
  return RANK[p ?? 'unknown'];
}

/** 자동차면 주차 없음 제외 + 가능 우선(안정 정렬). 그 외 모드는 그대로 */
export function applyParkingPolicy<T extends { parking?: Parking }>(candidates: readonly T[], mode: Mode): T[] {
  if (mode !== 'car') return [...candidates];
  return candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.parking !== '없음')
    .sort((a, b) => parkingRank(a.c.parking) - parkingRank(b.c.parking) || a.i - b.i)
    .map(({ c }) => c);
}
