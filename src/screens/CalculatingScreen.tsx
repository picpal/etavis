/** A3 — 계산 중 (진행률 → 자동으로 A5, 실패 플래그 시 A8) */
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { calcSteps } from '../data/mockData';
import { usePlan } from '../state/plan';
import { Card } from '../components/common';
import { CheckMark } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Calculating'>;

const DURATION_MS = 6000;
/** 단계 전환 임계값 (progress 0..1) */
const STEP_AT = [0.22, 0.48, 0.86, 1];

function PulseRing() {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: 600, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[
        { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: color.primary },
        style,
      ]}
    />
  );
}

function SkeletonBar({ width, height, soft, delay }: { width: `${number}%`; height: number; soft?: boolean; delay?: number }) {
  const shimmer = useSharedValue(1);
  useEffect(() => {
    const t = setTimeout(() => {
      shimmer.value = withRepeat(
        withSequence(
          withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    }, delay ?? 0);
    return () => clearTimeout(t);
  }, [delay, shimmer]);
  const style = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: height > 16 ? 6 : 5,
          backgroundColor: soft ? color.skeletonSoft : color.skeleton,
        },
        style,
      ]}
    />
  );
}

export function CalculatingScreen({ navigation }: Props) {
  const { state, setFailNext } = usePlan();
  const [progress, setProgress] = useState(0);
  const failRef = useRef(state.failNext);
  failRef.current = state.failNext;

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / DURATION_MS);
      // ease-out: 초반 빠르게, 후반 천천히
      const eased = 1 - Math.pow(1 - t, 1.8);
      setProgress(t >= 1 ? 1 : eased);
      if (t >= 1) {
        clearInterval(timer);
        if (failRef.current) {
          setFailNext(false);
          navigation.replace('Error');
        } else {
          navigation.replace('Options');
        }
      }
    }, 60);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = Math.round(progress * 100);
  const remainSec = Math.max(1, Math.ceil(((1 - progress) * DURATION_MS) / 1000));

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader
        title="경로 계산 중"
        onBack={() => navigation.goBack()}
        right={{ label: '취소', tint: color.muted, onPress: () => navigation.goBack() }}
      />

      <View style={{ flex: 1, paddingTop: 18, paddingHorizontal: 20, gap: 16 }}>
        <Card style={{ padding: 20, gap: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View style={{ gap: 5 }}>
              <Text style={[type.labelPlain, { color: color.muted }]}>조합 12개 검토 중</Text>
              <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 30, lineHeight: 30, letterSpacing: -0.6, color: color.ink }}>
                {pct}%
              </Text>
            </View>
            <Text style={[type.captionM, { color: color.muted }]}>약 {remainSec}초 남음</Text>
          </View>

          <View style={{ height: 6, borderRadius: 3, backgroundColor: color.skeleton, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color.primary }} />
          </View>

          <View style={{ gap: 14 }}>
            {calcSteps.map((step, i) => {
              const done = progress >= STEP_AT[i];
              const active = !done && (i === 0 || progress >= STEP_AT[i - 1]);
              return (
                <View
                  key={step.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: done || active ? 1 : 0.45 }}
                >
                  {done ? (
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: color.green,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CheckMark />
                    </View>
                  ) : active ? (
                    <PulseRing />
                  ) : (
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: color.stroke }} />
                  )}
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: active ? 'Pretendard-Medium' : 'Pretendard-Regular',
                      fontSize: 15,
                      lineHeight: 20,
                      color: active ? color.ink : color.body,
                    }}
                  >
                    {step.text}
                    {'count' in step && step.count && done ? (
                      <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.ink }}> {step.count}</Text>
                    ) : null}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>

        <Text style={[type.label, { color: color.muted }]}>추천 경로</Text>
        <Card style={{ padding: 20, gap: 14 }}>
          <SkeletonBar width="48%" height={22} />
          <SkeletonBar width="78%" height={13} soft delay={200} />
          <SkeletonBar width="40%" height={13} soft delay={400} />
        </Card>
        <Card style={{ padding: 20, gap: 14, opacity: 0.65 }}>
          <SkeletonBar width="40%" height={22} delay={100} />
          <SkeletonBar width="66%" height={13} soft delay={300} />
        </Card>

        <Text style={[type.caption, { color: color.muted, textAlign: 'center', paddingHorizontal: 20 }]}>
          계산 중에도 대화를 이어갈 수 있어요.
        </Text>
      </View>

      <BottomInputBar placeholder="조건을 더 말해보세요" sendEnabled={false} editable={false} />
      <TabBar />
    </View>
  );
}
