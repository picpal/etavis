/**
 * 추적 로그의 순수 부분 — 이벤트 타입, 파일명, 보관, 직렬화, 상한.
 *
 * 왜: 실기기에서 도착 오판이 나면 화면 캡처로 원인을 추측해야 했다. 기기에 판정 근거를
 * 남겨 내려받는다. 파일 I/O는 trackLog.ts에 두고, 여기는 node 테스트가 닿는 부분만 둔다.
 */

export const KEEP_DAYS = 7;
export const CAP_BYTES = 2 * 1024 * 1024;

/**
 * 한 겹 상세. 중첩을 허용하면 줄이 길어져 한 줄만 보고 무슨 일인지 알기 어려워진다 —
 * 이 로그의 첫 독자는 사람이거나 LLM이지 파서가 아니다.
 */
export type LogDetail = Record<string, string | number | boolean | null>;

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
  | { k: 'notify'; kind: 'arrival' | 'nextLeg' | 'dest'; id: string }
  /**
   * 사용자 행동. `a` 는 'plan.start' 같은 점 표기라 grep 으로 갈래를 자를 수 있다.
   * 리듀서를 지나는 액션이 전부 여기로 오므로 누락이 구조적으로 안 생긴다.
   */
  | { k: 'act'; a: string; d?: LogDetail }
  /** 바깥 호출 한 번 — 보강이 왜 비었는지 로그만 보고 알 수 있어야 한다 */
  | { k: 'net'; ep: string; ms: number; ok: boolean; d?: LogDetail };

/**
 * 남길지 말지 — 소음을 줄이는 자리.
 *
 * fix 는 5초/20m 간격으로 들어와서 30분 주행이면 360줄이다. 대부분은 같은 좌표가
 * 반복되는 줄이라, 실제로 판정을 설명하는 geofence·track 이 그 안에 묻힌다.
 * 09-12 로그는 39줄 중 30줄(77%)이 fix·geofence 였다.
 */
export const FIX_MIN_MOVE_M = 15;
export const FIX_MAX_GAP_MS = 30_000;
export const GEOFENCE_MAX_GAP_MS = 30_000;

export type FixMark = { lat: number; lng: number; atMs: number };
export type GeofenceMark = { target: string | null; atStop: boolean; hasEvents: boolean; atMs: number };

/** 하버사인 없이 충분하다 — 십여 미터 판단이라 위도 보정한 평면 근사로 족하다 */
function roughMeters(a: FixMark, b: FixMark): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** 움직였거나, 안 움직인 채로 한참 지났거나(멈춰 있다는 것도 정보다) */
export function shouldLogFix(prev: FixMark | null, next: FixMark): boolean {
  if (!prev) return true;
  if (next.atMs - prev.atMs >= FIX_MAX_GAP_MS) return true;
  return roughMeters(prev, next) >= FIX_MIN_MOVE_M;
}

/**
 * 판정에 영향을 주는 것이 바뀌었으면 무조건 남긴다 — 도착·출발이 일어난 순간의
 * 근거를 잃으면 이 로그가 존재하는 이유가 없어진다. 그 외에는 heartbeat 간격으로.
 */
export function shouldLogGeofence(prev: GeofenceMark | null, next: GeofenceMark): boolean {
  if (!prev) return true;
  if (next.hasEvents) return true;
  if (next.target !== prev.target || next.atStop !== prev.atStop) return true;
  return next.atMs - prev.atMs >= GEOFENCE_MAX_GAP_MS;
}

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

/**
 * 한 줄. `r`(runId)은 계획 한 번을 묶는다 — 하루에 계획을 두 번 세우면 어느 줄이 어느
 * 계획 소속인지 이게 없으면 못 가른다. 계획을 시작하기 전 이벤트는 runId 가 없고,
 * 그때는 필드를 아예 빼서 줄을 짧게 둔다.
 */
export function serialize(event: TrackEvent, now: Date, runId: string | null = null): string {
  const { k, ...rest } = event;
  const head: Record<string, unknown> = { t: localIso(now) };
  if (runId != null) head.r = runId;
  head.k = k;
  for (const [key, v] of Object.entries(rest)) {
    // d 가 비면 필드째 뺀다 — 빈 객체로 줄을 늘리지 않는다
    if (key === 'd' && (v == null || Object.keys(v as object).length === 0)) continue;
    head[key] = v;
  }
  return JSON.stringify(head) + '\n';
}

export function overCap(bytes: number, cap = CAP_BYTES): boolean {
  return bytes >= cap;
}
