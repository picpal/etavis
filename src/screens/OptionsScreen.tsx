/** A5 — 추천. 답(제시간 도착 여부)이 맨 위, 3안은 그 아래. "최적"이 아니라 "검증한 안 중 최선" */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { color, type } from '../theme/tokens';
import { usePlan, toHHMM } from '../state/plan';
import { usePlanFlow } from '../state/planFlowProvider';
import { usePlanRequest } from '../state/usePlanRequest';
import { effectiveVisits, optionTitle, slotCandidates, toLegacyPlan, SLOT_STATUS_TEXT } from '../state/planFlowBridge';
import { Card, haptic, PrimaryButton } from '../components/common';
import { Chevron, DottedLineH, Hairline } from '../components/primitives';
import { NavHeader } from '../components/NavHeader';
import { TabBar } from '../components/TabBar';
import { CandidateSheet } from '../sheets/CandidateSheet';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Options'>;

const hhmm = (min: number) => toHHMM(Math.round(min)).padStart(5, '0');

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
  const relaxedSlack =
    result.relaxed && req.arriveByMin != null
      ? Math.round(req.arriveByMin - (req.departAtMin + result.relaxed.totalMin))
      : null;

  /** 완화안의 '계획에서 빼기' — 말한 대로 칩을 실제로 뺀다. 자동 재계산은 하지 않는다 */
  const dropRelaxedSlot = () => {
    haptic();
    if (result.relaxed) removeChip(result.relaxed.droppedSlotId); // 슬롯 id = 칩 id
    flow.reset();
    navigation.navigate('Plan');
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

        {/* 1. 판정 카드 — 답 먼저 */}
        <Card elevated style={{ padding: 20, gap: 8 }}>
          {slack == null ? (
            <Text style={[type.displayXL, { color: color.ink }]}>{approx}{hhmm(arriveMin)} 도착</Text>
          ) : late ? (
            <Text style={[type.displayXL, { color: color.amberDeep }]}>지금 출발해도 {approx}{-slack}분 늦어요</Text>
          ) : (
            <Text style={[type.displayXL, { color: color.ink }]}>들렀다 가도 {approx}{hhmm(arriveMin)} 도착</Text>
          )}
          <Text style={[type.body, { color: slack != null && !late ? color.green : color.muted }]}>
            {slack == null ? `직행보다 +${Math.round(current.timing.totalMin - result.directMin)}분` : late ? `마감 ${hhmm(req.arriveByMin!)}` : `${slack}분 여유`}
          </Text>
          {late && result.relaxed && (
            <Pressable onPress={dropRelaxedSlot}>
              <Text style={[type.body, { color: color.primary }]}>
                {slotQuery(result.relaxed.droppedSlotId)}을(를) 빼면 {approx}{hhmm(req.departAtMin + result.relaxed.totalMin)} 도착 · {relaxedSlack! >= 0 ? `${relaxedSlack}분 여유` : `${-relaxedSlack!}분 늦음`} → 계획에서 빼기
              </Text>
            </Pressable>
          )}
          <Text style={[type.caption, { color: color.muted }]}>
            {flow.usingServer ? `검증한 안 중 최선 · 실측 ${result.measuredCount}회` : '서버 없이 추정한 값이에요'}
          </Text>
        </Card>

        {/* 못 찾아 빠진 슬롯 — 경유지 행에는 나오지 않으니 여기서 말해 준다 */}
        {state.slots
          .filter(s => result.slotStatus[s.id] === 'none')
          .map(s => (
            <Text key={s.id} style={[type.caption, { color: color.muted }]}>
              {s.query}은(는) 경로 근처에서 못 찾아 뺐어요
            </Text>
          ))}

        {/* 2. 경유지 행 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {current.visits.map(v => {
            const alts = (state.slots.find(s => s.id === v.slotId)?.candidates.length ?? 0) - 1;
            const st = result.slotStatus[v.slotId];
            const suffix = st && st !== 'ok' ? ` · ${SLOT_STATUS_TEXT[st]}` : '';
            return (
              <Pressable key={v.slotId} disabled={alts === 0} onPress={() => { haptic(); setPickSlot(v.slotId); }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: color.surface, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 17, color: st && st !== 'ok' ? color.amberDeep : color.body }}>{v.candidate.name}{suffix}</Text>
                {alts > 0 && <Chevron size={7} thickness={2} color={color.muted} dir="down" />}
              </Pressable>
            );
          })}
        </View>

        {/* 3. 3안 */}
        <Text style={[type.label, { color: color.muted }]}>직행 {Math.round(result.directMin)}분 기준 · {result.options.length}개 안</Text>
        {result.options.map((o, i) => {
          const selected = i === state.selectedOptionIdx;
          // 선택된 안은 이미 위에서 계산해 둔 current를 그대로 쓴다 — 다시 계산하지 않는다
          const eff = selected ? current : effectiveVisits(result, state.slots, i, state.overrides);
          const names = [req.originName, ...eff.visits.map(v => v.candidate.name), req.destinationName];
          const pre = eff.timing.estimated || !flow.usingServer ? '약 ' : '';
          return (
            <Pressable key={i} onPress={() => { if (!selected) { haptic(); flow.select(i); } }}>
              <Card elevated={selected} style={{ padding: selected ? 20 : 18, gap: selected ? 16 : 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={[type.labelPlain, { color: color.muted }]}>{optionTitle(result, i)}</Text>
                    <Text style={[selected ? type.displayXL : type.statL, { color: color.ink }]}>{pre}{Math.round(eff.timing.totalMin)}분</Text>
                  </View>
                  <Text style={[selected ? type.stat : type.statS, { color: color.amber }]}>+{Math.round(eff.timing.totalMin - result.directMin)}분</Text>
                </View>
                {selected && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {names.map((_, k) => (
                        <React.Fragment key={k}>
                          {k > 0 && <DottedLineH />}
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k === names.length - 1 ? color.green : color.primary }} />
                        </React.Fragment>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6 }}>
                      {names.map((n, k) => (
                        <Text key={k} numberOfLines={1} style={{ flex: 1, fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 16, color: color.muted, textAlign: k === 0 ? 'left' : k === names.length - 1 ? 'right' : 'center' }}>{n}</Text>
                      ))}
                    </View>
                    <Hairline />
                    <Text style={[type.body, { color: color.body }]}>
                      {eff.visits.map((v, k) => `${v.candidate.name} ${hhmm(eff.timing.arrivals[k])}`).join(' → ')} → {hhmm(req.departAtMin + eff.timing.totalMin)}
                    </Text>
                  </>
                )}
              </Card>
            </Pressable>
          );
        })}

        {/* 4. 조건 완화 — 늦을 때만, 3안과 분리 */}
        {late && result.relaxed && (
          <View style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.stroke, borderRadius: 20, padding: 18, gap: 8 }}>
            <Text style={[type.labelPlain, { color: color.muted }]}>조건 완화 · {slotQuery(result.relaxed.droppedSlotId)} 제외</Text>
            <Text style={[type.statL, { color: color.ink }]}>{approx}{Math.round(result.relaxed.totalMin)}분 · {hhmm(req.departAtMin + result.relaxed.totalMin)} 도착</Text>
            <Text style={[type.caption, { color: color.muted }]}>필수 경유지가 아니면 이 안이 마감을 지켜요. 계획 화면에서 칩을 빼면 이 안으로 다시 계산해요.</Text>
          </View>
        )}
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
