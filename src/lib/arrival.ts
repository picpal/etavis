/**
 * 도착·출발 판정 — 순수 함수. GPS 한 건과 계획 컨텍스트를 받아 이벤트를 낸다.
 *
 * 왜: 실기기에서 1샘플 즉시 판정이 지나치는 역을 '도착'으로 봤고, 출발 반경 250m가
 * 200m 떨어진 다음 지점을 영영 못 잡았다. 규칙을 React 밖으로 빼서 npm test로 고정한다.
 *
 * 규칙 (스펙 docs/superpowers/specs/2026-09-11-tracker-arrival-design.md §1)
 *   0. target 없음 → 이벤트 없음
 *   1. accuracy > maxAccuracyM → 샘플 무시 (streak 유지, 직전 샘플도 갱신 안 함)
 *   2. 멈춤 = 속도가 있으면 속도 < stationaryMps, 없으면 직전 샘플과의 실효 속도로 잰다
 *   3. 다음 지점 반경 안 + 더 가까움 + 멈춤 연속 N샘플 → depart|skip(target) + arrive(next)
 *   4. target 반경 안 + 멈춤 연속 N샘플 → arrive(target)  ← 잠정 도착
 *   5. 체류 중 target 반경 밖 연속 M샘플 → depart(target)
 *   6. 잠정 도착 뒤 같은 지점 반경 안에서 visitDwellMs 경과 → visit(target). 한 번만
 */
import { haversineM } from './geo';
import type { LatLng } from '../data/mockData';

export type Fix = LatLng & {
  /** 샘플 시각(ms). 실효 속도·체류 시계의 기준이라 필수다 */
  atMs: number;
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
  /** 이 속도 미만이어야 '멈춤'. Infinity면 속도를 아예 안 본다 */
  stationaryMps: number;
  /** 잠정 도착 뒤 이만큼 더 머물러야 '방문'으로 친다 */
  visitDwellMs: number;
};

const LIVE_CAR: ArrivalProfile = {
  arriveBaseM: 150,
  departBaseM: 250,
  arriveSamples: 3,
  departSamples: 2,
  maxAccuracyM: 100,
  stationaryMps: 2,
  visitDwellMs: 90_000,
};
/* 보행 속도가 1.2~1.5m/s라 2로 두면 가게 앞을 지나가는 것도 '멈춤'이 된다 */
const LIVE_SLOW: ArrivalProfile = { ...LIVE_CAR, arriveBaseM: 80, stationaryMps: 1 };
/* 시뮬레이션은 틱당 700m를 움직여 반경 안에 두 번 들어오지 않는다 — 1샘플, 속도·정확도 검사 없음.
   틱이 1.5초라 체류도 90초를 요구하면 가상 주행이 영영 안 끝난다 */
const SIM: ArrivalProfile = {
  arriveBaseM: 400,
  departBaseM: 600,
  arriveSamples: 1,
  departSamples: 1,
  maxAccuracyM: null,
  stationaryMps: Infinity,
  visitDwellMs: 3_000,
};

export function profileFor(sim: boolean, mode: TravelMode): ArrivalProfile {
  if (sim) return SIM;
  return mode === 'car' ? LIVE_CAR : LIVE_SLOW;
}

/** 두 지점이 100m 안쪽이면 출발 반경은 여기서 멈춘다 */
export const DEPART_FLOOR_M = 50;

/**
 * 좌표로 속도를 잴 때, 이만큼의 이동은 안 움직인 것으로 본다.
 * 왜: Accuracy.Balanced의 흔한 오차가 이 언저리라, 정차 중에도 좌표가 20~25m씩 튄다.
 * 그 지터를 1초로 나누면 시속 70~90km가 되어 진짜 도착을 통째로 놓친다.
 */
export const NOISE_FLOOR_M = 25;

/** 실효 속도의 기준점. 정확도 필터로 버린 샘플은 여기 들어오지 않는다 */
export type PrevSample = { coord: LatLng; atMs: number; accuracyM: number | null };

export type ArrivalState = {
  /** 연속 카운트가 붙은 지점 id */
  streakId: string | null;
  arriveStreak: number;
  departStreak: number;
  /** 이미 도착 이벤트를 낸 지점 — dispatch 반영 전 샘플의 중복 방지 */
  arrivedId: string | null;
  /** 이미 출발 이벤트를 낸 지점 */
  departedId: string | null;
  /** 직전에 채택한 샘플. 속도를 모를 때 여기서 실효 속도를 낸다 */
  prev: PrevSample | null;
  /** 체류 시계가 돌고 있는 지점 id */
  dwellId: string | null;
  /** 그 지점에 잠정 도착한 시각(ms) */
  dwellSinceMs: number | null;
  /** 이미 방문 이벤트를 낸 지점 */
  visitedId: string | null;
};

export const initialArrivalState: ArrivalState = {
  streakId: null,
  arriveStreak: 0,
  departStreak: 0,
  arrivedId: null,
  departedId: null,
  prev: null,
  dwellId: null,
  dwellSinceMs: null,
  visitedId: null,
};

export type ArrivalEvent =
  | { kind: 'arrive'; id: string }
  | { kind: 'depart'; id: string }
  /** 도착을 못 본 채 다음 지점에 도착 → 지나간 것으로 처리 */
  | { kind: 'skip'; id: string }
  /** 잠정 도착 뒤 충분히 머물렀다 — 스쳐 지나간 것과 진짜로 들른 것의 구분 */
  | { kind: 'visit'; id: string };

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

/**
 * 규칙 2. 속도를 못 믿을 때는 직전 샘플과의 실효 속도로 잰다.
 * 왜: iOS는 속도를 모르면 -1을 주고 호출자가 그걸 null로 바꾼다. 예전엔 null을 '멈춤'으로
 * 봐서 세 방어선 중 정지가 통째로 꺼졌고, 시속 50km로 가게 옆을 지나가도 방문이 됐다.
 */
function isStationary(state: ArrivalState, fix: Fix, profile: ArrivalProfile): boolean {
  // SIM은 속도를 아예 안 보겠다는 뜻이다 — 이 줄이 없으면 가상 주행이 깨진다
  if (profile.stationaryMps === Infinity) return true;

  const speed = fix.speedMps;
  if (speed != null && speed >= 0) return speed < profile.stationaryMps;

  // 근거가 없으면 이동 중으로 본다 — 모른다는 이유로 방문을 만들어내지 않는다
  const prev = state.prev;
  if (!prev) return false;

  const dt = (fix.atMs - prev.atMs) / 1000;
  if (dt <= 0) return false;

  const movedM = haversineM(prev.coord, fix);
  const noiseM = Math.max(NOISE_FLOOR_M, fix.accuracyM ?? 0, prev.accuracyM ?? 0);
  // 오차 범위 안의 흔들림은 이동이 아니다 (NOISE_FLOOR_M 주석 참고)
  if (movedM <= noiseM) return true;
  return movedM / dt < profile.stationaryMps;
}

export function stepArrival(state: ArrivalState, fix: Fix, ctx: ArrivalContext): ArrivalStep {
  const { target, next, atStop, profile } = ctx;
  const arriveR = Math.max(profile.arriveBaseM, fix.accuracyM ?? 0);
  const gap = target && next ? haversineM(target.coord, next.coord) : null;
  /* 출발 반경은 다음 지점이 가까우면 좁아진다. 다만 **도착 반경보다 좁아질 수는 없다** —
     그러면 도착을 인정한 그 자리가 곧 '떠났다'가 되어, 움직이지도 않았는데 한 샘플 만에
     arrive→depart 로 뒤집힌다(2026-09-20 가상 주행에서 실측: arriveR 400 · departR 86).
     체류 시계가 돌 틈이 없어 방문이 영영 안 잡히고, 실주행도 경유지 간격이 arriveR*2 미만이면
     같은 일이 난다. 가까운 다음 지점은 규칙 3(선행 도착)이 잡으므로 좁힐 이유도 없다. */
  const departGap = gap == null ? profile.departBaseM : Math.min(profile.departBaseM, Math.max(DEPART_FLOOR_M, gap / 2));
  const departR = Math.max(departGap, arriveR);
  const distToTargetM = target ? haversineM(fix, target.coord) : null;
  const distToNextM = next ? haversineM(fix, next.coord) : null;
  const base = { ignored: null as ArrivalStep['ignored'], distToTargetM, distToNextM, arriveR, departR };
  const prev: PrevSample = { coord: { latitude: fix.latitude, longitude: fix.longitude }, atMs: fix.atMs, accuracyM: fix.accuracyM ?? null };
  const keep = (s: ArrivalState): ArrivalState => ({ ...s, prev });
  const quiet = (s: ArrivalState, events: ArrivalEvent[] = []): ArrivalStep => ({ ...base, state: keep(s), events });

  // 0. 갈 곳이 없다
  if (!target || distToTargetM == null) return quiet(state);

  // 1. 정확도 필터 — 나쁜 샘플은 없던 것으로. 기준점으로도 삼지 않는다
  //    (버린 좌표를 기준으로 실효 속도를 내면 엉뚱한 값이 나온다)
  if (profile.maxAccuracyM != null && fix.accuracyM != null && fix.accuracyM > profile.maxAccuracyM) {
    return { ...base, state, events: [], ignored: 'accuracy' };
  }

  // 2. 멈춤
  const stationary = isStationary(state, fix, profile);

  // 6. 방문 확정 — 잠정 도착한 그 지점 반경 안에서 체류 시간을 채웠나.
  //    한 샘플이 노이즈로 반경을 잠깐 벗어나도 시계는 그대로다(늦어질 뿐 초기화되지 않는다).
  const events: ArrivalEvent[] = [];
  let dwellId = state.dwellId;
  let dwellSinceMs = state.dwellSinceMs;
  let visitedId = state.visitedId;
  if (
    atStop &&
    dwellId === target.id &&
    dwellSinceMs != null &&
    visitedId !== target.id &&
    distToTargetM < arriveR &&
    fix.atMs - dwellSinceMs >= profile.visitDwellMs
  ) {
    events.push({ kind: 'visit', id: target.id });
    visitedId = target.id;
  }
  const dwell = { dwellId, dwellSinceMs, visitedId };

  // 3. 다음 지점 선행 도착 — 두 반경이 겹치면 더 가까운 쪽이 이긴다
  if (next && state.arrivedId !== next.id && distToNextM != null && distToNextM < arriveR && distToNextM < distToTargetM && stationary) {
    const streak = (state.streakId === next.id ? state.arriveStreak : 0) + 1;
    if (streak >= profile.arriveSamples) {
      return {
        ...base,
        // target을 실제로 떠났다 — 체류 시계는 여기서 next로 옮겨 다시 돈다
        state: keep({
          streakId: null,
          arriveStreak: 0,
          departStreak: 0,
          arrivedId: next.id,
          departedId: target.id,
          prev: state.prev,
          dwellId: next.id,
          dwellSinceMs: fix.atMs,
          visitedId: null,
        }),
        events: [...events, { kind: atStop ? 'depart' : 'skip', id: target.id }, { kind: 'arrive', id: next.id }],
      };
    }
    return quiet({ ...state, ...dwell, streakId: next.id, arriveStreak: streak, departStreak: 0 }, events);
  }

  // 4. target 도착(잠정)
  if (!atStop) {
    if (state.arrivedId === target.id) return quiet({ ...state, ...dwell }, events);
    const inside = distToTargetM < arriveR && stationary;
    const streak = inside ? (state.streakId === target.id ? state.arriveStreak : 0) + 1 : 0;
    if (inside && streak >= profile.arriveSamples) {
      return {
        ...base,
        state: keep({
          ...state,
          streakId: null,
          arriveStreak: 0,
          departStreak: 0,
          arrivedId: target.id,
          // 체류 시계 시작 — 여기서부터 visitDwellMs를 센다
          dwellId: target.id,
          dwellSinceMs: fix.atMs,
          visitedId: null,
        }),
        events: [...events, { kind: 'arrive', id: target.id }],
      };
    }
    return quiet({ ...state, ...dwell, streakId: target.id, arriveStreak: streak, departStreak: 0 }, events);
  }

  // 5. target 출발
  if (state.departedId === target.id) return quiet({ ...state, ...dwell }, events);
  const outside = distToTargetM > departR;
  const streak = outside ? (state.streakId === target.id ? state.departStreak : 0) + 1 : 0;
  if (outside && streak >= profile.departSamples) {
    return {
      ...base,
      // 실제로 떠났을 때만 체류 상태를 비운다
      state: keep({
        ...state,
        streakId: null,
        arriveStreak: 0,
        departStreak: 0,
        departedId: target.id,
        dwellId: null,
        dwellSinceMs: null,
        visitedId: null,
      }),
      events: [...events, { kind: 'depart', id: target.id }],
    };
  }
  return quiet({ ...state, ...dwell, streakId: target.id, departStreak: streak, arriveStreak: 0 }, events);
}
