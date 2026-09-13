/**
 * 주행 추적 — 도착·출발은 반경 기반(stepArrival), 이탈만 경로 폴리라인 대비 수직거리로 판정한다.
 *
 * 위치 공급원은 두 가지이고 판정 로직은 하나를 공유한다.
 *   live   — expo-location 실제 GPS (기본)
 *   sim    — 개발 메뉴의 가상 주행 (driving / deviate / stuck)
 *
 * 도착·출발은 src/lib/arrival.ts의 stepArrival이 판정한다 —
 *   live: 반경 안 연속 3샘플 + 정지, accuracy > 100m 무시, 출발 반경 = min(250, 다음 지점 거리/2)
 *   sim : 1샘플 (틱당 700m라 연속 샘플이 불가능)
 * 여기서는 이벤트를 dispatch·알림·로그로 옮기기만 한다.
 *
 * 판정 규칙 (3중 조건)
 *   수직거리 > 임계  AND  연속 3샘플  AND  거리 증가 추세
 *   → '경로 확인 중'(내비 API 재요청에 해당) → 우회 / 이탈 확정
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { startBackgroundLocation, stopBackgroundLocation, subscribeBackgroundLocation, toFix } from '../lib/backgroundLocation';
import { LatLng } from '../data/mockData';
import { formatEta } from '../lib/geo';
import { notifyArrival, notifyDestinationArrival, notifyNextLeg } from '../notifications';
import { buildPolyline, crossTrack, offsetPerpendicular, pointAtProgress, polylineLengthM } from '../lib/geo';
import { toMin, usePlan } from './plan';
import { initialArrivalState, profileFor, stepArrival, type ArrivalState, type Fix, type Point } from '../lib/arrival';
import { flushTrackLog, logTrack } from '../lib/trackLog';
import { shouldLogFix, shouldLogGeofence, type FixMark, type GeofenceMark } from '../lib/trackLogFormat';
import { usePlanFlow } from './planFlowProvider';

/** 위치 공급원 — live는 실제 GPS, 나머지는 개발용 시뮬레이션 */
export type SimMode = 'off' | 'live' | 'driving' | 'deviate' | 'stuck';

export const isSimMode = (m: SimMode) => m === 'driving' || m === 'deviate' || m === 'stuck';

/** 주행 상태 */
export type TrackStatus = 'idle' | 'moving' | 'stalled' | 'suspect' | 'detour' | 'offroute' | 'faraway';

const TICK_MS = 1500; // 목: 1틱 = 실제 30초 상당
const DRIVE_M_PER_TICK = 700;
const DEVIATE_M_PER_TICK = 140;

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
  const { state, destinationDisplay, arriveAtStop, departStop, arriveAtDestination } = usePlan();
  const { usingServer } = usePlanFlow();

  // 인터벌 안에서 최신 계획 상태·액션을 읽기 위한 ref (인터벌 재생성을 피한다)
  const planRef = useRef({
    stops: state.stops,
    passedCount: state.passedCount,
    atStop: state.atStop,
    mode: state.mode,
    destArriveAt: state.destArriveAt,
    arrivedAtDest: state.arrivedAtDest,
    arriveByMin: state.arriveByMin,
  });
  planRef.current = {
    stops: state.stops,
    passedCount: state.passedCount,
    atStop: state.atStop,
    mode: state.mode,
    destArriveAt: state.destArriveAt,
    arrivedAtDest: state.arrivedAtDest,
    arriveByMin: state.arriveByMin,
  };
  const actionsRef = useRef({ arriveAtStop, departStop, arriveAtDestination });
  actionsRef.current = { arriveAtStop, departStop, arriveAtDestination };
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
  /* 사용자가 고른 좌표를 쓴다. 목 데이터 좌표로 그리면 경로도 도착 판정도
     엉뚱한 지점을 기준으로 삼는다 — 지도 앱은 제대로 갔는데 앱만 못 알아보는 일이 생긴다 */
  const destCoord = state.destinationCoord ?? state.dataset.destination.coord;
  const originCoord = state.originCoord ?? state.dataset.origin.coord;
  const polyline = useMemo(() => {
    const pts = [originCoord, ...state.stops.map(s => s.coord), destCoord].map(c =>
      offset ? { latitude: c.latitude + offset.dLat, longitude: c.longitude + offset.dLng } : c,
    );
    return buildPolyline(pts, 16);
  }, [originCoord, destCoord, state.stops, offset]);

  const routeLengthM = useMemo(() => polylineLengthM(polyline), [polyline]);

  // 시뮬레이션 내부 상태
  const progressRef = useRef(0);
  const deviationRef = useRef(0);
  const consecutiveRef = useRef(0);
  const prevDistRef = useRef(0);
  const confirmRef = useRef(0);
  const tickRef = useRef(0);
  const dwellHoldRef = useRef(0);
  /*
    이미 알린 전환을 기억한다.
    위치 공급원이 둘(포그라운드 watch + 배경 태스크)이고 dispatch는 비동기라,
    같은 도착·출발을 여러 번 판정하게 된다. 상태는 멱등이지만 알림은 그대로 중복된다.
  */
  const notifiedRef = useRef<{ arrived: string | null; departed: string | null; dest: boolean }>({
    arrived: null,
    departed: null,
    dest: false,
  });
  // detect는 ref로 호출돼 클로저가 오래된 값을 잡는다 — 목적지 좌표도 ref로 넘긴다
  const destCoordRef = useRef(destCoord);
  destCoordRef.current = destCoord;

  const setMode = (next: SimMode) => {
    logTrack({ k: 'mode', from: mode, to: next, via: 'setMode' });
    arrivalRef.current = initialArrivalState;
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
  const arrivalRef = useRef<ArrivalState>(initialArrivalState);
  /** 마지막으로 로그에 남긴 위치·판정 — 소음 필터의 기준점 */
  const lastFixMarkRef = useRef<FixMark | null>(null);
  const lastGeofenceMarkRef = useRef<GeofenceMark | null>(null);

  const detectRef = useRef<(fix: Fix, src: 'fg' | 'bg' | 'sim', simStuck?: boolean) => void>(() => {});
  detectRef.current = (fix: Fix, src, simStuck = false) => {
    const position: LatLng = { latitude: fix.latitude, longitude: fix.longitude };
    // 5초/20m 간격 그대로 남기면 30분 주행이 360줄이라, 판정을 설명하는 줄이 그 안에 묻힌다
    const fixMark: FixMark = { lat: fix.latitude, lng: fix.longitude, atMs: Date.now() };
    if (shouldLogFix(lastFixMarkRef.current, fixMark)) {
      lastFixMarkRef.current = fixMark;
      logTrack({ k: 'fix', lat: fix.latitude, lng: fix.longitude, acc: fix.accuracyM ?? null, spd: fix.speedMps ?? null, src });
    }

    // 도착·출발 — 순수 판정에 넘기고 이벤트만 옮긴다
    const { stops, passedCount, atStop, arrivedAtDest } = planRef.current;
    const destPoint: Point = { id: 'D', coord: shift(destCoordRef.current) };
    // 경유지를 다 지나면 목적지가 target — 옛 코드는 이 자리가 비어 '회사 도착'이 영영 안 잡혔다
    const targetStop = stops[passedCount];
    const target: Point | null = targetStop
      ? { id: targetStop.id, coord: shift(targetStop.coord) }
      : arrivedAtDest
        ? null
        : destPoint;
    const nextStop = stops[passedCount + 1];
    const next: Point | null = !targetStop ? null : nextStop ? { id: nextStop.id, coord: shift(nextStop.coord) } : destPoint;
    const step = stepArrival(arrivalRef.current, fix, {
      target,
      next,
      atStop,
      profile: profileFor(isSimMode(mode), planRef.current.mode),
    });
    arrivalRef.current = step.state;
    if (step.ignored == null && target) {
      // 판정이 일어난 순간(events)·대상이 바뀐 순간은 반드시 남기고, 그 외엔 heartbeat 만
      const gMark: GeofenceMark = { target: target.id, atStop, hasEvents: step.events.length > 0, atMs: Date.now() };
      if (shouldLogGeofence(lastGeofenceMarkRef.current, gMark)) {
        lastGeofenceMarkRef.current = gMark;
        logTrack({
          k: 'geofence',
          target: target.id,
          next: next?.id ?? null,
          dTarget: step.distToTargetM,
          dNext: step.distToNextM,
          arriveR: step.arriveR,
          departR: step.departR,
          ignored: null,
          events: step.events.map(e => `${e.kind}:${e.id}`),
          atStop,
        });
      }
    }
    // 전환 순간에만 알린다 — 상시 갱신을 알림으로 흉내내면 계속 울려서 방해가 된다
    for (const ev of step.events) {
      if (ev.kind === 'arrive' && ev.id === 'D') {
        actionsRef.current.arriveAtDestination();
        if (!notifiedRef.current.dest) {
          notifiedRef.current.dest = true;
          const p = planRef.current;
          logTrack({ k: 'notify', kind: 'dest', id: 'D' });
          void notifyDestinationArrival(
            destinationDisplay,
            p.arriveByMin == null || toMin(p.destArriveAt) <= p.arriveByMin,
            formatEta(p.destArriveAt),
          );
        }
      } else if (ev.kind === 'arrive') {
        const stop = stops.find(s => s.id === ev.id);
        actionsRef.current.arriveAtStop();
        if (stop && notifiedRef.current.arrived !== stop.id) {
          notifiedRef.current.arrived = stop.id;
          logTrack({ k: 'notify', kind: 'arrival', id: stop.id });
          void notifyArrival(stop.id, stop.name, stop.tasks.length);
        }
      } else if (ev.kind === 'depart') {
        actionsRef.current.departStop();
        if (notifiedRef.current.departed !== ev.id) {
          notifiedRef.current.departed = ev.id;
          const idx = stops.findIndex(s => s.id === ev.id);
          const after = stops[idx + 1];
          logTrack({ k: 'notify', kind: 'nextLeg', id: after?.id ?? 'D' });
          void notifyNextLeg(
            after?.name ?? destinationDisplay,
            formatEta(after?.arriveAt ?? planRef.current.destArriveAt),
            planRef.current.mode === 'transit',
          );
        }
      } else {
        // skip — 도착을 못 본 채 지나간 경유지. 알림 없이 다음으로 넘긴다
        actionsRef.current.departStop();
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

    // iOS가 배경 위치 이벤트 직후 앱을 정지시킬 수 있어 500ms 배치를 못 쓸 수 있다 — 즉시 흘려보낸다
    if (src === 'bg') flushTrackLog();
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

      detectRef.current({ ...position, accuracyM: null, speedMps: null }, 'sim', mode === 'stuck');
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [mode, polyline, routeLengthM, state.stops]);

  // 경로를 확정하면 실제 GPS 추적을 자동으로 시작한다 (사용자가 켤 필요 없음)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!state.planConfirmed || autoStartedRef.current) return;
    autoStartedRef.current = true;
    logTrack({
      k: 'plan',
      origin: { lat: originCoord.latitude, lng: originCoord.longitude },
      dest: { lat: destCoord.latitude, lng: destCoord.longitude },
      stops: state.stops.map(s => ({ id: s.id, name: s.name, lat: s.coord.latitude, lng: s.coord.longitude })),
      mode: state.mode,
      source: usingServer ? 'server' : 'mock',
    });
    logTrack({ k: 'mode', from: mode, to: 'live', via: 'auto' });
    arrivalRef.current = initialArrivalState;
    setModeRaw('live');
    setTracker(t => ({ ...t, mode: 'live' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.planConfirmed]);

  /*
    데이터셋이 바뀌면 도착 상태를 초기화한다.
    데이터셋마다 경유지 id를 재사용해서(s1/s2), 이전 데이터셋에서 남은 arrivedId가
    새 데이터셋의 첫 도착을 영영 막을 수 있다.
  */
  const datasetMountedRef = useRef(false);
  useEffect(() => {
    if (!datasetMountedRef.current) {
      datasetMountedRef.current = true;
      return;
    }
    arrivalRef.current = initialArrivalState;
    notifiedRef.current = { arrived: null, departed: null, dest: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dataset.key]);

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
    const unsubBackground = subscribeBackgroundLocation(f => detectRef.current(f, 'bg'));

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
          detectRef.current(toFix(first), 'fg');
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
          detectRef.current(toFix(loc), 'fg');
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

  // status가 바뀔 때만 한 줄 — setTracker 갱신 함수 안에서 로그하면 StrictMode에서 두 번 찍힌다
  const prevStatusRef = useRef(tracker.status);
  useEffect(() => {
    if (prevStatusRef.current === tracker.status) return;
    logTrack({ k: 'track', from: prevStatusRef.current, to: tracker.status, crossTrack: tracker.crossTrackM, progress: tracker.progressM });
    prevStatusRef.current = tracker.status;
  }, [tracker.status, tracker.crossTrackM, tracker.progressM]);

  const api = useMemo<TrackerApi>(
    () => ({
      ...tracker,
      polyline,
      setMode,
      keepPlan: () => {
        // 경로로 복귀 — 이탈 상태만 풀고 위치 공급원은 그대로 둔다 (live면 live)
        const next: SimMode = mode === 'deviate' ? 'driving' : mode;
        logTrack({ k: 'mode', from: mode, to: next, via: 'keepPlan' });
        deviationRef.current = 0;
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        if (next !== mode) setModeRaw(next);
        setTracker(t => ({ ...t, mode: next, status: 'moving', etaDeltaMin: 0, offRouteStopId: null }));
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
        logTrack({ k: 'mode', from: mode, to: 'live', via: 'anchor' });
        arrivalRef.current = initialArrivalState;
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
        const next: SimMode = mode === 'deviate' ? 'driving' : mode;
        logTrack({ k: 'mode', from: mode, to: next, via: 'dismissOffRoute' });
        deviationRef.current = 0;
        consecutiveRef.current = 0;
        confirmRef.current = 0;
        if (next !== mode) setModeRaw(next);
        setTracker(t => ({ ...t, mode: next, status: 'moving', offRouteStopId: null }));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracker, polyline, destinationDisplay, offset, state.dataset, mode],
  );

  return <TrackerContext.Provider value={api}>{children}</TrackerContext.Provider>;
}

export function useTracker() {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error('useTracker must be used within TrackerProvider');
  return ctx;
}
