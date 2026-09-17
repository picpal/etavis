/**
 * 채팅 문장 → 의도 추출, 서버판.
 *
 * `intent.ts`의 로컬 목과 입출력이 같다(`server/src/schema.ts`의 `Intent`와
 * 필드까지 동일하다). 그래서 이 파일이 하는 일은 얇다 — 부르고, 실패하면 목으로 떨군다.
 *
 * **폴백을 여기 묻는다.** 실패 종류가 넷이고(네트워크 끊김 · 429 일일 상한 ·
 * 502 OpenAI · schema 거부) 화면이 그걸 각각 알아야 할 이유가 없다. 화면은
 * `source`만 보면 된다 — 목으로 떨어졌으면 사용자에게 그렇게 말해야 하니까.
 *
 * 검증은 서버가 `schema.ts`에서 이미 했다. 여기서 다시 좁히지 않고 **모양만**
 * 확인한다 — 중간에 낀 프록시가 HTML 오류 페이지를 돌려주는 경우를 거르는 용도다.
 */
import { extractIntent, type Intent, type IntentContext } from './intent';

export type ExtractSource = 'server' | 'local';
export type ExtractOutcome = { intent: Intent; source: ExtractSource };
export type ExtractFn = (text: string, ctx: IntentContext) => Promise<ExtractOutcome>;

/**
 * LLM 왕복이라 라우팅(4초)보다 길다.
 *
 * 실측 (2026-09-15, gpt-5.6-sol):
 *   짧은 문장 "올리브영 들르고 빵도"        4.05 · 4.26 · 4.46 · 5.71초
 *   긴 문장  "…문 연 약국도 두 곳 들러야 해"  8.20초
 *
 * 처음에 6초로 뒀다가 **정작 흥미로운 문장이 전부 목으로 떨어지는** 걸 봤다.
 * 짧은 문장은 어차피 5초 안에 끝나므로 이 상한은 느린 꼬리에만 걸린다 —
 * 거기서는 기다리는 편이 틀린 답보다 낫다. 넘기면 목이 즉시 답하고,
 * 화면이 "간단한 규칙으로 알아들었어요"라고 말한다.
 */
const DEFAULT_TIMEOUT_MS = 12000;

/** 서버가 좁힌 뒤라 필수 필드의 존재만 본다. 값 검증은 `server/src/schema.ts`의 몫 */
function looksLikeIntent(v: unknown): v is Intent {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.stops) &&
    typeof r.order === 'string' &&
    (r.arriveBy === null || typeof r.arriveBy === 'number') &&
    !!r.endpoints &&
    typeof r.endpoints === 'object' &&
    Array.isArray(r.ambiguous)
  );
}

export function localExtractFn(): ExtractFn {
  return async (text, ctx) => ({ intent: extractIntent(text, ctx), source: 'local' });
}

export function serverExtractFn(opts: {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  timeoutMs?: number;
  /** 테스트용 주입. 기본 globalThis.fetch — serverProvider.ts·enrichClient.ts와 같은 자리 */
  fetchFn?: typeof fetch;
  /** 테스트용 주입. 기본은 로컬 목 */
  fallback?: (text: string, ctx: IntentContext) => Intent;
  /**
   * 왜 떨어졌나. 화면은 `source` 만 보면 되지만 **로그는 알아야 한다** —
   * 2026-09-17 에 워커 secret 이 비어 `/extract` 가 502 를 내고 있었는데 넷을 전부
   * 조용히 삼키는 바람에 며칠간 아무도 몰랐다. `transitRouteProvider` 의
   * `onFallback` 과 같은 자리, 같은 이유다. 사유는 서로 구분된다:
   * `http <코드>` · `shape` · `throw <내용>`
   */
  onFallback?: (reason: string) => void;
}): ExtractFn {
  const fetchFn = opts.fetchFn ?? fetch;
  const fallback = opts.fallback ?? extractIntent;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (text, ctx) => {
    const local = (reason: string): ExtractOutcome => {
      opts.onFallback?.(reason);
      return { intent: fallback(text, ctx), source: 'local' };
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${opts.baseUrl.replace(/\/$/, '')}/extract`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-token': opts.appToken,
          'x-device-id': opts.deviceId,
        },
        // 사용자 문장은 지시가 아니라 데이터다 — 서버도 같은 규칙으로 감싼다
        body: JSON.stringify({
          text,
          context: { currentStops: ctx.currentStops, knownPlaces: ctx.knownPlaces ?? [] },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return local(`http ${res.status}`);
      const body = (await res.json()) as unknown;
      return looksLikeIntent(body) ? { intent: body, source: 'server' } : local('shape');
    } catch (e) {
      return local(`throw ${String(e).slice(0, 120)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}
