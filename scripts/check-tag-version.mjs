#!/usr/bin/env node
/**
 * CI 게이트 A — 태그와 app.json 의 version 이 같은지만 본다.
 * EAS 빌드 크레딧을 쓰기 전, 공짜 러너에서 먼저 죽으라고 있는 스크립트다.
 *
 *   node scripts/check-tag-version.mjs v1.2.0
 *   GITHUB_REF_NAME=v1.2.0 node scripts/check-tag-version.mjs
 */

import { readFileSync } from 'node:fs';

import { assertTagMatchesVersion } from './release-version.mjs';

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';

if (!tag) {
  console.error('✖ 태그를 인자나 GITHUB_REF_NAME 으로 넘겨야 한다.');
  process.exit(1);
}

const version = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo
  ?.version;

try {
  assertTagMatchesVersion(tag, version);
} catch (error) {
  console.error(`✖ ${error.message}`);
  process.exit(1);
}

console.log(`✓ 태그 ${tag} == app.json 의 version ${version}`);
