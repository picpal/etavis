/**
 * Analytics Engine 이 준 행을 시간당 지표 하나로 접는다. 순수 함수 — 네트워크·바인딩 없음.
 *
 * 세션 = 사람이다. 웹의 `x-device-id` 는 expo-constants 의 `sessionId` 이고, 이 값은
 * 모듈 로드 때 한 번 만들어지므로 **페이지를 열 때마다 새로 생긴다**(새로고침도 새 사람).
 * 로그인이 없는 데모에서 "진입 한 번 = 한 명"이라는 정의가 그대로 성립한다.
 */

export type Row = { event: string; session: string; n: number };

export type Stats = {
  /** 이 시간에 관측된 사람 수 */
  visitors: number;
  /** 질문(대화 추출) 총 횟수 */
  asks: number;
  /** 그중 질문을 한 사람 수 */
  askers: number;
  /** 계획을 확정한 횟수 */
  plans: number;
  /** 질문한 사람 1인당 평균 질문 수 (소수 첫째 자리) */
  avgAsks: number;
  /** 한 사람이 던진 최다 질문 수 */
  maxAsks: number;
};

export function aggregate(rows: Row[]): Stats {
  const sessions = new Set<string>();
  const asksBySession = new Map<string, number>();
  let asks = 0;
  let plans = 0;

  for (const r of rows) {
    // 이벤트 이름을 몰라도 사람은 센다 — 이벤트를 늘렸다 되돌릴 때 리포트가 깨지지 않게
    sessions.add(r.session);
    if (r.event === 'ask') {
      asks += r.n;
      asksBySession.set(r.session, (asksBySession.get(r.session) ?? 0) + r.n);
    } else if (r.event === 'plan') {
      plans += r.n;
    }
  }

  const perAsker = [...asksBySession.values()];
  return {
    visitors: sessions.size,
    asks,
    askers: perAsker.length,
    plans,
    // 전체 방문자로 나누면 열고 나간 사람이 평균을 끌어내려 질문자의 행동이 안 보인다
    avgAsks: perAsker.length ? Math.round((asks / perAsker.length) * 10) / 10 : 0,
    maxAsks: perAsker.length ? Math.max(...perAsker) : 0,
  };
}
