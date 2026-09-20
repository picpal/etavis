# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# 채팅 추출 — API 태우기 전에 시뮬레이션한다

채팅 → 경유지 추출(`src/lib/intent.ts`, `server/`)을 고칠 때는 반드시 케이스를 돌린다.

```bash
node server/run-cases.mjs                          # 150개 · 28개 범주 (목)
node server/run-cases.mjs --json > server/results.json && python3 server/make-xlsx.py
```

**LLM 실측은 codex로 한다** — 서버·API 키 없이 실제 모델 응답을 받을 수 있다.
`codex exec -m <model> "<prompt>" -s read-only --json`

## 검증 순서 — API는 마지막에 한 번

돈이 나가는 순서로 정렬한다. 앞 단계에서 답이 나오면 뒤로 가지 않는다.

| 단계 | 명령 | 비용 |
|---|---|---|
| 1. 목 기준선 | `node server/run-cases.mjs` | 0 |
| 2. 모델 시뮬레이션 | `node server/run-llm.mjs` (codex 구독제) | 0 |
| 3. **확신 검증** | `node server/run-server-cases.mjs` — 그룹당 1개 = 27개 | API 과금 |

3번은 **배선을 바꾼 뒤 살아 있는지 확인하는 용도**다. 모델 품질은 2번에서 재고,
3번을 `--all`로 돌리는 건 정말 필요할 때만. 채점은 세 단계가 `case-score.mjs`를
공유한다 — 자가 다르면 숫자를 나란히 놓는 의미가 없다.

## 지켜야 할 것

**기대값은 "제품이 어떻게 동작해야 하나"로 쓴다.** 지금 구현이 뭘 할 수 있는지로
쓰면 안 된다. `올리브용`의 기대값을 "못 잡으면 되묻기"로 적어둔 적이 있는데,
그건 목의 한계를 제품 사양으로 굳힌 것이었다. LLM은 올리브영으로 교정한다.

**목 기준 실패가 늘어나는 건 나쁜 신호가 아니다.** 기대값을 제품 기준으로
올리면 목은 더 많이 실패한다. 그게 목과 LLM의 격차를 정직하게 드러낸 것이다.

**러너의 '미검증'을 통과로 세지 말 것.** `note`만 있고 검증 조건이 없는 케이스는
자동 통과한다. 그걸 합격으로 세면 숫자가 부풀려진다.

**LLM은 '무엇을'만 뽑는다.** 소요시간·거리·도착 가능 여부를 만들게 하면 안 된다.
그건 라우팅 API와 코드의 몫이고, LLM이 지어내면 이 앱의 존재 이유가 무너진다.

**인젝션 방어선은 프롬프트가 아니라 `server/src/schema.ts`다.** 프롬프트 규칙은
1차선일 뿐이다. LLM이 무엇을 뱉든 스키마를 통과해야 앱에 닿는다.

## 파일

| 파일 | 역할 |
|---|---|
| `server/prompts/extract-intent.md` | 프롬프트 원본(v3). 코드 사본은 `server/src/prompt.ts` |
| `server/prompts/cases.jsonl` | 케이스. 새 케이스는 여기 한 줄 |
| `src/lib/intent.ts` | 로컬 목. 서버가 죽으면 앱이 여기로 fallback |
| `src/lib/intentClient.ts` | 서버 `/extract` 호출 + 폴백. 화면은 `source`만 본다 |
| `server/src/schema.ts` | LLM 응답 검증 |
| `server/src/guard.ts` | 과금 방어선(기기·IP·일일 상한). 상한값은 `PER_DAY` 한 곳 |
| `server/case-score.mjs` | 채점 규칙. 목·codex·서버 러너가 공유한다 |
| `server/run-server-cases.mjs` | 서버 실측 러너 (과금) |
| `server/push-secrets.sh` | `.env` → 워커 secret 동기화. 워커가 갈아끼워지면 여기서 복구한다 |
| `docs/채팅-추출-시뮬레이션.xlsx` | 케이스 시트는 스크립트가 만든다. **개선 이력만 손으로** |

# 시뮬레이터 — 세션마다 기기를 하나씩 띄운다

**남의 기기를 쓰지 않는다.** 사람이 Claude Desktop 에서 한 대를 보고 있는데 다른 세션이
같은 기기를 만지면 서로의 화면을 뒤엎는다. **서브 에이전트도 각자 하나씩 만들어 쓴다** —
디스패치할 때 그가 쓸 UDID 를 프롬프트에 적어 넘긴다. 놀고 있는 기기는
`xcrun simctl list devices available | grep iPhone` 에 여럿 있다.

```bash
xcrun simctl boot <UDID>
xcrun simctl install <UDID> "$(xcrun simctl get_app_container <이미쓰는UDID> com.etavia.app app)"
xcrun simctl location <UDID> set 37.5285,126.9245   # 기본값은 샌프란시스코다. 안 바꾸면
xcrun simctl launch <UDID> com.etavia.app           # 9,000km 경로를 요청해 /route 가 죽는다
```

Metro 는 나눌 필요 없다 — 코드가 같으면 여러 기기가 8081 하나를 같이 쓴다.

**조작은 `maestro --device <UDID>` 로 한다.** `scripts/sim/tap.py` 는 Apple `Simulator.app`
**창**에 마우스를 쏘는 방식이라 창이 없으면 죽고, `window 1` 을 두고 세션끼리 경합하고,
포커스가 전역이라 동시에 못 쓴다. maestro 는 창 없이 기기 안으로 이벤트를 넣는다.

- 선택자는 **정규식이고 전체 일치**다. RN 이 접근성 라벨을 묶어 내놓아서
  (`"최종 목적지, 최종 목적지를 입력하세요"`) 눈에 보이는 문구로는 못 잡는다.
  `.*…*.` 로 감싼다. 모르겠으면 `maestro --device <UDID> hierarchy`.
- 한글은 `inputText` 한 줄이면 된다. 클립보드 우회는 이제 필요 없다.
- `inputText` 전에 입력란을 `tapOn` 한다. 포커스가 없으면 **COMPLETED 를 찍고 아무 데도
  안 들어간다** — 조용히 실패하는 자리다.
- **이 앱은 상태를 영속하지 않는다. 앱을 재시작하면 확정한 계획이 사라지고**
  화면엔 목 데이터셋의 옛 계획이 대신 뜬다 — 검증한 줄 알기 딱 좋다(2026-09-19 에
  코엑스·스타벅스가 떴는데 여의도 계획인 줄 알고 한참 샜다). 그러니
  "확정한 뒤 대화로 고친다" 같은 시나리오는 **한 플로우 파일**에 담고, 중간에
  `simctl terminate`·`launch` 를 끼우지 않는다.
- **`maestro test` 는 앱을 새로 띄우지 않는다.** 직전 플로우가 남긴 화면에서 시작하므로,
  플로우 첫머리에서 탭을 눌러 원하는 화면으로 **수렴**시켜야 어디서 돌려도 같게 동작한다.
  단, 실행이 끝나면 앱이 백그라운드로 내려가 **홈 화면(스프링보드)이 남는다** —
  처음부터 가는 플로우는 첫 줄에 `launchApp` 을 둔다(`clearState` 는 주지 않는다,
  최근 목적지가 지워진다). 반대로 **확정한 상태를 이어받는 플로우엔 절대 넣지 않는다.**
- **경로 편집에 처음 들어가면 코치마크(`1/2 순서는 꾹 눌러서 바꿔요`)가 화면을 가린다.**
  `건너뛰기` 를 optional 로 먼저 눌러 치운다. 안 치우면 그 아래 버튼이 '못 찾음'이 된다.
- **첫 명령 앞에 `extendedWaitUntil` 을 건다.** maestro 는 실행마다 드라이버를 다시
  세우는데, 그 사이에 떨어진 첫 명령은 화면에 멀쩡히 보이는 요소도 '못 찾음'이 된다.
- 드라이버가 엉켜 `only one gesture can be performed at a time` 이 나오면
  `xcrun simctl uninstall <UDID> dev.mobile.maestro-driver-iosUITests.xctrunner` 로
  지우면 다음 실행이 새로 깐다. **`pkill -f maestro` 는 쓰지 않는다** — 다른 세션이
  다른 기기에서 돌리던 드라이버까지 죽인다(2026-09-19 에 그랬다).
- **`--device` 는 명령이 갈 기기를 고르지 못한다. 드라이버는 `127.0.0.1:7001`
  하나뿐이고, 먼저 잡은 놈이 전부 받는다.** 그래서 두 번째 세션의 명령은
  *조용히 남의 기기로 간다* — 실패가 아니라 **거짓말**이다. 2026-09-19 에 이걸
  모르고 9번을 날렸다. 화면에 멀쩡히 보이는 요소가 '못 찾음'이 되고, 엉뚱하게
  Safari 가 앞으로 나오고, `hierarchy` 조차 남의 화면을 찍어 줬다.

  ```bash
  lsof -nP -iTCP:7001 -sTCP:LISTEN          # 비어 있어야 내 기기로 간다
  ps -eo pid,ppid,command | grep '[m]aestro-driver-iosUITests-Runner'
  ```

  **돌리기 전에 7001 을 본다.** 남이 쓰는 중이면 기다린다. 물고 있는 게
  `ppid=1` 인 고아면(주인 maestro CLI 가 이미 끝난 찌꺼기) 그 기기에만
  `xcrun simctl terminate <그UDID> dev.mobile.maestro-driver-iosUITests.xctrunner`
  로 걷어낸다. `pkill -f maestro` 는 여전히 쓰지 않는다.

  **내 기기가 맞는지는 화면 크기로 가른다.** 실패 덤프
  (`~/.maestro/tests/<시각>/commands-*.json`)의 루트 `bounds` 가 기기다 —
  iPhone 17·17 Pro `[402,874]`, 16e `[390,844]`.
