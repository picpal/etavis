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
import { haversineM } from './geo';
import type { LatLng, Mode, NearSide } from './routePlan/types';

/**
 * 완화 단계. 좁은 쪽부터.
 *
 * 왜 진행률(`s`)이 아닌가: `s` 는 비율이라 경로 길이에 따라 뜻이 달라진다.
 * 2km 경로의 `s ≥ 0.6` 은 마지막 800m 지만 40km 경로에서는 마지막 16km 다.
 * 16km 떨어진 마트는 목적지 근처가 아니다.
 *
 * 1500m 은 `corridorSearch.ts` 의 `ANCHOR_MAX_M` 과 같은 값이다 — 거기서 이미
 * "이걸 넘으면 역 근처가 아니라 별개의 경유다"라는 선을 긋고 있다.
 */
export const NEAR_RADII_M = [1500, 3000] as const;

/**
 * 이 후보가 그쪽 끝에 있나. **검색·컷·필터 네 자리가 전부 이 함수를 쓴다** —
 * 기준이 갈리면 검색이 애써 채운 것을 필터가 버린다(설계 §5.1).
 */
export function matchesNear(
  near: NearSide,
  coord: LatLng,
  origin: LatLng,
  destination: LatLng,
  radiusM: number,
): boolean {
  if (near === 'any') return true;
  return haversineM(near === 'end' ? destination : origin, coord) <= radiusM;
}

/** 부담의 유무. 정도는 재지 않는다 — '생수 한 병'과 '장바구니 가득'을 나누면 태그가 흔들린다 */
export type Load = 'none' | 'hard';
/** 목적지에 닿기 전에 필요한가, 닿은 뒤에 필요한가 */
export type NeedWhen = 'beforeArrival' | 'afterArrival' | 'unknown';
export type StopTags = { loadBefore: Load; loadAfter: Load; needWhen: NeedWhen };

/**
 * 방향을 정하는 유일한 자리. LLM 은 방향을 뱉지 않는다 — 물성과 시점만 뱉고
 * 여기서 방향이 된다(AGENTS.md: LLM은 '무엇을'만 뽑는다).
 *
 * 분기 순서가 곧 우선순위다.
 * - `loadBefore` 가 `needWhen` 보다 앞인 이유: 택배를 부치러 가면서 도착해서 쓸 것을
 *   같이 사더라도, 상자를 오래 들고 다니는 쪽이 언제나 더 아프다.
 * - `needWhen === 'beforeArrival'` 이 `loadAfter` 보다 앞인 이유: 걸어가며 먹을
 *   아이스크림은 들고 가기 어렵지만 도착 전에 없어진다. 부담이 시점을 무조건 이기면 틀린다.
 * - `mode === 'car'` 는 일찍 빠진다. 차는 near 가 아니라 정차 용이성이 지배 축이고,
 *   그건 다음 단계다. 그래서 "차로 회 포장"을 못 잡는다 — 알려진 한계다(설계 §12).
 */
export function decideNear(stated: NearSide | undefined, mode: Mode, tags: StopTags): NearSide {
  if (stated === 'start' || stated === 'end') return stated;
  if (mode === 'car') return 'any';
  if (tags.loadBefore === 'hard') return 'start';
  if (tags.needWhen === 'beforeArrival') return 'start';
  if (tags.loadAfter === 'hard') return 'end';
  if (tags.needWhen === 'afterArrival') return 'end';
  return 'any';
}

/**
 * 그쪽 끝에서 이만큼은 있어야 교체 시트가 의미를 갖는다.
 *
 * 왜 1이 아닌가: 현행은 `need = count = 1` 이라 그쪽에 한 곳만 남아도 완화가 안 돌았다.
 * 그 한 곳으로 확정되고 사용자는 대안 없는 추천을 본다 — 정확도보다 신뢰도가 먼저 무너진다.
 */
export const NEAR_TARGET = 3;

/**
 * 후보를 그쪽 끝으로 좁힌다. 반경을 넓혀 가며 요구량을 채우고, 끝내 못 채우면
 * **전부 되돌리고** `relaxed` 를 세운다. 0건이 곧 경유지 증발이라는 걸 2026-09-16 에
 * 한 번 겪었다(`샌드위치 파는 카페` → 0건 → 계획에서 통째로 사라짐).
 *
 * 입력 순서를 보존한다 — 앞 단계(주차 정책)가 매긴 우선순위를 뒤집으면 안 된다.
 *
 * @param need 이 near 를 공유하는 형제 슬롯 수. `runPlan` 이 센다
 * @returns radiusM 어느 단계에서 멈췄나. null 이면 전부 되돌린 것(또는 any)
 */
export function applyNear<T extends { coord: LatLng }>(
  candidates: readonly T[],
  near: NearSide,
  origin: LatLng,
  destination: LatLng,
  need = 1,
): { candidates: T[]; relaxed: boolean; radiusM: number | null } {
  if (near === 'any' || candidates.length === 0) {
    return { candidates: [...candidates], relaxed: false, radiusM: null };
  }
  const target = Math.max(need, NEAR_TARGET);
  // 애초에 후보가 목표보다 적으면 near 가 원인이 아니다 — 최소 need 만 지킨다
  const want = candidates.length < target ? Math.min(need, candidates.length) : target;
  for (const radiusM of NEAR_RADII_M) {
    const kept = candidates.filter(c => matchesNear(near, c.coord, origin, destination, radiusM));
    if (kept.length >= want) return { candidates: kept, relaxed: false, radiusM };
  }
  return { candidates: [...candidates], relaxed: true, radiusM: null };
}
