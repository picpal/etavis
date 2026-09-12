/**
 * 블로그 글 날짜 목록 → 최근성 신호. 순수 함수라 UI·네트워크 없이 시험한다.
 *
 * 전 기간 총 건수(네이버 total)는 쓰지 않는다. 오래된 맛집이 요즘 뜨는 곳을
 * 이기면 이 기능의 의미가 없다. 90일 창 안에서 최근일수록 크게 센다.
 */
import type { BlogSignal } from './types';

const WINDOW_DAYS = 90;
const HALF_LIFE_DAYS = 45;
/** 네이버는 display=100, 카카오는 size=50. 어느 쪽이든 이 이상은 안 들어온다 */
const MAX_ITEMS = 100;

/** 'YYYYMMDD' → UTC 자정 ms. 형식이 아니면 null */
function ymdToMs(ymd: string): number | null {
  if (!/^\d{8}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  // Date.UTC 는 2월 30일을 3월 2일로 굴려버린다 — 되돌려 확인한다
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

const DAY_MS = 86_400_000;

export function countBlog(
  postdates: readonly string[],
  todayYmd: string,
  source: 'naver' | 'kakao',
): BlogSignal {
  const today = ymdToMs(todayYmd);
  const ages: number[] = [];
  if (today != null) {
    for (const s of postdates.slice(0, MAX_ITEMS)) {
      const ms = ymdToMs(s);
      if (ms == null) continue;
      const age = Math.round((today - ms) / DAY_MS);
      // 음수(미래)는 버린다. 기기·서버 시계가 어긋나도 가중치가 1을 넘지 않는다
      if (age < 0 || age > WINDOW_DAYS) continue;
      ages.push(age);
    }
  }
  const weighted = ages.reduce((sum, a) => sum + Math.exp(-a / HALF_LIFE_DAYS), 0);
  return {
    count90d: ages.length,
    latestDaysAgo: ages.length ? Math.min(...ages) : null,
    weighted,
    source,
  };
}

/** ISO 8601('2026-09-12T10:00:00.000+09:00') → 'YYYYMMDD'. 카카오 응답용 */
export function isoToYmd(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

/** Date → 'YYYYMMDD' (UTC 기준). 호출부가 '오늘'을 만들 때 쓴다 */
export function toYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}
