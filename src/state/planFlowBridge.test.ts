import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { plan } from '../lib/routePlan/plan';
import type { PlaceCandidate, Slot } from '../lib/routePlan/types';
import { effectiveVisits, optionTitle, slotCandidates, toLegacyPlan } from './planFlowBridge';
import { initialPlanFlow, planFlowReducer, type PlanFlowState, type PlanRequest } from './planFlow';
import { toMin } from '../lib/clock';

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

test('slotCandidates — 신호가 있으면 trend 를 붙이고 note 를 근거로 바꾼다(혼재 포함)', async () => {
  // 어떤 후보가 지금 선택되는지 먼저 알아낸다 — 그 후보에는 신호를 안 붙여야
  // '현재 경로'가 근거 없이 원래 note 를 유지하는 경우를 확실히 본다
  const base = await ready();
  const currentId = effectiveVisits(base.result!, slots, 0, {}).visits.find(v => v.slotId === 's-1')!.candidate.id;
  const signalTargetId = slots.find(s => s.id === 's-1')!.candidates.find(c2 => c2.id !== currentId)!.id;

  const signalSlots: Slot[] = slots.map(s =>
    s.id === 's-1'
      ? { ...s, candidates: s.candidates.map(cand => cand.id === signalTargetId
          ? { ...cand, signals: { google: { rating: 4.5, ratingCount: 120, hours: null, matchedName: cand.name }, fetchedAt: '2026-01-01T00:00:00.000Z' } }
          : cand) }
      : s,
  );
  const result = await plan({ origin: O, destination: D, departAtMin: 480, arriveByMin: 560, mode: 'car', slots: signalSlots, order: 'auto' }, mockRouteProvider());
  const { visits, timing } = effectiveVisits(result, signalSlots, 0, {});
  const idx = visits.findIndex(v => v.slotId === 's-1');
  const list = slotCandidates(result, signalSlots, visits, idx, timing);

  // 신호가 하나라도 있으면 슬롯 후보 전부에 trend 가 붙는다 — 신호 없는 후보도 fit 만으로 점수를 받는다(혼재)
  assert.ok(list.every(x => x.trend), 's-1 슬롯은 신호가 있으니 후보 전부에 trend 가 있어야 한다');

  const withSignal = list.find(x => x.id === signalTargetId)!;
  assert.ok(withSignal.trend!.reasons.length > 0);
  assert.equal(withSignal.note, withSignal.trend!.reasons.join(' · '));

  const current = list.find(x => x.id === visits[idx].candidate.id)!;
  assert.equal(current.trend!.reasons.length, 0, '지금 경로는 추가시간 0·신호 없음이라 근거가 비어야 한다');
  assert.equal(current.note, '올리브영 · 현재 경로', '근거가 없으면 note 는 원래 문구를 유지해야 한다');

  // 신호가 없는 슬롯은 그대로 — trend 가 붙지 않는다
  const idx2 = visits.findIndex(v => v.slotId === 's-2');
  const list2 = slotCandidates(result, signalSlots, visits, idx2, timing);
  assert.ok(list2.every(x => x.trend === undefined), 's-2 슬롯은 신호가 없으니 trend 가 붙지 않아야 한다');

  // +N분을 reasons에서 뺀 뒤로는 '추가시간이 0이 아닌데 근거가 비는' 경우가 새로 생긴다 —
  // 지금 경로(current)는 addedMin이 항상 0이라 이 케이스를 가리지 못한다. s-1의 세 번째
  // 후보(현재도 아니고 신호도 안 받은 쪽)로 확인한다. 원래 문구(추정 여부 포함)는
  // 신호를 하나도 안 받은 baseline 계산에서 그대로 가져와 비교한다 — 문자열을 직접
  // 재구성하면 alternativeToCandidate의 '· 추정' 분기를 다시 베끼는 셈이라 깨지기 쉽다
  const bystander = list.find(x => x.id !== current.id && x.id !== withSignal.id)!;
  assert.ok(bystander, 's-1에 신호 없는 제3의 후보가 있어야 한다');
  assert.notEqual(bystander.addedMin, 0, '추가시간이 0이 아닌 후보로 검증해야 current와 같은 케이스가 되지 않는다');
  assert.equal(bystander.trend!.reasons.length, 0, '이 후보 자신에게는 구글·블로그 신호가 없으니 근거가 비어야 한다');
  const baseline = slotCandidates(base.result!, slots, effectiveVisits(base.result!, slots, 0, {}).visits, idx, effectiveVisits(base.result!, slots, 0, {}).timing);
  const bystanderBaseline = baseline.find(x => x.id === bystander.id)!;
  assert.equal(bystander.note, bystanderBaseline.note, '근거가 없으면 추가시간이 0이 아니어도 note는 원래 문구를 유지해야 한다');
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

/* 도착 시각 일관성 — A5(원본 timing)와 타임라인(legs 재계산)이 같은 숫자를 말해야 한다.
   예전엔 구간마다 Math.round 를 해서 1분씩 증발했다. */

/** plan.tsx 의 computeChain 과 같은 방식으로 체인을 다시 잇는다 */
function rechain(p: ReturnType<typeof toLegacyPlan>, departMin: number) {
  const legOf = (a: string, b: string) =>
    p.dataset.legs![`${a}>${b}`] ?? p.dataset.legs![`${b}>${a}`] ?? { min: 10, km: 5 };
  let clock = departMin;
  const arrivals: number[] = [];
  p.stops.forEach((st, i) => {
    clock += legOf(i === 0 ? 'origin' : p.stops[i - 1].baseId, st.baseId).min;
    arrivals.push(clock);
    clock += st.dwellMin;
  });
  clock += legOf(p.stops[p.stops.length - 1].baseId, 'dest').min;
  return { arrivals, destArrive: clock, totalMin: clock - departMin };
}

test('legs 를 이어 붙인 총시간이 A5 의 timing 과 정확히 같다 — 구간별 반올림은 1분을 증발시킨다', async () => {
  const s = await ready();
  const { timing } = effectiveVisits(s.result!, slots, 0, {});
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  const chain = rechain(p, 480);

  assert.equal(chain.totalMin, timing.totalMin, '총시간이 어긋나면 A5 와 타임라인이 다른 답을 말한다');
  timing.arrivals.forEach((a, i) => {
    if (i < chain.arrivals.length) assert.equal(chain.arrivals[i], a, `${i}번째 경유지 도착`);
  });
});

test('legs 분은 반올림하지 않는다 — 화면에 나가는 값이 아니라 체인의 재료다', async () => {
  const s = await ready();
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  const mins = Object.values(p.dataset.legs!).map(l => l.min);
  assert.ok(mins.some(m => !Number.isInteger(m)), '전부 정수면 정밀도를 이미 버린 것이다');
});

test('stops 의 legMin 은 표시용이라 정수다 — 화면이 "이동 11.468분"을 보면 안 된다', async () => {
  const s = await ready();
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  for (const st of p.stops) assert.ok(Number.isInteger(st.legMin), `${st.baseId} legMin=${st.legMin}`);
});

/* 재클럭 — A5 에 머문 시간만큼 시계를 민다 */

test('departMin 을 옮기면 도착 시각이 같은 폭으로 밀린다 — 소요시간은 그대로다', async () => {
  const s = await ready();
  const base = toLegacyPlan({ flow: s, departMin: 480 });
  const later = toLegacyPlan({ flow: s, departMin: 480 + 17 });

  assert.deepEqual(
    later.stops.map(st => st.legMin),
    base.stops.map(st => st.legMin),
    '구간 소요시간은 시계를 옮겨도 변하지 않는다',
  );
  base.stops.forEach((st, i) => {
    assert.equal(toMin(later.stops[i].arriveAt) - toMin(st.arriveAt), 17, `${st.baseId} 도착이 17분 밀려야 한다`);
  });
  assert.equal(later.dataset.totals.totalMin, base.dataset.totals.totalMin, '총시간은 그대로');
});

test('재클럭해도 체인은 여전히 timing 과 맞는다 — 시계만 옮기고 소요시간은 안 건드린다', async () => {
  const s = await ready();
  const { timing } = effectiveVisits(s.result!, slots, 0, {});
  const p = toLegacyPlan({ flow: s, departMin: 480 + 25 });
  assert.equal(rechain(p, 480 + 25).totalMin, timing.totalMin);
});

/* 하이브리드 공급자 — 서버는 자동차만 받는다. 나머지를 던지면 계획 전체가 죽는다. */

test('자동차는 서버로, 도보·대중교통은 목으로 간다 — 던지지 않는다', async () => {
  const calls: string[] = [];
  const mk = (tag: string) => ({
    route: async (_p: unknown, _d: number, mode: string) => {
      calls.push(`${tag}:${mode}`);
      if (tag === 'server' && mode !== 'car') throw new Error(`server route: ${mode} 미지원`);
      return { durationMin: 10, distanceKm: 5, sections: [], polyline: [] } as never;
    },
  });
  const hybrid = {
    route: (points: never, departAtMin: number, mode: 'car' | 'walk' | 'transit') =>
      (mode === 'car' ? mk('server') : mk('mock')).route(points, departAtMin, mode),
  };
  for (const m of ['car', 'walk', 'transit'] as const) {
    await hybrid.route([] as never, 480, m); // 던지면 여기서 테스트가 죽는다
  }
  assert.deepEqual(calls, ['server:car', 'mock:walk', 'mock:transit']);
});

test('toLegacyPlan — timingSource 를 확정본에 싣고, 1안 근거는 출처에 맞게', async () => {
  const s = await ready(); // mockRouteProvider → estimate
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  assert.equal(p.dataset.timingSource, 'estimate');
  assert.equal(p.dataset.options[0].rationale, '추정으로 계산한 경로예요 · 실측 전');
  const stamped = { ...s, result: { ...s.result!, timingSource: 'provider' as const } };
  const q = toLegacyPlan({ flow: stamped, departMin: 480 });
  assert.equal(q.dataset.timingSource, 'provider');
  assert.match(q.dataset.options[0].rationale, /^실측 \d+회로 확인한 경로예요\.$/);
});
