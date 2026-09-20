/** 브라우저 음성 인식의 순수한 부분 — DOM·React 의존 없음.
 *
 *  `speech.web.ts` 가 Web Speech API 를 이 함수들로 읽는다. 훅에서 분리해 둔 이유는
 *  여기가 틀리기 쉬운 자리이기 때문이다: results 는 누적 배열이고, 음량은 API 가
 *  주지 않아 파형에서 직접 재야 한다. 둘 다 훅 안에 있으면 시험할 수가 없다.
 */

/** Web Speech 의 한 조각. 앱은 대안(alternatives) 중 첫 번째만 쓴다 */
export type SpeechResultPiece = { transcript: string; isFinal: boolean };

type MaybeWindow = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } | undefined;

/** Chrome·Edge 는 webkit 접두사로만 준다. Firefox 는 둘 다 없다 */
export function speechRecognitionCtor(w: MaybeWindow): unknown {
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

export function isSpeechAvailable(w: MaybeWindow): boolean {
  return speechRecognitionCtor(w) != null;
}

/**
 * `SpeechRecognitionEvent.results` 를 한 덩어리로 읽는다.
 *
 * results 는 **누적**이다 — 확정된 조각 뒤에 흐르는 조각이 붙어서 온다. 마지막
 * 조각만 읽으면 앞서 확정된 말이 화면에서 사라지고, 전부 확정된 줄 알고 밀어
 * 넣으면 말이 잘린 채 입력창에 들어간다. 그래서 이어 붙이되 **마지막 조각까지
 * 확정됐을 때만** 최종으로 본다.
 */
export function readSpeechResults(results: SpeechResultPiece[]): SpeechResultPiece {
  const transcript = results
    .map(r => r.transcript.trim())
    .filter(Boolean)
    .join(' ');
  const isFinal = results.length > 0 && results[results.length - 1].isFinal;
  return { transcript, isFinal };
}

/** 말소리 RMS 는 0.05 언저리라 그대로 쓰면 막대가 안 움직인다 */
const LEVEL_GAIN = 4;

/**
 * AnalyserNode 의 8비트 시간영역 파형에서 0~1 음량을 만든다.
 *
 * Web Speech API 에는 네이티브의 `volumechange` 에 해당하는 게 없다. 막대를
 * 가짜로 흔들면 말하지 않아도 "듣고 있다"는 거짓 신호가 되므로 실제로 잰다.
 * 무음은 128 이 기준선이다.
 */
export function micLevelFromTimeDomain(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / bytes.length);
  return Math.min(1, Math.max(0, rms * LEVEL_GAIN));
}
