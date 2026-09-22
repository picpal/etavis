import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPolyline, polylineLengthM } from '../geo';
import { projectOnCorridor } from './corridor';
import { DEST_ID, LegStore, ORIGIN_ID } from './legs';
import { allClosedAtArrival, closedThroughout, isOpenAt, scorePlan, type ScoreContext } from './score';
import type { Mode, PlaceCandidate, Visit } from './types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km 동쪽
const poly = buildPolyline([O, D], 32);
const L = polylineLengthM(poly);
const c1: PlaceCandidate = { id: 'c1', name: 'c1', coord: { latitude: 37.5, longitude: 127.0568 } };
const c2: PlaceCandidate = { id: 'c2', name: 'c2', coord: { latitude: 37.5, longitude: 127.0852 } };
const cp = new Map([[c1.id, projectOnCorridor(poly, c1.coord)], [c2.id, projectOnCorridor(poly, c2.coord)]]);

function ctx(legs = new LegStore()): ScoreContext {
  return {
    origin: O, destination: D, corridorLengthM: L, rhoMinPerKm: 2, mode: 'car', departAtMin: 480, legs,
    corridorOf: id => cp.get(id)!,
  };
}
const v = (c: PlaceCandidate, dwellMin = 10): Visit => ({ slotId: c.id, candidate: c, dwellMin });

test('추정만으로 채점 — 경로 위 후보 1곳: 이동 ≈ 20분 + 체류 10분', () => {
  const s = scorePlan([v(c1)], ctx());
  assert.equal(s.unknownLegs, 2);
  assert.ok(Math.abs(s.totalMin - 30) < 1.5, `total=${s.totalMin}`);
  assert.equal(s.arrivals.length, 2);
  assert.ok(Math.abs(s.arrivals[0] - 490) < 1);
  assert.ok(Math.abs(s.arrivals[1] - 510) < 1.5);
});

test('실측 leg가 있으면 그 값을 쓰고 unknownLegs가 준다', () => {
  const legs = new LegStore();
  legs.add(ORIGIN_ID, 'c1', 'car', { durationMin: 13, distanceKm: 5, departAtMin: 480 });
  const s = scorePlan([v(c1)], ctx(legs));
  assert.equal(s.unknownLegs, 1);
  assert.equal(s.legsMin[0], 13);
  assert.equal(s.arrivals[0], 493);
});

test('불확실성은 합산된다', () => {
  const legs = new LegStore();
  legs.add(ORIGIN_ID, 'c1', 'car', { durationMin: 20, distanceKm: 5, departAtMin: 470 }); // Δ10 → 2분
  legs.add('c1', DEST_ID, 'car', { durationMin: 10, distanceKm: 5, departAtMin: 510 });    // c1 출발 = 480+20+10
  const s = scorePlan([v(c1)], ctx(legs));
  assert.equal(s.unknownLegs, 0);
  assert.equal(s.uncertaintyMin, 2);
});

test('두 곳 — 순서대로 도착시각이 누적된다', () => {
  const s = scorePlan([v(c1), v(c2, 5)], ctx());
  assert.equal(s.arrivals.length, 3);
  assert.ok(s.arrivals[0] < s.arrivals[1] && s.arrivals[1] < s.arrivals[2]);
});

test('isOpenAt — hours 없으면 열림, 자정 넘는 영업시간 처리', () => {
  assert.equal(isOpenAt(c1, 100), true);
  const day = { ...c1, hours: { openMin: 600, closeMin: 1320 } };
  assert.equal(isOpenAt(day, 599), false);
  assert.equal(isOpenAt(day, 600), true);
  assert.equal(isOpenAt(day, 1320), false);
  const night = { ...c1, hours: { openMin: 1200, closeMin: 120 } };
  assert.equal(isOpenAt(night, 30), true);
  assert.equal(isOpenAt(night, 600), false);
});

test('allClosedAtArrival — 도착 시각 기준', () => {
  const closed = { ...c1, hours: { openMin: 600, closeMin: 1320 } };
  const s = scorePlan([v(closed)], ctx()); // 도착 ≈ 490 < 600
  assert.equal(allClosedAtArrival(s), true);
});

/* burdenMin — 짐을 진 채 이동하는 시간.
   "마트 들렀다 약국 갔다 집"이 왜 불편한지를 숫자로 만드는 자리다.
   장을 본 뒤의 모든 구간이 짐 진 시간이고, 순서를 바꾸면 그게 줄어든다. */

const HARD_AFTER = { loadBefore: 'none', loadAfter: 'hard', needWhen: 'unknown' } as const;
const HARD_BEFORE = { loadBefore: 'hard', loadAfter: 'none', needWhen: 'unknown' } as const;
const NONE = { loadBefore: 'none', loadAfter: 'none', needWhen: 'unknown' } as const;

/** 두 순서를 같은 실측값으로 재려고 양방향 leg를 다 넣는다 */
function bothWays(mode: Mode = 'transit'): ScoreContext {
  const legs = new LegStore();
  // [c1, c2] 경로
  legs.add(ORIGIN_ID, 'c1', mode, { durationMin: 10, distanceKm: 5, departAtMin: 480 });
  legs.add('c1', 'c2', mode, { durationMin: 8, distanceKm: 4, departAtMin: 500 });
  legs.add('c2', DEST_ID, mode, { durationMin: 6, distanceKm: 3, departAtMin: 518 });
  // [c2, c1] 경로
  legs.add(ORIGIN_ID, 'c2', mode, { durationMin: 12, distanceKm: 6, departAtMin: 480 });
  legs.add('c2', 'c1', mode, { durationMin: 8, distanceKm: 4, departAtMin: 502 });
  legs.add('c1', DEST_ID, mode, { durationMin: 9, distanceKm: 5, departAtMin: 520 });
  return { ...ctx(legs), mode };
}

test('태그를 안 주면 짐이 없다 — 지금 동작을 안 바꾼다', () => {
  const s = scorePlan([v(c1), v(c2)], bothWays());
  assert.equal(s.burdenMin, 0);
});

test('loadAfter=hard 면 그 경유지 이후의 모든 구간이 짐 진 시간이다', () => {
  const c = { ...bothWays(), tagsOf: (id: string) => (id === 'c1' ? HARD_AFTER : NONE) };
  const s = scorePlan([v(c1), v(c2)], c);
  // c1 에서 짐이 생긴다 → c1→c2(8) + c2→D(6)
  assert.equal(s.burdenMin, 14);
});

test('순서를 바꾸면 짐 진 시간이 준다 — 이 기능의 요점', () => {
  const tagsOf = (id: string) => (id === 'c1' ? HARD_AFTER : NONE);
  const first = scorePlan([v(c1), v(c2)], { ...bothWays(), tagsOf });
  const last = scorePlan([v(c2), v(c1)], { ...bothWays(), tagsOf });

  assert.equal(first.burdenMin, 14, '짐 생기는 곳을 먼저 들르면 끝까지 들고 간다');
  assert.equal(last.burdenMin, 9, '나중에 들르면 집까지 한 구간만');
  assert.ok(last.totalMin > first.totalMin, '대신 시간은 더 걸린다 — 맞바꿈이 있어야 선택이 의미가 있다');
});

test('loadBefore=hard 면 그 경유지까지의 구간이 짐 진 시간이다 — 맡기면 홀가분해진다', () => {
  const c = { ...bothWays(), tagsOf: (id: string) => (id === 'c2' ? HARD_BEFORE : NONE) };
  const s = scorePlan([v(c1), v(c2)], c);
  // 출발부터 c2 까지 들고 간다 → O→c1(10) + c1→c2(8)
  assert.equal(s.burdenMin, 18);
});

test('짐이 둘이면 겹치는 구간은 두 번 세진다 — 둘을 같이 들고 있다', () => {
  const c = { ...bothWays(), tagsOf: () => HARD_AFTER };
  const s = scorePlan([v(c1), v(c2)], c);
  // c1 이후(8+6=14) + c2 이후(6) = 20
  assert.equal(s.burdenMin, 20);
});

test('마지막 경유지에서 짐이 생기면 목적지까지 한 구간뿐이다', () => {
  const c = { ...bothWays(), tagsOf: (id: string) => (id === 'c2' ? HARD_AFTER : NONE) };
  const s = scorePlan([v(c1), v(c2)], c);
  assert.equal(s.burdenMin, 6);
});

test('자동차면 짐이 0 이다 — 트렁크에 실으면 그만이다', () => {
  const c = { ...bothWays('car'), tagsOf: () => HARD_AFTER };
  const s = scorePlan([v(c1), v(c2)], c);
  assert.equal(s.burdenMin, 0, 'decideNear 가 차를 일찍 빼는 것과 같은 이유다');
});

test('도보도 짐을 센다 — 걸어서 드는 게 제일 힘들다', () => {
  const c = { ...bothWays('walk'), tagsOf: (id: string) => (id === 'c1' ? HARD_AFTER : NONE) };
  assert.equal(scorePlan([v(c1), v(c2)], c).burdenMin, 14);
});

/** 창 내내 닫힘 — 도착 시각을 모르는 채로도 "어떤 순서로도 못 들른다"만 가린다 */
const hours = (openMin: number, closeMin: number) => ({ hours: { openMin, closeMin } });

test('창 내내 닫힌 곳은 닫힘이다 — 밤 11시에 떠나는데 9시에 닫는 가게', () => {
  // 23:00 출발 ~ 23:40 도착 기한, 가게는 10:00~21:00
  assert.equal(closedThroughout(hours(600, 1260), 23 * 60, 23 * 60 + 40), true);
});

test('창이 영업 시간에 1분이라도 걸치면 닫힘이 아니다 — 문 닫기 직전도 들를 수 있다', () => {
  // 20:59 에 출발, 가게는 21:00 마감 — 20:59 한 분이 겹친다
  assert.equal(closedThroughout(hours(600, 1260), 20 * 60 + 50, 21 * 60 + 30), false);
  // 여는 순간에 창이 끝나도 겹친다 — 10:00 에 문이 열리고 창의 끝이 10:00
  assert.equal(closedThroughout(hours(600, 1260), 9 * 60, 10 * 60), false);
});

test('영업시간을 모르는 곳은 안 거른다 — 모름은 닫힘이 아니다(F6 와 같은 규칙)', () => {
  assert.equal(closedThroughout({}, 23 * 60, 23 * 60 + 40), false);
  assert.equal(closedThroughout(hours(600, 600), 23 * 60, 23 * 60 + 40), false, 'openMin === closeMin 은 0분인지 24시간인지 모른다');
});

test('자정을 넘는 영업은 자정 넘는 창과 겹친다 — 새벽 1시의 편의점', () => {
  // 22:00~06:00 영업, 창은 00:30~01:10(= 다음 날이라 1470~1510 분)
  assert.equal(closedThroughout(hours(1320, 360), 1470, 1510), false);
  // 같은 가게, 창은 오후 3시 — 이때는 닫혀 있다
  assert.equal(closedThroughout(hours(1320, 360), 15 * 60, 15 * 60 + 40), true);
});

test('창이 자정을 넘으면 다음 날 영업까지 본다 — 23:50 출발 10:20 도착은 안 거른다', () => {
  // 10:00~21:00 영업, 창 23:50~(다음 날) 10:20 → 다음 날 10:00~10:20 이 겹친다
  assert.equal(closedThroughout(hours(600, 1260), 23 * 60 + 50, 24 * 60 + 10 * 60 + 20), false);
});

test('하루보다 긴 창은 무엇도 안 거른다 — 언젠가는 연다', () => {
  assert.equal(closedThroughout(hours(600, 1260), 0, 1500), false);
});
