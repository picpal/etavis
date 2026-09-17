/**
 * 칩 → 파이프라인 슬롯 매핑.
 *
 * `usePlanRequest`에서 떼어 냈다. 그 파일은 `plan.tsx`를 런타임으로 물고,
 * `plan.tsx`는 react-native를 문다 — node 테스트가 닿을 수 없다.
 * 여기서는 **타입만** 가져오므로(컴파일 시 지워진다) 테스트가 직접 부를 수 있다.
 */
import type { IntentChip } from './plan';
import type { PlanRequest } from './planFlow';
import { expandQueries } from '../lib/placeQuery';

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
      // 칩의 queries 는 폴백 목록이다 — 앞이 0건이면 runPlan 이 뒤로 넘어간다.
      // 사용자가 되묻기에서 하나를 고르면 chips.ts 가 이 배열을 그 값 하나로 줄인다.
      queries: expandQueries(c.kind === 'stop' ? c.queries : []),
      // count 는 칩을 개수만큼 복제하는 방식이라(APPLY_INTENT) 슬롯당 항상 1이다
      count: 1,
      // 옛 상태의 칩에는 필드가 없을 수 있다 — stopKind 와 같은 방식으로 기본값을 둔다
      flexible: (c.kind === 'stop' ? c.flexible : undefined) ?? true,
      openNow: (c.kind === 'stop' ? c.openNow : undefined) ?? false,
      stopKind: (c.kind === 'stop' ? c.stopKind : undefined) ?? 'category',
      // 공백뿐인 why 는 없는 것으로 본다 — 글자 없는 할 일 한 줄이 카드에 남는다
      why: (c.kind === 'stop' ? c.why?.trim() : undefined) || undefined,
      // 옛 상태의 칩에는 없을 수 있다 — 없으면 제약 없음
      near: (c.kind === 'stop' ? c.near : undefined) ?? 'any',
      // 옛 상태의 칩에는 없다 — stopKind·near 와 같은 방식으로 보수적 기본값을 둔다
      loadBefore: (c.kind === 'stop' ? c.loadBefore : undefined) ?? 'none',
      loadAfter: (c.kind === 'stop' ? c.loadAfter : undefined) ?? 'none',
      needWhen: (c.kind === 'stop' ? c.needWhen : undefined) ?? 'unknown',
    }));
}
