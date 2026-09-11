/** A9 — 경유지 할 일 체크리스트 시트 (체크는 재계산을 유발하지 않는다) */
import React, { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { color, type } from '../theme/tokens';
import { toHHMM, toMin, usePlan } from '../state/plan';
import { Card, haptic } from '../components/common';
import { CongestionKey, CONGESTION, congestionLabel } from '../lib/congestion';
import { CheckCircle, CheckMark, Hairline } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { cancelScheduled, scheduleDepartureReminder } from '../notifications';

const GREEN_DEEP = '#0F5C3E';

/** 시트 높이 어림 — 내용만큼만 띄우고, 넘치면 목록이 스크롤되게 한다 */
const TASK_ROW_H = 49; // paddingVertical 14×2 + lineHeight 20 + 구분선
const TASK_WRAP_H = 20; // 긴 할 일이 두 줄로 넘어갈 때
const ADD_ROW_H = 48;
const LIST_CARD_PAD = 16;
const CONGESTION_CARD_H = 109;
const CONGESTION_H = CONGESTION_CARD_H + 14;
/** 실측 전 첫 프레임용 어림값 — 그랩바 + 헤더 + 도착 카드 + 하단 안내 */
const SHEET_CHROME_H = 211;
/** 그랩바 영역(Sheet가 그린다) + 콘텐츠 paddingTop */
const GRABBAR_H = 29;
const SCROLL_PAD_TOP = 14;

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

  const departAt = stop ? toHHMM(toMin(stop.arriveAt) + stop.dwellMin) : '';
  const remainMin = stop ? Math.max(stop.dwellMin - 6, 1) : 0;
  // 실제로 이 경유지에 도착해 체류 중인지 (진행중 탭의 '도착했어요'로 전환)
  const dwelling = !!stop && state.atStop && state.stops[state.passedCount]?.id === stop.id;
  // 도착해 체류 중이고 아직 제보 전일 때만 혼잡도를 묻는다.
  // devAnyCongestion은 개발 메뉴의 테스트 스위치 — 도착 전에도 열어 본다
  const askCongestion = (dwelling || state.devAnyCongestion) && !stop?.congestion;

  /* 제보하면 그 자리에서 고맙다고 하고 시트가 닫힌다.
     dispatch 즉시 askCongestion이 꺼지므로, 인사를 띄우는 동안은
     이 로컬 상태가 카드를 붙들고 있어야 화면이 튀지 않는다 */
  const [thanks, setThanks] = useState<CongestionKey | null>(null);
  const showCongestion = askCongestion || !!thanks;
  const thanksIn = useSharedValue(0);

  const submitCongestion = (level: CongestionKey) => {
    if (!stop) return;
    haptic();
    reportStopCongestion(stop.id, level);
    setThanks(level);
  };

  // 시트를 다시 열면 깨끗한 상태로
  React.useEffect(() => {
    if (!stopId) setThanks(null);
    else setMeasuredListH(0);
  }, [stopId]);

  React.useEffect(() => {
    if (!thanks) {
      thanksIn.value = 0;
      return;
    }
    thanksIn.value = withSpring(1, { damping: 13, stiffness: 210 });
    /* 인사를 보여준 뒤 혼잡도 영역만 접는다. 시트까지 닫으면 아직 남은
       할 일을 체크하러 다시 열어야 한다 — 제보는 할 일 도중에 스치는 동작이다 */
    const t = setTimeout(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setThanks(null);
    }, 1150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thanks]);

  const thanksStyle = useAnimatedStyle(() => ({
    opacity: withTiming(thanksIn.value, { duration: 160 }),
    transform: [{ scale: 0.9 + thanksIn.value * 0.1 }],
  }));

  /* ScrollView는 콘텐츠만큼 늘어나지 않는다. 시트가 콘텐츠 높이로 뜨면
     목록에 확정 높이가 안 잡혀 maxHeight를 줘도 스크롤이 죽는다.
     그래서 필요한 높이를 미리 재서 시트에 넘기고, 목록은 flex로 남은 만큼 차지한다.
     화면을 넘으면 Sheet가 알아서 잘라주고, 그때부터 목록이 스크롤된다 */
  /* 높이를 상수로 어림하면 빗나가서 목록 아래에 빈 공간이 남거나 잘린다.
     목록도 고정 영역도 그려진 값을 받아 쓰고, 첫 프레임에만 어림값을 쓴다 */
  const [measuredListH, setMeasuredListH] = useState(0);
  const [topH, setTopH] = useState(0);
  const [bottomH, setBottomH] = useState(0);
  const estimatedListH = stop
    ? stop.tasks.reduce((sum, t) => sum + TASK_ROW_H + (t.text.length > 18 ? TASK_WRAP_H : 0), 0) +
      ADD_ROW_H +
      LIST_CARD_PAD
    : 0;
  const listH = measuredListH || estimatedListH;
  const measured = topH > 0 && bottomH > 0;
  const sheetHeight = measured
    ? GRABBAR_H + topH + SCROLL_PAD_TOP + listH + bottomH
    : SHEET_CHROME_H + listH + (showCongestion ? CONGESTION_H : 0) + insets.bottom + 24;

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
        <View onLayout={e => setTopH(e.nativeEvent.layout.height)}>
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

          {/* 도착 상태 — 서 있는 사람에게 필요한 건 언제 나가야 하는지 뿐이다.
              도착 시각과 체류 예정은 '남은 N분'이 대신하므로 뺐다.
              체류시간의 '근거'도 뺐다 — 할 일 개수로 몇 분 걸릴지는 알 수 없다.
              모르는 걸 아는 척하면 나머지 숫자까지 못 믿게 된다 */}
          <Card style={{ padding: 14 }}>
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
                  lineHeight: 19,
                  color: dwelling ? GREEN_DEEP : color.body,
                }}
                numberOfLines={1}
              >
                {dwelling ? `체류 중 · ${departAt} 출발` : `도착 예정 ${stop.arriveAt} · ${departAt} 출발`}
              </Text>
              {dwelling && (
                <View style={{ backgroundColor: color.primaryTint, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 9 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.primary }}>
                    남은 {remainMin}분
                  </Text>
                </View>
              )}
            </View>
          </Card>
        </View>

          {/* 스크롤 경계 — 없으면 카드가 도착 카드 밑으로 파고들어 겹쳐 보인다.
              '여기서 할 일' 제목은 뺐다 — 시트 헤더가 이미 경유지 할 일이라고 말한다 */}
          <View style={{ paddingTop: 14 }}>
            <Hairline />
          </View>
        </View>

          {/* 할 일이 여섯 개만 돼도 넘친다 — 목록만 스크롤시킨다 */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={(_w, h) => setMeasuredListH(h)}
          >
          <Card style={{ padding: 8 }}>
            {stop.tasks.map((task, i) => {
              const isEditing = editingTaskId === task.id;
              return (
                <React.Fragment key={task.id}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                  {/* 왼쪽으로 밀면 오른쪽에 ✕ 박스 — 빈 내용으로 확정하는 것 말고는 지울 길이 없었다 */}
                  <ReanimatedSwipeable
                    enabled={!isEditing}
                    friction={2}
                    rightThreshold={36}
                    overshootRight={false}
                    renderRightActions={() => (
                      <Pressable
                        onPress={() => {
                          haptic();
                          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                          removeTask(stop.id, task.id);
                        }}
                        accessibilityLabel="할 일 삭제"
                        style={({ pressed }) => ({
                          width: 64,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: color.dangerBg,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 18, lineHeight: 22, color: color.danger }}>✕</Text>
                      </Pressable>
                    )}
                  >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                      backgroundColor: color.surface,
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
                  </ReanimatedSwipeable>
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

          <View
            onLayout={e => setBottomH(e.nativeEvent.layout.height)}
            style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: insets.bottom + 24, gap: 14 }}
          >
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
              도착해 체류 중일 때만 연다 — 가보지도 않은 곳의 혼잡도는 제보가 아니라 소음이다.
              카드 높이는 고정 — 인사로 바뀔 때 시트가 출렁이면 안 된다 */}
          {showCongestion && (
            <Card style={{ padding: 16, height: CONGESTION_CARD_H, justifyContent: 'center' }}>
              {thanks ? (
                <Animated.View
                  style={[
                    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
                    thanksStyle,
                  ]}
                >
                  <CheckCircle size={22} tint={color.green} />
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: GREEN_DEEP }}>
                    ‘{congestionLabel(thanks)}’ 제보 고마워요
                  </Text>
                </Animated.View>
              ) : (
                <View style={{ gap: 12 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink }}>
                    여기 얼마나 붐비나요?
                  </Text>
                  {/* 폭을 4등분해 꽉 채운다 — 한 번 스치듯 누르고 지나갈 자리라 표적이 커야 한다 */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {CONGESTION.map(c => (
                      <Pressable
                        key={c.key}
                        onPress={() => submitCongestion(c.key)}
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
                </View>
              )}
            </Card>
          )}

          </View>
        </View>
      )}
    </Sheet>
  );
}
