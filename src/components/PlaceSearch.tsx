/**
 * 장소 검색 입력 + 결과 목록.
 *
 * `DestinationSheet` 가 검색 로직(디바운스·경합 가드·공급자 호출)과 시트 레이아웃을
 * 한 파일에 쥐고 있어서 '내 장소 추가'에서 재사용할 수 없었다. 검색만 떼어 낸다.
 *
 * 여기 없는 것: 최근·내 장소 목록, plan 스토어 연결, 시트 레이아웃·푸터.
 * 그건 쓰는 쪽의 몫이다.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { color, shadow, type } from '../theme/tokens';
import type { LatLng } from '../data/mockData';
import { getProvider, isSearchDegraded, type Place } from '../lib/places';
import { formatDistanceM, haversineM } from '../lib/geo';
import { Card } from './common';
import { PinIcon } from './primitives';

const DEBOUNCE = 250;

export function PlaceSearch({
  query,
  onChangeQuery,
  near,
  maxHeight,
  autoFocus = false,
  placeholder = '장소명이나 주소로 검색',
  onPick,
  onStatusChange,
}: {
  query: string;
  onChangeQuery: (v: string) => void;
  /** 거리 표시와 가까운 순 정렬의 기준. 없으면 거리를 안 그린다 */
  near: LatLng | null;
  /** 결과 목록의 최대 높이. 키보드가 올라오면 쓰는 쪽에서 줄여 넘긴다 */
  maxHeight: number;
  autoFocus?: boolean;
  placeholder?: string;
  onPick: (name: string, coord: LatLng, address: string) => void;
  /** 푸터 문구는 쓰는 쪽이 쓴다 — 시트마다 하고 싶은 말이 다르다 */
  /** degraded = 공급자가 죽어 목 카탈로그로 내려갔다. 한 번 서면 안 내린다 */
  onStatusChange?: (s: { searching: boolean; failed: boolean; degraded: boolean }) => void;
}) {
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [degraded, setDegraded] = useState(false);
  // 늦게 끝난 이전 요청이 최신 결과를 덮어쓰지 않게 한다
  const reqId = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    onStatusChange?.({ searching, failed, degraded });
    // 콜백 신원이 바뀔 때마다 도는 걸 막는다 — 값이 바뀔 때만 알린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, failed, degraded]);

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
      getProvider(near)
        .search(trimmed, near)
        .then(list => {
          if (id !== reqId.current) return;
          setResults(list);
          // 목으로 내려갔는지는 결과만 봐서는 모른다 — 플래그가 유일한 단서다
          setDegraded(isSearchDegraded());
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
  }, [trimmed, near]);

  return (
    <View style={{ gap: 14 }}>
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
          onChangeText={onChangeQuery}
          placeholder={placeholder}
          placeholderTextColor={color.placeholder}
          selectionColor={color.primary}
          returnKeyType="search"
          autoCorrect={false}
          autoFocus={autoFocus}
          style={[type.bodyL, { flex: 1, color: color.ink, paddingVertical: 0 }]}
        />
        {searching && <ActivityIndicator size="small" color={color.stroke} />}
      </View>

      {trimmed.length > 0 && (
        <ScrollView
          style={{ maxHeight }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card style={{ padding: 8 }}>
            {results.map((place, i) => {
              const distM = near ? haversineM(near, place.coord) : null;
              return (
                <React.Fragment key={place.id}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                  <Pressable
                    onPress={() => onPick(place.name, place.coord, place.address)}
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
        </ScrollView>
      )}
    </View>
  );
}
