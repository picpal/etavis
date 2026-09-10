/**
 * 방문 순열 열거. V ≤ 3은 전수(beamWidth=Infinity), V ≥ 4는 beam.
 * 상태 = (지금까지 순서, 쓴 후보 id, 슬롯별 남은 방문 수).
 */
import type { PlaceCandidate, Slot, Visit } from './types';

export function effectiveCandidates(slot: Slot): PlaceCandidate[] {
  if (!slot.flexible && slot.candidates.length > 0) return [slot.candidates[0]];
  return slot.candidates;
}

export function totalVisits(slots: Slot[]): number {
  return slots.reduce((n, s) => n + (s.candidates.length ? Math.max(1, s.count) : 0), 0);
}

type State = { seq: Visit[]; used: Set<string>; remain: number[] };

export function enumeratePlans(
  slots: Slot[],
  order: 'auto' | 'locked',
  partialScore: (seq: Visit[]) => number,
  beamWidth: number,
): Visit[][] {
  const active = slots.filter(s => s.candidates.length > 0);
  const V = totalVisits(active);
  let frontier: State[] = [{ seq: [], used: new Set(), remain: active.map(s => Math.max(1, s.count)) }];

  for (let depth = 0; depth < V; depth++) {
    const next: State[] = [];
    for (const st of frontier) {
      // locked: 남은 첫 슬롯만. auto: 남은 모든 슬롯
      const slotIdx = st.remain.map((r, i) => (r > 0 ? i : -1)).filter(i => i >= 0);
      const choices = order === 'locked' ? slotIdx.slice(0, 1) : slotIdx;
      for (const i of choices) {
        const slot = active[i];
        for (const cand of effectiveCandidates(slot)) {
          if (st.used.has(cand.id)) continue;
          const remain = st.remain.slice();
          remain[i]--;
          next.push({
            seq: [...st.seq, { slotId: slot.id, candidate: cand, dwellMin: slot.dwellMin }],
            used: new Set([...st.used, cand.id]),
            remain,
          });
        }
      }
    }
    if (next.length > beamWidth) {
      next.sort((a, b) => partialScore(a.seq) - partialScore(b.seq));
      next.length = beamWidth;
    }
    frontier = next;
  }
  // 같은 슬롯 count>1은 순서가 달라도 같은 집합 → 순열 그대로 둔다(순서가 곧 경로)
  return frontier.map(s => s.seq);
}
