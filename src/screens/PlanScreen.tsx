/** A2 — 자연어 입력 (채팅 전용). 조건은 A1에서 받고 헤더에 요약만 표시.
 *  경로 계산은 어시스턴트가 묻고 퀵리플라이로 확정한다. */
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { toHHMM, usePlan } from '../state/plan';
import { RECENT_DESTINATIONS } from '../data/mockData';
import { Bubble, haptic, PrimaryButton } from '../components/common';
import { Sheet } from '../components/Sheet';
import { DottedLineH } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import { usePlanFlow } from '../state/planFlowProvider';
import { SLOT_STATUS_HELP, SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import { introCopy } from '../lib/timingCopy';
import type { SlotStatus } from '../lib/routePlan/types';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

const MODE_LABELS = { car: '자동차', walk: '도보', transit: '대중교통' } as const;

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
  const { state, pushChat, destinationDisplay, originDisplay, applyIntent, removeChip } = usePlan();
  const flow = usePlanFlow();
  const ds = state.dataset;
  const scrollRef = useRef<ScrollView>(null);
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
        setReply(intent.reject?.say ?? intent.ambiguous[0]?.question ?? null);
        setFellBack(source === 'local');
        setPending(false);
      });
  };

  const startSearch = () => {
    navigation.navigate('Calculating');
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {/* 우측 '요약'은 동작이 없어 제거했다 — 누를 수 있어 보이는데 아무 일도 없으면 신뢰를 잃는다 */}
      <NavHeader title="계획 만들기" onBack={() => navigation.goBack()}>
        {/* 이름을 첫 단어로 자르지 않는다 — '내 위치'가 '내'가 되고
            'CGV 용산아이파크몰'이 'CGV'가 된다. 넘치면 말줄임으로 처리 */}
        <ConnectorCard directMin={ds.directMin} from={originDisplay} to={destinationDisplay} />
        {/* A1에서 받은 조건 요약 */}
        <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, color: color.muted, textAlign: 'center' }}>
          {MODE_LABELS[state.mode]} ·{' '}
          {state.arriveByMin == null
            ? '도착 시각 상관없음'
            : `오늘 ${toHHMM(state.arriveByMin).padStart(5, '0')}까지 도착`}
        </Text>
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
