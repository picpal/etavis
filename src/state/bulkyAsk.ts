/**
 * "들고 다니기 무거운가"를 **사용자에게 묻는다.**
 *
 * 왜 LLM 에게 안 맡기나: 같은 문장 5회에 `loadAfter` 가 `hard/none/hard/none/hard` 로
 * 갈렸다(2026-09-18 실측). 이 태그 하나가 `추천 순서` 탭이 가리킬 안을 정하는데,
 * 그게 동전 던지기면 같은 말을 해도 추천이 있었다 없었다 한다.
 *
 * 규칙은 코드가 고정한다 — 프롬프트를 더 세게 써도 비결정성은 안 없어진다.
 * 묻는 비용은 탭 한 번이고, 답은 사용자가 제일 잘 안다.
 */
import type { IntentChip } from './plan';
import { askTarget, ASK_LOAD, type NarrowAsk } from './narrowAsk';

export const BULKY_YES = '무거워요';
export const BULKY_NO = '괜찮아요';

/**
 * 부피·무게가 생기는 업종어. 브랜드가 아니라 **업종**으로 둔다 —
 * 브랜드를 나열하면 새 브랜드가 나올 때마다 빠진다.
 */
const BULKY = ['마트', '슈퍼', '정육점', '생수', '쌀', '가구', '창고형', '시장', '농협', '하나로'];

export function bulkyAsks(chips: IntentChip[], mode: 'car' | 'walk' | 'transit'): NarrowAsk[] {
  // 자동차는 짐 계산 자체를 건너뛴다(`routePlan/plan.ts` 의 `burdened`) — 물어도 안 쓴다
  if (mode === 'car') return [];
  return chips.flatMap(c => {
    /* 거르는 기준은 `loadAfter` 가 아니라 `loadAsked` 다. 추출은 `loadAfter` 를
       늘 채워 보내므로(없으면 `none` 으로 굳힌다) 값으로 거르면 한 칩도 안 남는다 —
       사람이 답했다는 표식만이 "이미 물었다"의 근거가 된다 */
    if (c.kind !== 'stop' || c.loadAsked) return [];
    if (!c.queries.some(q => BULKY.some(b => q.includes(b)))) return [];
    return [{
      field: `${ASK_LOAD}${c.id}`,
      question: `${c.label}에서 산 건 들고 다니기 무거우신가요?`,
      options: [BULKY_YES, BULKY_NO],
    }];
  });
}

/** 물성 되묻기의 field 에서 칩 id 를 꺼낸다. 다른 되묻기면 null */
export function bulkyChipId(field: string): string | null {
  const t = askTarget(field);
  return t?.kind === 'chip' ? t.chipId : null;
}

/**
 * 자동으로 열 질문. **닫아 둔 것은 고르지 않는다.**
 *
 * 닫기는 그 질문 하나에 대한 것이지 큐 전체가 아니다 — 그래서 새 질문은 계속 뜨고,
 * 닫은 질문은 칩 메뉴에서만 다시 열린다(`asksForChip`).
 */
export function nextAskField(asks: NarrowAsk[], dismissed: readonly string[]): string | null {
  return asks.find(a => !dismissed.includes(a.field))?.field ?? null;
}

/**
 * 되묻기 큐를 **지금 물어야 할 물성 질문 집합에 맞춘다** — 새로 생긴 건 넣고,
 * 물을 일이 없어진 건 뺀다.
 *
 * 빼는 쪽이 왜 필요한가: 걸어서 마트에 들르기로 하면 물성 질문이 큐에 들어가는데,
 * 거기서 이동수단을 자동차로 바꾸면 `bulkyAsks` 는 빈 배열을 돌려준다(트렁크에
 * 실으니 답이 계획을 안 바꾼다). 넣기만 하던 시절엔 그 빈 배열을 보고 그냥
 * 돌아가서, 이미 떠 있던 질문이 자동차 모드에서도 그대로 남았다.
 *
 * 좁히기 질문(`stop:`)은 건드리지 않는다 — 이 함수가 아는 건 물성 질문뿐이고,
 * 모르는 질문을 지우면 남의 큐를 망가뜨린다.
 *
 * 바뀐 게 없으면 `asks` 로 **받은 배열을 그대로** 돌려준다. 호출하는 effect 가
 * 큐를 의존성에 들고 있어서, 매번 새 배열을 만들면 effect 가 자기 자신을 다시 부른다.
 */
export function mergeBulkyAsks(
  queue: NarrowAsk[],
  fresh: NarrowAsk[],
  askField: string | null,
  dismissed: readonly string[],
): { asks: NarrowAsk[]; askField: string | null } {
  const live = new Set(fresh.map(a => a.field));
  const kept = queue.filter(a => bulkyChipId(a.field) == null || live.has(a.field));
  const add = fresh.filter(a => !queue.some(q => q.field === a.field));
  if (kept.length === queue.length && add.length === 0) return { asks: queue, askField };
  const asks = [...kept, ...add];
  /* 답하던 질문이 살아남았으면 그대로 둔다 — 새 질문이 밀어내면 사용자는 자기가
     뭘 답하던 중이었는지 잃는다. 닫음 목록보다 이 판단이 앞선다:
     지금 답하고 있다는 건 닫지 않았다는 뜻이다 */
  if (askField != null && asks.some(a => a.field === askField)) return { asks, askField };

  /* 그 밖에는 닫지 않은 질문 중 첫 번째. `askField` 가 null(닫음)이든 잘렸든 같은
     규칙이다 — 두 경우를 가르려 했더니 "닫았는데 새 질문이 생긴" 경우가 어디에도
     안 맞았다. 닫음 목록이 그 구분을 대신한다 */
  return { asks, askField: nextAskField(asks, dismissed) };
}
