/**
 * 데모 사용 집계 비콘 — 화면을 그리지 않는다. App 의 PlanProvider 안에 하나만 둔다.
 *
 * 여기 모아 둔 이유: 계획 확정은 여러 화면에서 일어나는데(`TimelineScreen` 등), 각
 * 화면에 넣으면 경로가 하나 늘 때마다 집계가 조용히 빠진다. 상태가 바뀌는 순간을 한
 * 곳에서 본다. `plan.tsx` 에 넣지 않은 건 그 파일이 단위 테스트를 받는데, expo 를 물면
 * 노드 러너가 react-native 변환에서 죽기 때문이다.
 *
 * `metricsUrl` 이 없으면 track() 이 무동작이라 앱 빌드에는 아무 영향이 없다.
 */
import { useEffect, useRef } from 'react';
import { usePlan } from '../state/plan';
import { track } from '../lib/metricsClient';

export function UsageBeacon() {
  const { state } = usePlan();
  const sentPlan = useRef(false);

  // 진입 1회 = 사람 1명. Constants.sessionId 가 페이지마다 새로 생기므로 그대로 성립한다
  useEffect(() => {
    track('hit');
  }, []);

  useEffect(() => {
    if (state.planConfirmed && !sentPlan.current) {
      sentPlan.current = true;
      track('plan');
    }
  }, [state.planConfirmed]);

  return null;
}
