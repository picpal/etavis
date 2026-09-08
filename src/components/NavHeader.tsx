/** 흰색 헤더 — back 버튼(38×38 R13) + 타이틀 20/700 + 우측 텍스트 액션 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow, type } from '../theme/tokens';
import { Chevron } from './primitives';
import { haptic } from './common';

export function NavHeader({
  title,
  onBack,
  right,
  children,
}: {
  title: string;
  onBack?: () => void;
  right?: { label: string; tint?: string; onPress?: () => void; onLongPress?: () => void };
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.surface,
        paddingTop: insets.top,
        paddingHorizontal: 20,
        paddingBottom: 14,
        gap: 12,
        ...shadow.header,
        zIndex: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {onBack ? (
          <Pressable
            onPress={() => {
              haptic();
              onBack();
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: radius.iconButton,
              backgroundColor: color.bg,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Chevron size={9} thickness={2} color={color.primary} dir="left" style={{ transform: [{ translateX: 2 }, { rotate: '-135deg' }] }} />
          </Pressable>
        ) : (
          <View style={{ width: 38 }} />
        )}
        <Text style={[type.title, { color: color.ink }]}>{title}</Text>
        {right ? (
          <Pressable
            onPress={right.onPress}
            onLongPress={right.onLongPress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ width: 38, alignItems: 'flex-end', justifyContent: 'center', height: 38 }}
          >
            <Text style={[type.action, { color: right.tint ?? color.primary }]}>{right.label}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 38 }} />
        )}
      </View>
      {children}
    </View>
  );
}
