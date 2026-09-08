/** 커스텀 bottom sheet — 그랩바·딤·드래그 닫기 재현 (A4/A7/A9) */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow } from '../theme/tokens';

const OPEN_MS = 300;
const CLOSE_MS = 220;

export function Sheet({
  visible,
  onClose,
  height,
  scrim = color.scrim,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** 지정 시 고정 높이(예: A4 730), 미지정 시 콘텐츠 높이 */
  height?: number;
  scrim?: string;
  children: React.ReactNode;
}) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const sheetH = useSharedValue(height ?? screenH * 0.7);

  const maxH = screenH - insets.top - 40;
  const fixedH = height ? Math.min(height, maxH) : undefined;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragY.value = 0;
      progress.value = withTiming(1, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      progress.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, fin => {
        if (fin) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const pan = Gesture.Pan()
    .onUpdate(e => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd(e => {
      if (e.translationY > 120 || e.velocityY > 800) {
        runOnJS(requestClose)();
      } else {
        dragY.value = withSpring(0, { damping: 20, stiffness: 240 });
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [sheetH.value + 40, 0]) + dragY.value },
    ],
  }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim }, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>
      <Animated.View
        onLayout={e => {
          sheetH.value = e.nativeEvent.layout.height;
        }}
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: fixedH,
            maxHeight: maxH,
            backgroundColor: color.bg,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            ...shadow.sheet,
          },
          sheetStyle,
        ]}
      >
        {/* 그랩바에만 팬 제스처 — 내부 스크롤과 충돌 방지 */}
        <GestureDetector gesture={pan}>
          <View style={{ paddingTop: 10, paddingBottom: 6, alignItems: 'center' }} hitSlop={{ top: 8, bottom: 12, left: 60, right: 60 }}>
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: color.stroke }} />
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
    </View>
  );
}
