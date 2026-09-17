/**
 * 시나리오 A 상태 — useReducer + Context.
 * 로드 시에는 mockData 수치를 그대로 쓰고, 사용자가 경로를 바꾼 뒤에는
 * LEGS 테이블 기반 체인 재계산으로 도착 시각·총시간·직행 대비를 다시 만든다.
 */
import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { useCurrentPlace } from '../lib/currentPlace';
import { CongestionKey, hasVisitedStop } from '../lib/congestion';
import { extractIntent, Intent } from '../lib/intent';
import type { ExtractSource } from '../lib/intentClient';
import type { NearSide } from '../lib/routePlan/types';
import { nowMin, toHHMM, toMin } from '../lib/clock';
import { narrowStopChips, resetChatChips, syncConditionChips } from './chips';
import { logTrack } from '../lib/trackLog';
import { describePlanAction } from './actionLog';
import {
  Candidate,
  Dataset,
  datasets,
  LatLng,
  RECENT_DESTINATIONS,
  RouteOption,
  Stop,
} from '../data/mockData';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** 채팅 추출 결과를 화면에 드러내는 단위. 조용한 실패를 보이는 실패로 바꾼다 */
export type IntentChip =
  | {
      id: string;
      kind: 'stop';
      label: string;
      queries: string[];
      /** 사용자가 이 경유지를 무엇이라 불렀나 — '빵집'(category)인지 '파리바게뜨'(brand)인지.
          좁히기 질문에 답했는지와는 다른 사실이다. 아래 `narrowed`를 보라 */
      stopKind: 'brand' | 'category' | 'specific';
      /** 좁히기 질문에 이미 답했나. `stopKind`는 그대로 둔 채(보강·트렌드 스왑이 계속
          돌아야 하므로) 이 칩이 되묻기 대상에서 빠졌는지만 따로 기록한다 */
      narrowed?: boolean;
      /** LLM이 뽑은 '문 연 곳만' — runPlan 의 슬롯으로 그대로 내려간다 */
      openNow: boolean;
      /** 여기서 할 일 — '옷수선 맡기고'의 '맡기고'. 장소가 정해지는 순간
          (`toLegacyPlan`) 그 경유지의 할 일 한 줄이 된다 */
      why?: string;
      /** false면 특정 지점 고정. 최적화 대상에서 뺀다 */
      flexible: boolean;
      /** 사용자가 말한 위치 — '회사 근처 카페'의 '회사 근처'. 말 안 했으면 'any' */
      near: NearSide;
    }
  | { id: string; kind: 'arriveBy'; label: string; value: number };
/* 이동수단은 칩이 아니다 — A2 헤더의 셀렉트가 유일한 조작점이다. 칩으로도 두던 시절엔
   ✕를 눌러도 state.mode 가 안 바뀌어, 지워도 안 지워지는 칩이었다(chips.ts 주석) */

export type StopState = Stop & {
  /** 원본 stop id — 교체돼도 유지되며 LEGS 조회 키로 쓴다 */
  baseId: string;
  /** 이 경유지에서 남긴 혼잡도 제보. 실제로 도착해 체류 중일 때만 기록된다 */
  congestion?: CongestionKey;
  /** 후보 교체 누적 추가시간(분). 추천 후보 대비 */
  replaceDeltaMin: number;
  selectedCandidateId?: string;
};

/** 확정 경계 — planFlow가 만든 계획을 기존 스토어 형식으로. 만드는 쪽은 planFlowBridge.ts */
export type ApplyLivePayload = {
  stops: StopState[];
  dataset: Dataset;
  departMin: number;
  selectedOptionId: string;
};

export type PlanState = {
  dataset: Dataset;
  mode: 'car' | 'walk' | 'transit';
  /** 도착 마감(자정 기준 분). null = 상관없음(기본값) */
  arriveByMin: number | null;
  /** A1에서 고른 목적지 이름. null이면 아직 미지정 (표시는 dataset 값으로 fallback) */
  destinationName: string | null;
  /** 검색 결과에서 고른 목적지 좌표 */
  destinationCoord: LatLng | null;
  /** 사용자가 직접 고른 출발지. null이면 현재 위치(GPS) */
  originName: string | null;
  originCoord: LatLng | null;
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
  /** 개발용 — 도착하지 않은 경유지에서도 혼잡도를 묻는다. 실사용에서는 꺼야 한다 */
  devAnyCongestion: boolean;
  recalcPending: boolean;
  /** A5에서 경로를 확정했는지 — 진행중 탭·새 계획 교체 확인의 기준 */
  planConfirmed: boolean;
  /** 내가 남긴 혼잡도 제보 (주변 탭·알림 액션 공용) */
  congestionReport: string | null;
  /** 이미 지나온 경유지 수 — stops[passedCount]가 다음(또는 체류 중) 경유지 */
  passedCount: number;
  /** 다음 경유지에 도착해 체류 중인지 */
  atStop: boolean;
  /** 최종 목적지 도착 — 경유지를 다 지난 뒤의 마지막 지오펜스 */
  arrivedAtDest: boolean;
  /** 채팅에서 지정한 경유지 개수(목 데이터). null이면 옵션이 정한 대로 */
  stopCount: number | null;
  /** 채팅에서 뽑아낸 조건 칩. 잘못 잡힌 걸 사용자가 그 자리에서 지울 수 있어야 한다 */
  chips: IntentChip[];
  /** 출발 시각(자정 기준 분) — 계획을 확정한 그 시각. 목 데이터의 08:10이 아니다 */
  departMin: number;
};

// 시각 표기는 lib/clock.ts 하나로 모았다 — 구현이 둘이면 화면마다 다른 시각을 말한다.
// 화면들이 여기서 import 하고 있어 재수출로 남긴다.
export { toHHMM, toMin } from '../lib/clock';

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


/** 이동수단 라벨은 여기 하나뿐이다 — A1 세그먼트·A2 헤더·시트가 같은 말을 써야 한다 */
export const MODE_KEYS = ['car', 'walk', 'transit'] as const;
export const MODE_TEXT: Record<PlanState['mode'], string> = { car: '자동차', walk: '도보', transit: '대중교통' };
let chipSeq = 0;

const asStopState = (s: Stop): StopState => ({
  ...s,
  baseId: s.id,
  replaceDeltaMin: 0,
});

/**
 * 로드 시에도 체인으로 전부 계산한다.
 * 예전엔 목 데이터의 arriveAt('08:22')을 그대로 썼는데, 출발이 현재 시각이 되면서
 * 출발만 저녁이고 경유지는 아침인 상태가 나왔다 — 총 소요가 음수로 찍혔다.
 */
function deriveFromDataset(ds: Dataset, departMin: number) {
  return computeChain(ds.stops.map(asStopState), ds, departMin);
}

/** 변경 후: LEGS 체인으로 전체 재계산 */
/**
 * 출발 시각부터 구간을 이어 붙여 도착 시각을 낸다.
 *
 * **클럭은 소수로 누적하고 표기할 때만 반올림한다.** 구간마다 반올림해서 더하면
 * 오차가 쌓여 도착 시각이 통째로 밀린다 — 실측 `11.468 + 9.175 + 5.413 = 26.06분`이
 * 구간별 반올림으로는 `11 + 9 + 5 = 25분`이 된다. 그래서 A5(원본 timing)와
 * 타임라인(체인 재계산)이 서로 다른 시각을 말했다.
 *
 * 화면에 내보내는 `legMin`·`totalMin`만 정수로 깎는다.
 */
function computeChain(stops: StopState[], ds: Dataset, departMin: number) {
  let clock = departMin;
  const out = stops.map((s, i) => {
    const prevKey = i === 0 ? 'origin' : stops[i - 1].baseId;
    const base = legBetween(prevKey, s.baseId, ds);
    const legMin = base.min + s.replaceDeltaMin;
    // base.min이 0이면 비율을 낼 수 없다 — 나눠 버리면 legKm이 NaN이 되어 화면에 "NaNkm"이 뜬다
    const legKm = round1(base.min > 0 ? base.km * (legMin / base.min) : base.km);
    clock += legMin; // 정밀 누적
    const arriveAt = toHHMM(clock);
    clock += s.dwellMin;
    return { ...s, legMin: Math.round(legMin), legKm, arriveAt };
  });
  const lastKey = stops.length ? stops[stops.length - 1].baseId : 'origin';
  const fin = legBetween(lastKey, 'dest', ds);
  clock += fin.min;
  const totalMin = clock - departMin;
  return {
    stops: out,
    finalLegMin: Math.round(fin.min),
    finalLegKm: fin.km,
    destArriveAt: toHHMM(clock),
    totals: {
      totalMin: Math.round(totalMin),
      deltaMin: Math.round(totalMin - ds.directMin),
      stopCount: out.length,
    },
  };
}

/**
 * @param seed 데이터셋의 예시 대화를 채팅·칩으로 미리 깔지 여부.
 *
 * **앱을 켰을 때는 깔지 않는다.** 사용자가 한 적 없는 말이 자기 말풍선으로 떠 있고
 * 칩까지 붙어 있으면, 그건 데모가 아니라 남의 계획이다. 실기기에서 이게 그대로
 * 보였다(2026-09-15).
 *
 * 개발 메뉴에서 데이터셋을 고를 때만 깐다 — 그때는 예시를 보려는 것이 목적이다.
 */
function initState(ds: Dataset, seed = false): PlanState {
  const departMin = nowMin();
  const seeded = seed ? extractIntent(ds.userMessage, { currentStops: [] }) : { stops: [] as never[] };
  const seedChips: IntentChip[] = seeded.stops.map(st => ({
    id: `s-${chipSeq++}`,
    kind: 'stop' as const,
    label: st.queries[0],
    queries: st.queries,
    stopKind: st.kind,
    openNow: st.openNow,
    flexible: st.flexible,
    why: st.why,
    near: st.near,
  }));
  return {
    departMin,
    chips: seedChips,
    dataset: ds,
    mode: ds.mode,
    arriveByMin: null, // 마감은 선택 — 기본은 '상관없어요'
    destinationName: null,
    destinationCoord: null,
    originName: null,
    originCoord: null,
    ...deriveFromDataset(ds, departMin),
    options: ds.options,
    selectedOptionId: (ds.options.find(o => o.recommended) ?? ds.options[0]).id,
    optionOverrides: {},
    chat: seed ? [ds.userMessage] : [],
    failNext: false,
    devAnyCongestion: false, // 개발 토글. 실사용 기본값은 꺼짐(docs/NEXT.md)
    recalcPending: false,
    planConfirmed: false,
    congestionReport: null,
    passedCount: 0,
    atStop: false,
    arrivedAtDest: false,
    stopCount: null,
  };
}

/** 칩의 검색어를 데이터셋 풀의 경유지에 맞춘다.
    실제 서버에서는 이 자리가 카카오 로컬 검색 결과가 된다 */
function stopsForChips(ds: Dataset, chips: IntentChip[]): StopState[] {
  const pool = [...ds.stops, ...(ds.extraStops ?? [])];
  const used = new Set<string>();
  const out: StopState[] = [];
  for (const chip of chips) {
    if (chip.kind !== 'stop') continue;
    const hit = pool.find(p => !used.has(p.id) && chip.queries.some(q => p.name.includes(q) || p.category === q));
    if (!hit) continue; // 못 찾은 건 칩만 남는다 — 사용자가 보고 지울 수 있다
    used.add(hit.id);
    out.push(asStopState(hit));
  }
  return out;
}

/** 채팅에서 지정한 개수만큼 경유지를 뽑는다 (목 데이터 전용) */
function stopsForCount(ds: Dataset, count: number): StopState[] {
  const pool = [...ds.stops, ...(ds.extraStops ?? [])];
  return pool.slice(0, Math.max(0, Math.min(pool.length, count))).map(asStopState);
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

/** 액션 이름을 밖에서도 쓴다 — actionLog.ts 가 이걸 로그 한 줄로 옮긴다 */
export type PlanAction =
  | { type: 'SET_DATASET'; key: string }
  | { type: 'SET_MODE'; mode: PlanState['mode'] }
  | { type: 'SET_ARRIVE_BY'; min: number | null }
  | { type: 'SET_DESTINATION'; name: string; coord: LatLng | null }
  | { type: 'SET_ORIGIN'; name: string | null; coord: LatLng | null }
  | { type: 'SWAP_ENDPOINTS'; myLocation: LatLng | null }
  | { type: 'APPLY_OPTION'; id: string }
  | { type: 'APPLY_LIVE'; payload: ApplyLivePayload }
  | { type: 'SELECT_OPTION'; id: string }
  | { type: 'SET_OPTION_STORE'; optionId: string; baseId: string; candidateId: string }
  | { type: 'REORDER_LOCAL'; stops: StopState[] }
  | { type: 'REPORT_STOP_CONGESTION'; stopId: string; level: CongestionKey }
  | { type: 'REMOVE_LOCAL'; stopId: string }
  | { type: 'REPLACE_LOCAL'; stopId: string; candidateId: string }
  | { type: 'RECALC' }
  | { type: 'TOGGLE_TASK'; stopId: string; taskId: string }
  | { type: 'UPDATE_TASK'; stopId: string; taskId: string; text: string }
  | { type: 'ADD_TASK'; stopId: string; taskId: string }
  | { type: 'REMOVE_TASK'; stopId: string; taskId: string }
  | { type: 'SET_FAIL_NEXT'; value: boolean }
  | { type: 'SET_DEV_ANY_CONGESTION'; value: boolean }
  | { type: 'SET_CONGESTION'; value: string | null }
  | { type: 'CONFIRM_PLAN' }
  | { type: 'ARRIVE_AT_STOP' }
  | { type: 'DEPART_STOP' }
  | { type: 'ARRIVE_AT_DESTINATION' }
  | { type: 'SET_STOP_COUNT'; count: number }
  /* `source` 는 상태로 가지 않는다 — 행동 로그만 읽는다(actionLog.ts). 안 실어 보내는
     호출부가 있어도 되게 optional 이다 */
  | { type: 'APPLY_INTENT'; intent: Intent; source?: ExtractSource }
  | { type: 'REMOVE_CHIP'; id: string }
  | { type: 'NARROW_STOP'; chipId: string; query: string }
  | { type: 'PUSH_CHAT'; text: string }
  /** A2에서 뒤로 나갈 때 — 대화와 대화가 만든 것을 전부 버리고 진입 시점 조건으로 되돌린다 */
  /* `committed` — 이 대화가 이미 확정 계획이 됐는가. 스토어가 아니라 **액션이 나른다.**
     `applyLive` 와 `navigation.reset` 이 같은 틱에 돌아서, 그때 상태를 읽는 쪽(로그의
     `stateRef`, 화면의 리스너 클로저)은 아직 APPLY_LIVE 이전을 본다. 한 곳에서 동기적으로
     정하고 실어 보내야 리듀서와 로그가 같은 사실을 읽는다 */
  | { type: 'RESET_CHAT'; mode: PlanState['mode']; arriveByMin: number | null; committed: boolean };

/* 테스트가 부를 수 있게 내보낸다 — plan.tsx 는 react-native 를 물어 node 로 그냥은
   못 읽는다. 스텁을 끼워 읽는 쪽은 plan.test.ts 에 있다(그쪽 주석 참고) */
export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'SET_DATASET': {
      const ds = datasets.find(d => d.key === action.key) ?? datasets[0];
      return initState(ds, true); // 개발 메뉴에서 고른 것이므로 예시를 깐다
    }
    /* 스칼라만 바꾸면 A2 의 칩이 옛 값을 말한다 — 헤더는 '대중교통', 칩은 '자동차'.
       이 앱은 알아들은 것을 칩으로 드러내는 게 원칙이라 칩이 틀리면 원칙이 무너진다 */
    case 'SET_MODE':
      return {
        ...state,
        mode: action.mode,
        chips: syncConditionChips(state.chips, { mode: action.mode, arriveByMin: state.arriveByMin }, k => `${k}-${chipSeq++}`),
      };
    case 'SET_ARRIVE_BY':
      return {
        ...state,
        arriveByMin: action.min,
        chips: syncConditionChips(state.chips, { mode: state.mode, arriveByMin: action.min }, k => `${k}-${chipSeq++}`),
      };
    case 'SET_DESTINATION':
      return { ...state, destinationName: action.name, destinationCoord: action.coord };
    case 'SET_ORIGIN':
      return { ...state, originName: action.name, originCoord: action.coord };
    case 'SWAP_ENDPOINTS': {
      /*
        출발지가 '내 위치'면 넘길 이름이 없어 목적지가 비어버린다.
        그때는 지금 있는 곳을 목적지로 굳힌다 — '여기로 돌아오기'가 실제 의도다.
      */
      const fromMyLocation = state.originName == null;
      return {
        ...state,
        originName: state.destinationName,
        originCoord: state.destinationCoord,
        destinationName: fromMyLocation ? '내 위치' : state.originName,
        destinationCoord: fromMyLocation ? action.myLocation : state.originCoord,
      };
    }
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
    case 'APPLY_LIVE': {
      const { stops, dataset, departMin, selectedOptionId } = action.payload;
      return {
        ...state,
        dataset,
        options: dataset.options,
        selectedOptionId,
        optionOverrides: {},
        stopCount: null,
        planConfirmed: true,
        departMin,
        /* 진행 상태는 새 계획 것으로 되돌린다 — 안 되돌렸더니 "새로 계획하기"로 갈아엎어도
           진행중 탭이 옛 진행률을 말했다(arrivedAtDest 가 남아 도착한 척, passedCount 가
           남아 앞 두 곳을 이미 지난 척).
           '새 계획'과 '다시 계산'을 가르지 않는다: passedCount 는 stops 의 인덱스인데
           여기서 stops 는 toLegacyPlan 이 새 결과로 처음부터 만든 배열이다 — 옛 번호를
           그대로 얹는 건 진행을 잇는 게 아니라 다른 목록에 남의 번호를 찍는 것이다.
           게다가 다시 계산은 이미 들른 곳의 칩을 소비하지 않아(도착해도 chips 는 그대로다)
           그곳을 또 들르는 계획을 내놓는다 — 그 계획 기준으로도 0 이 맞는 답이다.
           방문한 곳을 빼고 이어서 계산하려면 그건 usePlanRequest·runPlan 의 일이지
           리듀서가 숫자로 흉내낼 일이 아니다 */
        passedCount: 0,
        atStop: false,
        arrivedAtDest: false,
        ...computeChain(stops, dataset, departMin),
      };
    }
    case 'APPLY_OPTION': {
      const option = state.options.find(o => o.id === action.id) ?? state.options[0];
      const overrides = state.optionOverrides?.[option.id] ?? {};
      const base =
        state.stopCount == null ? stopsForOption(state.dataset, option) : stopsForCount(state.dataset, state.stopCount);
      const stops = base.map(s => {
        const overrideId = overrides[s.baseId];
        if (!overrideId) return s;
        const cands = state.dataset.candidates[s.baseId] ?? [];
        const cand = cands.find(c => c.id === overrideId);
        return cand ? applyCandidate(s, cand, cands) : s;
      });
      const recommendedId = (state.dataset.options.find(o => o.recommended) ?? state.dataset.options[0]).id;
      const untouched =
        state.stopCount == null && option.id === recommendedId && Object.keys(overrides).length === 0;
      // 계획을 확정하는 그 순간이 출발 시각이다
      const depart = nowMin();
      return {
        ...state,
        selectedOptionId: option.id,
        planConfirmed: true,
        departMin: depart,
        // 여기도 stops 를 처음부터 다시 만든다 — 확정이면 진행 상태도 새 계획 것이다(근거는 APPLY_LIVE)
        passedCount: 0,
        atStop: false,
        arrivedAtDest: false,
        ...(untouched
          ? deriveFromDataset(state.dataset, depart)
          : computeChain(stops, state.dataset, depart)),
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
      const next = computeChain(state.stops, state.dataset, state.departMin);
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
    case 'SET_DEV_ANY_CONGESTION':
      return { ...state, devAnyCongestion: action.value };
    case 'SET_CONGESTION':
      return { ...state, congestionReport: action.value };
    case 'REPORT_STOP_CONGESTION': {
      /* 가 본 곳에서만 받는다 — 체류 중이거나 이미 지나온 곳.
         화면에서도 막지만, 여기서 한 번 더 막아야 다른 경로로 들어와도 오제보가 안 생긴다.
         판단은 hasVisitedStop 한 곳에서 한다 — 화면과 조건이 어긋나면 제보가 조용히 버려진다 */
      const idx = state.stops.findIndex(s => s.id === action.stopId);
      if (!hasVisitedStop(idx, state.passedCount, state.atStop) && !state.devAnyCongestion) return state;
      const stops = state.stops.map(s =>
        s.id === action.stopId ? { ...s, congestion: action.level } : s,
      );
      return { ...state, stops };
    }
    case 'CONFIRM_PLAN':
      return state.planConfirmed ? state : { ...state, planConfirmed: true };
    case 'ARRIVE_AT_STOP':
      return { ...state, atStop: true };
    case 'DEPART_STOP':
      return { ...state, atStop: false, passedCount: Math.min(state.stops.length, state.passedCount + 1) };
    case 'ARRIVE_AT_DESTINATION':
      return state.arrivedAtDest ? state : { ...state, arrivedAtDest: true };
    case 'APPLY_INTENT': {
      const it = action.intent;
      if (it.reject) return state; // 길찾기와 무관한 말은 계획을 건드리지 않는다

      /* v3 — 제거와 추가가 한 문장에 섞일 수 있다.
         '올리브영 대신 이마트'가 remove + add 두 항목으로 온다 */
      let chips: IntentChip[] = it.resetStops ? [] : state.chips.filter(c => c.kind === 'stop');
      for (const st of it.stops) {
        if (st.op === 'remove') {
          chips = chips.filter(c => !(c.kind === 'stop' && c.queries.some(q => st.queries.includes(q))));
          continue;
        }
        for (let k = 0; k < Math.max(1, st.count); k++) {
          chips.push({
            id: `s-${chipSeq++}`, kind: 'stop', label: st.queries[0], queries: st.queries,
            stopKind: st.kind, openNow: st.openNow, flexible: st.flexible, why: st.why, near: st.near,
          });
        }
      }
      const keep: IntentChip[] = chips.filter(c => c.kind === 'stop');
      const arriveBy = it.arriveBy ?? state.arriveByMin;
      const mode = it.mode ?? state.mode;
      if (arriveBy != null) {
        keep.push({ id: `a-${chipSeq++}`, kind: 'arriveBy', label: `${toHHMM(arriveBy).padStart(5, '0')}까지`, value: arriveBy });
      }
      const stops = stopsForChips(state.dataset, keep);
      /* 출발지·목적지 변경 — 좌표를 아는 곳일 때만 적용한다.
         이름만 바꾸면 경로를 못 그린다(예전 '입력한 대로 설정'이 그래서 빠졌다) */
      const known = RECENT_DESTINATIONS;
      const pick = (name?: string) =>
        name ? known.find(r => r.name.includes(name) || name.includes(r.name)) : undefined;
      const nextDest = pick(it.endpoints.destination);
      const nextOrigin = pick(it.endpoints.origin);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return {
        ...state,
        chips: keep,
        arriveByMin: arriveBy,
        mode,
        stopCount: stops.length,
        optionOverrides: {},
        ...(nextDest ? { destinationName: nextDest.name, destinationCoord: nextDest.coord } : null),
        ...(nextOrigin ? { originName: nextOrigin.name, originCoord: nextOrigin.coord } : null),
        ...computeChain(stops, state.dataset, state.departMin),
      };
    }
    case 'NARROW_STOP': {
      // 좁히는 규칙(라벨·queries·stopKind) 자체는 chips.ts 의 narrowStopChips 가 갖는다 —
      // plan.tsx 런타임(react-native)을 물지 않는 곳에 둬야 node 테스트가 직접 부를 수 있다.
      const chips = narrowStopChips(state.chips, action.chipId, action.query);
      if (chips === state.chips) return state; // 없는 칩 — 애니메이션도 재계산도 돌릴 이유가 없다
      // chips 를 바꾸는 것만으로 끝나지 않는다 — stopsForChips(dataset, chips) 가
      // chip.queries 로 데이터셋 경유지를 다시 매칭하므로, queries 를 좁히면 매칭되는
      // 경유지 자체가 바뀐다. REMOVE_CHIP 과 같은 모양으로 stops·체인을 다시 계산한다.
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const stops = stopsForChips(state.dataset, chips);
      return {
        ...state,
        chips,
        stopCount: stops.length,
        ...computeChain(stops, state.dataset, state.departMin),
      };
    }
    case 'REMOVE_CHIP': {
      const chip = state.chips.find(c => c.id === action.id);
      if (!chip) return state;
      const chips = state.chips.filter(c => c.id !== action.id);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const patch = chip.kind === 'arriveBy' ? { arriveByMin: null } : {};
      const stops = stopsForChips(state.dataset, chips);
      return {
        ...state,
        ...patch,
        chips,
        stopCount: stops.length,
        ...computeChain(stops, state.dataset, state.departMin),
      };
    }
    case 'SET_STOP_COUNT': {
      /* 목 데이터로 개수별 화면을 보기 위한 것. 실제 최적 순서 계산이 아니다 —
         그건 구간별 실제 소요시간이 있어야 하고, 그 API 키는 서버에 있어야 한다 */
      const stops = stopsForCount(state.dataset, action.count);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return {
        ...state,
        stopCount: stops.length,
        optionOverrides: {},
        ...computeChain(stops, state.dataset, state.departMin),
      };
    }
    case 'PUSH_CHAT':
      return { ...state, chat: [...state.chat, action.text] };
    case 'RESET_CHAT': {
      /* 대화가 만든 것을 전부 되돌린다 — 경유지 칩뿐 아니라 APPLY_INTENT 가 바꿨을
         수 있는 도착 시각·이동수단까지. 칩만 지우고 조건을 남기면 "대화를 지웠다"고
         해놓고 대화의 흔적이 남는다. 되돌릴 값은 A2에 들어온 시점의 조건이고,
         그건 화면(PlanScreen)이 진입할 때 잡아 둔다 — 스토어는 그 스냅샷을 모른다.
         목적지·출발지는 A1에서 고른 것이라 건드리지 않는다 */
      const chips = resetChatChips(
        state.chips,
        { mode: action.mode, arriveByMin: action.arriveByMin },
        k => `${k}-${chipSeq++}`,
        action.committed,
      );
      // 같은 참조 = 확정된 계획이다. 기록만 비우고 칩·조건·경유지는 그대로 둔다
      if (chips === state.chips) return { ...state, chat: [] };
      const stops = stopsForChips(state.dataset, chips);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return {
        ...state,
        chat: [],
        chips,
        mode: action.mode,
        arriveByMin: action.arriveByMin,
        stopCount: stops.length,
        optionOverrides: {},
        ...computeChain(stops, state.dataset, state.departMin),
      };
    }
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
  /** 출발지 지정. null을 주면 다시 '내 위치'(GPS)로 돌아간다 */
  setOrigin: (name: string | null, coord?: LatLng | null) => void;
  /** 출발지 ↔ 목적지 맞바꾸기 */
  swapEndpoints: () => void;
  /** 표시용 목적지 이름 (미지정이면 데이터셋 값) */
  destinationDisplay: string;
  /** 표시용 출발지 이름 — GPS를 잡았으면 '내 위치'. 목 데이터셋 이름이 새어 나가지 않게 한 곳에서 만든다 */
  originDisplay: string;
  /** 출발 시각 표시 — 목 데이터가 아니라 계획을 확정한 시각 */
  departAtLabel: string;
  /** 선택 가능한 도착 시각 옵션 (30분 단위) */
  arriveByOptions: number[];
  selectOption: (id: string) => void;
  applyOption: (id: string) => void;
  /** 확정 경계 — planFlowBridge.toLegacyPlan()이 만든 결과를 기존 스토어에 적용한다 */
  applyLive: (payload: ApplyLivePayload) => void;
  setOptionStore: (optionId: string, baseId: string, candidateId: string) => void;
  reorderStops: (stops: StopState[]) => void;
  removeStop: (stopId: string) => void;
  replaceStop: (stopId: string, candidateId: string) => void;
  toggleTask: (stopId: string, taskId: string) => void;
  updateTask: (stopId: string, taskId: string, text: string) => void;
  addTask: (stopId: string, taskId: string) => void;
  removeTask: (stopId: string, taskId: string) => void;
  setFailNext: (value: boolean) => void;
  setDevAnyCongestion: (value: boolean) => void;
  setCongestionReport: (value: string | null) => void;
  /** 경유지 혼잡도 제보 — 도착해 체류 중인 경유지에만 먹는다 */
  reportStopCongestion: (stopId: string, level: CongestionKey) => void;
  /** 확정 상태로 표시 — A6(최종 경로)에 들어왔다는 건 계획이 있다는 뜻 */
  confirmPlan: () => void;
  arriveAtStop: () => void;
  departStop: () => void;
  arriveAtDestination: () => void;
  /** 목 데이터 경유지 개수 변경 — 채팅에서 'N개'를 말했을 때 */
  setStopCount: (count: number) => void;
  applyIntent: (intent: Intent, source?: ExtractSource) => void;
  removeChip: (id: string) => void;
  /** 되묻기 선택지를 골랐을 때 — 그 경유지의 검색어를 고른 값 하나로 좁힌다 */
  narrowStop: (chipId: string, query: string) => void;
  pushChat: (text: string) => void;
  /** A2를 대화 전으로 되돌린다. `entry`는 A2에 들어온 시점의 조건 — 화면이 잡아서 넘긴다 */
  resetChat: (entry: { mode: PlanState['mode']; arriveByMin: number | null }) => void;
  arriveByLabel: string;
};

const PlanContext = createContext<PlanApi | null>(null);

const RECALC_DELAY = 600;

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(planReducer, datasets[0], initState);
  const here = useCurrentPlace();
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  /* 대화가 확정 계획이 됐는지. 상태가 아니라 ref 인 이유는 `PlanAction`의 RESET_CHAT
     주석에 있다 — 같은 틱 안에서 읽혀야 한다 */
  const chatCommitted = useRef(false);

  /**
   * 리듀서가 아니라 dispatch 를 감싼다 — 리듀서는 순수해야 하고, StrictMode 가 개발 중
   * 두 번 부르므로 안에서 로그를 남기면 줄이 두 배가 된다. 액션은 전부 여기를 지나므로
   * 화면이 늘어도 로그가 빠지지 않는다.
   */
  const dispatch = useCallback((action: PlanAction) => {
    const log = describePlanAction(action, stateRef.current);
    if (log) logTrack({ k: 'act', a: log.a, d: log.d });
    rawDispatch(action);
  }, []);

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
      setOrigin: (name, coord) => dispatch({ type: 'SET_ORIGIN', name, coord: coord ?? null }),
      swapEndpoints: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'SWAP_ENDPOINTS', myLocation: here.coord });
      },
      destinationDisplay: state.destinationName ?? state.dataset.destination.name,
      /*
        출발지 이름 — 직접 고른 곳이 없으면 지금 있는 곳의 짧은 주소를 쓴다.
        `내 위치`는 라벨이지 장소가 아니라, 일정 순서에서 아래 행들(가맹점명)과 종류가 다르다.
        주소를 아직 못 받았으면 그때만 `내 위치`로 버틴다 — 빈칸을 두는 것보다 낫다.
      */
      originDisplay:
        state.originName ?? (here.coord ? here.shortAddress ?? '내 위치' : state.dataset.origin.name),
      departAtLabel: toHHMM(state.departMin).padStart(5, '0'),
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
      applyLive: payload => {
        chatCommitted.current = true;
        dispatch({ type: 'APPLY_LIVE', payload });
      },
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
      setDevAnyCongestion: value => dispatch({ type: 'SET_DEV_ANY_CONGESTION', value }),
      setCongestionReport: value => dispatch({ type: 'SET_CONGESTION', value }),
      reportStopCongestion: (stopId, level) => dispatch({ type: 'REPORT_STOP_CONGESTION', stopId, level }),
      confirmPlan: () => dispatch({ type: 'CONFIRM_PLAN' }),
      arriveAtStop: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'ARRIVE_AT_STOP' });
      },
      departStop: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'DEPART_STOP' });
      },
      arriveAtDestination: () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dispatch({ type: 'ARRIVE_AT_DESTINATION' });
      },
      setStopCount: count => dispatch({ type: 'SET_STOP_COUNT', count }),
      applyIntent: (intent, source) => dispatch({ type: 'APPLY_INTENT', intent, source }),
      removeChip: id => dispatch({ type: 'REMOVE_CHIP', id }),
      narrowStop: (chipId, query) => dispatch({ type: 'NARROW_STOP', chipId, query }),
      pushChat: text => {
        // 새 말이 들어오면 다시 '버릴 것'이 생긴다 — 안 내리면 "확정 → 새 대화 → 중간에
        // 나감"에서 버려야 할 경유지 칩이 남는다
        chatCommitted.current = false;
        dispatch({ type: 'PUSH_CHAT', text });
      },
      resetChat: entry =>
        dispatch({ type: 'RESET_CHAT', mode: entry.mode, arriveByMin: entry.arriveByMin, committed: chatCommitted.current }),
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
