/**
 * etavia-metrics — 데모 방문·질문 집계와 시간당 Slack 리포트.
 *
 * **왜 따로 있나.** `etavia`(API)는 iOS 앱과 공유라 여기서만 고치면 다음에 main 에서
 * 배포할 때 사라진다(`/places` 404 를 그렇게 두 번 겪었다). `etavia-demo`(정적 자산)는
 * 스크립트가 없다. 이 워커가 죽어도 데모는 멀쩡하다 — 그게 분리한 이유다.
 *
 * **사람을 어떻게 세나.** 웹의 `x-device-id` 는 expo-constants 의 `sessionId` 이고 모듈
 * 로드 때 한 번 만들어진다 — 페이지를 열 때마다 새 값이라 "진입 한 번 = 한 명"이 그대로
 * 성립한다(새로고침도 새 사람). 로그인도 쿠키도 없고 IP 도 저장하지 않는다.
 *
 * 저장은 Analytics Engine 이다. KV 는 쓰지 않는다 — 무료 1,000 회/일을 `etavia` 의
 * 과금 방어선(guard.ts)이 쓰고 있어서, 집계로 태우면 레이트 리미터가 먼저 죽는다.
 */
import { aggregate, type Row } from './aggregate';
import { buildReport } from './slack';
import { hourWindow } from './window';

export type Env = {
  METRICS: AnalyticsEngineDataset;
  ALLOWED_ORIGINS: string;
  CF_ACCOUNT_ID: string;
  DEMO_URL: string;
  /** wrangler secret put — 파일에 쓰지 않는다 */
  APP_TOKEN: string;
  CF_API_TOKEN: string;
  SLACK_WEBHOOK_URL: string;
};

const EVENTS = new Set(['hit', 'ask', 'plan']);
const DATASET = 'etavia_metrics';

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  // 와일드카드로 열지 않는다. 허용 목록에 있는 오리진에만 헤더를 붙인다
  const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-app-token',
    'access-control-max-age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin'), env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health') return Response.json({ ok: true }, { headers: cors });
    if (url.pathname !== '/e' || request.method !== 'POST') {
      return Response.json({ error: 'not found' }, { status: 404, headers: cors });
    }

    // 앱과 같은 게이트. 누구나 부를 수 있으면 숫자를 부풀리거나 AE 사용량을 태울 수 있다
    if (request.headers.get('x-app-token') !== env.APP_TOKEN) {
      return Response.json({ error: 'unauthorized' }, { status: 401, headers: cors });
    }

    let body: { s?: unknown; e?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400, headers: cors });
    }

    const session = typeof body.s === 'string' ? body.s.slice(0, 64) : '';
    const event = typeof body.e === 'string' ? body.e : '';
    if (!session || !EVENTS.has(event)) {
      return Response.json({ error: 'bad event' }, { status: 400, headers: cors });
    }

    env.METRICS.writeDataPoint({ indexes: [session], blobs: [event, session], doubles: [1] });
    return new Response(null, { status: 204, headers: cors });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(report(env, new Date()));
  },
};

/** AE 에 SQL 을 던져 행을 받는다. 실패하면 빈 배열 — 리포트가 안 오는 것보다 0 이 낫다 */
async function query(env: Env, from: string, to: string): Promise<Row[]> {
  const sql =
    `SELECT blob1 AS event, blob2 AS session, sum(_sample_interval) AS n ` +
    `FROM ${DATASET} ` +
    `WHERE timestamp >= toDateTime('${from}') AND timestamp < toDateTime('${to}') ` +
    `GROUP BY event, session`;

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
    body: sql,
  });
  if (!res.ok) {
    console.error(`[metrics] AE 조회 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const json = (await res.json()) as { data?: { event: string; session: string; n: number | string }[] };
  return (json.data ?? []).map(r => ({ event: r.event, session: r.session, n: Number(r.n) || 0 }));
}

export async function report(env: Env, now: Date): Promise<void> {
  const w = hourWindow(now);
  const [rows, prevRows] = await Promise.all([query(env, w.from, w.to), query(env, w.prevFrom, w.from)]);

  const payload = buildReport({
    stats: aggregate(rows),
    // 직전 시간에 데이터가 아예 없으면 비교를 지어내지 않는다
    prevVisitors: prevRows.length ? aggregate(prevRows).visitors : null,
    windowLabel: w.label,
    demoUrl: env.DEMO_URL,
  });

  const res = await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`[metrics] Slack 전송 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
