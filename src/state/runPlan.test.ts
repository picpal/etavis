import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineM } from '../lib/geo';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import type { PlaceCandidate } from '../lib/routePlan/types';
import type { SearchFn } from '../lib/corridorSearch';
import { dwellFor, runPlan } from './runPlan';
import type { PlanFlowAction, PlanRequest } from './planFlow';

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
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false }, { id: 's-2', query: '파리바게뜨', count: 1, flexible: true, openNow: false }]), { provider, search, dispatch });
  const types = actions.map(a => a.type);
  assert.deepEqual(types.slice(0, 2), ['START', 'PROGRESS']);
  assert.ok(types.includes('SLOTS'));
  assert.equal(types[types.length - 1], 'RESULT');
  const result = (actions[actions.length - 1] as { type: 'RESULT'; result: { apiCalls: number; measuredCount: number } }).result;
  assert.equal(provider.calls, result.apiCalls + 1); // 직행 1 + 플래너 호출
  assert.equal(result.measuredCount, provider.calls);
  const slots = (actions.find(a => a.type === 'SLOTS') as { type: 'SLOTS'; slots: { id: string; searchStatus?: string; candidates: unknown[] }[] }).slots;
  assert.equal(slots[0].id, 's-1');
  assert.equal(slots[0].candidates.length, 2);
  assert.equal(slots[0].searchStatus, 'ok');
});

test('검색 0건 슬롯은 none으로 남고 계획은 진행된다', async () => {
  const { actions, dispatch } = collect();
  await runPlan(req([{ id: 's-1', query: '없는가게', count: 1, flexible: true, openNow: false }]), { provider: mockRouteProvider(), search, dispatch });
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
  await runPlan(req([{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false }, { id: 's-2', query: '파리바게뜨', count: 1, flexible: true, openNow: false }]), { provider: mockRouteProvider(), search, dispatch });
  const p = actions.find(a => a.type === 'PROGRESS' && a.key === 'search') as { detail?: string };
  assert.equal(p.detail, '올리브영 2곳 · 파리바게뜨 1곳');
});

test('dwellFor — 카테고리 기본값', () => {
  assert.equal(dwellFor('스타벅스'), 5);
  assert.equal(dwellFor('편의점'), 3);
  assert.equal(dwellFor('이마트'), 15);
  assert.equal(dwellFor('올리브영'), 10);
});
