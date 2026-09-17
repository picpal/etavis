/**
 * 워커 진입점 — 배선 테스트.
 *
 * 개별 핸들러는 각자 테스트가 있다. 여기서 보는 건 **순서와 껍데기**다:
 * 예외가 나가는 길, 캐시와 상한의 앞뒤, 버킷이 실제로 갈리는지.
 * 이 셋은 전부 index.ts 에만 있어서 다른 파일의 테스트로는 안 잡힌다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index';
import { placesCacheKey } from './places';
import { parsePlacesRequest } from './placesSchema';
import { dayKey, PER_DAY } from './guard';

const kv = () => {
  const store = new Map<string, string>();
  return {
    store,
    puts: 0,
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
      this.puts += 1;
    },
  };
};

const ORIGIN = 'https://demo.test';

const env = (over: Record<string, unknown> = {}) =>
  ({
    APP_TOKEN: 'tok',
    KAKAO_LOCAL_KEY: 'kkey',
    CACHE: kv(),
    RATE: kv(),
    ALLOWED_ORIGINS: ORIGIN,
    ...over,
  }) as never;

const placesBody = { kind: 'keyword', query: '올리브영', x: 126.9327, y: 37.5271, radius: 1500, size: 15 };

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://w.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-token': 'tok', 'cf-connecting-ip': '1.2.3.4', ...headers },
    body: JSON.stringify(body),
  });

/** console.error 를 잠깐 삼킨다 — 일부러 던지는 테스트라 스택이 출력을 덮는다 */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = real;
  }
}

/* C3 — handle() 이 던지면 Workers 가 1101 을 내고 그 응답에는 cors 가 없다.
   브라우저에는 "네트워크 오류"로만 보여서 원인을 응답만으로 알 수 없다 */

test('핸들러가 던져도 503 으로 답한다 — 1101 은 응답 본문이 없어서 진단이 불가능하다', async () => {
  // RATE 바인딩이 없으면 gate 의 rateLimited 가 던진다(실제 바인딩 누락 사고와 같은 모양)
  const res = await quiet(() => worker.fetch(post('/route', {}), env({ RATE: undefined })));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'internal' });
});

test('던진 경우에도 cors 를 붙인다 — 이게 C3 의 전부다', async () => {
  const res = await quiet(() =>
    worker.fetch(post('/route', {}, { origin: ORIGIN }), env({ RATE: undefined })),
  );
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('예외 응답에 스택을 싣지 않는다 — 내부 구조는 wrangler tail 로 본다', async () => {
  const res = await quiet(() => worker.fetch(post('/route', {}), env({ RATE: undefined })));
  const body = await res.text();
  assert.ok(!/at |Error:|\.ts:/.test(body), `본문에 내부 정보가 있다: ${body}`);
});

test('성공 응답에도 cors 가 붙는다 — try/catch 를 끼운 뒤에도 원래 길이 살아 있어야 한다', async () => {
  const res = await worker.fetch(
    new Request('https://w.test/health', { headers: { origin: ORIGIN } }),
    env(),
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('허용목록에 없는 오리진에는 던진 경우에도 헤더를 안 붙인다', async () => {
  const res = await quiet(() =>
    worker.fetch(post('/route', {}, { origin: 'https://evil.test' }), env({ RATE: undefined })),
  );
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

/* I5 — /places 는 TTL 24시간에 캐시 키가 좌표를 11m 로 깎는다. 적중이 예산을 먹으면
   4주 가동의 주 방어선인 캐시가 일일 상한에 대해 방어력 0 이 된다 */

test('/places 캐시 적중은 일일 카운터를 올리지 않는다 — 카카오에 한 푼도 안 나간 요청이다', async () => {
  const e = env() as unknown as { CACHE: ReturnType<typeof kv>; RATE: ReturnType<typeof kv> };
  const parsed = parsePlacesRequest(placesBody)!;
  e.CACHE.store.set(placesCacheKey(parsed), JSON.stringify({ documents: [{ id: 'cached' }] }));

  const res = await worker.fetch(post('/places', placesBody, { origin: ORIGIN }), e as never);
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { documents: { id: string }[] }).documents[0].id, 'cached');
  assert.equal(e.RATE.store.get(dayKey('/places:web', new Date())), undefined, '카운터가 안 올라간다');
});

test('/places 캐시 미스는 카운터를 올린다 — 카운터의 뜻은 실제 카카오 지출이다', async () => {
  const e = env() as unknown as { RATE: ReturnType<typeof kv> };
  // 상한을 이미 채워 두면 상류를 부르기 전에 429 로 끊긴다 — 테스트가 네트워크를 타지 않는다
  e.RATE.store.set(dayKey('/places:web', new Date()), String(PER_DAY['/places:web']));
  const res = await worker.fetch(post('/places', placesBody, { origin: ORIGIN }), e as never);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'daily cap', bucket: '/places:web' });
});

test('/places 는 나쁜 요청을 카운터 전에 거른다 — 카카오에 안 나가는 요청은 예산이 아니다', async () => {
  const e = env() as unknown as { RATE: ReturnType<typeof kv> };
  const res = await worker.fetch(post('/places', { kind: 'nope' }, { origin: ORIGIN }), e as never);
  assert.equal(res.status, 400);
  assert.equal(e.RATE.store.get(dayKey('/places:web', new Date())), undefined);
});

/* I2 — 네이티브 앱은 kakaoRestKey 를 잃고 이 프록시 하나에 매달려 있다 */

test('Origin 이 없으면 네이티브 버킷으로 센다 — 공개 데모가 출시된 앱의 검색을 끄면 안 된다', async () => {
  const e = env() as unknown as { RATE: ReturnType<typeof kv> };
  e.RATE.store.set(dayKey('/places:native', new Date()), String(PER_DAY['/places:native']));
  const res = await worker.fetch(post('/places', placesBody), e as never);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'daily cap', bucket: '/places:native' });
});

test('웹 버킷이 다 차도 네이티브 요청은 통과한다 — 실제 배선에서 확인한다', async () => {
  /* 키를 비워 두면 handlePlaces 가 상류를 부르기 전에 501 을 낸다 — 테스트가
     네트워크를 안 타면서도 '상한을 지나 핸들러까지 갔다'를 429 와 구분해 볼 수 있다 */
  const e = env({ KAKAO_LOCAL_KEY: '' }) as unknown as { RATE: ReturnType<typeof kv> };
  e.RATE.store.set(dayKey('/places:web', new Date()), String(PER_DAY['/places:web'] + 50));

  assert.equal((await worker.fetch(post('/places', placesBody, { origin: ORIGIN }), e as never)).status, 429, '웹은 막혔다');
  assert.equal((await worker.fetch(post('/places', placesBody), e as never)).status, 501, '앱은 상한을 지나 핸들러까지 간다');
});

/* F3 — /places 는 IP 카운터만 쓴다. gate 를 지나는 실제 요청으로 확인한다 */

test('/places 요청은 기기 분당 카운터를 만들지 않는다', async () => {
  const e = env() as unknown as { RATE: ReturnType<typeof kv>; CACHE: ReturnType<typeof kv> };
  const parsed = parsePlacesRequest(placesBody)!;
  e.CACHE.store.set(placesCacheKey(parsed), JSON.stringify({ documents: [] }));
  await worker.fetch(post('/places', placesBody, { 'x-device-id': 'dev-1', origin: ORIGIN }), e as never);

  const keys = [...e.RATE.store.keys()];
  assert.ok(!keys.some(k => k.startsWith('rl:/places:')), `기기 카운터가 생겼다: ${keys}`);
  assert.ok(keys.some(k => k.startsWith('rlip:/places:')), 'IP 카운터는 있어야 한다');
});
