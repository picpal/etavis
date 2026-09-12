import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNaverBlog, parseNaverBlog } from './naverBlog.ts';

const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

test('postdate 로 90일 안 글을 세고 weighted 를 낸다', () => {
  const r = parseNaverBlog({ total: 400, items: [{ postdate: '20260912' }, { postdate: '20260101' }] }, '20260912');
  assert.equal(r?.count90d, 1);
  assert.ok(Math.abs(r!.weighted - 1) < 1e-9);
  assert.equal(r?.source, 'naver');
});

test('total 이 20000 을 넘으면 전국 집계로 보고 버린다', () => {
  const r = parseNaverBlog({ total: 289993, items: [{ postdate: '20260912' }] }, '20260912');
  assert.equal(r, null);
});

test('total 이 정확히 20000 이면 아직 쓴다', () => {
  const r = parseNaverBlog({ total: 20000, items: [{ postdate: '20260912' }] }, '20260912');
  assert.ok(r !== null);
});

test('응답이 망가지면 null', () => {
  assert.equal(parseNaverBlog(null, '20260912'), null);
  // total이 없으면 이 검사 전에 total 체크가 먼저 걸린다.
  // items 배열 검사 자체를 확인하려면 total은 유효해야 한다.
  assert.equal(parseNaverBlog({ total: 5, items: '배열아님' }, '20260912'), null);
  assert.equal(parseNaverBlog({ total: 'x', items: [] }, '20260912'), null);
});

test('글이 하나도 없어도 0 신호를 준다 — 없음과 모름을 구분한다', () => {
  const r = parseNaverBlog({ total: 3, items: [] }, '20260912');
  assert.equal(r?.count90d, 0);
  assert.equal(r?.weighted, 0);
});

test('이름을 그대로 query 로 보낸다 — 동네를 붙이지 않는다', async () => {
  let seen = '';
  const f = (async (url: string | URL) => {
    seen = String(url);
    return new Response(JSON.stringify({ total: 1, items: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchNaverBlog('베이글랜드 홍대점', 'id', 'key', f, '20260912');
  // URLSearchParams 는 공백을 '+'로 인코딩한다(폼 표준). 디코딩해서 비교한다
  const q = new URL(seen).searchParams;
  assert.equal(q.get('query'), '베이글랜드 홍대점');
  assert.equal(q.get('sort'), 'date');
  assert.equal(q.get('display'), '100');
});

test('인증 헤더 두 개를 보낸다', async () => {
  let headers: Record<string, string> = {};
  const f = (async (_u: unknown, init?: RequestInit) => {
    headers = (init?.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ total: 1, items: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchNaverBlog('x', 'ID값', 'KEY값', f, '20260912');
  assert.equal(headers['X-NCP-APIGW-API-KEY-ID'], 'ID값');
  assert.equal(headers['X-NCP-APIGW-API-KEY'], 'KEY값');
});

test('429 나 5xx 면 null — 재시도하지 않는다', async () => {
  // 바디가 비-JSON이면 res.ok 가드 없이도 res.json() 파싱 실패로 우연히 null이 나온다.
  // 게이트웨이가 429에도 스키마상 유효한 바디(캐시된 이전 결과 등)를 실어 보낼 수 있다는
  // 걸 가정해 검사한다 — 가드가 없으면 이 바디가 그대로 파서를 통과해 신호로 둔갑한다.
  const f = (async () =>
    new Response(JSON.stringify({ total: 5, items: [{ postdate: '20260912' }] }), { status: 429 })) as unknown as typeof fetch;
  assert.equal(await fetchNaverBlog('x', 'a', 'b', f, '20260912'), null);
});

test('fetch 가 던져도 null 로 삼킨다', async () => {
  const f = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await fetchNaverBlog('x', 'a', 'b', f, '20260912'), null);
});

test('정상 경로', async () => {
  const r = await fetchNaverBlog('x', 'a', 'b', ok({ total: 10, items: [{ postdate: '20260912' }] }), '20260912');
  assert.equal(r?.count90d, 1);
});
