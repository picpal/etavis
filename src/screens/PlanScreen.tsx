/** A2 — 자연어 입력 (채팅 전용). 조건은 A1에서 받고 헤더에 요약만 표시.
 *  경로 계산은 어시스턴트가 묻고 퀵리플라이로 확정한다. */
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NavigationAction } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { MODE_TEXT, toHHMM, usePlan } from '../state/plan';
import { RECENT_DESTINATIONS } from '../data/mockData';
import { Bubble, haptic, PrimaryButton } from '../components/common';
import { Sheet } from '../components/Sheet';
import { Chevron, DottedLineH } from '../components/primitives';
import { ModeSheet } from '../sheets/ModeSheet';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import { usePlanFlow } from '../state/planFlowProvider';
import { SLOT_STATUS_HELP, SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import { introCopy } from '../lib/timingCopy';
import type { SlotStatus } from '../lib/routePlan/types';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

/** 항공권 스타일 출발–도착 커넥터 */
function ConnectorCard({ directMin, from, to }: { directMin: number; from: string; to: string }) {
  return (
    <View
      style={{
        backgroundColor: color.bg,
        borderRadius: 16,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[type.micro, { color: color.muted }]}>출발</Text>
        <Text
          style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 18, color: color.ink }}
          numberOfLines={1}
        >
          {from}
        </Text>
      </View>
      <View style={{ flex: 1.2, alignItems: 'center', gap: 5 }}>
        <Text style={[type.micro, { color: color.muted }]}>직행 {directMin}분</Text>
        <DottedLineH style={{ alignSelf: 'stretch', flex: 0 }} />
      </View>
      <View style={{ flex: 1, gap: 3, alignItems: 'flex-end' }}>
        <Text style={[type.micro, { color: color.muted }]}>도착</Text>
        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 18, color: color.ink }} numberOfLines={1}>
          {to}
        </Text>
      </View>
    </View>
  );
}

/** 헤더 조건 줄 — 이동수단은 눌러서 바꾼다, 도착 시각은 A1에서 받은 값 그대로 */
function ConditionBar({ mode, arriveText, onPressMode }: { mode: 'car' | 'walk' | 'transit'; arriveText: string; onPressMode: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Pressable
        onPress={() => {
          haptic();
          onPressMode();
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          paddingHorizontal: 11,
          borderRadius: 11,
          backgroundColor: color.bg,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: color.primary }}>
          {MODE_TEXT[mode]}
        </Text>
        <Chevron size={6} thickness={1.6} color={color.primary} dir="down" style={{ marginTop: -3 }} />
      </Pressable>
      <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 14, color: color.muted }} numberOfLines={1}>
        {arriveText}
      </Text>
    </View>
  );
}

/** 어시스턴트 버블 공통 껍데기 — 좌측 정렬, R 20 20 20 8 */
function AssistantShell({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: 300,
        backgroundColor: color.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderBottomRightRadius: 20,
        borderBottomLeftRadius: 8,
        paddingVertical: 13,
        paddingHorizontal: 16,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
}

/** 어시스턴트 안내 버블 — 예시 문장 제시 */
function AssistantBubble({ mode }: { mode: 'car' | 'walk' | 'transit' }) {
  return (
    <AssistantShell>
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 20, color: color.body }}>
        들를 곳과 조건을 말하면 계획에 반영해 드려요. 한 문장이면 충분해요.
      </Text>
      <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 21, color: color.primary }}>
        “가는 길에 올리브영 들르고 빵도 사가고 싶어”
      </Text>
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
        {introCopy(mode)}
      </Text>
    </AssistantShell>
  );
}

/** 경로 탐색 확인 — 어시스턴트 질문 + 퀵리플라이 */
function CalculatePrompt({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <View style={{ gap: 10, alignSelf: 'flex-start' }}>
      <AssistantShell>
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, lineHeight: 21, color: color.body }}>
          조건은 준비됐어요. 이제 경로를 찾아볼까요?
        </Text>
      </AssistantShell>
      <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 4 }}>
        <Pressable
          onPress={() => {
            haptic();
            onYes();
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 20,
            borderRadius: 14,
            backgroundColor: color.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 15, color: '#fff' }}>
            좋아요, 경로 찾기
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic();
            onNo();
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 18,
            borderRadius: 14,
            backgroundColor: color.track,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 15, color: color.body }}>
            아직이요
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PlanScreen({ navigation }: Props) {
  const { state, pushChat, destinationDisplay, originDisplay, applyIntent, removeChip, narrowStop, resetChat } = usePlan();
  const flow = usePlanFlow();
  const insets = useSafeAreaInsets();
  const ds = state.dataset;
  const scrollRef = useRef<ScrollView>(null);
  const [modeOpen, setModeOpen] = useState(false);
  // '아직이요'로 미룬 시점의 대화 길이 — 새 메시지가 오면 다시 물어본다
  const [dismissedAt, setDismissedAt] = useState(-1);
  const promptVisible = state.chat.length > dismissedAt;
  // 탭한 정거장 칩 — 액션 시트(빼기/그대로 두기)를 띄운다
  const [chipMenu, setChipMenu] = useState<string | null>(null);

  // 슬롯 id는 칩 id와 같다(runPlan이 그렇게 낸다) — 마지막 실측 결과의 판정을 칩에 바로 되돌린다
  const statusOf = (chipId: string): SlotStatus | undefined => flow.state.result?.slotStatus[chipId];

  /* 채팅 → 의도 추출. 서버(LLM)를 부르고, 닿지 않으면 로컬 목으로 떨어진다.
     추출 결과는 아래 칩으로 그대로 드러난다 — 잘못 잡힌 걸 사용자가 봐야 한다 */
  const [reply, setReply] = useState<string | null>(null);
  /** 업종을 좁히는 되묻기. 고르거나 경유지가 바뀌면 사라진다 */
  const [narrowAsks, setNarrowAsks] = useState<{ field: string; question: string; options: string[] }[]>([]);
  const [pending, setPending] = useState(false);
  /** 목으로 떨어졌는지. 사용자에게 말해야 한다 — 같은 문장이 다음엔 다르게 잡힐 수 있으니까 */
  const [fellBack, setFellBack] = useState(false);
  /* 연속 전송이면 늦게 시작한 요청이 먼저 도착할 수 있다. 마지막 것만 반영한다 —
     계산 흐름의 runId 세대 가드와 같은 문제다(docs/NEXT.md) */
  const seqRef = useRef(0);

  const applyChat = (text: string) => {
    pushChat(text);
    const seq = (seqRef.current += 1);
    setPending(true);
    void flow
      .extract(text, {
        currentStops: state.stops.map(s => s.name),
        // 좌표를 아는 곳만 넘긴다 — 목적지 변경은 그 안에서만 적용된다(plan.tsx APPLY_INTENT)
        knownPlaces: RECENT_DESTINATIONS.map(r => r.name),
      })
      .then(({ intent, source }) => {
        if (seq !== seqRef.current) return; // 지나간 요청의 답은 버린다
        applyIntent(intent);
        flow.reset(); // 칩이 바뀌면 계산은 사용자가 다시 들어갈 때 — 자동 재계산 금지
        // options 를 방어적으로 읽는다 — intentClient.ts 는 서버 응답을 Intent로 그대로
        // 캐스팅하고, looksLikeIntent 도 ambiguous 원소별로는 들여다보지 않는다. Task 1의
        // 스키마가 아직 없는 배포된 Worker가 옛 모양({field, question})을 돌려주면
        // a.options 가 undefined라 .length 에서 던진다
        const narrow = intent.ambiguous.filter(a => a.field.startsWith('stop:') && (a.options ?? []).length > 0);
        /* 칩으로 그릴 되묻기는 이 한 줄에서 빼야 한다. 안 빼면 같은 질문이 칩 줄 위와
           되묻기 블록에 두 번 나오고, 선택지를 고른 뒤에도 위쪽 한 줄만 낡은 채 남는다
           (2026-09-15 시뮬레이터에서 실제로 그랬다) */
        const plain = intent.ambiguous.find(a => !narrow.includes(a));
        setReply(intent.reject?.say ?? plain?.question ?? null);
        setNarrowAsks(narrow);
        setFellBack(source === 'local');
        setPending(false);
      });
  };

  const startSearch = () => {
    navigation.navigate('Calculating');
  };

  /* 뒤로 나가면 대화가 사라진다 — 그러니 사라진다고 먼저 말한다.
     A1의 조건(목적지·이동수단·도착 시각)은 남기고 대화가 만든 것만 되돌린다.

     진입 시점의 조건을 여기서 잡아 둔다. 대화(APPLY_INTENT)가 이동수단·도착 시각까지
     바꿀 수 있어서, 칩만 지우고 조건을 남기면 "대화를 지웠다"고 해놓고 흔적이 남는다.
     첫 렌더 값이라 이후 setMode/setArriveBy 로 바뀌어도 스냅샷은 그대로다 — 헤더에서
     이동수단을 바꾼 것도 대화 중의 선택이라 같이 되돌린다. */
  const entryRef = useRef({ mode: state.mode, arriveByMin: state.arriveByMin });
  const [leaveOpen, setLeaveOpen] = useState(false);
  /* preventDefault 로 막아둔 이동을 나중에 그대로 다시 쏜다. 새로 navigate 하면
     제스처로 돌아가던 것이 push 가 돼 스택이 어긋난다 */
  const pendingLeave = useRef<NavigationAction | null>(null);
  /* 되돌린 뒤 다시 쏜 이동이 이 리스너를 또 타면 안 된다. state.chat 이 비었는지로
     판단하면 리스너가 잡아 둔 낡은 클로저를 볼 수 있어, 통과 여부를 ref 로 못박는다 */
  const leaving = useRef(false);

  /* 스와이프 백은 화면을 네이티브에서 먼저 없애고 JS 에 통보한다 — beforeRemove 의
     preventDefault 가 무시되고 콘솔에 남는 건 경고 한 줄뿐이다(2026-09-15 시뮬레이터
     실측: "The screen 'Plan' was removed natively but didn't get removed from JS
     state … not fully supported in native-stack"). 그러면 묻지도 않고 대화가 날아간다.
     그래서 물어봐야 할 때는 제스처 자체를 막고 헤더 back 으로만 나가게 한다 —
     버릴 게 없을 때는 원래대로 스와이프가 통한다 */
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: state.chat.length === 0 });
  }, [navigation, state.chat.length]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', e => {
        // 대화가 한 번도 없었으면 버릴 것도 없다 — 묻지 않고 보낸다
        if (leaving.current || state.chat.length === 0) return;
        /* 이 화면이 보이지 않을 때도 제거될 수 있다 — 탭바의 '계획'은 설정 화면에서
           navigate('Home') 이라, 위에 쌓인 화면들과 함께 이 화면까지 한 번에 팝한다.
           그때 막아 세우면 보이지도 않는 시트를 기다리며 이동이 멈춘다. 보낸 뒤
           조용히 되돌린다 — 화면이 사라지는데 대화만 남겨두면 다음에 들어왔을 때
           남의 대화처럼 보인다 */
        if (!navigation.isFocused()) {
          resetChat(entryRef.current);
          flow.reset();
          return;
        }
        e.preventDefault();
        pendingLeave.current = e.data.action;
        setLeaveOpen(true);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, state.chat.length],
  );

  const confirmLeave = () => {
    resetChat(entryRef.current);
    flow.reset();
    // 화면이 들고 있던 대화의 부산물도 같이 버린다 — 스토어만 비우면 되묻기·안내가 남는다
    setReply(null);
    setNarrowAsks([]);
    setFellBack(false);
    setPending(false);
    setDismissedAt(-1);
    setChipMenu(null);
    seqRef.current += 1; // 날아가 있는 추출 응답이 돌아와도 버린다
    setLeaveOpen(false);
    leaving.current = true;
    const action = pendingLeave.current;
    pendingLeave.current = null;
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  };

  /* 좁히기 질문은 아직 좁히기 질문에 답하지 않은 경유지만 가리킬 수 있다. 이미 좁혀진
     칩(narrowed:true)을 후보에서 빼지 않으면, 두 경유지가 같은 값으로 좁혀졌을 때
     나중 질문이 엉뚱한 쪽을 집는다 */
  const chipFor = (field: string) => {
    const q = field.slice('stop:'.length);
    return state.chips.find(c => c.kind === 'stop' && !c.narrowed && c.queries.includes(q));
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {/* 우측 '요약'은 동작이 없어 제거했다 — 누를 수 있어 보이는데 아무 일도 없으면 신뢰를 잃는다 */}
      <NavHeader title="계획 만들기" onBack={() => navigation.goBack()}>
        {/* 이름을 첫 단어로 자르지 않는다 — '내 위치'가 '내'가 되고
            'CGV 용산아이파크몰'이 'CGV'가 된다. 넘치면 말줄임으로 처리 */}
        <ConnectorCard directMin={ds.directMin} from={originDisplay} to={destinationDisplay} />
        {/* 조건 요약 — 이동수단은 여기서 바로 바꾼다. 계산은 '경로 찾기'부터라 되돌아갈 이유가 없다 */}
        <ConditionBar
          mode={state.mode}
          arriveText={
            state.arriveByMin == null
              ? '도착 시각 상관없음'
              : `오늘 ${toHHMM(state.arriveByMin).padStart(5, '0')}까지 도착`
          }
          onPressMode={() => setModeOpen(true)}
        />
      </NavHeader>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <AssistantBubble mode={state.mode} />
          {state.chat.map((msg, i) => (
            <Bubble key={i}>{msg}</Bubble>
          ))}
          {pending ? (
            /* 서버 왕복이 1~3초다. 빈 화면으로 두면 먹통으로 읽힌다 */
            <AssistantShell>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, lineHeight: 21, color: color.muted }}>
                알아듣는 중이에요…
              </Text>
            </AssistantShell>
          ) : (
            state.chat.length > 0 && (
              <AssistantShell>
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, lineHeight: 21, color: color.body }}>
                  {reply ?? '이렇게 알아들었어요. 틀린 건 지워주세요.'}
                </Text>
                {fellBack && (
                  /* A5의 '서버 없이 추정한 값이에요'와 같은 약속 — 추정이면 추정이라고 말한다 */
                  <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
                    서버에 닿지 못해 간단한 규칙으로 알아들었어요
                  </Text>
                )}
              </AssistantShell>
            )
          )}

          {/* 알아들은 것을 그대로 보여준다 — 이게 없으면 잘못 잡혀도 경로 3개가
              멀쩡히 나와서 사용자는 뭐가 빠졌는지 끝까지 모른다 */}
          {state.chips.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {state.chips.map(chip => (
                <Pressable
                  key={chip.id}
                  onPress={() => {
                    haptic();
                    if (chip.kind === 'stop') {
                      setChipMenu(chip.id);
                    } else {
                      removeChip(chip.id);
                      flow.reset(); // 칩이 바뀌면 계산은 사용자가 다시 들어갈 때 — 자동 재계산 금지
                    }
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 7,
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    backgroundColor: chip.kind === 'stop' ? color.primaryTint : color.surface,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily: 'Pretendard-SemiBold',
                      fontSize: 14,
                      lineHeight: 17,
                      color: chip.kind === 'stop' ? color.primary : color.body,
                    }}
                  >
                    {chip.label}
                    {chip.kind === 'stop' && statusOf(chip.id) && statusOf(chip.id) !== 'ok'
                      ? ` · ${SLOT_STATUS_TEXT[statusOf(chip.id)!]}`
                      : ''}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'Pretendard-Medium',
                      fontSize: 15,
                      lineHeight: 15,
                      color: chip.kind === 'stop' ? color.primary : color.placeholder,
                    }}
                  >
                    ✕
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* 업종 되묻기 — 정거장 칩과 헷갈리지 않게 ✕ 없는 중립색 칩을 쓴다.
              탭 = 고르기이지 지우기가 아니다 */}
          {narrowAsks.map(ask => {
            const chip = chipFor(ask.field);
            if (!chip) return null; // 이미 지운 경유지면 되묻기도 그리지 않는다
            return (
              <View key={ask.field} style={{ gap: 8, alignSelf: 'flex-start' }}>
                <AssistantShell>
                  <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, lineHeight: 21, color: color.body }}>
                    {ask.question}
                  </Text>
                </AssistantShell>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 4 }}>
                  {ask.options.map(option => (
                    <Pressable
                      key={option}
                      onPress={() => {
                        haptic();
                        if (option === '상관없어요') {
                          // 검색어는 그대로 둔다 — 로그도, 재계산도 없다
                          setNarrowAsks(prev => prev.filter(a => a.field !== ask.field));
                          return;
                        }
                        narrowStop(chip.id, option);
                        flow.reset(); // 검색어가 바뀌면 계산은 사용자가 다시 들어갈 때 — 자동 재계산 금지
                        setNarrowAsks(prev => prev.filter(a => a.field !== ask.field));
                      }}
                      style={({ pressed }) => ({
                        minHeight: 38,
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 14,
                        backgroundColor: color.track,
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 17, color: color.body }}>
                        {option}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}

          {promptVisible && (
            <CalculatePrompt onYes={startSearch} onNo={() => setDismissedAt(state.chat.length)} />
          )}
        </ScrollView>

        <BottomInputBar
          placeholder="조건을 더 말해보세요"
          autoFocus
          onSubmit={applyChat}
        />
      </KeyboardAvoidingView>
      <TabBar />

      <ModeSheet visible={modeOpen} onClose={() => setModeOpen(false)} />

      {/* 뒤로 나가기 확인 — 대화를 버린다고 먼저 말한다. 헤더 back·스와이프·하드웨어 back 공용 */}
      <Sheet visible={leaveOpen} onClose={() => setLeaveOpen(false)}>
        <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={[type.titleL, { color: color.ink }]}>대화를 지우고 나갈까요?</Text>
            {/* 되돌리는 범위를 있는 그대로 쓴다 — 헤더에서 바꾼 이동수단도 대화 전으로
                돌아가므로 "계산 조건은 그대로"라고 하면 거짓말이 된다 */}
            <Text style={[type.body, { color: color.muted }]}>
              대화와 알아들은 경유지가 사라지고, 계산 조건도 대화 전으로 돌아가요. 목적지는 그대로예요.
            </Text>
          </View>
          <PrimaryButton label="지우고 나가기" height={54} borderRadius={16} onPress={confirmLeave} />
          <Pressable
            onPress={() => {
              haptic();
              pendingLeave.current = null;
              setLeaveOpen(false);
            }}
            style={{ minHeight: 52, borderRadius: 16, backgroundColor: color.track, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[type.btn, { color: color.body }]}>계속 쓸게요</Text>
          </Pressable>
        </View>
      </Sheet>

      {/* 정거장 칩 액션 시트 — 뺄지 그대로 둘지. 판정(마감 초과 등)은 A5가 실측으로 한다 */}
      <Sheet visible={!!chipMenu} onClose={() => setChipMenu(null)}>
        <View style={{ padding: 20, gap: 10 }}>
          <Text style={[type.titleL, { color: color.ink }]}>{state.chips.find(c => c.id === chipMenu)?.label}</Text>
          {chipMenu && statusOf(chipMenu) && statusOf(chipMenu) !== 'ok' && (
            <Text style={[type.body, { color: color.muted }]}>{SLOT_STATUS_HELP[statusOf(chipMenu)!]}</Text>
          )}
          <PrimaryButton
            label="이 경유지 빼기"
            height={52}
            borderRadius={16}
            onPress={() => {
              if (chipMenu) removeChip(chipMenu);
              flow.reset(); // 칩이 바뀌면 계산은 사용자가 다시 들어갈 때 — 자동 재계산 금지
              setChipMenu(null);
            }}
          />
          <Pressable
            onPress={() => {
              haptic();
              setChipMenu(null);
            }}
            style={{ minHeight: 52, borderRadius: 16, backgroundColor: color.track, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[type.btn, { color: color.body }]}>그대로 둘게요</Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}
