/**
 * 시나리오 A 상태 — useReducer + Context.
 * 로드 시에는 mockData 수치를 그대로 쓰고, 사용자가 경로를 바꾼 뒤에는
 * LEGS 테이블 기반 체인 재계산으로 도착 시각·총시간·직행 대비를 다시 만든다.
 */
import React, { createContext, useContext, useMemo, useReducer, useRef } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { useCurrentPlace } from '../lib/currentPlace';
import {
  Candidate,
  Dataset,
  datasets,
  LatLng,
  RouteOption,
  Stop,
} from '../data/mockData';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type StopState = Stop & {
  /** 원본 stop id — 교체돼도 유지되며 LEGS 조회 키로 쓴다 */
  baseId: string;
  /** 후보 교체 누적 추가시간(분). 추천 후보 대비 */
  replaceDeltaMin: number;
  selectedCandidateId?: string;
};

export type PlanState = {
  dataset: Dataset;
  mode: 'car' | 'walk' | 'transit';
  /** 도착 마감(자정 기준 분). null = 상관없음(기본값) */
  arriveByMin: number | null;
  /** A1에서 고른 목적지 이름. null이면 아직 미지정 (표시는 dataset 값으로 fallback) */
  destinationName: string | null;
  /** 검색 결과에서 고른 목적지 좌표. 직접 입력한 경우엔 null */
  destinationCoord: LatLng | null;
  stops: StopState[];
  options: RouteOption[];
  selectedOptionId: string;
  /** A5에서 안(案)별로 미리 골라둔 매장: optionId → (stop baseId → candidateId) */
  optionOverrides: Record<string, Record<string, string>>;
  finalLegMin: number;
  finalLegKm: number;
  destArriveAt: string;
  totals: { totalMin: number; deltaMin: number; stopCount: number };
  chat: string[];
  failNext: boolean;
  recalcPending: boolean;
  /** A5에서 경로를 확정했는지 — 진행중 탭·새 계획 교체 확인의 기준 */
  planConfirmed: boolean;
  /** 내가 남긴 혼잡도 제보 (주변 탭·알림 액션 공용) */
  congestionReport: string | null;
  /** 이미 지나온 경유지 수 — stops[passedCount]가 다음(또는 체류 중) 경유지 */
  passedCount: number;
  /** 다음 경유지에 도착해 체류 중인지 */
  atStop: boolean;
};

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const toHHMM = (min: number) =>
  `${Math.floor(min / 60) % 24}:${String(min % 60).padStart(2, '0')}`;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 마감 시각 표기 — 자정을 넘긴 값은 '내일'로 붙인다 */
export const arriveByText = (min: number) =>
  `${min >= 24 * 60 ? '내일' : '오늘'} ${toHHMM(min).padStart(5, '0')}까지`;

/** 구간 이동시간 목 테이블 (from>to, 역방향 fallback) */
const LEGS: Record<string, { min: number; km: number }> = {
  'origin>s1': { min: 12, km: 6.4 },
  'origin>s2': { min: 14, km: 7.2 },
  's1>s2': { min: 9, km: 4.1 },
  's2>s1': { min: 11, km: 5.3 },
  's1>dest': { min: 9, km: 3.8 },
  's2>dest': { min: 8, km: 3.2 },
  'origin>dest': { min: 32, km: 23.5 },
};
const legBetween = (a: string, b: string, ds?: Dataset) => {
  const table = ds?.legs ?? LEGS;
  return table[`${a}>${b}`] ?? table[`${b}>${a}`] ?? { min: 10, km: 5.0 };
};

const asStopState = (s: Stop): StopState => ({
  ...s,
  baseId: s.id,
  replaceDeltaMin: 0,
});

/** 로드 시: stops 수치는 데이터 그대로, 목적지 도착만 체인으로 파생 */
function deriveFromDataset(ds: Dataset) {
  const stops = ds.stops.map(asStopState);
  const departMin = toMin(ds.origin.departAt);
  let finalLegMin: number;
  let finalLegKm: number;
  let destArrive: number;
  if (stops.length) {
    const last = stops[stops.length - 1];
    const fin = legBetween(last.baseId, 'dest', ds);
    finalLegMin = fin.min;
    finalLegKm = fin.km;
    destArrive = toMin(last.arriveAt) + last.dwellMin + fin.min;
  } else {
    const fin = legBetween('origin', 'dest', ds);
    finalLegMin = fin.min;
    finalLegKm = fin.km;
    destArrive = departMin + fin.min;
  }
  const totalMin = destArrive - departMin;
  return {
    stops,
    finalLegMin,
    finalLegKm,
    destArriveAt: toHHMM(destArrive),
    totals: { totalMin, deltaMin: totalMin - ds.directMin, stopCount: stops.length },
  };
}

/** 변경 후: LEGS 체인으로 전체 재계산 */
function computeChain(stops: StopState[], ds: Dataset) {
  const departMin = toMin(ds.origin.departAt);
  let clock = departMin;
  const out = stops.map((s, i) => {
    const prevKey = i === 0 ? 'origin' : stops[i - 1].baseId;
    const base = legBetween(prevKey, s.baseId, ds);
    const legMin = base.min + s.replaceDeltaMin;
    const legKm = round1(base.km * (legMin / base.min));
    clock += legMin;
    const arriveAt = toHHMM(clock);
    clock += s.dwellMin;
    return { ...s, legMin, legKm, arriveAt };
  });
  const lastKey = stops.length ? stops[stops.length - 1].baseId : 'origin';
  const fin = legBetween(lastKey, 'dest', ds);
  clock += fin.min;
  const totalMin = clock - departMin;
  return {
    stops: out,
    finalLegMin: fin.min,
    finalLegKm: fin.km,
    destArriveAt: toHHMM(clock),
    totals: { totalMin, deltaMin: totalMin - ds.directMin, stopCount: out.length },
  };
}

function initState(ds: Dataset): PlanState {
  return {
    dataset: ds,
    mode: ds.mode,
    arriveByMin: null, // 마감은 선택 — 기본은 '상관없어요'
    destinationName: null,
    destinationCoord: null,
    ...deriveFromDataset(ds),
    options: ds.options,
    selectedOptionId: (ds.options.find(o => o.recommended) ?? ds.options[0]).id,
    optionOverrides: {},
    chat: [ds.userMessage],
    failNext: false,
    recalcPending: false,
    planConfirmed: false,
    congestionReport: null,
    passedCount: 0,
    atStop: false,
  };
}

/** A5 선택안 → stops 구성. stopNames의 중간 항목을 stop/candidate 이름과 매칭 */
function stopsForOption(ds: Dataset, option: RouteOption): StopState[] {
  const middles = option.stopNames.slice(1, -1);
  const result: StopState[] = [];
  for (const short of middles) {
    const stop = ds.stops.find(s => s.name.includes(short));
    if (stop) {
      result.push(asStopState(stop));
      continue;
    }
    for (const s of ds.stops) {
      const cands = ds.candidates[s.id] ?? [];
      const cand = cands.find(c => c.name.includes(short));
      if (cand) {
        result.push(applyCandidate(asStopState(s), cand, cands));
        break;
      }
    }
  }
  return result;
}

function applyCandidate(stop: StopState, cand: Candidate, cands: Candidate[]): StopState {
  const current = cands.find(c => c.id === stop.selectedCandidateId)
    ?? cands.find(c => c.recommended)
    ?? cands[0];
  const openLabel = cand.openNote.split(' · ')[0];
  return {
    ...stop,
    name: cand.name,
    coord: cand.coord,
    dwellMin: cand.dwellMin,
    openState: cand.openState,
    openNote: `체류 ${cand.dwellMin}분 · ${openLabel}`,
    selectedCandidateId: cand.id,
    replaceDeltaMin: stop.replaceDeltaMin + (cand.addedMin - (current?.addedMin ?? 0)),
  };
}

/**
 * 체류시간의 근거 — 이 앱의 해자.
 * 지도 앱이 못 갖는 신호(할 일 개수·목적)를 우선 쓰고, 없으면 매장/카테고리 평균으로 폴백한다.
 *   ① 이 매장 (표본 충분)  ② 브랜드 평균  ③ 카테고리 기본값
 */
export function dwellBasis(stop: { name: string; category: string; tasks: { id: string }[] }): string {
  if (stop.tasks.length > 0) return `할 일 ${stop.tasks.length}개 기준`;
  const brand = stop.name.split(' ')[0];
  return `${brand} 평균`;
}

/** A5 카드에 그릴 옵션의 중간 경유지 슬롯 */
export type OptionStopSlot = {
  baseId: string;
  /** 표시용 짧은 이름 (브랜드) */
  shortName: string;
  /** 현재 유효 후보 id (오버라이드 반영) */
  candidateId?: string;
  candidateCount: number;
};

/**
 * 옵션의 표시값 — A5 매장 오버라이드를 반영한 이름·총시간·직행 대비.
 * originLabel을 주면 첫 칸(출발지)을 그 이름으로 바꾼다 — 목 데이터셋 이름이 새어 나가지 않게.
 */
export function getOptionView(state: PlanState, option: RouteOption, originLabel?: string, destLabel?: string) {
  const ds = state.dataset;
  const middles = option.stopNames.slice(1, -1);
  const overrides = state.optionOverrides?.[option.id] ?? {};
  let adjust = 0;
  const slots: OptionStopSlot[] = [];
  for (const short of middles) {
    let baseId: string | undefined;
    let baseCand: Candidate | undefined;
    const stop = ds.stops.find(s => s.name.includes(short));
    if (stop) {
      baseId = stop.id;
      const cands = ds.candidates[stop.id] ?? [];
      baseCand = cands.find(c => c.recommended) ?? cands[0];
    } else {
      for (const s of ds.stops) {
        const cands = ds.candidates[s.id] ?? [];
        const cand = cands.find(c => c.name.includes(short));
        if (cand) {
          baseId = s.id;
          baseCand = cand;
          break;
        }
      }
    }
    if (!baseId) {
      slots.push({ baseId: short, shortName: short, candidateCount: 0 });
      continue;
    }
    const cands = ds.candidates[baseId] ?? [];
    const effective = cands.find(c => c.id === overrides[baseId!]) ?? baseCand;
    if (effective && baseCand) adjust += effective.addedMin - baseCand.addedMin;
    slots.push({
      baseId,
      shortName: (effective?.name ?? short).split(' ')[0],
      candidateId: effective?.id,
      candidateCount: cands.filter(c => !c.disabled).length,
    });
  }
  const last = destLabel ?? option.stopNames[option.stopNames.length - 1];
  return {
    slots,
    names: [originLabel ?? option.stopNames[0], ...slots.map(s => s.shortName), last],
    totalMin: option.totalMin + adjust,
    deltaMin: option.deltaMin + adjust,
  };
}

type Action =
  | { type: 'SET_DATASET'; key: string }
  | { type: 'SET_MODE'; mode: PlanState['mode'] }
  | { type: 'SET_ARRIVE_BY'; min: number | null }
  | { type: 'SET_DESTINATION'; name: string; coord: LatLng | null }
  | { type: 'APPLY_OPTION'; id: string }
  | { type: 'SELECT_OPTION'; id: string }
  | { type: 'SET_OPTION_STORE'; optionId: string; baseId: string; candidateId: string }
  | { type: 'REORDER_LOCAL'; stops: StopState[] }
  | { type: 'REMOVE_LOCAL'; stopId: string }
  | { type: 'REPLACE_LOCAL'; stopId: string; candidateId: string }
  | { type: 'RECALC' }
  | { type: 'TOGGLE_TASK'; stopId: string; taskId: string }
  | { type: 'UPDATE_TASK'; stopId: string; taskId: string; text: string }
  | { type: 'ADD_TASK'; stopId: string; taskId: string }
  | { type: 'REMOVE_TASK'; stopId: string; taskId: string }
  | { type: 'SET_FAIL_NEXT'; value: boolean }
  | { type: 'SET_CONGESTION'; value: string | null }
  | { type: 'CONFIRM_PLAN' }
  | { type: 'ARRIVE_AT_STOP' }
  | { type: 'DEPART_STOP' }
  | { type: 'PUSH_CHAT'; text: string };

function reducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case 'SET_DATASET': {
      const ds = datasets.find(d => d.key === action.key) ?? datasets[0];
      return initState(ds);
    }
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_ARRIVE_BY':
      return { ...state, arriveByMin: action.min };
    case 'SET_DESTINATION':
      return { ...state, destinationName: action.name, destinationCoord: action.coord };
    case 'SELECT_OPTION':
      return { ...state, selectedOptionId: action.id };
    case 'SET_OPTION_STORE': {
      const cur = state.optionOverrides?.[action.optionId] ?? {};
      return {
        ...state,
        optionOverrides: {
          ...state.optionOverrides,
          [action.optionId]: { ...cur, [action.baseId]: action.candidateId },
        },
      };
    }
    case 'APPLY_OPTION': {
      const option = state.options.find(o => o.id === action.id) ?? state.options[0];
      const overrides = state.optionOverrides?.[option.id] ?? {};
      const stops = stopsForOption(state.dataset, option).map(s => {
        const overrideId = overrides[s.baseId];
        if (!overrideId) return s;
        const cands = state.dataset.candidates[s.baseId] ?? [];
        const cand = cands.find(c => c.id === overrideId);
        return cand ? applyCandidate(s, cand, cands) : s;
      });
      const recommendedId = (state.dataset.options.find(o => o.recommended) ?? state.dataset.options[0]).id;
      const untouched = option.id === recommendedId && Object.keys(overrides).length === 0;
      return {
        ...state,
        selectedOptionId: option.id,
        planConfirmed: true,
        ...(untouched ? deriveFromDataset(state.dataset) : computeChain(stops, state.dataset)),
      };
    }
    case 'REORDER_LOCAL':
      return { ...state, stops: action.stops, recalcPending: true };
    case 'REMOVE_LOCAL':
      return { ...state, stops: state.stops.filter(s => s.id !== action.stopId), recalcPending: true };
    case 'REPLACE_LOCAL': {
      const stops = state.stops.map(s => {
        if (s.id !== action.stopId) return s;
        const cands = state.dataset.candidates[s.baseId] ?? [];
        const cand = cands.find(c => c.id === action.candidateId);
        return cand ? applyCandidate(s, cand, cands) : s;
      });
      return { ...state, stops, recalcPending: true };
    }
    case 'RECALC': {
      const next = computeChain(state.stops, state.dataset);
      // 히스테리시스: 도착 예정이 3분 미만으로 흔들리면 표기를 유지한다.
      // 값이 볼 때마다 바뀌면 사용자가 그 숫자를 믿지 않게 된다.
      const drift = Math.abs(toMin(next.destArriveAt) - toMin(state.destArriveAt));
      const destArriveAt = drift < 3 ? state.destArriveAt : next.destArriveAt;
      return { ...state, ...next, destArriveAt, recalcPending: false };
    }
    case 'TOGGLE_TASK': {
      const stops = state.stops.map(s =>
        s.id === action.stopId
          ? { ...s, tasks: s.tasks.map(t => (t.id === action.taskId ? { ...t, done: !t.done } : t)) }
          : s,
      );
      return { ...state, stops };
    }
    case 'UPDATE_TASK': {
      const stops = state.stops.map(s =>
        s.id === action.stopId
          ? { ...s, tasks: s.tasks.map(t => (t.id === action.taskId ? { ...t, text: action.text } : t)) }
          : s,
      );
      return { ...state, stops };
    }
    case 'ADD_TASK': {
      const stops = state.stops.map(s =>
        s.id === action.stopId
          ? { ...s, tasks: [...s.tasks, { id: action.taskId, text: '', done: false }] }
          : s,
      );
      return { ...state, stops };
    }
    case 'REMOVE_TASK': {
      const stops = state.stops.map(s =>
        s.id === action.stopId ? { ...s, tasks: s.tasks.filter(t => t.id !== action.taskId) } : s,
      );
      return { ...state, stops };
    }
    case 'SET_FAIL_NEXT':
      return { ...state, failNext: action.value };
    case 'SET_CONGESTION':
      return { ...state, congestionReport: action.value };
    case 'CONFIRM_PLAN':
      return state.planConfirmed ? state : { ...state, planConfirmed: true };
    case 'ARRIVE_AT_STOP':
      return { ...state, atStop: true };
    case 'DEPART_STOP':
      return { ...state, atStop: false, passedCount: Math.min(state.stops.length, state.passedCount + 1) };
    case 'PUSH_CHAT':
      return { ...state, chat: [...state.chat, action.text] };
    default:
      return state;
  }
}

type PlanApi = {
  state: PlanState;
  setDataset: (key: string) => void;
  setMode: (mode: PlanState['mode']) => void;
  setArriveBy: (min: number | null) => void;
  /** 마감까지 남은 여유(분). 음수면 초과. 마감이 없으면 null */
  slackMin: number | null;
  setDestination: (name: string, coord?: LatLng | null) => void;
  /** 표시용 목적지 이름 (미지정이면 데이터셋 값) */
  destinationDisplay: string;
  /** 표시용 출발지 이름 — GPS를 잡았으면 '내 위치'. 목 데이터셋 이름이 새어 나가지 않게 한 곳에서 만든다 */
  originDisplay: string;
  /** 선택 가능한 도착 시각 옵션 (30분 단위) */
  arriveByOptions: number[];
  selectOption: (id: string) => void;
  applyOption: (id: string) => void;
  setOptionStore: (optionId: string, baseId: string, candidateId: string) => void;
  reorderStops: (stops: StopState[]) => void;
  removeStop: (stopId: string) => void;
  replaceStop: (stopId: string, candidateId: string) => void;
  toggleTask: (stopId: string, taskId: string) => void;
  updateTask: (stopId: string, taskId: string, text: string) => void;
  addTask: (stopId: string, taskId: string) => void;
  removeTask: (stopId: string, taskId: string) => void;
  setFailNext: (value: boolean) => void;
  setCongestionReport: (value: string | null) => void;
  /** 확정 상태로 표시 — A6(최종 경로)에 들어왔다는 건 계획이 있다는 뜻 */
  confirmPlan: () => void;
  arriveAtStop: () => void;
  departStop: () => void;
  pushChat: (text: string) => void;
  arriveByLabel: string;
};

const PlanContext = createContext<PlanApi | null>(null);

const RECALC_DELAY = 600;

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, datasets[0], initState);
  const here = useCurrentPlace();
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo<PlanApi>(() => {
    const scheduleRecalc = () => {
      if (recalcTimer.current) clearTimeout(recalcTimer.current);
      recalcTimer.current = setTimeout(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'RECALC' });
      }, RECALC_DELAY);
    };
    return {
      state,
      setDataset: key => dispatch({ type: 'SET_DATASET', key }),
      setMode: mode => dispatch({ type: 'SET_MODE', mode }),
      setArriveBy: min => dispatch({ type: 'SET_ARRIVE_BY', min }),
      setDestination: (name, coord) => dispatch({ type: 'SET_DESTINATION', name, coord: coord ?? null }),
      destinationDisplay: state.destinationName ?? state.dataset.destination.name,
      originDisplay: here.coord ? '내 위치' : state.dataset.origin.name,
      /*
        마감 후보는 '지금' 이후만 보여준다. 목 데이터의 출발 시각을 기준으로 잡으면
        이미 지나간 시각이 목록에 남아 고를 수 있게 된다.
        30분 뒤부터 12시간치. 자정을 넘어가는 항목은 '내일'로 붙는다.
      */
      arriveByOptions: (() => {
        const now = new Date();
        const start = Math.ceil((now.getHours() * 60 + now.getMinutes() + 30) / 30) * 30;
        return Array.from({ length: 24 }, (_, i) => start + i * 30);
      })(),
      selectOption: id => dispatch({ type: 'SELECT_OPTION', id }),
      applyOption: id => dispatch({ type: 'APPLY_OPTION', id }),
      setOptionStore: (optionId, baseId, candidateId) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'SET_OPTION_STORE', optionId, baseId, candidateId });
      },
      reorderStops: stops => {
        dispatch({ type: 'REORDER_LOCAL', stops });
        scheduleRecalc();
      },
      removeStop: stopId => {
        dispatch({ type: 'REMOVE_LOCAL', stopId });
        scheduleRecalc();
      },
      replaceStop: (stopId, candidateId) => {
        dispatch({ type: 'REPLACE_LOCAL', stopId, candidateId });
        scheduleRecalc();
      },
      toggleTask: (stopId, taskId) => dispatch({ type: 'TOGGLE_TASK', stopId, taskId }),
      updateTask: (stopId, taskId, text) => dispatch({ type: 'UPDATE_TASK', stopId, taskId, text }),
      addTask: (stopId, taskId) => dispatch({ type: 'ADD_TASK', stopId, taskId }),
      removeTask: (stopId, taskId) => dispatch({ type: 'REMOVE_TASK', stopId, taskId }),
      setFailNext: value => dispatch({ type: 'SET_FAIL_NEXT', value }),
      setCongestionReport: value => dispatch({ type: 'SET_CONGESTION', value }),
      confirmPlan: () => dispatch({ type: 'CONFIRM_PLAN' }),
      arriveAtStop: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'ARRIVE_AT_STOP' });
      },
      departStop: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'DEPART_STOP' });
      },
      pushChat: text => dispatch({ type: 'PUSH_CHAT', text }),
      arriveByLabel: state.arriveByMin == null ? '도착 시각 상관없어요' : arriveByText(state.arriveByMin),
      slackMin: state.arriveByMin == null ? null : state.arriveByMin - toMin(state.destArriveAt),
    };
  }, [state, here.coord]);

  return <PlanContext.Provider value={api}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within PlanProvider');
  return ctx;
}
