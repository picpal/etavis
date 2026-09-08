/** 메인 탭바 — 계획/진행중/주변/더보기.
 *  모든 화면 하단에 상주하되, 키보드(채팅 입력)가 올라오면 숨는다.
 *  탭 페이지끼리는 replace로 전환해 스택이 쌓이지 않고,
 *  계획 탭은 탭 페이지 아래에 있던 계획 화면으로 복귀한다.
 *
 *  '더보기'만 화면을 바꾸지 않고 시트를 올린다. 자주 쓰지 않는 설정·이동 기록을
 *  거기 모아, 상시 노출되는 탭 자리는 실제로 매일 쓰는 것만 차지하게 했다. */
import React, { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { Chevron, GearIcon, PersonIcon, TabIcon } from './primitives';
import { Card, haptic } from './common';
import { Sheet } from './Sheet';
import type { RootStackParamList } from '../../App';

type TabKey = 'plan' | 'today' | 'nearby' | 'more';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'plan', label: '계획' },
  { key: 'today', label: '진행중' },
  { key: 'nearby', label: '주변' },
  { key: 'more', label: '더보기' },
];

const TAB_ROUTES: Record<'today' | 'nearby', keyof RootStackParamList> = {
  today: 'Today',
  nearby: 'Nearby',
};

/** 탭바를 달고 있는 화면들 — 서로 전환할 때 스택을 쌓지 않고 replace한다 */
const isTabRoute = (name: string) => name === 'Today' || name === 'Nearby' || name === 'History';

export function TabBar() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const [hidden, setHidden] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHidden(true);
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHidden(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (hidden) return null;

  const activeKey: TabKey =
    route.name === 'Today' ? 'today'
    : route.name === 'Nearby' ? 'nearby'
    : route.name === 'History' || route.name === 'Settings' ? 'more'
    : 'plan';

  const go = (target: keyof RootStackParamList) => {
    if (isTabRoute(route.name)) navigation.replace(target);
    else navigation.navigate(target);
  };

  const onPressTab = (key: TabKey) => {
    // 더보기는 현재 위치와 무관하게 언제든 다시 열 수 있어야 한다
    if (key === 'more') {
      haptic();
      setMoreOpen(true);
      return;
    }
    if (key === activeKey) return;
    haptic();
    if (key === 'plan') {
      // 탭 페이지 아래에 있던 계획 화면으로 복귀 (탭 페이지는 항상 1장만 쌓임)
      if (isTabRoute(route.name) && navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('Home');
      return;
    }
    go(TAB_ROUTES[key]);
  };

  return (
    <>
      <View
        style={{
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          paddingTop: 10,
          paddingHorizontal: 24,
          paddingBottom: Math.max(insets.bottom, 10),
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        {TABS.map(tab => {
          const active = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onPressTab(tab.key)}
              hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
              style={({ pressed }) => ({ width: 64, alignItems: 'center', gap: 5, opacity: pressed ? 0.6 : 1 })}
            >
              <TabIcon name={tab.key} size={22} tint={active ? color.primary : color.stroke} />
              <Text
                style={{
                  fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                  fontSize: 11,
                  lineHeight: 11,
                  color: active ? color.primary : color.muted,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <MoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        current={route.name}
        onPick={target => {
          setMoreOpen(false);
          if (route.name === target) return;
          if (target === 'Settings') navigation.navigate('Settings');
          else go(target);
        }}
      />
    </>
  );
}

type MoreItem = {
  key: string;
  /** 없으면 아직 화면이 없는 자리표시 */
  target?: keyof RootStackParamList;
  label: string;
  note: string;
  icon: 'person' | 'history' | 'gear';
};

const MORE_ITEMS: MoreItem[] = [
  // 프로필은 아직 화면이 없다. 자리만 잡아두고 준비 중임을 그대로 표시한다
  { key: 'profile', label: '내 프로필', note: '닉네임 · 제보와 받은 고마움', icon: 'person' },
  { key: 'history', target: 'History', label: '이동 기록', note: '지난 이동과 그때의 계획', icon: 'history' },
  { key: 'settings', target: 'Settings', label: '설정', note: '이동수단 · 지도 앱 · 알림', icon: 'gear' },
];

function MoreSheet({
  visible,
  onClose,
  current,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  current: string;
  onPick: (target: keyof RootStackParamList) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <Text style={[type.titleL, { color: color.ink }]}>더보기</Text>

        <Card style={{ padding: 8 }}>
          {MORE_ITEMS.map((item, i) => {
            const active = !!item.target && current === item.target;
            const tint = active ? color.primary : color.body;
            return (
              <React.Fragment key={item.key}>
                {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                <Pressable
                  disabled={!item.target}
                  onPress={() => {
                    haptic();
                    if (item.target) onPick(item.target);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    opacity: !item.target ? 0.55 : pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: color.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon === 'gear' ? (
                      <GearIcon size={20} tint={tint} />
                    ) : item.icon === 'person' ? (
                      <PersonIcon size={20} tint={tint} />
                    ) : (
                      <TabIcon name="history" size={20} tint={tint} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{
                        fontFamily: 'Pretendard-SemiBold',
                        fontSize: 16,
                        lineHeight: 20,
                        color: active ? color.primary : color.ink,
                      }}
                    >
                      {item.label}
                    </Text>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
                      {item.note}
                    </Text>
                  </View>
                  {item.target ? (
                    <Chevron size={8} thickness={2} color={color.stroke} dir="right" />
                  ) : (
                    <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 16, color: color.muted }}>
                      준비 중
                    </Text>
                  )}
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>

        <Pressable
          onPress={() => {
            haptic();
            onClose();
          }}
          style={({ pressed }) => ({
            minHeight: 54,
            borderRadius: 16,
            backgroundColor: color.track,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={[type.btn, { color: color.body }]}>닫기</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
