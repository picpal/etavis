import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlacesRequest } from './placesSchema';

test('정상 — keyword, 좌표·반지름 포함', () => {
  const r = parsePlacesRequest({ kind: 'keyword', query: '올리브영', x: 126.9327, y: 37.5271, radius: 1500, size: 15 });
  assert.deepEqual(r, { kind: 'keyword', query: '올리브영', x: 126.9327, y: 37.5271, radius: 1500, size: 15, categoryCode: undefined, sortByDistance: true });
});

test('좌표가 없으면 거리순 정렬을 끈다', () => {
  const r = parsePlacesRequest({ kind: 'address', query: '여의도동 12', size: 5 });
  assert.equal(r?.sortByDistance, false);
  assert.equal(r?.x, undefined);
});

test('kind 가 둘 중 하나가 아니면 거절', () => {
  assert.equal(parsePlacesRequest({ kind: 'category', query: 'x', size: 5 }), null);
});

test('빈 검색어·40자 초과는 거절', () => {
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: '   ', size: 5 }), null);
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'ㄱ'.repeat(41), size: 5 }), null);
});

test('한국 밖 좌표는 거절 — 이 프록시는 카카오 로컬 전용이다', () => {
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x', x: 139.7, y: 35.6, size: 5 }), null);
});

test('size 는 1~15 로 자른다', () => {
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x', size: 99 })?.size, 15);
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x', size: 0 })?.size, 1);
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x' })?.size, 15);
});

test('radius 는 카카오 상한 20km 로 자른다', () => {
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x', x: 126.9, y: 37.5, radius: 99999, size: 5 })?.radius, 20000);
});

test('categoryCode 는 대문자·숫자 3자리만 받는다', () => {
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x', size: 5, categoryCode: 'PK6' })?.categoryCode, 'PK6');
  assert.equal(parsePlacesRequest({ kind: 'keyword', query: 'x', size: 5, categoryCode: '../../etc' }), null);
});

/* 이름으로 목적지를 찾을 때는 좌표를 주되 거리순은 아니어야 한다. 좌표 유무로 정렬을
   정하면 그 둘을 분리할 길이 없어, 서울시청에서 '강남역'을 쳐도 강남역이 안 나왔다 */

test('sortByDistance 를 false 로 주면 좌표가 있어도 거리순이 아니다', () => {
  const r = parsePlacesRequest({ kind: 'keyword', query: '강남역', x: 126.978, y: 37.5665, sortByDistance: false });

  assert.equal(r?.sortByDistance, false);
  assert.equal(r?.x, 126.978, '좌표는 그대로 넘어간다 — 관련도 정렬의 힌트로는 쓴다');
});

test('필드를 안 보내면 좌표 유무로 정한다 — 이미 배포된 앱이 그렇게 보낸다', () => {
  const withCoord = parsePlacesRequest({ kind: 'keyword', query: '올리브영', x: 126.978, y: 37.5665 });
  const without = parsePlacesRequest({ kind: 'keyword', query: '올리브영' });

  assert.equal(withCoord?.sortByDistance, true);
  assert.equal(without?.sortByDistance, false);
});
