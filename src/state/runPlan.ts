/**
 * 계획 파이프라인 — 직행 실측 → 슬롯별 회랑 검색 → plan(). 액션을 순서대로 보낸다.
 * 예외를 밖으로 던지지 않는다. 실패는 전부 FAIL 액션이다.
 * 의존(공급자·검색·dispatch)을 주입받아 목으로 시험한다.
 */
import { initialRadiusM, maxRadiusM, searchAlong, type SearchFn } from '../lib/corridorSearch';
import { plan } from '../lib/routePlan/plan';
import type { RouteProvider, RouteResult, Slot } from '../lib/routePlan/types';
import type { PlanFlowAction, PlanRequest } from './planFlow';

export type RunPlanDeps = {
  provider: RouteProvider;
  search: SearchFn;
  dispatch: (a: PlanFlowAction) => void;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 12_000;

/** 체류시간 기본값 — 할 일이 생기면 A9에서 바뀐다. 목 데이터와 같은 수준 */
const DWELL: [RegExp, number][] = [
  [/편의점|CU|GS25|세븐일레븐|이마트24/i, 3],
  [/카페|커피|스타벅스|스벅|투썸|메가|컴포즈|빽다방/i, 5],
  [/약국|은행|ATM|우체국|주유소|충전/i, 5],
  [/빵집|베이커리|파리바게뜨|파바|뚜레쥬르/i, 5],
  [/마트|이마트|홈플러스|롯데마트|코스트코|다이소/i, 15],
];
export function dwellFor(query: string): number {
  for (const [re, min] of DWELL) if (re.test(query)) return min;
  return 10;
}

class Timeout extends Error {}

export async function runPlan(request: PlanRequest, deps: RunPlanDeps): Promise<void> {
  const { provider, search, dispatch } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  dispatch({ type: 'START', request });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout('timeout')), timeoutMs);
  });
  const race = <T,>(p: Promise<T>) => Promise.race([p, deadline]);

  try {
    // 0. 직행 — 폴리라인이 회랑 검색과 플래너 둘 다에 필요하다
    let direct: RouteResult;
    try {
      direct = await race(provider.route([request.origin, request.destination], request.departAtMin, request.mode));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'direct', message: String(e) } });
      return;
    }
    dispatch({ type: 'PROGRESS', key: 'direct', detail: `직행 ${Math.round(direct.durationMin)}분` });

    // 0.5 회랑 검색 — 슬롯별 병렬
    const rho = direct.durationMin / Math.max(direct.distanceKm, 0.1);
    const slack = request.arriveByMin == null ? null : request.arriveByMin - request.departAtMin - direct.durationMin;
    const poly = direct.polyline.length >= 2 ? direct.polyline : [request.origin, request.destination];
    let slots: Slot[];
    try {
      slots = await race(Promise.all(request.stops.map(async st => {
        const found = await searchAlong(
          poly, st.query,
          { need: Math.max(1, st.count), initialRadiusM: initialRadiusM(request.mode), maxRadiusM: maxRadiusM(request.mode, slack, rho) },
          search,
        );
        return {
          id: st.id, query: st.query, candidates: found.candidates.slice(0, 8), dwellMin: dwellFor(st.query),
          count: Math.max(1, st.count), flexible: st.flexible, openNow: st.openNow, searchStatus: found.status,
        } satisfies Slot;
      })));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'search', message: String(e) } });
      return;
    }
    dispatch({ type: 'SLOTS', slots });
    dispatch({ type: 'PROGRESS', key: 'search', detail: slots.map(s => `${s.query} ${s.candidates.length}곳`).join(' · ') });

    // 1~6. 플래너
    let result;
    try {
      result = await race(plan(
        { origin: request.origin, destination: request.destination, departAtMin: request.departAtMin,
          arriveByMin: request.arriveByMin ?? undefined, mode: request.mode, slots, order: request.order },
        provider, { direct },
      ));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'measure', message: String(e) } });
      return;
    }
    dispatch({ type: 'PROGRESS', key: 'measure', detail: `실측 ${result.measuredCount}회` });
    dispatch({ type: 'RESULT', result });
  } catch (e) {
    if (e instanceof Timeout) dispatch({ type: 'FAIL', error: { kind: 'timeout', message: '12초 안에 끝나지 않았어요' } });
    else dispatch({ type: 'FAIL', error: { kind: 'measure', message: String(e) } });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
