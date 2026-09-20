import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './aggregate.ts';

test('세션 수를 센다 — 진입 한 번이 사람 한 명이다', () => {
  // 웹의 x-device-id 는 expo-constants 의 sessionId 라 페이지를 열 때마다 새로 생긴다.
  // 그래서 세션 개수가 곧 "들어온 사람" 수다.
  const s = aggregate([
    { event: 'hit', session: 'a', n: 1 },
    { event: 'hit', session: 'b', n: 1 },
  ]);
  assert.equal(s.visitors, 2);
});

test('비콘을 놓친 세션도 사람으로 센다', () => {
  // hit 은 유실될 수 있다(탭을 바로 닫거나 네트워크가 끊기거나). 질문이 왔다는 건
  // 사람이 있었다는 뜻이라, hit 이 없다고 없던 사람으로 치면 방문자가 과소 집계된다.
  const s = aggregate([{ event: 'ask', session: 'c', n: 3 }]);
  assert.equal(s.visitors, 1);
});

test('질문 횟수와 질문한 사람을 따로 센다', () => {
  const s = aggregate([
    { event: 'hit', session: 'a', n: 1 },
    { event: 'hit', session: 'b', n: 1 },
    { event: 'hit', session: 'c', n: 1 },
    { event: 'ask', session: 'a', n: 4 },
    { event: 'ask', session: 'b', n: 2 },
  ]);
  assert.equal(s.visitors, 3);
  assert.equal(s.asks, 6);
  assert.equal(s.askers, 2, '질문한 사람은 2명 — c 는 열기만 했다');
});

test('1인당 평균은 질문한 사람으로 나눈다', () => {
  // 전체 방문자로 나누면 "열고 나간 사람"이 평균을 끌어내려 질문자의 행동이 안 보인다.
  const s = aggregate([
    { event: 'hit', session: 'a', n: 1 },
    { event: 'hit', session: 'b', n: 1 },
    { event: 'ask', session: 'a', n: 5 },
  ]);
  assert.equal(s.askers, 1);
  assert.equal(s.avgAsks, 5);
  assert.equal(s.maxAsks, 5);
});

test('아무도 안 왔으면 전부 0이고 0으로 나누지 않는다', () => {
  const s = aggregate([]);
  assert.deepEqual(s, { visitors: 0, asks: 0, askers: 0, plans: 0, avgAsks: 0, maxAsks: 0 });
});

test('같은 세션이 여러 행으로 쪼개져 와도 합친다', () => {
  // Analytics Engine 은 group by 로 주지만, 샘플 구간이 갈리면 행이 나뉠 수 있다.
  const s = aggregate([
    { event: 'ask', session: 'a', n: 2 },
    { event: 'ask', session: 'a', n: 3 },
  ]);
  assert.equal(s.asks, 5);
  assert.equal(s.askers, 1);
  assert.equal(s.maxAsks, 5, '한 사람의 최다 질문은 합산값이어야 한다');
});

test('계획 확정을 따로 센다 — 끝까지 간 사람이 진짜 지표다', () => {
  const s = aggregate([
    { event: 'hit', session: 'a', n: 1 },
    { event: 'ask', session: 'a', n: 2 },
    { event: 'plan', session: 'a', n: 1 },
  ]);
  assert.equal(s.plans, 1);
});

test('모르는 이벤트 이름은 무시하되 사람은 센다', () => {
  // 나중에 이벤트를 늘렸다가 되돌릴 때, 리포트가 깨지는 대신 조용히 넘어가야 한다.
  const s = aggregate([{ event: 'zzz', session: 'a', n: 9 }]);
  assert.equal(s.visitors, 1);
  assert.equal(s.asks, 0);
});
