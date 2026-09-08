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

export function useCurrentPlace(): CurrentPlace {
  const value = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    if (snapshot.status === 'idle') void refreshCurrentPlace();
  }, []);
  return value;
}
