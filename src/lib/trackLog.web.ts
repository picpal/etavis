/**
 * 웹 추적 로그 — 전부 no-op. expo-file-system·expo-sharing 은 웹에서 못 쓴다.
 *
 * 원본 src/lib/trackLog.ts 의 export 를 **하나도 빠짐없이** 덮어야 한다.
 * 빠지면 부르는 쪽에서 undefined 가 되는데, 확장자 없는 import 라 tsc 는 .ts 계약을
 * 보고 통과시킨다. 최종 검사는 실제 웹 export 와 브라우저 완주다.
 */
import type { TrackEvent } from './trackLogFormat';

let runId: string | null = null;

export function newRunId(): string {
  runId = `web-${Date.now().toString(36)}`;
  return runId;
}

export function currentRunId(): string | null {
  return runId;
}

export function logTrack(_e: TrackEvent): void {}

export function flushTrackLog(): void {}

export async function listTrackLogs(): Promise<{ name: string; bytes: number }[]> {
  return [];
}

export async function exportTrackLogs(): Promise<'shared' | 'empty' | 'unavailable'> {
  return 'unavailable';
}

export async function clearTrackLogs(): Promise<void> {}
