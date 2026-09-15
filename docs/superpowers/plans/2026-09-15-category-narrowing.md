# 업종 되묻기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "빵집"처럼 넓은 업종을 말하면 선택지 칩을 띄워, 사용자가 한 번 탭으로 검색어를 좁히게 한다.

**Architecture:** 추출 응답의 `ambiguous`에 `options`를 더한다. LLM이 넓은 업종에 대해 질문과 선택지를 함께 낸다. 앱은 그걸 칩으로 그리고, 고르면 그 경유지의 `queries`를 고른 값 하나로 바꾼다. `requestStopsFromChips`가 이미 `queries[0]`을 쓰므로 검색어가 그대로 좁혀진다. **이번 단계는 묻고 이번 계획에 적용하는 데까지다** — 답을 기억하는 저장 계층은 다음 단계다.

**Tech Stack:** TypeScript, React Native(Expo SDK 57), Cloudflare Workers, node:test + tsx (`npm test`).

**Spec:** `docs/대중교통-경로-단계계획.md` §6.7

## 왜 선택지를 LLM이 내는가 (2026-09-15 실측 근거)

운영 서버에 "가는 길에 빵 사고 마트에서 장보고 가려고"를 넣으면 이렇게 나온다:

```
queries: ['빵집'] | kind: category | why: 빵 사기
queries: ['마트'] | kind: category | why: 장보기
ambiguous: []
```

**기존 `queries`에는 선택지가 없다.** 프롬프트의 "카테고리를 하나로 좁히지 않는다"는 택배(우체국·편의점)처럼 업종이 실제로 갈리는 말에만 걸리고, 빵집은 그 자체가 하나의 업종이다. 그래서 선택지는 새로 만들어야 한다.

대안이었던 "검색 결과의 브랜드에서 선택지를 만든다"(카카오 `category_name` 마지막 조각이 브랜드다)는 채택하지 않는다. 검색이 먼저 돌아야 하므로 질문이 경로 계산 **뒤로** 밀리고, 대화 중에 묻는다는 흐름이 깨진다. 다음 단계에서 재고한다.

**고른 브랜드가 경로 근처에 없으면**: 새 코드를 넣지 않는다. `searchAlong`·`searchAtAnchors`가 반경을 넓히다 `short`/`none`을 돌려주고, 화면은 이미 그 상태를 표시한다. 좁혔더니 못 찾는 것도 사용자가 알아야 할 사실이다.

## Global Constraints

- 스테이징은 파일명을 직접 적는다. `git add -A` / `git add .` **금지**.
- 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 테스트 글로브는 **평면만** 돈다 — 루트 `src/**/*.test.ts`와 `server/src/*.test.ts`. 하위 폴더는 안 돈다.
- 완료 게이트: `npm test` 전부 통과 + `npx tsc --noEmit` exit 0 + `cd server && npx tsc --noEmit` exit 0.
- **인젝션 방어선은 프롬프트가 아니라 `server/src/schema.ts`다.** LLM이 무엇을 뱉든 스키마를 통과해야 앱에 닿는다.
- **LLM은 '무엇을'만 뽑는다.** 소요시간·거리·도착 가능 여부를 만들게 하지 않는다.
- API 키 값을 코드·문서·커밋에 절대 넣지 않는다.
- 과금 순서를 지킨다: 목 → codex 시뮬레이션 → 서버 실측. 서버 실측은 배선 확인용으로 마지막에 한 번.

---

### Task 1: `options` 배관 — 스키마·타입·목

**Files:**
- Modify: `server/src/schema.ts` (`Intent.ambiguous` 에 `options`)
- Modify: `src/lib/intent.ts` (같은 타입 + 로컬 목이 넓은 업종에 선택지를 낸다)
- Test: `server/src/schema.test.ts`, `src/lib/intent.test.ts`

**Interfaces:**
- Produces: `ambiguous: { field: string; question: string; options: string[] }[]` — Task 3·4가 쓴다. `field`는 **어느 경유지인지**를 가리키려고 `stop:<queries[0]>` 형태를 쓴다(예: `stop:빵집`). 기존 값(`mode`·`stops`·`text`·`endpoints`)은 그대로 둔다.

**왜 `field`에 경유지를 싣나:** 지금 `field`는 자유 문자열이고 화면은 `ambiguous[0].question` 한 줄만 쓴다. 경유지가 둘이면(빵집·마트) 어느 칩 아래에 선택지를 붙일지 알아야 한다. 새 필드를 더하는 대신 기존 `field`의 규약을 정하는 쪽이 스키마 변경이 작다.

- [ ] **Step 1: 스키마 실패 테스트를 쓴다**

`server/src/schema.test.ts` 맨 아래에 추가한다. 이 파일의 기존 헬퍼·import 방식을 먼저 읽고 맞춘다.

```ts
test('ambiguous options — 문자열만, 최대 4개, 각 20자', () => {
  const i = parseIntent(JSON.stringify({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'stop:빵집', question: '어떤 빵집으로 할까요?', options: ['파리바게뜨', '뚜레쥬르', '동네 빵집', '상관없어요', '다섯번째'] },
    ],
  }));
  assert.equal(i.ambiguous[0].field, 'stop:빵집');
  assert.deepEqual(i.ambiguous[0].options, ['파리바게뜨', '뚜레쥬르', '동네 빵집', '상관없어요']);
});

test('ambiguous options — 없거나 이상하면 빈 배열', () => {
  const none = parseIntent(JSON.stringify({ stops: [], endpoints: {}, ambiguous: [{ field: 'mode', question: '어떤 이동수단으로 갈까요?' }] }));
  assert.deepEqual(none.ambiguous[0].options, []);
  const junk = parseIntent(JSON.stringify({ stops: [], endpoints: {}, ambiguous: [{ field: 'mode', question: '뭘로 갈까요?', options: [1, null, { a: 1 }, '카페'] }] }));
  assert.deepEqual(junk.ambiguous[0].options, ['카페'], '문자열 아닌 건 버린다');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test server/src/schema.test.ts`
Expected: FAIL — `options` 가 `undefined`

- [ ] **Step 3: 스키마에 `options` 를 더한다**

`server/src/schema.ts`의 `Intent` 타입에서 `ambiguous` 줄을 바꾼다:

```ts
  /** 되묻기. options 가 있으면 화면이 자유 입력 대신 칩으로 그린다.
      field 가 `stop:<검색어>` 면 그 경유지를 좁히는 질문이다 */
  ambiguous: { field: string; question: string; options: string[] }[];
```

그리고 `parseIntent` 의 `ambiguous` 매핑을 바꾼다:

```ts
    ambiguous: (Array.isArray(r.ambiguous) ? r.ambiguous : [])
      .slice(0, 4)
      .map(a => {
        const x = (a ?? {}) as Record<string, unknown>;
        return {
          field: clampText(x.field, 'text'),
          question: clampText(x.question),
          // 선택지는 그대로 화면의 탭 대상이 된다 — 길이와 개수를 여기서 자른다.
          // 프롬프트 규칙은 1차선일 뿐이고, 앱에 닿는 건 이 필터를 통과한 것뿐이다
          options: (Array.isArray(x.options) ? x.options : [])
            .filter(isStr)
            .map(o => o.slice(0, 20))
            .slice(0, 4),
        };
      })
      .filter(a => a.question),
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test server/src/schema.test.ts`
Expected: PASS (기존 포함 전부)

- [ ] **Step 5: 앱 타입과 로컬 목의 실패 테스트를 쓴다**

`src/lib/intent.test.ts` 맨 아래에 추가한다.

```ts
test('목 — 넓은 업종은 선택지를 함께 낸다', () => {
  const i = extractIntent('가는 길에 빵 사고 싶어', { currentStops: [] });
  assert.equal(i.stops.length, 1);
  const q = i.ambiguous.find(a => a.field.startsWith('stop:'));
  assert.ok(q, '되묻기가 있어야 한다');
  assert.ok(q!.options.length >= 2, `선택지 ${q!.options.length}개`);
  assert.ok(q!.options.includes('상관없어요'), '고르지 않을 길을 남긴다');
  // 선택지는 그 업종의 검색어여야 한다 — 고르면 그대로 검색어가 된다
  assert.ok(q!.options.some(o => o.includes('파리바게뜨') || o.includes('빵')));
});

test('목 — 좁은 질의는 되묻지 않는다', () => {
  const i = extractIntent('올리브영 들르고 싶어', { currentStops: [] });
  assert.equal(i.ambiguous.filter(a => a.field.startsWith('stop:')).length, 0);
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx tsx --test src/lib/intent.test.ts`
Expected: FAIL — `options` 가 타입에 없거나 되묻기가 비어 있다

- [ ] **Step 7: 앱 타입과 목을 고친다**

`src/lib/intent.ts` 의 `Intent` 타입에서 `ambiguous` 줄을 서버와 **같은 모양**으로 바꾼다:

```ts
  ambiguous: { field: string; question: string; options: string[] }[];
```

기존에 `base.ambiguous.push({ field: ..., question: ... })` 하는 곳이 여럿이다. 전부 `options: []` 를 더한다(선택지 없는 되묻기는 지금까지처럼 문장만 띄운다).

그리고 넓은 업종 표를 파일 위쪽 `CATEGORIES` 근처에 둔다:

```ts
/**
 * 되물어 좁힐 값어치가 있는 업종. 답이 **검색어를 바꿀 때만** 넣는다 —
 * 물어놓고 결과가 같으면 사용자 시간만 쓴 것이다.
 * '상관없어요'는 항상 마지막에 붙는다: 고르지 않을 길이 없으면 되묻기가 강요가 된다.
 */
const NARROW: { keys: string[]; question: string; options: string[] }[] = [
  { keys: ['빵', '베이커리', '제과'], question: '어떤 빵집으로 할까요?', options: ['파리바게뜨', '뚜레쥬르', '동네 빵집'] },
  { keys: ['마트', '장보'], question: '어떤 마트로 할까요?', options: ['대형마트', '동네 마트', '편의점'] },
  { keys: ['카페', '커피'], question: '어떤 카페로 할까요?', options: ['스타벅스', '동네 카페'] },
];
```

`extractIntent` 가 스톱을 다 만든 뒤, 각 스톱의 `queries[0]` 과 원문을 보고 되묻기를 붙인다. 스톱을 만드는 블록 뒤(`base.ambiguous.push({ field: 'text', ... })` 앞)에 넣는다:

```ts
  // 넓은 업종이면 좁힐 선택지를 낸다. 좁은 질의(브랜드·특정 지점)는 묻지 않는다
  for (const st of base.stops) {
    if (st.kind !== 'category') continue;
    const hit = NARROW.find(n => n.keys.some(k => st.queries[0].includes(k) || text.includes(k)));
    if (!hit) continue;
    base.ambiguous.push({
      field: `stop:${st.queries[0]}`,
      question: hit.question,
      options: [...hit.options, '상관없어요'],
    });
  }
```

`text` 라는 이름의 원문 변수가 그 자리에 없으면 함수 인자 이름을 확인해 맞춘다.

- [ ] **Step 8: 통과를 확인한다**

Run: `npx tsx --test src/lib/intent.test.ts`
Expected: PASS

- [ ] **Step 9: 전체 게이트**

Run: `npm test && npx tsc --noEmit && (cd server && npx tsc --noEmit)`
Expected: 전부 통과

- [ ] **Step 10: 목 케이스 러너로 회귀를 본다**

Run: `node server/run-cases.mjs`
합격 수가 이 변경 전보다 **줄지 않았는지** 본다. 줄었으면 어떤 케이스가 왜 깨졌는지 보고서에 적는다. `AGENTS.md`: 목 기준 실패가 느는 게 늘 나쁜 신호는 아니지만, 이 태스크는 되묻기를 **더하는** 것이라 기존 케이스가 깨질 이유가 없다.

- [ ] **Step 11: 커밋**

```bash
git add server/src/schema.ts server/src/schema.test.ts src/lib/intent.ts src/lib/intent.test.ts
git commit -m "$(cat <<'EOF'
feat(intent): 되묻기에 선택지 — 넓은 업종을 좁힐 칩의 재료

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 프롬프트 v5 — LLM이 선택지를 낸다

**Files:**
- Modify: `server/prompts/extract-intent.md` (원본)
- Modify: `server/src/prompt.ts` (코드 사본)
- Modify: `server/prompts/cases.jsonl` (케이스 추가)

**Interfaces:**
- Consumes: Task 1의 `options` 스키마
- Produces: 동작 변화만. 출력 JSON 예시에 `options` 가 들어간다.

**두 파일을 같이 고치는 이유:** `AGENTS.md`가 `extract-intent.md`를 원본, `prompt.ts`를 코드 사본이라고 정한다. 한쪽만 고치면 다음 사람이 원본을 읽고 다른 동작을 기대한다.

- [ ] **Step 1: 프롬프트에 규칙을 더한다**

`server/src/prompt.ts` 의 `되묻기(ambiguous):` 절 아래에 세 줄을 더한다. 기존 두 줄은 그대로 둔다.

```
- 넓은 업종은 선택지를 함께 낸다. '빵집'·'마트'·'카페'처럼 브랜드·규모에 따라 답이 갈리는 업종이면
  ambiguous에 {"field":"stop:<그 경유지의 queries[0]>","question":"...","options":["...","...","상관없어요"]}를 넣는다.
- options는 **그대로 검색어가 된다.** 실제로 검색되는 말만 넣는다(브랜드명·'동네 빵집' 같은 업종어).
  마지막은 항상 '상관없어요'다 — 고르지 않을 길을 남긴다.
- 좁은 질의는 되묻지 않는다. 브랜드('올리브영')·특정 지점('강남역 스타벅스')은 이미 좁다.
```

그리고 출력 예시 JSON을 선택지가 있는 모양으로 바꾼다:

```
출력은 이 JSON만:
{"resetStops":false,"stops":[{"op":"add","queries":["빵집"],"kind":"category","why":"빵 사기","count":1,"flexible":true,"openNow":false}],"endpoints":{},"order":"auto","arriveBy":null,"mode":null,"reject":null,"ambiguous":[{"field":"stop:빵집","question":"어떤 빵집으로 할까요?","options":["파리바게뜨","뚜레쥬르","동네 빵집","상관없어요"]}]}
```

버전 주석을 `v5 (2026-09-15) — 넓은 업종 되묻기 선택지` 로 올린다.

- [ ] **Step 2: 원본 문서를 같은 내용으로 맞춘다**

`server/prompts/extract-intent.md` 에 같은 규칙과 같은 출력 예시를 반영한다. 두 파일의 규칙 문장이 **글자까지 같아야** 한다.

- [ ] **Step 3: 케이스를 더한다**

`server/prompts/cases.jsonl` 에 한 줄씩 더한다. 이 파일의 기존 줄 모양을 먼저 읽고 필드 이름을 맞춘다. 기대값은 **제품이 어떻게 동작해야 하나**로 쓴다(지금 목이 뭘 할 수 있는지가 아니다).

- "가는 길에 빵 사고 마트에서 장보고 가려고" → stops 둘(빵집·마트), ambiguous 둘, 각 `field` 가 `stop:` 으로 시작하고 `options` 마지막이 '상관없어요'
- "올리브영 들르고 싶어" → ambiguous 에 `stop:` 되묻기 없음
- "강남역 스타벅스 들렀다 가자" → 특정 지점이라 되묻기 없음

- [ ] **Step 4: 목 기준선을 돌린다**

Run: `node server/run-cases.mjs`
목은 Task 1의 `NARROW` 표로 답하므로 빵·마트·카페 케이스가 통과해야 한다. 실패하면 목과 케이스 기대값 중 어느 쪽이 제품 기준에 맞는지 판단해 고치고, 무엇을 왜 고쳤는지 보고서에 적는다.

- [ ] **Step 5: 모델 시뮬레이션 — 과금 없이 실제 모델로 본다**

Run: `node server/run-llm.mjs`
(러너가 인자를 받는다면 새로 더한 세 케이스만 돌린다. 사용법은 파일 머리 주석을 읽는다.)
LLM이 `options` 를 실제로 내는지, '상관없어요'를 마지막에 두는지 본다. 안 내면 프롬프트 문장을 고치고 다시 돌린다. **이 단계에서 품질을 맞춘다 — 서버 실측은 배선 확인용이다.**

- [ ] **Step 6: 전체 게이트**

Run: `npm test && (cd server && npx tsc --noEmit)`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add server/src/prompt.ts server/prompts/extract-intent.md server/prompts/cases.jsonl
git commit -m "$(cat <<'EOF'
feat(prompt): v5 — 넓은 업종에 되묻기 선택지를 내게 한다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 고른 값을 검색어로 — 리듀서

**Files:**
- Modify: `src/state/plan.tsx` (`NARROW_STOP` 액션 + 컨텍스트 노출)
- Modify: `src/state/actionLog.ts` (`stop.narrow` 로그)
- Test: `src/state/actionLog.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ambiguous[].field` 규약(`stop:<queries[0]>`)
- Produces: `PlanAction` 에 `{ type: 'NARROW_STOP'; chipId: string; query: string }`, 컨텍스트에 `narrowStop(chipId, query)`. Task 4가 쓴다.

**`requestStopsFromChips` 는 건드리지 않는다:** 이미 `queries[0]` 을 쓴다. 좁히기가 `queries` 를 `[고른 값]` 한 개로 바꾸면 검색어가 그대로 좁혀진다. 한 곳만 바꾸고 파이프라인은 그대로 두는 게 이 설계의 요점이다.

- [ ] **Step 1: 로그 실패 테스트를 쓴다**

`src/state/actionLog.test.ts` 에 추가한다.

```ts
test('stop.narrow — 무엇을 무엇으로 좁혔는지 남긴다', () => {
  const before = planState();
  const log = describePlanAction({ type: 'NARROW_STOP', chipId: 'ch-1', query: '파리바게뜨' } as never, before);
  assert.equal(log?.a, 'stop.narrow');
  assert.equal(log?.d?.to, '파리바게뜨');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/state/actionLog.test.ts`
Expected: FAIL — `log` 가 null

- [ ] **Step 3: 액션을 더한다**

`src/state/plan.tsx` 의 `PlanAction` 유니온에 한 줄:

```ts
  | { type: 'NARROW_STOP'; chipId: string; query: string }
```

리듀서에 `case 'REMOVE_CHIP':` 바로 위에 추가한다:

```ts
    case 'NARROW_STOP': {
      // 고른 값 하나로 줄인다 — requestStopsFromChips 가 queries[0] 을 쓰므로
      // 검색어가 그대로 좁혀진다. '상관없어요'면 원래대로 두고 질문만 닫는다(화면 몫)
      const chips = state.chips.map(c =>
        c.kind === 'stop' && c.id === action.chipId
          ? { ...c, label: action.query, queries: [action.query], stopKind: 'brand' as const }
          : c,
      );
      return { ...state, chips };
    }
```

`stopKind` 를 `'brand'` 로 올리는 이유는 주석으로 남긴다: 사용자가 고른 값은 더 이상 업종이 아니라 지정이므로, 보강·트렌드 스왑이 도는 `category` 취급에서 빼야 한다.

컨텍스트 값 목록(`applyIntent`·`removeChip` 이 있는 곳)에 더한다:

```ts
      narrowStop: (chipId: string, query: string) => dispatch({ type: 'NARROW_STOP', chipId, query }),
```

컨텍스트 타입 선언에도 같은 시그니처를 더한다.

- [ ] **Step 4: 로그를 더한다**

`src/state/actionLog.ts` 의 `describePlanAction` 에서 `case 'REMOVE_CHIP':` 근처에 추가한다:

```ts
    case 'NARROW_STOP':
      return { a: 'stop.narrow', d: { from: stopName(action.chipId), to: action.query } };
```

`stopName` 이 칩 id 를 못 찾으면 id 를 그대로 돌려주므로 안전하다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx tsx --test src/state/actionLog.test.ts`
Expected: PASS

- [ ] **Step 6: 전체 게이트 + 커밋**

```bash
npm test && npx tsc --noEmit
git add src/state/plan.tsx src/state/actionLog.ts src/state/actionLog.test.ts
git commit -m "$(cat <<'EOF'
feat(plan): NARROW_STOP — 고른 선택지를 그 경유지의 검색어로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 선택지 칩 — 화면

**Files:**
- Modify: `src/screens/PlanScreen.tsx`

**Interfaces:**
- Consumes: Task 1의 `intent.ambiguous[].options`, Task 3의 `narrowStop(chipId, query)`

**지금 화면이 하는 일:** `setReply(intent.reject?.say ?? intent.ambiguous[0]?.question ?? null)` 로 **질문 한 줄만** 띄운다. 선택지는 버려진다. 여기에 칩 줄을 더한다.

- [ ] **Step 1: 되묻기를 상태로 들고 있는다**

`const [reply, setReply] = useState<string | null>(null);` 아래에 더한다:

```ts
  /** 업종을 좁히는 되묻기. 고르거나 경유지가 바뀌면 사라진다 */
  const [narrowAsks, setNarrowAsks] = useState<{ field: string; question: string; options: string[] }[]>([]);
```

추출 응답을 반영하는 `.then(...)` 안, `setReply(...)` 옆에 더한다:

```ts
        setNarrowAsks(intent.ambiguous.filter(a => a.field.startsWith('stop:') && a.options.length > 0));
```

- [ ] **Step 2: 칩 줄을 그린다**

칩 목록을 그리는 블록(`{/* 알아들은 것을 그대로 보여준다 ... */}` 아래) **다음에** 되묻기 블록을 둔다. 이 파일에 이미 있는 칩 스타일과 `AssistantShell` 을 그대로 쓴다 — 새 디자인 언어를 만들지 않는다.

각 되묻기마다: 질문 한 줄, 그 아래 `options` 를 가로로 늘어놓은 탭 가능한 칩들. 칩을 누르면

- `'상관없어요'` 면 `setNarrowAsks(prev => prev.filter(a => a.field !== ask.field))` 만 한다(검색어는 그대로).
- 아니면 그 `field` 가 가리키는 경유지 칩을 찾아 `narrowStop(chip.id, option)` 을 부르고, 같은 되묻기를 목록에서 뺀다.

경유지 칩 찾기: `field` 는 `stop:<검색어>` 이므로

```ts
  const chipFor = (field: string) => {
    const q = field.slice('stop:'.length);
    return state.chips.find(c => c.kind === 'stop' && c.queries.includes(q));
  };
```

못 찾으면(이미 지운 경유지) 그 되묻기는 그리지 않는다.

- [ ] **Step 3: 시뮬레이터에서 눈으로 본다**

빌드·설치는 Task 5의 절차를 따른다. 여기서는 **보이는지**만 본다 — 질문과 칩이 경유지 칩 아래에 나오고, 탭하면 경유지 칩 이름이 고른 값으로 바뀌고 되묻기가 사라진다.

- [ ] **Step 4: 게이트 + 커밋**

```bash
npm test && npx tsc --noEmit
git add src/screens/PlanScreen.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 업종 되묻기 선택지 칩 — 한 번 탭으로 검색어를 좁힌다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 시뮬레이터 검증 (컨트롤러가 직접 한다)

**준비**

```bash
xcodebuild -workspace ios/Etavia.xcworkspace -scheme Etavia -configuration Debug \
  -destination "id=32E7E297-E515-478B-8EB4-62E8AF4B069E" -derivedDataPath ./build-sim
xcrun simctl install 32E7E297-E515-478B-8EB4-62E8AF4B069E ./build-sim/Build/Products/Debug-iphonesimulator/Etavia.app
```

번들 id 는 `com.etavia.app`. **검증 전에 번들에 새 코드가 들어갔는지 반드시 확인한다** — 브랜치를 바꿔도 Metro 가 다시 만들지 않아 낡은 코드를 보고 판정한 사고가 있었다:

```bash
curl -s "http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false" -o /tmp/b.js
grep -c "NARROW_STOP" /tmp/b.js
```

한글 입력은 `export LANG=en_US.UTF-8` 뒤 `pbcopy` + `xcrun simctl pbsync host <udid>`, 그리고 필드를 탭해 포커스를 준 뒤
`osascript -e 'tell application "System Events" to set frontmost of process "Simulator" to true'` → Cmd+V.

**검증 항목**

- [ ] **1. 선택지가 뜬다**: 현대카드빌딩 2관 → 신정동(회사), 대중교통, "가는 길에 빵 사고 마트에서 장보고 가려고". 빵집·마트 칩 아래에 각각 질문과 선택지 칩이 나온다.
- [ ] **2. 고르면 검색어가 바뀐다**: 빵집에서 `파리바게뜨`를 고른다. 경유지 칩 이름이 바뀌고 되묻기가 사라진다. 트랙 로그에 `stop.narrow`(from 빵집, to 파리바게뜨)가 남는다.
- [ ] **3. 후보가 실제로 좁아진다**: 경로를 찾고 `plan.slots` 의 `picks` 를 본다. **빵집 후보가 전부 파리바게뜨여야 한다.** 좁히기 전 실행(와플대학이 1등이던 그것)과 나란히 적는다.
- [ ] **4. '상관없어요'는 아무것도 안 바꾼다**: 마트는 `상관없어요`를 고른다. 되묻기만 사라지고 경유지 칩과 검색어는 그대로다. 로그에 `stop.narrow` 가 **없어야** 한다.
- [ ] **5. 좁은 질의는 묻지 않는다**: "올리브영 들르고 싶어" 로 다시 돌려 되묻기가 안 나오는지 본다.
- [ ] **6. 못 찾는 경우가 정직한가**: 경로 근처에 없을 브랜드를 고른다(예: 카페에서 지역에 없는 브랜드). 후보가 적거나 없을 때 화면이 이미 있는 `short`/`none` 표시를 내는지 본다. 조용히 넓은 검색으로 되돌아가면 안 된다.
- [ ] **7. 자동차 회귀**: 같은 흐름을 자동차로 한 번 돌려 되묻기와 좁히기가 이동수단과 무관하게 도는지 본다.

**완료 기준**: 1·2·3·4 통과. 3번의 전후 비교를 `docs/대중교통-경로-단계계획.md` §6.7 에 실측으로 적는다.

---

## Self-Review

**1. 스펙 커버리지** (`docs/대중교통-경로-단계계획.md` §6.7)

| 스펙 문장 | 태스크 |
|---|---|
| 이미 뽑은 업종을 좁히는 새 용도의 되묻기 | Task 1(배관)·2(프롬프트) |
| 답이 검색어나 카테고리 코드를 바꿀 때만 묻는다 | Task 1의 `NARROW` 표, Task 2의 "좁은 질의는 되묻지 않는다" 규칙, Task 5 항목 5 |
| 자유 입력이 아니라 칩으로 한 번 탭 | Task 4 |
| 순위 가중치가 아니라 후보 생성 단계를 바꾼다 | Task 3 (`queries` 를 바꿔 검색어 자체를 좁힌다) |
| 기억하는 건 다음 단계 | 이 계획에 저장 계층이 없다. Task 3은 이번 세션 상태만 바꾼다 |

**2. 플레이스홀더 점검**: 모든 코드 단계에 실제 코드가 있다. Task 2 Step 3(케이스 추가)과 Task 4 Step 2(칩 그리기)는 기존 파일의 모양을 따라야 해서 형태를 글자 그대로 적지 않았는데, 둘 다 **무엇을 만족해야 하는지**를 명시했고 참조할 기존 코드를 지목했다.

**3. 타입 일관성**: `ambiguous: { field, question, options }` 가 서버(`server/src/schema.ts`)와 앱(`src/lib/intent.ts`) 양쪽에 **같은 모양**으로 있어야 한다 — Task 1이 둘 다 바꾼다. `field` 규약 `stop:<queries[0]>` 는 Task 1이 만들고 Task 4가 파싱한다. `narrowStop(chipId, query)` 는 Task 3이 내고 Task 4가 쓴다. `NARROW_STOP` 액션 이름은 Task 3·5에서 같다.

**4. 범위 점검**: 저장(취향 기억), `category_name` 필터, 순위 정책(최적 경로 우선)은 이 계획에 없다. 각각 다음 단계다.
