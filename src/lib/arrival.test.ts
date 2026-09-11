import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialArrivalState,
  profileFor,
  stepArrival,
  type ArrivalContext,
  type ArrivalState,
  type Fix,
  type Point,
} from './arrival.ts';
import type { LatLng } from '../data/mockData.ts';

// 여의도 올리브영 근처. 북쪽으로 m미터 이동 = 위도 + m/111320
const O: LatLng = { latitude: 37.5219, longitude: 126.9245 };
const north = (p: LatLng, m: number): LatLng => ({ latitude: p.latitude + m / 111_320, longitude: p.longitude });

const T: Point = { id: 'olive', coord: O };
const N: Point = { id: 'hcard', coord: north(O, 200) };
const D: Point = { id: 'D', coord: north(O, 3000) };

const fix = (p: LatLng, speedMps: number | null = 0.5, accuracyM: number | null = 30): Fix => ({ ...p, speedMps, accuracyM });
const car = profileFor(false, 'car');
const walk = profileFor(false, 'walk');

/** 샘플을 순서대로 넣고 단계 결과 배열을 돌려준다 */
function run(fixes: Fix[], ctx: ArrivalContext, s: ArrivalState = initialArrivalState) {
  const out = [];
  for (const f of fixes) {
    const r = stepArrival(s, f, ctx);
    s = r.state;
    out.push(r);
  }
  return out;
}
const kinds = (r: ReturnType<typeof stepArrival>) => r.events.map(e => `${e.kind}:${e.id}`);

test('프로필: car 150/250, walk·transit 80, sim 400/600 1샘플', () => {
  assert.equal(car.arriveBaseM, 150);
  assert.equal(car.departBaseM, 250);
  assert.equal(car.arriveSamples, 3);
  assert.equal(car.departSamples, 2);
  assert.equal(car.maxAccuracyM, 100);
  assert.equal(car.stationaryMps, 2);
  assert.equal(walk.arriveBaseM, 80);
  assert.equal(walk.stationaryMps, 1);
  assert.equal(profileFor(false, 'transit').arriveBaseM, 80);
  const sim = profileFor(true, 'car');
  assert.equal(sim.arriveBaseM, 400);
  assert.equal(sim.departBaseM, 600);
  assert.equal(sim.arriveSamples, 1);
  assert.equal(sim.departSamples, 1);
  assert.equal(sim.maxAccuracyM, null);
});

test('지나치기: 반경 안이라도 속도 8m/s면 도착 아님', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: walk };
  const rs = run([fix(north(O, 40), 8), fix(north(O, 20), 8), fix(north(O, 60), 8)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], []]);
});

test('도착: 반경 안 연속 3샘플 + 정지 → 3번째에서 arrive', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(north(O, 40)), fix(north(O, 30)), fix(north(O, 35))], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
  assert.equal(rs[2].state.arrivedId, 'olive');
});

test('도착: 중간에 반경 밖 샘플이 끼면 처음부터 다시 센다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(north(O, 40)), fix(north(O, 30)), fix(north(O, -400)), fix(north(O, 20)), fix(north(O, 10))], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], [], [], []]);
  assert.equal(rs[4].state.arriveStreak, 2);
});

test('정확도: 100m 넘는 샘플은 무시하고 streak을 유지한다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(north(O, 40)), fix(north(O, 30), 0.5, 180), fix(north(O, 30)), fix(north(O, 35))], ctx);
  assert.equal(rs[1].ignored, 'accuracy');
  assert.equal(rs[1].state.arriveStreak, 1);
  assert.deepEqual(rs.map(kinds), [[], [], [], ['arrive:olive']]);
});

test('정확도: 반경보다 나쁘면(100m 이하) 반경을 정확도만큼 넓힌다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: walk };
  // walk 반경 80m인데 정확도 95m — 90m 지점도 반경 안으로 친다
  const r = stepArrival(initialArrivalState, fix(north(O, 90), 0.5, 95), ctx);
  assert.equal(r.arriveR, 95);
  assert.equal(r.state.arriveStreak, 1);
});

test('출발 반경 = 다음 지점 거리/2 (200m면 100m), 밖 2샘플이면 depart', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  // 남쪽(다음 지점 반대편)으로 130m — 옛 반경 250m로는 영영 출발이 안 잡히던 거리
  const rs = run([fix(north(O, -130), 3), fix(north(O, -130), 3)], ctx, s);
  assert.ok(Math.abs(rs[0].departR - 100) < 1);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive']]);
  assert.equal(rs[1].state.departedId, 'olive');
});

test('출발 반경은 50m 바닥, 250m 천장', () => {
  const near: Point = { id: 'n', coord: north(O, 60) };
  const far: Point = { id: 'f', coord: north(O, 5000) };
  const a = stepArrival(initialArrivalState, fix(O), { target: T, next: near, atStop: true, profile: car });
  assert.equal(a.departR, 50);
  const b = stepArrival(initialArrivalState, fix(O), { target: T, next: far, atStop: true, profile: car });
  assert.equal(b.departR, 250);
  const c = stepArrival(initialArrivalState, fix(O), { target: T, next: null, atStop: true, profile: car });
  assert.equal(c.departR, 250);
});

test('선행 도착: 체류 중에 다음 지점 반경 안 3샘플 → depart + arrive', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  const at = north(O, 190);
  const rs = run([fix(at), fix(at), fix(at)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], [], ['depart:olive', 'arrive:hcard']]);
});

test('선행 도착: 체류 전이면 skip + arrive (순서 강제 해제)', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const at = north(O, 190);
  const rs = run([fix(at), fix(at), fix(at)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['skip:olive', 'arrive:hcard']]);
});

test('두 반경이 겹치면 더 가까운 쪽으로 센다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  // target에서 60m, next에서 140m — 둘 다 150m 안이지만 target이 가깝다
  const rs = run([fix(north(O, 60)), fix(north(O, 60)), fix(north(O, 60))], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
});

test('목적지: 경유지가 끝나면 target=D, next=null로 도착을 잡는다', () => {
  const ctx: ArrivalContext = { target: D, next: null, atStop: false, profile: car };
  const at = north(O, 3010);
  const rs = run([fix(at), fix(at), fix(at)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:D']]);
});

test('target이 없으면 아무 이벤트도 없다', () => {
  const r = stepArrival(initialArrivalState, fix(O), { target: null, next: null, atStop: false, profile: car });
  assert.deepEqual(r.events, []);
  assert.equal(r.distToTargetM, null);
});

test('중복: 이미 도착을 낸 지점은 dispatch 반영 전 샘플에서 다시 내지 않는다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const rs = run([fix(O), fix(O), fix(O), fix(O), fix(O)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive'], [], []]);
});

test('중복: 이미 출발을 낸 지점은 다시 내지 않는다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  const rs = run([fix(north(O, -130), 3), fix(north(O, -130), 3), fix(north(O, -130), 3)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive'], []]);
});

test('속도를 모르면(null) 멈춘 것으로 본다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const rs = run([fix(O, null), fix(O, null), fix(O, null)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
});

test('sim 프로필: 1샘플로 도착, 속도 검사 없음, 정확도 무시 없음', () => {
  const sim = profileFor(true, 'car');
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: sim };
  const r = stepArrival(initialArrivalState, fix(north(O, 300), 25, 500), ctx);
  assert.equal(r.ignored, null);
  assert.equal(r.arriveR, 500); // 정확도가 반경보다 나쁘면 반경이 그만큼 넓어진다
  assert.deepEqual(kinds(r), ['arrive:olive']);
});
