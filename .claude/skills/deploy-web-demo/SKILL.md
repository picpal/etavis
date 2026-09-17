---
name: deploy-web-demo
description: 해커톤 웹 데모(etavia-demo.picpal.workers.dev)를 앱 소스에서 다시 빌드해 배포한다. 앱을 고친 뒤 그 변경을 공개 데모에 반영할 때, 또는 데모가 깨졌는지 확인할 때 쓴다.
---

# 웹 데모 배포

앱과 웹 데모는 **소스가 하나**다. `expo export --platform web` 이 같은 `src/` 를
`react-native-web` 으로 두 번째 타깃에 내보낸다. 그래서 앱을 고치면 웹에도 반영되지만
**자동이 아니다** — 이 절차를 밟아야 한다.

- 공개 URL: `https://etavia-demo.picpal.workers.dev` (정적 자산 Worker `etavia-demo`)
- API 서버: `https://etavia.picpal.workers.dev` (Worker `etavia`, 앱과 공유)
- 배경: `docs/superpowers/specs/2026-09-17-웹-데모-design.md` (부록 2 = 네이티브에 미친 영향)

## 시작 전에 — 지금 배포해도 되나

**심사 기간 2026-09-21 ~ 10-17 에는 링크가 죽으면 심사 대상에서 제외된다.**
그 기간에 배포를 요청받으면 먼저 사용자에게 확인한다: 꼭 지금 올려야 하는 변경인가,
아니면 심사 끝나고 올려도 되는가. 확인 없이 배포하지 않는다.

## 0. 어디서 도는지 확인

```bash
pwd                      # 웹 데모 코드가 있는 체크아웃이어야 한다
git rev-parse --abbrev-ref HEAD
ls src/webFrame.css src/lib/placesFallback.ts server/src/places.ts
```

세 파일이 다 있어야 한다. 하나라도 없으면 웹 데모 코드가 없는 체크아웃/브랜치다 —
거기서 배포하면 데모가 예전 버전으로 되돌아간다. **멈추고 사용자에게 알린다.**

`.env` 도 있어야 한다. 없으면 빌드가 `serverUrl` 을 빈 값으로 굽고 데모가 전부
목으로 돈다:

```bash
grep -cE '^(SERVER_URL|APP_TOKEN)=' .env    # 2 여야 한다
grep -E '^(KAKAO_REST_KEY|GOOGLE_PLACES_KEY)=' .env   # 값이 있으면 안 된다(빈 값이어야)
```

## 1. 웹 shim export 대조 — 조용히 깨지는 자리

아래 다섯 모듈에 export 를 **추가**했는데 `.web.ts` 에 안 넣으면 웹에서 런타임
`undefined` 가 된다. 확장자 없는 import 라 **`tsc` 가 못 잡는다**(`.ts` 계약만 본다).

```bash
for m in src/notifications src/lib/trackLog src/lib/prefs src/lib/currentPlace src/lib/backgroundLocation; do
  printf '%-34s ' "$m"
  diff <(grep -oE 'export (async function|function|const) [A-Za-z_]+' $m.ts     | awk '{print $NF}' | sort) \
       <(grep -oE 'export (async function|function|const) [A-Za-z_]+' $m.web.ts | awk '{print $NF}' | sort) \
    >/dev/null && echo OK || echo '차이 있음 ← .web.ts 를 맞춰라'
done
```

**목록에 없는 모듈이 새로 네이티브 API 를 물었는지도 본다.** 위 다섯은 이미 shim 이
있는 것들이고, 앱에 새 모듈이 들어오면 목록 밖이라 대조로는 안 잡힌다. 2026-09-17 에
메인의 `placesStore.ts`(내 장소·최근 목적지)가 `expo-file-system` 을 물고 들어와,
빌드는 통과하는데 런타임에 `expo-file-system is not supported on web` 이 뜨고
저장이 매번 빈 상태로 시작했다.

기준선은 **마지막으로 배포한 커밋**이다. 5번이 성공할 때마다 `web-demo-deployed`
태그를 그 자리로 옮기므로, 그 뒤로 바뀐 파일만 보면 된다. 태그가 아직 없으면
기준선이 없으니 `src/` 전체를 훑는다 — 시끄럽지만 놓치지 않는다.

```bash
{ BASE=$(git rev-parse -q --verify web-demo-deployed)
  if [ -n "$BASE" ]; then
    echo "기준선: $BASE ($(git log -1 --format=%cd --date=short "$BASE") 배포분)" >&2
    git diff --name-only "$BASE"..HEAD -- 'src/**'
  else
    echo '기준선 없음 — src/ 전체를 훑는다' >&2
    git ls-files 'src/**'
  fi
} | while IFS= read -r f; do
  case "$f" in *.web.ts|*.web.tsx) continue;; esac
  [ -f "$f" ] || continue
  grep -q "from 'expo-" "$f" || continue
  [ -f "${f%.ts}.web.ts" ] || [ -f "${f%.tsx}.web.tsx" ] || echo "shim 없음: $f"
done
```

**이미 알고 있는 5개는 무시한다** — 전부 웹에서 도는 게 확인된 것들이다.
그 밖의 이름이 나오면 그게 새로 들어온 모듈이다.

| 파일 | 무는 것 | 왜 괜찮나 |
|---|---|---|
| `src/components/common.tsx`·`src/screens/TimelineScreen.tsx` | `expo-haptics` | 웹에서 무동작, 안 죽는다 |
| `src/lib/places.ts`·`src/state/planFlowProvider.tsx` | `expo-constants` | 웹 지원. `serverUrl` 을 읽는 통로다 |
| `src/state/tracker.tsx` | `expo-location` | 파일 안에 `Platform.OS === 'web'` 분기가 있다 |

> 두 가지를 고친 자리다. (1) 기준선이 `git merge-base main HEAD` 였다 — **main 을 이
> 브랜치에 병합할 때마다 merge-base 가 main 끝으로 올라가서, 정작 main 에서 들어온
> 모듈이 범위 밖으로 빠진다.** 이 스캔이 잡으라고 만든 바로 그 경우다(`placesStore.ts`).
> (2) 루프가 `for f in $(...)` 였다 — **zsh 는 `$(...)` 를 단어로 쪼개지 않으므로**
> 이 머신의 기본 셸에서는 파일 하나짜리 통짜 문자열이 되어 늘 0건이었다. 둘 다
> 증상이 같다: 조용히 통과한 것처럼 보인다.

`shim 없음` 이 나오면 그 모듈이 웹에서 어떻게 되는지 확인한다. 죽지 않고 빈 값으로
degrade 하더라도, 저장·위치처럼 사용자가 결과를 보는 기능이면 `.web.ts` 를 만든다 —
로직은 옮기지 말고 **읽고 쓰는 자리만** 바꾼다(`prefs.web.ts`·`placesStore.web.ts` 참고).

## 2. 타입·테스트

```bash
npx tsc --noEmit && npm test 2>&1 | grep -E '^. (pass|fail) '
```

`fail 0` 이 아니면 멈춘다.

## 3. 빌드 — `--clear` 필수

```bash
rm -rf dist
npx expo export --platform web --output-dir dist --clear
```

**`--clear` 를 빼면 안 된다.** 이 머신의 전역 Metro 캐시(`$TMPDIR/metro-cache`)가
낡은 매니페스트를 재사용해서, `serverUrl`·`appToken` 이 빈 번들이 배포된 사고가 있었다.
화면은 멀쩡해 보이고 **모든 기능이 조용히 목으로 돈다** — 폴백이 그러라고 있는 층이라
눈으로는 구분이 안 된다.

## 4. 번들 검사 — 배포 전에

```bash
J=$(ls dist/_expo/static/js/web/*.js)
echo "== 0 이어야 하는 것 =="
for p in kakaoRestKey googlePlacesKey 'X-Goog-Api-Key' 'dapi\.kakao\.com'; do printf '%-20s ' "$p"; grep -c "$p" "$J" || true; done
echo "== 있어야 하는 것 =="
grep -oE 'serverUrl\\":\\"[^\\]*\\"' "$J" | head -1      # 비어 있으면 3번을 다시
grep -c 'ucc28.ub2e8.uae30' "$J"                          # 회로차단기, 1 이상
```

`kakaoRestKey`/`googlePlacesKey` 가 0 이 아니면 **배포하지 마라.** 공급자 키가 공개
번들에 실린다는 뜻이다. 키는 Workers 시크릿에만 둔다.

> 예전에 쓰던 `KakaoAK`/`dapi.kakao.com` grep 만으로는 부족하다. 키가 `extra` 의 JSON
> 필드에 문자열로 실리면 두 패턴 다 매치되지 않는다 — **필드 이름 자체가 0 인지**를 본다.

## 5. 배포

```bash
npx wrangler deploy --name etavia-demo --assets=./dist --latest
```

서버(`etavia`)는 건드리지 않는다. 서버 코드(`server/`)를 고쳤을 때만, 그리고 그때는
**반드시 `--config` 를 명시한다**:

```bash
cd server && npx wrangler deploy --config wrangler.toml && cd ..
```

**7번 검증까지 통과하면 기준선을 옮긴다.** 1번의 shim 스캔이 이 태그를 기준으로
"지난 배포 이후 바뀐 파일"을 고른다 — 안 옮기면 다음 배포가 같은 구간을 다시 훑는다.
로컬 태그이므로 push 하지 않는다.

```bash
git tag -f web-demo-deployed HEAD && git log -1 --format='기준선 → %h %s' web-demo-deployed
```

## 6. 배포 직후 — 루트 오염 확인

`wrangler pages deploy` 계열이 레포 루트에 `wrangler.jsonc` 를 만들고 `package.json` 에
`"deploy"` 스크립트를 끼워 넣은 적이 있다. 그 `wrangler.jsonc` 의 `name` 이 API 워커와
같은 `etavia` 여서, 뒤이은 `wrangler deploy` 가 **API 워커를 정적 웹 데모로 덮어썼다.**

```bash
ls wrangler.* 2>/dev/null && echo '!! 루트 오염 — 지워라' || echo '루트 깨끗'
grep -n '"deploy"' package.json && echo '!! package.json 오염 — 되돌려라' || echo 'package.json 깨끗'
git status --short
```

## 7. 검증 — 화면이 아니라 응답으로

```bash
D=https://etavia-demo.picpal.workers.dev
W=$(grep -E '^SERVER_URL=' .env | cut -d= -f2- | tr -d '"'"'"' ')
T=$(grep -E '^APP_TOKEN=' .env | cut -d= -f2- | tr -d '"'"'"' ')

curl -s -o /dev/null -w "데모      %{http_code} %{content_type}\n" "$D/"
curl -s -o /dev/null -w "API 상태  %{http_code}\n" "$W/health"
curl -s "$W/" | head -c 40; echo '   ← JSON 에러여야 한다. 정적 HTML 이면 API 를 덮어쓴 것'

for p in route places extract; do
  printf '/%-8s ' "$p"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$W/$p" \
    -H 'content-type: application/json' -H "x-app-token: $T" -H "x-device-id: skill-check" \
    -H "Origin: $D" -d '{}'
done
```

기대: `/route`·`/places`·`/extract` 가 **400/422**(스키마 거부 = 라우트 살아 있음).
**404 면 그 라우트가 사라진 것** — 예전 코드가 배포됐다는 뜻이니 소스에서 다시 배포한다.
**401 이면 토큰이 안 실린 것**, **501 이면 해당 공급자 키가 서버에 없는 것**이다.

CORS 도 본다 — 허용 오리진은 헤더가 붙고, 아무 오리진은 0 이어야 한다:

```bash
curl -s -o /dev/null -D - -X OPTIONS "$W/route" -H "Origin: $D" -H 'Access-Control-Request-Method: POST' | grep -ci 'access-control'
curl -s -o /dev/null -D - -X OPTIONS "$W/route" -H 'Origin: https://evil.test' -H 'Access-Control-Request-Method: POST' | grep -ci 'access-control'
```

## 8. 화면 확인

브라우저로 `https://etavia-demo.picpal.workers.dev` 를 열고 **A1 → 목적지 검색 →
계획 만들기 → A5 판정** 까지 한 번 밟는다. 볼 것:

- 데스크톱에서 폰 프레임·다이나믹 아일랜드·하단 탭바가 나오는가
- 위치 권한을 거부해도 출발지가 `데모 출발지 · 여의나루역` 으로 채워지는가
- 검색 결과 하단에 `지금은 예시 장소 데이터로 보여드리고 있어요` 가 **뜨지 않는가**
  (뜨면 `/places` 가 실패해 목 카탈로그로 내려간 것 — 7번의 `/places` 를 다시 본다)
- A5 에 `N분 여유/늦어요` 판정이 뜨는가. `소요시간은 추정이에요 · 서버 연결 전` 배너가
  보이면 `/route` 가 실패해 추정으로 내려간 것이다
- 콘솔 에러 0

## 문제가 생기면

| 증상 | 원인과 조치 |
|---|---|
| 데모가 흰 화면 | 배포 직후 전파 지연일 수 있다. 캐시 무시하고 새로고침. 그래도면 `index.html` 이 참조하는 JS 해시가 실제로 서빙되는지 확인 |
| 모든 기능이 목 | 번들의 `serverUrl` 이 비었다 → 3번을 `--clear` 로 다시 |
| `/places` 404 | **그 라우트가 없는 코드로 서버가 배포된 것이다.** 서버 워커(`etavia`)는 앱과 데모가 공유하므로 어느 체크아웃에서든 배포되고, 배포한 쪽에 없는 라우트는 그때마다 사라진다. `/places` 자체는 2026-09-17 에 `main` 에 병합돼 지금은 양쪽에 다 있다 — 그래서 이 증상이 또 나오면 원인은 그때와 다르다. **`server/` 를 `picpal/web-demo` 에서만 고친 경우**다. 고치는 법: 라우트가 있는 체크아웃에서 `cd server && npx wrangler deploy --config wrangler.toml`, 그리고 그 서버 변경을 main 에도 올린다. Cloudflare 대시보드의 "Add variable and deploy" 도 같은 증상을 낼 수 있으니 시크릿은 `wrangler secret put` 으로 넣고 넣은 뒤 7번으로 확인한다 |
| `/route` 는 되는데 `/places` 500 | 서버 로그를 본다: `cd server && npx wrangler tail --config wrangler.toml` |
| API 루트가 정적 HTML | API 워커가 웹 데모로 덮어써졌다 → 6번의 루트 오염을 지우고 `--config` 로 서버 재배포 |

## 하지 않는 것

- **비밀값을 파일에 쓰지 않는다.** `wrangler secret put` 으로만 넣고, 그 명령은
  사용자가 직접 실행한다. 대시보드로 넣었다면 **그 뒤에 소스에서 재배포**한다.
- **`server/` 변경을 이 브랜치에만 두지 않는다.** 데모 전용으로 남길 것은 `webFrame.css`·
  `.web.ts` shim 처럼 **웹 빌드에만 닿는 것**이다. 서버 워커는 앱과 공유라 메인
  체크아웃에서도 배포되고, 그때 여기에만 있는 라우트·가드는 사라진다.
- **CORS 를 와일드카드로 열지 않는다.** `server/wrangler.toml` 의 `ALLOWED_ORIGINS` 에
  production 오리진만 둔다.
- **`dist/` · `.env` · `node_modules` 를 커밋하지 않는다.** `git add -A` 를 쓰지 말고
  파일을 하나씩 명시한다.
- 포트를 점유한 프로세스를 확인 없이 죽이지 않는다. 8081 은 Metro 개발 서버의 기본
  포트다 — 죽이면 사용자의 앱 개발이 끊긴다.
