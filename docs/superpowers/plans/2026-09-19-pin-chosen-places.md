# 정해진 가게를 지키는 구현 계획 — v2

> **에이전트에게:** 한 번에 한 과제씩. 테스트를 먼저 쓰고, 초록이 된 뒤 커밋한다.
> UI 를 건드리는 과제(6)는 시뮬레이터로 화면을 보고 판정한다 — `AGENTS.md` 의 시뮬레이터 절.

**목표:** 경유지를 하나 추가해도 이미 정해진 가게가 다른 곳으로 바뀌지 않게 한다.

**설계 한 줄:** **고정은 검색을 막지 않는다. 고르기만 막는다.**
그리고 **고정을 어디에 적을지는 이미 정해져 있다 — `state.stops` 다.**

---

## 무엇이 문제인가 (2026-09-19 실측)

여의도 → 용왕산, 대중교통. `마트 들러서 장 보고 약국 갔다 집에 갈게` 로 확정한 뒤
`편집 → AI와 대화로 수정하기 → "빵집도 들러줘"`.

| | 확정 직후 | 빵집 추가 후 |
|---|---|---|
| 약국 | 봄빛온누리약국 17:53 | **은하약국** 18:04 |
| 마트 | 한청할인마트 18:15 | 한청할인마트 18:26 |
| 빵집 | — | 아티제 여의도공원점 17:56 |

**사용자가 아무것도 안 했는데 약국이 바뀌었다.**

`usePlanRequest` 가 요청을 **오직 `state.chips` + 현재 위치**로 조립한다(`usePlanRequest.ts:23`).
확정된 가게는 `state.stops` 에 있는데 요청은 그걸 보지 않는다. 그래서 세 슬롯이 전부
새로 검색된다.

**회랑이 바뀐 게 아니다.** 직행 회랑은 출발↔목적지로만 정해진다(`runPlan.ts:100`).
약국이 바뀐 건 형제 슬롯의 `near` 배분과 조합 탐색이 달라졌기 때문이다.

---

## v1 이 틀린 지점 — 지우지 않고 남긴다

v1 은 `IntentChip.pinned` 라는 **새 필드**를 만들고, 고정된 슬롯은 **검색을 건너뛰게** 했다.
codex 리뷰가 P1 12건을 냈고 전부 이 두 결정에서 나왔다.

| v1 이 한 것 | 무엇이 깨지나 | v2 는 |
|---|---|---|
| 칩에 `pinned` 새 필드 | 리듀서 10곳이 동기화해야 하는 **두 번째 사본**. 동기화가 깨지는 곳이 곧 "고정이 안 풀리는 경로" | `state.stops` 를 그대로 쓴다. 사본이 없다 |
| 검색을 건너뜀 | 후보가 1개 → **매장 교체 시트가 빈다**(`planFlowBridge.ts:165`). `KC=8` 이 무의미 | 검색은 그대로 돈다 |
| 검색을 건너뜀 | 후보 1개는 `/enrich` 를 안 탄다(`ENRICH_MIN_CANDIDATES=4`) → `hours` 없음 → **근거 없이 "영업 중"**(`score.ts:135`) | 보강도 그대로 돈다 |
| 검색을 건너뜀 | `applyNear` 를 건너뛰고 `ok`·완화없음을 박음 → **상태가 거짓말**. 회랑 밖이어도 `far` 가 안 뜸 | 검색·near 를 그대로 태우므로 메타데이터가 사실이다 |
| 합성 후보 id `pin-<slot>` | `enumerate.ts:37` 이 `used.has(cand.id)` 로만 중복을 막는다 → **한 가게를 두 번 들르는 계획** | 진짜 장소 id 를 들고 다닌다(과제 1) |
| 해제를 `remove`+`add` 에 맡김 | `remove` 는 **질의 겹침**으로 지운다(`plan.tsx:667`). 추출은 `봄빛온누리약국`(가게명)을 주는데 칩은 `약국`(업종)이라 안 걸리고, `add` 는 중복으로 걸러져 **고정이 영영 안 풀린다** | 가게 이름으로도 걸리게 한다(과제 5) |
| `requestKey` 를 안 건드림 | 고정을 바꿔도 같은 키 → `isStale=false` → **재계산이 아예 안 돈다**(`planFlow.ts:74`) | 키에 넣는다(과제 3) |

v1 에서 살린 것: 문제 진단, `Slot.flexible=false`(= `candidates[0]` 한 곳으로 고정,
`enumerate.ts:7`) 를 쓴다는 착상, 해제 과제를 본 과제와 묶는다는 판단.

---

## 왜 `state.stops` 인가

이미 다 들어 있다.

```
StopState = Stop & { baseId, selectedCandidateId?, replaceDeltaMin, congestion? }
            └ name, coord, category …
chip.id ── baseId ── slotId        planFlowBridge.ts:257, plan.tsx:171
```

그리고 **이미 모든 경로가 이걸 갱신한다** — `REPLACE_LOCAL` 이 바꾸고, `REMOVE_LOCAL` 이
지우고, `REORDER_LOCAL` 이 옮긴다. 새 필드를 만들면 이 셋을 다시 구현해야 한다.

**막고 있는 것은 한 곳뿐이다.** `APPLY_INTENT` 가 `stopsForChips(state.dataset, keep)` 로
스톱을 데이터셋에서 **다시 매칭**하고(`plan.tsx:690`), `asStopState` 가
`selectedCandidateId` 와 `replaceDeltaMin` 을 **0 으로 지운다**(`plan.tsx:169`).
거기만 고치면 나머지는 이미 있다.

## 전역 제약

- **LLM 은 '무엇을'만 뽑는다.** 고정은 코드의 일이고 프롬프트를 건드리지 않는다.
- **상태 메타데이터를 지어내지 않는다.** 검색을 안 했으면 `ok` 라고 적지 않는다.
- **고정은 반드시 풀 수 있어야 한다.** 과제 5 없이 3·4 만 올리지 않는다.
- **후보 id 는 합성하지 않는다.** `enumerate` 가 id 로 중복을 막으므로, 같은 가게는
  어디서 와도 같은 id 여야 한다.
- `server/` 는 손대지 않는다.

---

## 파일

| 파일 | 역할 |
|---|---|
| `src/state/planFlowBridge.ts` | 스톱이 진짜 장소 id 를 든다 — **이미 그렇다**. 계약만 못 박는다(과제 1) |
| `src/state/plan.tsx` | `APPLY_INTENT` 가 해결된 스톱을 보존. 채팅 제거가 가게 이름으로도 걸린다 |
| `src/state/usePlanRequest.ts` | `state.stops` 에서 고정을 끌어온다 |
| `src/state/planRequest.ts` | 고정을 슬롯 입력으로 |
| `src/state/planFlow.ts` | `PlanRequest` 타입 + `requestKey` |
| `src/state/runPlan.ts` | 고정된 가게를 후보 맨 앞에 놓고 `flexible:false` |
| `src/state/chips.ts` | 칩이 정해진 가게 이름을 말한다 |

---

## 과제 1: 스톱이 자기가 어느 가게인지 기억한다 — **이미 기억하고 있었다**

**계획이 틀렸다(2026-09-19 실측).** 이 과제는 `StopState.placeId` 라는 새 필드를 만들라고
했는데, 전제가 사실이 아니었다. 다리는 진짜 장소 id 를 **이미 싣는다** —
`selectedCandidateId: v.candidate.id`(`planFlowBridge.ts:260`). `id`·`baseId` 만 본 것이
오독이었다.

**그래서 필드를 만들지 않는다.** 만들면 `placeId` 와 `selectedCandidateId` 가 같은 값을
가리키는 **두 번째 사본**이 되고, `applyCandidate`(`plan.tsx:336`)·`REPLACE_LOCAL`·다리
세 곳이 영원히 동기화해야 한다. **그건 v1 이 반려된 바로 그 이유다**(위 표 첫 줄).
`selectedCandidateId` 가 곧 장소 id 다 — 아래 과제 3·4 는 이걸 읽는다.

> 왜 `selectedCandidateId` 라는 이름에 장소 id 가 들어 있나: 목 시절의 `Candidate.id` 와
> 라이브의 `PlaceCandidate.id` 가 같은 값이다. `slotCandidates` 가 후보 목록을
> `cand.id` 그대로 만들기 때문에(`planFlowBridge.ts:165-170`), 교체 시트가 고르는 id 와
> 플래너가 방문한 후보의 id 가 같은 공간에 있다.

**남는 일은 계약을 못 박는 것뿐이다.** 과제 3·4 가 이 값 위에 올라가므로, 다리가
장소 id 대신 자리 id 를 싣게 바뀌면 거기서 걸려야 한다.

**파일**: 테스트만 — `src/state/planFlowBridge.test.ts`. 제품 코드는 안 바뀐다.

- [x] **1.** 계약 테스트: `toLegacyPlan` 이 만든 stop 의 `selectedCandidateId` 가
      `visit.candidate.id` 와 같고, `baseId` 와는 다르다
- [x] **2.** 초록(제품 코드 변경 없이) → 계획의 이 절을 고쳐 적음 → 커밋

**이 테스트는 실패한 적이 없다 — 알고 쓴 것이다.** 회귀 방지용 계약이지 TDD 의 빨강이
아니다. 계획이 틀렸다는 사실 자체를 여기 남긴다.

## 과제 2: `APPLY_INTENT` 가 해결된 스톱을 보존한다

**여기가 본체다.** 이것만으로도 사용자의 매장 교체가 대화 편집에서 안 날아간다.

**파일**: 수정 `src/state/plan.tsx` · 테스트 `src/state/plan.test.ts`

- [x] **1.** 실패 테스트
```ts
test('대화로 경유지를 추가해도 이미 정해진 가게는 그대로다', () => {
  const before = { ...base, chips: [stopChip('c1', ['약국'])], stops: [resolved('c1', '봄빛온누리약국')] };
  const next = planReducer(before, applyIntent({ stops: [add(['빵집'])] }));
  assert.equal(next.stops.find(s => s.baseId === 'c1')?.name, '봄빛온누리약국');
});

test('사용자가 교체한 매장이 대화 편집에서 살아남는다 — asStopState 가 지우던 것', () => {
  const before = { ...base, chips: [stopChip('c1', ['마트'])],
                   stops: [{ ...resolved('c1', '한청할인마트'), selectedCandidateId: 'k-99', replaceDeltaMin: 4 }] };
  const next = planReducer(before, applyIntent({ stops: [add(['빵집'])] }));
  const s = next.stops.find(x => x.baseId === 'c1');
  assert.equal(s?.selectedCandidateId, 'k-99');
  assert.equal(s?.replaceDeltaMin, 4, '교체로 늘어난 시간까지 같이 남아야 한다');
});

test('지운 경유지의 스톱은 안 남는다', () => { /* remove 뒤 stops 에서 사라진다 */ });
test('새로 추가한 칩은 스톱이 없다 — 검색해서 채울 자리다', () => { /* 빵집은 stops 에 없음 */ });
```
- [x] **2.** 실패 확인 — 앞의 셋이 빨강(넷째는 원래 초록. 고침이 과하게 보존하는지를 재는 가드다)
- [x] **3.** 구현 — **계획의 스케치는 쓰지 않았다. 중복 제거를 깨뜨린다.**

> **계획이 틀린 두 번째 지점(2026-09-19).** 아래 스케치대로 칩마다 `stopsForChips` 를
> 부르면 함수 안의 `used` 집합이 매 호출 새로 생긴다. 풀에 은행이 하나뿐인데
> `은행` 칩이 셋이면(`count: 3`) **같은 스톱이 세 번 들어간다** — id 가 겹쳐 LEGS 체인
> 키와 화면 키가 같이 무너진다. 이 계획의 전역 제약("같은 가게는 어디서 와도 같은
> id")이 막으려던 바로 그 결함을 구현 스케치가 도로 만든 것이다.
>
> ```ts
> // 쓰지 않음 — 중복 제거가 호출마다 초기화된다
> const byBase = new Map(state.stops.map(s => [s.baseId, s]));
> const stops = keep.flatMap(c => c.kind !== 'stop' ? []
>   : byBase.has(c.id) ? [byBase.get(c.id)!]
>   : stopsForChips(state.dataset, [c]));
> ```

대신 **보존을 `stopsForChips` 안으로 넣었다.** 중복 제거와 보존이 한 루프에 있어야 한다.

```ts
function stopsForChips(ds: Dataset, chips: IntentChip[], held?: ReadonlyMap<string, StopState>) {
  // …루프 안에서
  const kept = held?.get(chip.id);
  if (kept) { used.add(kept.baseId); out.push(kept); continue; }
  // 없으면 종전대로 풀에서 찾는다
}

// APPLY_INTENT
const held = new Map(state.stops.map(s => [s.baseId, s]));
const stops = stopsForChips(state.dataset, keep, held);
```

- [x] **4.** 초록 → 커밋. 회귀 테스트를 하나 더 달았다 —
      `같은 곳을 두 번 들르는 계획을 만들지 않는다`

**주의:** 같은 보존을 `NARROW_STOP` 에는 넣지 않는다. 거기선 질의가 바뀌었으니
정해진 가게를 버리는 게 맞다 — 과제 5 의 해제 경로 중 하나다.

## 과제 3: 요청이 고정을 싣는다 (+ `requestKey`)

**파일**: 수정 `src/state/usePlanRequest.ts`, `src/state/planRequest.ts`, `src/state/planFlow.ts`
· 테스트 `src/state/planRequest.test.ts`, `src/state/planFlow.test.ts`

**인터페이스**: `PlanRequest['stops'][n].fixed?: { placeId: string; name: string; coord: LatLng }`

> **계획을 고쳐 적음(2026-09-19): `placeId` 는 선택이 아니라 필수다.**
> 계획은 `placeId?` 로 두고 "목에서 온 스톱은 이름·좌표로만 맞춘다"고 했는데, 그러면
> 과제 4 가 **검색 결과에 없는 고정을 후보로 끼워 넣을 때 id 를 지어내야 한다** —
> 이 계획의 전역 제약("후보 id 는 합성하지 않는다")을 정면으로 어긴다. 그래서
> **장소 id 가 없는 스톱은 아예 고정하지 않는다.** 그 대상은 목 데이터셋에서 온
> 스톱뿐이고(`asStopState`), 고정해서도 안 되는 것들이다 — 개발 메뉴의 가짜 가게가
> 진짜 경로에 눌러앉는다. (실제로는 목 스톱의 `baseId` 가 풀 id 라 칩 id 와 애초에
> 안 맞지만, 그 우연에 기대지 않고 `selectedCandidateId` 유무로 명시한다.)

`placeId` 는 **`stop.selectedCandidateId` 를 그대로 옮긴 것**이다(과제 1). 요청은 상태가
아니라 스냅샷이라 여기선 사본이 문제가 안 된다 — 매 렌더 다시 조립되고 아무도 갱신하지
않는다.

- [x] **1.** 실패 테스트
```ts
test('정해진 스톱이 있는 칩은 그 가게를 요청에 싣는다', () => { /* fixed.name === '봄빛온누리약국' */ });
test('스톱이 없는 칩에는 fixed 가 없다', () => { /* undefined */ });

test('requestKey 가 고정을 본다 — 안 그러면 바꿔도 재계산을 건너뛴다', () => {
  const a = req([{ ...stopReq('c1', ['약국']) }]);
  const b = req([{ ...stopReq('c1', ['약국']), fixed: { name: '봄빛온누리약국', coord: C } }]);
  assert.notEqual(requestKey(a), requestKey(b));
});
test('고정된 가게가 다른 곳으로 바뀌면 키도 바뀐다', () => { /* 두 fixed 의 키가 다르다 */ });
```
- [x] **2~4.** 실패 확인 → 구현 → 초록 → 커밋

`requestKey` 의 스톱 조각에 `=${fixed.placeId}` 를 잇는다. 이름은 표시용이라 안 넣고
(그 파일의 기존 원칙), **좌표도 안 넣는다** — 같은 가게인데도 공급자가 좌표를 몇 미터
흔들면 아무도 안 바꾼 요청이 매번 새 요청이 된다. 테스트로 묶었다
(`고정된 가게의 표시 이름만 달라지면 같은 요청이다`).

`usePlanRequest` 의 의존 배열에 `state.stops` 를 더했다. **재계산 루프는 안 생긴다** —
`isStale` 은 배너와 '다시 계산' 버튼만 켜고(`OptionsScreen.tsx:198,215`) 스스로 계산을
걸지 않는다.

## 과제 4: 고정된 가게가 이긴다 — **검색은 그대로 돈다**

**파일**: 수정 `src/state/runPlan.ts` · 테스트 `src/state/runPlan.test.ts`

검색·`applyNear`·`/enrich` 를 **전부 그대로 태운다.** 끝난 뒤에 고정된 가게를
`candidates[0]` 로 올리고 `flexible: false` 로 닫는다. 그래서:

- 매장 교체 시트에 대안이 남는다(`KC=8` 이 살아 있다)
- `/enrich` 가 돌아 `hours` 가 신선하다 — "영업 중"이 근거를 갖는다
- `near`·`searchStatus` 가 **실제로 일어난 일**을 적는다

- [x] **1.** 실패 테스트
```ts
test('고정된 슬롯도 검색을 돈다 — 교체 시트에 보여줄 대안이 있어야 한다', async () => {
  const slots = await capturedSlots(fixedReq);
  assert.ok(slots[0].candidates.length > 1, '후보가 하나뿐이면 교체 시트가 빈다');
});
test('고정된 가게가 candidates[0] 이고 flexible 이 아니다', async () => { /* … */ });
test('검색 결과에 그 가게가 이미 있으면 중복으로 넣지 않고 그것을 올린다 — placeId 로 맞춘다', async () => {
  const slots = await capturedSlots(reqFixedTo('k-77'));
  assert.equal(slots[0].candidates.filter(c => c.id === 'k-77').length, 1);
  assert.equal(slots[0].candidates[0].id, 'k-77');
});
test('검색이 그 가게를 못 찾으면 맨 앞에 끼워 넣는다 — 사용자가 고른 것이 사라지면 안 된다', async () => { /* … */ });
test('near 로 걸러졌어도 고정은 살아남고, 로그가 그 사실을 적는다', async () => {
  assert.equal(slots[0].candidates[0].id, 'k-77');
  assert.equal(slots[0].nearRelaxedRaw, true, '걸러낸 걸 되살렸으면 로그가 말해야 한다');
});
test('고정이 없는 형제 슬롯은 아무것도 달라지지 않는다', async () => { /* … */ });
```
- [x] **2~4.** 실패 확인 → 구현 → 초록 → 커밋

**하지 않는 것:** 검색 호출을 아끼지 않는다. v1 은 그걸 노렸다가 위 네 가지를 깼다.
사용자가 신고한 것은 속도가 아니라 **가게가 바뀐다**는 것이다.

> **계획이 빠뜨린 것 ①: 트렌드 스왑이 고정을 덮어쓴다.**
> `RESULT` 를 보낸 뒤 업종 슬롯마다 트렌드 1위로 `SET_OVERRIDE` 를 날리는 블록이 있다
> (`runPlan.ts` 의 트렌드 스왑). v1 은 "후보가 하나면 스왑이 자동으로 안 돈다"고 봤는데,
> v2 는 검색을 그대로 돌리므로 **고정된 슬롯에도 후보가 30곳 있다** — 막지 않으면
> 사용자가 고른 가게가 조용히 트렌드 1위로 바뀐다. 고정의 의미가 사라지는 자리다.
> `if (!slot.flexible) continue;` 로 가른다 — `flexible:false` 가 곧
> "candidates[0] 한 곳"이라는 계약이다(`enumerate.ts:7`).

> **계획이 빠뜨린 것 ②: 되살렸다는 사실을 적을 칸이 없다.**
> 계획의 테스트는 `nearRelaxedRaw: true` 로 그걸 재라고 했는데, 그 칸은
> `applyNear` 가 완화했을 때만 true 다. 되살렸다고 거기에 적으면 **로그가 거짓말한다**
> — 이 계획의 전역 제약("상태 메타데이터를 지어내지 않는다")에 걸린다.
> `Slot.fixed?: { placeId, source: 'search' | 'filtered' | 'request' }` 를 새로 뒀다.
> `request` 는 검색이 그 가게를 못 줘서 요청의 이름·좌표만으로 세운 것 —
> **영업시간도 신호도 없다**는 뜻이라 화면·로그가 구분할 수 있어야 한다.
> 트랙 로그의 `plan.slots.search` 에 `fix=<id>(source)` 로 찍는다.

## 과제 5: 푸는 길 — **과제 4와 같이 올린다**

| 경로 | 무엇이 일어나야 하나 | 계획이 본 것 | 실제 |
|---|---|---|---|
| 칩 `✕`(`REMOVE_CHIP`) | 지운 칩의 스톱만 사라진다 | 자동 | **아니었다 — 아래 ③** |
| `resetStops` · 새 계획 | 칩이 통째로 비워진다 | 자동 | 맞다 |
| 되묻기(`NARROW_STOP`) | **그 칩의** 스톱만 버린다 | 과제 2 에서 제외 | **부족했다 — 아래 ③** |
| 매장 교체(`REPLACE_LOCAL`) | 스톱이 갱신된다 | 이미 그렇다 | 맞다 |
| **"약국 다른 데로 바꿔줘"** | 고정이 풀려야 한다 | 깨져 있다 | 맞다 |
| **편집에서 삭제(`REMOVE_LOCAL`)** | 그 경유지가 없어져야 한다 | 깨져 있다 | 맞다 |

> **계획이 빠뜨린 것 ③: `REMOVE_CHIP`·`NARROW_STOP` 도 스톱을 통째로 다시 매칭한다.**
> 계획은 이 둘을 "자동"·"제외"로 적고 넘어갔는데, 둘 다 `stopsForChips(dataset, chips)` 를
> **맨손으로** 부른다(`APPLY_INTENT` 와 같은 결함이 두 곳 더 있었던 것이다). 그대로
> 두면 칩 하나를 ✕ 하거나 되묻기에 한 번 답하는 것만으로 **정해진 가게가 전부 풀린다**
> — 고정이 "가끔 풀리는" 기능이 되고, 그건 안 풀리는 것만큼 나쁘다.
> `REMOVE_CHIP` 은 남은 칩의 가게를 지키고, `NARROW_STOP` 은 **좁힌 칩의 것만** 버린다.

- [x] **1.** 실패 테스트
```ts
test('가게 이름으로 지워도 그 칩이 걸린다 — 추출은 가게명을 주고 칩은 업종을 든다', () => {
  // '봄빛온누리약국 말고 다른 데' → remove(queries:['봄빛온누리약국'])
  // 칩의 queries 는 ['약국'] 이라 지금은 안 걸리고, 이어지는 add 는 중복으로 걸러진다
  const next = planReducer(before, applyIntent({ stops: [remove(['봄빛온누리약국']), add(['약국'])] }));
  assert.equal(next.stops.find(s => s.baseId === 'c1'), undefined, '고정이 풀려야 다시 찾는다');
});

test('편집에서 경유지를 지우면 대화로 돌아가도 안 살아난다', () => {
  // REMOVE_LOCAL 은 stops 만 지운다(plan.tsx:584) — 칩이 남아 다음 요청이 되살린다
  const afterRemove = planReducer(withStop, { type: 'REMOVE_LOCAL', stopId: 'c1' });
  assert.equal(afterRemove.chips.filter(c => c.kind === 'stop' && c.id === 'c1').length, 0);
});
```
- [x] **2.** 실패 확인 — 넷 다 빨강
- [x] **3.** 구현
  - `APPLY_INTENT` 의 `remove` 매칭에 **해결된 스톱 이름**을 더한다. 규칙은
    `stopsForChips` 의 매칭과 **대칭**으로 뒀다(`name.includes(q)`) — 붙일 때 이름으로
    걸렸으면 뗄 때도 같은 규칙으로 걸린다
  - `REMOVE_LOCAL` 이 칩도 함께 지운다(`baseId` → 칩 id)
  - `REMOVE_CHIP` 은 남은 칩의 스톱을 `held` 로 지킨다
  - `NARROW_STOP` 은 좁힌 칩만 `held` 에서 빼고 나머지를 지킨다
- [x] **4.** 초록 → 커밋

**`REMOVE_LOCAL` 은 이미 있던 결함이다.** v1 이 그것을 "지워도 되살아나는" 필수 경로로
승격시킬 뻔했다. 지금 같이 고친다.

## 과제 6: 화면이 정해진 것을 말한다 (UI — 시뮬레이터 확인)

확정된 계획으로 돌아온 대화 화면이 `마트 ✕` 라고 말하면 사용자는 키워드로 읽는다.
실제로는 `한청할인마트` 로 정해져 있다. **이것이 혼란의 근원이다.**

**파일**: 수정 `src/state/chips.ts`, `src/screens/PlanScreen.tsx` · 테스트 `src/state/chips.test.ts`

- [ ] **1.** 실패 테스트 — 정해진 스톱이 있으면 칩 라벨이 그 가게 이름
- [ ] **2~4.** 실패 확인 → 구현 → 초록
- [ ] **5.** **시뮬레이터** — 세션 전용 기기(`AGENTS.md`)로 재현 절차를 그대로 밟아
      **약국이 봄빛온누리약국 그대로인지** 본다. 트랙 로그의 `plan.slots` 에서
      그 슬롯의 `calls` 가 **0 이 아닌 것**(검색은 돌아야 한다)과,
      `plan.result` 의 `picked` 가 고정된 가게를 담는지 함께 본다.
- [ ] **6.** 커밋

---

## 이 계획이 하지 않는 것

- **이미 들른 곳 제외** — 이동 중 추가는 별도 단계다. `APPLY_LIVE` 가 `passedCount: 0` 으로
  되돌리는 것까지 손봐야 한다(`plan.tsx:535` 주석).
- **편집 화면의 이동수단** — 과제 1~6 이 끝나야 안전하다. 지금 모드를 바꾸면 전체가
  다시 계산돼 가게가 전부 바뀐다. **이동수단이 바뀌면 고정을 유지할지도 그때 정한다** —
  자동차↔대중교통은 주차 정책(`parkingPolicy.ts:20`)과 `near` 추론이 달라진다.
- **순서 보존** — `usePlanRequest` 가 `order: 'auto'` 를 하드코딩한다(별도 과제).
- **`APPLY_OPTION`·`SET_STOP_COUNT`** — 목 데이터 전용 경로다. 고정과 어긋날 수 있지만
  개발 메뉴에서만 닿는다. 건드리지 않고 남겨 둔다.
