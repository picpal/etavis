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

test('수정 라운드 1 — 리뷰 지적 4건(실측 확인)', () => {
  // FINDING 1: 농협하나로마트는 실측 전부 MT1, 농협은행은 그대로 BK9
  assert.equal(kakaoCategoryFor('농협하나로마트'), 'MT1');
  assert.equal(kakaoCategoryFor('농협은행'), 'BK9');
  // FINDING 2: "전기차충전소"는 실측 category_group_code가 빈 값 — OL7 찍으면 0건
  assert.equal(kakaoCategoryFor('전기차충전소'), null);
  // FINDING 3: "국회의원회관"은 실측 주차장·정치단체 사무실만 나오고 HP8은 없다
  assert.equal(kakaoCategoryFor('국회의원회관'), null);
  // FINDING 4: "팜"은 실측 문구점·IT·건강식품이 걸리고, "팜약국"만 PM9
  assert.equal(kakaoCategoryFor('팜'), null);
  assert.equal(kakaoCategoryFor('팜약국'), 'PM9');
});

test('수정 라운드 1 — 자체 감사에서 찾은 동형 충돌(실측 확인)', () => {
  // 농협뿐 아니라 신협·수협·새마을금고도 전부 자기 이름을 건 주유소를 운영한다.
  // BK9 쪽 패턴을 낱개로 좁히지 않고 MT1·OL7을 BK9보다 앞에 둬서 한 번에 막는다.
  assert.equal(kakaoCategoryFor('농협주유소'), 'OL7');
  assert.equal(kakaoCategoryFor('신협주유소'), 'OL7');
  assert.equal(kakaoCategoryFor('수협주유소'), 'OL7');
  assert.equal(kakaoCategoryFor('새마을금고주유소'), 'OL7');
  // "은행나무"는 관광명소(실측 AT4/빈 값)이지 은행이 아니다 — 은행 뒤에 "나무"가
  // 오면 걸지 않는다. 파생어인 "은행나무주유소"(실측 OL7)도 함께 확인한다.
  assert.equal(kakaoCategoryFor('은행나무'), null);
  assert.equal(kakaoCategoryFor('은행나무주유소'), 'OL7');
  // 그냥 "atm"은 영단어 부분 문자열도 집는다 — "atmosphere"는 실측 카페(CE7)이지
  // ATM이 아니다. 단어 경계(\b)를 걸어 막는다. 정상적인 단독 ATM/atm 표기는
  // 위 '은행' 테스트에서 이미 확인했다.
  assert.equal(kakaoCategoryFor('atmosphere'), null);
});
