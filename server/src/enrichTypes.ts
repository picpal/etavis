/**
 * /enrich 응답 타입. 원본은 src/lib/enrich/types.ts 이며 내용이 같아야 한다.
 * 서버가 앱 코드를 import 하지 않도록 사본을 둔다 — 앱은 expo 를 물고 있다.
 */
export type BlogSignal = {
  count90d: number;
  latestDaysAgo: number | null;
  weighted: number;
  source: 'naver' | 'kakao';
};
export type GoogleSignal = {
  rating: number;
  ratingCount: number;
  hours: { openMin: number; closeMin: number } | null;
  matchedName: string;
};
export type PlaceSignals = {
  blog?: BlogSignal;
  /** 블로그를 실제로 물어봤는가 — 미조회와 '언급 0'을 점수 모듈이 구분하려면 필요하다 */
  blogQueried?: boolean;
  google?: GoogleSignal;
  fetchedAt: string;
};
