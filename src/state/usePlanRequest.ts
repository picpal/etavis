/**
 * 기존 스토어(입력)에서 PlanRequest를 조립한다. planFlow는 입력을 갖지 않는다.
 * 출발 좌표: 사용자가 고른 곳 → GPS → (없으면 null: 계산 불가)
 */
import { useMemo } from 'react';
import { useCurrentPlace } from '../lib/currentPlace';
import { usePlan } from './plan';
import type { PlanRequest } from './planFlow';

const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

export function usePlanRequest(): PlanRequest | null {
  const { state, originDisplay, destinationDisplay } = usePlan();
  const here = useCurrentPlace();
  const origin = state.originCoord ?? here.coord ?? null;
  const destination = state.destinationCoord ?? state.dataset.destination.coord;
  return useMemo(() => {
    if (!origin || !destination) return null;
    const stops = state.chips
      .filter(c => c.kind === 'stop')
      .map(c => ({ id: c.id, query: c.kind === 'stop' ? c.queries[0] : '', count: 1, flexible: true, openNow: false }));
    return {
      origin, destination, originName: originDisplay, destinationName: destinationDisplay,
      mode: state.mode, arriveByMin: state.arriveByMin, departAtMin: nowMin(), stops, order: 'auto',
    };
    // departAtMin은 렌더마다 바뀌면 안 된다 — 분이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude, state.chips, state.mode, state.arriveByMin, originDisplay, destinationDisplay, Math.floor(Date.now() / 60000)]);
}
