/**
 * 들러(Duler) 목 데이터 — 평창 기준 3개 시나리오
 * 백엔드 없이 화면·상호작용을 검증하기 위한 고정 데이터셋.
 * 좌표는 실제 평창/원주 일대 근사값 (지도 폴리라인 확인용).
 */

export type LatLng = { latitude: number; longitude: number };

export type Task = { id: string; text: string; done: boolean; required?: boolean };

export type Stop = {
  id: string;
  name: string;
  category: string;
  coord: LatLng;
  dwellMin: number;          // 체류
  arriveAt: string;          // 'HH:mm'
  legMin: number;            // 직전 구간 이동 시간
  legKm: number;
  openState: 'open' | 'closing_soon' | 'closed';
  openNote: string;          // '영업 중 · 22시 마감'
  tasks: Task[];
};

export type Candidate = {
  id: string;
  name: string;
  note: string;              // '화장품 · 경로에서 1.1km'
  addedMin: number;          // +4
  arriveAt: string;
  dwellMin: number;
  parking: '가능' | '어려움' | '없음';
  openState: Stop['openState'];
  openNote: string;
  reason?: string;
  verifiedNote?: string;     // '영업시간 12분 전 확인'
  recommended?: boolean;
  disabled?: boolean;
  coord: LatLng;
};

export type RouteOption = {
  id: string;
  badge?: string;            // '시간 최소'
  title: string;             // '시간 최소' | '대기 최소' | '한 곳만 들르기'
  totalMin: number;
  deltaMin: number;
  stopNames: string[];
  rationale: string;
  recommended?: boolean;
};

export type Dataset = {
  key: string;
  label: string;
  origin: { name: string; note: string; coord: LatLng; departAt: string };
  destination: { name: string; coord: LatLng; arriveAt: string };
  directMin: number;
  mode: 'car' | 'walk' | 'transit';
  arriveByLabel: string;     // '오늘 21:00까지'
  userMessage: string;
  options: RouteOption[];
  stops: Stop[];
  candidates: Record<string, Candidate[]>;   // stopId → 후보
  totals: { totalMin: number; stopCount: number; deltaMin: number };
};

const ALPENSIA: LatLng = { latitude: 37.6605, longitude: 128.6754 };
const OLIVE_PC: LatLng = { latitude: 37.6357, longitude: 128.6812 };
const KYOCHON: LatLng = { latitude: 37.6202, longitude: 128.6493 };
const OAKVALLEY: LatLng = { latitude: 37.4235, longitude: 127.9008 };
const OLIVE_DGR: LatLng = { latitude: 37.6893, longitude: 128.7237 };
const OLIVE_JB: LatLng = { latitude: 37.5989, longitude: 128.5581 };
const BBQ_DGR: LatLng = { latitude: 37.6851, longitude: 128.7104 };

/** ① 기본: 갤러리 A1~A9에 그려진 그 계획 */
export const datasetBase: Dataset = {
  key: 'base',
  label: '기본 (올리브영 → 교촌 → 숙소)',
  origin: { name: '알펜시아 리조트', note: '현재 위치', coord: ALPENSIA, departAt: '18:52' },
  destination: { name: '오크밸리 숙소', coord: OAKVALLEY, arriveAt: '19:48' },
  directMin: 32,
  mode: 'car',
  arriveByLabel: '오늘 21:00까지',
  userMessage: '숙소 가기 전에 올리브영에서 화장품 사고 치킨 포장하고 싶어',
  options: [
    {
      id: 'fastest', badge: '시간 최소', title: '시간 최소', totalMin: 41, deltaMin: 9,
      stopNames: ['알펜시아', '올리브영', '교촌', '숙소'],
      rationale: '두 매장이 모두 숙소 방향이고, 포장 대기 12분이 이동 중에 소화돼요.',
      recommended: true,
    },
    {
      id: 'least-wait', title: '대기 최소', totalMin: 44, deltaMin: 12,
      stopNames: ['알펜시아', 'BBQ 대관령점', '올리브영', '숙소'],
      rationale: 'BBQ 대관령점 → 올리브영 · 포장 대기 4분, 순서가 바뀌어요',
    },
    {
      id: 'single-stop', title: '한 곳만 들르기', totalMin: 36, deltaMin: 4,
      stopNames: ['알펜시아', '올리브영', '숙소'],
      rationale: '올리브영만 들르고 치킨은 숙소 근처 배달로 대체',
    },
  ],
  stops: [
    {
      id: 's1', name: '올리브영 평창점', category: '화장품', coord: OLIVE_PC,
      dwellMin: 15, arriveAt: '19:04', legMin: 12, legKm: 6.4,
      openState: 'open', openNote: '체류 15분 · 영업 중',
      tasks: [
        { id: 't1', text: '스킨·로션 리필', done: true },
        { id: 't2', text: '선크림 (세일 확인)', done: false },
        { id: 't3', text: '멤버십 쿠폰 적용', done: false, required: true },
      ],
    },
    {
      id: 's2', name: '교촌치킨 평창점', category: '포장', coord: KYOCHON,
      dwellMin: 12, arriveAt: '19:28', legMin: 9, legKm: 4.1,
      openState: 'open', openNote: '포장 대기 12분',
      tasks: [{ id: 't4', text: '허니콤보 1 + 무 추가', done: false, required: true }],
    },
  ],
  candidates: {
    s1: [
      {
        id: 'c1', name: '올리브영 평창점', note: '화장품 · 경로에서 1.1km', addedMin: 4,
        arriveAt: '19:12', dwellMin: 15, parking: '가능', openState: 'open',
        openNote: '영업 중 · 22시 마감',
        reason: '숙소 방향에서 벗어나지 않고, 치킨집까지 이어지는 구간이 가장 짧아요.',
        verifiedNote: '영업시간 12분 전 확인', recommended: true, coord: OLIVE_PC,
      },
      {
        id: 'c2', name: '올리브영 대관령점', note: '영업 중 · 재고 많음 · 역방향', addedMin: 11,
        arriveAt: '19:19', dwellMin: 15, parking: '가능', openState: 'open',
        openNote: '영업 중', coord: OLIVE_DGR,
      },
      {
        id: 'c3', name: '올리브영 진부점', note: '영업 종료 · 선택 불가', addedMin: 6,
        arriveAt: '19:14', dwellMin: 15, parking: '어려움', openState: 'closed',
        openNote: '영업 종료 · 선택 불가', disabled: true, coord: OLIVE_JB,
      },
    ],
    s2: [
      {
        id: 'c4', name: '교촌치킨 평창점', note: '포장 · 경로에서 0.6km', addedMin: 8,
        arriveAt: '19:28', dwellMin: 12, parking: '가능', openState: 'open',
        openNote: '영업 중 · 24시 마감', reason: '포장 대기가 이동 중에 끝나요.',
        recommended: true, coord: KYOCHON,
      },
      {
        id: 'c5', name: 'BBQ 대관령점', note: '포장 대기 4분 · 역방향', addedMin: 14,
        arriveAt: '19:36', dwellMin: 8, parking: '없음', openState: 'closing_soon',
        openNote: '21시 마감', coord: BBQ_DGR,
      },
    ],
  },
  totals: { totalMin: 56, stopCount: 2, deltaMin: 24 },
};

/** ② 순서 뒤바뀜: 드래그 재정렬·재계산 검증용 (치킨 먼저) */
export const datasetReordered: Dataset = {
  ...datasetBase,
  key: 'reordered',
  label: '순서 변형 (치킨 먼저 · 재계산 검증)',
  userMessage: '치킨 먼저 픽업하고 화장품 사고 숙소로',
  stops: [
    { ...datasetBase.stops[1], arriveAt: '19:06', legMin: 14, legKm: 7.2 },
    { ...datasetBase.stops[0], arriveAt: '19:31', legMin: 11, legKm: 5.3, dwellMin: 15 },
  ],
  options: datasetBase.options.map(o =>
    o.id === 'fastest' ? { ...o, totalMin: 47, deltaMin: 15, stopNames: ['알펜시아', '교촌', '올리브영', '숙소'] } : o,
  ),
  totals: { totalMin: 63, stopCount: 2, deltaMin: 31 },
};

/** ③ 후보 부족 + 마감 임박: 예외 UI(비활성 행·주의 카드·A8) 검증용 */
export const datasetScarce: Dataset = {
  ...datasetBase,
  key: 'scarce',
  label: '후보 부족 · 마감 임박 (예외 UI)',
  arriveByLabel: '오늘 20:30까지',
  userMessage: '숙소 가기 전에 화장품만 사고 싶어',
  stops: [
    {
      ...datasetBase.stops[0],
      openState: 'closing_soon',
      openNote: '체류 15분 · 20:00 마감',
      arriveAt: '19:41',
      tasks: [{ id: 't1', text: '선크림', done: false, required: true }],
    },
  ],
  candidates: {
    s1: [
      { ...datasetBase.candidates.s1[0], addedMin: 9, arriveAt: '19:41', openNote: '20:00 마감 · 19분 여유', openState: 'closing_soon', verifiedNote: '영업시간 3분 전 확인' },
      { ...datasetBase.candidates.s1[2] },
    ],
  },
  options: [datasetBase.options[2]],
  totals: { totalMin: 47, stopCount: 1, deltaMin: 15 },
};

export const datasets = [datasetBase, datasetReordered, datasetScarce];

/** 외부 지도 앱 (A7) */
export const mapApps = [
  { id: 'naver', name: '네이버지도', note: '경유지 3개 전달 가능', tint: '#E4F0E8', scheme: 'nmap://', installed: true },
  { id: 'kakaomap', name: '카카오맵', note: '경유지 3개 전달 가능', tint: '#FBF3DC', scheme: 'kakaomap://', installed: true },
  { id: 'kakaonavi', name: '카카오내비', note: '자동차 안내 즉시 시작', tint: '#FBF3DC', scheme: 'kakaonavi://', installed: true },
  { id: 'gmaps', name: 'Google Maps', note: '미설치 · 해외 경로용', tint: '#EAEFF6', scheme: 'comgooglemaps://', installed: false },
] as const;

/** A3 계산 중 체크리스트 */
export const calcSteps = [
  { id: 'k1', text: '경로상 올리브영', count: '4곳', state: 'done' },
  { id: 'k2', text: '포장 가능한 치킨집', count: '6곳', state: 'done' },
  { id: 'k3', text: '실제 이동시간 계산', state: 'active' },
  { id: 'k4', text: '추천 경로 정리', state: 'pending' },
] as const;

export const RECENT_DESTINATIONS = ['오크밸리 숙소', '평창역', '집'];
