# Handoff: 들러(Duler) — 시나리오 A (목적형 경유지 계획)

## Overview
들러는 “숙소 가기 전에 올리브영에서 화장품 사고 치킨 포장하고 싶어” 같은 자연어 한 문장을 받아, **실제 이동시간 + 경유지 체류시간**까지 계산해 순서를 정해주는 iOS 경로 계획 앱입니다. Duration(체류시간) + Scheduler.

이 핸드오프의 범위는 **시나리오 A 한 줄기**입니다: 홈 → 자연어 입력 → 계산 중 → 경로 3안 비교 → 타임라인(드래그 재정렬) → 후보 매장 교체 / 경유지 할 일 / 외부 지도 앱 전달 / 오류·재시도.

## About the design files
`design-reference/Duler iOS Gallery v2.dc.html` 는 **HTML로 만든 디자인 레퍼런스**입니다. 프로덕션 코드가 아니고, 그대로 옮겨 붙이는 대상도 아닙니다. 브라우저로 열면 31개 화면(A/B/C/D 시나리오 전체)이 iPhone 393×852 프레임으로 나열되며, 각 프레임 밑에 화면 ID(A1, A2 …)와 의도가 적혀 있습니다.

**정확한 색·간격·타이포는 이 HTML의 인라인 스타일이 원본(source of truth)입니다.** 아래 스펙과 어긋나면 HTML을 따르세요. 구현 대상은 새 Expo(React Native) 프로젝트이며, HTML 마크업이 아니라 화면의 **결과물**을 재현하는 것이 과제입니다.

## Fidelity
**High-fidelity.** 색상 hex, 폰트 크기/웨이트/행간, 라운드, 그림자, 카드 패딩까지 확정된 상태입니다. 픽셀 단위로 재현하세요. 임의로 컴포넌트 라이브러리 기본 스타일(예: 기본 그림자, 기본 라운드)을 쓰지 마세요.

## Target environment (사용자 확정 사항)
| 항목 | 결정 |
|---|---|
| 스택 | **Expo (React Native) + TypeScript**, iOS만, Expo Go에서 실행 |
| 스타일링 | Tailwind 표기 선호 → **NativeWind v4** 사용, 또는 동등한 `StyleSheet` + 토큰 상수 (판단은 구현자에게 위임) |
| 백엔드 | **없음.** 전부 로컬 목 데이터 + `setTimeout` 지연 |
| 지도 | `react-native-maps`, **Apple Maps 공급자**(iOS 기본, API 키 불필요), 실제 경로 폴리라인 |
| 드래그 재정렬 | `react-native-draggable-flatlist` |
| 폰트 | **Pretendard 번들** (`expo-font`), 웨이트 400/500/600/700 |
| 인터랙션 깊이 | 화면 전환 + 로컬 상태 (체크박스·라디오·세그먼트·드래그 실제 동작) |
| 목 데이터 | 평창 기준 3개 시나리오 데이터셋 (경로 변형 테스트용) |

동봉 파일 `tokens.ts`, `mockData.ts` 는 그대로 프로젝트에 넣어 쓰면 됩니다.

## Design tokens
`tokens.ts` 에 코드로 들어 있습니다. 요약:

**Color**
| 이름 | 값 | 용도 |
|---|---|---|
| `bg` | `#F4F7FC` | 화면 배경 |
| `surface` | `#FFFFFF` | 카드·헤더·탭바·입력창 |
| `ink` | `#10203A` | 제목·숫자 |
| `body` | `#4C5A72` | 본문 |
| `muted` | `#5B6A84` | 라벨·보조 설명 (AA 통과) |
| `placeholder` | `#7C8AA2` | 미입력 값 |
| `primary` | `#1B57D6` | CTA·활성·강조 |
| `primaryTint` | `#E8EFFD` | 파란 칩 배경 |
| `amber` | `#8A5108` | 추가시간·주의 텍스트 |
| `amberDeep` | `#7A4707` | 오류 카드 본문 |
| `amberBg` | `#FDF3E4` | 오류·주의 카드 배경 |
| `green` | `#157A54` | 영업 중·완료 |
| `hairline` | `rgba(16,32,58,0.07)` | 카드 내부 구분선 |
| `stroke` | `#C6D2E6` | 점선 커넥터·비활성 아이콘·핸들 |
| `track` | `#E5EBF4` | 세그먼트 트랙·비활성 버튼 |
| `skeleton` | `#EAF0F9` / `#F0F4FA` | 스켈레톤 2단 |
| `scrim` | `rgba(16,32,58,0.30)` | 시트 뒤 딤 (A7은 0.32) |

**Radius** 카드 20 · 시트 상단 24 · 입력창/큰 버튼 18 · 버튼 16 · 칩 14 · 세그먼트 트랙 12 / 썸 10 · 작은 칩 9 · 아이콘 버튼 13

**Shadow** (iOS)
- `card`: offset (0,4) blur 16 → `shadowColor '#1C3A6E', opacity .06, radius 8, offset {0,4}`
- `cardElevated`: (0,6) blur 20–22, opacity .10
- `header`: (0,2) blur 12, opacity .05
- `input`: (0,4) blur 16, opacity .08
- `chip`: (0,2) blur 10, opacity .05
- `sheet`: (0,-10) blur 32, `#10203A` opacity .20

**Type scale** (Pretendard)
| 이름 | 크기/행간/웨이트 | 비고 |
|---|---|---|
| display | 30–34 / 1.0–1.25 / 700 | `letterSpacing: -0.02em` (예: `64%`, `41분`, `어디로 가시나요?`) |
| titleL | 24 / 1.2 / 700 | 시트 제목 (`후보 4곳`) |
| title | 20 / 1.2 / 700 | 네비 타이틀, `-0.02em` |
| btn | 17 / 1 / 600 | CTA 라벨 |
| bodyL | 16 / 1.4 / 400 | 채팅 버블·입력 텍스트 |
| item | 16 / 1.2 / 600 | 리스트 항목명 |
| action | 15 / 1 / 500 | 네비 우측 텍스트 버튼, 세그먼트 |
| body | 14 / 1.5 / 400 | 설명문 (`textWrap: pretty` 대응 = `numberOfLines` 없이 자연 줄바꿈) |
| caption | 13 / 1.3–1.45 / 400 | 보조 |
| label | 12 / 1 / 600 | 섹션 라벨, `letterSpacing: 0.06em`, `muted` |
| micro | 11 / 1 / 500 | 4열 라벨 상단 |

**Spacing** 화면 좌우 20 · 카드 패딩 16~20 · 카드 사이 14 · 섹션 라벨과 카드 사이 9~10 · 칩 간격 8~9 · 헤더 상단 52(= status bar, 실제로는 `useSafeAreaInsets().top` 사용) / 하단 14 · 하단 CTA 영역 `padding: 16 20 30`

## Global layout rules
- 프레임 393×852 기준. RN에서는 `flex: 1` + safe area. 갤러리의 `52px` 상단 패딩과 `30px` 하단 패딩은 각각 top/bottom inset으로 대체.
- 화면 구조는 항상 **헤더(흰색, 그림자) → 스크롤 콘텐츠(bg) → 하단 고정 영역(흰색 또는 투명)**.
- 카드 시스템: `섹션 라벨(12/600/.06em/muted)` + `흰 카드(R20, shadow card)` + 카드 안에서 4열 마이크로 라벨(`micro` 라벨 위 `17/700` 값, 사이 1px 세로 구분선).
- 점선 커넥터: 타임라인 좌측 `2px dashed #C6D2E6` — RN에서는 `borderLeftWidth: 2, borderStyle: 'dashed'` 또는 `react-native-svg`의 `strokeDasharray`(더 안정적).
- 시트: 하단에서 올라오는 `borderTopLeftRadius/RightRadius: 24`, 상단에 38×5 R3 그랩바(`stroke`), 배경 `bg`, 뒤에 `scrim`.
- **계획 내부 화면(A2~A9)에는 탭바가 없습니다.** 탭바는 홈(A1)에만 — 계획/저장/기록/설정 4개, 아이콘 20×20, 라벨 11/500, 활성만 `primary`.
- 접근성: 모든 탭 타깃 최소 44×44. 본문 최소 12pt.

## Screens

### A1 — 홈
사용자가 출발/목적지를 확인하고 자연어로 계획을 시작하는 진입점.
- 상단: 위치 핀 아이콘 + `현재 위치 평창 · 오늘 18:52` (14/500/muted), 그 아래 `어디로 가시나요?` (30/700/-0.02em).
- **출발–목적지 카드**: 흰 카드 R20 p18. 좌측 12px 폭 컬럼에 위 원(11px, `border 3px primary`), 아래 사각(11px, `ink`, R3), 사이 `2px dashed stroke`. 우측에 `출발`(12/500/muted) + `알펜시아 리조트`(20/700), 1px hairline, `최종 목적지` + `숙소를 입력하세요`(20/700, `placeholder`).
- `최근 목적지` 섹션: 칩 3개(오크밸리 숙소 / 평창역 / 집), 15/500, padding 13×15, R14, 흰 배경 + chip shadow.
- `이렇게 물어보세요` 카드: 예시 문장 16/500 `primary`, hairline, 설명 14/400 muted.
- 하단 입력 바: `flex:1` 입력창(minHeight 52, R18, 흰색, input shadow, placeholder `메시지로 계획을 시작하세요` 16/400) + 52×52 R18 `primary` 전송 버튼(흰 chevron).
- 탭바.
- **동작**: 입력창 탭 → A2로 이동(입력 상태로).

### A2 — 자연어 입력 + 조건 카드
- 헤더(흰색): 좌 38×38 R13 back 버튼(배경 `bg`, chevron `primary`), 중앙 `계획 만들기`, 우 `요약`(15/500/primary). 헤더 아래에 **항공권 스타일 커넥터**: `bg` 카드 R16 p14 — 좌 `출발/알펜시아`, 중앙 `직행 32분`(11/500/muted) + `2px dotted stroke` 선, 우 `도착/오크밸리`(우측 정렬).
- 사용자 버블: 우측 정렬, `primary` 배경, 흰 텍스트 16/400/1.4, R `20 20 8 20`, maxWidth 285.
- `계산 조건` 카드: ① 이동수단 세그먼트(트랙 `bg` R12 p3, 활성 썸 흰색 R10 + shadow, 자동차/도보/대중교통 15) ② hairline ③ `숙소 도착 예정 시각` 행 — `bg` R12 p13×16, `오늘 21:00까지`(17/600) + ` · 30분 단위`(13/400/muted), 우측 위/아래 chevron 스테퍼.
- CTA `경로 계산하기`(minHeight 54, R16, primary, 17/600 + chevron).
- 하단 입력 바: 입력 중 텍스트 `카페도 하나 추가해줘` + 2×20 `primary` 캐럿(1.1s blink).
- 키보드 영역: RN에서는 실제 시스템 키보드 + `KeyboardAvoidingView`.
- **동작**: CTA → A3. 세그먼트·시각 스테퍼는 실제 로컬 상태.

### A3 — 계산 중
- 헤더: back, `경로 계산 중`, 우측 `취소`(15/500/muted).
- 진행 카드: `조합 12개 검토 중`(12/500/muted) + `64%`(30/700) / 우측 `약 6초 남음`(13/500/muted); 6px R3 트랙 `#EAF0F9` + `primary` 채움; 체크리스트 4행 — 완료(22px 원 `green` + 흰 체크), 진행 중(22px `border 2.5px primary`, 1.2s pulse), 대기(`stroke` 테두리, opacity .45). 완료 행은 `경로상 올리브영 4곳`처럼 숫자만 600/`ink`.
- `추천 경로` 스켈레톤 카드 2장(두 번째 opacity .65), 바 `#EAF0F9`/`#F0F4FA`, 1.4s shimmer, 딜레이 0.1~0.4s.
- 안내문 `계산 중에도 대화를 이어갈 수 있어요.`(13/400/muted, 중앙).
- 하단 입력 바(전송 버튼 비활성 `stroke`).
- **동작**: 목 지연 약 6초(개발 중 조정 가능) 후 자동으로 A5. `취소` → A2. 목 실패 플래그 시 A8.

### A5 — 경로 3안 비교
- 헤더: back, `추천 경로`, 우 `정렬`.
- 섹션 라벨 `직행 32분 기준 · 3개 안`.
- 추천안 카드(cardElevated): 우상단 배지 `시간 최소`(11/700/.06em, `primary` 배경, R `0 0 8 8`, 카드 top에 붙음) / `총 소요` + `41분`(34/700) / 우측 `직행 대비` + `+9분`(20/700 `amber`) / 점선 커넥터 4포인트 행(원-점선-원-점선-원-점선-사각) + 그 아래 지점명 4열(12/500/muted, 좌·중·중·우 정렬) / hairline / 근거 문장 14/400/body.
- 대안 카드 2장: `대기 최소 44분` `+12분`, `한 곳만 들르기 36분` `+4분` — 26/700 총시간 + 17/700 `amber` + 한 줄 요약 13/400/muted.
- 하단 흰 영역: CTA `41분 경로로 계속`(minHeight 56, R18) + 안내문 12/400/muted 중앙.
- **동작**: 카드 탭으로 안 선택(선택 카드가 cardElevated + 배지). CTA → A6.

### A6 — 타임라인 (핵심 화면)
- 헤더: back, `최종 경로`, 우 `편집`.
- **지도 프리뷰**: height 132, R20. `react-native-maps` + Apple Maps, 실제 경유지 좌표 폴리라인(`primary`, 2px), 출발 원(흰 배경 + 3px primary), 경유지 원(primary + 흰 테두리 2px), 도착 사각(`ink`). 좌하단 캡션 칩 `경유지 미리보기 · 안내는 외부 앱`(11/500, 흰 배경 90%, R8, p6×8). 지도 제스처는 비활성(`scrollEnabled={false}`) — 프리뷰이므로.
- 섹션 라벨 `일정 순서`.
- **타임라인 카드**(흰 R20 p18): 좌측 12px 노드 컬럼 + 절대 위치 `2px dashed stroke` 라인(top 29, bottom 29, left 23). 행 구성:
  1. 출발 — 원(12px, border 3px primary, 흰 배경) / `알펜시아 리조트`(16/600) + `현재 위치`(13/400/muted) / 우측 `18:52`(16/700)
  2. 이동 행 — 노드 없음, `이동 12분 · 6.4km`(13/500/muted)
  3. 경유지 — 원(12px primary, 흰 테두리 2px) / `올리브영 평창점` + `체류 15분 · 영업 중` + 칩 2개: `할 일 1 / 3`(13/600 primary, `primaryTint`, R9, p8×10) → **A9 진입**, `매장 교체`(13/600 body, `bg`) → **A4 진입** / 우측 `19:04`(16/700) + 3줄 드래그 핸들(14×2 R1 `stroke`)
  4. 이동 행
  5. 드래그 중 상태 — 내부 카드 `bg` R14 p12, `border 1.5px rgba(27,87,214,.35)`, shadow (0,8) blur 18 .12, 부제 `드래그 중 · 놓으면 재계산`(13/400 `amber`), 핸들 `primary`
  6. 이동 행 → 도착 — 사각 노드(`ink`) / `오크밸리 숙소` / `19:48`
- 카드 아래 힌트 `길게 눌러 순서 변경 · 왼쪽으로 스와이프해 삭제`(12/400/muted 중앙).
- 하단 흰 영역: 3열 요약(`총 예상 56분`(26/700) | `경유지 2곳`(20/700) | `직행 대비 +24분`(20/700 amber), 사이 1×34 구분선) + CTA `지도 앱에서 열기`(56, R18).
- **동작**: `react-native-draggable-flatlist` 로 경유지 순서 변경 → 드롭 시 목 재계산(0.6s 지연 후 도착 시각/총시간 갱신). 스와이프 삭제. CTA → A7.

### A4 — 후보 비교 시트 (A6에서 `매장 교체`로 진입)
- 뒤 배경: A6 헤더만 보이고 `scrim` 덮음. 시트 height 730, R24 상단, 그랩바.
- 시트 헤더: `올리브영 평창점 교체`(12/500/.06em/muted) + `후보 4곳`(24/700), 우측 `완료`(15/500 primary). 아래 정렬 세그먼트(트랙 `track`): 추가시간 / 영업 상태 / 거리.
- 추천 후보 카드(cardElevated): 우상단 `추천` 배지 / 64×64 R16 사진 placeholder(대각 스트라이프 `repeating-linear-gradient(135deg,#E4EAF4 0 6px,#EFF3F9 6px 12px)` → RN에서는 `react-native-svg` 패턴 또는 6px 줄무늬 이미지) + `올리브영 평창점`(18/600) + `화장품 · 경로에서 1.1km`(13/400/muted) + `● 영업 중 · 22시 마감`(13/500 green) / **4열 라벨 블록**(`bg` R14 p14: 추가시간 `+4분`(amber) | 도착 `19:12` | 체류 `15분` | 주차 `가능`, 값 17/700, 라벨 11/500/muted, 사이 1px 구분선) / `추천 이유` 12/600 + 설명 14/400/body + `영업시간 12분 전 확인` 12/400/muted / CTA `이 매장으로 정하기`(52, R16).
- 대안 행 2개: 52×52 R14 사진 + 이름 16/600 + 한 줄 요약 13/400/muted + 우측 `+11분`(17/700 amber) & `19:19`(11/400/muted). 영업 종료 항목은 `opacity .55` + 회색 점 + `선택 불가`(탭 비활성).
- **동작**: 세그먼트로 정렬 실제 동작, 후보 선택 → A6 복귀 + 타임라인 갱신(도착 시각 재계산).

### A9 — 경유지 할 일 체크리스트 (A6의 `할 일 1 / 3`로 진입)
- 시트 형태. 상단 3열 라벨(도착 · 체류 · 다음 출발). 그 아래 체크리스트 카드 — 체크박스 실제 토글, 완료 항목은 취소선 + muted. 하단 CTA로 A6 복귀.
- **체크가 경로 재계산을 유발하지 않는다**는 문구를 유지하세요(사용자 신뢰 포인트).
- 정확한 마크업은 갤러리 HTML의 A9 프레임 참조.

### A7 — 외부 지도 앱 선택 시트
- `scrim` 0.32 + 하단 시트(R24, p `10 20 30`, gap 16).
- 제목 `어떤 지도 앱으로 열까요?`(23/700) + 설명 14/400/muted.
- 단일 흰 카드 안에 4행(각 minHeight 58, p16): 40×40 R12 아이콘 자리(네이버 `#E4F0E8` / 카카오맵·카카오내비 `#FBF3DC` / Google `#EAEFF6`) + 이름 16/500 + 보조 12/400/muted + 우측 chevron(`stroke`). 행 사이 1px hairline, `marginLeft: 70`.
- 미설치(Google Maps): `opacity .5` + 우측 `설치`(14/500 primary).
- 주의 카드: `amberBg` R16 p14 — `경유지가 5개를 넘으면 일부가 생략돼요`(13/600 amber) + 설명(13/400 amber).
- `취소` 버튼(54, R18, `track`, 17/600 body).
- **동작**: 항목 탭 → 목 딥링크(실제 `Linking.openURL` 시도, 실패 시 A8 스타일 배너). 취소 → A6.

### A8 — 오류 · 재시도
- 헤더: back, `계획 수정`, 우 `요약`.
- 사용자 버블(`사람 적은 카페로 바꿔줘`).
- 오류 카드: `amberBg` R20 p20, shadow `rgba(178,106,10,.12)` — 26px 원 `amber` + 흰 `!` + 제목 `연결이 불안정해요`(20/700 `#7A4707`) + 설명 14/400/1.55 `#7A4707` + 버튼 행(`다시 시도` flex1 primary 52 R16 / `나중에` 흰 배경, 텍스트 `#7A4707`) + `3번 재시도 · 19:44 기준`(12/400 amber).
- 아래에 **유지된 계획 카드**(시각 우측 정렬) — 실패했어도 마지막 계산 결과가 남아 있음을 보여줌.
- **동작**: `다시 시도` → A3, `나중에` → A6.

## Interactions & behavior
- 화면 전환: `@react-navigation/native-stack`, iOS 기본 push 애니메이션. 시트(A4/A7/A9)는 `presentation: 'modal'` 대신 커스텀 bottom sheet(`react-native-reanimated` + `react-native-gesture-handler`) — 디자인의 730px 높이/그랩바/딤을 재현.
- 목 지연: 계산 3~6초(진행률 애니메이션과 동기), 재계산 0.6초, 딥링크 0.3초.
- 상태 변화 시 숫자(도착 시각·총시간)는 `LayoutAnimation` 또는 reanimated로 부드럽게 갱신.
- 실패 시뮬레이션: 개발용 토글(`__DEV__` 화면 또는 흔들기)로 A8 진입 가능하게.
- 햅틱: CTA·드래그 드롭·체크 토글에 `expo-haptics` light impact.

## State management
`zustand` 또는 `useReducer` + Context 하나로 충분합니다.

```ts
type PlanState = {
  origin: Place; destination: Place;
  mode: 'car' | 'walk' | 'transit';
  arriveBy: string;              // ISO
  stops: Stop[];                 // 순서 = 방문 순서
  candidates: Record<string, Candidate[]>;
  options: RouteOption[];        // A5의 3안
  selectedOptionId: string;
  status: 'idle' | 'calculating' | 'ready' | 'error';
  progress: number;              // 0..1  (A3)
  totals: { totalMin: number; deltaMin: number; stopCount: number };
};
```
전이: `입력(A2) → calculate() → status:'calculating' & progress tick → options 채움 → A5` / `selectOption → stops 확정 → A6` / `reorder(stops) → recalculate()` / `replaceStop(candidate) → recalculate()` / `toggleTask(stopId, taskId)` (재계산 없음) / `openExternal(app)`.

## Assets
- **Pretendard** (SIL OFL) — `expo-font` 로 400/500/600/700 번들.
- 아이콘: 디자인은 모두 CSS 도형(원·사각·chevron·핸들)입니다. RN에서는 `react-native-svg`로 그리거나 `@expo/vector-icons`의 SF Symbols 계열로 대체하되 **선 두께 2px, 크기 8–12px** 규격을 지키세요.
- 매장 사진: 45° 대각 스트라이프 placeholder. 실사진 없음.
- 지도 타일: Apple Maps 기본.

## Files in this bundle
- `README.md` — 이 문서
- `CLAUDE_CODE_PROMPT.md` — Claude Code에 그대로 붙여넣는 지시문
- `tokens.ts` — 색·타이포·그림자·라운드 상수 (+ NativeWind 테마 확장 스니펫)
- `mockData.ts` — 평창 기준 3개 시나리오 데이터셋 (좌표·소요시간·후보·할 일 포함)
- `design-reference/Duler iOS Gallery v2.dc.html` — 31개 화면 디자인 원본 (브라우저로 열어 확인)
