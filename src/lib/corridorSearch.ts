/**
 * 회랑 검색 — 직행 폴리라인 위 5개 점에서 찾고, target(기본 need)만큼 모일 때까지 반지름을 2배씩 넓힌다.
 * status는 need 기준. 상한까지 없으면 가장 가까운 곳을 far로 넣는다. 설계 0.5단계.
 * 검색 함수는 주입받는다(places.ts는 expo-constants를 물고 있어 node 테스트가 못 읽는다).
 */
import { crossTrack, haversineM, pointAtProgress, polylineLengthM } from './geo';
import type { LatLng, Mode, NearSide, PlaceCandidate, SearchStatus } from './routePlan/types';
import type { Anchor } from './routePlan/anchors';
import { matchesNear, NEAR_RADII_M } from './nearSide';

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
  /**
   * 어느 쪽 끝을 노릴까. 샘플 구간과 target 판정이 이걸 본다.
   * 'start'|'end' 면 origin·destination 이 있어야 한다 — 없으면 무시한다.
   */
  side?: NearSide;
  origin?: LatLng;
  destination?: LatLng;
  /**
   * 반경을 **한 회차 더** 넓힐 시간이 있나. `false` 면 그 자리에서 멈추고 지금까지
   * 모은 것으로 답한다. 없으면 지금까지처럼 사다리를 끝까지 오른다.
   *
   * 사다리는 회차마다 순차로 도는데(회차 안은 병렬), 근처에 그 업종이 없으면
   * 2000→4000→8000→15000 네 회차가 다 돈다. 실측 2026-09-19: 그 20콜이 검색
   * 단계를 6.4초로 밀어 계획 전체가 12초 예산을 넘겨 버렸다 — 그 시점에 후보는
   * 이미 손에 있었는데 통째로 버렸다. 후보를 덜 모으는 게 계획을 잃는 것보다 낫다.
   *
   * 첫 회차는 이 판정을 보지 않는다. 안 돌면 아무것도 못 찾는다.
   */
  canWiden?: () => boolean;
};

const INITIAL: Record<Mode, number> = { car: 2000, walk: 500, transit: 800 };
const ABS_MAX: Record<Mode, number> = { car: 15000, walk: 2000, transit: 3000 };

export const initialRadiusM = (mode: Mode): number => INITIAL[mode];

/** 컷이 near 쪽을 먼저 채울 때 보는 것. side 가 있어도 origin·destination 이 없으면 못 쓴다 */
type NearCut = { side: NearSide; origin: LatLng; destination: LatLng };

/**
 * 경로 위 위치로 묶어 라운드로빈으로 자른다.
 *
 * 왜 근접순 한 줄로 자르지 않나: 실측 2026-09-20, 서교동 → 코엑스 대중교통 13km 에서
 * CU 를 찾자 교체 시트 30곳이 **전부 홍대**였다(라이즈홍대점·서교타워점·홍대입구역점…).
 * 앵커 5개 중 출발지·승차역 둘이 홍대 안에 있고 카카오가 앵커당 15건을 주니
 * 2 × 15 = 30 = max 로 딱 찼고, 삼성역·코엑스 앵커의 CU 는 걷는 거리가 조금 더 멀어
 * 컷에 닿기도 전에 밀렸다. 회랑 검색도 표본 5점 중 한 점이 빽빽하면 같은 꼴이 난다 —
 * 경로 *진행* 을 보지 않고 자르면 한 동네가 목록을 독점한다(설계 §3 D4).
 *
 * 규칙: `bucketOf` 로 묶고(회랑은 진행률 구간, 앵커는 앵커) 버킷 안은 `rankOf`
 * 오름차순 — 오늘 기준(수직거리 / anchorWalkM)을 그대로 둔다. 버킷을 진행 순으로
 * 놓고 한 개씩 돌아가며 뽑아 `max` 에서 멈춘다. 빈 버킷은 건너뛴다. 공급이 있는
 * 버킷이 B 개면 각각 최소 ⌊max / B⌋ 자리를 얻는다 — 5개면 6곳이라 두 앵커가 30을 다 못 먹는다.
 *
 * `near` 가 있으면 두 패스 — near 쪽 후보들을 먼저 라운드로빈하고, 그다음 반대쪽.
 * **반대쪽을 버리지 않는다** — applyNear 의 완화가 되돌릴 후보가 없으면 완화 자체가
 * 무의미해진다(설계 §5.1). 이 계약은 이전 `nearFirst` 것 그대로다.
 *
 * 회랑 컷과 앵커 컷이 같은 함수를 쓴다. 두 벌로 두면 기준이 갈린다.
 * 같은 검색 결과를 다르게 자를 뿐이라 `/places` 호출은 한 번도 늘지 않는다.
 */
export function spreadCut<T extends { coord: LatLng }>(
  list: readonly T[],
  bucketOf: (c: T) => number,
  rankOf: (c: T) => number,
  max: number,
  near?: NearCut,
): T[] {
  const roundRobin = (items: readonly T[], cap: number): T[] => {
    const buckets = new Map<number, T[]>();
    for (const c of items) {
      const k = bucketOf(c);
      const b = buckets.get(k);
      if (b) b.push(c); else buckets.set(k, [c]);
    }
    const lanes = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, b]) => b.sort((x, y) => rankOf(x) - rankOf(y)));
    const out: T[] = [];
    for (let i = 0; out.length < cap; i++) {
      let took = false;
      for (const lane of lanes) {
        if (i >= lane.length) continue;
        out.push(lane[i]);
        took = true;
        if (out.length >= cap) break;
      }
      if (!took) break;
    }
    return out;
  };
  if (!near) return roundRobin(list, max);
  const on: T[] = [];
  const off: T[] = [];
  for (const c of list) {
    (matchesNear(near.side, c.coord, near.origin, near.destination, NEAR_RADII_M[0]) ? on : off).push(c);
  }
  const first = roundRobin(on, max);
  return [...first, ...roundRobin(off, max - first.length)];
}

/** 추정 우회 ≈ 2r·ρ 가 여유를 넘지 않게. 여유가 없으면 절대 상한 */
export function maxRadiusM(mode: Mode, slackMin: number | null, rhoMinPerKm: number): number {
  const abs = ABS_MAX[mode];
  if (slackMin == null || slackMin <= 0) return abs;
  const bySlack = (slackMin / (2 * rhoMinPerKm)) * 1000;
  return Math.min(abs, Math.round(bySlack));
}

/**
 * 표본 검색을 **한 건씩 독립으로** 본다.
 *
 * 왜: 2026-09-19 프로덕션에서 `/places` 30건 중 1건이 503(KV PUT 429)으로 죽었는데
 * `Promise.all` 이라 그 하나가 검색 전체를 reject 시켰고, 계획이 통째로 실패해
 * 사용자에겐 "연결이 불안정해요"만 보였다. 표본 하나는 표본 하나만큼만 잃어야 한다.
 *
 * 실패한 표본은 **빈 결과로 자리를 지킨다.** 자리를 빼면 `attach` 가 후보를 엉뚱한
 * 앵커에 붙인다 — 거긴 `used[i]` 로 인덱스를 되짚기 때문이다.
 *
 * 다만 **전부 실패하면 던진다.** 빈 배열로 돌려주면 "그 근처엔 그런 곳이 없다"가
 * 되는데 사실은 "보지 못했다"이다. 둘을 섞으면 사용자에게 없는 사실을 말하게 된다.
 */
async function settleSamples(tasks: Promise<PlaceCandidate[]>[]): Promise<PlaceCandidate[][]> {
  if (tasks.length === 0) return [];
  const settled = await Promise.allSettled(tasks);
  if (settled.every(r => r.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason;
  return settled.map(r => (r.status === 'fulfilled' ? r.value : []));
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
  // near 쪽 후보가 나올 구간에서만 찍는다. 점 개수는 그대로라 카카오 호출 수가 늘지 않는다.
  // 경계 0.5 는 완화 경계(절대 거리)와 별개다 — 검색은 넉넉하게, 필터는 좁게
  // side 가 있어도 origin·destination 이 없으면 무시한다(인터페이스 계약)
  const sided = (opts.side === 'start' || opts.side === 'end') && !!opts.origin && !!opts.destination;
  const [lo, hi] = sided && opts.side === 'end' ? [0.5, 1] : sided && opts.side === 'start' ? [0, 0.5] : [0, 1];
  const points: LatLng[] = [];
  for (let i = 0; i < samples; i++) {
    const t = lo + ((hi - lo) * i) / (samples - 1);
    points.push(pointAtProgress(poly, L * t).point);
  }

  const max = opts.max ?? 30;
  /**
   * 진행률 구간(표본 수만큼)으로 묶어 돌아가며 자른다. 구간 안은 경로 수직거리순.
   * near 쪽을 노리는 중이면 **그쪽을 먼저 채운다.** 반대쪽을 버리지는 않는다 —
   * applyNear 의 완화가 되돌릴 후보가 없으면 완화가 무의미해진다. 규칙은 `spreadCut`.
   */
  const byCorridor = (list: PlaceCandidate[]) => {
    // 후보마다 한 번만 투영한다 — 버킷과 순위가 같은 값을 본다
    const ct = new Map(list.map(c => [c.id, crossTrack(c.coord, poly)] as const));
    const bucketOf = (c: PlaceCandidate) => {
      const s = L > 0 ? ct.get(c.id)!.progressM / L : 0;
      return Math.min(samples - 1, Math.floor(s * samples)); // s=1 (끝점)은 마지막 구간
    };
    const rankOf = (c: PlaceCandidate) => ct.get(c.id)!.distanceM;
    const near = sided && opts.origin && opts.destination
      ? { side: opts.side!, origin: opts.origin, destination: opts.destination }
      : undefined;
    return spreadCut(list, bucketOf, rankOf, max, near);
  };

  const merge = (lists: PlaceCandidate[][]) => {
    const seen = new Map<string, PlaceCandidate>();
    for (const l of lists) for (const c of l) if (!seen.has(c.id)) seen.set(c.id, c);
    return [...seen.values()];
  };

  /**
   * 반경을 더 넓힐지 판정하는 개수. near 쪽을 노리는 중이면 **그쪽 개수**로 센다.
   * 전체로 세면 "8개 모였으니 그만" 하고 멈춘 뒤 applyNear 가 1개로 깎는다 —
   * 이 설계가 고치려는 바로 그 경로다(설계 §5.1).
   */
  const countForTarget = (list: PlaceCandidate[]) =>
    sided && opts.origin && opts.destination
      ? list.filter(c => matchesNear(opts.side!, c.coord, opts.origin!, opts.destination!, NEAR_RADII_M[0])).length
      : list.length;

  const target = Math.max(opts.need, opts.target ?? opts.need);
  let radiusM = opts.initialRadiusM;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = merge(await settleSamples(points.map(p => countedSearch(query, p, r))));
    if (countForTarget(found) >= target) return { candidates: byCorridor(found), status: 'ok', radiusM: r, calls };
    if (r >= opts.maxRadiusM) break;
    if (opts.canWiden && !opts.canWiden()) break;
    radiusM = Math.min(opts.maxRadiusM, r * 2);
  }
  if (found.length >= opts.need) return { candidates: byCorridor(found), status: 'ok', radiusM, calls };
  if (found.length > 0) return { candidates: byCorridor(found), status: 'short', radiusM, calls };

  /* 상한까지 0건 — 더 멀리 한 번만 보고 가장 가까운 3곳.
     이 마지막 기회도 예산을 본다. 경유지 하나를 살리려다 계획 전체를 잃으면
     살리려던 경유지까지 같이 잃는다 */
  const farR = opts.farRadiusM ?? 20_000;
  if (farR > opts.maxRadiusM && (!opts.canWiden || opts.canWiden())) {
    const far = merge(await settleSamples(points.map(p => countedSearch(query, p, farR))));
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
  /**
   * 어느 쪽 끝을 노릴까. 그쪽 종류의 앵커만 조회한다 — 앵커당 1콜이라 호출 수도 준다.
   * 앵커 *선택* 은 kind 만으로 된다. origin·destination 은 그 뒤 attach 안에서
   * max(기본 30개)로 자르는 컷에 쓰인다 — spreadCut 이 matchesNear 로
   * near 쪽을 먼저 채운다.
   */
  side?: NearSide;
  origin?: LatLng;
  destination?: LatLng;
  /** `CorridorSearchOptions.canWiden` 과 같다 */
  canWiden?: () => boolean;
};

/**
 * 어느 쪽 끝일 때 어느 앵커를 보나. `extractAnchors` 가 붙이는 kind 를 그대로 쓴다.
 * `transfer`(환승역)는 어느 쪽도 아니라 any 일 때만 본다 — 환승 지점을 원하는
 * 케이스는 NearSide 3값으로 표현되지 않는다(설계 §12).
 */
const ANCHOR_KINDS: Record<'start' | 'end', readonly Anchor['kind'][]> = {
  end: ['alight', 'destination'],
  start: ['origin', 'board'],
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
  // 그쪽 앵커만 본다 — 앵커당 1콜이라 호출 수도 준다.
  // 다만 그 종류가 하나도 없으면(하차역 없는 itinerary 등) 전부 본다. 좁히다 0건이 되면
  // 회랑 폴백이 돌아 오히려 호출이 는다
  const kinds = opts.side === 'start' || opts.side === 'end' ? ANCHOR_KINDS[opts.side] : null;
  const picked = kinds ? anchors.filter(a => kinds.includes(a.kind)) : anchors;
  const used = picked.length > 0 ? picked : anchors;

  const initial = opts.initialRadiusM ?? ANCHOR_INITIAL_M;
  const maxR = Math.max(initial, opts.maxRadiusM ?? ANCHOR_MAX_M);
  const target = Math.max(opts.need, opts.target ?? opts.need);
  const max = opts.max ?? 30;
  let calls = 0;

  /**
   * 후보를 가장 가까운 앵커에 붙인다. 같은 id 가 여러 앵커에서 나오면 가까운 쪽이 이긴다.
   * 앵커별로 묶어 돌아가며 자르고 앵커 안은 도보순 — 출발지·승차역 둘이 한 동네면
   * 도보순 한 줄로는 그 동네가 30을 다 먹는다(`spreadCut` 주석의 실측). near 쪽을
   * 노리는 중이면 그쪽을 먼저 채운다(byCorridor 와 같은 이유).
   * 앵커를 이미 좁혔어도 폴백 경로(picked.length === 0)에서는 이 컷이 필요하다.
   */
  const laneOf = new Map(used.map((a, i) => [a.id, i] as const)); // 앵커 순서 = 경로 진행 순서
  const attach = (lists: PlaceCandidate[][]) => {
    const best = new Map<string, PlaceCandidate>();
    for (let i = 0; i < lists.length; i++) {
      const a = used[i];
      for (const c of lists[i]) {
        const walkM = Math.round(haversineM(a.coord, c.coord));
        const prev = best.get(c.id);
        if (prev && (prev.anchorWalkM ?? Infinity) <= walkM) continue;
        best.set(c.id, { ...c, anchorId: a.id, anchorWalkM: walkM });
      }
    }
    const near = kinds && opts.origin && opts.destination
      ? { side: opts.side!, origin: opts.origin, destination: opts.destination }
      : undefined;
    return spreadCut(
      [...best.values()],
      c => laneOf.get(c.anchorId!) ?? 0,
      c => c.anchorWalkM ?? 0,
      max,
      near,
    );
  };

  let radiusM = initial;
  let found: PlaceCandidate[] = [];
  while (true) {
    const r = radiusM;
    found = attach(await settleSamples(used.map(a => { calls++; return search(query, a.coord, r); })));
    if (found.length >= target) return { candidates: found, status: 'ok', radiusM: r, calls };
    if (r >= maxR) break;
    if (opts.canWiden && !opts.canWiden()) break;
    radiusM = Math.min(maxR, r * 2);
  }
  if (found.length >= opts.need) return { candidates: found, status: 'ok', radiusM, calls };
  if (found.length > 0) return { candidates: found, status: 'short', radiusM, calls };
  return { candidates: [], status: 'none', radiusM, calls };
}
