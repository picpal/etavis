/** 저장 · 기록 · 설정 — 탭 스텁 페이지 (디자인 언어만 맞춘 placeholder) */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { color, shadow, type } from '../theme/tokens';
import { StopState, toHHMM, toMin, usePlan } from '../state/plan';
import { useTracker } from '../state/tracker';
import { Card, haptic, MicroLabelRow } from '../components/common';
import { CheckCircle, Chevron, Hairline, HeartIcon, PencilIcon, PersonPlusIcon } from '../components/primitives';
import { Connector, StateBadge, TimelineRow } from '../components/TimelineRow';
import { formatDistanceM, formatEta } from '../lib/geo';
import { useRouteLegs } from '../lib/routeLegs';
import { notifyDeadlineRisk, scheduleThanksNotification } from '../notifications';
import { TabBar } from '../components/TabBar';
import { Sheet } from '../components/Sheet';
import { DevSheet } from '../sheets/DevSheet';
import { TaskSheet } from '../sheets/TaskSheet';
import { MapAppSheet } from '../sheets/MapAppSheet';
import { SmallChip, PrimaryButton } from '../components/common';
import { NavHeader } from '../components/NavHeader';
import { BottomInputBar } from '../components/BottomInputBar';
import type { RootStackParamList } from '../../App';

const MODE_LABELS = { car: '자동차', walk: '도보', transit: '대중교통' } as const;

const fmtDist = formatDistanceM;

function TabPage({
  title,
  children,
  overlay,
  right,
}: {
  title: string;
  children: React.ReactNode;
  /** 시트 등 절대배치 오버레이 — ScrollView 밖, 탭바 위에 렌더 */
  overlay?: React.ReactNode;
  /** 헤더 우측 텍스트 액션 */
  right?: { label: string; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View
        style={{
          backgroundColor: color.surface,
          paddingTop: insets.top,
          paddingHorizontal: 20,
          paddingBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          ...shadow.header,
          zIndex: 10,
        }}
      >
        <View style={{ width: 44 }} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[type.title, { color: color.ink }]}>{title}</Text>
        </View>
        <View style={{ width: 44, alignItems: 'flex-end' }}>
          {right && (
            <Pressable
              onPress={() => {
                haptic();
                right.onPress();
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={[type.action, { color: color.primary }]}>{right.label}</Text>
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      <TabBar />
      {overlay}
    </View>
  );
}

/** 경로 이탈 확정 시 확인 시트 */
function OffRouteSheet() {
  const insets = useSafeAreaInsets();
  const { state, removeStop } = usePlan();
  const tracker = useTracker();
  const stop = state.stops.find(s => s.id === tracker.offRouteStopId);
  const lastNameRef = React.useRef('');
  if (stop) lastNameRef.current = stop.name;

  return (
    <Sheet visible={tracker.status === 'offroute' && !!stop} onClose={tracker.keepPlan}>
      <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}>
        <View style={{ gap: 6 }}>
          <Text style={[type.titleL, { color: color.ink }]}>{lastNameRef.current} 건너뛰시나요?</Text>
          <Text style={[type.body, { color: color.muted }]}>
            경로에서 {fmtDist(tracker.crossTrackM)} 벗어나 계속 이동 중이에요. 계획을 어떻게 할까요?
          </Text>
        </View>
        <PrimaryButton
          label="이 경유지 건너뛰기"
          height={54}
          borderRadius={16}
          onPress={() => {
            if (tracker.offRouteStopId) removeStop(tracker.offRouteStopId);
            tracker.dismissOffRoute();
          }}
        />
        <Pressable
          onPress={() => {
            haptic();
            tracker.keepPlan();
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
          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 17, lineHeight: 17, color: color.body }}>
            계획 유지 · 경로로 복귀
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

type PlaceState = 'passed' | 'current' | 'next' | 'upcoming';

/** 경유지 카드 — 다음·체류 중은 강조하고 행동 버튼을 붙인다 */
function StopCard({
  stop,
  placeState,
  onOpenTasks,
}: {
  stop: StopState;
  placeState: PlaceState;
  onOpenTasks: () => void;
}) {
  const doneCount = stop.tasks.filter(t => t.done).length;
  const departAt = toHHMM(toMin(stop.arriveAt) + stop.dwellMin);
  const remainMin = Math.max(stop.dwellMin - 6, 1);
  const active = placeState === 'current' || placeState === 'next';

  if (placeState === 'passed') {
    /*
      지나온 곳도 눌러서 할 일을 볼 수 있어야 한다 — "여기서 뭐 했더라"가 나중에 궁금해진다.
      취소선은 지우고 회색조만 남겼다. 완료는 우측 초록 체크가 말한다.
    */
    return (
      <Pressable onPress={onOpenTasks} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.65 })}>
        <Card style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 19, color: color.body }}>
              {stop.name}
            </Text>
            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, lineHeight: 13, color: color.muted }}>
              {stop.arriveAt} 들름
            </Text>
            <CheckCircle size={22} tint={color.green} />
          </View>
          {stop.tasks.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <SmallChip label={`할 일 ${doneCount} / ${stop.tasks.length}`} tint={color.body} background={color.bg} />
            </View>
          )}
        </Card>
      </Pressable>
    );
  }

  return (
    <Card elevated={active} style={{ padding: 18, paddingTop: active ? 26 : 18, gap: 12 }}>
      {placeState === 'current' && <StateBadge label="체류 중" tint={color.green} />}
      {placeState === 'next' && <StateBadge label="다음" tint={color.primary} />}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[type.item, { color: color.ink }]}>{stop.name}</Text>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
            {placeState === 'current' ? `${stop.arriveAt} 도착 · ${departAt} 출발 예정` : stop.openNote}
          </Text>
        </View>
        {placeState === 'current' ? (
          <View style={{ backgroundColor: color.primaryTint, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 }}>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 13, lineHeight: 13, color: color.primary }}>
              남은 {remainMin}분
            </Text>
          </View>
        ) : (
          <Text style={[type.time, { color: color.ink }]}>{stop.arriveAt}</Text>
        )}
      </View>

      {stop.tasks.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <SmallChip
            label={`할 일 ${doneCount} / ${stop.tasks.length}`}
            tint={color.primary}
            background={color.primaryTint}
            onPress={onOpenTasks}
          />
        </View>
      )}

      {/* 도착·출발은 GPS 지오펜스로 자동 전환한다 (네이버 길찾기 방식) */}
      {active && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color.stroke }} />
          <Text style={{ flex: 1, fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
            {placeState === 'current' ? '멀어지면 자동으로 출발 처리돼요' : '가까워지면 자동으로 도착 처리돼요'}
          </Text>
        </View>
      )}
    </Card>
  );
}

/** 마감 초과가 예측되면 한 번만 알린다 (만회 가능한 시점) */
function useDeadlineRiskAlert(slackMin: number | null, deadlineLabel: string) {
  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (slackMin == null) {
      firedRef.current = false;
      return;
    }
    if (slackMin < 0 && !firedRef.current) {
      firedRef.current = true;
      notifyDeadlineRisk(-slackMin, deadlineLabel);
    }
    if (slackMin >= 5) firedRef.current = false; // 여유를 회복하면 다시 감시
  }, [slackMin, deadlineLabel]);
}

/** 진행중 — 확정한 계획의 실행 뷰 */
export function TodayScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state, destinationDisplay, originDisplay, slackMin, arriveByLabel } = usePlan();
  const tracker = useTracker();
  // 대중교통이면 지도 앱이 경유지를 못 받아 구간 단위로 넘긴다
  const { legs, nextLeg, byLeg } = useRouteLegs();
  const [taskStopId, setTaskStopId] = useState<string | null>(null);
  const [mapAppOpen, setMapAppOpen] = useState(false);

  /*
    알림에서 들어온 경우 해당 시트를 바로 연다.
    도착 알림 → 그 경유지 할 일 / 대중교통 출발 알림 → 구간 길찾기
  */
  const params = (useRoute().params ?? {}) as { sheet?: 'task' | 'mapapp'; stopId?: string };
  React.useEffect(() => {
    if (params.sheet === 'task' && params.stopId) setTaskStopId(params.stopId);
    if (params.sheet === 'mapapp') setMapAppOpen(true);
  }, [params.sheet, params.stopId]);
  useDeadlineRiskAlert(state.planConfirmed ? slackMin : null, arriveByLabel);

  if (!state.planConfirmed) {
    return (
      <TabPage title="진행 중">
        <Card style={{ padding: 24, gap: 12, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.ink }}>
            진행 중인 계획이 없어요
          </Text>
          <Text
            style={{
              fontFamily: 'Pretendard-Regular',
              fontSize: 13,
              lineHeight: 19,
              color: color.muted,
              textAlign: 'center',
            }}
          >
            경로를 확정하면 다음 경유지와 할 일이{'\n'}여기에 표시돼요
          </Text>
          <PrimaryButton
            label="계획 만들기"
            height={48}
            borderRadius={14}
            style={{ alignSelf: 'stretch', marginTop: 4 }}
            onPress={() => navigation.navigate('Home')}
          />
        </Card>
      </TabPage>
    );
  }

  const next = state.stops[0];
  const doneCount = next ? next.tasks.filter(t => t.done).length : 0;

  /*
    구간 진행 상태. 이동 중이면 나는 두 노드 '사이'에 있고, 체류 중이면 노드 '위'에 있다.
    구간 k는 (k-1)번째 장소 → k번째 장소. 0 = 출발지 → 첫 경유지.
  */
  /*
    공유 문구 — 기다리는 사람이 궁금한 건 내 위치가 아니라 '몇 시에 오냐'다.
    이미 지나온 경유지는 빼고, 앞으로 들를 곳만 적는다.
  */
  const shareMessage = (() => {
    const lines = ['[Etavia] 같이 가는 길', `${destinationDisplay} ${formatEta(state.destArriveAt)} 도착 예정`];
    const remaining = state.stops.slice(state.passedCount);
    if (remaining.length) lines.push(`들렀다 가요 · ${remaining.map(s => s.name).join(', ')}`);
    if (slackMin != null) {
      lines.push(slackMin < 0 ? `${arriveByLabel} 기준 ${-slackMin}분 초과` : `${arriveByLabel} 기준 ${slackMin}분 여유`);
    }
    return lines.join('\n');
  })();

  const activeSeg = state.atStop ? -1 : state.passedCount;
  const doneThrough = state.atStop ? state.passedCount : state.passedCount - 1;
  const segStyle = (k: number, part: 'above' | 'below'): Connector => {
    if (k <= doneThrough) return 'solid';
    // 이동 중인 구간은 현재 위치 마커까지만 실선 — 마커는 다음 행의 leg 줄에 있다
    if (k === activeSeg) return part === 'above' ? 'split' : 'solid';
    return 'dashed';
  };

  return (
    <TabPage
      title="진행 중"
      right={{ label: '편집', onPress: () => navigation.navigate('Timeline') }}
      overlay={
        <>
          <TaskSheet stopId={taskStopId} onClose={() => setTaskStopId(null)} />
          <MapAppSheet visible={mapAppOpen} onClose={() => setMapAppOpen(false)} />
          <OffRouteSheet />
        </>
      }
    >
      {/* 진행 중인 계획 — 이 화면의 주인공이라 맨 위에서 elevated로 강조한다 */}
      <Text style={[type.label, { color: color.muted }]}>진행 중인 계획</Text>
      <Card elevated style={{ padding: 18, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[type.labelPlain, { color: color.muted }]} numberOfLines={1}>
              {originDisplay} → {destinationDisplay}
            </Text>
            <Text style={[type.statL, { color: color.ink }]}>{state.totals.totalMin}분</Text>
          </View>
          <Text style={[type.statS, { color: color.amber }]}>+{state.totals.deltaMin}분</Text>
        </View>
        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 19, color: color.muted }}>
          경유지 {state.totals.stopCount}곳 · {MODE_LABELS[state.mode]} · 도착 예정 {formatEta(state.destArriveAt)}
        </Text>
        {/* 마감이 있을 때만 여유·초과가 등장한다 */}
        {slackMin != null && (
          <Text
            style={{
              fontFamily: 'Pretendard-SemiBold',
              fontSize: 13,
              lineHeight: 18,
              color: slackMin < 0 ? color.amberDeep : color.green,
            }}
          >
            {arriveByLabel} · {slackMin < 0 ? `${-slackMin}분 초과` : `${slackMin}분 여유`}
          </Text>
        )}
      </Card>

      {/* 주행 상태 — 폴리라인 대비 수직거리로 판정. 카드 문구가 곧 제목이라 라벨은 두지 않는다 */}
      {tracker.mode !== 'off' && (
        <>
          <Card
            style={{
              padding: 18,
              gap: 8,
              ...(tracker.status === 'detour' || tracker.status === 'suspect'
                ? { backgroundColor: color.amberBg }
                : null),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 4.5,
                  backgroundColor:
                    tracker.status === 'moving'
                      ? color.green
                      : tracker.status === 'stalled' || tracker.status === 'faraway' || tracker.status === 'idle'
                        ? color.muted
                        : color.amber,
                }}
              />
              <Text
                style={{
                  flex: 1,
                  fontFamily: 'Pretendard-SemiBold',
                  fontSize: 16,
                  lineHeight: 20,
                  color: tracker.status === 'moving' ? color.ink : color.amberDeep,
                }}
              >
                {tracker.status === 'idle'
                  ? '위치 확인 중…'
                  : tracker.status === 'faraway'
                  ? '경로에서 떨어진 위치예요'
                  : tracker.status === 'moving'
                  ? '이동중 · 경로 위'
                  : tracker.status === 'stalled'
                    ? '정체 중 · 경로 위'
                    : tracker.status === 'suspect'
                      ? '경로 확인 중…'
                      : tracker.status === 'detour'
                        ? `우회 중 · 도착 +${tracker.etaDeltaMin}분`
                        : '경로를 벗어났어요'}
              </Text>
            </View>
            <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}>
              {!tracker.position
                ? tracker.mode === 'live'
                  ? 'GPS 신호를 기다리는 중이에요'
                  : '위치 대기 중'
                : tracker.status === 'faraway'
                  ? `경로까지 ${fmtDist(tracker.crossTrackM)} · 계획한 지역으로 이동하면 자동으로 추적해요`
                  : `경로에서 ${fmtDist(tracker.crossTrackM)} · 진행 ${(tracker.progressM / 1000).toFixed(1)}km / ${(tracker.routeLengthM / 1000).toFixed(1)}km`}
            </Text>
          </Card>
        </>
      )}

      {/* 일정 순서 — 좌측 커넥터로 순서를 잇고, 장소마다 카드 하나.
          커넥터는 행마다 조각으로 그린다: 지나온 구간은 파란 실선, 앞으로 갈 구간은 점선 */}
      <Text style={[type.label, { color: color.muted }]}>일정 순서</Text>
      <View>
        {/* 카드가 이미 흐리므로 노드에는 dim을 걸지 않는다 — 노드는 회색 점으로 '지나옴'을 말한다 */}
        <TimelineRow node="origin" nodeState="passed" below={segStyle(0, 'below')}>
          <Card style={{ padding: 16, opacity: 0.6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 19, color: color.ink }}>
                {originDisplay}
              </Text>
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 14, color: color.muted }}>
                {state.dataset.origin.departAt} 출발
              </Text>
            </View>
          </Card>
        </TimelineRow>

        {state.stops.map((stop, i) => {
          const placeState: PlaceState =
            i < state.passedCount ? 'passed' : i === state.passedCount ? (state.atStop ? 'current' : 'next') : 'upcoming';
          return (
            <TimelineRow
              key={stop.id}
              node="stop"
              leg={`이동 ${stop.legMin}분 · ${stop.legKm}km`}
              nodeState={placeState === 'passed' ? 'passed' : placeState === 'current' ? 'current' : 'upcoming'}
              legActive={activeSeg === i}
              above={segStyle(i, 'above')}
              below={segStyle(i + 1, 'below')}
            >
              <StopCard
                stop={stop}
                placeState={placeState}
                onOpenTasks={() => setTaskStopId(stop.id)}
              />
            </TimelineRow>
          );
        })}

        <TimelineRow
          node="dest"
          leg={`이동 ${state.finalLegMin}분 · ${state.finalLegKm}km`}
          legActive={activeSeg === state.stops.length}
          above={segStyle(state.stops.length, 'above')}
        >
          <Card style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.ink }}>
                {destinationDisplay}
              </Text>
              <Text style={[type.time, { color: color.ink }]}>{state.destArriveAt}</Text>
            </View>
          </Card>
        </TimelineRow>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PrimaryButton
          label={byLeg ? '구간별 지도 보기' : '지도 앱에서 열기'}
          chevron
          height={56}
          borderRadius={18}
          style={{ flex: 1 }}
          onPress={() => setMapAppOpen(true)}
        />
        {/* 일행 초대 — 기다리는 사람이 궁금한 건 내 위치가 아니라 '몇 시에 오냐'다.
            아직 서버가 없어 초대 '링크'는 못 만들고 텍스트만 보낸다. 받는 쪽은 앱이 없어도 된다 */}
        <Pressable
          onPress={() => {
            haptic();
            Share.share({ message: shareMessage }).catch(() => {});
          }}
          style={({ pressed }) => ({
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: color.track,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <PersonPlusIcon size={22} tint={color.body} />
        </Pressable>
      </View>
      {byLeg && nextLeg && (
        <Text
          style={{
            fontFamily: 'Pretendard-Regular',
            fontSize: 13,
            lineHeight: 18,
            color: color.muted,
            textAlign: 'center',
          }}
          numberOfLines={1}
        >
          {nextLeg.to.name}까지 · {legs.length}개 구간 중 {nextLeg.index + 1}번째
        </Text>
      )}
    </TabPage>
  );
}

type HistoryRow = {
  name: string;
  time: string;
  node: 'origin' | 'stop' | 'dest';
  /** 그때 그 장소에서 하기로 했던 일 — '여기서 뭐 했더라'를 되짚는 게 기록의 쓸모다 */
  tasks?: string[];
};
type HistoryRecord = {
  route: string;
  when: string;
  min: number;
  note: string;
  rows: HistoryRow[];
};

const HISTORY_RECORDS: HistoryRecord[] = [
  {
    route: '집 → 회사',
    when: '오늘 07:40',
    min: 62,
    note: '경유 2곳 · 자동차',
    rows: [
      { name: '집', time: '07:40', node: 'origin' },
      {
        name: '올리브영 국회의사당역점',
        time: '08:05',
        node: 'stop',
        tasks: ['선크림 리필', '클렌징폼 2+1 확인', '멤버십 적립'],
      },
      {
        name: '파리바게뜨 목동역점',
        time: '08:31',
        node: 'stop',
        tasks: ['샌드위치 2개', '아메리카노 픽업'],
      },
      { name: '회사', time: '08:42', node: 'dest' },
    ],
  },
  {
    route: '집 → 평창역',
    when: '어제 14:20',
    min: 41,
    note: '경유 1곳 · 자동차',
    rows: [
      { name: '집', time: '14:20', node: 'origin' },
      { name: '스타벅스 평창점', time: '14:38', node: 'stop', tasks: ['아메리카노 2잔 포장', '기프티콘 사용'] },
      { name: '평창역', time: '15:01', node: 'dest' },
    ],
  },
  {
    route: '평창역 → 알펜시아 리조트',
    when: '어제 16:05',
    min: 24,
    note: '직행 · 자동차',
    rows: [
      { name: '평창역', time: '16:05', node: 'origin' },
      { name: '알펜시아 리조트', time: '16:29', node: 'dest', tasks: ['체크인', '주차 등록'] },
    ],
  },
  {
    route: '알펜시아 리조트 → 대관령 양떼목장',
    when: '그제 11:30',
    min: 18,
    note: '직행 · 자동차',
    rows: [
      { name: '알펜시아 리조트', time: '11:30', node: 'origin' },
      { name: '대관령 양떼목장', time: '11:48', node: 'dest', tasks: ['입장권 예매 확인'] },
    ],
  },
];

/** 두 시각 사이 소요 — 카드 사이 구간 표기 겸 시각적 간격 */
function legLabel(from: string, to: string): string | undefined {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const d = th * 60 + tm - (fh * 60 + fm);
  return Number.isFinite(d) && d > 0 ? `이동 ${d}분` : undefined;
}

/** 카드 한 장 높이 어림 — 시트를 내용만큼만 띄우기 위한 계산 */
const ROW_BASE_H = 54;
const TASK_H = 25;
const LEG_H = 27;
/** 그랩바 + 헤더 + 요약 + 구분선 위아래 여백 */
const SHEET_CHROME_H = 206;

/** 기록 상세 — 지난 계획을 읽기 전용 타임라인으로 */
function HistoryDetailSheet({
  record,
  onClose,
}: {
  record: HistoryRecord | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const lastRef = React.useRef(record);
  if (record) lastRef.current = record;
  const rec = lastRef.current;

  /* 내용이 적으면 작게, 많으면 화면을 꽉 채우고 스크롤한다.
     ScrollView는 콘텐츠만큼 늘어나지 않으므로 시트에 확정 높이를 줘야 flex:1 스크롤이 산다 */
  const bodyH = rec
    ? rec.rows.reduce(
        (sum, r, i) => sum + ROW_BASE_H + (r.tasks?.length ?? 0) * TASK_H + (i === 0 ? 0 : LEG_H),
        0,
      )
    : 0;
  const sheetHeight = SHEET_CHROME_H + bodyH + Math.max(insets.bottom, 20);

  return (
    <Sheet visible={!!record} onClose={onClose} height={sheetHeight}>
      {rec && (
        <View style={{ flex: 1, paddingTop: 8 }}>
          <View style={{ paddingHorizontal: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ gap: 4, flex: 1 }}>
                <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
                  이동 기록 · {rec.when}
                </Text>
                <Text style={[type.titleL, { color: color.ink }]} numberOfLines={1}>
                  {rec.route}
                </Text>
              </View>
              <Pressable onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ paddingTop: 2 }}>
                <Text style={[type.action, { color: color.primary }]}>완료</Text>
              </Pressable>
            </View>

            <MicroLabelRow
              padV={13}
              valueSize={16}
              background={color.surface}
              items={[
                { label: '총 소요', value: `${rec.min}분` },
                { label: '경유지', value: `${Math.max(0, rec.rows.length - 2)}곳` },
                { label: '이동수단', value: '자동차' },
              ]}
            />

          </View>

          {/* 스크롤 경계 — 구분선이 없으면 카드가 요약 밑으로 파고들어 겹쳐 보인다.
              '일정 순서' 라벨은 뺐다 — 헤더가 이미 어떤 이동인지 말해준다 */}
          <View style={{ height: 16 }} />
          <Hairline />

          {/* 지난 계획 — 진행중과 같은 타임라인 구조로. 다 지나온 이동이라 커넥터는 전부 실선 */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 14,
              paddingBottom: Math.max(insets.bottom, 20),
            }}
          >
            {rec.rows.map((row, i) => (
              <TimelineRow
                key={row.name}
                node={row.node}
                nodeState="passed"
                leg={i === 0 ? undefined : legLabel(rec.rows[i - 1].time, row.time)}
                above={i === 0 ? 'none' : 'solid'}
                below={i === rec.rows.length - 1 ? 'none' : 'solid'}
              >
                <Card style={{ padding: 16, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text
                      style={{ flex: 1, fontFamily: 'Pretendard-SemiBold', fontSize: 16, lineHeight: 20, color: color.ink }}
                      numberOfLines={1}
                    >
                      {row.name}
                    </Text>
                    <Text style={[type.time, { color: color.ink }]}>{row.time}</Text>
                  </View>
                  {row.tasks?.length ? (
                    <View style={{ gap: 6 }}>
                      {row.tasks.map(t => (
                        <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                          <CheckCircle size={15} tint={color.green} />
                          <Text
                            style={{ flex: 1, fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 18, color: color.muted }}
                          >
                            {t}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Card>
              </TimelineRow>
            ))}
          </ScrollView>

          {/* '이 경로로 다시 계획하기'는 뺐다 — 기록은 되짚어 보는 곳이지 다시 실행하는 곳이 아니다 */}
        </View>
      )}
    </Sheet>
  );
}

export function HistoryScreen() {
  const [selected, setSelected] = useState<HistoryRecord | null>(null);

  return (
    <TabPage
      title="이동 기록"
      overlay={
        <HistoryDetailSheet record={selected} onClose={() => setSelected(null)} />
      }
    >
      <Text style={[type.label, { color: color.muted }]}>지난 이동</Text>
      {HISTORY_RECORDS.map(rec => (
        <Pressable
          key={rec.route}
          onPress={() => {
            haptic();
            setSelected(rec);
          }}
        >
          {({ pressed }) => (
            <Card style={{ padding: 18, gap: 10, opacity: pressed ? 0.8 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={[type.labelPlain, { color: color.muted }]}>{rec.when}</Text>
                  <Text style={[type.item, { color: color.ink }]} numberOfLines={1}>
                    {rec.route}
                  </Text>
                </View>
                <Text style={[type.statS, { color: color.ink }]}>{rec.min}분</Text>
              </View>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
                {rec.note}
              </Text>
            </Card>
          )}
        </Pressable>
      ))}
      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
        기록을 탭하면 지난 계획을 볼 수 있어요 · 데모용 예시입니다
      </Text>
    </TabPage>
  );
}

/** 주변 — 현재 위치 혼잡도 제보 + 커뮤니티 한줄 소식 */
type NearbyPost = {
  id: string;
  text: string;
  place: string;
  when: string;
  author: string;
  avatarColor: string;
  likes: number;
  likedByMe?: boolean;
  /** 관련 경유지 이름 — 경로 필터·방문 순서 정렬의 앵커 */
  anchor?: string;
  /** 그 경유지로 가는 구간(도로) 소식 — 경유지 소식보다 먼저 정렬 */
  road?: boolean;
};

const NEARBY_POSTS: NearbyPost[] = [
  { id: 'p1', text: '올리브영 평창점 웨이팅 없어요', place: '올리브영 평창점', when: '3분 전', author: '민지', avatarColor: color.primary, likes: 4, anchor: '올리브영 평창점' },
  { id: 'p2', text: '대관령 방면 안개, 서행하세요', place: '대관령IC', when: '12분 전', author: '준호', avatarColor: '#0F5C3E', likes: 12, anchor: '올리브영 평창점', road: true },
  { id: 'p3', text: '교촌 평창점 포장 20분 정도 걸린대요', place: '교촌치킨 평창점', when: '25분 전', author: '수현', avatarColor: color.amber, likes: 7, anchor: '교촌치킨 평창점' },
];

/** 체류시간 제보 선택지(분) */

const CONGESTION = [
  { key: 'low', label: '여유', tint: color.green },
  { key: 'mid', label: '보통', tint: color.primary },
  { key: 'high', label: '혼잡', tint: color.amber },
  { key: 'veryhigh', label: '매우혼잡', tint: '#B33B2B' },
] as const;

export function NearbyScreen() {
  const insets = useSafeAreaInsets();
  const { state, setCongestionReport } = usePlan();
  const myReport = state.congestionReport;
  const setMyReport = setCongestionReport;
  const [posts, setPosts] = useState<NearbyPost[]>(NEARBY_POSTS);
  const [pickedPlace, setPickedPlace] = useState<string | null>(null);
  // 내 제보 수정 모드 — 연필 탭 시 글이 입력창에 실린다
  const [editing, setEditing] = useState<NearbyPost | null>(null);
  const [draft, setDraft] = useState<{ text: string; key: string } | undefined>();
  const draftSeq = React.useRef(0);
  const pushDraft = (text: string) => {
    draftSeq.current += 1;
    setDraft({ text, key: `d${draftSeq.current}` });
  };

  // 혼잡도 대상 장소: 도착한 경유지(진행 중) 또는 지역. 장소 단위는 제보가 없을 수 있다.
  const congestionPlace = state.planConfirmed && state.stops[0] ? state.stops[0].name : '평창 일대';
  const baseReportCount = state.planConfirmed && state.stops[0] ? 0 : 12;
  const reportCount = baseReportCount + (myReport ? 1 : 0);
  const level = myReport
    ? CONGESTION.find(c => c.key === myReport)!
    : baseReportCount > 0
      ? CONGESTION.find(c => c.key === 'mid')!
      : null;

  // 진행 중 계획과 매핑: 확정된 계획이 있으면 다음 경유지에 근접/도착한 것으로 본다.
  // 제보는 실제 있는 장소에서만 — 도착한 경유지와 현재 지역만 선택 가능, 나머지 경유지는 비활성.
  const placeOptions: { name: string; postable: boolean }[] = state.planConfirmed
    ? [
        ...state.stops.map((s, i) => ({ name: s.name, postable: i === 0 })),
        { name: '평창 · 내 주변', postable: true },
      ]
    : [{ name: '평창 · 내 주변', postable: true }];
  const autoPlace = placeOptions[0].name;
  const effectivePlace =
    pickedPlace && placeOptions.some(o => o.name === pickedPlace && o.postable) ? pickedPlace : autoPlace;

  // 경로 관련 소식만, 방문 순서(구간 도로 → 경유지)로 정렬. 미확정이면 전체 최신순.
  const orderOf = (p: NearbyPost) => {
    const idx = state.stops.findIndex(s => s.name === p.anchor);
    if (idx >= 0) return idx * 2 + (p.road ? 0 : 1);
    return p.id.startsWith('me-') ? -1 : 999; // 내 제보는 앵커 없어도 맨 위에 유지
  };
  const visiblePosts = state.planConfirmed
    ? posts
        .map(p => ({ p, o: orderOf(p) }))
        .filter(x => x.o < 999)
        .sort((a, b) => a.o - b.o)
        .map(x => x.p)
    : posts;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View
        style={{
          backgroundColor: color.surface,
          paddingTop: insets.top,
          paddingHorizontal: 20,
          paddingBottom: 14,
          alignItems: 'center',
          ...shadow.header,
          zIndex: 10,
        }}
      >
        <Text style={[type.title, { color: color.ink }]}>주변 · 평창</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[type.label, { color: color.muted }]}>예상 혼잡도</Text>
          <Card style={{ padding: 18, gap: 14 }}>
            {/* 장소 · 상태 · 기준을 세로로 쌓아 가운데 정렬.
                가로 space-between으로 밀어붙이면 상태 글자 수에 따라 좌우로 쏠리고 가운데가 텅 빈다 */}
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text
                numberOfLines={1}
                style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.body }}
              >
                {congestionPlace}
              </Text>
              <Text style={[type.statL, { color: level ? level.tint : color.placeholder }]}>
                {level ? level.label : '제보 없음'}
              </Text>
              <Text style={[type.labelPlain, { color: color.muted }]}>
                {reportCount > 0 ? `최근 1시간 제보 ${reportCount}건 기준` : '최근 1시간 제보 없음'}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.07)' }} />
            <View style={{ gap: 9 }}>
              <Text style={[type.labelPlain, { color: color.muted, textAlign: 'center' }]}>
                {level ? '지금 상황 제보하기' : '아직 제보가 없어요 · 첫 제보를 남겨주세요'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
                {CONGESTION.map(c => {
                  const active = myReport === c.key;
                  return (
                    <SmallChip
                      key={c.key}
                      label={active ? `${c.label} ✓` : c.label}
                      tint={active ? color.primary : color.body}
                      background={active ? color.primaryTint : color.bg}
                      onPress={() => setMyReport(active ? null : c.key)}
                    />
                  );
                })}
              </View>
            </View>
          </Card>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text style={[type.label, { color: color.muted }]}>한줄 소식</Text>
            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, color: color.primary }}>
              {state.planConfirmed ? '내 경로 순' : '최신순'}
            </Text>
          </View>
          <Card style={{ padding: 8 }}>
            {/* 빈 카드만 덩그러니 있으면 고장 난 줄 안다. 왜 비었는지 + 뭘 하면 되는지 적는다 */}
            {visiblePosts.length === 0 && (
              <View style={{ paddingVertical: 26, paddingHorizontal: 16, gap: 6, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 19, color: color.body }}>
                  아직 올라온 소식이 없어요
                </Text>
                <Text
                  style={{
                    fontFamily: 'Pretendard-Regular',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.muted,
                    textAlign: 'center',
                  }}
                >
                  {state.planConfirmed
                    ? '내 경로와 관련된 소식만 보여드려요.\n아래에서 지금 상황을 한 줄 남기면 첫 소식이 돼요.'
                    : '아래에서 지금 상황을 한 줄 남겨보세요.\n같은 길을 가는 분들께 도움이 돼요.'}
                </Text>
              </View>
            )}
            {visiblePosts.map((post, i) => {
              const mine = post.id.startsWith('me-');
              return (
                <React.Fragment key={post.id}>
                  {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 10,
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                    }}
                  >
                    {/* 프로필 아바타 */}
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: post.avatarColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 10, lineHeight: 12, color: '#fff' }}>
                        {post.author.slice(0, 1)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 15, lineHeight: 21, color: color.ink }}>
                        {post.text}
                      </Text>
                      <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 16, color: color.muted }}>
                        {post.author} · {post.place} · {post.when}
                      </Text>
                    </View>
                    {mine && (
                      <Pressable
                        onPress={() => {
                          haptic();
                          setEditing(post);
                          pushDraft(post.text);
                        }}
                        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginTop: 3 })}
                      >
                        <PencilIcon tint={editing?.id === post.id ? color.primary : color.stroke} size={15} />
                      </Pressable>
                    )}
                    {/* 하트 */}
                    <Pressable
                      onPress={() => {
                        haptic();
                        setPosts(prev =>
                          prev.map(p =>
                            p.id === post.id
                              ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) }
                              : p,
                          ),
                        );
                      }}
                      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 2,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <HeartIcon filled={!!post.likedByMe} />
                      {/* 하트 기준 좌측 정렬 — 3자리 수까지 폭 고정 */}
                      <Text
                        style={{
                          fontFamily: 'Pretendard-SemiBold',
                          fontSize: 12,
                          lineHeight: 12,
                          color: post.likedByMe ? '#B33B2B' : color.muted,
                          minWidth: 24,
                          textAlign: 'left',
                        }}
                      >
                        {post.likes}
                      </Text>
                    </Pressable>
                  </View>
                </React.Fragment>
              );
            })}
          </Card>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
            {state.planConfirmed
              ? '내 경로와 관련된 소식만 방문 순서대로 보여드려요'
              : '같은 지역을 지나는 사람들의 실시간 제보예요'}
          </Text>
        </ScrollView>

        {/* 제보 위치 — 진행 중 계획 기준 자동 선택, 칩으로 변경. 수정 중엔 배너로 전환 */}
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 8 }}>
          {editing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, color: color.primary }}>
                내 제보 수정 중 · {editing.place.replace(' · 내 제보', '')}
              </Text>
              <Pressable
                onPress={() => {
                  haptic();
                  setEditing(null);
                  pushDraft('');
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, color: color.muted }}>
                  취소
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, color: color.muted }}>
              제보 위치{state.planConfirmed ? ' · 지금 있는 장소에서만 제보할 수 있어요' : ''}
            </Text>
          )}
          {!editing && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {placeOptions.map((opt, i) => {
              const active = opt.name === effectivePlace;
              const isAuto = state.planConfirmed && i === 0;
              return (
                <View key={opt.name} style={{ opacity: opt.postable ? 1 : 0.45 }}>
                  <SmallChip
                    label={isAuto ? `${opt.name} · 도착` : opt.name}
                    tint={active ? color.primary : color.body}
                    background={active ? color.primaryTint : color.bg}
                    onPress={opt.postable ? () => setPickedPlace(opt.name) : undefined}
                  />
                </View>
              );
            })}
          </ScrollView>
          )}
        </View>

        <BottomInputBar
          placeholder={editing ? '수정할 내용을 입력하세요' : '지금 상황을 한 줄로 남겨보세요'}
          draft={draft}
          onSubmit={text => {
            if (editing) {
              const target = editing;
              setPosts(prev =>
                prev.map(p => (p.id === target.id ? { ...p, text, when: '방금 전 · 수정됨' } : p)),
              );
              setEditing(null);
              return;
            }
            const id = `me-${posts.length}`;
            setPosts(prev => [
              {
                id,
                text,
                place: `${effectivePlace} · 내 제보`,
                when: '방금 전',
                author: '나',
                avatarColor: color.ink,
                likes: 0,
                anchor: state.stops.some(s => s.name === effectivePlace) ? effectivePlace : undefined,
              },
              ...prev,
            ]);
            // 목: 8초 뒤 하트 5개 적립 + 감사 알림
            scheduleThanksNotification(text, 5);
            setTimeout(() => {
              setPosts(prev => prev.map(p => (p.id === id ? { ...p, likes: p.likes + 5 } : p)));
            }, 8000);
          }}
        />
      </KeyboardAvoidingView>
      <TabBar />
    </View>
  );
}

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { state } = usePlan();
  const [devOpen, setDevOpen] = useState(false);

  const rows = [
    { name: '기본 이동수단', value: MODE_LABELS[state.mode] },
    { name: '지도 앱 연결', value: '네이버지도' },
    { name: '알림', value: '켜짐' },
    { name: '앱 정보', value: '1.0.0' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="설정" onBack={() => navigation.goBack()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
      <Text style={[type.label, { color: color.muted }]}>일반</Text>
      <Card style={{ padding: 8 }}>
        {rows.map((row, i) => (
          <React.Fragment key={row.name}>
            {i > 0 && <View style={{ height: 1, backgroundColor: 'rgba(16,32,58,0.06)', marginHorizontal: 12 }} />}
            <Pressable
              onPress={haptic}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 15,
                paddingHorizontal: 12,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 16, lineHeight: 20, color: color.ink }}>
                {row.name}
              </Text>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 14, color: color.muted }}>
                {row.value}
              </Text>
              <Chevron size={8} thickness={2} color={color.stroke} dir="right" />
            </Pressable>
          </React.Fragment>
        ))}
      </Card>

      <Text style={[type.label, { color: color.muted }]}>개발</Text>
      <Card style={{ padding: 8 }}>
        <Pressable
          onPress={() => {
            haptic();
            setDevOpen(true);
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
          <Text style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 16, lineHeight: 20, color: color.ink }}>
            개발 메뉴
          </Text>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 14, lineHeight: 14, color: color.muted }}>
            {state.dataset.label.split(' ')[0]}
          </Text>
          <Chevron size={8} thickness={2} color={color.stroke} dir="right" />
        </Pressable>
      </Card>
      </ScrollView>

      <DevSheet visible={devOpen} onClose={() => setDevOpen(false)} />
    </View>
  );
}
