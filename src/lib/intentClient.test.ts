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

/* 폴백 사유 — 화면은 몰라도 되지만 로그는 알아야 한다.
   2026-09-17 에 워커 secret 이 비어 /extract 가 502 를 내고 있었는데, 실패 넷을
   전부 조용히 삼키는 바람에 며칠간 아무도 몰랐다. 사유가 서로 구분돼야 의미가 있다. */

test('상태코드 실패면 사유에 그 코드가 실린다', async () => {
  const seen: string[] = [];
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({ error: 'upstream' }, 502), fallback,
    onFallback: r => seen.push(r),
  });
  await fn('t', CTX);
  assert.deepEqual(seen, ['http 502']);
});

test('일일 상한과 서버 오류가 같은 사유로 뭉뚱그려지지 않는다', async () => {
  const seen: string[] = [];
  const mk = (status: number) => serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({}, status), fallback, onFallback: r => seen.push(r),
  });
  await mk(429)('t', CTX);
  await mk(502)('t', CTX);
  assert.deepEqual(seen, ['http 429', 'http 502'], '두 사유가 구분돼야 어디를 고칠지 안다');
});

test('모양이 틀린 응답은 상태코드 실패와 다른 사유로 남는다', async () => {
  const seen: string[] = [];
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({ ...SERVER_INTENT, stops: 'nope' }), fallback,
    onFallback: r => seen.push(r),
  });
  await fn('t', CTX);
  assert.deepEqual(seen, ['shape'], '200 인데 모양이 틀린 건 프록시가 낀 것이다 — 상태코드 실패와 원인이 다르다');
});

test('예외(네트워크 끊김·타임아웃)는 사유에 내용이 실린다', async () => {
  const seen: string[] = [];
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd', fallback,
    fetchFn: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
    onFallback: r => seen.push(r),
  });
  await fn('t', CTX);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /network down/, '무엇 때문에 떨어졌는지가 남아야 한다');
});

test('성공하면 사유를 남기지 않는다 — 로그가 노이즈가 되면 아무도 안 본다', async () => {
  const seen: string[] = [];
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply(SERVER_INTENT), fallback, onFallback: r => seen.push(r),
  });
  const out = await fn('t', CTX);
  assert.equal(out.source, 'server');
  assert.deepEqual(seen, []);
});

test('onFallback 을 안 넘겨도 폴백은 그대로 돈다 — 선택 인자다', async () => {
  const fn = serverExtractFn({
    baseUrl: 'https://x.test', appToken: 't', deviceId: 'd',
    fetchFn: reply({}, 500), fallback,
  });
  assert.equal((await fn('t', CTX)).source, 'local');
});
