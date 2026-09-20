/** A4 — 후보 비교 시트 (height 730, 정렬 세그먼트는 candidateRank.ts 가 정한다)
 *  A6 타임라인의 `매장 교체`와 A5 추천 경로의 매장 선택 칩이 공용으로 쓴다.
 *  데이터는 전부 props로 받는다 — usePlan()에 의존하지 않는다. */
import React, { useMemo, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, type } from '../theme/tokens';
import { Candidate } from '../data/mockData';
import { Card, haptic, MicroLabelRow, PrimaryButton, SegmentControl } from '../components/common';
import { CandidateSort, rankClusters, sortsFor } from '../lib/candidateRank';
import { StripePhoto } from '../components/primitives';
import { Sheet } from '../components/Sheet';
import { approxOf, classOf, deltaCopy } from '../lib/timingCopy';
import type { TimingSource } from '../lib/routePlan/types';

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

/** 최근 블로그 언급이 많고 상위 3위 안인 후보. 도착 배지와 같은 모양 */
function HotBadge() {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: color.greenBg }}>
      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 14, color: color.green }}>
        요즘 인기
      </Text>
    </View>
  );
}

export function CandidateSheet({
  visible,
  title,
  candidates,
  currentId,
  onPick,
  onClose,
  mode,
  timingSource,
}: {
  visible: boolean;
  title: string;
  candidates: Candidate[];
  /** 지금 경로에 들어가 있는 후보 id */
  currentId?: string;
  onPick: (candidateId: string) => void;
  onClose: () => void;
  mode: 'car' | 'walk' | 'transit';
  /** 계획의 시간 출처. 후보가 자기 등급(`cls`)을 안 들고 오면 이걸로 본다 — 목 데이터셋 */
  timingSource?: TimingSource;
}) {
  const insets = useSafeAreaInsets();
  // '약'은 여기서 정하지 않는다 — 예전엔 note 의 '추정' 글자를 냄새 맡았는데, note 가 trend 근거로
  // 바뀌면 그 글자가 사라져 '약'도 같이 사라졌다. 등급은 후보의 cls 가 들고 문구는 timingCopy 가 낸다
  const clsOf = (cand: Candidate) => cand.cls ?? classOf(timingSource);
  const addedLabel = (cand: Candidate) => deltaCopy({ min: cand.addedMin, cls: clsOf(cand) });
  const arriveLabel = (cand: Candidate) => `${approxOf(clsOf(cand))}${cand.arriveAt}`;
  const [tabIdxRaw, setTabIdx] = useState(0);

  // 닫힘 애니메이션 동안 내용을 유지 — visible이 꺼지면 호출부의 candidates가 []로 무너져도
  // Sheet는 CLOSE_MS(220ms) 동안 마운트를 유지하므로, 마지막으로 보여준 내용을 그대로 붙잡아 둔다
  const lastRef = useRef({ title, candidates, currentId });
  if (visible) lastRef.current = { title, candidates, currentId };
  const shown = visible ? { title, candidates, currentId } : lastRef.current;

  // 이 목록에서 고를 수 있는 탭만 만든다
  const hasTrend = shown.candidates.some(c => c.trend);
  const tabs = useMemo(() => sortsFor(mode, hasTrend), [mode, hasTrend]);
  // 탭 구성이 바뀌면 고른 인덱스가 범위를 벗어날 수 있다
  const tabIdx = Math.min(tabIdxRaw, tabs.length - 1);
  const sortIdx = tabs[tabIdx]?.sort ?? 1;

  // 정렬은 목록 전체에 적용된다 — 펼친 카드도 제자리를 지킨다. 마감·선택불가는 여기서 걸러진다.
  // 세는 단위는 후보가 아니라 **자리**다. 250m 안 30곳을 30줄로 늘어놓으면 선택지가 30개라고
  // 말하는 셈인데, 시간으로는 하나다(설계 §4)
  const clusters = useMemo(() => rankClusters(shown.candidates, sortIdx, shown.currentId), [shown.candidates, sortIdx, shown.currentId]);
  const total = clusters.reduce((n, g) => n + g.members.length, 0);
  const [showAll, setShowAll] = useState(false);
  const VISIBLE = 5;
  /** 한 자리 안에서 접지 않고 보여 주는 수. 묶은 이유가 "골라야 할 게 적다"라 여기도 접는다 */
  const WITHIN = 3;
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const visibleGroups = showAll ? clusters : clusters.slice(0, VISIBLE);
  const membersShown = (g: (typeof clusters)[number]) =>
    openGroups.includes(g.id) ? g.members : g.members.slice(0, WITHIN);
  const visibleCands = visibleGroups.flatMap(membersShown);
  const hidden = total - visibleGroups.reduce((n, g) => n + g.members.length, 0);

  /**
   * 펼쳐 볼 후보 — 기본은 지금 정렬의 1위(visibleCands[0]).
   * 목록에서 빼내 위로 올리지 않는다. 자리가 바뀌면 내가 고른 건지 골라야 하는 건지 헷갈린다.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  React.useEffect(() => {
    if (visible) {
      setExpandedId(null); // 시트가 새로 열리면 추천으로 되돌림
      setTabIdx(0);
      setShowAll(false);
      setOpenGroups([]);
    }
  }, [visible]);
  // 화면에 실제로 그려지는 카드(visibleCands) 기준으로 찾는다 — sorted 전체에서 찾으면
  // 탭을 바꿔 그 후보가 상위 5개 밖으로 밀려났을 때 어떤 카드도 펼쳐지지 않는다
  const expanded = visibleCands.find(c => c.id === expandedId) ?? visibleCands[0];

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

  /**
   * 카드 하나. `showTime` 이 거짓이면 시간 칸을 그리지 않는다 — 같은 자리로 묶인 카드는
   * 자기 시간을 따로 말하지 않고 묶음 머리가 한 번만 말한다(설계 §4)
   */
  const renderCard = (cand: Candidate, showTime: boolean) => {
    const isCurrent = cand.id === shown.currentId;
    const isOpen = cand.id === expanded?.id;

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
                {/* 카드당 배지 하나 — 겹치면 요즘 인기가 이긴다 */}
                {cand.trend?.hot ? (
                  <HotBadge />
                ) : isCurrent ? (
                  <CurrentBadge />
                ) : (
                  cand.recommended && <RecommendBadge />
                )}
              </View>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
                {cand.note}
              </Text>
              <OpenStateRow cand={cand} />
            </View>
          </View>
          {/* 묶음 안에서는 시간 칸을 빼고 묶음 머리가 한 번만 말한다 — 머리가
              "시간 차이 없어요"라 해 놓고 카드마다 다른 숫자를 내면 둘 중 하나가 거짓이다 */}
          <MicroLabelRow
            items={[
              ...(showTime
                ? [
                    { label: '추가시간', value: addedLabel(cand), tint: color.amber },
                    { label: '도착', value: arriveLabel(cand) },
                  ]
                : []),
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
                {/* 카드당 배지 하나 — 겹치면 요즘 인기가 이긴다 */}
                {cand.trend?.hot ? (
                  <HotBadge />
                ) : isCurrent ? (
                  <CurrentBadge />
                ) : (
                  cand.recommended && <RecommendBadge />
                )}
              </View>
              <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 13, lineHeight: 17, color: color.muted }}>
                {cand.note}
              </Text>
            </View>
            {showTime && (
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={[type.statS, { color: color.amber }]}>{addedLabel(cand)}</Text>
                <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 11, lineHeight: 11, color: color.muted }}>
                  {arriveLabel(cand)}
                </Text>
              </View>
            )}
          </Card>
        )}
      </Pressable>
    );
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
                <Text style={[type.titleL, { color: color.ink }]}>후보 {total}곳</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={[type.action, { color: color.primary }]}>완료</Text>
              </Pressable>
            </View>
            <SegmentControl
              options={tabs.map(t => t.label)}
              value={tabIdx}
              onChange={setTabIdx}
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
            {/* 후보 목록 — 자리(묶음)마다 한 덩어리. 순서는 정렬 기준만 따르고,
                탭하면 그 자리에서 펼쳐진다 */}
            {visibleGroups.map(group => {
              const many = group.members.length > 1;
              const rest = group.members.length - membersShown(group).length;
              return (
                <View key={group.id} style={{ gap: many ? 8 : 14 }}>
                  {many && (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: 4,
                        gap: 12,
                      }}
                    >
                      <Text style={{ fontFamily: 'Pretendard-SemiBold', fontSize: 12, lineHeight: 16, color: color.muted }}>
                        같은 자리 {group.members.length}곳 · 시간 차이 없어요
                      </Text>
                      {/* 시간은 자리마다 한 번만 — 250m 안의 1~2분 차이는 구간 추정 오차보다
                          작아서, 곳마다 다른 숫자를 붙이면 없는 차이를 고르게 만든다 */}
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                        <Text style={[type.statS, { color: color.amber }]}>{addedLabel(group.lead)}</Text>
                        <Text style={{ fontFamily: 'Pretendard-Regular', fontSize: 11, lineHeight: 11, color: color.muted }}>
                          {arriveLabel(group.lead)}
                        </Text>
                      </View>
                    </View>
                  )}
                  {membersShown(group).map(cand => renderCard(cand, !many))}
                  {rest > 0 && (
                    <Pressable
                      onPress={() => {
                        haptic();
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setOpenGroups(ids => [...ids, group.id]);
                      }}
                      style={{ paddingVertical: 8, alignItems: 'center' }}
                    >
                      <Text style={[type.action, { color: color.primary, fontSize: 14 }]}>이 자리 {rest}곳 더</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            {hidden > 0 && (
              <Pressable
                onPress={() => {
                  haptic();
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowAll(true);
                }}
                style={{ paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={[type.action, { color: color.primary }]}>{hidden}곳 더 보기</Text>
              </Pressable>
            )}
          </ScrollView>
        </>
      ) : (
        <View />
      )}
    </Sheet>
  );
}
