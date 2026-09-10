import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, haversineM } from './geo';
import { initialRadiusM, maxRadiusM, searchAlong, type SearchFn } from './corridorSearch';
import type { PlaceCandidate } from './routePlan/types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km
const poly = buildPolyline([O, D], 32);
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });

/** 카탈로그에서 반지름 안의 것만 돌려주는 검색 함수 + 호출 기록 */
function catalogSearch(catalog: PlaceCandidate[]) {
  const calls: { near: { latitude: number; longitude: number }; radiusM: number }[] = [];
  const fn: SearchFn = async (_q, near, radiusM) => {
    calls.push({ near, radiusM });
    return catalog.filter(c => haversineM(near, c.coord) <= radiusM);
  };
  return { fn, calls };
}

test('반지름 상수', () => {
  assert.equal(initialRadiusM('car'), 2000);
  assert.equal(initialRadiusM('walk'), 500);
  assert.equal(maxRadiusM('car', null, 2), 15000);
  // 여유 20분, ρ=2분/km → 우회 10km → r 5km
  assert.equal(maxRadiusM('car', 20, 2), 5000);
  assert.equal(maxRadiusM('walk', 100, 12), 2000);
});

test('회랑 5점에서 찾고 place id로 합친다', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.5, 127.05) }; // 중간
  const { fn, calls } = catalogSearch([c1]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.candidates.map(c => c.id), ['c1']);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(c => c.radiusM === 2000));
});

test('없으면 반지름을 2배씩 넓혀 찾는다', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.53, 127.05) }; // 북쪽 3.3km
  const { fn, calls } = catalogSearch([c1]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(r.radiusM, 4000);
  assert.equal(calls.length, 10);
});

test('상한까지 없고 더 멀리엔 있으면 far — 가장 가까운 3곳', async () => {
  const farOnes = [1, 2, 3, 4].map(i => ({ id: `f${i}`, name: `f${i}`, coord: at(37.5 + 0.2 * i, 127.05) })); // 22km+
  const { fn } = catalogSearch(farOnes);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 4000, farRadiusM: 100_000 }, fn);
  assert.equal(r.status, 'far');
  assert.deepEqual(r.candidates.map(c => c.id), ['f1', 'f2', 'f3']);
});

test('아예 없으면 none', async () => {
  const { fn } = catalogSearch([]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.equal(r.status, 'none');
  assert.deepEqual(r.candidates, []);
});

test('need=3인데 2개뿐이면 short', async () => {
  const two = [at(37.5, 127.03), at(37.5, 127.08)].map((coord, i) => ({ id: `s${i}`, name: `s${i}`, coord }));
  const { fn } = catalogSearch(two);
  const r = await searchAlong(poly, 'q', { need: 3, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.equal(r.status, 'short');
  assert.equal(r.candidates.length, 2);
});

test('결과는 회랑에서 가까운 순', async () => {
  const cat = [
    { id: 'off', name: 'off', coord: at(37.515, 127.05) },
    { id: 'on', name: 'on', coord: at(37.5, 127.06) },
  ];
  const { fn } = catalogSearch(cat);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.deepEqual(r.candidates.map(c => c.id), ['on', 'off']);
});
