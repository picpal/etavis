import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPlace, normalizeName } from './placeMatch.ts';

// 위도 37.55 에서 경도 0.001도 ≈ 88m, 위도 0.001도 ≈ 111m
const at = (name: string, dLat = 0, dLng = 0) => ({ name, lat: 37.55 + dLat, lng: 126.92 + dLng });

test('정규화는 공백·특수문자·지점 접미사를 떼고 소문자로', () => {
  assert.equal(normalizeName('파리바게트 홍대점'), '파리바게트홍대');
  assert.equal(normalizeName('PARIS BAGUETTE 홍대'), 'parisbaguette홍대');
  assert.equal(normalizeName('베이글랜드(홍대)'), '베이글랜드홍대');
  assert.equal(normalizeName('쿠리노키 제빵 본점'), '쿠리노키제빵');
});

test('정규화 이름이 같으면 채택한다', () => {
  const i = matchPlace(at('파리바게트 홍대점'), [at('스타벅스 홍대'), at('파리바게트 홍대')]);
  assert.equal(i, 1);
});

test('접두 일치 4자 이상이면 채택한다', () => {
  const i = matchPlace(at('베이글랜드홍대'), [at('베이글랜드홍대입구역점')]);
  assert.equal(i, 0);
});

test('접두가 안 맞으면 채택하지 않는다 — 우연한 겹침을 막는다', () => {
  // 60m 밖에 두어 '가까운 게 하나뿐' 규칙이 끼어들지 않게 한다(≈89m)
  const i = matchPlace(at('김밥천국'), [at('김밥나라', 0.0008)]);
  assert.equal(i, null);
});

test('150m 를 넘으면 이름이 같아도 탈락한다', () => {
  const i = matchPlace(at('아오이토리'), [at('아오이토리', 0.002)]); // ≈222m
  assert.equal(i, null);
});

test('이름이 안 맞아도 60m 안에 후보가 정확히 하나면 채택한다', () => {
  const i = matchPlace(at('쿠리노키제빵'), [at('Kurinoki Bakery', 0.0004)]); // ≈44m
  assert.equal(i, 0);
});

test('60m 안에 둘이면 고르지 않는다', () => {
  const i = matchPlace(at('카페'), [at('A', 0.0002), at('B', 0.0003)]);
  assert.equal(i, null);
});

test('후보가 비면 null', () => {
  assert.equal(matchPlace(at('아무개'), []), null);
});

test('이름 일치가 거리 근접보다 우선한다', () => {
  // 0번은 아주 가깝지만 이름이 다르고, 1번은 조금 멀지만 이름이 같다
  const i = matchPlace(at('아오이토리'), [at('다른가게', 0.0001), at('아오이토리', 0.0009)]);
  assert.equal(i, 1);
});
