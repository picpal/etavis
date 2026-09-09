/**
 * A1 — 최종 목적지 시트.
 *
 * 검색이 필요한 건 최종 목적지 하나뿐이다. 경유지는 "치킨집 들러야 해"처럼
 * 말로 던지면 AI가 경로상에서 찾아주는 게 이 앱의 방식이라 검색창이 없다.
 *
 * 지도를 그리지 않는다는 정체성은 그대로다 — 이름·주소·현재 위치로부터의 거리만
 * 리스트로 보여주면 목적지를 고르는 데 충분하다.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, shadow, type } from '../theme/tokens';
import { LatLng, RECENT_DESTINATIONS } from '../data/mockData';
import { usePlan } from '../state/plan';
import { useCurrentPlace } from '../lib/currentPlace';
import { getProvider, Place } from '../lib/places';
import { formatDistanceM, haversineM } from '../lib/geo';
import { Card, haptic } from '../components/common';
import { CheckMark, PinIcon } from '../components/primitives';
import { Sheet } from '../components/Sheet';

const DEBOUNCE = 250;

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  // 늦게 끝난 이전 요청이 최신 결과를 덮어쓰지 않게 한다
  const reqId = useRef(0);

  // 키보드 높이만큼 시트를 끌어올린다
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', e => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // 닫으면 다음에 열릴 때 최근 목적지부터 보이도록 초기화
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults([]);
      setSearching(false);
      reqId.current++;
    }
  }, [visible]);

  const myCoord = here.coord;
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      reqId.current++;
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    setFailed(false);
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      getProvider(myCoord)
        .search(trimmed, myCoord)
        .then(list => {
          if (id !== reqId.current) return;
          setResults(list);
          setSearching(false);
        })
        .catch(() => {
          // 키가 틀렸거나 네트워크가 끊긴 경우 — 조용히 빈 목록이면 원인을 알 수 없다
          if (id !== reqId.current) return;
          setResults([]);
          setSearching(false);
          setFailed(true);
        });
    }, DEBOUNCE);
    return () => clearTimeout(timer);
  }, [trimmed, myCoord]);

  const finish = (name: string, coord: LatLng | null) => {
    haptic();
    Keyboard.dismiss();
    if (isOrigin) setOrigin(name, coord);
    else setDestination(name, coord);
    setQuery('');
    onClose();
    onPicked?.(name);
  };

  const recents = RECENT_DESTINATIONS;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View
        style={{
          paddingTop: 8,
          paddingHorizontal: 20,
          paddingBottom: kbHeight > 0 ? kbHeight + 12 : Math.max(insets.bottom, 20),
          gap: 14,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
            {isOrigin ? '출발지' : '최종 목적지'}
          </Text>
          <Text style={[type.titleL, { color: color.ink }]}>{isOrigin ? '어디서 출발하나요?' : '어디로 갈까요?'}</Text>
        </View>

        {/* 주소·지명 검색 */}
        <View
          style={{
            minHeight: 52,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 18,
            borderRadius: 16,
            backgroundColor: color.surface,
            ...shadow.input,
          }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="장소명이나 주소로 검색"
            placeholderTextColor={color.placeholder}
            selectionColor={color.primary}
            returnKeyType="search"
            autoCorrect={false}
            style={[type.bodyL, { flex: 1, color: color.ink, paddingVertical: 0 }]}
          />
          {searching && <ActivityIndicator size="small" color={color.stroke} />}
        </View>

        {/*
          결과가 15건까지 오므로 반드시 스크롤 영역이어야 한다.
          키보드가 올라오면 남는 높이가 확 줄어서, 높이를 화면에서 계산해 묶는다.
          keyboardShouldPersistTaps — 키보드가 떠 있어도 결과를 한 번에 고를 수 있게
        */}
        <ScrollView
          style={{ maxHeight: Math.max(180, H - kbHeight - 330) }}
          contentContainerStyle={{ gap: 14 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        {/* 검색 결과 */}
        {trimmed.length > 0 && (
          <Card style={{ padding: 8 }}>
            {results.map((place, i) => {
              const distM = myCoord ? haversineM(myCoord, place.coord) : null;
              return (
                <React.Fragment key={place.id}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                  <Pressable
                    onPress={() => finish(place.name, place.coord)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <PinIcon />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text
                        style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.ink }}
                        numberOfLines={1}
                      >
                        {place.name}
                      </Text>
                      <Text
                        style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}
                        numberOfLines={1}
                      >
                        {place.address}
                      </Text>
                    </View>
                    {distM != null && (
                      <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, lineHeight: 17, color: color.muted }}>
                        {formatDistanceM(distM)}
                      </Text>
                    )}
                  </Pressable>
                </React.Fragment>
              );
            })}

            {/*
              '입력한 대로 설정'은 없앴다. 좌표 없이 이름만 있는 목적지는
              경로를 산정할 수도, 지도 앱에 넘길 수도 없다 — 조용히 엉뚱한 곳으로 안내하게 된다.
            */}
            {results.length === 0 && (
              <View style={{ paddingVertical: 22, paddingHorizontal: 16, gap: 6, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.body }}>
                  {searching ? '찾는 중이에요' : '조회된 결과가 없습니다'}
                </Text>
                {!searching && (
                  <Text
                    style={{
                      fontFamily: 'Pretendard-Regular',
                      fontSize: 13,
                      lineHeight: 19,
                      color: color.muted,
                      textAlign: 'center',
                    }}
                  >
                    건물 이름이나 상호, 도로명 주소로{'\n'}다시 검색해 보세요
                  </Text>
                )}
              </View>
            )}
          </Card>
        )}

        {/* 출발지는 '내 위치'로 되돌릴 길이 있어야 한다 — 기본값이 GPS이므로 */}
        {isOrigin && trimmed.length === 0 && (
          <Card style={{ padding: 8 }}>
            <Pressable
              onPress={() => {
                haptic();
                Keyboard.dismiss();
                setOrigin(null, null);
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
            <Text style={[type.label, { color: color.muted }]}>{isOrigin ? '자주 쓰는 곳' : '최근 목적지'}</Text>
            <Card style={{ padding: 8 }}>
              {recents.map((recent, i) => {
                const active = recent.name === (isOrigin ? state.originName : state.destinationName);
                return (
                  <React.Fragment key={recent.name}>
                    {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                    <Pressable
                      onPress={() => finish(recent.name, recent.coord)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 14,
                        paddingHorizontal: 12,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
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
                      {/* 주소는 우측 여백에 작게 — 이름이 주인공이고 주소는 확인용 */}
                      <Text
                        style={{
                          flex: 1,
                          textAlign: 'right',
                          fontFamily: 'Pretendard-Regular',
                          fontSize: 12,
                          lineHeight: 16,
                          color: color.muted,
                        }}
                        numberOfLines={1}
                      >
                        {recent.address}
                      </Text>
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
        </ScrollView>

        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          {failed
            ? '검색에 실패했어요 · 연결 상태나 API 키를 확인해 주세요'
            : here.status === 'denied'
              ? '위치 권한이 없어 거리는 표시되지 않아요'
              : '경로를 계산하려면 목록에서 골라야 해요 · 가까운 순으로 보여드려요'}
        </Text>
      </View>
    </Sheet>
  );
}
