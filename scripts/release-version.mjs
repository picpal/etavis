/**
 * 릴리즈 태그 ↔ app.json 의 마케팅 버전을 잇는 규칙.
 *
 * EAS 의 `appVersionSource: "remote"` 는 **빌드 번호만** 서버에서 관리한다.
 * 사용자에게 보이는 `version`(CFBundleShortVersionString)은 여전히 app.json 에서
 * 읽으므로, 태그가 릴리즈 버전을 명시하려면 둘이 반드시 같아야 한다.
 * 그 확인을 CI 가 빌드 크레딧을 쓰기 전에 한다.
 */

// 앞자리 0 을 막는다 — App Store 는 `01.2.0` 을 그렇게 표기하지 않는다.
const PART = '(?:0|[1-9]\\d*)';
const TAG_RE = new RegExp(`^v(${PART}\\.${PART}\\.${PART})$`);

/** 태그 이름에서 마케팅 버전을 뽑는다. 형식이 아니면 null. */
export function parseTag(tag) {
  const matched = TAG_RE.exec(String(tag ?? ''));
  return matched ? matched[1] : null;
}

/** 릴리즈 스크립트 인자. 사람이 치는 값이라 `v` 는 붙여도 안 붙여도 받는다. */
export function parseVersionArg(arg) {
  const raw = String(arg ?? '');
  return parseTag(raw.startsWith('v') ? raw : `v${raw}`);
}

/** next 가 current 보다 앞선 버전인가. 마디를 숫자로 비교한다. */
export function isVersionAhead(current, next) {
  const a = current.split('.').map(Number);
  const b = next.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (b[i] !== a[i]) return b[i] > a[i];
  }
  return false;
}

/** CI 게이트 A. 태그와 app.json 의 version 이 어긋나면 던진다. */
export function assertTagMatchesVersion(tag, version) {
  const fromTag = parseTag(tag);

  if (fromTag === null) {
    throw new Error(
      `태그 ${tag} 는 vX.Y.Z 형식이 아니다. 마케팅 버전은 숫자 3마디만 가능하다.`,
    );
  }
  if (fromTag !== version) {
    throw new Error(
      `태그 ${tag} 와 app.json 의 version ${version} 이 다르다. ` +
        `app.json 을 ${fromTag} 으로 올려 커밋한 뒤 태그를 다시 달아야 한다.`,
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** app.json 원문에서 expo.version 만 바꾼 새 원문을 돌려준다(들여쓰기·나머지 보존). */
export function setAppJsonVersion(text, nextVersion) {
  const config = JSON.parse(text).expo;

  if (!config?.version) {
    throw new Error('app.json 에 expo.version 이 없다.');
  }
  if (config.ios?.buildNumber) {
    throw new Error(
      'app.json 에 ios.buildNumber 가 있다. ' +
        'eas.json 이 appVersionSource: "remote" 라 무시되고 두 곳이 어긋난다 — 지워야 한다.',
    );
  }
  if (config.version === nextVersion) {
    throw new Error(`app.json 의 version 이 이미 ${nextVersion} 이다.`);
  }

  const versionLine = new RegExp(`("version"\\s*:\\s*")${escapeRegExp(config.version)}(")`, 'g');
  const hits = text.match(versionLine) ?? [];

  if (hits.length !== 1) {
    throw new Error(
      `app.json 에서 version 줄을 하나로 특정하지 못했다(${hits.length}건). 손으로 고쳐야 한다.`,
    );
  }

  return text.replace(versionLine, `$1${nextVersion}$2`);
}
