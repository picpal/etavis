import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersQuery, expandQueries, isVerifiedCategory, keepByCategoryName, keepPlace, planSearch } from './placeQuery.ts';

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

test('프랜차이즈가 category_name 에 안 실릴 때가 있다 — 이름도 본다', () => {
  const p = planSearch('동네 빵집');
  // 실측 2026-09-15: '파리바게트 신트리점' 은 '음식점 > 간식 > 제과,베이커리' 로만 온다.
  // 같은 브랜드의 신정역점은 '… > 파리바게뜨' 로 온다 — 카카오가 일관되지 않다
  assert.ok(keepByCategoryName('음식점 > 간식 > 제과,베이커리', p), '경로만 보면 못 거른다');
  assert.ok(!keepPlace('파리바게트 신트리점', '음식점 > 간식 > 제과,베이커리', p));
  assert.ok(!keepPlace('파리바게뜨 여의도점', '음식점 > 간식 > 제과,베이커리 > 파리바게뜨', p));
  assert.ok(keepPlace('폴앤폴리나 여의도점', '음식점 > 간식 > 제과,베이커리', p));
  // 하르당은 지점이 몇 안 되는 작은 체인이라 일부러 FRANCHISE 에 없다
  assert.ok(keepPlace('하르당 목동역점', '음식점 > 간식 > 제과,베이커리', p));
});

test('좁히지 않았으면 이름으로도 안 거른다', () => {
  const p = planSearch('빵집');
  assert.ok(keepPlace('파리바게뜨 여의도점', '음식점 > 간식 > 제과,베이커리 > 파리바게뜨', p));
  assert.ok(keepPlace('스타벅스 여의도점', '음식점 > 카페 > 커피전문점 > 스타벅스', planSearch('카페')));
});

test("'스마트'도 마트가 아니다 — 끝 앵커만으로는 안 걸러진다", () => {
  assert.deepEqual(planSearch('스마트').pathAny, [], '휴대폰 가게가 0건이 된다');
  assert.deepEqual(planSearch('스마트폰').pathAny, []);
  assert.deepEqual(planSearch('이마트').pathAny, ['슈퍼마켓', '대형마트'], '앞 글자가 스가 아니면 걸린다');
  assert.deepEqual(planSearch('마트').pathAny, ['슈퍼마켓', '대형마트']);
  assert.deepEqual(planSearch('슈퍼마켓').pathAny, ['슈퍼마켓', '대형마트']);
});

test('베이커리카페는 빵집이 아니라 카페다', () => {
  const p = planSearch('베이커리카페');
  assert.equal(p.query, '베이커리카페', "'빵집'으로 바꾸면 사용자의 말을 버린다");
  assert.deepEqual(p.pathAny, ['카페']);
  // 실측: 카페로 분류된 빵집이 있다 — 음식점 > 카페 > 테마카페 > 디저트카페
  assert.ok(keepByCategoryName('음식점 > 카페 > 테마카페 > 디저트카페', p));
});

test('세탁소 한 조건이 빨래방까지 덮는다', () => {
  // 실측 2026-09-15: '빨래방'·'코인빨래방' 질의는 15/15가 '가정,생활 > 세탁소 > 셀프빨래방 > …'
  const p = planSearch('코인빨래방');
  assert.ok(keepByCategoryName('가정,생활 > 세탁소 > 셀프빨래방 > 크린토피아 코인워시', p));
  assert.ok(keepByCategoryName('가정,생활 > 세탁소', p));
});

test('약국 한 조건이 한약국까지 덮는다', () => {
  // 실측: '의료,건강 > 약국' 14건, '의료,건강 > 한약국,한약방' 1건 — 둘 다 '약국'을 포함한다
  const p = planSearch('약국');
  assert.ok(keepByCategoryName('의료,건강 > 약국', p));
  assert.ok(keepByCategoryName('의료,건강 > 한약국,한약방', p));
});

test('expandQueries — 구가 아는 업종어로 끝나면 업종어를 후보로 덧붙인다', () => {
  assert.deepEqual(expandQueries(['샌드위치 파는 카페']), ['샌드위치 파는 카페', '카페']);
  assert.deepEqual(expandQueries(['조용한 카페']), ['조용한 카페', '카페']);
  assert.deepEqual(expandQueries(['주차 되는 마트']), ['주차 되는 마트', '마트']);
});

test('expandQueries — 브랜드를 업종어로 뭉개지 않는다', () => {
  // '메가커피'는 카페 행에 걸리지만 '카페'라는 글자를 품지 않는다.
  // 여기서 '카페'를 붙이면 브랜드 검색이 0건일 때 엉뚱한 카페로 조용히 갈아탄다.
  assert.deepEqual(expandQueries(['메가커피']), ['메가커피']);
  assert.deepEqual(expandQueries(['이디야커피']), ['이디야커피']);
});

test('expandQueries — 이미 업종어면 그대로 둔다', () => {
  assert.deepEqual(expandQueries(['카페']), ['카페']);
  assert.deepEqual(expandQueries(['편의점']), ['편의점']);
});

test('expandQueries — 아는 업종어가 없으면 손대지 않는다', () => {
  assert.deepEqual(expandQueries(['샌드위치 파는 곳']), ['샌드위치 파는 곳']);
});

test('expandQueries — 중복을 만들지 않고 순서를 지킨다', () => {
  assert.deepEqual(
    expandQueries(['샌드위치 파는 카페', '카페']),
    ['샌드위치 파는 카페', '카페'],
  );
});

test('expandQueries — 의도된 좁히기(동네·작은·소형)는 넓히지 않는다', () => {
  // '동네'는 사용자가 알고 붙인 배제다. 0건일 때 '카페'로 넓히면
  // 방금 빼 달라고 한 프랜차이즈가 그대로 나온다.
  assert.deepEqual(expandQueries(['동네 카페']), ['동네 카페']);
  assert.deepEqual(expandQueries(['작은 서점']), ['작은 서점']);
});

test('expandQueries — 복합명사는 업종어로 넓히지 않는다(끝 단어 경계)', () => {
  // '스터디카페'는 '카페'를 글자로 품지만(includes) 공백으로 갈라지지 않는다
  // (endsWith(' 카페')는 거짓). 여기서 넓히면 스터디카페가 0건일 때 폴백이
  // 조용히 일반 카페로 갈아탄다 — 일하러 가려던 사람이 일 못 하는 데로 간다.
  assert.deepEqual(expandQueries(['스터디카페']), ['스터디카페']);
  assert.deepEqual(expandQueries(['한약국']), ['한약국']);
  assert.deepEqual(expandQueries(['중고서점']), ['중고서점']);
  assert.deepEqual(expandQueries(['키즈카페']), ['키즈카페']);
});

/* ── 이 장소가 질의에 답하나 ─────────────────────────────────────
   실측 2026-09-19 기기 트랙로그: '닭강정집' 질의에 카카오가 21건을 줬는데
   메가MGC커피·맘스터치·본도시락이 섞여 있었다. 이 업종은 표에 없어서 `pathAny`가
   비고, 경로 조건이 없으면 필터가 무조건 통과라 전부 후보로 남는다. 거를 근거가
   없으니 거르지 않는 건 이 파일의 원칙(과잉 필터링이 더 비싸다)대로다. 대신 화면이
   "무엇을 찾던 자리인지"를 말해 사용자가 도착 전에 알아채게 한다. */

test('업종으로 확인된 검색은 이름이 달라도 조용하다 — 마트/홈플러스익스프레스', () => {
  // 실측 2026-09-19 기기: '마트' 자리에 '홈플러스익스프레스 광화문점'이 뽑혔다.
  // 이름에 '마트'가 없지만 pathAny(['슈퍼마켓','대형마트'])가 이미 걸러 낸 결과다 —
  // 여기에 라벨을 붙이면 잘 맞은 행까지 시끄러워지고, 그러면 정작 어긋난 행을 안 읽는다
  assert.equal(answersQuery('홈플러스익스프레스 광화문점', '마트'), true);
  assert.ok(isVerifiedCategory(planSearch('마트')));
});

test('표에 없는 업종이 이름까지 어긋나면 말해야 한다 — 닭강정집', () => {
  // 실측 2026-09-19 기기: 이 둘이 실제로 1순위·후보로 올라왔다
  assert.equal(answersQuery('메가MGC커피 명동한진빌딩점', '닭강정집'), false);
  assert.equal(answersQuery('맘스터치 마포공덕역점', '닭강정집'), false);
  assert.equal(isVerifiedCategory(planSearch('닭강정집')), false, '거를 근거가 아예 없다');
});

test('이름이 검색어를 품으면 굳이 다시 말하지 않는다 — 읽는 사람 시간만 쓴다', () => {
  assert.equal(answersQuery('정숙마트', '마트'), true);
  assert.equal(answersQuery('레스큐약국', '약국'), true);
});

test("'동네 X' 는 실제로 보낸 검색어로 잰다 — 접두사까지 요구하면 늘 어긋난다", () => {
  // planSearch('동네 마트').query 는 '마트'다. '정숙마트'에 '동네'가 있을 리 없다
  assert.equal(answersQuery('정숙마트', '동네 마트'), true);
  // 빵집은 표에 있어 업종으로 확인된다 — 성심당은 이름에 '빵집'이 없어도 빵집이 맞다
  assert.equal(answersQuery('성심당 대전역점', '동네 빵집'), true);
});

test('공백은 무시한다 — 띄어쓰기로 판정이 갈리면 안 된다', () => {
  // 닭강정집은 표에 없어서 이름 매칭까지 내려온다 — 공백 처리가 실제로 걸리는 자리다
  assert.equal(answersQuery('명동 닭강정 집', '닭강정집'), true);
  assert.equal(answersQuery('명동닭강정집', '닭강정 집'), true);
});

test('브랜드·특정 장소는 저절로 조용하다 — 이름이 곧 질의다', () => {
  // 브랜드는 업종 코드가 없다(올리브영·다이소는 카카오에 코드 자체가 없다).
  // 그래도 이름이 질의를 품어서 라벨이 안 붙는다
  assert.equal(isVerifiedCategory(planSearch('올리브영')), false);
  assert.equal(answersQuery('올리브영 명동점', '올리브영'), true);
  assert.equal(answersQuery('서울시청', '서울시청'), true);
});

test('진짜 닭강정집이어도 이름이 안 겹치면 말한다 — 과소 표기보다 과대 표기', () => {
  // '북창치킨'은 실제로 닭을 파는 집이다. 그래도 '닭강정집'을 품지 않으니 말해 준다.
  // 이 라벨은 고발이 아니라 맥락이다 — 틀린 걸 숨기는 쪽이 훨씬 비싸다
  assert.equal(answersQuery('북창치킨 서울시청본점', '닭강정집'), false);
});
