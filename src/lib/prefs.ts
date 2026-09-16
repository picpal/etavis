/**
 * 기기에 남기는 사용자 설정 — 문서 폴더의 `prefs.json` 한 파일.
 *
 * 읽기는 **모듈이 처음 읽힐 때 동기로 한 번**이다. 비동기로 읽으면 첫 프레임이 값을
 * 모르는 채 그려져서, 예를 들어 A2 의 팁이 펼쳐졌다가 곧바로 접히는 깜빡임이 난다.
 * `textSync()` 가 네이티브 동기 함수라 그럴 일이 없다.
 *
 * 쓰기는 값이 바뀔 때만. 둘 다 **절대 던지지 않는다** — 설정은 앱이 도는 데 필수가
 * 아니다. 파일을 못 읽거나 못 쓰면 이번 실행만 기본값으로 살고 화면은 그대로 선다.
 * (`trackLog` 와 같은 약속이다)
 */
import { File, Paths } from 'expo-file-system';
import { DEFAULT_PREFS, parsePrefs, serializePrefs, type Prefs } from './prefsFormat';

const file = () => new File(Paths.document, 'prefs.json');

function load(): Prefs {
  try {
    const f = file();
    return f.exists ? parsePrefs(f.textSync()) : { ...DEFAULT_PREFS };
  } catch {
    // 파일을 못 읽는 기기(권한·손상)에서도 앱은 돌아야 한다
    return { ...DEFAULT_PREFS };
  }
}

let cache: Prefs = load();

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  return cache[key];
}

/** 같은 값이면 파일을 건드리지 않는다 — 화면이 렌더마다 불러도 되게 */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  if (cache[key] === value) return;
  cache = { ...cache, [key]: value };
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(serializePrefs(cache));
  } catch {
    // 못 써도 이번 실행에서는 메모리 값으로 동작한다
  }
}
