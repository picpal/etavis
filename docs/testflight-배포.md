# TestFlight 배포

폰을 케이블로 연결해 7일마다 재설치하던 것을 없애는 게 목적이다.
TestFlight 빌드는 **90일** 유효하고, 테스터는 TestFlight 앱으로 직접 받는다.

빌드는 **EAS(클라우드)** 에서 돈다. 로컬 Xcode 빌드를 쓰지 않는 이유는 비용이 아니라
반복 작업이다 — `npx expo prebuild` 가 서명 팀과 entitlements 를 되돌리고,
`npm install` 이 Xcode 26 clang 패치를 지운다([[etavia-ios-build]]).
EAS 는 자기 이미지의 Xcode 로 빌드하므로 그 둘을 건드릴 일이 없다.

## 0. 한 번만 하는 것

### Apple Developer Program 가입

| 단계 | 내용 |
|---|---|
| Apple ID | **`official.picpal@gmail.com`**. 키체인의 `pic.vamos@gmail.com (X7762XSUDT)` 인증서는 **다른 계정**이라 쓰지 않는다 |
| 2FA | 미설정이면 가입이 막힌다 |
| Enroll | developer.apple.com/programs → **Individual**. 법인(Organization)은 D-U-N-S 번호가 필요해 훨씬 오래 걸린다 |
| 결제 | $99/년. 개인 승인 보통 24~48시간 |
| App ID | Certificates, Identifiers & Profiles → Identifiers → `com.etavia.app` |
| 앱 레코드 | App Store Connect → 새 앱(이름·기본 언어·SKU). 여기서 나오는 **Apple ID 숫자**가 `ascAppId` 다 |

가입이 끝나면 **무료 Personal Team `6626BYCJG4` 는 더 쓰지 않는다.** 새 Team ID 를
`eas.json` 의 `submit.production.ios.appleTeamId` 에 적어두면 매번 묻지 않는다.

가입 전까지 EAS 빌드는 **credentials 단계에서 막힌다.** 순서가 뒤바뀌지 않게 할 것.

### EAS 프로젝트 연결

```bash
npx eas-cli login          # Expo 계정 (Apple ID 와 무관)
npx eas-cli init           # extra.eas.projectId 를 만든다
```

`app.config.js`(동적 config)가 있어 `eas init` 이 값을 못 쓸 수 있다. 그러면
`app.json` 의 `expo.extra` 에 직접 넣는다 — `app.config.js` 가
`...appJson.expo.extra` 로 펼치므로 그대로 흘러간다.

### 키를 EAS 환경에 넣기

**`--visibility sensitive` 를 써야 한다. `secret` 이면 안 된다.**
`secret` 은 EAS 서버 밖으로 안 나가는데, `app.config.js` 는 빌드 앞단의
**config 해석 단계**에서 평가된다. 그 단계에서 읽히는 건 `plaintext` 와
`sensitive` 뿐이라, `secret` 으로 넣으면 `extra` 가 **빈 값으로 굳고 목 앱이
빌드된다** — 대회 판정 때 나온 "`.env` 가 없어 빌드하면 목 앱이 나온다"와 같은 사고다.

```bash
npx eas-cli env:set --name KAKAO_REST_KEY    --environment production --visibility sensitive
npx eas-cli env:set --name GOOGLE_PLACES_KEY --environment production --visibility sensitive
npx eas-cli env:set --name SERVER_URL        --environment production --visibility sensitive
npx eas-cli env:set --name APP_TOKEN         --environment production --visibility sensitive
```

`--value` 를 빼면 값을 대화식으로 묻는다 — 셸 히스토리에 키가 남지 않는다.
값은 로컬 `.env` 와 같아야 한다. 넣은 뒤 확인:

```bash
npx eas-cli env:list --environment production
```

`sensitive` 는 빌드 로그에서 가려지지만 웹 대시보드에서는 토글로 보인다.
어차피 이 키들은 **앱 번들에 인라인되어 추출 가능**하다(`app.config.js` 주석).
진짜로 숨겨야 하는 키는 앱이 아니라 `server/` 뒤에 둬야 한다.

## 1. 매번 하는 것

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```

첫 `submit` 은 `ascAppId`·`appleTeamId` 를 묻는다. 답한 값을 `eas.json` 에
적어두면 다음부터 안 묻는다.

업로드 후 App Store Connect 가 빌드를 처리하는 데 10~30분. 처리가 끝나면
**내부 테스터(최대 100명)는 Beta App Review 없이 바로** 받는다.
외부 테스터(최대 10,000명)는 Beta App Review 를 거친다.

### 버전

`eas.json` 이 `appVersionSource: "remote"` + `autoIncrement: true` 라
**빌드 번호는 EAS 가 올린다.** `app.json` 에 `ios.buildNumber` 를 적지 말 것 —
remote 모드에서는 무시되고, 두 곳이 서로 다른 말을 하게 된다.
사용자에게 보이는 버전(`expo.version`, 지금 `1.0.0`)만 손으로 올린다.

## 알아둘 것

- **푸시 권한은 이제 문제가 아니다.** 무료 팀에서 프로비저닝을 깨뜨리던
  `aps-environment` 는 유료 계정에서 정상 지원되고, EAS 가 App ID 의 capability 를
  맞춰준다. `Etavia.entitlements` 를 빈 `<dict/>` 로 덮어쓰던 작업은 EAS 빌드에는
  필요 없다(로컬 Xcode 빌드를 다시 할 때만 해당).
- **`ios/` 는 gitignore 대상**이라 EAS 가 매번 prebuild 한다. 로컬 `ios/` 를
  고쳐도 클라우드 빌드에는 반영되지 않는다 — 네이티브 설정은 `app.json` 에 적어야 한다.
- **아이콘**은 `assets/icon.png` 1024×1024·알파 없음으로 App Store Connect 조건을
  이미 만족한다. 알파 채널이 있으면 업로드가 거부된다.
- **무료 Expo 플랜은 빌드 큐 대기가 있다.** 급하면 유료($19/월)로 우선순위를 산다.
