/**
 * 시간 출처에 따른 화면 문구. 화면마다 따로 판정하면 한 곳만 고쳐지고 나머지가 거짓말한다 —
 * 진행중 화면이 그랬다(2026-09-15). 여기 말고는 '약'·'여유'·'늦어요'를 결정하지 않는다.
 *
 * - approx      숫자 앞 접두. 추정이면 '약 '
 * - banner      추정임을 말하는 한 줄. 실측이면 null
 * - showVerdict 마감 판정("N분 여유/늦어요/초과")과 그 알림을 낼 수 있나. 추정치 위에서 판정하면
 *               +8분 추정이 실제 +15분일 때 "제시간"이라 말하고 늦게 만든다
 */
import type { Mode, TimingSource } from './routePlan/types';

export type TimingCopy = { approx: '약 ' | ''; banner: string | null; showVerdict: boolean };

const BANNER: Record<Mode, string> = {
  transit: '소요시간은 추정이에요 · 배차·환승 미반영',
  walk: '소요시간은 추정이에요 · 거리 기준',
  car: '소요시간은 추정이에요 · 서버 연결 전',
};

export function timingCopy(source: TimingSource | undefined, mode: Mode, legEstimated = false): TimingCopy {
  // 출처를 못 밝히면 추정이다 — 목 데이터셋(timingSource 없음)이 여기 온다
  if (source !== 'provider') return { approx: '약 ', banner: BANNER[mode], showVerdict: false };
  return { approx: legEstimated ? '약 ' : '', banner: null, showVerdict: true };
}

export function introCopy(mode: Mode): string {
  return mode === 'car'
    ? '직선거리가 아니라 실제 소요시간으로 계산해요'
    : '도보·대중교통 시간은 아직 추정이에요 · 도착 시각은 참고만';
}

export function rationaleCopy(source: TimingSource, measuredCount: number): string {
  return source === 'provider' ? `실측 ${measuredCount}회로 확인한 경로예요.` : '추정으로 계산한 경로예요 · 실측 전';
}
