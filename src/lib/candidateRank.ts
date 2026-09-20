/**
 * 후보 비교 시트의 정렬·필터. 순수 함수라 UI 없이 시험한다.
 *
 * - 마감(closed)·선택불가(disabled)는 아예 보여주지 않는다. 고를 수 없는 걸 목록에 두면
 *   "왜 못 고르지"만 남는다. 곧 마감(closing_soon)은 고를 수 있으니 남긴다.
 * - 정렬 기준은 탭 순서와 1:1. 동률이면 항상 추가시간이 짧은 쪽이 먼저다.
 */
import type { Candidate } from '../data/mockData';
import { clusterCandidates, preferenceOrder, SAME_TIME_M, type Cluster } from './routePlan/cluster';

export const CANDIDATE_SORTS = ['추천', '추가시간', '주차'] as const;
export type CandidateSort = 0 | 1 | 2;

const parkingRank: Record<Candidate['parking'], number> = { 가능: 0, 모름: 1, 어려움: 2, 없음: 3 };

const byAdded = (a: Candidate, b: Candidate) => a.addedMin - b.addedMin;
const keyFor: Record<CandidateSort, (c: Candidate) => number> = {
  // 점수는 클수록 좋다 — 다른 축과 방향을 맞추려고 음수로 뒤집는다.
  // trend 가 없으면 +Infinity — scoreTrend의 점수 범위가 나중에 바뀌어도
  // "구조적으로 어떤 점수보다 크다"는 사실 자체는 안 바뀐다. 매직넘버로 상한을
  // 가정하지 않는다.
  0: c => (c.trend ? -c.trend.score : Number.POSITIVE_INFINITY),
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
 * 시트가 그리는 단위. 고를 수 없는 곳을 먼저 빼고(빼야 그것이 묶음 대표가 되는 일이 없다),
 * 탭 기준으로 한 줄로 세운 뒤 자리로 묶는다. 묶음끼리의 순서는 **대표**의 키로 정하고,
 * 묶음 안은 흩지 않는다 — 탭을 '추가시간'으로 바꿔도 한 자리 안의 4곳이 흩어져 목록 여기저기로
 * 튀면 "같은 자리"라는 말이 거짓이 된다
 */
export function rankClusters(
  candidates: readonly Candidate[],
  sort: CandidateSort,
  currentId?: string,
): Cluster<Candidate>[] {
  const key = keyFor[sort];
  const flat = rankCandidates(candidates, sort);
  return clusterCandidates(flat, SAME_TIME_M, currentId).map(g => ({
    ...g,
    members: [g.lead, ...g.members.filter(c => c !== g.lead).sort(preferenceOrder)],
  }))
    .sort((a, b) => key(a.lead) - key(b.lead) || byAdded(a.lead, b.lead));
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
