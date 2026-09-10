/** A4 — 후보 비교 시트 (height 730, 정렬 세그먼트는 candidateRank.ts 가 정한다)
 *  A6 타임라인의 `매장 교체`와 A5 추천 경로의 매장 선택 칩이 공용으로 쓴다. */
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { Candidate } from '../data/mockData';
import { toHHMM, toMin, usePlan } from '../state/plan';
import { Card, haptic, MicroLabelRow, PrimaryButton, SegmentControl } from '../components/common';
import { CANDIDATE_SORTS, CandidateSort, rankCandidates } from '../lib/candidateRank';
import { StripePhoto } from '../components/primitives';
import { Sheet } from '../components/Sheet';

function OpenStateRow({ cand }: { cand: Candidate }) {
  const tint = cand.openState === 'closed' ? color.muted : color.green;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />
      <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 13, lineHeight: 13, color: tint }}>
        {cand.openNote}
      </Text>
    </View>
  );
}

function Tag({ label, tint, bg }: { label: string; tint: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6 }}>
      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 11, lineHeight: 11, color: tint }}>{label}</Text>
    </View>
  );
}

const CurrentBadge = () => <Tag label="현재 경로" tint={color.primary} bg={color.primaryTint} />;
const RecommendBadge = () => <Tag label="추천" tint="#fff" bg={color.primary} />;

export function CandidateSheet({
  baseId,
  currentCandidateId,
  onPick,
  onClose,
}: {
  /** 원본 stop id (dataset.candidates 키). null이면 닫힘 */
  baseId: string | null;
  /** 지금 경로에 들어가 있는 후보 id */
  currentCandidateId?: string;
  onPick: (candidateId: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { state } = usePlan();

  /* 후보의 arriveAt은 목 데이터에 박힌 아침 시각이라 지금 경로와 맞지 않는다.
     현재 이 경유지의 도착 시각에 후보 간 추가시간 차이를 더해 보여준다 */
  const stopNow = baseId ? state.stops.find(st => st.baseId === baseId) : undefined;
  const candList = baseId ? state.dataset.candidates[baseId] ?? [] : [];
  const currentCand =
    candList.find(c => c.id === stopNow?.selectedCandidateId) ?? candList.find(c => c.recommended) ?? candList[0];
  const arriveFor = (cand: Candidate): string => {
    if (!stopNow || !currentCand) return cand.arriveAt;
    return toHHMM(toMin(stopNow.arriveAt) + (cand.addedMin - currentCand.addedMin));
  };
  const [sortIdx, setSortIdx] = useState<CandidateSort>(0);

  // 닫힘 애니메이션 동안 콘텐츠 유지
  const lastRef = React.useRef({ baseId, currentCandidateId });
  if (baseId) lastRef.current = { baseId, currentCandidateId };
  const effBaseId = lastRef.current.baseId;
  const currentId = lastRef.current.currentCandidateId;

  const candidates = effBaseId ? state.dataset.candidates[effBaseId] ?? [] : [];
  // 정렬은 목록 전체에 적용된다 — 펼친 카드도 제자리를 지킨다. 마감·선택불가는 여기서 걸러진다
  const sorted = useMemo(() => rankCandidates(candidates, sortIdx), [candidates, sortIdx]);
  const recommended = sorted.find(c => c.recommended) ?? sorted[0];
  const current = candidates.find(c => c.id === currentId);

  /**
   * 펼쳐 볼 후보 — 기본은 추천.
   * 목록에서 빼내 위로 올리지 않는다. 자리가 바뀌면 내가 고른 건지 골라야 하는 건지 헷갈린다.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  React.useEffect(() => {
    if (baseId) setExpandedId(null); // 시트가 새로 열리면 추천으로 되돌림
  }, [baseId]);
  const expanded = sorted.find(c => c.id === expandedId) ?? recommended;

  /** 카드 탭 — 선택이 아니라 '그 자리에서 펼치기' */
  const focus = (cand: Candidate) => {
    if (cand.id === expanded?.id) return;
    haptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId(cand.id);
  };

  /** 확정 — 경로에 반영하고 시트를 닫는다 */
  const pick = (cand: Candidate) => {
    haptic();
    if (cand.id !== currentId) onPick(cand.id);
    onClose();
  };

  return (
    <Sheet visible={!!baseId} onClose={onClose} height={730}>
      {expanded ? (
        <>
          {/* 시트 헤더 */}
          <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: 14, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ gap: 4 }}>
                <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
                  {(current ?? recommended).name} 교체
                </Text>
                <Text style={[type.titleL, { color: color.ink }]}>후보 {sorted.length}곳</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={[type.action, { color: color.primary }]}>완료</Text>
              </Pressable>
            </View>
            <SegmentControl
              options={[...CANDIDATE_SORTS]}
              value={sortIdx}
              onChange={i => setSortIdx(i as CandidateSort)}
              track={color.track}
              fontSize={14}
              padV={11}
            />
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: Math.max(insets.bottom, 20), gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {/* 후보 목록 — 순서는 정렬 기준만 따르고, 탭하면 그 자리에서 펼쳐진다 */}
            {sorted.map(cand => {
              const isCurrent = cand.id === currentId;
              const isOpen = cand.id === expanded.id;

              if (isOpen) {
                return (
                  <Card key={cand.id} elevated style={{ padding: 18, gap: 16 }}>
                    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
                      <StripePhoto size={64} radius={16} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 18, lineHeight: 22, color: color.ink }}>
                            {cand.name}
                          </Text>
                          {cand.recommended && <RecommendBadge />}
                          {isCurrent && <CurrentBadge />}
                        </View>
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
                          {cand.note}
                        </Text>
                        <OpenStateRow cand={cand} />
                      </View>
                    </View>
                    <MicroLabelRow
                      items={[
                        { label: '추가시간', value: `+${cand.addedMin}분`, tint: color.amber },
                        { label: '도착', value: arriveFor(cand) },
                        { label: '체류', value: `${cand.dwellMin}분` },
                        { label: '주차', value: cand.parking },
                      ]}
                    />
                    {(cand.reason || cand.verifiedNote) && (
                      <View style={{ gap: 5 }}>
                        {cand.reason && (
                          <>
                            <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 12, letterSpacing: 0.48, color: color.muted }}>
                              추천 이유
                            </Text>
                            <Text style={[type.body, { color: color.body }]}>{cand.reason}</Text>
                          </>
                        )}
                        {cand.verifiedNote && (
                          <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 12, lineHeight: 17, color: color.muted }}>
                            {cand.verifiedNote}
                          </Text>
                        )}
                      </View>
                    )}
                    {isCurrent ? (
                      <View
                        style={{
                          minHeight: 52,
                          borderRadius: 16,
                          backgroundColor: color.track,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={[type.btn, { color: color.body }]}>현재 선택된 매장이에요</Text>
                      </View>
                    ) : (
                      <PrimaryButton label="이 매장으로 정하기" height={52} borderRadius={16} onPress={() => pick(cand)} />
                    )}
                  </Card>
                );
              }

              return (
                <Pressable key={cand.id} onPress={() => focus(cand)}>
                  {({ pressed }) => (
                    <Card
                      style={{
                        padding: 16,
                        flexDirection: 'row',
                        gap: 14,
                        alignItems: 'center',
                        opacity: pressed ? 0.8 : 1,
                      }}
                    >
                      <StripePhoto size={52} radius={14} />
                      <View style={{ flex: 1, gap: 5 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={[type.item, { color: color.ink }]}>{cand.name}</Text>
                          {cand.recommended && <RecommendBadge />}
                          {isCurrent && <CurrentBadge />}
                        </View>
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
                          {cand.note}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[type.statS, { color: color.amber }]}>+{cand.addedMin}분</Text>
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 11, lineHeight: 11, color: color.muted }}>
                          {arriveFor(cand)}
                        </Text>
                      </View>
                    </Card>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : (
        <View />
      )}
    </Sheet>
  );
}
