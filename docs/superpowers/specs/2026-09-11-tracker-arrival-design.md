# 추적기 묶음 — 도착·출발 판정 강화와 실기기 추적 로그

작성 2026-09-11. `docs/NEXT.md` §5 "도착 판정이 너무 느슨하다" · "목적지 도착도 못 잡음" · "실기기 추적 로그"를 한 묶음으로 푼다.

## 왜

2026-09-11 실기기에서 세 가지가 겹쳤다.

1. 영등포구청역에서 이탈 알림 → "계획 유지"를 누르자 **가상 주행**이 켜져 올리브영 도착으로 바뀌었다. `keepPlan`·`dismissOffRoute`가 `setModeRaw('driving')`을 부른다.
2. 도착 반경 150m + Balanced 정확도(≈100m) + 샘플 1개 즉시 판정이라 지나치기만 해도 "체류 중"이 된다.
3. 올리브영→현대카드가 200m인데 출발 반경이 250m라 출발이 영영 안 잡히고, 목적지 지오펜스는 경유지를 다 지난 뒤에만 돈다.

그리고 이런 일을 다음에 또 겪으면 원인을 화면 캡처로 추측해야 한다. 기기에 판정 근거를 남겨 내려받을 수 있어야 한다.

## 범위

- 판정 로직을 `src/lib/arrival.ts` **순수 모듈**로 빼고 `npm test`로 시험한다. `tracker.tsx`는 이 모듈을 부르고 dispatch·알림만 한다.
- 추적 로그 `src/lib/trackLog.ts` + 개발 메뉴 카드(내보내기·지우기) + 분석 스크립트.
- `keepPlan`·`dismissOffRoute` 모드 복귀.
- 건드리지 않는 것: 이탈(offroute) 판정 규칙, 시뮬레이션 틱 생성, `plan.tsx` 리듀서, 알림 문구.

## 1. 판정 모듈 `src/lib/arrival.ts`

### 입력

```ts
export type Fix = LatLng & {
  accuracyM?: number | null;   // 수평 정확도. 없으면 null
  speedMps?: number | null;    // iOS는 없으면 -1 → 호출자가 null로 바꿔 넘긴다
};
export type Point = { id: string; coord: LatLng };

export type ArrivalProfile = {
  arriveBaseM: number;   // 도착 반경 하한
  departBaseM: number;   // 출발 반경 상한
  arriveSamples: number; // 반경 안 연속 샘플 수
  departSamples: number; // 반경 밖 연속 샘플 수
  maxAccuracyM: number | null; // 이보다 나쁜 샘플은 무시. null이면 무시 안 함
  stationaryMps: number; // 이 속도 미만이어야 '멈춤'
};
```

프로필은 두 벌이고 `profileFor(sim: boolean, travelMode: 'car' | 'walk' | 'transit')`이 고른다.

| | live · car | live · walk/transit | sim (개발 메뉴) |
|---|---|---|---|
| arriveBaseM | 150 | 80 | 400 |
| departBaseM | 250 | 250 | 600 |
| arriveSamples | 3 | 3 | 1 |
| departSamples | 2 | 2 | 1 |
| maxAccuracyM | 100 | 100 | null |
| stationaryMps | 2 | 1 | ∞ (검사 안 함) |

walk/transit이 1인 이유: 보행 속도가 1.2~1.5m/s라 2로 두면 가게 앞을 지나가는 것도 '멈춤'이 된다. car는 주차장에서 기어가는 속도를 허용한다.

sim이 1샘플인 이유: 틱당 700m를 움직이므로 반경 안에 두 번 들어오지 않는다. 시뮬레이션의 목적은 UI 변형 확인이지 판정 검증이 아니다.

### 반경 계산 (샘플마다)

- `arriveR = max(profile.arriveBaseM, fix.accuracyM ?? 0)` — 정확도가 반경보다 나쁘면 반경을 정확도만큼 넓힌다.
- `departR = clamp(dist(target, next) / 2, 50, profile.departBaseM)` — next가 없으면 `departBaseM`. 두 지점이 100m 안쪽이면 50m 바닥.

### 상태와 단계 함수

```ts
export type ArrivalState = {
  streakId: string | null;  // 연속 카운트가 붙은 지점 id
  arriveStreak: number;
  departStreak: number;
  arrivedId: string | null;  // 이미 도착 이벤트를 낸 지점 — 중복 방지
  departedId: string | null; // 이미 출발 이벤트를 낸 지점 — 중복 방지
};
export const initialArrivalState: ArrivalState;

export type ArrivalEvent =
  | { kind: 'arrive'; id: string }
  | { kind: 'depart'; id: string }
  | { kind: 'skip'; id: string };   // 도착을 못 본 채 다음 지점에 도착 → 지나간 것으로 처리

export type ArrivalContext = {
  target: Point | null;  // stops[passedCount] ?? 목적지. 목적지까지 끝났으면 null
  next: Point | null;    // stops[passedCount+1] ?? 목적지. target이 목적지면 null
  atStop: boolean;       // target에 체류 중인가
  profile: ArrivalProfile;
};

export type ArrivalStep = {
  state: ArrivalState;
  events: ArrivalEvent[];
  ignored: 'accuracy' | null;   // 샘플을 버렸으면 이유
  distToTargetM: number | null;
  distToNextM: number | null;
  arriveR: number;
  departR: number;
};

export function stepArrival(state: ArrivalState, fix: Fix, ctx: ArrivalContext): ArrivalStep;
```

### 규칙

순서대로 평가하고, 이벤트를 낸 규칙에서 끝낸다.

0. `target === null` → 이벤트 없음.
1. **정확도 필터**: `maxAccuracyM != null && fix.accuracyM != null && fix.accuracyM > maxAccuracyM` → `ignored: 'accuracy'`, 상태 그대로.
2. **멈춤 여부** `stationary = speedMps == null || speedMps < 0 || speedMps < stationaryMps`. 속도를 모르면 멈춘 것으로 본다(3샘플 규칙이 남아 있다).
3. **다음 지점 선행 도착** (next가 있고 `distToNext < arriveR` 이고 `distToNext < distToTarget` 이고 stationary — 두 반경이 겹칠 때는 더 가까운 쪽이 이긴다): next에 대한 arriveStreak를 올린다. `arriveSamples`에 닿으면
   - atStop이면 `depart(target)` + `arrive(next)`
   - atStop이 아니면 `skip(target)` + `arrive(next)`
   
   호출자는 depart/skip을 먼저 dispatch한다(passedCount+1) → next가 target이 된다 → arrive를 dispatch한다. 한 지점만 내다본다. 두 지점 뒤까지 보면 출발 직후 목적지 옆을 지나는 경로에서 오판한다.
4. **target 도착** (atStop이 아니고 `arrivedId !== target.id`): `distToTarget < arriveR` 이고 stationary면 target의 arriveStreak +1, 아니면 0. `arriveSamples`에 닿으면 `arrive(target)`, `arrivedId = target.id`.
5. **target 출발** (atStop이고 `departedId !== target.id`): `distToTarget > departR`이면 departStreak +1, 아니면 0. `departSamples`에 닿으면 `depart(target)`, `departedId = target.id`.

streak는 지점 id가 바뀌면 0부터 다시 센다(`streakId`). 무시된 샘플은 streak를 건드리지 않는다.

### 시험 (`src/lib/arrival.test.ts`)

최소 이 케이스를 넣는다. 좌표는 여의도 근처 실좌표로, 거리는 `haversineM`으로 잡는다.

- 지나치기: 80m 반경 안에 1샘플(속도 8m/s) → 이벤트 없음. 3샘플 다 안에 있어도 속도 8이면 없음.
- 도착: 반경 안 연속 3샘플, 속도 0.5 → 3번째에서 `arrive`. 중간에 반경 밖 1샘플이 끼면 다시 0부터.
- 정확도: accuracy 180 샘플은 `ignored: 'accuracy'`, streak 유지. accuracy 95(walk 반경 80)는 반경을 95로 넓혀 판정.
- 출발 200m 문제: target·next가 200m 떨어져 있으면 departR = 100. 130m 지점 2샘플 → `depart`.
- 선행 도착: atStop에서 next 반경 안 3샘플 → `[depart(target), arrive(next)]`. atStop 아니면 `[skip, arrive]`.
- 목적지: stops 끝나 target=목적지, next=null → 반경 안 3샘플로 `arrive(dest)`.
- 중복: 같은 상태로 `stepArrival`을 한 번 더 불러도 arrive/depart를 다시 내지 않는다.
- sim 프로필: 1샘플로 arrive, 속도 검사 없음.

## 2. `tracker.tsx` 변경

- `detect`가 `Fix`를 받는다. expo-location 콜백에서 `accuracyM = coords.accuracy ?? null`, `speedMps = coords.speed == null || coords.speed < 0 ? null : coords.speed`. `backgroundLocation.ts`의 리스너도 `Fix`를 넘긴다.
- 지오펜스 블록을 `stepArrival` 호출로 바꾼다. `ArrivalState`는 ref. 컨텍스트: `target = stops[passedCount] ?? { id: 'D', coord: dest }` (arrivedAtDest면 null), `next = stops[passedCount+1] ?? { id: 'D', coord: dest }` (target이 D면 null). 좌표는 기존처럼 `shift()`를 거친다.
- 이벤트 처리:
  - `arrive(id)`: id가 'D'면 `arriveAtDestination` + `notifyDestinationArrival`, 아니면 `arriveAtStop` + `notifyArrival`. 알림 중복 방지는 기존 `notifiedRef` 유지.
  - `depart(id)`: `departStop` + `notifyNextLeg`.
  - `skip(id)`: `departStop`만. 알림 없음.
- `setMode`·`anchorToMyLocation`에서 `ArrivalState`를 `initialArrivalState`로 되돌린다.
- **① 모드 복귀**: `keepPlan`·`dismissOffRoute`는 `setModeRaw`를 부르지 않는다. 예외: 현재 모드가 `'deviate'`면 `'driving'`으로(시뮬레이션이 계속 벗어나므로). `tracker.mode`도 같은 값.
- 옛 상수 `ARRIVE_RADIUS_M`·`DEPART_RADIUS_M`은 삭제하고 프로필로 대체. 파일 머리 주석의 판정 규칙 문단을 갱신한다.

## 3. 추적 로그 `src/lib/trackLog.ts`

새 의존성: `expo-file-system`(신 API `File`·`Directory`·`Paths`), `expo-sharing`. `npx expo install`로 넣는다. 네이티브 모듈이라 다음 기기 빌드에서 켜진다.

### 파일

- `Paths.document/tracklog/track-YYYYMMDD.jsonl` — 로컬 날짜 기준 일별.
- 보관 7일: 기록 시작 때 이름 기준으로 오래된 파일을 지운다.
- 상한 2MB: 그날 파일이 넘으면 그날은 더 쓰지 않는다(드롭). 앱 재시작 후에도 같다.
- 한 줄 = JSON 하나: `{"t":"2026-09-11T09:41:03.120+09:00","k":"fix", ...}`.

### 이벤트

| k | 필드 |
|---|---|
| `fix` | lat, lng, acc, spd, src(`fg`\|`bg`\|`sim`) |
| `geofence` | target, next, dTarget, dNext, arriveR, departR, ignored, events(문자열 배열), atStop |
| `track` | from, to(status), crossTrack, progress |
| `mode` | from, to, via(`setMode`\|`keepPlan`\|`dismissOffRoute`\|`auto`\|`anchor`) |
| `plan` | origin, dest, stops[{id,name,lat,lng}], mode, source(`server`\|`mock`) |
| `notify` | kind(`arrival`\|`nextLeg`\|`dest`), id |

`fix`는 모든 샘플, `geofence`는 무시되지 않은 샘플마다, `track`은 status가 바뀔 때만.

### API

```ts
export type TrackEvent = { k: 'fix'; ... } | { k: 'geofence'; ... } | ...;
export function logTrack(e: TrackEvent): void;          // 동기 호출, 내부 큐 → 500ms 배치 append
export async function listTrackLogs(): Promise<{ name: string; bytes: number }[]>;
export async function exportTrackLogs(): Promise<void>;  // 7일치를 cache/track-export.jsonl로 합쳐 shareAsync
export async function clearTrackLogs(): Promise<void>;
```

순수 부분은 `src/lib/trackLogFormat.ts`로 빼서 시험한다: `fileNameFor(date)`, `pruneList(names, today, keepDays)`, `serialize(event, now)`, `overCap(bytes, cap)`. 파일 I/O는 시험하지 않는다.

`logTrack`은 실패해도 절대 던지지 않는다. 로그가 추적을 깨면 안 된다.

### 기록 지점

- `tracker.tsx`: detect 진입(`fix`), `stepArrival` 결과(`geofence`), status 전이(`track`), `setMode`·`keepPlan`·`dismissOffRoute`·자동 시작·anchor(`mode`), 알림 호출(`notify`).
- 계획 확정: `planConfirmed`가 true로 바뀌는 순간 `plan` 스냅샷. source는 `usePlanFlow().usingServer`.

## 4. 개발 메뉴 (`DevSheet.tsx`)

"위치 추적" 카드 아래 "추적 로그" 카드: 파일 수·총 용량 한 줄, 버튼 두 개 `내보내기`(공유 시트) · `지우기`. 시트가 열릴 때 `listTrackLogs`로 갱신. 파일이 없으면 버튼 비활성.

## 5. 분석 스크립트 `scripts/tracklog-timeline.mjs`

```bash
node scripts/tracklog-timeline.mjs track-export.jsonl
```

의존성 없음. `plan` 줄에서 지점 이름을 익히고, `geofence`·`track`·`mode`·`notify`를 시각순으로 한 줄씩 펼친다. `fix`는 접고 이벤트 사이 샘플 수·정확도·속도 범위만 요약한다.

## 지킬 것

- 순수 로직은 `src/lib/`, React·expo import 금지. `npm test`에 포함.
- 새 파일은 "왜" 주석으로 시작. 한국어 주석·커밋. 커밋 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 워크트리 에이전트: `git add -A` 금지, `node_modules` 절대 스테이징 금지.
- Expo SDK 57 문서(`https://docs.expo.dev/versions/v57.0.0/`)의 API만 쓴다. `expo-file-system/legacy`는 쓰지 않는다.

## 알려진 한계

- 버스가 가게 앞에서 정체하면(속도 < 2, 3샘플) 오도착이 난다. 로그로 빈도를 본 뒤 필요하면 "체류 N초"를 추가한다.
- 한 지점 선행만 본다. 경유지를 두 개 연속 건너뛰면 세 번째 도착이 안 잡힌다.
- 알림을 누른 액션은 기록하지 않는다(응답 리스너가 아직 없다).
