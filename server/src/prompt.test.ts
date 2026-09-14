import { test } from 'node:test';
import assert from 'node:assert/strict';
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
