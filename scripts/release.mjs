#!/usr/bin/env node
/**
 * 릴리즈 한 방 — app.json 의 version 을 올리고, 커밋하고, 같은 이름의 태그를 밀어
 * TestFlight 배포(.github/workflows/testflight.yml)를 깨운다.
 *
 *   npm run release -- 1.2.0
 *   npm run release -- 1.2.0 --dry-run     # 아무것도 밀지 않고 계획만 본다
 *
 * `--` 가 필요한 이유는 npm 이 `--dry-run` 을 자기 플래그로 먹기 때문이다.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { parseVersionArg, setAppJsonVersion } from './release-version.mjs';
import { assertReleasable } from './release-preflight.mjs';

const APP_JSON = new URL('../app.json', import.meta.url);
const ROOT = new URL('..', import.meta.url);

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function run(command, ...args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}

function die(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = parseVersionArg(args.find((arg) => !arg.startsWith('--')));

if (!version) {
  die('버전을 X.Y.Z 로 넘겨야 한다.  예) npm run release -- 1.2.0');
}

const text = readFileSync(APP_JSON, 'utf8');
const currentVersion = JSON.parse(text).expo?.version;
const tag = `v${version}`;

// 원격에 이미 있는 태그를 모르고 지나치지 않도록 먼저 당겨온다. 오프라인이면 로컬만 본다.
try {
  git('fetch', '--tags', '--quiet', 'origin');
} catch {
  console.warn('! origin 에서 태그를 못 당겼다. 로컬 태그만 보고 판단한다.');
}

try {
  assertReleasable({
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain'),
    tagExists: git('tag', '--list', tag) !== '',
    currentVersion,
    nextVersion: version,
  });
} catch (error) {
  die(error.message);
}

// CI 가 어차피 돌리지만, 여기서 먼저 죽는 편이 낫다 —
// 태그를 민 뒤에 실패하면 원격 태그를 지우고 다시 달아야 한다.
console.log('· 테스트');
try {
  run('npm', 'test');
} catch {
  die('테스트가 실패했다. 고친 뒤 다시 릴리즈한다.');
}

console.log(`\n  app.json   version ${currentVersion} → ${version}`);
console.log(`  commit     release: ${tag}`);
console.log(`  tag        ${tag}`);
console.log('  push       origin main --follow-tags\n');

if (dryRun) {
  console.log('· --dry-run 이라 여기서 멈춘다. 아무것도 바꾸지 않았다.');
  process.exit(0);
}

writeFileSync(APP_JSON, setAppJsonVersion(text, version));
git('add', 'app.json');
git('commit', '-m', `release: ${tag}`);
git('tag', '-a', tag, '-m', `release ${tag}`); // --follow-tags 는 annotated 태그만 민다
git('push', '--follow-tags', 'origin', 'main');

console.log(`✓ ${tag} 를 밀었다. TestFlight 배포가 시작된다.`);
console.log('  https://github.com/picpal/etavis/actions/workflows/testflight.yml');
