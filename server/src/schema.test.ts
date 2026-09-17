import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from './schema';

test('ambiguous options — 문자열만, 3개로 자르고 상관없어요를 맨 뒤에 붙인다', () => {
  // '상관없어요'가 안 섞인 5개를 넣는다 — 3개만 남고 뒤에 옵트아웃이 붙는 걸 명확히 보여준다
  const i = parseIntent({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'stop:빵집', question: '어떤 빵집으로 할까요?', options: ['파리바게뜨', '뚜레쥬르', '동네 빵집', '마트', '다섯번째'] },
    ],
  });
  assert.equal(i!.ambiguous[0].field, 'stop:빵집');
  assert.deepEqual(i!.ambiguous[0].options, ['파리바게뜨', '뚜레쥬르', '동네 빵집', '상관없어요']);
});

test('ambiguous options — 모델이 상관없어요를 이미 넣었어도 한 번만, 맨 뒤에 남는다', () => {
  const i = parseIntent({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'stop:빵집', question: '어떤 빵집으로 할까요?', options: ['상관없어요', '파리바게뜨', '뚜레쥬르', '동네 빵집', '다섯번째'] },
    ],
  });
  assert.deepEqual(i!.ambiguous[0].options, ['파리바게뜨', '뚜레쥬르', '동네 빵집', '상관없어요']);
});

test('ambiguous options — 모델이 상관없어요를 빠뜨리면 스키마가 붙여준다 (인젝션 방어선)', () => {
  const i = parseIntent({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'stop:마트', question: '어떤 마트로 할까요?', options: ['이마트', '홈플러스'] },
    ],
  });
  assert.deepEqual(i!.ambiguous[0].options, ['이마트', '홈플러스', '상관없어요']);
});

test('ambiguous options — 옵션이 아예 없으면 빈 배열로 남는다 (순수 질문에 칩을 만들지 않는다)', () => {
  const i = parseIntent({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'mode', question: '어떤 이동수단으로 갈까요?', options: [] },
    ],
  });
  assert.deepEqual(i!.ambiguous[0].options, []);
});

test('ambiguous options — 20자 넘으면 자른다', () => {
  const long = '가'.repeat(30);
  const i = parseIntent({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'stop:빵집', question: '어떤 빵집으로 할까요?', options: [long] },
    ],
  });
  assert.equal(i!.ambiguous[0].options[0].length, 20);
  assert.equal(i!.ambiguous[0].options[0], long.slice(0, 20));
});

test('ambiguous options — 없거나 이상하면 빈 배열', () => {
  const none = parseIntent({ stops: [], endpoints: {}, ambiguous: [{ field: 'mode', question: '어떤 이동수단으로 갈까요?' }] });
  assert.deepEqual(none!.ambiguous[0].options, []);
  const junk = parseIntent({ stops: [], endpoints: {}, ambiguous: [{ field: 'mode', question: '뭘로 갈까요?', options: [1, null, { a: 1 }, '카페'] }] });
  // 문자열 아닌 건 버리지만, 남은 문자열 옵션이 하나라도 있으면 옵트아웃이 붙는다
  assert.deepEqual(junk!.ambiguous[0].options, ['카페', '상관없어요'], '문자열 아닌 건 버린다');
});

test('prefers — 문자열만 받고 3개·20자로 자른다', () => {
  const i = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '샌드위치 사기', count: 1,
              flexible: true, openNow: false,
              prefers: ['샌드위치', 123, '조용한', '주차', '다섯번째'] }],
  });
  assert.deepEqual(i!.stops[0].prefers, ['샌드위치', '조용한', '주차']);
});

test('prefers — 20자를 넘으면 자른다', () => {
  const i = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false, prefers: ['가'.repeat(50)] }],
  });
  assert.equal(i!.stops[0].prefers[0].length, 20);
});

test('prefers — 없으면 빈 배열', () => {
  const i = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false }],
  });
  assert.deepEqual(i!.stops[0].prefers, []);
});

test('prefers — 배열 자체가 아니거나(단일 문자열·null) 배열 안에 중첩 객체가 섞여도 안전하다', () => {
  const single = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false, prefers: '샌드위치' }],
  });
  assert.deepEqual(single!.stops[0].prefers, [], '배열이 아니면 통째로 버린다');

  const nullish = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false, prefers: null }],
  });
  assert.deepEqual(nullish!.stops[0].prefers, [], 'null 도 배열이 아니면 버린다');

  const nested = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false, prefers: [null, { a: 1 }, '조용한'] }],
  });
  assert.deepEqual(nested!.stops[0].prefers, ['조용한'], '문자열 아닌 항목은 버리고 남은 것만 쓴다');
});

test('near — 세 값만 통과한다. 그 밖은 전부 any 로 떨어진다', () => {
  const ok = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false, near: 'end' }],
  });
  assert.equal(ok!.stops[0].near, 'end');

  // LLM 이 '목적지 근처'·거리(m)·객체를 뱉어도 앱에 닿지 않는다 — 방어선은 여기다
  for (const junk of ['목적지 근처', 'END', 500, null, { side: 'end' }, ['end']]) {
    const i = parseIntent({
      endpoints: {}, ambiguous: [],
      stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
                flexible: true, openNow: false, near: junk }],
    });
    assert.equal(i!.stops[0].near, 'any', `near=${JSON.stringify(junk)} 는 any 여야 한다`);
  }
});

test('near — 없으면 any. 말하지 않은 제약을 지어내지 않는다', () => {
  const i = parseIntent({
    endpoints: {}, ambiguous: [],
    stops: [{ op: 'add', queries: ['카페'], kind: 'category', why: '커피 사기', count: 1,
              flexible: true, openNow: false }],
  });
  assert.equal(i!.stops[0].near, 'any');
});

test('태그 3개를 허용 목록으로 검증한다', () => {
  const got = parseIntent({
    stops: [{ queries: ['마트'], loadBefore: 'none', loadAfter: 'hard', needWhen: 'afterArrival' }],
  });
  assert.equal(got?.stops[0].loadAfter, 'hard');
  assert.equal(got?.stops[0].needWhen, 'afterArrival');
});

test('목록 밖 값은 보수적 기본값으로 떨어진다', () => {
  const got = parseIntent({
    stops: [{ queries: ['마트'], loadBefore: '아주무거움', loadAfter: 7, needWhen: null }],
  });
  assert.equal(got?.stops[0].loadBefore, 'none');
  assert.equal(got?.stops[0].loadAfter, 'none');
  assert.equal(got?.stops[0].needWhen, 'unknown');
});

test('op=remove 의 태그는 읽지 않는다', () => {
  const got = parseIntent({
    stops: [{ op: 'remove', queries: ['마트'], loadAfter: 'hard', needWhen: 'afterArrival' }],
  });
  assert.equal(got?.stops[0].loadAfter, 'none');
  assert.equal(got?.stops[0].needWhen, 'unknown');
});
