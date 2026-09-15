import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey,
  dailyBucket,
  overDailyCap,
  rateLimited,
  routeCacheKey,
  corsHeaders,
  PER_DAY,
  type KVLike,
} from './guard';
import type { RouteRequest } from './routeSchema';

/** 실제 KV처럼 TTL은 무시하고 값만 들고 있는 목 */
function fakeKV(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const kv: KVLike & { store: Map<string, string>; puts: number } = {
    store,
    puts: 0,
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v) {
      store.set(k, v);
      kv.puts += 1;
    },
  };
  return kv;
}

const req = (over: Partial<RouteRequest> = {}): RouteRequest => ({
  points: [
    { lat: 37.5172, lng: 127.0473 },
    { lat: 37.5665, lng: 126.978 },
  ],
  mode: 'car',
  polyline: false,
  ...over,
});

test('일일 키는 KST 기준으로 날짜를 자른다 — UTC로 자르면 카카오 할당량 경계와 어긋난다', () => {
  // 2026-09-14T16:00Z = 2026-09-15T01:00 KST → 이미 다음 날이다
  assert.equal(dayKey('/extract', new Date('2026-09-14T16:00:00Z')), 'day:/extract:2026-09-15');
  // 2026-09-14T14:59Z = 23:59 KST → 아직 같은 날
  assert.equal(dayKey('/extract', new Date('2026-09-14T14:59:00Z')), 'day:/extract:2026-09-14');
});

test('/route는 미래운행 여부로 버킷이 갈린다 — 무료분이 10,000과 5,000으로 다르다', () => {
  assert.equal(dailyBucket('/route', undefined), '/route:now');
  assert.equal(dailyBucket('/route', '202609141830'), '/route:future');
  assert.equal(dailyBucket('/extract', undefined), '/extract');
});

test('상한 이하면 통과하고, 넘는 순간부터 막는다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const cap = PER_DAY['/enrich'];
  const kv = fakeKV({ [dayKey('/enrich', now)]: String(cap - 1) });

  assert.equal(await overDailyCap(kv, '/enrich', now), false, 'cap 번째 호출은 통과');
  assert.equal(await overDailyCap(kv, '/enrich', now), true, 'cap+1 번째부터 막힌다');
});

test('상한이 없는 버킷은 막지 않는다 — 모르는 경로에 임의 상한을 씌우지 않는다', async () => {
  const kv = fakeKV();
  assert.equal(await overDailyCap(kv, '/unknown', new Date()), false);
  assert.equal(kv.puts, 0, '카운터도 만들지 않는다');
});

test('막힌 요청도 카운터는 올린다 — 시도는 시도다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const key = dayKey('/enrich', now);
  const kv = fakeKV({ [key]: String(PER_DAY['/enrich'] + 5) });
  await overDailyCap(kv, '/enrich', now);
  assert.equal(kv.store.get(key), String(PER_DAY['/enrich'] + 6));
});

test('기기당 상한을 넘으면 막는다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const kv = fakeKV();
  let blocked = 0;
  for (let i = 0; i < 12; i += 1) {
    if (await rateLimited(kv, '/extract', 'dev-1', null, now)) blocked += 1;
  }
  assert.equal(blocked, 2, '분당 10회 → 11·12번째가 막힌다');
});

test('기기 id를 매번 바꿔도 IP 상한에 걸린다 — device id는 클라이언트가 정하는 값이다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const kv = fakeKV();
  let blocked = 0;
  for (let i = 0; i < 40; i += 1) {
    // 매 요청마다 새 기기 id → 기기당 상한은 영원히 1회
    if (await rateLimited(kv, '/extract', `dev-${i}`, '1.2.3.4', now)) blocked += 1;
  }
  assert.equal(blocked, 10, 'IP당 30회를 넘는 31~40번째가 막힌다');
});

test('기기 상한에 걸린 요청도 IP 카운터를 올린다 — 안 그러면 IP 상한을 영원히 피한다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const kv = fakeKV();
  for (let i = 0; i < 12; i += 1) await rateLimited(kv, '/extract', 'dev-1', '1.2.3.4', now);
  const minute = Math.floor(now.getTime() / 60000);
  assert.equal(kv.store.get(`rlip:/extract:1.2.3.4:${minute}`), '12');
});

test('IP가 없으면 기기 상한만 본다 — 헤더가 없다고 전부 막지는 않는다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const kv = fakeKV();
  assert.equal(await rateLimited(kv, '/route', 'dev-1', null, now), false);
  const minute = Math.floor(now.getTime() / 60000);
  assert.equal(kv.store.get(`rlip:/route:null:${minute}`), undefined);
});

test('캐시 키는 좌표를 4자리로 깎는다 — 11m 안쪽 흔들림은 같은 경로다', () => {
  const a = routeCacheKey(req());
  const b = routeCacheKey(req({ points: [
    { lat: 37.51720009, lng: 127.04730004 },
    { lat: 37.56650001, lng: 126.97800009 },
  ] }));
  assert.equal(a, b);
});

test('캐시 키는 출발 시각을 10분으로 묶고, 버킷이 다르면 갈라진다', () => {
  assert.equal(
    routeCacheKey(req({ departAt: '202609141831' })),
    routeCacheKey(req({ departAt: '202609141839' })),
  );
  assert.notEqual(
    routeCacheKey(req({ departAt: '202609141839' })),
    routeCacheKey(req({ departAt: '202609141840' })),
  );
});

test('폴리라인 요청은 따로 캐시한다 — 같은 좌표라도 응답 모양이 다르다', () => {
  assert.notEqual(routeCacheKey(req({ polyline: true })), routeCacheKey(req({ polyline: false })));
});

test('경유지 순서가 다르면 다른 경로다', () => {
  const mid1 = { lat: 37.53, lng: 127.0 };
  const mid2 = { lat: 37.54, lng: 127.01 };
  const base = req().points;
  assert.notEqual(
    routeCacheKey(req({ points: [base[0], mid1, mid2, base[1]] })),
    routeCacheKey(req({ points: [base[0], mid2, mid1, base[1]] })),
  );
});

/* CORS — 웹 데모에서만 필요하고, 네이티브에는 영향이 없어야 한다 */

test('Origin 이 없으면 헤더를 안 붙인다 — 네이티브 앱은 CORS 자체가 없다', () => {
  assert.deepEqual(corsHeaders(null, 'https://demo.test'), {});
});

test('허용 목록에 있는 오리진만 통과한다', () => {
  const h = corsHeaders('https://demo.test', 'https://demo.test,http://localhost:8080');
  assert.equal(h['access-control-allow-origin'], 'https://demo.test');
  assert.equal(h.vary, 'Origin', '오리진마다 응답이 다르므로 캐시가 섞이면 안 된다');
});

test('목록에 없는 오리진에는 헤더를 안 붙인다 — 브라우저가 알아서 막는다', () => {
  assert.deepEqual(corsHeaders('https://evil.test', 'https://demo.test'), {});
});

test('허용 목록이 비어 있으면 아무도 통과하지 못한다 — 기본값이 열림이면 안 된다', () => {
  assert.deepEqual(corsHeaders('https://demo.test', undefined), {});
  assert.deepEqual(corsHeaders('https://demo.test', ''), {});
});

test('목록의 공백은 무시한다 — wrangler.toml 에 사람이 쓰는 값이다', () => {
  const h = corsHeaders('http://localhost:8080', ' https://demo.test , http://localhost:8080 ');
  assert.equal(h['access-control-allow-origin'], 'http://localhost:8080');
});

test('preflight 에 필요한 헤더를 전부 허용한다 — 하나라도 빠지면 브라우저가 막는다', () => {
  const h = corsHeaders('https://demo.test', 'https://demo.test');
  const allowed = h['access-control-allow-headers'].split(',');
  for (const need of ['content-type', 'x-app-token', 'x-device-id']) {
    assert.ok(allowed.includes(need), `${need} 가 빠졌다`);
  }
  assert.ok(h['access-control-allow-methods'].includes('OPTIONS'));
});

test('transitCacheKey — 좌표 4자리, 출발 10분 버킷, 옵션·공급자 포함', async () => {
  const { transitCacheKey } = await import('./guard');
  const base = { origin: { lat: 37.52459, lng: 126.86069 }, destination: { lat: 37.52947, lng: 126.91869 }, alternatives: 3, subwayOnly: false };
  const k1 = transitCacheKey({ ...base, departAt: '2026-09-16T00:33:00.000Z' }, 'google');
  const k2 = transitCacheKey({ ...base, departAt: '2026-09-16T00:39:00.000Z' }, 'google');
  const k3 = transitCacheKey({ ...base, departAt: '2026-09-16T00:41:00.000Z' }, 'google');
  assert.equal(k1, 'transit:google:37.5246,126.8607;37.5295,126.9187:2026-09-16T00:3:n');
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.notEqual(transitCacheKey(base, 'google'), k1); // now 버킷
  assert.notEqual(transitCacheKey({ ...base, subwayOnly: true }, 'google'), transitCacheKey(base, 'google'));
  assert.notEqual(transitCacheKey(base, 'tmap'), transitCacheKey(base, 'google'));
});
