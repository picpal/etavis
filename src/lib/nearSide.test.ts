import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNear, decideNear, matchesNear, NEAR_RADII_M, NEAR_TARGET } from './nearSide.ts';
import type { Load, NeedWhen } from './nearSide.ts';
import type { LatLng, Mode, NearSide } from './routePlan/types.ts';

/** 위도 37.5 위의 동서 직선. 127.0 이 출발지, 127.1 이 목적지 — 경도가 곧 진행률이다 */
const at = (lng: number): LatLng => ({ latitude: 37.5, longitude: lng });

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

const O = at(127.0);
const D = at(127.5);
/** D 에서 서쪽으로 m 미터쯤 — 경도 0.01° ≈ 883m */
const nearD = (m: number) => at(127.5 - m / 88300);
const c = (id: string, coord: LatLng) => ({ id, coord });

test('그쪽에 충분하면 좁힌 결과를 준다', () => {
  const list = [c('a', nearD(200)), c('b', nearD(400)), c('c', nearD(600)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['a', 'b', 'c']);
  assert.equal(r.relaxed, false);
  assert.equal(r.radiusM, 1500);
});

test('1500m 에 모자라면 3000m 로 넓힌다', () => {
  const list = [c('a', nearD(200)), c('b', nearD(2000)), c('c', nearD(2500)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['a', 'b', 'c']);
  assert.equal(r.radiusM, 3000);
});

// 이 설계의 1순위 동기다. 현행 코드는 여기서 완화를 안 돌린다
test('need=1 이어도 그쪽 후보가 NEAR_TARGET 미만이면 완화한다', () => {
  const list = [c('a', nearD(200)), c('x', at(127.0)), c('y', at(127.01)),
                c('z', at(127.02)), c('w', at(127.03))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.equal(r.relaxed, true);
  assert.equal(r.candidates.length, 5);
  assert.equal(r.radiusM, null);
});

test('후보 총수가 NEAR_TARGET 보다 적으면 near 가 원인이 아니다 — 좁힌 결과를 쓴다', () => {
  const list = [c('a', nearD(200)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['a']);
  assert.equal(r.relaxed, false);
});

test('형제 슬롯이 셋이면 셋을 요구한다', () => {
  const list = [c('a', nearD(200)), c('b', nearD(400)), c('x', at(127.0))];
  const r = applyNear(list, 'end', O, D, 3);
  assert.equal(r.relaxed, true); // 그쪽 2개 < 요구 3개, 총수 3개 ≥ 3 이라 예외도 안 걸린다
});

test('any 는 손대지 않는다', () => {
  const list = [c('a', nearD(200)), c('x', at(127.0))];
  const r = applyNear(list, 'any', O, D, 1);
  assert.equal(r.candidates.length, 2);
  assert.equal(r.relaxed, false);
  assert.equal(r.radiusM, null);
});

test('입력 순서를 보존한다 — 앞 단계(주차 정책)의 우선순위를 뒤집지 않는다', () => {
  const list = [c('c', nearD(600)), c('a', nearD(200)), c('b', nearD(400))];
  const r = applyNear(list, 'end', O, D, 1);
  assert.deepEqual(r.candidates.map(v => v.id), ['c', 'a', 'b']);
});

test('NEAR_TARGET 은 3 이다', () => {
  assert.equal(NEAR_TARGET, 3);
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
