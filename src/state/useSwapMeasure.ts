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
import { a6SwapTarget, createSwapMeasurer, type SwapSkip } from './measureSwap';
import { buildCandidates, buildLegs } from './planFlowBridge';
import { logTrack } from '../lib/trackLog';
import { usePlan } from './plan';
import { usePlanFlow } from './planFlowProvider';

/** 재는 동안 배너에 '조회 중'을 붙일지. 요청이 정말 나가 있을 때만 true 다 */
export type SwapMeasure = { measuring: boolean };

/**
 * 안 잰 이유를 로그에 남긴다. 화면엔 안 띄운다 — 사용자에게 보이는 건 '약'이 남는 것뿐이고
 * 그건 이미 배너가 말한다. 이 줄이 없어서 기기에서 A6 가 왜 조용한지 못 짚었다(2026-09-21)
 */
const logSkip = (where: 'A5' | 'A6', reason: SwapSkip) =>
  logTrack({ k: 'act', a: 'cand.measureSkip', d: { where, reason } });

/**
 * A5 — 교체 시트에서 고르면 오버라이드가 즉시 먹고(화면은 안 막는다), 뒤에서 두 구간을 잰다.
 * `base` 는 바꾸기 전 안, `visits` 는 **교체가 반영된 뒤의** 배열이다 — 잴 자격은 기준 안이,
 * 잴 대상은 바뀐 안이 정한다
 */
export function useSwapMeasureA5(): SwapMeasure & { measure: (base: Visit[], visits: Visit[], idx: number) => void } {
  const flow = usePlanFlow();
  const [measuring, setMeasuring] = useState(false);
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const measurer = useMemo(
    () =>
      createSwapMeasurer({
        onMeasuring: setMeasuring,
        onLearned: () => flowRef.current.legsLearned(),
        onSkip: r => logSkip('A5', r),
      }),
    [],
  );

  return {
    measuring,
    measure: (base, visits, idx) => {
      const result = flowRef.current.state.result;
      if (!result) return;
      void measurer.measure(result, base, visits, idx);
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
        onSkip: r => logSkip('A6', r),
      }),
    [],
  );

  return {
    measuring,
    measureReplace: (stopId, candidateId) => {
      /* `planRef.current.state.stops` 는 **교체가 리듀서에 닿기 전** 목록이다 — 같은 틱에
         `replaceStop` 을 부르지만 리듀서는 다음 렌더에나 돈다. 그게 곧 기준 안이라 맞는 값이다 */
      const t = a6SwapTarget(flowRef.current.state, planRef.current.state.stops, stopId, candidateId);
      if (typeof t === 'string') return logSkip('A6', t);
      void measurer.measure(t.result, t.target.base, t.target.visits, t.target.idx);
    },
  };
}
