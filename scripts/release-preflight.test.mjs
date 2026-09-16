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
