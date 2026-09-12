import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGooglePlace, parseGooglePlaces } from './googlePlaces.ts';

const target = { name: '아오이토리', lat: 37.55, lng: 126.92 };
const gp = (over: Record<string, unknown> = {}) => ({
  displayName: { text: '아오이토리' },
  location: { latitude: 37.55, longitude: 126.92 },
  rating: 4.5,
  userRatingCount: 320,
  ...over,
});

test('이름·좌표가 맞는 후보의 평점을 가져온다', () => {
  const r = parseGooglePlaces({ places: [gp()] }, target, 5);
  assert.equal(r?.rating, 4.5);
  assert.equal(r?.ratingCount, 320);
  assert.equal(r?.matchedName, '아오이토리');
});

test('매칭에 실패하면 null — 엉뚱한 가게 평점을 붙이지 않는다', () => {
  const far = gp({ displayName: { text: '전혀다른가게' }, location: { latitude: 37.60, longitude: 126.99 } });
  assert.equal(parseGooglePlaces({ places: [far] }, target, 5), null);
});

test('평점이 없으면 null', () => {
  assert.equal(parseGooglePlaces({ places: [gp({ rating: undefined })] }, target, 5), null);
  assert.equal(parseGooglePlaces({ places: [gp({ userRatingCount: undefined })] }, target, 5), null);
});

test('응답이 망가지면 null', () => {
  assert.equal(parseGooglePlaces(null, target, 5), null);
  assert.equal(parseGooglePlaces({ places: '배열아님' }, target, 5), null);
  assert.equal(parseGooglePlaces({ places: [] }, target, 5), null);
});

test('오늘 요일의 영업시간을 분으로 바꾼다', () => {
  const withHours = gp({
    regularOpeningHours: {
      periods: [
        { open: { day: 5, hour: 9, minute: 30 }, close: { day: 5, hour: 21, minute: 0 } },
        { open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 18, minute: 0 } },
      ],
    },
  });
  const r = parseGooglePlaces({ places: [withHours] }, target, 5);
  assert.deepEqual(r?.hours, { openMin: 570, closeMin: 1260 });
});

test('오늘 요일 영업시간이 없으면 hours 는 null', () => {
  const withHours = gp({
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } }] },
  });
  assert.equal(parseGooglePlaces({ places: [withHours] }, target, 5)?.hours, null);
});

test('close 가 없으면 24시간 영업으로 본다', () => {
  const always = gp({ regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } });
  assert.deepEqual(parseGooglePlaces({ places: [always] }, target, 0)?.hours, { openMin: 0, closeMin: 1440 });
});

test('FieldMask 와 키 헤더를 보낸다', async () => {
  let init: RequestInit | undefined;
  const f = (async (_u: unknown, i?: RequestInit) => {
    init = i;
    return new Response(JSON.stringify({ places: [gp()] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchGooglePlace(target, 'KEY값', f, 5);
  const h = (init?.headers ?? {}) as Record<string, string>;
  assert.equal(h['X-Goog-Api-Key'], 'KEY값');
  assert.ok(h['X-Goog-FieldMask'].includes('places.rating'));
  assert.equal(init?.method, 'POST');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.textQuery, '아오이토리');
  assert.equal(body.maxResultCount, 3);
  assert.equal(body.languageCode, 'ko');
});

test('4xx·5xx 면 null', async () => {
  // 바디가 비-JSON이면 res.ok 가드 없이도 res.json() 파싱 실패로 우연히 null이 나온다.
  // 쿼터 초과라도 스키마상 유효한 바디(캐시된 이전 결과 등)를 실어 보낼 수 있다는 걸
  // 가정해 검사한다 — 가드가 없으면 이 바디가 그대로 매칭을 통과해 평점이 붙는다.
  const f = (async () => new Response(JSON.stringify({ places: [gp()] }), { status: 429 })) as unknown as typeof fetch;
  assert.equal(await fetchGooglePlace(target, 'k', f, 5), null);
});

test('fetch 가 던져도 null', async () => {
  const f = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await fetchGooglePlace(target, 'k', f, 5), null);
});
