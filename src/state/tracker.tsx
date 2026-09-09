/**
 * 주행 추적 — 경로 폴리라인 대비 수직거리로 도착·출발·이탈을 판정한다.
 *
 * 위치 공급원은 두 가지이고 판정 로직은 하나를 공유한다.
 *   live   — expo-location 실제 GPS (기본)
 *   sim    — 개발 메뉴의 가상 주행 (driving / deviate / stuck)
 *
 * 판정 규칙 (3중 조건)
 *   수직거리 > 임계  AND  연속 3샘플  AND  거리 증가 추세
 *   → '경로 확인 중'(내비 API 재요청에 해당) → 우회 / 이탈 확정
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { startBackgroundLocation, stopBackgroundLocation, subscribeBackgroundLocation } from '../lib/backgroundLocation';
import { LatLng } from '../data/mockData';
import { formatEta } from '../lib/geo';
import { notifyArrival, notifyNextLeg } from '../notifications';
import {
  buildPolyline,
  crossTrack,
  haversineM,
  offsetPerpendicular,
  pointAtProgress,
  polylineLengthM,
} from '../lib/geo';
import { usePlan } from './plan';

/** 위치 공급원 — live는 실제 GPS, 나머지는 개발용 시뮬레이션 */
export type SimMode = 'off' | 'live' | 'driving' | 'deviate' | 'stuck';

export const isSimMode = (m: SimMode) => m === 'driving' || m === 'deviate' || m === 'stuck';

/** 주행 상태 */
export type TrackStatus = 'idle' | 'moving' | 'stalled' | 'suspect' | 'detour' | 'offroute' | 'faraway';

const TICK_MS = 1500; // 목: 1틱 = 실제 30초 상당
const DRIVE_M_PER_TICK = 700;
const DEVIATE_M_PER_TICK = 140;

/**
 * 도착·출발 지오펜스 — 네이버 길찾기처럼 버튼 없이 자동 전환한다.
 * 들어올 때와 나갈 때 반경을 다르게 둬서(히스테리시스) 경계에서 깜빡이지 않게 한다.
 * 목에서는 1틱이 700m를 이동하므로 실제(100~150m)보다 큰 반경을 쓴다.
 */
// 실제 GPS는 현실적인 반경을, 시뮬레이션은 1틱 700m 이동을 감안해 크게 잡는다
const ARRIVE_RADIUS_M = { live: 150, sim: 400 };
const DEPART_RADIUS_M = { live: 250, sim: 600 };
/** 도착 후 이 틱 수만큼 머문 뒤 다시 움직인다 (체류 시뮬레이션) */
const DWELL_HOLD_TICKS = 4;

/** 이탈 판정 임계값 */
const OFF_ROUTE_M = 300;
const CONSECUTIVE_REQUIRED = 3;
const CONFIRM_TICKS = 2; // '경로 확인 중' 유지 틱 (내비 API 왕복에 해당)
const HARD_OFF_M = 900;
const BACK_ON_ROUTE_M = 150;
/** 이보다 멀면 '경로를 달리는 중'이 아니라 아예 다른 지역에 있는 것으로 본다 */
const FAR_AWAY_M = 5000;

type TrackerState = {
  mode: SimMode;
  /** 위치 권한이 거부돼 실제 GPS를 못 쓰는 상태 */
  permissionDenied: boolean;
  /** 배경 위치 구독이 켜졌는지 — 앱이 뒤에 있어도 도착·출발을 잡는다 */
  background: boolean;
  status: TrackStatus;
  position: LatLng | null;
  crossTrackM: number;
  progressM: number;
  routeLengthM: number;
  etaDeltaMin: number;
  /** 이탈 확정 시 대상 경유지 id */
  offRouteStopId: string | null;
};

type TrackerApi = TrackerState & {
  setMode: (mode: SimMode) => void;
  /** 이탈 확인 시트: 계획 유지 (경로로 복귀) */
  keepPlan: () => void;
  /** 이탈 확인 시트: 해당 경유지 건너뛰기 */
  dismissOffRoute: () => void;
  /** 목 경로를 현재 위치로 평행이동 — 실제 GPS로 검증할 때 사용 */
  anchorToMyLocation: () => Promise<void>;
  /** 경로가 내 위치 기준으로 옮겨진 상태인지 */
  anchored: boolean;
  polyline: LatLng[];
};

const TrackerContext = createContext<TrackerApi | null>(null);

export function TrackerProvider({ children }: { children: React.ReactNode }) {
  const { state, destinationDisplay, arriveAtStop, departStop } = usePlan();

  // 인터벌 안에서 최신 계획 상태·액션을 읽기 위한 ref (인터벌 재생성을 피한다)
  const planRef = useRef({
    stops: state.stops,
    passedCount: state.passedCount,
    atStop: state.atStop,
    mode: state.mode,
    destArriveAt: state.destArriveAt,
  });
  planRef.current = {
    stops: state.stops,
    passedCount: state.passedCount,
    atStop: state.atStop,
    mode: state.mode,
    destArriveAt: state.destArriveAt,
  };
  const actionsRef = useRef({ arriveAtStop, departStop });
  actionsRef.current = { arriveAtStop, departStop };
  const [mode, setModeRaw] = useState<SimMode>('off');
  const [tracker, setTracker] = useState<TrackerState>({
    mode: 'off',
    permissionDenied: false,
    background: false,
    status: 'idle',
    position: null,
    crossTrackM: 0,
    progressM: 0,
    routeLengthM: 0,
    etaDeltaMin: 0,
    offRouteStopId: null,
  });

  /**
   * 목 경로는 평창 좌표라 다른 지역에서는 실제 GPS로 검증할 수 없다.
   * '내 위치를 출발지로'를 쓰면 경로 전체를 현재 위치로 평행이동한다.
   */
  const [offset, setOffset] = useState<{ dLat: number; dLng: number } | null>(null);
  const shift = (c: LatLng): LatLng =>
    offset ? { latitude: c.latitude + offset.dLat, longitude: c.longitude + offset.dLng } : c;

  // 현재 계획의 경로 폴리라인 (최초 계산 때 내비가 준 경로에 해당)
  const polyline = useMemo(() => {
    const pts = [state.dataset.origin.coord, ...state.stops.map(s => s.coord), state.dataset.destination.coord].map(
      c => (offset ? { latitude: c.latitude + offset.dLat, longitude: c.longitude + offset.dLng } : c),
    );
    return buildPolyline(pts, 16);
  }, [state.dataset, state.stops, offset]);

  const routeLengthM = useMemo(() => polylineLengthM(polyline), [polyline]);

  // 시뮬레이션 내부 상태
  const progressRef = useRef(0);
  const deviationRef = useRef(0);
  const consecutiveRef = useRef(0);
  const prevDistRef = useRef(0);
  const confirmRef = useRef(0);
  const tickRef = useRef(0);
  const dwellHoldRef = useRef(0);

  const setMode = (next: SimMode) => {
    setModeRaw(next);
    if (next === 'off') {
      setTracker(t => ({ ...t, mode: next, status: 'idle', position: null, crossTrackM: 0, offRouteStopId: null }));
      return;
    }
    if (next === 'driving' || next === 'live') deviationRef.current = 0;
    // 시뮬레이션은 항상 경로 처음부터 다시 달린다.
    // 진행 거리를 남겨두면 데이터셋을 바꿨을 때 경로 끝에 위치가 박혀 도착이 영영 안 잡힌다
    if (isSimMode(next)) {
      progressRef.current = 0;
      dwellHoldRef.current = 0;
      tickRef.current = 0;
    }
    consecutiveRef.current = 0;
    confirmRef.current = 0;
    setTracker(t => ({ ...t, mode: next, status: next === 'live' ? 'idle' : 'moving', offRouteStopId: null }));
  };

  /**
   * 위치 한 건을 받아 도착·출발·이탈을 판정한다.
   * 시뮬레이션 틱과 실제 GPS 콜백이 이 함수를 공유한다.
   */
  const detectRef = useRef<(position: LatLng, simStuck?: boolean) => void>(() => {});
  detectRef.current = (position: LatLng, simStuck = false) => {
    const sim = isSimMode(mode);
    const arriveR = sim ? ARRIVE_RADIUS_M.sim : ARRIVE_RADIUS_M.live;
    const departR = sim ? DEPART_RADIUS_M.sim : DEPART_RADIUS_M.live;

    // 도착·출발 지오펜스 — 버튼 없이 자동 전환
    const { stops, passedCount, atStop } = planRef.current;
    const target = stops[passedCount];
    if (target) {
      const distToStop = haversineM(position, shift(target.coord));
      if (!atStop && distToStop < arriveR) {
        actionsRef.current.arriveAtStop();
        // 전환 순간에만 알린다 — 상시 갱신은 알림으로 흉내내면 계속 울려서 방해가 된다
        void notifyArrival(target.id, target.name, target.tasks.length);
      } else if (atStop && distToStop > departR) {
        actionsRef.current.departStop();
        const next = stops[passedCount + 1];
        void notifyNextLeg(
          next?.name ?? destinationDisplay,
          formatEta(next?.arriveAt ?? planRef.current.destArriveAt),
          planRef.current.mode === 'transit',
        );
      }
    }

    // 이탈 판정 — 폴리라인까지 수직거리
    const ct = crossTrack(position, polyline);
    const dist = ct.distanceM;
    const increasing = dist > prevDistRef.current + 5;
    prevDistRef.current = dist;

    setTracker(prev => {
      let status = prev.status;
      let etaDeltaMin = prev.etaDeltaMin;
      let offRouteStopId = prev.offRouteStopId;

      // 3중 조건: 임계 초과 + 연속 샘플 + 증가 추세
      if (dist > OFF_ROUTE_M && increasing) consecutiveRef.current += 1;
      else if (dist < BACK_ON_ROUTE_M) consecutiveRef.current = 0;

      // 경로에서 아주 멀면 이탈 판정을 돌리지 않는다 (다른 지역에 있는 상태)
      if (dist > FAR_AWAY_M) {
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        return { ...prev, mode, status: 'faraway', position, crossTrackM: dist, routeLengthM, offRouteStopId: null };
      }

      if (prev.status === 'moving' || prev.status === 'stalled' || prev.status === 'idle' || prev.status === 'faraway') {
        if (consecutiveRef.current >= CONSECUTIVE_REQUIRED) {
          status = 'suspect'; // 내비 API 재요청 구간
          confirmRef.current = 0;
        } else if (simStuck) {
          status = 'stalled'; // 수직거리 0인데 진행 없음 = 정체
        } else {
          status = 'moving';
        }
      } else if (prev.status === 'suspect') {
        confirmRef.current += 1;
        if (confirmRef.current >= CONFIRM_TICKS) {
          if (dist > HARD_OFF_M) {
            status = 'offroute';
            offRouteStopId = planRef.current.stops[planRef.current.passedCount]?.id ?? null;
          } else {
            status = 'detour';
            etaDeltaMin = Math.max(1, Math.round(dist / 200));
          }
        }
      } else if (prev.status === 'detour' && dist < BACK_ON_ROUTE_M) {
        status = 'moving'; // 우회 후 복귀 → 조용히 정상 복원
        etaDeltaMin = 0;
      }

      return {
        ...prev,
        mode,
        status,
        position,
        crossTrackM: dist,
        progressM: ct.progressM,
        routeLengthM,
        etaDeltaMin,
        offRouteStopId,
      };
    });
  };

  // 가상 주행 — 개발 메뉴 모드에서만
  useEffect(() => {
    if (!isSimMode(mode)) return;
    const timer = setInterval(() => {
      tickRef.current += 1;

      // 0) 체류 중이면 잠시 멈춰 있는다 (체류 시뮬레이션)
      const holding = planRef.current.atStop && dwellHoldRef.current < DWELL_HOLD_TICKS;
      if (planRef.current.atStop) dwellHoldRef.current += 1;
      else dwellHoldRef.current = 0;

      // 1) 가상 GPS 위치 생성
      if (holding) {
        // 정지 — 위치 갱신 없음
      } else if (mode === 'driving') {
        progressRef.current = Math.min(routeLengthM, progressRef.current + DRIVE_M_PER_TICK);
        deviationRef.current = Math.max(0, deviationRef.current - DEVIATE_M_PER_TICK);
      } else if (mode === 'deviate') {
        progressRef.current = Math.min(routeLengthM, progressRef.current + DRIVE_M_PER_TICK * 0.5);
        deviationRef.current += DEVIATE_M_PER_TICK;
      } // stuck: 진행·이탈 모두 그대로

      const base = pointAtProgress(polyline, progressRef.current);
      // GPS 지터 (결정적)
      const jitter = Math.sin(tickRef.current * 1.7) * 18;
      const position =
        deviationRef.current + Math.abs(jitter) > 0
          ? offsetPerpendicular(polyline, base.index, base.point, deviationRef.current + jitter)
          : base.point;

      detectRef.current(position, mode === 'stuck');
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [mode, polyline, routeLengthM, state.stops]);

  // 경로를 확정하면 실제 GPS 추적을 자동으로 시작한다 (사용자가 켤 필요 없음)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!state.planConfirmed || autoStartedRef.current) return;
    autoStartedRef.current = true;
    setModeRaw('live');
    setTracker(t => ({ ...t, mode: 'live' }));
  }, [state.planConfirmed]);

  // 실제 GPS — 위치 권한을 받아 이동을 구독한다
  useEffect(() => {
    if (mode !== 'live') return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    /*
      배경 위치도 함께 켠다. watchPositionAsync는 포그라운드에서만 도는데,
      도착·출발 감지가 정작 필요한 순간은 지도 앱이 앞에 있고 화면이 잠긴 운전 중이다.
      둘 다 같은 판정 함수로 흘려보내므로 중복 호출은 문제가 되지 않는다.
    */
    const unsubBackground = subscribeBackgroundLocation(p => detectRef.current(p));

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setTracker(t => ({ ...t, mode: 'off', status: 'idle', permissionDenied: true }));
        setModeRaw('off');
        return;
      }
      setTracker(t => ({ ...t, permissionDenied: false }));
      startBackgroundLocation().then(r => {
        if (!cancelled) setTracker(t => ({ ...t, background: r === 'started' }));
      });
      // 기기가 멈춰 있으면 watch 콜백이 안 오므로 현재 위치로 한 번 즉시 판정한다
      try {
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) {
          detectRef.current({ latitude: first.coords.latitude, longitude: first.coords.longitude });
        }
      } catch {}
      if (cancelled) return;
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 20, // 20m 이동할 때마다
          timeInterval: 5000,
        },
        loc => {
          detectRef.current({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        },
      );
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      unsubBackground();
    };
  }, [mode, offset]);

  // 추적을 끄면 배경 구독도 반드시 내린다 — 안 그러면 배터리를 계속 먹는다
  useEffect(() => {
    if (mode === 'off') void stopBackgroundLocation();
  }, [mode]);

  const api = useMemo<TrackerApi>(
    () => ({
      ...tracker,
      polyline,
      setMode,
      keepPlan: () => {
        // 경로로 복귀 — 이탈 상태 해제
        deviationRef.current = 0;
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        setModeRaw('driving');
        setTracker(t => ({ ...t, mode: 'driving', status: 'moving', etaDeltaMin: 0, offRouteStopId: null }));
      },
      anchored: offset != null,
      anchorToMyLocation: async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setTracker(t => ({ ...t, permissionDenied: true }));
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const o = state.dataset.origin.coord;
        setOffset({
          dLat: loc.coords.latitude - o.latitude,
          dLng: loc.coords.longitude - o.longitude,
        });
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        setModeRaw('live');
        setTracker(t => ({
          ...t,
          mode: 'live',
          status: 'idle',
          position: null,
          crossTrackM: 0,
          progressM: 0,
          offRouteStopId: null,
          permissionDenied: false,
        }));
      },
      dismissOffRoute: () => {
        deviationRef.current = 0;
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        setModeRaw('driving');
        setTracker(t => ({ ...t, mode: 'driving', status: 'moving', offRouteStopId: null }));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracker, polyline, destinationDisplay, offset, state.dataset],
  );

  return <TrackerContext.Provider value={api}>{children}</TrackerContext.Provider>;
}

export function useTracker() {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error('useTracker must be used within TrackerProvider');
  return ctx;
}
