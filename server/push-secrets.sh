#!/usr/bin/env bash
#
# 워커 secret 동기화 — 저장소 루트 `.env` 의 값을 Cloudflare 워커(etavia)로 올린다.
#
# 왜 있나: 2026-09-17 에 워커 secret 이 APP_TOKEN 하나만 남고 전부 비어 있는 걸
# 발견했다. `/extract` 가 `Incorrect API key provided: undefined` 로 502 를 내고
# 앱은 조용히 로컬 목으로 떨어져 있었다 — 며칠간 아무도 몰랐다.
# 워커가 다시 갈아끼워지면 같은 일이 난다. 그때 이 파일이 복구 수단이다.
#
# 키는 화면에도 셸 히스토리에도 남지 않는다(파일 → 파이프).
#
#   bash server/push-secrets.sh            # 루트 .env 사용
#   bash server/push-secrets.sh path/to/.env
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-$HERE/../.env}"

[ -f "$ENV_FILE" ] || { echo "없음: $ENV_FILE"; exit 1; }
cd "$HERE" || exit 1

get() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

# 워커에 이미 올라가 있는 이름들. 건너뛴 키가 "기존 값 유지"인지 "기능 꺼짐"인지를
# 가르는 데 쓴다 — 워크트리의 오래된 .env 로 돌려서 절반만 올리는 사고를 막는다.
# 올리지 않는 것과 지우는 것은 다르다. 건너뛴 secret 은 워커에 그대로 남는다.
EXISTING="$(npx --no-install wrangler secret list --config wrangler.toml 2>/dev/null | grep -o '"name": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')"
has_remote() { printf '%s\n' "$EXISTING" | grep -qx "$1"; }

# $3 는 대체 출처. .env 에 전용 이름이 없을 때만 쓴다
put() {
  local local_name="$1" secret_name="$2" alt="${3:-}" val
  val="$(get "$local_name")"
  [ -z "$val" ] && [ -n "$alt" ] && val="$(get "$alt")"
  if [ -z "$val" ]; then
    if has_remote "$secret_name"; then
      printf '  건너뜀  %-20s  (.env 에 없음 — 워커의 기존 값 유지)\n' "$secret_name"
    else
      printf '  없음!   %-20s  (.env 에도 워커에도 없음 — 이 기능은 꺼집니다)\n' "$secret_name"
    fi
    return
  fi
  # --config 를 반드시 붙인다. 루트에 wrangler 설정이 생기면 그걸 집어
  # 엉뚱한 프로젝트를 이 워커 위에 덮어쓴다 — 2026-09 에 한 번 겪었다.
  if printf '%s' "$val" | npx --no-install wrangler secret put "$secret_name" --config wrangler.toml >/dev/null 2>&1; then
    printf '  설정됨  %-20s\n' "$secret_name"
  else
    printf '  실패    %-20s\n' "$secret_name"
  fi
}

echo "워커 etavia  ←  $ENV_FILE"
echo

put OPENAI_API_KEY      OPENAI_API_KEY
put APP_TOKEN           APP_TOKEN

# 2026-09-17 실측: GOOGLE_ROUTES_KEY 가 places:searchText 도 통과한다(같은 프로젝트에
# Places API (New) 가 켜져 있다). 다만 GOOGLE_PLACES_KEY 는 앱 번들에도 들어가므로
# (src/lib/places.ts:240) 언젠가 Places 전용 제한 키로 분리하는 편이 낫다.
put GOOGLE_PLACES_KEY   GOOGLE_PLACES_KEY   GOOGLE_ROUTES_KEY
put GOOGLE_ROUTES_KEY   GOOGLE_ROUTES_KEY

# 2026-09-17 실측: apis-navi.kakaomobility.com/v1/directions 는 developers.kakao.com
# REST 키를 그대로 받는다("길찾기 성공"). 제휴 계약이 필요한 건 대중교통 통합
# 길찾기 쪽이고, 이 앱이 쓰는 자동차 길찾기는 아니다.
put KAKAO_MOBILITY_KEY  KAKAO_MOBILITY_KEY  KAKAO_REST_KEY

put NCP_API_KEY_ID      NCP_API_KEY_ID
put NCP_API_KEY         NCP_API_KEY

echo
echo "현재 워커 secret:"
npx --no-install wrangler secret list --config wrangler.toml
