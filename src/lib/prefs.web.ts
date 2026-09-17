/**
 * 웹 설정 — localStorage. expo-file-system 은 웹에서 지원되지 않는다.
 *
 * 네이티브와 같은 약속을 지킨다: **절대 던지지 않는다.** 설정은 앱이 도는 데 필수가
 * 아니다. 시크릿 모드·사이트 데이터 차단에서는 localStorage 에 **접근하는 것만으로도**
 * 던지므로 읽기·쓰기·파싱 셋 다 감싼다. 심사자가 시크릿 모드로 들어온다.
 */
import { DEFAULT_PREFS, parsePrefs, serializePrefs, type Prefs } from './prefsFormat';

const KEY = 'etavia.prefs';

function load(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? parsePrefs(raw) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let cache: Prefs = load();

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return cache[key];
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (cache[key] === value) return;
  cache = { ...cache, [key]: value };
  try {
    globalThis.localStorage?.setItem(KEY, serializePrefs(cache));
  } catch {
    // 못 써도 이번 세션은 메모리 값으로 동작한다
  }
}
