/**
 * 도착·출발 판정 — 순수 함수. GPS 한 건과 계획 컨텍스트를 받아 이벤트를 낸다.
 *
 * 왜: 실기기에서 1샘플 즉시 판정이 지나치는 역을 '도착'으로 봤고, 출발 반경 250m가
 * 200m 떨어진 다음 지점을 영영 못 잡았다. 규칙을 React 밖으로 빼서 npm test로 고정한다.
 *
 * 규칙 (스펙 docs/superpowers/specs/2026-09-11-tracker-arrival-design.md §1)
 *   0. target 없음 → 이벤트 없음
 *   1. accuracy > maxAccuracyM → 샘플 무시 (streak 유지)
 *   2. 멈춤 = 속도 모름 또는 속도 < stationaryMps
 *   3. 다음 지점 반경 안 + 더 가까움 + 멈춤 연속 N샘플 → depart|skip(target) + arrive(next)
 *   4. target 반경 안 + 멈춤 연속 N샘플 → arrive(target)
 *   5. 체류 중 target 반경 밖 연속 M샘플 → depart(target)
 */
import { haversineM } from './geo';
import type { LatLng } from '../data/mockData';

export type Fix = LatLng & {
  /** 수평 정확도(m). 없으면 null */
  accuracyM?: number | null;
  /** m/s. 모르면 null (iOS의 -1은 호출자가 null로 바꾼다) */
  speedMps?: number | null;
};

export type Point = { id: string; coord: LatLng };

export type TravelMode = 'car' | 'walk' | 'transit';

export type ArrivalProfile = {
  /** 도착 반경 하한 */
  arriveBaseM: number;
  /** 출발 반경 상한 */
  departBaseM: number;
  /** 반경 안 연속 샘플 수 */
  arriveSamples: number;
  /** 반경 밖 연속 샘플 수 */
  departSamples: number;
  /** 이보다 나쁜 샘플은 무시. null이면 무시 안 함 */
  maxAccuracyM: number | null;
  /** 이 속도 미만이어야 '멈춤' */
  stationaryMps: number;
};

const LIVE_CAR: ArrivalProfile = {
  arriveBaseM: 150,
  departBaseM: 250,
  arriveSamples: 3,
  departSamples: 2,
  maxAccuracyM: 100,
  stationaryMps: 2,
};
/* 보행 속도가 1.2~1.5m/s라 2로 두면 가게 앞을 지나가는 것도 '멈춤'이 된다 */
const LIVE_SLOW: ArrivalProfile = { ...LIVE_CAR, arriveBaseM: 80, stationaryMps: 1 };
/* 시뮬레이션은 틱당 700m를 움직여 반경 안에 두 번 들어오지 않는다 — 1샘플, 속도·정확도 검사 없음 */
const SIM: ArrivalProfile = {
  arriveBaseM: 400,
  departBaseM: 600,
  arriveSamples: 1,
  departSamples: 1,
  maxAccuracyM: null,
  stationaryMps: Infinity,
};

export function profileFor(sim: boolean, mode: TravelMode): ArrivalProfile {
  if (sim) return SIM;
  return mode === 'car' ? LIVE_CAR : LIVE_SLOW;
}

/** 두 지점이 100m 안쪽이면 출발 반경은 여기서 멈춘다 */
export const DEPART_FLOOR_M = 50;

export type ArrivalState = {
  /** 연속 카운트가 붙은 지점 id */
  streakId: string | null;
  arriveStreak: number;
  departStreak: number;
  /** 이미 도착 이벤트를 낸 지점 — dispatch 반영 전 샘플의 중복 방지 */
  arrivedId: string | null;
  /** 이미 출발 이벤트를 낸 지점 */
  departedId: string | null;
};

export const initialArrivalState: ArrivalState = {
  streakId: null,
  arriveStreak: 0,
  departStreak: 0,
  arrivedId: null,
  departedId: null,
};

export type ArrivalEvent =
  | { kind: 'arrive'; id: string }
  | { kind: 'depart'; id: string }
  /** 도착을 못 본 채 다음 지점에 도착 → 지나간 것으로 처리 */
  | { kind: 'skip'; id: string };

export type ArrivalContext = {
  /** stops[passedCount] ?? 목적지. 목적지까지 끝났으면 null */
  target: Point | null;
  /** stops[passedCount+1] ?? 목적지. target이 목적지면 null */
  next: Point | null;
  /** target에 체류 중인가 */
  atStop: boolean;
  profile: ArrivalProfile;
};

export type ArrivalStep = {
  state: ArrivalState;
  events: ArrivalEvent[];
  /** 샘플을 버렸으면 이유 */
  ignored: 'accuracy' | null;
  distToTargetM: number | null;
  distToNextM: number | null;
  arriveR: number;
  departR: number;
};

export function stepArrival(state: ArrivalState, fix: Fix, ctx: ArrivalContext): ArrivalStep {
  const { target, next, atStop, profile } = ctx;
  const arriveR = Math.max(profile.arriveBaseM, fix.accuracyM ?? 0);
  const gap = target && next ? haversineM(target.coord, next.coord) : null;
  const departR = gap == null ? profile.departBaseM : Math.min(profile.departBaseM, Math.max(DEPART_FLOOR_M, gap / 2));
  const distToTargetM = target ? haversineM(fix, target.coord) : null;
  const distToNextM = next ? haversineM(fix, next.coord) : null;
  const base = { ignored: null as ArrivalStep['ignored'], distToTargetM, distToNextM, arriveR, departR };
  const quiet = (s: ArrivalState): ArrivalStep => ({ ...base, state: s, events: [] });

  // 0. 갈 곳이 없다
  if (!target || distToTargetM == null) return quiet(state);

  // 1. 정확도 필터 — 나쁜 샘플은 없던 것으로
  if (profile.maxAccuracyM != null && fix.accuracyM != null && fix.accuracyM > profile.maxAccuracyM) {
    return { ...quiet(state), ignored: 'accuracy' };
  }

  // 2. 멈춤 — 속도를 모르면 멈춘 것으로 본다(연속 샘플 규칙이 남아 있다)
  const speed = fix.speedMps;
  const stationary = speed == null || speed < 0 || speed < profile.stationaryMps;

  // 3. 다음 지점 선행 도착 — 두 반경이 겹치면 더 가까운 쪽이 이긴다
  if (next && distToNextM != null && distToNextM < arriveR && distToNextM < distToTargetM && stationary) {
    const streak = (state.streakId === next.id ? state.arriveStreak : 0) + 1;
    if (streak >= profile.arriveSamples) {
      return {
        ...base,
        state: { streakId: null, arriveStreak: 0, departStreak: 0, arrivedId: next.id, departedId: target.id },
        events: [{ kind: atStop ? 'depart' : 'skip', id: target.id }, { kind: 'arrive', id: next.id }],
      };
    }
    return quiet({ ...state, streakId: next.id, arriveStreak: streak, departStreak: 0 });
  }

  // 4. target 도착
  if (!atStop) {
    if (state.arrivedId === target.id) return quiet(state);
    const inside = distToTargetM < arriveR && stationary;
    const streak = inside ? (state.streakId === target.id ? state.arriveStreak : 0) + 1 : 0;
    if (inside && streak >= profile.arriveSamples) {
      return {
        ...base,
        state: { ...state, streakId: null, arriveStreak: 0, departStreak: 0, arrivedId: target.id },
        events: [{ kind: 'arrive', id: target.id }],
      };
    }
    return quiet({ ...state, streakId: target.id, arriveStreak: streak, departStreak: 0 });
  }

  // 5. target 출발
  if (state.departedId === target.id) return quiet(state);
  const outside = distToTargetM > departR;
  const streak = outside ? (state.streakId === target.id ? state.departStreak : 0) + 1 : 0;
  if (outside && streak >= profile.departSamples) {
    return {
      ...base,
      state: { ...state, streakId: null, arriveStreak: 0, departStreak: 0, departedId: target.id },
      events: [{ kind: 'depart', id: target.id }],
    };
  }
  return quiet({ ...state, streakId: target.id, departStreak: streak, arriveStreak: 0 });
}
