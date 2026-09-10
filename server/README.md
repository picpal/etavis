# Etavia 서버

키를 가리고 LLM 응답을 검증해 넘기는 얇은 프록시. 그 이상은 하지 않는다.

- **경로 계산·시간 판정은 앱이 한다.** 여기서 하면 느려지고 배터리만 먹는다.
- **인젝션 방어선은 `src/schema.ts`다.** 프롬프트 규칙은 1차선일 뿐,
  LLM이 무엇을 뱉든 스키마를 통과해야 앱에 닿는다.
- **서버가 죽어도 앱은 돈다.** 앱은 실패하면 `src/lib/intent.ts`의 로컬 목으로 떨어진다.

## 준비

```bash
cd server && npm i
npx wrangler kv namespace create RATE   # id를 wrangler.toml에 붙여넣기
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN       # 앱과 같은 값
npx wrangler dev                        # 로컬
npx wrangler deploy
```

## 엔드포인트

`POST /extract` — 헤더 `x-app-token`, `x-device-id` 필요. 기기당 분당 10회.

```json
{ "text": "출근길에 올리브영 들르고 빵도", "context": { "currentStops": [] } }
```

응답은 `server/prompts/extract-intent.md`의 v3 스키마.

## 케이스 회귀

```bash
node ../server/run-cases.mjs      # 로컬 목 기준선 (147개)
```

OpenAI를 붙인 뒤 같은 147개를 서버로 돌려 이 기준선과 비교한다.

## 시뮬레이션 기록

```bash
node run-cases.mjs --json > results.json
python3 make-xlsx.py            # docs/채팅-추출-시뮬레이션.xlsx
```

케이스 결과는 스크립트가 만든다. 손으로 채우지 않는다.
**개선 이력 시트만 사람이 늘린다** — 실패를 고칠 때마다
무엇이/왜/어떻게를 한 줄. 같은 실수를 두 번 하지 않기 위한 것이다.
