#!/bin/bash
# 시뮬레이터를 순서대로 탭한 뒤 스크린샷을 찍는다.
#   shot.sh <out.png> [px py [px py ...]]
# 좌표는 `simctl io screenshot` 이 내놓는 픽셀 기준(iPhone 16e = 1170x2532).
# 디바이스가 다르면 SIM_UDID 로 넘긴다.
set -u
UDID=${SIM_UDID:-32E7E297-E515-478B-8EB4-62E8AF4B069E}
SP="$(cd "$(dirname "$0")" && pwd)"
OUT=$1
shift
while [ $# -ge 2 ]; do
  python3 "$SP/tap.py" "$1" "$2"
  shift 2
  sleep 1.2
done
sleep 0.8
xcrun simctl io "$UDID" screenshot --type=png "$OUT" >/dev/null
echo "shot -> $OUT"
