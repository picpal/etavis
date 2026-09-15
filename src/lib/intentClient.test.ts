import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverExtractFn, localExtractFn } from './intentClient';
import type { Intent, IntentContext } from './intent';

const CTX: IntentContext = { currentStops: ['올리브영'], knownPlaces: ['집', '회사'] };

const SERVER_INTENT: Intent = {
  resetStops: false,
  stops: [{ op: 'add', queries: ['이마트'], kind: 'brand', why: '장보기', count: 1, flexible: true, openNow: false }],
  endpoints: {},
  order: 'auto',
  arriveBy: null,
  mode: null,
  reject: null,
  ambiguous: [],
};

const MOCK_INTENT: Intent = { ...SERVER_INTENT, stops: [], order: 'locked' };
const fallback = () => MOCK_INTENT;

const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('서버가 답하면 그대로 쓰고 source는 server', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply(SERVER_INTENT), fallback,
  });
  const out = await fn('이마트도 들러', CTX);
  assert.equal(out.source, 'server');
  assert.equal(out.intent.stops[0].queries[0], '이마트');
});

test('요청에 토큰·기기 id·컨텍스트를 실어 보낸다', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 'tok', deviceId: 'dev-1', fallback,
    fetchFn: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(SERVER_INTENT), { status: 200 });
    }) as unknown as typeof fetch,
  });
  await fn('이마트도 들러', CTX);
  assert.ok(seen);
  assert.equal(seen!.url, 'https://x.test/extract');
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h['x-app-token'], 'tok');
  assert.equal(h['x-device-id'], 'dev-1');
  const body = JSON.parse(seen!.init.body as string);
  assert.equal(body.text, '이마트도 들러');
  assert.deepEqual(body.context, { currentStops: ['올리브영'], knownPlaces: ['집', '회사'] });
});

test('baseUrl 끝 슬래시가 있어도 //extract 가 되지 않는다', async () => {
  let url = '';
  const fn = serverExtractFn({
    baseUrl: 'https://x.test/', appToken: 't', deviceId: 'd', fallback,
    fetchFn: (async (u: string) => { url = u; return new Response(JSON.stringify(SERVER_INTENT)); }) as unknown as typeof fetch,
  });
  await fn('t', CTX);
  assert.equal(url, 'https://x.test/extract');
});

test('knownPlaces 가 없으면 빈 배열로 보낸다 — 서버가 undefined 를 만나지 않는다', async () => {
  let body: { context?: { knownPlaces?: unknown } } = {};
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd', fallback,
    fetchFn: (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(SERVER_INTENT));
    }) as unknown as typeof fetch,
  });
  await fn('t', { currentStops: [] });
  assert.deepEqual(body.context?.knownPlaces, []);
});

/* 폴백 — 실패 넷이 전부 같은 곳으로 간다. 화면은 source 만 보면 된다 */

test('429(일일 상한)면 목으로 떨어진다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({ error: 'daily cap' }, 429), fallback,
  });
  const out = await fn('t', CTX);
  assert.equal(out.source, 'local');
  assert.equal(out.intent.order, 'locked', '목이 낸 값이 그대로 온다');
});

test('502(OpenAI 죽음)면 목으로 떨어진다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({ error: 'upstream', status: 401 }, 502), fallback,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});

test('네트워크가 끊기면 목으로 떨어진다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd', fallback,
    fetchFn: (async () => { throw new Error('network'); }) as unknown as typeof fetch,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});

test('타임아웃이면 목으로 떨어진다 — 사용자를 무한정 기다리게 두지 않는다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd', fallback, timeoutMs: 10,
    fetchFn: ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});

test('JSON 이 아닌 응답(프록시 HTML 오류 페이지)이면 목으로 떨어진다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd', fallback,
    fetchFn: (async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })) as unknown as typeof fetch,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});

test('모양이 Intent 가 아니면 목으로 떨어진다 — stops 가 배열이 아니다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({ ...SERVER_INTENT, stops: 'nope' }), fallback,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});

test('ambiguous 가 없으면 목으로 떨어진다 — Task 1 스키마가 아직 없는 배포된 Worker가 이 모양을 돌려준다', async () => {
  const { ambiguous: _omit, ...withoutAmbiguous } = SERVER_INTENT;
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply(withoutAmbiguous), fallback,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});

test('arriveBy 가 null 인 정상 응답은 통과한다 — null 은 "마감 없음"이지 결함이 아니다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({ ...SERVER_INTENT, arriveBy: null }), fallback,
  });
  assert.equal((await fn('t', CTX)).source, 'server');
});

test('localExtractFn 은 항상 목이고 네트워크를 타지 않는다', async () => {
  const out = await localExtractFn()('올리브영 들러', { currentStops: [] });
  assert.equal(out.source, 'local');
  assert.ok(Array.isArray(out.intent.stops));
});
