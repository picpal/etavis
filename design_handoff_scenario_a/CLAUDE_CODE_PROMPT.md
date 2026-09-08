# Claude Code에 붙여넣을 프롬프트

아래 블록 전체를 복사해 `duler` 폴더에서 Claude Code에 붙여넣으세요. (핸드오프 폴더를 `duler/` 안에 먼저 복사해 두세요.)

---

이 폴더에 **들러(Duler)** iOS 앱의 시나리오 A 화면들을 Expo로 구현해줘. 백엔드는 없고, 목 데이터로 화면과 상호작용만 완성하는 것이 목표야.

**먼저 읽을 것 (순서대로)**
1. `design_handoff_scenario_a/README.md` — 화면별 스펙, 디자인 토큰, 상태 모델. 이게 기준 문서다.
2. `design_handoff_scenario_a/design-reference/Duler iOS Gallery v2.dc.html` — 디자인 원본. 브라우저로 열어 A1~A9 프레임을 확인하고, **색·간격·폰트 크기는 이 파일의 인라인 스타일 값을 그대로 가져와라.** README와 다르면 HTML을 따른다.
3. `design_handoff_scenario_a/tokens.ts`, `mockData.ts` — 그대로 `src/theme/`, `src/data/` 로 옮겨 사용.

**제약**
- Expo SDK 최신 + TypeScript, **iOS만**, Expo Go로 실행 가능해야 한다 (`npx expo start` → i).
- 스타일링은 NativeWind v4를 쓰되, Expo Go 호환에 문제가 있으면 `StyleSheet` + `tokens.ts` 상수로 가라. 판단은 네가 하고 이유를 README에 한 줄 남겨라.
- 지도는 `react-native-maps` + `provider={PROVIDER_DEFAULT}` (Apple Maps, 키 불필요). A6의 132px 프리뷰에 실제 경유지 좌표 폴리라인을 그린다. 제스처는 비활성.
- 경유지 재정렬은 `react-native-draggable-flatlist`.
- 폰트는 Pretendard를 `expo-font`로 번들 (400/500/600/700). 파일은 네가 받아서 `assets/fonts/`에 넣어라.
- 네트워크 호출 금지. 모든 지연은 `setTimeout`.

**구현 범위 (9개 화면)**
A1 홈 · A2 자연어 입력+조건 · A3 계산 중 · A5 경로 3안 · A6 타임라인(핵심) · A4 후보 비교 시트 · A9 할 일 체크리스트 시트 · A7 외부 지도 앱 시트 · A8 오류·재시도.
네비게이션은 `@react-navigation/native-stack`; A4·A7·A9는 커스텀 bottom sheet(reanimated + gesture-handler)로 디자인의 그랩바·딤·높이를 재현한다.

**실제로 동작해야 하는 것**
- A2 이동수단 세그먼트, 도착 시각 스테퍼 → 상태 반영
- A3 진행률 애니메이션 후 자동으로 A5
- A5 3안 중 선택 → A6에 반영
- A6 드래그 재정렬 → 0.6초 목 재계산 후 도착 시각·총시간·직행 대비 갱신 / 스와이프 삭제
- A6 `매장 교체` 칩 → A4, 후보 선택 시 타임라인 갱신
- A6 `할 일 1/3` 칩 → A9, 체크 토글 (**체크는 재계산을 유발하지 않는다**)
- A7 항목 탭 → `Linking.openURL` 딥링크 시도, 실패 시 A8 스타일 오류 처리
- 개발용 실패 토글로 A8 진입 가능
- CTA·드롭·체크에 `expo-haptics` light impact

**목 데이터**
`mockData.ts`의 3개 데이터셋(기본 / 순서 뒤바뀜 / 후보 부족)을 개발 메뉴에서 전환할 수 있게 해라. 경로 변형이 UI에서 어떻게 보이는지 확인하는 용도다.

**품질 기준**
- 픽셀 재현이 최우선. 임의의 라이브러리 기본 스타일(기본 그림자, 기본 라운드, 기본 폰트)을 남기지 마라.
- 탭 타깃 최소 44×44, 본문 12pt 이상.
- 계획 내부 화면(A2~A9)에는 탭바가 없다. 탭바는 A1에만.
- `README.md`에 실행 방법과 파일 구조를 정리하고, 스펙과 다르게 구현한 부분은 이유와 함께 남겨라.

작업 순서: 프로젝트 세팅 → 토큰/폰트 → 공통 컴포넌트(Card, SectionLabel, MicroLabelRow, PrimaryButton, NavHeader, BottomInputBar, Sheet) → A1 → A2 → A3 → A5 → A6 → 시트 3개 → A8. 각 단계마다 iOS 시뮬레이터에서 확인하고 진행해라.
