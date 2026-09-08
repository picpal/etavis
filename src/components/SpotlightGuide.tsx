/**
 * 스포트라이트 가이드 — 특정 영역만 밝게 남기고 나머지를 덮어 설명한다.
 * 구멍은 딤 사각형 4장(위/아래/좌/우)으로 만든다. 마스크 없이 동작해 가볍다.
 */
import React from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { color, radius, type } from '../theme/tokens';
import { haptic } from './common';

export type SpotRect = { x: number; y: number; width: number; height: number };

export type GuideStep = {
  /** 강조할 영역 (화면 좌표) */
  rect: SpotRect;
  title: string;
  body: string;
};

const SCRIM = 'rgba(16,32,58,0.74)';
const PAD = 8;

export function SpotlightGuide({
  steps,
  stepIndex,
  onNext,
  onClose,
}: {
  steps: GuideStep[];
  stepIndex: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const step = steps[stepIndex];
  if (!step) return null;

  const { x, y, width, height } = step.rect;
  const hx = Math.max(0, x - PAD);
  const hy = Math.max(0, y - PAD);
  const hw = Math.min(W - hx, width + PAD * 2);
  // 강조 영역이 화면을 다 먹으면 설명 카드를 놓을 자리가 없어 높이를 제한한다
  const hh = Math.min(height + PAD * 2, H * 0.42);

  // 여유 공간이 더 넓은 쪽에 설명을 붙인다
  const spaceAbove = hy;
  const spaceBelow = H - (hy + hh);
  const placeBelow = spaceBelow >= spaceAbove;
  const isLast = stepIndex === steps.length - 1;

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 100 }}>
      {/* 딤 4장으로 구멍 만들기 */}
      <Pressable style={{ position: 'absolute', left: 0, top: 0, width: W, height: hy, backgroundColor: SCRIM }} onPress={onNext} />
      <Pressable
        style={{ position: 'absolute', left: 0, top: hy + hh, width: W, height: Math.max(0, H - hy - hh), backgroundColor: SCRIM }}
        onPress={onNext}
      />
      <Pressable style={{ position: 'absolute', left: 0, top: hy, width: hx, height: hh, backgroundColor: SCRIM }} onPress={onNext} />
      <Pressable
        style={{ position: 'absolute', left: hx + hw, top: hy, width: Math.max(0, W - hx - hw), height: hh, backgroundColor: SCRIM }}
        onPress={onNext}
      />

      {/* 강조 테두리 */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: hx,
          top: hy,
          width: hw,
          height: hh,
          borderRadius: radius.card + 4,
          borderWidth: 2,
          borderColor: '#fff',
        }}
      />

      {/* 설명 카드 */}
      <View
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          ...(placeBelow ? { top: hy + hh + 14 } : { bottom: Math.max(20, H - hy + 14) }),
        }}
      >
        <View style={{ backgroundColor: color.surface, borderRadius: radius.card, padding: 20, gap: 10 }}>
          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.primary }}>
            {stepIndex + 1} / {steps.length}
          </Text>
          <Text style={[type.titleL, { color: color.ink }]}>{step.title}</Text>
          <Text style={[type.body, { color: color.body }]}>{step.body}</Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={() => {
                haptic();
                onClose();
              }}
              style={({ pressed }) => ({
                minHeight: 48,
                paddingHorizontal: 18,
                borderRadius: 14,
                backgroundColor: color.track,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 15, color: color.body }}>
                건너뛰기
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                haptic();
                onNext();
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: color.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 15, color: '#fff' }}>
                {isLast ? '알겠어요' : '다음'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
