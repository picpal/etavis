/**
 * planFlow Context. 공급자 선택은 여기서만 한다:
 *   .env에 SERVER_URL·APP_TOKEN이 있으면 Workers /route, 없으면 목 라우팅(haversine 추정).
 * 장소 검색은 places.ts의 planSearchFn(카카오 키 있으면 카카오, 없으면 목 카탈로그).
 */
import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from 'react';
import Constants from 'expo-constants';
import { planSearchFn } from '../lib/places';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import { serverRouteProvider } from '../lib/routePlan/serverProvider';
import type { RouteProvider } from '../lib/routePlan/types';
import { serverEnrichFn, type EnrichFn } from '../lib/enrich/enrichClient';
import { localExtractFn, serverExtractFn, type ExtractFn } from '../lib/intentClient';
import { mockEnrichFn } from '../lib/enrich/mockEnrich';
import { initialPlanFlow, isBusy, planFlowReducer, requestKey, type PlanFlowAction, type PlanFlowState, type PlanRequest } from './planFlow';
import { runPlan } from './runPlan';
import { describeFlowAction } from './actionLog';
import { logTrack, newRunId } from '../lib/trackLog';

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
  /** 채팅 문장 → 의도. 서버가 없거나 죽으면 로컬 목으로 떨어진다(source로 알 수 있다) */
  extract: ExtractFn;
};

const Ctx = createContext<PlanFlowApi | null>(null);

/**
 * 바깥 호출 한 번을 로그로 남긴다. serverProvider·enrichClient 안에서 부르면 안 된다 —
 * 그 둘은 node 테스트가 닿는데 trackLog 는 expo-file-system 을 문다. 여기가 유일한 이음매다.
 *
 * 보강이 왜 비었는지를 로그만 보고 알 수 있어야 한다. 2026-09-13에 그걸 몰라서
 * 서버 지연을 손으로 재며 하루를 썼다.
 */
function timedRoute(provider: RouteProvider): RouteProvider {
  return {
    route: async (points, departAtMin, mode) => {
      const t0 = Date.now();
      try {
        const r = await provider.route(points, departAtMin, mode);
        // 소수점 열두 자리는 읽는 데 방해만 된다 — 로그는 사람이 먼저 읽는다
        logTrack({ k: 'net', ep: '/route', ms: Date.now() - t0, ok: true, d: { points: points.length, mode, min: Math.round(r.durationMin * 10) / 10 } });
        return r;
      } catch (e) {
        logTrack({ k: 'net', ep: '/route', ms: Date.now() - t0, ok: false, d: { points: points.length, mode, err: String(e).slice(0, 120) } });
        throw e;
      }
    },
  };
}

function timedEnrich(enrich: EnrichFn): EnrichFn {
  return async (places, opts) => {
    const t0 = Date.now();
    try {
      const r = await enrich(places, opts);
      const got = Object.values(r);
      logTrack({
        k: 'net', ep: '/enrich', ms: Date.now() - t0, ok: true,
        d: {
          places: places.length,
          budgetMs: opts?.timeoutMs ?? null,
          // 신호가 0이면 '왔는데 비었다'인지 '못 왔다'인지 갈려야 한다
          results: got.length,
          blog: got.filter(v => v.blog).length,
          google: got.filter(v => v.google).length,
        },
      });
      return r;
    } catch (e) {
      logTrack({ k: 'net', ep: '/enrich', ms: Date.now() - t0, ok: false, d: { places: places.length, err: String(e).slice(0, 120) } });
      throw e;
    }
  };
}

/**
 * 서버는 **자동차만** 받는다(`serverProvider.route`가 나머지는 던진다).
 * 그런데 `runPlan`의 0단계 직행은 그 예외를 그대로 `FAIL`로 만들기 때문에,
 * 도보·대중교통을 고르면 **계획 전체가 죽는다.**
 *
 * 키가 없던 시절에는 목 공급자가 모든 모드를 추정으로 처리해 드러나지 않았고,
 * 서버를 붙인 뒤 실기기에서 터졌다(2026-09-15).
 *
 * 그래서 모드로 갈라 준다 — 자동차는 실측, 나머지는 추정.
 * 추정이라는 사실은 화면이 말한다(A5의 "약" 표기).
 */
function hybridProvider(server: RouteProvider, mock: RouteProvider): RouteProvider {
  return {
    route: (points, departAtMin, mode) =>
      (mode === 'car' ? server : mock).route(points, departAtMin, mode),
  };
}

function pickProvider(): { provider: RouteProvider; usingServer: boolean; enrich: EnrichFn; extract: ExtractFn } {
  const extra = (Constants.expoConfig?.extra ?? {}) as { serverUrl?: string; appToken?: string };
  const baseUrl = extra.serverUrl?.trim();
  const appToken = extra.appToken?.trim();
  if (baseUrl && appToken) {
    const deviceId = Constants.sessionId ?? 'unknown';
    return {
      provider: hybridProvider(serverRouteProvider({ baseUrl, appToken, deviceId }), mockRouteProvider()),
      usingServer: true,
      enrich: serverEnrichFn({ baseUrl, appToken, deviceId }),
      extract: serverExtractFn({ baseUrl, appToken, deviceId }),
    };
  }
  return { provider: mockRouteProvider(), usingServer: false, enrich: mockEnrichFn(), extract: localExtractFn() };
}

export function PlanFlowProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(planFlowReducer, initialPlanFlow);
  const stateRef = useRef(state);
  stateRef.current = state;
  const deps = useMemo(() => {
    const picked = pickProvider();
    return {
      ...picked,
      provider: timedRoute(picked.provider),
      enrich: timedEnrich(picked.enrich),
      search: planSearchFn(),
    };
  }, []);

  /**
   * 리듀서가 아니라 dispatch 를 감싼다 — 리듀서는 순수해야 하고, StrictMode 가 개발 중
   * 두 번 부르므로 안에서 로그를 남기면 줄이 두 배가 된다.
   * runPlan 도 이 dispatch 를 받으므로 계획 생명주기가 전부 잡힌다.
   */
  const dispatch = useCallback((action: PlanFlowAction) => {
    // 계획 하나가 여기서 시작한다 — 이후 모든 줄이 이 id 로 묶인다
    if (action.type === 'START') newRunId();
    const log = describeFlowAction(action, stateRef.current);
    if (log) logTrack({ k: 'act', a: log.a, d: log.d });
    rawDispatch(action);
  }, []);

  const api = useMemo<PlanFlowApi>(() => ({
    state,
    start: request => {
      const cur = stateRef.current;
      if (isBusy(cur.phase) && cur.request && requestKey(cur.request) === requestKey(request)) return;
      void runPlan(request, { provider: deps.provider, search: deps.search, enrich: deps.enrich, dispatch });
    },
    select: idx => dispatch({ type: 'SELECT_OPTION', idx }),
    setOverride: (optionIdx, slotId, candidateId) => dispatch({ type: 'SET_OVERRIDE', optionIdx, slotId, candidateId }),
    reset: () => dispatch({ type: 'RESET' }),
    isStale: request => !!state.request && requestKey(state.request) !== requestKey(request),
    usingServer: deps.usingServer,
    extract: deps.extract,
  }), [state, deps]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlanFlow(): PlanFlowApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlanFlow must be used within PlanFlowProvider');
  return ctx;
}
