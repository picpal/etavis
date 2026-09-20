import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, haversineM } from './geo.ts';
import { ANCHOR_INITIAL_M, initialRadiusM, maxRadiusM, searchAlong, searchAtAnchors, spreadCut, type SearchFn } from './corridorSearch.ts';
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

const at2 = (lng: number) => ({ latitude: 37.5, longitude: lng });
const O2 = at2(127.0), D2 = at2(127.5);
const line2 = [O2, D2];

/** 검색 중심 좌표를 기록하는 목 */
function spy(make: (center: { latitude: number; longitude: number }) => PlaceCandidate[]) {
  const centers: number[] = [];
  const fn = async (_q: string, center: { latitude: number; longitude: number }) => {
    centers.push(center.longitude);
    return make(center);
  };
  return { fn, centers };
}

/** 중심마다 후보 1개. 0건이면 far 폴백이 한 라운드 더 돌아 calls 가 5를 넘는다 */
const one = (center: { latitude: number; longitude: number }): PlaceCandidate[] =>
  [{ id: `p${center.longitude}`, name: 'p', coord: { ...center } }];

test('side=end 면 샘플 점이 후반부에만 찍힌다', async () => {
  const s = spy(one);
  await searchAlong(line2, '마트', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'end', origin: O2, destination: D2,
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.equal(first.length, 5);
  assert.ok(Math.min(...first) >= 127.249, `후반부여야 한다: ${first}`);
  assert.ok(Math.max(...first) <= 127.5);
});

test('side=start 면 전반부에만 찍힌다', async () => {
  const s = spy(one);
  await searchAlong(line2, '약국', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'start', origin: O2, destination: D2,
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.ok(Math.max(...first) <= 127.251, `전반부여야 한다: ${first}`);
});

test('side 를 줘도 라운드당 호출 수는 5회 그대로다', async () => {
  const s = spy(one);
  const r = await searchAlong(line2, '마트', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'end', origin: O2, destination: D2,
  }, s.fn);
  assert.equal(r.calls, 5); // 반경이 상한과 같아 한 라운드만 돈다
});

test('target 을 near 쪽 개수로 센다 — 반대쪽만 8개면 반경을 더 넓힌다', async () => {
  let round = 0;
  const far = (i: number): PlaceCandidate =>
    ({ id: `f${i}`, name: `f${i}`, coord: at2(127.0) });       // 전부 출발지 쪽
  const close = (i: number): PlaceCandidate =>
    ({ id: `c${i}`, name: `c${i}`, coord: at2(127.495) });      // 목적지에서 약 440m
  const fn = async () => {
    round++;
    // 1라운드는 반대쪽만, 2라운드부터 목적지 쪽이 나온다
    return round <= 5 ? [far(round)] : [far(round), close(round)];
  };
  const r = await searchAlong(line2, '마트', {
    need: 1, target: 3, initialRadiusM: 1000, maxRadiusM: 4000,
    side: 'end', origin: O2, destination: D2,
  }, fn);
  assert.ok(r.calls > 5, `한 라운드로 멈추면 안 된다: ${r.calls}`);
  assert.equal(r.status, 'ok');
});

test('side 가 없으면 지금까지처럼 전 구간에서 찍는다', async () => {
  const s = spy(one);
  await searchAlong(line2, '카페', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.ok(Math.min(...first) <= 127.001);
  assert.ok(Math.max(...first) >= 127.499);
});

test('side 를 줘도 origin·destination 이 없으면 무시한다 — 계약대로 전 구간에서 찍는다', async () => {
  const s = spy(one);
  await searchAlong(line2, '마트', {
    need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000,
    side: 'end', // origin·destination 를 일부러 뺀다
  }, s.fn);
  const first = s.centers.slice(0, 5);
  assert.ok(Math.min(...first) <= 127.001, `전 구간이어야 한다: ${first}`);
  assert.ok(Math.max(...first) >= 127.499, `전 구간이어야 한다: ${first}`);
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

const anchor = (id: string, kind: Anchor['kind'], lng: number): Anchor =>
  ({ id, kind, name: id, coord: at2(lng), progressM: 0 });

const ALL: Anchor[] = [
  anchor('a0', 'origin', 127.0),
  anchor('a1', 'board', 127.01),
  anchor('a2', 'transfer', 127.25),
  anchor('a3', 'alight', 127.49),
  anchor('a4', 'destination', 127.5),
];

test('side=end 면 하차역·목적지 앵커만 조회한다', async () => {
  const seen: string[] = [];
  const fn = async (_q: string, center: { longitude: number }) => {
    seen.push(center.longitude.toFixed(2));
    return [];
  };
  await searchAtAnchors(ALL, '마트', { need: 1, target: 3, side: 'end', origin: O2, destination: D2 }, fn);
  // stub 이 []만 돌려줘서 target(3)에 절대 못 미친다 — 반지름이 500→1000→1500 세 번 도는
  // 만큼 같은 중심을 세 번씩 조회한다. 그래서 여기서는 "몇 번 불렀나"가 아니라
  // "어느 중심을 불렀나"(집합)를 본다 — 호출 횟수로 재면 세 배로 뻥튀기된 값과 비교하게 된다.
  assert.deepEqual([...new Set(seen)].sort(), ['127.49', '127.50']);
});

test('side=start 면 출발지·승차역 앵커만 조회한다', async () => {
  const seen: string[] = [];
  const fn = async (_q: string, center: { longitude: number }) => {
    seen.push(center.longitude.toFixed(2));
    return [];
  };
  await searchAtAnchors(ALL, '약국', { need: 1, target: 3, side: 'start', origin: O2, destination: D2 }, fn);
  assert.deepEqual([...new Set(seen)].sort(), ['127.00', '127.01']);
});

test('그쪽 종류의 앵커가 하나도 없으면 전부 본다 — 좁히다가 0건이 되면 안 된다', async () => {
  const onlyTransfer = [anchor('t', 'transfer', 127.25)];
  let calls = 0;
  const fn = async () => { calls++; return []; };
  await searchAtAnchors(onlyTransfer, '마트', { need: 1, target: 3, side: 'end', origin: O2, destination: D2 }, fn);
  assert.ok(calls > 0, '앵커를 전부 버리면 안 된다');
});

test('side 가 없으면 지금까지처럼 전부 조회한다', async () => {
  const seen: string[] = [];
  const fn = async (_q: string, center: { longitude: number }) => {
    seen.push(center.longitude.toFixed(2));
    return [];
  };
  await searchAtAnchors(ALL, '카페', { need: 1, target: 3 }, fn);
  // 위와 같은 이유로 호출 횟수(15) 대신 조회된 앵커 집합의 크기를 본다 — side 없음이면 전부(5개)다
  assert.equal(new Set(seen).size, 5);
});

test('좁힌 앵커 집합에서도 후보가 맞는 앵커에 붙는다', async () => {
  // a3(하차역, 127.49) 자리에 후보 하나. side=end 면 used=[a3,a4] 라 a3 에 붙고 walkM 은 0 이다.
  // attach 가 used[i] 대신 anchors[i] 를 쓰면 a0(출발지)·a1(승차역)에 붙어 40km 대가 나온다 —
  // 좁혀진 뒤에도 attach 가 올바른 인덱스로 앵커를 찾아 붙이는지를 확인한다
  const fn = async (): Promise<PlaceCandidate[]> =>
    [{ id: 'm', name: '마트', coord: at2(127.49) }];
  const r = await searchAtAnchors(ALL, '마트', {
    need: 1, target: 1, side: 'end', origin: O2, destination: D2,
  }, fn);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].anchorId, 'a3');
  assert.equal(r.candidates[0].anchorWalkM, 0);
});

test('컷이 near 쪽을 먼저 채운다 — 반대쪽이 경로에 더 가까워도', async () => {
  // 목적지 쪽 1곳은 경로에서 멀고, 출발지 쪽 3곳은 경로 위에 있다
  const list: PlaceCandidate[] = [
    { id: 'n1', name: 'n1', coord: { latitude: 37.51, longitude: 127.5 } }, // end 쪽, D2 에서 약 1.1km
    { id: 'f1', name: 'f1', coord: at2(127.0) },
    { id: 'f2', name: 'f2', coord: at2(127.01) },
    { id: 'f3', name: 'f3', coord: at2(127.02) },
  ];
  let done = false;
  const fn = async () => { if (done) return []; done = true; return list; };
  const r = await searchAlong(line2, '마트', {
    need: 1, target: 1, initialRadiusM: 3000, maxRadiusM: 3000,
    max: 2, side: 'end', origin: O2, destination: D2,
  }, fn);
  assert.equal(r.candidates[0].id, 'n1', `end 쪽이 먼저여야 한다: ${r.candidates.map(c => c.id)}`);
  assert.equal(r.candidates.length, 2); // 반대쪽도 버리지 않는다 — 완화가 되돌릴 게 있어야 한다
});

test('앵커 컷도 near 쪽을 먼저 채운다 — 폴백 경로', async () => {
  // 하차역·목적지 앵커가 없어 폴백으로 전체를 본다. 그때도 목적지 쪽이 먼저다.
  // near 는 앵커에서 21km 라 도보순으로는 꼴찌지만 D 에서 442m 다
  const only = [anchor('t', 'transfer', 127.25)];
  const near: PlaceCandidate = { id: 'n', name: 'n', coord: at2(127.495) };
  const far: PlaceCandidate = { id: 'f', name: 'f', coord: at2(127.26) };
  const fn = async (): Promise<PlaceCandidate[]> => [near, far];
  const r = await searchAtAnchors(only, '마트', {
    need: 1, target: 1, max: 2, side: 'end', origin: O2, destination: D2,
  }, fn);
  assert.equal(r.candidates[0].id, 'n', `목적지 쪽이 먼저여야 한다: ${r.candidates.map(c => c.id)}`);
  // 반대쪽을 버리지 않는다 — 완화가 되돌릴 후보가 없으면 완화가 무의미해진다
  assert.equal(r.candidates.length, 2);
});

/* ── 표본 하나가 실패해도 계획이 죽지 않는다 ──────────────────────────────
   2026-09-19 프로덕션: /places 30건 중 1건이 503(KV PUT 429)으로 죽었고,
   Promise.all 이라 그 하나가 검색 전체를 reject 시켜 계획이 통째로 실패했다.
   사용자에겐 "연결이 불안정해요"만 보였다. 표본 하나는 표본 하나만큼만 잃어야 한다. */

/** n번째 표본 호출만 던지는 검색 함수 */
function flakySearch(catalog: PlaceCandidate[], failOn: (i: number) => boolean) {
  let i = 0;
  const fn: SearchFn = async (_q, near, radiusM) => {
    const mine = i++;
    if (failOn(mine)) throw new Error('KV PUT failed: 429 Too Many Requests');
    return catalog.filter(c => haversineM(near, c.coord) <= radiusM);
  };
  return fn;
}

test('표본 하나가 던져도 나머지 표본의 후보로 결과를 낸다', async () => {
  const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: at(37.5, 127.05) };
  const fn = flakySearch([c1], i => i === 0);

  const r = await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn);

  assert.equal(r.status, 'ok');
  assert.deepEqual(r.candidates.map(c => c.id), ['c1']);
});

test('표본이 전부 던지면 던진다 — "없다"와 "못 봤다"를 섞으면 안 된다', async () => {
  const fn = flakySearch([], () => true);

  await assert.rejects(
    () => searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000 }, fn),
    /429/,
  );
});

test('far 폴백에서도 표본 하나는 표본 하나만큼만 잃는다', async () => {
  // 회랑 안에는 없고 멀리 한 곳만 있다 → far 폴백으로 내려간다
  const farOne: PlaceCandidate = { id: 'far', name: 'far', coord: at(37.6, 127.05) };
  const fn = flakySearch([farOne], i => i === 0);

  const r = await searchAlong(
    poly, 'q',
    { need: 1, initialRadiusM: 2000, maxRadiusM: 4000, farRadiusM: 20_000 },
    fn,
  );

  assert.equal(r.status, 'far');
  assert.deepEqual(r.candidates.map(c => c.id), ['far']);
});

test('앵커 검색도 앵커 하나가 던지면 그 앵커만 잃는다', async () => {
  const a1: Anchor = { id: 'a1', name: '역1', coord: at(37.5, 127.02) };
  const a2: Anchor = { id: 'a2', name: '역2', coord: at(37.5, 127.08) };
  const near2: PlaceCandidate = { id: 'n2', name: 'n2', coord: at(37.5, 127.081) };
  const fn = flakySearch([near2], i => i === 0);

  const r = await searchAtAnchors([a1, a2], 'q', { need: 1, maxRadiusM: 1500 }, fn);

  assert.equal(r.status, 'ok');
  assert.deepEqual(r.candidates.map(c => c.id), ['n2']);
});

/* ── 반경 넓히기와 시간 예산 ─────────────────────────────────────
   실측 2026-09-19 기기: '닭강정집'에 업종 경로가 생기자 근처 것이 전부 걸러져
   반경이 2000→4000→8000→15000 으로 올라갔다(20콜). 검색 단계가 2.6초에서
   6.4초가 되면서 계획 전체가 12초 예산을 넘겨 FAIL('timeout') 으로 끝났다 —
   그 시점에 두 슬롯 다 후보를 들고 있었는데 통째로 버렸다.

   같은 파일 위쪽의 원칙을 반경 사다리에도 적용한다:
   "경유지 하나를 잃는 게 계획 전체를 타임아웃으로 잃는 것보다 낫다."(runPlan.ts) */

test('예산이 없으면 반경을 더 넓히지 않고 지금까지 모은 것을 쓴다', async () => {
  const near = at(37.5, 127.05); // 회랑 한가운데, 첫 회차(2000m)에 잡힌다
  const { fn, calls } = catalogSearch([{ id: 'c1', name: 'c1', coord: near }]);

  // target 3 이라 원래는 1곳만 찾고 반경을 넓힌다
  const r = await searchAlong(
    poly, 'q',
    { need: 1, target: 3, initialRadiusM: 2000, maxRadiusM: 15000, canWiden: () => false },
    fn,
  );

  assert.equal(calls.length, 5, '첫 회차만 돈다');
  assert.equal(r.status, 'ok', 'need 는 채웠다');
  assert.deepEqual(r.candidates.map(c => c.id), ['c1']);
  assert.equal(r.radiusM, 2000, '넓히지 않았으니 반경도 그대로여야 한다');
});

test('첫 회차는 예산과 무관하게 돈다 — 안 돌면 아무것도 못 찾는다', async () => {
  const { fn, calls } = catalogSearch([{ id: 'c1', name: 'c1', coord: at(37.5, 127.05) }]);

  await searchAlong(poly, 'q', { need: 1, initialRadiusM: 2000, maxRadiusM: 15000, canWiden: () => false }, fn);

  assert.equal(calls.length, 5);
});

test('예산이 없으면 far 한 회차도 포기한다 — 마지막 기회가 계획을 죽이면 안 된다', async () => {
  // 15km 밖이라 상한(15000)까지 넓혀도 0건 — 원래는 far(20000)로 한 번 더 본다
  const { fn, calls } = catalogSearch([{ id: 'far', name: 'far', coord: at(37.65, 127.05) }]);

  const r = await searchAlong(
    poly, 'q',
    { need: 1, initialRadiusM: 2000, maxRadiusM: 15000, canWiden: () => false },
    fn,
  );

  assert.equal(r.status, 'none');
  assert.equal(calls.length, 5, 'far 회차까지 5콜에서 멈춘다');
});

test('예산이 남아 있으면 지금까지처럼 넓힌다 — 기본 동작은 그대로다', async () => {
  const { fn, calls } = catalogSearch([{ id: 'c1', name: 'c1', coord: at(37.53, 127.05) }]); // 북쪽 3.3km

  const r = await searchAlong(
    poly, 'q',
    { need: 1, initialRadiusM: 2000, maxRadiusM: 15000, canWiden: () => true },
    fn,
  );

  assert.equal(r.status, 'ok');
  assert.ok(calls.length > 5, '두 회차 이상');
});

test('이미 target 을 채웠으면 예산을 묻지도 않는다', async () => {
  let asked = 0;
  const { fn } = catalogSearch([{ id: 'c1', name: 'c1', coord: at(37.5, 127.05) }]);

  await searchAlong(
    poly, 'q',
    { need: 1, initialRadiusM: 2000, maxRadiusM: 15000, canWiden: () => { asked++; return true; } },
    fn,
  );

  assert.equal(asked, 0, '넓힐 이유가 없으면 예산은 상관없는 질문이다');
});

test('앵커 검색도 같은 규칙을 쓴다', async () => {
  const far = at(37.5300, 126.8700); // 목동역에서 500m 밖, 1000m 안
  const { fn, calls } = catalogSearch([{ id: 'x', name: '먼곳', coord: far }]);

  const r = await searchAtAnchors(anchors, '카페', { need: 1, canWiden: () => false }, fn);

  assert.equal(calls.length, anchors.length, '한 회차만');
  assert.equal(r.status, 'none', '500m 안엔 없다 — 넓히지 못했으니 못 찾은 것이다');
  assert.equal(r.radiusM, ANCHOR_INITIAL_M);
});

/* ── 한 동네가 목록을 독점하지 않는다 — 진행률 버킷 라운드로빈 ─────────────────
   실측 2026-09-20 기기: 서교동 → 코엑스 대중교통 13km 에서 CU 를 찾자 교체 시트
   30곳이 전부 홍대였다. 출발지·승차역 앵커 둘이 홍대 안에 있고 카카오가 앵커당
   15건을 주니 2 × 15 = 30 = max 로 딱 찼다. 삼성역·코엑스 앵커의 CU 는 걷는 거리가
   조금 더 멀어 도보순 컷에 닿기도 전에 밀렸다 — 없던 게 아니라 밀린 것이다.
   그래서 같은 검색 결과를 진행률로 묶어 돌아가며 자른다(설계 §3 D4). /places 는 안 는다. */

test('앵커 둘이 15곳씩 가까이 채워도 세 번째 앵커의 후보가 목록에 산다 — 진행률 버킷마다 자리를 남긴다', async () => {
  // 앞 두 앵커는 100m 안에 15곳씩, 셋째는 300m 에 5곳. 도보순 한 줄이면 앞 30곳이 max 를 다 먹는다
  const three: Anchor[] = [
    anchor('a0', 'origin', 127.0),
    anchor('a1', 'board', 127.01),
    anchor('a3', 'alight', 127.49),
  ];
  const dense = (lng: number, tag: string): PlaceCandidate[] =>
    Array.from({ length: 15 }, (_, i) => ({ id: `${tag}${i}`, name: `CU ${tag}${i}`, coord: at(37.5009, lng + i * 0.00001) })); // ≈100m
  const sparse = Array.from({ length: 5 }, (_, i) =>
    ({ id: `s${i}`, name: `CU 삼성${i}`, coord: at(37.5027, 127.49 + i * 0.00001) })); // ≈300m
  const { fn } = catalogSearch([...dense(127.0, 'h'), ...dense(127.01, 'b'), ...sparse]);

  const r = await searchAtAnchors(three, 'CU', { need: 1, target: 8 }, fn);

  assert.equal(r.status, 'ok');
  assert.equal(r.candidates.length, 30);
  const third = r.candidates.filter(c => c.anchorId === 'a3');
  assert.ok(third.length >= 5, `셋째 앵커 후보가 ${third.length}곳 — 5곳 다 살아야 한다`);
  // 나머지 자리는 앞 두 앵커가 도보순으로 나눠 갖는다 — 한쪽이 독점하지 않는다
  const first = r.candidates.filter(c => c.anchorId === 'a0').length;
  const second = r.candidates.filter(c => c.anchorId === 'a1').length;
  assert.ok(first >= 10 && second >= 10, `a0 ${first} · a1 ${second}`);
});

test('회랑 5점 중 한 점에 40곳이 몰려도 다른 점의 후보가 산다', async () => {
  // 첫 표본점(127.0) 옆에 40곳이 경로 위(0~440m)에 있고, 넷째(127.375)·다섯째(127.5) 점엔
  // 550m 떨어진 곳이 3곳·2곳. 수직거리순 한 줄이면 30곳이 전부 첫 점 것이다
  const crowd = Array.from({ length: 40 }, (_, i) =>
    ({ id: `c${i}`, name: `c${i}`, coord: at(37.5 + i * 0.0001, 127.0) }));
  const later = [
    ...[0, 1, 2].map(i => ({ id: `d${i}`, name: `d${i}`, coord: at(37.505, 127.375 + i * 0.001) })),
    ...[0, 1].map(i => ({ id: `e${i}`, name: `e${i}`, coord: at(37.505, 127.499 - i * 0.001) })),
  ];
  const { fn } = catalogSearch([...crowd, ...later]);

  const r = await searchAlong(line2, '편의점', { need: 1, target: 8, initialRadiusM: 2000, maxRadiusM: 2000 }, fn);

  assert.equal(r.candidates.length, 30);
  const ids = new Set(r.candidates.map(c => c.id));
  for (const c of later) assert.ok(ids.has(c.id), `${c.id} 가 밀려났다: ${[...ids]}`);
  // 버킷 안 순서는 오늘 기준 그대로 — 첫 점 것은 수직거리순이다
  const crowdKept = r.candidates.filter(c => c.id.startsWith('c')).map(c => Number(c.id.slice(1)));
  assert.deepEqual(crowdKept, [...crowdKept].sort((a, b) => a - b));
});

test('side=end 면 그쪽 버킷을 먼저 채우되 반대쪽을 버리지 않는다', async () => {
  // 목적지 쪽 2곳, 출발지 쪽 5곳(첫 구간 2곳은 경로 위, 둘째 구간 것은 110m 옆).
  // 그쪽 먼저: n1·n2. 남은 두 자리는 반대쪽에서 **구간을 돌아가며** — 첫 구간이 더 가까워도 둘 다 주지 않는다
  const list: PlaceCandidate[] = [
    { id: 'f0a', name: 'f0a', coord: at2(127.0) },
    { id: 'f0b', name: 'f0b', coord: at2(127.001) },
    { id: 'f1a', name: 'f1a', coord: at(37.501, 127.125) },
    { id: 'f1b', name: 'f1b', coord: at(37.501, 127.126) },
    { id: 'f2a', name: 'f2a', coord: at2(127.25) },
    { id: 'n1', name: 'n1', coord: at2(127.495) },
    { id: 'n2', name: 'n2', coord: at(37.501, 127.49) },
  ];
  const fn = async (): Promise<PlaceCandidate[]> => list;

  const r = await searchAlong(line2, '마트', {
    need: 1, target: 1, initialRadiusM: 2000, maxRadiusM: 2000,
    max: 4, side: 'end', origin: O2, destination: D2,
  }, fn);

  assert.deepEqual(r.candidates.slice(0, 2).map(c => c.id), ['n1', 'n2'], '그쪽이 먼저다');
  assert.deepEqual(r.candidates.slice(2).map(c => c.id), ['f0a', 'f1a'], '반대쪽도 구간마다 한 곳씩');
});

test('spreadCut — 공급이 있는 버킷 B 개면 각각 최소 ⌊max / B⌋ 자리를 얻는다', () => {
  // 5 버킷 × 10곳, max 30 → 6곳씩. 순위 값이 버킷마다 겹쳐도(0~9) 버킷 간에 경합하지 않는다
  const list = Array.from({ length: 50 }, (_, i) => ({ id: i, bucket: i % 5, rank: Math.floor(i / 5), coord: at2(127.0) }));
  const out = spreadCut(list, c => c.bucket, c => c.rank, 30);
  assert.equal(out.length, 30);
  for (let b = 0; b < 5; b++) {
    assert.equal(out.filter(c => c.bucket === b).length, 6, `버킷 ${b}`);
  }
  // 버킷 안은 순위순이고 앞머리는 버킷을 진행 순으로 한 바퀴 돈다
  assert.deepEqual(out.slice(0, 5).map(c => c.bucket), [0, 1, 2, 3, 4]);
  assert.deepEqual(out.filter(c => c.bucket === 2).map(c => c.rank), [0, 1, 2, 3, 4, 5]);
});
