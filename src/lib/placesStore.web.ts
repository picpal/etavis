/**
 * placesStore 의 웹판 — 문서 폴더의 places.json 대신 localStorage 한 칸.
 *
 * 원본(`placesStore.ts`)은 `expo-file-system` 의 File/Paths 를 쓰는데 웹에는 없다.
 * 그대로 두면 `expo-file-system is not supported on web` 이 뜨고 내 장소·최근
 * 목적지가 매번 빈 상태로 시작한다 — 죽지는 않지만 심사자에겐 "저장이 안 되는 앱"으로
 * 보인다. `prefs.web.ts` 와 같은 방식으로 받아낸다.
 *
 * 로직은 하나도 옮기지 않는다. 파싱·병합·직렬화는 전부 `placesFormat.ts` 의 순수
 * 함수이고 원본과 같은 것을 쓴다. 여기서 다른 건 읽고 쓰는 자리뿐이다.
 *
 * **절대 던지지 않는다.** 시크릿 모드·저장소 차단에서는 localStorage 접근 자체가
 * 던지므로 읽기·쓰기를 다 감싼다. 못 쓰면 이번 실행만 메모리 값으로 산다.
 */
import type { LatLng } from '../data/mockData';
import {
  knownPlaces,
  parsePlaces,
  removeSaved,
  serializePlaces,
  upsertRecent,
  upsertSaved,
  type PlacesFile,
  type RecentPlace,
  type SavedPlace,
} from './placesFormat';

const KEY = 'etavia.places';

/* 원본과 같은 이유로 EMPTY_PLACES 를 그대로 돌려주지 않는다 — 공유 객체라 한 번
   오염되면 상수가 영영 오염된다. parsePlaces(null) 은 매번 새 빈 객체를 준다 */
function load(): PlacesFile {
  try {
    return parsePlaces(localStorage.getItem(KEY));
  } catch {
    return parsePlaces(null);
  }
}

let cache: PlacesFile = load();
let lastText = serializePlaces(cache);
const listeners = new Set<() => void>();

export function placesSnapshot(): PlacesFile {
  return cache;
}

export function subscribePlaces(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function commit(next: PlacesFile): void {
  const text = serializePlaces(next);
  if (text === lastText) return;
  lastText = text;
  cache = next;
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // 시크릿 모드·용량 초과 — 이번 실행은 메모리 값으로 동작한다
  }
  for (const fn of [...listeners]) fn();
}

export function recordRecent(entry: Omit<RecentPlace, 'usedAt'>): void {
  commit(upsertRecent(cache, entry, Date.now()));
}

export function savePlace(place: SavedPlace): void {
  commit(upsertSaved(cache, place));
}

export function removePlace(id: string): void {
  commit(removeSaved(cache, id));
}

export function knownPlacesSnapshot(): { name: string; coord: LatLng; address: string }[] {
  return knownPlaces(cache);
}

export function newPlaceId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
