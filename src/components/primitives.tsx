/** 도형 프리미티브 — 디자인의 CSS 도형(원·사각·chevron·핸들·점선)을 재현 */
import React from 'react';
import { View, ViewStyle } from 'react-native';
import Svg, { Line, Path, Circle, Rect } from 'react-native-svg';
import { color } from '../theme/tokens';

type ChevronDir = 'up' | 'down' | 'left' | 'right';

/** 두 변 테두리를 45° 돌린 chevron. 디자인 규격: 8~9px, 선 2~2.5px */
export function Chevron({
  size = 9,
  thickness = 2,
  color: c = color.stroke,
  dir = 'right',
  style,
}: {
  size?: number;
  thickness?: number;
  color?: string;
  dir?: ChevronDir;
  style?: ViewStyle;
}) {
  const rotate = { right: '45deg', down: '135deg', left: '-135deg', up: '-45deg' }[dir];
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderTopWidth: thickness,
          borderRightWidth: thickness,
          borderColor: c,
          transform: [{ rotate }],
        },
        style,
      ]}
    />
  );
}

/** 세로 점선 (타임라인 커넥터) — svg가 borderStyle dashed보다 안정적 */
export function DashedLineV({ style, stroke = color.stroke }: { style?: ViewStyle; stroke?: string }) {
  return (
    <Svg style={[{ width: 2 }, style]} pointerEvents="none">
      <Line x1={1} y1={0} x2={1} y2="100%" stroke={stroke} strokeWidth={2} strokeDasharray="5,4" />
    </Svg>
  );
}

/** 가로 도트선 (A2 커넥터·A5 구간 행) — 2px dotted */
export function DottedLineH({ style, stroke = color.stroke }: { style?: ViewStyle; stroke?: string }) {
  return (
    <Svg height={2} style={[{ flex: 1 }, style]} pointerEvents="none">
      <Line
        x1={1}
        y1={1}
        x2="100%"
        y2={1}
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray="0.1,4.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 1px 카드 내부 구분선 */
export function Hairline({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: color.hairline }, style]} />;
}

/** 드래그 핸들 — 14×2 R1 바 3줄 */
export function DragHandle({ tint = color.stroke, style }: { tint?: string; style?: ViewStyle }) {
  return (
    <View style={[{ gap: 3 }, style]}>
      {[0, 1, 2].map(i => (
        <View key={i} style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: tint }} />
      ))}
    </View>
  );
}

/** 45° 대각 스트라이프 사진 placeholder */
export function StripePhoto({ size, radius }: { size: number; radius: number }) {
  const barCount = Math.ceil((size * 2) / 12) + 2;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: '#EFF3F9',
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: -size / 2,
            left: i * 12 - size,
            width: 6,
            height: size * 2,
            backgroundColor: '#E4EAF4',
            transform: [{ rotate: '45deg' }],
          }}
        />
      ))}
    </View>
  );
}

/** 체크 표시 (흰색) — 진행 카드·체크박스용 */
export function CheckMark({ w = 9, h = 5, thickness = 2, tint = '#fff' }: { w?: number; h?: number; thickness?: number; tint?: string }) {
  return (
    <View
      style={{
        width: w,
        height: h,
        borderLeftWidth: thickness,
        borderBottomWidth: thickness,
        borderColor: tint,
        transform: [{ rotate: '-45deg' }],
        marginTop: -2,
      }}
    />
  );
}

/** A1 위치 핀 아이콘 (12×12) */
export function PinIcon() {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12">
      <Path
        d="M6 1.2 A 3.9 3.9 0 0 1 9.9 5.1 C 9.9 7.4 6 10.8 6 10.8 C 6 10.8 2.1 7.4 2.1 5.1 A 3.9 3.9 0 0 1 6 1.2 Z"
        stroke={color.primary}
        strokeWidth={1.8}
        fill="none"
      />
      <Circle cx={6} cy={5.1} r={1.3} fill={color.primary} />
    </Svg>
  );
}

/** 탭바 아이콘 — 계획(경로 노드) / 진행중(재생) / 기록(시계) / 주변(핀) */
export function TabIcon({
  name,
  size = 22,
  tint,
}: {
  name: 'plan' | 'today' | 'history' | 'nearby' | 'more';
  size?: number;
  tint: string;
}) {
  const sw = 2;
  if (name === 'plan') {
    // 출발 → 경유 → 도착이 이어지는 경로
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={5} cy={6} r={2.6} stroke={tint} strokeWidth={sw} fill="none" />
        <Path d="M5 9.4v3.2a3.2 3.2 0 0 0 3.2 3.2h7.4" stroke={tint} strokeWidth={sw} fill="none" strokeLinecap="round" />
        <Rect x={16.2} y={13.6} width={5.2} height={5.2} rx={1.4} fill={tint} />
      </Svg>
    );
  }
  if (name === 'today') {
    // 진행 중 = 재생
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={8.8} stroke={tint} strokeWidth={sw} fill="none" />
        <Path d="M10.2 8.8l5.4 3.2-5.4 3.2z" fill={tint} />
      </Svg>
    );
  }
  if (name === 'history') {
    // 지난 이동 = 시계
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={8.8} stroke={tint} strokeWidth={sw} fill="none" />
        <Path d="M12 7.2V12l3.2 2" stroke={tint} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  if (name === 'more') {
    // 더보기 = 점 세 개. 눌러도 화면이 바뀌지 않고 메뉴가 올라온다는 신호
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={5.4} cy={12} r={1.9} fill={tint} />
        <Circle cx={12} cy={12} r={1.9} fill={tint} />
        <Circle cx={18.6} cy={12} r={1.9} fill={tint} />
      </Svg>
    );
  }
  // 주변 = 위치 핀
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 21c4.4-4.6 6.6-7.7 6.6-10.6A6.6 6.6 0 0 0 5.4 10.4C5.4 13.3 7.6 16.4 12 21z"
        stroke={tint}
        strokeWidth={sw}
        fill="none"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10.2} r={2.4} fill={tint} />
    </Svg>
  );
}

/** 휴지통(삭제) 아이콘 */
export function TrashIcon({ size = 22, tint = '#B33B2B' }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4.5 6.8h15" stroke={tint} strokeWidth={2} strokeLinecap="round" />
      <Path
        d="M9.4 6.8V5.4a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v1.4"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M6.4 6.8l.8 11.3a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.8-11.3"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M10.3 10.4v6M13.7 10.4v6" stroke={tint} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** 하트 아이콘 — 채움/외곽선 */
export function HeartIcon({ size = 15, filled = false, tint = '#B33B2B' }: { size?: number; filled?: boolean; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        d="M8 13.6C5.3 11.4 1.8 8.9 1.8 5.9 1.8 4 3.3 2.6 5 2.6 6.1 2.6 7.2 3.2 8 4.2 8.8 3.2 9.9 2.6 11 2.6 12.7 2.6 14.2 4 14.2 5.9 14.2 8.9 10.7 11.4 8 13.6Z"
        fill={filled ? tint : 'none'}
        stroke={filled ? tint : color.stroke}
        strokeWidth={1.6}
      />
    </Svg>
  );
}

/** 연필(수정) 아이콘 */
export function PencilIcon({ size = 14, tint = color.muted }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Rect x={6.6} y={0.6} width={3.4} height={9.6} rx={1.2} fill={tint} transform="rotate(45 8 8)" />
      <Path d="M3.4 10.6 L5.4 12.6 L2.4 13.6 Z" fill={tint} />
    </Svg>
  );
}

/** 설정 톱니바퀴 아이콘 */
/** 공유 — 상자에서 위로 나가는 화살표 */
export function ShareIcon({ size = 20, tint = color.body }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 3.6v10.2M12 3.6L8.4 7.2M12 3.6l3.6 3.6"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 11.4v7.2a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8v-7.2"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 사람 실루엣 — 프로필 자리표시 */
export function PersonIcon({ size = 20, tint = color.body }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8.2} r={3.6} stroke={tint} strokeWidth={2} fill="none" />
      <Path
        d="M5.6 19.6a6.7 6.7 0 0 1 12.8 0"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function GearIcon({ size = 20, tint = color.body }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
        <Rect
          key={deg}
          x={8.8}
          y={0.5}
          width={2.4}
          height={4.6}
          rx={1.2}
          fill={tint}
          transform={`rotate(${deg} 10 10)`}
        />
      ))}
      <Circle cx={10} cy={10} r={5.1} stroke={tint} strokeWidth={2.6} fill="none" />
    </Svg>
  );
}

/** 진행 상태에 따른 노드 표현 — 지나옴 / 지금 여기 / 예정 */
export type NodeState = 'passed' | 'current' | 'upcoming';

/** 타임라인 노드 — 출발(링)·경유지(점)·도착(사각) */
export function Node({
  kind,
  size = 12,
  state = 'upcoming',
}: {
  kind: 'origin' | 'stop' | 'dest';
  size?: number;
  state?: NodeState;
}) {
  // 지금 여기 — 이중 링으로 다른 노드와 확실히 구분한다.
  // 음수 마진으로 레이아웃 크기는 size 그대로 두어 커넥터 기하가 흔들리지 않게 한다
  if (state === 'current') {
    const outer = size + 8;
    return (
      <View
        style={{
          width: outer,
          height: outer,
          margin: -(outer - size) / 2,
          borderRadius: outer / 2,
          borderWidth: 2.5,
          borderColor: color.primary,
          backgroundColor: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: size - 4, height: size - 4, borderRadius: size / 2, backgroundColor: color.primary }} />
      </View>
    );
  }
  // 지나온 곳 — 흰 테두리를 두지 않는다.
  // 지나온 구간은 파란 실선이라, 테두리가 있으면 선이 노드마다 끊겨 보인다
  if (state === 'passed' && kind !== 'dest') {
    return (
      <View
        style={{
          width: size - 2,
          height: size - 2,
          borderRadius: (size - 2) / 2,
          backgroundColor: color.primary,
        }}
      />
    );
  }
  if (kind === 'origin') {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 3,
          borderColor: color.primary,
          backgroundColor: '#fff',
        }}
      />
    );
  }
  if (kind === 'stop') {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color.primary,
          borderWidth: 2,
          borderColor: '#fff',
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        backgroundColor: color.ink,
        borderWidth: 2,
        borderColor: '#fff',
      }}
    />
  );
}
