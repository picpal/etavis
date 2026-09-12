import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { plan } from '../lib/routePlan/plan';
import type { PlaceCandidate, Slot } from '../lib/routePlan/types';
import { effectiveVisits, optionTitle, slotCandidates, toLegacyPlan } from './planFlowBridge';
import { initialPlanFlow, planFlowReducer, type PlanFlowState, type PlanRequest } from './planFlow';

const O = { latitude: 37.5, longitude: 127.0 };
const D = { latitude: 37.5, longitude: 127.1136 };
const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, name: string, coord: { latitude: number; longitude: number }, extra: Partial<PlaceCandidate> = {}): PlaceCandidate => ({ id, name, coord, ...extra });
const slots: Slot[] = [
  { id: 's-1', query: '올리브영', dwellMin: 10, count: 1, flexible: true, openNow: false, stopKind: 'category', searchStatus: 'ok',
    candidates: [c('oy1', '올리브영 A', at(37.5, 127.05)), c('oy2', '올리브영 B', at(37.505, 127.07)), c('oy3', '올리브영 C', at(37.45, 127.06), { hours: { openMin: 600, closeMin: 1320 } })] },
  { id: 's-2', query: '파리바게뜨', dwellMin: 5, count: 1, flexible: true, openNow: false, stopKind: 'category', searchStatus: 'ok',
    candidates: [c('pb1', '파리바게뜨 A', at(37.5, 127.09)), c('pb2', '파리바게뜨 B', at(37.495, 127.08))] },
];
const req: PlanRequest = { origin: O, destination: D, originName: '집', destinationName: '회사', mode: 'car', arriveByMin: 560, departAtMin: 480, stops: slots.map(s => ({ id: s.id, query: s.query, count: 1, flexible: true, openNow: false, stopKind: 'category' as const })), order: 'auto' };

async function ready(): Promise<PlanFlowState> {
  const result = await plan({ origin: O, destination: D, departAtMin: 480, arriveByMin: 560, mode: 'car', slots, order: 'auto' }, mockRouteProvider());
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'SLOTS', slots });
  return planFlowReducer(s, { type: 'RESULT', result });
}

test('effectiveVisits — 오버라이드 없으면 옵션 그대로, 있으면 rescore', async () => {
  const s = await ready();
  const plain = effectiveVisits(s.result!, slots, 0, {});
  assert.equal(plain.timing.estimated, false);
  assert.equal(plain.timing.totalMin, s.result!.options[0].totalMin);
  const swapped = effectiveVisits(s.result!, slots, 0, { 0: { 's-1': 'oy2' } });
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

test('toLegacyPlan — 2안을 고르면 후보에 중복이 없고 recommended는 2안의 후보', async () => {
  const s0 = await ready();
  assert.ok(s0.result!.options.length >= 2, '픽스처가 2안 이상을 내야 이 테스트가 뜻이 있다');
  const s: PlanFlowState = { ...s0, selectedOptionIdx: 1 };
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  const option1 = s.result!.options[1];
  for (const slot of slots) {
    const list = p.dataset.candidates[slot.id];
    const ids = list.map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, `slot ${slot.id}: 후보 id 중복`);
    assert.equal(ids.length, slot.candidates.length, `slot ${slot.id}: 후보 개수는 슬롯 전체 후보 수와 같아야 한다`);
    const recommended = list.filter(x => x.recommended);
    assert.equal(recommended.length, 1, `slot ${slot.id}: recommended는 정확히 하나`);
    const expectedId = option1.visits.find(v => v.slotId === slot.id)!.candidate.id;
    assert.equal(recommended[0].id, expectedId, `slot ${slot.id}: recommended는 2안이 고른 후보여야 한다`);
  }
});

test('toLegacyPlan — 옵션 밖 후보로 오버라이드해도 legs가 빠지지 않는다', async () => {
  const extraSlots: Slot[] = slots.map(s =>
    s.id === 's-1' ? { ...s, candidates: [...s.candidates, c('oy4', '올리브영 D', at(37.51, 127.04))] } : s,
  );
  const result = await plan({ origin: O, destination: D, departAtMin: 480, arriveByMin: 560, mode: 'car', slots: extraSlots, order: 'auto' }, mockRouteProvider());
  assert.ok(!result.options.some(o => o.visits.some(v => v.candidate.id === 'oy4')), 'oy4는 어떤 옵션에도 뽑히지 않아야 이 테스트가 뜻이 있다');

  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'SLOTS', slots: extraSlots });
  s = planFlowReducer(s, { type: 'RESULT', result });
  s = planFlowReducer(s, { type: 'SET_OVERRIDE', optionIdx: 0, slotId: 's-1', candidateId: 'oy4' });

  const p = toLegacyPlan({ flow: s, departMin: 480 });
  const ids = p.stops.map(st => st.baseId);
  assert.equal(ids.length, 2);
  const expectedKeys = [
    `origin>${ids[0]}`, `${ids[0]}>${ids[1]}`, `${ids[1]}>${ids[0]}`,
    `${ids[0]}>dest`, `${ids[1]}>dest`, `origin>${ids[1]}`,
  ];
  for (const key of expectedKeys) assert.ok(p.dataset.legs![key], `leg 누락: ${key}`);

  const { timing } = effectiveVisits(result, extraSlots, 0, { 0: { 's-1': 'oy4' } });
  const toHHMM = (min: number) => {
    const m = Math.round(min);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  assert.equal(p.stops[0].arriveAt, toHHMM(timing.arrivals[0]));
});

test('slotCandidates — 2안에서도 중복 없이 슬롯 후보 전부, recommended는 2안의 픽', async () => {
  const s0 = await ready();
  assert.ok(s0.result!.options.length >= 2, '픽스처가 2안 이상을 내야 이 테스트가 뜻이 있다');
  const result = s0.result!;
  const { visits, timing } = effectiveVisits(result, slots, 1, {});
  visits.forEach((v, i) => {
    const slot = slots.find(x => x.id === v.slotId)!;
    const list = slotCandidates(result, slots, visits, i, timing);
    const ids = list.map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, `slot ${slot.id}: 후보 id 중복`);
    assert.deepEqual([...ids].sort(), slot.candidates.map(c2 => c2.id).sort(), `slot ${slot.id}: 슬롯 후보 전부가 나와야 한다`);
    const rec = list.filter(x => x.recommended);
    assert.equal(rec.length, 1, `slot ${slot.id}: recommended는 정확히 하나`);
    assert.equal(rec[0].id, v.candidate.id, `slot ${slot.id}: recommended는 2안이 고른 후보`);
  });
});

test('effectiveVisits — 2안에서 1안의 후보로 오버라이드해도 실제로 바뀐다', async () => {
  const s0 = await ready();
  const result = s0.result!;
  assert.ok(result.options.length >= 2);
  const base = effectiveVisits(result, slots, 1, {});
  // 1안과 2안이 다르게 고른 슬롯을 찾아, 2안 위에서 1안의 후보로 되돌린다
  const diff = base.visits.find(v => {
    const o0 = result.options[0].visits.find(x => x.slotId === v.slotId);
    return !!o0 && o0.candidate.id !== v.candidate.id;
  });
  assert.ok(diff, '1안과 2안이 다른 매장을 고른 슬롯이 있어야 이 테스트가 뜻이 있다');
  const target = result.options[0].visits.find(x => x.slotId === diff!.slotId)!.candidate.id;
  const after = effectiveVisits(result, slots, 1, { 1: { [diff!.slotId]: target } });
  assert.equal(after.visits.find(v => v.slotId === diff!.slotId)!.candidate.id, target, '오버라이드가 먹지 않았다');
  assert.notEqual(after.visits.find(v => v.slotId === diff!.slotId)!.candidate.id, diff!.candidate.id);
});

import { josa, optionDiff } from './planFlowBridge';

test('josa — 받침에 따라 을/를·으로/로·이/가, ㄹ받침은 로, 한글 아니면 받침 없음 취급', () => {
  assert.equal(josa('올리브영', '을/를'), '을');
  assert.equal(josa('빵집', '을/를'), '을');
  assert.equal(josa('회사', '을/를'), '를');
  assert.equal(josa('올리브영 여의도IFC점', '으로/로'), '으로');
  assert.equal(josa('서울', '으로/로'), '로');
  assert.equal(josa('회사', '으로/로'), '로');
  assert.equal(josa('GS25', '으로/로'), '로');
  assert.equal(josa('빵집', '이/가'), '이');
  assert.equal(josa('회사', '이/가'), '가');
});

test('optionDiff — 1안은 best, 후보 다르면 swap(from·to)', async () => {
  const s = await ready();
  assert.deepEqual(optionDiff(s.result!, 0), { kind: 'best' });
  for (let i = 1; i < s.result!.options.length; i++) {
    const d = optionDiff(s.result!, i);
    if (d.kind === 'swap') {
      assert.ok(d.swaps.length >= 1);
      for (const sw of d.swaps) assert.ok(sw.from && sw.to && sw.from !== sw.to);
    } else {
      assert.ok(d.kind === 'order' || d.kind === 'rank');
    }
  }
});
