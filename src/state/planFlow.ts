/**
 * 계획 흐름 상태 — 순수 리듀서. 파이프라인(runPlan)이 액션을 순서대로 보낸다.
 * 입력(출발·목적지·모드·마감·칩)은 기존 스토어(plan.tsx)가 갖고, 여기엔 계산 시점의 스냅샷만 있다.
 * 스펙: docs/superpowers/specs/2026-09-11-plan-flow-redesign-design.md
 */
import type { LatLng, Mode, NearSide, PlanResult, Slot } from '../lib/routePlan/types';
import type { Load, NeedWhen } from '../lib/nearSide';

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
  stops: { id: string; queries: string[]; count: number; flexible: boolean; openNow: boolean; stopKind: 'brand' | 'category' | 'specific'; why?: string; near?: NearSide; loadBefore?: Load; loadAfter?: Load; needWhen?: NeedWhen }[];
  order: 'auto' | 'locked';
};

export type PlanFlowError = { kind: 'direct' | 'search' | 'measure' | 'timeout'; message: string };

/**
 * 실패 화면이 쓸 문구. 원인별로 다른 말을 한다.
 *
 * 타임아웃을 "연결이 불안정해요"로 뭉뚱그리고 있었다. 실측 2026-09-19 기기에서 그
 * 실패를 냈을 때 트랙로그의 네트워크 호출은 9건 전부 `ok:true` 였다 — 연결은
 * 멀쩡했고 반경을 네 번 넓히느라 검색이 6.4초를 쓴 것이다. 틀린 원인을 말하면
 * 사용자는 엉뚱한 걸 고치려 든다(와이파이를 끄고 켠다).
 *
 * 다시 계산을 권하는 건 빈말이 아니다 — 장소 검색은 서버가 24시간 캐시하므로
 * (`server/src/places.ts`) 두 번째 시도는 검색 단계를 거의 건너뛴다.
 */
export function planFailCopy(kind: PlanFlowError['kind']): { title: string; detail: string } {
  if (kind === 'timeout') {
    return {
      title: '계산이 길어졌어요',
      detail: '12초 안에 끝나지 않았어요. 다시 계산하면 대개 빨라요 — 방금 찾은 곳들이 남아 있어요.',
    };
  }
  return { title: '연결이 불안정해요', detail: '이동시간을 계산하지 못했어요.' };
}

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

/** 좌표를 비교 가능한 문자열로. 5자리면 1m 남짓이라 같은 지점은 같은 키가 된다 */
const coord = (p: LatLng) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;

/** 직행 시간을 정하는 것 전부. 들르는 곳도 마감도 두 점 사이 직행을 바꾸지 않는다 */
export type Trip = Pick<PlanRequest, 'origin' | 'destination' | 'mode'>;

const sameTrip = (a: Trip, b: Trip): boolean =>
  a.mode === b.mode && coord(a.origin) === coord(b.origin) && coord(a.destination) === coord(b.destination);

/**
 * 화면 머리글에 쓸 직행 시간. **지금 여정을 실제로 잰 값일 때만** 돌려준다. 없으면 `null`.
 *
 * 머리글이 `datasets[0].directMin`(목 데이터)을 쓰고 있었다. 목적지를 고르기만 하면
 * `/route` 를 부른 적도 없이 '직행 16분'이라고 했고, 실제로 계산하면 47분이었다
 * (2026-09-19 시뮬레이터, 태평로1가→목동). 3배 차이를 사실처럼 말하느니 비워 둔다.
 *
 * 좌표 비교가 `flow.reset()` 과 겹쳐 보이지만 겹치지 않는다: 이동수단·칩이 바뀌면
 * 화면들이 결과를 지우는데(`ModeSheet.tsx`), **출발·목적지를 바꿀 때는 아무도 안 지운다**
 * (`DestinationSheet.tsx` 는 flow 를 모른다). 그 자리를 여기서 막는다.
 */
export function measuredDirectMin(state: PlanFlowState, now: Trip | null): number | null {
  const measured = state.request;
  if (state.result == null || measured == null || now == null) return null;
  return sameTrip(measured, now) ? Math.round(state.result.directMin) : null;
}

/**
 * 이름은 표시용이라 뺀다. 같은 키면 같은 계산이다.
 * departAtMin도 뺀다 — 그건 사용자가 바꾼 조건이 아니라 시계다.
 * 넣어두면 1분만 지나도 A5에 "조건이 바뀌었어요"가 뜬다.
 */
export function requestKey(r: PlanRequest): string {
  const c = coord;
  // near 와 태그가 빠져 있었다 — 태그를 바꿔도 같은 요청으로 보고 재계산을 건너뛴다.
  // mode 는 아래 배열에 이미 있으므로, 이것으로 decideNear 의 입력이 전부 키에 들어간다
  const stops = r.stops.map(s =>
    `${s.queries.join('>')}×${s.count}${s.flexible ? '' : '!'}${s.openNow ? '?' : ''}`
    + `@${s.near ?? 'any'}/${s.loadBefore ?? 'none'}/${s.loadAfter ?? 'none'}/${s.needWhen ?? 'unknown'}`,
  ).join('|');
  return [c(r.origin), c(r.destination), r.mode, r.arriveByMin ?? '-', r.order, stops].join('#');
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
        /* 기본 선택은 **추천안**이다. 최단안(0)을 기본으로 두면 탭을 건드리지 않은
           사용자가 화면이 권하지 않는 안을 그대로 확정한다 — 이 값은 하이라이트만이
           아니라 무엇을 확정하나를 정한다. 짐을 안 잰 계획은 `comfortIdx` 가 null 이라
           가리킬 추천안이 없고, 그때만 최단안으로 떨어진다 */
        selectedOptionIdx: action.result.comfortIdx ?? 0,
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
