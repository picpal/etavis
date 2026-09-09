/** 로컬 알림 헬퍼 — 체류 종료 혼잡도 제보 액션 + 하트 감사 알림 */
import * as Notifications from 'expo-notifications';

export const CONGESTION_CATEGORY = 'congestion-report';
/** 도착 알림 — 여기서 할 일을 바로 열 수 있게 */
export const ARRIVAL_CATEGORY = 'stop-arrival';
/** 출발 알림(대중교통) — 다음 구간 길찾기를 바로 열 수 있게 */
export const NEXT_LEG_CATEGORY = 'next-leg';

export const ACTION_OPEN_TASKS = 'open-tasks';
export const ACTION_OPEN_LEG = 'open-leg';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let ready: Promise<boolean> | null = null;

/** 권한 요청 + 액션 카테고리 등록 (1회) */
export function ensureNotificationsReady(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return false;
        await Notifications.setNotificationCategoryAsync(CONGESTION_CATEGORY, [
          { identifier: 'low', buttonTitle: '여유' },
          { identifier: 'mid', buttonTitle: '보통' },
          { identifier: 'high', buttonTitle: '혼잡' },
          { identifier: 'veryhigh', buttonTitle: '매우혼잡' },
        ]);
        await Notifications.setNotificationCategoryAsync(ARRIVAL_CATEGORY, [
          { identifier: ACTION_OPEN_TASKS, buttonTitle: '할 일 보기' },
        ]);
        await Notifications.setNotificationCategoryAsync(NEXT_LEG_CATEGORY, [
          { identifier: ACTION_OPEN_LEG, buttonTitle: '구간 길찾기' },
        ]);
        return true;
      } catch {
        return false;
      }
    })();
  }
  return ready;
}

/**
 * 출발 5분 전 알림 — 경유지에 도착하면 자동 예약된다.
 * 잠금화면 액션으로 혼잡도까지 바로 제보할 수 있다.
 * 목에서는 실제 5분을 기다릴 수 없어 6초 뒤에 발송한다.
 */
const MOCK_LEAD_SECONDS = 6;

export async function scheduleDepartureReminder(
  stopName: string,
  departAt: string,
): Promise<string | null> {
  const ok = await ensureNotificationsReady();
  if (!ok) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: '곧 출발할 시간이에요',
      body: `${stopName} 체류가 5분 남았어요 · ${departAt} 출발 예정`,
      categoryIdentifier: CONGESTION_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: MOCK_LEAD_SECONDS,
    },
  });
}

/**
 * 경유지 도착 — 여기서 할 일이 뭐였는지 그 순간에 알려준다.
 *
 * 잠금화면에 상주하는 Live Activity가 아니라 '전환 순간'에만 보낸다.
 * 상시 갱신을 알림으로 흉내내면 갱신할 때마다 다시 울려서 방해가 된다 (issue #1)
 */
export async function notifyArrival(stopId: string, stopName: string, taskCount: number) {
  const ok = await ensureNotificationsReady();
  if (!ok) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${stopName} 도착`,
      body: taskCount > 0 ? `여기서 할 일 ${taskCount}개가 있어요` : '체류를 시작할게요',
      categoryIdentifier: taskCount > 0 ? ARRIVAL_CATEGORY : undefined,
      data: { screen: 'today', stopId },
    },
    trigger: null,
  });
}

/** 경유지 출발 — 다음이 어디이고 몇 시 도착인지. 대중교통이면 구간 길찾기 액션을 붙인다 */
export async function notifyNextLeg(toName: string, etaLabel: string, transit: boolean) {
  const ok = await ensureNotificationsReady();
  if (!ok) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `다음 · ${toName}`,
      body: `${etaLabel} 도착 예정`,
      categoryIdentifier: transit ? NEXT_LEG_CATEGORY : undefined,
      data: { screen: 'today', leg: transit ? 1 : 0 },
    },
    trigger: null,
  });
}

export async function cancelScheduled(id: string | null) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
}

/**
 * 마감 초과가 '예측되는' 순간 알림 — 아직 만회 가능할 때 알려야 행동이 바뀐다.
 * 이미 늦은 뒤에 알리는 건 소용이 없다.
 */
export async function notifyDeadlineRisk(overMin: number, deadlineLabel: string) {
  const ok = await ensureNotificationsReady();
  if (!ok) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${deadlineLabel} 도착이 어려워요`,
      body: `지금 속도면 ${overMin}분 초과해요. 경유지를 줄이면 맞출 수 있어요.`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2 },
  });
}

/** 내 제보가 하트를 받았을 때 감사 알림 */
export async function scheduleThanksNotification(postText: string, hearts: number) {
  const ok = await ensureNotificationsReady();
  if (!ok) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '사람들이 고마워하고 있어요 ❤️',
      body: `‘${postText}’ 제보가 하트 ${hearts}개를 받았어요`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 8 },
  });
}
