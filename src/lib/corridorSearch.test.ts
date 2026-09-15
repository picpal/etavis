import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, haversineM } from './geo.ts';
import { ANCHOR_INITIAL_M, initialRadiusM, maxRadiusM, searchAlong, searchAtAnchors, type SearchFn } from './corridorSearch.ts';
import type { PlaceCandidate } from './routePlan/types.ts';
import type { Anchor } from './routePlan/anchors.ts';

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

test('need 를 채운 뒤에도 max 까지 준다 — 추천은 후보가 많아야 의미가 있다', async () => {
  const poly = [{ latitude: 37.5, longitude: 127.0 }, { latitude: 37.6, longitude: 127.0 }];
  // 샘플 점마다 12곳씩, 전부 다른 id
  let n = 0;
  const search: SearchFn = async () =>
    Array.from({ length: 12 }, () => {
      n++;
      return { id: `p${n}`, name: `가게${n}`, coord: { latitude: 37.5 + n * 0.0001, longitude: 127.0 } };
    });
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 1000, maxRadiusM: 4000, max: 30 }, search);
  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 30);
});

test('max 가 없으면 30 이 기본', async () => {
  const poly = [{ latitude: 37.5, longitude: 127.0 }, { latitude: 37.6, longitude: 127.0 }];
  let n = 0;
  const search: SearchFn = async () =>
    Array.from({ length: 12 }, () => {
      n++;
      return { id: `q${n}`, name: `가게${n}`, coord: { latitude: 37.5 + n * 0.0001, longitude: 127.0 } };
    });
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 1000, maxRadiusM: 4000 }, search);
  assert.equal(r.candidates.length, 30);
});

test('중복 id 는 한 번만 — 샘플 점이 겹쳐도 같은 가게가 두 번 오지 않는다', async () => {
  const poly = [{ latitude: 37.5, longitude: 127.0 }, { latitude: 37.6, longitude: 127.0 }];
  const search: SearchFn = async () => [
    { id: 'same', name: '한곳', coord: { latitude: 37.55, longitude: 127.0 } },
  ];
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 1000, maxRadiusM: 4000 }, search);
  assert.equal(r.candidates.length, 1);
});

test('target — 1곳 찾았어도 target 까지 반지름을 넓힌다', async () => {
  // 2km 안에 1곳, 4km 안에 2곳 더, 8km 안에 5곳 더 = 8곳
  const cat: PlaceCandidate[] = [
    { id: 'a', name: 'a', coord: at(37.5, 127.05) },
    { id: 'b', name: 'b', coord: at(37.53, 127.05) },
    { id: 'c', name: 'c', coord: at(37.47, 127.05) },
    ...[1, 2, 3, 4, 5].map(i => ({ id: `d${i}`, name: `d${i}`, coord: at(37.56, 127.02 + 0.01 * i) })),
  ];
  const { fn, calls } = catalogSearch(cat);
  const r = await searchAlong(poly, 'q', { need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(r.radiusM, 8000);
  assert.equal(r.candidates.length, 8);
  assert.equal(calls.length, 15); // 2km·4km·8km × 5점
});

test('target 을 못 채워도 need 이상이면 ok — short 는 count 기준이다', async () => {
  const three = [127.03, 127.06, 127.09].map((lng, i) => ({ id: `t${i}`, name: `t${i}`, coord: at(37.5, lng) }));
  const { fn, calls } = catalogSearch(three);
  const r = await searchAlong(poly, 'q', { need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 4000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 3);
  assert.equal(r.radiusM, 4000); // 상한까지 넓혔다
  assert.equal(calls.length, 10);
});

test('target 없으면 need 가 곧 target — 기존 동작', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.5, 127.05) };
  const { fn, calls } = catalogSearch([c1]);
  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 5);
});

test('calls — 한 회차는 샘플 5점', async () => {
  // 경로 한가운데. 50% 샘플이 바로 여기라 1회차(5번 호출)에 찾는다
  const mid = at(37.5, 127.0568);
  const { fn, calls } = catalogSearch([{ id: 'p1', name: '한곳', coord: mid }]);
  const r = await searchAlong(poly, '카페', { need: 1, initialRadiusM: 2000, maxRadiusM: 8000 }, fn);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.calls, calls.length);
  assert.equal(r.calls, 5);
});

test('calls — 못 찾으면 회차마다 5씩 는다', async () => {
  // 어디에도 없다 → 2000 → 4000 → 8000 세 회차 + far(기본 20000m) 한 회차
  const { fn, calls } = catalogSearch([{ id: 'z', name: '딴데', coord: at(38.2, 128.5) }]);
  const r = await searchAlong(poly, '카페', { need: 1, initialRadiusM: 2000, maxRadiusM: 8000 }, fn);
  assert.equal(r.status, 'none');
  assert.equal(r.calls, calls.length);
  assert.equal(r.calls, 20, '5점 × (3회차 + far 1회차)');
});

const anchors: Anchor[] = [
  { id: 'a0', kind: 'origin', name: '출발지', coord: at(37.5188, 126.8575), progressM: 0 },
  { id: 'a1', kind: 'board', name: '목동', coord: at(37.526097, 126.864538), progressM: 1100 },
  { id: 'a2', kind: 'transfer', name: '여의도', coord: at(37.521624, 126.924221), progressM: 6400 },
  { id: 'a3', kind: 'alight', name: '국회의사당', coord: at(37.528143, 126.917856), progressM: 7300 },
  { id: 'a4', kind: 'destination', name: '목적지', coord: at(37.5285, 126.9187), progressM: 7400 },
];

test('앵커 검색 — 각 앵커에서 한 번씩, 후보에 앵커와 도보 거리가 붙는다', async () => {
  const nearBoard = at(37.5263, 126.8650); // 목동역에서 100m 이내
  const { fn, calls } = catalogSearch([{ id: 'kb', name: '국민은행 목동역점', coord: nearBoard }]);
  const r = await searchAtAnchors(anchors, '국민은행', { need: 1 }, fn);

  assert.equal(r.calls, calls.length);
  assert.equal(r.calls, anchors.length, '앵커마다 한 번');
  assert.ok(calls.every(c => c.radiusM === ANCHOR_INITIAL_M));
  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].anchorId, 'a1');
  assert.ok(r.candidates[0].anchorWalkM! < 200, `도보 ${r.candidates[0].anchorWalkM}m`);
});

test('앵커 검색 — target 에 못 미치면 반지름을 넓힌다', async () => {
  const far = at(37.5300, 126.8700); // 목동역에서 500m 밖, 1000m 안
  const { fn, calls } = catalogSearch([{ id: 'x', name: '먼곳', coord: far }]);
  const r = await searchAtAnchors(anchors, '카페', { need: 1 }, fn);
  assert.equal(r.candidates.length, 1);
  assert.ok(r.radiusM > ANCHOR_INITIAL_M, '넓혔어야 한다');
  assert.equal(r.calls, calls.length);
  assert.equal(r.calls, anchors.length * 2, '두 회차');
});

test('앵커 검색 — 상한까지 0건이면 none', async () => {
  const { fn } = catalogSearch([{ id: 'z', name: '아주먼곳', coord: at(37.6, 127.3) }]);
  const r = await searchAtAnchors(anchors, '카페', { need: 1 }, fn);
  assert.equal(r.status, 'none');
  assert.equal(r.candidates.length, 0);
});

test('앵커 검색 — 여러 앵커에서 같은 id 가 나오면 가까운 앵커로 한 번만', async () => {
  // 여의도에서 북쪽 200m. 반지름 1200m 면 국회의사당(770m)·목적지(740m)도 같이 집어온다
  const nearTransfer = at(37.5234, 126.924221);
  const { fn } = catalogSearch([{ id: 'dup', name: '올리브영', coord: nearTransfer }]);
  const r = await searchAtAnchors(anchors, '올리브영', { need: 1, initialRadiusM: 1200 }, fn);
  assert.equal(r.candidates.length, 1, '같은 id 가 세 앵커에서 나와도 하나');
  assert.equal(r.candidates[0].anchorId, 'a2', '가장 가까운 환승역에 붙는다');
  assert.ok(r.candidates[0].anchorWalkM! < 300);
});

test('앵커 검색 — 도보 거리 오름차순', async () => {
  const { fn } = catalogSearch([
    { id: 'far', name: '먼 올리브영', coord: at(37.5300, 126.8700) },
    { id: 'near', name: '가까운 올리브영', coord: at(37.5263, 126.8650) },
  ]);
  const r = await searchAtAnchors(anchors, '올리브영', { need: 2, initialRadiusM: 1200 }, fn);
  assert.deepEqual(r.candidates.map(c => c.id), ['near', 'far']);
});
