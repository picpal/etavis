# 업종 질의에 카테고리 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "국민은행"을 찾으면 은행이 나오게 한다 — 은행 이름이 붙은 주차장·구내식당·충전소가 아니라.

**Architecture:** 카카오 장소 검색은 **이름만** 매칭한다. 그래서 "국민은행앞1 공영노상주차장"이 은행과 같은 자격으로 후보에 들어오고, 앵커에서 67m라는 이유로 1순위가 됐다. 카카오 응답에는 이미 `category_group_code`가 들어 있고(은행 BK9, 주차장 PK6, 구내식당 FD6), 키워드 API는 그 코드를 **요청 파라미터로도** 받는다. 업종 질의를 코드로 옮겨 서버에서 거른다. 브랜드 질의(올리브영·다이소)는 업종 코드가 없으므로 건드리지 않는다.

**Tech Stack:** TypeScript, React Native(Expo SDK 57), node:test + tsx (`npm test`).

**Spec:** `docs/대중교통-경로-단계계획.md` (6단계 시뮬레이터 검증에서 나온 결함), 아래 실측 근거.

## 실측 근거 (2026-09-15, 운영 카카오 키)

여의도 좌표에서 `query=국민은행&radius=500&sort=distance` 결과 8건:

| 장소명 | 코드 | 카테고리 |
|---|---|---|
| KB국민은행 서여의도 365자동화점 ATM | BK9 | 금융,보험 > 금융서비스 > 은행 > ATM |
| KB국민은행 서여의도영업부 | BK9 | 금융,보험 > 금융서비스 > 은행 > KB국민은행 |
| 현대그린푸드국민은행 여의도전산센터 | FD6 | 음식점 > 구내식당 |
| **국민은행앞1 공영노상주차장** | PK6 | 교통,수송 > 교통시설 > 주차장 > 공영주차장 |
| KB국민은행 여의도전산센터 | BK9 | 금융,보험 > 금융서비스 > 은행 > KB국민은행 |
| **국민은행앞 공영주차장** | PK6 | 교통,수송 > 교통시설 > 주차장 > 공영주차장 |
| KB국민은행 여의도순복음교회 ATM | BK9 | 금융,보험 > 금융서비스 > 은행 > ATM |
| 서울영등포 국민은행 IT센터 전기차충전소 | (없음) | 교통,수송 > 자동차 > 전기차 충전소 |

같은 질의에 `category_group_code=BK9`를 더하면 **4건, 전부 은행**이다. 굵게 표시한 둘과 구내식당·충전소가 사라진다.

같은 좌표에서 `query=올리브영`은 **업종 코드가 없다**(`category_name`은 "가정,생활 > 드럭스토어 > 올리브영"). 브랜드에 코드를 넣으면 0건이 된다 — 그래서 아는 업종에만 넣는다.

## Global Constraints

- 스테이징은 파일명을 직접 적는다. `git add -A` / `git add .` **금지**.
- 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- 테스트 글로브는 **평면만** 돈다 — `src/**/*.test.ts`. 테스트 파일은 소스 옆에 둔다.
- 완료 게이트: `npm test` 전부 통과 + `npx tsc --noEmit` exit 0.
- 화면을 바꾸지 않는다. `src/screens/**` 무변경.
- **API 키 값을 코드·문서·커밋에 절대 넣지 않는다.** 키는 루트 `.env`(gitignore)와 `app.json` 주입에만 있다.
- `src/lib/places.ts`는 `expo-constants`를 물고 있어 **node 테스트가 읽지 못한다**. 그래서 판정 로직은 순수 파일로 분리하고, 배선은 시뮬레이터로 검증한다.

---

### Task 1: 질의 → 카카오 업종 코드

**Files:**
- Create: `src/lib/placeCategory.ts`
- Create: `src/lib/placeCategory.test.ts`

**Interfaces:**
- Consumes: 없음(순수 함수)
- Produces: `export function kakaoCategoryFor(query: string): string | null;` — Task 2의 `kakaoProvider`가 쓴다.

**왜 null 이 기본인가:** 모르는 업종에 코드를 찍으면 결과가 0건이 된다(올리브영에 코드를 넣으면 그렇다). 확신하는 업종에만 코드를 주고, 나머지는 지금과 똑같이 이름 매칭에 맡긴다. 틀렸을 때의 손해가 한쪽으로만 나게 둔다.

- [ ] **Step 1: 실패 테스트를 쓴다**

`src/lib/placeCategory.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kakaoCategoryFor } from './placeCategory.ts';

test('은행 — 브랜드까지 BK9', () => {
  for (const q of ['은행', '국민은행', 'KB국민은행', '신한은행', '우리은행', '하나은행', '농협은행', '기업은행', '새마을금고', 'ATM', 'atm']) {
    assert.equal(kakaoCategoryFor(q), 'BK9', q);
  }
});

test('편의점 — CS2', () => {
  for (const q of ['편의점', 'CU', 'GS25', '세븐일레븐', '이마트24']) {
    assert.equal(kakaoCategoryFor(q), 'CS2', q);
  }
});

test('이마트24 는 편의점, 이마트는 대형마트 — 긴 쪽이 먼저 걸린다', () => {
  assert.equal(kakaoCategoryFor('이마트24'), 'CS2');
  assert.equal(kakaoCategoryFor('이마트'), 'MT1');
});

test('카페·약국·주유소·마트·병원·주차장', () => {
  assert.equal(kakaoCategoryFor('카페'), 'CE7');
  assert.equal(kakaoCategoryFor('스타벅스'), 'CE7');
  assert.equal(kakaoCategoryFor('약국'), 'PM9');
  assert.equal(kakaoCategoryFor('주유소'), 'OL7');
  assert.equal(kakaoCategoryFor('홈플러스'), 'MT1');
  assert.equal(kakaoCategoryFor('치과'), 'HP8');
  assert.equal(kakaoCategoryFor('주차장'), 'PK6');
});

test('브랜드·미지 업종은 null — 코드를 찍으면 0건이 된다', () => {
  // 올리브영은 카카오에 업종 코드가 없다(실측: category_group_code 빈 값)
  for (const q of ['올리브영', '다이소', '무신사 스탠다드', '현대카드빌딩 2관', '', '   ']) {
    assert.equal(kakaoCategoryFor(q), null, q);
  }
});

test('공백·대소문자에 흔들리지 않는다', () => {
  assert.equal(kakaoCategoryFor(' 국민 은행 '), 'BK9');
  assert.equal(kakaoCategoryFor('Gs25'), 'CS2');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx tsx --test src/lib/placeCategory.test.ts`
Expected: FAIL — `Cannot find module './placeCategory.ts'`

- [ ] **Step 3: `placeCategory.ts`를 쓴다**

```ts
/**
 * 질의 → 카카오 업종 코드. 카카오 장소 검색은 **이름만** 매칭해서,
 * "국민은행"으로 찾으면 "국민은행앞1 공영노상주차장"(PK6)과
 * "현대그린푸드국민은행 여의도전산센터"(FD6)가 은행과 같은 자격으로 들어온다.
 * 2026-09-15 시뮬레이터에서 그 주차장이 실제로 1순위 추천이 됐다.
 *
 * 아는 업종에만 코드를 준다. 모르면 null — 코드를 잘못 찍으면 결과가 0건이 된다.
 * 올리브영·다이소 같은 브랜드는 카카오에 업종 코드 자체가 없다(실측 확인).
 *
 * 코드 표: https://developers.kakao.com/docs/latest/ko/local/dev-guide
 */

/** 앞에서부터 먼저 걸리는 것이 이긴다 — 이마트24(편의점)가 이마트(대형마트)보다 앞이어야 한다 */
const TABLE: [RegExp, string][] = [
  [/편의점|씨유|\bcu\b|gs25|세븐일레븐|이마트24|미니스톱|이마트24시/i, 'CS2'],
  [/은행|atm|새마을금고|신협|농협|수협|우체국예금/i, 'BK9'],
  [/카페|커피|스타벅스|스벅|투썸|메가커피|컴포즈|빽다방|이디야|할리스|커피빈/i, 'CE7'],
  [/약국|팜|pharmacy/i, 'PM9'],
  [/주유소|충전소|gs칼텍스|sk에너지|현대오일뱅크|에쓰오일|s-oil/i, 'OL7'],
  [/대형마트|이마트|홈플러스|롯데마트|코스트코|하나로마트/i, 'MT1'],
  [/병원|의원|치과|한의원|정형외과|내과|소아과|피부과|안과|이비인후과/i, 'HP8'],
  [/주차장|주차/i, 'PK6'],
  [/지하철역|전철역/i, 'SW8'],
  [/학교|초등학교|중학교|고등학교|대학교/i, 'SC4'],
  [/어린이집|유치원/i, 'PS3'],
  [/숙박|호텔|모텔|펜션|게스트하우스|리조트/i, 'AD5'],
];

/**
 * 아는 업종이면 카카오 `category_group_code`, 모르면 null.
 * null 이면 지금까지처럼 이름 매칭에만 맡긴다 — 거르지 않는 쪽이 0건보다 낫다.
 */
export function kakaoCategoryFor(query: string): string | null {
  const q = query.replace(/\s+/g, '');
  if (!q) return null;
  for (const [re, code] of TABLE) if (re.test(q)) return code;
  return null;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx tsx --test src/lib/placeCategory.test.ts`
Expected: PASS 6건. 하나라도 실패하면 **표가 아니라 기대값을 먼저 의심하지 말고**, 카카오 코드 표를 확인하고 사실에 맞는 쪽으로 고친 뒤 무엇을 왜 고쳤는지 보고서에 적는다.

- [ ] **Step 5: 전체 게이트 + 커밋**

```bash
npm test && npx tsc --noEmit
git add src/lib/placeCategory.ts src/lib/placeCategory.test.ts
git commit -m "$(cat <<'EOF'
feat(search): 업종 질의를 카카오 카테고리 코드로 옮긴다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 카카오 검색에 코드를 실어 보낸다

**Files:**
- Modify: `src/lib/places.ts` (`KakaoKeywordDoc` 타입, `kakaoProvider.search`)

**Interfaces:**
- Consumes: Task 1의 `kakaoCategoryFor(query): string | null`
- Produces: 동작 변화만. 공개 시그니처는 그대로 — `PlaceSearchProvider.search(query, near, radiusM)`.

**주소 검색을 왜 건너뛰나:** `kakaoProvider`는 키워드 검색과 주소 검색을 함께 부른다. 주소 결과는 POI가 없는 순수 주소(주택가·펜션)를 메우려고 있는 것인데, "국민은행"처럼 **업종을 물은 질의**에 건물·주소를 섞으면 방금 카테고리로 거른 것을 뒷문으로 다시 들인다. 업종 코드가 잡힌 질의에서는 주소 검색을 아예 부르지 않는다 — 호출도 하나 준다.

- [ ] **Step 1: `KakaoKeywordDoc`에 카테고리 필드를 적는다**

`src/lib/places.ts`의 `type KakaoKeywordDoc`에 두 줄을 더한다. 지금은 응답에 있는데도 타입이 버리고 있어, 읽는 사람이 카테고리가 없는 줄 안다.

```ts
type KakaoKeywordDoc = {
  id: string;
  place_name: string;
  road_address_name: string;
  address_name: string;
  /** 업종 코드(BK9 은행, PK6 주차장 …). 브랜드 매장은 빈 값일 수 있다 */
  category_group_code?: string;
  /** "금융,보험 > 금융서비스 > 은행 > ATM" 같은 전체 경로 */
  category_name?: string;
  x: string; // 경도
  y: string; // 위도
};
```

- [ ] **Step 2: import 를 더한다**

`src/lib/places.ts` 상단의 import 목록에:

```ts
import { kakaoCategoryFor } from './placeCategory';
```

- [ ] **Step 3: 검색에 코드를 싣고, 업종 질의면 주소 검색을 건너뛴다**

`kakaoProvider.search` 안. `const keywordParams = new URLSearchParams({ query, size: '15' });` 바로 아래에 넣는다:

```ts
    /*
      카카오는 이름만 매칭한다 — "국민은행"에 "국민은행앞1 공영노상주차장"(PK6)과
      "현대그린푸드국민은행 여의도전산센터"(FD6)가 같이 온다. 2026-09-15 시뮬레이터에서
      그 주차장이 1순위 추천이 됐다. 아는 업종이면 코드로 서버에서 거른다.
      모르는 업종(올리브영 같은 브랜드)은 코드 자체가 없어서 찍으면 0건이 된다 — 그래서 null.
    */
    const categoryCode = kakaoCategoryFor(query);
    if (categoryCode) keywordParams.set('category_group_code', categoryCode);
```

그리고 두 검색을 부르는 부분을 이렇게 바꾼다:

```ts
    const [keyword, address] = await Promise.all([
      kakaoFetch('keyword', keywordParams),
      // 업종을 물었으면 주소 결과는 부르지 않는다 — 카테고리로 거른 것을 뒷문으로 다시 들인다.
      // 주소 검색은 POI 가 없는 순수 주소를 메우는 보조라, 업종 질의에는 쓸모가 없다.
      categoryCode
        ? Promise.resolve({ documents: [] })
        : kakaoFetch('address', new URLSearchParams({ query, size: '5' })).catch(() => ({ documents: [] })),
    ]);
```

- [ ] **Step 4: 타입과 테스트**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 통과, tsc 0줄. (`places.ts`는 `expo-constants` 때문에 node 테스트가 읽지 못한다 — 여기서 확인하는 건 타입과 기존 테스트 무회귀다. 동작은 Task 3에서 화면으로 본다.)

- [ ] **Step 5: 화면 무변경 확인**

Run: `git diff --stat HEAD -- src/screens`
Expected: 빈 출력

- [ ] **Step 6: 커밋**

```bash
git add src/lib/places.ts
git commit -m "$(cat <<'EOF'
fix(search): 업종 질의는 카테고리로 거른다 — 은행 이름 붙은 주차장 배제

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 시뮬레이터 검증 (컨트롤러가 직접 한다)

**준비**

```bash
xcodebuild -workspace ios/Etavia.xcworkspace -scheme Etavia -configuration Debug \
  -destination "id=32E7E297-E515-478B-8EB4-62E8AF4B069E" -derivedDataPath ./build-sim
xcrun simctl install 32E7E297-E515-478B-8EB4-62E8AF4B069E ./build-sim/Build/Products/Debug-iphonesimulator/Etavia.app
```

번들 id 는 `com.etavia.app`. Metro 가 붙었는지 반드시 확인한다 — Release 번들이 박힌 앱을 보고 판정한 사고가 있었다.

**검증 항목**

- [ ] **1. 자동차에서 주차장이 사라진다**: 출발 회사(신정동) → 현대카드빌딩 2관, 자동차, 경유지 `국민은행`·`올리브영`. 트랙 로그 `plan.slots`의 `picks`에 **"국민은행앞1 공영노상주차장"·"국민은행앞 공영주차장"·"현대그린푸드국민은행 여의도전산센터"·"전기차충전소"가 없어야 한다.** 남은 국민은행 후보가 전부 `KB국민은행`·`ATM`이어야 한다.
- [ ] **2. 올리브영은 줄지 않는다**: 같은 로그에서 올리브영 후보 수가 이 변경 전(자동차 기준 30곳)과 같은 수준이어야 한다. 브랜드 질의에 코드가 잘못 붙으면 여기서 0곳이 된다.
- [ ] **3. 추천이 실제 은행**: 추천 화면 1번·2번 경유지가 은행과 올리브영이어야 한다.
- [ ] **4. 대중교통 회귀**: 같은 OD 를 대중교통으로 돌려 후보·추천이 정상인지 본다(앵커는 이 브랜치에 없으므로 회랑 검색 기준).
- [ ] **5. 검색 호출 수**: `plan.slots`의 `search`에서 `calls`가 변경 전과 같아야 한다 — 업종 질의는 주소 검색을 건너뛰지만 그건 `calls`에 안 세는 별개 호출이라, 회랑 샘플 수 × 회차는 그대로여야 한다.

**완료 기준**: 1·2·3 통과. 결과를 `docs/대중교통-경로-단계계획.md`에 실측으로 적는다.

---

## Self-Review

**1. 스펙 커버리지**

| 요구 | 태스크 |
|---|---|
| 업종 질의에서 은행 이름 붙은 주차장·식당·충전소를 뺀다 | Task 1(판정) + Task 2(배선) |
| 브랜드 질의(올리브영)는 건드리지 않는다 | Task 1이 null 반환, Task 3 항목 2가 확인 |
| 화면 무변경 | Global Constraints + Task 2 Step 5 |
| 키를 코드·문서에 넣지 않는다 | Global Constraints. 이 문서의 실측 표는 응답 내용만 담았다 |

**2. 플레이스홀더 점검**: 모든 코드 단계에 실제 코드가 있다. Task 3은 컨트롤러가 직접 하는 검증이라 명령과 판정 기준을 적었다.

**3. 타입 일관성**: `kakaoCategoryFor(query: string): string | null` 한 개만 태스크를 넘나든다. Task 1이 export 하고 Task 2가 import 한다. 반환을 `string | null`로 둔 건 카카오 코드 표가 늘어날 때 리터럴 유니온을 매번 고치지 않기 위해서다 — 이 값은 곧바로 URL 파라미터가 되므로 타입을 좁혀서 얻는 게 없다.
