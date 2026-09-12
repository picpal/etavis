import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnrichRequest } from './enrichSchema.ts';

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
