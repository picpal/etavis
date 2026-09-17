import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kstHHMM, SYSTEM_PROMPT } from './prompt';

test('UTC 를 KST 로 9시간 민다 — Workers 의 Date 는 UTC 다', () => {
  assert.equal(kstHHMM(new Date('2026-09-15T00:00:00Z')), '09:00');
  assert.equal(kstHHMM(new Date('2026-09-14T22:00:00Z')), '07:00');
});

test('자정을 넘겨도 00~23 안에 있다 — 날짜는 프롬프트가 알 바가 아니다', () => {
  assert.equal(kstHHMM(new Date('2026-09-14T15:30:00Z')), '00:30');
  assert.equal(kstHHMM(new Date('2026-09-14T14:59:00Z')), '23:59');
});

test('시·분을 0으로 채운다 — HH:MM 이라고 프롬프트가 약속했다', () => {
  assert.match(kstHHMM(new Date('2026-09-14T20:05:00Z')), /^\d{2}:\d{2}$/);
  assert.equal(kstHHMM(new Date('2026-09-14T20:05:00Z')), '05:05');
});

test('프롬프트가 now 를 실제로 언급한다 — 서버가 넣는데 규칙이 없으면 무용지물이다', () => {
  assert.ok(SYSTEM_PROMPT.includes('now'), 'now 규칙이 빠졌다');
  assert.ok(SYSTEM_PROMPT.includes('transit'), 'mode 규칙이 빠졌다');
});

test('near 규칙이 프롬프트에 실려 있다 — 스키마만 고치면 LLM 은 영영 안 뱉는다', () => {
  assert.ok(SYSTEM_PROMPT.includes('near'), 'near 규칙이 빠졌다');
  assert.ok(SYSTEM_PROMPT.includes('"near":"any"'), '출력 예시에 near 가 빠졌다');
});

test('프롬프트가 태그 3개를 요구한다', () => {
  for (const k of ['loadBefore', 'loadAfter', 'needWhen']) {
    assert.ok(SYSTEM_PROMPT.includes(k), `${k} 가 프롬프트에 없다`);
  }
});

test('방향은 여전히 추론하지 않는다고 못 박는다', () => {
  assert.ok(SYSTEM_PROMPT.includes('추론하지 않는다'));
});

test('문서 원본도 태그 3개를 적고 있다 — 사본만 고치면 다음 사람이 원본을 믿는다', () => {
  const md = readFileSync('server/prompts/extract-intent.md', 'utf8');
  assert.ok(md.includes('(v10)'), '문서 헤더가 v10 이 아니다');
  for (const k of ['loadBefore', 'loadAfter', 'needWhen']) {
    assert.ok(md.includes(k), `${k} 가 문서 원본에 없다`);
  }
});
