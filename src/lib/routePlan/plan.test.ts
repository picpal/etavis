import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from './mockProvider';
import { plan } from './plan';
import { TRANSIT_CALL_BUDGET, transitCallCost, transitSeedFloor } from './transitBudget';
import type { PlaceCandidate, PlanInput, Slot } from './types';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 }; // ≈10km 동쪽
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, coord: { latitude: number; longitude: number }, extra: Partial<PlaceCandidate> = {}): PlaceCandidate =>
  ({ id, name: id, coord, ...extra });
const slot = (id: string, candidates: PlaceCandidate[], extra: Partial<Slot> = {}): Slot =>
  ({ id, query: id, candidates, dwellMin: 10, count: 1, flexible: true, openNow: false, stopKind: 'category', ...extra });
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

test('arriveBy 위반 — 늦음은 slackMin으로만 드러난다 (완화안·late 상태는 뺐다: 무엇을 뺄지는 사용자가 정한다)', async () => {
  const p = mockRouteProvider({ minPerKm: 2, circuity: 1 });
  // 직행 ≈ 20분. 480 출발, 505 마감. far는 dwell 10 + 우회로 늦는다
  const r = await plan(base([slot('a', [far], { dwellMin: 10 })], { arriveByMin: 505 }), p);
  assert.equal(r.slotStatus.a, 'ok');
  assert.ok(r.options[0].slackMin! < 0);
  assert.equal(r.measuredCount, 2); // 직행 + far 시드. 완화안 실측은 없다
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
  assert.equal(r.measuredCount, 1); // 직행 1회뿐
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

test('direct 옵션 — 직행을 다시 부르지 않는다', async () => {
  const p = mockRouteProvider();
  const direct = await p.route([O, D], 480, 'car');
  const r = await plan(base([slot('a', [on])]), p, { direct });
  assert.equal(r.apiCalls, 1); // 후보 1개 실측만
  assert.equal(r.directMin, direct.durationMin);
  assert.equal(r.measuredCount, 2); // 직행 + 1
});

test('rescore — 실측 leg면 estimated=false, 없으면 true', async () => {
  const r = await plan(base([slot('a', [on, near])]), mockRouteProvider());
  const best = r.options[0].visits;
  const same = r.rescore(best);
  assert.equal(same.estimated, false);
  assert.ok(Math.abs(same.totalMin - r.options[0].totalMin) < 1e-9);
  const unknown = r.rescore([{ ...best[0], candidate: far }]);
  assert.equal(unknown.estimated, true);
  assert.equal(unknown.arrivals.length, 2);
});

test('legTable — 선택 후보 × 양끝의 완전 표, 실측 여부 표시', async () => {
  const b1 = c('b1', at(37.5, 127.09));
  const r = await plan(base([slot('a', [on, near]), slot('b', [b1])]), mockRouteProvider(), { R: 4 });
  const ids = new Set<string>();
  for (const o of r.options) for (const v of o.visits) ids.add(v.candidate.id);
  const nodes = ['O', ...ids, 'D'];
  for (const a of nodes) for (const b of nodes) {
    if (a === b || a === 'D' || b === 'O') continue;
    assert.ok(r.legTable[`${a}>${b}`], `missing ${a}>${b}`);
  }
  assert.equal(r.legTable['O>on'].measured, true);
});

test('timingSource — 목이면 estimate, 공급자가 provider 를 찍으면 provider', async () => {
  const est = await plan(base([slot('a', [on, near])]), mockRouteProvider());
  assert.equal(est.timingSource, 'estimate');
  const mock = mockRouteProvider();
  const stamped = { route: async (...args: Parameters<typeof mock.route>) => ({ ...(await mock.route(...args)), source: 'provider' as const }) };
  const prov = await plan(base([slot('a', [on, near])]), stamped);
  assert.equal(prov.timingSource, 'provider');
});

test('timingSource — 직행만 provider 고 시드가 estimate 면 provider_direct_only', async () => {
  const mock = mockRouteProvider();
  const directOnly = { route: async (...args: Parameters<typeof mock.route>) => {
    const r = await mock.route(...args);
    return args[0].length === 2 ? { ...r, source: 'provider' as const } : r; // 3점 이상은 mock 그대로(estimate)
  } };
  const r = await plan(base([slot('a', [on, near])]), directOnly);
  assert.equal(r.timingSource, 'provider_direct_only');
  // 경유지가 없으면 직행이 곧 계획 — provider
  const r0 = await plan(base([]), directOnly);
  assert.equal(r0.timingSource, 'provider');
});

// --- 7단계: 대중교통은 구간마다 /transit 한 번이라 호출 예산을 따로 센다 ---

/** transitProvider 가 하는 일을 흉내 낸다 — route() 한 번이 구간 수만큼 나간다 */
function legCounting(inner = mockRouteProvider()) {
  const self = {
    legCalls: 0,
    async route(points: { latitude: number; longitude: number }[], departAtMin: number, mode: 'car' | 'walk' | 'transit') {
      self.legCalls += points.length - 1;
      return inner.route(points, departAtMin, mode);
    },
  };
  return self;
}
const many = (n: number) => Array.from({ length: n }, (_, i) => c(`m${i}`, at(37.5 + (i % 7) * 0.004, 127.02 + i * 0.002)));

test('대중교통 V=1 — 겹치는 구간이 없어 4안, /transit 은 직행 1 + 4×2 = 9회', async () => {
  const p = legCounting();
  const r = await plan(base([slot('a', many(30))], { mode: 'transit' }), p);
  // V=1 은 O→cᵢ·cᵢ→D 가 후보마다 전부 달라 중복 제거가 아낄 게 없다 — 장부와 실제가 같고,
  // 실측 안 수는 겹침 0 일 때의 보장 하한(transitSeedFloor)과 정확히 같다
  assert.equal(p.legCalls, 9, `구간 호출 ${p.legCalls}회`);
  assert.equal(r.apiCalls, 1 + transitSeedFloor(1) * transitCallCost(1), '직행 1 + 4안 × 구간 2개');
  assert.equal(r.apiCalls, 9, 'apiCalls 는 실제로 나간 요청 수여야 감사에 쓸 수 있다');
  assert.ok(r.apiCalls <= TRANSIT_CALL_BUDGET);
  assert.equal(r.options[0].visits.length, 1);
});

test('대중교통 V=2 — 2라운드까지 합쳐도 예산 10회를 넘지 않는다', async () => {
  // 강 건너 후보를 넣어 2라운드 트리거를 켠다
  const barrier = { a: at(37.49, 126.9), b: at(37.49, 127.2), penaltyKm: 8 };
  const across = c('across', at(37.485, 127.05));
  const p = legCounting(mockRouteProvider({ barrier }));
  const r = await plan(base([slot('a', [across, near, on, far]), slot('b', [c('b1', at(37.5, 127.09)), c('b2', at(37.505, 127.085))])], { mode: 'transit' }), p);
  // 장부(apiCalls)는 구간 중복을 뺀 수다. 실제 요청도 같은 수라는 건 진짜 공급자를 쓰는
  // transitLegs.regression.test.ts 가 확인한다 — 여기 legCounting 은 코얼레싱을 흉내 내지 않는다
  assert.ok(r.apiCalls <= TRANSIT_CALL_BUDGET, `예산 초과: ${r.apiCalls}회`);
  assert.ok(r.options.length >= 1);
  assert.equal(r.timingSource, 'estimate', '목 공급자라 직행부터 추정');
});

test('자동차는 예산이 그대로다 — V=1 은 여전히 시드 8안', async () => {
  const p = legCounting();
  const r = await plan(base([slot('a', many(30))]), p);
  assert.equal(r.apiCalls, 9, '직행 1 + SINGLE_R 8');
});

test('대중교통 — 예산으로 한 안도 못 재는 경유지 수면, 실측은 포기해도 계획은 남는다', async () => {
  const p = legCounting();
  const stops = Array.from({ length: 10 }, (_, i) => slot(`s${i}`, [c(`s${i}c`, at(37.5 + i * 0.001, 127.01 + i * 0.009))]));
  const r = await plan(base(stops, { mode: 'transit', order: 'locked' }), p);
  assert.equal(p.legCalls, 1, '직행 말고는 한 번도 안 부른다 — 예산을 넘겨 가며 재지 않는다');
  assert.ok(r.options.length >= 1, '실측을 포기해도 계획까지 사라지면 안 된다');
  assert.equal(r.options[0].visits.length, 10);
  assert.notEqual(r.timingSource, 'provider', '한 구간도 안 쟀으면 실측이라 말할 수 없다');
});
