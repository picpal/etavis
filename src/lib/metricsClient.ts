/**
 * 집계 비콘의 **전송 부분**. 판단은 `metrics.ts`(순수)에 있다.
 *
 * 사람의 정체는 `Constants.sessionId` — 모듈 로드 때 한 번 만들어지므로 **페이지를 열
 * 때마다 새 사람**이 된다(새로고침도 새 사람). 로그인도 쿠키도 없고 IP 도 보내지 않는다.
 * 앱의 다른 호출이 `x-device-id` 로 쓰는 값과 같아 집계가 어긋나지 않는다.
 *
 * `metricsUrl` 은 웹 데모 체크아웃의 `.env` 에만 있다 — 앱 빌드에서는 저절로 무동작이다.
 * 실패해도 조용하다. 집계 때문에 화면이 멈추면 본말이 전도된다.
 */
import Constants from 'expo-constants';
import { metricsRequest, type MetricEvent } from './metrics';

/** 쏘고 잊는다. 절대 던지지 않고 아무것도 기다리지 않는다 */
export function track(event: MetricEvent): void {
  const extra = (Constants.expoConfig?.extra ?? {}) as { metricsUrl?: string; appToken?: string };
  const req = metricsRequest(
    { url: extra.metricsUrl ?? '', token: extra.appToken ?? '', session: Constants.sessionId ?? '' },
    event,
  );
  if (!req) return;
  void fetch(req.url, req.init).catch(() => {});
}
