import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksForSheet, answerAsk, askTarget, asksForChip, ASK_LOAD } from './narrowAsk';
import type { IntentChip } from './plan';

const stopChip = (over: Partial<Extract<IntentChip, { kind: 'stop' }>> = {}): IntentChip => ({
  id: 's-1', kind: 'stop', label: '마트', queries: ['마트'],
  stopKind: 'category', openNow: false, flexible: true, ...over,
} as IntentChip);

const martAsk = { field: 'stop:마트', question: '어떤 마트로 할까요?', options: ['이마트', '동네 마트', '상관없어요'] };

test('선택지가 2개 미만인 되묻기는 시트로 띄우지 않는다 — 고를 것이 없으면 질문이 아니다', () => {
  const out = asksForSheet([
    martAsk,
    { field: 'stop:약국', question: '어떤 약국으로 할까요?', options: ['상관없어요'] },
  ]);

  assert.deepEqual(out.map(a => a.field), ['stop:마트']);
});

test('칩에 달린 되묻기를 찾는다 — 표식과 재오픈이 같은 답을 봐야 한다', () => {
  assert.equal(asksForChip([martAsk], stopChip())[0]?.field, 'stop:마트');
});

test('답한 칩은 검색어가 그대로 남아 있어도 되묻지 않는다 — 고정한 값을 덮어쓸 길을 막는다', () => {
  assert.deepEqual(asksForChip([martAsk], stopChip({ narrowed: true })), []);
});

test("'상관없어요'는 좁히지 않고 질문만 닫는다", () => {
  const out = answerAsk([martAsk], martAsk, '상관없어요');

  assert.equal(out.narrowTo, null, '좁히지 않겠다는 답이지 지우겠다는 답이 아니다');
  assert.deepEqual(out.asks, []);
});

test('선택지를 고르면 그 말로 좁히라고 알려준다', () => {
  const out = answerAsk([martAsk], martAsk, '이마트');

  assert.equal(out.narrowTo, '이마트');
  assert.deepEqual(out.asks, []);
});

test('되묻기가 둘이면 하나를 답해도 나머지는 남는다 — 시트가 다음 질문으로 넘어간다', () => {
  const bakery = { field: 'stop:빵집', question: '어떤 빵집으로 할까요?', options: ['파리바게뜨', '동네 빵집', '상관없어요'] };

  const out = answerAsk([martAsk, bakery], martAsk, '이마트');

  assert.deepEqual(out.asks.map(a => a.field), ['stop:빵집']);
});

/* 접두사는 코드가 확인한다. 전에는 `field.slice('stop:'.length)` 로 5글자를 무조건
   잘라서, `load:s-1` 이 검색어 `s-1` 인 척할 수 있었다 */

test('stop: 은 검색어를, load: 는 칩 id 를 가리킨다', () => {
  assert.deepEqual(askTarget('stop:마트'), { kind: 'query', query: '마트' });
  assert.deepEqual(askTarget('load:s-1'), { kind: 'chip', chipId: 's-1' });
});

test('모르는 접두사는 아무것도 가리키지 않는다 — 5글자를 무조건 자르면 안 된다', () => {
  assert.equal(askTarget('other:x'), null);
  assert.equal(askTarget('마트'), null);
});

test('물성 질문도 칩에 달린 질문으로 셈한다 — 안 그러면 칩에서 도달할 길이 없다', () => {
  const load = { field: 'load:s-1', question: '무거우신가요?', options: ['무거워요', '괜찮아요'] };

  assert.deepEqual(asksForChip([load], stopChip()).map(a => a.field), ['load:s-1']);
});

test('좁힌 칩에도 물성 질문은 남는다 — 어떤 마트인지와 무거운지는 다른 질문이다', () => {
  const load = { field: 'load:s-1', question: '무거우신가요?', options: ['무거워요', '괜찮아요'] };

  assert.deepEqual(asksForChip([load], stopChip({ narrowed: true })).map(a => a.field), ['load:s-1']);
});

test('한 칩에 두 종류가 달리면 둘 다 준다 — 메뉴가 전부 보여줘야 한다', () => {
  const asks = [
    { field: 'stop:마트', question: '어떤 마트로 할까요?', options: ['이마트', '동네 마트', '상관없어요'] },
    { field: 'load:s-1', question: '무거우신가요?', options: ['무거워요', '괜찮아요'] },
  ];

  assert.deepEqual(asksForChip(asks, stopChip()).map(a => a.field), ['stop:마트', 'load:s-1']);
});

test('좁힌 칩은 좁히기 질문을 더 받지 않는다 — 고정한 값을 덮을 길을 막는다', () => {
  const asks = [{ field: 'stop:마트', question: '어떤 마트로 할까요?', options: ['이마트', '상관없어요'] }];

  assert.deepEqual(asksForChip(asks, stopChip({ narrowed: true })), []);
});
