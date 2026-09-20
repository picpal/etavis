/**
 * 화면이 `measureSwap` 을 부르는 자리(6단계). A5(추천 경로)와 A6(확정 뒤 타임라인)는
 * 교체를 **다른 길로** 반영한다 — A5 는 planFlow 의 오버라이드, A6 는 확정본 스토어의
 * `REPLACE_LOCAL` 이다. 그래서 훅이 둘이지만, **재는 판단과 경합 처리는 한 곳**
 * (`measureSwap.ts` 의 `createSwapMeasurer`)이다. 한쪽만 고쳐 다른 화면이 거짓말하는 것을
 * 구조로 막는다.
 *
 * 둘의 차이는 "실측이 들어온 뒤 무엇을 다시 도나"뿐이다:
 *   A5 — `result` 참조가 안 바뀌므로 `legsVersion` 을 올려 파생 `useMemo` 를 무효화한다
 *   A6 — 확정본은 스냅샷이라 leg 표·후보 목록을 다시 내서 얹는다(`LEGS_LEARNED`)
 */
import { useMemo, useRef, useState } from 'react';
import type { Visit } from '../lib/routePlan/types';
import { createSwapMeasurer } from './measureSwap';
import { buildCandidates, buildLegs, visitsFromStops } from './planFlowBridge';
import { usePlan } from './plan';
import { usePlanFlow } from './planFlowProvider';

/** 재는 동안 배너에 '조회 중'을 붙일지. 요청이 정말 나가 있을 때만 true 다 */
export type SwapMeasure = { measuring: boolean };

/**
 * A5 — 교체 시트에서 고르면 오버라이드가 즉시 먹고(화면은 안 막는다), 뒤에서 두 구간을 잰다.
 * `visits` 는 **교체가 반영된 뒤의** 배열이어야 한다. 기준 안을 주면 남의 구간을 잰다
 */
export function useSwapMeasureA5(): SwapMeasure & { measure: (visits: Visit[], idx: number) => void } {
  const flow = usePlanFlow();
  const [measuring, setMeasuring] = useState(false);
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const measurer = useMemo(
    () =>
      createSwapMeasurer({
        onMeasuring: setMeasuring,
        onLearned: () => flowRef.current.legsLearned(),
      }),
    [],
  );

  return {
    measuring,
    measure: (visits, idx) => {
      const result = flowRef.current.state.result;
      if (!result) return;
      void measurer.measure(result, visits, idx);
    },
  };
}

/**
 * A6 — 확정 뒤 타임라인의 `매장 교체`. 스톱은 이미 `replaceStop` 이 바꿨고, 여기선 **잰 뒤**
 * 그 실측으로 leg 표와 후보 목록을 다시 내서 확정본에 얹는다.
 *
 * 계획이 목 데이터셋이면(슬롯이 없다) `visitsFromStops` 가 null 을 줘 아무것도 안 한다 —
 * 남의 계획 구간을 재고 그 결과를 이 화면에 붙이는 것보다 '약'이 남는 편이 정직하다
 */
export function useSwapMeasureA6(): SwapMeasure & { measureReplace: (stopId: string, candidateId: string) => void } {
  const flow = usePlanFlow();
  const plan = usePlan();
  const [measuring, setMeasuring] = useState(false);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const planRef = useRef(plan);
  planRef.current = plan;

  const measurer = useMemo(
    () =>
      createSwapMeasurer({
        onMeasuring: setMeasuring,
        onLearned: (visits) => {
          const { result, slots, request } = flowRef.current.state;
          if (!result || !request) return;
          planRef.current.applyLearnedLegs(
            buildLegs(result, visits, request.departAtMin),
            buildCandidates(result, slots, visits),
          );
        },
      }),
    [],
  );

  return {
    measuring,
    measureReplace: (stopId, candidateId) => {
      const { result, slots } = flowRef.current.state;
      const stops = planRef.current.state.stops;
      const idx = stops.findIndex(s => s.id === stopId);
      if (!result || idx < 0) return;
      const base = visitsFromStops(slots, stops);
      const cand = slots.find(x => x.id === stops[idx].baseId)?.candidates.find(c => c.id === candidateId);
      if (!base || !cand) return;
      const visits = base.map((v, i) => (i === idx ? { ...v, candidate: cand } : v));
      void measurer.measure(result, visits, idx);
    },
  };
}
