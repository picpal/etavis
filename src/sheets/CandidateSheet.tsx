/** A4 — 후보 비교 시트 (height 730, 정렬 세그먼트는 candidateRank.ts 가 정한다)
 *  A6 타임라인의 `매장 교체`와 A5 추천 경로의 매장 선택 칩이 공용으로 쓴다.
 *  데이터는 전부 props로 받는다 — usePlan()에 의존하지 않는다. */
import React, { useMemo, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { Candidate } from '../data/mockData';
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

/** 후보 note에 '추정'이 섞여 있으면 추가시간이 실측이 아니라는 뜻 — 앞에 '약 '을 붙인다 */
const addedLabel = (cand: Candidate) => `${cand.note.includes('추정') ? '약 ' : ''}+${cand.addedMin}분`;

export function CandidateSheet({
  visible,
  title,
  candidates,
  currentId,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  candidates: Candidate[];
  /** 지금 경로에 들어가 있는 후보 id */
  currentId?: string;
  onPick: (candidateId: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [sortIdx, setSortIdx] = useState<CandidateSort>(0);

  // 닫힘 애니메이션 동안 내용을 유지 — visible이 꺼지면 호출부의 candidates가 []로 무너져도
  // Sheet는 CLOSE_MS(220ms) 동안 마운트를 유지하므로, 마지막으로 보여준 내용을 그대로 붙잡아 둔다
  const lastRef = useRef({ title, candidates, currentId });
  if (visible) lastRef.current = { title, candidates, currentId };
  const shown = visible ? { title, candidates, currentId } : lastRef.current;

  // 정렬은 목록 전체에 적용된다 — 펼친 카드도 제자리를 지킨다. 마감·선택불가는 여기서 걸러진다
  const sorted = useMemo(() => rankCandidates(shown.candidates, sortIdx), [shown.candidates, sortIdx]);
  const recommended = sorted.find(c => c.recommended) ?? sorted[0];

  /**
   * 펼쳐 볼 후보 — 기본은 추천.
   * 목록에서 빼내 위로 올리지 않는다. 자리가 바뀌면 내가 고른 건지 골라야 하는 건지 헷갈린다.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  React.useEffect(() => {
    if (visible) setExpandedId(null); // 시트가 새로 열리면 추천으로 되돌림
  }, [visible]);
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
    if (cand.id !== shown.currentId) onPick(cand.id);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} height={730}>
      {expanded ? (
        <>
          {/* 시트 헤더 */}
          <View style={{ paddingTop: 8, paddingHorizontal: 20, paddingBottom: 14, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ gap: 4 }}>
                <Text style={{ fontFamily: 'Pretendard-Medium', fontSize: 12, lineHeight: 12, letterSpacing: 0.72, color: color.muted }}>
                  {shown.title}
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
              const isCurrent = cand.id === shown.currentId;
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
                        { label: '추가시간', value: addedLabel(cand), tint: color.amber },
                        { label: '도착', value: cand.arriveAt },
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
                        <Text style={[type.statS, { color: color.amber }]}>{addedLabel(cand)}</Text>
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 11, lineHeight: 11, color: color.muted }}>
                          {cand.arriveAt}
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
