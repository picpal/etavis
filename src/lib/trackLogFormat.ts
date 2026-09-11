/**
 * 추적 로그의 순수 부분 — 이벤트 타입, 파일명, 보관, 직렬화, 상한.
 *
 * 왜: 실기기에서 도착 오판이 나면 화면 캡처로 원인을 추측해야 했다. 기기에 판정 근거를
 * 남겨 내려받는다. 파일 I/O는 trackLog.ts에 두고, 여기는 node 테스트가 닿는 부분만 둔다.
 */

export const KEEP_DAYS = 7;
export const CAP_BYTES = 2 * 1024 * 1024;

export type TrackEvent =
  | { k: 'fix'; lat: number; lng: number; acc: number | null; spd: number | null; src: 'fg' | 'bg' | 'sim' }
  | {
      k: 'geofence';
      target: string | null;
      next: string | null;
      dTarget: number | null;
      dNext: number | null;
      arriveR: number;
      departR: number;
      ignored: string | null;
      events: string[];
      atStop: boolean;
    }
  | { k: 'track'; from: string; to: string; crossTrack: number; progress: number }
  | { k: 'mode'; from: string; to: string; via: 'setMode' | 'keepPlan' | 'dismissOffRoute' | 'auto' | 'anchor' }
  | {
      k: 'plan';
      origin: { lat: number; lng: number };
      dest: { lat: number; lng: number };
      stops: { id: string; name: string; lat: number; lng: number }[];
      mode: string;
      source: 'server' | 'mock';
    }
  | { k: 'notify'; kind: 'arrival' | 'nextLeg' | 'dest'; id: string };

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 로컬 날짜 기준. UTC로 바꾸면 자정 근처 기록이 전날 파일로 간다 */
export function fileNameFor(d: Date): string {
  return `track-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.jsonl`;
}

const TRACK_FILE = /^track-\d{8}\.jsonl$/;

export function isTrackFile(name: string): boolean {
  return TRACK_FILE.test(name);
}

/** 지울 파일 이름들 — 오늘 포함 keepDays일보다 오래된 것. 파일명이 정렬 가능해서 문자열 비교로 충분하다 */
export function pruneList(names: string[], today: Date, keepDays = KEEP_DAYS): string[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (keepDays - 1));
  const keepFrom = fileNameFor(cutoff);
  return names.filter(n => isTrackFile(n) && n < keepFrom);
}

/** ISO 8601에 로컬 오프셋을 붙인다 — 분석할 때 한국 시각 그대로 읽히게 */
function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function serialize(event: TrackEvent, now: Date): string {
  const { k, ...rest } = event;
  return JSON.stringify({ t: localIso(now), k, ...rest }) + '\n';
}

export function overCap(bytes: number, cap = CAP_BYTES): boolean {
  return bytes >= cap;
}
