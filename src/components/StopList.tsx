/**
 * 경유지 목록 — 추천 경로(A5)의 본문. 행: 순번 · 이름 · 도착 시각(늦으면 '빼면 언제 도착') · 후보 셰브론.
 *
 * 왜: 이 화면의 질문은 "언제 도착하나, 뭘 바꾸면 되나" 둘뿐이다. 3안 선택은 뺐다.
 * 행을 왼쪽으로 밀면 빼기, 탭하면 후보 팝업에서 다른 매장(고르면 바로 반영).
 * 늦을 때는 행마다 '빼면 언제 도착'만 적는다 — 무엇을 뺄지는 사용자가 정한다.
 *
 * **빼기는 그 자리에서 계산하지 않는다.** 뺀 행은 지우지 않고 흐리게 남겨 '뺄 예정'으로
 * 두고, 실제 재계산은 화면 아래 '다시 계산'을 누를 때 한 번만 한다. 예전에는 한 곳 뺄
 * 때마다 검색부터 전부 다시 돌아서(외부 호출 약 30회) 남아 있던 후보까지 다른 곳으로
 * 갈렸다 — 경유지가 줄면 회랑이 바뀌고, 회랑이 바뀌면 검색 앵커가 움직이기 때문이다.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { color, HIT_SLOP, type } from '../theme/tokens';
import { Card, haptic } from './common';
import { Chevron, Hairline } from './primitives';
import { toHHMM } from '../state/plan';
import { SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import { answersQuery } from '../lib/placeQuery';
import type { PlanResult, Slot, Visit } from '../lib/routePlan/types';

const hhmm = (min: number) => toHHMM(Math.round(min)).padStart(5, '0');

export function StopList({
  result, visits, arrivals, slots, departAtMin, arriveByMin, late, approx, onPick, onRemove,
  pendingRemove, onUndoRemove, headerAccessory,
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
  /** 뺄 예정인 행. 아직 계획에서 지운 게 아니라 '다시 계산'을 누를 때 반영된다 */
  pendingRemove: string[];
  onUndoRemove: (slotId: string) => void;
  /* 라벨과 카드 사이. 목록을 다시 세우는 조작(기준 탭)이 여기 들어간다 —
     조작과 그 결과가 붙어 있어야 무엇이 바뀌는지 눈으로 이어진다 */
  headerAccessory?: React.ReactNode;
}) {
  const left = visits.length - pendingRemove.length;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.label, { color: color.muted }]}>
        경유지 {left}곳{pendingRemove.length > 0 ? ` · ${pendingRemove.length}곳 뺌` : ''}
      </Text>
      {headerAccessory}
      {/* 들를 곳이 하나도 없을 때. 예전에는 빈 카드가 높이 0으로 접혀 아무것도 안 그려졌고,
          그러면 '경유지가 없다'가 아니라 '목록이 안 떴다'로 읽힌다 — 실제로 그렇게 읽혔다.
          왜 없는지는 바로 위 '못 찾아 뺐어요' 줄들이 말하므로, 여기서는 지금 어떤 길인지만
          말한다 */}
      {visits.length === 0 ? (
        <Card style={{ paddingVertical: 22, paddingHorizontal: 16, alignItems: 'center', gap: 4 }}>
          <Text style={[type.body, { color: color.body }]}>들를 곳이 없어요</Text>
          <Text style={[type.caption, { color: color.muted }]}>목적지까지 바로 가는 길이에요</Text>
        </Card>
      ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {visits.map((v, k) => {
              const pending = pendingRemove.includes(v.slotId);
              const slot = slots.find(s => s.id === v.slotId);
              const alts = (slot?.candidates.length ?? 0) - 1;
              /* 무엇을 찾던 자리인지. 업종으로 확인됐거나 이름이 질의를 품으면 붙이지
                 않는다 — '정숙마트' 옆의 '마트'는 읽는 사람 시간만 쓰고, 잘 맞은 행까지
                 시끄러우면 정작 어긋난 행을 안 읽는다. 근거가 하나도 없는 행에만 붙어서
                 '닭강정집' 자리에 앉은 '맘스터치'를 도착 전에 알아챌 수 있다
                 (실측 2026-09-19 기기 — 판정은 placeQuery.answersQuery) */
              const askedFor = slot && !answersQuery(v.candidate.name, slot.query) ? slot.query : null;
              const st = result.slotStatus[v.slotId];
              const statusText = st && st !== 'ok' ? SLOT_STATUS_TEXT[st] : null;
              /* 늦을 때만: 이 경유지를 빼면 언제 도착하나 (rescore는 부분 집합에도 동작).
                 이미 뺄 예정인 행에는 붙이지 않는다 — 뺀 뒤의 시각을 뺀 행에 적으면 앞뒤가 안 맞는다 */
              const without = late && !pending ? result.rescore(visits.filter((_, j) => j !== k)) : null;
              const withoutArrive = without ? departAtMin + without.totalMin : null;
              const withoutSlack = withoutArrive != null && arriveByMin != null ? Math.round(arriveByMin - withoutArrive) : null;
              return (
                <React.Fragment key={v.slotId}>
                  {k > 0 && <Hairline style={{ marginLeft: 16 }} />}
                  <ReanimatedSwipeable
                    enabled={!pending}
                    friction={2}
                    rightThreshold={32}
                    overshootRight={false}
                    /* 세 번째 인자로 이 행의 제어권이 온다. 빼기는 행을 지우는 게 아니라
                       흐리게 남기는 동작이라, 직접 닫지 않으면 열린 채로 굳는다 —
                       이름과 '되돌리기'가 빨간 버튼에 밀려 잘린다 */
                    renderRightActions={(_progress, _translation, methods) => (
                      <View style={{ justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Pressable
                          onPress={() => { haptic(); methods.close(); onRemove(v.slotId); }}
                          accessibilityLabel={`${v.candidate.name} 빼기`}
                          style={({ pressed }) => ({ minWidth: 56, height: 40, paddingHorizontal: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: color.danger, opacity: pressed ? 0.7 : 1 })}
                        >
                          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 16, color: '#FFFFFF' }}>빼기</Text>
                        </Pressable>
                      </View>
                    )}
                  >
                    <Pressable
                      disabled={alts === 0 || pending}
                      onPress={() => { haptic(); onPick(v.slotId); }}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: pressed ? color.bg : color.surface })}
                    >
                      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: pending ? color.track : color.primaryTint, alignItems: 'center', justifyContent: 'center', opacity: pending ? 0.6 : 1 }}>
                        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: pending ? color.muted : color.primary }}>{k + 1}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19,
                            color: pending ? color.muted : color.ink,
                            textDecorationLine: pending ? 'line-through' : 'none',
                          }}
                        >
                          {v.candidate.name}
                        </Text>
                        {/* 도착 시각 배지 — 이름 다음에 바로 읽히게 이름 아래 줄, 초록 */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {pending ? (
                            /* 도착 시각 자리에 되돌리기를 둔다 — 뺀 행에 초록 도착 배지가 남아 있으면
                               뺐다는 것과 정면으로 어긋난다. 되돌릴 길은 이 행 안에 있어야 한다 */
                            <Pressable
                              onPress={() => { haptic(); onUndoRemove(v.slotId); }}
                              accessibilityRole="button"
                              accessibilityLabel={`${v.candidate.name} 되돌리기`}
                              hitSlop={HIT_SLOP}
                              style={({ pressed }) => ({ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: color.primaryTint, opacity: pressed ? 0.7 : 1 })}
                            >
                              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: color.primary }}>되돌리기</Text>
                            </Pressable>
                          ) : (
                            /* '도착'이 먼저 읽히고 시각이 굵게 — 숫자만 보이면 무슨 시각인지 모른다 */
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: color.greenBg }}>
                              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 14, color: color.green, opacity: 0.85 }}>도착</Text>
                              <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 14, lineHeight: 16, color: color.green }}>{approx}{hhmm(arrivals[k])}</Text>
                            </View>
                          )}
                          {statusText && !pending && <Text style={[type.caption, { color: color.amberDeep }]}>{statusText}</Text>}
                          {askedFor && !pending && (
                            <Text numberOfLines={1} style={[type.caption, { color: color.muted, flexShrink: 1 }]}>
                              {askedFor} 자리
                            </Text>
                          )}
                        </View>
                        {withoutArrive != null && withoutSlack != null && (
                          <Text style={[type.caption, { color: withoutSlack >= 0 ? color.green : color.muted }]}>
                            빼면 {approx}{hhmm(withoutArrive)} 도착 · {withoutSlack >= 0 ? `${withoutSlack}분 여유` : `그래도 ${-withoutSlack}분 늦음`}
                          </Text>
                        )}
                      </View>
                      {alts > 0 && !pending && <Chevron size={9} thickness={2} color={color.stroke} dir="right" />}
                    </Pressable>
                  </ReanimatedSwipeable>
                </React.Fragment>
              );
            })}
          </Card>
      )}
    </View>
  );
}
