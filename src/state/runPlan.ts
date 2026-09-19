/**
 * 계획 파이프라인 — 직행 실측 → 슬롯별 회랑 검색 → plan(). 액션을 순서대로 보낸다.
 * 예외를 밖으로 던지지 않는다. 실패는 전부 FAIL 액션이다.
 * 의존(공급자·검색·dispatch)을 주입받아 목으로 시험한다.
 */
import { initialRadiusM, maxRadiusM, searchAlong, searchAtAnchors, ANCHOR_MAX_M, type SearchFn } from '../lib/corridorSearch';
import { plan } from '../lib/routePlan/plan';
import type { NearSide, PlaceCandidate, RouteProvider, RouteResult, Slot } from '../lib/routePlan/types';
import { extractAnchors, type Anchor } from '../lib/routePlan/anchors';
import type { PlanFlowAction, PlanRequest } from './planFlow';
import { applyParkingPolicy } from '../lib/parkingPolicy';
import { applyNear, decideNear } from '../lib/nearSide';
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
/**
 * 실측 단계에 남겨 둘 예산의 몫. 검색이 이걸 파고들면 반경 사다리를 멈춘다
 * (`corridorSearch.canWiden`).
 *
 * 실측 2026-09-19: 슬롯 2개·실측 8회가 4.1초였는데 검색이 9.8초까지 끌어 2.2초만
 * 남겼다 — 후보를 다 들고도 FAIL('timeout')로 끝났다. 0.5 면 그 회차가 6.6초에
 * 멈춰 5.4초를 남긴다. 아래 검색어 폴백이 쓰는 몫과 같은 값이다 — 둘 다 "남은
 * 예산의 절반을 넘겼으면 더 안 쓴다"는 같은 규칙이라 숫자를 갈라 둘 이유가 없다.
 */
const MEASURE_RESERVE = 0.5;
/** 슬롯당 후보 상한. 플래너는 추정만 하므로 늘려도 /route 호출은 안 는다 */
const MAX_CANDIDATES = 30;
/** 후보가 이보다 적으면 보강해도 순서가 안 바뀐다 */
const ENRICH_MIN_CANDIDATES = 4;
/** 마감이 없을 때, 트렌드 1위로 바꾸며 허용하는 추가시간 */
const TREND_SWAP_SLACK_MIN = 10;
/** 슬롯당 확보 목표. 설계 0.5단계의 Kc. 이만큼 모일 때까지 회랑 반지름을 넓힌다 —
    후보가 적으면 추천 점수도 교체 시트도 의미가 없다. short 판정은 count 기준이라 별개 */
export const KC = 8;

/**
 * 보강 뒤에 남겨 둬야 하는 플래너 라우팅 몫. 플래너는 실측을 최대 9회 부른다
 * (대중교통은 구간마다 쪼개져 최대 10회지만 한 번의 Promise.all 로 나가므로 벽시계는 1회분이다).
 * 실측 p95 를 재서 교체해야 한다 — NEXT.md 에 이월했다.
 */
const PLANNER_RESERVE_MS = 3_500;
/** 예산 계산의 여유분 — 계산 시점과 실제 호출 사이의 틈 */
const ENRICH_SAFETY_MS = 500;
/** 보강 단계 전체 상한. 남은 시간이 아무리 많아도 이보다 오래 쓰지 않는다 */
const ENRICH_CAP_MS = 5_000;
/**
 * 슬롯 하나가 쓸 만한 결과를 받으려면 최소 이만큼은 있어야 한다.
 *
 * 유도(2026-09-13 실측): 서버는 받은 예산에서 구글 몫 1.8초를 떼고 나머지를 블로그에
 * 준다. 네이버 호출 하나가 1.7초이므로 블로그 몫이 1.9초는 돼야 한 회차가 끝난다
 * → 서버 예산 ≥ 3.7초. 여기에 서버 오버헤드 여유(SERVER_MARGIN_MS 0.7초)를 더해 4.4초다.
 *
 * 이보다 적게 주면 한 건도 못 받는다 — 예전 값(0.8초)으로는 업종 슬롯이 2개일 때
 * 슬롯당 2.5초씩 나눠 갖고 **둘 다 빈 결과**였다(로그: budgetMs=2500 results=0).
 */
const ENRICH_MIN_SLOT_MS = 4_400;

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

/**
 * 사용자가 이미 정한 가게를 후보 맨 앞으로 올린다. **검색을 막지 않는다 — 고르기만 막는다.**
 *
 * 검색·`applyNear`·`/enrich` 를 전부 그대로 태운 **뒤에** 부른다. 그래야
 * 매장 교체 시트에 대안이 남고(`KC=8`), 보강이 돌아 "영업 중"이 근거를 갖고,
 * `near`·`searchStatus` 가 실제로 일어난 일을 적는다. 검색을 건너뛰면 이 셋이 전부 깨진다.
 *
 * **id 를 지어내지 않는다.** `enumerate` 가 후보 id 로 중복 방문을 막으므로
 * (`enumerate.ts:37`), 같은 가게는 어디서 와도 같은 id 여야 한다. 그래서 `fixed.placeId`
 * 는 필수고, 검색이 못 찾았을 때도 그 id 를 그대로 쓴다.
 *
 * @param ranked 이 슬롯이 실제로 쓸 후보(주차·near·상한을 다 통과한 것)
 * @param searched 필터 전 검색 결과. 걸러진 고정을 **원본 그대로** 되살리려고 본다 —
 *                 요청에 실린 이름·좌표로 다시 세우면 영업시간·주소를 잃는다
 */
function pinFixed(
  ranked: PlaceCandidate[],
  searched: PlaceCandidate[],
  fixed: PlanRequest['stops'][number]['fixed'],
): { candidates: PlaceCandidate[]; fixed?: Slot['fixed'] } {
  if (!fixed) return { candidates: ranked };
  const inRanked = ranked.find(c => c.id === fixed.placeId);
  if (inRanked) {
    return {
      candidates: [inRanked, ...ranked.filter(c => c !== inRanked)],
      fixed: { placeId: fixed.placeId, source: 'search' },
    };
  }
  const filtered = searched.find(c => c.id === fixed.placeId);
  if (filtered) {
    return { candidates: [filtered, ...ranked], fixed: { placeId: fixed.placeId, source: 'filtered' } };
  }
  // 검색이 못 줬다 — 요청에 실린 것만으로 세운다. hours·signals 가 없으니 화면은
  // 영업 여부를 모른다고 말하고(`score.ts` 의 hours 없음 경로), 트렌드 점수도 안 붙는다
  return {
    candidates: [{ id: fixed.placeId, name: fixed.name, coord: fixed.coord }, ...ranked],
    fixed: { placeId: fixed.placeId, source: 'request' },
  };
}

class Timeout extends Error {}

export async function runPlan(request: PlanRequest, deps: RunPlanDeps): Promise<void> {
  const { provider, search, dispatch } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedMs = Date.now();
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
    // 대중교통이면 실제 정류장이 앵커다. 공급자가 itinerary 를 안 줬으면(추정 폴백)
    // 앵커도 없다 — 그때는 지금까지처럼 회랑으로 찾는다
    const itinerary = request.mode === 'transit' ? direct.transit?.[0] : undefined;
    const anchors: Anchor[] = itinerary ? extractAnchors(itinerary, request.origin, request.destination) : [];
    let slots: Slot[];
    try {
      // 같은 검색어를 쓰는 슬롯이 몇 개인가 — "편의점 두 곳"은 칩을 복제해 슬롯 둘로 온다.
      // near 가 형제 수보다 적게 남기면 enumerate 가 서로 다른 후보를 못 골라 계획이 통째로 빈다
      const siblings = new Map<string, number>();
      for (const s of request.stops) {
        const k = s.queries.join('|');
        siblings.set(k, (siblings.get(k) ?? 0) + Math.max(1, s.count));
      }
      // 방향을 먼저 전부 정한다. 검색이 side 를 받아야 하고(§5), 같은 near 를 가진
      // 형제 수를 세려면(§10) 슬롯 하나만 보고는 알 수 없다
      const decided = request.stops.map(st => ({
        st,
        near: decideNear(st.near, request.mode, {
          loadBefore: st.loadBefore ?? 'none',
          loadAfter: st.loadAfter ?? 'none',
          needWhen: st.needWhen ?? 'unknown',
        }),
      }));
      // 같은 near 를 가진 슬롯 수. 기존 siblings 는 같은 '검색어'만 세는데,
      // 검색어가 달라도("마트"·"약국") 같은 쪽 끝을 나눠 가져야 하는 건 같다
      const byNear = new Map<NearSide, number>();
      for (const d of decided) {
        if (d.near === 'any') continue;
        byNear.set(d.near, (byNear.get(d.near) ?? 0) + Math.max(1, d.st.count));
      }
      const settled = await race(Promise.allSettled(decided.map(async ({ st, near }) => {
        const nearSource: 'stated' | 'inferred' | 'none' =
          near === 'any' ? 'none' : st.near === 'start' || st.near === 'end' ? 'stated' : 'inferred';
        const need = Math.max(1, st.count);
        const target = Math.max(st.count, KC);

        /* 반경을 한 회차 더 넓힐 시간이 있나. 슬롯들이 이 클로저를 공유한다 —
           예산은 슬롯별이 아니라 계획 전체의 것이다 */
        const canWiden = () => timeoutMs - (Date.now() - startedMs) > timeoutMs * MEASURE_RESERVE;

        const runSearch = async (query: string) => {
          const corridor = () => searchAlong(
            poly, query,
            {
              need, target,
              initialRadiusM: initialRadiusM(request.mode),
              maxRadiusM: maxRadiusM(request.mode, slack, rho),
              side: near, origin: request.origin, destination: request.destination,
              canWiden,
            },
            search,
          );
          // 앵커가 있으면 역 주변부터. 한 곳도 없으면 오늘 나오던 후보까지 잃지 않게 회랑으로 떨어진다
          let r = anchors.length > 0
            ? await searchAtAnchors(anchors, query, {
                need, target,
                maxRadiusM: Math.min(ANCHOR_MAX_M, maxRadiusM(request.mode, slack, rho)),
                side: near, origin: request.origin, destination: request.destination,
                canWiden,
              }, search)
            : await corridor();
          if (anchors.length > 0 && r.status === 'none') {
            // 앵커에서 0건이라 회랑으로 다시 찾는다. 호출 수는 더한다 —
            // 이 숫자는 실제로 나간 장소 검색 요청 수를 감사하려고 남기는 것이라
            // 앞의 앵커 조회를 빼고 적으면 로그가 사용량을 축소해서 말한다
            const anchorCalls = r.calls;
            const viaCorridor = await corridor();
            r = { ...viaCorridor, calls: viaCorridor.calls + anchorCalls };
          }
          return r;
        };

        // 검색어 폴백 — LLM이 조건을 섞은 구를 내놓아도(실측: `샌드위치 파는 카페`)
        // 업종어 후보로 넘어가 경유지를 살린다. 호출 수는 모든 시도를 합산한다.
        //
        // queries가 비면(expandQueries(['   '])가 []를 돌려줄 수 있다) 검색 자체를
        // 건너뛴다 — 빈 문자열로 카카오를 부르면 400이 라운드마다(최대 25회) 돌아온다.
        if (st.queries.length === 0) {
          return {
            id: st.id, query: '', stopKind: st.stopKind, why: st.why,
            candidates: [], dwellMin: dwellFor(''),
            count: Math.max(1, st.count), flexible: st.flexible, openNow: st.openNow,
            near, nearRelaxed: false,
            nearSource, nearBefore: 0, nearAfter: 0, nearRadiusM: null, nearRelaxedRaw: false,
            loadBefore: st.loadBefore, loadAfter: st.loadAfter, needWhen: st.needWhen,
            searchStatus: 'none',
            searchRadiusM: 0, searchCalls: 0,
          } satisfies Slot;
        }
        // 시도 후보를 3개로 제한한다 — 후보 하나당 최대 25콜(반지름 4라운드 + far
        // 1라운드, 라운드마다 최대 5점 동시 조회)이 **순차로** 나간다. 상한이 없으면
        // 슬롯당 최악 10후보(LLM 5개 × expandQueries 최대 2배) × 25콜 = 250콜, 순차
        // 라운드 50개가 DEFAULT_TIMEOUT_MS(12초)를 넘겨 계획 전체가 FAIL('timeout')로
        // 끝난다 — 폴백이 살리려던 경유지를 폴백 자체가 죽이는 경로다.
        const queries = st.queries.slice(0, 3);
        let used = queries[0];
        let found = await runSearch(used);
        let calls = found.calls;
        for (const next of queries.slice(1)) {
          if (found.candidates.length > 0) break;
          // 남은 예산의 절반을 넘겼으면 더 시도하지 않는다(아래 보강 단계의
          // remainMs와 같은 패턴) — 슬롯 하나의 폴백이 다른 슬롯·플래너 몫까지 다
          // 먹으면 안 된다. 경유지 하나를 잃는 게 계획 전체를 타임아웃으로 잃는
          // 것보다 낫다.
          const remainMs = timeoutMs - (Date.now() - startedMs);
          if (remainMs < timeoutMs * 0.5) break;
          const retry = await runSearch(next);
          calls += retry.calls;
          used = next;
          found = retry;
        }
        found = { ...found, calls };
        // 전부 0건이면 사용자가 말한 그대로를 보여 준다 —
        // "…는 경로 근처에서 못 찾아 뺐어요"(OptionsScreen)에 찍히는 값이다
        if (found.candidates.length === 0) used = queries[0];

        // 자동차면 주차 없음 제외·가능 우선 — 아는 정보만 거른다(실제 검색은 아직 주차를 모른다).
        // 그다음 near 로 한쪽 끝만 남긴다. 한 곳도 안 남으면 되돌린다 — 0건은 곧 경유지 증발이다
        const parked = applyParkingPolicy(found.candidates, request.mode);
        // 같은 검색어를 쓰는 형제와 같은 near 를 쓰는 형제 중 큰 쪽을 요구한다
        const sameQuery = siblings.get(st.queries.join('|')) ?? 1;
        const sameNear = near === 'any' ? 1 : byNear.get(near) ?? 1;
        const nearNeed = Math.max(sameQuery, sameNear);
        const sided = applyNear(parked, near, request.origin, request.destination, nearNeed);
        const pinned = pinFixed(sided.candidates.slice(0, MAX_CANDIDATES), found.candidates, st.fixed);

        return {
          id: st.id, query: used, stopKind: st.stopKind, why: st.why,
          candidates: pinned.candidates, dwellMin: dwellFor(used),
          // 고정이 있으면 고르기를 닫는다 — enumerate 가 candidates[0] 한 곳만 본다
          count: Math.max(1, st.count), flexible: pinned.fixed ? false : st.flexible, openNow: st.openNow,
          fixed: pinned.fixed,
          near, nearSource,
          // 사용자가 말한 제약이 안 먹었을 때만 사과한다 — 코드가 물성으로 추론한 제약까지
          // 사과하면, 목적지 얘기를 꺼낸 적 없는 사용자에게 "목적지 쪽엔 없어서"라고 말하게 된다
          nearRelaxed: sided.relaxed && (st.near === 'start' || st.near === 'end'),
          nearRelaxedRaw: sided.relaxed,
          nearBefore: parked.length,
          nearAfter: sided.candidates.length,
          nearRadiusM: sided.radiusM,
          loadBefore: st.loadBefore, loadAfter: st.loadAfter, needWhen: st.needWhen,
          searchStatus: found.status,
          searchRadiusM: found.radiusM, searchCalls: found.calls,
        } satisfies Slot;
      })));
      /* 슬롯 하나는 슬롯 하나만큼만 잃는다 — corridorSearch.settleSamples 와 같은 원칙을
         한 층 위에서 다시 올린다.

         왜: 2026-09-19 프로덕션에서 /places 가 503(KV PUT 429)을 내면 settleSamples 가
         한 라운드 표본이 전부 거절될 때 던지는데, 여기가 Promise.all 이라 그 슬롯
         하나가 계획 전체를 FAIL('search')로 죽였다. 멀쩡히 후보를 찾은 다른 슬롯까지
         같이 버렸다. 이 파일이 이미 적어 둔 원칙이다 — 경유지 하나를 잃는 게 계획
         전체를 잃는 것보다 낫다.

         거절된 슬롯은 후보 0개로 **자리를 지킨다.** 자리를 빼면 뒤의 슬롯이 앞으로
         밀려 decided[i] 와 짝이 어긋난다 — settleSamples 가 used[i] 때문에 빈 배열로
         자리를 지키는 것과 같은 함정이다. */
      if (decided.length > 0 && settled.every(r => r.status === 'rejected')) {
        // 전부 거절이면 할 말이 아무것도 없다 — 지금처럼 FAIL('search')로 간다
        throw (settled[0] as PromiseRejectedResult).reason;
      }
      slots = settled.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        const { st, near } = decided[i];
        const query = st.queries[0] ?? '';
        return {
          id: st.id, query, stopKind: st.stopKind, why: st.why,
          candidates: [], dwellMin: dwellFor(query),
          count: Math.max(1, st.count), flexible: st.flexible, openNow: st.openNow,
          near, nearRelaxed: false,
          nearSource: near === 'any' ? 'none' : st.near === 'start' || st.near === 'end' ? 'stated' : 'inferred',
          nearBefore: 0, nearAfter: 0, nearRadiusM: null, nearRelaxedRaw: false,
          loadBefore: st.loadBefore, loadAfter: st.loadAfter, needWhen: st.needWhen,
          // 찾아봤는데 없는 게 아니라 아예 보지 못했다. 'none' 으로 적으면 화면이
          // "경로 근처에서 못 찾아 뺐어요"라고 없는 사실을 말한다
          searchStatus: 'unchecked',
          // 몇 번이 나갔는지는 던진 클로저와 함께 잃었다. 감사 로그가 사용량을
          // 축소해 말하게 되지만, 모르는 수를 지어내는 것보다는 낫다
          searchRadiusM: 0, searchCalls: 0,
        } satisfies Slot;
      });
    } catch (e) {
      if (e instanceof Timeout) throw e;
      dispatch({ type: 'FAIL', error: { kind: 'search', message: String(e) } });
      return;
    }
    // 0.7 보강 — 업종 슬롯만. 실패해도 계획은 계속 간다. 전체 12초 예산에 물려 있어야
    // 한다 — 그래서 race()로 감싼다. 단 데드라인 탈락(Timeout)은 다시 던져 파이프라인이
    // 끝나게 하고, 그 외(개별 슬롯 실패 포함)는 신호 없이 넘어간다.
    //
    // 슬롯은 순차로 부른다(동시 아님). server/src/enrich.ts의 월 예산 카운터는 "먼저
    // 예약 쓰기 → 실제 지출로 정정"인데, 이건 요청이 겹치지 않을 때만 유효하다.
    // 슬롯 N개를 Promise.allSettled로 동시에 보내면 N개 요청이 같은 used를 동시에
    // 읽고 각자 예약·정정하므로 카운터엔 마지막 정정 한 번만 남고 실제로는 N배가
    // 나간다(실효 상한이 900×N이 되는 결함). 순차로 보내면 각 요청이 이전 요청이 쓴
    // 카운터를 보고 예약하므로 카운터가 실제 지출을 그대로 반영한다.
    // 비용은 슬롯 수만큼 지연이 누적되는 것 — 구글 호출을 슬롯 안에서 병렬화(§enrich.ts
    // fix 2)해 상쇄한다.
    if (deps.enrich) {
      const need = slots.filter(s => s.stopKind === 'category' && s.candidates.length >= ENRICH_MIN_CANDIDATES);
      // 슬롯당 시간은 파이프라인 잔여 예산에서 계산한다. 고정값을 쓰면 슬롯이 늘 때
      // 그대로 곱해져 12초 예산을 넘긴다 — 슬롯 3개 × 8초면 24초다.
      const remainMs = timeoutMs - (Date.now() - startedMs);
      const enrichBudgetMs = Math.min(ENRICH_CAP_MS, remainMs - PLANNER_RESERVE_MS - ENRICH_SAFETY_MS);
      // 예산을 슬롯 수로 미리 나누지 않는다. 나누면 어느 슬롯도 한 건을 못 끝낸다 —
      // 실측(2026-09-13)에서 슬롯 2개가 각 2.5초를 받고 둘 다 빈 결과였다.
      // 대신 슬롯마다 '그 시점에 남은 예산 전부'를 준다. 캐시가 더워 빨리 끝나면
      // 다음 슬롯이 나머지를 쓰고, 콜드라 다 쓰면 다음 슬롯은 건너뛴다.
      // 전부 빈 결과를 받느니 앞 슬롯 하나라도 신호가 붙는 게 낫다.
      const enrichDeadlineMs = Date.now() + enrichBudgetMs;
      if (need.length > 0 && enrichBudgetMs >= ENRICH_MIN_SLOT_MS) {
        try {
          await race((async () => {
            for (const s of need) {
              // 남은 시간으로 한 건도 못 끝낼 바에는 부르지 않는다 — 결과는 버려지는데
              // 네이버·구글 쿼터만 나간다
              const leftMs = enrichDeadlineMs - Date.now();
              if (leftMs < ENRICH_MIN_SLOT_MS) break;
              try {
                const m = await deps.enrich!(s.candidates.map(c => ({
                  id: c.id, name: c.name, address: c.address ?? '',
                  lat: c.coord.latitude, lng: c.coord.longitude,
                })), { timeoutMs: leftMs });
                s.candidates = s.candidates.map(c => (m[c.id] ? { ...c, signals: m[c.id] } : c));
              } catch {
                // 이 슬롯만 신호 없이 남는다 — 나머지 슬롯은 계속 진행한다
              }
            }
          })());
        } catch (e) {
          if (e instanceof Timeout) throw e;
          // 신호가 없을 뿐이다. 화면은 추가시간순으로 떨어진다
        }
      }
    }

    if (anchors.length > 0) {
      dispatch({ type: 'PROGRESS', key: 'search', detail: `앵커 ${anchors.map(a => a.name).join(' → ')}` });
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
    // runningVisits가 그 누적 상태고, 다음 슬롯의 기준선(baseTiming)도 여기서 다시 잰다 —
    // addedMin(scoreTrend용)과 마감 판정(도착 절대시각은 이미 누적이라 그대로 둔다)엔 이게 맞다.
    // 단 "마감 없을 때 총 +10분 이내"는 원래 여행 전체 기준 딱 한 번이어야 한다 — 슬롯마다
    // 직전 슬롯이 이미 늘려놓은 시간을 기준으로 다시 재면 슬롯 N개면 최대 N×10분까지 새는
    // 사고가 난다. 그래서 이 비교만 원본 total(originTotalMin)로 고정해 둔다.
    // 이 블록 전체를 감싼다 — 신호 하나가 이상한 모양으로 와도(server/src/schema.ts
    // 검증을 거치지만 클라이언트 쪽엔 그런 방어선이 없다) scoreTrend의 toFixed 같은
    // 호출이 던지면, 이미 RESULT로 내보낸 멀쩡한 시간 최적 경로까지 바깥 catch가
    // FAIL로 덮어써 버린다. 여기서 삼키면 이미 나간 SET_OVERRIDE(있다면)는 유지한 채
    // 남은 스왑만 건너뛰고 시간 최적 경로가 그대로 선다.
    try {
      const base = result.options[0];
      if (base) {
        const originTotalMin = result.rescore(base.visits).totalMin;
        let runningVisits = base.visits;
        for (const slot of slots) {
          if (slot.stopKind !== 'category') continue;
          // 고정된 슬롯은 건너뛴다. flexible:false 는 곧 "candidates[0] 한 곳"이라는
          // 계약인데(enumerate.ts:7), 여기서 덮어쓰면 사용자가 고른 가게가 트렌드 1위로
          // 조용히 바뀐다 — 고정을 만든 이유가 그것이다
          if (!slot.flexible) continue;
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
              blogQueried: c.signals?.blogQueried,
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
          // t.estimated면 이 타이밍은 실측 leg가 아니라 하버사인 추정이다(SINGLE_R=8 이후
          // 30개 후보 중 상위 8곳 밖은 구조적으로 추정치). 마감 판정을 마진 0 추정치 위에서
          // 내리면 +8분 추정이 실제 +15분일 때 "제시간 도착"이라 말하고 늦게 만든다 —
          // 그래서 추정이면 스왑을 아예 하지 않는다. 시트에서는 여전히 고를 수 있고
          // 이미 "약"·"추정"으로 표시된다.
          const arriveOk = !t.estimated && (request.arriveByMin == null
            ? t.totalMin - originTotalMin <= TREND_SWAP_SLACK_MIN // 여행 전체 기준 — 슬롯마다 다시 재면 안 된다
            : request.departAtMin + t.totalMin <= request.arriveByMin); // 절대 도착시각이라 이미 누적이다

          if (arriveOk) {
            dispatch({ type: 'SET_OVERRIDE', optionIdx: 0, slotId: slot.id, candidateId: cand.id });
            runningVisits = swapped; // 다음 슬롯은 이 스왑이 반영된 상태를 기준으로 잰다
          }
        }
      }
    } catch {
      // 신호 모양이 이상해 스코어링이 죽어도 계획 자체는 이미 RESULT로 나갔다 —
      // 남은 슬롯의 트렌드 스왑만 포기하고 시간 최적 경로를 그대로 둔다.
    }
  } catch (e) {
    if (e instanceof Timeout) dispatch({ type: 'FAIL', error: { kind: 'timeout', message: '12초 안에 끝나지 않았어요' } });
    else dispatch({ type: 'FAIL', error: { kind: 'measure', message: String(e) } });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
