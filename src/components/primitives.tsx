/** 도형 프리미티브 — 디자인의 CSS 도형(원·사각·chevron·핸들·점선)을 재현 */
import React from 'react';
import { Platform, View, ViewStyle } from 'react-native';
import Svg, { Line, Path, Circle, Rect } from 'react-native-svg';
import { color } from '../theme/tokens';
import { DASH_OFF, DASH_ON, fitDashV } from '../lib/dashFit';

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

/**
 * 세로 점선 (타임라인 커넥터) — svg가 borderStyle dashed보다 안정적.
 *
 * 높이를 재서 주기를 거기 맞춘다. 커넥터는 한 줄이 아니라 조각 여러 개라
 * (행마다 `above`/`below` 가 따로) 조각마다 dash phase 가 0 에서 다시 시작하는데,
 * 고정 주기로는 이음매가 dash 한가운데 떨어져 두 dash 가 붙거나 구멍이 난다.
 * 왜 이 방법인지는 `lib/dashFit.ts` 주석에 있다.
 */
/**
 * 세로 점선의 Svg 스타일. 웹만 다르다.
 *
 * RNW 에서 이 Svg 는 HTML <svg> 로 나오는데, height 를 안 준 <svg> 는 300x150 의
 * 고유 크기를 갖는다. 부모 높이가 flex 로 정해지는 자리(A1 출발-목적지 카드의 레일 등)
 * 에서는 그 150px 이 거꾸로 부모를 밀어올려, 카드가 실제 내용보다 68px 높아졌다.
 * minHeight:0 은 줄어드는 걸 허용할 뿐 줄여 주지 않는다 — 절대 배치로 흐름에서 빼야
 * 높이에 기여하지 않는다. top/bottom 을 둘 다 주는 방법은 안 통한다. <svg> 는
 * replaced element 라 bottom 이 무시되고 고유 높이가 남는다. 그래서 height 를 100% 로
 * 못 박는다.
 *
 * 네이티브는 건드리지 않는다. Yoga 에는 이 함정이 없고, 시뮬레이터로 확인하지 못한
 * 변경을 출시 앱에 실을 이유가 없다.
 */
const DASH_SVG = Platform.OS === 'web'
  ? ({ position: 'absolute', top: 0, left: 0, width: 2, height: '100%' } as const)
  : ({ flex: 1, width: 2 } as const);

export function DashedLineV({ style, stroke = color.stroke }: { style?: ViewStyle; stroke?: string }) {
  const [height, setHeight] = React.useState(0);
  const fit = fitDashV(height);
  return (
    <View
      /* minHeight 0 은 Yoga 의 기본값이라 네이티브에는 아무 영향이 없다. 웹에서만 의미가 있다 —
         아래 Svg 는 RNW 에서 HTML <svg> 로 나오고, height 를 안 준 <svg> 는 300x150 의 고유
         크기를 갖는다. CSS 의 min-height 기본값이 auto 라 flex:1 이어도 그 150px 밑으로 못
         줄어들고, 그게 부모 레일의 높이가 되어 카드를 실제 내용보다 68px 높였다. */
      style={[{ width: 2, minHeight: 0 }, style]}
      pointerEvents="none"
      onLayout={e => {
        const next = e.nativeEvent.layout.height;
        // 소수점 떨림으로 매 프레임 다시 그리지 않는다
        if (Math.abs(next - height) > 0.5) setHeight(next);
      }}
    >
      <Svg style={DASH_SVG}>
        <Line
          x1={1}
          y1={0}
          x2={1}
          y2="100%"
          stroke={stroke}
          strokeWidth={2}
          // 아직 못 잰 첫 프레임은 원안 주기로 그린다 — 비워두면 선이 한 번 깜빡인다
          strokeDasharray={fit ? `${fit.on},${fit.off}` : `${DASH_ON},${DASH_OFF}`}
        />
      </Svg>
    </View>
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
/** 일행 초대 — 사람 + 더하기 */
export function PersonPlusIcon({ size = 22, tint = color.body }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={9.6} cy={8} r={3.4} stroke={tint} strokeWidth={2} fill="none" />
      <Path
        d="M3.6 19.4a6.2 6.2 0 0 1 12 0"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
      <Path d="M18.6 7.4v5.2M16 10h5.2" stroke={tint} strokeWidth={2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** 스왑 — 위아래로 엇갈린 화살표 */
export function SwapIcon({ size = 20, tint = color.body }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M8 4.5v15M8 4.5L4.8 7.9M8 4.5l3.2 3.4"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 19.5v-15M16 19.5l3.2-3.4M16 19.5l-3.2-3.4"
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 완료 — 채워진 원 안의 체크 */
export function CheckCircle({ size = 22, tint = color.green }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={11} fill={tint} />
      <Path
        d="M7.2 12.3l3.3 3.2 6.3-6.4"
        stroke="#fff"
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

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

/**
 * 반짝임 — A2 의 접힌 팁 버튼. 이 앱은 이모지를 쓰지 않는다(폰트·플랫폼마다 모양이 달라
 * 디자인이 흔들린다). 네 갈래 별을 오목한 곡선으로 이어 그린다 — 직선으로 이으면
 * 마름모가 되어 '반짝임'이 아니라 도형으로 읽힌다.
 */
export function SparkIcon({ size = 16, tint = color.primary }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path
        d="M10 1.2C10.5 6.6 13.4 9.5 18.8 10C13.4 10.5 10.5 13.4 10 18.8C9.5 13.4 6.6 10.5 1.2 10C6.6 9.5 9.5 6.6 10 1.2Z"
        fill={tint}
      />
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
  // 목적지 — 도착을 뜻하는 초록. 모양은 다른 노드와 같은 점이라 타임라인이 흐트러지지 않는다.
  // 지나온 뒤에는 흰 테두리를 빼서 커넥터 실선이 끊겨 보이지 않게 한다
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color.green,
        ...(state === 'passed' ? null : { borderWidth: 2, borderColor: '#fff' }),
      }}
    />
  );
}
