/** 저장한 장소·최근 목적지를 구독한다. 저장하면 열려 있는 시트·화면이 같이 바뀐다 */
import { useSyncExternalStore } from 'react';
import { placesSnapshot, subscribePlaces } from './placesStore';
import type { PlacesFile } from './placesFormat';

export function usePlaces(): PlacesFile {
  return useSyncExternalStore(subscribePlaces, placesSnapshot);
}
