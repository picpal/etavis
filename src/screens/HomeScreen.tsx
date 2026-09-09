/** A1 — 홈: 출발(현재 위치)·목적지·이동수단·도착 목표 시각을 먼저 받는다 */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, shadow, type } from '../theme/tokens';
import { usePlan } from '../state/plan';
import { useCurrentPlace } from '../lib/currentPlace';
import { Card, haptic, PrimaryButton, SegmentControl } from '../components/common';
import { Chevron, DashedLineV, Hairline, PinIcon, SwapIcon } from '../components/primitives';
import { TabBar } from '../components/TabBar';
import { Sheet } from '../components/Sheet';
import { DevSheet } from '../sheets/DevSheet';
import { ArriveBySheet } from '../sheets/ArriveBySheet';
import { DestinationSheet } from '../sheets/DestinationSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const MODES = ['자동차', '도보', '대중교통'] as const;
const MODE_KEYS = ['car', 'walk', 'transit'] as const;

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { state, setMode, arriveByLabel, swapEndpoints } = usePlan();
  const here = useCurrentPlace();
  const [devOpen, setDevOpen] = useState(false);
  const [arriveOpen, setArriveOpen] = useState(false);
  const [destOpen, setDestOpen] = useState(false);
  const [originOpen, setOriginOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  // 목적지 미지정 상태에서 채팅을 시작하면, 목적지부터 고르게 한 뒤 이어서 이동
  const [continueAfterPick, setContinueAfterPick] = useState(false);

  const proceedToChat = () => {
    if (!state.destinationName) {
      setContinueAfterPick(true);
      setDestOpen(true);
      return;
    }
    navigation.navigate('Plan');
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
            <Text style={[type.display, { color: color.ink }]}>어디로 가시나요?</Text>
          </Pressable>
        </View>

        {/* 출발–목적지 카드 (각 행 탭 → 선택 시트, 우측 아이콘으로 맞바꾸기) */}
        <Card style={{ padding: 18, flexDirection: 'row', gap: 14 }}>
          <View style={{ width: 12, alignItems: 'center', paddingVertical: 6 }}>
            <View style={{ width: 11, height: 11, borderRadius: 5.5, borderWidth: 3, borderColor: color.primary }} />
            <DashedLineV style={{ flex: 1, marginVertical: 6 }} />
            <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: color.ink }} />
          </View>
          <View style={{ flex: 1, gap: 14, paddingRight: 54 }}>
            <Pressable
              onPress={() => {
                haptic();
                setOriginOpen(true);
              }}
              style={({ pressed }) => ({ gap: 3, opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={[type.labelPlain, { color: color.muted }]}>
                {state.originName ? '출발' : '출발 · 현재 위치'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[type.title, { flex: 1, color: color.ink }]} numberOfLines={1}>
                  {originTitle}
                </Text>
                <Chevron size={9} thickness={2} color={color.stroke} dir="down" style={{ marginTop: -4 }} />
              </View>
              <Text
                style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}
                numberOfLines={1}
              >
                {originSub}
              </Text>
            </Pressable>
            {/* 경계선 위에 얹어 두 행의 정확한 가운데에 오게 한다 — 카드 기준 50%로는 텍스트 높이 차이로 쏠린다 */}
            <View style={{ justifyContent: 'center' }}>
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
                  // 경계선 끝에서 살짝 떨어뜨려 선에 붙지 않게 한다
                  right: -46,
                  alignSelf: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: color.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !state.destinationName ? 0.35 : pressed ? 0.6 : 1,
                })}
              >
                <SwapIcon size={22} tint={color.body} />
              </Pressable>
            </View>
            <Pressable
              onPress={() => {
                haptic();
                setContinueAfterPick(false);
                setDestOpen(true);
              }}
              style={({ pressed }) => ({ gap: 3, opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={[type.labelPlain, { color: color.muted }]}>최종 목적지</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text
                  style={[
                    type.title,
                    { flex: 1, color: state.destinationName ? color.ink : color.placeholder },
                  ]}
                  numberOfLines={1}
                >
                  {state.destinationName ?? '최종 목적지를 입력하세요'}
                </Text>
                <Chevron size={9} thickness={2} color={color.stroke} dir="down" style={{ marginTop: -4 }} />
              </View>
            </Pressable>
          </View>
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
            navigation.navigate('Plan');
          }
        }}
      />
    </View>
  );
}
