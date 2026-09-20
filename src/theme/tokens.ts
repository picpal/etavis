/**
 * Etavia(에타비아) 디자인 토큰 — 시나리오 A
 * 원본: design-reference/Duler iOS Gallery v2.dc.html 의 인라인 스타일
 */

export const color = {
  bg: '#F4F7FC',
  surface: '#FFFFFF',
  ink: '#10203A',
  body: '#4C5A72',
  muted: '#5B6A84',
  placeholder: '#7C8AA2',
  primary: '#1B57D6',
  primaryTint: '#E8EFFD',
  amber: '#8A5108',
  amberDeep: '#7A4707',
  amberBg: '#FDF3E4',
  green: '#157A54',
  /** 도착 시각 배지 바탕 */
  greenBg: '#E3F3EC',
  /** 삭제·되돌릴 수 없는 동작 — iOS 시스템 레드 */
  danger: '#FF3B30',
  /** 마감을 넘김 — 글자·눈금용 붉은색과 막대 채움용 파스텔 */
  late: '#D0453F',
  lateSoft: '#F4A6A1',
  hairline: 'rgba(16,32,58,0.07)',
  stroke: '#C6D2E6',
  track: '#E5EBF4',
  skeleton: '#EAF0F9',
  skeletonSoft: '#F0F4FA',
  mapBg: '#E1E8F3',
  scrim: 'rgba(16,32,58,0.30)',
  scrimStrong: 'rgba(16,32,58,0.32)',
} as const;

export const radius = {
  card: 20,
  sheet: 24,
  input: 18,
  button: 16,
  chip: 14,
  segment: 12,
  segmentThumb: 10,
  chipSmall: 9,
  iconButton: 13,
} as const;

/** iOS 전용 그림자 (RN shadow*). Android는 elevation 별도. */
export const shadow = {
  card: { shadowColor: '#1C3A6E', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  cardElevated: { shadowColor: '#1C3A6E', shadowOpacity: 0.1, shadowRadius: 11, shadowOffset: { width: 0, height: 6 } },
  header: { shadowColor: '#1C3A6E', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  input: { shadowColor: '#1C3A6E', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  chip: { shadowColor: '#1C3A6E', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  dragging: { shadowColor: '#1C3A6E', shadowOpacity: 0.12, shadowRadius: 9, shadowOffset: { width: 0, height: 8 } },
  sheet: { shadowColor: '#10203A', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -10 } },
  amberCard: { shadowColor: '#B26A0A', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
} as const;

/**
 * z축 층. **같은 부모 안에서 누가 위에 그려지는가**를 한 곳에서 정한다.
 *
 * 왜 토큰으로 빼나: 헤더는 `zIndex: 10` 을 직접 들고 있었고 시트는 아무것도 안 들고
 * 있어서(=0) 헤더가 시트 위에 그려졌다. 키보드가 올라와 시트가 그만큼 떠오르면
 * 시트 머리 — 손잡이·'경유지' 라벨·제목 윗부분 — 가 불투명한 헤더 밑으로 들어가
 * 잘렸고, 딤도 헤더를 못 덮어 헤더만 환하게 남았다
 * (2026-09-19 실기기 제보, 1.3.0, A2 되묻기 시트).
 *
 * 두 숫자가 서로 다른 파일에 흩어져 있어서 눈으로만 찾을 수 있었다. 그래서 값을
 * 여기 모으고, 날숫자 `zIndex` 는 `layer.test.ts` 가 막는다.
 */
export const layer = {
  /** 화면 상단 고정 헤더. 스크롤 내용 위로 그림자를 떨궈야 해서 0 이면 안 된다 */
  header: 10,
  /** 바텀시트와 그 딤. **화면 크롬보다 항상 위다** — 모달은 화면을 덮는 것이다 */
  sheet: 50,
  /** 사용 안내 스포트라이트. 시트 안을 가리킬 때가 있어 시트보다도 위다 */
  spotlight: 100,
} as const;

const F = {
  r: 'Pretendard-Regular',
  m: 'Pretendard-Medium',
  sb: 'Pretendard-SemiBold',
  b: 'Pretendard-Bold',
} as const;

export const font = F;

export const type = {
  display: { fontFamily: F.b, fontSize: 30, lineHeight: 37, letterSpacing: -0.6 },
  displayXL: { fontFamily: F.b, fontSize: 34, lineHeight: 34, letterSpacing: -0.68 },
  titleL: { fontFamily: F.b, fontSize: 24, lineHeight: 29, letterSpacing: -0.24 },
  title: { fontFamily: F.b, fontSize: 20, lineHeight: 24, letterSpacing: -0.4 },
  statL: { fontFamily: F.b, fontSize: 26, lineHeight: 26, letterSpacing: -0.52 },
  stat: { fontFamily: F.b, fontSize: 20, lineHeight: 20 },
  statS: { fontFamily: F.b, fontSize: 17, lineHeight: 17 },
  time: { fontFamily: F.b, fontSize: 16, lineHeight: 16 },
  btn: { fontFamily: F.sb, fontSize: 17, lineHeight: 17 },
  bodyL: { fontFamily: F.r, fontSize: 16, lineHeight: 22 },
  item: { fontFamily: F.sb, fontSize: 16, lineHeight: 19 },
  action: { fontFamily: F.m, fontSize: 15, lineHeight: 15 },
  body: { fontFamily: F.r, fontSize: 14, lineHeight: 21 },
  caption: { fontFamily: F.r, fontSize: 13, lineHeight: 18 },
  captionM: { fontFamily: F.m, fontSize: 13, lineHeight: 13 },
  label: { fontFamily: F.sb, fontSize: 12, lineHeight: 12, letterSpacing: 0.72 },
  labelPlain: { fontFamily: F.m, fontSize: 12, lineHeight: 12 },
  micro: { fontFamily: F.m, fontSize: 11, lineHeight: 11 },
} as const;

export const space = {
  screenX: 20,
  cardP: 18,
  cardPLg: 20,
  cardPSm: 16,
  betweenCards: 14,
  labelToCard: 10,
  chipGap: 9,
  headerBottom: 14,
  bottomBarY: 12,
  bottomAreaP: 16,
  bottomAreaBottom: 30,
} as const;

/** 최소 탭 타깃 */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/* ─── NativeWind v4를 쓸 경우 tailwind.config.js 확장 ───────────────
module.exports = {
  content: ['./App.tsx', './src/**\/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#F4F7FC', surface: '#fff', ink: '#10203A', body: '#4C5A72',
        muted: '#5B6A84', placeholder: '#7C8AA2', primary: '#1B57D6',
        'primary-tint': '#E8EFFD', amber: '#8A5108', 'amber-deep': '#7A4707',
        'amber-bg': '#FDF3E4', green: '#157A54', stroke: '#C6D2E6', track: '#E5EBF4',
      },
      borderRadius: { card: '20px', sheet: '24px', input: '18px', chip: '14px' },
      fontFamily: {
        regular: ['Pretendard-Regular'], medium: ['Pretendard-Medium'],
        semibold: ['Pretendard-SemiBold'], bold: ['Pretendard-Bold'],
      },
    },
  },
};
──────────────────────────────────────────────────────────────── */
