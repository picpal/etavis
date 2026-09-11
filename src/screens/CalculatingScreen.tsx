/** A3 — 계산 중. 진행 바는 실제 단계(직행 → 검색 → 실측 → 정리)에 묶인다. ready면 A5, failed면 A8 */
import React, { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { usePlanFlow } from '../state/planFlowProvider';
import { usePlanRequest } from '../state/usePlanRequest';
import { Card } from '../components/common';
import { CheckMark } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Calculating'>;

/** 결과가 더 빨라도 이만큼은 보여준다 — 깜빡이면 계산한 것 같지 않다 */
const MIN_SHOW_MS = 1200;

function PulseRing() {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(0.35, { duration: 600, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) })), -1);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: color.primary }, style]} />;
}

export function CalculatingScreen({ navigation }: Props) {
  const { state, start } = usePlanFlow();
  const request = usePlanRequest();
  const enteredAt = useRef(Date.now());
  const startedRef = useRef(false);

  useEffect(() => {
    // request가 생기는 순간 한 번. GPS가 늦게 잡혀도(첫 렌더는 null) 이후 non-null로
    // 바뀌면 그때 시작하고, 한 번 시작했으면 다시 부르지 않는다.
    // 칩이 바뀌면 A2가 RESET하고 여기로 다시 온다
    if (request && !startedRef.current) {
      startedRef.current = true;
      start(request);
    }
  }, [request, start]);

  useEffect(() => {
    if (state.phase !== 'ready' && state.phase !== 'failed') return;
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - enteredAt.current));
    const t = setTimeout(() => navigation.replace(state.phase === 'ready' ? 'Options' : 'Error'), wait);
    return () => clearTimeout(t);
  }, [state.phase, navigation]);

  const done = state.progress.filter(p => p.done).length;
  const pct = state.progress.length ? Math.round((done / state.progress.length) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="경로 계산 중" onBack={() => navigation.goBack()} right={{ label: '취소', tint: color.muted, onPress: () => navigation.goBack() }} />
      <View style={{ flex: 1, paddingTop: 18, paddingHorizontal: 20, gap: 16 }}>
        <Card style={{ padding: 20, gap: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View style={{ gap: 5 }}>
              <Text style={[type.labelPlain, { color: color.muted }]}>{request ? `경유지 ${request.stops.length}곳` : '위치 확인 중'}</Text>
              <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 30, lineHeight: 30, letterSpacing: -0.6, color: color.ink }}>{pct}%</Text>
            </View>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: color.skeleton, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: color.primary }} />
          </View>
          <View style={{ gap: 14 }}>
            {state.progress.map((step, i) => {
              const active = !step.done && (i === 0 || state.progress[i - 1].done);
              return (
                <View key={step.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, opacity: step.done || active ? 1 : 0.45 }}>
                  {step.done ? (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' }}><CheckMark /></View>
                  ) : active ? <PulseRing /> : (
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: color.stroke }} />
                  )}
                  <Text style={{ flex: 1, fontFamily: active ? 'Pretendard-Medium' : 'Pretendard-Regular', fontSize: 15, lineHeight: 20, color: active ? color.ink : color.body }}>
                    {step.label}
                    {step.detail ? <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.ink }}> {step.detail}</Text> : null}
                  </Text>
                </View>
              );
            })}
          </View>
        </Card>
        {!request && (
          <Text style={[type.caption, { color: color.amberDeep, textAlign: 'center' }]}>출발지 위치를 아직 못 잡았어요. 잠시 뒤 다시 시도해 주세요.</Text>
        )}
      </View>
      <BottomInputBar placeholder="조건을 더 말해보세요" sendEnabled={false} editable={false} />
      <TabBar />
    </View>
  );
}
