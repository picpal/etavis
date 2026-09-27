/**
 * 리포트가 덮을 시간 구간. 순수 함수 — 시계는 밖에서 넣는다.
 *
 * 두 가지가 틀리기 쉬워서 따로 뺐다.
 *  1. **직전 한 시간**을 봐야 한다. cron 이 05:03 에 돌면서 05:00~06:00 을 세면
 *     3분치만 세고 나머지를 버린다.
 *  2. 워커는 UTC 로 돌고 보는 사람은 KST 다. 라벨을 UTC 날짜로 적으면 자정 근처에서
 *     하루가 어긋난다(15:00 UTC = 다음 날 00:00 KST).
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const p2 = (n: number) => String(n).padStart(2, '0');

/** Analytics Engine SQL 이 받는 'YYYY-MM-DD HH:mm:ss' (UTC) */
function sqlTime(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
  );
}

export type Window = {
  /** 이번 리포트 구간 시작 (UTC, SQL 형식) */
  from: string;
  /** 구간 끝 (UTC, SQL 형식) */
  to: string;
  /** 직전 구간 시작 — 증감 비교용 */
  prevFrom: string;
  /** 사람이 읽는 라벨 (KST) */
  label: string;
};

/** 직전 `hours` 시간. 하루 리포트는 hours=24 — 비교 대상도 그만큼 앞으로 민다 */
export function hourWindow(now: Date, hours = 1): Window {
  const span = hours * HOUR_MS;
  const to = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const from = new Date(to.getTime() - span);
  const prevFrom = new Date(from.getTime() - span);

  // 라벨은 KST 로 — 날짜는 구간 시작 기준이라 자정을 넘어도 하루가 밀리지 않는다
  const kFrom = new Date(from.getTime() + KST_OFFSET_MS);
  const kTo = new Date(to.getTime() + KST_OFFSET_MS);
  const day = (d: Date) => `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  // 한 시간을 넘으면 끝 날짜가 달라지므로 끝에도 날짜를 붙인다
  const label =
    `${day(kFrom)} ${p2(kFrom.getUTCHours())}:00~` +
    `${hours > 1 ? `${day(kTo)} ` : ''}${p2(kTo.getUTCHours())}:00`;

  return { from: sqlTime(from), to: sqlTime(to), prevFrom: sqlTime(prevFrom), label };
}
