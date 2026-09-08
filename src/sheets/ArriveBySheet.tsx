/** A2 — 숙소 도착 예정 시각 선택 시트 (30분 단위 select box) */
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { toHHMM, usePlan } from '../state/plan';
import { Card, haptic } from '../components/common';
import { CheckMark } from '../components/primitives';
import { Sheet } from '../components/Sheet';

export function ArriveBySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { state, setArriveBy, arriveByOptions } = usePlan();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
            계산 조건
          </Text>
          <Text style={[type.titleL, { color: color.ink }]}>숙소 도착 예정 시각</Text>
        </View>

        <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
          <Card style={{ padding: 8 }}>
            {/* 마감은 선택 — 기본은 상관없음 */}
            <Pressable
              onPress={() => {
                haptic();
                setArriveBy(null);
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
                    fontFamily: state.arriveByMin == null ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                    fontSize: 16,
                    lineHeight: 20,
                    color: state.arriveByMin == null ? color.primary : color.ink,
                  }}
                >
                  상관없어요
                </Text>
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 16, color: color.muted }}>
                  예상 도착 시각만 알려드려요
                </Text>
              </View>
              {state.arriveByMin == null && (
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
            {arriveByOptions.map(min => {
              const active = min === state.arriveByMin;
              return (
                <React.Fragment key={min}>
                  <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />
                  <Pressable
                    onPress={() => {
                      haptic();
                      setArriveBy(min);
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
                    <Text
                      style={{
                        flex: 1,
                        fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                        fontSize: 16,
                        lineHeight: 20,
                        color: active ? color.primary : color.ink,
                      }}
                    >
                      오늘 {toHHMM(min).padStart(5, '0')}까지
                    </Text>
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
        </ScrollView>

        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          마감을 정하면 늦어질 때 미리 알려드려요
        </Text>
      </View>
    </Sheet>
  );
}
