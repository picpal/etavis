/**
 * 확정 뒤(A6) 매장을 바꾸고 두 구간을 재면 '약'이 지워지나 — **끝에서 끝까지**.
 *
 * 이 구간이 비어 있었다. `measureSwap.test.ts` 는 관문까지고 `plan.test.ts` 는 `LEGS_LEARNED`
 * 리듀서까지인데, 기기에서 깨진 자리는 **그 사이**였다(2026-09-21, A5 는 되는데 A6 만 '약').
 * 그래서 여기는 진짜 플래너부터 리듀서까지를 한 줄로 잇는다:
 *
 *   plan() → toLegacyPlan → APPLY_LIVE → swapTargetFromStops → 관문 → measureSwap
 *          → buildLegs/buildCandidates → LEGS_LEARNED → dataset.legEstimated
 *
 * 훅(`useSwapMeasureA6`)만 빠져 있는데, 그건 이 함수들을 순서대로 부르는 것 말고 하는 일이 없다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanFlowState } from './planFlow';
import type { PlanResult, PlaceCandidate, Slot } from '../lib/routePlan/types';
import type { PlanState } from './plan';

(globalThis as Record<string, unknown>).__DEV__ = false;

/* plan.tsx 는 react-native·expo 를 물어 node 가 그냥은 못 읽는다 — plan.test.ts 와 같은 스텁 */
const Module = require('module');
const loadOrig = Module._load;
const stubs: Record<string, unknown> = {
  'react-native': {
    Platform: { OS: 'ios' },
    UIManager: {},
    LayoutAnimation: { configureNext: () => {}, Presets: { easeInEaseOut: {} } },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  },
  'expo-location': {},
  'expo-file-system': { Directory: class {}, File: class {}, Paths: {} },
  'expo-sharing': {},
};
Module._load = (req: string, parent: unknown, isMain: boolean) =>
  req in stubs ? stubs[req] : loadOrig.call(Module, req, parent, isMain);

const { planReducer } = require('./plan') as typeof import('./plan');
const { plan } = require('../lib/routePlan/plan') as typeof import('../lib/routePlan/plan');
const { mockRouteProvider } = require('../lib/routePlan/mockProvider') as typeof import('../lib/routePlan/mockProvider');
const bridge = require('./planFlowBridge') as typeof import('./planFlowBridge');
const { shouldKeepCommittedPlan } = require('./chips') as typeof import('./chips');
const { a6SwapTarget, swapTargetFromStops, swapSkipReason } = require('./measureSwap') as typeof import('./measureSwap');

const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const c = (id: string, coord: { latitude: number; longitude: number }): PlaceCandidate => ({ id, name: id, coord });
const mkSlot = (id: string, candidates: PlaceCandidate[]): Slot =>
  ({ id, query: id, candidates, dwellMin: 10, count: 1, flexible: true, openNow: false, stopKind: 'category' });

/* 회랑은 위도 37.5 위의 일직선이다. 장벽이 37.5015 를 가로막아, **회랑 밖(북쪽) 후보로 가는
   구간만** 20km 를 더 문다 — 실측 ≈ 64분 대 추정 ≈ 4분. 시드끼리는 장벽을 안 건드리므로
   기준 안은 전부 실측이고, 북쪽 후보는 재기 전에 진짜로 '약'이다(기기와 같은 상태).
   지형이 순하면 후보가 재기도 전에 measured 로 나와 이 테스트가 아무것도 안 가른다 */
const BARRIER = { a: at(37.5015, 127.005), b: at(37.5015, 127.018), penaltyKm: 20 };

/* 회랑 위 후보를 넉넉히 둔다 — 시드 예산(`TRANSIT_SEED_BUDGET`)이 이쪽으로 다 나가야
   AG 가 **시드 밖**으로 남는다. 후보가 둘뿐이면 플래너가 AG 까지 재 버려서, 바꾸기도 전에
   'measured' 가 되고 이 테스트는 아무것도 안 가른다(처음에 그렇게 짰다가 전제에서 빨갛게 났다) */
const A1 = c('a1', at(37.5, 127.0113));
const A3 = c('a3', at(37.5, 127.0225));
const A5 = c('a5', at(37.5, 127.034));
const AG = c('aG', at(37.5027, 127.0113)); // 300m 북쪽 — 장벽 너머라 재기 전엔 추정
const B1 = c('b1', at(37.5, 127.07));

const REQUEST = {
  origin: at(37.5, 127.0), destination: at(37.5, 127.1136),
  originName: '서교동', destinationName: '코엑스',
  mode: 'transit' as const, arriveByMin: null, departAtMin: 1343, stops: [], order: 'auto' as const,
};

/** 경유 2곳짜리 실측 계획 — A5 에서는 아무것도 안 바꾸고 그대로 확정한 상태까지 만든다 */
async function confirmedPlan() {
  const inner = mockRouteProvider({ barrier: BARRIER });
  // 목은 source 를 안 붙여 estimate 로 떨어진다. 기기처럼 공급자가 실측이라고 말하게 한다
  const provider = {
    route: async (pts: Parameters<typeof inner.route>[0], d: number, m: Parameters<typeof inner.route>[2]) =>
      ({ ...(await inner.route(pts, d, m)), source: 'provider' as const, legJoined: true }),
  };
  const slots = [mkSlot('a', [A1, A3, A5, AG]), mkSlot('b', [B1])];
  const result: PlanResult = await plan({ ...REQUEST, slots }, provider);
  const flow = {
    result, request: REQUEST, slots, selectedOptionIdx: 0, overrides: {}, legsVersion: 0,
    phase: 'ready', progress: [], error: null,
  } as unknown as PlanFlowState;
  // 확정 — A5 가 하는 그대로. 출발 시각만 지금으로 옮긴다
  const payload = bridge.toLegacyPlan({ flow, departMin: 1400 });
  const fresh = planReducer({} as PlanState, { type: 'SET_DATASET', key: 'device-0914' });
  const state = planReducer(fresh, { type: 'APPLY_LIVE', payload });
  return { result, slots, state };
}

test('확정본 스톱은 계획의 방문으로 되돌아간다 — A5 에 없고 A6 에만 있는 구간이라 여기서 끊기면 조용히 안 잰다', async () => {
  const { slots, state } = await confirmedPlan();
  const t = swapTargetFromStops(slots, state.stops, state.stops[0].id, AG.id);
  assert.notEqual(typeof t, 'string', typeof t === 'string' ? `되돌리기 실패: ${t}` : '');
  if (typeof t === 'string') return;
  assert.equal(t.idx, 0);
  assert.deepEqual(t.base.map(v => v.candidate.id), ['a1', 'b1'], '기준 안은 확정한 그 조합이다');
  assert.deepEqual(t.visits.map(v => v.candidate.id), ['aG', 'b1'], '바꾼 안은 고른 후보가 들어간 조합이다');
});

test('확정 뒤 바꾼 두 구간을 재면 dataset.legEstimated 가 거짓이 된다 — A6 의 약은 leg 저장소가 아니라 후보 cls 가 정한다', async () => {
  const { result, slots, state } = await confirmedPlan();
  assert.equal(state.dataset.timingSource, 'provider_legs', '전제: 실측 계획으로 확정했다');
  assert.equal(state.dataset.legEstimated, false, '전제: 확정 직후엔 추정 구간이 없다');

  const stopId = state.stops[0].id;
  const t = swapTargetFromStops(slots, state.stops, stopId, AG.id);
  assert.notEqual(typeof t, 'string', typeof t === 'string' ? `되돌리기 실패: ${t}` : '');
  if (typeof t === 'string') return;

  // 화면이 하는 일 — 교체는 즉시 먹고, 재는 건 뒤에서 돈다
  const replaced = planReducer(state, { type: 'REPLACE_LOCAL', stopId, candidateId: AG.id });
  assert.equal(replaced.dataset.legEstimated, true, '전제: 장벽 너머 후보라 바꾼 직후엔 진짜로 추정이다');

  assert.equal(swapSkipReason(result, t.base, t.visits, t.idx), null, '관문을 통과해야 호출이 나간다');
  assert.equal(await result.measureSwap(t.visits, t.idx), true, '예산 안이고 두 구간이 다 들어왔다');

  const learned = planReducer(replaced, {
    type: 'LEGS_LEARNED',
    legs: bridge.buildLegs(result, t.visits, REQUEST.departAtMin),
    candidates: bridge.buildCandidates(result, slots, t.visits),
  });
  assert.equal(learned.dataset.legEstimated, false, '재고 나면 약이 지워진다 — 이게 6단계의 전부다');
  assert.equal(learned.stops[0].name, 'aG', '고른 매장은 그대로다');
});


/* ── 안 잰 이유는 반드시 이름이 있어야 한다 ─────────────────────────────────
   조용히 `return` 하면 기기에서 못 짚는다. 아래 넷이 A6 가 끊길 수 있는 자리 전부고,
   훅은 그 이름을 그대로 `cand.measureSkip` 로그로 흘린다. */

test('없는 스톱을 가리키면 stop-not-found — 목록이 그 사이 바뀐 것이지 잴 대상이 없는 게 아니다', async () => {
  const { slots, state } = await confirmedPlan();
  assert.equal(swapTargetFromStops(slots, state.stops, '없는스톱', AG.id), 'stop-not-found');
});

test('슬롯이 없으면 slot-not-found — 목 데이터셋 스톱이 섞인 것이다', async () => {
  const { state } = await confirmedPlan();
  // 남의 계획 구간을 재고 그 결과를 이 화면에 붙이느니 '약'이 남는 편이 정직하다
  assert.equal(swapTargetFromStops([], state.stops, state.stops[0].id, AG.id), 'slot-not-found');
});

test('확정본 스톱은 selectedCandidateId 를 들고 있다 — 이게 비면 A6 는 첫 교체에서 늘 막힌다', async () => {
  /* `toLegacyPlan` 이 그 필드를 떼는 건 **`dataset.stops`** 뿐이다(Dataset 의 `Stop` 엔 그 칸이
     없다). payload 의 `stops` 는 들고 있고 `APPLY_LIVE` 는 그걸 그대로 체인에 태운다.
     여기가 비어 있었다면 아래 되돌리기가 `stop-candidate-unknown` 을 냈을 것이다 */
  const { slots, state } = await confirmedPlan();
  assert.deepEqual(state.stops.map(s => s.selectedCandidateId), ['a1', 'b1']);
  assert.notEqual(typeof swapTargetFromStops(slots, state.stops, state.stops[0].id, AG.id), 'string');

  // 필드가 비면 슬롯은 멀쩡한데 후보를 못 집는다 — 슬롯이 없는 것과 다른 병, 다른 이름
  const blanked = state.stops.map(s => ({ ...s, selectedCandidateId: undefined }));
  assert.equal(swapTargetFromStops(slots, blanked, blanked[0].id, AG.id), 'stop-candidate-unknown');
});

test('시트가 넘긴 후보가 슬롯에 없으면 candidate-not-in-slot', async () => {
  const { slots, state } = await confirmedPlan();
  assert.equal(swapTargetFromStops(slots, state.stops, state.stops[0].id, '없는후보'), 'candidate-not-in-slot');
});

test('앞선 교체가 시계를 창 밖으로 밀어 놓았으면 base-has-estimate 로 멈춘다 — 재도 약이 안 지워지니 부르지 않는다', async () => {
  /* A5 에서 이미 한 번 바꿔 실측한 뒤 확정한 경우다. 새로 잰 앞 구간이 뒤 구간의 조회 시각을
     LegStore 의 창(15분) 밖으로 밀면, 멀쩡히 잰 마지막 구간이 '그 시각엔 모른다'가 된다 —
     시간표는 출발 시각이 바뀌면 진짜로 다르다. 그 상태에서 두 구간을 더 사도 배너의 '약'은
     그대로라, 안 부르는 것이 맞는 동작이다. **기기에서 이 이름이 찍히면 결함이 아니라 이 자리다.** */
  const { result } = await confirmedPlan();
  const base = result.options[0].visits;
  const swapped = base.map((v, i) => (i === 0 ? { ...v, candidate: AG } : v));
  assert.equal(swapSkipReason(result, base, swapped, 0), null, '전제: 첫 교체는 잰다');
  assert.equal(await result.measureSwap(swapped, 0), true);

  const after = result.rescore(swapped).legCls;
  assert.deepEqual(after.slice(0, 2), ['measured', 'measured'], '바꾼 두 구간은 실측으로 섰다');
  assert.equal(after[2], 'estimated', '전제: 장벽 때문에 시계가 60분 밀려 마지막 구간이 창 밖이다');

  // 이 안을 확정하고 A6 에서 또 바꾸려 하면 — 기준 안에 추정이 있으니 부르지 않는다
  const again = swapped.map((v, i) => (i === 0 ? { ...v, candidate: A3 } : v));
  assert.equal(swapSkipReason(result, swapped, again, 0), 'base-has-estimate');
});


/* ── 확정하면서 계획을 버리면 A6 는 아무것도 못 잰다 ──────────────────────────
   기기(2026-09-21): A5 확정 → A6 첫 교체에서 `cand.measureSkip no-plan`. A5 확정은
   `navigation.reset` 으로 PlanScreen 을 스택에서 걷어내는데, 포커스 없는 `beforeRemove` 가
   그 자리에서 `flow.reset()` 을 불러 **방금 확정한 계획의 PlanResult** 를 버렸다.
   확정본(스톱·후보·leg 표)은 스토어에 남아 화면은 멀쩡하고, 다시 잴 수단만 없다.
   그래서 '약'이 끝까지 남고 `조회 중` 도 안 뜬다 — 가장 짚기 어려운 모양의 고장이다. */

test('계획이 버려졌으면 no-plan 이다 — 스톱을 못 되돌린 것과 같은 이름을 쓰면 기기 로그가 엉뚱한 곳을 가리킨다', async () => {
  const { slots, state } = await confirmedPlan();
  const stopId = state.stops[0].id;

  // 확정 직후 PlanScreen 이 떠나며 flow 를 비운 상태
  assert.equal(a6SwapTarget({ result: null, slots }, state.stops, stopId, AG.id), 'no-plan');

  // 계획이 살아 있으면 같은 입력이 그대로 통한다 — 스톱도 후보도 멀쩡했다는 뜻이다
  const alive = a6SwapTarget({ result: (await confirmedPlan()).result, slots }, state.stops, stopId, AG.id);
  assert.notEqual(typeof alive, 'string', typeof alive === 'string' ? `살아 있는데 막혔다: ${alive}` : '');
});

test('떠날 때 계획을 지키는 규칙은 스토어와 화면이 같다 — 화면만 따로 버려서 A6 가 조용해졌다', () => {
  // 스토어는 `RESET_CHAT` 에서 이 규칙으로 확정 계획을 지킨다. 화면의 `flow.reset()` 도 같은
  // 규칙을 타야 한다 — 확정하고 나가는 길에서만 플래너 결과가 살아남는다
  assert.equal(shouldKeepCommittedPlan('leavingChat', true), true, '확정하고 나가면 계획을 지킨다');
  assert.equal(shouldKeepCommittedPlan('leavingChat', false), false, '확정 안 했으면 버린다');
  assert.equal(shouldKeepCommittedPlan('newChat', true), false, '새 대화는 확정했어도 버린다');
});
