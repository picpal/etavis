import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM } from '../lib/geo.ts';
import { mockRouteProvider } from '../lib/routePlan/mockProvider.ts';
import type { PlaceCandidate } from '../lib/routePlan/types.ts';
import type { SearchFn } from '../lib/corridorSearch.ts';
import { dwellFor, runPlan } from './runPlan.ts';
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
