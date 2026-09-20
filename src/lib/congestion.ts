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

/**
 * 이 경유지를 **들렀는가** — 도착해서 충분히 머물렀다고 판정된 곳.
 *
 * 위치 인덱스로는 알 수 없다. `passedCount` 는 '몇 번째까지 지나왔나'일 뿐이라
 * 스쳐 지나간 곳(skip)도 같이 올라가서, 차로 가게 옆을 지나가기만 해도 '가 봤다'가 됐다.
 * 그래서 판정부(`arrival.ts`)가 체류 시간을 채운 지점만 `visit` 이벤트로 내고,
 * 그 id 들이 여기 들어온다 — 지금 서 있다는 것만으로는 아직 방문이 아니다.
 *
 * 화면과 리듀서가 각자 판단하면 어긋난다. 실제로 그랬다: 화면은 '가 본 곳'으로
 * 넓혔는데 리듀서는 '체류 중'만 받고 있어서, 떠나온 경유지에 제보를 하면
 * 고맙다는 인사만 뜨고 상태는 그대로였다 — 시트를 다시 열면 또 물었다.
 */
export function hasVisitedStop(stopId: string, visitedStopIds: readonly string[]): boolean {
  return visitedStopIds.includes(stopId);
}
