# `category_name` 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카카오 응답의 `category_name`으로 업종을 걸러, 그룹 코드가 없는 업종의 잡음을 없애고 `'동네 빵집'`처럼 0건을 내던 되묻기 선택지가 실제로 검색되게 한다.

**Architecture:** 질의 하나를 "카카오 검색 계획"으로 옮기는 순수 함수를 새 파일에 둔다 — 보낼 검색어, 그룹 코드, `category_name`이 만족해야 할 조건. `places.ts`는 그 계획대로 요청을 만들고 응답을 거른다. `'동네 X'`는 검색어가 아니라 **접두사**로 읽어 X를 검색하고 프랜차이즈를 뺀다.

**Tech Stack:** TypeScript, React Native(Expo SDK 57), node:test + tsx (`npm test`).

**Spec:** `docs/대중교통-경로-단계계획.md` §6.6

---

## §6.6의 전제는 틀렸다 — 실측으로 정정한다 (2026-09-15, 운영 키)

§6.6은 이렇게 적혀 있다: *"빵집 1순위가 '와플대학 양천구청캠퍼스'였다. 카카오에서 빵집과 와플가게가 같은 FD6라 그룹 코드로는 못 가른다. `category_name`은 '음식점 > 간식 > 제과,베이커리'로 갈린다."*

**갈리지 않는다.**

```
와플대학 홍대캠퍼스     음식점 > 간식 > 제과,베이커리 > 와플대학
파리바게뜨 신정역점     음식점 > 간식 > 제과,베이커리 > 파리바게뜨
케이크라보             음식점 > 간식 > 제과,베이커리
```

신정동·여의도 두 곳에서 빵집 150건을 뽑으면 **150건 전부** `제과,베이커리` 아래다. `category_name`은 와플대학을 못 거른다. §6.6이 약속한 그 효과는 없다.

### 그럼 이 단계에 값이 있나 — 있다. 이유가 다르다

**1. 대부분의 업종에는 그룹 코드가 아예 없다.** 6.5가 쓴 `category_group_code`는 15개 남짓의 거친 묶음이고, 나머지는 전부 빈 값이다.

| 질의 | 표본 | 그룹 코드 없음 |
|---|---|---|
| 문구점 | 30 | **30** |
| 꽃집 | 30 | **30** |
| 세탁소 | 26 | **26** |
| 서점 | 20 | 19 |
| 마트 | 27 | **18** |

`category_name`은 그룹 코드보다 한 칸 촘촘한 게 아니라, **이 업종들에 존재하는 유일한 분류**다.

**2. 동네 마트를 살리면서 잡음만 거를 유일한 방법이다.** 6.5가 `'마트'`를 표에 안 넣은 건 MT1로 묶으면 동네 마트가 전멸하기 때문이었다. 실제로 그렇다 — 동네 마트는 그룹 코드가 비어 있다.

```
[MT1] 경서농협하나로마트 신정점    가정,생활 > 슈퍼마켓 > 대형슈퍼 > 하나로마트
[--]  홈마트                    가정,생활 > 슈퍼마켓
[--]  우리마트                   가정,생활 > 슈퍼마켓
[--]  베스트아울렛 디씨마트         가정,생활 > 생활용품점 > 주방용품 > 주방가구,싱크대판매
[--]  폰마트휴대폰쇼핑몰            가정,생활 > 전자제품 > 전자제품판매 > 휴대폰판매
```

`슈퍼마켓`을 요구하면 동네 마트 13곳이 살고 주방가구·휴대폰판매만 떨어진다. 그룹 코드로는 불가능하다.

**3. 방금 배포한 되묻기의 구멍을 메운다 — 이게 제일 크다.**

```
"동네 빵집"  → 0건
"동네 마트"  → 0건
"대형마트"   → 1건
```

카카오는 **이름만** 매칭하는데 가게 이름을 "동네 마트"라고 짓는 사람이 없다. 6.7이 낸 선택지 네 개 중 브랜드가 아닌 것들이 전부 빈 결과를 낸다. 사용자가 좁혀달라고 골랐는데 아무것도 못 찾는다 — 6.7 검증 6번에서 "진짜 `none`은 재현 못 했다"고 적었던 그 상황이, 사실은 **항상** 일어나고 있었다.

`'동네 빵집'`은 검색어가 아니라 필터다. `'빵집'`을 검색하고 프랜차이즈를 빼는 것이 그 말의 뜻이다.

### "마지막 조각이 브랜드"는 규칙이 못 된다

되묻기 계획에서 *"`category_name` 마지막 조각이 브랜드다"* 라고 적었다. 빵집만 보면 맞지만 일반화되지 않는다.

```
음식점 > 카페 > 테마카페 > 디저트카페        ← 하위 업종
문화,예술 > 도서 > 서점 > 독립서점           ← 하위 업종
의료,건강 > 병원 > 피부과                   ← 하위 업종
음식점 > 카페 > 테마카페 > 디저트카페 > 백미당  ← 브랜드가 5단계에
```

그래서 구조 규칙을 쓰지 않는다. **아는 프랜차이즈 이름만 적는다** — 6.5의 "아는 것만 거른다"와 같은 원칙이고, 손해의 방향도 같다: 빠뜨린 체인은 '동네' 결과에 섞일 뿐이지만(작은 체인이면 오히려 맞다), 잘못 적은 이름은 멀쩡한 가게를 지운다.

---

## Global Constraints

- 스테이징은 파일명을 직접 적는다. `git add -A` / `git add .` **금지**.
- 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 완료 게이트: `npm test` 전부 통과 + `npx tsc --noEmit` exit 0 + `cd server && npx tsc --noEmit` exit 0.
- **표는 실측으로만 쓴다.** 추론으로 쓰면 틀린다 — 6.5에서 농협→하나로마트·의원→국회의원회관 등 7건이 그렇게 걸렸다. 이 계획의 모든 표 값은 2026-09-15 운영 키 실측이다.
- **손해는 한쪽으로만.** 거를 조건을 모르면 안 거른다(지금까지처럼 이름 매칭). 조건을 잘못 적으면 결과가 0건이 된다.
- API 키 값을 코드·문서·커밋에 절대 넣지 않는다. 키는 루트 `.env`에만 있다.
- `src/lib/places.ts`는 `expo-constants`를 물고 있어 **node 테스트가 못 읽는다**(`corridorSearch.ts` 머리 주석). 그 파일의 검증은 `tsc` + 시뮬레이터다.
- 테스트는 `npm test` 하나로 돈다(`src/**/*.test.ts` + `server/src/*.test.ts`).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/placeCategory.ts` (그대로) | 질의 → 카카오 **그룹 코드**. 6.5가 만든 표. 이 계획은 안 건드린다 |
| `src/lib/placeQuery.ts` (**새로**) | 질의 → **검색 계획**(보낼 검색어·그룹 코드·`category_name` 조건). `placeCategory`를 안에서 부른다 |
| `src/lib/placeQuery.test.ts` (**새로**) | 위의 순수 함수 시험 |
| `src/lib/places.ts` (수정) | 계획대로 요청을 만들고 응답을 거른다 |

`placeCategory.ts`를 늘리지 않고 파일을 나누는 이유: 그룹 코드는 **요청 파라미터**이고 `category_name`은 **응답 필터**다. 카카오에서 다루는 방식이 달라서, 한 파일에 섞으면 다음 사람이 둘을 같은 것으로 읽는다.

---

### Task 1: `placeQuery.ts` — 질의를 검색 계획으로 옮긴다

**Files:**
- Create: `src/lib/placeQuery.ts`
- Create: `src/lib/placeQuery.test.ts`

**Interfaces:**
- Consumes: `kakaoCategoryFor(query: string): string | null` from `./placeCategory`
- Produces: Task 2가 쓴다.
  ```ts
  export type SearchPlan = {
    query: string;
    categoryCode: string | null;
    pathAny: string[];
    pathNot: string[];
    localOnly: boolean;
  };
  export function planSearch(query: string): SearchPlan;
  export function keepByCategoryName(categoryName: string | undefined, plan: SearchPlan): boolean;
  ```

- [ ] **Step 1: 실패 테스트를 쓴다**

`src/lib/placeQuery.test.ts` 를 새로 만든다. `src/lib/placeCategory.test.ts` 의 import 방식(`.ts` 확장자 포함)을 그대로 따른다.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepByCategoryName, planSearch } from './placeQuery.ts';

test("'동네 X' 는 검색어가 아니라 접두사다 — X 를 찾고 프랜차이즈를 뺀다", () => {
  // 실측 2026-09-15: "동네 빵집" 질의는 카카오에서 0건이다. 가게 이름이 그렇지 않으니까
  const p = planSearch('동네 빵집');
  assert.equal(p.query, '빵집');
  assert.ok(p.pathAny.includes('제과,베이커리'));
  assert.equal(p.localOnly, true);
});

test("표에 없는 업종이어도 '동네' 접두사는 떼어낸다 — 0건보다 낫다", () => {
  const p = planSearch('동네 반찬가게');
  assert.equal(p.query, '반찬가게');
  assert.deepEqual(p.pathAny, [], '모르는 업종은 안 거른다');
  assert.equal(p.localOnly, true);
});

test('대형마트 — 실측상 1건뿐인 질의를 마트 검색 + 경로 조건으로 옮긴다', () => {
  const p = planSearch('대형마트');
  assert.equal(p.query, '마트');
  assert.deepEqual(p.pathAny, ['대형슈퍼', '대형마트']);
});

test('동네 마트 — 슈퍼마켓이되 대형슈퍼는 뺀다', () => {
  const p = planSearch('동네 마트');
  assert.equal(p.query, '마트');
  assert.deepEqual(p.pathAny, ['슈퍼마켓']);
  assert.deepEqual(p.pathNot, ['대형슈퍼']);
});

test('모르는 질의는 아무것도 안 거른다 — null 이 0건보다 낫다', () => {
  const p = planSearch('올리브영');
  assert.equal(p.query, '올리브영');
  assert.deepEqual(p.pathAny, []);
  assert.equal(p.localOnly, false);
});

test('이마트24 는 편의점이다 — 마트 규칙에 먼저 걸리면 안 된다', () => {
  // "가정,생활 > 편의점 > 이마트24" 라서, 마트 규칙(슈퍼마켓)에 걸리면 전멸한다
  const p = planSearch('이마트24');
  assert.ok(p.pathAny.includes('편의점'));
  assert.ok(keepByCategoryName('가정,생활 > 편의점 > 이마트24', p));
});

test('마트 — 동네 마트는 살리고 주방가구·휴대폰판매는 버린다', () => {
  const p = planSearch('마트');
  const keep = (c: string) => keepByCategoryName(c, p);
  assert.ok(keep('가정,생활 > 슈퍼마켓'), '홈마트·우리마트 (그룹 코드 없음)');
  assert.ok(keep('가정,생활 > 슈퍼마켓 > 대형슈퍼 > 하나로마트'));
  assert.ok(keep('가정,생활 > 대형마트 > 이마트'));
  assert.ok(!keep('가정,생활 > 생활용품점 > 주방용품 > 주방가구,싱크대판매'));
  assert.ok(!keep('가정,생활 > 전자제품 > 전자제품판매 > 휴대폰판매'));
});

test('동네 빵집 — 프랜차이즈만 뺀다. 작은 체인은 동네에 가깝다', () => {
  const p = planSearch('동네 빵집');
  const keep = (c: string) => keepByCategoryName(c, p);
  assert.ok(keep('음식점 > 간식 > 제과,베이커리'), '이름 없는 동네 빵집');
  assert.ok(!keep('음식점 > 간식 > 제과,베이커리 > 파리바게뜨'));
  assert.ok(!keep('음식점 > 간식 > 제과,베이커리 > 뚜레쥬르'));
  assert.ok(!keep('음식점 > 간식 > 제과,베이커리 > 와플대학'));
  // 실측: 김영모과자점·하르당은 지점이 몇 안 되는 작은 체인이다. 일부러 목록에 안 넣는다
  assert.ok(keep('음식점 > 간식 > 제과,베이커리 > 김영모과자점'));
});

test('동네 카페 — 브랜드 깊이가 제각각이라 구조가 아니라 이름으로 뺀다', () => {
  const p = planSearch('동네 카페');
  const keep = (c: string) => keepByCategoryName(c, p);
  assert.ok(keep('음식점 > 카페'));
  assert.ok(keep('음식점 > 카페 > 커피전문점'), '이름 없는 커피전문점은 동네다');
  assert.ok(keep('음식점 > 카페 > 테마카페 > 디저트카페'), '마지막 조각이 브랜드가 아니다');
  assert.ok(!keep('음식점 > 카페 > 커피전문점 > 스타벅스'));
  assert.ok(!keep('음식점 > 카페 > 테마카페 > 디저트카페 > 백미당'), '브랜드가 5단계에 있다');
});

test('category_name 이 없으면 통과시킨다 — 거를 근거가 없다', () => {
  const p = planSearch('마트');
  assert.ok(keepByCategoryName(undefined, p));
  assert.ok(keepByCategoryName('', p));
});

test('빵집 — FD6 그룹 코드는 없고 경로 조건만 붙는다', () => {
  const p = planSearch('빵집');
  assert.equal(p.query, '빵집');
  assert.deepEqual(p.pathAny, ['제과,베이커리']);
  assert.equal(p.localOnly, false, '좁히지 않은 빵집은 프랜차이즈도 후보다');
});

test('그룹 코드는 새 검색어로 정한다 — 접두사를 뗀 뒤에 본다', () => {
  assert.equal(planSearch('동네 카페').categoryCode, 'CE7');
  assert.equal(planSearch('대형마트').categoryCode, 'MT1', "'마트'로 바뀐 뒤 이마트 규칙에 걸린다");
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/placeQuery.test.ts`
Expected: FAIL — 모듈이 없다

- [ ] **Step 3: `placeQuery.ts` 를 만든다**

```ts
/**
 * 질의 → 카카오 검색 계획.
 *
 * 6.5가 붙인 `category_group_code`는 15개 남짓의 거친 묶음이고, 문구점·꽃집·세탁소·
 * 동네 마트는 **그룹 코드가 아예 비어 있다**(실측 2026-09-15: 문구점 30/30, 꽃집 30/30,
 * 세탁소 26/26이 빈 값). 그 업종에 존재하는 유일한 분류가 `category_name`이다.
 *
 * 그리고 `'동네 빵집'`은 **검색어가 아니다.** 카카오는 이름만 매칭하는데 가게 이름을
 * 그렇게 짓는 사람이 없어서 실측 0건이다. 6.7의 되묻기가 그 말을 그대로 검색어로
 * 보내고 있었다 — 여기서 `'빵집'` 검색 + 프랜차이즈 제외로 옮긴다.
 *
 * 표는 전부 운영 키 실측이다. 추론으로 쓰면 틀린다(6.5에서 7건이 그렇게 걸렸다).
 */
import { kakaoCategoryFor } from './placeCategory';

export type SearchPlan = {
  /** 카카오에 실제로 보낼 검색어. 원래 질의와 다를 수 있다 */
  query: string;
  /** 카카오 `category_group_code`. 모르면 null */
  categoryCode: string | null;
  /** `category_name`이 이 중 **하나라도** 포함해야 통과. 비면 안 거른다 */
  pathAny: string[];
  /** 이 조각이 경로에 있으면 버린다 */
  pathNot: string[];
  /** 아는 프랜차이즈 이름이 경로에 있으면 버린다 */
  localOnly: boolean;
};

/**
 * '동네 X' · '작은 X' · '소형 X' 는 X 를 찾고 프랜차이즈를 빼라는 뜻이다.
 * 표에 없는 업종이어도 접두사는 뗀다 — 못 거를지언정 0건보다 낫다.
 */
const LOCAL_PREFIX = /^(?:동네|작은|소형)\s*/;

/**
 * 앞에서부터 먼저 걸리는 것이 이긴다. `placeCategory.ts`의 표와 같은 규칙이고,
 * 같은 함정이 있다 — 이마트24(편의점)가 이마트(마트)보다 **앞**이어야 한다.
 * 뒤에 두면 "가정,생활 > 편의점 > 이마트24"가 슈퍼마켓 조건에 걸려 전멸한다.
 */
const TABLE: { re: RegExp; query?: string; pathAny: string[]; pathNot?: string[] }[] = [
  // 실측: "가정,생활 > 편의점 > GS25 / 세븐일레븐 / CU / 이마트24" — 30/30이 이 경로
  { re: /편의점|씨유|\bcu\b|gs25|세븐일레븐|이마트24|미니스톱/i, pathAny: ['편의점'] },
  // 실측: "가정,생활 > 대형마트 > 이마트" 와 "... > 슈퍼마켓 > 대형슈퍼 > 하나로마트"
  // 두 경로가 다 있다. 대형은 둘 다 받아야 한다
  { re: /대형\s*마트|대형\s*슈퍼/i, query: '마트', pathAny: ['대형슈퍼', '대형마트'] },
  { re: /마트|슈퍼/i, pathAny: ['슈퍼마켓', '대형마트'] },
  // 실측: 150건 전부 "음식점 > 간식 > 제과,베이커리". 와플대학도 여기다 —
  // 그룹 코드로도 category_name 으로도 와플가게는 못 가른다(§6.6 정정)
  { re: /빵집|빵|베이커리|제과/i, query: '빵집', pathAny: ['제과,베이커리'] },
  { re: /카페|커피/i, pathAny: ['카페'] },
  { re: /정육|고기\s*사/i, query: '정육점', pathAny: ['정육점'] },
  { re: /문구/i, pathAny: ['문구,사무용품'] },
  { re: /꽃집|꽃\s*사|플라워/i, query: '꽃집', pathAny: ['꽃집,꽃배달'] },
  { re: /세탁소|빨래방|코인빨래/i, pathAny: ['세탁소'] },
  { re: /서점|책방/i, pathAny: ['서점'] },
  { re: /약국/i, pathAny: ['약국'] },
];

/** '동네 마트'는 슈퍼마켓이되 대형슈퍼는 아니다. 접두사만으로는 표현이 안 돼 따로 둔다 */
const LOCAL_PATH_NOT: Record<string, string[]> = { 마트: ['대형슈퍼'] };

/**
 * 아는 프랜차이즈. **경로 어느 조각이든** 이 이름이면 '동네'가 아니다.
 *
 * 구조로 못 가른다 — 브랜드가 4단계에 있기도(…제과,베이커리 > 파리바게뜨),
 * 5단계에 있기도(…테마카페 > 디저트카페 > 백미당) 하고, 4단계가 하위 업종인
 * 경우도 많다(…테마카페 > 디저트카페, …서점 > 독립서점, …병원 > 피부과).
 *
 * 일부러 넣지 않은 것: 김영모과자점·하르당·복호두·버터풀앤크리멀러스처럼 지점이
 * 몇 안 되는 작은 체인. 사용자가 피하고 싶은 건 가맹점이지 작은 체인이 아니다.
 * 빠뜨린 체인은 '동네' 결과에 섞일 뿐이고, 잘못 적은 이름은 멀쩡한 가게를 지운다.
 */
const FRANCHISE = [
  // 빵 — 실측 150건에서 꼬리로 나온 것들
  '파리바게뜨', '뚜레쥬르', '파리크라상', '아티제', '앤티앤스프레즐', '와플대학', '브레댄코', '코코호도', '던킨',
  // 카페 — 실측
  '스타벅스', '투썸플레이스', '이디야커피', '컴포즈커피', '빽다방', '할리스', '커피빈', '폴바셋',
  '메가MGC커피', '매머드익스프레스', '텐퍼센트커피', '파스쿠찌', '엔제리너스', '탐앤탐스',
  '더벤티', '감성커피', '백미당', '블루보틀',
];

export function planSearch(raw: string): SearchPlan {
  const trimmed = raw.trim();
  const localOnly = LOCAL_PREFIX.test(trimmed);
  const base = localOnly ? trimmed.replace(LOCAL_PREFIX, '').trim() : trimmed;
  const flat = base.replace(/\s+/g, '');

  const hit = TABLE.find(t => t.re.test(flat));
  const query = hit?.query ?? base;
  const pathNot = [...(hit?.pathNot ?? []), ...(localOnly ? (LOCAL_PATH_NOT[query] ?? []) : [])];

  return {
    query,
    categoryCode: kakaoCategoryFor(query),
    pathAny: hit?.pathAny ?? [],
    pathNot,
    localOnly,
  };
}

/** 계획의 경로 조건을 통과하는가. `category_name`이 없으면 거를 근거가 없으니 통과 */
export function keepByCategoryName(categoryName: string | undefined, plan: SearchPlan): boolean {
  if (!categoryName) return true;
  if (plan.pathAny.length > 0 && !plan.pathAny.some(p => categoryName.includes(p))) return false;
  if (plan.pathNot.some(p => categoryName.includes(p))) return false;
  if (plan.localOnly && FRANCHISE.some(f => categoryName.includes(f))) return false;
  return true;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/placeQuery.test.ts`
Expected: PASS

실패하면 표를 고치기 전에 **어느 쪽이 사실인지 실측으로 확인한다.** 키는 루트 `.env`의 `KAKAO_REST_KEY`이고, 값을 출력하거나 붙여넣지 않는다:

```bash
set -a && . ./.env && set +a
curl -s -G "https://dapi.kakao.com/v2/local/search/keyword.json" \
  -H "Authorization: KakaoAK $KAKAO_REST_KEY" \
  --data-urlencode "query=마트" --data-urlencode "x=126.8556" \
  --data-urlencode "y=37.5220" --data-urlencode "radius=1000" --data-urlencode "size=15" \
  | python3 -c "import sys,json;[print(d['category_group_code'] or '--', d['place_name'], '|', d['category_name']) for d in json.load(sys.stdin)['documents']]"
```

- [ ] **Step 5: 전체 게이트**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/lib/placeQuery.ts src/lib/placeQuery.test.ts
git commit -m "$(cat <<'EOF'
feat(places): 질의를 검색 계획으로 — category_name 조건과 '동네' 접두사

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `places.ts` 배선 — 계획대로 요청하고 응답을 거른다

**Files:**
- Modify: `src/lib/places.ts` (`kakaoProvider.search`, 163~205행 부근)

**Interfaces:**
- Consumes: Task 1의 `planSearch`, `keepByCategoryName`, `SearchPlan`

**왜 테스트가 없나:** `places.ts`는 `expo-constants`를 물고 있어 node 테스트가 이 파일을 못 읽는다(`corridorSearch.ts` 머리 주석에 같은 이유가 적혀 있다). 검증은 `tsc` + Task 3의 시뮬레이터다. 로직은 전부 Task 1의 순수 함수에 있고 이 태스크는 **배선만** 한다 — 그래서 여기에 판단이 들어가면 안 된다.

- [ ] **Step 1: `kakaoCategoryFor` 호출을 `planSearch` 로 바꾼다**

지금 코드(163행 부근):

```ts
  async search(query, near, radiusM) {
    const keywordParams = new URLSearchParams({ query, size: '15' });
    /* ... 기존 주석 ... */
    const categoryCode = kakaoCategoryFor(query);
    if (categoryCode) keywordParams.set('category_group_code', categoryCode);
```

이렇게 바꾼다:

```ts
  async search(query, near, radiusM) {
    /*
      카카오는 이름만 매칭한다 — "국민은행"에 "국민은행앞1 공영노상주차장"(PK6)과
      "현대그린푸드국민은행 여의도전산센터"(FD6)가 같이 온다. 2026-09-15 시뮬레이터에서
      그 주차장이 1순위 추천이 됐다. 아는 업종이면 코드로 서버에서 거른다.
      모르는 업종(올리브영 같은 브랜드)은 코드 자체가 없어서 찍으면 0건이 된다 — 그래서 null.

      코드로 못 거르는 업종이 더 많다(문구점·꽃집·세탁소·동네 마트는 코드가 빈 값이다).
      그건 응답의 category_name 으로 거른다. '동네 빵집' 처럼 검색어로는 0건인 말도
      여기서 실제 검색어로 옮긴다 — planSearch 가 둘 다 정한다.
    */
    const plan = planSearch(query);
    const keywordParams = new URLSearchParams({ query: plan.query, size: '15' });
    if (plan.categoryCode) keywordParams.set('category_group_code', plan.categoryCode);
```

`import { kakaoCategoryFor } from './placeCategory';` (14행)을 `import { keepByCategoryName, planSearch } from './placeQuery';` 로 바꾼다. `kakaoCategoryFor` 가 이 파일에서 더 안 쓰이는지 확인한다(`grep -n kakaoCategoryFor src/lib/places.ts`).

- [ ] **Step 2: 주소 검색 건너뛰기 조건을 넓힌다**

지금은 그룹 코드가 있을 때만 주소 검색을 건너뛴다. `category_name` 으로 거르는 질의도 **업종 질의**라 같은 이유가 그대로 적용된다 — 카테고리로 거른 것을 주소 결과가 뒷문으로 다시 들인다.

```ts
    // 업종을 물었으면 주소 결과는 부르지 않는다 — 카테고리로 거른 것을 뒷문으로 다시 들인다.
    // 주소 검색은 POI 가 없는 순수 주소를 메우는 보조라, 업종 질의에는 쓸모가 없다.
    const isCategoryQuery = plan.categoryCode != null || plan.pathAny.length > 0;
```

`Promise.all` 안의 삼항에서 `categoryCode` 를 `isCategoryQuery` 로 바꾸고, 주소 검색의 `query` 도 `plan.query` 를 쓴다.

- [ ] **Step 3: 응답을 거른다**

`places` 를 만드는 `.map(...)` 앞에 필터를 넣는다:

```ts
    const kept = ((keyword.documents ?? []) as KakaoKeywordDoc[]).filter(d =>
      keepByCategoryName(d.category_name, plan),
    );
    const places: Place[] = kept.map(d => ({
```

**한 페이지만 받는다(15건, 카카오 상한).** 걸러서 남는 수가 줄면 `searchAlong`·`searchAtAnchors`가 반지름을 넓혀 다시 부른다 — 호출이 늘 수 있지만, 없는 걸 있다고 하는 것보다 낫고 이미 있는 장치다. 페이지를 더 받는 건 이 단계에서 안 한다.

- [ ] **Step 4: 게이트**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 통과 (`places.ts` 는 테스트가 없으므로 `tsc` 가 유일한 자동 검증이다)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/places.ts
git commit -m "$(cat <<'EOF'
feat(places): 검색 계획대로 요청하고 category_name 으로 거른다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 시뮬레이터 검증 (컨트롤러가 직접 한다)

**도구: Claude Desktop 빌트인 iOS 시뮬레이터를 쓴다.** 화면을 열고 두드리고 읽는 건 전부 빌트인(`attach` · `screenshot` · `tap` · `text` · `inspect`)으로 한다. `xcrun simctl`·`osascript` 는 빌트인이 못 하는 세 가지에만 쓴다 — 번들 확인(`curl`), 앱 재시작, 트랙 로그 읽기. 두 경로를 섞으면 좌표계와 포커스가 어긋나 엉뚱한 걸 누른다.

**준비**

번들에 새 코드가 들어갔는지 **반드시** 먼저 확인한다 — 브랜치를 바꿔도 Metro 가 다시 만들지 않아 낡은 코드를 보고 판정한 사고가 있었다(§6.5 기록):

```bash
curl -s "http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false" -o /tmp/b.js
grep -c "keepByCategoryName" /tmp/b.js
xcrun simctl terminate 32E7E297-E515-478B-8EB4-62E8AF4B069E com.etavia.app
xcrun simctl launch 32E7E297-E515-478B-8EB4-62E8AF4B069E com.etavia.app
```

그다음 빌트인 `attach`(device `32E7E297-E515-478B-8EB4-62E8AF4B069E`)로 화면을 연다. 번들 id 는 `com.etavia.app`.

**좌표계 함정(2026-09-15 실측).** `attach` 가 알려주는 좌표계는 **390×844 포인트**인데 `screenshot` 이 돌려주는 이미지는 그보다 크다(`scale` 을 줘도 좌표는 항상 포인트 기준이다). 이미지에서 읽은 픽셀을 그대로 `tap` 에 넣으면 어긋난다 — 되묻기 검증 때 목적지를 '회사' 대신 '집'으로 두 번 잘못 골랐다. 변환은 `포인트 = 이미지픽셀 × 844 / 이미지높이` 이고, 이미지 높이는 `너비 ÷ 0.462` 로 구한다. 가능하면 `inspect` 로 프레임을 받아 그 중심을 누른다.

**한글 입력**: 빌트인 `text` 를 먼저 시도한다. 안 들어가면 클립보드로 넘긴다 —
`export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` 뒤 `pbcopy`, `xcrun simctl pbsync host <udid>`, 빌트인 `tap` 으로 입력 필드 포커스, `osascript -e 'tell application "System Events" to set frontmost of process "Simulator" to true'` → Cmd+V → 뜨는 `Paste` 메뉴를 빌트인 `tap` 으로 누른다. (`activate` 만으로는 포커스가 안 넘어간다.)

트랙 로그는 앱 컨테이너의 `Documents/tracklog/track-YYYYMMDD.jsonl`. `plan.slots` 의 `picks` 를 본다. **계산이 끝난 뒤에 읽는다** — 도는 중에 `tail -1` 하면 이전 실행의 줄을 읽고 엉뚱한 판정을 한다(6단계에서 그렇게 한 번 틀렸다).

**검증 항목**

- [ ] **1. 마트 잡음이 사라진다**: 내 위치(여의도) → 회사(신정동), 대중교통, "마트에서 장보고 가려고". `상관없어요`를 고른다. `picks` 의 마트 후보에서 **목동안경마트·메이플문구 팬시할인마트·CU 가 사라지고**, 홈마트·우리마트 같은 동네 마트는 **남아야** 한다. 6.7 실측(20:24 실행)과 나란히 적는다.
- [ ] **2. '동네 빵집'이 실제로 검색된다**: 같은 경로에 "가는 길에 빵 사고". 되묻기에서 `동네 빵집`을 고른다. **고치기 전이면 0건이다.** 후보가 나오고, 그 안에 파리바게뜨·뚜레쥬르가 **없어야** 한다.
- [ ] **3. 좁히지 않은 빵집은 그대로다**: 같은 문장에서 `상관없어요`를 고른다. 파리바게뜨가 후보에 **있어야** 한다 — 프랜차이즈 제외는 '동네'를 골랐을 때만이다.
- [ ] **4. 브랜드 질의 회귀**: "올리브영 들르고 싶어". 올리브영은 표에 없으므로 `pathAny` 가 비고 아무것도 안 걸러져야 한다. 후보 수가 6.5 때(10곳)와 같은 수준인지 본다.
- [ ] **5. 은행 회귀(6.5 가 고친 것)**: "은행 들러야 해". BK9 그룹 코드가 그대로 걸리고 주차장·구내식당이 없어야 한다.
- [ ] **6. 반경이 얼마나 더 넓어지는가**: `plan.slots` 의 `search` 줄에서 `r=` 와 `calls=` 를 6.7 실측과 비교한다. 거르면 남는 수가 줄어 반지름을 더 넓힐 수 있다 — 얼마나 늘었는지 숫자로 적는다. 늘었다고 실패는 아니지만, 모르고 지나가면 안 되는 비용이다.

**완료 기준**: 1·2·3·4·5 통과. 1·2 의 전후 비교와 6 의 호출 수를 `docs/대중교통-경로-단계계획.md` §6.6 에 실측으로 적고, §6.6 의 틀린 전제(빵집/와플가게)를 정정한다.

---

## Self-Review

**1. 스펙 커버리지** (`docs/대중교통-경로-단계계획.md` §6.6)

| 스펙 문장 | 태스크 |
|---|---|
| 응답의 `category_name`을 후보에 싣고 질의별 기대 경로 조각으로 거른다 | Task 1(`pathAny`)·2(필터) |
| 그룹 코드처럼 **아는 것만** 거른다 | Task 1 — 표에 없으면 `pathAny: []` |
| "마트"를 대형마트로 묶으면 동네 마트가 사라진다 | Task 1 — `pathAny: ['슈퍼마켓','대형마트']` 로 동네를 살린다. Task 3 항목 1이 눈으로 확인 |
| 빵집 1순위가 와플대학이었다 → `category_name`이 가른다 | **불가.** 실측으로 반증했고 계획 머리에 정정을 적었다. 이 단계는 그걸 약속하지 않는다 — 와플대학은 6.7의 되묻기가 다룰 몫이다 |
| (스펙에 없던 것) 되묻기 선택지가 0건을 낸다 | Task 1의 `LOCAL_PREFIX` + Task 3 항목 2. 6.7이 만든 결함이라 이 단계에서 같이 메운다 |

**2. 플레이스홀더 점검**: 모든 코드 단계에 실제 코드가 있다. Task 2는 기존 파일의 기존 줄을 바꾸는 것이라 바꿀 앞뒤를 그대로 옮겨 적었다.

**3. 타입 일관성**: `SearchPlan`의 다섯 필드(`query`·`categoryCode`·`pathAny`·`pathNot`·`localOnly`)를 Task 1이 정의하고 Task 2가 `plan.query`·`plan.categoryCode`·`plan.pathAny` 세 개를 읽는다. `keepByCategoryName(categoryName, plan)`의 인자 순서가 Task 1 테스트·구현·Task 2 호출에서 같다. `KakaoKeywordDoc.category_name`은 6.5가 이미 파싱해 뒀다(`places.ts:142`).

**4. 범위 점검**: 순위·강등은 안 한다(거르기만). 후보에 `categoryName`을 싣지 않는다 — 읽는 곳이 없으면 죽은 필드다. 페이지를 더 받지 않는다. `run-llm.mjs`의 채점 공유 문제와 `dwellFor`의 질의 문자열 의존은 §6.7 후속으로 남아 있고 이 계획에 없다.
