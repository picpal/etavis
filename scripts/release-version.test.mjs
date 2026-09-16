import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTag,
  parseVersionArg,
  isVersionAhead,
  assertTagMatchesVersion,
  setAppJsonVersion,
} from './release-version.mjs';

// 태그 이름 → 마케팅 버전.
// 3마디 숫자만 받는 이유는 CFBundleShortVersionString 이 그것만 받기 때문이다.
test('parseTag: v 접두사 + 3마디 숫자만 버전으로 읽는다', () => {
  assert.equal(parseTag('v1.2.0'), '1.2.0');
  assert.equal(parseTag('v10.0.31'), '10.0.31');
});

test('parseTag: 프리릴리즈 꼬리표는 마케팅 버전이 될 수 없다', () => {
  assert.equal(parseTag('v1.2.0-rc1'), null);
  assert.equal(parseTag('v1.2.0+build'), null);
});

test('parseTag: v 없는 이름·마디 수가 다른 이름은 거른다', () => {
  assert.equal(parseTag('1.2.0'), null);
  assert.equal(parseTag('v1.2'), null);
  assert.equal(parseTag('v1.2.0.1'), null);
  assert.equal(parseTag('release-1.2.0'), null);
});

test('parseTag: 앞자리 0 은 App Store 표기와 어긋나므로 거른다', () => {
  assert.equal(parseTag('v01.2.0'), null);
  assert.equal(parseTag('v1.02.0'), null);
});

// 릴리즈 스크립트 인자는 사람이 치므로 v 를 붙여도 받아준다.
test('parseVersionArg: v 를 붙이든 안 붙이든 같은 버전으로 읽는다', () => {
  assert.equal(parseVersionArg('1.2.0'), '1.2.0');
  assert.equal(parseVersionArg('v1.2.0'), '1.2.0');
});

test('parseVersionArg: 형식이 틀리면 null', () => {
  assert.equal(parseVersionArg('1.2'), null);
  assert.equal(parseVersionArg('1.2.0-rc1'), null);
  assert.equal(parseVersionArg(''), null);
});

test('isVersionAhead: 마디를 숫자로 비교한다', () => {
  assert.equal(isVersionAhead('1.0.0', '1.2.0'), true);
  assert.equal(isVersionAhead('1.9.0', '1.10.0'), true); // 문자열 비교였다면 false
  assert.equal(isVersionAhead('1.2.0', '1.2.1'), true);
});

test('isVersionAhead: 같거나 낮은 버전은 앞이 아니다', () => {
  assert.equal(isVersionAhead('1.2.0', '1.2.0'), false);
  assert.equal(isVersionAhead('1.2.0', '1.1.9'), false);
  assert.equal(isVersionAhead('2.0.0', '1.99.99'), false);
});

// CI 게이트 A — 태그와 app.json 이 어긋난 채 빌드가 나가는 것을 막는다.
test('assertTagMatchesVersion: 일치하면 아무 일도 없다', () => {
  assert.doesNotThrow(() => assertTagMatchesVersion('v1.2.0', '1.2.0'));
});

test('assertTagMatchesVersion: 어긋나면 두 값을 모두 담아 실패한다', () => {
  assert.throws(() => assertTagMatchesVersion('v1.2.0', '1.1.0'), (err) => {
    assert.match(err.message, /v1\.2\.0/);
    assert.match(err.message, /1\.1\.0/);
    return true;
  });
});

test('assertTagMatchesVersion: 태그 형식 자체가 틀리면 실패한다', () => {
  assert.throws(() => assertTagMatchesVersion('v1.2.0-rc1', '1.2.0'), /v1\.2\.0-rc1/);
});

const APP_JSON = `{
  "expo": {
    "name": "Etavia",
    "slug": "etavia",
    "version": "1.0.0",
    "ios": {
      "supportsTablet": false
    }
  }
}
`;

test('setAppJsonVersion: version 만 바꾸고 나머지 바이트는 그대로 둔다', () => {
  const next = setAppJsonVersion(APP_JSON, '1.2.0');

  assert.equal(JSON.parse(next).expo.version, '1.2.0');
  assert.equal(next, APP_JSON.replace('"version": "1.0.0"', '"version": "1.2.0"'));
});

test('setAppJsonVersion: 같은 버전으로 다시 쓰면 실패한다', () => {
  assert.throws(() => setAppJsonVersion(APP_JSON, '1.0.0'), /1\.0\.0/);
});

test('setAppJsonVersion: expo.version 이 없으면 실패한다', () => {
  assert.throws(() => setAppJsonVersion('{"expo":{"slug":"etavia"}}', '1.2.0'), /version/);
});

// buildNumber 는 EAS 가 remote 로 관리한다. app.json 에 있으면 두 곳이 어긋난다.
test('setAppJsonVersion: ios.buildNumber 가 섞여 있으면 실패한다', () => {
  const withBuildNumber = APP_JSON.replace(
    '"supportsTablet": false',
    '"supportsTablet": false,\n      "buildNumber": "3"',
  );

  assert.throws(() => setAppJsonVersion(withBuildNumber, '1.2.0'), /buildNumber/);
});
