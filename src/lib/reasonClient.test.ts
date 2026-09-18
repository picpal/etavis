import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReasonClient } from './reasonClient';

const REQ = {
  text: '마트 들러서 약국 가고 집에 갈게',
  mode: 'walk' as const,
  fast: { stops: ['이마트', '온누리약국'], totalMin: 40 },
  comfort: { stops: ['온누리약국', '이마트'], totalMin: 44 },
};

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('서버가 준 한 줄을 그대로 돌려준다', async () => {
  const client = makeReasonClient({
    baseUrl: 'https://x.test',
    appToken: 't',
    deviceId: 'd',
    fetchFn: async () => jsonRes({ why: '장 본 걸 들고 약국에 들어가지 않아도 돼요' }),
  });

  assert.equal(await client(REQ), '장 본 걸 들고 약국에 들어가지 않아도 돼요');
});

test('why 가 null 이면 null 이다 — 설명은 장식이라 없어도 경로는 나온다', async () => {
  const client = makeReasonClient({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: async () => jsonRes({ why: null }),
  });

  assert.equal(await client(REQ), null);
});

test('서버가 실패해도 던지지 않는다 — 설명 하나 때문에 화면이 시끄러우면 안 된다', async () => {
  const client = makeReasonClient({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: async () => jsonRes({ error: 'bad request' }, 422),
  });

  assert.equal(await client(REQ), null);
});

test('네트워크가 끊겨도 던지지 않는다', async () => {
  const client = makeReasonClient({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: async () => { throw new Error('offline'); },
  });

  assert.equal(await client(REQ), null);
});

test('모양이 다른 응답은 버린다 — 서버 응답도 믿지 않는다', async () => {
  const client = makeReasonClient({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: async () => jsonRes({ why: 42 }),
  });

  assert.equal(await client(REQ), null);
});

test('토큰과 기기 id 를 헤더에 싣는다', async () => {
  let seen: Record<string, string> = {};
  const client = makeReasonClient({
    baseUrl: 'https://x.test/', appToken: 'tok', deviceId: 'dev',
    fetchFn: async (_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return jsonRes({ why: '한 줄' });
    },
  });
  await client(REQ);

  assert.equal(seen['x-app-token'], 'tok');
  assert.equal(seen['x-device-id'], 'dev');
});
