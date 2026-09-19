/**
 * `/reason` 호출 — 계산된 두 안을 보내고 설명 한 줄을 받는다.
 *
 * **실패해도 던지지 않는다.** 설명은 장식이지 기능이 아니다 — 없으면 탭만 뜨면 되고,
 * 이것 하나 때문에 경로 화면이 에러를 띄우면 안 된다. 서버도 같은 약속을 지킨다
 * (`server/src/reason.ts` 가 LLM 실패를 삼키고 `{why:null}` 을 200 으로 돌려준다).
 *
 * `expo-constants` 를 여기서 읽지 않는다 — 읽으면 node 테스트에서 이 파일이 로드되지
 * 않는다. 값은 호출부가 넘긴다.
 */
export type ReasonOption = { stops: string[]; totalMin: number };
export type ReasonRequest = {
  text: string;
  mode: 'car' | 'walk' | 'transit';
  fast: ReasonOption;
  comfort: ReasonOption;
};

const DEFAULT_TIMEOUT_MS = 6000;

export function makeReasonClient(opts: {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): (req: ReasonRequest) => Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async req => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${opts.baseUrl.replace(/\/$/, '')}/reason`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-token': opts.appToken,
          'x-device-id': opts.deviceId,
        },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as unknown;
      // 서버 응답도 믿지 않는다 — 화면에 그대로 나가는 문자열이다
      const why = (body as { why?: unknown } | null)?.why;
      // trim 은 빈 문자열을 걸러내는 판정에만 쓰던 걸 반환값에도 적용한다 — 앞뒤 공백이
      // 남은 채로 그대로 나가면 화면에 눈에 띄는 여백이 생긴다
      return typeof why === 'string' && why.trim() ? why.trim() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
