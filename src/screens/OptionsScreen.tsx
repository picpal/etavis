/** A5 — 추천. 답(제시간 도착 여부)이 맨 위, 3안은 그 아래. "최적"이 아니라 "검증한 안 중 최선" */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { usePlan, toHHMM } from '../state/plan';
import { usePlanFlow } from '../state/planFlowProvider';
import { usePlanRequest } from '../state/usePlanRequest';
import { effectiveVisits, josa, slotCandidates, toLegacyPlan } from '../state/planFlowBridge';
import { haptic, PrimaryButton } from '../components/common';
import { NavHeader } from '../components/NavHeader';
import { TabBar } from '../components/TabBar';
import { CandidateSheet } from '../sheets/CandidateSheet';
import { StopList } from '../components/StopList';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Options'>;

const hhmm = (min: number) => toHHMM(Math.round(min)).padStart(5, '0');

/**
 * 출발→도착 타임바. 직행이면 어디까지, 들르면 얼마나 더, 마감은 어디쯤인지를 한 줄로 보인다.
 * 숫자 세 개(직행·경유·마감)를 문장으로 읽게 하지 않으려고.
 */
function EtaBar({ departMin, directMin, totalMin, arriveByMin, estimated }: {
  departMin: number; directMin: number; totalMin: number; arriveByMin: number | null; estimated: boolean;
}) {
  const deadline = arriveByMin == null ? null : arriveByMin - departMin;
  // 막대 끝이 곧 도착(또는 더 늦은 마감). 여백을 두면 도착점이 어디인지 흐려진다
  const span = Math.max(totalMin, deadline ?? 0, 1);
  const pct = (m: number) => `${Math.max(0, Math.min(100, (m / span) * 100))}%` as const;
  const late = deadline != null && totalMin > deadline;
  const pre = estimated ? '약 ' : '';
  const dp = deadline == null ? 0 : (deadline / span) * 100;
  const deadlineAtEdge = dp < 22 || dp > 78;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 22, justifyContent: 'center' }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: color.track, overflow: 'hidden' }}>
          {/* 들르기 포함 전체. 늦으면 마감을 넘긴 구간만 파스텔 레드 — 어디서부터 늦는지 보이게 */}
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(totalMin), backgroundColor: color.primary, borderRadius: 4 }} />
          {late && (
            <View style={{ position: 'absolute', left: pct(Math.max(0, deadline!)), top: 0, bottom: 0, width: pct(totalMin - Math.max(0, deadline!)), backgroundColor: color.lateSoft, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
          )}
          {/* 직행만큼은 옅게 — 그 위로 튀어나온 부분이 '들러서 더 걸리는' 시간 */}
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(directMin), backgroundColor: color.stroke, borderRadius: 4 }} />
        </View>
        {deadline != null && (
          <View style={{ position: 'absolute', left: pct(deadline), top: 0, bottom: 0, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: late ? color.late : color.green }} />
        )}
      </View>
      <View style={{ height: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={[type.micro, { color: color.muted }]}>{hhmm(departMin)} 출발</Text>
          <Text style={[type.micro, { color: color.muted }]}>{pre}{hhmm(departMin + totalMin)} 도착</Text>
        </View>
        {/* 마감 라벨은 눈금 바로 아래. 가장자리에 붙어 출발·도착 라벨과 겹칠 때는 아래 범례 줄로 내린다 */}
        {deadline != null && !deadlineAtEdge && (
          <View style={{ position: 'absolute', top: 0, left: pct(deadline), width: 120, marginLeft: -60, alignItems: 'center' }}>
            <Text style={[type.micro, { color: late ? color.late : color.green, backgroundColor: color.bg, paddingHorizontal: 4 }]}>마감 {hhmm(arriveByMin!)}</Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.stroke }} />
          <Text style={[type.micro, { color: color.muted }]}>직행 {Math.round(directMin)}분</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.primary }} />
          <Text style={[type.micro, { color: color.muted }]}>들르기 +{Math.round(totalMin - directMin)}분</Text>
        </View>
        {late && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.lateSoft }} />
            <Text style={[type.micro, { color: color.muted }]}>초과 {Math.round(totalMin - Math.max(0, deadline!))}분</Text>
          </View>
        )}
        {deadline != null && deadlineAtEdge && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 2, height: 10, borderRadius: 1, backgroundColor: late ? color.late : color.green }} />
            <Text style={[type.micro, { color: late ? color.late : color.green }]}>마감 {hhmm(arriveByMin!)}{deadline <= 0 ? ' 지남' : ''}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export function OptionsScreen({ navigation }: Props) {
  const flow = usePlanFlow();
  const request = usePlanRequest();
  const { applyLive, removeChip } = usePlan();
  const { state } = flow;
  const result = state.result;
  const [pickSlot, setPickSlot] = useState<string | null>(null);

  const current = useMemo(
    () => (result ? effectiveVisits(result, state.slots, state.selectedOptionIdx, state.overrides) : null),
    [result, state.slots, state.selectedOptionIdx, state.overrides],
  );

  const slotQuery = (id: string) => state.slots.find(s => s.id === id)?.query ?? '';
  const pickIdx = current ? current.visits.findIndex(v => v.slotId === pickSlot) : -1;
  const pickVisit = current && pickIdx >= 0 ? current.visits[pickIdx] : null;
  // 지금 고른 안 기준으로 낸다 — result.alternatives는 1안 기준이라 2·3안에서 중복·누락이 생긴다.
  // 매 렌더 새 배열을 만들지 않는다 — CandidateSheet 안의 sorted useMemo가 실제로 캐시되게
  const sheetCands = useMemo(
    () => (result && current && pickIdx >= 0 ? slotCandidates(result, state.slots, current.visits, pickIdx, current.timing) : []),
    [result, current, pickIdx, state.slots],
  );

  if (!result || !current || !state.request) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bg }}>
        <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />
        <Text style={[type.body, { color: color.muted, padding: 20 }]}>계산된 경로가 없어요. 계획 화면에서 다시 시작해 주세요.</Text>
        <TabBar />
      </View>
    );
  }

  const req = state.request;
  const arriveMin = req.departAtMin + current.timing.totalMin;
  // 반올림 후에 늦음을 판정한다 — 그래야 "0분 늦어요"가 뜨지 않는다
  const slack = req.arriveByMin == null ? null : Math.round(req.arriveByMin - arriveMin);
  const late = slack != null && slack < 0;
  const approx = current.timing.estimated || !flow.usingServer ? '약 ' : '';
  const stale = request ? flow.isStale(request) : false;

  // 완화안도 마감을 못 지킬 수 있다 — 그때 "−3분 여유"라고 쓰면 안 된다
  /* 경유지 빼기 — 칩을 지우고 바로 다시 계산. 늦을 때 '무엇을 빼야 맞추나'가 이 화면의 질문이다 */
  const removeStop = (slotId: string) => {
    haptic();
    removeChip(slotId);
    flow.reset();
    navigation.replace('Calculating');
  };

  const confirm = () => {
    applyLive(toLegacyPlan({ flow: state, departMin: req.departAtMin }));
    navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Today' }] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader title="추천 경로" onBack={() => navigation.goBack()} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}>
        {stale && (
          <Pressable onPress={() => { haptic(); flow.reset(); navigation.replace('Calculating'); }}
            style={{ backgroundColor: color.amberBg, borderRadius: 14, padding: 14 }}>
            <Text style={[type.body, { color: color.amberDeep }]}>조건이 바뀌었어요 · 다시 계산</Text>
          </Pressable>
        )}

        {/* 1. 판정 — 답 먼저. 카드 없이 헤드라인 + 타임바: 직행·들르기·마감을 한 줄 그림으로 */}
        <View style={{ gap: 10, paddingHorizontal: 2, paddingTop: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            {slack == null ? (
              <Text style={[type.displayXL, { color: color.ink }]}>{approx}{hhmm(arriveMin)} 도착</Text>
            ) : late ? (
              <Text style={[type.displayXL, { color: color.late }]}>{approx}{-slack}분 늦어요</Text>
            ) : (
              <Text style={[type.displayXL, { color: color.ink }]}>{approx}{hhmm(arriveMin)} 도착</Text>
            )}
            {/* 여유가 있을 때만 옆에 한마디. 추정/실측 표기는 뺐다 — '약'이 이미 말한다 */}
            {slack != null && !late && (
              <Text style={[type.caption, { color: color.green }]}>{slack}분 여유</Text>
            )}
          </View>
          <EtaBar
            departMin={req.departAtMin}
            directMin={result.directMin}
            totalMin={current.timing.totalMin}
            arriveByMin={req.arriveByMin}
            estimated={current.timing.estimated || !flow.usingServer}
          />
        </View>

        {/* 못 찾아 빠진 슬롯 — 경유지 행에는 나오지 않으니 여기서 말해 준다 */}
        {state.slots
          .filter(s => result.slotStatus[s.id] === 'none')
          .map(s => (
            <Text key={s.id} style={[type.caption, { color: color.muted }]}>
              {s.query}{josa(s.query, '이/가') === '이' ? '은' : '는'} 경로 근처에서 못 찾아 뺐어요
            </Text>
          ))}

        {/* 2. 경유지 — 이 화면의 본문. 빼기·교체 모두 여기서, 바뀌면 위 도착 시각이 다시 계산된다 */}
        <StopList
          result={result}
          visits={current.visits}
          arrivals={current.timing.arrivals}
          slots={state.slots}
          departAtMin={req.departAtMin}
          arriveByMin={req.arriveByMin}
          late={late}
          approx={approx}
          onPick={slotId => { setPickSlot(slotId); }}
          onRemove={removeStop}
        />
      </ScrollView>

      <View style={{ backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.hairline, paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}>
        <PrimaryButton label={`${approx}${hhmm(arriveMin)} 도착 경로로 계속`} chevron height={56} borderRadius={18} onPress={confirm} />
        <Pressable onPress={() => { haptic(); navigation.navigate('Plan'); }} hitSlop={{ top: 8, bottom: 12, left: 20, right: 20 }}>
          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted, textAlign: 'center' }}>
            확정 전이라 언제든 대화로 바꿀 수 있어요 · <Text style={{ fontFamily: 'Pretendard-SemiBold', color: color.primary }}>대화로 바꾸기</Text>
          </Text>
        </Pressable>
      </View>
      <TabBar />

      <CandidateSheet
        visible={!!pickVisit}
        title={`${pickVisit?.candidate.name ?? ''} 교체`}
        candidates={sheetCands}
        currentId={pickVisit?.candidate.id}
        onPick={candId => pickSlot && flow.setOverride(state.selectedOptionIdx, pickSlot, candId)}
        onClose={() => setPickSlot(null)}
      />
    </View>
  );
}
