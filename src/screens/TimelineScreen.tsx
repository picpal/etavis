/** A6 — 타임라인 (드래그 재정렬·스와이프 삭제·시트 진입점) */
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  RenderItemParams,
} from 'react-native-draggable-flatlist';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import * as Haptics from 'expo-haptics';
import { color, radius, shadow, type } from '../theme/tokens';
import { StopState, toHHMM, toMin, usePlan } from '../state/plan';
import { Card, haptic, MicroLabelRow, PrimaryButton, SmallChip } from '../components/common';
import { DashedLineV, TrashIcon } from '../components/primitives';
import { StateBadge, TimelineRow } from '../components/TimelineRow';
import { GuideStep, SpotlightGuide, SpotRect } from '../components/SpotlightGuide';
import { NavHeader } from '../components/NavHeader';
import { TabBar } from '../components/TabBar';
import { CandidateSheet } from '../sheets/CandidateSheet';
import { TaskSheet } from '../sheets/TaskSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Timeline'>;

/** 가이드는 앱 실행당 한 번만 보여준다 */
let guideSeen = false;

export function TimelineScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { state, reorderStops, removeStop, replaceStop, destinationDisplay, originDisplay, slackMin, arriveByLabel, confirmPlan, departAtLabel } = usePlan();
  const [taskStopId, setTaskStopId] = useState<string | null>(null);
  const [candidateStopId, setCandidateStopId] = useState<string | null>(null);

  const candidateStop = state.stops.find(s => s.id === candidateStopId);
  const candidateCands = candidateStop ? state.dataset.candidates[candidateStop.baseId] ?? [] : [];
  const candidateCurrentId =
    candidateStop?.selectedCandidateId ??
    (candidateCands.find(c => c.recommended) ?? candidateCands[0])?.id;
  const currentCand = candidateStop
    ? (state.dataset.candidates[candidateStop.baseId] ?? []).find(c => c.id === candidateCurrentId)
    : undefined;
  // 매 렌더 새 배열을 만들지 않는다 — CandidateSheet 안의 sorted useMemo가 실제로 캐시되게
  const candidateSheetCands = useMemo(
    () =>
      (candidateStop ? state.dataset.candidates[candidateStop.baseId] ?? [] : []).map(c => ({
        ...c,
        // 목 데이터의 아침 시각 대신 지금 경로의 도착시각 + 후보 간 차이
        arriveAt: candidateStop ? toHHMM(toMin(candidateStop.arriveAt) + (c.addedMin - (currentCand?.addedMin ?? 0))) : c.arriveAt,
      })),
    [candidateStop, state.dataset, candidateCurrentId],
  );

  // 최초 진입 가이드 — 앱 실행당 한 번만 (목: 영구 저장은 생략)
  const listRef = React.useRef<View>(null);
  const ctaRef = React.useRef<View>(null);
  const [guideSteps, setGuideSteps] = useState<GuideStep[] | null>(null);
  const [guideIndex, setGuideIndex] = useState(0);

  React.useEffect(() => {
    if (guideSeen) return;
    // 레이아웃이 잡힌 뒤 두 영역의 화면 좌표를 잰다
    const t = setTimeout(() => {
      // 시트가 열려 있으면 스포트라이트 구멍으로 시트가 비쳐 엉뚱한 걸 가리킨다.
      // 이번엔 건너뛰고 다음 진입에서 보여준다
      if (taskStopId || candidateStopId) return;
      const rects: Record<string, SpotRect> = {};
      const done = () => {
        if (!rects.list || !rects.cta) return;
        guideSeen = true;
        setGuideSteps([
          {
            rect: rects.list,
            title: '순서는 꾹 눌러서 바꿔요',
            body: '파란 테두리 카드를 길게 눌러 위아래로 옮기면 도착 시각이 다시 계산돼요. 왼쪽으로 밀면 그 경유지를 뺄 수 있어요.',
          },
          {
            rect: rects.cta,
            title: '나머지는 대화로 바꿔요',
            body: '들를 곳을 더하거나 조건을 바꾸는 건 여기서 AI와 대화하면 돼요. 순서·매장은 위에서 직접 만지고요.',
          },
        ]);
      };
      listRef.current?.measureInWindow((x, y, width, height) => {
        rects.list = { x, y, width, height };
        done();
      });
      ctaRef.current?.measureInWindow((x, y, width, height) => {
        rects.cta = { x, y, width, height };
        done();
      });
    }, 450);
    return () => clearTimeout(t);
  }, []);

  // A6를 보고 있다는 건 계획이 있다는 뜻 — 진행중 탭과 상태를 일치시킨다
  // (딥링크나 앱 재시작으로 확정 단계를 건너뛰고 들어온 경우 대비)
  React.useEffect(() => {
    confirmPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 개발·검증용: 딥링크 파라미터로 시트 자동 오픈 (?sheet=task|candidate|mapapp)
  React.useEffect(() => {
    const sheet = route.params?.sheet;
    if (!sheet) return;
    const firstStop = state.stops[0];
    setTaskStopId(sheet === 'task' && firstStop ? firstStop.id : null);
    setCandidateStopId(sheet === 'candidate' && firstStop ? firstStop.id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.sheet]);

  const ds = state.dataset;
  const pendingStyle = state.recalcPending ? { opacity: 0.35 } : undefined;

  const renderStop = ({ item, drag, isActive }: RenderItemParams<StopState>) => {
    const doneCount = item.tasks.filter(t => t.done).length;
    const hasCandidates = (ds.candidates[item.baseId] ?? []).length > 0;

    return (
      <TimelineRow
        node="stop"
        hideNode={isActive}
        leg={`이동 ${item.legMin}분 · ${item.legKm}km`}
        legStyle={isActive ? { opacity: 0 } : undefined}
      >
        {/* 스와이프는 카드에만 걸어 노드·커넥터는 제자리에 둔다 */}
        <ReanimatedSwipeable
          enabled={!isActive}
          friction={2}
          rightThreshold={40}
          overshootRight={false}
          containerStyle={{ borderRadius: radius.card, overflow: 'hidden' }}
          renderRightActions={() => (
            // 카드와 같은 라운드로 잘리도록 클리핑 컨테이너로 감싼다
            <View
              style={{
                width: 86,
                marginLeft: 10,
                borderRadius: radius.card,
                overflow: 'hidden',
              }}
            >
              <Pressable
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                  removeStop(item.id);
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  backgroundColor: color.track,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <TrashIcon size={26} />
              </Pressable>
            </View>
          )}
        >
          {/* 카드 전체를 길게 눌러 순서 변경 — 핸들 아이콘 없음 */}
          <Pressable onLongPress={drag} delayLongPress={220} disabled={isActive}>
            <Card
              elevated={isActive}
              style={{
                padding: 18,
                paddingTop: isActive ? 26 : 18,
                gap: 12,
                // 파란 테두리 = 길게 눌러 옮길 수 있는 카드
                borderWidth: 1.5,
                borderColor: isActive ? color.primary : 'rgba(27,87,214,0.35)',
                ...(isActive ? shadow.dragging : null),
              }}
            >
              {isActive && <StateBadge label="드래그 중" tint={color.primary} />}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={[type.item, { color: color.ink }]}>{item.name}</Text>
                  <Text
                    style={{
                      fontFamily: 'Pretendard-Regular',
                      fontSize: 13,
                      lineHeight: 17,
                      color: isActive ? color.amber : color.muted,
                    }}
                  >
                    {isActive ? '놓으면 도착 시각을 다시 계산해요' : item.openNote}
                  </Text>
                </View>
                <Text style={[type.time, { color: color.ink }, pendingStyle]}>{item.arriveAt}</Text>
              </View>

              {!isActive && (item.tasks.length > 0 || hasCandidates) && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {item.tasks.length > 0 && (
                    <SmallChip
                      label={`할 일 ${doneCount} / ${item.tasks.length}`}
                      tint={color.primary}
                      background={color.primaryTint}
                      onPress={() => setTaskStopId(item.id)}
                    />
                  )}
                  {hasCandidates && <SmallChip label="매장 교체" onPress={() => setCandidateStopId(item.id)} />}
                </View>
              )}
            </Card>
          </Pressable>
        </ReanimatedSwipeable>
      </TimelineRow>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader
        title="경로 편집"
        onBack={() => navigation.goBack()}
        right={{
          label: '완료',
          tint: color.primary,
          onPress: () => {
            haptic();
            navigation.goBack();
          },
          onLongPress: () => navigation.navigate('Error'), // 개발용: A8 진입
        }}
      >
        {/* 요약은 헤더에 — 하단은 손에 가려지는 영역 */}
        <MicroLabelRow
          padV={13}
          valueSize={17}
          items={[
            { label: '총 예상', value: `${state.totals.totalMin}분` },
            { label: '경유지', value: `${state.totals.stopCount}곳` },
            { label: '직행 대비', value: `+${state.totals.deltaMin}분`, tint: color.amber },
          ]}
        />
        {slackMin != null && (
          <Text
            style={{
              fontFamily: 'Pretendard-SemiBold',
              fontSize: 12,
              lineHeight: 12,
              textAlign: 'center',
              color: slackMin < 0 ? color.amberDeep : color.green,
            }}
          >
            {arriveByLabel} · {slackMin < 0 ? `${-slackMin}분 초과` : `${slackMin}분 여유`}
          </Text>
        )}
      </NavHeader>

      <NestableScrollContainer
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[type.label, { color: color.muted }]}>일정 순서</Text>

        <View style={{ position: 'relative' }} ref={listRef} collapsable={false}>
          <DashedLineV style={{ position: 'absolute', left: 5, top: 20, bottom: 20 }} />

          {/* 출발 */}
          <TimelineRow node="origin">
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.ink }}>
                    {originDisplay}
                  </Text>
                  <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 13, color: color.muted }}>
                    {ds.origin.note}
                  </Text>
                </View>
                <Text style={[type.time, { color: color.ink }]}>{departAtLabel}</Text>
              </View>
            </Card>
          </TimelineRow>

          {/* 경유지 (카드를 길게 눌러 재정렬) */}
          <NestableDraggableFlatList
            data={state.stops}
            keyExtractor={s => s.id}
            scrollEnabled={false}
            activationDistance={12}
            onDragBegin={() => haptic()}
            onDragEnd={({ data }) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              reorderStops(data);
            }}
            renderItem={renderStop}
          />

          {/* 도착 */}
          <TimelineRow node="dest" leg={`이동 ${state.finalLegMin}분 · ${state.finalLegKm}km`}>
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.ink }}>
                  {destinationDisplay}
                </Text>
                <Text style={[type.time, { color: color.ink }, pendingStyle]}>{state.destArriveAt}</Text>
              </View>
            </Card>
          </TimelineRow>
        </View>

      </NestableScrollContainer>

      {/* 하단 요약 + CTA */}
      <View
        style={{
          backgroundColor: color.surface,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          paddingTop: 16,
          paddingHorizontal: 20,
          paddingBottom: 16,
          gap: 14,
        }}
      >
        {/* 편집 화면이므로 실행(지도 앱)이 아니라 추가 논의로 이어간다 */}
        <View ref={ctaRef} collapsable={false}>
        <PrimaryButton
          label="AI와 대화로 수정하기"
          chevron
          height={56}
          borderRadius={18}
          onPress={() => navigation.navigate('Plan')}
        />
        </View>
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
          순서·매장은 여기서, 조건이나 들를 곳 추가는 대화로
        </Text>
      </View>
      <TabBar />

      {guideSteps && (
        <SpotlightGuide
          steps={guideSteps}
          stepIndex={guideIndex}
          onNext={() => {
            if (guideIndex + 1 < guideSteps.length) setGuideIndex(guideIndex + 1);
            else setGuideSteps(null);
          }}
          onClose={() => setGuideSteps(null)}
        />
      )}

      <TaskSheet stopId={taskStopId} onClose={() => setTaskStopId(null)} />
      <CandidateSheet
        visible={!!candidateStop}
        title={`${candidateStop?.name ?? ''} 교체`}
        candidates={candidateSheetCands}
        currentId={candidateCurrentId}
        mode={state.dataset.mode}
        onPick={candId => candidateStop && replaceStop(candidateStop.id, candId)}
        onClose={() => setCandidateStopId(null)}
      />
    </View>
  );
}
