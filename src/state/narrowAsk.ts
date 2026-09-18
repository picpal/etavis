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

/**
 * 되묻기 `field` 의 접두사. 여기 한 곳만 안다 — 접두사를 여러 곳에서 해석하면
 * 한 곳이 5글자를 무조건 자르는 순간(`'load:s-1'.slice(5) === 's-1'`) 물성 질문이
 * 좁히기 질문 행세를 한다.
 */
export const ASK_STOP = 'stop:';
export const ASK_LOAD = 'load:';

/** 이 질문이 무엇을 가리키나. 모르는 접두사면 `null` */
export type AskTarget =
  | { kind: 'query'; query: string }
  | { kind: 'chip'; chipId: string }
  | null;

export function askTarget(field: string): AskTarget {
  if (field.startsWith(ASK_STOP)) return { kind: 'query', query: field.slice(ASK_STOP.length) };
  if (field.startsWith(ASK_LOAD)) return { kind: 'chip', chipId: field.slice(ASK_LOAD.length) };
  return null;
}

/**
 * 이 칩에 달린 되묻기 **전부**. 칩 표식(▾)과 칩 메뉴가 이걸로 그린다.
 *
 * 단수(`askForChip`)였을 때는 칩에 질문이 둘 달리면 하나가 가려졌고, 물성 질문은
 * 접두사가 달라 아예 안 잡혀 **큐에 있는데 도달할 수 없는 질문**이 생겼다.
 */
export function asksForChip(asks: NarrowAsk[], chip: IntentChip): NarrowAsk[] {
  if (chip.kind !== 'stop') return [];
  const { id, queries, narrowed } = chip;
  return asks.filter(a => {
    const t = askTarget(a.field);
    if (t == null) return false;
    // 좁히기는 답한 칩에 다시 달지 않는다 — 고른 값과 같은 말이 검색어로 남으면
    // 사용자가 고정한 값을 되묻기가 덮는다
    if (t.kind === 'query') return !narrowed && queries.includes(t.query);
    // 물성은 좁혔는지와 무관하다 — 어떤 마트인지와 무거운지는 다른 질문이다
    return t.chipId === id;
  });
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
