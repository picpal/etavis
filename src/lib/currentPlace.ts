/**
 * 현재 위치 — GPS 좌표 + 역지오코딩한 표시용 주소.
 *
 * 출발지에는 검색 UI가 필요 없다. 좌표는 GPS로 이미 알고 있고, 경로 계산도 좌표로 한다.
 * 주소는 오직 사람이 읽으라고 만드는 것이라 실패해도 좌표는 그대로 살린다.
 * (상호명은 일부러 만들지 않는다 — 반경 안 POI가 수십 개라 좌표만으로는 특정이 불가능하다.)
 *
 * expo-location의 reverseGeocodeAsync는 iOS 내장 지오코더를 쓰므로 API 키가 필요 없다.
 * 화면 여러 곳에서 같은 값을 보므로 모듈 단위 스토어로 한 번만 받아 공유한다.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { LatLng } from '../data/mockData';

export type CurrentPlaceStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export type CurrentPlace = {
  status: CurrentPlaceStatus;
  coord: LatLng | null;
  /** 역지오코딩한 전체 주소 — 출발지 행의 부제 */
  address: string | null;
  /** 헤더용 짧은 지역명 (시/군/구) */
  area: string | null;
};

/** 지오코딩 결과를 한 줄 주소로. 한국은 큰 단위부터, 그 외는 번지부터 적는다. */
export function formatAddress(a: Location.LocationGeocodedAddress): string {
  const parts =
    a.isoCountryCode === 'KR'
      ? [a.region, a.city, a.district, a.street, a.streetNumber]
      : [a.streetNumber, a.street, a.city, a.region];
  const out: string[] = [];
  for (const part of parts) {
    const v = part?.trim();
    // 한국에서는 region과 city가 같은 값으로 오는 경우가 있다 (특별시·광역시)
    if (v && !out.includes(v)) out.push(v);
  }
  return out.join(' ');
}

const shortArea = (a: Location.LocationGeocodedAddress) =>
  a.city?.trim() || a.subregion?.trim() || a.region?.trim() || null;

let snapshot: CurrentPlace = { status: 'idle', coord: null, address: null, area: null };
const listeners = new Set<() => void>();

function set(next: Partial<CurrentPlace>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach(l => l());
}

let inflight: Promise<void> | null = null;

export function refreshCurrentPlace(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    set({ status: 'loading' });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        set({ status: 'denied' });
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      fetchedAt = Date.now();
      set({ status: 'ready', coord });
      try {
        const [first] = await Location.reverseGeocodeAsync(coord);
        if (first) set({ address: formatAddress(first) || null, area: shortArea(first) });
      } catch {
        // 주소는 표시용일 뿐이라 실패해도 좌표 기반 동작은 유지한다
      }
    } catch {
      set({ status: 'error' });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 이 시간이 지난 위치는 낡은 것으로 본다 — 운전 중이면 몇 분 만에 수 km를 간다 */
const STALE_MS = 60_000;
let fetchedAt = 0;

/** 낡았을 때만 다시 잡는다 */
export function refreshIfStale(): void {
  if (Date.now() - fetchedAt > STALE_MS) void refreshCurrentPlace();
}

export function useCurrentPlace(): CurrentPlace {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    if (snapshot.status === 'idle') void refreshCurrentPlace();
    /*
      앱이 다시 앞으로 나오면 위치를 새로 잡는다.
      한 번만 잡아두면 '내 위치'가 앱을 처음 켠 자리(집)에 굳어버려서,
      한참 이동한 뒤 지도 앱으로 넘길 때 엉뚱한 출발지가 전달된다.
    */
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') refreshIfStale();
    });
    return () => sub.remove();
  }, []);
  return value;
}
