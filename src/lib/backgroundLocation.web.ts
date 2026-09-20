/**
 * 웹 배경 위치 — 추적은 no-op, 변환은 살린다.
 *
 * 통째로 no-op 하면 안 된다: toFix 는 tracker.tsx 가 **전경** GPS 에도 쓴다.
 * 그리고 원본은 모듈 최상단에서 TaskManager.defineTask 를 부른다 — 웹에서는
 * 그 부작용 자체가 없어야 한다.
 */
import type { Fix } from './arrival';

export const LOCATION_TASK = 'etavia-location-updates';

export const getLastBackgroundPosition = (): Fix | null => null;

export function subscribeBackgroundLocation(_listener: (fix: Fix) => void) {
  return () => {};
}

export type BackgroundStartResult = 'started' | 'denied' | 'unavailable';

export async function startBackgroundLocation(): Promise<BackgroundStartResult> {
  return 'unavailable';
}

export async function stopBackgroundLocation(): Promise<void> {}

/** 네이티브와 같은 순수 변환. iOS 는 속도를 모르면 -1 을 준다 */
export function toFix(loc: {
  timestamp?: number | null;
  coords: { latitude: number; longitude: number; accuracy?: number | null; speed?: number | null };
}): Fix {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  return {
    latitude,
    longitude,
    // 네이티브와 같은 이유로 OS 시각을 쓴다(backgroundLocation.ts 주석)
    atMs: typeof loc.timestamp === 'number' ? loc.timestamp : Date.now(),
    accuracyM: accuracy ?? null,
    speedMps: speed == null || speed < 0 ? null : speed,
  };
}
