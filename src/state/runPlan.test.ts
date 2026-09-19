import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM } from '../lib/geo.ts';
import { mockRouteProvider } from '../lib/routePlan/mockProvider.ts';
import type { LatLng, PlaceCandidate } from '../lib/routePlan/types.ts';
import type { SearchFn } from '../lib/corridorSearch.ts';
import { dwellFor, runPlan } from './runPlan.ts';
import { initialPlanFlow, planFlowReducer } from './planFlow.ts';
import type { PlanFlowAction, PlanRequest } from './planFlow.ts';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const catalog: PlaceCandidate[] = [
  { id: 'oy1', name: '올리브영 A', coord: at(37.5, 127.05) },
  { id: 'oy2', name: '올리브영 B', coord: at(37.505, 127.07) },
  { id: 'pb1', name: '파리바게뜨 A', coord: at(37.5, 127.09) },
];
const search: SearchFn = async (q, near, r) =>
  catalog.filter(c => c.name.startsWith(q) && haversineM(near, c.coord) <= r);
/** 목적지(127.1136) 1500m 안에 3곳, 밖에 2곳. near=end 완화 단계를 가르는 배치 */
const martCatalog: PlaceCandidate[] = [
  { id: 'm1', name: '마트 A', coord: at(37.5, 127.1100) }, // D 에서 약 318m
  { id: 'm2', name: '마트 B', coord: at(37.5, 127.1050) }, // 약 760m
  { id: 'm3', name: '마트 C', coord: at(37.5, 127.1000) }, // 약 1,201m
  { id: 'm4', name: '마트 D', coord: at(37.5, 127.0650) }, // 약 4,294m
  { id: 'm5', name: '마트 E', coord: at(37.5, 127.0600) }, // 약 4,736m
  { id: 'k1', name: '약국 A', coord: at(37.5, 127.1105) },
  { id: 'k2', name: '약국 B', coord: at(37.5, 127.0640) },
];
const martSearch: SearchFn = async (q, center, r) =>
  martCatalog.filter(c => c.name.startsWith(q) && haversineM(center, c.coord) <= r);
const req = (stops: PlanRequest['stops'], extra: Partial<PlanRequest> = {}): PlanRequest => ({
  origin: O, destination: D, originName: '집', destinationName: '회사', mode: 'car',
  arriveByMin: null, departAtMin: 480, stops, order: 'auto', ...extra,
});
const collect = () => {
  const actions: PlanFlowAction[] = [];
  return { actions, dispatch: (a: PlanFlowAction) => { actions.push(a); } };
};

test('후보가 2곳뿐이면 상한까지 넓혀 찾고 status 는 ok — Kc=8 확보가 목표', async () => {
  // 카탈로그의 올리브영은 2곳(oy1·oy2, 둘 다 회랑 2km 안). target 8을 못 채우니 15km까지 넓힌다
  const radii: number[] = [];
  const spy: SearchFn = async (q, near, r) => { radii.push(r); return search(q, near, r); };
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false, stopKind: 'brand' }]), { provider: mockRouteProvider(), search: spy, dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { searchStatus?: string; candidates: unknown[] }[] }).slots;
  assert.equal(slots[0].searchStatus, 'ok'); // count=1 은 채웠다
  assert.equal(slots[0].candidates.length, 2);
  // 2km → 4km → 8km → 15km, 각 5점
  assert.deepEqual([...new Set(radii)], [2000, 4000, 8000, 15000]);
  assert.equal(radii.length, 20);
  assert.equal(actions[actions.length - 1].type, 'RESULT');
});

test('정상 — START·PROGRESS×3·SLOTS·RESULT 순서, 직행은 한 번만', async () => {
  const provider = mockRouteProvider();
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false, stopKind: 'brand' }, { id: 's-2', queries: ['파리바게뜨'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]), { provider, search, dispatch });
  const types = actions.map(a => a.type);
  assert.deepEqual(types.slice(0, 2), ['START', 'PROGRESS']);
  assert.ok(types.includes('SLOTS'));
  assert.equal(types[types.length - 1], 'RESULT');
  const result = (actions[actions.length - 1] as { type: 'RESULT'; result: { apiCalls: number; measuredCount: number } }).result;
  assert.equal(provider.calls, result.apiCalls + 1); // 직행 1 + 플래너 호출
  assert.equal(result.measuredCount, provider.calls);
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { id: string; searchStatus?: string; candidates: unknown[]; stopKind: string }[] }).slots;
  assert.equal(slots[0].id, 's-1');
  assert.equal(slots[0].candidates.length, 2);
  assert.equal(slots[0].searchStatus, 'ok');
  // stopKind가 요청 슬롯별로 그대로 전달되는지 — 두 슬롯이 다른 값이라 하드코딩으로는 통과 못한다
  assert.equal(slots[0].stopKind, 'brand');
  assert.equal(slots[1].stopKind, 'category');
});

test('검색 0건 슬롯은 none으로 남고 계획은 진행된다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', queries: ['없는가게'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]), { provider: mockRouteProvider(), search, dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { searchStatus?: string }[] }).slots;
  assert.equal(slots[0].searchStatus, 'none');
  assert.equal(actions[actions.length - 1].type, 'RESULT');
});

/* ── 슬롯 하나가 죽어도 나머지는 살린다 ──────────────────────────
   2026-09-19 프로덕션: /places 가 503(KV PUT 429)을 내면 corridorSearch 의
   settleSamples 가 한 라운드 표본이 전부 거절될 때 던진다. 여기가 Promise.all 이라
   그 슬롯 하나가 계획 전체를 FAIL('search')로 죽였고, 멀줦히 후보를 찾은 다른
   슬롯까지 같이 버렸다. 경유지 하나를 잃는 게 계획 전체를 잃는 것보다 낫다. */

/** 그 검색어만 늘 던진다 — 표본이 전부 거절돼 슬롯이 통째로 reject 된다 */
const failingQuerySearch = (failQuery: string): SearchFn => async (q, near, r) => {
  if (q === failQuery) throw new Error('KV PUT failed: 429 Too Many Requests');
  return search(q, near, r);
};

const twoStops: PlanRequest['stops'] = [
  { id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false, stopKind: 'brand' },
  { id: 's-2', queries: ['파리바게뜨'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
];

test('슬롯 하나가 던져도 나머지 슬롯의 후보는 살아남는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req(twoStops), { provider: mockRouteProvider(), search: failingQuerySearch('올리브영'), dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { id: string; candidates: unknown[] }[] }).slots;
  // 거절된 슬롯도 자리를 지킨다 — 자리를 뺀 채 접으면 인덱스가 밀려 다른 슬롯의 후보가 된다
  assert.deepEqual(slots.map(s => s.id), ['s-1', 's-2']);
  assert.equal(slots[0].candidates.length, 0);
  assert.equal(slots[1].candidates.length, 1); // pb1 은 멀줦히 찾았다
  assert.equal(actions[actions.length - 1].type, 'RESULT');
});

test("눈으로 보지 못한 슬롯은 'none' 이 아니라 'unchecked' 다 — 없는 것과 못 본 것은 다른 사실이다", async () => {
  const { actions, dispatch } = collect();
  await runPlan(req(twoStops), { provider: mockRouteProvider(), search: failingQuerySearch('올리브영'), dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { searchStatus?: string }[] }).slots;
  assert.equal(slots[0].searchStatus, 'unchecked');
  assert.equal(slots[1].searchStatus, 'ok');
});

test("슬롯이 전부 던지면 FAIL(search) — 할 말이 아무것도 없다", async () => {
  const { actions, dispatch } = collect();
  const allFail: SearchFn = async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); };
  await runPlan(req(twoStops), { provider: mockRouteProvider(), search: allFail, dispatch });
  const last = actions[actions.length - 1];
  assert.equal(last.type, 'FAIL');
  assert.equal((last as { type: 'FAIL'; error: { kind: string } }).error.kind, 'search');
});

test('직행 실패 → FAIL(direct)', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([]), { provider: { route: () => Promise.reject(new Error('down')) }, search, dispatch });
  const last = actions[actions.length - 1];
  assert.equal(last.type, 'FAIL');
  assert.equal((last as { type: 'FAIL'; error: { kind: string } }).error.kind, 'direct');
});

test('타임아웃 → FAIL(timeout)', async () => {
  const slow = { route: () => new Promise<never>(() => {}) };
  const { actions, dispatch } = collect();
  await runPlan(req([]), { provider: slow, search, dispatch, timeoutMs: 30 });
  const last = actions[actions.length - 1] as { type: 'FAIL'; error: { kind: string } };
  assert.equal(last.type, 'FAIL');
  assert.equal(last.error.kind, 'timeout');
});

test('PROGRESS search detail은 "올리브영 2곳 · 파리바게뜨 1곳"', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false, stopKind: 'category' }, { id: 's-2', queries: ['파리바게뜨'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]), { provider: mockRouteProvider(), search, dispatch });
  const p = actions.find(a => a.type === 'PROGRESS' && a.key === 'search') as { detail?: string };
  assert.equal(p.detail, '올리브영 2곳 · 파리바게뜨 1곳');
});

test('dwellFor — 카테고리 기본값', () => {
  assert.equal(dwellFor('스타벅스'), 5);
  assert.equal(dwellFor('편의점'), 3);
  assert.equal(dwellFor('이마트'), 15);
  assert.equal(dwellFor('올리브영'), 10);
});

test('실측 호출 수는 후보 수와 무관하다 — 단일·2스톱 각각 8개·30개에서 동일', async () => {
  const make = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`, name: `가게${prefix}${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
    }));
  const run = async (stopCount: 1 | 2, n: number) => {
    let routeCalls = 0;
    const provider = {
      route: async (points: { latitude: number; longitude: number }[]) => {
        routeCalls++;
        return {
          durationMin: 10 * (points.length - 1), distanceKm: 5 * (points.length - 1),
          polyline: points, sections: points.slice(1).map(() => ({ durationMin: 10, distanceKm: 5 })),
        };
      },
    };
    const stops =
      stopCount === 1
        ? [{ id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' as const }]
        : [
            { id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' as const },
            { id: 's2', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' as const },
          ];
    const actions: { type: string }[] = [];
    await runPlan(
      {
        origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.6, longitude: 127.0 },
        originName: '출발', destinationName: '도착', mode: 'car', arriveByMin: null, departAtMin: 540,
        stops, order: 'auto',
      },
      { provider, search: async q => make(q === '빵집' ? 'b' : 'c', n), dispatch: a => actions.push(a) },
    );
    assert.ok(actions.some(a => a.type === 'RESULT'), '결과가 나와야 한다');
    return routeCalls;
  };
  // 단일 스톱 — V=1은 SINGLE_R(8)까지만 실측하므로 30개여도 호출 수가 늘지 않는다.
  // 절대값도 박아둔다 — 그냥 같기만 하면 SINGLE_R이 조용히 R(4)로 줄어도(둘 다 5회로 같아짐) 못 잡는다
  const single8 = await run(1, 8);
  const single30 = await run(1, 30);
  assert.equal(single8, 9, `단일 스톱 8개: 직행1 + SINGLE_R(8) = 9회여야 하는데 ${single8}회`);
  assert.equal(single8, single30, `단일 스톱: 8개=${single8}회, 30개=${single30}회`);
  // 2스톱 — pickSeeds(ranked, R=4)가 후보 수와 무관하게 고정 개수만 뽑는다
  const two8 = await run(2, 8);
  const two30 = await run(2, 30);
  assert.equal(two8, two30, `2스톱: 8개=${two8}회, 30개=${two30}회`);
});

async function runTrend(o: {
  stopKind: 'brand' | 'category' | 'specific';
  n: number;
  enrich?: (p: { id: string; name: string; address: string; lat: number; lng: number }[]) => Promise<Record<string, never>>;
}) {
  const provider = {
    route: async (points: { latitude: number; longitude: number }[]) => ({
      durationMin: 10 * (points.length - 1), distanceKm: 5 * (points.length - 1),
      polyline: points, sections: points.slice(1).map(() => ({ durationMin: 10, distanceKm: 5 })),
    }),
  };
  const actions: { type: string }[] = [];
  await runPlan(
    {
      origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.6, longitude: 127.0 },
      originName: '출발', destinationName: '도착', mode: 'car', arriveByMin: null, departAtMin: 540,
      stops: [{ id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: o.stopKind }],
      order: 'auto',
    },
    {
      provider,
      search: async () => Array.from({ length: o.n }, (_, i) => ({
        id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
      })),
      dispatch: a => actions.push(a),
      enrich: o.enrich as never,
    },
  );
  return actions;
}

test('업종 슬롯이고 후보가 4개 이상이면 보강을 부른다', async () => {
  const seen: { id: string }[][] = [];
  await runTrend({ stopKind: 'category', n: 6, enrich: async ps => { seen.push(ps); return {}; } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 6);
});

test('브랜드 슬롯이면 보강을 부르지 않는다', async () => {
  let calls = 0;
  await runTrend({ stopKind: 'brand', n: 6, enrich: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
});

test('후보가 3개면 보강을 부르지 않는다 — 순서를 바꿔봐야 의미가 없다', async () => {
  let calls = 0;
  await runTrend({ stopKind: 'category', n: 3, enrich: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
});

test('보강이 실패해도 결과는 나온다', async () => {
  const actions = await runTrend({
    stopKind: 'category', n: 6,
    enrich: async () => { throw new Error('보강 실패'); },
  });
  assert.ok(actions.some(a => a.type === 'RESULT'));
});

/**
 * 트렌드 1위 기본 선택 시나리오 — near(경로 위·무보강 신호 약함)와
 * far(살짝 벗어남·보강 신호 강함)를 둔다. 필러 2곳은 순위에 영향이 없도록
 * 신호도 없고 훨씬 멀리 둔다(보강 최소 후보수 4를 채우는 용도).
 * 실측(mockRouteProvider)으로 확인한 실제 값 — near totalMin ≈27.94분,
 * far로 바꾸면 totalMin ≈28.12분(약 +0.18분). 이 격차로 마감 경계를 가른다.
 */
async function runTrendSwap(arriveByMin: number | null, fixed?: { placeId: string; name: string; coord: LatLng }): Promise<PlanFlowAction[]> {
  const near: PlaceCandidate = { id: 'near', name: '카페 근처', coord: { latitude: 37.5, longitude: 127.05 } };
  const far: PlaceCandidate = { id: 'far', name: '카페 트렌드', coord: { latitude: 37.505, longitude: 127.05 } };
  const filler1: PlaceCandidate = { id: 'f1', name: '카페 필러1', coord: { latitude: 37.6, longitude: 127.05 } };
  const filler2: PlaceCandidate = { id: 'f2', name: '카페 필러2', coord: { latitude: 37.7, longitude: 127.05 } };
  const swapSearch: SearchFn = async () => [near, far, filler1, filler2];
  const enrich = async (places: { id: string; name: string }[]) => {
    const out: Record<string, { fetchedAt: string; blog?: unknown; google?: unknown }> = {};
    for (const p of places) {
      if (p.id === 'near') {
        out[p.id] = { fetchedAt: 't', google: { rating: 3.8, ratingCount: 20, hours: null, matchedName: p.name } };
      }
      if (p.id === 'far') {
        out[p.id] = {
          fetchedAt: 't',
          blog: { weighted: 20, count90d: 32, latestDaysAgo: 1, source: 'kakao' },
          google: { rating: 5.0, ratingCount: 250, hours: null, matchedName: p.name },
        };
      }
    }
    return out;
  };
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', fixed }], {
      origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.5, longitude: 127.1 },
      departAtMin: 540, arriveByMin,
    }),
    { provider: mockRouteProvider(), search: swapSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  return actions;
}

test('트렌드 1위가 마감을 지키면 그 후보로 SET_OVERRIDE를 보낸다', async () => {
  // near totalMin≈27.94, far totalMin≈28.12 — 569분 마감은 far도 지킨다
  const actions = await runTrendSwap(569);
  assert.ok(actions.some(a => a.type === 'SET_OVERRIDE' && a.slotId === 's1' && a.candidateId === 'far'));
});

test('트렌드 1위로 바꾸면 마감을 넘기면 바꾸지 않는다', async () => {
  // 568분 마감은 near(≈567.94 도착)는 지키지만 far(≈568.12 도착)는 넘긴다
  const actions = await runTrendSwap(568);
  assert.ok(!actions.some(a => a.type === 'SET_OVERRIDE'));
});

test('마감이 없으면 10분 이내로 늘어날 때 트렌드 1위로 바꾼다', async () => {
  const actions = await runTrendSwap(null);
  assert.ok(actions.some(a => a.type === 'SET_OVERRIDE' && a.candidateId === 'far'));
});

test('RESULT 뒤에 보낸 SET_OVERRIDE도 리듀서 상태에 남는다 — RESULT가 overrides를 리셋해도 그 이후 온 것까지 지우지 않는다', async () => {
  const actions = await runTrendSwap(null);
  assert.equal(actions[actions.length - 1].type, 'SET_OVERRIDE', 'SET_OVERRIDE는 RESULT 뒤에 와야 한다');
  const state = actions.reduce(planFlowReducer, initialPlanFlow);
  assert.deepEqual(state.overrides[0], { s1: 'far' });
});

test('마감이 없어도 추가시간이 10분을 넘으면 트렌드 1위로 바꾸지 않는다', async () => {
  // far를 더 벗어난 자리로 — 실측 결과 near 대비 +13.96분. 신호는 여전히 far가 near를 이길 만큼
  // 우월하다(트렌드 랭킹 자체는 far가 1위) — 그런데도 10분 상한에 걸려 바뀌면 안 된다.
  // (근접 필러로는 fit 축만으로 필러가 1위를 채가 이 시험이 성립하지 않는다 — 확인함)
  const near: PlaceCandidate = { id: 'near', name: '카페 근처', coord: { latitude: 37.5, longitude: 127.05 } };
  const far: PlaceCandidate = { id: 'far', name: '카페 트렌드', coord: { latitude: 37.55, longitude: 127.05 } };
  const filler1: PlaceCandidate = { id: 'f1', name: '카페 필러1', coord: { latitude: 37.6, longitude: 127.05 } };
  const filler2: PlaceCandidate = { id: 'f2', name: '카페 필러2', coord: { latitude: 37.7, longitude: 127.05 } };
  const farSearch: SearchFn = async () => [near, far, filler1, filler2];
  const enrich = async (places: { id: string; name: string }[]) => {
    const out: Record<string, { fetchedAt: string; blog?: unknown; google?: unknown }> = {};
    for (const p of places) {
      if (p.id === 'near') out[p.id] = { fetchedAt: 't', google: { rating: 3.8, ratingCount: 20, hours: null, matchedName: p.name } };
      if (p.id === 'far') {
        out[p.id] = {
          fetchedAt: 't',
          blog: { weighted: 20, count90d: 32, latestDaysAgo: 1, source: 'kakao' },
          google: { rating: 5.0, ratingCount: 250, hours: null, matchedName: p.name },
        };
      }
    }
    return out;
  };
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' }], {
      origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.5, longitude: 127.1 },
      departAtMin: 540, arriveByMin: null,
    }),
    { provider: mockRouteProvider(), search: farSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  assert.ok(!actions.some(a => a.type === 'SET_OVERRIDE'));
});

test('업종 슬롯 두 곳 — 각자는 마감을 지켜도 합치면 넘기면 첫 번째만 바꾼다', async () => {
  // 카페·베이커리 각각 near/far 두 후보. 실측(mockRouteProvider, order:'locked')으로 확인한 값:
  //   base(양쪽 near) totalMin ≈55.87, departAtMin 540 → 기준 도착 595.87
  //   한쪽만 far로 바꾸면 +2.05분(도착 597.92) — 둘 다 바꾸면 +2.32분(도착 598.20)
  // arriveByMin=598 은 "각자 따로"는 지키지만(597.92<=598) "합쳐서"는 넘긴다(598.20>598).
  // 원본 base 대비로만 검사하면(합산 없이) 두 슬롯 다 통과해 버려 이 시험이 실패해야 정상이다.
  const mk = (query: string, lon: number): PlaceCandidate[] => [
    { id: `${query}-near`, name: `${query} 근처`, coord: { latitude: 37.5, longitude: lon } },
    { id: `${query}-far`, name: `${query} 트렌드`, coord: { latitude: 37.52, longitude: lon } },
    { id: `${query}-f1`, name: `${query} 필러1`, coord: { latitude: 37.6, longitude: lon } },
    { id: `${query}-f2`, name: `${query} 필러2`, coord: { latitude: 37.7, longitude: lon } },
  ];
  const cafeCands = mk('카페', 127.06);
  const bakeryCands = mk('베이커리', 127.14);
  const twoSlotSearch: SearchFn = async q => (q === '카페' ? cafeCands : bakeryCands);
  const enrich = async (places: { id: string; name: string }[]) => {
    const out: Record<string, { fetchedAt: string; blog?: unknown; google?: unknown }> = {};
    for (const p of places) {
      if (p.id.endsWith('-near')) out[p.id] = { fetchedAt: 't', google: { rating: 3.8, ratingCount: 20, hours: null, matchedName: p.name } };
      if (p.id.endsWith('-far')) {
        out[p.id] = {
          fetchedAt: 't',
          blog: { weighted: 20, count90d: 32, latestDaysAgo: 1, source: 'kakao' },
          google: { rating: 5.0, ratingCount: 250, hours: null, matchedName: p.name },
        };
      }
    }
    return out;
  };
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req(
      [
        { id: 's1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
        { id: 's2', queries: ['베이커리'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
      ],
      { origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.5, longitude: 127.2 }, departAtMin: 540, arriveByMin: 598, order: 'locked' },
    ),
    { provider: mockRouteProvider(), search: twoSlotSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  const overrides = actions.filter(a => a.type === 'SET_OVERRIDE') as { slotId: string; candidateId: string }[];
  assert.deepEqual(overrides.map(o => o.slotId), ['s1'], `첫 슬롯만 바뀌어야 하는데: ${JSON.stringify(overrides)}`);
});

test('마감이 없는 업종 슬롯 두 곳 — 각자는 총 +10분 이내여도 합치면 넘기면 첫 번째만 바꾼다', async () => {
  // "마감 없으면 총 +10분 이내"는 여행 전체 기준 딱 한 번이어야 한다. 슬롯마다 직전 스왑이
  // 이미 늘려놓은 시간을 기준으로 다시 재면(버그) 슬롯 2개로 최대 20분까지 샐 수 있다.
  // 실측(mockRouteProvider, order:'locked')으로 확인한 값:
  //   base(양쪽 near) 대비 한쪽만 far로 바꾸면 +9.31분(≤10, 개별 통과)
  //   둘 다 바꾸면 +10.33분(원본 대비, >10 — 마감이 없어도 이건 넘기면 안 된다)
  // 직전 슬롯 기준으로 다시 재면(버그) 두 번째 슬롯은 "+10.33-9.31=+1.02분"으로 보여 통과해
  // 버린다 — 이 시험은 원본(origin) 기준으로 고정했는지를 가른다.
  const mk = (query: string, lon: number): PlaceCandidate[] => [
    { id: `${query}-near`, name: `${query} 근처`, coord: { latitude: 37.5, longitude: lon } },
    { id: `${query}-far`, name: `${query} 트렌드`, coord: { latitude: 37.545, longitude: lon } },
    { id: `${query}-f1`, name: `${query} 필러1`, coord: { latitude: 37.6, longitude: lon } },
    { id: `${query}-f2`, name: `${query} 필러2`, coord: { latitude: 37.7, longitude: lon } },
  ];
  const cafeCands = mk('카페', 127.06);
  const bakeryCands = mk('베이커리', 127.14);
  const twoSlotSearch: SearchFn = async q => (q === '카페' ? cafeCands : bakeryCands);
  const enrich = async (places: { id: string; name: string }[]) => {
    const out: Record<string, { fetchedAt: string; blog?: unknown; google?: unknown }> = {};
    for (const p of places) {
      if (p.id.endsWith('-near')) out[p.id] = { fetchedAt: 't', google: { rating: 3.8, ratingCount: 20, hours: null, matchedName: p.name } };
      if (p.id.endsWith('-far')) {
        out[p.id] = {
          fetchedAt: 't',
          blog: { weighted: 20, count90d: 32, latestDaysAgo: 1, source: 'kakao' },
          google: { rating: 5.0, ratingCount: 250, hours: null, matchedName: p.name },
        };
      }
    }
    return out;
  };
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req(
      [
        { id: 's1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
        { id: 's2', queries: ['베이커리'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
      ],
      { origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.5, longitude: 127.2 }, departAtMin: 540, arriveByMin: null, order: 'locked' },
    ),
    { provider: mockRouteProvider(), search: twoSlotSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  const overrides = actions.filter(a => a.type === 'SET_OVERRIDE') as { slotId: string; candidateId: string }[];
  assert.deepEqual(overrides.map(o => o.slotId), ['s1'], `첫 슬롯만 바뀌어야 하는데: ${JSON.stringify(overrides)}`);
});

test('보강이 응답 없이 걸려도(hang) 파이프라인은 12초 예산 안에서 끝난다', async () => {
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    {
      provider: mockRouteProvider(),
      search: async () => Array.from({ length: 6 }, (_, i) => ({
        id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
      })),
      enrich: () => new Promise(() => {}), // 절대 안 끝나는 보강
      dispatch: a => actions.push(a),
      // 보강이 실제로 불릴 만큼은 남겨야 이 경로를 시험한다. 예산이 모자라면
      // 보강을 건너뛰므로(아래 테스트) hang 자체에 닿지 않는다.
      // 플래너 예약 3.5초 + 여유 0.5초를 빼고도 슬롯 최소치 4.4초가 남아야 한다.
      timeoutMs: 8_500,
    },
  );
  const last = actions[actions.length - 1];
  assert.equal(last.type, 'FAIL');
  assert.equal((last as { type: 'FAIL'; error: { kind: string } }).error.kind, 'timeout');
});

test('남은 시간이 플래너 몫에도 못 미치면 보강을 아예 건너뛴다', async () => {
  const seen: unknown[] = [];
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    {
      provider: mockRouteProvider(),
      search: async () => Array.from({ length: 6 }, (_, i) => ({
        id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
      })),
      enrich: async ps => { seen.push(ps); return {}; },
      dispatch: a => actions.push(a),
      timeoutMs: 4_000, // 플래너 예약 3.5초 + 여유 0.5초를 빼면 슬롯당 0 이 된다
    },
  );
  assert.equal(seen.length, 0, '보강을 부르면 안 된다');
  assert.ok(actions.some(a => a.type === 'RESULT'), '계획 자체는 나와야 한다');
});

const sixCandidates: SearchFn = async () =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
  }));

const twoCategorySlots = () =>
  req([
    { id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
    { id: 's2', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
  ]);

test('슬롯마다 그 시점에 남은 예산 전부를 준다 — 나눠 주면 어느 슬롯도 한 건을 못 끝낸다', async () => {
  // 예산을 미리 쪼개면 슬롯당 2.5초가 되는데, 네이버 호출 하나가 1.7초라 서버가
  // 한 건도 못 끝낸다. 실측에서 슬롯 2개가 둘 다 빈 결과였다(budgetMs=2500 results=0).
  const given: number[] = [];
  await runPlan(twoCategorySlots(), {
    provider: mockRouteProvider(),
    search: sixCandidates,
    enrich: async (_ps, opts) => { given.push(opts?.timeoutMs ?? -1); return {}; },
    dispatch: () => {},
    timeoutMs: 12_000,
  });
  // 목 보강은 즉시 끝나므로 두 슬롯 다 불린다. 첫 슬롯이 상한(5초)에 가까운 값을 받고,
  // 두 번째도 거의 그대로 받는다 — 나눠 준 2.5초가 아니다
  assert.equal(given.length, 2);
  assert.ok(given[0] > 4_000, `첫 슬롯이 ${given[0]}ms 만 받았다`);
  assert.ok(given[1] > 4_000, `두 번째 슬롯이 ${given[1]}ms 만 받았다`);
  assert.ok(given[0] <= 5_000 && given[1] <= 5_000, '상한 5초를 넘으면 안 된다');
});

test('첫 슬롯이 예산을 다 쓰면 다음 슬롯은 건너뛴다 — 결과가 버려질 호출에 쿼터를 안 쓴다', async () => {
  const given: number[] = [];
  await runPlan(twoCategorySlots(), {
    provider: mockRouteProvider(),
    search: sixCandidates,
    enrich: async (_ps, opts) => {
      given.push(opts?.timeoutMs ?? -1);
      // 콜드처럼 예산을 써서, 남은 시간이 슬롯 최소치(4.4초) 아래로 떨어지게 한다.
      // 전액을 다 쓰지 않아도 남은 몫이 한 건을 못 끝낼 만큼이면 건너뛰어야 한다
      await new Promise(r => setTimeout(r, 800));
      return {};
    },
    dispatch: () => {},
    timeoutMs: 12_000,
  });
  assert.equal(given.length, 1, '두 번째 슬롯을 부르면 안 된다');
});

test('보강 최소 후보수 경계 — 정확히 4개면 보강을 부른다(> 아니라 >=)', async () => {
  const seen: { id: string }[][] = [];
  const actions = await runTrend({ stopKind: 'category', n: 4, enrich: async ps => { seen.push(ps); return {}; } });
  assert.ok(actions.some(a => a.type === 'RESULT'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 4);
});

test('업종 슬롯 한 곳의 보강이 실패해도 다른 슬롯의 신호는 살아남는다(allSettled)', async () => {
  const mk = (prefix: string, n: number): PlaceCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`, name: `${prefix}가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
    }));
  const okCands = mk('ok', 4);
  const badCands = mk('bad', 4);
  const twoSlotSearch: SearchFn = async q => (q === '빵집' ? okCands : badCands);
  const enrich = async (places: { id: string; name: string }[]) => {
    if (places[0].id.startsWith('bad')) throw new Error('이 슬롯만 실패');
    const out: Record<string, { fetchedAt: string; google?: unknown }> = {};
    for (const p of places) out[p.id] = { fetchedAt: 't', google: { rating: 4.5, ratingCount: 100, hours: null, matchedName: p.name } };
    return out;
  };
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([
      { id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
      { id: 's2', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
    ]),
    { provider: mockRouteProvider(), search: twoSlotSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  const slotsAction = actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { id: string; candidates: { signals?: unknown }[] }[] };
  const okSlot = slotsAction.slots.find(s => s.id === 's1')!;
  const badSlot = slotsAction.slots.find(s => s.id === 's2')!;
  assert.ok(okSlot.candidates.every(c => c.signals !== undefined), '실패하지 않은 슬롯은 신호가 전부 붙어야 한다');
  assert.ok(badSlot.candidates.every(c => c.signals === undefined), '실패한 슬롯은 신호 없이 넘어가되 나머지를 막지 않는다');
  assert.ok(actions.some(a => a.type === 'RESULT'), '한 슬롯이 실패해도 계획은 나온다');
});

// --- 최종 브랜치 리뷰 fix 1 회귀: 슬롯 보강은 순차라야 한다 -------------------------------
// Promise.allSettled로 되돌리면(구 코드) 두 슬롯의 enrich 호출이 동시에 시작돼 겹친다.
// 겹치면 server/src/enrich.ts의 월 예산 카운터가 슬롯 수만큼 실효 상한을 불려버린다
// (900 × 동시 슬롯 수) — 최종 리뷰 Critical 1. 여기서는 실제 서버 없이, enrich 호출의
// '동시 진행 중(in-flight) 개수'가 2를 넘는 순간이 있는지로 겹침 여부를 직접 잰다.
test('업종 슬롯 여러 곳이면 보강을 슬롯마다 순차로 부른다 — 동시에 겹치지 않는다', async () => {
  let inFlight = 0;
  let sawOverlap = false;
  const order: string[] = [];
  const enrich = async (places: { id: string }[]) => {
    inFlight++;
    if (inFlight > 1) sawOverlap = true;
    order.push(places[0]?.id.slice(0, 1) ?? '');
    await new Promise(r => setTimeout(r, 5)); // 겹치면 두 번째 호출이 이 대기 중에 시작돼 잡힌다
    inFlight--;
    return {};
  };
  const mk = (prefix: string, n: number): PlaceCandidate[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`, name: `${prefix}가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
    }));
  const twoSlotSearch: SearchFn = async q => (q === '빵집' ? mk('b', 6) : mk('c', 6));
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([
      { id: 's1', queries: ['빵집'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
      { id: 's2', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
    ]),
    { provider: mockRouteProvider(), search: twoSlotSearch, enrich, dispatch: a => actions.push(a) },
  );
  assert.ok(actions.some(a => a.type === 'RESULT'), '결과가 나와야 한다');
  assert.ok(!sawOverlap, '두 슬롯의 보강 호출이 동시에 겹치면 안 된다 — 겹치면 예산 카운터가 슬롯 수만큼 실효 상한을 불린다');
  assert.deepEqual(order, ['b', 'c'], '첫 슬롯이 끝난 뒤 다음 슬롯을 불러야 한다');
});

// --- 최종 브랜치 리뷰 fix 4 회귀: 추정치 위에서는 스왑하지 않는다 --------------------------
// SINGLE_R=8이라 후보가 9개 이상이면 그중 하나는 구조적으로 실측을 못 받는다(estimated=true).
// 아래 좌표는 실제로 그렇게 되도록 확인된 값이다(probe로 확인): near는 8개 시드 밖으로
// 밀려 추정치로 남고, far가 시드에 뽑혀 시간 1위(base)가 된다. 신호는 아무도 없으므로
// scoreTrend는 fit(추가시간)만으로 순위를 매기는데, near의 실측 없는 타이밍이 base보다
// 약 4.1분 빠르게 나와(둘 다 fit=1로 동점이라 '동률은 addedMin 오름차순' 규칙이 near를
// 1위로 올린다) 마감·10분 여유 둘 다 가볍게 통과하는 값이 된다. 그 숫자가 "제시간 도착"의
// 근거가 되는데 추정치라 신뢰할 수 없다 — 그래서 estimated면 아예 스왑하지 않아야 한다.
// (측정된 타이밍이면 스왑해야 한다는 반대쪽 분기는 기존 '트렌드 1위가 마감을 지키면 그
// 후보로 SET_OVERRIDE를 보낸다' 테스트가 이미 고정한다 — 그 테스트의 후보는 4개뿐이라
// SINGLE_R(8) 안에 다 들어가 전부 실측되기 때문이다.)
test('트렌드 1위의 타이밍이 추정치(estimated)면 스왑하지 않는다', async () => {
  const near: PlaceCandidate = { id: 'near', name: '카페 근처', coord: { latitude: 37.5, longitude: 127.05 } };
  const far: PlaceCandidate = { id: 'far', name: '카페 트렌드', coord: { latitude: 37.55, longitude: 127.05 } };
  const fillers: PlaceCandidate[] = Array.from({ length: 7 }, (_, i) => ({
    id: `f${i}`, name: `필러${i}`, coord: { latitude: 37.5 + (i + 1) * 0.001, longitude: 127.05 },
  }));
  const cands = [near, far, ...fillers];
  const estSearch: SearchFn = async () => cands;
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' }], {
      origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.6, longitude: 127.0 },
      departAtMin: 540, arriveByMin: null,
    }),
    { provider: mockRouteProvider(), search: estSearch, enrich: (async () => ({})) as never, dispatch: a => actions.push(a) },
  );
  assert.ok(actions.some(a => a.type === 'RESULT'), '결과가 나와야 한다');
  // base(시간 1위)가 far여야 near가 추정치 후보로 남는 이 시나리오가 성립한다 — 전제 확인
  const result = actions.find(a => a.type === 'RESULT') as { type: 'RESULT'; result: { options: { visits: { candidate: { id: string } }[] }[] } };
  assert.equal(result.result.options[0].visits[0].candidate.id, 'far', '전제 확인 — base가 far가 아니면 이 시나리오가 성립하지 않는다');
  assert.ok(!actions.some(a => a.type === 'SET_OVERRIDE'), 'near의 타이밍은 실측이 아니므로(estimated) 스왑하면 안 된다');
});

// --- 최종 브랜치 리뷰 fix 8 회귀: 신호 모양이 이상해도 이미 나간 RESULT를 FAIL로 덮지 않는다 --
// enrichClient.ts는 서버 응답을 깊이 검증하지 않는다(그건 server/src/schema.ts의 몫이라
// 클라이언트 쪽은 방어선이 없다). google.rating이 숫자가 아닌 신호가 들어오면
// scoreTrend의 `rating.toFixed(1)`이 던진다 — 트렌드 스왑 블록을 감싸지 않으면 이
// 예외가 바깥 catch까지 올라가 이미 dispatch된 RESULT를 FAIL이 뒤엎어 버린다.
test('신호 하나가 망가진 모양이어도(google.rating이 숫자가 아님) RESULT가 FAIL로 덮이지 않는다', async () => {
  const cands: PlaceCandidate[] = Array.from({ length: 4 }, (_, i) => ({
    id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
  }));
  const brokenSearch: SearchFn = async () => cands;
  // 서버가 정상이라면 있을 수 없는 모양이지만, 클라이언트는 이걸 막을 방법이 없다 —
  // rating이 문자열로 온 경우를 그대로 흉내 낸다.
  const enrich = async (places: { id: string }[]) => {
    const out: Record<string, unknown> = {};
    for (const p of places) {
      out[p.id] = { fetchedAt: 't', google: { rating: '망가짐', ratingCount: 10, hours: null, matchedName: p.id } };
    }
    return out;
  };
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    { provider: mockRouteProvider(), search: brokenSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  assert.ok(actions.some(a => a.type === 'RESULT'), 'RESULT는 나가야 한다');
  assert.ok(!actions.some(a => a.type === 'FAIL'), '스코어링이 던져도 이미 나간 RESULT를 FAIL이 덮으면 안 된다');
});

// --- 6단계: 대중교통이면 앵커에서 경유지를 찾는다 ---
test('대중교통 — itinerary 가 있으면 앵커에서 찾는다', async () => {
  const board = { latitude: 37.526097, longitude: 126.864538 };
  const nearBoard = { latitude: 37.5263, longitude: 126.8650 };
  const searched: { latitude: number; longitude: number }[] = [];
  const search = async (_q: string, near: { latitude: number; longitude: number }, r: number) => {
    searched.push(near);
    return Math.hypot(near.latitude - nearBoard.latitude, near.longitude - nearBoard.longitude) < 0.01
      ? [{ id: 'kb', name: '국민은행 목동역점', coord: nearBoard }]
      : [];
  };
  const provider = {
    route: async (points: { latitude: number; longitude: number }[]) => ({
      durationMin: 24, distanceKm: 7.2,
      polyline: [points[0], board, points[points.length - 1]],
      sections: points.slice(1).map(() => ({ durationMin: 12, distanceKm: 3.6 })),
      source: 'provider' as const,
      transit: [{
        durationMin: 24, distanceM: 7218,
        legs: [{
          kind: 'transit' as const, mode: 'SUBWAY' as const, line: '5호선',
          from: { name: '목동', lat: 37.526097, lng: 126.864538 },
          to: { name: '국회의사당', lat: 37.528143, lng: 126.917856 },
          durationMin: 12, stops: 6, departAt: null, arriveAt: null,
        }],
      }],
    }),
  };
  const actions: { type: string }[] = [];
  await runPlan(
    { origin: { latitude: 37.5188, longitude: 126.8575 }, destination: { latitude: 37.5285, longitude: 126.9187 },
      departAtMin: 9 * 60, arriveByMin: null, mode: 'transit', order: 'auto',
      stops: [{ id: 'sl-1', queries: ['국민은행'], count: 1, flexible: true, openNow: false, stopKind: 'category' }] } as never,
    { provider: provider as never, search: search as never, dispatch: a => actions.push(a) },
  );

  const slots = (actions.find(a => a.type === 'SLOTS') as { slots: { candidates: { id: string; anchorId?: string; anchorWalkM?: number }[] }[] }).slots;
  assert.equal(slots[0].candidates.length, 1);
  assert.equal(slots[0].candidates[0].anchorId, 'a1', '승차역 앵커에 붙어야 한다');
  assert.ok(slots[0].candidates[0].anchorWalkM! < 200);
  // 검색은 앵커 좌표에서 이뤄졌다 — 직선 위 등간격 5점이 아니다
  assert.ok(searched.some(p => Math.abs(p.latitude - board.latitude) < 1e-6), '승차역에서 찾지 않았다');
});

test('대중교통 — 앵커에서 0건이면 회랑 검색으로 떨어진다', async () => {
  const board = { latitude: 37.526097, longitude: 126.864538 };
  // 역 주변(최대 1500m)엔 없고, 회랑 반지름 2000m 이상에서만 잡히는 가게
  const onCorridor = { latitude: 37.5235, longitude: 126.8880 };
  const calls: { latitude: number; longitude: number }[] = [];
  const search = async (_q: string, near: { latitude: number; longitude: number }, r: number) => {
    calls.push(near);
    return Math.hypot(near.latitude - onCorridor.latitude, near.longitude - onCorridor.longitude) < 0.02 && r >= 2000
      ? [{ id: 'far1', name: '회랑 가게', coord: onCorridor }]
      : [];
  };
  const provider = {
    route: async (points: { latitude: number; longitude: number }[]) => ({
      durationMin: 24, distanceKm: 7.2,
      polyline: [points[0], board, points[points.length - 1]],
      sections: points.slice(1).map(() => ({ durationMin: 12, distanceKm: 3.6 })),
      source: 'provider' as const,
      transit: [{
        durationMin: 24, distanceM: 7218,
        legs: [{
          kind: 'transit' as const, mode: 'SUBWAY' as const, line: '5호선',
          from: { name: '목동', lat: 37.526097, lng: 126.864538 },
          to: { name: '국회의사당', lat: 37.528143, lng: 126.917856 },
          durationMin: 12, stops: 6, departAt: null, arriveAt: null,
        }],
      }],
    }),
  };
  const actions: { type: string }[] = [];
  await runPlan(
    { origin: { latitude: 37.5188, longitude: 126.8575 }, destination: { latitude: 37.5285, longitude: 126.9187 },
      departAtMin: 9 * 60, arriveByMin: null, mode: 'transit', order: 'auto',
      stops: [{ id: 'sl-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' }] } as never,
    { provider: provider as never, search: search as never, dispatch: a => actions.push(a) },
  );

  const slots = (actions.find(a => a.type === 'SLOTS') as { slots: { candidates: { id: string; anchorId?: string }[]; searchCalls?: number }[] }).slots;
  assert.equal(slots[0].candidates.length, 1, '앵커가 비었다고 후보까지 잃으면 안 된다');
  assert.equal(slots[0].candidates[0].anchorId, undefined, '회랑에서 온 후보엔 앵커가 없다');
  // 앵커 조회(0건으로 끝남)와 회랑 재조회, 둘 다 실제로 나간 요청이다 — 로그의 calls는
  // 회랑 몫만이 아니라 실제 발신 총량이어야 감사 목적에 맞는다
  assert.equal(slots[0].searchCalls, calls.length, 'searchCalls는 앵커 조회 + 회랑 재조회를 합친 실제 요청 수여야 한다');
});

test('검색어 폴백 — 첫 후보가 0건이면 다음 후보로 넘어가고 slot.query 는 실제로 쓴 검색어', async () => {
  // 카탈로그에 '샌드위치 파는 카페'로 시작하는 이름은 없다. '카페'는 있다.
  const cafeCatalog: PlaceCandidate[] = [{ id: 'cf1', name: '카페 A', coord: at(37.5, 127.05) }];
  const cafeSearch: SearchFn = async (q, near, r) =>
    cafeCatalog.filter(c => c.name.startsWith(q) && haversineM(near, c.coord) <= r);
  const { actions, dispatch } = collect();

  await runPlan(
    req([{ id: 's-1', queries: ['샌드위치 파는 카페', '카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    { provider: mockRouteProvider(), search: cafeSearch, dispatch },
  );

  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { query: string; candidates: unknown[]; searchStatus?: string }[] }).slots;
  assert.equal(slots[0].candidates.length, 1);
  assert.equal(slots[0].query, '카페');           // 화면에 찍히는 건 실제로 쓴 검색어
  assert.equal(slots[0].searchStatus, 'ok');
});

test('검색어 폴백 — 첫 후보가 잡히면 뒤 후보는 검색하지 않는다', async () => {
  const tried: string[] = [];
  const spy: SearchFn = async (q, near, r) => { tried.push(q); return search(q, near, r); };
  const { actions, dispatch } = collect();

  await runPlan(
    req([{ id: 's-1', queries: ['올리브영', '화장품'], count: 1, flexible: true, openNow: false, stopKind: 'brand' }]),
    { provider: mockRouteProvider(), search: spy, dispatch },
  );

  // tried 가 비어도 every()는 통과한다(vacuous) — 실제로 검색이 나갔는지부터 본다
  assert.ok(tried.length > 0, '검색이 한 번도 나가지 않았다');
  assert.ok(tried.every(q => q === '올리브영'), `'화장품'까지 검색했다: ${[...new Set(tried)].join(',')}`);
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { query: string }[] }).slots;
  assert.equal(slots[0].query, '올리브영');
});

test('검색어 폴백 — 모든 후보가 0건이면 status none, query 는 첫 후보', async () => {
  const tried: string[] = [];
  const empty: SearchFn = async q => { tried.push(q); return []; };
  const { actions, dispatch } = collect();

  await runPlan(
    req([{ id: 's-1', queries: ['샌드위치 파는 카페', '카페'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    { provider: mockRouteProvider(), search: empty, dispatch },
  );

  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { query: string; searchStatus?: string; searchCalls?: number }[] }).slots;
  assert.equal(slots[0].searchStatus, 'none');
  assert.equal(slots[0].query, '샌드위치 파는 카페');   // 사용자가 말한 그대로를 보여 준다
  assert.ok((slots[0].searchCalls ?? 0) > 0, '호출 수가 0이면 감사 로그가 사용량을 축소해 말한다');
  // searchCalls > 0 만으로는 두 후보 전부의 합산인지, 첫 후보 몫만인지 못 가른다 —
  // 실제로 나간 카카오 요청 수(tried.length)와 정확히 같아야 한다
  assert.equal(slots[0].searchCalls, tried.length, 'searchCalls는 두 후보 시도를 합산해야 한다');
});

test('검색어 폴백 — dwellMin은 구가 아니라 실제로 쓴 검색어 기준', async () => {
  // '커피 파는 마트'는 DWELL의 카페|커피 행(5분)에 먼저 걸리지만, 첫 후보가 0건이라
  // 실제로 쓴 검색어는 폴백된 '마트'다. DWELL 표(runPlan.ts) 확인: 카페|커피 행=5분,
  // 마트 행=15분 — dwellFor(used)가 구 전체가 아니라 실제 검색어를 봐야 15분이 맞다.
  const martCatalog: PlaceCandidate[] = [{ id: 'mt1', name: '마트 A', coord: at(37.5, 127.05) }];
  const martSearch: SearchFn = async (q, near, r) =>
    martCatalog.filter(c => c.name.startsWith(q) && haversineM(near, c.coord) <= r);
  const { actions, dispatch } = collect();

  await runPlan(
    req([{ id: 's-1', queries: ['커피 파는 마트', '마트'], count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );

  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { query: string; dwellMin: number }[] }).slots;
  assert.equal(slots[0].query, '마트');
  assert.equal(slots[0].dwellMin, 15, 'dwellFor는 구가 아니라 실제로 쓴 검색어(마트)를 봐야 한다');
});

/* near — 경로의 어느 쪽 끝. 채점은 총 소요시간만 보므로 여기서 거르지 않으면
   "회사 근처 카페"라고 말해도 출발지 쪽 후보가 이긴다 */

const nearCatalog: PlaceCandidate[] = [
  { id: 'cf-near', name: '카페 집앞', coord: at(37.5, 127.005) },  // s ≈ 0.04
  { id: 'cf-far', name: '카페 회사앞', coord: at(37.5, 127.108) },  // s ≈ 0.95
];
const nearSearch: SearchFn = async (q, from, r) =>
  nearCatalog.filter(c => c.name.startsWith(q) && haversineM(from, c.coord) <= r);

const slotsOf = (actions: PlanFlowAction[]) =>
  (actions.find(a => a.type === 'SLOTS') as {
    type: 'SLOTS';
    slots: {
      near?: string; nearSource?: string; nearBefore?: number; nearAfter?: number;
      nearRadiusM?: number | null; nearRelaxed?: boolean; nearRelaxedRaw?: boolean;
      candidates: { id: string }[];
    }[];
  }).slots;

test("near='end' — 목적지 쪽 후보만 슬롯에 남는다", async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', near: 'end' }]),
    { provider: mockRouteProvider(), search: nearSearch, dispatch },
  );
  const [s] = slotsOf(actions);
  assert.deepEqual(s.candidates.map(c => c.id), ['cf-far']);
  assert.equal(s.near, 'end');
  assert.equal(s.nearRelaxed, false);
});

test("near='start' — 출발지 쪽 후보만 남는다", async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', near: 'start' }]),
    { provider: mockRouteProvider(), search: nearSearch, dispatch },
  );
  assert.deepEqual(slotsOf(actions)[0].candidates.map(c => c.id), ['cf-near']);
});

test('그쪽에 한 곳도 없으면 제약을 풀고 계획은 그대로 간다 — 경유지가 증발하면 안 된다', async () => {
  const onlyNear: SearchFn = async (q, from, r) =>
    nearCatalog.filter(c => c.id === 'cf-near' && c.name.startsWith(q) && haversineM(from, c.coord) <= r);
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', near: 'end' }]),
    { provider: mockRouteProvider(), search: onlyNear, dispatch },
  );
  const [s] = slotsOf(actions);
  assert.deepEqual(s.candidates.map(c => c.id), ['cf-near'], '되돌려서 후보를 살린다');
  assert.equal(s.nearRelaxed, true);
  assert.equal(actions[actions.length - 1].type, 'RESULT');
});

test('물성 신호 — 대중교통에서 커피를 사면 near 를 말 안 해도 목적지 쪽이 된다', async () => {
  // decideNear 는 why 텍스트를 안 본다(CARRY 정규식은 748a030 에서 버렸다) — '커피'라는
  // 물성은 이제 추출이 붙이는 loadAfter 태그로 온다. why 는 여전히 화면 표시용으로 남는다
  const { actions, dispatch } = collect();
  await runPlan(
    req(
      [{ id: 's-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', why: '커피 사기', loadAfter: 'hard' }],
      { mode: 'transit' },
    ),
    { provider: mockRouteProvider(), search: nearSearch, dispatch },
  );
  const [s] = slotsOf(actions);
  assert.equal(s.near, 'end');
  assert.deepEqual(s.candidates.map(c => c.id), ['cf-far']);
});

test('물성 신호 — 차로 가면 표를 읽지 않는다. 커피는 들고 탈 수 있다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', why: '커피 사기', loadAfter: 'hard' }]),
    { provider: mockRouteProvider(), search: nearSearch, dispatch },
  );
  const [s] = slotsOf(actions);
  assert.equal(s.near, 'any');
  assert.equal(s.candidates.length, 2);
});

test('같은 검색어 슬롯이 둘인데 그쪽에 한 곳뿐이면 제약을 푼다 — 계획 전체가 사라지면 안 된다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', near: 'end' },
      { id: 's-2', queries: ['카페'], count: 1, flexible: true, openNow: false, stopKind: 'category', near: 'end' },
    ]),
    { provider: mockRouteProvider(), search: nearSearch, dispatch },
  );
  const slots = slotsOf(actions);
  // 목적지 쪽 후보는 cf-far 하나뿐이다. 그대로 좁히면 슬롯 둘이 같은 한 곳을 두고 다퉈
  // enumerate 가 빈 배열을 내고 계획이 통째로 없어진다 — 제약을 풀어야 한다
  assert.equal(slots[0].nearRelaxed, true);
  assert.equal(slots[0].candidates.length, 2);
  const last = actions[actions.length - 1];
  assert.equal(last.type, 'RESULT', '계획이 나와야 한다');
  assert.ok((last as { type: 'RESULT'; result: { options: unknown[] } }).result.options.length > 0, '안이 하나는 있어야 한다');
});

/* 진단 필드 — nearSource·nearBefore·nearAfter·nearRadiusM·nearRelaxedRaw.
   화면은 near·nearRelaxed 만 보지만, 로그(actionLog.ts)는 이 다섯을 전부 본다 */

test('추론한 방향은 end 이고 nearSource=inferred 로 기록된다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', loadBefore: 'none', loadAfter: 'hard', needWhen: 'afterArrival' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  assert.equal(s.near, 'end');
  assert.equal(s.nearSource, 'inferred');
  assert.equal(s.nearRadiusM, 1500);      // 1500m 안에 3곳이라 첫 단계에서 멈춘다
  assert.equal(s.nearAfter, 3);
  assert.equal(s.nearRelaxed, false);     // 화면은 추론을 사과하지 않는다
  assert.equal(s.nearRelaxedRaw, false);
  assert.equal(s.nearBefore, 5);          // martCatalog 의 마트 5곳 전부 — 완화 전 원본 개수
});

test('추론한 side 가 검색까지 닿는다 — 샘플이 목적지 쪽 절반에서만 찍힌다', async () => {
  // side 를 searchAlong 에 안 넘기면 회랑 전체(0~1)에서 표본을 찍어 O 근처(127.0)
  // 중심도 섞인다. side='end' 가 실제로 검색까지 닿으면 표본은 s∈[0.5,1] 에서만
  // 찍히므로 중심 경도가 전부 127.056(=O+0.5*(D-O)) 이상이어야 한다.
  const centers: LatLng[] = [];
  const spy: SearchFn = async (q, center, r) => { centers.push(center); return martSearch(q, center, r); };
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: spy, dispatch },
  );
  assert.equal(slotsOf(actions)[0].near, 'end');
  assert.ok(centers.length > 0);
  assert.ok(centers.every(c => c.longitude >= 127.056),
    `목적지 쪽 절반에서만 찍혀야 한다: ${centers.map(c => c.longitude.toFixed(4))}`);
});

test('사용자가 말한 방향은 stated 다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', near: 'end' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  assert.equal(slotsOf(actions)[0].nearSource, 'stated');
});

test('방향이 없으면 nearSource=none 이고 반경도 안 남는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  assert.equal(s.near, 'any');
  assert.equal(s.nearSource, 'none');
  assert.equal(s.nearRadiusM, null);
});

test('추론이 완화돼도 화면 플래그는 안 서고 진단 플래그만 선다', async () => {
  // 기존 catalog 의 올리브영은 127.05·127.07 — D 에서 3,851m·5,616m 라 두 단계 다 못 채운다
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false,
           stopKind: 'brand', loadAfter: 'hard', needWhen: 'afterArrival' }],
        { mode: 'transit' }),
    { provider: mockRouteProvider(), search, dispatch },
  );
  const s = slotsOf(actions)[0];
  assert.equal(s.near, 'end');
  assert.equal(s.nearRelaxed, false);     // 사용자가 말한 게 아니라 사과하지 않는다
  assert.equal(s.nearRelaxedRaw, true);   // 로그는 안다
  assert.equal(s.nearRadiusM, null);
  assert.equal(s.candidates.length, 2);   // 되돌렸으므로 경유지가 증발하지 않는다
});

test('자동차는 태그가 있어도 any 다 — 알려진 한계', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([{ id: 's-1', queries: ['마트'], count: 1, flexible: true, openNow: false,
           stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' }]),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  assert.equal(slotsOf(actions)[0].near, 'any');
});

/* 형제 슬롯 요구량 — 검색어가 달라도 같은 near 를 쓰면 같은 쪽 후보 풀을 나눠 가진다 */

test('검색어가 달라도 같은 near 를 쓰면 형제로 세어 요구량을 올린다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' },
      { id: 's-2', queries: ['약국'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' },
    ], { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  // 같은 검색어 형제만 세면 need=2 → 요구량 max(2,3)=3 → 목적지 쪽 3곳으로 통과했을 것이다.
  // 같은 near 형제까지 세면 need=4 → 요구량 4 → 3곳으로는 모자라 완화한다
  assert.equal(s.near, 'end');
  assert.equal(s.nearRelaxedRaw, true);
  assert.equal(s.nearRadiusM, null);
});

test('near 가 any 인 슬롯은 형제로 세지 않는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', loadAfter: 'hard', needWhen: 'afterArrival' },
      { id: 's-2', queries: ['약국'], count: 2, flexible: true, openNow: false,
        stopKind: 'category' }, // 태그 없음 → any
    ], { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  // byNear('end') = 2 뿐이라 요구량은 max(2,3)=3 → 목적지 쪽 3곳으로 통과한다
  assert.equal(s.nearRelaxedRaw, false);
  assert.equal(s.nearRadiusM, 1500);
});

test('같은 검색어가 양쪽으로 갈려도 검색어 형제 수를 잃지 않는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', near: 'end' },
      { id: 's-2', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', near: 'start' },
    ], { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  // sameQuery('마트') = 4, byNear('end') = 2. Math.max 를 버리고 sameNear 만 쓰면
  // 요구량이 2로 떨어져 목적지 쪽 3곳으로 통과해 버린다
  assert.equal(s.nearRelaxedRaw, true);
  assert.equal(s.nearRadiusM, null);
});

test('양쪽 끝의 슬롯 수를 한 덩어리로 합치지 않는다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(
    req([
      { id: 's-1', queries: ['마트'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', near: 'end' },
      { id: 's-2', queries: ['약국'], count: 2, flexible: true, openNow: false,
        stopKind: 'category', near: 'start' },
    ], { mode: 'transit' }),
    { provider: mockRouteProvider(), search: martSearch, dispatch },
  );
  const s = slotsOf(actions)[0];
  // byNear('end') = 2 뿐이라 요구량은 max(2,3)=3 → 목적지 쪽 3곳으로 통과한다.
  // 양쪽을 한 덩어리로 세면 4가 돼 완화가 돈다
  assert.equal(s.nearRelaxedRaw, false);
  assert.equal(s.nearRadiusM, 1500);
});


/* ── 정해진 가게가 이긴다 — 검색은 그대로 돈다 ─────────────────────────────
   확정된 계획에 경유지를 하나 추가하면 손도 안 댄 가게가 바뀌었다(2026-09-19 실측).
   요청의 `fixed` 가 그 가게를 슬롯까지 들고 오고(planRequest), 여기서 `candidates[0]`
   으로 올린 뒤 `flexible:false` 로 닫는다 — `enumerate` 가 그때 한 곳만 고른다
   (`enumerate.ts:7`).

   **검색을 건너뛰지 않는다.** 건너뛰면 후보가 하나뿐이라 매장 교체 시트가 비고,
   `/enrich` 가 안 돌아 영업시간 없이 "영업 중"이라 말하고, `near`·`searchStatus` 가
   실제로 일어나지 않은 일을 적는다. 사용자가 신고한 건 속도가 아니라 가게가 바뀐다는
   것이다. */
const fixedSlots = (actions: PlanFlowAction[]) =>
  (actions.find(a => a.type === 'SLOTS') as {
    type: 'SLOTS';
    slots: {
      id: string; flexible: boolean; searchCalls?: number; nearRelaxedRaw?: boolean;
      fixed?: { placeId: string; source: 'search' | 'filtered' | 'request' };
      candidates: { id: string; name: string }[];
    }[];
  }).slots;

const pharmacyReq = (fixed?: { placeId: string; name: string; coord: LatLng }) =>
  req([{ id: 's-1', queries: ['약국'], count: 1, flexible: true, openNow: false, stopKind: 'category', fixed }]);

const runFixed = async (r: PlanRequest) => {
  const { actions, dispatch } = collect();
  await runPlan(r, { provider: mockRouteProvider(), search: martSearch, dispatch });
  return fixedSlots(actions);
};

test('고정된 슬롯도 검색을 돈다 — 교체 시트에 보여줄 대안이 있어야 한다', async () => {
  const [s] = await runFixed(pharmacyReq({ placeId: 'k2', name: '약국 B', coord: at(37.5, 127.064) }));
  assert.ok(s.candidates.length > 1, `후보가 하나뿐이면 교체 시트가 빈다 (${s.candidates.length}곳)`);
  assert.ok((s.searchCalls ?? 0) > 0, '검색을 아예 안 부르면 near·status 가 거짓말이 된다');
});

test('고정된 가게가 candidates[0] 이고 flexible 이 아니다', async () => {
  const [s] = await runFixed(pharmacyReq({ placeId: 'k2', name: '약국 B', coord: at(37.5, 127.064) }));
  assert.equal(s.candidates[0].id, 'k2');
  assert.equal(s.flexible, false, 'flexible 이 true 면 플래너가 다른 후보를 고른다');
});

test('검색 결과에 그 가게가 이미 있으면 중복으로 넣지 않고 그것을 올린다', async () => {
  const [s] = await runFixed(pharmacyReq({ placeId: 'k1', name: '약국 A', coord: at(37.5, 127.1105) }));
  assert.equal(s.candidates.filter(c => c.id === 'k1').length, 1, 'enumerate 는 id 로 중복 방문을 막는다');
  assert.equal(s.candidates[0].id, 'k1');
  assert.equal(s.fixed?.source, 'search', '검색이 준 것이면 그렇게 적어야 한다');
});

test('검색이 그 가게를 못 찾으면 맨 앞에 끼워 넣는다 — 사용자가 고른 것이 사라지면 안 된다', async () => {
  const [s] = await runFixed(pharmacyReq({ placeId: 'k-없는곳', name: '봄빛온누리약국', coord: at(37.5, 127.08) }));
  assert.equal(s.candidates[0].id, 'k-없는곳');
  assert.equal(s.candidates[0].name, '봄빛온누리약국');
  assert.equal(s.fixed?.source, 'request', '검색이 못 준 것이면 신호·영업시간이 없다고 적어야 한다');
});

test('near 로 걸러졌어도 고정은 살아남고, 로그가 그 사실을 적는다', async () => {
  // 약국 B(k2)는 출발지 쪽이라 near=end 로 걸러진다. 그래도 사용자가 고른 곳이다
  const r = req([{ id: 's-1', queries: ['약국'], count: 1, flexible: true, openNow: false,
    stopKind: 'category', near: 'end', fixed: { placeId: 'k2', name: '약국 B', coord: at(37.5, 127.064) } }]);
  const [s] = await runFixed(r);
  assert.equal(s.candidates[0].id, 'k2');
  assert.equal(s.fixed?.source, 'filtered', '걸러낸 걸 되살렸으면 로그가 그렇게 말해야 한다');
  assert.equal(s.nearRelaxedRaw, false, 'applyNear 는 완화한 적이 없다 — 그 칸을 빌려 쓰면 로그가 거짓말한다');
});

test('고정이 없는 형제 슬롯은 아무것도 달라지지 않는다', async () => {
  const r = req([
    { id: 's-1', queries: ['약국'], count: 1, flexible: true, openNow: false, stopKind: 'category',
      fixed: { placeId: 'k2', name: '약국 B', coord: at(37.5, 127.064) } },
    { id: 's-2', queries: ['마트'], count: 1, flexible: true, openNow: false, stopKind: 'category' },
  ]);
  const [, mart] = await runFixed(r);
  assert.equal(mart.flexible, true);
  assert.equal(mart.fixed, undefined);
});

/* 트렌드 스왑은 RESULT 뒤에 돌면서 업종 슬롯의 선택을 갈아치운다(runPlan.ts:349).
   검색을 그대로 돌리기로 했으니 고정된 슬롯에도 후보가 30곳 있고, 막지 않으면
   **사용자가 고른 가게를 트렌드 1위로 덮어쓴다** — 고정의 의미가 없어진다.
   `flexible:false` 가 곧 "candidates[0] 한 곳"이라는 계약이므로 그걸로 가른다. */
test('트렌드 스왑이 고정된 가게를 뒤집지 않는다', async () => {
  const withFix = await runTrendSwap(null, { placeId: 'near', name: '카페 근처', coord: { latitude: 37.5, longitude: 127.05 } });
  assert.ok(!withFix.some(a => a.type === 'SET_OVERRIDE'), '고정된 슬롯은 스왑 대상이 아니다');
  const without = await runTrendSwap(null);
  assert.ok(without.some(a => a.type === 'SET_OVERRIDE' && a.candidateId === 'far'),
    '전제: 고정이 없으면 이 시나리오는 트렌드 1위로 바뀐다');
});
