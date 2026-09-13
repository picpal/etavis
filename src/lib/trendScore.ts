/**
 * 후보 추천 점수. 순수 함수라 네트워크·UI 없이 시험한다.
 *
 * 한 소스에 기대지 않는다. 세 축(경로 적합도·평점 품질·최근 언급)의 가중합이다.
 * 그래서 블로그가 죽어도, 구글이 예산을 다 써도 순위는 계속 나온다.
 *
 * 축은 슬롯 단위로 켜지거나 꺼진다. 한 후보라도 관측됐으면 축을 켜고, 관측 못 한
 * 후보는 그 슬롯 관측값의 중앙값으로 채운다. 아무도 관측 못 했으면 축을 통째로 끄고
 * 모든 후보에 대해 똑같이 재정규화한다.
 *
 * 후보마다 따로 재정규화하면 안 된다. 그러면 없는 축이 "그 후보의 나머지 축과 같은
 * 값"으로 채워져, 경로가 가까운 미조회 후보일수록 공짜 보너스가 커진다 — 측정 안 한
 * 가게가 측정해서 평점이 낮게 나온 가게를 이기는 결함이었다.
 *
 * 순위는 전부 여기서 정한다. LLM은 '무엇을 찾을지'만 뽑는다(AGENTS.md).
 */

export type TrendInput = {
  id: string;
  /** 플래너 추정 — 이 후보로 바꿨을 때 늘어나는 분 */
  addedMin: number;
  blog?: { weighted: number };
  /**
   * 블로그를 실제로 물어봤는가. 물어봤는데 신호가 없는 것(전국 브랜드라 전국 집계로
   * 뭉개짐)과 아예 안 물어본 것을 구분한다 — 미조회를 '언급 0'으로 세면 buzz 축이
   * 엉뚱하게 꺼진다. 서버가 이 값을 안 보내면 blog 가 있는 후보만 조회분으로 본다.
   */
  blogQueried?: boolean;
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
/** 조회분 중 이 비율 이상이 언급 0이면 색인 공백으로 보고 축을 버린다 */
const BUZZ_BLIND_RATIO = 0.8;
/** 조회분 중 신호가 온 비율이 이보다 낮으면 축을 믿지 않는다 */
const BUZZ_MIN_COVERAGE = 0.8;
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

/** 켜진 축만 모아 가중평균. fit 은 항상 켜져 있으므로 분모가 0이 되지 않는다 */
function blend(parts: { w: number; v: number }[]): number {
  const total = parts.reduce((s, p) => s + p.w, 0);
  if (total === 0) return 0;
  return parts.reduce((s, p) => s + p.w * p.v, 0) / total;
}

/** 관측값의 중앙값 — 미관측 후보를 채우는 값. 빈 배열이면 축이 꺼지므로 부르지 않는다 */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function scoreTrend(inputs: readonly TrendInput[]): TrendScored[] {
  if (inputs.length === 0) return [];

  const maxAdded = Math.max(FIT_FLOOR_MIN, ...inputs.map(i => i.addedMin));

  // 조회분 중 0이 너무 많거나, 조회했는데 신호가 온 비율이 낮으면 색인 공백이다.
  // 없는 걸 '인기 없음'으로 읽으면 순위가 거꾸로 간다. 분모는 후보 전체가 아니라
  // 실제로 물어본 후보다 — 서버가 30곳 중 12곳만 묻기 때문이다.
  const anyQueriedFlag = inputs.some(i => i.blogQueried);
  const queried = anyQueriedFlag ? inputs.filter(i => i.blogQueried) : inputs.filter(i => i.blog);
  const observed = queried.filter(i => i.blog);
  const coverage = queried.length > 0 ? observed.length / queried.length : 0;
  const zeroRate = observed.length > 0
    ? observed.filter(i => i.blog!.weighted === 0).length / observed.length
    : 1;
  const buzzBlind = observed.length === 0
    || coverage < BUZZ_MIN_COVERAGE
    || zeroRate >= BUZZ_BLIND_RATIO;

  // 축을 켤지 끌지는 슬롯 전체를 보고 한 번 정한다. 켜면 미관측 후보는 중앙값으로 채운다
  const observedQuality = inputs.map(i => (i.google ? qualityOf(i.google) : null))
    .filter((v): v is number => v != null);
  const observedBuzz = inputs.map(i => (!buzzBlind && i.blog ? buzzOf(i.blog.weighted) : null))
    .filter((v): v is number => v != null);
  const qualityPrior = observedQuality.length > 0 ? medianOf(observedQuality) : null;
  const buzzPrior = observedBuzz.length > 0 ? medianOf(observedBuzz) : null;

  const scored = inputs.map((i, idx) => {
    const fit = fitOf(i.addedMin, maxAdded);
    const quality = i.google ? qualityOf(i.google) : null;
    const buzz = !buzzBlind && i.blog ? buzzOf(i.blog.weighted) : null;

    // 가중치 구성은 슬롯 안 모든 후보가 똑같다 — 채운 값도 축이 켜졌으면 그대로 쓴다
    const parts = [{ w: W_FIT, v: fit }];
    if (qualityPrior != null) parts.push({ w: W_QUALITY, v: quality ?? qualityPrior });
    if (buzzPrior != null) parts.push({ w: W_BUZZ, v: buzz ?? buzzPrior });

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
