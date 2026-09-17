/** 웹 알림 — 전부 no-op. 데모는 핵심 한 줄기(A1→A6)만 보여주므로 알림 경로가 없다. */

export const CONGESTION_CATEGORY = 'congestion-report';
export const ARRIVAL_CATEGORY = 'stop-arrival';
export const NEXT_LEG_CATEGORY = 'next-leg';
export const ACTION_OPEN_TASKS = 'open-tasks';
export const ACTION_OPEN_LEG = 'open-leg';

export function ensureNotificationsReady(): Promise<boolean> {
  return Promise.resolve(false);
}

export async function scheduleDepartureReminder(): Promise<string | null> {
  return null;
}

export async function notifyArrival(): Promise<void> {}
export async function notifyDestinationArrival(): Promise<void> {}
export async function notifyNextLeg(): Promise<void> {}
export async function cancelScheduled(): Promise<void> {}
export async function notifyDeadlineRisk(): Promise<void> {}
export async function scheduleThanksNotification(): Promise<void> {}
