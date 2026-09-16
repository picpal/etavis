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
| `eas submit` | 첫 회만 ❌ (Apple 로그인). 그때 ASC API 키가 EAS 에 저장되므로 **이후에는 `!` 안에서도 ✅** — 실측 §2 |

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

## 1. 매번 하는 것 — 태그 하나

```bash
npm run release -- 1.2.0
```

`scripts/release.mjs` 가 app.json 의 `version` 을 올리고, 커밋하고, 같은 이름의 태그
`v1.2.0` 을 밀어 `.github/workflows/testflight.yml` 을 깨운다. `--` 가 필요한 이유는
npm 이 뒤의 플래그를 자기 것으로 먹기 때문이다. `--dry-run` 을 붙이면 아무것도 밀지 않고
계획만 보여준다.

**main 에 커밋·머지하는 것만으로는 아무 일도 일어나지 않는다.** 태그가 유일한 트리거다.

| | |
|---|---|
| 트리거 | `v[0-9]+.[0-9]+.[0-9]+` 태그 푸시 |
| 게이트 A | 태그 ≠ `app.json` 의 `expo.version` 이면 빌드 전에 실패 |
| 게이트 B | `npm test` |
| 배포 | `eas build --platform ios --profile production --non-interactive --auto-submit` |
| 로그 | https://github.com/picpal/etavis/actions/workflows/testflight.yml |

게이트 두 개는 **공짜 GitHub 러너**에서 돈다. EAS 빌드 크레딧은 둘 다 통과한 뒤에만 나간다.

릴리즈 스크립트가 먼저 막는 것들: main 이 아닌 브랜치, 커밋되지 않은 변경, 이미 있는 태그,
뒤로 가는 버전. 규칙은 `scripts/release-version.mjs`·`scripts/release-preflight.mjs` 에
있고 테스트가 붙어 있다.

### 한 번만 — `EXPO_TOKEN`

CI 는 Apple 로그인 대신 Expo 토큰으로 인증한다.

1. https://expo.dev/settings/access-tokens → **Create token** (이름 아무거나)
2. GitHub 저장소 → Settings → Secrets and variables → Actions → **New repository secret**
3. 이름 `EXPO_TOKEN`, 값은 1번에서 받은 토큰

토큰은 만들 때 한 번만 보인다. ASC API 키는 이미 EAS 서버에 있으므로(§2) Apple 쪽
비밀은 GitHub 에 넣을 게 없다.

### 태그를 잘못 밀었다면

```bash
git push --delete origin v1.2.0
git tag -d v1.2.0
```

빌드가 이미 시작됐으면 expo.dev 에서 취소한다. app.json 을 되돌리는 커밋은 따로 해야 한다.

### 손으로 돌릴 때

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

### 테스터 — 손으로 만들 게 없다

**EAS 가 내부 그룹까지 만들어 둔다.** 첫 제출이 끝난 뒤 들어가 보면 이미 이렇다:

| | |
|---|---|
| 그룹 | `Team (Expo)` (내부 그룹) |
| 테스터 | `official.picpal@gmail.com` — 상태 `초대됨` |
| 빌드 | `1.0.0 (2)` — 상태 `테스트 중` |
| 빌드 배포 | `자동 - Xcode 빌드` |

그래서 **다음 빌드부터는 아무것도 안 해도 이 그룹에 자동으로 붙는다.**
`자동` 이라 EAS 가 올린 빌드도 그대로 잡힌다(실측).

찾아가는 경로가 헷갈린다 — 상단의 `TestFlight ⌄` 는 앱 단위 메뉴(배포·분석·TestFlight)고,
테스터·그룹은 그 아래 **`iOS 빌드 ⌄`** 를 눌러야 나온다.

`초대됨` 은 아직 수락 전이라는 뜻이다. 메일을 못 찾겠으면 테스터를 체크하고
**`다시 초대`** → `재전송`. **초대 메일은 `official.picpal@gmail.com` 로 간다** —
평소 쓰는 `pic.vamos@gmail.com` 이 아니다.

폰에서는 App Store 에서 **TestFlight** 앱을 깔고 메일의 링크(또는 리딤 코드)를 연다.

### 버전

`eas.json` 이 `appVersionSource: "remote"` + `autoIncrement: true` 라
**빌드 번호는 EAS 가 올린다.** `app.json` 에 `ios.buildNumber` 를 적지 말 것 —
remote 모드에서는 무시되고, 두 곳이 서로 다른 말을 하게 된다.
사용자에게 보이는 버전(`expo.version`)은 `npm run release` 가 태그와 함께 올린다.
실패한 빌드도 번호를 가져가므로 건너뛴 번호가 생기는 건 정상이다.

**같은 빌드를 두 번 submit 하면 거절된다** — 인증·업로드는 다 지나가고 마지막에 이렇게 죽는다:

```
Build number 3 for app version 1.0.0 has already been used.
App Store Connect requires unique build numbers within each app version.
```

재제출이 목적이면 `eas build` 를 다시 돌려 새 번호를 받아야 한다.

## 2. App Store Connect API 키 — 손으로 만들 게 없었다

등록되어 있으면 `eas submit` 이 Apple 비밀번호·2FA 를 묻지 않는다.

**그런데 `eas submit` 이 첫 실행 때 키를 스스로 만들어 EAS 에 올려둔다.**
"API 키를 만들까요?" 프롬프트에 Yes 하면 끝이고, 이름은 `[Expo] EAS Submit <난수>` 로 붙는다.
`.p8` 은 EAS 서버에 저장되므로 **받아서 보관할 파일도, `eas.json` 에 적을 경로도 없다.**

확인은 두 곳에서 된다:

| 어디 | 무엇이 보이나 |
|---|---|
| expo.dev → 프로젝트 → Credentials → 번들 ID → **Service credentials** | `App Store Connect API key` 행 (Key ID·Issuer ID·Roles) |
| App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API | 같은 키가 `활성화됨` 목록에 |

**ASC 웹 UI 쪽은 처음에 잠겨 있다.** 키 목록 대신 이렇게 나온다:

```
App Store Connect API에 액세스하려면 권한이 필요합니다.
조직을 대신하여 액세스를 요청할 수 있습니다.   [ 액세스 요청 ]
```

`액세스 요청` → 동의 체크 → `제출` 이면 즉시 열린다(개인 계정 기준, 실측).
**이건 웹에서 키를 보기 위한 것일 뿐**이다 — eas-cli 는 이 화면이 잠겨 있어도
Apple ID 세션으로 키를 만들어냈다. 열어보면 그 키가 이미 목록에 있다.

키를 손으로 만들고 싶다면(역할은 `App Manager` 면 충분하고, 생성 후 변경 불가):
`npx eas-cli credentials` → iOS → production → App Store Connect API Key → Upload.
이때 받는 `.p8` 은 **한 번만** 받을 수 있고 저장소 밖에 둔다(`.gitignore` 의 `*.p8`).

### `eas.json` 에서 `appleId` 는 뺀다

키가 EAS 에 있으면 `submit.production.ios` 는 `ascAppId` 하나면 된다.
`appleId` 를 남겨두면 Apple ID 인증 경로를 쓰는 것처럼 보여 헷갈리기만 한다.

```json
"submit": { "production": { "ios": { "ascAppId": "6812422135" } } }
```

**빼고 `!` 안에서 `--non-interactive` 로 돌려 확인했다**(2026-09-16). 로그 첫 줄:

```
Using App Store Connect API Key from EAS credentials service.
✔ App Store Connect API Key already set up.
Using Api Key ID: JT9LBRB7GA ([Expo] EAS Submit OPyxZBewOU)
    Key Source:  EAS servers
```

비밀번호도 2FA 도 묻지 않는다. 이제 `eas submit` 은 CI 에서도 그대로 돈다.

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
| 내부 그룹 | `Team (Expo)` · `a4de7bf1-4c5c-49c4-b8de-87915f80f866` |
| Apple 팀 | `sugeun kim (Individual)` · `6626BYCJG4` — 무료 시절과 **같은 팀**이 유료로 바뀐 것 |
| ASC API 키 | `[Expo] EAS Submit OPyxZBewOU` · Key `JT9LBRB7GA` · Issuer `f7fbe2e9-0d74-466b-b7aa-6e119f015cdf` (EAS 서버 보관) |
