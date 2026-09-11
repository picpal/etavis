/**
 * 실기기 추적 로그 — 문서 폴더에 일별 JSONL로 남기고 개발 메뉴에서 내보낸다.
 *
 * 왜: 도착 오판을 화면 캡처로 추측하지 않으려고. 로컬 전용이고 7일·2MB로 자른다.
 * logTrack은 절대 던지지 않는다 — 로그가 추적을 깨면 안 된다.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fileNameFor, isTrackFile, overCap, pruneList, serialize, type TrackEvent } from './trackLogFormat';

const FLUSH_MS = 500;

let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** 오늘 파일명 — 날짜가 바뀌면 보관 정리를 다시 돈다 */
let dayName = '';
/** 오늘 파일이 상한을 넘어 더 쓰지 않는 상태 */
let capped = false;

const dir = () => new Directory(Paths.document, 'tracklog');

export function logTrack(e: TrackEvent): void {
  try {
    queue.push(serialize(e, new Date()));
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  } catch {
    // 직렬화 실패는 버린다
  }
}

/** 대기 중인 배치를 즉시 쓴다 — 타이머가 돌기 전에 앱이 죽을 수 있는 지점에서 부른다 */
export function flushTrackLog(): void {
  cancelTimer();
  flush();
}

function cancelTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function flush() {
  timer = null;
  const lines = queue;
  queue = [];
  if (lines.length === 0) return;
  try {
    const d = dir();
    if (!d.exists) d.create();
    const today = new Date();
    const name = fileNameFor(today);
    if (name !== dayName) {
      dayName = name;
      capped = false;
      for (const n of pruneList(d.list().map(i => i.name), today)) {
        try {
          new File(d, n).delete();
        } catch {}
      }
    }
    if (capped) return;
    const f = new File(d, name);
    if (!f.exists) f.create();
    if (overCap(f.size)) {
      capped = true;
      return;
    }
    f.write(lines.join(''), { append: true });
  } catch {
    // 파일 오류는 조용히 — 추적이 우선이다
  }
}

export async function listTrackLogs(): Promise<{ name: string; bytes: number }[]> {
  try {
    const d = dir();
    if (!d.exists) return [];
    return d
      .list()
      .filter(i => isTrackFile(i.name))
      .map(i => ({ name: i.name, bytes: i.size ?? 0 }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch {
    return [];
  }
}

/** 7일치를 하나로 합쳐 공유 시트로 넘긴다 (AirDrop·파일 저장·메일) */
export async function exportTrackLogs(): Promise<'shared' | 'empty' | 'unavailable'> {
  cancelTimer();
  flush();
  const files = await listTrackLogs();
  if (files.length === 0) return 'empty';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const d = dir();
  let all = '';
  for (const { name } of files) all += await new File(d, name).text();
  const out = new File(Paths.cache, 'track-export.jsonl');
  if (out.exists) out.delete();
  out.create();
  out.write(all);
  await Sharing.shareAsync(out.uri, { UTI: 'public.json', mimeType: 'application/json', dialogTitle: '추적 로그 내보내기' });
  return 'shared';
}

export async function clearTrackLogs(): Promise<void> {
  cancelTimer();
  queue = [];
  try {
    const d = dir();
    if (d.exists) d.delete();
  } catch {}
  dayName = '';
  capped = false;
}
