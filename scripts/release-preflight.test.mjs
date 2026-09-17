import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertReleasable } from './release-preflight.mjs';

const ok = {
  branch: 'main',
  dirty: '',
  tagExists: false,
  currentVersion: '1.0.0',
  nextVersion: '1.1.0',
};

test('정상 상태면 아무 일도 없다', () => {
  assert.doesNotThrow(() => assertReleasable(ok));
});

test('main 이 아니면 막는다 — 태그는 main 의 커밋을 가리켜야 한다', () => {
  assert.throws(() => assertReleasable({ ...ok, branch: 'feat/transit' }), /main/);
});

test('커밋되지 않은 변경이 있으면 막는다 — 태그가 가리키지 않는 코드가 빌드된다', () => {
  assert.throws(
    () => assertReleasable({ ...ok, dirty: ' M src/App.tsx\n' }),
    /src\/App\.tsx/,
  );
});

test('이미 있는 태그면 막는다', () => {
  assert.throws(() => assertReleasable({ ...ok, tagExists: true }), /v1\.1\.0/);
});

test('같은 버전이면 막는다', () => {
  assert.throws(
    () => assertReleasable({ ...ok, currentVersion: '1.1.0' }),
    /1\.1\.0/,
  );
});

test('버전을 내리면 막는다 — 같은 빌드 번호 공간으로 되돌아간다', () => {
  assert.throws(
    () => assertReleasable({ ...ok, currentVersion: '1.2.0', nextVersion: '1.1.0' }),
    /1\.2\.0/,
  );
});

test('--downgrade 면 버전을 내릴 수 있다', () => {
  /* 내리는 걸 막는 게 아니라 모르고 내리는 걸 막는 가드다.
     TestFlight 에서 실제로 내려 봤다가 테스터에게 안 가서 되돌렸지만
     (release.mjs 머리말), 탈출구 자체는 남겨 둔다 */
  assert.doesNotThrow(() =>
    assertReleasable({ ...ok, currentVersion: '1.0.3', nextVersion: '0.1.0', allowDowngrade: true }),
  );
});

test('--downgrade 라도 같은 버전은 막는다 — 태그가 둘이 될 수는 없다', () => {
  assert.throws(
    () => assertReleasable({ ...ok, currentVersion: '1.1.0', allowDowngrade: true }),
    /같은 버전/,
  );
});

test('--downgrade 없이 내리면 무엇을 붙여야 하는지 알려준다', () => {
  assert.throws(
    () => assertReleasable({ ...ok, currentVersion: '1.0.3', nextVersion: '0.1.0' }),
    /--downgrade/,
  );
});
