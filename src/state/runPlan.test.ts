import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM } from '../lib/geo.ts';
import { mockRouteProvider } from '../lib/routePlan/mockProvider.ts';
import type { PlaceCandidate } from '../lib/routePlan/types.ts';
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
const req = (stops: PlanRequest['stops'], extra: Partial<PlanRequest> = {}): PlanRequest => ({
  origin: O, destination: D, originName: '집', destinationName: '회사', mode: 'car',
  arriveByMin: null, departAtMin: 480, stops, order: 'auto', ...extra,
});
const collect = () => {
  const actions: PlanFlowAction[] = [];
  return { actions, dispatch: (a: PlanFlowAction) => { actions.push(a); } };
};

test('정상 — START·PROGRESS×3·SLOTS·RESULT 순서, 직행은 한 번만', async () => {
  const provider = mockRouteProvider();
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false, stopKind: 'brand' }, { id: 's-2', query: '파리바게뜨', count: 1, flexible: true, openNow: false, stopKind: 'category' }]), { provider, search, dispatch });
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
  await runPlan(req([{ id: 's-1', query: '없는가게', count: 1, flexible: true, openNow: false, stopKind: 'category' }]), { provider: mockRouteProvider(), search, dispatch });
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { searchStatus?: string }[] }).slots;
  assert.equal(slots[0].searchStatus, 'none');
  assert.equal(actions[actions.length - 1].type, 'RESULT');
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
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false, stopKind: 'category' }, { id: 's-2', query: '파리바게뜨', count: 1, flexible: true, openNow: false, stopKind: 'category' }]), { provider: mockRouteProvider(), search, dispatch });
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
        ? [{ id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: 'category' as const }]
        : [
            { id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: 'category' as const },
            { id: 's2', query: '카페', count: 1, flexible: true, openNow: false, stopKind: 'category' as const },
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
      stops: [{ id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: o.stopKind }],
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
async function runTrendSwap(arriveByMin: number | null): Promise<PlanFlowAction[]> {
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
    req([{ id: 's1', query: '카페', count: 1, flexible: true, openNow: false, stopKind: 'category' }], {
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
    req([{ id: 's1', query: '카페', count: 1, flexible: true, openNow: false, stopKind: 'category' }], {
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
        { id: 's1', query: '카페', count: 1, flexible: true, openNow: false, stopKind: 'category' },
        { id: 's2', query: '베이커리', count: 1, flexible: true, openNow: false, stopKind: 'category' },
      ],
      { origin: { latitude: 37.5, longitude: 127.0 }, destination: { latitude: 37.5, longitude: 127.2 }, departAtMin: 540, arriveByMin: 598, order: 'locked' },
    ),
    { provider: mockRouteProvider(), search: twoSlotSearch, enrich: enrich as never, dispatch: a => actions.push(a) },
  );
  const overrides = actions.filter(a => a.type === 'SET_OVERRIDE') as { slotId: string; candidateId: string }[];
  assert.deepEqual(overrides.map(o => o.slotId), ['s1'], `첫 슬롯만 바뀌어야 하는데: ${JSON.stringify(overrides)}`);
});

test('보강이 응답 없이 걸려도(hang) 파이프라인은 12초 예산 안에서 끝난다', async () => {
  const actions: PlanFlowAction[] = [];
  await runPlan(
    req([{ id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: 'category' }]),
    {
      provider: mockRouteProvider(),
      search: async () => Array.from({ length: 6 }, (_, i) => ({
        id: `c${i}`, name: `가게${i}`, coord: { latitude: 37.5 + i * 0.001, longitude: 127.0 },
      })),
      enrich: () => new Promise(() => {}), // 절대 안 끝나는 보강
      dispatch: a => actions.push(a),
      timeoutMs: 30,
    },
  );
  const last = actions[actions.length - 1];
  assert.equal(last.type, 'FAIL');
  assert.equal((last as { type: 'FAIL'; error: { kind: string } }).error.kind, 'timeout');
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
      { id: 's1', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: 'category' },
      { id: 's2', query: '카페', count: 1, flexible: true, openNow: false, stopKind: 'category' },
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
