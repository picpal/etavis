/**
 * /transit — 대중교통 경로 프록시. 4층: 스키마 → 캐시 → 상한 → 공급자.
 * 상한이 캐시 **뒤**인 건 /route(상한 → 캐시)와 다르다 — 아래 캐시 주석에 근거를 적었다.
 * 공급자는 env TRANSIT_PROVIDER 로 고른다(기본 google). 앱은 정규화된 형식만 본다.
 */
import { overDailyCap, TRANSIT_TTL_S, transitCacheKey, type KVLike } from './guard';
import { parseTransitRequest } from './transitSchema';
import { googleAdapter } from './transitGoogle';
import { upstreamDetail } from './upstream';
import type { TransitAdapter, TransitEnv, TransitResponse } from './transitTypes';
import { kvPut } from './kvWrite';

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

  /* 캐시를 상한보다 **먼저** 본다 — `/places`(index.ts:180)와 같은 순서다.
     캐시 키가 좌표를 11m(소수 4자리)로, 출발시각을 10분으로 깎으므로(`guard.ts:210`)
     같은 계획을 다시 열거나 경유지 하나만 손보는 흐름은 거의 그대로 적중한다.
     적중을 세면 구글에 한 푼도 안 나가는 요청이 300 에서 1 을 빼 가고, 캐시가
     일일 상한에 대해 방어력이 0 이 된다. 이 순서에서만 카운터의 뜻이
     '실제 구글 지출'이다. 덤으로 적중마다 KV 쓰기 1회가 준다.

     키 없음 검사(위)는 캐시보다 앞에 그대로 둔다. 적중은 상류를 안 부르니 키가 없어도
     답할 수는 있지만, 그러면 배포 설정 실수가 캐시가 사는 10분 동안 가려졌다가
     적중이 식는 순간 터진다. 키 없음은 상한과 달리 돈 문제가 아니라 설정 문제라
     전부 똑같이, 즉시 500 으로 드러나는 편이 낫다.

     alternatives 는 캐시 키에서 뺐다 — 같은 상류 응답을 alternatives 값 때문에 두 번 부르지 않는다 */
  const cacheKey = transitCacheKey(req, adapter.id);
  const hit = await env.CACHE.get(cacheKey);
  if (hit !== null) {
    try {
      const cached = JSON.parse(hit) as TransitResponse;
      return json({ ...cached, itineraries: cached.itineraries.slice(0, req.alternatives) });
    } catch { /* 깨진 캐시는 새로 받는다 — 아래 상한 검사를 지나서 간다, 그 호출엔 돈이 나간다 */ }
  }

  // 여기부터는 상류를 부른다. 상한은 캐시를 못 쓰는 모든 경로(미스·깨진 캐시)의 공통 관문이어야 한다
  if (await overDailyCap(env.RATE, '/transit', deps.now)) return json({ error: 'daily cap' }, 429);

  const res = await adapter.fetchRaw(req, env, deps.fetch);
  if (!res.ok) return json({ error: 'upstream', status: res.status, detail: await upstreamDetail(res) }, 502);
  let raw: unknown;
  try { raw = await res.json(); } catch { return json({ error: 'unparseable' }, 502); }

  // 최대치(3)로 정규화해서 캐시한다 — 다른 alternatives 로 온 다음 요청이 캐시를 그대로 쓸 수 있게
  const norm = adapter.normalize(raw, { ...req, alternatives: 3 });
  if (!norm.ok) return json({ error: 'transit', code: norm.code, msg: norm.msg }, 422);

  const out: TransitResponse = { provider: adapter.id, source: 'provider', itineraries: norm.itineraries };
  await kvPut(env.CACHE, 'transit:cache', cacheKey, JSON.stringify(out), { expirationTtl: TRANSIT_TTL_S }, 'best-effort');
  return json({ ...out, itineraries: out.itineraries.slice(0, req.alternatives) });
}
