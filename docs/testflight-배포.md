# TestFlight 배포

폰을 케이블로 연결해 7일마다 재설치하던 것을 없애는 게 목적이다.
TestFlight 빌드는 **90일** 유효하고, 테스터는 TestFlight 앱으로 직접 받는다.

빌드는 **EAS(클라우드)** 에서 돈다. 로컬 Xcode 빌드를 쓰지 않는 이유는 비용이 아니라
반복 작업이다 — `npx expo prebuild` 가 서명 팀과 entitlements 를 되돌리고,
`npm install` 이 Xcode 26 clang 패치를 지운다([[etavia-ios-build]]).
EAS 는 자기 이미지의 Xcode 로 빌드하므로 그 셋 다 건드릴 일이 없다.

> 2026-09-16 첫 배포를 이 문서대로 끝냈다. 아래 수치와 함정은 전부 그때 실측이다.

## 어디서 실행하나 — Claude Code 의 `!` 로는 안 된다

**Apple 로그인이 필요한 명령은 본인 터미널(Terminal.app·ghostty)에서 돌려야 한다.**
`!` 로 실행하면 stdin 이 TTY 가 아니라 eas-cli 가 비대화식으로 판단하고 멈춘다:

```
Distribution Certificate is not validated for non-interactive builds.
Credentials are not set up. Run this command again in interactive mode.
```

| 명령 | `!` 로 가능? |
|---|---|
| `eas whoami` · `env:*` · `config` · `build:list` | ✅ |
| `eas login` | ❌ 브라우저 콜백 대기 — 터미널에서 |
| `eas build` (첫 회) | ❌ Apple 로그인 프롬프트 |
| `eas submit` | ❌ Apple 로그인 프롬프트 (API 키를 등록하면 ✅) |

## 0. 한 번만 하는 것

### Apple Developer Program 가입

| 단계 | 내용 |
|---|---|
| Apple ID | **`official.picpal@gmail.com`**. 키체인의 `pic.vamos@gmail.com (X7762XSUDT)` 인증서는 **다른 계정**이라 쓰지 않는다 |
| 2FA | 미설정이면 가입이 막힌다 |
| Enroll | developer.apple.com/programs → **Individual**. 법인은 D-U-N-S 번호가 필요해 훨씬 오래 걸린다 |
| 결제 | $99/년 |

**결제 메일(영수증)이 와도 계정에는 늦게 반영된다.** 계정 페이지가 `(대기 중)` 과
"멤버십을 구입하시기 바랍니다" 배너를 그대로 들고 있는데, 같은 배너가 "처리에 최대
48시간" 이라고 말한다. Apple 이 수납과 승인을 따로 처리하는 것이다 —
**`지금 구입을 완료` 링크를 다시 누르면 중복 결제 위험.**

**App ID 와 앱 레코드는 손으로 안 만들어도 된다.** EAS 가 빌드·제출 중에 만든다.
(2026-09-16 실측: `com.etavia.app` 등록도, App Store Connect 앱 생성도 자동이었다.)

### EAS 프로젝트 연결

```bash
npx eas-cli login                                        # 터미널에서
npx eas-cli init --account official.picpal --non-interactive
```

`--account` 를 주면 `@<account>/<app.json 의 slug>` 로 만든다. 지금은
`@official.picpal/etavia`.

**`eas init` 은 에러를 뱉지만 쓰기는 성공한다** — `Cannot read properties of
undefined (reading 'projectId')` 는 쓴 값을 되읽는 단계에서 나는 것이고,
`app.json` 의 `extra.eas.projectId` 는 이미 들어가 있다. 무시하고 넘어가면 된다.

다만 **`app.config.js` 가 만들어내는 값까지 해석된 채로 `app.json` 에 되써 넣는다**
(`serverUrl`·`appToken` 이 빈 문자열로 추가된다). 그 둘은 `app.config.js` 가 매번
`process.env` 로 덮으므로, 남겨두면 설정이 두 곳에 있는 것처럼 보인다. **지운다.**

### 키를 EAS 환경에 넣기

**`--visibility sensitive` 를 써야 한다. `secret` 이면 안 된다.**
`secret` 은 EAS 서버 밖으로 안 나가는데, `app.config.js` 는 빌드 앞단의
**config 해석 단계**에서 평가된다. 그 단계에서 읽히는 건 `plaintext` 와
`sensitive` 뿐이라, `secret` 으로 넣으면 `extra` 가 **빈 값으로 굳고 목 앱이
빌드된다** — 대회 판정 때 나온 "`.env` 가 없어 빌드하면 목 앱이 나온다"와 같은 사고다.

앱이 실제로 읽는 건 **3개뿐**이다(`app.config.js` 는 4개를 주입하지만
`googlePlacesKey` 를 읽는 코드가 없다. Google 쪽은 서버의 `GOOGLE_ROUTES_KEY` 로
옮겨갔다):

```bash
npx eas-cli env:set --name KAKAO_REST_KEY --environment production --visibility sensitive
npx eas-cli env:set --name SERVER_URL     --environment production --visibility sensitive
npx eas-cli env:set --name APP_TOKEN      --environment production --visibility sensitive
```

`--value` 를 빼면 값을 대화식으로 묻는다 — 셸 히스토리에 키가 남지 않는다.
값은 로컬 `.env` 와 같아야 한다. 넣은 뒤 확인:

```bash
npx eas-cli env:list --environment production
```

**제대로 들어갔는지는 빌드 로그가 말해준다.** 첫 줄 근처에 이렇게 나와야 한다:

```
Environment variables with visibility "Plain text" and "Sensitive" loaded from
the "production" environment on EAS: APP_TOKEN, KAKAO_REST_KEY, SERVER_URL.
```

여기 안 나오면 `secret` 으로 들어간 것이다 — 그대로 두면 목 앱이 나온다.

`sensitive` 는 빌드 로그에서 가려지지만 웹 대시보드에서는 토글로 보인다.
어차피 이 키들은 **앱 번들에 인라인되어 추출 가능**하다(`app.config.js` 주석).
진짜로 숨겨야 하는 키는 앱이 아니라 `server/` 뒤에 둬야 한다.

## 1. 매번 하는 것

```bash
npx eas-cli build  --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```

첫 빌드는 서명 인증서·프로파일이 없어 Apple 로그인을 묻는다. 답:

| 프롬프트 | 답 |
|---|---|
| Apple 계정 로그인 | Yes → `official.picpal@gmail.com` → 비밀번호 → 2FA |
| Distribution Certificate 생성 | Yes |
| Provisioning Profile 생성 | Yes |
| Push Notifications 설정 | **No** — 앱은 로컬 알림만 쓴다 |

### 걸리는 시간 (2026-09-16 실측)

| 단계 | 첫 회 | 이후 |
|---|---|---|
| 클라우드 빌드 | **5분 15초** | 비슷 |
| EAS submitter 대기 + 업로드 | 수 분 | 비슷 |
| App Store Connect 처리 | **10~60분** (앱 레코드를 처음 만들며 추가 검증) | 5~15분 |

처리가 끝나면 메일이 오고 TestFlight 탭에 뜬다.
**내부 테스터(최대 100명)는 Beta App Review 없이 바로** 받는다.
외부 테스터(최대 10,000명)는 Beta App Review 를 거친다.

### 버전

`eas.json` 이 `appVersionSource: "remote"` + `autoIncrement: true` 라
**빌드 번호는 EAS 가 올린다.** `app.json` 에 `ios.buildNumber` 를 적지 말 것 —
remote 모드에서는 무시되고, 두 곳이 서로 다른 말을 하게 된다.
사용자에게 보이는 버전(`expo.version`)만 손으로 올린다.
실패한 빌드도 번호를 가져가므로 건너뛴 번호가 생기는 건 정상이다.

## 2. 아직 안 한 것 — App Store Connect API 키

등록하면 `eas submit` 에서 **Apple 로그인(비밀번호+2FA)이 사라져** 완전 무인이 된다.

**그런데 이 계정은 API 섹션이 잠겨 있다.** 사용자 및 액세스 → 통합 →
App Store Connect API 로 가면 키 목록 대신 이렇게 나온다:

```
App Store Connect API에 액세스하려면 권한이 필요합니다.
조직을 대신하여 액세스를 요청할 수 있습니다.   [ 액세스 요청 ]
```

먼저 **`액세스 요청`** 을 눌러야 키를 만들 수 있다. 개인 계정은 본인이 Account
Holder 라 보통 즉시 활성화된다. 그 뒤:

1. 키 생성 (역할 `App Manager` 면 충분하다. `Admin` 도 되지만 권한이 넓다.
   역할은 생성 후 변경 불가 — 좁히려면 폐기하고 다시 만든다)
2. **`.p8` 다운로드 — 한 번만 받을 수 있다.** `Issuer ID`·`Key ID` 도 같이 적어둔다
3. `npx eas-cli credentials` → iOS → production → App Store Connect API Key → Upload

`.p8` 은 저장소 밖에 둔다. `.gitignore` 의 `*.p8` 이 막아주긴 한다.

## 알아둘 것

- **푸시 권한은 이제 문제가 아니다.** 무료 팀에서 프로비저닝을 깨뜨리던
  `aps-environment` 는 유료 계정에서 정상 지원되고, EAS 가 App ID 의 capability 를
  맞춰준다. `Etavia.entitlements` 를 빈 `<dict/>` 로 덮어쓰던 작업은 EAS 빌드에는
  필요 없다(로컬 Xcode 빌드를 다시 할 때만 해당).
- **`ios/` 는 gitignore 대상**이라 EAS 가 매번 prebuild 한다. 로컬 `ios/` 를
  고쳐도 클라우드 빌드에는 반영되지 않는다 — 네이티브 설정은 `app.json` 에 적어야 한다.
- **아이콘**은 `assets/icon.png` 1024×1024·알파 없음으로 조건을 이미 만족한다.
  알파 채널이 있으면 업로드가 거부된다.
- `Detected that your app uses Expo Go for development` 경고는 무시해도 된다.
  `expo-dev-client` 가 의존성에 없어서 뜨는 안내이고 빌드에 영향이 없다.
- **무료 Expo 플랜은 빌드 큐 대기가 있다.** 급하면 유료($19/월)로 우선순위를 산다.

## 지금 값

| | |
|---|---|
| EAS 프로젝트 | `@official.picpal/etavia` · `b138be35-f2e8-4186-ae54-cfb5f907f8eb` |
| 번들 ID | `com.etavia.app` |
| `ascAppId` | `6812422135` (`eas.json` 에 기록됨) |
| TestFlight | https://appstoreconnect.apple.com/apps/6812422135/testflight/ios |
