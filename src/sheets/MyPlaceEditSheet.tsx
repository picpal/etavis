/**
 * 내 장소 추가·수정 — 별칭, 장소, 슬롯(집·회사), 삭제.
 *
 * 삭제 확인을 네이티브 Alert 로 띄우지 않는다. 앱 톤에서 튀고, 시트 위에 시스템 창이
 * 겹치면 어느 쪽을 닫는 건지도 흐려진다 — 같은 시트 안에서 확인 줄로 바뀐다.
 */
import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow, type } from '../theme/tokens';
import type { LatLng } from '../data/mockData';
import type { SavedPlace } from '../lib/placesFormat';
import { newPlaceId, removePlace, savePlace } from '../lib/placesStore';
import { usePlaces } from '../lib/usePlaces';
import { useCurrentPlace } from '../lib/currentPlace';
import { Card, haptic } from '../components/common';
import { PlaceSearch } from '../components/PlaceSearch';
import { Sheet } from '../components/Sheet';

const SLOTS = [
  { key: 'home', label: '집' },
  { key: 'work', label: '회사' },
  { key: null, label: '직접 입력' },
] as const;

type Picked = { name: string; address: string; coord: LatLng };

export function MyPlaceEditSheet({
  visible,
  onClose,
  place,
  presetSlot,
}: {
  visible: boolean;
  onClose: () => void;
  /** 있으면 수정, 없으면 추가 */
  place?: SavedPlace;
  /** 추가로 열 때 미리 골라 둘 슬롯 ('집 등록'으로 들어온 경우) */
  presetSlot?: 'home' | 'work' | null;
}) {
  const insets = useSafeAreaInsets();
  const places = usePlaces();
  const here = useCurrentPlace();

  const [label, setLabel] = useState('');
  const [slot, setSlot] = useState<'home' | 'work' | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* 열릴 때마다 들고 온 값으로 초기화한다 — 지난번에 쓰다 만 값이 남으면 안 된다 */
  useEffect(() => {
    if (!visible) return;
    setLabel(place?.label ?? (presetSlot ? (presetSlot === 'home' ? '집' : '회사') : ''));
    setSlot(place?.slot ?? presetSlot ?? null);
    setPicked(place ? { name: place.name, address: place.address, coord: place.coord } : null);
    setSearching(!place); // 새로 추가할 때는 검색부터
    setQuery('');
    setConfirmDelete(false);
  }, [visible, place, presetSlot]);

  const taken = (s: 'home' | 'work') => places.saved.find(p => p.slot === s && p.id !== place?.id);
  const canSave = !!picked;

  const onSave = () => {
    if (!picked) return;
    haptic();
    Keyboard.dismiss();
    savePlace({
      id: place?.id ?? newPlaceId(),
      slot,
      // 별칭을 비우고 저장하면 고른 장소의 이름을 그대로 쓴다
      label: label.trim() || picked.name,
      name: picked.name,
      address: picked.address,
      coord: picked.coord,
      createdAt: place?.createdAt ?? Date.now(),
    });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <Text style={[type.titleL, { color: color.ink }]}>{place ? '장소 수정' : '장소 추가'}</Text>

        {searching ? (
          <>
            <PlaceSearch
              query={query}
              onChangeQuery={setQuery}
              near={here.coord}
              maxHeight={280}
              autoFocus
              placeholder="등록할 장소를 검색"
              onPick={(name, coord, address) => {
                haptic();
                Keyboard.dismiss();
                setPicked({ name, address, coord });
                setSearching(false);
              }}
            />
            {!!picked && (
              <Pressable onPress={() => setSearching(false)} style={({ pressed }) => ({ alignSelf: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 14, lineHeight: 18, color: color.muted }}>취소</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            {/* 별칭 */}
            <View style={{ gap: 8 }}>
              <Text style={[type.label, { color: color.muted }]}>이름</Text>
              <View
                style={{
                  minHeight: 52,
                  justifyContent: 'center',
                  paddingHorizontal: 18,
                  borderRadius: 16,
                  backgroundColor: color.surface,
                  ...shadow.input,
                }}
              >
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder={picked?.name ?? '예: 단골 미용실'}
                  placeholderTextColor={color.placeholder}
                  selectionColor={color.primary}
                  style={[type.bodyL, { color: color.ink, paddingVertical: 0 }]}
                />
              </View>
            </View>

            {/* 장소 */}
            <View style={{ gap: 8 }}>
              <Text style={[type.label, { color: color.muted }]}>장소</Text>
              <Pressable
                onPress={() => {
                  haptic();
                  setSearching(true);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Card style={{ paddingVertical: 14, paddingHorizontal: 16, gap: 3 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: picked ? color.ink : color.placeholder }} numberOfLines={1}>
                    {picked?.name ?? '검색해서 고르기'}
                  </Text>
                  {!!picked && (
                    <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }} numberOfLines={1}>
                      {picked.address}
                    </Text>
                  )}
                </Card>
              </Pressable>
            </View>

            {/* 슬롯 */}
            <View style={{ gap: 8 }}>
              <Text style={[type.label, { color: color.muted }]}>종류</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {SLOTS.map(s => {
                  const active = slot === s.key;
                  return (
                    <Pressable
                      key={s.label}
                      onPress={() => {
                        haptic();
                        setSlot(s.key);
                        if (s.key && !label.trim()) setLabel(s.key === 'home' ? '집' : '회사');
                      }}
                      style={({ pressed }) => ({
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: radius.chip,
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: active ? color.primary : color.stroke,
                        backgroundColor: active ? color.primaryTint : color.surface,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text
                        style={{
                          fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                          fontSize: 14,
                          lineHeight: 18,
                          color: active ? color.primary : color.body,
                        }}
                      >
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {/* 슬롯은 하나뿐이라, 뺏어오는 거라면 미리 말해 준다 */}
              {slot && taken(slot) && (
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.amber }}>
                  지금 {slot === 'home' ? '집' : '회사'}인 '{taken(slot)?.label}'은 일반 장소로 바뀌어요
                </Text>
              )}
            </View>

            {/* 저장 */}
            <Pressable
              disabled={!canSave}
              onPress={onSave}
              style={({ pressed }) => ({
                height: 52,
                borderRadius: radius.button,
                backgroundColor: color.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: !canSave ? 0.35 : pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.btn, { color: '#fff' }]}>저장</Text>
            </Pressable>

            {/* 삭제 — 같은 시트 안에서 확인 줄로 바뀐다 */}
            {!!place &&
              (confirmDelete ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 2 }}>
                  <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 14, lineHeight: 18, color: color.body }}>
                    '{place.label}'을 지울까요?
                  </Text>
                  <Pressable onPress={() => setConfirmDelete(false)} style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.6 : 1 })}>
                    <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 14, lineHeight: 18, color: color.muted }}>취소</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      haptic();
                      removePlace(place.id);
                      onClose();
                    }}
                    style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 18, color: color.danger }}>삭제</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    haptic();
                    setConfirmDelete(true);
                  }}
                  style={({ pressed }) => ({ alignSelf: 'center', padding: 8, opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 14, lineHeight: 18, color: color.danger }}>이 장소 삭제</Text>
                </Pressable>
              ))}
          </>
        )}
      </View>
    </Sheet>
  );
}
