import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepByCategoryName, planSearch } from './placeQuery.ts';

test("'동네 X' 는 검색어가 아니라 접두사다 — X 를 찾고 프랜차이즈를 뺀다", () => {
  // 실측 2026-09-15: "동네 빵집" 질의는 카카오에서 0건이다. 가게 이름이 그렇지 않으니까
  const p = planSearch('동네 빵집');
  assert.equal(p.query, '빵집');
  assert.ok(p.pathAny.includes('제과,베이커리'));
  assert.equal(p.localOnly, true);
});

test("표에 없는 업종이어도 '동네' 접두사는 떼어낸다 — 0건보다 낫다", () => {
  const p = planSearch('동네 반찬가게');
  assert.equal(p.query, '반찬가게');
  assert.deepEqual(p.pathAny, [], '모르는 업종은 안 거른다');
  assert.equal(p.localOnly, true);
});

test('대형마트 — 실측상 1건뿐인 질의를 마트 검색 + 경로 조건으로 옮긴다', () => {
  const p = planSearch('대형마트');
  assert.equal(p.query, '마트');
  assert.deepEqual(p.pathAny, ['대형슈퍼', '대형마트']);
});

test('동네 마트 — 슈퍼마켓이되 대형슈퍼는 뺀다', () => {
  const p = planSearch('동네 마트');
  assert.equal(p.query, '마트');
  assert.deepEqual(p.pathAny, ['슈퍼마켓']);
  assert.deepEqual(p.pathNot, ['대형슈퍼']);
});

test('모르는 질의는 아무것도 안 거른다 — null 이 0건보다 낫다', () => {
  const p = planSearch('올리브영');
  assert.equal(p.query, '올리브영');
  assert.deepEqual(p.pathAny, []);
  assert.equal(p.localOnly, false);
});

test('이마트24 는 편의점이다 — 마트 규칙에 먼저 걸리면 안 된다', () => {
  // "가정,생활 > 편의점 > 이마트24" 라서, 마트 규칙(슈퍼마켓)에 걸리면 전멸한다
  const p = planSearch('이마트24');
  assert.ok(p.pathAny.includes('편의점'));
  assert.ok(keepByCategoryName('가정,생활 > 편의점 > 이마트24', p));
});

test('마트 — 동네 마트는 살리고 주방가구·휴대폰판매는 버린다', () => {
  const p = planSearch('마트');
  const keep = (c: string) => keepByCategoryName(c, p);
  assert.ok(keep('가정,생활 > 슈퍼마켓'), '홈마트·우리마트 (그룹 코드 없음)');
  assert.ok(keep('가정,생활 > 슈퍼마켓 > 대형슈퍼 > 하나로마트'));
  assert.ok(keep('가정,생활 > 대형마트 > 이마트'));
  assert.ok(!keep('가정,생활 > 생활용품점 > 주방용품 > 주방가구,싱크대판매'));
  assert.ok(!keep('가정,생활 > 전자제품 > 전자제품판매 > 휴대폰판매'));
});

test('동네 빵집 — 프랜차이즈만 뺀다. 작은 체인은 동네에 가깝다', () => {
  const p = planSearch('동네 빵집');
  const keep = (c: string) => keepByCategoryName(c, p);
  assert.ok(keep('음식점 > 간식 > 제과,베이커리'), '이름 없는 동네 빵집');
  assert.ok(!keep('음식점 > 간식 > 제과,베이커리 > 파리바게뜨'));
  assert.ok(!keep('음식점 > 간식 > 제과,베이커리 > 뚜레쥬르'));
  assert.ok(!keep('음식점 > 간식 > 제과,베이커리 > 와플대학'));
  // 실측: 김영모과자점·하르당은 지점이 몇 안 되는 작은 체인이다. 일부러 목록에 안 넣는다
  assert.ok(keep('음식점 > 간식 > 제과,베이커리 > 김영모과자점'));
});

test('동네 카페 — 브랜드 깊이가 제각각이라 구조가 아니라 이름으로 뺀다', () => {
  const p = planSearch('동네 카페');
  const keep = (c: string) => keepByCategoryName(c, p);
  assert.ok(keep('음식점 > 카페'));
  assert.ok(keep('음식점 > 카페 > 커피전문점'), '이름 없는 커피전문점은 동네다');
  assert.ok(keep('음식점 > 카페 > 테마카페 > 디저트카페'), '마지막 조각이 브랜드가 아니다');
  assert.ok(!keep('음식점 > 카페 > 커피전문점 > 스타벅스'));
  assert.ok(!keep('음식점 > 카페 > 테마카페 > 디저트카페 > 백미당'), '브랜드가 5단계에 있다');
});

test('category_name 이 없으면 통과시킨다 — 거를 근거가 없다', () => {
  const p = planSearch('마트');
  assert.ok(keepByCategoryName(undefined, p));
  assert.ok(keepByCategoryName('', p));
});

test('빵집 — FD6 그룹 코드는 없고 경로 조건만 붙는다', () => {
  const p = planSearch('빵집');
  assert.equal(p.query, '빵집');
  assert.deepEqual(p.pathAny, ['제과,베이커리']);
  assert.equal(p.localOnly, false, '좁히지 않은 빵집은 프랜차이즈도 후보다');
});

test('그룹 코드는 새 검색어로 정한다 — 접두사를 뗀 뒤에 본다', () => {
  assert.equal(planSearch('동네 카페').categoryCode, 'CE7');
  // kakaoCategoryFor('마트')는 일부러 null이다(placeCategory.ts의 정규식이
  // '대형마트|이마트|...'만 매칭하고 '마트' 단독은 안 잡는다). 그래서 대형마트 행에
  // code: 'MT1'을 직접 박아둔다 — 검색어가 '마트'로 바뀐 뒤 kakaoCategoryFor에
  // 기대는 게 아니라, 행 자체가 코드를 들고 있어서 나오는 값이다.
  assert.equal(planSearch('대형마트').categoryCode, 'MT1');
});

test('동네 마트 — 대형슈퍼를 거르는 건 pathNot 뿐이다', () => {
  const p = planSearch('동네 마트');
  assert.ok(keepByCategoryName('가정,생활 > 슈퍼마켓', p), '홈마트·우리마트');
  // pathAny 는 '슈퍼마켓' 으로 이 줄을 통과시킨다. 막는 건 pathNot 한 줄이다
  assert.ok(!keepByCategoryName('가정,생활 > 슈퍼마켓 > 대형슈퍼 > 하나로마트', p));
});

test('좁히지 않은 질의는 프랜차이즈도 후보다 — localOnly 가드', () => {
  assert.ok(keepByCategoryName('음식점 > 간식 > 제과,베이커리 > 파리바게뜨', planSearch('빵집')));
  assert.ok(keepByCategoryName('음식점 > 카페 > 커피전문점 > 스타벅스', planSearch('카페')));
});

test('업종어는 질의 끝에 온다 — 스마트폰이 마트에 걸리면 0건이다', () => {
  const p = planSearch('스마트폰');
  assert.deepEqual(p.pathAny, []);
  assert.ok(keepByCategoryName('가정,생활 > 전자제품 > 전자제품판매 > 휴대폰판매', p));
  assert.deepEqual(planSearch('하나로마트').pathAny, ['슈퍼마켓', '대형마트'], '끝에 오면 걸린다');
});

test('붕어빵은 빵집이 아니다 — 모르면 안 거른다', () => {
  const p = planSearch('붕어빵');
  assert.equal(p.query, '붕어빵');
  assert.deepEqual(p.pathAny, []);
});

test("'작은도서관'은 시설 유형명이다 — 접두사는 공백이 있을 때만 뗀다", () => {
  const p = planSearch('작은도서관');
  assert.equal(p.query, '작은도서관');
  assert.equal(p.localOnly, false);
});

test('접두사만 남으면 원래 질의를 쓴다 — 빈 검색어는 카카오 400 이다', () => {
  const p = planSearch('동네');
  assert.equal(p.query, '동네');
  assert.equal(p.localOnly, false);
});
