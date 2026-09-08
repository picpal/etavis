/** A5 — 경로 3안 비교 (카드 탭 선택, 경유 매장 칩 탭으로 브랜드 변경 → CTA로 확정) */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { RouteOption } from '../data/mockData';
import { getOptionView, OptionStopSlot, usePlan } from '../state/plan';
import { Card, haptic, PrimaryButton } from '../components/common';
import { Chevron, DottedLineH, Hairline } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { TabBar } from '../components/TabBar';
import { CandidateSheet } from '../sheets/CandidateSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Options'>;

type OptionView = ReturnType<typeof getOptionView>;

/** 1·2위 추가시간 차이가 이 값 이하면 "애매하다"고 보고 사용자에게 묻는다 */
const AMBIGUOUS_MIN = 3;

/** 추천안 스타일 — 점선 커넥터로 구간 펼침, 경유지는 매장 선택 칩 */
function ExpandedOption({
  option,
  view,
  onPickStop,
}: {
  option: RouteOption;
  view: OptionView;
  onPickStop: (slot: OptionStopSlot) => void;
}) {
  const names = view.names;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: 20,
          backgroundColor: color.primary,
          paddingVertical: 6,
          paddingHorizontal: 9,
          borderBottomLeftRadius: 8,
          borderBottomRightRadius: 8,
        }}
      >
        <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 11, lineHeight: 11, letterSpacing: 0.66, color: '#fff' }}>
          {option.badge ?? option.title}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[type.labelPlain, { color: color.muted }]}>총 소요</Text>
          <Text style={[type.displayXL, { color: color.ink }]}>{view.totalMin}분</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <Text style={[type.labelPlain, { color: color.muted }]}>직행 대비</Text>
          <Text style={[type.stat, { color: color.amber }]}>+{view.deltaMin}분</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {names.map((_, i) => {
          const node =
            i === 0 ? (
              <View style={{ width: 9, height: 9, borderRadius: 4.5, borderWidth: 2.5, borderColor: color.primary }} />
            ) : i === names.length - 1 ? (
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: color.ink }} />
            ) : (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.primary }} />
            );
          return (
            <React.Fragment key={i}>
              {i > 0 && <DottedLineH />}
              {node}
            </React.Fragment>
          );
        })}
      </View>
      {/* 지점명 행 — 후보가 여럿인 경유지는 탭해서 매장 변경 */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        {names.map((name, i) => {
          const isEdge = i === 0 || i === names.length - 1;
          const slot = isEdge ? undefined : view.slots[i - 1];
          const selectable = !!slot && slot.candidateCount > 1;
          const align = i === 0 ? 'flex-start' : i === names.length - 1 ? 'flex-end' : 'center';
          return (
            <View key={name + i} style={{ flex: 1, alignItems: align }}>
              {selectable ? (
                <Pressable
                  onPress={() => {
                    haptic();
                    onPickStop(slot!);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    backgroundColor: color.bg,
                    paddingVertical: 7,
                    paddingHorizontal: 9,
                    borderRadius: 9,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    numberOfLines={1}
                    style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: color.body }}
                  >
                    {name}
                  </Text>
                  <Chevron size={7} thickness={2} color={color.muted} dir="down" style={{ marginTop: -3 }} />
                </Pressable>
              ) : (
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 16, color: color.muted }}
                >
                  {name}
                </Text>
              )}
            </View>
          );
        })}
      </View>
      <Hairline />
      <Text style={[type.body, { color: color.body }]}>{option.rationale}</Text>
    </>
  );
}

/** 대안 스타일 — 한 줄 압축 */
function CompactOption({ option, view }: { option: RouteOption; view: OptionView }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[type.labelPlain, { color: color.muted }]}>{option.title}</Text>
          <Text style={[type.statL, { color: color.ink }]}>{view.totalMin}분</Text>
        </View>
        <Text style={[type.statS, { color: color.amber }]}>+{view.deltaMin}분</Text>
      </View>
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.muted }}>
        {option.rationale}
      </Text>
    </>
  );
}

export function OptionsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { state, selectOption, applyOption, setOptionStore, originDisplay, destinationDisplay } = usePlan();
  const selected = state.options.find(o => o.id === state.selectedOptionId) ?? state.options[0];
  const selectedView = getOptionView(state, selected, originDisplay, destinationDisplay);
  const [pickBaseId, setPickBaseId] = useState<string | null>(null);
  // 시트가 열려 있는 동안에도 현재 선택이 라이브로 반영되도록 매 렌더에서 파생
  const pickSlot = pickBaseId ? selectedView.slots.find(s => s.baseId === pickBaseId) ?? null : null;

  // 개발·검증용: ?pick=1 로 첫 선택 가능 슬롯의 시트 자동 오픈
  React.useEffect(() => {
    if (!route.params?.pick) return;
    const slot = selectedView.slots.find(s => s.candidateCount > 1);
    if (slot) setPickBaseId(slot.baseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.pick]);

  // 1·2위가 애매할 때만 후보를 물어본다. 매번 물으면 "3초 안에 답"과 충돌한다.
  const askedRef = React.useRef(false);
  React.useEffect(() => {
    if (askedRef.current || route.params?.pick) return;
    for (const slot of selectedView.slots) {
      const cands = (state.dataset.candidates[slot.baseId] ?? []).filter(c => !c.disabled);
      if (cands.length < 2) continue;
      const sorted = [...cands].sort((a, b) => a.addedMin - b.addedMin);
      if (Math.abs(sorted[0].addedMin - sorted[1].addedMin) <= AMBIGUOUS_MIN) {
        askedRef.current = true;
        setPickBaseId(slot.baseId);
        return;
      }
    }
    askedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {/* 우측 '정렬'은 동작이 없어 제거했다 */}
      <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
      >
        <Text style={[type.label, { color: color.muted }]}>
          직행 {state.dataset.directMin}분 기준 · {state.options.length}개 안
        </Text>
        {state.options.map(option => {
          const isSelected = option.id === selected.id;
          const view = isSelected ? selectedView : getOptionView(state, option, originDisplay, destinationDisplay);
          return (
            <Pressable
              key={option.id}
              onPress={() => {
                if (!isSelected) {
                  haptic();
                  selectOption(option.id);
                }
              }}
            >
              <Card
                elevated={isSelected}
                style={{ padding: isSelected ? 20 : 18, gap: isSelected ? 16 : 12 }}
              >
                {isSelected ? (
                  <ExpandedOption option={option} view={view} onPickStop={slot => setPickBaseId(slot.baseId)} />
                ) : (
                  <CompactOption option={option} view={view} />
                )}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>

      <View
        style={{
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          paddingTop: 16,
          paddingHorizontal: 20,
          paddingBottom: 16,
          gap: 10,
        }}
      >
        <PrimaryButton
          label={`${selectedView.totalMin}분 경로로 계속`}
          chevron
          height={56}
          borderRadius={18}
          onPress={() => {
            applyOption(selected.id);
            // 확정하면 진행중으로 넘기고, 계획 탭은 초기 화면(A1)으로 되돌린다
            navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Today' }] });
          }}
        />
        {/* 문구가 곧 액션 — 탭하면 A2 대화로 복귀 */}
        <Pressable
          onPress={() => {
            haptic();
            navigation.navigate('Plan');
          }}
          hitSlop={{ top: 8, bottom: 12, left: 20, right: 20 }}
        >
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
            확정 전이라 언제든 대화로 바꿀 수 있어요 ·{' '}
            <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.primary }}>대화로 바꾸기</Text>
          </Text>
        </Pressable>
      </View>
      <TabBar />

      <CandidateSheet
        baseId={pickBaseId}
        currentCandidateId={pickSlot?.candidateId}
        onPick={candId => pickBaseId && setOptionStore(selected.id, pickBaseId, candId)}
        onClose={() => setPickBaseId(null)}
      />
    </View>
  );
}
