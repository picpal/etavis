/**
 * 시드 선택(3단계), 2라운드 트리거(5단계), Q=3 선택(6단계).
 */
import { DEST_ID, ORIGIN_ID } from './legs';
import type { Scored } from './score';
import type { Visit } from './types';

export type Ranked = { visits: Visit[]; estA: number; estB: number; estC: number };

export const planKey = (visits: Visit[]): string => visits.map(v => v.candidate.id).join('>');

export function candidateSet(v: Visit[]): Set<string> {
  return new Set(v.map(x => x.candidate.id));
}

export function legSet(v: Visit[]): Set<string> {
  const ids = [ORIGIN_ID, ...v.map(x => x.candidate.id), DEST_ID];
  const out = new Set<string>();
  for (let i = 0; i < ids.length - 1; i++) out.add(`${ids[i]}>${ids[i + 1]}`);
  return out;
}

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function overlap(a: Visit[], b: Visit[]): number {
  return 0.6 * jaccard(candidateSet(a), candidateSet(b)) + 0.4 * jaccard(legSet(a), legSet(b));
}

export function pickSeeds(ranked: Ranked[], R: number): Visit[][] {
  const byC = [...ranked].sort((a, b) => a.estC - b.estC);
  const byA = [...ranked].sort((a, b) => a.estA - b.estA);
  const byB = [...ranked].sort((a, b) => a.estB - b.estB);
  const chosen: Visit[][] = [];
  const seen = new Set<string>();
  const push = (r?: Ranked) => {
    if (!r) return;
    const k = planKey(r.visits);
    if (seen.has(k) || chosen.length >= R) return;
    seen.add(k);
    chosen.push(r.visits);
  };
  push(byC[0]);
  push(byC[1]);
  push(byA[0]);
  push(byB[0]);
  // 부족분: C 상위 20개 중 기존 선택과 겹침이 가장 적은 안
  const pool = byC.slice(0, 20).filter(r => !seen.has(planKey(r.visits)));
  while (chosen.length < R && pool.length) {
    pool.sort((a, b) => {
      const oa = Math.max(...chosen.map(c => overlap(a.visits, c)));
      const ob = Math.max(...chosen.map(c => overlap(b.visits, c)));
      return oa - ob || a.estC - b.estC;
    });
    push(pool.shift());
  }
  return chosen;
}

export const deltaMaxMin = (directMin: number): number => Math.min(8, Math.max(2, 0.15 * directMin));
export const marginMin = (directMin: number): number => Math.max(2, 0.08 * directMin);

/** 1안 = 최단. 이후 T + max_q(Δmax·overlap) 최소를 반복 선택 */
export function pickOptions(measured: Scored[], directMin: number, q: number): Scored[] {
  if (measured.length === 0) return [];
  const sorted = [...measured].sort((a, b) => a.totalMin - b.totalMin);
  const dmax = deltaMaxMin(directMin);
  const pool = sorted.filter(s => s.totalMin <= sorted[0].totalMin + dmax);
  const out: Scored[] = [pool[0]];
  const rest = pool.slice(1);
  const score = (p: Scored) => p.totalMin + dmax * Math.max(...out.map(s => overlap(p.visits, s.visits)));
  while (out.length < q && rest.length) {
    rest.sort((a, b) => score(a) - score(b));
    out.push(rest.shift()!);
  }
  return out;
}

export type Round2Input = {
  measured: Scored[];
  rescored: Scored[];
  legErrors: { measuredMin: number; estimatedMin: number }[];
  arriveByMin?: number;
  directMin: number;
};

export function round2Plan(input: Round2Input): { extra: Visit[][]; reason: string | null } {
  const { measured, rescored, legErrors, arriveByMin, directMin } = input;
  const mu = marginMin(directMin);
  const measuredKeys = new Set(measured.map(m => planKey(m.visits)));
  const unmeasured = rescored.filter(r => !measuredKeys.has(planKey(r.visits))).sort((a, b) => a.totalMin - b.totalMin);
  const sortedMeasured = [...measured].sort((a, b) => a.totalMin - b.totalMin);

  const ratios = legErrors
    .filter(e => e.measuredMin >= 3 && e.estimatedMin > 0)
    .map(e => Math.max(e.measuredMin / e.estimatedMin, e.estimatedMin / e.measuredMin));
  const maxRatio = ratios.length ? Math.max(...ratios) : 1;
  const sumM = legErrors.reduce((s, e) => s + e.measuredMin, 0);
  const wape = sumM > 0 ? legErrors.reduce((s, e) => s + Math.abs(e.measuredMin - e.estimatedMin), 0) / sumM : 0;
  const third = sortedMeasured[2]?.totalMin;
  const challenger = unmeasured.find(u => u.unknownLegs === 1 && third != null && u.totalMin <= third + mu);
  const best = sortedMeasured[0];
  const nearDeadline =
    arriveByMin != null && best != null && best.arrivals.length > 0 &&
    Math.abs(best.arrivals[best.arrivals.length - 1] - arriveByMin) <= mu;
  const fewValid = measured.length < 3;

  const reasons: string[] = [];
  if (maxRatio > 1.6) reasons.push(`leg 오차 ${maxRatio.toFixed(2)}`);
  if (wape > 0.25) reasons.push(`WAPE ${wape.toFixed(2)}`);
  if (challenger) reasons.push('도전자');
  if (nearDeadline) reasons.push('마감 경계');
  if (fewValid) reasons.push('유효 실측 부족');
  if (reasons.length === 0) return { extra: [], reason: null };

  const oneUnknown = unmeasured.filter(u => u.unknownLegs === 1);
  const base = (oneUnknown.length ? oneUnknown : unmeasured.filter(u => u.unknownLegs <= 2)).slice(0, 2);
  const extra = base.map(s => s.visits);
  if (maxRatio > 2.0 || wape > 0.4 || fewValid) {
    const chosen = new Set(extra.map(planKey));
    const explorer = [...unmeasured]
      .filter(u => !chosen.has(planKey(u.visits)))
      .sort((a, b) => b.unknownLegs - a.unknownLegs || a.totalMin - b.totalMin)[0];
    if (explorer) extra.push(explorer.visits);
  }
  return { extra, reason: reasons.join(' · ') };
}
