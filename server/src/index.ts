/**
 * Etavia 서버 — Cloudflare Workers.
 *
 * 하는 일은 하나다: 키를 가리고, LLM 응답을 검증해서 넘긴다.
 * 경로 계산·시간 판정은 앱이 한다. 여기서 하면 느려지고 배터리만 먹는다.
 */
import { parseIntent } from './schema';
import { SYSTEM_PROMPT } from './prompt';

export interface Env {
  OPENAI_API_KEY: string;
  /** 앱이 보내는 공유 토큰. 없으면 누구나 이 엔드포인트로 남의 요금을 쓴다 */
  APP_TOKEN: string;
  RATE: KVNamespace;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** 기기당 분당 호출 상한. 키를 서버로 옮겨도 문이 열려 있으면 옮긴 의미가 없다 */
const PER_MIN = 10;

async function rateLimited(env: Env, deviceId: string): Promise<boolean> {
  const key = `rl:${deviceId}:${Math.floor(Date.now() / 60000)}`;
  const hit = Number((await env.RATE.get(key)) ?? 0) + 1;
  await env.RATE.put(key, String(hit), { expirationTtl: 120 });
  return hit > PER_MIN;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (url.pathname !== '/extract') return json({ error: 'not found' }, 404);
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    if (req.headers.get('x-app-token') !== env.APP_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }
    const deviceId = req.headers.get('x-device-id') ?? 'unknown';
    if (await rateLimited(env, deviceId)) {
      return json({ error: 'rate limited' }, 429);
    }

    let body: { text?: string; context?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const text = (body.text ?? '').slice(0, 500);
    if (!text.trim()) return json({ error: 'empty text' }, 400);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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
  },
};
