import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { plan } from '../lib/routePlan/plan';
import type { PlaceCandidate, Slot } from '../lib/routePlan/types';
import { effectiveVisits, optionTitle, toLegacyPlan } from './planFlowBridge';
import { initialPlanFlow, planFlowReducer, type PlanFlowState, type PlanRequest } from './planFlow';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, name: string, coord: { latitude: number; longitude: number }, extra: Partial<PlaceCandidate> = {}): PlaceCandidate => ({ id, name, coord, ...extra });
const slots: Slot[] = [
  { id: 's-1', query: '올리브영', dwellMin: 10, count: 1, flexible: true, openNow: false, searchStatus: 'ok',
    candidates: [c('oy1', '올리브영 A', at(37.5, 127.05)), c('oy2', '올리브영 B', at(37.505, 127.07)), c('oy3', '올리브영 C', at(37.45, 127.06), { hours: { openMin: 600, closeMin: 1320 } })] },
  { id: 's-2', query: '파리바게뜨', dwellMin: 5, count: 1, flexible: true, openNow: false, searchStatus: 'ok',
    candidates: [c('pb1', '파리바게뜨 A', at(37.5, 127.09)), c('pb2', '파리바게뜨 B', at(37.495, 127.08))] },
];
const req: PlanRequest = { origin: O, destination: D, originName: '집', destinationName: '회사', mode: 'car', arriveByMin: 560, departAtMin: 480, stops: slots.map(s => ({ id: s.id, query: s.query, count: 1, flexible: true, openNow: false })), order: 'auto' };

async function ready(): Promise<PlanFlowState> {
  const result = await plan({ origin: O, destination: D, departAtMin: 480, arriveByMin: 560, mode: 'car', slots, order: 'auto' }, mockRouteProvider());
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'SLOTS', slots });
  return planFlowReducer(s, { type: 'RESULT', result });
}

test('effectiveVisits — 오버라이드 없으면 옵션 그대로, 있으면 rescore', async () => {
  const s = await ready();
  const plain = effectiveVisits(s.result!, 0, {});
  assert.equal(plain.timing.estimated, false);
  assert.equal(plain.timing.totalMin, s.result!.options[0].totalMin);
  const swapped = effectiveVisits(s.result!, 0, { 0: { 's-1': 'oy2' } });
  assert.equal(swapped.visits.find(v => v.slotId === 's-1')!.candidate.id, 'oy2');
  assert.ok(swapped.timing.totalMin !== plain.timing.totalMin);
});

test('optionTitle — 1안은 가장 빠름, 후보 다르면 "대신", 순서만 다르면 순서 바꿈', async () => {
  const s = await ready();
  assert.equal(optionTitle(s.result!, 0), '가장 빠름');
  for (let i = 1; i < s.result!.options.length; i++) {
    const t = optionTitle(s.result!, i);
    assert.ok(/대신|순서 바꿈|번째로 빠름/.test(t), t);
  }
});

test('toLegacyPlan — stops·legs·candidates·options가 기존 형식으로', async () => {
  const s = await ready();
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  assert.equal(p.stops.length, 2);
  assert.equal(p.stops[0].baseId, p.stops[0].id);
  assert.match(p.stops[0].arriveAt, /^\d{1,2}:\d{2}$/);
  assert.equal(p.stops[0].tasks.length, 0);
  assert.equal(p.dataset.key, 'live');
  assert.equal(p.dataset.directMin, Math.round(s.result!.directMin));
  // legs — origin>슬롯, 슬롯>슬롯, 슬롯>dest 전부
  const ids = p.stops.map(st => st.baseId);
  assert.ok(p.dataset.legs![`origin>${ids[0]}`]);
  assert.ok(p.dataset.legs![`${ids[0]}>${ids[1]}`]);
  assert.ok(p.dataset.legs![`${ids[1]}>dest`]);
  assert.ok(p.dataset.legs![`origin>${ids[1]}`], '역순 재정렬용 leg');
  // candidates — 선택된 곳은 recommended, 마감은 disabled
  const oy = p.dataset.candidates['s-1'];
  assert.ok(oy.find(x => x.recommended));
  assert.equal(oy.find(x => x.name === '올리브영 C')?.disabled, true);
  assert.equal(p.dataset.options.length, s.result!.options.length);
  assert.equal(p.dataset.options[0].stopNames[0], '집');
  assert.equal(p.selectedOptionId, p.dataset.options[0].id);
});
