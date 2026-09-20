import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from './mockProvider';
import { plan } from './plan';
import { TRANSIT_CALL_BUDGET, TRANSIT_SWAP_BUDGET, transitCallCost, transitSeedFloor } from './transitBudget';
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

test('V=1 — 대안은 실측값이라 addedMin 등급이 measured, 값은 1안 대비', async () => {
  const r = await plan(base([slot('a', [far, near, on])]), mockRouteProvider());
  const alts = r.alternatives.filter(x => x.slotId === 'a');
  assert.equal(alts.length, 2);
  assert.ok(alts.every(x => x.addedMin.cls === 'measured' && x.addedMin.min > 0));
  assert.ok(alts.find(x => x.candidate.id === 'far')!.addedMin.min > alts.find(x => x.candidate.id === 'near')!.addedMin.min);
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

test("못 본 슬롯은 후보가 0건이어도 none 이 아니라 unchecked — 둘을 섞으면 찾아본 적 없는 곳을 '못 찾았다'고 말하게 된다", async () => {
  const r = await plan(base([slot('a', [], { searchStatus: 'unchecked' }), slot('b', [on])]), mockRouteProvider());
  assert.equal(r.slotStatus.a, 'unchecked');
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
  assert.deepEqual(r.alternatives.map(a => [a.candidate.id, a.addedMin.cls]).sort(), [['far', 'measured'], ['near', 'estimated']]);
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

test('timingSource — 구간을 쪼개 이어 붙인 실측은 provider_legs 다', async () => {
  const mock = mockRouteProvider();
  // transitProvider 처럼: 2점은 한 번에, 3점 이상은 쪼개 이어 붙였다고(legJoined) 찍는다
  const legs = { route: async (...args: Parameters<typeof mock.route>) => {
    const r = await mock.route(...args);
    return args[0].length === 2
      ? { ...r, source: 'provider' as const }
      : { ...r, source: 'provider' as const, legJoined: true };
  } };
  const r = await plan(base([slot('a', [on, near])], { mode: 'transit' }), legs);
  assert.equal(r.timingSource, 'provider_legs');
  // 경유지가 없으면 쪼갤 게 없다 — 직행이 곧 계획이라 provider
  const r0 = await plan(base([], { mode: 'transit' }), legs);
  assert.equal(r0.timingSource, 'provider');
});

test('timingSource — 자동차는 경유지를 한 번에 실어 보내 절대 provider_legs 가 안 된다', async () => {
  const mock = mockRouteProvider();
  const oneCall = { route: async (...args: Parameters<typeof mock.route>) => ({ ...(await mock.route(...args)), source: 'provider' as const }) };
  const r = await plan(base([slot('a', [on, near])], { mode: 'car' }), oneCall);
  assert.equal(r.timingSource, 'provider');
});

// --- 신뢰성 2단계: 차이는 같은 자에서만 난다(rescoreFrom) ---
//
// 서교동→코엑스 대중교통에서 CU 후보 30곳이 전부 −32분이었다(2026-09-20). 기준 안은 실측,
// 바꾼 안은 추정이라 실측 합계에서 추정 합계를 뺀 값이었다. 대중교통 목도 구간마다 접근·대기
// 8분을 넣으므로(mockProvider MODE_ESTIMATE) 같은 함정을 그대로 재현한다.
const tO = { latitude: 37.5, longitude: 127.0 };
const tD = { latitude: 37.5, longitude: 127.1136 };
const tc1 = c('c1', at(37.5, 127.0113)); // 회랑 위, 출발 1km — 앞 구간이 짧아야 여행 전체 차이가 첫 도착을 출발 앞으로 끌고 간다
const tc3 = c('c3', at(37.5, 127.034));
const tc5 = c('c5', at(37.5, 127.0567));
const tc7 = c('c7', at(37.5, 127.079));
/** c1 에서 300m 북쪽 — 같은 자리다. 시드 4안(transitSeedFloor(1)) 밖이라 실측이 없다 */
const ghost = c('ghost', at(37.5027, 127.0113));
const transitPlan = () => plan(
  { origin: tO, destination: tD, departAtMin: 1343, mode: 'transit', slots: [slot('a', [tc1, tc3, tc5, tc7, ghost])], order: 'auto' },
  mockRouteProvider(),
);
const visit = (cand: PlaceCandidate) => ({ slotId: 'a', candidate: cand, dwellMin: 10 });

test('rescoreFrom — 기준 안이 실측이고 바꾼 구간만 미실측이면 차이는 같은 추정기로 잰 두 값의 차다 — 실측에서 추정을 빼지 않는다', async () => {
  const r = await transitPlan();
  const base = [visit(tc1)];
  assert.deepEqual(r.rescore(base).legCls, ['measured', 'measured'], '전제 — 기준 안은 두 구간 다 실측');
  const swapped = [visit(ghost)];
  // 함정이 진짜로 있는지 먼저 본다 — 합계 둘을 빼면 300m 옆이 십수 분 빨라진다
  const mixed = r.rescore(swapped).totalMin - r.rescore(base).totalMin;
  assert.ok(mixed < -10, `픽스처가 자 섞기를 재현해야 한다: ${mixed.toFixed(1)}`);
  const d = r.rescoreFrom(base, swapped).delta;
  assert.equal(d.totalMin.cls, 'estimated');
  assert.ok(Math.abs(d.totalMin.min) < 3, `300m 옆은 비슷해야 한다: ${d.totalMin.min.toFixed(2)}`);
});

test('rescoreFrom — 바뀐 두 구간이 다 실측이면 차이도 실측이다', async () => {
  const r = await transitPlan();
  const from = r.rescoreFrom([visit(tc1)], [visit(tc3)]);
  assert.equal(from.delta.totalMin.cls, 'measured');
  assert.deepEqual(from.legCls, ['measured', 'measured']);
  assert.ok(Math.abs(from.totalMin - r.rescore([visit(tc3)]).totalMin) < 1e-9, '실측끼리면 그냥 다시 잰 값과 같다');
});

test('rescoreFrom — 바꾼 경유지의 도착 차이는 들어오는 구간만이다 — 여행 전체 차이를 한 지점에 더하지 않는다', async () => {
  const r = await transitPlan();
  const base = [visit(tc1)];
  const bt = r.rescore(base);
  const f = r.rescoreFrom(base, [visit(ghost)]);
  assert.equal(f.delta.arrivals.length, 2);
  assert.ok(Math.abs(f.delta.arrivals[0].min - (f.arrivals[0] - bt.arrivals[0])) < 1e-9, '도착 차이 = 새 도착 − 기준 도착');
  assert.ok(Math.abs(f.delta.arrivals[1].min - f.delta.totalMin.min) < 1e-9, '목적지 도착 차이 = 총합 차이');
  assert.ok(f.arrivals[0] >= 1343, `도착 ${f.arrivals[0].toFixed(1)} 이 출발 1343 앞이면 안 된다`);
  // 여행 전체 차이를 첫 도착에 더했을 때의 값(예전 브리지) — 그건 출발보다 이르다. 여기선 나올 수 없다
  const bogus = bt.arrivals[0] + (r.rescore([visit(ghost)]).totalMin - bt.totalMin);
  assert.ok(bogus < 1343, `픽스처가 21:58 을 재현해야 한다: ${bogus.toFixed(1)}`);
});

test('rescoreFrom — 안 바뀐 구간은 값도 등급도 그대로다', async () => {
  const r = await plan(base([slot('a', [on, near]), slot('b', [c('b1', at(37.5, 127.09)), c('b2', at(37.495, 127.08))])]), mockRouteProvider(), { R: 4 });
  const best = r.options[0].visits;
  const bt = r.rescore(best);
  // 두 번째 방문을 시드 밖(far)으로 — 첫 구간은 안 바뀐다
  const swapped = best.map((v, i) => (i === 1 ? { ...v, candidate: far } : v));
  const f = r.rescoreFrom(best, swapped);
  assert.equal(f.arrivals[0], bt.arrivals[0]);
  assert.equal(f.legsKm[0], bt.legsKm[0]);
  assert.equal(f.legCls[0], bt.legCls[0]);
  assert.deepEqual(f.delta.arrivals[0], { min: 0, cls: 'measured' }, '바뀐 게 없으면 차이 0 은 정확한 값이다');
  assert.equal(f.delta.arrivals[1].cls, 'estimated');
  assert.equal(f.legCls[1], 'estimated');
});

test('rescoreFrom — 방문 수가 다르면 던진다 — 교체만 잰다, 빼기·더하기는 rescore 몫이다', async () => {
  const r = await transitPlan();
  assert.throws(() => r.rescoreFrom([visit(tc1)], []), /방문 수/);
});

test('alternativeAt — 우회는 회랑 수직거리다 — 추정 km 에서 실측 km 를 뺀 0m 가 아니다', async () => {
  const r = await transitPlan();
  const alt = r.alternativeAt([visit(tc1)], 0, ghost);
  assert.ok(alt.detourKm > 0.25 && alt.detourKm < 0.35, `300m 북쪽인데 ${alt.detourKm}km`);
  assert.equal(alt.addedMin.cls, 'estimated');
  assert.equal(alt.arriveMin.cls, 'estimated');
  assert.ok(alt.arriveMin.min >= 1343);
});

// --- 신뢰성 6단계: 고른 매장 하나만 실제로 재서 '약'을 지운다(measureSwap) ---

/** 구간 호출을 세는 공급자 — 2점짜리 호출 하나가 구간 하나다 */
function legWatch(inner = mockRouteProvider()) {
  const self = {
    legCalls: 0,
    pointCounts: [] as number[],
    async route(points: { latitude: number; longitude: number }[], departAtMin: number, mode: 'car' | 'walk' | 'transit') {
      self.legCalls += points.length - 1;
      self.pointCounts.push(points.length);
      return inner.route(points, departAtMin, mode);
    },
  };
  return self;
}
const transitPlanWith = (cands: PlaceCandidate[], p: { route: ReturnType<typeof mockRouteProvider>['route'] }) => plan(
  { origin: tO, destination: tD, departAtMin: 1343, mode: 'transit', slots: [slot('a', cands)], order: 'auto' },
  p,
);

test('measureSwap — 고른 후보의 두 구간만 /transit 2회로 재고 시드였던 구간은 다시 묻지 않는다', async () => {
  const p = legWatch();
  const r = await transitPlanWith([tc1, tc3, tc5, tc7, ghost], p);
  const seeded = p.legCalls;
  const budgeted = r.apiCalls;

  assert.equal(await r.measureSwap([visit(ghost)], 0), true);
  assert.equal(p.legCalls - seeded, 2, '들어오는 구간·나가는 구간 둘뿐이다 — 계획을 다시 계산하지 않는다');
  assert.deepEqual(p.pointCounts.slice(-2), [2, 2], '구간 하나씩 물어야 공급자가 다시 쪼갤 일이 없다');
  assert.equal(r.apiCalls, budgeted + 2, 'apiCalls 는 실제 나간 수다 — 계획이 끝난 뒤의 호출도 센다');

  // tc3 은 시드라 두 구간이 이미 저장소에 있다. 같은 시각으로 찾히면 한 번도 안 나간다
  const afterSwap = p.legCalls;
  assert.equal(await r.measureSwap([visit(tc3)], 0), true);
  assert.equal(p.legCalls, afterSwap, '시드였던 구간을 다시 물으면 돈만 나가고 얻는 게 없다');
  assert.equal(r.apiCalls, budgeted + 2);
});

test('measureSwap — 계획당 TRANSIT_SWAP_BUDGET 을 넘는 고르기는 추정으로 남고 apiCalls 는 실제 나간 수다', async () => {
  const g2 = c('ghost2', at(37.5027, 127.034));
  const g3 = c('ghost3', at(37.5027, 127.0567));
  const p = legWatch();
  const r = await transitPlanWith([tc1, tc3, tc5, tc7, ghost, g2, g3], p);
  const budgeted = r.apiCalls;

  assert.equal(await r.measureSwap([visit(ghost)], 0), true, '고르기 1회 = 구간 2개');
  assert.equal(await r.measureSwap([visit(g2)], 0), true, '고르기 2회까지가 예산 4다');
  const spent = p.legCalls;
  assert.equal(await r.measureSwap([visit(g3)], 0), false, '세 번째는 예산 밖이다');
  assert.equal(p.legCalls, spent, '예산을 넘으면 반쪽도 안 부른다 — 반만 재면 돈은 쓰고 약은 남는다');
  assert.equal(r.apiCalls, budgeted + TRANSIT_SWAP_BUDGET, '장부는 나간 4회까지만 말한다');
  assert.equal(r.rescoreFrom([visit(tc1)], [visit(g3)]).estimated, true, '못 잰 후보는 추정으로 남는다');
});

test('measureSwap — 재고 나면 같은 후보의 rescoreFrom 이 measured 로 올라간다', async () => {
  // 들어오는 구간만 추정이 크게 틀리는 동네여야 이 테스트가 무언가를 가른다. LegStore 의 창은
  // 15분이라(legs.ts PROVISIONAL_MIN), 실측과 추정이 그 안에서만 벌어지면 나가는 구간을 **어느**
  // 시계에 넣든 조회가 성공한다 — 구현이 틀려도 초록인 테스트가 된다. 그래서 O→ghost 만 가로지르는
  // 장벽을 두고 20km 를 얹는다: 실측 ≈ 64분 대 추정 ≈ 4분, 창의 네 배다
  const barrier = { a: at(37.5015, 127.005), b: at(37.5015, 127.018), penaltyKm: 20 };
  const p = legWatch(mockRouteProvider({ barrier }));
  const r = await transitPlanWith([tc1, tc3, tc5, tc7, ghost], p);
  const from = [visit(tc1)];
  const to = [visit(ghost)];
  assert.deepEqual(r.rescoreFrom(from, to).legCls, ['estimated', 'estimated'], '전제 — 시드 밖이라 두 구간 다 추정');
  // 틀린 구현이 나가는 구간을 넣을 시계 = scorePlan 의 추정 도착. 맞는 구현은 실측 도착에 넣는다
  const estArrive = r.rescore(to).arrivals[0];

  assert.equal(await r.measureSwap(to, 0), true);

  const f = r.rescoreFrom(from, to);
  assert.ok(f.arrivals[0] - estArrive > 15, `전제 — 들어오는 구간의 실측이 추정보다 창(15분) 넘게 늦어야 시계 오류가 드러난다: ${(f.arrivals[0] - estArrive).toFixed(1)}분`);
  // 나가는 구간을 들어오는 구간의 **실측값으로 고친 시계**에 넣지 않으면 그 차이만큼 어긋나
  // LegStore 가 못 찾는다 — 호출만 나가고 '약'이 그대로 남는 자리다
  assert.deepEqual(f.legCls, ['measured', 'measured'], '잰 시각과 조회하는 시각이 같아야 실측으로 선다');
  assert.equal(f.estimated, false);
  assert.equal(f.delta.totalMin.cls, 'measured', '두 구간이 다 실측이면 차이도 실측이다');
  assert.equal(r.alternativeAt(from, 0, ghost).arriveMin.cls, 'measured');
  assert.ok(f.arrivals[0] >= 1343);
});

test('measureSwap — 자동차·도보도 같은 천장을 쓴다. 구간 하나는 어느 모드에서나 2점짜리 호출 하나다', async () => {
  // 대중교통 판과 같은 이유로 장벽을 둔다 — 없으면 legCls 단언이 시계를 안 가른다(창 15분).
  // 이 선은 O→outsider 만 가로지른다: 시드(on·near·far)도 outsider→D 도 안 닿는다
  const barrier = { a: at(37.504, 127.005), b: at(37.504, 127.03), penaltyKm: 20 };
  const p = legWatch(mockRouteProvider({ barrier }));
  const r = await plan(base([slot('a', [on, near, far])]), p);
  const seeded = p.legCalls;
  const outsider = c('outsider', at(37.508, 127.052));
  const swapped = [{ slotId: 'a', candidate: outsider, dwellMin: 10 }];
  const estArrive = r.rescore(swapped).arrivals[0];
  assert.equal(await r.measureSwap(swapped, 0), true);
  assert.equal(p.legCalls - seeded, 2);
  const f = r.rescoreFrom([visit(on)], swapped);
  assert.ok(f.arrivals[0] - estArrive > 15, `전제 — 실측이 추정보다 창(15분) 넘게 늦어야 한다: ${(f.arrivals[0] - estArrive).toFixed(1)}분`);
  assert.deepEqual(f.legCls, ['measured', 'measured']);
});

test('measureSwap — 구간 하나가 실패하면 false 고, 나간 요청은 장부에 남는다', async () => {
  const inner = mockRouteProvider();
  let n = 0;
  const flaky = {
    route: (pts: typeof O[], t: number, m: 'car' | 'walk' | 'transit') => {
      n++;
      return n === 6 ? Promise.reject(new Error('timeout')) : inner.route(pts, t, m);
    },
  };
  const r = await transitPlanWith([tc1, tc3, tc5, tc7, ghost], flaky);
  assert.equal(n, 5, '전제 — 직행 1 + 시드 4안. 목은 구간을 안 쪼개니 route() 는 5번이다');
  assert.equal(r.apiCalls, 9, '전제 — 장부는 구간 단위라 1 + 4×2 = 9');
  assert.equal(await r.measureSwap([visit(ghost)], 0), false, '삼키되 거짓말하지 않는다');
  assert.equal(r.apiCalls, 11, '나간 요청은 둘 다 셈한다 — 실패했다고 장부에서 지우지 않는다');
  assert.equal(r.measuredCount, 6, '성공한 호출만 실측으로 센다 — 직행 1 + 시드 4 + 성공한 구간 1');
});
