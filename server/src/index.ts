/**
 * Etavia 서버 — Cloudflare Workers.
 *
 * 하는 일은 둘이다: 키를 가리고, 바깥 응답을 검증해서 넘긴다.
 *   /extract — LLM 의도 추출
 *   /route   — 카카오모빌리티 자동차 길찾기(경유지 ≤ 5)
 * 경로 조합·시간 판정은 앱이 한다. 여기서 하면 느려지고 배터리만 먹는다.
 */
import { parseIntent } from './schema';
import { SYSTEM_PROMPT } from './prompt';
import { parseRouteRequest } from './routeSchema';
import { kakaoDirectionsUrl, normalizeKakao } from './kakao';
import { handleEnrich } from './enrich';
import { corsHeaders, dailyBucket, overDailyCap, rateLimited, routeCacheKey, ROUTE_TTL_S } from './guard';

export interface Env {
  OPENAI_API_KEY: string;
  /** 모델 이름. Codex CLI(ChatGPT 계정)에서 쓰는 이름과 API에서 쓰는 이름이
      다를 수 있으므로 env로 뺐다 — 바꿔야 하면 secret 하나만 고치면 된다 */
  OPENAI_MODEL?: string;
  /** 앱이 보내는 공유 토큰. 없으면 누구나 이 엔드포인트로 남의 요금을 쓴다 */
  APP_TOKEN: string;
  /** developers.kakaomobility.com REST 키. 카카오 로컬(developers.kakao.com) 키와 다르다 */
  KAKAO_MOBILITY_KEY: string;
  /** NAVER API HUB 검색(블로그). 네이버 클라우드 콘솔의 Client ID·Secret */
  NCP_API_KEY_ID: string;
  NCP_API_KEY: string;
  /** 구글 Places (New). Places API (New) 하나로만 제한된 키 */
  GOOGLE_PLACES_KEY: string;
  /** 바깥 응답 캐시. RATE 와 별개 — 용도가 섞이면 TTL 을 못 나눈다 */
  CACHE: KVNamespace;
  RATE: KVNamespace;
  /** 웹 데모 오리진 허용 목록(콤마 구분). 비어 있으면 CORS 헤더를 안 붙인다 = 네이티브 전용 */
  ALLOWED_ORIGINS?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** 시뮬레이션에서 30건 중 29건(97%)을 맞힌 모델. server/bench-models.mjs 참고 */
const DEFAULT_MODEL = 'gpt-5.6-sol';

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
  if (!res.ok) return json({ error: 'upstream', status: res.status }, 502);
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
  await env.CACHE.put(cacheKey, JSON.stringify(norm.route), { expirationTtl: ROUTE_TTL_S });
  return json(norm.route);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req.headers.get('origin'), env.ALLOWED_ORIGINS);
    // preflight 는 문지기를 타지 않는다 — 브라우저가 토큰 없이 보내는 요청이다
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const res = await handle(req, env);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function handle(req: Request, env: Env): Promise<Response> {
  {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });

    const known = ['/extract', '/route', '/enrich'];
    if (!known.includes(url.pathname)) return json({ error: 'not found' }, 404);

    const gated = await gate(req, env, url.pathname);
    if (gated instanceof Response) return gated;
    if (url.pathname === '/route') return handleRoute(gated.body, env);
    if (url.pathname === '/enrich') {
      if (await overDailyCap(env.RATE, '/enrich', new Date())) return json({ error: 'daily cap' }, 429);
      return handleEnrich(gated.body, env, { fetch, now: new Date() });
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
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          // 사용자 문장은 지시가 아니라 데이터다. 역할을 섞지 않는다
          { role: 'user', content: JSON.stringify({ text, context: body.context ?? {} }) },
        ],
      }),
    });

    if (!res.ok) {
      // 앱은 이걸 받으면 로컬 목으로 떨어진다 — 서버가 죽어도 계획은 세워진다
      return json({ error: 'upstream', status: res.status }, 502);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
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
