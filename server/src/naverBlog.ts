/**
 * NAVER API HUB 블로그 검색.
 *   GET https://naverapihub.apigw.ntruss.com/search/v1/blog
 * 2026-09-12 실제 호출로 엔드포인트·헤더·응답 필드를 확인했다.
 *
 * 질의어는 카카오 place_name 그대로다. 행정동("서교동")을 붙이면 안 된다 —
 * 블로거는 "홍대"라고 쓰지 "서교동"이라고 쓰지 않아서 건수가 20분의 1로 뭉개진다.
 * 실측 근거는 설계 문서 §2.1.3.
 */
import type { BlogSignal } from './enrichTypes';

const ENDPOINT = 'https://naverapihub.apigw.ntruss.com/search/v1/blog';
/** 이보다 크면 단일 지점이 아니라 전국 집계다("파리바게트" 289,993) */
const TOTAL_NATIONAL = 20_000;
const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 45;
const DAY_MS = 86_400_000;

function ymdToMs(ymd: unknown): number | null {
  if (typeof ymd !== 'string' || !/^\d{8}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** 응답 → 신호. 네트워크와 분리해 시험한다 */
export function parseNaverBlog(raw: unknown, todayYmd: string): BlogSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.total !== 'number' || !Number.isFinite(r.total)) return null;
  if (!Array.isArray(r.items)) return null;
  if (r.total > TOTAL_NATIONAL) return null;

  const today = ymdToMs(todayYmd);
  if (today == null) return null;

  const ages: number[] = [];
  for (const it of r.items.slice(0, 100)) {
    const ms = ymdToMs((it as Record<string, unknown>)?.postdate);
    if (ms == null) continue;
    const age = Math.round((today - ms) / DAY_MS);
    if (age < 0 || age > WINDOW_DAYS) continue;
    ages.push(age);
  }
  return {
    count90d: ages.length,
    latestDaysAgo: ages.length ? Math.min(...ages) : null,
    weighted: ages.reduce((s, a) => s + Math.exp(-a / HALF_LIFE_DAYS), 0),
    source: 'naver',
  };
}

export async function fetchNaverBlog(
  name: string,
  keyId: string,
  key: string,
  f: typeof fetch,
  todayYmd: string,
): Promise<BlogSignal | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', name);
  url.searchParams.set('sort', 'date');
  url.searchParams.set('display', '100');
  try {
    const res = await f(url.toString(), {
      headers: { 'X-NCP-APIGW-API-KEY-ID': keyId, 'X-NCP-APIGW-API-KEY': key },
    });
    if (!res.ok) return null; // 429·5xx 는 재시도하지 않는다. 이 후보만 신호가 없을 뿐이다
    return parseNaverBlog(await res.json(), todayYmd);
  } catch {
    return null;
  }
}
