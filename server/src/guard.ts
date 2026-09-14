/**
 * 과금 방어선. 키를 서버로 옮겨도 문이 열려 있으면 옮긴 의미가 없다.
 *
 * 층이 셋이다.
 *   1) 기기당 분당 — 정상 사용자의 폭주를 막는다
 *   2) IP당 분당   — `x-device-id`를 매번 바꿔 1)을 우회하는 걸 막는다
 *   3) 전역 일일   — 최후 방어선. 위 둘을 다 뚫어도 하루 총액이 고정된다
 *
 * 3)이 필요한 이유: `x-device-id`는 클라이언트가 정하는 값이고, `APP_TOKEN`은
 * 앱 번들에 인라인된다. 웹 데모라면 브라우저 네트워크 탭에 그대로 보인다.
 * 기기당 상한만으로는 "기기 1,000개"를 막지 못한다.
 *
 * **상한은 정확할 필요가 없다.** KV는 read-modify-write가 원자적이지 않아
 * 동시 요청에서 몇 건 샌다(`docs/NEXT.md`에 64→56으로 되돌아간 실측이 있다).
 * 그래도 75,000/일이 8,000/일이 되는 것이 이 파일의 요점이다. 정확한 카운터는
 * Durable Object로 옮길 때 얻는다.
 */
import type { RouteRequest } from './routeSchema';

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

/** 기기당 분당 상한. /route는 계획 하나에 5~9회가 나가므로 더 넉넉하다 */
export const PER_MIN: Record<string, number> = { '/extract': 10, '/route': 40, '/enrich': 10 };

/** IP당 분당 상한. 기기당의 3배 — 사무실·모바일 NAT로 여럿이 한 IP를 쓰는 걸
    감안하되, 기기 id만 갈아끼우는 우회는 막는다 */
export const PER_MIN_IP: Record<string, number> = { '/extract': 30, '/route': 120, '/enrich': 30 };

/**
 * 전역 일일 상한. 값의 근거는 2026-09-14 기준 각 API 요금표다.
 *
 * | 버킷 | 무료분 | 초과 단가 | 상한 |
 * |---|---|---|---|
 * | `/route:now`    | 일 10,000 | 8원 | 8,000 |
 * | `/route:future` | 일  5,000 | 8원 | 4,000 |
 * | `/enrich`       | 구글 Places — `enrich.ts`에 월 900 카운터가 따로 있다 | | 600 |
 * | `/extract`      | OpenAI, 무료분 없음 | 문장당 | 1,200 |
 *
 * 상한에 닿으면 429를 낸다. 앱은 서버 실패를 이미 로컬 목으로 폴백하므로
 * (`src/lib/intent.ts`) 화면이 죽지는 않는다 — 대신 추정값이 보인다.
 */
export const PER_DAY: Record<string, number> = {
  '/extract': 1200,
  '/route:now': 8000,
  '/route:future': 4000,
  '/enrich': 600,
};

const DAY_TTL_S = 2 * 24 * 60 * 60;
const MIN_TTL_S = 120;

/** 카카오·구글 할당량이 현지 시각 기준이라 UTC로 자르면 경계가 어긋난다 */
export function dayKey(bucket: string, now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `day:${bucket}:${kst.toISOString().slice(0, 10)}`;
}

/** /route는 지금 출발과 미래운행이 무료분이 달라 버킷을 나눈다 */
export function dailyBucket(path: string, departAt?: string): string {
  if (path === '/route') return departAt ? '/route:future' : '/route:now';
  return path;
}

/** 상한을 넘었는지. 넘었든 아니든 카운터는 올린다 — 막힌 요청도 시도는 시도다 */
export async function overDailyCap(kv: KVLike, bucket: string, now: Date): Promise<boolean> {
  const cap = PER_DAY[bucket];
  if (cap === undefined) return false;
  const key = dayKey(bucket, now);
  const used = Number((await kv.get(key)) ?? 0) + 1;
  await kv.put(key, String(used), { expirationTtl: DAY_TTL_S });
  return used > cap;
}

/**
 * 기기당·IP당 분당 상한을 함께 본다.
 * 둘 중 하나라도 넘으면 막되, **카운터는 둘 다 올린다** — 기기 상한에 걸린
 * 요청이 IP 카운터를 비껴가면 id만 갈아끼워 IP 상한을 영원히 피할 수 있다.
 */
export async function rateLimited(
  kv: KVLike,
  path: string,
  deviceId: string,
  ip: string | null,
  now: Date,
): Promise<boolean> {
  const minute = Math.floor(now.getTime() / 60000);
  const checks: [string, number][] = [[`rl:${path}:${deviceId}:${minute}`, PER_MIN[path] ?? 10]];
  if (ip) checks.push([`rlip:${path}:${ip}:${minute}`, PER_MIN_IP[path] ?? 30]);

  let over = false;
  for (const [key, cap] of checks) {
    const hit = Number((await kv.get(key)) ?? 0) + 1;
    await kv.put(key, String(hit), { expirationTtl: MIN_TTL_S });
    if (hit > cap) over = true;
  }
  return over;
}

/**
 * /route 응답 캐시 TTL. 교통 상황이 바뀌므로 짧다.
 * 노리는 건 장시간 재사용이 아니라 **한 번의 계획 안에서 겹치는 구간**이다 —
 * 플래너가 3안을 열거하면 같은 leg를 여러 번 묻는다.
 */
export const ROUTE_TTL_S = 300;

/** 좌표는 4자리(약 11m), 출발 시각은 10분 버킷으로 깎는다 */
export function routeCacheKey(req: RouteRequest): string {
  const q = (n: number) => n.toFixed(4);
  const pts = req.points.map(p => `${q(p.lat)},${q(p.lng)}`).join(';');
  const depart = req.departAt ? `${req.departAt.slice(0, 11)}0` : 'now';
  return `route:${pts}:${depart}:${req.polyline ? 'p' : 'n'}`;
}
