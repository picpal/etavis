import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kvPut } from './kvWrite';

const ok = { put: async () => {} };
const boom = { put: async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); } };

function captureErr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  return { lines, restore: () => { console.error = orig; } };
}

test('성공하면 true 를 주고 아무것도 안 찍는다', async () => {
  const cap = captureErr();
  try {
    assert.equal(await kvPut(ok, 'places:cache', 'k', 'v', {}, 'best-effort'), true);
    assert.deepEqual(cap.lines, []);
  } finally { cap.restore(); }
});

test('best-effort 는 실패를 삼키고 false 를 준다 — 캐시 쓰기가 요청을 죽이면 안 된다', async () => {
  const cap = captureErr();
  try {
    assert.equal(await kvPut(boom, 'places:cache', 'k', 'v', {}, 'best-effort'), false);
  } finally { cap.restore(); }
});

test('required 는 실패를 다시 던진다 — 상한 카운터는 실패가 뜻을 갖는다', async () => {
  const cap = captureErr();
  try {
    await assert.rejects(() => kvPut(boom, 'guard:daily:/places:native', 'k', 'v', {}, 'required'));
  } finally { cap.restore(); }
});

test('실패하면 site 와 mode 를 남긴다 — 8개 put 중 어느 것인지 이게 유일한 단서다', async () => {
  const cap = captureErr();
  try {
    await kvPut(boom, 'guard:rl:ip', 'k', 'v', {}, 'best-effort');
    assert.equal(cap.lines.length, 1);
    assert.match(cap.lines[0], /site=guard:rl:ip/);
    assert.match(cap.lines[0], /mode=best-effort/);
    assert.match(cap.lines[0], /429/);
  } finally { cap.restore(); }
});

test('키는 절대 로그에 넣지 않는다 — 분당 카운터 키에 사용자 IP 가 들어 있다', async () => {
  const cap = captureErr();
  try {
    await kvPut(boom, 'guard:rl:ip', 'rlip:/places:203.0.113.7:29163196', 'v', {}, 'best-effort');
    assert.equal(cap.lines.length, 1);
    assert.ok(!cap.lines[0].includes('203.0.113.7'), 'IP 가 로그에 샜다');
    assert.ok(!cap.lines[0].includes('rlip:'), '키가 로그에 샜다');
  } finally { cap.restore(); }
});
