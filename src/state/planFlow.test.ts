import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlanFlow, isBusy, planFlowReducer, requestKey, type PlanRequest } from './planFlow';
import type { PlanResult } from '../lib/routePlan/types';

const req: PlanRequest = {
  origin: { latitude: 37.5, longitude: 127 }, destination: { latitude: 37.6, longitude: 127.1 },
  originName: '집', destinationName: '회사', mode: 'car', arriveByMin: 540, departAtMin: 480,
  stops: [{ id: 's-1', query: '올리브영', count: 1, flexible: true, openNow: false }], order: 'auto',
};
const result = { options: [], alternatives: [], slotStatus: {}, apiCalls: 1, directMin: 20, directKm: 10, measuredCount: 1, legTable: {}, rescore: () => ({ totalMin: 0, arrivals: [], distanceKm: 0, estimated: true }) } as unknown as PlanResult;

test('START → direct, progress 4단계 미완', () => {
  const s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  assert.equal(s.phase, 'direct');
  assert.equal(s.progress.length, 4);
  assert.ok(s.progress.every(p => !p.done));
  assert.equal(s.request, req);
});

test('PROGRESS가 단계를 완료시키고 phase를 옮긴다', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'PROGRESS', key: 'direct', detail: '직행 20분' });
  assert.equal(s.phase, 'searching');
  assert.equal(s.progress[0].done, true);
  assert.equal(s.progress[0].detail, '직행 20분');
  s = planFlowReducer(s, { type: 'PROGRESS', key: 'search', detail: '올리브영 4곳' });
  assert.equal(s.phase, 'measuring');
  s = planFlowReducer(s, { type: 'RESULT', result });
  assert.equal(s.phase, 'ready');
  assert.ok(s.progress.every(p => p.done));
  assert.equal(s.selectedOptionIdx, 0);
});

test('FAIL은 어느 단계에서든 failed', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'FAIL', error: { kind: 'direct', message: 'x' } });
  assert.equal(s.phase, 'failed');
  assert.equal(s.error?.kind, 'direct');
});

test('진행 중 같은 요청 START는 무시, 다른 요청은 새로 시작', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'PROGRESS', key: 'direct' });
  const again = planFlowReducer(s, { type: 'START', request: { ...req } });
  assert.equal(again, s);
  const other = planFlowReducer(s, { type: 'START', request: { ...req, arriveByMin: 600 } });
  assert.equal(other.phase, 'direct');
});

test('SET_OVERRIDE는 안별로 누적, RESET은 초기값', () => {
  let s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });
  s = planFlowReducer(s, { type: 'RESULT', result });
  s = planFlowReducer(s, { type: 'SET_OVERRIDE', optionIdx: 0, slotId: 's-1', candidateId: 'c2' });
  s = planFlowReducer(s, { type: 'SET_OVERRIDE', optionIdx: 1, slotId: 's-1', candidateId: 'c3' });
  assert.deepEqual(s.overrides, { 0: { 's-1': 'c2' }, 1: { 's-1': 'c3' } });
  assert.equal(planFlowReducer(s, { type: 'RESET' }), initialPlanFlow);
});

test('requestKey는 좌표·모드·마감·칩·순서를 본다 (이름·출발시각은 아니다)', () => {
  assert.equal(requestKey(req), requestKey({ ...req, originName: '다른이름' }));
  assert.notEqual(requestKey(req), requestKey({ ...req, stops: [] }));
  assert.notEqual(requestKey(req), requestKey({ ...req, mode: 'walk' }));
  assert.notEqual(requestKey(req), requestKey({ ...req, arriveByMin: 600 }));
  // departAtMin은 시계일 뿐 — 1분 지났다고 "조건이 바뀌었어요"가 뜨면 안 된다
  assert.equal(requestKey(req), requestKey({ ...req, departAtMin: req.departAtMin + 1 }));
});

test('isBusy', () => {
  assert.equal(isBusy('idle'), false);
  assert.equal(isBusy('searching'), true);
  assert.equal(isBusy('ready'), false);
});
