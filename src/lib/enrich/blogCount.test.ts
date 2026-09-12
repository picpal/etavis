import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countBlog, isoToYmd, toYmd } from './blogCount.ts';

test('90일 밖 글은 세지 않는다', () => {
  const r = countBlog(['20260912', '20260101'], '20260912', 'naver');
  assert.equal(r.count90d, 1);
  assert.equal(r.latestDaysAgo, 0);
});

test('오늘 글의 가중치는 1', () => {
  const r = countBlog(['20260912'], '20260912', 'naver');
  assert.ok(Math.abs(r.weighted - 1) < 1e-9);
});

test('45일 전 글의 가중치는 1/e', () => {
  const r = countBlog(['20260729'], '20260912', 'naver');
  assert.ok(Math.abs(r.weighted - Math.exp(-1)) < 1e-3);
});

test('글이 없으면 weighted 0, latestDaysAgo null', () => {
  const r = countBlog([], '20260912', 'naver');
  assert.equal(r.weighted, 0);
  assert.equal(r.count90d, 0);
  assert.equal(r.latestDaysAgo, null);
});

test('망가진 날짜는 무시하고 나머지를 센다', () => {
  const r = countBlog(['', 'x', '20260912', '2026-09-12'], '20260912', 'naver');
  assert.equal(r.count90d, 1);
});

test('미래 날짜는 세지 않는다 — 서버 시계가 어긋나도 가중치가 1을 넘지 않게', () => {
  const r = countBlog(['20261231'], '20260912', 'naver');
  assert.equal(r.count90d, 0);
});

test('source 를 그대로 싣는다', () => {
  assert.equal(countBlog(['20260912'], '20260912', 'kakao').source, 'kakao');
});

test('ISO 8601 을 YYYYMMDD 로 자른다', () => {
  assert.equal(isoToYmd('2026-09-12T10:00:00.000+09:00'), '20260912');
  assert.equal(isoToYmd('망가진 값'), '');
});

test('Date 를 UTC 기준 YYYYMMDD 로 바꾼다', () => {
  assert.equal(toYmd(new Date(Date.UTC(2026, 8, 2))), '20260902');
});
