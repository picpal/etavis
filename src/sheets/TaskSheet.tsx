/** A9 — 경유지 할 일 체크리스트 시트 (체크는 재계산을 유발하지 않는다) */
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { dwellBasis, toHHMM, toMin, usePlan } from '../state/plan';
import { Card, haptic, MicroLabelRow, PrimaryButton } from '../components/common';
import { CheckMark } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { cancelScheduled, scheduleDepartureReminder } from '../notifications';

const GREEN_DEEP = '#0F5C3E';

function Checkbox({ done }: { done: boolean }) {
  if (done) {
    return (
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          backgroundColor: color.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckMark w={10} h={5} />
      </View>
    );
  }
  return (
    <View
      style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: color.stroke, backgroundColor: '#fff' }}
    />
  );
}

export function TaskSheet({ stopId, onClose }: { stopId: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { state, toggleTask, updateTask, addTask, removeTask } = usePlan();
  const scheduledRef = React.useRef<string | null>(null);
  // 할 일 인라인 편집
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const draftTextRef = React.useRef('');
  const taskSeq = React.useRef(0);

  // 닫힘 애니메이션 동안 콘텐츠 유지
  const lastIdRef = React.useRef(stopId);
  if (stopId) lastIdRef.current = stopId;
  const stop = state.stops.find(s => s.id === lastIdRef.current);

  const doneCount = stop ? stop.tasks.filter(t => t.done).length : 0;
  const departAt = stop ? toHHMM(toMin(stop.arriveAt) + stop.dwellMin) : '';
  const remainMin = stop ? Math.max(stop.dwellMin - 6, 1) : 0;
  // 실제로 이 경유지에 도착해 체류 중인지 (진행중 탭의 '도착했어요'로 전환)
  const dwelling = !!stop && state.atStop && state.stops[state.passedCount]?.id === stop.id;

  // 경유지에 도착(시트 열림)하면 출발 5분 전 알림을 자동 예약
  const stopName = stop?.name;
  React.useEffect(() => {
    if (!stopId || !stopName) return;
    let cancelled = false;
    scheduleDepartureReminder(stopName, departAt).then(id => {
      if (cancelled) cancelScheduled(id);
      else scheduledRef.current = id;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopId, stopName]);

  const commitEdit = () => {
    const id = editingTaskId;
    if (!stop || !id) return;
    const text = draftTextRef.current.trim();
    // 빈 내용으로 확정하면 그 항목은 삭제 (새로 추가하다 만 경우 포함)
    if (text) updateTask(stop.id, id, text);
    else removeTask(stop.id, id);
    setEditingTaskId(null);
  };

  const startAddTask = () => {
    if (!stop) return;
    haptic();
    taskSeq.current += 1;
    const id = `new-${stop.id}-${taskSeq.current}`;
    draftTextRef.current = '';
    addTask(stop.id, id);
    setEditingTaskId(id);
  };

  return (
    <Sheet visible={!!stopId} onClose={onClose}>
      {stop && (
        <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
          {/* 시트 헤더 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
                경유지 할 일
              </Text>
              <Text style={[type.titleL, { color: color.ink }]}>{stop.name}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={[type.action, { color: color.primary }]}>완료</Text>
            </Pressable>
          </View>

          {/* 도착 상태 카드 */}
          <Card style={{ padding: 18, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 4.5,
                  backgroundColor: dwelling ? color.green : color.stroke,
                }}
              />
              <Text
                style={{
                  flex: 1,
                  fontFamily: 'Pretendard-SemiBold',
                  fontSize: 15,
                  lineHeight: 18,
                  color: dwelling ? GREEN_DEEP : color.body,
                }}
              >
                {dwelling ? '도착했어요 · 체류 중' : '도착 예정'}
              </Text>
              {dwelling && (
                <View style={{ backgroundColor: color.primaryTint, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.primary }}>
                    남은 {remainMin}분
                  </Text>
                </View>
              )}
            </View>
            <MicroLabelRow
              padV={13}
              valueSize={16}
              items={[
                { label: '도착', value: stop.arriveAt },
                { label: '체류 예정', value: `${stop.dwellMin}분` },
                { label: '다음 출발', value: departAt },
              ]}
            />
            {/* 체류시간의 근거를 밝힌다 */}
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 16, color: color.muted }}>
              체류 {stop.dwellMin}분은 {dwellBasis(stop)}이에요 · 더 머물면 다음 일정이 밀려요
            </Text>
          </Card>

          {/* 여기서 할 일 */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={[type.label, { color: color.muted }]}>여기서 할 일</Text>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, color: color.primary }}>
              {doneCount} / {stop.tasks.length} 완료
            </Text>
          </View>

          <Card style={{ padding: 8 }}>
            {stop.tasks.map((task, i) => {
              const isEditing = editingTaskId === task.id;
              return (
                <React.Fragment key={task.id}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                    }}
                  >
                    {/* 체크박스는 완료 토글, 텍스트는 탭해서 수정 */}
                    <Pressable
                      onPress={() => {
                        haptic();
                        toggleTask(stop.id, task.id);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <Checkbox done={task.done} />
                    </Pressable>
                    {isEditing ? (
                      <TextInput
                        autoFocus
                        defaultValue={task.text}
                        onChangeText={t => (draftTextRef.current = t)}
                        onSubmitEditing={commitEdit}
                        onBlur={commitEdit}
                        returnKeyType="done"
                        placeholder="할 일을 입력하세요"
                        placeholderTextColor={color.placeholder}
                        selectionColor={color.primary}
                        style={{
                          flex: 1,
                          fontFamily: 'Pretendard-Medium',
                          fontSize: 16,
                          lineHeight: 20,
                          color: color.ink,
                          paddingVertical: 0,
                        }}
                      />
                    ) : (
                      <Pressable
                        onPress={() => {
                          haptic();
                          draftTextRef.current = task.text;
                          setEditingTaskId(task.id);
                        }}
                        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text
                          style={{
                            fontFamily: 'Pretendard-Medium',
                            fontSize: 16,
                            lineHeight: 20,
                            color: task.done ? color.muted : color.ink,
                            textDecorationLine: task.done ? 'line-through' : 'none',
                          }}
                        >
                          {task.text}
                        </Text>
                      </Pressable>
                    )}
                    {isEditing && (
                      <Pressable
                        onPress={commitEdit}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.primary }}>
                          완료
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </React.Fragment>
              );
            })}
            <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />
            <Pressable
              onPress={startAddTask}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingVertical: 14,
                paddingHorizontal: 12,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  backgroundColor: color.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View style={{ position: 'absolute', width: 12, height: 2, backgroundColor: color.primary }} />
                <View style={{ position: 'absolute', width: 2, height: 12, backgroundColor: color.primary }} />
              </View>
              <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 16, lineHeight: 20, color: color.primary }}>
                할 일 추가
              </Text>
            </Pressable>
          </Card>

          {/* 출발 5분 전 알림은 도착하면 자동 예약 — 별도 토글 없음 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color.stroke }} />
            <Text style={{ flex: 1, fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}>
              출발 5분 전({departAt} 출발)에 알려드릴게요
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            <PrimaryButton label="다 했어요 · 다음 경유지" chevron height={56} borderRadius={18} onPress={onClose} />
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
              체크는 경로를 다시 계산하지 않아요
            </Text>
          </View>
        </View>
      )}
    </Sheet>
  );
}
