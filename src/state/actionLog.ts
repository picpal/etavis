/**
 * 리듀서 액션 → 행동 로그 한 줄. 순수 함수라 화면 없이 시험한다.
 *
 * 왜 여기냐: 액션은 전부 리듀서를 지나므로, 변환을 한 곳에 모으면 로그 누락이
 * 구조적으로 안 생긴다. 화면마다 logTrack을 흩뿌리면 새 화면이 생길 때마다 빠진다.
 *
 * **id 대신 이름을 싣는다.** 기존 로그의 `{"k":"notify","id":"s-1"}` 은 어느 가게인지
 * 알려면 위쪽 plan 줄과 대조해야 했다. 한 줄만 보고 알 수 있어야 한다.
 *
 * **채팅 원문을 남긴다.** 추출을 다듬으려면 사용자가 실제로 뭐라고 쳤는지가 제일 값지다.
 * 로그는 기기 로컬 전용이고 사용자가 개발 메뉴에서 직접 내보낼 때만 나간다.
 *
 * trackLog 를 import 하지 않는다 — expo-file-system 을 물고 있어 node 테스트에서 죽는다.
 * 부르는 쪽(.tsx 공급자)이 반환값을 logTrack 에 넘긴다.
 */
import type { LogDetail } from '../lib/trackLogFormat';
import type { PlanAction, PlanState } from './plan';
import type { PlanFlowAction, PlanFlowState } from './planFlow';

export type ActLog = { a: string; d?: LogDetail };

/** 로그 한 줄에 원문을 그대로 다 싣지는 않는다 — 줄이 길면 읽히지 않는다 */
const TEXT_CAP = 200;
const cut = (s: string, n = TEXT_CAP) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function describePlanAction(action: PlanAction, before: PlanState): ActLog | null {
  const stopName = (id: string) => before.stops.find(s => s.id === id)?.name ?? id;

  switch (action.type) {
    case 'SET_DESTINATION':
      return { a: 'dest.set', d: { name: action.name, hasCoord: action.coord != null } };
    case 'SET_ORIGIN':
      return { a: 'origin.set', d: { name: action.name ?? '내 위치', hasCoord: action.coord != null } };
    case 'SWAP_ENDPOINTS':
      return { a: 'endpoints.swap' };
    case 'SET_MODE':
      return { a: 'mode.set', d: { from: before.mode, to: action.mode } };
    case 'SET_ARRIVE_BY':
      return { a: 'arriveBy.set', d: { min: action.min } };

    case 'PUSH_CHAT':
      return { a: 'chat.send', d: { text: cut(action.text) } };
    case 'APPLY_INTENT': {
      const i = action.intent;
      return {
        a: 'chat.extract',
        d: {
          add: i.stops.filter(s => s.op === 'add').length,
          remove: i.stops.filter(s => s.op === 'remove').length,
          queries: i.stops.map(s => s.queries[0] ?? '?').join(' · '),
          reset: i.resetStops,
          order: i.order,
          arriveBy: i.arriveBy,
          mode: i.mode,
          // 되묻기·거절은 '못 알아들었다'는 신호다. 세어두면 어떤 문장이 막히는지 보인다
          ask: i.ambiguous.length,
          reject: i.reject ? cut(i.reject.say, 60) : null,
        },
      };
    }
    case 'REMOVE_CHIP': {
      const chip = before.chips.find(c => c.id === action.id);
      return { a: 'chip.remove', d: { kind: chip?.kind ?? '?', label: chip?.label ?? action.id } };
    }

    case 'SELECT_OPTION':
      return { a: 'option.select', d: { id: action.id } };
    case 'APPLY_OPTION':
      return { a: 'option.apply', d: { id: action.id } };
    case 'SET_OPTION_STORE':
      return { a: 'cand.preselect', d: { option: action.optionId, slot: action.baseId, to: action.candidateId } };

    case 'REPLACE_LOCAL': {
      const stop = before.stops.find(s => s.id === action.stopId);
      const cand = (before.dataset.candidates[stop?.baseId ?? ''] ?? []).find(c => c.id === action.candidateId);
      return {
        a: 'stop.replace',
        d: { from: stop?.name ?? action.stopId, to: cand?.name ?? action.candidateId, addedMin: cand?.addedMin ?? null },
      };
    }
    case 'REMOVE_LOCAL':
      return { a: 'stop.remove', d: { name: stopName(action.stopId) } };
    case 'REORDER_LOCAL':
      return { a: 'stop.reorder', d: { order: action.stops.map(s => s.name).join(' → ') } };

    case 'APPLY_LIVE':
      return {
        a: 'plan.apply',
        d: {
          stops: action.payload.stops.map(s => s.name).join(' · '),
          count: action.payload.stops.length,
          departMin: action.payload.departMin,
        },
      };
    case 'CONFIRM_PLAN':
      return { a: 'plan.confirm', d: { stops: before.stops.map(s => s.name).join(' · ') } };
    case 'RECALC':
      return { a: 'plan.recalc' };

    case 'REPORT_STOP_CONGESTION':
      return { a: 'congestion.report', d: { stop: stopName(action.stopId), level: action.level } };

    case 'ARRIVE_AT_STOP':
      return { a: 'stop.arrive', d: { name: before.stops[before.passedCount]?.name ?? '?' } };
    case 'DEPART_STOP':
      return { a: 'stop.depart', d: { name: before.stops[before.passedCount]?.name ?? '?' } };
    case 'ARRIVE_AT_DESTINATION':
      return { a: 'dest.arrive', d: { name: before.destinationName ?? '목적지' } };

    case 'TOGGLE_TASK':
      return { a: 'task.toggle', d: { stop: stopName(action.stopId), task: action.taskId } };
    case 'ADD_TASK':
      return { a: 'task.add', d: { stop: stopName(action.stopId) } };
    case 'REMOVE_TASK':
      return { a: 'task.remove', d: { stop: stopName(action.stopId) } };
    case 'UPDATE_TASK':
      return { a: 'task.update', d: { stop: stopName(action.stopId), text: cut(action.text, 60) } };

    // 개발 메뉴 — 동작을 바꾸므로 이상한 로그의 이유가 될 수 있다
    case 'SET_DATASET':
      return { a: 'dev.dataset', d: { key: action.key } };
    case 'SET_FAIL_NEXT':
      return { a: 'dev.failNext', d: { value: action.value } };
    case 'SET_DEV_ANY_CONGESTION':
      return { a: 'dev.anyCongestion', d: { value: action.value } };
    case 'SET_CONGESTION':
      return { a: 'dev.congestion', d: { value: action.value } };
    case 'SET_STOP_COUNT':
      return { a: 'dev.stopCount', d: { count: action.count } };

    default:
      return null;
  }
}

export function describeFlowAction(action: PlanFlowAction, before: PlanFlowState): ActLog | null {
  switch (action.type) {
    case 'START': {
      const r = action.request;
      return {
        a: 'plan.start',
        d: {
          stops: r.stops.map(s => s.query).join(' · ') || '(없음)',
          count: r.stops.length,
          from: r.originName ?? '내 위치',
          dest: r.destinationName,
          mode: r.mode,
          arriveBy: r.arriveByMin,
          order: r.order,
        },
      };
    }
    case 'PROGRESS':
      return { a: 'plan.step', d: { key: action.key, detail: action.detail ?? null } };
    case 'SLOTS':
      return {
        a: 'plan.slots',
        d: { found: action.slots.map(s => `${s.query} ${s.candidates.length}곳`).join(' · ') },
      };
    case 'RESULT': {
      const best = action.result.options[0];
      return {
        a: 'plan.result',
        d: {
          options: action.result.options.length,
          apiCalls: action.result.apiCalls,
          measured: action.result.measuredCount,
          totalMin: best?.totalMin ?? null,
          picked: best?.visits.map(v => v.candidate.name).join(' · ') ?? '',
        },
      };
    }
    case 'FAIL':
      return { a: 'plan.fail', d: { kind: action.error.kind, message: cut(action.error.message, 120) } };
    case 'SELECT_OPTION':
      return { a: 'option.select', d: { idx: action.idx } };
    case 'SET_OVERRIDE': {
      const slot = before.slots.find(s => s.id === action.slotId);
      const cand = slot?.candidates.find(c => c.id === action.candidateId);
      return {
        a: 'cand.override',
        d: { query: slot?.query ?? action.slotId, to: cand?.name ?? action.candidateId },
      };
    }
    case 'RESET':
      return { a: 'plan.reset' };
    default:
      return null;
  }
}
