# 정해진 가게를 지키는 구현 계획

> **에이전트에게:** 한 번에 한 과제씩. 과제마다 테스트를 먼저 쓰고, 초록이 된 뒤 커밋한다.
> UI 를 건드리는 과제(5)는 시뮬레이터로 화면을 보고 판정한다 — `AGENTS.md` 의 시뮬레이터 절.

**목표:** 경유지를 하나 추가해도 이미 정해진 가게가 다른 곳으로 바뀌지 않게 한다.

**스펙:** 이 문서가 스펙을 겸한다. 아래 "무엇이 문제인가"가 근거다.

---

## 무엇이 문제인가 (2026-09-19 실측)

여의도 → 용왕산, 대중교통, `마트 들러서 장 보고 약국 갔다 집에 갈게` 로 계획을 확정한 뒤
`편집 → AI와 대화로 수정하기 → "빵집도 들러줘"` 를 했다.

| | 확정 직후 | 빵집 추가 후 |
|---|---|---|
| 약국 | 봄빛온누리약국 17:53 | **은하약국** 18:04 |
| 마트 | 한청할인마트 18:15 | 한청할인마트 18:26 |
| 빵집 | — | 아티제 여의도공원점 17:56 |

**사용자가 아무것도 안 했는데 약국이 바뀌었다.**

원인은 `overrides` 보다 한 단계 앞이다. 대화 화면이 보는 것은 `state.stops`(확정된 가게)가
아니라 `state.chips`(처음 추출된 키워드)다. 확정 결과가 칩으로 되먹여지지 않아서,
칩은 계속 `마트`·`약국` 이고 추가 요청 한 번에 **세 슬롯 전부 새로 검색**된다.

```
chip.id ──▶ slot.id ──▶ visit.slotId ──▶ StopState.baseId      가는 길은 있다
                                                                돌아오는 길이 없다
```

**이건 최적화가 고장난 게 아니다.** 빵집이 출발지 쪽에 들어가면서 회랑이 달라졌고,
약국도 그 회랑에서 다시 뽑힌 것이다 — 플래너로서는 맞게 일했다. 우리가 포기하는 것은
"더 나은 가게로 갈아탈 기회"이고, 얻는 것은 "내가 정한 건 그대로 있다"는 신뢰다.
사용자가 후자를 골랐다(2026-09-19).

## 설계 한 줄

**칩이 "이 자리는 이 가게로 정해졌다"를 기억한다.** 값과 "누가 정했나"를 따로 드는
기존 패턴(`narrowed`, `loadAsked`)을 그대로 쓴다 — 새 구조를 만들지 않는다.

고정된 슬롯은 검색을 **건너뛴다**. `Slot.flexible: false`(= `candidates[0]` 한 곳으로 고정)가
이미 있으므로 후보 배열에 그 가게 하나만 넣으면 플래너는 손댈 곳이 없다.

## 전역 제약

- **LLM 은 '무엇을'만 뽑는다.** 고정은 코드가 하는 일이고 프롬프트를 건드리지 않는다.
- **고정은 반드시 풀 수 있어야 한다.** 못 푸는 고정은 "약국 다른 데로 바꿔줘"를
  영영 안 먹게 만드는 새 버그다. 과제 4 없이 과제 1~3 만 올리지 않는다.
- `server/` 는 손대지 않는다. 전부 앱 안의 일이다.
- 테스트는 `src/**/*.test.ts` 규칙을 따른다(`.ts` 확장자로 import).

---

## 파일

| 파일 | 역할 |
|---|---|
| `src/state/plan.tsx` | `IntentChip` 에 `pinned` 추가. `APPLY_LIVE`·`REPLACE_LOCAL`·`NARROW_STOP` 에서 갱신·해제 |
| `src/state/planRequest.ts` | `pinned` 를 슬롯 입력으로 내린다 |
| `src/state/planFlow.ts` | `PlanRequest['stops']` 타입에 `pinned` |
| `src/state/runPlan.ts` | `pinned` 면 검색을 건너뛰고 후보 하나짜리 슬롯을 만든다 |
| `src/state/chips.ts` | 칩 라벨이 고정된 가게 이름을 말한다 |
| `src/screens/PlanScreen.tsx` | 고정 칩의 표식·해제 |

---

## 과제 1: 칩이 정해진 가게를 기억한다

**파일**
- 수정: `src/state/plan.tsx` (`IntentChip`, `case 'APPLY_LIVE'`)
- 테스트: `src/state/plan.test.ts`

**인터페이스**
```ts
/** 이 자리는 이 가게로 정해졌다. 값이 아니라 **누가 정했나**의 표식이다 —
 *  `narrowed`·`loadAsked` 와 같은 이유로 따로 든다.
 *  hours·signals 는 담지 않는다. 시간이 지나면 낡고, 재계산 때 /enrich 가 다시 붙인다. */
pinned?: { name: string; coord: LatLng };
```

- [ ] **1. 실패하는 테스트를 쓴다**
```ts
test('확정하면 칩이 그때 정해진 가게를 기억한다 — 다음 계산이 다시 뽑지 않게', () => {
  const chips = [stopChip('c1', ['마트']), stopChip('c2', ['약국'])];
  const next = planReducer(
    { ...base, chips },
    { type: 'APPLY_LIVE', payload: applyPayload([
        { baseId: 'c1', name: '한청할인마트', coord: { latitude: 37.53, longitude: 126.87 } },
        { baseId: 'c2', name: '봄빛온누리약국', coord: { latitude: 37.52, longitude: 126.88 } },
      ]) },
  );
  assert.equal(stop(next, 'c1').pinned?.name, '한청할인마트');
  assert.equal(stop(next, 'c2').pinned?.name, '봄빛온누리약국');
});

test('칩에 없는 baseId 는 무시한다 — 계획이 칩보다 많을 수 있다', () => {
  const next = planReducer(
    { ...base, chips: [stopChip('c1', ['마트'])] },
    { type: 'APPLY_LIVE', payload: applyPayload([
        { baseId: 'c1', name: '한청할인마트', coord: { latitude: 37.53, longitude: 126.87 } },
        { baseId: 'zzz', name: '없는칩', coord: { latitude: 37.5, longitude: 126.9 } },
      ]) },
  );
  assert.equal(next.chips.filter(c => c.kind === 'stop').length, 1);
});
```

- [ ] **2. 돌려서 실패를 본다** — `tsx --test src/state/plan.test.ts`
- [ ] **3. `APPLY_LIVE` 에 되먹임을 넣는다**
```ts
const pinBy = new Map(action.payload.stops.map(s => [s.baseId, { name: s.name, coord: s.coord }]));
const chips = state.chips.map(c =>
  c.kind === 'stop' && pinBy.has(c.id) ? { ...c, pinned: pinBy.get(c.id) } : c);
```
- [ ] **4. 초록 확인 후 커밋**

## 과제 2: 고정을 슬롯까지 내린다

**파일**
- 수정: `src/state/planRequest.ts`, `src/state/planFlow.ts`
- 테스트: `src/state/planRequest.test.ts`

**인터페이스**
- 소비: 과제 1 의 `IntentChip.pinned`
- 생산: `PlanRequest['stops'][number].pinned?: { name: string; coord: LatLng }`

- [ ] **1. 실패하는 테스트**
```ts
test('고정된 칩은 가게를 그대로 슬롯에 싣는다', () => {
  const [s] = requestStopsFromChips([
    { ...stopChip('c1', ['마트']), pinned: { name: '한청할인마트', coord: { latitude: 37.53, longitude: 126.87 } } },
  ]);
  assert.equal(s.pinned?.name, '한청할인마트');
});
test('고정이 없으면 필드도 없다 — 없는 것과 빈 것을 섞지 않는다', () => {
  assert.equal(requestStopsFromChips([stopChip('c1', ['마트'])])[0].pinned, undefined);
});
```
- [ ] **2. 실패 확인 → 3. 필드 전달 → 4. 초록 → 커밋**

## 과제 3: 고정된 슬롯은 검색하지 않는다

**파일**
- 수정: `src/state/runPlan.ts`
- 테스트: `src/state/runPlan.test.ts`

`st.queries.length === 0` 조기 반환 **바로 위**에 같은 모양으로 넣는다.

- [ ] **1. 실패하는 테스트**
```ts
test('고정된 슬롯은 장소 검색을 한 번도 부르지 않는다', async () => {
  let calls = 0;
  const search = async (...a) => { calls++; return { places: [] }; };
  await runPlan({ ...req, stops: [{ ...stopReq('c1', ['마트']), pinned: { name: '한청할인마트', coord: C } }] },
    { ...deps, search });
  assert.equal(calls, 0, '고정된 자리를 다시 찾으면 고정한 의미가 없다');
});

test('고정된 슬롯의 후보는 그 가게 하나뿐이고 flexible 이 아니다', async () => {
  const slots = await capturedSlots(/* … */);
  assert.deepEqual(slots[0].candidates.map(c => c.name), ['한청할인마트']);
  assert.equal(slots[0].flexible, false, 'flexible 이면 플래너가 다른 후보로 갈아탄다');
});

test('고정되지 않은 형제 슬롯은 그대로 검색한다 — 추가한 곳은 찾아야 한다', async () => { /* … */ });
```
- [ ] **2. 실패 확인**
- [ ] **3. 조기 반환을 넣는다**
```ts
if (st.pinned) {
  return {
    id: st.id, query: st.queries[0] ?? '', stopKind: st.stopKind, why: st.why,
    candidates: [{ id: `pin-${st.id}`, name: st.pinned.name, coord: st.pinned.coord }],
    dwellMin: dwellFor(st.queries[0] ?? ''),
    count: 1,
    flexible: false,          // candidates[0] 한 곳으로 고정 — Slot 주석 참고
    openNow: st.openNow,
    near, nearRelaxed: false, nearSource, nearBefore: 1, nearAfter: 1,
    nearRadiusM: null, nearRelaxedRaw: false,
    loadBefore: st.loadBefore, loadAfter: st.loadAfter, needWhen: st.needWhen,
    searchStatus: 'ok', searchRadiusM: 0, searchCalls: 0,
  } satisfies Slot;
}
```
- [ ] **4. 초록 → 커밋**

**주의:** 트렌드 스왑(`scoreTrend`)과 매장 추천은 `stopKind === 'category'` 이면서 후보가
여럿일 때만 돈다. 후보가 하나면 자연히 건너뛴다 — 별도 분기를 만들지 않는다.

## 과제 4: 고정을 푸는 길 — **과제 3과 같이 올린다**

**파일**
- 수정: `src/state/plan.tsx` (`REPLACE_LOCAL`, `NARROW_STOP`)
- 테스트: `src/state/plan.test.ts`

| 경로 | 무엇이 일어나야 하나 | 지금 |
|---|---|---|
| 칩 `✕`(`REMOVE_CHIP`) | 칩이 사라지므로 고정도 사라진다 | 자동 |
| "약국 다른 데로" (`APPLY_INTENT` remove+add) | 새 칩에는 `pinned` 가 없다 | 자동 |
| 매장 교체(`REPLACE_LOCAL`) | **새 가게로 고정을 갱신** | **넣어야 함** |
| 되묻기에서 다른 브랜드(`NARROW_STOP`) | 검색어가 바뀌었으니 **고정을 푼다** | **넣어야 함** |
| 물성 답(`SET_CHIP_LOAD`) | 순서만 바뀌고 가게는 그대로 | 유지 |
| 이동수단 변경(`SET_MODE`) | **유지한다** — 사용자가 고른 것을 모드 때문에 버리면 놀란다. 바꾸고 싶으면 칩에서 푼다 | 유지 |

- [ ] **1. 실패하는 테스트**
```ts
test('매장을 교체하면 고정이 새 가게로 옮겨간다', () => { /* REPLACE_LOCAL → pinned.name 갱신 */ });
test('되묻기로 브랜드를 바꾸면 고정이 풀린다 — 검색어가 달라졌다', () => { /* NARROW_STOP → pinned undefined */ });
test('이동수단을 바꿔도 고정은 남는다 — 사용자가 고른 것이다', () => { /* SET_MODE → pinned 유지 */ });
```
- [ ] **2~4. 실패 확인 → 구현 → 초록 → 커밋**

## 과제 5: 화면이 고정을 말한다 (UI — 시뮬레이터 확인)

**파일**
- 수정: `src/state/chips.ts`(라벨), `src/screens/PlanScreen.tsx`
- 테스트: `src/state/chips.test.ts`

**이게 혼란의 근원이었다.** 확정된 계획으로 돌아온 대화 화면이 `마트 ✕` 라고 말하면
사용자는 그것을 "키워드"로 읽는다. 실제로는 `한청할인마트` 로 정해져 있다.

- [ ] **1. 실패하는 테스트**
```ts
test('고정된 칩은 가게 이름을 말한다 — 키워드로 보이면 정해진 줄 모른다', () => {
  assert.equal(chipLabel({ ...stopChip('c1', ['마트']), pinned: { name: '한청할인마트', coord: C } }), '한청할인마트');
});
test('고정이 없으면 검색어를 그대로 말한다', () => {
  assert.equal(chipLabel(stopChip('c1', ['마트'])), '마트');
});
```
- [ ] **2. 실패 확인 → 3. 구현 → 4. 초록**
- [ ] **5. 시뮬레이터로 확인한다** — 세션 전용 기기를 띄우고(`AGENTS.md`),
      재현 절차를 그대로 밟아 **약국이 봄빛온누리약국 그대로인지** 본다.
      트랙 로그의 `plan.slots` 에서 고정된 슬롯의 `calls=0` 을 함께 확인한다.
- [ ] **6. 커밋**

---

## 이 계획이 하지 않는 것

- **이미 들른 곳 제외** — 이동 중 추가는 별도 단계다. `APPLY_LIVE` 가 `passedCount: 0` 으로
  되돌리는 것까지 손봐야 해서 범위가 다르다(`plan.tsx:535` 주석).
- **편집 화면의 이동수단** — 과제 1~5 가 끝나야 안전하다. 지금 모드를 바꾸면 전체가
  다시 계산돼 가게가 전부 바뀐다.
- **순서 보존** — 사용자가 편집에서 바꾼 순서는 이 계획의 범위 밖이다.
  `usePlanRequest` 가 `order: 'auto'` 를 하드코딩하고 있다(별도 과제).
