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
  search(query: string, near: { latitude: number; longitude: number } | null, radiusM?: number): Promise<PlaceLike[]>;
};

export type FallbackOptions = {
  /** 웹에서만 true. 네이티브는 기존 동작(던지기)을 유지한다 */
  enabled?: boolean;
  onFallback?: (err: unknown) => void;
};

export function withMockFallback<P extends SearchProviderLike>(
  primary: P,
  fallback: SearchProviderLike,
  opts: FallbackOptions = {},
): P | SearchProviderLike {
  if (!opts.enabled) return primary;
  if (primary.key === fallback.key) return primary;
  return {
    key: primary.key,
    async search(query, near, radiusM) {
      try {
        return await primary.search(query, near, radiusM);
      } catch (e) {
        opts.onFallback?.(e);
        return fallback.search(query, near, radiusM);
      }
    },
  };
}
