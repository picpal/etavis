/**
 * 계획 파이프라인 — 직행 실측 → 슬롯별 회랑 검색 → plan(). 액션을 순서대로 보낸다.
 * 예외를 밖으로 던지지 않는다. 실패는 전부 FAIL 액션이다.
 * 의존(공급자·검색·dispatch)을 주입받아 목으로 시험한다.
 */
import { initialRadiusM, maxRadiusM, searchAlong, type SearchFn } from '../lib/corridorSearch';
import { plan } from '../lib/routePlan/plan';
import type { RouteProvider, RouteResult, Slot } from '../lib/routePlan/types';
import type { PlanFlowAction, PlanRequest } from './planFlow';
import { applyParkingPolicy } from '../lib/parkingPolicy';
import type { EnrichFn } from '../lib/enrich/enrichClient';
import { scoreTrend } from '../lib/trendScore';

export type RunPlanDeps = {
  provider: RouteProvider;
  search: SearchFn;
  dispatch: (a: PlanFlowAction) => void;
  timeoutMs?: number;
  /** 후보 보강. 없으면 보강 없이 진행한다 */
  enrich?: EnrichFn;
};

const DEFAULT_TIMEOUT_MS = 12_000;
/** 슬롯당 후보 상한. 플래너는 추정만 하므로 늘려도 /route 호출은 안 는다 */
const MAX_CANDIDATES = 30;
/** 후보가 이보다 적으면 보강해도 순서가 안 바뀐다 */
const ENRICH_MIN_CANDIDATES = 4;
/** 마감이 없을 때, 트렌드 1위로 바꾸며 허용하는 추가시간 */
const TREND_SWAP_SLACK_MIN = 10;

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
          // 자동차면 주차 없음 제외·가능 우선 — 아는 정보만 거른다(실제 검색은 아직 주차를 모른다)
          id: st.id, query: st.query, stopKind: st.stopKind,
          candidates: applyParkingPolicy(found.candidates, request.mode).slice(0, MAX_CANDIDATES), dwellMin: dwellFor(st.query),
          count: Math.max(1, st.count), flexible: st.flexible, openNow: st.openNow, searchStatus: found.status,
        } satisfies Slot;
      })));
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'search', message: String(e) } });
      return;
    }
    // 0.7 보강 — 업종 슬롯만. 실패해도 계획은 계속 간다. 전체 12초 예산에 물려 있어야
    // 한다 — 그래서 race()로 감싼다. 단 데드라인 탈락(Timeout)은 다시 던져 파이프라인이
    // 끝나게 하고, 그 외(개별 슬롯 실패 포함)는 신호 없이 넘어간다.
    if (deps.enrich) {
      const need = slots.filter(s => s.stopKind === 'category' && s.candidates.length >= ENRICH_MIN_CANDIDATES);
      if (need.length > 0) {
        try {
          // allSettled — 슬롯 하나가 실패해도 나머지 슬롯의 신호까지 버리지 않는다
          const settled = await race(Promise.allSettled(need.map(s =>
            deps.enrich!(s.candidates.map(c => ({
              id: c.id, name: c.name, address: c.address ?? '',
              lat: c.coord.latitude, lng: c.coord.longitude,
            }))))));
          need.forEach((s, i) => {
            const r = settled[i];
            if (r.status !== 'fulfilled') return; // 이 슬롯만 신호 없이 남는다
            const m = r.value;
            s.candidates = s.candidates.map(c => (m[c.id] ? { ...c, signals: m[c.id] } : c));
          });
        } catch (e) {
          if (e instanceof Timeout) throw e;
          // 신호가 없을 뿐이다. 화면은 추가시간순으로 떨어진다
        }
      }
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

    // 업종 슬롯에서 트렌드 1위가 시간 1위와 다르면 바꾼다.
    // 단 마감을 넘기면 안 바꾼다 — 추천은 제시간 도착보다 앞설 수 없다.
    // 슬롯이 여럿이면 스왑을 누적한다 — 각자 따로는 마감을 지켜도 합치면 넘길 수 있다.
    // runningVisits가 그 누적 상태고, 다음 슬롯의 기준선(baseTiming)도 여기서 다시 잰다.
    const base = result.options[0];
    if (base) {
      let runningVisits = base.visits;
      for (const slot of slots) {
        if (slot.stopKind !== 'category') continue;
        const idx = runningVisits.findIndex(v => v.slotId === slot.id);
        if (idx < 0) continue;
        const current = runningVisits[idx].candidate.id;
        const baseTiming = result.rescore(runningVisits);

        const ranked = scoreTrend(slot.candidates.map(c => {
          const swapped = runningVisits.map((vv, j) => (j === idx ? { ...vv, candidate: c } : vv));
          const t = result.rescore(swapped);
          return {
            id: c.id,
            addedMin: t.totalMin - baseTiming.totalMin,
            blog: c.signals?.blog ? { weighted: c.signals.blog.weighted } : undefined,
            google: c.signals?.google
              ? { rating: c.signals.google.rating, ratingCount: c.signals.google.ratingCount }
              : undefined,
          };
        }));

        const top = ranked[0];
        if (!top || top.id === current) continue;
        const cand = slot.candidates.find(c => c.id === top.id);
        if (!cand) continue;
        const swapped = runningVisits.map((vv, j) => (j === idx ? { ...vv, candidate: cand } : vv));
        const t = result.rescore(swapped);
        const arriveOk = request.arriveByMin == null
          ? t.totalMin - baseTiming.totalMin <= TREND_SWAP_SLACK_MIN
          : request.departAtMin + t.totalMin <= request.arriveByMin;
        if (arriveOk) {
          dispatch({ type: 'SET_OVERRIDE', optionIdx: 0, slotId: slot.id, candidateId: cand.id });
          runningVisits = swapped; // 다음 슬롯은 이 스왑이 반영된 상태를 기준으로 잰다
        }
      }
    }
  } catch (e) {
    if (e instanceof Timeout) dispatch({ type: 'FAIL', error: { kind: 'timeout', message: '12초 안에 끝나지 않았어요' } });
    else dispatch({ type: 'FAIL', error: { kind: 'measure', message: String(e) } });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
