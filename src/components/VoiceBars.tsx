/** 음량 파형 막대 — 듣는 중일 때 입력 바 안에서 움직인다.
 *  음량은 아직 가짜 신호(타이머). 실제 마이크 미터링이 들어오면 useFakeLevel 만 갈아끼운다. */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { color } from '../theme/tokens';

const BAR_COUNT = 5;
const BAR_MIN = 4;
const BAR_MAX = 22;
// 가운데가 가장 크고 바깥으로 갈수록 작다 — 한 값으로 다섯 막대를 움직인다
const WEIGHTS = [0.45, 0.8, 1, 0.8, 0.45];

function useFakeLevel() {
  const [level, setLevel] = useState(0.2);
  useEffect(() => {
    const id = setInterval(() => setLevel(0.15 + Math.random() * 0.85), 120);
    return () => clearInterval(id);
  }, []);
  return level;
}

export function VoiceBars({ tint = color.green }: { tint?: string }) {
  const level = useFakeLevel();
  const anims = useRef(Array.from({ length: BAR_COUNT }, () => new Animated.Value(BAR_MIN))).current;

  useEffect(() => {
    Animated.parallel(
      anims.map((a, i) =>
        Animated.timing(a, {
          toValue: BAR_MIN + (BAR_MAX - BAR_MIN) * level * WEIGHTS[i],
          duration: 110,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ),
    ).start();
  }, [level, anims]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: BAR_MAX }}>
      {anims.map((h, i) => (
        <Animated.View key={i} style={{ width: 4, height: h, borderRadius: 2, backgroundColor: tint }} />
      ))}
    </View>
  );
}
