/**
 * /transit — 대중교통 경로 프록시. /route 와 같은 4층: 스키마 → 상한 → 캐시 → 공급자.
 * 공급자는 env TRANSIT_PROVIDER 로 고른다(기본 google). 앱은 정규화된 형식만 본다.
 */
import { overDailyCap, TRANSIT_TTL_S, transitCacheKey, type KVLike } from './guard';
import { parseTransitRequest } from './transitSchema';
import { googleAdapter } from './transitGoogle';
import { upstreamDetail } from './upstream';
import type { TransitAdapter, TransitEnv, TransitResponse } from './transitTypes';

export type TransitHandlerEnv = TransitEnv & { CACHE: KVLike; RATE: KVLike; TRANSIT_PROVIDER?: string };

const ADAPTERS: Record<string, TransitAdapter> = { google: googleAdapter };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function handleTransit(body: unknown, env: TransitHandlerEnv, deps: { fetch: typeof fetch; now: Date }): Promise<Response> {
  const req = parseTransitRequest(body, deps.now);
  if (!req) return json({ error: 'bad request' }, 400);

  const providerId = env.TRANSIT_PROVIDER ?? 'google';
  const adapter = ADAPTERS[providerId];
  // 어댑터가 없으면 google 로 떨어뜨리지 않는다 — 설정 실수가 조용히 다른 공급자 요금이 되면 안 된다
  if (!adapter) return json({ error: 'provider not implemented', provider: providerId }, 501);

  // 키가 없으면 상한 카운터를 건드리기 전에 끊는다 — 설정 실수로 하루 예산이 새면 안 된다
  if (adapter.hasKey?.(env) === false) return json({ error: 'not configured', provider: adapter.id }, 500);

  if (await overDailyCap(env.RATE, '/transit', deps.now)) return json({ error: 'daily cap' }, 429);

  // alternatives 는 캐시 키에서 뺐다 — 같은 상류 응답을 alternatives 값 때문에 두 번 부르지 않는다
  const cacheKey = transitCacheKey(req, adapter.id);
  const hit = await env.CACHE.get(cacheKey);
  if (hit !== null) {
    try {
      const cached = JSON.parse(hit) as TransitResponse;
      return json({ ...cached, itineraries: cached.itineraries.slice(0, req.alternatives) });
    } catch { /* 깨진 캐시는 새로 받는다 */ }
  }

  const res = await adapter.fetchRaw(req, env, deps.fetch);
  if (!res.ok) return json({ error: 'upstream', status: res.status, detail: await upstreamDetail(res) }, 502);
  let raw: unknown;
  try { raw = await res.json(); } catch { return json({ error: 'unparseable' }, 502); }

  // 최대치(3)로 정규화해서 캐시한다 — 다른 alternatives 로 온 다음 요청이 캐시를 그대로 쓸 수 있게
  const norm = adapter.normalize(raw, { ...req, alternatives: 3 });
  if (!norm.ok) return json({ error: 'transit', code: norm.code, msg: norm.msg }, 422);

  const out: TransitResponse = { provider: adapter.id, source: 'provider', itineraries: norm.itineraries };
  await env.CACHE.put(cacheKey, JSON.stringify(out), { expirationTtl: TRANSIT_TTL_S });
  return json({ ...out, itineraries: out.itineraries.slice(0, req.alternatives) });
}
