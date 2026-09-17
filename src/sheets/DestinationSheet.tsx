/**
 * A1 — 최종 목적지 시트.
 *
 * 검색이 필요한 건 최종 목적지 하나뿐이다. 경유지는 "치킨집 들러야 해"처럼
 * 말로 던지면 AI가 경로상에서 찾아주는 게 이 앱의 방식이라 검색창이 없다.
 *
 * 지도를 그리지 않는다는 정체성은 그대로다 — 이름·주소·현재 위치로부터의 거리만
 * 리스트로 보여주면 목적지를 고르는 데 충분하다.
 */
import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import type { RootStackParamList } from '../../App';
import { LatLng } from '../data/mockData';
import { usePlan } from '../state/plan';
import { useCurrentPlace } from '../lib/currentPlace';
import { usePlaces } from '../lib/usePlaces';
import { Card, haptic } from '../components/common';
import { CheckMark, PinIcon } from '../components/primitives';
import { PlaceSearch } from '../components/PlaceSearch';
import { Sheet } from '../components/Sheet';

export function DestinationSheet({
  visible,
  onClose,
  onPicked,
  target = 'destination',
}: {
  visible: boolean;
  onClose: () => void;
  /** 선택 직후 호출 — 채팅 시작 게이트에서 이어서 이동할 때 사용 */
  onPicked?: (name: string) => void;
  /** 출발지에도 같은 검색을 쓴다 — 기본은 목적지 */
  target?: 'origin' | 'destination';
}) {
  const isOrigin = target === 'origin';
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const { state, setDestination, setOrigin } = usePlan();
  const here = useCurrentPlace();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const places = usePlaces();
  const recents = places.recents;
  const home = places.saved.find(s => s.slot === 'home');
  const work = places.saved.find(s => s.slot === 'work');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState({ searching: false, failed: false });
  const [kbHeight, setKbHeight] = useState(0);

  /* 시트를 끌어올리는 건 Sheet가 한다. 여기서 키보드 높이를 재는 건
     결과 목록이 차지할 수 있는 높이를 계산하기 위해서다 */
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 닫으면 다음에 열릴 때 최근 목적지부터 보이도록 초기화 — failed도 같이 지운다.
  // 예전엔 failed를 안 지웠다. 검색이 실패한 채로 닫았다가 다시 열면, 이번엔
  // 검색을 하지도 않았는데 푸터에 "검색에 실패했어요"가 그대로 남아 있었다.
  // 갓 열린 시트가 하지도 않은 검색의 실패를 띄우면 안 된다.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setStatus({ searching: false, failed: false });
    }
  }, [visible]);

  const myCoord = here.coord;
  const trimmed = query.trim();

  const finish = (name: string, coord: LatLng | null, address: string | null) => {
    haptic();
    Keyboard.dismiss();
    if (isOrigin) setOrigin(name, coord, address);
    else setDestination(name, coord, address);
    setQuery('');
    onClose();
    onPicked?.(name);
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View
        style={{
          paddingTop: 8,
          paddingHorizontal: 20,
          paddingBottom: kbHeight > 0 ? 20 : Math.max(insets.bottom, 20),
          gap: 14,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
            {isOrigin ? '출발지' : '최종 목적지'}
          </Text>
          <Text style={[type.titleL, { color: color.ink }]}>{isOrigin ? '어디서 출발하나요?' : '어디로 갈까요?'}</Text>
        </View>

        <PlaceSearch
          query={query}
          onChangeQuery={setQuery}
          near={myCoord}
          maxHeight={Math.max(180, H - kbHeight - 330)}
          onPick={(name, coord, address) => finish(name, coord, address)}
          onStatusChange={setStatus}
        />

        {/*
          최근·내 위치 목록만 감싼다 — 검색 결과는 PlaceSearch가 자기 스크롤을 갖는다.
          결과가 15건까지 오므로 반드시 스크롤 영역이어야 한다.
          키보드가 올라오면 남는 높이가 확 줄어서, 높이를 화면에서 계산해 묶는다.
          keyboardShouldPersistTaps — 키보드가 떠 있어도 결과를 한 번에 고를 수 있게
        */}
        {trimmed.length === 0 && (
          <ScrollView
            style={{ maxHeight: Math.max(180, H - kbHeight - 330) }}
            contentContainerStyle={{ gap: 14 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          {/* 출발지는 '내 위치'로 되돌릴 길이 있어야 한다 — 기본값이 GPS이므로 */}
          {isOrigin && trimmed.length === 0 && (
            <Card style={{ padding: 8 }}>
              <Pressable
                onPress={() => {
                  haptic();
                  Keyboard.dismiss();
                  setOrigin(null, null, null);
                  onClose();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                  paddingHorizontal: 12,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <PinIcon />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    style={{
                      fontFamily: state.originName ? 'Pretendard-Medium' : 'Pretendard-SemiBold',
                      fontSize: 16,
                      lineHeight: 20,
                      color: state.originName ? color.ink : color.primary,
                    }}
                  >
                    내 위치
                  </Text>
                  <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 16, color: color.muted }}>
                    {here.address ?? 'GPS로 지금 있는 곳에서 출발해요'}
                  </Text>
                </View>
                {!state.originName && (
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: color.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckMark />
                  </View>
                )}
              </Pressable>
            </Card>
          )}

          {trimmed.length === 0 && recents.length > 0 && (
            <>
              <Text style={[type.label, { color: color.muted }]}>최근에 쓴 곳</Text>
              <Card style={{ padding: 8 }}>
                {recents.map((recent, i) => {
                  const active = recent.name === (isOrigin ? state.originName : state.destinationName);
                  const key = `${recent.name}-${recent.coord.latitude}-${recent.coord.longitude}`;
                  return (
                    <React.Fragment key={key}>
                      {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                      <Pressable
                        onPress={() => finish(recent.name, recent.coord, recent.address)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        {/*
                          검색 결과 행과 같은 2줄 구성 — 이름 옆 한 줄에 우측 정렬로 욱여넣으면
                          이름이 길 때(실제 검색 결과 대부분) 주소가 잘려 구 이름조차 안 보인다.
                          확인용이라는 주소의 역할을 하려면 자기 줄이 있어야 한다.
                          좌측 아이콘 자리는 비워 둔다 — 저장한 장소일 때 북마크 배지가 그 자리에 들어온다.
                        */}
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text
                            style={{
                              fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                              fontSize: 16,
                              lineHeight: 20,
                              color: color.ink,
                            }}
                            numberOfLines={1}
                          >
                            {recent.name}
                          </Text>
                          {recent.address.length > 0 && (
                            <Text
                              style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}
                              numberOfLines={1}
                            >
                              {recent.address}
                            </Text>
                          )}
                        </View>
                        {active && (
                          <View
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 11,
                              backgroundColor: color.primary,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <CheckMark />
                          </View>
                        )}
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </Card>
            </>
          )}

          {/*
            최근이 비면 그 자리가 통째로 빈다. 첫 실행에서 검색창만 덩그러니 남지 않게,
            다음 행동(자주 가는 곳 등록)으로 잇는다. 등록이 끝난 사용자에게는 안 보인다.
          */}
          {trimmed.length === 0 && recents.length === 0 && (
            <Card style={{ paddingVertical: 24, paddingHorizontal: 20, gap: 14, alignItems: 'center' }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: color.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <PinIcon />
              </View>
              <View style={{ gap: 5 }}>
                <Text
                  style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink, textAlign: 'center' }}
                >
                  아직 다녀온 곳이 없어요
                </Text>
                <Text
                  style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.muted, textAlign: 'center' }}
                >
                  자주 가는 곳을 등록해 두면{'\n'}여기서 바로 고를 수 있어요
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(!home || !work) &&
                  ([['home', '집 등록'], ['work', '회사 등록']] as const)
                    .filter(([slot]) => (slot === 'home' ? !home : !work))
                    .map(([slot, label]) => (
                      <Pressable
                        key={slot}
                        onPress={() => {
                          haptic();
                          Keyboard.dismiss();
                          onClose();
                          navigation.navigate('MyPlaces', { addSlot: slot });
                        }}
                        style={({ pressed }) => ({
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor: color.stroke,
                          backgroundColor: color.surface,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 18, color: color.primary }}>
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                {home && work && (
                  <Pressable
                    onPress={() => {
                      haptic();
                      Keyboard.dismiss();
                      onClose();
                      navigation.navigate('MyPlaces');
                    }}
                    style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 18, color: color.primary }}>
                      내 장소 관리
                    </Text>
                  </Pressable>
                )}
              </View>
            </Card>
          )}
          </ScrollView>
        )}

        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          {status.failed
            ? '검색에 실패했어요 · 연결 상태나 API 키를 확인해 주세요'
            : here.status === 'denied'
              ? '위치 권한이 없어 거리는 표시되지 않아요'
              : '경로를 계산하려면 목록에서 골라야 해요 · 가까운 순으로 보여드려요'}
        </Text>
      </View>
    </Sheet>
  );
}
