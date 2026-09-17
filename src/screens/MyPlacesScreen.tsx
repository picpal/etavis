/**
 * 내 장소 — 미리 등록해 두고 목적지 시트에서 바로 고르는 곳.
 *
 * 집·회사는 비어 있어도 자리를 지킨다. 점선 카드가 "여기 등록하라"는 표시다 —
 * 목록 맨 위 두 자리가 늘 같은 자리여야 눈이 안 헤맨다.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { color, radius, type } from '../theme/tokens';
import { Card, haptic } from '../components/common';
import { BookmarkIcon, Chevron } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { usePlaces } from '../lib/usePlaces';
import type { SavedPlace } from '../lib/placesFormat';
import type { RootStackParamList } from '../../App';

const SLOT_LABEL = { home: '집', work: '회사' } as const;

export function MyPlacesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'MyPlaces'>>();
  const insets = useSafeAreaInsets();
  const places = usePlaces();

  /* Task 7 에서 이 값으로 편집 시트를 연다. 이 과제에서는 담기만 한다 */
  const [editing, setEditing] = useState<{ place?: SavedPlace; slot?: 'home' | 'work' } | null>(null);
  void editing;

  const home = places.saved.find(s => s.slot === 'home');
  const work = places.saved.find(s => s.slot === 'work');
  const rest = places.saved.filter(s => !s.slot);

  const slotRow = (slot: 'home' | 'work', place: SavedPlace | undefined) => (
    <Pressable
      key={slot}
      onPress={() => {
        haptic();
        setEditing(place ? { place } : { slot });
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 15,
        paddingHorizontal: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          minWidth: 44,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: radius.chipSmall,
          backgroundColor: place ? color.primaryTint : color.skeleton,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: place ? color.primary : color.muted }}>
          {SLOT_LABEL[slot]}
        </Text>
      </View>
      {place ? (
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 16, lineHeight: 20, color: color.ink }} numberOfLines={1}>
            {place.name}
          </Text>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }} numberOfLines={1}>
            {place.address}
          </Text>
        </View>
      ) : (
        <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 20, color: color.placeholder }}>
          + 등록하기
        </Text>
      )}
      <Chevron size={8} thickness={2} color={color.stroke} dir="right" />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="내 장소" onBack={() => navigation.goBack()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 24, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[type.label, { color: color.muted }]}>자주 가는 곳</Text>
        <Card style={{ padding: 8 }}>
          {slotRow('home', home)}
          <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />
          {slotRow('work', work)}
        </Card>

        <Text style={[type.label, { color: color.muted }]}>등록한 장소</Text>
        {rest.length === 0 ? (
          <Card style={{ paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.body }}>
              등록한 장소가 없어요
            </Text>
            <Text
              style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.muted, textAlign: 'center' }}
            >
              단골집·부모님 댁처럼 자주 가는 곳을{'\n'}이름 붙여 저장해 두세요
            </Text>
          </Card>
        ) : (
          <Card style={{ padding: 8 }}>
            {rest.map((place, i) => (
              <React.Fragment key={place.id}>
                {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                <Pressable
                  onPress={() => {
                    haptic();
                    setEditing({ place });
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
                  <BookmarkIcon size={18} filled />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 16, lineHeight: 20, color: color.ink }} numberOfLines={1}>
                      {place.label}
                    </Text>
                    <Text
                      style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}
                      numberOfLines={1}
                    >
                      {place.name === place.label ? place.address : `${place.name} · ${place.address}`}
                    </Text>
                  </View>
                  <Chevron size={8} thickness={2} color={color.stroke} dir="right" />
                </Pressable>
              </React.Fragment>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* 추가 버튼은 목록이 길어져도 늘 닿는 자리에 있어야 한다 */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16),
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
        }}
      >
        <Pressable
          onPress={() => {
            haptic();
            setEditing({});
          }}
          style={({ pressed }) => ({
            height: 52,
            borderRadius: radius.button,
            backgroundColor: color.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={[type.btn, { color: '#fff' }]}>+ 장소 추가</Text>
        </Pressable>
      </View>
    </View>
  );
}
