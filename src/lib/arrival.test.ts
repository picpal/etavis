import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialArrivalState,
  profileFor,
  stepArrival,
  NOISE_FLOOR_M,
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

/** 시각이 명시되지 않은 샘플은 1초 간격으로 들어온 것으로 본다 */
let clock = 0;
const fix = (p: LatLng, speedMps: number | null = 0.5, accuracyM: number | null = 30): Fix => ({
  ...p,
  speedMps,
  accuracyM,
  atMs: (clock += 1000),
});
/** 시각이 판정에 쓰이는 테스트용 — 실효 속도·체류 시계 */
const fixAt = (p: LatLng, atMs: number, speedMps: number | null = 0.5, accuracyM: number | null = 30): Fix => ({
  ...p,
  speedMps,
  accuracyM,
  atMs,
});

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
  assert.equal(car.visitDwellMs, 90_000);
  assert.equal(walk.arriveBaseM, 80);
  assert.equal(walk.stationaryMps, 1);
  assert.equal(walk.visitDwellMs, 90_000);
  assert.equal(profileFor(false, 'transit').arriveBaseM, 80);
  const sim = profileFor(true, 'car');
  assert.equal(sim.arriveBaseM, 400);
  assert.equal(sim.departBaseM, 600);
  assert.equal(sim.arriveSamples, 1);
  assert.equal(sim.departSamples, 1);
  assert.equal(sim.maxAccuracyM, null);
  // 가상 주행은 틱이 1.5초라 90초를 요구하면 시뮬레이션이 영영 안 끝난다
  assert.equal(sim.visitDwellMs, 3_000);
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

test('출발 반경은 다음 지점이 가까우면 좁아진다 — 다만 도착 반경 아래로는 안 내려간다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const s: ArrivalState = { ...initialArrivalState, arrivedId: 'olive' };
  /* 다음 지점이 200m 앞이라 gap/2 = 100m 지만, 그대로 쓰면 도착 반경(150m)보다 좁아
     도착한 자리가 곧 출발이 된다. 그래서 150m 로 올라간다 — 260m 는 나가야 떠난 것이다 */
  const rs = run([fix(north(O, -260), 3), fix(north(O, -260), 3)], ctx, s);
  assert.equal(rs[0].departR, 150);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive']]);
  assert.equal(rs[1].state.departedId, 'olive');
});

test('출발 반경은 도착 반경이 바닥, 250m 천장', () => {
  const near: Point = { id: 'n', coord: north(O, 60) };
  const far: Point = { id: 'f', coord: north(O, 5000) };
  // gap/2 = 30m → DEPART_FLOOR_M(50) 로 올라가고, 다시 도착 반경(150)까지 올라간다
  const a = stepArrival(initialArrivalState, fix(O), { target: T, next: near, atStop: true, profile: car });
  assert.equal(a.departR, 150);
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
  const rs = run([fix(north(O, -260), 3), fix(north(O, -260), 3), fix(north(O, -260), 3)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive'], []]);
});

test('중복: 선행 도착을 낸 뒤 같은 상태의 샘플이 더 와도 다시 내지 않는다', () => {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile: car };
  const at = north(O, 190);
  const rs = run([fix(at), fix(at), fix(at), fix(at), fix(at)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['skip:olive', 'arrive:hcard'], [], []]);
});

test('속도를 모르면 좌표로 잰다 — 첫 샘플은 기준점이 없으니 이동 중으로 보고 한 박자 늦게 도착한다', () => {
  // 예전엔 speed=null이 곧 '멈춤'이라 3샘플로 끝났다. 이제 근거가 없는 첫 샘플은 이동 중이다.
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const rs = run([fix(O, null), fix(O, null), fix(O, null), fix(O, null)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], [], ['arrive:olive']]);
});

test('sim 프로필: 1샘플로 도착, 속도 검사 없음, 정확도 무시 없음', () => {
  const sim = profileFor(true, 'car');
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: sim };
  const r = stepArrival(initialArrivalState, fix(north(O, 300), 25, 500), ctx);
  assert.equal(r.ignored, null);
  assert.equal(r.arriveR, 500); // 정확도가 반경보다 나쁘면 반경이 그만큼 넓어진다
  assert.deepEqual(kinds(r), ['arrive:olive']);
});

/* ── 회귀: 속도를 모를 때 좌표로 직접 잰다 ───────────────────────────── */

test('회귀: 속도 null이어도 좌표가 시속 50km로 움직이면 반경 안 3샘플이라도 도착이 아니다', () => {
  // 실기기 버그 — iOS의 -1이 null이 되어 정지 방어선이 통째로 꺼졌고, 가게 100m 옆을
  // 차로 지나가기만 해도 방문 처리됐다.
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const rs = run(
    [
      fixAt(north(O, 140), 0, null),
      fixAt(north(O, 70), 5_000, null), // 5초에 70m = 14m/s ≈ 시속 50km
      fixAt(O, 10_000, null),
      fixAt(north(O, -70), 15_000, null),
    ],
    ctx,
  );
  assert.deepEqual(rs.map(kinds), [[], [], [], []]);
});

test('속도 null이어도 감속해 좌표가 거의 안 움직이면 도착을 잡는다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const rs = run(
    [
      fixAt(north(O, 40), 0, null), // 기준점 없음 → 이동 중
      fixAt(north(O, 38), 5_000, null),
      fixAt(north(O, 39), 10_000, null),
      fixAt(north(O, 37), 15_000, null),
    ],
    ctx,
  );
  assert.deepEqual(rs.map(kinds), [[], [], [], ['arrive:olive']]);
});

test('회귀: 정차 중 GPS 지터(20m, 정확도 30)는 이동이 아니다 — 노이즈 바닥이 없으면 시속 72km로 읽힌다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const jitter = [north(O, 0), north(O, 20), north(O, 0), north(O, 20)];
  const rs = run(jitter.map((p, i) => fixAt(p, i * 1_000, null, 30)), ctx);
  assert.deepEqual(rs.map(kinds), [[], [], [], ['arrive:olive']]);
  assert.equal(NOISE_FLOOR_M, 25);
});

test('speedMps가 실려 있으면 좌표로 잰 값보다 그 값을 우선한다', () => {
  // 좌표만 보면 1초에 100m(시속 360km)지만, 기기가 0.5m/s라고 하면 그 말을 믿는다
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const rs = run([fixAt(north(O, 140), 0, 0.5), fixAt(north(O, 40), 1_000, 0.5), fixAt(north(O, -60), 2_000, 0.5)], ctx);
  assert.deepEqual(rs.map(kinds), [[], [], ['arrive:olive']]);
});

test('정확도로 버린 샘플은 실효 속도의 기준점이 되지 않는다', () => {
  const ctx: ArrivalContext = { target: T, next: null, atStop: false, profile: car };
  const good = fixAt(north(O, 40), 0, null, 30);
  const bad = fixAt(north(O, -2_000), 1_000, null, 180); // 버려질 샘플
  const rs = run(
    [good, bad, fixAt(north(O, 41), 2_000, null, 30), fixAt(north(O, 39), 3_000, null, 30), fixAt(north(O, 40), 4_000, null, 30)],
    ctx,
  );
  assert.equal(rs[1].ignored, 'accuracy');
  // 버린 샘플이 기준점이 됐다면 3번째 샘플이 2km를 1초에 간 셈이 되어 도착을 못 잡는다
  assert.deepEqual(rs[1].state.prev, { coord: { latitude: good.latitude, longitude: good.longitude }, atMs: 0, accuracyM: 30 });
  assert.deepEqual(rs.map(kinds), [[], [], [], [], ['arrive:olive']]);
});

/* ── 방문 확정(visit) ─────────────────────────────────────────────── */

/** 도착까지 진행한 상태를 만들어 준다 (atStop=false 구간) */
function arriveAt(profile = car) {
  const ctx: ArrivalContext = { target: T, next: N, atStop: false, profile };
  const rs = run([fixAt(O, 1_000), fixAt(O, 2_000), fixAt(O, 3_000)], ctx);
  assert.deepEqual(kinds(rs[2]), ['arrive:olive']);
  return rs[2].state;
}

test('방문: 잠정 도착 뒤 90초를 더 머물러야 visit이 난다', () => {
  const s = arriveAt();
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const rs = run([fixAt(O, 60_000), fixAt(O, 92_999), fixAt(O, 93_000)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], [], ['visit:olive']]);
});

test('방문: visit은 한 번만 난다 — 계속 머물러도 다시 내지 않는다', () => {
  const s = arriveAt();
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const rs = run([fixAt(O, 93_000), fixAt(O, 94_000), fixAt(O, 200_000)], ctx, s);
  assert.deepEqual(rs.map(kinds), [['visit:olive'], [], []]);
  assert.equal(rs[2].state.visitedId, 'olive');
});

test('방문: 체류 시간을 채우기 전에 떠나면 depart만 나고 visit은 없다 — 스쳐 간 것과 들른 것의 구분', () => {
  const s = arriveAt();
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  // 출발 반경은 도착 반경(150m) 아래로 안 내려가므로, 떠나려면 그보다 멀리 나가야 한다
  const rs = run([fixAt(north(O, -260), 10_000, 3), fixAt(north(O, -260), 11_000, 3), fixAt(north(O, -260), 120_000, 3)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], ['depart:olive'], []]);
  assert.equal(rs[1].state.dwellId, null);
  assert.equal(rs[2].state.visitedId, null);
});

test('방문: 한 샘플이 노이즈로 반경을 벗어나도 체류 시계는 초기화되지 않는다', () => {
  const s = arriveAt();
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  // 60초쯤에 160m 튄 샘플 하나(반경 150m 밖) — departSamples=2라 출발로 굳지 않는다
  const rs = run([fixAt(north(O, 160), 60_000, 0.5), fixAt(O, 93_000)], ctx, s);
  assert.deepEqual(rs.map(kinds), [[], ['visit:olive']]);
});

test('회귀: 출발 반경은 도착 반경보다 좁아지지 않는다 — 안 그러면 도착한 자리가 곧 출발이 된다', () => {
  /* 다음 지점이 200m 앞이라 gap/2 = 100m. 옛 코드는 그걸 그대로 써서 departR(100) < arriveR(150) 이었고,
     도착을 인정한 130m 지점이 다음 샘플에서 곧바로 '떠났다'가 됐다 — 체류 시계가 돌 틈이 없었다.
     2026-09-20 가상 주행에서 실측(arriveR 400 · departR 86)해 잡은 결함 */
  const ctx: ArrivalContext = { target: T, next: N, atStop: true, profile: car };
  const r = run([fixAt(north(O, -130), 10_000, 3)], ctx, arriveAt())[0];
  assert.ok(r.departR >= r.arriveR, `departR(${r.departR}) 가 arriveR(${r.arriveR}) 보다 작다`);
  assert.deepEqual(kinds(r), []);
});
