/**
 * near 축 — 이 경유지가 경로의 **어느 쪽 끝**에 붙어야 하는가.
 *
 * 왜 필요한가: 채점(`routePlan/score.ts`)은 총 소요시간만 본다. 그래서 "회사 근처
 * 카페"라고 말해도 집 앞 카페가 우회 1분 더 짧으면 그쪽이 이긴다. 여행 단위 `order`
 * 로도 표현되지 않는다 — 순서가 마지막이어도 장소는 출발지 옆일 수 있다.
 *
 * **하드 필터가 아니다.** 그쪽에 한 곳도 없으면 제약을 풀고 전부 되돌린다.
 * 0건이 곧 경유지 증발이라는 걸 2026-09-16 에 이미 한 번 겪었다
 * (`샌드위치 파는 카페` → 0건 → 계획에서 통째로 사라짐).
 */
import { projectOnCorridor } from './routePlan/corridor';
import type { LatLng, Mode, NearSide } from './routePlan/types';

/**
 * 진행률 경계. end 는 s ≥ 0.6, start 는 s ≤ 0.4 다.
 * 가운데 0.4~0.6 은 어느 쪽도 아니다 — 애매한 자리를 양쪽에 다 넣으면 제약이 아니게 된다.
 */
export const NEAR_SPLIT_S = 0.6;

/** s = 직행 폴리라인 위 진행 비율(0=출발지, 1=목적지). `routePlan/corridor.ts` 가 계산한다 */
export function matchesNear(near: NearSide, s: number): boolean {
  if (near === 'any') return true;
  return near === 'end' ? s >= NEAR_SPLIT_S : s <= 1 - NEAR_SPLIT_S;
}

/**
 * 들고 대중교통을 타기 어려운 것. 사면 곧 목적지여야 한다.
 *
 * `꽃`이 `꽃집`에도 걸리는 건 의도한 것이다 — 꽃을 사서 가는 길은 거의 항상 목적지 쪽이다.
 * 표를 늘리기 전에 오판 쪽을 먼저 보라: 틀리면 사용자가 말하지도 않은 제약이 붙는다.
 * 앉아서 머무는 업종(결혼식 전 카페)은 여기 신호가 아니다 — 그건 체류시간 축의 몫이다.
 */
const CARRY = /커피|음료|주스|스무디|아이스크림|빙수|케이크|꽃/;

/**
 * 물성 신호 — 사용자가 위치를 말하지 않았을 때의 기본값.
 *
 * `mode === 'transit'` 에서만 산다. 차·도보는 들고 갈 수 있으니 제약이 아니다.
 */
export function nearFromCarry(mode: Mode, queries: readonly string[], why?: string): NearSide {
  if (mode !== 'transit') return 'any';
  return CARRY.test([why ?? '', ...queries].join(' ')) ? 'end' : 'any';
}

/** 사용자가 말한 위치가 언제나 이긴다. 물성 표는 말하지 않았을 때만 읽는다 */
export function resolveNear(
  stated: NearSide | undefined,
  mode: Mode,
  queries: readonly string[],
  why?: string,
): NearSide {
  if (stated === 'start' || stated === 'end') return stated;
  return nearFromCarry(mode, queries, why);
}

/**
 * 후보를 그쪽 끝으로 좁힌다. **`need` 만큼 못 남기면 전부 되돌리고 `relaxed` 를 세운다.**
 * 입력 순서를 보존한다 — 앞 단계(주차 정책)가 매긴 우선순위를 뒤집으면 안 된다.
 *
 * `need` 가 1 이 아닌 이유: 같은 검색어를 쓰는 형제 슬롯이 둘이면(= "편의점 두 곳")
 * 둘이 같은 후보 목록을 나눠 가져야 한다. near 가 1곳만 남기면 각 슬롯은 0건이 아니라
 * 1건이라 폴백이 안 돌고, enumerate 의 중복 방지에 걸려 **계획 전체**가 빈 배열이 된다.
 * 애초에 후보가 need 보다 적으면 near 가 원인이 아니므로 좁힌 결과를 그대로 쓴다.
 */
export function applyNear<T extends { coord: LatLng }>(
  candidates: readonly T[],
  near: NearSide,
  poly: LatLng[],
  need = 1,
): { candidates: T[]; relaxed: boolean } {
  // poly 가 2점 미만이면 진행률을 못 잰다. runPlan 은 항상 2점 이상을 주지만,
  // 못 잰 것을 '그쪽에 없다'로 말하면 거짓말이 된다 — 조용히 제약 없이 통과시킨다
  if (near === 'any' || candidates.length === 0 || poly.length < 2) {
    return { candidates: [...candidates], relaxed: false };
  }
  const kept = candidates.filter(c => matchesNear(near, projectOnCorridor(poly, c.coord).s));
  return kept.length >= Math.min(need, candidates.length)
    ? { candidates: kept, relaxed: false }
    : { candidates: [...candidates], relaxed: true };
}
