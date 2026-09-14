/**
 * 칩 → 파이프라인 슬롯 매핑.
 *
 * `usePlanRequest`에서 떼어 냈다. 그 파일은 `plan.tsx`를 런타임으로 물고,
 * `plan.tsx`는 react-native를 문다 — node 테스트가 닿을 수 없다.
 * 여기서는 **타입만** 가져오므로(컴파일 시 지워진다) 테스트가 직접 부를 수 있다.
 */
import type { IntentChip } from './plan';
import type { PlanRequest } from './planFlow';

/**
 * 칩 → 파이프라인 슬롯. **누수가 나는 경계라 순수 함수로 뺐다.**
 *
 * 예전에 여기서 `flexible: true, openNow: false`를 하드코딩했고, 그래서 LLM이
 * "문 연 약국"에서 뽑은 `openNow`가 `runPlan`에 닿지 못했다. `runPlan`은 줄곧
 * 받을 준비가 돼 있었는데(슬롯 조립부) 값이 오지 않았을 뿐이다 — 화면 어디에도
 * 드러나지 않는 종류의 결함이라 테스트로 묶어 둔다.
 */
export function requestStopsFromChips(chips: IntentChip[]): PlanRequest['stops'] {
  return chips
    .filter(c => c.kind === 'stop')
    .map(c => ({
      id: c.id,
      query: c.kind === 'stop' ? c.queries[0] : '',
      // count 는 칩을 개수만큼 복제하는 방식이라(APPLY_INTENT) 슬롯당 항상 1이다
      count: 1,
      // 옛 상태의 칩에는 필드가 없을 수 있다 — stopKind 와 같은 방식으로 기본값을 둔다
      flexible: (c.kind === 'stop' ? c.flexible : undefined) ?? true,
      openNow: (c.kind === 'stop' ? c.openNow : undefined) ?? false,
      stopKind: (c.kind === 'stop' ? c.stopKind : undefined) ?? 'category',
    }));
}
