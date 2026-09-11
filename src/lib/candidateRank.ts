/**
 * 후보 비교 시트의 정렬·필터. 순수 함수라 UI 없이 시험한다.
 *
 * - 마감(closed)·선택불가(disabled)는 아예 보여주지 않는다. 고를 수 없는 걸 목록에 두면
 *   "왜 못 고르지"만 남는다. 곧 마감(closing_soon)은 고를 수 있으니 남긴다.
 * - 정렬 기준은 탭 순서와 1:1. 동률이면 항상 추가시간이 짧은 쪽이 먼저다.
 */
import type { Candidate } from '../data/mockData';

export const CANDIDATE_SORTS = ['추가시간', '주차', '거리'] as const;
export type CandidateSort = 0 | 1 | 2;

const parkingRank: Record<Candidate['parking'], number> = { 가능: 0, 모름: 1, 어려움: 2, 없음: 3 };

const byAdded = (a: Candidate, b: Candidate) => a.addedMin - b.addedMin;
const keyFor: Record<CandidateSort, (c: Candidate) => number> = {
  0: c => c.addedMin,
  1: c => parkingRank[c.parking],
  2: c => c.detourKm,
};

export function isSelectable(c: Candidate): boolean {
  return !c.disabled && c.openState !== 'closed';
}

export function rankCandidates(candidates: readonly Candidate[], sort: CandidateSort): Candidate[] {
  const key = keyFor[sort];
  return candidates.filter(isSelectable).sort((a, b) => key(a) - key(b) || byAdded(a, b));
}
