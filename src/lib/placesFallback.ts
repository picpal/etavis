/**
 * 장소 검색 실패를 목 카탈로그로 받아낸다. 웹 데모에서만 켠다.
 *
 * 지금은 kakaoFetch 가 던지면 runPlan 이 FAIL(search) 로 계획 전체를 끝낸다.
 * 공개 링크에서는 그게 곧 '데모가 죽었다'가 된다.
 *
 * **네이티브에서는 끈다.** 부산에서 '올리브영'을 찾았는데 목 카탈로그의 여의도 매장이
 * 나오면 조용한 거짓말이 된다. 실패 배너가 정직하다. 데모는 준비된 지역에서만 돌므로
 * 목이 답이 될 수 있다.
 *
 * 타입을 places.ts 에서 가져오면 순환 참조가 되므로 구조적 타입을 여기 둔다.
 */
export type PlaceLike = {
  id: string;
  name: string;
  address: string;
  coord: { latitude: number; longitude: number };
};

export type SearchProviderLike = {
  readonly key: string;
  /** `intent` 는 그대로 흘려보낸다 — 폴백은 정렬 규칙을 바꾸는 자리가 아니다 */
  search(
    query: string,
    near: { latitude: number; longitude: number } | null,
    intent: 'byName' | 'nearby',
    radiusM?: number,
  ): Promise<PlaceLike[]>;
};

export type FallbackOptions = {
  /** 웹에서만 true. 네이티브는 기존 동작(던지기)을 유지한다 */
  enabled?: boolean;
  onFallback?: (err: unknown) => void;
  /** 테스트가 시계를 제어할 수 있게. 프로덕션은 기본값(Date.now)을 그대로 쓴다 */
  now?: () => number;
};

/**
 * 차단기 쿨다운. 계획 계산 한 번이 12초 예산 안에서 끝나므로(runPlan.ts DEFAULT_TIMEOUT_MS)
 * 실패 한 번이 그 계산 전체를 덮는다. corridorSearch.ts 의 반경 루프는 라운드마다 다시
 * primary 를 때리는데, 공급자가 죽어 있으면 그게 라운드 수만큼 곱해져 50건짜리 난타가 된다.
 *
 * 영구 래치로 두면 일시적 장애 한 번이 재배포 전까지 모든 방문자의 실검색을 죽인다 —
 * 4주짜리 공개 데모에선 그게 더 나쁘다. 60초면 그 계산 한 번은 확실히 덮으면서도,
 * 다음 방문자(혹은 같은 방문자의 다음 계산)에선 자연히 다시 시도한다.
 */
export const BREAKER_COOLDOWN_MS = 60_000;

export function withMockFallback<P extends SearchProviderLike>(
  primary: P,
  fallback: SearchProviderLike,
  opts: FallbackOptions = {},
): P | SearchProviderLike {
  if (!opts.enabled) return primary;
  if (primary.key === fallback.key) return primary;
  const now = opts.now ?? Date.now;
  let downUntil = 0;
  return {
    key: primary.key,
    async search(query, near, intent, radiusM) {
      if (now() < downUntil) {
        opts.onFallback?.(new Error(`${primary.key} 차단기 열림 — 쿨다운 중`));
        return fallback.search(query, near, intent, radiusM);
      }
      try {
        return await primary.search(query, near, intent, radiusM);
      } catch (e) {
        downUntil = now() + BREAKER_COOLDOWN_MS;
        opts.onFallback?.(e);
        return fallback.search(query, near, intent, radiusM);
      }
    },
  };
}
