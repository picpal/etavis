import React from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { color } from './src/theme/tokens';
import { PlanProvider, usePlan } from './src/state/plan';
import { ACTION_OPEN_LEG, ACTION_OPEN_TASKS } from './src/notifications';
import { TrackerProvider } from './src/state/tracker';
import './src/notifications';
import { HomeScreen } from './src/screens/HomeScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { CalculatingScreen } from './src/screens/CalculatingScreen';
import { OptionsScreen } from './src/screens/OptionsScreen';
import { TimelineScreen } from './src/screens/TimelineScreen';
import { ErrorScreen } from './src/screens/ErrorScreen';
import { HistoryScreen, NearbyScreen, SettingsScreen, TodayScreen } from './src/screens/TabStubScreens';

export type RootStackParamList = {
  Home: undefined;
  Plan: undefined;
  Calculating: undefined;
  Options: { pick?: string } | undefined;
  Timeline: { sheet?: 'task' | 'candidate' | 'mapapp' } | undefined;
  Error: undefined;
  Today: { sheet?: 'task' | 'mapapp'; stopId?: string } | undefined;
  History: undefined;
  Settings: undefined;
  Nearby: undefined;
};

/** 개발·검증용 딥링크: exp://.../--/timeline 등으로 각 화면 직접 진입 */
const linking = {
  prefixes: [Linking.createURL('/')],
  config: {
    screens: {
      Home: 'home',
      Plan: 'plan',
      Calculating: 'calculating',
      Options: 'options',
      Timeline: 'timeline',
      Error: 'error',
      Today: 'today',
      History: 'history',
      Settings: 'settings',
      Nearby: 'nearby',
    },
  },
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: color.bg },
};

/** 알림 액션(여유/보통/혼잡/매우혼잡) 응답 → 혼잡도 제보로 반영 */
/** 알림에서 화면으로 보내려면 NavigationContainer 밖에서도 쓸 수 있는 ref가 필요하다 */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function NotificationBridge() {
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
  }, [setCongestionReport]);
  return null;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    'Pretendard-Regular': require('./assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium': require('./assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold': require('./assets/fonts/Pretendard-SemiBold.otf'),
    'Pretendard-Bold': require('./assets/fonts/Pretendard-Bold.otf'),
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: color.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PlanProvider>
          <TrackerProvider>
          <NotificationBridge />
          <NavigationContainer ref={navigationRef} theme={theme} linking={linking}>
            <StatusBar style="dark" />
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Plan" component={PlanScreen} />
              <Stack.Screen name="Calculating" component={CalculatingScreen} />
              <Stack.Screen name="Options" component={OptionsScreen} />
              <Stack.Screen name="Timeline" component={TimelineScreen} />
              <Stack.Screen name="Error" component={ErrorScreen} />
              <Stack.Screen name="Today" component={TodayScreen} options={{ animation: 'none' }} />
              <Stack.Screen name="History" component={HistoryScreen} options={{ animation: 'none' }} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Nearby" component={NearbyScreen} options={{ animation: 'none' }} />
            </Stack.Navigator>
          </NavigationContainer>
          </TrackerProvider>
        </PlanProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
