/** 일정 한 칸 — 좌측 노드 + 직전 이동 시간 + 카드 한 장 (진행중·A6 공용) */
import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { color } from '../theme/tokens';
import { DashedLineV, Node, NodeState } from './primitives';

/** 이 행이 그리는 커넥터 한 조각.
 *  none=안 그림(A6처럼 부모가 통째로 그리는 경우) · solid=지나옴 · dashed=예정
 *  split=지금 이동 중인 구간 (현재 위치 마커까지만 실선) */
export type Connector = 'none' | 'solid' | 'dashed' | 'split';

const LEG_ROW_H = 27; // paddingVertical 7 × 2 + lineHeight 13
const NODE_CENTER = 24; // paddingTop 18 + 노드 반지름 6

export function TimelineRow({
  node,
  leg,
  dim,
  hideNode,
  children,
  legStyle,
  nodeState = 'upcoming',
  legActive,
  above = 'none',
  below = 'none',
}: {
  node: 'origin' | 'stop' | 'dest';
  /** 직전 구간 이동 시간 */
  leg?: string;
  dim?: boolean;
  /** 드래그 중에는 노드를 숨겨 카드만 떠 보이게 한다 */
  hideNode?: boolean;
  children: React.ReactNode;
  legStyle?: ViewStyle;
  nodeState?: NodeState;
  /** 지금 이 구간을 이동 중 — leg 줄에 현재 위치 마커를 찍는다 */
  legActive?: boolean;
  /** 행 위쪽(직전 노드 → 이 노드) 커넥터 */
  above?: Connector;
  /** 행 아래쪽(이 노드 → 다음 노드) 커넥터 */
  below?: Connector;
}) {
  const nodeTop = (leg ? LEG_ROW_H : 0) + NODE_CENTER;
  const markerY = LEG_ROW_H / 2;

  return (
    <View style={{ position: 'relative' }}>
      {/* 위쪽 커넥터 — 이 행 맨 위부터 노드까지 */}
      {above !== 'none' && (
        <View style={{ position: 'absolute', left: 0, top: 0, height: nodeTop, width: 12, alignItems: 'center' }}>
          {above === 'split' ? (
            <>
              <View style={{ height: markerY, width: 2, backgroundColor: color.primary, borderRadius: 1 }} />
              <DashedLineV style={{ flex: 1 }} />
            </>
          ) : above === 'solid' ? (
            <View style={{ flex: 1, width: 2, backgroundColor: color.primary, borderRadius: 1 }} />
          ) : (
            <DashedLineV style={{ flex: 1 }} />
          )}
        </View>
      )}

      {/* 아래쪽 커넥터 — 노드부터 이 행 맨 아래까지.
          bottom을 1px 넘겨 다음 행의 커넥터와 겹친다. 딱 맞추면 행 경계마다 흰 실선이 비친다 */}
      {below !== 'none' && (
        <View style={{ position: 'absolute', left: 0, top: nodeTop, bottom: -1, width: 12, alignItems: 'center' }}>
          {below === 'dashed' ? (
            <DashedLineV style={{ flex: 1 }} />
          ) : (
            <View style={{ flex: 1, width: 2, backgroundColor: color.primary, borderRadius: 1 }} />
          )}
        </View>
      )}

      {leg && (
        <View style={[{ flexDirection: 'row', gap: 14, paddingVertical: 7 }, legStyle]}>
          <View style={{ width: 12, alignItems: 'center', justifyContent: 'center' }}>
            {/* 이동 중일 때 나는 두 노드 '사이'에 있다. 구간 위에 찍어야 위치가 맞다.
                체류 중일 때와 같은 이중 링을 쓴다 — '나'는 언제나 이중 링, 장소는 점 */}
            {legActive && <Node kind="stop" state="current" />}
          </View>
          <Text
            style={{
              fontFamily: legActive ? 'Pretendard-SemiBold' : 'Pretendard-Medium',
              fontSize: 13,
              lineHeight: 13,
              color: legActive ? color.primary : color.muted,
            }}
          >
            {legActive ? `이동 중 · ${leg.replace(/^이동 /, '')}` : leg}
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
        <View style={{ width: 12, alignItems: 'center', paddingTop: 18, opacity: dim ? 0.5 : 1 }}>
          {!hideNode && <Node kind={node} state={nodeState} />}
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </View>
  );
}

/** 카드 상단 배지 (다음 / 체류 중 / 드래그 중) */
export function StateBadge({ label, tint }: { label: string; tint: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 16,
        backgroundColor: tint,
        paddingVertical: 5,
        paddingHorizontal: 9,
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 8,
      }}
    >
      <Text style={{ fontFamily: 'Pretendard-Bold', fontSize: 11, lineHeight: 11, letterSpacing: 0.66, color: '#fff' }}>
        {label}
      </Text>
    </View>
  );
}
