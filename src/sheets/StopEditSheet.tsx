/**
 * 경유지 수정 시트 — 추천 경로(A5)의 선택된 카드에서 "경유지 수정"으로 연다.
 *
 * 왜: 경유지 리스트를 화면에 늘 펼쳐 두면 답(도착 시각)보다 목록이 먼저 보였다. 수정은
 * 필요한 순간에만. 행을 왼쪽으로 밀면 빼기, 탭하면 다른 매장 고르기(후보 시트로 넘긴다).
 * 늦을 때는 행마다 '빼면 언제 도착'을 적어 무엇을 빼야 맞추는지 바로 비교되게 한다.
 */
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { color, type } from '../theme/tokens';
import { Card, haptic } from '../components/common';
import { Chevron, Hairline } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { toHHMM } from '../state/plan';
import { SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import type { PlanResult, Slot, Visit } from '../lib/routePlan/types';

const hhmm = (min: number) => toHHMM(Math.round(min)).padStart(5, '0');

export function StopEditSheet({
  visible, onClose, result, visits, arrivals, slots, departAtMin, arriveByMin, late, approx, onPick, onRemove,
}: {
  visible: boolean;
  onClose: () => void;
  result: PlanResult;
  visits: Visit[];
  arrivals: number[];
  slots: Slot[];
  departAtMin: number;
  arriveByMin: number | null;
  late: boolean;
  /** '약 ' 또는 '' — 추정이면 약 */
  approx: string;
  onPick: (slotId: string) => void;
  onRemove: (slotId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View style={{ gap: 4 }}>
              <Text style={[type.label, { color: color.muted }]}>추천 경로</Text>
              <Text style={[type.titleL, { color: color.ink }]}>경유지 수정</Text>
            </View>
            <Pressable onPress={() => { haptic(); onClose(); }} hitSlop={12}>
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.primary }}>완료</Text>
            </Pressable>
          </View>
          <Text style={[type.caption, { color: color.muted }]}>
            {visits.length}곳 · 왼쪽으로 밀면 빼기{late ? '(바로 다시 계산)' : ''} · 탭하면 다른 매장 고르기
          </Text>

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {visits.map((v, k) => {
              const alts = (slots.find(s => s.id === v.slotId)?.candidates.length ?? 0) - 1;
              const st = result.slotStatus[v.slotId];
              const statusText = st && st !== 'ok' ? SLOT_STATUS_TEXT[st] : null;
              // 늦을 때만: 이 경유지를 빼면 언제 도착하나 (rescore는 부분 집합에도 동작)
              const without = late ? result.rescore(visits.filter((_, j) => j !== k)) : null;
              const withoutArrive = without ? departAtMin + without.totalMin : null;
              const withoutSlack = withoutArrive != null && arriveByMin != null ? Math.round(arriveByMin - withoutArrive) : null;
              return (
                <React.Fragment key={v.slotId}>
                  {k > 0 && <Hairline style={{ marginLeft: 16 }} />}
                  <ReanimatedSwipeable
                    friction={2}
                    rightThreshold={32}
                    overshootRight={false}
                    renderRightActions={() => (
                      <View style={{ justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Pressable
                          onPress={() => { haptic(); onRemove(v.slotId); }}
                          accessibilityLabel={`${v.candidate.name} 빼기`}
                          style={({ pressed }) => ({ minWidth: 56, height: 40, paddingHorizontal: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: color.danger, opacity: pressed ? 0.7 : 1 })}
                        >
                          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 16, color: '#FFFFFF' }}>빼기</Text>
                        </Pressable>
                      </View>
                    )}
                  >
                    <Pressable
                      disabled={alts === 0}
                      onPress={() => { haptic(); onPick(v.slotId); }}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: pressed ? color.bg : color.surface })}
                    >
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: color.primary }}>{k + 1}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text numberOfLines={1} style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink }}>{v.candidate.name}</Text>
                        <Text style={[type.caption, { color: st === 'late' ? color.late : statusText ? color.amberDeep : color.muted }]}>
                          {approx}{hhmm(arrivals[k])} 도착{statusText ? ` · ${statusText}` : ''}
                        </Text>
                        {withoutArrive != null && withoutSlack != null && (
                          <Text style={[type.caption, { color: withoutSlack >= 0 ? color.green : color.muted }]}>
                            빼면 {approx}{hhmm(withoutArrive)} 도착 · {withoutSlack >= 0 ? `${withoutSlack}분 여유` : `그래도 ${-withoutSlack}분 늦음`}
                          </Text>
                        )}
                      </View>
                      {alts > 0 && <Chevron size={9} thickness={2} color={color.stroke} dir="right" />}
                    </Pressable>
                  </ReanimatedSwipeable>
                </React.Fragment>
              );
            })}
          </Card>
        </View>
      </ScrollView>
    </Sheet>
  );
}
