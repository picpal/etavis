/**
 * planFlow Context. 공급자 선택은 여기서만 한다:
 *   .env에 SERVER_URL·APP_TOKEN이 있으면 Workers /route, 없으면 목 라우팅(haversine 추정).
 * 장소 검색은 places.ts의 planSearchFn(카카오 키 있으면 카카오, 없으면 목 카탈로그).
 */
import React, { createContext, useContext, useMemo, useReducer, useRef } from 'react';
import Constants from 'expo-constants';
import { planSearchFn } from '../lib/places';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { serverRouteProvider } from '../lib/routePlan/serverProvider';
import type { RouteProvider } from '../lib/routePlan/types';
import { initialPlanFlow, isBusy, planFlowReducer, requestKey, type PlanFlowState, type PlanRequest } from './planFlow';
import { runPlan } from './runPlan';

type PlanFlowApi = {
  state: PlanFlowState;
  start: (request: PlanRequest) => void;
  select: (idx: number) => void;
  setOverride: (optionIdx: number, slotId: string, candidateId: string) => void;
  reset: () => void;
  /** 결과가 있는데 지금 입력과 다르면 true — A5 배너 */
  isStale: (request: PlanRequest) => boolean;
  /** 실측인가 추정인가 — 화면 문구용 */
  usingServer: boolean;
};

const Ctx = createContext<PlanFlowApi | null>(null);

function pickProvider(): { provider: RouteProvider; usingServer: boolean } {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
  const baseUrl = extra.serverUrl?.trim();
  const appToken = extra.appToken?.trim();
  if (baseUrl && appToken) {
    const deviceId = Constants.sessionId ?? 'unknown';
    return { provider: serverRouteProvider({ baseUrl, appToken, deviceId }), usingServer: true };
  }
  return { provider: mockRouteProvider(), usingServer: false };
}

export function PlanFlowProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(planFlowReducer, initialPlanFlow);
  const stateRef = useRef(state);
  stateRef.current = state;
  const deps = useMemo(() => ({ ...pickProvider(), search: planSearchFn() }), []);

  const api = useMemo<PlanFlowApi>(() => ({
    state,
    start: request => {
      const cur = stateRef.current;
      if (isBusy(cur.phase) && cur.request && requestKey(cur.request) === requestKey(request)) return;
      void runPlan(request, { provider: deps.provider, search: deps.search, dispatch });
    },
    select: idx => dispatch({ type: 'SELECT_OPTION', idx }),
    setOverride: (optionIdx, slotId, candidateId) => dispatch({ type: 'SET_OVERRIDE', optionIdx, slotId, candidateId }),
    reset: () => dispatch({ type: 'RESET' }),
    isStale: request => !!state.request && requestKey(state.request) !== requestKey(request),
    usingServer: deps.usingServer,
  }), [state, deps]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlanFlow(): PlanFlowApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlanFlow must be used within PlanFlowProvider');
  return ctx;
}
