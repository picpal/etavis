# 시뮬레이터 조작

화면을 직접 보며 디자인을 점검할 때 쓴다. `xcrun simctl` 은 스크린샷은 찍어주지만
**탭을 넣어주지 않는다** — 그래서 macOS 쪽에서 마우스 이벤트를 만들어 넣는다.

```bash
scripts/sim/shot.sh /tmp/a.png            # 캡처만
scripts/sim/shot.sh /tmp/a.png 584 817    # 한 번 탭하고 캡처
scripts/sim/shot.sh /tmp/a.png 584 817 500 1953   # 두 곳을 차례로 탭하고 캡처

python3 scripts/sim/tap.py 495 2175 1.2   # 롱프레스(1.2초) — 붙여넣기 콜아웃 등
python3 scripts/sim/tap.py drag 6 1200 900 1230   # 가장자리 스와이프
```

좌표는 `simctl io screenshot` 이 내놓는 **픽셀** 기준(iPhone 16e = 1170×2532).
스크린샷에서 읽은 좌표를 그대로 넣으면 된다. 다른 기기는 `SIM_UDID` 로 넘긴다.

## 준비

**손쉬운 사용 권한이 있어야 한다.** 시스템 설정 → 개인정보 보호 및 보안 →
손쉬운 사용에 터미널 앱을 넣는다. 없으면 좌표를 읽는 AppleScript 가 `-1719` 로 죽는다.

## 알아둘 것

- **탭이 조용히 안 먹으면 창 배율부터 본다.** 시뮬레이터 창을 줄여 놨으면 포인트=픽셀/3 이
  아니다. `tap.py` 는 이제 AXGroup 의 position 과 size 를 둘 다 읽어 비례시키지만, 직접
  좌표를 계산할 땐 같은 함정에 빠진다. 확인:
  ```
  osascript -e 'tell application "System Events" to tell process "Simulator" to tell window 1 to get size of (first UI element whose role is "AXGroup")'
  ```
  기기 포인트 크기(iPhone 16e = 390×844)와 다르면 창이 줄어 있는 것이다.
  **에러가 안 난다** — `tap.py` 는 좌표를 출력하고 exit 0 으로 끝나며 화면만 무반응이라,
  손쉬운 사용 권한 문제로 오진하기 딱 좋다(2026-09-17 실제로 그랬다). AX **읽기**가 되는데
  클릭만 안 먹으면 권한은 멀쩡한 것이다 — 배율을 의심한다.

- **`click at` 을 쓰지 않는다.** System Events 의 `click at` 은 AX 요소를 히트테스트하는데,
  시뮬레이터 화면은 자식 없는 `AXGroup` 하나라 `-25204` 로 죽는다. CGEvent 를 직접 쏜다
  (ctypes — pyobjc 설치 불필요).
- **원점은 활성화한 뒤에 읽는다.** `open -a Simulator` 가 창을 옮긴다. 먼저 읽으면
  클릭이 수십 px 씩 어긋나 엉뚱한 곳을 누른다. `tap.py` 가 이 순서를 지킨다.
- **한글은 붙여넣기로 넣는다.** `LANG=en_US.UTF-8` 를 준 뒤
  `pbcopy` → `xcrun simctl pbsync host <udid>` → 입력창 롱프레스 → 콜아웃의 `Paste` 를 탭.
  `Cmd+V` 와 Simulator 의 Edit▸Paste 메뉴는 앱 입력창까지 닿지 않는다.
- **레이아웃이 움직이면 좌표도 움직인다.** 예를 들어 A1 의 이동수단을 대중교통으로
  바꾸면 안내문이 카드를 밀어 아래 행들이 내려간다. 단계마다 캡처해서 확인한다.
- **HMR 이 상태를 날릴 수 있다.** Fast Refresh 가 풀 리로드로 떨어지면 화면이 홈으로
  돌아가고, 그 뒤 탭 시퀀스는 전부 엉뚱한 곳을 누른다.
  `xcrun simctl terminate/launch com.etavia.app` 로 다시 시작하고 처음부터 간다.
