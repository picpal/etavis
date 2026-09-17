/** 커스텀 bottom sheet — 그랩바·딤·드래그 닫기 재현 (A4/A7/A9) */
import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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

/** 키보드와 같은 곡선·같은 시간으로 움직인다 — 시트만 먼저 튀면 뒤에 딤이 번쩍인다 */
function keyboardAnim(duration: number) {
  return {
    duration: Math.max(duration, 1),
    update: { type: LayoutAnimation.Types.keyboard },
  };
}

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

  /* 시트는 화면 바닥에 붙어 있어서, 키보드가 올라오면 안에서 편집 중인 줄이
     그대로 키보드 밑으로 들어간다(A9 할 일 편집에서 목록 전체가 가려졌다).
     키보드 높이만큼 통째로 끌어올리고, 높이 한계도 같이 줄인다 —
     올리기만 하면 긴 시트는 반대로 머리가 화면 위로 잘린다 */
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', e => {
      LayoutAnimation.configureNext(keyboardAnim(e.duration));
      setKbHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardWillHide', e => {
      LayoutAnimation.configureNext(keyboardAnim(e.duration));
      setKbHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const maxH = screenH - insets.top - 40 - kbHeight;
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
            bottom: kbHeight,
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
