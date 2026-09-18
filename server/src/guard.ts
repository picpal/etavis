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
import type { TransitRequest } from './transitTypes';

export type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

/** 기기당 분당 상한. /route는 계획 하나에 5~9회가 나가므로 더 넉넉하다.
    /transit도 2026-09-16(7단계)부터 계획 하나에 최대 10회가 나간다 — 경유지를 못 실어
    구간마다 한 번씩 부른다(`src/lib/routePlan/transitBudget.ts`). 20이면 1분에 두 번만
    계획할 수 있어 경로를 다시 짜는 정상 사용이 막힌다. /route와 같은 근거로 40으로 둔다.
    분당 상한은 폭주 방어선이지 돈줄이 아니다 — 돈은 아래 PER_DAY가 막는다 */
export const PER_MIN: Record<string, number> = { '/extract': 10, '/route': 40, '/enrich': 10, '/transit': 40, '/places': 300, '/reason': 10 };

/** IP당 분당 상한. 기기당의 3배 — 사무실·모바일 NAT로 여럿이 한 IP를 쓰는 걸
    감안하되, 기기 id만 갈아끼우는 우회는 막는다 */
export const PER_MIN_IP: Record<string, number> = { '/extract': 30, '/route': 120, '/enrich': 30, '/transit': 120, '/places': 900, '/reason': 30 };

/**
 * 전역 일일 상한. 값의 근거는 2026-09-14 기준 각 API 요금표다.
 *
 * | 버킷 | 무료분 | 초과 단가 | 상한 |
 * |---|---|---|---|
 * | `/route:now`    | 일 10,000 | 8원 | 8,000 |
 * | `/route:future` | 일  5,000 | 8원 | 4,000 |
 * | `/enrich`       | 구글 Places — `enrich.ts`에 월 900 카운터가 따로 있다 | | 600 |
 * | `/extract`      | OpenAI, 무료분 없음 | 문장당 | 1,200 |
 * | `/transit`      | Google Routes — Compute Routes Essentials 월 10,000 무료·$5/1,000 (2026-09-15 공식 요금·SKU 문서 확인: TRANSIT·transitDetails·대안 경로는 Pro/Enterprise 트리거가 아님) | | 300 |
 * | `/places:web`    | 아래 참고 | | 7000 |
 * | `/places:native` | 아래 참고 | | 3000 |
 *
 * **`/places` 는 웹 데모와 네이티브 앱이 버킷을 나눠 쓴다.** 나누지 않으면 공개 데모를
 * 두들기는 누군가가 출시된 iOS 앱의 장소 검색을 같이 끈다 — 앱은 `kakaoRestKey` 를
 * 잃고 이 프록시 하나에만 매달려 있어서(`src/lib/places.ts`) 대체 경로가 없다.
 * 가르는 기준은 `Origin` 헤더다: 브라우저는 반드시 붙이고 네이티브는 안 붙인다.
 * 위조하면 웹 버킷에서 네이티브 버킷으로 넘어올 수 있지만, 그러려면 `ALLOWED_ORIGINS`
 * 허용목록에 없는 오리진을 써야 해서 CORS 로 응답을 못 읽는다. 완벽한 분리가 아니라
 * **네이티브 몫의 예약**이 목적이다.
 *
 * 합은 10,000 그대로다 — developers.kakao.com 로컬 검색은 2026-09-17 콘솔 확인을
 * 못 했고(에이전트는 로그인 불가) Task 8 규칙대로 확인 불가 시 10,000 폴백이다.
 * 확정값은 콘솔 확인 후 채운다.
 *
 * **이 숫자가 받아 내는 계획 건수는 `search()` 수가 아니라 HTTP 요청 수로 센다.**
 * 계획 한 건 최악 150 `search()`(`runPlan.ts:159`, 후보 3개×25×경유지 2)인데,
 * 업종 코드가 없는 질의(올리브영 같은 상호·브랜드)는 `src/lib/places.ts:245-251` 이
 * keyword 와 address 를 함께 부르므로 `search()` 하나가 요청 **2건**이다 —
 * 최악 300 요청이고, 7,000 이 받아 내는 건 23건(웹)·10건(네이티브)이다.
 * 정상 트래픽은 계획 1회당 12~26 요청이다. 그리고 이 카운터는 캐시 적중을
 * 세지 않는다(`index.ts` 의 /places 분기) — 세는 건 실제로 카카오에 나간 요청뿐이다.
 *
 * `/transit` 300/일은 월 10,000 무료분을 30일로 나눈 선이다. **이 숫자는 그대로 두되 뜻이 바뀌었다** —
 * 7단계(2026-09-16)부터 대중교통 계획 하나가 1회가 아니라 최대 10회를 쓴다(구간마다 한 번).
 * 즉 무료분 안에서 도는 대중교통 계획이 월 ~10,000건에서 **월 ~1,000건**이 됐다.
 * 이 상한을 올리는 건 무료분을 나가는 결정이라 값만 고쳐선 안 된다.
 *
 * 상한에 닿으면 429를 낸다. 앱은 서버 실패를 이미 로컬 목으로 폴백하므로
 * (`src/lib/intent.ts`) 화면이 죽지는 않는다 — 대신 추정값이 보인다.
 */
export const PER_DAY: Record<string, number> = {
  '/extract': 1200,
  /* 계획 하나당 최대 한 번, 그것도 '편한 순서'가 따로 있을 때만 부른다. /extract 를
     줄여 쪼개지 않는다 — 그건 비용 분할이 아니라 핵심 기능 감축이다(901번째 추출이
     429 를 받고 로컬 목으로 떨어진다). 상한에 닿으면 설명만 안 붙고 경로는 나온다 */
  '/reason': 200,
  '/route:now': 8000,
  '/route:future': 4000,
  '/enrich': 600,
  '/transit': 300,
  /* dailyBucket 이 만드는 버킷은 **반드시** 여기 있어야 한다 — overDailyCap 은
     cap 이 undefined 면 무조건 통과시키므로, 버킷만 나누고 상한을 빠뜨리면
     그 엔드포인트가 상한 없이 열린다. guard.test.ts 가 이 짝을 검사한다. */
  '/places:web': 7000,
  '/places:native': 3000,
};

const DAY_TTL_S = 2 * 24 * 60 * 60;
const MIN_TTL_S = 120;

/** 카카오·구글 할당량이 현지 시각 기준이라 UTC로 자르면 경계가 어긋난다 */
export function dayKey(bucket: string, now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `day:${bucket}:${kst.toISOString().slice(0, 10)}`;
}

/**
 * 일일 상한을 어느 통에서 셀지.
 *   /route  — 지금 출발과 미래운행이 무료분이 달라(10,000 / 5,000) 나눈다
 *   /places — 웹 데모와 네이티브 앱이 예산을 나눠 쓴다(PER_DAY 주석 참고).
 *             `origin` 은 요청의 Origin 헤더 — 브라우저만 붙인다
 * 여기서 만든 버킷은 전부 PER_DAY 에 항목이 있어야 한다.
 */
export function dailyBucket(path: string, departAt?: string, origin?: string | null): string {
  if (path === '/route') return departAt ? '/route:future' : '/route:now';
  if (path === '/places') return origin ? '/places:web' : '/places:native';
  return path;
}

/**
 * 상한을 넘었는지.
 *
 * **이미 넘었으면 카운터를 더 올리지 않는다.** 예전엔 막힌 요청도 세었다("시도는
 * 시도다"). 그 편이 부하를 정직하게 보여 주지만, KV 쓰기는 무료 플랜이 일 1,000회다 —
 * 상한에 닿은 뒤로도 요청마다 쓰면, 막느라 쓰는 쓰기가 계정의 KV 를 통째로 태우고
 * 그 순간부터 **모든 엔드포인트의 카운터가 같이 죽는다**(상한이 사라진다는 뜻이다).
 * 그래서 카운터의 뜻이 "시도 수"가 아니라 **"허용된 시도 수"**다. 값은 cap 에서
 * 멈추고, 쓰기 총량도 하루 cap 회를 넘지 않는다. 초과분을 알아야 하면 로그로 센다.
 */
export async function overDailyCap(kv: KVLike, bucket: string, now: Date): Promise<boolean> {
  const cap = PER_DAY[bucket];
  if (cap === undefined) return false;
  const key = dayKey(bucket, now);
  const used = Number((await kv.get(key)) ?? 0) + 1;
  if (used > cap) return true;
  await kv.put(key, String(used), { expirationTtl: DAY_TTL_S });
  return false;
}

/**
 * 기기당·IP당 분당 상한을 함께 본다.
 * 둘 중 하나라도 넘으면 막되, **카운터는 둘 다 본다** — 기기 상한에 걸린
 * 요청이 IP 카운터를 비껴가면 id만 갈아끼워 IP 상한을 영원히 피할 수 있다.
 * (각 카운터는 자기 상한 안에서만 올라간다 — overDailyCap 과 같은 이유다.)
 */
export async function rateLimited(
  kv: KVLike,
  path: string,
  deviceId: string,
  ip: string | null,
  now: Date,
): Promise<boolean> {
  const minute = Math.floor(now.getTime() / 60000);
  /* /places 는 기기 카운터를 생략한다. 계획 한 건에 최대 300 요청이 나가는
     엔드포인트라 분당 카운터의 KV 쓰기가 그대로 예산이 되는데, 기기 카운터가
     막아 주는 게 없다 — `x-device-id` 는 클라이언트가 정하는 값이라(위 3번)
     요청마다 새로 만들면 그만이다. 진짜 문지기는 IP 쪽이고, 그 하나만 세면
     이 엔드포인트의 분당 KV 쓰기가 절반이 된다.
     IP 헤더가 없을 때(로컬·테스트)만 기기 카운터로 돌아간다 — 분당 상한이
     통째로 사라지는 자리를 만들지 않는다. */
  const checks: [string, number][] = [];
  if (path !== '/places' || !ip) checks.push([`rl:${path}:${deviceId}:${minute}`, PER_MIN[path] ?? 10]);
  if (ip) checks.push([`rlip:${path}:${ip}:${minute}`, PER_MIN_IP[path] ?? 30]);

  let over = false;
  for (const [key, cap] of checks) {
    const hit = Number((await kv.get(key)) ?? 0) + 1;
    if (hit > cap) {
      over = true;
      continue; // 상한에 닿은 카운터에는 더 쓰지 않는다 — 막느라 쓰는 쓰기가 예산을 태운다
    }
    await kv.put(key, String(hit), { expirationTtl: MIN_TTL_S });
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

/**
 * /transit 응답 캐시 TTL. 배차가 시각에 묶이므로 짧다(10분). TMAP 약관(24시간 이상 저장 금지)도 만족.
 * 노리는 건 한 계획 안의 재조회 — 6단계가 같은 직행을 지하철우선으로 한 번 더 묻는다.
 */
export const TRANSIT_TTL_S = 600;

/** 좌표 4자리(약 11m), 출발 시각 10분 버킷, 공급자 포함. alternatives 는 뺀다 — 캐시는 항상
    최대치로 채우고 응답에서 자르므로, 이 값이 다르다고 상류를 두 번 부를 이유가 없다 */
export function transitCacheKey(req: TransitRequest, provider: string): string {
  const q = (n: number) => n.toFixed(4);
  const pts = `${q(req.origin.lat)},${q(req.origin.lng)};${q(req.destination.lat)},${q(req.destination.lng)}`;
  const depart = req.departAt ? req.departAt.slice(0, 15) : 'now'; // 'YYYY-MM-DDTHH:M' = 10분 버킷
  return `transit:${provider}:${pts}:${depart}:${req.preferSubway ? 's' : 'n'}`;
}

/**
 * 웹 데모는 브라우저에서 돈다. preflight(OPTIONS)에 답하지 않으면 모든 호출이
 * CORS로 막힌다 — 네이티브 앱에는 CORS가 없어서 여기까지 드러나지 않았다.
 *
 * **와일드카드로 열지 않는다.** `APP_TOKEN`이 브라우저 네트워크 탭에 그대로
 * 보이는 마당에, 오리진 제한이 남은 문지기다. 목록에 없는 오리진에는 헤더를
 * 붙이지 않고 — 브라우저가 알아서 막는다.
 */
export function corsHeaders(origin: string | null, allowedCsv: string | undefined): Record<string, string> {
  if (!origin) return {}; // 네이티브 앱은 Origin을 보내지 않는다
  const allowed = (allowedCsv ?? '').split(',').map(o => o.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type,x-app-token,x-device-id',
    'access-control-allow-methods': 'POST,OPTIONS',
    'access-control-max-age': '86400',
    // 오리진마다 응답이 다르므로 캐시가 섞이면 안 된다
    vary: 'Origin',
  };
}
