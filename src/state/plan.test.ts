/**
 * 계획 스토어 리듀서 — 계획을 확정하면 주행 진행 상태가 어떻게 되나.
 *
 * `plan.tsx` 는 react-native·expo 를 물어 node 가 그냥은 못 읽는다. chips.ts 처럼 순수
 * 조각을 또 떼어 낼 수도 있었지만, 여기서 확인해야 할 것은 **리듀서가 상태를 어떻게
 * 이어 붙이느냐**(스프레드 순서까지)라서 떼어 내면 정작 틀렸던 자리가 테스트 밖에
 * 남는다. 그래서 리듀서가 실제로 쓰는 네 모듈만 스텁으로 끼우고 그대로 읽는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApplyLivePayload, PlanAction, PlanState } from './plan';

(globalThis as Record<string, unknown>).__DEV__ = false;

/* 값 import 는 hoisting 때문에 못 쓴다 — 스텁을 깔기 전에 plan.tsx 가 먼저 읽힌다 */
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
const { datasets } = require('../data/mockData') as typeof import('../data/mockData');

const run = (state: PlanState, actions: PlanAction[]) => actions.reduce(planReducer, state);

/** 경유지 둘(s1·s2)짜리 초기 상태 */
const fresh = (): PlanState => planReducer({} as PlanState, { type: 'SET_DATASET', key: 'device-0914' });

/** 확정한 계획을 따라 s1·s2 를 지나 목적지까지 도착한 상태 */
const arrived = (): PlanState =>
  run(fresh(), [
    { type: 'ARRIVE_AT_STOP' },
    { type: 'DEPART_STOP' },
    { type: 'ARRIVE_AT_STOP' },
    { type: 'DEPART_STOP' },
    { type: 'ARRIVE_AT_DESTINATION' },
  ]);

/** s1 을 지나고 s2 에서 체류 중인 상태 */
const dwelling = (): PlanState =>
  run(fresh(), [{ type: 'ARRIVE_AT_STOP' }, { type: 'DEPART_STOP' }, { type: 'ARRIVE_AT_STOP' }]);

/** A5 확정이 스토어에 내려보내는 것 — 다른 데이터셋이라 완전히 다른 계획이다 */
const newPlan = (): ApplyLivePayload => {
  const ds = datasets.find(d => d.key === 'commute')!;
  return {
    dataset: ds,
    departMin: 9 * 60,
    selectedOptionId: ds.options[0].id,
    stops: ds.stops.map(s => ({ ...s, baseId: s.id, replaceDeltaMin: 0 })),
  };
};

test('새 계획을 확정하면 지나온 경유지 수가 0으로 돌아간다 — 안 그러면 진행중 탭이 옛 계획의 진행률을 말한다', () => {
  const before = arrived();
  assert.equal(before.passedCount, 2, '전제: 두 곳을 지나온 계획이어야 한다');

  const after = planReducer(before, { type: 'APPLY_LIVE', payload: newPlan() });

  assert.equal(after.passedCount, 0);
  assert.equal(after.arrivedAtDest, false, '새 계획은 아직 도착하지 않았다');
  assert.equal(after.atStop, false);
});

test('체류 중에 새 계획을 확정해도 되돌린다 — 새 계획의 첫 경유지는 아직 안 들른 곳이다', () => {
  const before = dwelling();
  assert.deepEqual(
    { passedCount: before.passedCount, atStop: before.atStop },
    { passedCount: 1, atStop: true },
    '전제: 한 곳을 지나고 다음 곳에서 체류 중이어야 한다',
  );

  const after = planReducer(before, { type: 'APPLY_LIVE', payload: newPlan() });

  assert.equal(after.passedCount, 0);
  assert.equal(after.atStop, false);
});

test('APPLY_OPTION 도 같은 자리다 — 확정이면(planConfirmed) 진행 상태도 새 계획 것이어야 한다', () => {
  const before = arrived();
  const after = planReducer(before, { type: 'APPLY_OPTION', id: before.options[0].id });

  assert.equal(after.planConfirmed, true, '전제: 이 액션은 계획을 확정한다');
  assert.equal(after.passedCount, 0);
  assert.equal(after.arrivedAtDest, false);
  assert.equal(after.atStop, false);
});

/*
  RESET_CHAT — "새로 계획하기로 들어가면 지난 대화가 없어야 한다".

  이 액션 자체는 처음부터 대화를 비웠다. 빠져 있던 건 **부르는 자리**였다:
  A2 가 나갈 때(`beforeRemove`)만 불렀는데 그 훅은 탭바로 나가는 경로에서 아예 안 뛴다
  (2026-09-16 시뮬레이터 실측: 재진입까지 beforeRemove 0회). 그래서 부르는 자리를
  '나갈 때'에서 '새로 시작할 때'(HomeScreen.enterChat)로 옮겼다.
  여기서는 그 자리가 기대하는 계약을 못박는다 — 어느 갈래로 가도 chat 은 비어야 한다.
*/
test('RESET_CHAT 은 대화를 비운다 — 확정 전(칩까지 되돌리는 갈래)', () => {
  const s = run(fresh(), [
    { type: 'PUSH_CHAT', text: '가는 길에 편의점 들러줘' },
    { type: 'PUSH_CHAT', text: 'GS25로' },
  ]);
  // fresh() 는 개발 메뉴의 목 데이터셋이라 예시 대화가 한 줄 깔려 있다 — 1 + 2
  assert.equal(s.chat.length, 3);
  const after = planReducer(s, { type: 'RESET_CHAT', mode: s.mode, arriveByMin: null, committed: false });
  assert.deepEqual(after.chat, [], '대화가 남으면 새 계획에 남의 말이 먼저 서 있다');
});

test('RESET_CHAT 은 확정된 계획에서도 대화를 비운다 — 칩은 남기더라도 기록은 비운다', () => {
  const s = run(fresh(), [{ type: 'CONFIRM_PLAN' }, { type: 'PUSH_CHAT', text: '편의점도' }]);
  const after = planReducer(s, { type: 'RESET_CHAT', mode: s.mode, arriveByMin: s.arriveByMin, committed: true });
  assert.deepEqual(after.chat, []);
  // committed 갈래는 칩·경유지를 그대로 둔다 — 확정한 계획을 대화 지운다고 흔들면 안 된다
  assert.equal(after.chips, s.chips, 'committed 면 칩은 같은 참조여야 한다');
  assert.deepEqual(after.stops, s.stops);
});

test('두 번째 RESET_CHAT 은 아무것도 바꾸지 않는다 — 진입할 때마다 불러도 안전해야 한다', () => {
  /* A2 로 들어갈 때마다 부르는 액션이라 멱등해야 한다. 안 그러면 대화 없이 들어갔다
     나오기만 해도 계획이 조금씩 달라진다 */
  const entry = { mode: fresh().mode, arriveByMin: null };
  const once = planReducer(fresh(), { type: 'RESET_CHAT', ...entry, committed: false });
  const twice = planReducer(once, { type: 'RESET_CHAT', ...entry, committed: false });
  assert.deepEqual(twice.chat, []);
  assert.deepEqual(twice.stops, once.stops, '두 번 불렀다고 경유지가 달라지면 안 된다');
  assert.deepEqual(twice.chips, once.chips);
  assert.equal(twice.mode, once.mode);
  assert.equal(twice.destinationName, once.destinationName, '목적지는 A1에서 고른 것이라 대화와 무관하다');
});
