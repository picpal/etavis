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
