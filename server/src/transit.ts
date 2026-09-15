/**
 * /transit — 대중교통 경로 프록시. /route 와 같은 4층: 스키마 → 상한 → 캐시 → 공급자.
 * 공급자는 env TRANSIT_PROVIDER 로 고른다(기본 google). 앱은 정규화된 형식만 본다.
 */
import { overDailyCap, TRANSIT_TTL_S, transitCacheKey, type KVLike } from './guard';
import { parseTransitRequest } from './transitSchema';
import { googleAdapter } from './transitGoogle';
import type { TransitAdapter, TransitEnv, TransitResponse } from './transitTypes';

export type TransitHandlerEnv = TransitEnv & { CACHE: KVLike; RATE: KVLike; TRANSIT_PROVIDER?: string };

const ADAPTERS: Record<string, TransitAdapter> = { google: googleAdapter };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function upstreamDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    return typeof msg === 'string' ? msg.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

export async function handleTransit(body: unknown, env: TransitHandlerEnv, deps: { fetch: typeof fetch; now: Date }): Promise<Response> {
  const req = parseTransitRequest(body, deps.now);
  if (!req) return json({ error: 'bad request' }, 400);

  const providerId = env.TRANSIT_PROVIDER ?? 'google';
  const adapter = ADAPTERS[providerId];
  // 어댑터가 없으면 google 로 떨어뜨리지 않는다 — 설정 실수가 조용히 다른 공급자 요금이 되면 안 된다
  if (!adapter) return json({ error: 'provider not implemented', provider: providerId }, 501);

  if (await overDailyCap(env.RATE, '/transit', deps.now)) return json({ error: 'daily cap' }, 429);

  const cacheKey = transitCacheKey(req, adapter.id);
  const hit = await env.CACHE.get(cacheKey);
  if (hit !== null) {
    try { return json(JSON.parse(hit)); } catch { /* 깨진 캐시는 새로 받는다 */ }
  }

  const res = await adapter.fetchRaw(req, env, deps.fetch);
  if (!res.ok) return json({ error: 'upstream', status: res.status, detail: await upstreamDetail(res) }, 502);
  let raw: unknown;
  try { raw = await res.json(); } catch { return json({ error: 'unparseable' }, 502); }

  const norm = adapter.normalize(raw, req);
  if (!norm.ok) return json({ error: 'transit', code: norm.code, msg: norm.msg }, 422);

  const out: TransitResponse = { provider: adapter.id, source: 'provider', itineraries: norm.itineraries };
  await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: TRANSIT_TTL_S });
  return json(out);
}
