/**
 * 경유지 목록 — 추천 경로(A5)의 본문. 행: 순번 · 이름 · 도착 시각(늦으면 '빼면 언제 도착') · 후보 셰브론.
 *
 * 왜: 이 화면의 질문은 "언제 도착하나, 뭘 바꾸면 되나" 둘뿐이다. 3안 선택은 뺐다.
 * 행을 왼쪽으로 밀면 빼기(바로 다시 계산), 탭하면 후보 팝업에서 다른 매장(고르면 다시 계산).
 * 늦을 때는 행마다 '빼면 언제 도착'만 적는다 — 무엇을 뺄지는 사용자가 정한다.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { color, type } from '../theme/tokens';
import { Card, haptic } from './common';
import { Chevron, Hairline } from './primitives';
import { toHHMM } from '../state/plan';
import { SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import type { PlanResult, Slot, Visit } from '../lib/routePlan/types';

const hhmm = (min: number) => toHHMM(Math.round(min)).padStart(5, '0');

export function StopList({
  result, visits, arrivals, slots, departAtMin, arriveByMin, late, approx, onPick, onRemove,
}: {
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
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.label, { color: color.muted }]}>경유지 {visits.length}곳</Text>
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
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text numberOfLines={1} style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink }}>{v.candidate.name}</Text>
                        {/* 도착 시각 배지 — 이름 다음에 바로 읽히게 이름 아래 줄, 초록 */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {/* '도착'이 먼저 읽히고 시각이 굵게 — 숫자만 보이면 무슨 시각인지 모른다 */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: color.greenBg }}>
                            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 14, color: color.green, opacity: 0.85 }}>도착</Text>
                            <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 14, lineHeight: 16, color: color.green }}>{approx}{hhmm(arrivals[k])}</Text>
                          </View>
                          {statusText && <Text style={[type.caption, { color: color.amberDeep }]}>{statusText}</Text>}
                        </View>
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
  );
}
