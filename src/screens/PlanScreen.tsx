/** A2 — 자연어 입력 (채팅 전용). 조건은 A1에서 받고 헤더에 요약만 표시.
 *  경로 계산은 어시스턴트가 묻고 퀵리플라이로 확정한다. */
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NavigationAction } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, HIT_SLOP, type } from '../theme/tokens';
import { arriveByText, MODE_TEXT, usePlan } from '../state/plan';
import { knownPlacesSnapshot } from '../lib/placesStore';
import { Bubble, haptic, PrimaryButton } from '../components/common';
import { Sheet } from '../components/Sheet';
import { calcPromptVisible } from '../state/chatPrompt';
import { Chevron, DottedLineH, SparkIcon } from '../components/primitives';
import { ModeSheet } from '../sheets/ModeSheet';
import { NarrowAskSheet } from '../sheets/NarrowAskSheet';
import { answerAsk, askForChip, asksForSheet, type NarrowAsk } from '../state/narrowAsk';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import { usePlanFlow } from '../state/planFlowProvider';
import { SLOT_STATUS_HELP, SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import { introCopy } from '../lib/timingCopy';
import { getPref, setPref } from '../lib/prefs';
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

/**
 * 어시스턴트 안내 버블 — 예시 문장 제시.
 *
 * 처음 온 사람에게는 이 카드가 사용법 전부다. 하지만 두 번째부터는 같은 글이 대화 맨 위를
 * 차지하고 앉아, 정작 읽어야 할 내 말과 알아들은 결과를 아래로 민다.
 *
 * 그래서 한 번 본 사람에게는 접어서 버튼 하나로 둔다. **없애지는 않는다** — 예시 문장은
 * "무엇을 말해도 되나"를 알려주는 유일한 자리라, 찾으면 나와야 한다.
 *
 * 펼친 상태는 이 화면에서만 산다. 다음에 다시 들어오면 접힌 채로 시작한다 — 한 번 접은
 * 사람에게 매번 다시 펼쳐 보이면 접은 뜻이 없다.
 */
function AssistantBubble({ mode }: { mode: 'car' | 'walk' | 'transit' }) {
  const [open, setOpen] = useState(() => !getPref('tipSeen'));

  /* '봤다'는 첫 렌더에 펼쳐져 있었는지로 정한다 — 눌러서 펼친 건 '처음 봄'이 아니다.
     그래서 open 이 아니라 빈 배열에 건다 */
  useEffect(() => {
    if (open) setPref('tipSeen', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    haptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(v => !v);
  };

  if (!open) {
    return (
      <Pressable
        onPress={toggle}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="팁 보기"
        style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingVertical: 9,
            paddingHorizontal: 13,
            // 알약 모양 — 버블(카드)과 종류가 다르다는 걸 모양으로 먼저 말한다
            borderRadius: 999,
            backgroundColor: color.surface,
          }}
        >
          <SparkIcon size={14} />
          {/* 라벨은 `Tip` — 한글 두 단어보다 짧아 대화 맨 위에서 자리를 덜 먹는다 */}
          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.primary }}>
            Tip
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <AssistantShell>
        {/* 접기 단추는 글에 겹치지 않게 오른쪽 위 모서리. 버블 폭이 좁아 안쪽에 두면 줄이 밀린다 */}
        <View style={{ paddingRight: 22 }}>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 20, color: color.body }}>
            들를 곳과 조건을 말하면 계획에 반영해 드려요. 한 문장이면 충분해요.
          </Text>
        </View>
        <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 21, color: color.primary }}>
          “가는 길에 올리브영 들르고 빵도 사가고 싶어”
        </Text>
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
          {introCopy(mode)}
        </Text>
      </AssistantShell>
      <Pressable
        onPress={toggle}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel="팁 접기"
        style={({ pressed }) => ({
          position: 'absolute',
          top: 9,
          right: 9,
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: color.bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Chevron size={7} thickness={2} color={color.stroke} dir="up" style={{ marginTop: 2 }} />
      </Pressable>
    </View>
  );
}

/**
 * 아직 아무 말도 안 했을 때의 '바로 찾기'.
 *
 * 전에는 이 자리에도 어시스턴트 말풍선이 "조건은 준비됐어요. 이제 경로를 찾아볼까요?"
 * 하고 떠 있었다. 듣지도 않고 준비됐다고 말하는 셈이라 앞뒤가 안 맞았고, 옆의 `아직이요`는
 * 미룰 대화가 없는데 미루라고 했다.
 *
 * 말풍선을 지우고 조용한 줄 하나만 남긴다. 대화가 없는 화면에서 어시스턴트가 먼저 말을
 * 거는 것 자체가 없는 대화를 지어내는 일이다. 직행으로 가는 길은 그대로 열어 둔다 —
 * 들를 곳이 없는 사람에게는 이 화면에서 할 일이 그것뿐이다(chatPrompt.ts 주석).
 */
function DirectPrompt({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic();
        onPress();
      }}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      /* 퀵리플라이와 같은 규격(44 / 18 / r14 / track) — 이 화면에 이미 있는 버튼 모양을
         또 만들지 않는다. 다만 글자는 primary 다. `아직이요` 는 미루는 버튼이라 회색이고,
         이건 지금 할 수 있는 단 하나의 행동이라 회색으로 두면 꺼진 것처럼 읽힌다 */
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 18,
        borderRadius: 14,
        backgroundColor: color.track,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 15, color: color.primary }}>
        들를 곳 없이 바로 찾기
      </Text>
      <Chevron size={7} thickness={2} color={color.primary} dir="right" />
    </Pressable>
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
  // 탭한 정거장 칩 — 액션 시트(빼기/그대로 두기)를 띄운다
  const [chipMenu, setChipMenu] = useState<string | null>(null);

  // 슬롯 id는 칩 id와 같다(runPlan이 그렇게 낸다) — 마지막 실측 결과의 판정을 칩에 바로 되돌린다
  const statusOf = (chipId: string): SlotStatus | undefined => flow.state.result?.slotStatus[chipId];

  /* 채팅 → 의도 추출. 서버(LLM)를 부르고, 닿지 않으면 로컬 목으로 떨어진다.
     추출 결과는 아래 칩으로 그대로 드러난다 — 잘못 잡힌 걸 사용자가 봐야 한다 */
  const [reply, setReply] = useState<string | null>(null);
  /** 업종을 좁히는 되묻기. 고르거나 경유지가 바뀌면 사라진다 */
  const [narrowAsks, setNarrowAsks] = useState<NarrowAsk[]>([]);
  /* 지금 시트에 떠 있는 질문. 큐(`narrowAsks`)와 따로 두는 이유: 닫아도 질문은 남는다 —
     경유지 칩을 눌러 다시 열 수 있어야 하고, 그때는 [0]이 아니라 그 칩의 질문을 연다 */
  const [askField, setAskField] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const promptVisible = calcPromptVisible({ pending, chatLength: state.chat.length, dismissedAt });
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
        knownPlaces: knownPlacesSnapshot().map(p => p.name),
      })
      .then(({ intent, source }) => {
        if (seq !== seqRef.current) return; // 지나간 요청의 답은 버린다
        applyIntent(intent, source);
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
        /* 되묻기는 채팅에 그리지 않고 시트로 올린다 — 안내 멘트와 버튼 줄이 겹겹이
           쌓이면 정작 물어본 것이 묻힌다. 첫 질문을 바로 띄우고 나머지는 큐에 둔다 */
        const forSheet = asksForSheet(narrow);
        setNarrowAsks(forSheet);
        setAskField(forSheet[0]?.field ?? null);
        setFellBack(source === 'local');
        setPending(false);
      });
  };

  const startSearch = () => {
    /* 프롬프트를 숨기는 것만으로는 부족하다 — 방어가 화면 한 곳뿐이면, 이 핸들러를
       부르는 다른 호출부가 생겼을 때 추출 중인 칩으로 계산이 시작된다 */
    if (pending) return;
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
    setAskField(null);
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

  /* 지금 시트에 떠 있는 질문. 큐에서 사라졌으면(답했으면) 시트도 닫힌다 */
  const openAsk = narrowAsks.find(a => a.field === askField) ?? null;
  /* 칩 메뉴를 연 칩에 아직 답 안 한 되묻기가 있나 — 있으면 거기서 다시 열 수 있다 */
  const menuChip = state.chips.find(c => c.id === chipMenu);
  const menuAsk = menuChip ? askForChip(narrowAsks, menuChip) : undefined;

  const pickAnswer = (option: string) => {
    if (!openAsk) return;
    const { narrowTo, asks } = answerAsk(narrowAsks, openAsk, option);
    if (narrowTo) {
      const target = state.chips.find(c => askForChip([openAsk], c));
      if (target) {
        narrowStop(target.id, narrowTo);
        flow.reset(); // 검색어가 바뀌면 계산은 사용자가 다시 들어갈 때 — 자동 재계산 금지
      }
    }
    setNarrowAsks(asks);
    // 남은 질문이 있으면 시트를 닫지 않고 다음 질문으로 넘어간다
    setAskField(asks[0]?.field ?? null);
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
          /* 표기는 arriveByText 하나로 — 여기서 '오늘'을 직접 붙이던 때는 A1 시트가
             '내일 03:00까지'라고 고른 마감을 이 헤더가 '오늘 03:00까지'라고 했다
             (2026-09-15 시뮬레이터). 자정을 넘긴 값은 1440 이상으로 들어온다 */
          arriveText={state.arriveByMin == null ? '도착 시각 상관없음' : `${arriveByText(state.arriveByMin)} 도착`}
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
                    {/* 아직 답 안 한 되묻기가 있다는 표식. 시트를 닫아도 질문이 어디 있는지
                        알 수 있어야 한다 — 표식이 없으면 닫는 순간 질문이 사라진 것처럼 보인다 */}
                    {askForChip(narrowAsks, chip) ? ' ▾' : ''}
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

          {promptVisible &&
            (state.chat.length === 0 ? (
              /* 말이 오간 뒤에야 "조건은 준비됐어요"가 참이 된다. 그 전에는 조용한 줄 하나 */
              <DirectPrompt onPress={startSearch} />
            ) : (
              <CalculatePrompt onYes={startSearch} onNo={() => setDismissedAt(state.chat.length)} />
            ))}
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
          {/* 되묻기를 닫아도 여기서 되살릴 수 있다. 시트를 닫는 순간 질문이 영영
              사라지면, 표식(▾)만 남고 누를 곳이 없다 */}
          {menuAsk && (
            <Pressable
              onPress={() => {
                haptic();
                setChipMenu(null);
                setAskField(menuAsk.field);
              }}
              style={{ minHeight: 52, borderRadius: 16, backgroundColor: color.primaryTint, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={[type.btn, { color: color.primary }]}>{menuAsk.question}</Text>
            </Pressable>
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

      {/* 업종 되묻기 — 닫아도 질문은 큐에 남는다. 칩의 ▾ 를 눌러 다시 연다 */}
      <NarrowAskSheet ask={openAsk} onPick={pickAnswer} onClose={() => setAskField(null)} />
    </View>
  );
}
