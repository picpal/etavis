/**
 * 되묻기(`ambiguous`)와 경유지 칩을 잇는 규칙.
 *
 * 화면에서 빼낸 이유: 되묻기가 채팅 인라인에서 하단 시트로 옮겨가면서 "어떤 질문을
 * 띄우나"·"어느 칩에 딸린 질문인가"를 여러 곳에서 물어보게 됐다. 규칙이 화면에만
 * 있으면 시트·칩 표식·재오픈이 서로 다른 답을 하게 된다.
 */
import type { IntentChip } from './plan';

export type NarrowAsk = { field: string; question: string; options: string[] };

/**
 * 시트를 띄울 최소 선택지 수.
 *
 * `schema.ts:parseOptions`가 '상관없어요'를 항상 마지막에 붙이므로 실제 응답은 늘
 * 2개 이상이다 — 오늘 기준 이 문턱은 사실상 항상 열린다. 그래도 조건을 남기는 건
 * 선택지 상한(`slice(0, 3)`)이 바뀌거나 선택지 없는 축약형이 생겼을 때 화면이
 * "고를 것이 없는 질문"을 모달로 띄우는 걸 막기 위해서다.
 */
const MIN_OPTIONS = 2;

/** 시트로 띄울 되묻기만 남긴다. 선택지가 모자라면 고를 것이 없어 질문이 아니다. */
export function asksForSheet(asks: NarrowAsk[]): NarrowAsk[] {
  return asks.filter(a => a.options.length >= MIN_OPTIONS);
}

/** `stop:<검색어>` 에서 검색어만 떼어낸다 */
const queryOf = (field: string) => field.slice('stop:'.length);

/** 이 칩에 딸린 되묻기. 없으면 `undefined` — 칩에 표식을 달지, 탭이 시트를 열지를 이걸로 정한다. */
export function askForChip(asks: NarrowAsk[], chip: IntentChip): NarrowAsk | undefined {
  // 답한 칩은 검색어가 그대로 남아 있어도 다시 묻지 않는다. `narrowStopChips` 가
  // queries 까지 갈아 주므로 보통은 여기까지 안 오지만, 방어가 한 곳뿐이면 고른 값과
  // 같은 말이 검색어로 남는 순간 사용자가 고정한 값을 되묻기가 덮는다.
  // 두 경유지가 같은 값으로 좁혀졌을 때 나중 질문이 엉뚱한 쪽을 집는 것도 이 가드가 막는다
  if (chip.kind !== 'stop' || chip.narrowed) return undefined;
  const queries = chip.queries;
  return asks.find(a => queries.includes(queryOf(a.field)));
}

/** 고르지 않을 길. `schema.ts:parseOptions` 가 선택지 끝에 항상 붙인다 */
const OPT_OUT = '상관없어요';

/**
 * 되묻기에 답했을 때 무엇을 해야 하는지 알려준다.
 *
 * 칩을 직접 고치지 않고 **결정만** 돌려주는 이유: 칩은 리듀서(`narrowStop`)가 소유한다.
 * 여기서 새 배열을 만들면 같은 일을 두 곳이 하게 되고, 둘이 어긋나는 날 화면과 계산이
 * 다른 경유지를 본다.
 *
 * `narrowTo` 가 `null` 이면 좁히지 않는다 — '상관없어요'는 좁히지 않겠다는 답이지
 * 지우겠다는 답이 아니다.
 */
export function answerAsk(
  asks: NarrowAsk[],
  ask: NarrowAsk,
  option: string,
): { narrowTo: string | null; asks: NarrowAsk[] } {
  return {
    narrowTo: option === OPT_OUT ? null : option,
    asks: asks.filter(a => a.field !== ask.field),
  };
}
