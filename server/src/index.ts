/**
 * Etavia 서버 — Cloudflare Workers.
 *
 * 하는 일은 둘이다: 키를 가리고, 바깥 응답을 검증해서 넘긴다.
 *   /extract — LLM 의도 추출
 *   /route   — 카카오모빌리티 자동차 길찾기(경유지 ≤ 5)
 *   /transit — Google Routes 대중교통(공급자 교체 가능)
 * 경로 조합·시간 판정은 앱이 한다. 여기서 하면 느려지고 배터리만 먹는다.
 */
import { parseIntent } from './schema';
import { SYSTEM_PROMPT, kstHHMM } from './prompt';
import { parseRouteRequest } from './routeSchema';
import { kakaoDirectionsUrl, normalizeKakao } from './kakao';
import { handleEnrich } from './enrich';
import { handleTransit } from './transit';
import { cachedPlaces, handlePlaces } from './places';
import { parsePlacesRequest } from './placesSchema';
import { corsHeaders, dailyBucket, overDailyCap, rateLimited, routeCacheKey, ROUTE_TTL_S } from './guard';
import { handleReason } from './reason';
import { upstreamDetail } from './upstream';
import { kvPut } from './kvWrite';

export interface Env {
  OPENAI_API_KEY: string;
  /** 모델 이름. Codex CLI(ChatGPT 계정)에서 쓰는 이름과 API에서 쓰는 이름이
      다를 수 있으므로 env로 뺐다 — 바꿔야 하면 secret 하나만 고치면 된다 */
  OPENAI_MODEL?: string;
  /** 앱이 보내는 공유 토큰. 없으면 누구나 이 엔드포인트로 남의 요금을 쓴다 */
  APP_TOKEN: string;
  /**
   * 카카오내비 길찾기(apis-navi.kakaomobility.com) 키.
   *
   * 2026-09-17 실측: developers.kakao.com 의 REST 키를 그대로 받는다("길찾기 성공").
   * 전에 "카카오 로컬 키와 다르다"고 적어뒀는데 사실이 아니었다 — 제휴 계약이
   * 필요한 건 카카오모빌리티 **대중교통** 통합 길찾기 쪽이고, 여기서 쓰는
   * 자동차 길찾기는 아니다. 슬롯을 따로 둔 건 나중에 분리할 여지 때문이다.
   */
  KAKAO_MOBILITY_KEY: string;
  /** NAVER API HUB 검색(블로그). 네이버 클라우드 콘솔의 Client ID·Secret */
  NCP_API_KEY_ID: string;
  NCP_API_KEY: string;
  /**
   * 구글 Places (New).
   *
   * **Places API (New) 하나로만 제한한 키여야 한다.** 2026-09-17 현재는 그렇지
   * 않고 GOOGLE_ROUTES_KEY 와 같은 키다(실측으로 둘 다 통과). 같은 이름이
   * `app.json` 의 `extra.googlePlacesKey` 로 앱 번들에도 들어가므로
   * (`src/lib/places.ts:240`) 번들에서 추출당하면 Routes 쿼터까지 같이 털린다.
   * 분리는 남은 숙제다.
   */
  GOOGLE_PLACES_KEY: string;
  /** Routes API 용 키. 없으면 GOOGLE_PLACES_KEY 를 쓴다(같은 키에 Routes 를 허용해 둔 경우) */
  GOOGLE_ROUTES_KEY?: string;
  /** developers.kakao.com 로컬 REST 키. KAKAO_MOBILITY_KEY(길찾기)와 다르다 */
  KAKAO_LOCAL_KEY: string;
  /** 대중교통 공급자. google | tmap | kakao. 없으면 google */
  TRANSIT_PROVIDER?: string;
  /** 바깥 응답 캐시. RATE 와 별개 — 용도가 섞이면 TTL 을 못 나눈다 */
  CACHE: KVNamespace;
  RATE: KVNamespace;
  /** 웹 데모 오리진 허용 목록(콤마 구분). 비어 있으면 CORS 헤더를 안 붙인다 = 네이티브 전용 */
  ALLOWED_ORIGINS?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * 2026-09-17 실측으로 gpt-5.6-sol 에서 옮겼다. 대표 34케이스(그룹당 1개,
 * run-server-cases.mjs 와 같은 표본) 기준:
 *
 *   sol    중앙 8.4s · p90 21.7s · 최대 29.4s · 30/34 · $17.82/1000콜
 *   terra  중앙 2.5s · p90  6.3s · 최대 13.7s · 29/34 · $10.39/1000콜
 *
 * **정확도 1점을 내주고 옮긴 게 아니다.** 앱 타임아웃 안에 답이 오느냐가 갈렸다 —
 * sol 은 절반 가까이가 상한을 넘겨 로컬 목으로 떨어졌고, 목이 답하면 정확도는
 * 30/34 근처가 아니라 훨씬 아래다. 사용자에게 **닿는** 정확도로는 terra 가 이긴다.
 *
 * 코드에 박는 이유: secret(OPENAI_MODEL)으로만 두면 워커가 초기화될 때 조용히
 * sol 로 돌아간다. secret 이 전부 날아가 있던 걸 2026-09-17 에 겪었다.
 * OPENAI_MODEL 은 급할 때 코드 배포 없이 바꾸는 탈출구로 남긴다.
 */
const DEFAULT_MODEL = 'gpt-5.6-terra';

/** 엔드포인트들이 공유하는 문지기. 토큰 → 분당 상한(기기·IP) → JSON 파싱.
    전역 일일 상한은 여기서 보지 않는다 — /route 는 요청을 파싱해야 버킷이 정해진다 */
async function gate(req: Request, env: Env, path: string): Promise<{ body: unknown } | Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (req.headers.get('x-app-token') !== env.APP_TOKEN) return json({ error: 'unauthorized' }, 401);
  const deviceId = req.headers.get('x-device-id') ?? 'unknown';
  const ip = req.headers.get('cf-connecting-ip');
  if (await rateLimited(env.RATE, path, deviceId, ip, new Date())) {
    return json({ error: 'rate limited' }, 429);
  }
  try {
    return { body: await req.json() };
  } catch {
    return json({ error: 'bad json' }, 400);
  }
}

/** 카카오 길찾기 프록시. 응답은 앱의 RouteResult 형식으로 정규화해서만 내보낸다 */
async function handleRoute(body: unknown, env: Env): Promise<Response> {
  const parsed = parseRouteRequest(body);
  if (!parsed) return json({ error: 'bad request' }, 400);

  // 지금 출발과 미래운행은 무료분이 다르다(10,000 / 5,000)
  const bucket = dailyBucket('/route', parsed.departAt);
  if (await overDailyCap(env.RATE, bucket, new Date())) {
    return json({ error: 'daily cap', bucket }, 429);
  }

  /* 캐시는 상한 뒤에 본다 — 히트는 과금이 아니지만, 카운터가 실제 부하를 보여야
     상한값을 조정할 때 쓸 수 있는 숫자가 된다 */
  const cacheKey = routeCacheKey(parsed);
  const hit = await env.CACHE.get(cacheKey);
  if (hit !== null) {
    try {
      return json(JSON.parse(hit));
    } catch {
      /* 캐시가 깨졌으면 새로 받는다 */
    }
  }

  const res = await fetch(kakaoDirectionsUrl(parsed), {
    headers: { authorization: `KakaoAK ${env.KAKAO_MOBILITY_KEY}` },
  });
  if (!res.ok) return json({ error: 'upstream', status: res.status, detail: await upstreamDetail(res) }, 502);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return json({ error: 'unparseable' }, 502);
  }
  const norm = normalizeKakao(raw, parsed.polyline);
  // result_code≠0(예: 104 출발·도착 5m 이내)은 앱이 사용자에게 설명할 수 있게 코드를 넘긴다
  if (!norm.ok) return json({ error: 'route', code: norm.code, msg: norm.msg }, 422);
  // 성공만 캐시한다. 실패를 캐시하면 일시적 장애가 TTL 내내 굳는다
  await kvPut(env.CACHE, 'route:cache', cacheKey, JSON.stringify(norm.route), { expirationTtl: ROUTE_TTL_S }, 'best-effort');
  return json(norm.route);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req.headers.get('origin'), env.ALLOWED_ORIGINS);
    // preflight 는 문지기를 타지 않는다 — 브라우저가 토큰 없이 보내는 요청이다
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /* handle() 이 던지면 Workers 가 대신 1101 을 내는데, **그 응답에는 cors 가 없다.**
       브라우저에는 그냥 "네트워크 오류"로 보이고, 4주 동안 원인을 응답만으로는 알 수
       없다(CORS 설정 문제인지 서버가 터진 건지 구분이 안 된다). 여기서 받아 503 으로
       바꾸고 — 성공이든 실패든 아래 한 곳에서 cors 를 붙인다.
       스택은 `npx wrangler tail` 로 본다. 응답에는 싣지 않는다. */
    let res: Response;
    try {
      res = await handle(req, env);
    } catch (err) {
      console.error('[fetch] unhandled', err);
      res = json({ error: 'internal' }, 503);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function handle(req: Request, env: Env): Promise<Response> {
  {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });

    const known = ['/extract', '/route', '/enrich', '/transit', '/places', '/reason'];
    if (!known.includes(url.pathname)) return json({ error: 'not found' }, 404);

    const gated = await gate(req, env, url.pathname);
    if (gated instanceof Response) return gated;
    if (url.pathname === '/route') return handleRoute(gated.body, env);
    if (url.pathname === '/transit') return handleTransit(gated.body, env, { fetch, now: new Date() });
    if (url.pathname === '/places') {
      const parsed = parsePlacesRequest(gated.body);
      if (!parsed) return json({ error: 'bad request' }, 400);
      /* 여기만 캐시를 상한보다 **먼저** 본다 — /route(:84)와 순서가 반대다.
         거기선 TTL 이 300초라 적중률이 낮아 카운터≈지출이 성립하지만, /places 는
         TTL 24시간에 캐시 키가 좌표를 11m 로 깎는다(`places.ts:18,33`). 회랑 검색은
         폴리라인 위 같은 진행률 지점을 뽑으므로 같은 심사자가 같은 시나리오를 두 번
         돌리면 격자가 거의 그대로 맞는다. 적중을 세면 4주 가동의 주 방어선인 캐시가
         일일 상한에 대해 방어력이 0 이 되고, 카카오에 한 푼도 안 나가는 요청이
         예산을 똑같이 먹는다. 이 순서에서만 카운터의 뜻이 '실제 카카오 지출'이다.
         덤으로 적중마다 KV 쓰기 1회가 준다. */
      const cached = await cachedPlaces(parsed, env);
      if (cached) return cached;
      /* 웹 데모와 네이티브 앱은 예산을 나눠 쓴다 — 브라우저만 Origin 을 붙인다.
         근거는 guard.ts 의 PER_DAY 주석. */
      const bucket = dailyBucket('/places', undefined, req.headers.get('origin'));
      if (await overDailyCap(env.RATE, bucket, new Date())) return json({ error: 'daily cap', bucket }, 429);
      return handlePlaces(parsed, env, { fetch, cacheChecked: true });
    }
    if (url.pathname === '/enrich') {
      if (await overDailyCap(env.RATE, '/enrich', new Date())) return json({ error: 'daily cap' }, 429);
      return handleEnrich(gated.body, env, { fetch, now: new Date() });
    }
    /* 분기를 여기서 끊는다. 빠뜨리면 아래 /extract 처리로 흘러가 엉뚱한 프롬프트를 탄다 —
       마지막 분기가 조건 없는 fall-through 라 조용히 그렇게 된다 */
    if (url.pathname === '/reason') {
      if (await overDailyCap(env.RATE, '/reason', new Date())) return json({ error: 'daily cap' }, 429);
      return handleReason(gated.body, env);
    }
    if (await overDailyCap(env.RATE, '/extract', new Date())) {
      // 앱은 429도 실패로 보고 로컬 목으로 떨어진다
      return json({ error: 'daily cap' }, 429);
    }

    const body = (gated.body ?? {}) as { text?: string; context?: unknown };
    const text = (body.text ?? '').slice(0, 500);
    if (!text.trim()) return json({ error: 'empty text' }, 400);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL ?? DEFAULT_MODEL,
        /* temperature 를 보내지 않는다. 이 모델은 기본값(1)만 받는다 —
           0 을 실으면 400 "does not support 0 with this model" 이 돌아온다.
           docs/NEXT.md 가 "temperature=0 으로 낮췄다" 고 적어 둔 건 실제로는
           적용된 적이 없다는 뜻이다. 비결정성의 실질 방어는 칩 UI 다 —
           사용자가 무엇을 알아들었는지 보고 고칠 수 있으면 치명상이 되지 않는다. */
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          // 사용자 문장은 지시가 아니라 데이터다. 역할을 섞지 않는다.
          // now 는 서버가 덮어쓴다 — '9시까지'가 오전인지 오후인지가 여기 달렸고,
          // 클라이언트가 정할 값이 아니다(v4).
          {
            role: 'user',
            content: JSON.stringify({
              text,
              context: { ...((body.context ?? {}) as Record<string, unknown>), now: kstHHMM(new Date()) },
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      // 앱은 이걸 받으면 로컬 목으로 떨어진다 — 서버가 죽어도 계획은 세워진다
      return json({ error: 'upstream', status: res.status, detail: await upstreamDetail(res) }, 502);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    /* 토큰을 로그로 남긴다 — 응답 모양은 건드리지 않는다(앱이 읽는 건 Intent 뿐이다).
       `npx wrangler tail` 로 본다. 케이스 러너를 돌릴 때 비용을 추정이 아니라
       실측으로 말할 수 있어야 한다. */
    if (data.usage) {
      console.log(`[extract] tokens in=${data.usage.prompt_tokens} out=${data.usage.completion_tokens} total=${data.usage.total_tokens} model=${env.OPENAI_MODEL ?? DEFAULT_MODEL}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data.choices?.[0]?.message?.content ?? '');
    } catch {
      return json({ error: 'unparseable' }, 502);
    }

    /* 여기가 방어선이다. LLM이 설득당해 무엇을 뱉든
       스키마를 통과하지 못하면 앱에 닿지 않는다 */
    const intent = parseIntent(raw);
    if (!intent) return json({ error: 'schema' }, 502);

    return json(intent);
  }
}
