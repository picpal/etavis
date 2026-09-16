/**
 * 릴리즈 태그를 달아도 되는 저장소 상태인지 판단한다.
 *
 * 태그는 "이 커밋이 그 버전"이라는 약속이다. main 이 아니거나 커밋되지 않은
 * 변경이 남아 있으면 그 약속이 깨지므로, 태그를 만들기 전에 막는다.
 */

import { isVersionAhead } from './release-version.mjs';

export function assertReleasable({ branch, dirty, tagExists, currentVersion, nextVersion }) {
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

  if (!isVersionAhead(currentVersion, nextVersion)) {
    throw new Error(
      `app.json 의 version 이 ${currentVersion} 인데 ${nextVersion} 으로 가려 한다. ` +
        '버전은 앞으로만 간다.',
    );
  }
}
