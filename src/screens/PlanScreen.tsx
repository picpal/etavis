/** A2 — 자연어 입력 (채팅 전용). 조건은 A1에서 받고 헤더에 요약만 표시.
 *  경로 계산은 어시스턴트가 묻고 퀵리플라이로 확정한다. */
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { arriveByText, toHHMM, usePlan } from '../state/plan';
import { Bubble, haptic, MicroLabelRow, PrimaryButton } from '../components/common';
import { Sheet } from '../components/Sheet';
import { DottedLineH } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
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
function AssistantBubble() {
  return (
    <AssistantShell>
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 20, color: color.body }}>
        들를 곳과 조건을 말하면 계획에 반영해 드려요. 한 문장이면 충분해요.
      </Text>
      <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 21, color: color.primary }}>
        “가는 길에 올리브영 들르고 빵도 사가고 싶어”
      </Text>
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
        직선거리가 아니라 실제 소요시간으로 계산해요
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
  const { state, pushChat, destinationDisplay, originDisplay, setArriveBy } = usePlan();
  const ds = state.dataset;
  const scrollRef = useRef<ScrollView>(null);
  // '아직이요'로 미룬 시점의 대화 길이 — 새 메시지가 오면 다시 물어본다
  const [dismissedAt, setDismissedAt] = useState(-1);
  const promptVisible = state.chat.length > dismissedAt;

  /*
    경로를 찾기 전에 '애초에 가능한 시간인가'부터 답한다.
    들를 곳 없이 직행으로만 가도 마감을 넘긴다면, 어떤 경로를 찾아도 소용없다.
    이 앱이 하는 일이 시간 타당성 판단이니 그 답이 제일 먼저 나와야 한다.
  */
  const [impossible, setImpossible] = useState<{ arriveMin: number; overMin: number } | null>(null);

  const startSearch = () => {
    if (state.arriveByMin != null) {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const arriveMin = nowMin + ds.directMin;
      if (arriveMin > state.arriveByMin) {
        setImpossible({ arriveMin, overMin: arriveMin - state.arriveByMin });
        return;
      }
    }
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
          <AssistantBubble />
          {state.chat.map((msg, i) => (
            <Bubble key={i}>{msg}</Bubble>
          ))}
          {state.chat.length > 1 && (
            <AssistantShell>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 15, lineHeight: 21, color: color.body }}>
                반영했어요. 조건이 바뀌면 경로도 달라져요.
              </Text>
            </AssistantShell>
          )}
          {promptVisible && (
            <CalculatePrompt onYes={startSearch} onNo={() => setDismissedAt(state.chat.length)} />
          )}
        </ScrollView>

        <BottomInputBar
          placeholder="조건을 더 말해보세요"
          autoFocus
          onSubmit={text => pushChat(text)}
        />
      </KeyboardAvoidingView>
      <TabBar />

      {/* 직행으로도 마감을 못 맞추는 경우 — 경로를 찾기 전에 먼저 말한다 */}
      <Sheet visible={!!impossible} onClose={() => setImpossible(null)}>
        {impossible && (
          <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}>
            <View style={{ gap: 6 }}>
              <Text style={[type.titleL, { color: color.ink }]}>지금 출발해도 늦어요</Text>
              <Text style={[type.body, { color: color.muted }]}>
                들르는 곳 없이 곧장 가도 {arriveByText(impossible.arriveMin).replace('까지', '')} 도착이라,
                목표보다 {impossible.overMin}분 넘겨요. 경유지를 넣으면 더 늦어집니다.
              </Text>
            </View>

            <MicroLabelRow
              items={[
                { label: '직행', value: `${ds.directMin}분` },
                { label: '도착 예정', value: toHHMM(impossible.arriveMin).padStart(5, '0') },
                { label: '초과', value: `+${impossible.overMin}분`, tint: color.amberDeep },
              ]}
            />

            <PrimaryButton
              label="도착 시각 다시 정하기"
              height={54}
              borderRadius={16}
              onPress={() => {
                setImpossible(null);
                setArriveBy(null);
                navigation.goBack();
              }}
            />
            <Pressable
              onPress={() => {
                haptic();
                setImpossible(null);
                navigation.navigate('Calculating');
              }}
              style={({ pressed }) => ({
                minHeight: 54,
                borderRadius: 16,
                backgroundColor: color.track,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={[type.btn, { color: color.body }]}>그래도 경로 찾기</Text>
            </Pressable>
          </View>
        )}
      </Sheet>
    </View>
  );
}
