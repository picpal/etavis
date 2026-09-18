import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksForSheet, askForChip, answerAsk } from './narrowAsk';
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
  assert.equal(askForChip([martAsk], stopChip())?.field, 'stop:마트');
});

test('답한 칩은 검색어가 그대로 남아 있어도 되묻지 않는다 — 고정한 값을 덮어쓸 길을 막는다', () => {
  assert.equal(askForChip([martAsk], stopChip({ narrowed: true })), undefined);
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
