import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBudgetMs, parseEnrichRequest } from './enrichSchema.ts';

const p = (over: Record<string, unknown> = {}) =>
  ({ id: 'k1', name: '아오이토리', address: '서울 마포구 서교동 1', lat: 37.55, lng: 126.92, ...over });

test('정상 요청을 통과시킨다', () => {
  const r = parseEnrichRequest({ places: [p()] });
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].name, '아오이토리');
});

test('places 가 없거나 빈 배열이면 null', () => {
  assert.equal(parseEnrichRequest({}), null);
  assert.equal(parseEnrichRequest({ places: [] }), null);
  assert.equal(parseEnrichRequest(null), null);
  assert.equal(parseEnrichRequest('문자열'), null);
});

test('30개를 넘으면 잘라낸다', () => {
  const many = Array.from({ length: 50 }, (_, i) => p({ id: `k${i}` }));
  assert.equal(parseEnrichRequest({ places: many })?.length, 30);
});

test('한국 바깥 좌표는 버린다', () => {
  const r = parseEnrichRequest({ places: [p(), p({ id: 'k2', lat: 48.8, lng: 2.3 })] });
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].id, 'k1');
});

test('좌표가 숫자가 아니면 버린다', () => {
  assert.equal(parseEnrichRequest({ places: [p({ lat: '37.55' })] }), null);
  assert.equal(parseEnrichRequest({ places: [p({ lng: NaN })] }), null);
});

test('이름이 비면 버린다 — 검색어가 없으면 쓸모가 없다', () => {
  assert.equal(parseEnrichRequest({ places: [p({ name: '   ' })] }), null);
});

test('긴 이름·주소는 자른다', () => {
  const r = parseEnrichRequest({ places: [p({ name: 'ㄱ'.repeat(200), address: 'ㄴ'.repeat(300) })] });
  assert.equal(r?.[0].name.length, 60);
  assert.equal(r?.[0].address.length, 120);
});

test('주소는 없어도 된다', () => {
  const r = parseEnrichRequest({ places: [p({ address: undefined })] });
  assert.equal(r?.[0].address, '');
});

test('id 가 중복이면 처음 것만 남긴다', () => {
  const r = parseEnrichRequest({ places: [p(), p({ name: '다른이름' })] });
  assert.equal(r?.length, 1);
  assert.equal(r?.[0].name, '아오이토리');
});

test('id 가 없으면 버린다', () => {
  assert.equal(parseEnrichRequest({ places: [p({ id: undefined })] }), null);
});

test('id 가 빈 문자열·공백만이면 버린다', () => {
  assert.equal(parseEnrichRequest({ places: [p({ id: '' })] }), null);
  assert.equal(parseEnrichRequest({ places: [p({ id: '  ' })] }), null);
});

test('id·이름·주소의 긴 값은 자른다', () => {
  const r = parseEnrichRequest({ places: [p({ id: 'k'.repeat(100), name: 'ㄱ'.repeat(200), address: 'ㄴ'.repeat(300) })] });
  assert.equal(r?.[0].id.length, 80);
  assert.equal(r?.[0].name.length, 60);
  assert.equal(r?.[0].address.length, 120);
});

test('한국 경계 좌표는 통과시킨다 — 포함 범위', () => {
  // 모든 경계값이 포함(inclusive)이어야 함
  assert(parseEnrichRequest({ places: [p({ lat: 33.0 })] })?.length === 1); // minLat
  assert(parseEnrichRequest({ places: [p({ lat: 38.7 })] })?.length === 1); // maxLat
  assert(parseEnrichRequest({ places: [p({ lng: 124.5 })] })?.length === 1); // minLng
  assert(parseEnrichRequest({ places: [p({ lng: 132.0 })] })?.length === 1); // maxLng
});

test('한국 경계 바깥 좌표는 버린다', () => {
  // 경계값 직전·직후는 거부되어야 함
  assert.equal(parseEnrichRequest({ places: [p({ lat: 32.99 })] }), null); // minLat - 0.01
  assert.equal(parseEnrichRequest({ places: [p({ lat: 38.71 })] }), null); // maxLat + 0.01
  assert.equal(parseEnrichRequest({ places: [p({ lng: 124.49 })] }), null); // minLng - 0.01
  assert.equal(parseEnrichRequest({ places: [p({ lng: 132.01 })] }), null); // maxLng + 0.01
});

test('입력 배열이 100을 넘으면 null을 반환한다 — 쿼터 보호', () => {
  // 검증 없이 수만 개 항목을 반복하면 안 됨
  const huge = Array.from({ length: 101 }, (_, i) => p({ id: `k${i}` }));
  assert.equal(parseEnrichRequest({ places: huge }), null);
});

test('입력 배열이 100 이하면 통과한다', () => {
  const big = Array.from({ length: 100 }, (_, i) => p({ id: `k${i}` }));
  assert.equal(parseEnrichRequest({ places: big })?.length, 30); // 100개 중 30개만 반환
});

test('budgetMs 는 500~8000 으로 자르고, 없으면 기본 8000', () => {
  assert.equal(parseBudgetMs({ places: [] }), 8_000);
  assert.equal(parseBudgetMs({ budgetMs: 3_000 }), 3_000);
  assert.equal(parseBudgetMs({ budgetMs: 10 }), 500);
  assert.equal(parseBudgetMs({ budgetMs: 999_999 }), 8_000);
  assert.equal(parseBudgetMs({ budgetMs: 'soon' }), 8_000);
  assert.equal(parseBudgetMs({ budgetMs: Number.NaN }), 8_000);
  assert.equal(parseBudgetMs(null), 8_000);
});
