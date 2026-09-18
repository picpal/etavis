/**
 * 출발 알림을 언제 울릴지.
 *
 * 전에는 `TaskSheet` 가 마운트될 때 6초 뒤로 예약했다. 주석은 "경유지에 도착(시트
 * 열림)하면" 이라고 적혀 있었는데, **도착과 시트 열림은 같은 사건이 아니다.**
 * 그래서 두 방향으로 다 틀렸다:
 *
 * - 실제로 도착해 체류 중이어도 시트를 안 열면 알림이 영영 안 잡혔다. 체류는 몇 분이고,
 *   그 몇 분 안에 시트를 열 이유가 사용자에겐 없다.
 * - 아직 가지도 않은 경유지의 카드를 열면 그 경유지의 출발 알림이 예약됐다. 가드가
 *   `departed`(이미 지나옴) 하나뿐이라 `upcoming` 은 그대로 통과했다.
 *
 * 이제 도착 판정(`tracker.tsx` 의 `arrive` 이벤트)이 부른다 — `notifyArrival` 과 같은
 * 자리다. 도착을 아는 곳이 한 곳이면 알림도 거기서 나와야 한다.
 */

/** 체류가 끝나기 몇 분 전에 알릴 것인가. 알림 문구('5분 남았어요')와 같은 값이어야 한다 */
export const DEPARTURE_LEAD_MIN = 5;

/** 가상 주행에서 쓰는 압축 값. 실제 15분을 기다리며 검증할 수는 없다 */
const COMPRESSED_SECONDS = 6;

/**
 * 지금부터 몇 초 뒤에 출발 알림을 울릴지. 울리지 않아야 하면 `null`.
 *
 * `null` 을 돌려주는 경우가 둘이다. 둘 다 "알림이 거짓말이 되는" 경우다:
 * - 체류가 리드 시간보다 짧다 — 도착하자마자 '5분 남았어요' 가 뜬다.
 * - 이미 리드 시간 안에 들어와 있다 — 남은 시간이 5분보다 적은데 5분이라고 말한다.
 *
 * `elapsedMin` 은 도착 판정이 늦게 처리됐을 때를 위한 자리다. 도착 이벤트가 곧바로
 * 오면 0 이지만, 배경 위치가 몰아서 들어오면 이미 몇 분 지난 뒤일 수 있다.
 */
export function departureReminderSeconds(
  dwellMin: number,
  opts: { compress: boolean; elapsedMin?: number },
): number | null {
  const remainMin = dwellMin - (opts.elapsedMin ?? 0) - DEPARTURE_LEAD_MIN;
  if (remainMin <= 0) return null;
  // 압축은 '언제'만 줄인다. '울릴지 말지'는 두 모드가 같은 규칙을 쓴다 —
  // 규칙이 모드마다 다르면 가상 주행으로 검증한 것이 실기를 보장하지 못한다
  return opts.compress ? COMPRESSED_SECONDS : Math.round(remainMin * 60);
}
