/**
 * 경로를 구간(leg) 단위로 쪼갠다.
 *
 * 대중교통은 A→B→C를 하나로 안내하는 개념이 없다. 구간마다 별개의 환승 계획이라
 * 지도 앱 세 곳 모두 대중교통 길찾기는 1:1이다. 우회할 방법이 없다.
 *
 * 그래서 전체를 한 번에 넘기는 대신 "지금 갈 구간"만 넘긴다. 어디까지 왔는지는
 * 우리가 알고 있으니(passedCount·atStop), 사용자가 매번 주소를 다시 찾을 필요가 없다.
 * 덤으로 대중교통은 '지금 출발' 기준 시간표가 중요해서, 나중 구간을 미리 열어봐야
 * 어차피 의미가 없다.
 */
import { useMemo } from 'react';
import { usePlan } from '../state/plan';
import { useCurrentPlace } from './currentPlace';
import { RoutePoint } from './mapLinks';

export type Leg = {
  index: number;
  from: RoutePoint;
  to: RoutePoint;
  /** 이미 지나온 구간 */
  done: boolean;
  /** 지금 가야 할 구간 */
  isNext: boolean;
};

export function useRouteLegs() {
  const { state, destinationDisplay } = usePlan();
  const here = useCurrentPlace();

  const points = useMemo<RoutePoint[]>(
    () => [
      { name: state.dataset.origin.name, coord: state.dataset.origin.coord },
      ...state.stops.map(s => ({ name: s.name, coord: s.coord })),
      { name: destinationDisplay, coord: state.destinationCoord ?? state.dataset.destination.coord },
    ],
    [state.dataset, state.stops, state.destinationCoord, destinationDisplay],
  );

  // 체류 중이면 그 경유지에서 '출발하는' 구간이 다음 구간이다
  const nextIndex = Math.min(
    points.length - 2,
    state.passedCount + (state.atStop ? 1 : 0),
  );

  const legs = useMemo<Leg[]>(
    () =>
      points.slice(0, -1).map((from, i) => ({
        index: i,
        // 지금 갈 구간의 출발지는 계획상의 좌표보다 실제 내 위치가 정확하다
        from: i === nextIndex && here.coord ? { name: '내 위치', coord: here.coord } : from,
        to: points[i + 1],
        done: i < nextIndex,
        isNext: i === nextIndex,
      })),
    [points, nextIndex, here.coord],
  );

  return {
    legs,
    nextLeg: legs[nextIndex] ?? null,
    /** 대중교통이면 구간 단위로 넘겨야 한다 */
    byLeg: state.mode === 'transit',
  };
}
