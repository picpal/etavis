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
  PER_MIN_IP,
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

test('상한을 넘은 뒤에는 카운터를 더 올리지 않는다 — 막느라 쓰는 KV 쓰기가 예산을 태운다', async () => {
  /* 예전엔 "시도는 시도다"로 막힌 요청도 셌다. 무료 플랜의 KV 쓰기가 일 1,000회라
     그렇게 두면 상한에 닿은 뒤의 요청이 계정의 쓰기를 태우고, 그 순간 모든
     엔드포인트의 카운터가 같이 죽는다(= 상한이 사라진다) */
  const now = new Date('2026-09-14T03:00:00Z');
  const key = dayKey('/enrich', now);
  const kv = fakeKV({ [key]: String(PER_DAY['/enrich'] + 5) });
  assert.equal(await overDailyCap(kv, '/enrich', now), true);
  assert.equal(kv.store.get(key), String(PER_DAY['/enrich'] + 5), '값이 그대로다');
  assert.equal(kv.puts, 0, '쓰기도 없다');
});

test('카운터는 cap 에서 멈춘다 — 하루 쓰기 총량이 cap 을 넘지 않는다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const cap = PER_DAY['/transit'];
  const kv = fakeKV({ [dayKey('/transit', now)]: String(cap - 2) });
  for (let i = 0; i < 5; i += 1) await overDailyCap(kv, '/transit', now);
  assert.equal(kv.store.get(dayKey('/transit', now)), String(cap), 'cap 에서 멈춘다');
  assert.equal(kv.puts, 2, '통과한 2건만 쓴다');
});

test('분당 카운터도 상한에서 멈춘다 — 폭주하는 쪽이 KV 를 태우면 문지기가 먼저 죽는다', async () => {
  const now = new Date('2026-09-14T03:00:00Z');
  const kv = fakeKV();
  for (let i = 0; i < 20; i += 1) await rateLimited(kv, '/extract', 'dev-1', null, now);
  const minute = Math.floor(now.getTime() / 60000);
  assert.equal(kv.store.get(`rl:/extract:dev-1:${minute}`), '10', 'PER_MIN 에서 멈춘다');
  assert.equal(kv.puts, 10, '20회를 받아도 쓰기는 10회');
});

/* F3 — /places 는 계획 한 건에 최대 300 요청이 나간다. 분당 카운터의 KV 쓰기가
   그대로 예산이라 막아 주는 게 없는 쪽을 뺀다 */

test('/places 는 기기 카운터를 만들지 않는다 — device id 는 클라이언트가 정하는 값이라 막는 게 없다', async () => {
  const now = new Date('2026-09-17T03:00:00Z');
  const kv = fakeKV();
  await rateLimited(kv, '/places', 'dev-1', '1.2.3.4', now);
  const minute = Math.floor(now.getTime() / 60000);
  assert.equal(kv.store.get(`rl:/places:dev-1:${minute}`), undefined, '기기 카운터 없음');
  assert.equal(kv.store.get(`rlip:/places:1.2.3.4:${minute}`), '1', 'IP 카운터만 센다');
  assert.equal(kv.puts, 1, '요청당 쓰기 1회 — 예전엔 2회였다');
});

test('/places 도 IP 상한은 그대로 건다', async () => {
  const now = new Date('2026-09-17T03:00:00Z');
  const kv = fakeKV();
  let blocked = 0;
  for (let i = 0; i < PER_MIN_IP['/places'] + 5; i += 1) {
    if (await rateLimited(kv, '/places', `dev-${i}`, '1.2.3.4', now)) blocked += 1;
  }
  assert.equal(blocked, 5, 'IP당 900회를 넘는 5건이 막힌다');
});

test('IP 헤더가 없으면 /places 도 기기 카운터로 돌아간다 — 분당 상한이 통째로 사라지면 안 된다', async () => {
  const now = new Date('2026-09-17T03:00:00Z');
  const kv = fakeKV();
  await rateLimited(kv, '/places', 'dev-1', null, now);
  const minute = Math.floor(now.getTime() / 60000);
  assert.equal(kv.store.get(`rl:/places:dev-1:${minute}`), '1');
});

/* I2 — 네이티브 앱은 kakaoRestKey 를 잃고 이 프록시 하나에 매달려 있다.
   공개 데모를 두들기는 누군가가 출시된 앱의 장소 검색을 같이 끄면 안 된다 */

test('/places 는 Origin 유무로 웹·네이티브 버킷이 갈린다 — 브라우저만 Origin 을 붙인다', () => {
  assert.equal(dailyBucket('/places', undefined, 'https://etavia-demo.pages.dev'), '/places:web');
  assert.equal(dailyBucket('/places', undefined, null), '/places:native');
  assert.equal(dailyBucket('/places', undefined, undefined), '/places:native');
  assert.equal(dailyBucket('/places', undefined, ''), '/places:native', '빈 문자열은 Origin 이 아니다');
});

test('새 /places 버킷에 상한이 실제로 걸린다 — 버킷만 나누고 PER_DAY 를 빠뜨리면 무제한이 된다', async () => {
  const now = new Date('2026-09-17T03:00:00Z');
  for (const bucket of ['/places:web', '/places:native']) {
    const cap = PER_DAY[bucket];
    assert.ok(typeof cap === 'number' && cap > 0, `${bucket} 에 상한이 없다`);
    const kv = fakeKV({ [dayKey(bucket, now)]: String(cap - 1) });
    assert.equal(await overDailyCap(kv, bucket, now), false, `${bucket}: cap 번째는 통과`);
    assert.equal(await overDailyCap(kv, bucket, now), true, `${bucket}: cap+1 부터 막힌다`);
  }
});

test('웹을 다 써도 네이티브 몫은 남는다 — 이 분리가 I2 의 전부다', async () => {
  const now = new Date('2026-09-17T03:00:00Z');
  const kv = fakeKV({ [dayKey('/places:web', now)]: String(PER_DAY['/places:web'] + 100) });
  assert.equal(await overDailyCap(kv, '/places:web', now), true, '웹은 막혔다');
  assert.equal(await overDailyCap(kv, '/places:native', now), false, '앱은 그대로 돈다');
});

test('dailyBucket 이 만드는 버킷은 전부 PER_DAY 에 있다 — overDailyCap 은 cap 이 없으면 무조건 통과시킨다', () => {
  const made = [
    dailyBucket('/route', undefined),
    dailyBucket('/route', '202609141830'),
    dailyBucket('/places', undefined, 'https://demo.test'),
    dailyBucket('/places', undefined, null),
    dailyBucket('/extract'),
    dailyBucket('/enrich'),
    dailyBucket('/transit'),
  ];
  for (const b of made) {
    assert.ok(PER_DAY[b] !== undefined, `${b} 에 상한이 없다 — 이 엔드포인트가 상한 없이 열린다`);
  }
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
  const base = { origin: { lat: 37.52459, lng: 126.86069 }, destination: { lat: 37.52947, lng: 126.91869 }, alternatives: 3, preferSubway: false };
  const k1 = transitCacheKey({ ...base, departAt: '2026-09-16T00:33:00.000Z' }, 'google');
  const k2 = transitCacheKey({ ...base, departAt: '2026-09-16T00:39:00.000Z' }, 'google');
  const k3 = transitCacheKey({ ...base, departAt: '2026-09-16T00:41:00.000Z' }, 'google');
  assert.equal(k1, 'transit:google:37.5246,126.8607;37.5295,126.9187:2026-09-16T00:3:n');
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
  assert.notEqual(transitCacheKey(base, 'google'), k1); // now 버킷
  assert.notEqual(transitCacheKey({ ...base, preferSubway: true }, 'google'), transitCacheKey(base, 'google'));
  assert.notEqual(transitCacheKey(base, 'tmap'), transitCacheKey(base, 'google'));
});


/* ── KV 쓰기가 죽어도 앱은 살아 있어야 한다 ─────────────────────────────────
   2026-09-19 프로덕션 실측: 무료 플랜의 KV 하루 쓰기 한도(1,000회)를 다 쓰자
   가드의 카운터 쓰기가 던졌고, `index.ts` 의 포괄 catch 가 그걸 503 으로 바꿨다.
   `/places` 도 `/route` 도 전부 죽었다 — **앱이 통째로 먹통이었다.**

     (error) [kv.put failed] site=guard:rl:ip:/places mode=required
             err=Error: KV put() limit exceeded for the day.
     (error) [fetch] unhandled Error: KV put() limit exceeded for the day.

   던져서 얻는 게 없다. 쓰기가 막힌 순간 카운터는 어차피 못 올라가므로 상한은
   이미 작동을 멈춘 것이고, 던지는 선택은 "상한 없음"을 "서비스 없음"으로 바꿀 뿐이다.
   **막는 쪽이 아니라 통과시키는 쪽으로 넘어진다.** 잃는 것은 아래 주석에 적었다. */
function throwingKV(seed: Record<string, string> = {}, err = 'KV put() limit exceeded for the day.') {
  const store = new Map<string, string>(Object.entries(seed));
  const kv: KVLike & { attempted: number } = {
    attempted: 0,
    async get(k) { return store.get(k) ?? null; },
    async put() { kv.attempted += 1; throw new Error(err); },
  };
  return kv;
}

test('분당 카운터를 못 써도 요청을 막지 않는다 — 쓰기 한도가 앱 전체를 죽이면 안 된다', async () => {
  const kv = throwingKV();
  const blocked = await rateLimited(kv, '/places', 'dev-1', '1.2.3.4', new Date('2026-09-19T09:46:00Z'));
  assert.equal(blocked, false, '던지지도, 막지도 않는다');
  assert.ok(kv.attempted > 0, '전제: 쓰기를 실제로 시도했다');
});

test('하루 상한 카운터를 못 써도 요청을 막지 않는다', async () => {
  const kv = throwingKV();
  const over = await overDailyCap(kv, '/places:native', new Date('2026-09-19T09:46:00Z'));
  assert.equal(over, false);
});

/* 쓰기가 죽어도 **이미 적혀 있는 값은 그대로 읽힌다.** 상한에 이미 닿아 있었다면
   그 판정은 살아 있다 — 잃는 건 "여기서부터 더 세는 것"뿐이다 */
test('쓰기가 죽어도 이미 상한에 닿아 있으면 여전히 막는다 — 읽기는 살아 있다', async () => {
  const now = new Date('2026-09-19T09:46:00Z');
  const cap = PER_DAY['/places:native'];
  assert.ok(cap !== undefined, '전제: 이 버킷에 상한이 있다');
  const kv = throwingKV({ [dayKey('/places:native', now)]: String(cap) });
  assert.equal(await overDailyCap(kv, '/places:native', now), true);
});

test('분당 상한도 이미 닿아 있으면 쓰기 없이 막는다', async () => {
  const now = new Date('2026-09-19T09:46:00Z');
  const minute = Math.floor(now.getTime() / 60000);
  const cap = PER_MIN_IP['/places'] ?? 30;
  const kv = throwingKV({ [`rlip:/places:1.2.3.4:${minute}`]: String(cap) });
  assert.equal(await rateLimited(kv, '/places', 'dev-1', '1.2.3.4', now), true);
  assert.equal(kv.attempted, 0, '상한에 닿은 카운터에는 쓰지 않는다');
});
