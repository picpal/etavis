/**
 * 회랑 검색 — 직행 폴리라인 위 5개 점에서 찾고, 없으면 반지름을 2배씩 넓힌다.
 * 상한까지 없으면 가장 가까운 곳을 far로 넣는다. 설계 0.5단계.
 * 검색 함수는 주입받는다(places.ts는 expo-constants를 물고 있어 node 테스트가 못 읽는다).
 */
import { crossTrack, pointAtProgress, polylineLengthM } from './geo';
import type { LatLng, Mode, PlaceCandidate, SearchStatus } from './routePlan/types';

export type SearchFn = (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]>;

export type CorridorSearchOptions = {
  need: number;
  initialRadiusM: number;
  maxRadiusM: number;
  samples?: number;
  /** far 단계에서 한 번 더 찾을 반지름. 카카오 로컬 상한 20km */
  farRadiusM?: number;
};

const INITIAL: Record<Mode, number> = { car: 2000, walk: 500, transit: 800 };
const ABS_MAX: Record<Mode, number> = { car: 15000, walk: 2000, transit: 3000 };

export const initialRadiusM = (mode: Mode): number => INITIAL[mode];

/** 추정 우회 ≈ 2r·ρ 가 여유를 넘지 않게. 여유가 없으면 절대 상한 */
export function maxRadiusM(mode: Mode, slackMin: number | null, rhoMinPerKm: number): number {
  const abs = ABS_MAX[mode];
  if (slackMin == null || slackMin <= 0) return abs;
  const bySlack = (slackMin / (2 * rhoMinPerKm)) * 1000;
  return Math.min(abs, Math.round(bySlack));
}

export async function searchAlong(
  poly: LatLng[],
  query: string,
  opts: CorridorSearchOptions,
  search: SearchFn,
): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number }> {
  const samples = opts.samples ?? 5;
  const L = polylineLengthM(poly);
  const points: LatLng[] = [];
  for (let i = 0; i < samples; i++) points.push(pointAtProgress(poly, (L * i) / (samples - 1)).point);

  const byCorridor = (list: PlaceCandidate[]) =>
    [...list].sort((a, b) => crossTrack(a.coord, poly).distanceM - crossTrack(b.coord, poly).distanceM);

  const merge = (lists: PlaceCandidate[][]) => {
    const seen = new Map<string, PlaceCandidate>();
    for (const l of lists) for (const c of l) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()];
  };

  let radiusM = opts.initialRadiusM;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = merge(await Promise.all(points.map(p => search(query, p, r))));
    if (found.length >= opts.need) return { candidates: byCorridor(found), status: 'ok', radiusM: r };
    if (r >= opts.maxRadiusM) break;
    radiusM = Math.min(opts.maxRadiusM, r * 2);
  }
  if (found.length > 0) return { candidates: byCorridor(found), status: 'short', radiusM };

  // 상한까지 0건 — 더 멀리 한 번만 보고 가장 가까운 3곳
  const farR = opts.farRadiusM ?? 20_000;
  if (farR > opts.maxRadiusM) {
    const far = merge(await Promise.all(points.map(p => search(query, p, farR))));
    if (far.length > 0) return { candidates: byCorridor(far).slice(0, 3), status: 'far', radiusM: farR };
  }
  return { candidates: [], status: 'none', radiusM };
}
