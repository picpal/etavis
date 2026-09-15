# 출처 표시 (timingSource) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추정(도보·대중교통은 하버사인 목)으로 계산한 시간을 실측(자동차, 서버 라우팅)처럼 말하지 않는다. 추정이면 "약"을 붙이고, 마감 판정("N분 여유/늦어요/초과")과 그 알림을 내지 않으며, 추정임을 한 줄로 말한다.

**Architecture:** 출처는 타입으로 흐른다. `RouteResult.source`(공급자가 찍음) → `PlanResult.timingSource`(플래너) → `Dataset.timingSource`(확정본) → 화면. 문구 결정은 순수 함수 `timingCopy()` 한 곳에서 하고 화면은 그 결과만 그린다. `usingServer` 불리언은 더 이상 화면 판정에 쓰지 않는다(서버 설정 유무이지 결과의 출처가 아니다).

**Tech Stack:** TypeScript, React Native(Expo), node:test via `tsx`. 화면 컴포넌트는 테스트가 없다 — 화면 변경은 `npx tsc --noEmit` + 시뮬레이터 확인이 검증이다.

**Spec:** `docs/대중교통-경로-단계계획.md` 2단계. 배경: Codex 토론(2026-09-15) H4 — 입력 화면 "실제 소요시간", 결과 "실측 N회"가 목 호출에도 나온다.

## Global Constraints

- 테스트 전체: `npm test`. 타입: `npx tsc --noEmit`(현재 exit 0이어야 한다).
- 커밋 메시지 한국어, `fix:`/`feat:`/`docs:` 접두, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 스테이징은 파일 이름으로(`git add <path>`), `git add -A` 금지.
- 단계 원칙: 알고리즘·공급자·대중교통 경로 계산에는 손대지 않는다. 이 단계는 **출처의 전달과 표시**만이다.
- 검증만을 위한 우회 구현 금지. 문구 스위치를 화면마다 따로 두지 않고 `timingCopy()` 하나를 쓴다.
- 문구(정확히 이 문자열):
  - 추정 접두: `약 `
  - 추정 배너(대중교통): `소요시간은 추정이에요 · 배차·환승 미반영`
  - 추정 배너(도보): `소요시간은 추정이에요 · 거리 기준`
  - 추정 배너(자동차인데 목, 즉 서버 없음): `소요시간은 추정이에요 · 서버 연결 전`
  - 입력 화면 안내(자동차): `직선거리가 아니라 실제 소요시간으로 계산해요`
  - 입력 화면 안내(도보·대중교통): `도보·대중교통 시간은 아직 추정이에요 · 도착 시각은 참고만`
  - 1안 근거(실측): `실측 ${n}회로 확인한 경로예요.` / (추정): `추정으로 계산한 경로예요 · 실측 전`

---

## 왜 이 구조인가

- `usingServer && mode === 'car'`(OptionsScreen.tsx:131)는 한 화면에만 있고, 진행중·타임라인·알림은 출처를 전혀 모른다. 스크린샷의 "49분 · 대중교통 · 도착 예정 10:20경 · +20분"이 그 결과다.
- `Rescored.estimated`는 "이 leg를 호출로 배웠나"이지 "호출이 실측이었나"가 아니다. 목 공급자로 배운 leg도 `estimated=false`다. 그래서 별도 축 `timingSource`가 필요하다. 둘은 합쳐서 쓴다: `approx = timingSource==='estimate' || legEstimated`.
- `measuredCount`의 의미(성공한 라우팅 호출 수)는 바꾸지 않는다. 테스트 6곳이 `provider.calls`와 같다고 단언하고, 그 의미 자체는 참이다. 화면 문구만 `timingSource`로 가른다.

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/routePlan/types.ts` | 타입 | `TimingSource`, `RouteResult.source?`, `PlanResult.timingSource` |
| `src/lib/routePlan/serverProvider.ts` | 서버 공급자 | 결과에 `source: 'provider'` |
| `src/lib/routePlan/mockProvider.ts` | 목 공급자 | 결과에 `source: 'estimate'` |
| `src/lib/routePlan/plan.ts` | 플래너 | `timingSource` 산출 |
| `src/lib/timingCopy.ts` (신규) | 문구 결정 순수 함수 | `timingCopy`, `introCopy`, `rationaleCopy` |
| `src/data/mockData.ts` | 확정본 타입 | `Dataset.timingSource?` |
| `src/state/planFlowBridge.ts` | 결과→확정본 | `timingSource` 전달, rationale |
| `src/screens/OptionsScreen.tsx` | 추천 화면 | `timingCopy` 사용, 배너, 판정 숨김 |
| `src/screens/TabStubScreens.tsx` | 진행중 화면 | 약·배너·판정 숨김·마감 알림 억제 |
| `src/screens/TimelineScreen.tsx` | 타임라인 | 약·판정 숨김 |
| `src/screens/PlanScreen.tsx` | 입력 화면 | 안내 문구 모드별 |
| `src/state/tracker.tsx` | 도착 알림 | 추정이면 "목표 시각 안에" 판정 안 함, 다음 구간 ETA에 약 |

---

### Task 1: 출처 타입 — 공급자가 찍고 플래너가 모은다

**Files:**
- Modify: `src/lib/routePlan/types.ts:53-60` (RouteResult), `:~100` (PlanResult)
- Modify: `src/lib/routePlan/serverProvider.ts:70-72`, `src/lib/routePlan/mockProvider.ts:72-77`, `src/lib/routePlan/plan.ts:172`
- Modify: `src/state/planFlow.test.ts:11` (fixture에 필드 추가)
- Test: `src/lib/routePlan/serverProvider.test.ts`, `src/lib/routePlan/mockProvider.test.ts`, `src/lib/routePlan/plan.test.ts`

**Interfaces:**
- Produces: `export type TimingSource = 'provider' | 'estimate'`; `RouteResult.source?: TimingSource`(없으면 estimate로 본다); `PlanResult.timingSource: TimingSource`.

- [ ] **Step 1: 실패하는 테스트 3개**

`src/lib/routePlan/serverProvider.test.ts` 끝에:

```ts
test('응답에 source=provider 를 찍는다 — 화면이 실측·추정을 가르는 근거', async () => {
  const { fn } = fakeFetch(() => ({ status: 200, body: okBody }));
  const p = serverRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'dev1', fetchFn: fn, now });
  const r = await p.route([at(37.5, 127), at(37.6, 127.1)], 480, 'car');
  assert.equal(r.source, 'provider');
});
```

`src/lib/routePlan/mockProvider.test.ts` 끝에(파일 상단의 기존 import·헬퍼를 그대로 쓴다):

```ts
test('목 공급자는 source=estimate 를 찍는다', async () => {
  const p = mockRouteProvider();
  const r = await p.route([{ latitude: 37.5, longitude: 127 }, { latitude: 37.6, longitude: 127.1 }], 480, 'transit');
  assert.equal(r.source, 'estimate');
});
```

`src/lib/routePlan/plan.test.ts` 끝에:

```ts
test('timingSource — 목이면 estimate, 공급자가 provider 를 찍으면 provider', async () => {
  const est = await plan(base([slot('a', [on, near])]), mockRouteProvider());
  assert.equal(est.timingSource, 'estimate');
  const mock = mockRouteProvider();
  const stamped = { route: async (...args: Parameters<typeof mock.route>) => ({ ...(await mock.route(...args)), source: 'provider' as const }) };
  const prov = await plan(base([slot('a', [on, near])]), stamped);
  assert.equal(prov.timingSource, 'provider');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/routePlan/serverProvider.test.ts src/lib/routePlan/mockProvider.test.ts src/lib/routePlan/plan.test.ts`
Expected: 새 테스트 3개 FAIL — `r.source` undefined, `timingSource` undefined.

- [ ] **Step 3: 구현**

`src/lib/routePlan/types.ts` — `RouteSection` 위에 추가하고 `RouteResult`·`PlanResult`에 필드:

```ts
/** 시간의 출처. provider = 라우팅 공급자 응답, estimate = 하버사인 목. 화면 문구는 이걸로 가른다 */
export type TimingSource = 'provider' | 'estimate';
```

```ts
export type RouteResult = {
  durationMin: number;
  distanceKm: number;
  polyline: LatLng[];
  sections: RouteSection[];
  /** 없으면 estimate 로 본다 — 찍지 않은 쪽이 실측을 주장할 수 없다 */
  source?: TimingSource;
};
```

`PlanResult`에 `measuredCount: number;` 다음 줄:

```ts
  /** 직행 응답의 출처. 한 계획의 호출은 모두 같은 모드·공급자라 직행 하나로 대표한다 */
  timingSource: TimingSource;
```

`src/lib/routePlan/serverProvider.ts:70-72` — `return data;`를:

```ts
        return { ...data, source: 'provider' };
```

`src/lib/routePlan/mockProvider.ts:72-77` — return 객체에 `source: 'estimate',` 추가:

```ts
      return {
        durationMin: sections.reduce((s, x) => s + x.durationMin, 0),
        distanceKm: sections.reduce((s, x) => s + x.distanceKm, 0),
        polyline: buildPolyline(points, 16),
        sections,
        source: 'estimate',
      };
```

`src/lib/routePlan/plan.ts:172`의 return에 추가:

```ts
  const timingSource: PlanResult['timingSource'] = direct.source === 'provider' ? 'provider' : 'estimate';
  return { directMin, directKm, options, alternatives, slotStatus, apiCalls, rescore, legTable, measuredCount, timingSource };
```

`src/state/planFlow.test.ts:11` fixture에 `timingSource: 'estimate',` 추가(`measuredCount: 1,` 뒤).

- [ ] **Step 4: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 PASS, tsc exit 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/routePlan/types.ts src/lib/routePlan/serverProvider.ts src/lib/routePlan/mockProvider.ts src/lib/routePlan/plan.ts src/lib/routePlan/serverProvider.test.ts src/lib/routePlan/mockProvider.test.ts src/lib/routePlan/plan.test.ts src/state/planFlow.test.ts
git commit -m "feat(routePlan): 시간의 출처(timingSource)를 공급자가 찍고 플래너가 모은다

usingServer 는 서버 설정 유무이지 결과의 출처가 아니다. 대중교통은 서버가 있어도
목이 계산하는데 화면은 그걸 몰랐다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `timingCopy` — 문구 결정을 한 곳에

**Files:**
- Create: `src/lib/timingCopy.ts`
- Test: `src/lib/timingCopy.test.ts`

**Interfaces:**
- Consumes: `TimingSource`, `Mode` from `./routePlan/types`
- Produces:
  ```ts
  export type TimingCopy = { approx: '약 ' | ''; banner: string | null; showVerdict: boolean };
  export function timingCopy(source: TimingSource | undefined, mode: Mode, legEstimated?: boolean): TimingCopy;
  export function introCopy(mode: Mode): string;
  export function rationaleCopy(source: TimingSource, measuredCount: number): string;
  ```

- [ ] **Step 1: 실패하는 테스트**

`src/lib/timingCopy.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introCopy, rationaleCopy, timingCopy } from './timingCopy';

test('실측이면 약 없음·배너 없음·판정 함', () => {
  assert.deepEqual(timingCopy('provider', 'car'), { approx: '', banner: null, showVerdict: true });
});

test('실측이라도 leg 하나가 추정이면 약은 붙고 판정은 한다 — 자동차 교체 시트의 기존 동작', () => {
  assert.deepEqual(timingCopy('provider', 'car', true), { approx: '약 ', banner: null, showVerdict: true });
});

test('추정이면 약·배너·판정 안 함 — 배너는 모드별', () => {
  assert.deepEqual(timingCopy('estimate', 'transit'), { approx: '약 ', banner: '소요시간은 추정이에요 · 배차·환승 미반영', showVerdict: false });
  assert.deepEqual(timingCopy('estimate', 'walk'), { approx: '약 ', banner: '소요시간은 추정이에요 · 거리 기준', showVerdict: false });
  assert.deepEqual(timingCopy('estimate', 'car'), { approx: '약 ', banner: '소요시간은 추정이에요 · 서버 연결 전', showVerdict: false });
});

test('출처를 모르면 추정으로 본다 — 목 데이터셋', () => {
  assert.equal(timingCopy(undefined, 'car').showVerdict, false);
  assert.equal(timingCopy(undefined, 'car').approx, '약 ');
});

test('입력 화면 안내는 모드별', () => {
  assert.equal(introCopy('car'), '직선거리가 아니라 실제 소요시간으로 계산해요');
  assert.equal(introCopy('transit'), '도보·대중교통 시간은 아직 추정이에요 · 도착 시각은 참고만');
  assert.equal(introCopy('walk'), '도보·대중교통 시간은 아직 추정이에요 · 도착 시각은 참고만');
});

test('1안 근거 — 실측이면 횟수, 추정이면 실측 전', () => {
  assert.equal(rationaleCopy('provider', 9), '실측 9회로 확인한 경로예요.');
  assert.equal(rationaleCopy('estimate', 9), '추정으로 계산한 경로예요 · 실측 전');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/timingCopy.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/lib/timingCopy.ts`:

```ts
/**
 * 시간 출처에 따른 화면 문구. 화면마다 따로 판정하면 한 곳만 고쳐지고 나머지가 거짓말한다 —
 * 진행중 화면이 그랬다(2026-09-15). 여기 말고는 '약'·'여유'·'늦어요'를 결정하지 않는다.
 *
 * - approx      숫자 앞 접두. 추정이면 '약 '
 * - banner      추정임을 말하는 한 줄. 실측이면 null
 * - showVerdict 마감 판정("N분 여유/늦어요/초과")과 그 알림을 낼 수 있나. 추정치 위에서 판정하면
 *               +8분 추정이 실제 +15분일 때 "제시간"이라 말하고 늦게 만든다
 */
import type { Mode, TimingSource } from './routePlan/types';

export type TimingCopy = { approx: '약 ' | ''; banner: string | null; showVerdict: boolean };

const BANNER: Record<Mode, string> = {
  transit: '소요시간은 추정이에요 · 배차·환승 미반영',
  walk: '소요시간은 추정이에요 · 거리 기준',
  car: '소요시간은 추정이에요 · 서버 연결 전',
};

export function timingCopy(source: TimingSource | undefined, mode: Mode, legEstimated = false): TimingCopy {
  // 출처를 못 밝히면 추정이다 — 목 데이터셋(timingSource 없음)이 여기 온다
  if (source !== 'provider') return { approx: '약 ', banner: BANNER[mode], showVerdict: false };
  return { approx: legEstimated ? '약 ' : '', banner: null, showVerdict: true };
}

export function introCopy(mode: Mode): string {
  return mode === 'car'
    ? '직선거리가 아니라 실제 소요시간으로 계산해요'
    : '도보·대중교통 시간은 아직 추정이에요 · 도착 시각은 참고만';
}

export function rationaleCopy(source: TimingSource, measuredCount: number): string {
  return source === 'provider' ? `실측 ${measuredCount}회로 확인한 경로예요.` : '추정으로 계산한 경로예요 · 실측 전';
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/timingCopy.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/timingCopy.ts src/lib/timingCopy.test.ts
git commit -m "feat: timingCopy — 약·배너·마감 판정 여부를 한 곳에서 정한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 확정본(Dataset)에 출처를 싣는다

**Files:**
- Modify: `src/data/mockData.ts:69` (Dataset.totals 아래), `src/state/planFlowBridge.ts:284`, `:291-306`
- Test: `src/state/planFlowBridge.test.ts`

**Interfaces:**
- Consumes: Task 1 `PlanResult.timingSource`, Task 2 `rationaleCopy`
- Produces: `Dataset.timingSource?: TimingSource` (목 데이터셋은 없음 = 추정)

- [ ] **Step 1: 실패하는 테스트**

`src/state/planFlowBridge.test.ts` 끝에:

```ts
test('toLegacyPlan — timingSource 를 확정본에 싣고, 1안 근거는 출처에 맞게', async () => {
  const s = await ready(); // mockRouteProvider → estimate
  const p = toLegacyPlan({ flow: s, departMin: 480 });
  assert.equal(p.dataset.timingSource, 'estimate');
  assert.equal(p.dataset.options[0].rationale, '추정으로 계산한 경로예요 · 실측 전');
  const stamped = { ...s, result: { ...s.result!, timingSource: 'provider' as const } };
  const q = toLegacyPlan({ flow: stamped, departMin: 480 });
  assert.equal(q.dataset.timingSource, 'provider');
  assert.match(q.dataset.options[0].rationale, /^실측 \d+회로 확인한 경로예요\.$/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/state/planFlowBridge.test.ts`
Expected: 새 테스트 FAIL — `timingSource` undefined.

- [ ] **Step 3: 구현**

`src/data/mockData.ts` — 파일 상단(`export type LatLng` 위)에 `import type { TimingSource } from '../lib/routePlan/types';`를 추가하고(타입 전용 import라 순환이어도 런타임 영향 없음), `Dataset`의 `totals` 줄 아래:

```ts
  /** 시간의 출처. 없으면 추정(목 데이터셋). 확정본은 planFlowBridge 가 채운다 */
  timingSource?: TimingSource;
```

`src/state/planFlowBridge.ts` — import에 `import { rationaleCopy } from '../lib/timingCopy';` 추가. `:284`를:

```ts
    rationale: i === 0 ? rationaleCopy(result.timingSource, result.measuredCount) : optionTitle(result, i),
```

`dataset` 객체(`:291-306`)의 `totals:` 줄 뒤에:

```ts
    timingSource: result.timingSource,
```

- [ ] **Step 4: 통과 확인**

Run: `npm test && npx tsc --noEmit`
Expected: 전부 PASS, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add src/data/mockData.ts src/state/planFlowBridge.ts src/state/planFlowBridge.test.ts
git commit -m "feat(bridge): 확정본에 timingSource 를 싣는다 — 진행중·타임라인·알림이 출처를 알게

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 화면·알림이 출처대로 말한다

**Files:**
- Modify: `src/screens/OptionsScreen.tsx:128-132`, `:164-183`, `:209`
- Modify: `src/screens/TabStubScreens.tsx:233-246`, `:251`, `:311`, `:349-368`
- Modify: `src/screens/TimelineScreen.tsx:32`, `:235-251`
- Modify: `src/screens/PlanScreen.tsx:83-97`, `:224`
- Modify: `src/state/tracker.tsx:90-99`, `:252-258`, `:275-279`
- Test: 없음(화면). 검증은 `npx tsc --noEmit` + `npm test`(회귀) + Task 5 시뮬레이터.

**Interfaces:**
- Consumes: Task 2 `timingCopy`, `introCopy`; Task 3 `Dataset.timingSource`

- [ ] **Step 1: OptionsScreen**

`:128-132`를:

```ts
  /* 출처는 결과가 안다. usingServer 는 서버 설정 유무일 뿐이라 대중교통 추정치를 실측인 양 말한다 */
  const copy = timingCopy(result.timingSource, req.mode, current.timing.estimated);
  const approx = copy.approx;
```

import에 `import { timingCopy } from '../lib/timingCopy';` 추가.

`:164-175` 헤드라인 블록을(판정은 `copy.showVerdict`일 때만, 아니면 배너):

```tsx
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            {/* 답은 항상 도착 시각. 마감이 있으면 옆에 '여유'/'늦어요' 한마디 — 늦으면 시각도 붉게.
                추정이면 판정을 내지 않는다 — 추정치 위의 "여유"는 거짓 정밀도다 */}
            <Text style={[type.displayXL, { color: late && copy.showVerdict ? color.late : color.ink }]}>{approx}{hhmm(arriveMin)} 도착</Text>
            {slack != null && copy.showVerdict && (
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 18, color: late ? color.late : color.green }}>
                {late ? `${-slack}분 늦어요` : `${slack}분 여유`}
              </Text>
            )}
          </View>
          {copy.banner && (
            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, lineHeight: 18, color: color.amberDeep }}>{copy.banner}</Text>
          )}
```

`EtaBar`의 `estimated={current.timing.estimated || !measured}`를 `estimated={approx !== ''}`로. `StopList`의 `late={late}`를 `late={late && copy.showVerdict}`로. `:209` CTA는 `approx`를 이미 쓰므로 그대로.

- [ ] **Step 2: TodayScreen (TabStubScreens.tsx)**

import에 `import { timingCopy } from '../lib/timingCopy';` 추가. `:251` 아래에:

```ts
  const copy = timingCopy(state.dataset.timingSource, state.mode);
  // 추정치 위에서는 마감 초과를 판정하지 않는다 — 알림도 같이 막는다
  const verdictSlack = copy.showVerdict ? slackMin : null;
```

`:267`의 `useDeadlineRiskAlert(state.planConfirmed ? slackMin : null, arriveByLabel)`를 `useDeadlineRiskAlert(state.planConfirmed ? verdictSlack : null, arriveByLabel)`로.

`:311` 공유 문구를 `` `${destinationDisplay} ${copy.approx}${formatEta(state.destArriveAt)} 도착 예정` ``로.

`:349-368` 카드를:

```tsx
            <Text style={[type.statL, { color: color.ink }]}>{copy.approx}{state.totals.totalMin}분</Text>
          </View>
          <Text style={[type.statS, { color: color.amber }]}>{copy.approx}+{state.totals.deltaMin}분</Text>
        </View>
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.muted }}>
          경유지 {state.totals.stopCount}곳 · {MODE_LABELS[state.mode]} · 도착 예정 {copy.approx}{formatEta(state.destArriveAt)}
        </Text>
        {/* 마감이 있고 실측일 때만 여유·초과. 추정이면 그 자리에 출처 한 줄 */}
        {copy.banner ? (
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, lineHeight: 18, color: color.amberDeep }}>{copy.banner}</Text>
        ) : verdictSlack != null && (
          <Text
            style={{
              fontFamily: 'Pretendard-SemiBold',
              fontSize: 13,
              lineHeight: 18,
              color: verdictSlack < 0 ? color.amberDeep : color.green,
            }}
          >
            {arriveByLabel} · {verdictSlack < 0 ? `${-verdictSlack}분 초과` : `${verdictSlack}분 여유`}
          </Text>
        )}
```

- [ ] **Step 3: TimelineScreen**

import에 `import { timingCopy } from '../lib/timingCopy';`. `:32` 아래 `const copy = timingCopy(state.dataset.timingSource, state.mode);`. `:235-237` 값에 접두: `` `${copy.approx}${state.totals.totalMin}분` ``, `` `${copy.approx}+${state.totals.deltaMin}분` ``. `:239-251` 판정 블록의 조건을 `slackMin != null && copy.showVerdict &&`로 바꾸고, 그 블록 앞에 배너:

```tsx
        {copy.banner && (
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, textAlign: 'center', color: color.amberDeep }}>{copy.banner}</Text>
        )}
```

- [ ] **Step 4: PlanScreen 안내 문구**

`AssistantBubble`이 모드를 받게: 시그니처 `function AssistantBubble({ mode }: { mode: 'car' | 'walk' | 'transit' })`, `:93` 문자열을 `{introCopy(mode)}`로. `:224` 호출을 `<AssistantBubble mode={state.mode} />`. import에 `import { introCopy } from '../lib/timingCopy';`.

- [ ] **Step 5: tracker 알림**

`:90-99` planRef에 `timingSource: state.dataset.timingSource,` 를 두 곳(초기값·갱신) 모두 추가. import에 `import { timingCopy } from '../lib/timingCopy';`.

`:252-258` 목적지 도착 알림:

```ts
          const p = planRef.current;
          const copy = timingCopy(p.timingSource, p.mode);
          logTrack({ k: 'notify', kind: 'dest', id: 'D' });
          void notifyDestinationArrival(
            destinationDisplay,
            copy.showVerdict && (p.arriveByMin == null || toMin(p.destArriveAt) <= p.arriveByMin),
            formatEta(p.destArriveAt),
          );
```

`:275-279` 다음 구간 알림의 `formatEta(...)`를 `` `${timingCopy(planRef.current.timingSource, planRef.current.mode).approx}${formatEta(after?.arriveAt ?? planRef.current.destArriveAt)}` ``로.

- [ ] **Step 6: 타입·회귀 확인**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 0, 전부 PASS. `grep -rn "usingServer" src/screens` 결과 0줄(화면에서는 더 이상 안 쓴다; tracker 로그용은 남는다).

- [ ] **Step 7: 커밋**

```bash
git add src/screens/OptionsScreen.tsx src/screens/TabStubScreens.tsx src/screens/TimelineScreen.tsx src/screens/PlanScreen.tsx src/state/tracker.tsx
git commit -m "fix(ui): 추정 시간을 실측처럼 말하지 않는다 — 약·배너·마감 판정 숨김·알림 억제

진행중 화면이 대중교통 추정치를 '도착 예정 10:20 · +20분'으로 단정했다(2026-09-15).
화면마다 따로 고치지 않고 timingCopy 하나로 가른다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 시뮬레이터 확인 (컨트롤러, 수동)

시뮬레이터 iPhone 16e, Metro 는 dev client(HMR). 같은 출발지·목적지(내 위치→회사), 경유지 "올리브영 1곳".

| # | 케이스 | 화면 | 기대(사실로 확인) |
|---|---|---|---|
| 1 | 자동차, 마감 있음(오늘 HH:MM까지) | 입력 | 안내 "직선거리가 아니라 실제 소요시간으로 계산해요" |
| 2 | 〃 | 추천 | "HH:MM 도착"(약 없음), "N분 여유/늦어요" 보임, 배너 없음, CTA "HH:MM 도착 경로로 계속" |
| 3 | 〃 확정 | 진행중 | "N분", "+N분", "도착 예정 HH:MM" 약 없음, "오늘 HH:MM까지 · N분 여유" 보임 |
| 4 | 대중교통, 마감 있음 | 입력 | 안내 "도보·대중교통 시간은 아직 추정이에요 · 도착 시각은 참고만" |
| 5 | 〃 | 추천 | "약 HH:MM 도착", 여유/늦어요 **없음**, 배너 "소요시간은 추정이에요 · 배차·환승 미반영", CTA "약 HH:MM 도착 경로로 계속" |
| 6 | 〃 확정 | 진행중 | "약 N분", "약 +N분", "도착 예정 약 HH:MM", 배너 보임, 여유/초과 **없음** |
| 7 | 〃 | 타임라인 | 총 예상 "약 N분", 배너, 여유/초과 없음 |

스크린샷 7장을 완료 보고에 첨부. 하나라도 어긋나면 Task 4로 돌아간다.

## 완료 기준 (2단계 게이트)

1. `npm test` 전부 PASS, `npx tsc --noEmit` 0.
2. 새 테스트: 공급자 2 + 플래너 1 + timingCopy 6 + 브리지 1.
3. Task 5 표 7행 전부 사실로 확인(스크린샷).
4. `src/screens` 에 `usingServer` 참조 0.
