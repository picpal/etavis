/** A9 — 경유지 할 일 체크리스트 시트 (체크는 재계산을 유발하지 않는다) */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { dwellBasis, toHHMM, toMin, usePlan } from '../state/plan';
import { Card, haptic, MicroLabelRow } from '../components/common';
import { CONGESTION, congestionLabel } from '../lib/congestion';
import { CheckMark, Hairline } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { cancelScheduled, scheduleDepartureReminder } from '../notifications';

const GREEN_DEEP = '#0F5C3E';

/** 시트 높이 어림 — 내용만큼만 띄우고, 넘치면 목록이 스크롤되게 한다 */
const TASK_ROW_H = 49; // paddingVertical 14×2 + lineHeight 20 + 구분선
const TASK_WRAP_H = 20; // 긴 할 일이 두 줄로 넘어갈 때
const ADD_ROW_H = 48;
const LIST_CARD_PAD = 16;
const CONGESTION_H = 123;
/** 그랩바 + 헤더 + 도착 카드 + 목록 제목 + 하단 안내 */
const SHEET_CHROME_H = 393;

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
  const { height: H } = useWindowDimensions();
  const { state, toggleTask, updateTask, addTask, removeTask, reportStopCongestion } = usePlan();
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
  // 도착해 체류 중이고 아직 제보 전일 때만 혼잡도를 묻는다
  const askCongestion = dwelling && !stop?.congestion;

  /* ScrollView는 콘텐츠만큼 늘어나지 않는다. 시트가 콘텐츠 높이로 뜨면
     목록에 확정 높이가 안 잡혀 maxHeight를 줘도 스크롤이 죽는다.
     그래서 필요한 높이를 미리 재서 시트에 넘기고, 목록은 flex로 남은 만큼 차지한다.
     화면을 넘으면 Sheet가 알아서 잘라주고, 그때부터 목록이 스크롤된다 */
  const listH = stop
    ? stop.tasks.reduce((sum, t) => sum + TASK_ROW_H + (t.text.length > 18 ? TASK_WRAP_H : 0), 0) +
      ADD_ROW_H +
      LIST_CARD_PAD
    : 0;
  const sheetHeight = SHEET_CHROME_H + listH + (askCongestion ? CONGESTION_H : 0) + insets.bottom + 24;

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
    <Sheet visible={!!stopId} onClose={onClose} height={sheetHeight}>
      {stop && (
        <View style={{ flex: 1, paddingTop: 8 }}>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
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
        </View>

          {/* 제목과 진행수는 고정 — 목록과 같이 밀려 올라가면 지금 몇 개 남았는지를 잃는다 */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={[type.label, { color: color.muted }]}>여기서 할 일</Text>
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, color: color.primary }}>
                {doneCount} / {stop.tasks.length} 완료
              </Text>
            </View>
            {/* 스크롤 경계 — 없으면 카드가 제목 밑으로 파고들어 겹쳐 보인다 */}
            <Hairline />
          </View>

          {/* 할 일이 여섯 개만 돼도 넘친다 — 목록만 스크롤시킨다 */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
          </ScrollView>

          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: insets.bottom + 24, gap: 14 }}>
          {/* 출발 5분 전 알림은 도착하면 자동 예약 — 별도 토글 없음 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color.stroke }} />
            <Text style={{ flex: 1, fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}>
              출발 5분 전({departAt} 출발)에 알려드릴게요
            </Text>
          </View>

          {/* 혼잡도 제보 — '다 했어요' 자리를 대신한다.
              그 버튼은 시트를 닫기만 했다. 떠나는 순간은 여기가 얼마나 붐볐는지
              사용자가 아는 유일한 시점이라, 같은 자리에서 그걸 받는 편이 값이 있다.
              도착해 체류 중일 때만 연다 — 가보지도 않은 곳의 혼잡도는 제보가 아니라 소음이다 */}
          {askCongestion && (
            <Card style={{ padding: 16, gap: 12 }}>
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink }}>
                여기 얼마나 붐비나요?
              </Text>
              {/* 폭을 4등분해 꽉 채운다 — 한 번 스치듯 누르고 지나갈 자리라 표적이 커야 한다 */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {CONGESTION.map(c => (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      haptic();
                      reportStopCongestion(stop.id, c.key);
                    }}
                    style={({ pressed }) => ({
                      flex: 1,
                      height: 46,
                      borderRadius: 12,
                      backgroundColor: color.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: c.tint }}>
                      {c.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          )}

          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
            {stop.congestion
              ? `혼잡도 '${congestionLabel(stop.congestion)}' 제보 고마워요`
              : '체크는 경로를 다시 계산하지 않아요'}
          </Text>
          </View>
        </View>
      )}
    </Sheet>
  );
}
