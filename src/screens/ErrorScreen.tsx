/** A8 — 오류 · 재시도 (유지된 계획 카드 포함) */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, shadow, type } from '../theme/tokens';
import { usePlanFlow } from '../state/planFlowProvider';
import { Card, haptic } from '../components/common';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import { TabBar } from '../components/TabBar';
import { MapAppSheet } from '../sheets/MapAppSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Error'>;

const INFO_BLUE = '#123F9E';

export function ErrorScreen({ navigation }: Props) {
  const flow = usePlanFlow();
  const [mapAppOpen, setMapAppOpen] = useState(false);

  // 실측 전에 실패했으니 확정된 계획이 없다 — 보여줄 건 실패한 요청이 뭘 찾으려 했는가뿐
  const planRows = flow.state.request
    ? flow.state.request.stops.map(s => ({ key: s.id, name: s.query }))
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader
        title="계획 수정"
        onBack={() => navigation.goBack()}
        right={{ label: '요약', tint: color.primary }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 16 }}
      >
        {/* 오류 카드 */}
        <View style={{ backgroundColor: color.amberBg, borderRadius: 20, padding: 20, gap: 16, ...shadow.amberCard }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: color.amber,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 16, lineHeight: 20, color: '#fff' }}>!</Text>
            </View>
            <Text style={[type.title, { color: color.amberDeep }]}>연결이 불안정해요</Text>
          </View>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 21.7, color: color.amberDeep }}>
            {flow.state.error?.kind === 'timeout'
              ? '12초 안에 계산이 끝나지 않았어요.'
              : '이동시간을 계산하지 못했어요.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => {
                haptic();
                flow.reset();
                navigation.replace('Calculating');
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 52,
                borderRadius: 16,
                backgroundColor: color.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 16, color: '#fff' }}>
                다시 계산
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                haptic();
                navigation.navigate('Plan');
              }}
              style={({ pressed }) => ({
                minHeight: 52,
                paddingHorizontal: 18,
                borderRadius: 16,
                backgroundColor: color.surface,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 16, color: color.amberDeep }}>
                조건 바꾸기
              </Text>
            </Pressable>
          </View>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.amber }}>
            3번 재시도 · 19:44 기준
          </Text>
        </View>

        {/* 찾으려던 것 — 확정된 계획이 아니라 실패한 요청이 뭘 찾고 있었는가다 */}
        {planRows.length > 0 && (
          <>
            <Text style={[type.label, { color: color.muted }]}>찾고 있던 곳</Text>
            <Card style={{ padding: 18, gap: 14 }}>
              {planRows.map(row => (
                <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: color.primary, marginLeft: 1 }} />
                  <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 18, color: color.ink }}>
                    {row.name}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {/* 오프라인 안내 */}
        <View
          style={{
            backgroundColor: color.primaryTint,
            borderRadius: 18,
            padding: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Text style={{ flex: 1, fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 20.3, color: INFO_BLUE }}>
            오프라인에서도 이 경로는 지도 앱으로 전달할 수 있어요.
          </Text>
          <Pressable
            onPress={() => {
              haptic();
              setMapAppOpen(true);
            }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 14, color: INFO_BLUE }}>열기</Text>
          </Pressable>
        </View>
      </ScrollView>

      <BottomInputBar placeholder="연결되면 다시 보낼게요" sendEnabled={false} editable={false} />
      <TabBar />

      <MapAppSheet visible={mapAppOpen} onClose={() => setMapAppOpen(false)} />
    </View>
  );
}
