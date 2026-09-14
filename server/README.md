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

---

## 공개 전 점검 — 과금 방어선

대회 심사 기간(2026-09-21 ~ 10-17) 동안 일반 사용자가 써보고 **투표**한다.
`APP_TOKEN`은 앱 번들에 인라인되고, 웹 데모라면 브라우저 네트워크 탭에 그대로 보인다.
**서버 밖에서 막을 수 있는 건 콘솔 할당량뿐이다.**

### 서버에 이미 걸린 것 (`src/guard.ts`)

| 층 | 내용 |
|---|---|
| 기기당 분당 | `/extract` 10 · `/route` 40 · `/enrich` 10 |
| IP당 분당 | 기기당의 3배. `x-device-id`를 갈아끼우는 우회를 막는다 |
| 전역 일일 | `/route:now` 8,000 · `/route:future` 4,000 · `/extract` 1,200 · `/enrich` 600 |
| `/route` 캐시 | 좌표 4자리 · 출발 10분 버킷 · TTL 300초 |

일일 상한에 닿으면 `429`. 앱은 서버 실패를 로컬 목으로 폴백하므로 화면은 살아 있고,
대신 추정값이 보인다. **상한값은 `src/guard.ts`의 `PER_DAY` 한 곳에 있다.**

KV는 read-modify-write가 원자적이지 않아 동시 요청에서 몇 건 샌다.
상한 방어는 정확할 필요가 없다 — 75,000/일이 8,000/일이 되는 게 요점이다.
정확한 카운터는 Durable Object로 옮길 때 얻는다(`docs/NEXT.md`).

### 콘솔에서 직접 걸어야 하는 것 — **서버 코드로는 못 막는다**

- [ ] **Google Cloud → Places API (New) → 할당량** 일일 상한을 건다.
      기본값이 **75,000/일**이다. 무료 체험판이면 "할당량 수정"이 비활성이라
      **유료 전환 직후**가 유일한 기회다. 그전까지 방어선은 `enrich.ts`의 월 900 카운터뿐이다.
- [ ] **카카오모빌리티 콘솔** 일 사용량 알림·상한.
      directions 일 10,000 무료 / future 5,000 무료, 초과 8원 (2026-09-11 요금표)
- [ ] **OpenAI 조직 → Limits** 월 예산 상한(hard limit)과 알림 임계값.
      무료분이 없어 문장당 과금이다.
- [ ] **네이버 API HUB** 유료 전환 공지가 떴는지 확인 (`docs/NEXT.md`)
- [ ] 키를 하나씩 **최소 권한으로** 재발급했는지 — 구글 키는 Places API (New) 하나로만 제한

### 배포 전 확인

```bash
cd server && npx wrangler secret list    # OPENAI_API_KEY 가 있는지
npx wrangler deploy
curl -s -o /dev/null -w '%{http_code}\n' -X POST $SERVER_URL/extract \
  -H 'content-type: application/json' -d '{"text":"t"}'   # 401 이어야 정상
```
