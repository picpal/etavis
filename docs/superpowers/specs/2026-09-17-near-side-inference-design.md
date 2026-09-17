# near 축 추론 — 경유지를 출발지 쪽에 붙일지 목적지 쪽에 붙일지

작성 2026-09-17. 대중교통으로 마트에 들러 장을 보고 집에 가면 장 본 짐을 들고 지하철을 타야 한다. 목적지 근처 마트가 맞다. 반대로 우산·약처럼 지금 바로 필요한 것은 출발지 근처가 맞다. 지금은 `src/lib/nearSide.ts`의 `CARRY` regex가 `커피|음료|주스|스무디|아이스크림|빙수|케이크|꽃`을 `mode === 'transit'`일 때만 `end`로 보낸다. 마트는 안 잡힌다. 업종은 무한하고 regex 표는 진다.

이 문서는 그 판정을 **LLM이 뽑는 태그 + 코드가 정하는 정책**으로 나누고, 판정이 실제로 후보 선택에 닿도록 검색 단계까지 `near`를 알게 만든다.

## 왜

- 업종은 무한하다. `placeCategory.ts` 주석이 기록하듯 올리브영·다이소는 카카오 업종 코드 자체가 없다(실측). 코드 표로는 커버리지가 안 나온다.
- 그렇다고 LLM에 방향을 직접 물으면 프롬프트 v8이 이미 내린 결론("케이스마다 흔들린다", `extract-intent.md` 위치 절)으로 되돌아간다. 정책이 프롬프트로 샌다.
- **더 큰 문제는 판정이 아니라 배선이다.** `runPlan.ts:114-190`의 순서가 `검색 → 30개 컷 → applyNear`라, `near`는 늘 "남은 것 중에서" 고른다. `target = max(count, KC)`(`runPlan.ts:34,118`, `KC = 8`)는 **전체** 후보가 8개면 반경 확장을 멈추고, 그 8개 중 그쪽 끝이 몇 개인지는 운이다. `need = 1`이라 1곳만 남아도 완화가 안 돈다(`nearSide.ts` `applyNear`). 판정을 아무리 정교하게 해도 여기서 무력화된다.
- 2026-09-17 codex 리뷰가 낸 반례 6개 중 4개는 축 하나(`loadBefore`)와 우선순위 뒤집기로 풀린다. 나머지 2개는 §12에 한계로 남긴다.

## 범위

들어가는 것

- 추출 태그 3개(`loadBefore` · `loadAfter` · `needWhen`)와 그 스키마 검증.
- 방향을 정하는 순수 함수 `decideNear`. `resolveNear`/`nearFromCarry`/`CARRY`를 대체한다.
- **검색을 near-aware하게** — `searchAlong`의 샘플 점 편향, `searchAtAnchors`의 앵커 선택, `target` 판정 기준.
- **컷을 near-aware하게** — `byCorridor`·`attach`의 30개 상한.
- 완화를 진행률(`s`)이 아니라 **출발지·목적지로부터의 절대 거리**로.
- 태그를 칩 → `PlanRequest` → `Slot`까지 전달. `requestKey`에 포함.
- `actionLog.ts` `plan.slots`에 진단 필드 추가.
- 형제 슬롯(같은 `near`를 가진 슬롯이 둘 이상)의 후보 요구량 반영.
- `case-score.mjs` 태그 채점 키와 반복 실행 흔들림 측정.

건드리지 않는 것

- **`score.ts`의 목적함수.** 채점은 총 소요시간만 본다. `near`를 분(min)으로 환산해 섞는 대안은 `plan.ts:84-164`의 beam·시드·2라운드·옵션 선택·대안 채점을 전부 바꿔야 한다. "기능은 한 단계에 하나씩" 규칙에 걸린다.
- **자동차의 정차 용이성**(드라이브스루·주차). `near`가 *어디에 붙일까*라면 그건 *얼마나 쉽게 들를까*다. 별개 축이고 다음 단계다. §12.
- 화면. 추론한 `near`는 사용자에게 드러내지 않는다. §9.
- 체류시간·영업시간·동행자 축. §12.

---

## 0. 용어 — 축이 셋이 아니라 넷이었다

처음 설계는 세 축(물성 · 사용 시점 · 반입 제약)으로 봤다. codex 반례가 네 번째를 드러냈다.

| 축 | 질문 | 예 |
|---|---|---|
| **경유지 前 부담** | 경유지까지 **들고 가야** 하나 | 택배 부치기, 세탁물 맡기기, 수선 맡기기 |
| **경유지 後 부담** | 사고 나서 들고 가기 어려운가 | 장보기, 꽃, 케이크, 테이크아웃 음료 |
| **필요 시점** | 도착 전에 필요한가, 도착 후에 필요한가 | 우산(전), 선물(후) |
| ~~반입 제약~~ | — | **後 부담에 흡수한다.** §4 |

"경유지 前 부담"이 없으면 *"지하철로 회사 가는데 큰 택배 상자부터 부치고 가자"*를 못 푼다. 맡긴 뒤 남는 물건이 없어서 後 부담은 `none`인데, 실제 부담은 경유지까지 상자를 들고 가는 앞 구간에 있다.

**시점이 부담을 뒤집는다.** *"걸어가면서 먹을 아이스크림"*은 後 부담이 있지만 도착 전에 소비된다. 부담이 시점을 무조건 이기면 틀린다.

---

## 1. 계약 — 태그 3개

```ts
/** 부담의 유무. 정도는 재지 않는다 */
export type Load = 'none' | 'hard';
/** 목적지에 닿기 전에 필요한가, 닿은 뒤에 필요한가 */
export type NeedWhen = 'beforeArrival' | 'afterArrival' | 'unknown';

/** 경유지까지 들고 가야 하는 것이 있나 */
loadBefore: Load;
/** 경유지에서 얻은 것을 대중교통·도보로 들고 이동하기 어려운가 */
loadAfter: Load;
/** 언제 필요한가 */
needWhen: NeedWhen;
```

값 7개. 값을 더 쪼개지 않는 이유:

- `bulky`(부피)와 `delicate`(변질·파손)을 나눴었지만 정책 결과가 같다. 갈리는 건 자동차뿐인데 자동차는 §12로 뺐다.
- `loadAfter`를 "무거운가"가 아니라 **"대중교통·도보로 들고 이동하기 어려운가"**로 정의하면 테이크아웃 음료가 여기 들어온다. `NO_BOARD` regex가 필요 없어진다.
- 값이 7개를 넘으면 흔들림이 커진다. 측정은 §11-2, 후퇴 경로는 §13.

`NearSide`(`routePlan/types.ts`)는 그대로 `'start' | 'end' | 'any'` 3값이다. 중간을 표현하지 못하는 건 알려진 한계다(§12).

### 사용자가 말한 위치는 별개다

`near`(`'start' | 'end' | 'any'`)는 지금처럼 **사용자가 위치를 말했을 때만** 채운다. 태그와 `near`는 다른 필드고, `near`가 언제나 이긴다.

---

## 2. 프롬프트 — v10

`server/prompts/extract-intent.md`가 원본, `server/src/prompt.ts`가 사본이다(`prompt.ts:1`).

**먼저 버전 표기를 정리한다.** 지금 문서 헤더는 `(v3)`, 절마다 `— v6` `— v8`, 코드 사본은 `v9`다. 카운터가 둘이라 어긋났는지 판별이 안 된다. 이번 변경으로 둘 다 **v10**으로 맞추고, 절 버전은 헤더와 같은 카운터임을 문서 머리에 한 줄로 적는다.

### 위치 절을 둘로 가른다

지금 v8 절은 이렇게 적혀 있다.

> 말하지 않았으면 `"any"`. **추론하지 않는다** — `커피 사서 회사 가자`는 어디서 사라는 말이 없으니 `"any"`다.

이 문장은 유지한다. 방향은 여전히 추론하지 않는다. 그 아래에 태그 절을 새로 붙인다.

> **방향**(`near`)은 사용자가 말했을 때만. **부담**(`loadBefore`·`loadAfter`)과 **시점**(`needWhen`)은 **항상 판단한다.** 방향은 코드가 정한다 — 태그로 방향을 암시하려 하지 마라.

각 태그의 판정 기준을 문장으로 적는다. 예시는 최소로 — 표를 늘리면 LLM이 표를 외우고 표 밖에서 흔들린다.

- `loadBefore: 'hard'` — 경유지에 **가져가서 맡기거나 넘길 물건**이 있다. 부치기·맡기기·반납하기·수선.
- `loadAfter: 'hard'` — 경유지에서 얻은 것을 **대중교통이나 도보로 들고 이동하기 어렵다.** 부피·무게·변질·파손·용기.
- `needWhen: 'beforeArrival'` — 목적지에 닿기 **전에** 쓰거나 소비한다. `'afterArrival'` — 목적지에 닿은 **뒤에** 쓴다. 판단할 근거가 문장에 없으면 `'unknown'`.

**서버는 출발지·목적지·모드를 받지 않는다**(`intentClient.ts:79-82` — `{text, context:{currentStops, knownPlaces}}`). 그래서 `needWhen`은 "이 여행의 목적지"를 알 필요가 없도록 정의했다: 목적지가 어디든 **산출물이 목적지까지 가는지**만 본다. 장 본 것은 목적지가 회사여도 목적지까지 간다.

---

## 3. 스키마 — `server/src/schema.ts`

인젝션 방어선은 프롬프트가 아니라 여기다(AGENTS.md).

- 허용 목록을 **정확히** 열거한다. 목록 밖이면 `'none'` / `'unknown'`.
- 필드가 없으면 `'none'` / `'unknown'`. 옛 클라이언트·옛 모델 응답이 그대로 돈다.
- **`op === 'remove'`인 stop의 태그는 무시한다.** 지울 경유지의 물성은 의미가 없고, 읽으면 공격면만 는다.
- 클라이언트 경계(`intentClient.ts:34-45`의 `looksLikeIntent`)는 stop 내부를 보지 않는 얕은 검사다. 여기는 그대로 두되, **`intent.ts`의 로컬 목이 만드는 값도 같은 허용 목록을 지나게** 한다.

스키마가 검증할 수 있는 건 값의 형태뿐이고 **태그의 사실성은 검증할 수 없다.** 공격 문장이 모델에게 합법 값 `loadAfter: 'hard'`를 뱉게 하면 구별할 방법이 없다. 그래서 이 태그로 만들어지는 제약은 §7의 완화를 반드시 통과해야 하고, 어떤 경우에도 경유지를 0건으로 만들지 않는다.

---

## 4. 정책 — `decideNear`

`src/lib/nearSide.ts`. `resolveNear` · `nearFromCarry` · `CARRY`를 대체한다.

```ts
export function decideNear(
  stated: NearSide | undefined,
  mode: Mode,
  tags: { loadBefore: Load; loadAfter: Load; needWhen: NeedWhen },
): NearSide {
  if (stated === 'start' || stated === 'end') return stated;   // 말한 게 언제나 이긴다
  if (mode === 'car') return 'any';                            // §12 한계
  if (tags.loadBefore === 'hard') return 'start';              // 앞 구간에 부담
  if (tags.needWhen === 'beforeArrival') return 'start';       // 시점이 부담을 뒤집는다
  if (tags.loadAfter === 'hard') return 'end';                 // 뒤 구간에 부담
  if (tags.needWhen === 'afterArrival') return 'end';
  return 'any';
}
```

순서가 곧 우선순위다. `loadBefore`가 `needWhen`보다 앞인 이유: 택배를 부치러 가면서 "도착해서 쓸 것"을 같이 사는 경우가 있어도, 상자를 오래 들고 다니는 쪽이 항상 더 아프다.

### 판정표

| 발화 | loadBefore | loadAfter | needWhen | mode | 결과 |
|---|---|---|---|---|---|
| 지하철로 회사 가는데 큰 택배부터 부치고 | hard | none | unknown | transit | `start` |
| 걸어가면서 먹을 아이스크림 | none | hard | beforeArrival | walk | `start` |
| 밀폐 텀블러에 담을 커피 사서 지하철 | none | hard | beforeArrival | transit | `start` |
| 카페에서 노트북 충전하고 회사 | none | none | beforeArrival | transit | `start` |
| 우산 하나 사야 해 | none | none | beforeArrival | transit | `start` |
| 장보고 집에 가자 | none | hard | afterArrival | transit | `end` |
| 장보고 집에 가자 | none | hard | afterArrival | **walk** | `end` |
| 커피 사서 회사 가자 (위치 언급 없음) | none | hard | unknown | transit | `end` |
| 꽃 사서 식장 가자 | none | hard | afterArrival | transit | `end` |
| 세탁물 찾아서 집에 | none | hard | afterArrival | transit | `end` |
| 세탁물 맡기고 회사 | hard | none | unknown | transit | `start` |
| 은행 들렀다 가자 | none | none | unknown | transit | `any` |
| 장보고 집에 가자 | none | hard | afterArrival | **car** | `any` |

`walk`가 더 이상 제외되지 않는다. 현행 `nearFromCarry`는 `mode !== 'transit'`을 전부 `any`로 보내는데, 도보로 장 본 짐을 드는 건 대중교통보다 힘들다.

---

## 5. 검색이 `near`를 알아야 한다

**이 절이 이 설계의 핵심이다.** §4를 아무리 정교하게 해도 여기가 없으면 판정이 후보에 닿지 않는다.

### 5.1 회랑 검색 — `searchAlong` (`corridorSearch.ts`)

지금은 직행 폴리라인 위 `samples = 5`개 점에서 찾고, **전체** 후보가 `target`에 닿으면 반경 확장을 멈춘다.

바꿈 두 가지. 시그니처에 `near: NearSide`를 받는다.

**(a) 샘플 점을 near 구간에서 뽑는다.** 진행률 구간을 좁히고 그 안에서 5점을 균등하게 뽑는다.

| `near` | 샘플 구간 |
|---|---|
| `end` | `s ∈ [0.5, 1.0]` |
| `start` | `s ∈ [0.0, 0.5]` |
| `any` | `s ∈ [0.0, 1.0]` (현행) |

점 개수는 5개 그대로다. **카카오 호출 수가 늘지 않는다.** 구간 경계 0.5는 §7의 완화 경계(절대 거리)와 별개다 — 검색은 넉넉하게, 필터는 좁게.

**(b) `target` 판정을 near 쪽 개수로 센다.** 지금은 `found.length >= target`인데, `near !== 'any'`면 `near` 조건을 만족하는 후보 수로 센다. 그래야 "전체 8개 모였으니 그만" 하고 멈춘 뒤 필터에서 1개로 쪼그라드는 일이 없다.

여기서 **"near 쪽"의 판정 기준은 §7.2의 첫 단계**(출발지·목적지로부터 `NEAR_RADII_M[0] = 1500m`)를 쓴다. `searchAlong`·`byCorridor`·`applyNear`가 같은 함수를 공유해야 한다 — 기준이 다르면 검색이 채운 것을 필터가 버린다. `matchesNear(near, coord, origin, destination, radiusM)` 하나를 `nearSide.ts`가 내보내고 세 자리가 쓴다.

반경 상한 `maxRadiusM`은 그대로다. 라운드를 더 돌 수 있지만 **최악 라운드 수는 변하지 않는다**(반경 4라운드 + far 1라운드, `runPlan.ts` 주석의 25콜 상한 그대로).

### 5.2 앵커 검색 — `searchAtAnchors` (대중교통)

`extractAnchors`가 만드는 `Anchor.kind`는 `'origin' | 'board' | 'transfer' | 'alight' | 'destination'`이다(`anchors.ts:17-18`). 방향을 이미 안다.

| `near` | 검색할 앵커 |
|---|---|
| `end` | `alight`, `destination` |
| `start` | `origin`, `board` |
| `any` | 전부 (현행) |

`transfer`(환승역)는 어느 쪽도 아니다 — `any`일 때만 본다. 환승 지점을 원하는 케이스는 §12의 한계다.

**앵커를 좁히면 호출 수가 준다**(앵커당 1콜). 좁힌 앵커에서 `status === 'none'`이면 지금처럼 회랑으로 떨어지되, **회랑도 같은 `near`로** 부른다.

---

## 6. 30개 컷이 `near`를 알아야 한다

`corridorSearch.ts`의 두 자리가 후보를 30개로 자른다.

- `byCorridor` — 회랑에서 벗어난 거리(cross-track) 오름차순
- `attach` — `anchorWalkM` 오름차순

둘 다 `near`를 모른다. 대중교통에서 `near === 'end'`인데 출발역 근처 후보가 역에 더 가까우면 **도착역 후보가 컷에서 먼저 잘린다.**

바꿈: `near !== 'any'`면 **near 쪽 후보로 먼저 자리를 채우고, 남는 자리를 반대쪽으로 채운다.** 각 그룹 안의 정렬 기준은 지금과 같다. "near 쪽"의 판정은 §5.1이 정한 공유 함수를 그대로 쓴다.

반대쪽을 버리지 않는 이유는 §7의 완화 때문이다. 완화가 돌아야 할 때 되돌릴 후보가 이미 없으면 완화가 무의미해진다.

---

## 7. 완화 — 진행률이 아니라 절대 거리

### 7.1 왜 `s`를 버리나

`NEAR_SPLIT_S = 0.6`은 `projectOnCorridor`가 내는 **진행 비율**이다(`corridor.ts`). 경로 길이에 따라 뜻이 달라진다.

- 2km 경로에서 `s ≥ 0.6` = 마지막 800m
- 40km 경로에서 `s ≥ 0.6` = 마지막 16km

같은 "목적지 근처"가 전혀 다른 것이 된다. 16km 떨어진 마트는 목적지 근처가 아니다.

### 7.2 절대 거리 단계

```ts
export const NEAR_RADII_M = [1500, 3000] as const;
```

- `end` — `haversineM(destination, coord) ≤ R`
- `start` — `haversineM(origin, coord) ≤ R`

근거: `corridorSearch.ts`의 `ANCHOR_MAX_M = 1500`이 이미 "여기를 넘으면 역 근처가 아니라 별개의 경유다"라는 선을 긋고 있다. 경유지는 역보다 넉넉해야 하므로 1500m에서 시작한다.

단계는 `1500` → `3000` → **제약 없음(완화)**. 가운데 단계가 처음 질문에 나온 *"양쪽 근처에 없으면 특정 지역을 경유"*에 해당한다.

### 7.3 완화 조건 — `need = 1`로는 안 돈다

지금 `applyNear`는 `kept.length >= Math.min(need, candidates.length)`면 통과다. `need = count = 1`이라 **1곳만 남아도 완화가 안 돈다.** 그 1곳으로 확정되고 교체 시트에 대안이 없다.

```ts
/** near 쪽에서 이만큼은 있어야 교체 시트가 의미를 갖는다 */
export const NEAR_TARGET = 3;
```

- 요구량 = `max(siblings, NEAR_TARGET)`. `siblings`는 같은 `near`를 가진 형제 슬롯 수(§10).
- 단계마다 요구량을 못 채우면 다음 반경으로. 마지막 단계에서도 못 채우면 전부 되돌리고 완화를 기록한다.
- 애초에 후보 총수가 요구량보다 적으면 `near`가 원인이 아니다 — 좁힌 결과를 그대로 쓴다(현행과 같은 예외).

`poly.length < 2`일 때 조용히 통과시키는 현행 예외는 유지한다. 다만 근거가 폴리라인이 아니라 출발지·목적지 좌표로 바뀌므로, 실제로는 좌표가 없을 때만 걸린다.

---

## 8. 배선

### 8.1 태그가 지나갈 길

`near`가 이미 지나는 길과 같다.

| 자리 | 변경 |
|---|---|
| `server/src/schema.ts` `IntentStop` | 태그 3개 파싱·검증 |
| `src/lib/intent.ts` (로컬 목) | 태그 3개 생성. **보수적으로** `none`/`unknown` 기본 |
| `src/state/plan.tsx` `IntentChip` | 태그 3개 필드 |
| `src/state/plan.tsx` 칩 생성 2곳 | 태그 전달 |
| `src/state/planFlow.ts` `PlanRequest['stops']` | 태그 3개 |
| `src/state/planRequest.ts` | 칩 → 슬롯. 없으면 `none`/`unknown` |
| `src/lib/routePlan/types.ts` `Slot` | 태그 3개(진단용) + §9 필드 |
| `src/state/runPlan.ts` | `resolveNear` → `decideNear` |

옛 상태의 칩에 필드가 없을 수 있다. `stopKind`·`near`와 같은 방식으로 기본값을 둔다(`planRequest.ts:20-38`의 기존 패턴).

### 8.2 `requestKey` — 지금 `near`조차 안 들어 있다

`planFlow.ts`의 `requestKey`는 stops를 이렇게 만든다.

```ts
`${s.queries.join('>')}×${s.count}${s.flexible ? '' : '!'}${s.openNow ? '?' : ''}`
```

`near`도 태그도 없다. **태그를 바꿔도 같은 요청으로 본다.** 이대로 태그를 얹으면 "바꿨는데 안 바뀐다"로 곧장 터진다.

바꿈: stops 키에 `near`와 태그 3개를 붙인다. `mode`는 이미 키에 있으므로, 이것으로 `decideNear`의 입력이 전부 키에 들어간다.

`departAtMin`을 빼는 현행 판단은 그대로 둔다 — 그건 조건이 아니라 시계다(`planFlow.ts` 주석).

### 8.3 모드 변경

`usePlanRequest`가 `state.mode`를 의존하고 `runPlan`이 요청 모드로 판정을 부르므로, 모드를 바꾸면 **새 실행에서 다시 계산된다.** 다만 즉시가 아니다 — 모드 변경은 결과를 리셋하고, 사용자가 다시 계산 화면에 들어갔을 때 실행된다(`ModeSheet.tsx`, `CalculatingScreen.tsx`). 이 동작을 바꾸지는 않는다. **태그를 추출 시점에 near로 확정하면 이것조차 안 되므로, 태그를 슬롯까지 들고 가는 것이 필요조건이다.**

### 8.4 후속 발화가 태그를 갱신하지 않는다

같은 질의에 대한 후속 발화는 기존 칩을 갱신하지 않고 추가만 생략한다(`plan.tsx` 칩 생성부). "아까 마트 말고 편의점" 같은 수정에서 낡은 태그가 남는다.

이번 범위에서는 **고치지 않는다.** `op: 'remove'` + `op: 'add'`로 오는 정상 경로에서는 칩이 새로 만들어져 태그도 새로 붙기 때문이다. 다만 §9의 로그에 태그를 찍어 두면 실제로 낡는 경우가 관측된다. 관측되면 그때 고친다.

---

## 9. 진단 — 화면이 아니라 로그

### 9.1 화면은 그대로

추론한 `near`는 사용자에게 드러내지 않는다. `runPlan.ts`의 현행 판단을 유지한다.

```ts
nearRelaxed: sided.relaxed && (st.near === 'start' || st.near === 'end')
```

주석에 적힌 이유가 맞다 — 코드가 물성으로 추론한 제약까지 사과하면, 목적지 얘기를 꺼낸 적 없는 사용자에게 "목적지 쪽엔 없어서"라고 말하게 된다.

### 9.2 로그는 늘린다

**하지만 그 결과로 추론이 완화돼도 아무 흔적이 없다.** 실전에서 "near 때문에 나빠졌는지"와 "원래 후보가 나빴는지"를 구분할 수 없다.

`actionLog.ts`의 `SLOTS` case가 이미 `plan.slots`에 이걸 찍고 있다.

```ts
search: `${s.query} near=${s.near ?? 'any'}${s.nearRelaxed ? '!' : ''} r=${s.searchRadiusM} calls=${s.searchCalls}`
```

여기를 늘린다. `Slot`에 필드를 추가한다.

| 필드 | 뜻 |
|---|---|
| `nearSource: 'stated' \| 'inferred' \| 'none'` | 방향이 어디서 왔나 |
| `nearBefore: number` | `applyNear` **전** 후보 수 |
| `nearAfter: number` | `applyNear` **후** 후보 수 |
| `nearRadiusM: number \| null` | 어느 완화 단계에서 멈췄나. `null`이면 전부 되돌림 |
| `nearRelaxedRaw: boolean` | 추론 포함 실제 완화 여부. 화면용 `nearRelaxed`와 별개 |

로그 문자열 예: `마트 near=end(inf) 8→3 nr=1500 r=2000 calls=5`

이 다섯 개가 §5·§6·§7이 실제로 도는지 확인하는 유일한 수단이다. DevSheet는 `usePlan()`만 읽어서 슬롯을 못 보지만, 이 채널은 `trackLog`로 파일에 남으므로 화면 배선이 필요 없다.

---

## 10. 형제 슬롯

지금 `runPlan.ts:107-112`의 `siblings`는 **같은 검색어**를 쓰는 슬롯만 센다("편의점 두 곳"). 검색어가 달라도 `near`가 같으면 같은 쪽 끝을 나눠 가져야 한다는 사실은 안 본다.

바꿈: `applyNear`에 넘기는 요구량을 `max(같은 near를 가진 슬롯 수, NEAR_TARGET)`으로 한다. 기존 "같은 검색어" 카운트는 그대로 두고 둘 중 큰 값을 쓴다.

**순서 규칙은 만들지 않는다.** "마트도 `end`, 약국도 `end`"일 때 방문 순서는 플래너가 총시간으로 최적화하고, 지금 그게 나쁘다는 증거가 없다. 증거 없이 규칙을 만들면 또 추측이다. §9의 로그에 `near`가 찍히므로 몰림이 실제로 일어나는지는 관측된다.

---

## 11. 검증 — AGENTS.md 순서대로

돈이 나가는 순서로 정렬한다. 앞에서 답이 나오면 뒤로 가지 않는다.

### 11-0. 단위 테스트 (무료)

- `nearSide.test.ts`
  - §4 판정표 13개 전부. codex 반례 6개 중 해결되는 4개를 포함한다.
  - §7.2 절대 거리 — 같은 `s`라도 2km 경로와 40km 경로에서 판정이 달라지는 케이스.
  - §7.3 완화 — **`need = 1`이고 near 쪽 후보가 1개일 때 완화가 돈다.** 이번 설계의 1순위 동기이자, 현행 코드가 실패하는 지점이다.
- `corridorSearch.test.ts` — §5.1 샘플 구간 편향(호출 수가 늘지 않는 것 포함), §5.1(b) target을 near 쪽으로 세는 것, §5.2 앵커 선택, §6 컷이 near 쪽을 먼저 채우는 것.
- `planFlow.test.ts` — §8.2 `requestKey`가 태그 변경에 반응하는지.

### 11-1. 목 기준선 (무료)

```bash
node server/run-cases.mjs
```

목(`intent.ts`)이 태그를 보수적으로만 뱉으므로 **실패가 늘어난다. 정상이다.** 기대값은 "제품이 어떻게 동작해야 하나"로 쓴다. 목이 못 하는 것을 기대값에서 빼면 목의 한계를 제품 사양으로 굳히는 것이다(AGENTS.md).

**`case-score.mjs`에 태그 키를 먼저 넣는다.** 지금 채점 키에 태그가 없어서, 넣지 않으면 태그가 틀려도 통과한다. 러너의 '미검증'을 통과로 세면 숫자가 부풀려진다(AGENTS.md).

`server/prompts/cases.jsonl`에 §4 판정표의 발화를 케이스로 추가한다.

### 11-2. 모델 시뮬레이션 (codex 구독제, 무료)

```bash
node server/run-llm.mjs
```

여기서 재는 것은 정답률만이 아니라 **흔들림**이다. 운영 호출은 기본 비결정성을 쓴다(`server/src/index.ts`).

- 같은 입력을 **3회** 돌린다.
- 태그별 혼동행렬을 낸다 — 특히 `loadAfter`의 `none`↔`hard`, `needWhen`의 `unknown`↔나머지.
- **판정 기준:** 같은 입력 3회에 같은 태그가 안 나오는 비율이 20%를 넘으면 §13의 후퇴를 검토한다.

### 11-3. 서버 실측 (API 과금)

```bash
node server/run-server-cases.mjs   # 그룹당 1개 = 27개
```

**배선을 바꾼 뒤 살아 있는지 확인하는 용도다.** 모델 품질은 11-2에서 재고, `--all`은 정말 필요할 때만.

### 11-4. 시뮬레이터

화면 변경은 없지만 §5·§6이 실제 카카오 응답에서 도는지는 목으로 못 본다. 대중교통으로 "장보고 집에 가자"를 돌리고 `trackLog`의 `plan.slots`에서 `nearBefore → nearAfter`와 `nr=`를 읽는다.

---

## 12. 알려진 한계 — 이번에 안 푸는 것

정직하게 적는다. 아래는 결함이 아니라 **범위 밖으로 정한 것**이다.

| 한계 | 예 | 왜 |
|---|---|---|
| **자동차** | "차로 집 가는 길에 회 포장해 가자" — `mode === 'car' → any`라 변질을 못 본다 | car는 `near`가 아니라 정차 용이성(드라이브스루·주차)이 지배 축이다. 다음 단계에서 같이 푼다 |
| **중간 지점** | "지하철 환승할 때 편의점에서 생수" | `NearSide`가 3값이라 중간을 표현하지 못한다. §5.2에서 `transfer` 앵커를 `any`일 때만 보는 것도 같은 이유 |
| **양·포장** | "생수 한 병"과 "장바구니 가득"이 둘 다 `loadAfter: 'hard'` | 값을 쪼개면 흔들림이 는다. 11-2에서 이게 실제 오판으로 나타나는지 먼저 본다 |
| **복합 모드** | 승차 전 도보 + 대중교통 + 하차 후 도보 | `mode`가 여행 단위 하나뿐이다 |
| **여러 경유지의 적재 순서** | 냉동식품을 먼저 사고 다른 곳을 오래 도는 문제 | §10에서 순서 규칙을 안 만들기로 한 것과 같은 판단 |
| **서버가 출발지·목적지를 모른다** | `intentClient.ts:79-82` | §2에서 `needWhen` 정의로 우회했다. 근본 해결은 컨텍스트를 보내는 것이고 그건 별개 변경이다 |
| **체류시간·영업시간·동행자** | 유아차·휠체어·날씨·엘리베이터 | 다른 축이다 |

---

## 13. 리스크와 후퇴

| 리스크 | 신호 | 후퇴 |
|---|---|---|
| **태그가 흔들린다.** 가장 큰 위험 | 11-2의 3회 반복 불일치율 > 20% | `needWhen`을 버리고 `loadBefore`·`loadAfter` 2축(값 4개)만 남긴다. `beforeArrival` 뒤집기를 잃지만 마트·택배는 살아남는다 |
| **태그 자체가 방향을 우회해 묻는 것이 된다** | `needWhen`이 사실상 `near`와 같은 분포 | 위와 같은 후퇴 |
| **추론이 조용히 틀린다** | 사용자 보고. §9 로그에 `near=…(inf)`와 `nearBefore→nearAfter` | 완화가 0건은 막지만 *반대쪽 오판*은 못 막는다. 케이스로만 잡는다 |
| **검색 편향이 후보를 줄인다** | §9의 `nearBefore`가 오히려 작아짐 | §5의 (a) 샘플 구간을 `[0.4, 1.0]`으로 넓힌다. (b) target 판정은 유지 |
| **로컬 목이 태그를 못 뽑아 폴백 품질이 떨어진다** | `source === 'local'`일 때 near가 전부 `any` | 의도한 것이다. 목은 보수적으로 `none`/`unknown` — 폴백 시 현행과 같은 동작이 된다 |
| **regex 후퇴안** | 위 후퇴로도 안 되면 | codex가 낸 대안: `why`의 **행동 동사** 표(늦게: 포장해 가기·장보기·픽업 / 일찍: 부치기·맡기기·반납하기). 동사는 업종보다 확실히 적다. 다만 `why`는 화면에 그대로 뜨는 자유 문장이라, `placeCategory.ts`가 기록한 "이름만 매칭해서 주차장이 1순위가 됐다" 실패를 문구 축에서 반복할 위험이 있다 |

---

## 부록 — codex 리뷰(2026-09-17) 대응

반례 6개 중 4개가 §0의 네 번째 축과 §4의 우선순위 뒤집기로 풀린다. 나머지 2개(차+회, 환승역)는 §12에 한계로 명시했다.

받아들인 지적: `loadBefore` 누락, 부담이 시점을 무조건 이기는 오류, `carry === 'none'` 조기 반환이 활동형 경유지를 죽이는 문제, `s` 비율 경계의 길이 의존성, `case-score`에 태그 키가 없으면 검증이 거짓이 되는 문제, `requestKey`에 `near`가 없는 기존 버그.

받아들이지 않은 지적: *"추론 near는 필터가 아니라 비용으로"*. 방향은 맞지만 `objectiveScore` 분리가 `plan.ts:84-164`를 전부 건드린다. 대신 핵심 논지("확실한 물리적 불가만 필터")를 §4의 분기 순서와 §7의 완화로 받았다.

사실이 아닌 지적: *"DevSheet가 판정 근거를 표시할 수 없다"*. 진단 채널은 DevSheet가 아니라 `actionLog.ts`의 `plan.slots`이고, 이미 `near=`·`r=`·`calls=`를 찍고 있다(§9.2).
