/**
 * 후보 비교 시트의 정렬·필터. 순수 함수라 UI 없이 시험한다.
 *
 * - 마감(closed)·선택불가(disabled)는 아예 보여주지 않는다. 고를 수 없는 걸 목록에 두면
 *   "왜 못 고르지"만 남는다. 곧 마감(closing_soon)은 고를 수 있으니 남긴다.
 * - 정렬 기준은 탭 순서와 1:1. 동률이면 항상 추가시간이 짧은 쪽이 먼저다.
 */
import type { Candidate } from '../data/mockData';

export const CANDIDATE_SORTS = ['추천', '추가시간', '주차'] as const;
export type CandidateSort = 0 | 1 | 2;

const parkingRank: Record<Candidate['parking'], number> = { 가능: 0, 모름: 1, 어려움: 2, 없음: 3 };

const byAdded = (a: Candidate, b: Candidate) => a.addedMin - b.addedMin;
const keyFor: Record<CandidateSort, (c: Candidate) => number> = {
  // 점수는 클수록 좋다 — 다른 축과 방향을 맞추려고 음수로 뒤집는다.
  // trend 가 없으면 2(어떤 점수보다도 큰 값)라 항상 뒤로 간다
  0: c => (c.trend ? -c.trend.score : 2),
  1: c => c.addedMin,
  2: c => parkingRank[c.parking],
};

export function isSelectable(c: Candidate): boolean {
  return !c.disabled && c.openState !== 'closed';
}

export function rankCandidates(candidates: readonly Candidate[], sort: CandidateSort): Candidate[] {
  const key = keyFor[sort];
  return candidates.filter(isSelectable).sort((a, b) => key(a) - key(b) || byAdded(a, b));
}

/**
 * 이 상황에서 보여줄 탭. 고를 수 없는 기준을 탭으로 두면 "왜 안 바뀌지"만 남는다.
 *   주차 — 자동차일 때만 의미가 있다
 *   추천 — 신호가 하나라도 있어야 한다(브랜드 슬롯은 보강을 안 한다)
 */
export function sortsFor(
  mode: 'car' | 'walk' | 'transit',
  hasTrend: boolean,
): { label: (typeof CANDIDATE_SORTS)[number]; sort: CandidateSort }[] {
  const out: { label: (typeof CANDIDATE_SORTS)[number]; sort: CandidateSort }[] = [];
  if (hasTrend) out.push({ label: '추천', sort: 0 });
  out.push({ label: '추가시간', sort: 1 });
  if (mode === 'car') out.push({ label: '주차', sort: 2 });
  return out;
}
