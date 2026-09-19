import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlanFlow, isBusy, measuredDirectMin, planFailCopy, planFlowReducer, requestKey, type PlanRequest } from './planFlow';
import type { PlanResult } from '../lib/routePlan/types';

const req: PlanRequest = {
  origin: { latitude: 37.5, longitude: 127 }, destination: { latitude: 37.6, longitude: 127.1 },
  originName: '집', destinationName: '회사', mode: 'car', arriveByMin: 540, departAtMin: 480,
  stops: [{ id: 's-1', queries: ['올리브영'], count: 1, flexible: true, openNow: false, stopKind: 'category' }], order: 'auto',
};
const result = { options: [], alternatives: [], slotStatus: {}, apiCalls: 1, directMin: 20, directKm: 10, measuredCount: 1, timingSource: 'estimate', legTable: {}, rescore: () => ({ totalMin: 0, arrivals: [], distanceKm: 0, estimated: true }) } as unknown as PlanResult;

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

const base = (): PlanRequest => ({
  origin: { latitude: 37.5, longitude: 127.0 },
  destination: { latitude: 37.5, longitude: 127.1 },
  originName: '내 위치', destinationName: '집',
  mode: 'transit', arriveByMin: null, departAtMin: 540,
  stops: [{
    id: 'c1', queries: ['마트'], count: 1, flexible: true, openNow: false,
    stopKind: 'category', near: 'any',
    loadBefore: 'none', loadAfter: 'none', needWhen: 'unknown',
  }],
  order: 'auto',
});

test('near 가 바뀌면 다른 요청이다', () => {
  const a = base();
  const b = base();
  b.stops[0].near = 'end';
  assert.notEqual(requestKey(a), requestKey(b));
});

test('태그가 바뀌면 다른 요청이다 — 셋 다 각각', () => {
  const a = base();
  for (const mutate of [
    (r: PlanRequest) => { r.stops[0].loadBefore = 'hard'; },
    (r: PlanRequest) => { r.stops[0].loadAfter = 'hard'; },
    (r: PlanRequest) => { r.stops[0].needWhen = 'afterArrival'; },
  ]) {
    const b = base();
    mutate(b);
    assert.notEqual(requestKey(a), requestKey(b));
  }
});

test('같은 값이면 같은 키다', () => {
  assert.equal(requestKey(base()), requestKey(base()));
});

test('isBusy', () => {
  assert.equal(isBusy('idle'), false);
  assert.equal(isBusy('searching'), true);
  assert.equal(isBusy('ready'), false);
});

/* 기본 선택은 **추천 순서**다. 최단안(0)을 기본으로 두면, 탭을 건드리지 않은 사용자가
   화면이 권하지 않는 안을 그대로 확정한다 — `selectedOptionIdx` 는 하이라이트만이
   아니라 **무엇을 확정하나**를 정하기 때문이다 */
test('RESULT는 추천안을 기본 선택으로 잡는다', () => {
  const withComfort = { ...result, comfortIdx: 2 } as unknown as PlanResult;

  const s = planFlowReducer(initialPlanFlow, { type: 'RESULT', result: withComfort });

  assert.equal(s.selectedOptionIdx, 2);
});

test('짐을 안 잰 계획은 최단안이 기본 선택이다 — 가리킬 추천안이 없다', () => {
  const noComfort = { ...result, comfortIdx: null } as unknown as PlanResult;

  const s = planFlowReducer(initialPlanFlow, { type: 'RESULT', result: noComfort });

  assert.equal(s.selectedOptionIdx, 0);
});

/* ── 머리글 직행 시간 ─────────────────────────────────────────────
   목 데이터(datasets[0].directMin)를 그대로 쓰던 자리다. 목적지를 고르기만 해도
   '직행 16분'이라고 했는데 실제로 재면 47분이었다(2026-09-19 시뮬레이터, 태평로1가→목동). */

const trip = { origin: req.origin, destination: req.destination, mode: req.mode } as const;
const ready = (r: PlanResult = result) =>
  planFlowReducer(planFlowReducer(initialPlanFlow, { type: 'START', request: req }), { type: 'RESULT', result: r });

test('재기 전에는 직행 시간이 없다 — 목 숫자를 보여주느니 아무것도 안 보여준다', () => {
  assert.equal(measuredDirectMin(initialPlanFlow, trip), null);
});

test('같은 여정을 실측했으면 그 값을 반올림해 준다', () => {
  const s = ready({ ...result, directMin: 46.5 } as PlanResult);

  assert.equal(measuredDirectMin(s, trip), 47);
});

test('목적지가 바뀌면 없다 — 옛 계산을 새 목적지에 붙이지 않는다', () => {
  const s = ready();

  assert.equal(measuredDirectMin(s, { ...trip, destination: { latitude: 37.7, longitude: 127.2 } }), null);
});

test('출발지가 바뀌어도 없다', () => {
  const s = ready();

  assert.equal(measuredDirectMin(s, { ...trip, origin: { latitude: 37.4, longitude: 126.9 } }), null);
});

test('이동수단이 바뀌면 없다 — 걸어가면 직행이 다른 시간이다', () => {
  const s = ready();

  assert.equal(measuredDirectMin(s, { ...trip, mode: 'walk' }), null);
});

test('경유지를 더해도 직행은 그대로다 — 직행은 들르는 곳과 무관하다', () => {
  const s = ready();

  assert.equal(measuredDirectMin(s, trip), 20, '같은 두 점 사이 직행은 안 바뀐다');
});

test('출발 좌표가 아직 없으면 없다 — GPS를 기다리는 동안 옛 값을 붙들지 않는다', () => {
  const s = ready();

  assert.equal(measuredDirectMin(s, null), null);
});

test('계산 중에는 아직 없다 — 이전 결과가 없는 채로 START만 돌았을 때', () => {
  const s = planFlowReducer(initialPlanFlow, { type: 'START', request: req });

  assert.equal(measuredDirectMin(s, trip), null);
});

/* ── 실패 문구 ───────────────────────────────────────────────────
   타임아웃 화면이 "연결이 불안정해요"라고 했다. 실측 2026-09-19 기기에서 그 실패를
   냈을 때 트랙로그의 네트워크 호출은 9건 전부 ok:true 였다 — 연결은 멀쩡했고 검색이
   길어졌을 뿐이다. 틀린 원인을 말하면 사용자는 엉뚱한 걸 고치려 든다(와이파이를 끄고
   켠다). */

test('타임아웃은 연결 탓을 하지 않는다', () => {
  const c = planFailCopy('timeout');

  assert.ok(!c.title.includes('연결'), `연결을 말하면 안 된다: ${c.title}`);
  assert.ok(!c.detail.includes('연결'), `연결을 말하면 안 된다: ${c.detail}`);
});

test('타임아웃은 다시 계산을 권한다 — 방금 찾은 것이 서버에 남아 실제로 빨라진다', () => {
  assert.ok(planFailCopy('timeout').detail.includes('다시 계산'));
});

test('그 밖의 실패는 연결을 말한다 — 거기선 실제로 호출이 실패한 것이다', () => {
  for (const kind of ['direct', 'search', 'measure'] as const) {
    assert.ok(planFailCopy(kind).title.includes('연결'), kind);
  }
});
