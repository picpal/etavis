/**
 * 배경 위치 — 앱이 뒤로 가도 위치를 계속 받는다.
 *
 * watchPositionAsync는 **포그라운드에서만** 동작한다. 그런데 이 앱의 핵심 동작인
 * '도착·출발 자동 감지'는 정확히 앱이 뒤에 있을 때 필요하다 — 운전 중에는
 * 지도 앱이 앞에 있고 화면은 잠겨 있으니까. 그래서 TaskManager 백그라운드 태스크가 필요하다.
 *
 * 태스크는 React 밖에서 실행되므로 결과를 모듈 스토어에 넣고,
 * TrackerProvider가 그걸 구독해 기존 판정 로직에 흘려보낸다.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { Fix } from './arrival';

export const LOCATION_TASK = 'etavia-location-updates';

type Listener = (fix: Fix) => void;
const listeners = new Set<Listener>();

/** 가장 최근에 받은 위치 — 구독 전에 도착한 것도 놓치지 않게 남겨둔다 */
let lastPosition: Fix | null = null;
export const getLastBackgroundPosition = () => lastPosition;

export function subscribeBackgroundLocation(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 태스크 정의는 앱 최상단에서 한 번만 — 등록 전에 startLocationUpdatesAsync를 부르면 실패한다
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  const last = locations?.[locations.length - 1];
  if (!last) return;
  lastPosition = toFix(last);
  listeners.forEach(l => l(lastPosition!));
});

export type BackgroundStartResult = 'started' | 'denied' | 'unavailable';

/**
 * 배경 위치 구독 시작.
 * 포그라운드 권한만 있어도 앱이 떠 있는 동안은 동작하므로, 배경 권한이 거부돼도 계속 진행한다.
 */
export async function startBackgroundLocation(): Promise<BackgroundStartResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';

  // '항상 허용'은 거부돼도 치명적이지 않다 — 앱이 앞에 있을 때는 여전히 받는다
  await Location.requestBackgroundPermissionsAsync().catch(() => null);

  try {
    const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (already) return 'started';
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 30,
      // 경유지 반경이 150m라 그보다 촘촘해야 도착을 놓치지 않는다
      deferredUpdatesDistance: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true,
    });
    return 'started';
  } catch {
    return 'unavailable';
  }
}

export async function stopBackgroundLocation() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // 등록된 적 없으면 무시
  }
}

/** expo-location 객체를 판정 입력으로. iOS는 속도를 모르면 -1을 준다 */
export function toFix(loc: Location.LocationObject): Fix {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  return {
    latitude,
    longitude,
    accuracyM: accuracy ?? null,
    speedMps: speed == null || speed < 0 ? null : speed,
  };
}
