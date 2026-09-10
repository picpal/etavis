import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRouteRequest } from './routeSchema';

const p = (lat: number, lng: number) => ({ lat, lng });

test('정상 — 2점, 기본 mode car, polyline false', () => {
  const r = parseRouteRequest({ points: [p(37.5, 127), p(37.6, 127.1)] });
  assert.deepEqual(r, { points: [p(37.5, 127), p(37.6, 127.1)], mode: 'car', departAt: undefined, polyline: false });
});

test('점이 1개거나 8개 이상이면 거절', () => {
  assert.equal(parseRouteRequest({ points: [p(37.5, 127)] }), null);
  assert.equal(parseRouteRequest({ points: Array(8).fill(p(37.5, 127)) }), null);
});

test('좌표 범위 밖·숫자 아님·문자열 좌표는 거절', () => {
  assert.equal(parseRouteRequest({ points: [p(91, 127), p(37, 127)] }), null);
  assert.equal(parseRouteRequest({ points: [{ lat: 'a', lng: 1 }, p(37, 127)] }), null);
});

test('mode는 car만', () => {
  assert.equal(parseRouteRequest({ points: [p(37.5, 127), p(37.6, 127.1)], mode: 'walk' }), null);
});

test('departAt은 12자리 숫자만', () => {
  assert.equal(parseRouteRequest({ points: [p(37.5, 127), p(37.6, 127.1)], departAt: '2026-09-11' }), null);
  assert.equal(parseRouteRequest({ points: [p(37.5, 127), p(37.6, 127.1)], departAt: '202609111230' })!.departAt, '202609111230');
});

test('쓰레기 입력', () => {
  assert.equal(parseRouteRequest(null), null);
  assert.equal(parseRouteRequest('x'), null);
  assert.equal(parseRouteRequest({ points: 'x' }), null);
});
