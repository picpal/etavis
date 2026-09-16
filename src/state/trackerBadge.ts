/**
 * 주행 상태 → 진행 중 카드에 그릴 뱃지 한 조각.
 *
 * `TabStubScreens.tsx`를 런타임으로 물지 않으려고 타입만 가져온다. 테스트가 직접 부른다.
 *
 * 원래는 카드 두 장이었다. 위 카드가 계획(소요·도착)을, 아래 카드가 주행 상태를 맡았는데,
 * 아래 카드가 말하는 내용의 대부분이 **"정상입니다"** 였다. `moving`·`idle`·`suspect` 는
 * 사용자가 알아야 할 게 없는 상태고 그게 대부분의 시간이다. 보조 줄의 `경로에서 0m` 도
 * 경로 위에 있으면 **항상** 0 근처라 늘 참인 값을 매번 적고 있었다.
 *
 * 그래서 카드를 합치고, 상태는 **점 하나 + 짧은 라벨**로 줄였다. 대신 버리지 않은 게 둘이다.
 * `detour` 의 `+N분` 은 이 추적기의 존재 이유이므로 라벨에 싣고, `faraway` 의 안내문은
 * "왜 아무 일도 안 일어나나"를 설명하므로 `note` 로 남긴다.
 */
import type { SimMode, TrackStatus } from './tracker';

/** 점 색이 곧 의미다 — 초록은 정상, 앰버는 사용자가 볼 것, 회색은 아직 모름 */
export type TrackerTone = 'ok' | 'warn' | 'idle';

export type TrackerBadge = {
  label: string;
  tone: TrackerTone;
  /** 라벨만으로 부족할 때의 한 줄. 없으면 null — 없는데 자리를 잡아두면 카드가 들쭉날쭉해진다 */
  note: string | null;
  /**
   * 진행 바를 믿을 수 있나. **색과 톤을 분리하는 이유가 여기 있다.**
   *
   * 처음엔 바 색으로 상태까지 말하게 했는데, 그러면 경고의 세기가 진행률에 종속된다 —
   * 100% 지점에서 이탈하면 앰버가 카드를 뒤덮고, 5% 지점에서 이탈하면 같은 경고가 얇은
   * 조각이라 거의 안 보인다(2026-09-16 시뮬레이터에서 눈으로 확인). 상태는 점과 글자가
   * 맡고, 바는 진행률만 맡는다. 색은 "이 숫자를 지금 믿을 수 있나"만 말한다.
   *
   * 경로를 벗어났거나 위치를 모르면 진행률은 마지막으로 알던 값이라 못 믿는다 — 회색.
   */
  progressTrusted: boolean;
};

export function trackerBadge(t: {
  status: TrackStatus;
  mode: SimMode;
  hasPosition: boolean;
  etaDeltaMin: number;
  crossTrackText: string;
}): TrackerBadge | null {
  // 추적을 끈 상태면 뱃지 자체를 그리지 않는다. 회색 점으로 "꺼짐"을 말하면 고장으로 읽힌다
  if (t.mode === 'off') return null;
  if (!t.hasPosition) {
    return { label: t.mode === 'live' ? 'GPS 기다리는 중' : '위치 대기 중', tone: 'idle', note: null, progressTrusted: false };
  }
  switch (t.status) {
    case 'moving':
      return { label: '이동 중', tone: 'ok', note: null, progressTrusted: true };
    case 'stalled':
      return { label: '정체 중', tone: 'warn', note: null, progressTrusted: true };
    case 'idle':
      return { label: '위치 확인 중', tone: 'idle', note: null, progressTrusted: false };
    // 잠깐 스쳐가는 상태다. 앰버로 칠하면 정작 detour 가 왔을 때 그 색을 안 믿는다
    case 'suspect':
      return { label: '경로 확인 중', tone: 'idle', note: null, progressTrusted: false };
    case 'detour':
      // 우회는 경로를 벗어난 게 아니다. 진행률은 여전히 유효하다
      return { label: `우회 중 · 도착 +${t.etaDeltaMin}분`, tone: 'warn', note: null, progressTrusted: true };
    case 'faraway':
      return {
        label: '경로에서 떨어짐',
        tone: 'warn',
        note: `경로까지 ${t.crossTrackText} · 계획한 지역으로 가면 다시 따라가요`,
        progressTrusted: false,
      };
    case 'offroute':
      // 시트(OffRouteSheet)가 뜨지만 그건 경유지를 찾았을 때뿐이다. 못 찾으면 이 줄이 유일한 신호다
      return { label: '경로를 벗어남', tone: 'warn', note: null, progressTrusted: false };
  }
}
