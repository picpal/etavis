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
import type { ApplyLivePayload, PlanAction, PlanState, StopState } from './plan';
import type { Candidate, Dataset } from '../data/mockData';

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

/*
  방문은 '몇 번째까지 지나왔나'와 다른 것이다.

  예전엔 `stopIdx < passedCount` 로 방문을 판단했는데, 스쳐 지나간 경유지(skip)도
  passedCount 를 올리기 때문에 차로 가게 옆을 지나가기만 해도 '가 봤다'가 됐다.
  이제는 체류 시간을 채운 지점만 VISIT_STOP 으로 들어온다.
*/
test('VISIT_STOP 은 들른 경유지를 기록한다', () => {
  const after = planReducer(fresh(), { type: 'VISIT_STOP', id: 's1' });

  assert.deepEqual(after.visitedStopIds, ['s1']);
});

test('같은 경유지를 두 번 방문해도 한 번만 남는다 — 판정부가 재시도로 같은 이벤트를 낼 수 있다', () => {
  const after = run(fresh(), [{ type: 'VISIT_STOP', id: 's1' }, { type: 'VISIT_STOP', id: 's1' }]);

  assert.deepEqual(after.visitedStopIds, ['s1']);
});

test('스쳐 지나가기만 한 경유지는 방문이 아니다 — 100m 옆을 지나간 가게가 들른 곳이 되던 버그', () => {
  const after = run(fresh(), [{ type: 'DEPART_STOP' }, { type: 'DEPART_STOP' }]);

  assert.equal(after.passedCount, 2, '전제: 두 곳을 지나오긴 했다');
  assert.deepEqual(after.visitedStopIds, [], '지나온 것과 들른 것은 다르다');
});

test('새 계획을 확정하면 방문 기록이 비워진다 — 옛 계획에서 들른 곳이 묻어나면 안 된다', () => {
  const before = run(arrived(), [{ type: 'VISIT_STOP', id: 's1' }, { type: 'VISIT_STOP', id: 's2' }]);
  assert.equal(before.visitedStopIds.length, 2, '전제: 두 곳을 들른 계획이어야 한다');

  assert.deepEqual(planReducer(before, { type: 'APPLY_LIVE', payload: newPlan() }).visitedStopIds, []);
  assert.deepEqual(planReducer(before, { type: 'APPLY_OPTION', id: before.options[0].id }).visitedStopIds, []);
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

test('들른 경유지의 혼잡도 제보는 그대로 남는다', () => {
  const s = dwelling();
  const target = s.stops[s.passedCount];
  const visited = planReducer(s, { type: 'VISIT_STOP', id: target.id });
  const after = planReducer(visited, { type: 'REPORT_STOP_CONGESTION', stopId: target.id, level: 'high' });
  assert.equal(after.stops[s.passedCount].congestion, 'high');
});

test('체류 중이기만 하고 아직 방문이 아니면 제보를 버린다 — 체류 시간을 채워야 들른 것이다', () => {
  const s = dwelling();
  const target = s.stops[s.passedCount];

  assert.equal(planReducer(s, { type: 'REPORT_STOP_CONGESTION', stopId: target.id, level: 'high' }), s);
});

test('이미 떠나온 경유지의 제보도 받는다 — 안 받으면 시트가 계속 다시 묻는다', () => {
  /* 화면은 '가 본 곳'이면 물어보는데 리듀서가 체류 중만 받던 시절, 떠나온 경유지에
     제보하면 고맙다는 인사만 뜨고 상태는 그대로였다. 시트를 다시 열면 또 물었다 */
  const s = arrived();
  const first = s.stops[0];
  assert.ok(s.passedCount > 0, '전제: 이미 지나온 경유지가 있어야 한다');
  const visited = planReducer(s, { type: 'VISIT_STOP', id: first.id });
  const after = planReducer(visited, { type: 'REPORT_STOP_CONGESTION', stopId: first.id, level: 'low' });
  assert.equal(after.stops[0].congestion, 'low');
});

test('아직 가보지 않은 경유지의 제보는 버린다', () => {
  const s = fresh();
  const ahead = s.stops[s.stops.length - 1];
  const after = planReducer(s, { type: 'REPORT_STOP_CONGESTION', stopId: ahead.id, level: 'veryhigh' });
  assert.equal(after, s, '아무것도 안 바뀌면 상태는 같은 참조여야 한다');
});

/* ── 대화가 길어져도 같은 경유지가 쌓이면 안 된다 ──────────────────────────
   실기기 로그(2026-09-17 10:43~10:45)에서 나온 일이다.
     "커피 사고 샌드위치 사서 올라가려고"  → add 카페 · 샌드위치 가게
     "두개를 한번에 살수있는곳이 있어?"     → 추출 결과 없음(되묻기만)
     "커피와 샌드위치"                      → add 카페 · 샌드위치 가게  ← 또
   같은 말을 고쳐 말한 것뿐인데 경유지가 네 곳이 됐고, 32분 길이 96분이 됐다 */
const addStop = (queries: string[], count = 1): PlanAction => ({
  type: 'APPLY_INTENT',
  intent: {
    resetStops: false,
    stops: [
      {
        op: 'add', queries, kind: 'category', why: '', count,
        flexible: true, openNow: false, prefers: [], near: 'any',
      },
    ],
    endpoints: {},
    order: 'auto',
    arriveBy: null,
    mode: null,
    reject: null,
    ambiguous: [],
  },
});

const stopQueries = (s: PlanState) => s.chips.filter(c => c.kind === 'stop').map(c => c.label);

test('같은 경유지를 다시 말해도 한 번만 선다 — 대화를 고쳐 말한 것뿐이다', () => {
  const once = run(fresh(), [
    { type: 'APPLY_INTENT', intent: { ...addStop(['카페']).intent, resetStops: true } },
    addStop(['샌드위치 가게']),
  ]);
  assert.deepEqual(stopQueries(once), ['카페', '샌드위치 가게'], '전제: 두 곳이 선다');

  const twice = run(once, [addStop(['카페']), addStop(['샌드위치 가게'])]);
  assert.deepEqual(stopQueries(twice), ['카페', '샌드위치 가게'], '다시 말했다고 네 곳이 되면 안 된다');
});

test('질의가 겹치면 같은 곳으로 본다 — 편의점 다음의 CU 는 새 경유지가 아니다', () => {
  const s = run(fresh(), [
    { type: 'APPLY_INTENT', intent: { ...addStop(['편의점', 'CU', 'GS25']).intent, resetStops: true } },
    addStop(['CU']),
  ]);
  assert.deepEqual(stopQueries(s), ['편의점']);
});

test('정말 여러 곳이 필요하면 count 로 온다 — 그만큼은 채운다', () => {
  const s = run(fresh(), [
    { type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } },
    addStop(['약국'], 3),
  ]);
  assert.deepEqual(stopQueries(s), ['약국', '약국', '약국'], 'count 만큼 총 세 곳');
});

test('다른 곳은 그대로 더한다 — 중복만 막지, 새 경유지를 막는 게 아니다', () => {
  const s = run(fresh(), [
    { type: 'APPLY_INTENT', intent: { ...addStop(['카페']).intent, resetStops: true } },
    addStop(['약국']),
  ]);
  assert.deepEqual(stopQueries(s), ['카페', '약국']);
});

/* ── 대화 편집이 이미 정해진 가게를 갈아치우면 안 된다 ────────────────────
   실측(2026-09-19, 여의도→용왕산 대중교통): `마트 들러서 장 보고 약국 갔다 집에 갈게`
   로 확정한 뒤 "빵집도 들러줘" 한 마디에 약국이 봄빛온누리약국 → 은하약국으로 바뀌었다.
   사용자는 약국을 건드린 적이 없다.

   원인은 여기다. `APPLY_INTENT` 가 칩을 고친 뒤 `stopsForChips(state.dataset, keep)` 로
   **스톱 전체를 목 데이터셋에서 다시 매칭**했다. 라이브로 정해진 가게(`state.stops`)는
   쳐다보지도 않으니 매번 새로 뽑혔고, `asStopState` 가 `selectedCandidateId` 와
   `replaceDeltaMin` 까지 지워서 사용자가 교체 시트에서 고른 매장도 같이 날아갔다.

   고침: 기존 스톱을 `baseId` 로 집어 **그대로 재사용**하고, 스톱이 없는 새 칩만
   데이터셋에서 찾는다. 라이브 경로에서 `baseId` 는 곧 칩 id 다
   (`planFlowBridge.ts:258` 의 `baseId: v.slotId`, 슬롯 id 는 `planRequest.ts:22` 에서 `c.id`). */

/** 라이브 확정이 내려놓은 모양의 스톱 — `baseId` 가 칩 id 이고 장소 id 를 들고 있다 */
const resolveChips = (s: PlanState, names: string[], extra: Partial<StopState> = {}): PlanState => ({
  ...s,
  stops: s.chips
    .filter(c => c.kind === 'stop')
    .map((c, i) => ({
      id: c.id, baseId: c.id, name: names[i], category: c.label,
      coord: { latitude: 37.52 + i / 1000, longitude: 126.92 },
      dwellMin: 10, arriveAt: '17:53', legMin: 12, legKm: 3.1,
      openState: 'open' as const, openNote: '체류 10분 · 영업 중', tasks: [],
      replaceDeltaMin: 0, selectedCandidateId: `k-${i}`, ...extra,
    })),
});

const stopNames = (s: PlanState) => s.stops.map(x => x.name);

test('대화로 경유지를 추가해도 이미 정해진 가게는 그대로다', () => {
  const before = resolveChips(
    run(fresh(), [{ type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } }]),
    ['봄빛온누리약국'],
  );
  assert.deepEqual(stopNames(before), ['봄빛온누리약국'], '전제: 약국이 정해져 있다');

  const after = planReducer(before, addStop(['빵집']));
  const pharmacy = after.stops.find(s => s.baseId === before.chips[0].id);
  assert.equal(pharmacy?.name, '봄빛온누리약국', '사용자가 안 건드린 약국이 바뀌면 안 된다');
});

test('사용자가 교체한 매장이 대화 편집에서 살아남는다 — asStopState 가 지우던 것', () => {
  const before = resolveChips(
    run(fresh(), [{ type: 'APPLY_INTENT', intent: { ...addStop(['마트']).intent, resetStops: true } }]),
    ['한청할인마트'],
    { selectedCandidateId: 'k-99', replaceDeltaMin: 4 },
  );

  const after = planReducer(before, addStop(['빵집']));
  const mart = after.stops.find(s => s.baseId === before.chips[0].id);
  assert.equal(mart?.selectedCandidateId, 'k-99', '고른 매장의 id 가 남아야 교체 시트가 그걸 현재로 안다');
  assert.equal(mart?.replaceDeltaMin, 4, '교체로 늘어난 시간까지 같이 남아야 한다');
});

test('지운 경유지의 스톱은 안 남는다 — 보존이 삭제를 이기면 안 된다', () => {
  const before = resolveChips(
    run(fresh(), [
      { type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } },
      addStop(['마트']),
    ]),
    ['봄빛온누리약국', '한청할인마트'],
  );
  assert.equal(before.stops.length, 2, '전제: 두 곳이 정해져 있다');

  const after = planReducer(before, {
    ...addStop(['약국']),
    intent: { ...addStop(['약국']).intent, stops: [{ ...addStop(['약국']).intent.stops[0], op: 'remove' as const }] },
  });
  assert.deepEqual(stopNames(after), ['한청할인마트'], '지운 약국의 스톱이 남으면 안 된다');
});

test('새로 추가한 칩은 스톱이 없다 — 검색해서 채울 자리다', () => {
  const before = resolveChips(
    run(fresh(), [{ type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } }]),
    ['봄빛온누리약국'],
  );

  const after = planReducer(before, addStop(['빵집']));
  const bakeryChip = after.chips.find(c => c.kind === 'stop' && c.label === '빵집')!;
  assert.equal(after.stops.some(s => s.baseId === bakeryChip.id), false, '아직 안 정해진 곳에 스톱이 있으면 안 된다');
  assert.equal(after.stopCount, after.stops.length, 'stopCount 는 stops 를 따라간다');
});

test('같은 곳을 두 번 들르는 계획을 만들지 않는다 — 칩을 하나씩 찾아도 중복 제거는 살아 있다', () => {
  /* 보존을 넣으면서 `stopsForChips` 를 칩마다 부르고 싶어지는데, 그러면 함수 안의
     `used` 집합이 매번 새로 생겨 같은 풀 항목이 여러 슬롯에 붙는다. 스톱 id 가 겹치면
     LEGS 체인 키와 화면 키가 같이 무너진다 — 풀에 은행이 하나뿐인 목 데이터셋으로 잰다 */
  const s = run(fresh(), [
    { type: 'APPLY_INTENT', intent: { ...addStop(['은행']).intent, resetStops: true } },
    addStop(['은행'], 3),
  ]);
  assert.equal(stopQueries(s).length, 3, '전제: 칩은 count 만큼 선다');
  assert.equal(new Set(s.stops.map(x => x.id)).size, s.stops.length, '같은 스톱이 두 번 들어가면 안 된다');
  assert.equal(s.stops.length, 1, '풀에 은행이 하나뿐이면 못 채운 칩은 스톱 없이 남는다');
});

/* ── 고정을 푸는 길 ──────────────────────────────────────────────────────
   정해진 가게를 지키는 것과 **그걸 풀 수 있는 것**은 같은 기능의 양면이다. 풀 수
   없으면 "약국 다른 데로 바꿔줘"가 영영 안 먹는 상태가 된다 — 지키기만 올리면
   사용자는 고장으로 읽는다. 그래서 과제 4와 한 묶음으로 올린다. */

const removeStop = (queries: string[]): PlanAction => ({
  ...addStop(queries),
  intent: { ...addStop(queries).intent, stops: [{ ...addStop(queries).intent.stops[0], op: 'remove' as const }] },
});

const withPharmacy = () => resolveChips(
  run(fresh(), [{ type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } }]),
  ['봄빛온누리약국'],
);

test('가게 이름으로 지워도 그 칩이 걸린다 — 추출은 가게명을 주고 칩은 업종을 든다', () => {
  /* "봄빛온누리약국 말고 다른 데로" → remove(['봄빛온누리약국']) + add(['약국']).
     제거는 질의 겹침으로만 걸렀는데 칩의 queries 는 ['약국'] 이라 안 걸리고,
     이어지는 add 는 중복으로 걸러진다 — 고정이 영영 안 풀린다. */
  const before = withPharmacy();
  const after = planReducer(before, removeStop(['봄빛온누리약국']));
  assert.equal(after.chips.filter(c => c.kind === 'stop').length, 0, '가게 이름으로도 칩이 지워져야 한다');
  assert.equal(after.stops.length, 0, '칩이 갔으면 스톱도 간다');
});

test('편집에서 경유지를 지우면 대화로 돌아가도 안 살아난다', () => {
  /* REMOVE_LOCAL 이 stops 만 지웠다. 칩이 남아 다음 요청이 그 경유지를 되살렸다 —
     고정 이전에도 있던 결함인데, 고정이 붙으면 "지워도 지워지지 않는" 경로가 된다 */
  const before = withPharmacy();
  const after = planReducer(before, { type: 'REMOVE_LOCAL', stopId: before.stops[0].id });
  assert.equal(after.stops.length, 0);
  assert.equal(after.chips.filter(c => c.kind === 'stop' && c.id === before.chips[0].id).length, 0, '칩도 같이 지워져야 한다');
});

test('칩 하나를 지워도 남은 가게는 그대로다 — REMOVE_CHIP 이 전부 다시 매칭하면 안 된다', () => {
  /* REMOVE_CHIP 도 stopsForChips 를 맨손으로 불러 스톱 전체를 데이터셋에서 다시
     매칭했다. 경유지 하나를 빼려고 ✕ 를 눌렀을 뿐인데 나머지 가게가 전부 날아간다 */
  const before = resolveChips(
    run(fresh(), [
      { type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } },
      addStop(['마트']),
    ]),
    ['봄빛온누리약국', '한청할인마트'],
  );
  const after = planReducer(before, { type: 'REMOVE_CHIP', id: before.chips[0].id });
  assert.deepEqual(stopNames(after), ['한청할인마트'], '지운 건 약국뿐인데 마트까지 날아가면 안 된다');
});

test('되묻기로 질의를 좁히면 그 칩의 가게만 버린다 — 검색어가 바뀌었으니 다시 찾아야 한다', () => {
  const before = resolveChips(
    run(fresh(), [
      { type: 'APPLY_INTENT', intent: { ...addStop(['약국']).intent, resetStops: true } },
      addStop(['마트']),
    ]),
    ['봄빛온누리약국', '한청할인마트'],
  );
  const after = planReducer(before, { type: 'NARROW_STOP', chipId: before.chips[0].id, query: '온누리약국' });
  assert.equal(after.stops.some(x => x.name === '봄빛온누리약국'), false, '질의가 바뀐 칩의 가게는 버린다');
  assert.deepEqual(stopNames(after), ['한청할인마트'], '건드리지 않은 칩의 가게는 그대로다');
});

test('목적지를 고르면 주소도 같이 실린다 — 최근 목록의 둘째 줄이 여기서 온다', () => {
  const s = planReducer(fresh(), {
    type: 'SET_DESTINATION',
    name: '올리브영 신정점',
    coord: { latitude: 37.52, longitude: 126.86 },
    address: '서울 양천구 신정동',
  });
  assert.equal(s.destinationAddress, '서울 양천구 신정동');
});

test('주소 없이 목적지만 바꾸면 주소는 비워진다 — 이전 목적지의 주소가 따라다니면 안 된다', () => {
  const had = planReducer(fresh(), {
    type: 'SET_DESTINATION',
    name: '올리브영 신정점',
    coord: { latitude: 37.52, longitude: 126.86 },
    address: '서울 양천구 신정동',
  });
  const s = planReducer(had, { type: 'SET_DESTINATION', name: '다른 곳', coord: null, address: null });
  assert.equal(s.destinationAddress, null);
});

test('출발지와 목적지를 맞바꾸면 주소도 같이 바뀐다', () => {
  let s = planReducer(fresh(), {
    type: 'SET_ORIGIN',
    name: '집',
    coord: { latitude: 37.5219, longitude: 126.9245 },
    address: '서울 영등포구 여의도동',
  });
  s = planReducer(s, {
    type: 'SET_DESTINATION',
    name: '회사',
    coord: { latitude: 37.52, longitude: 126.86 },
    address: '서울 양천구 신정동',
  });
  s = planReducer(s, { type: 'SWAP_ENDPOINTS', myLocation: null });
  assert.equal(s.originAddress, '서울 양천구 신정동');
  assert.equal(s.destinationAddress, '서울 영등포구 여의도동');
});

test("'내 위치'에서 맞바꾸면 목적지 주소는 없다 — 지금 있는 곳의 주소를 리듀서는 모른다", () => {
  const had = planReducer(fresh(), {
    type: 'SET_DESTINATION',
    name: '회사',
    coord: { latitude: 37.52, longitude: 126.86 },
    address: '서울 양천구 신정동',
  });
  const s = planReducer(had, { type: 'SWAP_ENDPOINTS', myLocation: { latitude: 37.5, longitude: 127.0 } });
  assert.equal(s.originAddress, '서울 양천구 신정동');
  assert.equal(s.destinationAddress, null);
});

test('채팅이 목적지를 바꾸면 주소도 새 목적지 것으로 바뀐다 — 이전 목적지 주소가 새 장소에 눌러앉으면 안 된다', () => {
  const { savePlace, removePlace } = require('../lib/placesStore') as typeof import('../lib/placesStore');
  // '집'을 등록해 둔 상태를 만든다 — 예전엔 목 데이터의 '집' 항목이었지만 지금은
  // placesStore가 출처다. placesStore는 이 테스트 파일 전체가 공유하는 모듈이라
  // 끝나면 지운다 — 안 지우면 바로 다음 테스트('저장해 둔 곳이 없으면...')가 전제로 삼는
  // 빈 목록이 깨진다.
  savePlace({
    id: 'home', slot: 'home', label: '집', name: '집',
    address: '서울 영등포구 여의도동', coord: { latitude: 37.5219, longitude: 126.9245 }, createdAt: 1,
  });
  try {
    const had = planReducer(fresh(), {
      type: 'SET_DESTINATION',
      name: '올리브영 신정점',
      coord: { latitude: 37.52, longitude: 126.86 },
      address: '서울 양천구 신정동',
    });
    const s = planReducer(had, {
      type: 'APPLY_INTENT',
      intent: {
        resetStops: false,
        stops: [],
        endpoints: { destination: '집' }, // 저장해 둔 '집' — 주소가 다른 곳
        order: 'auto',
        arriveBy: null,
        mode: null,
        reject: null,
        ambiguous: [],
      },
    });
    assert.equal(s.destinationName, '집');
    assert.equal(s.destinationAddress, '서울 영등포구 여의도동', '이전 목적지(올리브영)의 주소가 남아 있으면 안 된다');
  } finally {
    removePlace('home');
  }
});

test('저장해 둔 곳이 없으면 채팅으로 목적지를 바꿀 수 없다 — 좌표를 모르면 경로를 못 그린다', () => {
  const before = fresh();
  const s = planReducer(before, {
    type: 'APPLY_INTENT',
    intent: {
      resetStops: false,
      stops: [],
      endpoints: { destination: '집' },
      order: 'auto',
      arriveBy: null,
      mode: null,
      reject: null,
      ambiguous: [],
    },
  });
  assert.equal(s.destinationName, before.destinationName);
  assert.equal(s.destinationCoord, before.destinationCoord);
});

test("짧은 라벨이 긴 말을 삼키지 않는다 — '포장마차집'은 집이 아니다", () => {
  const { savePlace } = require('../lib/placesStore') as typeof import('../lib/placesStore');
  // 이 파일의 마지막 테스트라 savePlace 뒤 정리(removePlace)를 생략했다 — 뒤에 아무도
  // 이 상태를 물려받지 않는다. 아래에 테스트를 더 붙인다면 위의 '채팅이 목적지를
  // 바꾸면...' 테스트처럼 finally에서 removePlace로 지워야 한다: placesStore는
  // 모듈 싱글턴이라 캐시가 이 파일 전체에서 이어지고, 정리를 빼먹으면 다음 테스트가
  // 왜 깨지는지 한참 헤매게 된다.
  savePlace({
    id: 'home', slot: 'home', label: '집', name: '여의도 자이',
    address: '서울 영등포구 여의도동', coord: { latitude: 37.5219, longitude: 126.9245 }, createdAt: 1,
  });
  const intent = (destination: string) => ({
    resetStops: false, stops: [], endpoints: { destination },
    order: 'auto' as const, arriveBy: null, mode: null, reject: null, ambiguous: [],
  });

  const wrong = planReducer(fresh(), { type: 'APPLY_INTENT', intent: intent('포장마차집') });
  assert.equal(wrong.destinationName, null, "'집'으로 끝난다고 집으로 보내면 안 된다");

  const right = planReducer(fresh(), { type: 'APPLY_INTENT', intent: intent('집') });
  assert.equal(right.destinationName, '집', '완전 일치는 한 글자라도 잡는다');
  assert.equal(right.destinationAddress, '서울 영등포구 여의도동', '주소도 같이 갈아 끼운다');

  const byName = planReducer(fresh(), { type: 'APPLY_INTENT', intent: intent('여의도자이') });
  assert.equal(byName.destinationName, '여의도 자이', '상호로도, 띄어쓰기가 달라도 걸린다');
});

/** 마트 칩 하나를 얹은 상태 — 물성 질문이 향할 자리 */
const withMart = (): PlanState => ({
  ...fresh(),
  chips: [{
    id: 's-1', kind: 'stop', label: '마트', queries: ['마트'],
    stopKind: 'category', openNow: false, flexible: true, near: 'any',
  }],
});

test('물성 답을 칩에 기록한다 — 이 값이 슬롯을 지나 추천 순서를 정한다', () => {
  const after = planReducer(withMart(), { type: 'SET_CHIP_LOAD', chipId: 's-1', loadAfter: 'hard' });

  const chip = after.chips.find(c => c.id === 's-1');
  assert.equal(chip?.kind === 'stop' && chip.loadAfter, 'hard');
});

test('없는 칩 id 면 상태를 바꾸지 않는다 — 같은 참조를 돌려준다', () => {
  const before = withMart();

  assert.equal(planReducer(before, { type: 'SET_CHIP_LOAD', chipId: 'nope', loadAfter: 'hard' }), before);
});

/* ── 확정 뒤 매장 교체 — 경유지 하나의 숫자는 경유지 하나의 재계산에서 온다 ─────────
   기기(2026-09-20, 서교동→코엑스 대중교통): 타임라인에서 CU 를 바꾸자 그 가게 도착이
   여행 전체 차이만큼 통째로 밀렸다. `applyCandidate` 가 전체 차이(addedMin)를
   `replaceDeltaMin` 에 더하고 `computeChain` 이 그걸 **들어오는 구간 하나**에 붙였다 —
   총합은 맞는데 그 경유지 도착과 다음 구간이 틀린다. 시트의 후보 도착도 같은 셈이었다.

   나눔의 근거는 후보의 `arriveAt` 이다. 브리지가 후보마다 rescore 로 낸 그 경유지 도착이라,
   현재 후보와의 차이가 곧 앞 구간의 몫이고 나머지는 뒷 구간이다. */

/** 확정 직후 모양의 라이브 계획. s1 후보 k2 는 전체 +39분인데 s1 도착은 +7분만 움직인다 */
const livePlan = (): ApplyLivePayload => {
  const base = datasets.find(d => d.key === 'commute')!;
  const cand = (over: Partial<Candidate>): Candidate => ({
    ...base.candidates[base.stops[0].id][0], parking: '모름', openState: 'open', openNote: '영업 중', disabled: false, ...over,
  });
  const stops: StopState[] = [
    { id: 's1', baseId: 's1', name: 'CU 홍대점', category: '편의점', coord: { latitude: 37.55, longitude: 126.92 },
      dwellMin: 10, arriveAt: '10:12', legMin: 12, legKm: 3.1, openState: 'open', openNote: '체류 10분 · 영업 중', tasks: [],
      replaceDeltaMin: 0, selectedCandidateId: 'k1' },
    { id: 's2', baseId: 's2', name: '이마트', category: '마트', coord: { latitude: 37.56, longitude: 126.93 },
      dwellMin: 20, arriveAt: '10:31', legMin: 9, legKm: 2.2, openState: 'open', openNote: '체류 20분 · 영업 중', tasks: [],
      replaceDeltaMin: 0, selectedCandidateId: 'k3' },
  ];
  const dataset: Dataset = {
    ...base,
    key: 'live',
    timingSource: 'provider_legs',
    legEstimated: false,
    stops: stops.map(({ baseId: _b, replaceDeltaMin: _r, selectedCandidateId: _s, ...rest }) => rest),
    legs: {
      'origin>s1': { min: 12, km: 3.1 }, 's1>s2': { min: 9, km: 2.2 }, 's2>dest': { min: 8, km: 2.0 },
      'origin>s2': { min: 14, km: 3.6 }, 's1>dest': { min: 15, km: 4.0 }, 'origin>dest': { min: 20, km: 6.0 },
    },
    candidates: {
      s1: [
        cand({ id: 'k1', name: 'CU 홍대점', addedMin: 0, arriveAt: '10:12', cls: 'measured', recommended: true }),
        cand({ id: 'k2', name: 'CU 삼성역점', addedMin: 39, arriveAt: '10:19', cls: 'estimated', recommended: false }),
      ],
      s2: [cand({ id: 'k3', name: '이마트', addedMin: 0, arriveAt: '10:31', dwellMin: 20, cls: 'measured', recommended: true })],
    },
  };
  return { stops, dataset, departMin: 10 * 60, selectedOptionId: base.options[0].id };
};

const swapS1 = (to: string) => (s: PlanState) =>
  run(s, [{ type: 'REPLACE_LOCAL', stopId: 's1', candidateId: to }, { type: 'RECALC' }]);

test('확정 뒤 매장을 바꾸면 그 경유지 도착은 후보 간 도착 차이만큼만 움직인다 — 전체 차이가 아니다', () => {
  const before = planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() });
  assert.equal(before.stops[0].arriveAt, '10:12', '전제: 10:00 출발 + 12분');
  assert.equal(before.destArriveAt, '10:59', '전제: 12+10+9+20+8');

  const after = swapS1('k2')(before);
  assert.equal(after.stops[0].arriveAt, '10:19', '앞 구간의 몫 +7 만 — 39 를 다 얹으면 10:51 이 된다');
  assert.equal(after.stops[0].legMin, 19);
  assert.equal(after.stops[1].arriveAt, '11:10', '나머지 +32 는 다음 구간에 — 10:19 + 체류 10 + (9+32)');
  assert.equal(after.stops[1].legMin, 41);
  assert.equal(after.destArriveAt, '11:38', '총합은 그대로 +39');
  assert.equal(after.totals.deltaMin, before.totals.deltaMin + 39);
});

test('마지막 경유지를 바꾸면 나머지 차이는 목적지 구간에 붙는다', () => {
  const p = livePlan();
  p.dataset.candidates.s2.push({ ...p.dataset.candidates.s2[0], id: 'k4', name: '이마트 삼성점', addedMin: 20, arriveAt: '10:36', cls: 'estimated', recommended: false });
  const before = planReducer(fresh(), { type: 'APPLY_LIVE', payload: p });
  const after = run(before, [{ type: 'REPLACE_LOCAL', stopId: 's2', candidateId: 'k4' }, { type: 'RECALC' }]);
  assert.equal(after.stops[1].arriveAt, '10:36', '앞 구간 +5');
  assert.equal(after.finalLegMin, 8 + 15, '뒷 구간 +15');
  assert.equal(after.destArriveAt, '11:19', '10:59 + 20');
});

test('교체를 되돌리면 나눔도 같이 0 으로 돌아온다 — 누적이 어긋나면 두 번째 교체부터 틀린다', () => {
  const before = planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() });
  const back = swapS1('k1')(swapS1('k2')(before));
  assert.equal(back.stops[0].replaceDeltaMin, 0);
  assert.equal(back.stops[0].replaceDeltaInMin, 0);
  assert.equal(back.stops[0].arriveAt, '10:12');
  assert.equal(back.destArriveAt, '10:59');
});

/* ── 확정 뒤 매장 교체 — 등급도 선택을 따라간다 ─────────────────────────────
   `toLegacyPlan` 이 확정 시점에 `dataset.legEstimated` 를 한 번 세우고 끝이었다. A6 에서
   추정 후보로 바꾸면 그 구간은 추정인데 값은 false 그대로라, 트래커·진행중·타임라인이
   `timingCopy` 에 그 값을 넘겨 '약' 없이 실측인 척 말했다 — 1단계가 A5 에서 걷어낸
   거짓말이 한 화면 뒤에 그대로 살아 있었다. 등급은 지금 고른 후보들의 `cls` 에서 낸다. */

test('확정 뒤 추정 후보로 바꾸면 dataset.legEstimated 가 참이 된다 — 확정 시점 값이 눌러앉으면 안 된다', () => {
  const before = planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() });
  assert.equal(before.dataset.legEstimated, false, '전제: 시드끼리는 실측');

  const swapped = planReducer(before, { type: 'REPLACE_LOCAL', stopId: 's1', candidateId: 'k2' });
  assert.equal(swapped.dataset.legEstimated, true, 'RECALC 를 기다리지 않는다 — 배너가 그 사이 옛 등급을 말하면 안 된다');
  assert.equal(planReducer(swapped, { type: 'RECALC' }).dataset.legEstimated, true);
  assert.equal(swapped.dataset.timingSource, 'provider_legs', '출처는 그대로 — 낮추는 건 legEstimated 몫이다');
});

test('실측 후보로 되돌리면 legEstimated 도 거짓으로 돌아온다 — 한 번 추정이 영영 추정이면 안 된다', () => {
  const before = planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() });
  const back = swapS1('k1')(swapS1('k2')(before));
  assert.equal(back.dataset.legEstimated, false);
  assert.equal(planReducer(back, { type: 'RECALC' }).dataset, back.dataset, '등급이 안 바뀌면 참조도 그대로 — 화면 memo 가 헛돌지 않게');
});

test('cls 가 없는 목 데이터셋 후보는 등급을 못 낮춘다 — 계획 등급이 정한다', () => {
  const s = run(fresh(), [{ type: 'REPLACE_LOCAL', stopId: 's2', candidateId: 'k3' }, { type: 'RECALC' }]);
  assert.equal(s.stops[1].selectedCandidateId, 'k3', '전제: 교체가 됐다');
  assert.equal(s.dataset.legEstimated ?? false, false);
});


/* ── 6단계 · 고른 매장의 두 구간을 실측하면 '약'이 지워진다 ─────────────────────
   `measureSwap` 은 값을 안 돌려주고 플래너 안의 leg 저장소만 채운다. 확정본(A6)은 그 저장소를
   안 보는 스냅샷이라, 실측이 들어오면 leg 표와 후보 목록을 **고른 매장이 '현재'인 상태로**
   다시 내서 얹는다(`LEGS_LEARNED`). 그래서 스톱에 얹혀 있던 교체 차이는 여기서 0 이 된다 —
   새 표에 그 교체가 이미 들어 있으므로, 남겨 두면 같은 교체가 두 번 더해진다. */

/** 두 구간을 실제로 재고 나서 브리지가 다시 낸 표. k2 가 '현재'라 추가시간은 0 이고 등급은 실측이다 */
const learnedAfterK2 = () => {
  const s1 = livePlan().dataset.candidates.s1;
  return {
    legs: { 'origin>s1': { min: 14, km: 3.4 }, 's1>s2': { min: 11, km: 2.6 } },
    candidates: {
      s1: [
        { ...s1[1], addedMin: 0, arriveAt: '10:14', cls: 'measured' as const, recommended: true },
        { ...s1[0], addedMin: -2, arriveAt: '10:12', cls: 'measured' as const, recommended: false },
      ],
    },
  };
};

test('두 구간이 실측으로 들어오면 legEstimated 가 내려간다 — 재고도 약이 남으면 돈만 쓴 것이다', () => {
  const swapped = planReducer(planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() }),
    { type: 'REPLACE_LOCAL', stopId: 's1', candidateId: 'k2' });
  assert.equal(swapped.dataset.legEstimated, true, '전제: 바꾼 직후엔 그 구간이 추정이다');

  const learned = planReducer(swapped, { type: 'LEGS_LEARNED', ...learnedAfterK2() });
  assert.equal(learned.dataset.legEstimated, false);
  assert.equal(learned.stops[0].name, 'CU 삼성역점', '고른 매장은 그대로 — 재는 것이 선택을 되돌리면 안 된다');
});

test('실측 표를 얹으면 스톱의 교체 차이는 0 이 된다 — 새 표에 그 교체가 이미 들어 있다', () => {
  const swapped = planReducer(planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() }),
    { type: 'REPLACE_LOCAL', stopId: 's1', candidateId: 'k2' });
  assert.equal(swapped.stops[0].replaceDeltaInMin, 7, '전제: 추정으로 낸 앞 구간 몫');

  const learned = planReducer(swapped, { type: 'LEGS_LEARNED', ...learnedAfterK2() });
  // 10:00 + 14(실측) — 차이를 남겨 두면 10:21 이 되어, 실측을 사고 도착을 더 틀리게 만든다
  assert.equal(learned.stops[0].arriveAt, '10:14');
  assert.equal(learned.stops[0].replaceDeltaMin, 0);
  assert.equal(learned.stops[0].replaceDeltaInMin, 0);
  assert.equal(learned.stops[1].arriveAt, '10:35', '10:14 + 체류 10 + 11');
  assert.equal(learned.destArriveAt, '11:03', '10:35 + 체류 20 + 8');
});

test('실측 표는 겹치고 덮지 않는다 — 안 바뀐 구간의 leg 가 사라지면 되돌릴 근거가 없다', () => {
  const swapped = planReducer(planReducer(fresh(), { type: 'APPLY_LIVE', payload: livePlan() }),
    { type: 'REPLACE_LOCAL', stopId: 's1', candidateId: 'k2' });
  const learned = planReducer(swapped, { type: 'LEGS_LEARNED', ...learnedAfterK2() });
  assert.deepEqual(learned.dataset.legs?.['s2>dest'], { min: 8, km: 2.0 });
  assert.equal(learned.dataset.candidates.s2.length, 1, '안 낸 슬롯의 후보 목록도 남는다');
});
