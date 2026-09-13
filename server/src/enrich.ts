/**
 * /enrich — 후보에 바깥 신호를 붙인다.
 *
 * 여기가 구글 과금을 막는 자리다. 세 겹으로 막는다:
 *   1) 캐시(블로그 24시간, 구글 14일)
 *   2) 슬롯당 상위 10곳만 구글에 묻는다(prescore) — room이 부족하면 순위 그대로 자른다
 *   3) 월 900회 카운터 — 무료분 1,000회 안에서 멈춘다. 호출부(src/state/runPlan.ts)가
 *      계획 하나 안에서 슬롯을 순차로 보강하므로 같은 계획에서 이 엔드포인트가 동시에
 *      여러 번 불리는 일은 없다. 그래도 서로 다른 계획(다른 기기·다른 순간)의 요청은
 *      겹칠 수 있다 — KV엔 compare-and-swap이 없어 그 경우까지 완전한 원자성은 못
 *      얻는다. 쓰기 전에 먼저 예약하고, 끝난 뒤 "내가 방금 쓴 예약이 그대로 남아
 *      있을 때만" 실제 지출로 정정한다 — 그 사이 겹치는 요청이 이미 자기 값을
 *      써 놨으면 손대지 않는다. 자세한 이유는 아래 카운터 코드 주석 참고. 진짜
 *      원자성이 필요하면 Durable Objects로 가야 한다.
 * 콘솔 일일 할당량은 무료 체험판이라 아직 못 걸었다(설계 §9). 그래서 3)이 유일한 코드 방어선이다.
 *
 * 부분 실패는 실패가 아니다. 블로그만 와도 200 이다.
 */
import { parseBudgetMs, parseEnrichRequest, type EnrichPlace } from './enrichSchema';
import { fetchNaverBlog } from './naverBlog';
import { fetchGooglePlace } from './googlePlaces';
import { prescore } from '../../src/lib/trendScore';
import { normalizeName } from '../../src/lib/placeMatch';
import type { BlogSignal, GoogleSignal, PlaceSignals } from './enrichTypes';

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type EnrichEnv = {
  CACHE: KVLike;
  NCP_API_KEY_ID?: string;
  NCP_API_KEY?: string;
  GOOGLE_PLACES_KEY?: string;
};

export type EnrichDeps = { fetch: typeof fetch; now: Date };

const BLOG_TTL_S = 24 * 60 * 60;      // 설계 §2.1.1 — 24시간을 넘기지 않는다
/**
 * 블로그에 물어볼 후보 수.
 *
 * 실측(2026-09-13, 콜드): 1곳 1.7초 · 6곳 1.7초 · 12곳 3.4초. 네이버 호출 하나가
 * 1.7초쯤 걸리고, Workers 는 요청당 동시 바깥 연결이 6개라 7곳부터 회차가 나뉜다.
 * 6곳이 한 회차에 들어가는 최대치다 — 7곳으로 올리면 시간이 두 배가 된다.
 *
 * 30곳을 다 덮으려면 장소마다 묻는 대신 '지역+업종'으로 2~3번 묻고 블로그 글
 * 제목을 후보명과 맞추는 쪽으로 가야 한다. NEXT.md 에 이월했다.
 */
const BLOG_LOOKUP_MAX = 6;
/**
 * 그중 앞에서 그대로 가져가는 수. 나머지는 뒤쪽에서 고르게 뽑는다.
 * 블로그를 부르기 전엔 인기를 모르므로 '인기 상위 N곳'은 원리적으로 불가능하다 —
 * 회랑 거리순 상위만 뽑으면 이 기능이 '가까운 곳 추천'으로 바뀐다. 탐색용 타협이다.
 */
const BLOG_LOOKUP_HEAD = 4;
/**
 * 구글 단계에 남겨 두는 시간. 블로그가 예산을 다 먹으면 구글이 아예 안 불려
 * 추천 카드에 평점이 영영 안 붙는다 — 지금 구조는 블로그가 전부 끝난 뒤에야
 * 구글로 넘어가기 때문이다. 구글 호출도 콜드 기준 1회차 약 1.5초다.
 */
const GOOGLE_RESERVE_MS = 1_800;
/** 예산이 작을 때도 블로그가 최소 이 비율은 갖는다 */
const BLOG_MIN_SHARE = 0.5;
/**
 * 단계에 이보다 적게 남으면 그 단계를 통째로 건너뛴다.
 * 특히 구글은 호출 '전에' 예산을 예약한다 — 끝날 수 없는 호출을 시작하면 결과는
 * 버려지는데 과금과 카운터는 올라간다. 앞 단계나 KV 가 예상보다 오래 걸렸을 때
 * 이 경로로 들어간다.
 */
const PHASE_MIN_MS = 800;

/**
 * 마감까지만 기다리고, 넘기면 fallback 으로 떨어진다.
 * 버려진 호출의 캐시 쓰기는 응답 뒤에 취소될 수 있다 — 다음 요청이 다시 받으면 된다.
 * 예산 카운터는 호출 '전에' 예약하므로 버려진 구글 호출도 지출로 남는다(실제로 나갔다).
 */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback);
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      v => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

/**
 * 블로그에 물어볼 후보의 인덱스. 입력은 회랑 거리순이다.
 * 앞 HEAD 곳 + 나머지 구간에서 고르게 뽑은 나머지.
 */
export function blogShortlist(total: number, take = BLOG_LOOKUP_MAX, head = BLOG_LOOKUP_HEAD): number[] {
  if (total <= take) return Array.from({ length: total }, (_, i) => i);
  const picked = Array.from({ length: head }, (_, i) => i);
  const restCount = take - head;
  const span = total - head;
  for (let k = 0; k < restCount; k++) {
    // 구간 중앙을 집어 양끝으로 치우치지 않게 한다
    const idx = head + Math.floor(((k + 0.5) * span) / restCount);
    picked.push(Math.min(total - 1, idx));
  }
  return [...new Set(picked)];
}
const GOOGLE_TTL_S = 14 * 24 * 60 * 60;
const GOOGLE_MONTHLY_CAP = 900;        // 무료분 1,000 보다 낮게
// 월 키(gbudget:YYYY-MM)는 매달 새로 시작하므로 정확도엔 영향이 없다 — TTL은 그저
// 다음 달로 넘어간 뒤에도 옛 키가 KV에 무한히 쌓이지 않게 한 달을 넉넉히 넘겨 만료시킨다.
const BUDGET_TTL_S = 45 * 24 * 60 * 60;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const p2 = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
const monthOf = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;

async function cached<T>(
  kv: KVLike,
  key: string,
  ttlS: number,
  make: () => Promise<T | null>,
): Promise<T | null> {
  const hit = await kv.get(key);
  if (hit !== null) {
    try {
      const v = JSON.parse(hit) as { v: T | null };
      return v.v;
    } catch {
      /* 캐시가 깨졌으면 새로 받는다 */
    }
  }
  const made = await make();
  // null 도 캐시한다 — 없는 걸 매번 다시 묻지 않는다
  await kv.put(key, JSON.stringify({ v: made }), { expirationTtl: ttlS });
  return made;
}

export async function handleEnrich(
  body: unknown,
  env: EnrichEnv,
  deps: EnrichDeps,
): Promise<Response> {
  const places = parseEnrichRequest(body);
  if (!places) return json({ error: 'bad request' }, 422);

  // 마감은 벽시계로 잰다. deps.now 는 날짜 계산용 고정값이라 경과 시간에 못 쓴다.
  const budgetMs = parseBudgetMs(body);
  const startedMs = Date.now();
  const googleCanRun = Boolean(env.GOOGLE_PLACES_KEY);
  const blogShareMs = googleCanRun
    ? Math.max(Math.round(budgetMs * BLOG_MIN_SHARE), budgetMs - GOOGLE_RESERVE_MS)
    : budgetMs;
  const blogDeadlineMs = startedMs + blogShareMs;
  const overallDeadlineMs = startedMs + budgetMs;

  const todayYmd = ymdOf(deps.now);
  const todayDow = deps.now.getUTCDay();
  const fetchedAt = deps.now.toISOString();

  // 1) 블로그 — 키가 있을 때만. shortlist 만 병렬로 묻는다
  const blogs = new Map<string, BlogSignal | null>();
  const blogQueried = new Set<string>();
  if (env.NCP_API_KEY_ID && env.NCP_API_KEY && blogShareMs >= PHASE_MIN_MS) {
    const keyId = env.NCP_API_KEY_ID;
    const key = env.NCP_API_KEY;
    const targets = blogShortlist(places.length).map(i => places[i]);
    for (const p of targets) blogQueried.add(p.id);
    await Promise.all(targets.map(async p => {
      const sig = await withDeadline(
        cached(env.CACHE, `blog:${p.id}`, BLOG_TTL_S,
          () => fetchNaverBlog(p.name, keyId, key, deps.fetch, todayYmd)),
        blogDeadlineMs - Date.now(),
        null,
      );
      blogs.set(p.id, sig);
    }));
  }

  // 2) 구글 — 예산 안에서 상위 10곳만.
  //    addedMin 은 서버가 모른다(플래너가 아직 안 돌았다). 회랑 검색이 이미 회랑
  //    거리순으로 주므로 그 순서를 addedMin 대용으로 쓴다 — prescore 는 순서만 본다.
  //
  //    캐시 키(gplace:)와 예산 키(gbudget:)는 접두사를 분리한다. place.id 는 클라이언트가
  //    고르는 값이라 "budget:2026-09" 같은 걸 넣으면, 접두사가 같았던 옛 스킴
  //    (google:${id} vs google:budget:${month})에서는 캐시 JSON 쓰기가 과금 카운터
  //    키와 정확히 겹칠 수 있었다. 서로 다른 접두사를 쓰면 어떤 id가 와도 구조적으로
  //    겹칠 수 없다.
  const budgetKey = `gbudget:${monthOf(deps.now)}`;
  const usedRaw = await env.CACHE.get(budgetKey);
  let used: number;
  if (usedRaw === null) {
    used = 0;
  } else {
    const n = Number(usedRaw);
    // 카운터 값이 깨져서(파싱 불가·NaN·Infinity) 숫자가 아니면 0이 아니라 캡으로 본다.
    // 모르는 값을 0으로 읽으면 이미 다 쓴 예산 위에 또 쓸 수 있다 — 모르면 이번 달은
    // 구글을 건너뛰는 쪽으로 fail-safe 한다. 키는 달마다 새로 시작하므로 최악의 경우도
    // 그 한 달만 구글 신호가 빠지는 것으로 끝나고 과금 위험은 없다.
    used = Number.isFinite(n) ? n : GOOGLE_MONTHLY_CAP;
  }
  let spent = 0;
  let finalUsed = used; // 응답 budget.googleUsed — 구글을 안 부르면 그대로 used
  const googles = new Map<string, GoogleSignal | null>();

  // 남은 시간이 한 회차도 못 돌 만큼이면 시작하지 않는다 — 예약만 하고 버리는 꼴이 된다
  const googleRoomMs = overallDeadlineMs - Date.now();
  if (env.GOOGLE_PLACES_KEY && used < GOOGLE_MONTHLY_CAP && googleRoomMs >= PHASE_MIN_MS) {
    const apiKey = env.GOOGLE_PLACES_KEY;
    const wantedIds = prescore(places.map((p, i) => ({
      id: p.id,
      addedMin: i,
      blog: blogs.get(p.id) ? { weighted: blogs.get(p.id)!.weighted } : undefined,
    })));
    const wanted = new Set(wantedIds);
    // prescore가 매긴 순위를 유지한 채로 room만큼 자른다. places 원래(입력) 순서로
    // 되돌린 뒤 자르면, 예산이 부족한 달 말(예산이 존재하는 이유 그 자체인 상황)에
    // 순위가 아니라 배열 위치로 상위 N곳이 뽑히게 된다.
    const rankOf = new Map(wantedIds.map((id, i) => [id, i]));
    const targets = places
      .filter(p => wanted.has(p.id))
      .sort((a, b) => rankOf.get(a.id)! - rankOf.get(b.id)!);
    const room = Math.max(0, GOOGLE_MONTHLY_CAP - used);
    const attempting = targets.slice(0, room);

    // 쓰기 전에 먼저 예약한다: 이번 배치가 최대 attempting.length 만큼 쓸 수 있다고
    // 루프 시작 전에 적어 둔다. 이 예약 쓰기 자체는 그냥 덮어쓰기라, 서로 다른 계획의
    // 요청 두 개가 정말 동시에(같은 used를 읽은 채) 예약하면 나중 쓰기가 먼저 쓰기를
    // 덮어써 두 예약이 합쳐지지 않는 문제는 여전히 남는다(파일 머리 주석 참고, KV
    // compare-and-swap 부재). 그래도 루프 중간에 요청이 죽으면 아래 정정 단계 자체가
    // 실행되지 않으므로, 이미 만든 호출 수만큼 적어 둔 이 예약값이 그대로 남아
    // 지출을 잊어버리지는 않는다.
    if (attempting.length > 0) {
      finalUsed = used + attempting.length;
      await env.CACHE.put(budgetKey, String(finalUsed), { expirationTtl: BUDGET_TTL_S });
    }

    // 구글 호출은 서로 독립이라 병렬로 보낸다. 예산 예약이 이미 호출 전에 끝나 있으므로
    // 완료 순서는 지출 계산과 무관하다 — spent는 캐시 미스(실제 호출)일 때만 늘어난다.
    // 순차였을 때는 슬롯 하나가 순차 보강(runPlan.ts)과 겹쳐 지연이 배로 쌓였다.
    await Promise.all(attempting.map(async p => {
      const sig = await withDeadline(
        cached(env.CACHE, `gplace:${p.id}:${normalizeName(p.name)}`, GOOGLE_TTL_S, async () => {
          spent++;
          return fetchGooglePlace({ name: p.name, lat: p.lat, lng: p.lng }, apiKey, deps.fetch, todayDow);
        }),
        overallDeadlineMs - Date.now(),
        null,
      );
      googles.set(p.id, sig);
    }));

    if (attempting.length > 0) {
      // 정정 직전에 카운터를 다시 읽는다. "내가 방금 쓴 예약이 그대로 남아 있을 때만"
      // 실제 지출로 내려쓴다 — 그 사이 다른(겹치는) 요청이 이미 자신의 값을 써 놨다면
      // 그건 그 요청의 몫이니 건드리지 않는다. (한때 Math.max(current, used+spent)로
      // "절대 뒤로 가지 않게" 했었는데, 그러면 겹침이 없는 보통의 경우조차 current가
      // 항상 이 요청 자신의 예약값과 같아 정정이 사실상 죽어 버렸다 — reserved ≥
      // used+spent가 늘 성립하니 max가 매번 reserved만 골랐다. 캐시 히트가 대부분인
      // 반복 계획에서 카운터가 실제 지출의 몇 배로 부풀어 예산이 훨씬 일찍 바닥나는
      // 결과였다.) 조건부 쓰기는 겹침이 없으면 정확히 실제 지출로 내려가고, 겹치면
      // 남의 값을 지우지 않는 대신 이번 요청의 캐시 히트만 과다집계로(최대
      // attempting.length만큼) 남긴다 — 남의 예약을 지우는 것보다 훨씬 작은 비용이다.
      const reserved = used + attempting.length;
      const currentRaw = await env.CACHE.get(budgetKey);
      const current = Number(currentRaw ?? 0);
      if (Number.isFinite(current) && current === reserved && spent !== attempting.length) {
        finalUsed = used + spent;
        await env.CACHE.put(budgetKey, String(finalUsed), { expirationTtl: BUDGET_TTL_S });
      } else if (Number.isFinite(current)) {
        // 정정이 필요 없거나(캐시 미스가 없어 reserved가 이미 실제 지출과 같다) 다른
        // 요청이 이미 더 최신 값을 써 놨다 — 카운터는 손대지 않고 응답엔 방금 읽은
        // 최신값을 그대로 보고한다.
        finalUsed = current;
      }
      // current가 깨져서(파싱 불가) Number.isFinite가 거짓이면 finalUsed는 이미
      // reserved로 남아 있다 — 모르는 값 위에 쓰지 않고 예약값을 그대로 보고한다.
    }
  }

  const results: Record<string, PlaceSignals> = {};
  for (const p of places) {
    const sig: PlaceSignals = { fetchedAt };
    const b = blogs.get(p.id);
    if (b) sig.blog = b;
    // 물어봤다는 사실은 신호가 없어도 남긴다 — 앱의 buzz 커버리지 규칙이 이걸 분모로 쓴다
    if (blogQueried.has(p.id)) sig.blogQueried = true;
    const g = googles.get(p.id);
    if (g) sig.google = g;
    results[p.id] = sig;
  }

  return json({
    results,
    budget: { googleUsed: finalUsed, googleLeft: Math.max(0, GOOGLE_MONTHLY_CAP - finalUsed) },
  });
}

export type { EnrichPlace };
