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
HID_TAP = 0


def screen_origin():
    """디바이스 화면(AXGroup)의 좌상단 — 창을 옮겨도 따라간다"""
    out = subprocess.check_output([
        'osascript', '-e',
        'tell application "System Events" to tell process "Simulator" to tell window 1 to '
        'get position of (first UI element whose role is "AXGroup")',
    ], text=True)
    x, y = (int(v.strip()) for v in out.strip().split(','))
    return x, y


def post(kind, pt):
    ev = AS.CGEventCreateMouseEvent(None, kind, pt, 0)
    AS.CGEventPost(HID_TAP, ev)
    AS.CFRelease(ev)


def tap(px, py, hold=0.06):
    # 활성화가 창을 옮긴다 — 원점은 반드시 활성화 뒤에 읽는다.
    # 먼저 읽으면 클릭이 수십 px 씩 어긋나 엉뚱한 곳을 누른다
    subprocess.run(['open', '-a', 'Simulator'], check=False)
    time.sleep(0.5)
    ox, oy = screen_origin()
    pt = CGPoint(ox + px / 3.0, oy + py / 3.0)  # 스크린샷은 3배 픽셀
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
    ox, oy = screen_origin()
    sx1, sy1 = ox + px1 / 3.0, oy + py1 / 3.0
    sx2, sy2 = ox + px2 / 3.0, oy + py2 / 3.0
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
