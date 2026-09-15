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
| `docs/채팅-추출-시뮬레이션.xlsx` | 케이스 시트는 스크립트가 만든다. **개선 이력만 손으로** |
