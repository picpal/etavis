/**
 * 계획 흐름 상태 — 순수 리듀서. 파이프라인(runPlan)이 액션을 순서대로 보낸다.
 * 입력(출발·목적지·모드·마감·칩)은 기존 스토어(plan.tsx)가 갖고, 여기엔 계산 시점의 스냅샷만 있다.
 * 스펙: docs/superpowers/specs/2026-09-11-plan-flow-redesign-design.md
 */
import type { LatLng, Mode, PlanResult, Slot } from '../lib/routePlan/types';

export type Phase = 'idle' | 'direct' | 'searching' | 'measuring' | 'ready' | 'failed';
export type ProgressKey = 'direct' | 'search' | 'measure' | 'select';

export type PlanRequest = {
  origin: LatLng;
  destination: LatLng;
  originName: string;
  destinationName: string;
  mode: Mode;
  arriveByMin: number | null;
  departAtMin: number;
  /** 칩에서. id는 칩 id 그대로 — 슬롯 status를 칩에 되돌릴 때 쓴다 */
  stops: { id: string; query: string; count: number; flexible: boolean; openNow: boolean }[];
  order: 'auto' | 'locked';
};

export type PlanFlowError = { kind: 'direct' | 'search' | 'measure' | 'timeout'; message: string };

export type PlanFlowState = {
  phase: Phase;
  progress: { key: ProgressKey; label: string; detail?: string; done: boolean }[];
  request: PlanRequest | null;
  slots: Slot[];
  result: PlanResult | null;
  selectedOptionIdx: number;
  overrides: Record<number, Record<string, string>>;
  error: PlanFlowError | null;
};

export type PlanFlowAction =
  | { type: 'START'; request: PlanRequest }
  | { type: 'PROGRESS'; key: ProgressKey; detail?: string }
  | { type: 'SLOTS'; slots: Slot[] }
  | { type: 'RESULT'; result: PlanResult }
  | { type: 'FAIL'; error: PlanFlowError }
  | { type: 'SELECT_OPTION'; idx: number }
  | { type: 'SET_OVERRIDE'; optionIdx: number; slotId: string; candidateId: string }
  | { type: 'RESET' };

const STEPS: { key: ProgressKey; label: string }[] = [
  { key: 'direct', label: '직행 시간 확인' },
  { key: 'search', label: '경로 주변 검색' },
  { key: 'measure', label: '실제 이동시간 계산' },
  { key: 'select', label: '추천 경로 정리' },
];

export const initialPlanFlow: PlanFlowState = {
  phase: 'idle',
  progress: [],
  request: null,
  slots: [],
  result: null,
  selectedOptionIdx: 0,
  overrides: {},
  error: null,
};

export const isBusy = (phase: Phase): boolean =>
  phase === 'direct' || phase === 'searching' || phase === 'measuring';

/** 이름은 표시용이라 뺀다. 같은 키면 같은 계산이다 */
export function requestKey(r: PlanRequest): string {
  const c = (p: LatLng) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
  const stops = r.stops.map(s => `${s.query}×${s.count}${s.flexible ? '' : '!'}${s.openNow ? '?' : ''}`).join('|');
  return [c(r.origin), c(r.destination), r.mode, r.arriveByMin ?? '-', r.departAtMin, r.order, stops].join('#');
}

const PHASE_AFTER: Record<ProgressKey, Phase> = {
  direct: 'searching',
  search: 'measuring',
  measure: 'measuring',
  select: 'ready',
};

export function planFlowReducer(state: PlanFlowState, action: PlanFlowAction): PlanFlowState {
  switch (action.type) {
    case 'START': {
      if (isBusy(state.phase) && state.request && requestKey(state.request) === requestKey(action.request)) return state;
      return {
        ...initialPlanFlow,
        phase: 'direct',
        request: action.request,
        progress: STEPS.map(s => ({ ...s, done: false })),
      };
    }
    case 'PROGRESS': {
      const idx = STEPS.findIndex(s => s.key === action.key);
      return {
        ...state,
        phase: PHASE_AFTER[action.key],
        progress: state.progress.map((p, i) =>
          i < idx ? { ...p, done: true } : i === idx ? { ...p, done: true, detail: action.detail ?? p.detail } : p,
        ),
      };
    }
    case 'SLOTS':
      return { ...state, slots: action.slots };
    case 'RESULT':
      return {
        ...state,
        phase: 'ready',
        result: action.result,
        selectedOptionIdx: 0,
        overrides: {},
        error: null,
        progress: state.progress.map(p => ({ ...p, done: true })),
      };
    case 'FAIL':
      return { ...state, phase: 'failed', error: action.error };
    case 'SELECT_OPTION':
      return { ...state, selectedOptionIdx: action.idx };
    case 'SET_OVERRIDE': {
      const cur = state.overrides[action.optionIdx] ?? {};
      return {
        ...state,
        overrides: { ...state.overrides, [action.optionIdx]: { ...cur, [action.slotId]: action.candidateId } },
      };
    }
    case 'RESET':
      return initialPlanFlow;
    default:
      return state;
  }
}
