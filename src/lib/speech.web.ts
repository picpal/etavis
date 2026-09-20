/** 웹 음성 입력 — 브라우저 Web Speech API. export 목록은 speech.ts 와 같아야 한다
 *  (확장자 없는 import 라 tsc 가 못 잡는다).
 *
 *  네이티브(expo-speech-recognition)와 **상태 전이를 공유한다** — 리듀서는
 *  speechSession.ts 하나뿐이고, 여기서는 브라우저 이벤트를 SpeechEvent 로 번역만 한다.
 *  Web Speech 의 error 이름이 곧 네이티브 쪽 이름이라 mapErrorCode 가 그대로 맞는다.
 *
 *  두 가지가 네이티브와 다르다.
 *  1. **음량 이벤트가 없다.** `volumechange` 에 해당하는 게 API 에 없어서
 *     getUserMedia + AnalyserNode 로 직접 잰다. 실패하면 막대만 포기하고 인식은 간다 —
 *     가짜로 흔들면 말하지 않아도 "듣고 있다"는 거짓 신호가 된다.
 *  2. **지원 브라우저가 갈린다.** Chrome·Edge 는 webkit 접두사로 주고 Firefox 는 없다.
 *     없으면 available:false 로 화면이 버튼을 숨긴다 — 눌러도 아무 일 없는 버튼보다 낫다.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { initialSpeech, reduceSpeech, type SpeechErrorCode } from './speechSession';
import { isSpeechAvailable, micLevelFromTimeDomain, readSpeechResults, speechRecognitionCtor } from './speechBrowser';

export type SpeechInput = {
  /** 이 브라우저에서 쓸 수 있나. false 면 화면은 마이크 버튼을 숨긴다 */
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

/* Web Speech 타입은 RN 의 tsconfig lib 에 없을 수 있어 필요한 만큼만 적는다 */
type Alternative = { transcript?: string };
type RecResult = { isFinal?: boolean; 0?: Alternative; length: number };
type RecEvent = { results: ArrayLike<RecResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function browserWindow(): { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown });
}

/** 파형에서 음량을 재기 시작한다. 멈추는 함수를 주고, 못 재면 null 을 준다 */
async function startMeter(onLevel: (v: number) => void): Promise<(() => void) | null> {
  try {
    const media = globalThis.navigator?.mediaDevices;
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!media || !Ctx) return null;

    const stream = await media.getUserMedia({ audio: true });
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      onLevel(micLevelFromTimeDomain(buf));
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach(t => t.stop());
      void ctx.close();
    };
  } catch {
    // 권한 거부·기기 없음 등. 인식 자체의 오류는 recognition.onerror 가 말한다
    return null;
  }
}

export function useSpeechInput({ onFinal }: { onFinal: (text: string) => void }): SpeechInput {
  const [state, dispatch] = useReducer(reduceSpeech, initialSpeech);
  const [level, setLevel] = useState(0);
  const recRef = useRef<Recognition | null>(null);
  const meterStop = useRef<(() => void) | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const available = isSpeechAvailable(browserWindow());

  const stopMeter = useCallback(() => {
    meterStop.current?.();
    meterStop.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (state.phase === 'listening') return;
    const Ctor = speechRecognitionCtor(browserWindow()) as (new () => Recognition) | null;
    if (!Ctor) return; // available:false 라 버튼 자체가 없다. 방어만 해 둔다

    const rec = new Ctor();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = false; // 무음이면 알아서 끝난다. 재탭은 stop()
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      const pieces = Array.from(e.results as ArrayLike<RecResult>).map(r => ({
        transcript: r[0]?.transcript ?? '',
        isFinal: r.isFinal === true,
      }));
      const read = readSpeechResults(pieces);
      dispatch({ type: 'result', transcript: read.transcript, isFinal: read.isFinal });
    };
    rec.onerror = e => dispatch({ type: 'error', code: e.error });
    rec.onend = () => dispatch({ type: 'end' });

    recRef.current = rec;
    dispatch({ type: 'start' });
    rec.start();
    // 인식을 먼저 띄운다 — 권한 팝업은 하나로 합쳐지고, 막대는 늦게 붙어도 된다
    meterStop.current = await startMeter(setLevel);
  }, [state.phase]);

  const stop = useCallback(() => {
    // stop() 은 지금까지의 말을 확정하고 끝낸다. abort() 는 버리므로 쓰지 않는다
    recRef.current?.stop();
  }, []);

  // 최종 결과는 한 번만 밖으로 내보내고 idle 로 돌아간다
  useEffect(() => {
    if (state.phase === 'done' && state.finalText != null) {
      onFinalRef.current(state.finalText);
      stopMeter();
      dispatch({ type: 'reset' });
    }
    if (state.phase === 'error') stopMeter();
  }, [state.phase, state.finalText, stopMeter]);

  useEffect(
    () => () => {
      recRef.current?.abort();
      meterStop.current?.();
    },
    [],
  );

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
