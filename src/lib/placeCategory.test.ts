import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kakaoCategoryFor } from './placeCategory.ts';

test('은행 — 브랜드까지 BK9', () => {
  for (const q of ['은행', '국민은행', 'KB국민은행', '신한은행', '우리은행', '하나은행', '농협은행', '기업은행', '새마을금고', 'ATM', 'atm']) {
    assert.equal(kakaoCategoryFor(q), 'BK9', q);
  }
});

test('편의점 — CS2', () => {
  for (const q of ['편의점', 'CU', 'GS25', '세븐일레븐', '이마트24']) {
    assert.equal(kakaoCategoryFor(q), 'CS2', q);
  }
});

test('이마트24 는 편의점, 이마트는 대형마트 — 긴 쪽이 먼저 걸린다', () => {
  assert.equal(kakaoCategoryFor('이마트24'), 'CS2');
  assert.equal(kakaoCategoryFor('이마트'), 'MT1');
});

test('카페·약국·주유소·마트·병원·주차장', () => {
  assert.equal(kakaoCategoryFor('카페'), 'CE7');
  assert.equal(kakaoCategoryFor('스타벅스'), 'CE7');
  assert.equal(kakaoCategoryFor('약국'), 'PM9');
  assert.equal(kakaoCategoryFor('주유소'), 'OL7');
  assert.equal(kakaoCategoryFor('홈플러스'), 'MT1');
  assert.equal(kakaoCategoryFor('치과'), 'HP8');
  assert.equal(kakaoCategoryFor('주차장'), 'PK6');
});

test('브랜드·미지 업종은 null — 코드를 찍으면 0건이 된다', () => {
  // 올리브영은 카카오에 업종 코드가 없다(실측: category_group_code 빈 값)
  for (const q of ['올리브영', '다이소', '무신사 스탠다드', '현대카드빌딩 2관', '', '   ']) {
    assert.equal(kakaoCategoryFor(q), null, q);
  }
});

test('공백·대소문자에 흔들리지 않는다', () => {
  assert.equal(kakaoCategoryFor(' 국민 은행 '), 'BK9');
  assert.equal(kakaoCategoryFor('Gs25'), 'CS2');
});
