/** 공통 컴포넌트 — Card, SectionLabel, MicroLabelRow, PrimaryButton, Chip, Bubble, SegmentControl */
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { color, radius, shadow, type } from '../theme/tokens';
import { Chevron } from './primitives';

export const haptic = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

export function Card({
  children,
  style,
  elevated,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  elevated?: boolean;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: color.surface,
          borderRadius: radius.card,
          ...(elevated ? shadow.cardElevated : shadow.card),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[type.label, { color: color.muted }, style]}>{children}</Text>;
}

export type MicroItem = { label: string; value: string; tint?: string };

/** bg R14 4열(또는 3열) 마이크로 라벨 블록 — 11/500 라벨 + 굵은 값, 1px 세로 구분선 */
export function MicroLabelRow({
  items,
  padV = 14,
  valueSize = 17,
  style,
  background = color.bg,
}: {
  items: MicroItem[];
  padV?: number;
  valueSize?: number;
  style?: ViewStyle;
  background?: string;
}) {
  return (
    <View
      style={[
        { flexDirection: 'row', backgroundColor: background, borderRadius: 14, paddingVertical: padV },
        style,
      ]}
    >
      {items.map((it, i) => (
        <React.Fragment key={it.label + i}>
          {i > 0 && <View style={{ width: 1, backgroundColor: 'rgba(16,32,58,0.08)' }} />}
          <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
            <Text style={[type.micro, { color: color.muted }]}>{it.label}</Text>
            <Text
              style={{
                fontFamily: 'Pretendard-Bold',
                fontSize: valueSize,
                lineHeight: valueSize,
                color: it.tint ?? color.ink,
              }}
            >
              {it.value}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  height = 54,
  borderRadius = radius.button,
  chevron,
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  height?: number;
  borderRadius?: number;
  chevron?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        haptic();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          minHeight: height,
          borderRadius,
          backgroundColor: disabled ? color.track : color.primary,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          opacity: pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      <Text style={[type.btn, { color: disabled ? color.body : '#fff' }]}>{label}</Text>
      {chevron && <Chevron size={9} thickness={2.5} color="#fff" dir="right" />}
    </Pressable>
  );
}

/** 작은 칩 (할 일 1 / 3 · 매장 교체) — 13/600, R9, p8×10 */
export function SmallChip({
  label,
  tint = color.body,
  background = color.bg,
  onPress,
}: {
  label: string;
  tint?: string;
  background?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              haptic();
              onPress();
            }
          : undefined
      }
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      style={({ pressed }) => ({
        backgroundColor: background,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: radius.chipSmall,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: tint }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 사용자 채팅 버블 — 우측 정렬, R 20 20 8 20 */
export function Bubble({ children, maxWidth = 285 }: { children: React.ReactNode; maxWidth?: number }) {
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        maxWidth,
        backgroundColor: color.primary,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderBottomRightRadius: 8,
        borderBottomLeftRadius: 20,
        paddingVertical: 13,
        paddingHorizontal: 16,
      }}
    >
      <Text style={[type.bodyL, { color: '#fff' }]}>{children}</Text>
    </View>
  );
}

/** 세그먼트 — 트랙 R12 p3, 활성 썸 흰색 R10 + shadow */
export function SegmentControl({
  options,
  value,
  onChange,
  track = color.bg,
  fontSize = 15,
  padV = 12,
}: {
  options: string[];
  value: number;
  onChange: (index: number) => void;
  track?: string;
  fontSize?: number;
  padV?: number;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: track,
        borderRadius: radius.segment,
        padding: 3,
      }}
    >
      {options.map((opt, i) => {
        const active = i === value;
        return (
          <Pressable
            key={opt}
            onPress={() => {
              if (!active) {
                haptic();
                onChange(i);
              }
            }}
            style={[
              styles.segmentItem,
              { paddingVertical: padV },
              active && {
                backgroundColor: color.surface,
                borderRadius: radius.segmentThumb,
                shadowColor: '#1C3A6E',
                shadowOpacity: 0.1,
                shadowRadius: 3,
                shadowOffset: { width: 0, height: 2 },
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                fontSize,
                lineHeight: fontSize,
                color: active ? color.ink : color.muted,
                textAlign: 'center',
              }}
            >
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
