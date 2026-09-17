/**
 * 릴리즈 태그를 달아도 되는 저장소 상태인지 판단한다.
 *
 * 태그는 "이 커밋이 그 버전"이라는 약속이다. main 이 아니거나 커밋되지 않은
 * 변경이 남아 있으면 그 약속이 깨지므로, 태그를 만들기 전에 막는다.
 */

import { isVersionAhead } from './release-version.mjs';

export function assertReleasable({
  branch,
  dirty,
  tagExists,
  currentVersion,
  nextVersion,
  allowDowngrade = false,
}) {
  if (branch !== 'main') {
    throw new Error(`현재 브랜치가 ${branch} 다. 릴리즈 태그는 main 에서만 단다.`);
  }

  if (dirty.trim() !== '') {
    throw new Error(
      `커밋되지 않은 변경이 있다. 태그가 가리키지 않는 코드로 빌드된다:\n${dirty.trimEnd()}`,
    );
  }

  if (tagExists) {
    throw new Error(`태그 v${nextVersion} 이 이미 있다. 버전을 올려야 한다.`);
  }

  /* 되돌리기는 사람이 한 번 더 말해야 한다(--downgrade).
     실수로 내리면 App Store Connect 에 이미 있는 버전 열로 되돌아간다.
     다만 정말 필요한 때가 있다 — 1.0.x 로 시작했다가 "아직 정식이 아니다"로
     메이저를 0 으로 내린 게 그 경우다(2026-09-17, 1.0.3 → 0.1.0).
     내리는 걸 막을 게 아니라, 모르고 내리는 걸 막는 가드다 */
  if (!isVersionAhead(currentVersion, nextVersion) && !(allowDowngrade && currentVersion !== nextVersion)) {
    throw new Error(
      `app.json 의 version 이 ${currentVersion} 인데 ${nextVersion} 으로 가려 한다. ` +
        (currentVersion === nextVersion
          ? '같은 버전으로는 릴리즈할 수 없다.'
          : '버전은 앞으로만 간다. 정말 내리려면 --downgrade 를 붙인다.'),
    );
  }
}
