/** A1 — 홈: 출발(현재 위치)·목적지·이동수단·도착 목표 시각을 먼저 받는다 */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, shadow, type } from '../theme/tokens';
import { MODE_KEYS, MODE_TEXT, usePlan } from '../state/plan';
import { useCurrentPlace } from '../lib/currentPlace';
import { Card, haptic, PrimaryButton, SegmentControl } from '../components/common';
import { Chevron, Hairline, PinIcon, SwapIcon } from '../components/primitives';
import { TabBar } from '../components/TabBar';
import { Sheet } from '../components/Sheet';
import { DevSheet } from '../sheets/DevSheet';
import { ArriveBySheet } from '../sheets/ArriveBySheet';
import { DestinationSheet } from '../sheets/DestinationSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const MODES = MODE_KEYS.map(k => MODE_TEXT[k]);

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { state, setMode, arriveByLabel, swapEndpoints, resetChat } = usePlan();
  const here = useCurrentPlace();
  const [devOpen, setDevOpen] = useState(false);
  const [arriveOpen, setArriveOpen] = useState(false);
  const [destOpen, setDestOpen] = useState(false);
  const [originOpen, setOriginOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  // 목적지 미지정 상태에서 채팅을 시작하면, 목적지부터 고르게 한 뒤 이어서 이동
  const [continueAfterPick, setContinueAfterPick] = useState(false);

  /*
    A2로 들어간다 — 지난 대화를 여기서 지운다.

    원래는 A2가 **나갈 때** `beforeRemove` 에서 지웠다. 그 훅은 믿을 수 없다:
    탭바의 '진행중'은 A2 위에 화면을 얹을 뿐이라 A2가 제거되지 않아 훅이 아예 안 뛴다
    (2026-09-16 시뮬레이터 실측: 재진입까지 beforeRemove 0회 · unmount 0회).
    그러면 새 계획을 시작해도 남의 대화가 먼저 서 있다.

    나가는 길을 전부 막는 대신 들어오는 길에서 지운다 — 들어오는 길은 여기 하나뿐이고,
    '새로 만든다'는 뜻이 분명한 자리다. A5·A6의 '대화로 고치기'는 이 함수를 타지 않으므로
    고치던 대화는 그대로 살아 있다.

    `beforeRemove` 는 남겨둔다 — 거기서 묻는 "대화를 버릴까요?"는 여전히 필요하고,
    칩·조건 되돌리기도 그쪽 몫이다.
  */
  const enterChat = () => {
    // 새 계획을 시작한다 = 이전 대화를 버린다. 확정돼 있어도 지운다
    resetChat({ mode: state.mode, arriveByMin: state.arriveByMin }, 'startingNewPlan');
    navigation.navigate('Plan');
  };

  const proceedToChat = () => {
    if (!state.destinationName) {
      setContinueAfterPick(true);
      setDestOpen(true);
      return;
    }
    enterChat();
  };

  /*
    기본은 GPS로 잡은 '내 위치'. 다만 항상 지금 있는 곳에서 출발하는 건 아니라서
    (내일 아침 계획을 미리 짠다든가) 눌러서 다른 출발지를 고를 수 있게 열어뒀다.
  */
  const originTitle = state.originName ?? (here.status === 'denied' ? '위치 권한이 필요해요' : '내 위치');
  const originSub = state.originName
    ? '눌러서 바꾸거나 내 위치로 되돌릴 수 있어요'
    : here.status === 'ready'
      ? here.address ?? '주소를 찾지 못했어요'
      : here.status === 'denied'
        ? '설정에서 위치 접근을 허용해 주세요'
        : here.status === 'error'
          ? '위치를 가져오지 못했어요'
          : '위치 확인 중…';

  const startChat = () => {
    // 확정된 계획이 있으면 교체 여부부터 확인
    if (state.planConfirmed) {
      setReplaceOpen(true);
      return;
    }
    proceedToChat();
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 6, paddingHorizontal: 20, paddingBottom: 12, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 위치 + 타이틀 (설정은 하단 '더보기'로 옮겼다. 타이틀 길게 누르면 개발 메뉴) */}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <PinIcon />
            {/* 시각은 여기 말고 도착 목표 시트에서 보여준다 — 마감을 고를 때만 필요한 정보다 */}
            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 14, lineHeight: 21, color: color.muted }}>
              {here.area ? `현재 위치 ${here.area}` : '현재 위치 확인 중'}
            </Text>
          </View>
          <Pressable onLongPress={() => setDevOpen(true)} delayLongPress={600}>
            <Text style={[type.display, { color: color.ink }]}>오늘의 길을 그려볼까요?</Text>
          </Pressable>
        </View>

        {/* 출발–목적지 카드 (각 행 탭 → 선택 시트, 경계선 위 버튼으로 맞바꾸기) */}
        <Card style={{ paddingVertical: 4 }}>
          <EndpointRow
            kind="origin"
            label={state.originName ? '출발' : '출발 · 현재 위치'}
            title={originTitle}
            sub={originSub}
            onPress={() => {
              haptic();
              setOriginOpen(true);
            }}
          />
          {/* 경계선은 아이콘 뒤에서 시작한다. 맞바꾸기 버튼은 그 선 위, 두 행의 정확한 가운데 */}
          <View style={{ justifyContent: 'center', marginLeft: 60 }}>
            <Hairline />
            <Pressable
              // 목적지가 비어 있으면 바꿀 게 없다
              disabled={!state.destinationName}
              onPress={() => {
                haptic();
                swapEndpoints();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => ({
                position: 'absolute',
                right: 16,
                alignSelf: 'center',
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: color.surface,
                borderWidth: 1,
                borderColor: color.track,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: !state.destinationName ? 0.35 : pressed ? 0.6 : 1,
              })}
            >
              <SwapIcon size={18} tint={color.body} />
            </Pressable>
          </View>
          <EndpointRow
            kind="destination"
            label="최종 목적지"
            title={state.destinationName ?? '최종 목적지를 입력하세요'}
            empty={!state.destinationName}
            onPress={() => {
              haptic();
              setContinueAfterPick(false);
              setDestOpen(true);
            }}
          />
        </Card>

        {/* 계산 조건 — 이동수단 + 도착 목표 시각 */}
        <View style={{ gap: 10 }}>
          <Text style={[type.label, { color: color.muted }]}>계산 조건</Text>
          <Card style={{ padding: 16, gap: 14 }}>
            <View style={{ gap: 8 }}>
              <Text style={[type.labelPlain, { color: color.muted }]}>이동수단</Text>
              <SegmentControl
                options={[...MODES]}
                value={MODE_KEYS.indexOf(state.mode)}
                onChange={i => setMode(MODE_KEYS[i])}
              />
              {/* 지도 앱이 대중교통 경유지를 못 받는 건 구조적 한계다. 뒤늦게 알면 배신감이 드니 고를 때 미리 말한다 */}
              {state.mode === 'transit' && (
                <View style={{ flexDirection: 'row', gap: 7, paddingTop: 1 }}>
                  <View
                    style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color.stroke, marginTop: 7 }}
                  />
                  <Text
                    style={{ flex: 1, fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}
                  >
                    대중교통은 지도 앱이 경유지를 못 받아요. 대신 도착할 때마다 다음 구간을 하나씩 열어드려요.
                  </Text>
                </View>
              )}
            </View>
            <Hairline />
            <View style={{ gap: 9 }}>
              <Text style={[type.labelPlain, { color: color.muted }]}>도착 목표 시각</Text>
              <Pressable
                onPress={() => {
                  haptic();
                  setArriveOpen(true);
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 13,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  backgroundColor: color.bg,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: 'Pretendard-SemiBold',
                      fontSize: 17,
                      color: state.arriveByMin == null ? color.placeholder : color.ink,
                    }}
                  >
                    {arriveByLabel}
                  </Text>
                  {state.arriveByMin != null && (
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, color: color.muted }}>
                      {' '}· 30분 단위
                    </Text>
                  )}
                </Text>
                <Chevron size={9} thickness={2} color={color.muted} dir="down" style={{ marginTop: -4 }} />
              </Pressable>
            </View>
          </Card>
        </View>

        {/* 채팅으로 이어지는 진입 버튼 — 계산 조건 바로 아래 */}
        <PrimaryButton label="계획 만들기" chevron height={56} borderRadius={18} onPress={startChat} />
      </ScrollView>
      <TabBar />

      <DevSheet visible={devOpen} onClose={() => setDevOpen(false)} />
      <ArriveBySheet visible={arriveOpen} onClose={() => setArriveOpen(false)} />

      {/* 진행 중인 계획이 있을 때 새 계획 시작 확인 */}
      <Sheet visible={replaceOpen} onClose={() => setReplaceOpen(false)}>
        <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
          <View style={{ gap: 6 }}>
            <Text style={[type.titleL, { color: color.ink }]}>오늘 계획을 바꿀까요?</Text>
            <Text style={[type.body, { color: color.muted }]}>
              진행 중인 계획이 있어요. 새 경로를 확정하면 지금 계획이 대체돼요.
            </Text>
          </View>
          <PrimaryButton
            label="새로 계획하기"
            height={54}
            borderRadius={16}
            onPress={() => {
              setReplaceOpen(false);
              proceedToChat();
            }}
          />
          <Pressable
            onPress={() => {
              haptic();
              setReplaceOpen(false);
              navigation.navigate('Today');
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
            <Text style={[type.btn, { color: color.body }]}>진행 중인 계획 보기</Text>
          </Pressable>
        </View>
      </Sheet>
      <DestinationSheet target="origin" visible={originOpen} onClose={() => setOriginOpen(false)} />
      <DestinationSheet
        visible={destOpen}
        onClose={() => setDestOpen(false)}
        onPicked={() => {
          if (continueAfterPick) {
            setContinueAfterPick(false);
            enterChat();
          }
        }}
      />
    </View>
  );
}

/** 출발·도착 한 행 — 왼쪽 표식(출발 링 / 도착 점) + 라벨·이름·부제 + 오른쪽 화살표 */
function EndpointRow({
  kind,
  label,
  title,
  sub,
  empty,
  onPress,
}: {
  kind: 'origin' | 'destination';
  label: string;
  title: string;
  sub?: string;
  /** 아직 고르지 않음 — 이름을 자리표시 색으로 */
  empty?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 14,
        paddingLeft: 18,
        paddingRight: 16,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: kind === 'origin' ? color.primaryTint : color.greenBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {kind === 'origin' ? (
          <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: color.primary }} />
        ) : (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.green }} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 11, lineHeight: 13, color: color.muted, letterSpacing: 0.2 }}>
          {label}
        </Text>
        <Text
          style={{
            fontFamily: 'Pretendard-SemiBold',
            fontSize: 17,
            lineHeight: 22,
            letterSpacing: -0.2,
            color: empty ? color.placeholder : color.ink,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {sub ? (
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Chevron size={8} thickness={1.8} color={color.stroke} dir="right" />
    </Pressable>
  );
}
