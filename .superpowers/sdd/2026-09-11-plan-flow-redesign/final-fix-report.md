# plan-flow-redesign — 리뷰 지적 일괄 수정 보고

브랜치: `worktree-agent-a94e979e140bd51e3` (`plan-flow-redesign`에서 ff merge)
커밋 3개. 각 커밋 시점마다 `npx tsc --noEmit -p .` 무출력(성공) 확인.

| 커밋 | 제목 |
|---|---|
| `42aa08a` | fix(planFlow): requestKey에서 departAtMin을 뺀다 |
| `e0a78c9` | fix(bridge): 교체 후보를 고른 안 기준으로 낸다 (+toHHMM 반올림) |
| `287a87f` | fix(화면): NaNkm·부호·없는 문구·못 찾은 슬롯·완화안 빼기 |

## 지적별 수정

### C1 — 거짓 stale 배너 (`42aa08a`)
- `src/state/planFlow.ts:76` — `requestKey`의 조합에서 `r.departAtMin` 제거.
  `usePlanRequest`가 `Math.floor(Date.now()/60000)`를 의존성에 넣어 1분마다
  `departAtMin`을 새로 만들기 때문에, 조건을 하나도 안 건드려도 1분 뒤
  `isStale`이 참이 되어 A5에 "조건이 바뀌었어요"가 떴다.
- `src/state/planFlow.ts:68-72` — 왜 뺐는지 주석.
- `src/state/planFlow.test.ts:60-67` — 테스트 이름을 "…(이름·출발시각은 아니다)"로 고치고
  `departAtMin + 1`이 **키를 바꾸지 않는다**는 단언과 `arriveByMin` 변경은 바꾼다는 단언 추가.

### C2 — 후보가 1안 기준 (`e0a78c9`)
- `src/state/planFlowBridge.ts:116-145` — `slotCandidates(result, slots, visits, idx, timing)`
  신설(export). `toLegacyPlan` 안에만 있던 슬롯별 루프를 그대로 옮긴 순수 함수.
  현재 방문 → `chosenToCandidate`, 나머지 슬롯 후보 → 스왑 후 `result.rescore` →
  `alternativeToCandidate`, id 기준 dedupe.
- `src/state/planFlowBridge.ts:186-190` — `toLegacyPlan`의 후보 생성이 이 함수를 호출.
- `src/state/planFlowBridge.ts:42-58` — `effectiveVisits`에 `slots: Slot[]` 파라미터 추가
  (`result, slots, optionIdx, overrides` 순). 오버라이드 id를 `result.alternatives`가 아니라
  `slots[].candidates`에서 푼다 → 2·3안에서 교체가 no-op이던 문제 해소.
- `src/screens/OptionsScreen.tsx:39-42` — `sheetCands`가 `slotCandidates(...)`로.
  `alternativeToCandidate`/`chosenToCandidate` import와 이제 안 쓰는 `pickArrive` 제거.
- `src/screens/OptionsScreen.tsx:30, 123` — `effectiveVisits` 호출부에 `state.slots` 전달.
- `src/screens/OptionsScreen.tsx:105` — (동반 수정) 경유지 칩의 '고를 수 있는가'도
  `result.alternatives` 개수가 아니라 슬롯 후보 수에서 낸다. 같은 1안 편향이라
  2·3안에서 교체 가능한 슬롯이 비활성으로 보였다.
- `src/sheets/CandidateSheet.tsx:141, 210` — `{cand.recommended && !isCurrent && <RecommendBadge />}`.
  `chosenToCandidate`가 `recommended: true`를 주고 그 id가 곧 `currentId`라 배지가 겹쳤다.
- `src/state/planFlowBridge.test.ts` — 기존 `effectiveVisits` 호출 3곳 인자 갱신.

**추가 테스트** (`src/state/planFlowBridge.test.ts:118-149`)
1. `slotCandidates — 2안에서도 중복 없이 슬롯 후보 전부, recommended는 2안의 픽`
   — 2안 기준으로 각 슬롯의 목록이 (a) id 중복 없음, (b) 슬롯 후보 전체와 집합이 같음,
   (c) `recommended`가 정확히 하나이고 그게 2안이 고른 후보임.
2. `effectiveVisits — 2안에서 1안의 후보로 오버라이드해도 실제로 바뀐다`
   — 1안과 2안이 다르게 고른 슬롯을 찾아 2안 위에서 1안의 후보로 오버라이드했을 때
   `visits`가 실제로 바뀌는지. 고치기 전이면 no-op이라 실패한다.

### I1 — NaNkm (`287a87f`)
- `src/state/plan.tsx:152-153` — `round1(base.min > 0 ? base.km * (legMin / base.min) : base.km)`.

### I2 — 부호 표기 (`287a87f`)
- `src/sheets/CandidateSheet.tsx:37-40` — `signedMin(n)` 헬퍼 추가,
  `addedLabel`이 이걸 쓴다. `약 +-1분` → `약 −1분`.
- `src/screens/OptionsScreen.tsx:66-70, 104-107` — 완화안 줄의 여유를 `relaxedSlack`으로
  먼저 내고, 음수면 `N분 늦음`으로 쓴다.

### I3 — 브리지 toHHMM 1시간 어긋남 (`e0a78c9`)
- `src/state/planFlowBridge.ts:31-35` — 반올림을 먼저 하고(`const m = Math.round(min)`)
  거기서 시/분을 가른다. 시는 두 자리로 채운다. 599.7 → `"10:00"`.
- `src/state/planFlowBridge.test.ts:111-114` — 테스트 안의 사본도 같은 식으로.

### I6 — A8 거짓 문구 (`287a87f`)
- `src/screens/ErrorScreen.tsx:29` — `right={{ label: '요약' }}`(onPress 없음) 제거.
- 하드코딩 `3번 재시도 · 19:44 기준` 텍스트 블록 삭제.

### I7 — none 슬롯이 A5에서 사라짐 (`287a87f`)
- `src/screens/OptionsScreen.tsx:112-119` — 판정 카드 아래에
  `state.slots.filter(s => result.slotStatus[s.id] === 'none')` 한 줄씩
  `${query}은(는) 경로 근처에서 못 찾아 뺐어요` (caption/muted).

### I8 — '빼기'가 아무것도 안 뺐다 (`287a87f`) — 판정 (b)
- `src/screens/OptionsScreen.tsx:24` — `usePlan()`에서 `removeChip`도 받는다.
- `src/screens/OptionsScreen.tsx:72-78` — `dropRelaxedSlot()`:
  `removeChip(result.relaxed.droppedSlotId)`(슬롯 id = 칩 id) → `flow.reset()` →
  `navigation.navigate('Plan')`. 문구 `→ 계획에서 빼기` 유지, 자동 재계산 없음.

### 사소 — 카드의 '약 ' (`287a87f`)
- `src/screens/OptionsScreen.tsx:125` — `eff.timing.estimated || !flow.usingServer`.

## OptionsScreen 훅 — 전부 첫 return 위
첫 `return`은 44행(`if (!result || !current || !state.request)`).

| 행 | 훅 |
|---|---|
| 22 | `usePlanFlow()` |
| 23 | `usePlanRequest()` |
| 24 | `usePlan()` |
| 27 | `useState<string \| null>(null)` |
| 29 | `useMemo` (current) |
| 39 | `useMemo` (sheetCands) |

6개 모두 22~42행, 44행보다 위. 조건부 호출 없음.

## 명령과 결과

```
$ npx tsc --noEmit -p .
(무출력 — 커밋 3개 각각에서 확인)

$ npm test
ℹ tests 103
ℹ pass 103
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 570.953417
```
