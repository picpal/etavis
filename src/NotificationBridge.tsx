/**
 * 알림 응답 → 화면 전환. App.tsx 에 있던 것을 플랫폼 분기가 가능하게 빼냈다.
 *
 * 웹에는 .web.tsx 가 대신 들어간다 — App.tsx 가 expo-notifications 를 직접 import 하면
 * notifications.web.ts 를 만들어도 그 경로가 안 막힌다.
 */
import React from 'react';
import * as Notifications from 'expo-notifications';
import type { NavigationContainerRef } from '@react-navigation/native';
import { usePlan } from './state/plan';
import { ACTION_OPEN_LEG, ACTION_OPEN_TASKS } from './notifications';
import type { RootStackParamList } from '../App';

export function NotificationBridge({ navigationRef }: { navigationRef: NavigationContainerRef<RootStackParamList> }) {
  const { setCongestionReport } = usePlan();
  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const action = response.actionIdentifier;
      if (['low', 'mid', 'high', 'veryhigh'].includes(action)) {
        setCongestionReport(action);
        return;
      }
      /*
        도착·출발 알림에서 들어온 경우 — 진행중으로 보내되 필요한 시트까지 열어준다.
        알림을 눌렀는데 홈이 뜨면 다시 두세 번 눌러야 한다.
      */
      const data = (response.notification.request.content.data ?? {}) as {
        screen?: string;
        stopId?: string;
      };
      if (data.screen !== 'today' || !navigationRef.isReady()) return;
      if (action === ACTION_OPEN_LEG) {
        navigationRef.navigate('Today', { sheet: 'mapapp' });
      } else if (action === ACTION_OPEN_TASKS && data.stopId) {
        navigationRef.navigate('Today', { sheet: 'task', stopId: data.stopId });
      } else {
        navigationRef.navigate('Today', data.stopId ? { sheet: 'task', stopId: data.stopId } : {});
      }
    });
    return () => sub.remove();
  }, [setCongestionReport, navigationRef]);
  return null;
}
