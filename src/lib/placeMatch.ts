/**
 * 카카오 매장과 구글 장소가 같은 곳인지 판단한다. 순수 함수.
 *
 * 여기서 틀리면 엉뚱한 가게의 평점이 붙는다. 그래서 애매하면 고르지 않는다 —
 * 신호가 없는 건 회복되지만(다른 축으로 점수를 낸다) 틀린 신호는 조용히 순위를 뒤집는다.
 */
import { haversineM } from './geo';

export type MatchPlaceInput = { name: string; lat: number; lng: number };

/** 이름 일치를 인정하는 최대 거리 */
const NAME_MAX_M = 150;
/** 이름이 안 맞아도 '하나뿐이면 그거'로 인정하는 거리 */
const ALONE_MAX_M = 60;
/** 접두 일치로 볼 최소 길이 */
const PREFIX_MIN = 4;

const BRANCH_SUFFIX = /(본점|지점|점)$/;

/**
 * 공백·괄호·특수문자를 지우고, 끝의 지점 접미사를 떼고, 영문은 소문자로.
 * "파리바게트 홍대점" → "파리바게트홍대"
 */
export function normalizeName(s: string): string {
  const stripped = s
    .toLowerCase()
    .replace(/[\s()[\]{}·・,.'""‘’\-_/\\&@!?~]/g, '');
  return stripped.replace(BRANCH_SUFFIX, '');
}

function distance(a: MatchPlaceInput, b: MatchPlaceInput): number {
  return haversineM({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
}

/** 한쪽이 다른 쪽으로 시작하고, 짧은 쪽이 PREFIX_MIN 이상이면 같은 이름으로 본다 */
function prefixMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= PREFIX_MIN && long.startsWith(short);
}

export function matchPlace(
  target: MatchPlaceInput,
  cands: readonly MatchPlaceInput[],
): number | null {
  const near = cands
    .map((c, i) => ({ i, c, d: distance(target, c) }))
    .filter(x => x.d <= NAME_MAX_M);
  if (near.length === 0) return null;

  const t = normalizeName(target.name);

  // 1) 정규화 이름이 같다 — 가장 가까운 것
  const exact = near.filter(x => normalizeName(x.c.name) === t).sort((a, b) => a.d - b.d);
  if (exact.length > 0) return exact[0].i;

  // 2) 접두 일치 — 가장 가까운 것
  const prefix = near.filter(x => prefixMatch(normalizeName(x.c.name), t)).sort((a, b) => a.d - b.d);
  if (prefix.length > 0) return prefix[0].i;

  // 3) 이름이 안 맞아도 아주 가까운 곳이 딱 하나면 그거다(지점명 표기만 다른 경우)
  const alone = near.filter(x => x.d <= ALONE_MAX_M);
  if (alone.length === 1) return alone[0].i;

  return null;
}
