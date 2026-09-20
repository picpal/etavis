#!/usr/bin/env bash
#
# etavia-metrics 워커 secret 동기화 — 저장소 루트 `.env` 의 값을 워커로 올린다.
# server/push-secrets.sh 와 같은 방식이다: 값은 파일 → 파이프로만 흐르므로
# **화면에도 셸 히스토리에도 남지 않는다.**
#
#   bash metrics/push-secrets.sh            # 루트 .env 사용
#   bash metrics/push-secrets.sh path/.env
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$HERE/../.env}"

[ -f "$ENV_FILE" ] || { echo "없음: $ENV_FILE"; exit 1; }
cd "$HERE" || exit 1

get() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"; }

# 이미 워커에 올라가 있는 이름. 건너뛴 키가 "기존 값 유지"인지 "기능 꺼짐"인지 가른다
EXISTING="$(npx --no-install wrangler secret list --config wrangler.toml 2>/dev/null | grep -o '"name": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')"
has_remote() { printf '%s\n' "$EXISTING" | grep -qx "$1"; }

put() {
  local name="$1" val
  val="$(get "$name")"
  if [ -z "$val" ]; then
    if has_remote "$name"; then
      printf '  건너뜀  %-20s  (.env 에 없음 — 워커의 기존 값 유지)\n' "$name"
    else
      printf '  없음!   %-20s  (.env 에도 워커에도 없음 — 이 기능은 꺼집니다)\n' "$name"
    fi
    return
  fi
  # --config 를 반드시 붙인다. 루트에 wrangler 설정이 생기면 그걸 집어
  # 엉뚱한 프로젝트를 이 워커 위에 덮어쓴다 — 2026-09 에 한 번 겪었다
  if printf '%s' "$val" | npx --no-install wrangler secret put "$name" --config wrangler.toml >/dev/null 2>&1; then
    printf '  설정됨  %-20s\n' "$name"
  else
    printf '  실패    %-20s\n' "$name"
  fi
}

echo "워커 etavia-metrics  ←  $ENV_FILE"
echo

put APP_TOKEN          # 비콘 게이트. etavia 와 같은 값이어야 앱이 통과한다
put AE_API_TOKEN       # Analytics Engine SQL 조회 (Account Analytics: Read).
                       # CF_/CLOUDFLARE_ 접두사를 쓰면 wrangler 가 제 인증 토큰으로 집는다
put SLACK_WEBHOOK_URL  # 리포트 보낼 채널이 이 URL 에 박혀 있다

echo
echo "현재 워커 secret:"
npx --no-install wrangler secret list --config wrangler.toml
