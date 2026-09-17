import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNear, decideNear, matchesNear, NEAR_RADII_M } from './nearSide.ts';
import type { Load, NeedWhen } from './nearSide.ts';
import type { LatLng, Mode, NearSide } from './routePlan/types.ts';

/** 위도 37.5 위의 동서 직선. 127.0 이 출발지, 127.1 이 목적지 — 경도가 곧 진행률이다 */
const at = (lng: number): LatLng => ({ latitude: 37.5, longitude: lng });
const poly: LatLng[] = [at(127.0), at(127.1)];
const c = (id: string, lng: number) => ({ id, coord: at(lng) });
const startSide = c('s1', 127.01); // s ≈ 0.1
const middle = c('m1', 127.05);    // s ≈ 0.5
const endSide = c('e1', 127.09);   // s ≈ 0.9

test('절대 거리 — 짧은 경로에서 목적지 1km 안은 end 다', () => {
  const o = at(127.0), d = at(127.02); // 약 1.77km
  assert.equal(matchesNear('end', at(127.019), o, d, 1500), true);
  assert.equal(matchesNear('end', at(127.0), o, d, 1500), false);
});

test('절대 거리 — 긴 경로에서 진행률 0.6 지점은 end 가 아니다', () => {
  const o = at(127.0), d = at(127.5); // 약 44km. s=0.6 은 127.3
  assert.equal(matchesNear('end', at(127.3), o, d, 1500), false);
  assert.equal(matchesNear('end', at(127.495), o, d, 1500), true);
});

test('start 는 출발지 기준이다', () => {
  const o = at(127.0), d = at(127.5);
  assert.equal(matchesNear('start', at(127.005), o, d, 1500), true);
  assert.equal(matchesNear('start', at(127.3), o, d, 1500), false);
});

test('any 는 언제나 통과한다', () => {
  assert.equal(matchesNear('any', at(127.3), at(127.0), at(127.5), 1500), true);
});

test('반경 단계는 넓어지는 순서다', () => {
  assert.deepEqual([...NEAR_RADII_M], [1500, 3000]);
});

test("applyNear('end') — 목적지 쪽 후보만 남는다", () => {
  const r = applyNear([startSide, middle, endSide], 'end', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['e1']);
  assert.equal(r.relaxed, false);
});

test("applyNear('start') — 출발지 쪽 후보만 남는다", () => {
  const r = applyNear([startSide, middle, endSide], 'start', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1']);
  assert.equal(r.relaxed, false);
});

test("applyNear('any') — 손대지 않는다", () => {
  const r = applyNear([startSide, middle, endSide], 'any', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1', 'm1', 'e1']);
  assert.equal(r.relaxed, false);
});

test('그쪽에 한 곳도 없으면 전부 남기고 relaxed — 경유지가 증발하면 안 된다', () => {
  const r = applyNear([startSide, middle], 'end', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1', 'm1'], '제약을 풀고 되돌린다');
  assert.equal(r.relaxed, true);
});

test('순서를 보존한다 — 앞 단계(주차 정책)가 매긴 우선순위를 뒤집지 않는다', () => {
  const e2 = c('e2', 127.08);
  const r = applyNear([e2, endSide], 'end', poly);
  assert.deepEqual(r.candidates.map(x => x.id), ['e2', 'e1']);
});

test('후보가 아예 없으면 relaxed 는 false — 못 찾은 것과 밀려난 것은 다른 사건이다', () => {
  const r = applyNear([], 'end', poly);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.relaxed, false);
});

test('폴리라인이 2점 미만이면 진행률을 못 잰다 — 조용히 통과시킨다', () => {
  const r = applyNear([startSide, endSide], 'end', [at(127.0)]);
  assert.deepEqual(r.candidates.map(x => x.id), ['s1', 'e1']);
  assert.equal(r.relaxed, false, '못 잰 걸 "못 찾았다"고 말하면 거짓말이 된다');
});

const tags = (lb: Load, la: Load, nw: NeedWhen) => ({ loadBefore: lb, loadAfter: la, needWhen: nw });

const TABLE: [string, NearSide | undefined, Mode, Load, Load, NeedWhen, NearSide][] = [
  ['택배 부치고 회사',      undefined, 'transit', 'hard', 'none', 'unknown',       'start'],
  ['걸어가며 먹을 아이스크림', undefined, 'walk',    'none', 'hard', 'beforeArrival', 'start'],
  ['텀블러 커피',           undefined, 'transit', 'none', 'hard', 'beforeArrival', 'start'],
  ['카페에서 충전',         undefined, 'transit', 'none', 'none', 'beforeArrival', 'start'],
  ['우산',                 undefined, 'transit', 'none', 'none', 'beforeArrival', 'start'],
  ['세탁물 맡기고 회사',     undefined, 'transit', 'hard', 'none', 'unknown',       'start'],
  ['장보고 집 (지하철)',     undefined, 'transit', 'none', 'hard', 'afterArrival',  'end'],
  ['장보고 집 (도보)',       undefined, 'walk',    'none', 'hard', 'afterArrival',  'end'],
  ['커피 사서 회사 (말 안 함)', undefined, 'transit', 'none', 'hard', 'unknown',     'end'],
  ['꽃 사서 식장',          undefined, 'transit', 'none', 'hard', 'afterArrival',  'end'],
  ['세탁물 찾아 집',        undefined, 'transit', 'none', 'hard', 'afterArrival',  'end'],
  ['은행',                 undefined, 'transit', 'none', 'none', 'unknown',       'any'],
  ['장보고 집 (자동차)',     undefined, 'car',     'none', 'hard', 'afterArrival',  'any'],
  ['택배 부치고 도착해서 쓸 것도 사기', undefined, 'transit', 'hard', 'hard', 'afterArrival', 'start'],
];

for (const [name, stated, mode, lb, la, nw, want] of TABLE) {
  test(`decideNear — ${name} → ${want}`, () => {
    assert.equal(decideNear(stated, mode, tags(lb, la, nw)), want);
  });
}

test('사용자가 말한 위치가 태그를 이긴다', () => {
  assert.equal(decideNear('start', 'transit', tags('none', 'hard', 'afterArrival')), 'start');
  assert.equal(decideNear('end', 'transit', tags('hard', 'none', 'beforeArrival')), 'end');
});

test('자동차여도 사용자가 말했으면 지킨다', () => {
  assert.equal(decideNear('end', 'car', tags('none', 'none', 'unknown')), 'end');
});
