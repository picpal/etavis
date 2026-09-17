import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlePlaces, kakaoLocalUrl, placesCacheKey } from './places';
import type { PlacesRequest } from './placesSchema';

const req = (over: Partial<PlacesRequest> = {}): PlacesRequest => ({
  kind: 'keyword', query: '올리브영', x: 126.9327, y: 37.5271, radius: 1500, size: 15,
  categoryCode: undefined, sortByDistance: true, ...over,
});

const kv = () => {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
  };
};

const env = (over: Record<string, unknown> = {}) => ({ KAKAO_LOCAL_KEY: 'test-key', CACHE: kv(), RATE: kv(), ...over }) as never;

test('URL 조립 — 좌표가 있으면 거리순, radius 를 싣는다', () => {
  const u = new URL(kakaoLocalUrl(req()));
  assert.equal(u.pathname, '/v2/local/search/keyword.json');
  assert.equal(u.searchParams.get('query'), '올리브영');
  assert.equal(u.searchParams.get('sort'), 'distance');
  assert.equal(u.searchParams.get('radius'), '1500');
  assert.equal(u.searchParams.get('size'), '15');
});

test('좌표가 없으면 sort·radius 를 안 싣는다', () => {
  const u = new URL(kakaoLocalUrl(req({ x: undefined, y: undefined, radius: undefined, sortByDistance: false })));
  assert.equal(u.searchParams.get('sort'), null);
  assert.equal(u.searchParams.get('radius'), null);
});

test('address 는 다른 엔드포인트', () => {
  assert.match(kakaoLocalUrl(req({ kind: 'address' })), /\/v2\/local\/search\/address\.json/);
});

test('성공 응답을 documents 로 넘기고 캐시에 넣는다', async () => {
  const e = env();
  const fetchFn = async () => new Response(JSON.stringify({ documents: [{ id: '1', place_name: '올리브영 여의도IFC점' }] }), { status: 200 });
  const res = await handlePlaces(req(), e, { fetch: fetchFn as typeof fetch });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { documents: unknown[] }).documents.length, 1);
  assert.equal(e.CACHE.store.size, 1);
});

test('캐시에 있으면 바깥을 안 부른다', async () => {
  const e = env();
  e.CACHE.store.set(placesCacheKey(req()), JSON.stringify({ documents: [{ id: 'cached' }] }));
  let called = 0;
  const fetchFn = async () => { called++; return new Response('{}', { status: 200 }); };
  const res = await handlePlaces(req(), e, { fetch: fetchFn as typeof fetch });
  assert.equal(called, 0);
  assert.equal((await res.json() as { documents: { id: string }[] }).documents[0].id, 'cached');
});

test('카카오가 실패하면 502 — 실패는 캐시하지 않는다', async () => {
  const e = env();
  const fetchFn = async () => new Response('nope', { status: 500 });
  const res = await handlePlaces(req(), e, { fetch: fetchFn as typeof fetch });
  assert.equal(res.status, 502);
  assert.equal(e.CACHE.store.size, 0);
});

test('키가 없으면 501 — 키 없음과 상류 장애를 섞지 않는다', async () => {
  const res = await handlePlaces(req(), env({ KAKAO_LOCAL_KEY: '' }), { fetch: (async () => new Response('{}')) as typeof fetch });
  assert.equal(res.status, 501);
});

test('캐시 키는 좌표를 격자로 깎는다 — 11m 차이로 캐시가 갈리면 안 된다', () => {
  assert.equal(placesCacheKey(req({ y: 37.52710 })), placesCacheKey(req({ y: 37.52712 })));
  assert.notEqual(placesCacheKey(req({ query: '올리브영' })), placesCacheKey(req({ query: '파리바게뜨' })));
});

test('fetch 를 this 없이 부른다 — Workers 의 fetch 는 전역 this 를 요구한다', async () => {
  let seenThis: unknown = 'unset';
  const deps = {
    // 화살표 함수면 this 를 못 본다. 일반 함수라야 호출 방식이 드러난다
    fetch: function (this: unknown) {
      seenThis = this;
      return Promise.resolve(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
    } as unknown as typeof fetch,
  };
  await handlePlaces(req(), env(), deps);
  assert.equal(
    seenThis,
    undefined,
    'deps.fetch(...) 로 부르면 this 가 deps 가 되어 Workers 에서 Illegal invocation 이 난다',
  );
});
