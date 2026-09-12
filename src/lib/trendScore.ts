/**
 * 후보 추천 점수. 순수 함수라 네트워크·UI 없이 시험한다.
 *
 * 한 소스에 기대지 않는다. 세 축(경로 적합도·평점 품질·최근 언급)의 가중합이고,
 * 없는 축은 빼고 남은 가중치를 다시 나눈다. 그래서 블로그가 죽어도, 구글이
 * 예산을 다 써도 순위는 계속 나온다.
 *
 * 순위는 전부 여기서 정한다. LLM은 '무엇을 찾을지'만 뽑는다(AGENTS.md).
 */

export type TrendInput = {
  id: string;
  /** 플래너 추정 — 이 후보로 바꿨을 때 늘어나는 분 */
  addedMin: number;
  blog?: { weighted: number };
  google?: { rating: number; ratingCount: number };
};

export type TrendScored = {
  id: string;
  score: number;
  fit: number;
  quality: number | null;
  buzz: number | null;
  /** 카드 부제에 ' · '로 잇는다 */
  reasons: string[];
  /** '요즘 인기' 배지 */
  hot: boolean;
};

const W_FIT = 0.4;
const W_QUALITY = 0.35;
const W_BUZZ = 0.25;

/** 이 값에서 fit 이 0이 된다. 전부 +3분이면 다 같은 값이라 다른 축이 순서를 만든다 */
const FIT_FLOOR_MIN = 10;
/** 리뷰 이만큼이면 품질 신뢰가 포화 */
const REVIEW_SATURATION = 200;
/** 90일 가중 언급이 이만큼이면 buzz 만점. 실측 분포(0~35) 기준 */
const BUZZ_SATURATION = 10;
/** 후보 중 이 비율 이상이 언급 0이면 색인 공백으로 보고 축을 버린다 */
const BUZZ_BLIND_RATIO = 0.8;
const HOT_BUZZ = 0.6;
const HOT_RANK = 3;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function fitOf(addedMin: number, maxAdded: number): number {
  return clamp01(1 - addedMin / maxAdded);
}

function qualityOf(g: { rating: number; ratingCount: number }): number {
  const trust = Math.min(1, Math.log10(1 + Math.max(0, g.ratingCount)) / Math.log10(1 + REVIEW_SATURATION));
  return clamp01(g.rating / 5) * trust;
}

function buzzOf(weighted: number): number {
  return Math.min(1, Math.log10(1 + Math.max(0, weighted)) / Math.log10(1 + BUZZ_SATURATION));
}

/** 있는 축만 모아 가중평균. 축이 하나도 없으면 fit 만 남으므로 항상 하나는 있다 */
function blend(parts: { w: number; v: number }[]): number {
  const total = parts.reduce((s, p) => s + p.w, 0);
  if (total === 0) return 0;
  return parts.reduce((s, p) => s + p.w * p.v, 0) / total;
}

export function scoreTrend(inputs: readonly TrendInput[]): TrendScored[] {
  if (inputs.length === 0) return [];

  const maxAdded = Math.max(FIT_FLOOR_MIN, ...inputs.map(i => i.addedMin));

  // 블로그 신호를 가진 후보 중 0이 너무 많으면 색인 공백이다.
  // 없는 걸 '인기 없음'으로 읽으면 순위가 거꾸로 간다.
  const withBlog = inputs.filter(i => i.blog);
  const zeros = withBlog.filter(i => i.blog!.weighted === 0).length;
  const buzzBlind = withBlog.length === 0 || zeros / withBlog.length >= BUZZ_BLIND_RATIO;

  const scored = inputs.map((i, idx) => {
    const fit = fitOf(i.addedMin, maxAdded);
    const quality = i.google ? qualityOf(i.google) : null;
    const buzz = !buzzBlind && i.blog ? buzzOf(i.blog.weighted) : null;

    const parts = [{ w: W_FIT, v: fit }];
    if (quality != null) parts.push({ w: W_QUALITY, v: quality });
    if (buzz != null) parts.push({ w: W_BUZZ, v: buzz });

    const reasons: string[] = [];
    if (i.google) reasons.push(`구글 ${i.google.rating.toFixed(1)} (${i.google.ratingCount})`);
    if (buzz != null && i.blog!.weighted > 0) reasons.push(`최근 블로그 ${Math.round(i.blog!.weighted)}건`);

    return { id: i.id, score: blend(parts), fit, quality, buzz, reasons, hot: false, _idx: idx, _added: i.addedMin };
  });

  scored.sort((a, b) => b.score - a.score || a._added - b._added || a._idx - b._idx);

  return scored.map(({ _idx, _added, ...rest }, rank) => ({
    ...rest,
    hot: rest.buzz != null && rest.buzz >= HOT_BUZZ && rank < HOT_RANK,
  }));
}

/** 구글에 물어볼 후보를 고른다 — 경로 적합도와 언급만으로 상위 10개 */
const PRESCORE_TOP = 10;
const PRE_W_FIT = 0.6;
const PRE_W_BUZZ = 0.4;

export function prescore(inputs: readonly TrendInput[]): string[] {
  if (inputs.length <= PRESCORE_TOP) return inputs.map(i => i.id);
  const maxAdded = Math.max(FIT_FLOOR_MIN, ...inputs.map(i => i.addedMin));
  return [...inputs]
    .map((i, idx) => ({
      id: i.id,
      idx,
      added: i.addedMin,
      v: PRE_W_FIT * fitOf(i.addedMin, maxAdded) + PRE_W_BUZZ * buzzOf(i.blog?.weighted ?? 0),
    }))
    .sort((a, b) => b.v - a.v || a.added - b.added || a.idx - b.idx)
    .slice(0, PRESCORE_TOP)
    .map(x => x.id);
}
