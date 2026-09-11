/** 개발 메뉴 — 목 데이터셋 전환 + 계산 실패 토글 + 위치 추적 + 추적 로그 내보내기 (A1 타이틀 길게 눌러 진입) */
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { datasets } from '../data/mockData';
import { usePlan } from '../state/plan';
import { useTracker } from '../state/tracker';
import { formatDistanceM } from '../lib/geo';
import { Card, haptic, SmallChip } from '../components/common';
import { CheckMark } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { clearTrackLogs, exportTrackLogs, listTrackLogs } from '../lib/trackLog';

const SIM_MODES = [
  { key: 'off', label: '중지' },
  { key: 'live', label: '실제 GPS' },
  { key: 'driving', label: '정상 주행' },
  { key: 'deviate', label: '경로 이탈' },
  { key: 'stuck', label: '정체' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  idle: '대기',
  moving: '이동중',
  stalled: '정체',
  suspect: '경로 확인 중',
  detour: '우회 중',
  offroute: '이탈 확정',
  faraway: '경로 밖',
};

export function DevSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { state, setDataset, setFailNext, setDevAnyCongestion } = usePlan();
  const tracker = useTracker();
  const [logs, setLogs] = useState<{ name: string; bytes: number }[]>([]);
  const refreshLogs = () => {
    void listTrackLogs().then(setLogs);
  };
  useEffect(() => {
    if (visible) refreshLogs();
  }, [visible]);
  const totalKb = Math.round(logs.reduce((a, l) => a + l.bytes, 0) / 1024);

  return (
    <Sheet visible={visible} onClose={onClose}>
      {/* 시트는 내부 스크롤을 자식에게 맡긴다 — 메뉴 전체(추적 로그 포함)가 화면 아래로 잘리지 않도록 여기서 스크롤 처리 */}
      <ScrollView showsVerticalScrollIndicator={false}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
            개발 메뉴
          </Text>
          <Text style={[type.titleL, { color: color.ink }]}>목 데이터셋</Text>
        </View>

        <Card style={{ padding: 8 }}>
          {datasets.map((ds, i) => {
            const active = ds.key === state.dataset.key;
            return (
              <React.Fragment key={ds.key}>
                {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                <Pressable
                  onPress={() => {
                    haptic();
                    setDataset(ds.key);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {active ? (
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
                  ) : (
                    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.stroke }} />
                  )}
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: active ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
                      fontSize: 15,
                      lineHeight: 19,
                      color: color.ink,
                    }}
                  >
                    {ds.label}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>

        <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink }}>
              다음 계산 실패 (A8)
            </Text>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}>
              켜면 다음 경로 계산이 오류 화면으로 이어져요
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptic();
              setFailNext(!state.failNext);
            }}
            style={{
              width: 51,
              height: 31,
              borderRadius: 16,
              backgroundColor: state.failNext ? color.primary : color.track,
              padding: 2,
              alignItems: state.failNext ? 'flex-end' : 'flex-start',
              justifyContent: 'center',
            }}
          >
            <View style={{ width: 27, height: 27, borderRadius: 13.5, backgroundColor: '#fff' }} />
          </Pressable>
        </Card>

        <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.ink }}>
              도착 안 해도 혼잡도 묻기
            </Text>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}>
              테스트용이에요 · 끄면 실제로 도착한 경유지에서만 물어요
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptic();
              setDevAnyCongestion(!state.devAnyCongestion);
            }}
            style={{
              width: 51,
              height: 31,
              borderRadius: 16,
              backgroundColor: state.devAnyCongestion ? color.primary : color.track,
              padding: 2,
              alignItems: state.devAnyCongestion ? 'flex-end' : 'flex-start',
              justifyContent: 'center',
            }}
          >
            <View style={{ width: 27, height: 27, borderRadius: 13.5, backgroundColor: '#fff' }} />
          </Pressable>
        </Card>

        {/* 주행 시뮬레이션 — 판정 로직은 실제 좌표 계산으로 동작 */}
        <Text style={[type.label, { color: color.muted }]}>위치 추적</Text>
        <Card style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {SIM_MODES.map(m => (
              <SmallChip
                key={m.key}
                label={m.label}
                tint={tracker.mode === m.key ? color.primary : color.body}
                background={tracker.mode === m.key ? color.primaryTint : color.bg}
                onPress={() => tracker.setMode(m.key)}
              />
            ))}
          </View>
          <Pressable
            onPress={() => {
              haptic();
              tracker.anchorToMyLocation();
            }}
            style={({ pressed }) => ({
              minHeight: 44,
              borderRadius: 12,
              backgroundColor: tracker.anchored ? color.primaryTint : color.bg,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: 'Pretendard-SemiBold',
                fontSize: 14,
                lineHeight: 14,
                color: tracker.anchored ? color.primary : color.body,
              }}
            >
              {tracker.anchored ? '내 위치 기준으로 이동됨 ✓' : '목 경로를 내 위치로 옮기기'}
            </Text>
          </Pressable>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
            {tracker.permissionDenied
              ? '위치 권한이 거부돼 실제 GPS를 쓸 수 없어요 · 설정에서 허용해 주세요'
              : tracker.mode === 'off'
                ? '경로 폴리라인 대비 수직거리로 도착·출발·이탈을 판정해요'
                : `${tracker.mode === 'live' ? '실제 GPS' : '시뮬레이션'} · 상태 ${STATUS_LABEL[tracker.status]} · 경로에서 ${formatDistanceM(tracker.crossTrackM)}`}
          </Text>
        </Card>

        <Text style={[type.label, { color: color.muted }]}>추적 로그</Text>
        <Card style={{ padding: 14, gap: 10 }}>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
            {logs.length === 0 ? '기록된 로그가 없어요' : `${logs.length}일치 · ${totalKb}KB · 7일 보관 · 로컬에만 남아요`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              disabled={logs.length === 0}
              onPress={async () => {
                haptic();
                const r = await exportTrackLogs();
                if (r === 'unavailable') Alert.alert('공유할 수 없어요', '이 기기에서는 공유 시트를 열 수 없어요');
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: color.primaryTint,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: logs.length === 0 ? 0.4 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 14, color: color.primary }}>내보내기</Text>
            </Pressable>
            <Pressable
              disabled={logs.length === 0}
              onPress={() => {
                haptic();
                Alert.alert('추적 로그 지우기', '7일치 기록을 모두 지워요', [
                  { text: '취소', style: 'cancel' },
                  {
                    text: '지우기',
                    style: 'destructive',
                    onPress: () => {
                      void clearTrackLogs().then(refreshLogs);
                    },
                  },
                ]);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: color.bg,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: logs.length === 0 ? 0.4 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 14, color: color.body }}>지우기</Text>
            </Pressable>
          </View>
        </Card>

        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          경로 변형이 UI에서 어떻게 보이는지 확인하는 용도예요
        </Text>
      </View>
      </ScrollView>
    </Sheet>
  );
}
