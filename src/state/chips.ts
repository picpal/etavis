/**
 * 조건 칩(도착 시각)을 지금 상태에 맞춘다.
 *
 * A1에서 이동수단을 바꿔도 A2의 칩은 `자동차` 그대로였다(2026-09-15 시뮬레이터).
 * 헤더는 `대중교통`이라고 쓰는데 칩은 `자동차`라서, **화면이 서로 다른 말을 했다.**
 * 그래서 한동안 이동수단도 칩으로 맞춰 왔는데 — 지금은 A2 헤더가 이동수단 셀렉트를
 * 직접 들고 있다. 조작점이 헤더 하나면 칩은 같은 말을 두 번 하는 자리이고, 게다가
 * ✕를 눌러도 `state.mode`가 안 바뀌어 **지워도 안 지워지는 칩**이었다. 그래서 뺐다.
 * 도착 시각은 그대로 칩으로 둔다 — 대화가 바꿀 수 있는 조건이라 드러나야 한다.
 *
 * `plan.tsx`를 런타임으로 물지 않으려고 타입만 가져온다. 테스트가 직접 부른다.
 */
import type { IntentChip } from './plan';
import { toHHMM } from '../lib/clock';

export type Mode = 'car' | 'walk' | 'transit';

/**
 * 경유지 칩은 그대로 두고 조건 칩만 맞춘다.
 *
 * - 도착 시각이 `null`이면(= '상관없어요') 칩을 **뺀다.** 없는 조건을 칩으로 두면
 *   지울 수 있는 것처럼 보인다.
 * - 이미 있으면 **id를 유지**한다 — 새 id를 주면 목록이 통째로 다시 그려져 칩이 깜빡인다.
 * - 순서는 `APPLY_INTENT`와 같다: 경유지 → 도착 시각.
 *
 * `mode`는 받기만 하고 칩으로 만들지 않는다. 조건의 출처를 한 곳으로 두려고 인자
 * 모양을 유지했다 — 호출부가 "지금 조건"을 통째로 넘기는 형태 그대로다.
 */
export function syncConditionChips(
  chips: IntentChip[],
  cond: { mode: Mode; arriveByMin: number | null },
  nextId: (kind: 'a') => string,
): IntentChip[] {
  const out: IntentChip[] = chips.filter(c => c.kind === 'stop');

  if (cond.arriveByMin != null) {
    const prev = chips.find(c => c.kind === 'arriveBy');
    out.push({
      id: prev?.id ?? nextId('a'),
      kind: 'arriveBy',
      label: `${toHHMM(cond.arriveByMin)}까지`,
      value: cond.arriveByMin,
    });
  }

  return out;
}

/**
 * 대화 전으로 되돌린다 — A2에서 뒤로 나갈 때 쓴다.
 *
 * 경유지 칩은 전부 대화가 만든 것이라 버린다. 조건은 **A2에 들어온 시점의 값**으로
 * 다시 맞춘다 — `APPLY_INTENT`가 대화로 도착 시각·이동수단까지 바꿀 수 있어서,
 * 칩만 지우고 조건을 남기면 "대화를 지웠다"고 해놓고 대화의 흔적이 남는다.
 */
export function resetConditionChips(
  chips: IntentChip[],
  entry: { mode: Mode; arriveByMin: number | null },
  nextId: (kind: 'a') => string,
): IntentChip[] {
  return syncConditionChips(chips.filter(c => c.kind !== 'stop'), entry, nextId);
}

/**
 * 되묻기 선택지를 고른 결과를 경유지 칩에 반영한다.
 *
 * 고른 값 하나로 줄인다 — `requestStopsFromChips`가 `queries[0]`을 쓰므로
 * 검색어가 그대로 좁혀진다. '상관없어요'면 원래대로 두고 질문만 닫는다(화면 몫).
 *
 * `stopKind`는 건드리지 않는다. 선택지의 절반이 브랜드가 아니라 업종어다 —
 * `NARROW`의 '동네 빵집'·'대형마트'·'동네 마트'·'동네 카페', 프롬프트도 "'동네 빵집'
 * 같은 업종어"를 넣으라고 시킨다. `stopKind`를 `'brand'`로 올리면 `runPlan.ts`의
 * 보강(154행)·트렌드 스왑(232행)이 꺼져, 좁혀달라고 한 사용자가 더 적은 신호로
 * 추천을 받는다. 대신 `narrowed`를 따로 둔다 — `stopKind`는 "사용자가 무엇이라
 * 불렀나", `narrowed`는 "좁히기 질문에 이미 답했나"다. 두 사실이라 필드도 둘이다.
 *
 * 되묻기는 **경유지 하나**에 대한 답이지 칩 하나에 대한 답이 아니다. `count>1`로
 * 칩이 여러 개 복제됐어도(APPLY_INTENT) 질문은 스톱당 하나만 온다 — 탭한 칩만
 * 좁히면 나머지 칩은 되묻기 없이 '빵집'으로 영영 남는다. 그래서 같은 `queries`를
 * 가진, 아직 안 좁혀진 칩을 전부 같이 좁힌다.
 *
 * 매칭되는 칩이 없으면 **같은 배열 참조**를 돌려준다 — 호출부(`plan.tsx`)가 그걸로
 * "바뀐 게 없다"를 판단해 애니메이션·재계산을 건너뛴다.
 */
export function narrowStopChips(chips: IntentChip[], chipId: string, query: string): IntentChip[] {
  const hit = chips.find(c => c.kind === 'stop' && c.id === chipId);
  // 이미 답한 칩은 다시 좁히지 않는다. 화면(`chipFor`)도 막지만 방어가 거기 한 곳뿐이면,
  // 리듀서를 직접 부르는 호출부가 생겼을 때 사용자가 고정한 값을 조용히 덮는다
  if (!hit || hit.kind !== 'stop' || hit.narrowed) return chips;
  const targetQueries = hit.queries;
  const sameQueries = (a: string[]) => a.length === targetQueries.length && a.every((v, i) => v === targetQueries[i]);
  return chips.map(c =>
    c.kind === 'stop' && !c.narrowed && sameQueries(c.queries)
      ? { ...c, label: query, queries: [query], narrowed: true }
      : c,
  );
}
