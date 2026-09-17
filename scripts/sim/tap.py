#!/usr/bin/env python3
"""시뮬레이터 탭 — 스크린샷 픽셀 좌표(1170x2532)를 받아 CGEvent로 클릭한다.

System Events 의 `click at` 은 AX 요소를 히트테스트하는데 시뮬레이터 화면은 자식 없는
AXGroup 하나라 -25204 로 죽는다. 그래서 CGEvent 를 직접 쏜다(ctypes, pyobjc 불필요).

디바이스 화면 원점·크기는 AX 로 매번 읽는다 — 창을 옮기면 좌표가 틀어지니까.
"""
import ctypes
import ctypes.util
import subprocess
import sys
import time

AS = ctypes.cdll.LoadLibrary(ctypes.util.find_library('ApplicationServices'))


class CGPoint(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]


AS.CGEventCreateMouseEvent.restype = ctypes.c_void_p
AS.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
AS.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
AS.CFRelease.argtypes = [ctypes.c_void_p]

MOVED, DOWN, UP = 5, 1, 2

# simctl io screenshot 이 내놓는 픽셀 크기 (iPhone 16e)
SHOT_W, SHOT_H = 1170, 2532
HID_TAP = 0


def _ax(what):
    out = subprocess.check_output([
        'osascript', '-e',
        f'tell application "System Events" to tell process "Simulator" to tell window 1 to '
        f'get {what} of (first UI element whose role is "AXGroup")',
    ], text=True)
    return [int(v.strip()) for v in out.strip().split(',')]


def screen_geom():
    """디바이스 화면(AXGroup)의 좌상단과 **크기** — 창을 옮기거나 줄여도 따라간다.

    크기까지 읽는 이유: 시뮬레이터 창은 배율을 줄일 수 있다. 예전엔 창이 100%(포인트=픽셀/3)
    라고 가정하고 `px / 3` 으로 찍었는데, 78% 로 줄여 둔 창에서 클릭이 300px 넘게 어긋나
    아무 데도 안 눌렸다. 에러가 안 나서 권한 문제로 오진하기 딱 좋다(2026-09-17 실제로 겪음).
    """
    ox, oy = _ax('position')
    w, h = _ax('size')
    return ox, oy, w, h


def post(kind, pt):
    ev = AS.CGEventCreateMouseEvent(None, kind, pt, 0)
    AS.CGEventPost(HID_TAP, ev)
    AS.CFRelease(ev)


def to_screen(px, py, geom):
    """스크린샷 픽셀 → 화면 좌표. 창 크기에 비례시킨다(배율을 가정하지 않는다)"""
    ox, oy, w, h = geom
    return CGPoint(ox + px * w / SHOT_W, oy + py * h / SHOT_H)


def tap(px, py, hold=0.06):
    # 활성화가 창을 옮긴다 — 좌표는 반드시 활성화 뒤에 읽는다.
    # 먼저 읽으면 클릭이 수십 px 씩 어긋나 엉뚱한 곳을 누른다
    subprocess.run(['open', '-a', 'Simulator'], check=False)
    time.sleep(0.5)
    pt = to_screen(px, py, screen_geom())
    post(MOVED, pt)
    time.sleep(0.05)
    post(DOWN, pt)
    time.sleep(hold)
    post(UP, pt)
    print(f'tap px({px},{py}) -> screen({pt.x:.0f},{pt.y:.0f})')


DRAGGED = 6


def drag(px1, py1, px2, py2, steps=24):
    """가장자리 스와이프 등 — 중간 이동 이벤트를 넣어야 제스처로 인식된다"""
    subprocess.run(['open', '-a', 'Simulator'], check=False)
    time.sleep(0.5)
    geom = screen_geom()
    p1, p2 = to_screen(px1, py1, geom), to_screen(px2, py2, geom)
    sx1, sy1, sx2, sy2 = p1.x, p1.y, p2.x, p2.y
    post(MOVED, CGPoint(sx1, sy1))
    time.sleep(0.05)
    post(DOWN, CGPoint(sx1, sy1))
    for i in range(1, steps + 1):
        t = i / steps
        post(DRAGGED, CGPoint(sx1 + (sx2 - sx1) * t, sy1 + (sy2 - sy1) * t))
        time.sleep(0.012)
    time.sleep(0.05)
    post(UP, CGPoint(sx2, sy2))
    print(f'drag px({px1},{py1})->({px2},{py2})')


if __name__ == '__main__':
    if sys.argv[1] == 'drag':
        drag(*(int(v) for v in sys.argv[2:6]))
    else:
        hold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.06
        tap(int(sys.argv[1]), int(sys.argv[2]), hold)
