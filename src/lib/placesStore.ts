/**
 * 내 장소·최근 목적지 — 기기에 남기는 부분. 문서 폴더의 `places.json` 한 파일.
 *
 * 읽기는 **모듈이 처음 읽힐 때 동기로 한 번**이다(`prefs.ts` 와 같은 이유 — 비동기로
 * 읽으면 첫 프레임이 빈 목록으로 그려졌다가 곧바로 채워지는 깜빡임이 난다).
 *
 * **절대 던지지 않는다.** 못 읽거나 못 쓰면 이번 실행만 메모리 값으로 산다.
 *
 * 화면은 `usePlaces()` 로 구독하고, 리듀서(`plan.tsx`)는 `knownPlacesSnapshot()` 을
 * 동기로 읽는다 — 훅이 아니라 모듈 getter 가 기본인 이유가 이것이다.
 */
import { File, Paths } from 'expo-file-system';
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

const file = () => new File(Paths.document, 'places.json');

/* 실패했을 때 `EMPTY_PLACES` 를 그대로 돌려주지 않는다 — 그건 export 된 공유 객체라,
   누군가 한 번이라도 `snapshot().recents.push(...)` 를 하면 상수가 영영 오염된다.
   `parsePlaces(null)` 은 같은 빈 값을 매번 새 객체로 준다 */
// 읽기가 실패한 실행에서는 파일을 건드리지 않는다 — 바이트는 멀쩡한데 빈 값으로
// 덮어쓰면 등록해 둔 장소·최근 목적지가 통째로 날아간다. JSON 파싱 실패는 여기 안
// 걸린다(parsePlaces 는 절대 던지지 않는다) — 내용 자체가 깨졌을 때는 덮어써야 맞다.
let readFailed = false;
function load(): PlacesFile {
  try {
    const f = file();
    return f.exists ? parsePlaces(f.textSync()) : parsePlaces(null);
  } catch {
    // 파일을 못 읽는 기기(권한·손상)에서도 앱은 돌아야 한다
    readFailed = true;
    return parsePlaces(null);
  }
}

let cache: PlacesFile = load();
/** 직렬화 결과를 들고 있다 — 바뀐 게 없는 저장을 걸러내는 기준이자 그대로 파일로 나갈 내용 */
let lastText = serializePlaces(cache);
const listeners = new Set<() => void>();

/** 바뀔 때만 새 객체를 돌려준다 — useSyncExternalStore 가 매번 새 객체를 보면 무한 렌더다 */
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
  if (text === lastText) return; // 바뀐 게 없으면 파일도 리스너도 건드리지 않는다
  lastText = text;
  cache = next;
  if (!readFailed) {
    // 읽기가 실패했으면 디스크는 건드리지 않는다 — 메모리 값(빈 값)으로 실제
    // 파일을 덮어쓰면 이번 실행 한 번으로 등록해 둔 장소가 영영 사라진다
    try {
      const f = file();
      if (!f.exists) f.create();
      f.write(text);
    } catch {
      // 못 써도 이번 실행에서는 메모리 값으로 동작한다
    }
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
