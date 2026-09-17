/**
 * 내 장소·최근 목적지 — 읽고 쓰는 순수 부분.
 *
 * 파일 I/O 는 `placesStore.ts` 가 한다. 갈래를 나눈 이유는 `prefsFormat`/`prefs`,
 * `trackLogFormat`/`trackLog` 와 같다: expo-file-system 을 물면 node 테스트가 못 읽는다.
 *
 * **이 모듈은 절대 던지지 않는다.** 파일이 깨졌으면 깨진 원소만 버리고 나머지로 선다 —
 * 한 줄 때문에 등록해 둔 장소를 다 날리는 건 설정값을 잃는 것과 무게가 다르다.
 */
import type { LatLng } from '../data/mockData';
import { haversineM } from './geo';

/** 내가 등록해 둔 장소 */
export type SavedPlace = {
  id: string;
  /** 고정 슬롯 둘. 각각 최대 하나 */
  slot: 'home' | 'work' | null;
  /** 사용자가 붙인 이름. 슬롯이 있으면 기본값 '집'·'회사' */
  label: string;
  /** 검색으로 고른 상호·지명 */
  name: string;
  address: string;
  coord: LatLng;
  createdAt: number;
};

/** 실제로 계획을 세운 목적지 */
export type RecentPlace = { name: string; address: string; coord: LatLng; usedAt: number };

export type PlacesFile = { saved: SavedPlace[]; recents: RecentPlace[] };

const empty = (): PlacesFile => ({ saved: [], recents: [] });

// 공유 상수라 얼려 둔다 — 어디선가 EMPTY_PLACES.recents.push(...) 를 한 번이라도
// 하면 이후 모든 '빈 값'이 그 오염을 물려받는다
function frozenEmpty(): PlacesFile {
  const f = empty();
  Object.freeze(f.saved);
  Object.freeze(f.recents);
  return Object.freeze(f);
}

export const EMPTY_PLACES: PlacesFile = frozenEmpty();
export const RECENT_MAX = 10;
/** 이 거리 안이면 같은 곳으로 본다 — 같은 건물을 다른 이름으로 검색해도 한 줄이어야 한다 */
export const SAME_PLACE_M = 50;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function readCoord(v: unknown): LatLng | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const latitude = num(o.latitude);
  const longitude = num(o.longitude);
  return latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined;
}

/** 좌표 없는 장소는 버린다 — 경로를 못 그리는 목적지는 화면에 닿아도 쓸모가 없다 */
function readSaved(v: unknown): SavedPlace | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const name = str(o.name);
  const coord = readCoord(o.coord);
  if (!id || !name || !coord) return undefined;
  return {
    id,
    slot: o.slot === 'home' || o.slot === 'work' ? o.slot : null,
    label: str(o.label) || name,
    name,
    address: str(o.address) ?? '',
    coord,
    createdAt: num(o.createdAt) ?? 0,
  };
}

function readRecent(v: unknown): RecentPlace | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  const coord = readCoord(o.coord);
  if (!name || !coord) return undefined;
  return { name, address: str(o.address) ?? '', coord, usedAt: num(o.usedAt) ?? 0 };
}

const SLOT_RANK = { home: 0, work: 1 } as const;
const rankOf = (s: SavedPlace) => (s.slot ? SLOT_RANK[s.slot] : 2);

/** 집 → 회사 → 등록 순. 목록 맨 위 두 자리는 늘 같은 자리여야 눈이 안 헤맨다 */
const sortSaved = (list: SavedPlace[]): SavedPlace[] =>
  [...list].sort((a, b) => rankOf(a) - rankOf(b) || a.createdAt - b.createdAt);

const sortRecents = (list: RecentPlace[]): RecentPlace[] => [...list].sort((a, b) => b.usedAt - a.usedAt);

export function parsePlaces(text: string | null | undefined): PlacesFile {
  if (!text) return empty();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty();
  const o = raw as Record<string, unknown>;
  const saved = Array.isArray(o.saved) ? o.saved.map(readSaved).filter((s): s is SavedPlace => !!s) : [];
  const recents = Array.isArray(o.recents) ? o.recents.map(readRecent).filter((r): r is RecentPlace => !!r) : [];
  return { saved: sortSaved(saved), recents: sortRecents(recents).slice(0, RECENT_MAX) };
}

export function serializePlaces(file: PlacesFile): string {
  return JSON.stringify(file);
}

export function upsertRecent(file: PlacesFile, entry: Omit<RecentPlace, 'usedAt'>, at: number): PlacesFile {
  // 같은 곳이면 지우고 새로 넣는다 — 이름·주소가 최신 검색 결과로 갱신되게
  const rest = file.recents.filter(r => haversineM(r.coord, entry.coord) > SAME_PLACE_M);
  return { ...file, recents: sortRecents([{ ...entry, usedAt: at }, ...rest]).slice(0, RECENT_MAX) };
}

/**
 * 슬롯 기본 라벨('집'/'회사')은 슬롯이 붙여준 이름일 뿐이다. 슬롯을 잃었는데 라벨이
 * 아직 그 기본값이면 상호로 되돌린다 — 안 그러면 슬롯을 뗀 장소가 여전히 '집'이라는
 * 이름표를 달고 있어 화면에 집이 두 개로 보인다. 사용자가 직접 붙인 이름('우리집' 등)은
 * 슬롯과 무관한 사용자의 말이니 건드리지 않는다.
 *
 * 슬롯을 잃는 경로가 둘이다 — 다른 항목이 강등될 때, 그리고 편집으로 자기 슬롯을 스스로
 * 놓을 때('직접 입력'으로 바꾸는 경우). 이 함수 하나로 두 경로를 다 닫는다 — 규칙이
 * 갈라져 있으면 다음에 세 번째 경로가 생겼을 때 또 샌다.
 */
function revertSlotLabel(lostSlot: 'home' | 'work' | null, label: string, name: string): string {
  if (!lostSlot) return label;
  const defaultLabel = lostSlot === 'home' ? '집' : '회사';
  return label === defaultLabel ? name : label;
}

export function upsertSaved(file: PlacesFile, place: SavedPlace): PlacesFile {
  const existing = file.saved.find(s => s.id === place.id);
  // 편집 자신이 슬롯을 놓은 경우 — 예전엔 슬롯이 있었는데(existing.slot) 이번엔 없다(place.slot)
  const selfLostSlot = existing && existing.slot && !place.slot ? existing.slot : null;
  const self = selfLostSlot ? { ...place, label: revertSlotLabel(selfLostSlot, place.label, place.name) } : place;

  const others = file.saved
    .filter(s => s.id !== place.id)
    // 집·회사는 하나뿐이다. 새로 지정하면 기존 것은 일반 장소로 내려온다 — 지우지는 않는다
    .map(s => (self.slot && s.slot === self.slot ? { ...s, slot: null, label: revertSlotLabel(s.slot, s.label, s.name) } : s));

  return { ...file, saved: sortSaved([...others, self]) };
}

export function removeSaved(file: PlacesFile, id: string): PlacesFile {
  return { ...file, saved: file.saved.filter(s => s.id !== id) };
}

/** 최근 목록에 북마크 배지를 달기 위해 — 좌표로 저장 여부를 본다 */
export function savedAt(file: PlacesFile, coord: LatLng): SavedPlace | undefined {
  return file.saved.find(s => haversineM(s.coord, coord) <= SAME_PLACE_M);
}

/**
 * 채팅 추출에 넘길 곳들. 저장한 장소는 **별칭과 상호가 각각 한 항목**이다 —
 * "집에 들렀다 가자"도 "여의도 자이로 가줘"도 같은 좌표로 떨어져야 한다.
 */
export function knownPlaces(file: PlacesFile): { name: string; coord: LatLng; address: string }[] {
  const out: { name: string; coord: LatLng; address: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, coord: LatLng, address: string) => {
    const key = name.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: key, coord, address });
  };
  for (const s of file.saved) {
    push(s.label, s.coord, s.address);
    push(s.name, s.coord, s.address);
  }
  for (const r of file.recents) push(r.name, r.coord, r.address);
  return out;
}
