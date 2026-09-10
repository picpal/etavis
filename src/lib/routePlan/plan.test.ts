import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from './mockProvider';
import { plan } from './plan';
import type { PlaceCandidate, PlanInput, Slot } from './types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km 동쪽
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, coord: { latitude: number; longitude: number }, extra: Partial<PlaceCandidate> = {}): PlaceCandidate =>
  ({ id, name: id, coord, ...extra });
const slot = (id: string, candidates: PlaceCandidate[], extra: Partial<Slot> = {}): Slot =>
  ({ id, query: id, candidates, dwellMin: 10, count: 1, flexible: true, openNow: false, ...extra });
const base = (slots: Slot[], extra: Partial<PlanInput> = {}): PlanInput =>
  ({ origin: O, destination: D, departAtMin: 480, mode: 'car', slots, order: 'auto', ...extra });

// 회랑 위(on), 살짝 북쪽(near), 멀리 남쪽(far)
const on = c('on', at(37.5, 127.05));
const near = c('near', at(37.505, 127.07));
const far = c('far', at(37.45, 127.06));

test('V=1 — 후보 전부 실측, 1안은 회랑 위 후보, apiCalls = 1 + K', async () => {
  const p = mockRouteProvider();
  const r = await plan(base([slot('a', [far, near, on])]), p);
  assert.equal(r.apiCalls, 4);
  assert.equal(r.options[0].visits[0].candidate.id, 'on');
  assert.ok(r.directMin > 0);
  assert.equal(r.options[0].deltaMin, r.options[0].totalMin - r.directMin);
  assert.equal(r.slotStatus.a, 'ok');
});

test('V=1 — 대안은 실측값이라 estimated=false, addedMin은 1안 대비', async () => {
  const r = await plan(base([slot('a', [far, near, on])]), mockRouteProvider());
  const alts = r.alternatives.filter(x => x.slotId === 'a');
  assert.equal(alts.length, 2);
  assert.ok(alts.every(x => !x.estimated && x.addedMin > 0));
  assert.ok(alts.find(x => x.candidate.id === 'far')!.addedMin > alts.find(x => x.candidate.id === 'near')!.addedMin);
});

test('V=2 — 직행 1 + R=4, 옵션 ≤ 3, 모든 옵션은 실측', async () => {
  const p = mockRouteProvider();
  const b1 = c('b1', at(37.5, 127.09));
  const b2 = c('b2', at(37.495, 127.08));
  const r = await plan(base([slot('a', [on, near, far]), slot('b', [b1, b2])]), p, { R: 4 });
  assert.ok(r.apiCalls >= 5 && r.apiCalls <= 8, `calls=${r.apiCalls}`);
  assert.ok(r.options.length >= 1 && r.options.length <= 3);
  assert.equal(r.options[0].visits.length, 2);
  for (const o of r.options) assert.equal(o.arrivals.length, 3);
});

test('장벽(강) — 추정이 틀리면 2라운드가 돈다', async () => {
  // 회랑 남쪽에 강. across는 강 건너라 추정보다 훨씬 오래 걸린다
  const barrier = { a: at(37.49, 126.9), b: at(37.49, 127.2), penaltyKm: 8 };
  const across = c('across', at(37.485, 127.05)); // 강 건너, 회랑에 가까워 보임
  const b1 = c('b1', at(37.5, 127.09));
  const b2 = c('b2', at(37.505, 127.085));
  const p = mockRouteProvider({ barrier });
  const r = await plan(base([slot('a', [across, near, on, far]), slot('b', [b1, b2])]), p, { R: 4 });
  assert.ok(r.apiCalls > 5, `2라운드 없이 끝남: calls=${r.apiCalls}`);
  assert.notEqual(r.options[0].visits[0].candidate.id, 'across');
});

test('arriveBy 위반 — late 상태와 조건 완화안', async () => {
  const p = mockRouteProvider({ minPerKm: 2, circuity: 1 });
  // 직행 ≈ 20분. 480 출발, 505 마감. far는 dwell 10 + 우회로 늦는다
  const r = await plan(base([slot('a', [far], { dwellMin: 10 })], { arriveByMin: 505 }), p);
  assert.equal(r.slotStatus.a, 'late');
  assert.ok(r.relaxed);
  assert.equal(r.relaxed!.droppedSlotId, 'a');
  assert.equal(r.relaxed!.visits.length, 0);
  assert.ok(r.options[0].slackMin! < 0);
});

test('전부 마감 — closed 상태, 계획은 그래도 나온다', async () => {
  const closed = c('closed', at(37.5, 127.05), { hours: { openMin: 600, closeMin: 1320 } });
  const r = await plan(base([slot('a', [closed])]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'closed');
  assert.equal(r.options.length, 1);
});

test('빈 슬롯 — none, 나머지로 계획', async () => {
  const r = await plan(base([slot('a', []), slot('b', [on])]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'none');
  assert.equal(r.slotStatus.b, 'ok');
  assert.equal(r.options[0].visits.length, 1);
});

test('검색 status far/short는 그대로 승격', async () => {
  const r = await plan(base([slot('a', [far], { searchStatus: 'far' }), slot('b', [on], { searchStatus: 'short', count: 2 })]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'far');
  assert.equal(r.slotStatus.b, 'short');
});

test('슬롯이 하나도 없으면 직행만', async () => {
  const p = mockRouteProvider();
  const r = await plan(base([]), p);
  assert.equal(r.apiCalls, 1);
  assert.equal(r.options.length, 1);
  assert.equal(r.options[0].visits.length, 0);
  assert.ok(Math.abs(r.options[0].deltaMin) < 1e-9);
});

test('시드 하나가 실패해도 나머지로 계획한다', async () => {
  const inner = mockRouteProvider();
  let n = 0;
  const flaky = {
    route: (pts: typeof O[], t: number, m: 'car' | 'walk' | 'transit') => {
      n++;
      if (n === 3) return Promise.reject(new Error('timeout'));
      return inner.route(pts, t, m);
    },
  };
  const r = await plan(base([slot('a', [far, near, on])]), flaky);
  assert.equal(r.apiCalls, 4);
  // 실패한 건 3번째 호출 = near. 1안은 on, 대안 중 near만 추정치로 남는다
  assert.equal(r.options[0].visits[0].candidate.id, 'on');
  assert.deepEqual(r.alternatives.map(a => [a.candidate.id, a.estimated]).sort(), [['far', false], ['near', true]]);
});

test('직행이 실패하면 계획 자체가 실패한다', async () => {
  const dead = { route: () => Promise.reject(new Error('down')) };
  await assert.rejects(plan(base([slot('a', [on])]), dead));
});
