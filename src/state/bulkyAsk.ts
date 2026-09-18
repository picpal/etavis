/**
 * "들고 다니기 무거운가"를 **사용자에게 묻는다.**
 *
 * 왜 LLM 에게 안 맡기나: 같은 문장 5회에 `loadAfter` 가 `HARD/none/HARD/none/HARD` 로
 * 갈렸다(2026-09-18 실측). 이 태그 하나가 `추천 순서` 탭이 가리킬 안을 정하는데,
 * 그게 동전 던지기면 같은 말을 해도 추천이 있었다 없었다 한다.
 *
 * 규칙은 코드가 고정한다 — 프롬프트를 더 세게 써도 비결정성은 안 없어진다.
 * 묻는 비용은 탭 한 번이고, 답은 사용자가 제일 잘 안다.
 */
import type { IntentChip } from './plan';
import type { NarrowAsk } from './narrowAsk';

export const BULKY_YES = '무거워요';
export const BULKY_NO = '괜찮아요';

const FIELD_PREFIX = 'load:';

/**
 * 부피·무게가 생기는 업종어. 브랜드가 아니라 **업종**으로 둔다 —
 * 브랜드를 나열하면 새 브랜드가 나올 때마다 빠진다.
 */
const BULKY = ['마트', '슈퍼', '정육점', '생수', '쌀', '가구', '창고형', '시장', '농협', '하나로'];

export function bulkyAsks(chips: IntentChip[], mode: 'car' | 'walk' | 'transit'): NarrowAsk[] {
  // 자동차는 짐 계산 자체를 건너뛴다(`routePlan/plan.ts` 의 `burdened`) — 물어도 안 쓴다
  if (mode === 'car') return [];
  return chips.flatMap(c => {
    if (c.kind !== 'stop' || c.loadAfter != null) return [];
    if (!c.queries.some(q => BULKY.some(b => q.includes(b)))) return [];
    return [{
      field: `${FIELD_PREFIX}${c.id}`,
      question: `${c.label}에서 산 건 들고 다니기 무거우신가요?`,
      options: [BULKY_YES, BULKY_NO],
    }];
  });
}

/** 물성 되묻기의 field 에서 칩 id 를 꺼낸다. 다른 되묻기면 null */
export function bulkyChipId(field: string): string | null {
  return field.startsWith(FIELD_PREFIX) ? field.slice(FIELD_PREFIX.length) : null;
}
