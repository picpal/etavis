import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkyAsks, bulkyChipId, mergeBulkyAsks, BULKY_YES, BULKY_NO } from './bulkyAsk';
import type { IntentChip } from './plan';
import type { NarrowAsk } from './narrowAsk';

/* 기본값에 `loadAfter: 'none'` 을 박아 둔다 — 앱이 실제로 만드는 칩 모양이다.
   추출(서버 `schema.ts` · 로컬 목 `intent.ts`)이 `loadAfter` 를 늘 채워 보내므로
   이 값이 빈 칩은 화면에 존재하지 않는다. 옛 픽스처는 이걸 빼고 있어서,
   `loadAfter != null` 로 거르던 시절의 버그를 테스트가 못 잡았다 */
const stop = (over: Partial<Extract<IntentChip, { kind: 'stop' }>> = {}): IntentChip => ({
  id: 's-1', kind: 'stop', label: '마트', queries: ['마트'],
  stopKind: 'category', openNow: false, flexible: true, near: 'any', loadAfter: 'none', ...over,
} as IntentChip);

test('짐이 생기는 업종이면 묻는다', () => {
  const asks = bulkyAsks([stop()], 'walk');

  assert.equal(asks.length, 1);
  assert.equal(asks[0].field, 'load:s-1');
  assert.deepEqual(asks[0].options, [BULKY_YES, BULKY_NO]);
});

test('자동차면 묻지 않는다 — 트렁크에 실으니 답이 계획을 안 바꾼다', () => {
  assert.deepEqual(bulkyAsks([stop()], 'car'), []);
});

test('이미 답한 칩은 다시 묻지 않는다', () => {
  assert.deepEqual(bulkyAsks([stop({ loadAsked: true, loadAfter: 'hard' })], 'walk'), []);
  assert.deepEqual(bulkyAsks([stop({ loadAsked: true, loadAfter: 'none' })], 'walk'), []);
});

test('추출이 hard 로 찍어 둔 칩도 묻는다 — 그 태그는 답이 아니라 추측이다', () => {
  const asks = bulkyAsks([stop({ loadAfter: 'hard' })], 'walk');

  assert.equal(asks.length, 1);
  assert.equal(asks[0].field, 'load:s-1');
});

test('짐이 안 생기는 업종은 묻지 않는다 — 안 물어도 되는 걸 물으면 소음이다', () => {
  assert.deepEqual(bulkyAsks([stop({ id: 's-2', queries: ['올리브영'], label: '올리브영' })], 'walk'), []);
});

test('여러 칩이면 각각 묻는다', () => {
  const asks = bulkyAsks([stop(), stop({ id: 's-9', queries: ['정육점'], label: '정육점' })], 'transit');

  assert.deepEqual(asks.map(a => a.field), ['load:s-1', 'load:s-9']);
});

test('field 에서 칩 id 를 되꺼낸다', () => {
  assert.equal(bulkyChipId('load:s-1'), 's-1');
  assert.equal(bulkyChipId('stop:마트'), null);
});

const ask = (field: string): NarrowAsk => ({ field, question: `${field}?`, options: ['예', '아니요'] });

test('새로 생긴 물성 질문은 큐 뒤에 붙는다', () => {
  const next = mergeBulkyAsks([], [ask('load:s-1')], null);

  assert.deepEqual(next.asks.map(a => a.field), ['load:s-1']);
  assert.equal(next.askField, 'load:s-1');
});

test('이미 큐에 있는 질문은 다시 넣지 않는다 — 같은 질문이 쌓이면 답한 걸 또 묻는다', () => {
  const queue = [ask('load:s-1')];

  const next = mergeBulkyAsks(queue, [ask('load:s-1')], 'load:s-1');

  assert.equal(next.asks, queue); // 같은 참조 — effect 가 다시 돌지 않는다
  assert.equal(next.askField, 'load:s-1');
});

test('물을 일이 없어진 물성 질문은 큐에서 빠진다 — 자동차로 바꿨는데 짐을 묻고 있으면 안 된다', () => {
  const next = mergeBulkyAsks([ask('load:s-1')], [], 'load:s-1');

  assert.deepEqual(next.asks, []);
  assert.equal(next.askField, null);
});

test('빠진 질문이 열려 있었으면 다음 질문으로 넘어간다', () => {
  const next = mergeBulkyAsks([ask('load:s-1'), ask('stop:빵집')], [], 'load:s-1');

  assert.deepEqual(next.asks.map(a => a.field), ['stop:빵집']);
  assert.equal(next.askField, 'stop:빵집');
});

test('좁히기 질문은 건드리지 않는다 — 이 함수가 맡는 건 물성 질문뿐이다', () => {
  const queue = [ask('stop:빵집')];

  const next = mergeBulkyAsks(queue, [], 'stop:빵집');

  assert.equal(next.asks, queue);
  assert.equal(next.askField, 'stop:빵집');
});

test('답하던 질문은 새 질문이 와도 밀리지 않는다', () => {
  const next = mergeBulkyAsks([ask('load:s-1')], [ask('load:s-1'), ask('load:s-9')], 'load:s-1');

  assert.deepEqual(next.asks.map(a => a.field), ['load:s-1', 'load:s-9']);
  assert.equal(next.askField, 'load:s-1');
});
