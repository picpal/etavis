/**
 * 웹 현재 위치 — 브라우저 geolocation. 역지오코딩은 없다.
 *
 * expo-location 의 reverseGeocodeAsync 는 iOS 내장 지오코더를 쓰므로 웹에서 지원되지 않는다.
 * 주소는 사람이 읽으라고 만드는 것이라 없어도 좌표 기반 동작은 그대로다.
 *
 * 권한을 거부하거나 콜백이 안 오면 **데모 출발지**로 간다. 심사자가 데스크톱에서
 * 권한 팝업을 거부할 확률은 낮지 않고, 거기서 A1 이 막히면 데모가 시작도 못 한다.
 * timeout 을 명시하지 않으면 콜백이 영영 안 와서 좌표가 null 로 남는다.
 *
 * 폴백으로 갔으면 화면이 그렇게 말한다 — 실제 위치처럼 보이면 오작동으로 읽힌다.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { LatLng } from '../data/mockData';

export type CurrentPlaceStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export type CurrentPlace = {
  status: CurrentPlaceStatus;
  coord: LatLng | null;
  address: string | null;
  shortAddress: string | null;
  area: string | null;
};

/** 여의나루역 — mockData.ts 의 HOME. 목 데이터셋이 여의도↔목동 축으로 짜여 있다 */
const DEMO_ORIGIN: LatLng = { latitude: 37.5271, longitude: 126.9327 };
const DEMO_PLACE: CurrentPlace = {
  status: 'ready',
  coord: DEMO_ORIGIN,
  address: '서울 영등포구 여의동로 (데모 출발지)',
  shortAddress: '데모 출발지 · 여의나루역',
  area: '영등포구',
};

/* 원본과 export 목록을 맞추기 위한 자리. 웹에는 지오코딩 결과가 없다.
   원본은 LocationGeocodedAddress 를 받지만 currentPlace.ts 밖에서 부르는 곳이
   하나도 없으므로(확인함) 인자를 받지 않아도 깨지지 않는다. */
export function formatAddress(): string {
  return '';
}

export function formatShortAddress(): string | null {
  return null;
}

let snapshot: CurrentPlace = { status: 'idle', coord: null, address: null, shortAddress: null, area: null };
const listeners = new Set<() => void>();

function set(next: Partial<CurrentPlace>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach(l => l());
}

let inflight: Promise<void> | null = null;
let fetchedAt = 0;
const STALE_MS = 60_000;
/** 5초. runPlan 의 전체 예산이 12초라 여기서 오래 끌면 계획이 타임아웃으로 죽는다 */
const GEO_TIMEOUT_MS = 5000;

export function refreshCurrentPlace(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    set({ status: 'loading' });
    try {
      const coord = await new Promise<LatLng>((resolve, reject) => {
        if (!globalThis.navigator?.geolocation) return reject(new Error('geolocation 없음'));
        globalThis.navigator.geolocation.getCurrentPosition(
          pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          err => reject(err),
          { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
        );
      });
      fetchedAt = Date.now();
      set({ status: 'ready', coord, address: null, shortAddress: '내 위치', area: null });
    } catch {
      // 거부·타임아웃·미지원 — 전부 데모 출발지로. 여기서 막히면 데모가 시작도 못 한다
      fetchedAt = Date.now();
      set(DEMO_PLACE);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function refreshIfStale(): void {
  if (Date.now() - fetchedAt > STALE_MS) void refreshCurrentPlace();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useCurrentPlace(): CurrentPlace {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    if (snapshot.status === 'idle') void refreshCurrentPlace();
  }, []);
  return value;
}
