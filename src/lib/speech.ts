/** 음성 입력 훅 — expo-speech-recognition 을 SpeechInput 하나로 감싼다.
 *  화면은 이 훅만 본다. 상태 전이는 speechSession.ts(순수)에 있다.
 *
 *  - ko-KR 고정, continuous:false 라 무음이면 알아서 끝난다. 재탭은 stop().
 *  - network 오류면 온디바이스 인식을 지원할 때 한 번 재시도한다.
 *  - EXPO_PUBLIC_SPEECH_FAKE=1 이면 네이티브 대신 가짜 드라이버가 돈다 —
 *    시뮬레이터에는 마이크가 없어 UI 전이를 maestro 로 고정하려면 이게 필요하다.
 *    Metro 번들 시점에 값이 박히므로 Metro 를 그 환경변수로 띄워야 한다. */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import {
  initialSpeech,
  reduceSpeech,
  volumeToLevel,
  type SpeechErrorCode,
  type SpeechEvent,
} from './speechSession';

export type SpeechInput = {
  /** 이 플랫폼·기기에서 쓸 수 있나. false 면 화면은 마이크 버튼을 숨긴다 */
  available: boolean;
  listening: boolean;
  /** 듣는 동안 차오르는 글자 */
  interim: string;
  /** 0~1 음량 */
  level: number;
  error: SpeechErrorCode | null;
  start(): Promise<void>;
  stop(): void;
};

const FAKE = process.env.EXPO_PUBLIC_SPEECH_FAKE === '1';

/** 가짜 드라이버 — 부분 결과 두 번, 최종 한 번, 음량은 사인파. 멈추는 함수를 돌려준다 */
function runFake(dispatch: (e: SpeechEvent) => void, setLevel: (v: number) => void) {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  let tick = 0;
  const meter = setInterval(() => setLevel(0.3 + 0.7 * Math.abs(Math.sin(tick++ / 3))), 100);
  at(600, () => dispatch({ type: 'result', transcript: '스타벅스', isFinal: false }));
  at(1200, () => dispatch({ type: 'result', transcript: '스타벅스 들러서', isFinal: false }));
  at(2000, () => dispatch({ type: 'result', transcript: '스타벅스 들러서 가자', isFinal: true }));
  at(2100, () => dispatch({ type: 'end' }));
  return () => {
    timers.forEach(clearTimeout);
    clearInterval(meter);
  };
}

export function useSpeechInput({ onFinal }: { onFinal: (text: string) => void }): SpeechInput {
  const [state, dispatch] = useReducer(reduceSpeech, initialSpeech);
  const [level, setLevel] = useState(0);
  const retriedOnDevice = useRef(false);
  const fakeStop = useRef<(() => void) | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const available = FAKE || ExpoSpeechRecognitionModule.isRecognitionAvailable();

  const startNative = (onDevice: boolean) => {
    ExpoSpeechRecognitionModule.start({
      lang: 'ko-KR',
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: onDevice,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  };

  useSpeechRecognitionEvent('result', e => {
    const transcript = e.results[0]?.transcript ?? '';
    dispatch({ type: 'result', transcript, isFinal: e.isFinal });
  });
  useSpeechRecognitionEvent('end', () => dispatch({ type: 'end' }));
  useSpeechRecognitionEvent('volumechange', e => setLevel(volumeToLevel(e.value)));
  useSpeechRecognitionEvent('error', e => {
    // 인터넷이 없으면 온디바이스로 한 번만 다시 시도한다
    if (e.error === 'network' && !retriedOnDevice.current && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      retriedOnDevice.current = true;
      dispatch({ type: 'start' });
      startNative(true);
      return;
    }
    dispatch({ type: 'error', code: e.error });
  });

  // 최종 결과는 한 번만 밖으로 내보내고 idle 로 돌아간다
  useEffect(() => {
    if (state.phase === 'done' && state.finalText != null) {
      onFinalRef.current(state.finalText);
      setLevel(0);
      dispatch({ type: 'reset' });
    }
    if (state.phase === 'error') setLevel(0);
  }, [state.phase, state.finalText]);

  const start = useCallback(async () => {
    if (state.phase === 'listening') return;
    retriedOnDevice.current = false;
    if (FAKE) {
      dispatch({ type: 'start' });
      fakeStop.current = runFake(dispatch, setLevel);
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      dispatch({ type: 'start' });
      dispatch({ type: 'error', code: 'not-allowed' });
      return;
    }
    dispatch({ type: 'start' });
    startNative(false);
  }, [state.phase]);

  const stop = useCallback(() => {
    if (FAKE) {
      // 가짜는 지금까지의 부분 결과를 최종으로 승격시킨다(리듀서의 end 규칙)
      fakeStop.current?.();
      fakeStop.current = null;
      dispatch({ type: 'end' });
      return;
    }
    ExpoSpeechRecognitionModule.stop();
  }, []);

  useEffect(() => () => fakeStop.current?.(), []);

  return {
    available,
    listening: state.phase === 'listening',
    interim: state.interim,
    level,
    error: state.error,
    start,
    stop,
  };
}
