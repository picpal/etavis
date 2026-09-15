import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransitRequest } from './transitSchema';

const now = new Date('2026-09-15T03:00:00Z'); // KST 12:00
const o = { lat: 37.5246, lng: 126.8607 };
const d = { lat: 37.5295, lng: 126.9187 };

test('정상 — 기본값 alternatives 3, preferSubway false, departAt 없음', () => {
  assert.deepEqual(parseTransitRequest({ origin: o, destination: d }, now), { origin: o, destination: d, departAt: undefined, alternatives: 3, preferSubway: false });
});

test('departAt — ISO 8601, 지금-5분 ~ 7일 안만', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-15T04:00:00Z' }, now)?.departAt, '2026-09-15T04:00:00.000Z');
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-15T02:00:00Z' }, now), null); // 1시간 전
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-30T00:00:00Z' }, now), null); // 15일 뒤
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '내일' }, now), null);
});

test('departAt — 느슨한 모양은 거절, 타임존 오프셋은 UTC 로 정규화', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026/09/16' }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-15 04:00:00Z' }, now), null); // 공백
  assert.equal(parseTransitRequest({ origin: o, destination: d, departAt: '2026-09-15T13:00:00+09:00' }, now)?.departAt, '2026-09-15T04:00:00.000Z');
});

test('alternatives 1~3 정수만, preferSubway 는 불리언만', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: 2 }, now)?.alternatives, 2);
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: 0 }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: 4 }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, alternatives: '3' }, now), null);
  assert.equal(parseTransitRequest({ origin: o, destination: d, preferSubway: true }, now)?.preferSubway, true);
  assert.equal(parseTransitRequest({ origin: o, destination: d, preferSubway: 'yes' }, now), null);
});

test('좌표 범위 밖·문자열·누락은 거절', () => {
  assert.equal(parseTransitRequest({ origin: { lat: 91, lng: 0 }, destination: d }, now), null);
  assert.equal(parseTransitRequest({ origin: { lat: 'a', lng: 1 }, destination: d }, now), null);
  assert.equal(parseTransitRequest({ origin: o }, now), null);
  assert.equal(parseTransitRequest(null, now), null);
});

test('출발·도착이 같은 점이면 거절 — 공급자에 돈 쓸 일이 아니다', () => {
  assert.equal(parseTransitRequest({ origin: o, destination: o }, now), null);
});
