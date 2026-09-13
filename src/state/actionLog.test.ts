import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFlowAction, describePlanAction } from './actionLog.ts';
import type { PlanAction, PlanState } from './plan.tsx';
import type { PlanFlowAction, PlanFlowState } from './planFlow.ts';

/** 로그가 읽는 부분만 채운 최소 상태 — 전체를 만들면 테스트가 구현을 베낀다 */
const planState = (over: Partial<PlanState> = {}): PlanState =>
  ({
    stops: [
      { id: 's-1', baseId: 'b-1', name: '파리바게뜨 목동점', category: '빵집' },
      { id: 's-2', baseId: 'b-2', name: '올리브영 신정점', category: '화장품' },
    ],
    dataset: {
      candidates: {
        'b-1': [
          { id: 'c-1', name: '파리바게뜨 목동점' },
          { id: 'c-9', name: '뚜레쥬르 신정점', addedMin: 4 },
        ],
      },
    },
    chips: [{ id: 'ch-1', kind: 'stop', label: '빵집' }],
    mode: 'car',
    destinationName: '회사',
    ...over,
  }) as unknown as PlanState;

const flowState = (over: Partial<PlanFlowState> = {}): PlanFlowState =>
  ({
    slots: [
      { id: 'sl-1', query: '카페', candidates: [{ id: 'k-1', name: '연남 카페' }, { id: 'k-2', name: '제니스커피' }] },
    ],
    ...over,
  }) as unknown as PlanFlowState;

test('후보 교체는 id 가 아니라 이름으로 남는다 — 로그만 보고 어느 가게인지 알아야 한다', () => {
  const log = describePlanAction(
    { type: 'REPLACE_LOCAL', stopId: 's-1', candidateId: 'c-9' } as PlanAction,
    planState(),
  );
  assert.equal(log?.a, 'stop.replace');
  assert.equal(log?.d?.from, '파리바게뜨 목동점');
  assert.equal(log?.d?.to, '뚜레쥬르 신정점');
});

test('추출 결과는 개수로 요약된다 — 원문과 무엇을 알아들었나가 같이 남는다', () => {
  const log = describePlanAction(
    {
      type: 'APPLY_INTENT',
      intent: {
        resetStops: false,
        stops: [
          { op: 'add', queries: ['카페'], kind: 'category', why: '', count: 1, flexible: true, openNow: false },
          { op: 'remove', queries: ['올리브영'], kind: 'brand', why: '', count: 1, flexible: false, openNow: false },
        ],
        endpoints: {},
        order: 'auto',
        arriveBy: 1080,
        mode: null,
        reject: null,
        ambiguous: [{ field: 'time', question: '몇 시요?' }],
      },
    } as PlanAction,
    planState(),
  );
  assert.equal(log?.a, 'chat.extract');
  assert.equal(log?.d?.add, 1);
  assert.equal(log?.d?.remove, 1);
  assert.equal(log?.d?.ask, 1);
  assert.equal(log?.d?.arriveBy, 1080);
});

test('채팅 원문을 남긴다 — 추출을 다듬으려면 실제로 뭐라고 쳤는지가 제일 값지다', () => {
  const log = describePlanAction({ type: 'PUSH_CHAT', text: '가는 길에 카페' } as PlanAction, planState());
  assert.equal(log?.a, 'chat.send');
  assert.equal(log?.d?.text, '가는 길에 카페');
});

test('경유지 빼기는 이름을 남긴다', () => {
  const log = describePlanAction({ type: 'REMOVE_LOCAL', stopId: 's-2' } as PlanAction, planState());
  assert.equal(log?.a, 'stop.remove');
  assert.equal(log?.d?.name, '올리브영 신정점');
});

test('개발 메뉴 토글도 남긴다 — 이상한 로그의 이유가 될 수 있다', () => {
  const log = describePlanAction({ type: 'SET_DEV_ANY_CONGESTION', value: true } as PlanAction, planState());
  assert.equal(log?.a, 'dev.anyCongestion');
  assert.equal(log?.d?.value, true);
});

test('모르는 액션은 null — 로그를 안 남긴다', () => {
  const log = describePlanAction({ type: 'NOPE' } as unknown as PlanAction, planState());
  assert.equal(log, null);
});

test('d 는 한 겹이다 — 중첩 객체가 들어가면 줄이 읽기 어려워진다', () => {
  const actions: PlanAction[] = [
    { type: 'SET_DESTINATION', name: '회사', coord: { latitude: 37.5, longitude: 127 } },
    { type: 'REPLACE_LOCAL', stopId: 's-1', candidateId: 'c-9' },
    { type: 'REPORT_STOP_CONGESTION', stopId: 's-1', level: 'busy' },
  ] as unknown as PlanAction[];
  for (const a of actions) {
    const d = describePlanAction(a, planState())?.d ?? {};
    for (const [k, v] of Object.entries(d)) {
      assert.ok(v === null || typeof v !== 'object', `${a.type}.${k} 가 중첩이다`);
    }
  }
});

test('계획 시작은 무엇을 요청했는지 남긴다', () => {
  const log = describeFlowAction(
    {
      type: 'START',
      request: {
        origin: { latitude: 37.5, longitude: 127 },
        destination: { latitude: 37.6, longitude: 127 },
        originName: '집', destinationName: '회사', mode: 'car',
        arriveByMin: null, departAtMin: 540, order: 'auto',
        stops: [
          { id: 's1', query: '카페', count: 1, flexible: true, openNow: false, stopKind: 'category' },
          { id: 's2', query: '빵집', count: 1, flexible: true, openNow: false, stopKind: 'category' },
        ],
      },
    } as PlanFlowAction,
    flowState(),
  );
  assert.equal(log?.a, 'plan.start');
  assert.equal(log?.d?.stops, '카페 · 빵집');
  assert.equal(log?.d?.mode, 'car');
  assert.equal(log?.d?.dest, '회사');
});

test('계획 실패는 갈래와 메시지를 남긴다 — 타임아웃이 조용히 사라지면 안 된다', () => {
  const log = describeFlowAction(
    { type: 'FAIL', error: { kind: 'timeout', message: '12초 안에 끝나지 않았어요' } } as PlanFlowAction,
    flowState(),
  );
  assert.equal(log?.a, 'plan.fail');
  assert.equal(log?.d?.kind, 'timeout');
  assert.equal(log?.d?.message, '12초 안에 끝나지 않았어요');
});

test('후보 시트 교체는 슬롯과 후보 이름을 남긴다', () => {
  const log = describeFlowAction(
    { type: 'SET_OVERRIDE', optionIdx: 0, slotId: 'sl-1', candidateId: 'k-2' } as PlanFlowAction,
    flowState(),
  );
  assert.equal(log?.a, 'cand.override');
  assert.equal(log?.d?.query, '카페');
  assert.equal(log?.d?.to, '제니스커피');
});
