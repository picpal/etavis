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
import { askWhenNothingFound, extractIntent, type Intent, type IntentContext } from './intent';

export type ExtractSource = 'server' | 'local';
export type ExtractOutcome = { intent: Intent; source: ExtractSource };
export type ExtractFn = (text: string, ctx: IntentContext) => Promise<ExtractOutcome>;

/**
 * LLM 왕복이라 라우팅(4초)보다 길다.
 *
 * 실측 (2026-09-17, gpt-5.6-terra, 대표 34케이스):
 *   중앙 2.5초 · p90 6.3초 · 최대 13.7초
 * 참고 — 같은 표본에서 gpt-5.6-sol 은 중앙 8.4초 · p90 21.7초 · 최대 29.4초였다.
 * (2026-09-15 에 적어둔 4.05~8.20초는 그 뒤 모델이 느려져 더는 맞지 않는다)
 *
 * 처음에 6초, 다음에 12초로 뒀다가 **정작 흥미로운 문장이 전부 목으로 떨어지는**
 * 걸 두 번 봤다. 두 번째는 며칠간 모르고 지나갔다 — 폴백 사유를 아무데도 안
 * 남기고 있었기 때문이다(그래서 onFallback 이 생겼다).
 *
 * 30초는 terra 최댓값의 두 배 남짓이다. 넉넉한 이유: 이 상한에 걸린다는 건
 * 사용자가 그만큼 기다렸는데 **결국 틀린 답을 받는다**는 뜻이라, 상한을 조이는
 * 것은 대기를 줄이는 게 아니라 대기를 낭비로 만든다. 중앙값이 2.5초라 이
 * 상한은 드문 꼬리에만 걸린다. 넘기면 목이 즉시 답하고, 화면이 "간단한 규칙으로
 * 알아들었어요"라고 말한다.
 */
const DEFAULT_TIMEOUT_MS = 30000;

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
      if (!looksLikeIntent(body)) return local('shape');
      /* 모양이 맞아도 **비어 있을 수 있다.** LLM 이 경유지를 0건으로 내면 화면엔
         "알아들었어요"만 뜨고 칩도 질문도 없다 — 인사와 구별이 안 된다.
         목(`extractIntent`)에만 있던 판정을 여기서도 건다. 로컬로 떨어뜨리지는
         않는다: 서버가 답을 하긴 했고, 되물을 말만 없는 것이다 */
      return { intent: askWhenNothingFound(text, body), source: 'server' };
    } catch (e) {
      return local(`throw ${String(e).slice(0, 120)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}
