/**
 * 시간 출처에 따른 화면 문구. 화면마다 따로 판정하면 한 곳만 고쳐지고 나머지가 거짓말한다 —
 * 진행중 화면이 그랬다(2026-09-15). 여기 말고는 '약'·'여유'·'늦어요'를 결정하지 않는다.
 *
 * - approx      숫자 앞 접두. 추정이면 '약 '
 * - banner      추정임을 말하는 한 줄. 실측이면 null
 * - showVerdict 마감 판정("N분 여유/늦어요/초과")과 그 알림을 낼 수 있나. 추정치 위에서 판정하면
 *               +8분 추정이 실제 +15분일 때 "제시간"이라 말하고 늦게 만든다
 */
import type { Mode, TimeClass, Timed, TimingSource } from './routePlan/types';

export type TimingCopy = { approx: '약 ' | ''; banner: string | null; showVerdict: boolean };

const BANNER: Record<Mode, string> = {
  transit: '소요시간은 추정이에요 · 배차·환승 미반영',
  walk: '소요시간은 추정이에요 · 거리 기준',
  car: '소요시간은 추정이에요 · 서버 연결 전',
};

/**
 * 구간마다 실측했지만 나중 구간이 계획의 출발 시각으로 조회된 경우. 대중교통만 이 등급에 닿는다 —
 * 구간을 쪼개는 공급자가 `transitProvider` 뿐이고 그게 transit 외 모드를 거절한다. 다른 모드가
 * 쪼개기 시작하면 그때 Record 로 바꾼다. 없는 문구를 미리 지어두면 못 쓰는 거짓말만 남는다
 */
const BANNER_LEGS = '구간마다 시간표 조회 · 체류 뒤 배차는 미반영';
/**
 * 실측 계획 안에서 매장을 바꿔 그 구간이 추정이 된 경우. "조회해요" 같은 약속은 넣지 않는다 —
 * 바꾼 구간을 다시 재는 기능(6단계)은 아직 없고, 없는 기능을 말하면 거짓말이다
 */
const BANNER_LEGS_SWAPPED = '구간마다 시간표 조회 · 바꾼 매장 구간은 추정';
const BANNER_SWAPPED = '바꾼 매장 구간은 추정이에요';

const BANNER_DIRECT_ONLY: Record<Mode, string> = {
  transit: '직행은 시간표 조회 · 경유 추가시간은 추정',
  walk: '직행은 실측 · 경유 추가시간은 추정',
  car: '직행은 실측 · 경유 추가시간은 추정',
};

export function timingCopy(source: TimingSource | undefined, mode: Mode, legEstimated = false): TimingCopy {
  // 추정 구간이 하나라도 있으면 출처가 무엇이든 '약'이고 판정은 없다 — 등급은 낮은 쪽이 이긴다.
  // provider_legs 가 이 인자를 버려서 매장을 바꾼 계획이 '약' 없이 "23:15 도착 경로로 계속"을
  // 내놨고(2026-09-20), provider 는 '약'을 붙이고도 판정을 해 머리말이 금한 일을 했다.
  // 아래 두 등급(직행만 실측·추정)은 legEstimated 와 무관하게 이미 '약'·판정 없음이다
  if (legEstimated && source === 'provider') return { approx: '약 ', banner: BANNER_SWAPPED, showVerdict: false };
  if (legEstimated && source === 'provider_legs') return { approx: '약 ', banner: BANNER_LEGS_SWAPPED, showVerdict: false };
  if (source === 'provider') return { approx: '', banner: null, showVerdict: true };
  // 구간마다 실측 — 숫자는 진짜로 쟀으니 '약'을 안 붙인다. 다만 2구간 이후가 계획 출발 시각으로
  // 조회돼(체류 뒤 배차는 다르다) 판정은 못 한다. 같은 O→D 가 출발 시각만 달라져 20% 흔들린 적이 있고,
  // 22분짜리 구간에 그만큼이면 "3분 여유"가 뒤집힌다(docs/transit-추정-오차.md)
  if (source === 'provider_legs') return { approx: '', banner: BANNER_LEGS, showVerdict: false };
  // 직행만 실측 — 도착 시각의 대부분이 추정이라 판정은 안 한다. 다만 배너는 무엇이 실측인지 말한다
  if (source === 'provider_direct_only') return { approx: '약 ', banner: BANNER_DIRECT_ONLY[mode], showVerdict: false };
  // 출처를 못 밝히면 추정이다 — 목 데이터셋(timingSource 없음)이 여기 온다
  return { approx: '약 ', banner: BANNER[mode], showVerdict: false };
}

/** 값 하나의 등급 → '약'. `timingCopy` 가 계획에 하는 일을 값 하나에 한다 */
export const approxOf = (cls: TimeClass): '약 ' | '' => (cls === 'estimated' ? '약 ' : '');

/**
 * 등급을 안 들고 온 값에 계획 등급을 내려준다 — 목 데이터셋 후보(`cls` 없음)가 여기 온다.
 * 직행만 실측(provider_direct_only)의 경유 추가시간은 추정이므로 실측은 두 등급뿐이다
 */
export const classOf = (source: TimingSource | undefined): TimeClass =>
  source === 'provider' || source === 'provider_legs' ? 'measured' : 'estimated';

/** 부호는 하나만 — 빼는 후보(음수)는 '+-1분'이 아니라 '−1분' */
export const signedMin = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(Math.round(n))}분`;

/**
 * 교체 시트의 추가시간 문구. 실측은 부호 그대로, 추정은 '약'. 추정 3분 미만은 숫자를 안 낸다 —
 * 구간 추정 오차가 MAE 5.1분이라(docs/transit-추정-오차.md) 그 안의 차이는 정보가 아니라 잡음이다
 */
export function deltaCopy(t: Timed): string {
  const m = Math.round(t.min);
  if (t.cls === 'measured') return m === 0 ? '같아요' : signedMin(m);
  if (Math.abs(m) < 3) return '비슷해요';
  return `약 ${signedMin(m)}`;
}

const INTRO: Record<Mode, string> = {
  car: '직선거리가 아니라 실제 소요시간으로 계산해요',
  // 계산 *전에* 뜨는 줄이라 출처를 알 수 없다 — 자동차 줄처럼 앱이 무엇을 하는지만 말한다.
  // 7단계부터 경유지도 구간마다 실측한다(2026-09-16)
  transit: '구간마다 시간표를 조회해 실제 소요시간으로 계산해요',
  walk: '도보 시간은 아직 추정이에요 · 도착 시각은 참고만',
};
export function introCopy(mode: Mode): string { return INTRO[mode]; }

export function rationaleCopy(source: TimingSource, measuredCount: number): string {
  if (source === 'provider') return `실측 ${measuredCount}회로 확인한 경로예요.`;
  // 실측 횟수는 그대로 말하되 '구간마다'로 한 번에 잰 것과 구분한다. 무엇이 미반영인지는 배너 몫이다
  if (source === 'provider_legs') return `구간마다 실측 ${measuredCount}회로 확인한 경로예요`;
  if (source === 'provider_direct_only') return '직행은 실측, 경유는 추정으로 계산한 경로예요';
  return '추정으로 계산한 경로예요 · 실측 전';
}
