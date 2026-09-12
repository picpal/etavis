/**
 * /enrich — 후보에 바깥 신호를 붙인다.
 *
 * 여기가 구글 과금을 막는 자리다. 세 겹으로 막는다:
 *   1) 캐시(블로그 24시간, 구글 14일)
 *   2) 슬롯당 상위 10곳만 구글에 묻는다(prescore)
 *   3) 월 900회 카운터 — 무료분 1,000회 안에서 멈춘다
 * 콘솔 일일 할당량은 무료 체험판이라 아직 못 걸었다(설계 §9). 그래서 3)이 유일한 코드 방어선이다.
 *
 * 부분 실패는 실패가 아니다. 블로그만 와도 200 이다.
 */
import { parseEnrichRequest, type EnrichPlace } from './enrichSchema';
import { fetchNaverBlog } from './naverBlog';
import { fetchGooglePlace } from './googlePlaces';
import { prescore } from '../../src/lib/trendScore';
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
const GOOGLE_TTL_S = 14 * 24 * 60 * 60;
const GOOGLE_MONTHLY_CAP = 900;        // 무료분 1,000 보다 낮게

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

  const todayYmd = ymdOf(deps.now);
  const todayDow = deps.now.getUTCDay();
  const fetchedAt = deps.now.toISOString();

  // 1) 블로그 — 키가 있을 때만, 전부 병렬
  const blogs = new Map<string, BlogSignal | null>();
  if (env.NCP_API_KEY_ID && env.NCP_API_KEY) {
    const keyId = env.NCP_API_KEY_ID;
    const key = env.NCP_API_KEY;
    await Promise.all(places.map(async p => {
      const sig = await cached(env.CACHE, `blog:${p.id}`, BLOG_TTL_S,
        () => fetchNaverBlog(p.name, keyId, key, deps.fetch, todayYmd));
      blogs.set(p.id, sig);
    }));
  }

  // 2) 구글 — 예산 안에서 상위 10곳만.
  //    addedMin 은 서버가 모른다(플래너가 아직 안 돌았다). 회랑 검색이 이미 회랑
  //    거리순으로 주므로 그 순서를 addedMin 대용으로 쓴다 — prescore 는 순서만 본다.
  const used = Number((await env.CACHE.get(`google:budget:${monthOf(deps.now)}`)) ?? 0);
  let spent = 0;
  const googles = new Map<string, GoogleSignal | null>();

  if (env.GOOGLE_PLACES_KEY && used < GOOGLE_MONTHLY_CAP) {
    const apiKey = env.GOOGLE_PLACES_KEY;
    const wanted = new Set(prescore(places.map((p, i) => ({
      id: p.id,
      addedMin: i,
      blog: blogs.get(p.id) ? { weighted: blogs.get(p.id)!.weighted } : undefined,
    }))));
    const targets = places.filter(p => wanted.has(p.id));
    const room = Math.max(0, GOOGLE_MONTHLY_CAP - used);

    for (const p of targets.slice(0, room)) {
      const sig = await cached(env.CACHE, `google:${p.id}`, GOOGLE_TTL_S, async () => {
        spent++; // 캐시 미스일 때만 실제 호출이 나간다
        return fetchGooglePlace({ name: p.name, lat: p.lat, lng: p.lng }, apiKey, deps.fetch, todayDow);
      });
      googles.set(p.id, sig);
    }
    if (spent > 0) {
      await env.CACHE.put(`google:budget:${monthOf(deps.now)}`, String(used + spent));
    }
  }

  const results: Record<string, PlaceSignals> = {};
  for (const p of places) {
    const sig: PlaceSignals = { fetchedAt };
    const b = blogs.get(p.id);
    if (b) sig.blog = b;
    const g = googles.get(p.id);
    if (g) sig.google = g;
    results[p.id] = sig;
  }

  return json({
    results,
    budget: { googleUsed: used + spent, googleLeft: Math.max(0, GOOGLE_MONTHLY_CAP - used - spent) },
  });
}

export type { EnrichPlace };
