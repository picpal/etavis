/**
 * 기기에 남기는 사용자 설정 — 읽고 쓰는 순수 부분.
 *
 * 파일 I/O 는 `prefs.ts` 가 한다. 갈래를 나눈 이유는 `trackLogFormat`/`trackLog` 와 같다:
 * expo-file-system 을 물면 node 테스트가 못 읽는다. 여기는 문자열만 다룬다.
 *
 * **이 모듈은 절대 던지지 않는다.** 설정은 앱이 돌아가는 데 필수가 아니다 —
 * 파일이 없든 깨졌든 기본값으로 가고, 화면은 그대로 선다.
 */

export type Prefs = {
  /** A2 의 팁 카드를 한 번이라도 봤나. 두 번째부터는 접어서 보여준다 */
  tipSeen: boolean;
};

export const DEFAULT_PREFS: Prefs = { tipSeen: false };

/** 값의 모양까지 본다 — 옛 버전이 남긴 다른 타입이 그대로 화면에 닿으면 안 된다 */
const READERS: { [K in keyof Prefs]: (v: unknown) => Prefs[K] | undefined } = {
  tipSeen: v => (typeof v === 'boolean' ? v : undefined),
};

/**
 * 저장된 문자열 → 설정. 못 읽으면 그 키만 기본값으로 돌아간다.
 * 모르는 키는 버린다 — 지운 설정이 파일에 남아 있다가 되살아나면 안 된다.
 */
export function parsePrefs(text: string | null | undefined): Prefs {
  if (!text) return { ...DEFAULT_PREFS };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PREFS };
  const out = { ...DEFAULT_PREFS };
  for (const key of Object.keys(READERS) as (keyof Prefs)[]) {
    const read = READERS[key](( raw as Record<string, unknown>)[key]);
    if (read !== undefined) (out[key] as Prefs[typeof key]) = read;
  }
  return out;
}

export function serializePrefs(prefs: Prefs): string {
  return JSON.stringify(prefs);
}
