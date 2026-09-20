/** 음성 입력 세션 — 순수 상태 전이. RN·네이티브 모듈 의존 없음.
 *  훅(speech.ts)은 네이티브 이벤트를 여기 SpeechEvent 로 바꿔 넣기만 한다.
 *
 *  iOS 는 continuous:false 일 때 무음이면 isFinal 없이 end 만 보내기도 한다.
 *  그래서 end·no-speech 가 와도 interim 이 있으면 그걸 결과로 승격한다 —
 *  사용자가 분명히 말했는데 빈손으로 끝나는 게 최악이다. */

export type SpeechPhase = 'idle' | 'listening' | 'done' | 'error';
export type SpeechErrorCode = 'not-allowed' | 'no-speech' | 'network' | 'unavailable' | 'other';

export type SpeechState = {
  phase: SpeechPhase;
  /** 듣는 동안 차오르는 부분 결과 */
  interim: string;
  /** phase 가 done 일 때만 값이 있다. 훅이 한 번 소비하고 reset 한다 */
  finalText: string | null;
  error: SpeechErrorCode | null;
};

export type SpeechEvent =
  | { type: 'start' }
  | { type: 'result'; transcript: string; isFinal: boolean }
  | { type: 'end' }
  | { type: 'error'; code: string }
  | { type: 'reset' };

export const initialSpeech: SpeechState = { phase: 'idle', interim: '', finalText: null, error: null };

export function reduceSpeech(state: SpeechState, event: SpeechEvent): SpeechState {
  switch (event.type) {
    case 'start':
      return { phase: 'listening', interim: '', finalText: null, error: null };
    case 'reset':
      return initialSpeech;
    case 'result': {
      if (state.phase !== 'listening') return state;
      const text = event.transcript.trim();
      if (event.isFinal) return { phase: 'done', interim: '', finalText: text, error: null };
      return { ...state, interim: text };
    }
    case 'end': {
      if (state.phase !== 'listening') return state;
      if (state.interim) return { phase: 'done', interim: '', finalText: state.interim, error: null };
      return { phase: 'error', interim: '', finalText: null, error: 'no-speech' };
    }
    case 'error': {
      if (state.phase !== 'listening') return state;
      const code = mapErrorCode(event.code);
      if (code === 'no-speech' && state.interim) {
        return { phase: 'done', interim: '', finalText: state.interim, error: null };
      }
      return { phase: 'error', interim: '', finalText: null, error: code };
    }
  }
}

/** expo-speech-recognition 의 error 이름(웹 스피치 API 기준)을 앱의 다섯 가지로 */
export function mapErrorCode(code: string): SpeechErrorCode {
  switch (code) {
    case 'not-allowed':
    case 'no-speech':
    case 'network':
      return code;
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'unavailable';
    default:
      return 'other';
  }
}

export function errorCopy(code: SpeechErrorCode): string {
  switch (code) {
    case 'not-allowed':
      return '설정에서 마이크·음성 인식을 켜 주세요';
    case 'no-speech':
      return '잘 못 들었어요. 다시 말해 주세요';
    case 'network':
      return '인터넷이 없어 음성 인식을 못 했어요';
    case 'unavailable':
      return '이 기기에서는 음성 인식을 쓸 수 없어요';
    case 'other':
      return '음성 인식이 중단됐어요. 다시 눌러 주세요';
  }
}

/** 입력창에 이미 글이 있으면 공백 하나로 이어 붙인다 */
export function mergeTranscript(existing: string, transcript: string): string {
  return [existing.trim(), transcript.trim()].filter(Boolean).join(' ');
}

/** volumechange 는 -2~10. 0 이하는 안 들리는 것으로 본다 */
export function volumeToLevel(volume: number): number {
  return Math.min(1, Math.max(0, volume / 10));
}
