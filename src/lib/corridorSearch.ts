/**
 * 회랑 검색 — 직행 폴리라인 위 5개 점에서 찾고, target(기본 need)만큼 모일 때까지 반지름을 2배씩 넓힌다.
 * status는 need 기준. 상한까지 없으면 가장 가까운 곳을 far로 넣는다. 설계 0.5단계.
 * 검색 함수는 주입받는다(places.ts는 expo-constants를 물고 있어 node 테스트가 못 읽는다).
 */
import { crossTrack, haversineM, pointAtProgress, polylineLengthM } from './geo';
import type { LatLng, Mode, PlaceCandidate, SearchStatus } from './routePlan/types';
import type { Anchor } from './routePlan/anchors';

export type SearchFn = (query: string, near: LatLng, radiusM: number) => Promise<PlaceCandidate[]>;

export type CorridorSearchOptions = {
  /** 이보다 적으면 short. 사용자가 말한 개수(count) */
  need: number;
  /** 이만큼 모일 때까지 반지름을 넓힌다. 없으면 need. 추천·교체 시트는 후보가 많아야 의미가 있다 */
  target?: number;
  initialRadiusM: number;
  maxRadiusM: number;
  samples?: number;
  /** far 단계에서 한 번 더 찾을 반지름. 카카오 로컬 상한 20km */
  farRadiusM?: number;
  /** 최대 몇 개까지 돌려줄지. 추천 점수는 후보가 많아야 의미가 있다 */
  max?: number;
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
): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number; calls: number }> {
  const samples = opts.samples ?? 5;
  let calls = 0;
  const countedSearch: SearchFn = (q, near, r) => { calls++; return search(q, near, r); };
  const L = polylineLengthM(poly);
  const points: LatLng[] = [];
  for (let i = 0; i < samples; i++) points.push(pointAtProgress(poly, (L * i) / (samples - 1)).point);

  const max = opts.max ?? 30;
  const byCorridor = (list: PlaceCandidate[]) =>
    [...list]
      .sort((a, b) => crossTrack(a.coord, poly).distanceM - crossTrack(b.coord, poly).distanceM)
      .slice(0, max);

  const merge = (lists: PlaceCandidate[][]) => {
    const seen = new Map<string, PlaceCandidate>();
    for (const l of lists) for (const c of l) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()];
  };

  const target = Math.max(opts.need, opts.target ?? opts.need);
  let radiusM = opts.initialRadiusM;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = merge(await Promise.all(points.map(p => countedSearch(query, p, r))));
    if (found.length >= target) return { candidates: byCorridor(found), status: 'ok', radiusM: r, calls };
    if (r >= opts.maxRadiusM) break;
    radiusM = Math.min(opts.maxRadiusM, r * 2);
  }
  if (found.length >= opts.need) return { candidates: byCorridor(found), status: 'ok', radiusM, calls };
  if (found.length > 0) return { candidates: byCorridor(found), status: 'short', radiusM, calls };

  // 상한까지 0건 — 더 멀리 한 번만 보고 가장 가까운 3곳
  const farR = opts.farRadiusM ?? 20_000;
  if (farR > opts.maxRadiusM) {
    const far = merge(await Promise.all(points.map(p => countedSearch(query, p, farR))));
    if (far.length > 0) return { candidates: byCorridor(far).slice(0, 3), status: 'far', radiusM: farR, calls };
  }
  return { candidates: [], status: 'none', radiusM, calls };
}

/** 역에서 이만큼 안이면 "역 근처"다. 초기 반지름 */
export const ANCHOR_INITIAL_M = 500;
/** 여기를 넘으면 역 근처가 아니라 별개의 경유다 — 넓히기를 멈춘다 */
export const ANCHOR_MAX_M = 1500;

export type AnchorSearchOptions = {
  /** 이보다 적으면 short */
  need: number;
  /** 이만큼 모일 때까지 넓힌다. 없으면 need */
  target?: number;
  initialRadiusM?: number;
  maxRadiusM?: number;
  max?: number;
};

/**
 * 앵커 주변 검색 — 직선 위 아무 점이 아니라 실제로 내리는 역에서 찾는다.
 * 후보마다 가장 가까운 앵커와 그 거리를 붙인다. 순위는 여기서 정하지 않는다(7단계).
 */
export async function searchAtAnchors(
  anchors: Anchor[],
  query: string,
  opts: AnchorSearchOptions,
  search: SearchFn,
): Promise<{ candidates: PlaceCandidate[]; status: SearchStatus; radiusM: number; calls: number }> {
  const initial = opts.initialRadiusM ?? ANCHOR_INITIAL_M;
  const maxR = Math.max(initial, opts.maxRadiusM ?? ANCHOR_MAX_M);
  const target = Math.max(opts.need, opts.target ?? opts.need);
  const max = opts.max ?? 30;
  let calls = 0;

  /** 후보를 가장 가까운 앵커에 붙인다. 같은 id 가 여러 앵커에서 나오면 가까운 쪽이 이긴다 */
  const attach = (lists: PlaceCandidate[][]) => {
    const best = new Map<string, PlaceCandidate>();
    for (let i = 0; i < lists.length; i++) {
      const a = anchors[i];
      for (const c of lists[i]) {
        const walkM = Math.round(haversineM(a.coord, c.coord));
        const prev = best.get(c.id);
        if (prev && (prev.anchorWalkM ?? Infinity) <= walkM) continue;
        best.set(c.id, { ...c, anchorId: a.id, anchorWalkM: walkM });
      }
    }
    return [...best.values()].sort((x, y) => (x.anchorWalkM ?? 0) - (y.anchorWalkM ?? 0)).slice(0, max);
  };

  let radiusM = initial;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = attach(await Promise.all(anchors.map(a => { calls++; return search(query, a.coord, r); })));
    if (found.length >= target) return { candidates: found, status: 'ok', radiusM: r, calls };
    if (r >= maxR) break;
    radiusM = Math.min(maxR, r * 2);
  }
  if (found.length >= opts.need) return { candidates: found, status: 'ok', radiusM, calls };
  if (found.length > 0) return { candidates: found, status: 'short', radiusM, calls };
  return { candidates: [], status: 'none', radiusM, calls };
}
