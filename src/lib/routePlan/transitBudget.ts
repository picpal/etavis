/**
 * 대중교통 `/transit` 호출 예산. 플래너(plan.ts)와 공급자(transitProvider.ts)가 같은 숫자를 본다 —
 * 두 곳이 따로 들고 있으면 한쪽만 고쳐져 예산이 조용히 새는 자리다(`server/src/guard.ts` 의 PER_DAY 와 같은 규칙).
 *
 * ## 왜 10인가 — 산수
 *
 * Google Routes TRANSIT 은 경유지를 못 받는다. 그래서 대중교통은 route() 한 번을
 * **구간마다 한 번씩** `/transit` 으로 쪼개 부른다(자동차 `/route` 는 경유지를 그대로 실어 한 번).
 *
 *   경유지 V곳인 계획 하나 = 점 V+2개 = 구간 V+1개 = `/transit` V+1회
 *
 * 자동차는 계획 하나가 `/route` 를 최대 9회 쓴다 — 직행 1 + 시드 `SINGLE_R`=8.
 * 대중교통을 같은 자릿수 **10회**(직행 1 + 경유 조합 9)로 묶는다. 쪼갠다는 이유로
 * 대중교통이 자동차보다 비싸질 근거가 없다.
 *
 * 벽시계는 이 상한의 근거가 아니다 — 구간도 시드도 `Promise.all` 로 병렬이라, 호출을
 * 몇 개로 늘려도 `runPlan` 의 12초 예산에서 쓰는 건 구간 1회분(2026-09-16 실측 1.7~2.5초)이다.
 * 묶는 이유는 돈과 서버 쿼터다.
 *
 * ## 시드 수가 여기서 나온다
 *
 * 직행이 먼저 1회를 쓰므로 경유 조합에 9회가 남고, 계획 하나가 V+1회를 먹는다.
 *
 *   V=1 → floor(9/2) = 4안   V=2 → floor(9/3) = 3안   V=3 → floor(9/4) = 2안
 *
 * V=1 은 자동차의 8안에서 4안으로 줄어든다. 그 대가로 그 4안은 구간 단위 실측이다 —
 * 2026-09-16 스파이크(`docs/transit-추정-오차.md`)에서 추정 1·2위가 0.2분 차이로 뒤집혔고
 * 실측 격차는 5.7분이었다. 8곳을 5분 오차로 재는 것보다 4곳을 제대로 재는 게 낫다.
 */

/** 계획 하나가 쓸 수 있는 `/transit` 총 호출 수. 직행 1회를 포함한다 */
export const TRANSIT_CALL_BUDGET = 10;

/** 직행이 쓰고 남는 몫 — 경유 조합 전부가 여기서 나눠 쓴다 */
export const TRANSIT_SEED_BUDGET = TRANSIT_CALL_BUDGET - 1;

/** 경유지 V곳인 계획 하나의 `/transit` 호출 수 = 구간 수 */
export const transitCallCost = (visits: number): number => visits + 1;

/** 경유지 V곳일 때 실측할 수 있는 안의 수. 예산이 모자라도 최소 1안은 잰다 */
export const transitSeedCount = (visits: number): number =>
  Math.max(1, Math.floor(TRANSIT_SEED_BUDGET / transitCallCost(visits)));

/**
 * route() 한 번이 쪼갤 수 있는 구간 수 상한. 넘으면 서버를 부르지 않고 통째로 추정으로 떨어진다.
 * 경유 조합 몫 전부(9)다 — 한 안이 예산을 다 먹는 건 허용하되, 넘기지는 못한다.
 */
export const TRANSIT_MAX_LEGS_PER_ROUTE = TRANSIT_SEED_BUDGET;
