/** 웹 데모 — 음성 입력 없음. export 목록은 speech.ts 와 같아야 한다(확장자 없는 import 라 tsc 가 못 잡는다) */
import type { SpeechErrorCode } from './speechSession';

export type SpeechInput = {
  available: boolean;
  listening: boolean;
  interim: string;
  level: number;
  error: SpeechErrorCode | null;
  start(): Promise<void>;
  stop(): void;
};

export function useSpeechInput(_opts: { onFinal: (text: string) => void }): SpeechInput {
  return { available: false, listening: false, interim: '', level: 0, error: null, start: async () => {}, stop: () => {} };
}
