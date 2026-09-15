/** A2 — 이동수단 선택 시트. 헤더의 셀렉트가 이걸 연다 (ArriveBySheet 와 같은 모양) */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { MODE_KEYS, MODE_TEXT, usePlan } from '../state/plan';
import { Card, haptic } from '../components/common';
import { CheckMark } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { usePlanFlow } from '../state/planFlowProvider';

/** 고를 때 알아야 할 것만. 뒤늦게 알면 배신감이 드는 한계는 여기서 미리 말한다 */
const MODE_NOTE: Record<(typeof MODE_KEYS)[number], string> = {
  car: '주차 가능한 곳을 우선 찾아드려요',
  walk: '걸어서 들를 수 있는 가까운 곳만 봐요',
  transit: '지도 앱이 경유지를 못 받아요 — 대신 도착할 때마다 다음 구간을 하나씩 열어드려요',
};

/**
 * 이동수단을 여기서도 바꿀 수 있게 한 이유:
 * 계산은 '경로 찾기'를 눌러야 도는데(usePlanRequest → runPlan), 그 전까지 이동수단은
 * 입력값일 뿐이다. 바꾸겠다고 A1까지 되돌아가 대화를 버릴 이유가 없다.
 */
export function ModeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { state, setMode } = usePlan();
  const flow = usePlanFlow();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
            계산 조건
          </Text>
          <Text style={[type.titleL, { color: color.ink }]}>이동수단</Text>
        </View>

        <Card style={{ padding: 8 }}>
          {MODE_KEYS.map((key, i) => {
            const active = key === state.mode;
            return (
              <React.Fragment key={key}>
                {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                <Pressable
                  onPress={() => {
                    haptic();
                    if (!active) {
                      setMode(key);
                      // 조건이 바뀌면 계산은 사용자가 다시 들어갈 때 — 칩 변경과 같은 규칙(자동 재계산 금지).
                      // 고르던 것을 다시 고른 경우엔 건드리지 않는다. 멀쩡한 결과를 버릴 이유가 없다
                      flow.reset();
                    }
                    onClose();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{
                        fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                        fontSize: 16,
                        lineHeight: 20,
                        color: active ? color.primary : color.ink,
                      }}
                    >
                      {MODE_TEXT[key]}
                    </Text>
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 16, color: color.muted }}>
                      {MODE_NOTE[key]}
                    </Text>
                  </View>
                  {active && (
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: color.primary,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CheckMark />
                    </View>
                  )}
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>

        {/* 바꿔도 지금 당장은 아무 일도 안 일어난다는 것을 말해둔다 — '경로 찾기'가 계산의 시작점이다 */}
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          바꾼 조건은 다음 경로 찾기부터 적용돼요
        </Text>
      </View>
    </Sheet>
  );
}
