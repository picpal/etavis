/**
 * /enrich 의 요청·응답 계약. 앱과 서버가 같이 읽는다. 런타임 코드 없음.
 * 설계: docs/superpowers/specs/2026-09-11-trend-candidates-design.md §2
 */

/** 블로그 최근 언급. weighted = 90일 안 글의 Σ exp(-age/45) */
export type BlogSignal = {
  count90d: number;
  latestDaysAgo: number | null;
  weighted: number;
  source: 'naver' | 'kakao';
};

/** 구글 Places. hours 는 오늘 요일 기준 분 단위 */
export type GoogleSignal = {
  rating: number;
  ratingCount: number;
  hours: { openMin: number; closeMin: number } | null;
  matchedName: string;
};

export type PlaceSignals = {
  blog?: BlogSignal;
  google?: GoogleSignal;
  /** ISO. 캐시 적중 여부를 개발 메뉴에서 보려고 남긴다 */
  fetchedAt: string;
};

export type EnrichPlace = { id: string; name: string; address: string; lat: number; lng: number };
export type EnrichRequest = { places: EnrichPlace[] };
export type EnrichResponse = {
  results: Record<string, PlaceSignals>;
  budget: { googleUsed: number; googleLeft: number };
};
