/**
 * 혼잡도 등급 — 주변 탭 제보와 경유지 체류 제보가 같은 눈금을 쓴다.
 * 두 곳이 각자 배열을 들고 있으면 등급이 어긋나 같은 '보통'이 다른 뜻이 된다.
 */
import { color } from '../theme/tokens';

export type CongestionKey = 'low' | 'mid' | 'high' | 'veryhigh';

export const CONGESTION: { key: CongestionKey; label: string; tint: string }[] = [
  { key: 'low', label: '여유', tint: color.green },
  { key: 'mid', label: '보통', tint: color.primary },
  { key: 'high', label: '혼잡', tint: color.amber },
  { key: 'veryhigh', label: '매우혼잡', tint: '#B33B2B' },
];

export function congestionLabel(key: string | null | undefined): string | null {
  return CONGESTION.find(c => c.key === key)?.label ?? null;
}
