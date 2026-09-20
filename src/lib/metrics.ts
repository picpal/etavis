/**
 * 데모 사용 집계 비콘의 **판단 부분** — 무엇을 어디로 보낼지 정한다.
 *
 * expo·react-native 를 물지 않는다. 물으면 node 테스트 러너가 RN 의 flow 문법에서
 * 변환에 실패한다(`intent.ts` / `intentClient.ts` 와 같은 갈라짐).
 * 실제 전송과 Constants 읽기는 `metricsClient.ts` 에 있다.
 */

export type MetricEvent = 'hit' | 'ask' | 'plan';

export type MetricsConfig = {
  /** 비어 있으면 아무것도 보내지 않는다 — 앱 빌드·메인 체크아웃의 기본 상태 */
  url: string;
  token: string;
  /** 페이지를 열 때마다 새로 생기는 값(Constants.sessionId). 이게 곧 "한 명"이다 */
  session: string;
};

export function metricsRequest(
  cfg: MetricsConfig,
  event: MetricEvent,
): { url: string; init: RequestInit } | null {
  if (!cfg.url || !cfg.session) return null;
  return {
    url: `${cfg.url.replace(/\/+$/, '')}/e`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-token': cfg.token },
      body: JSON.stringify({ s: cfg.session, e: event }),
      // 진입 비콘은 첫 화면에서 쏘는데, 바로 닫으면 평범한 fetch 는 취소된다
      keepalive: true,
    },
  };
}
