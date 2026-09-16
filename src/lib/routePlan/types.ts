/**
 * 최적 경로 플래너의 계약. 런타임 코드 없음.
 * 설계: docs/최적경로-설계.md
 */
import type { LatLng } from '../../data/mockData';

export type { LatLng };
export type Mode = 'car' | 'walk' | 'transit';

/** 장소 검색에서 온 후보 한 곳 */
export type PlaceCandidate = {
  id: string;
  name: string;
  coord: LatLng;
  /** 분 단위 하루 시각. 없으면 항상 열려 있다고 본다 */
  hours?: { openMin: number; closeMin: number };
  parking?: '가능' | '어려움' | '없음';
  /** 카카오 address_name. /enrich 요청에 싣는다 */
  address?: string;
  /** 어느 앵커 주변에서 찾았나(6단계). 없으면 회랑 검색으로 찾은 것 */
  anchorId?: string;
  /** 그 앵커에서 여기까지 직선 거리(m). 7단계 삽입 비용의 재료 */
  anchorWalkM?: number;
  /** /enrich 가 붙인 바깥 신호. 없으면 보강을 안 했거나 실패한 것 */
  signals?: import('../enrich/types').PlaceSignals;
};

/** 검색 단계가 붙이는 상태. 플래너는 이걸 슬롯 status로 승격한다 */
export type SearchStatus = 'ok' | 'far' | 'none' | 'short';

export type Slot = {
  id: string;
  query: string;
  candidates: PlaceCandidate[];
  dwellMin: number;
  /** 같은 종류를 몇 곳. 기본 1 */
  count: number;
  /** false면 candidates[0] 한 곳으로 고정 */
  flexible: boolean;
  openNow: boolean;
  /** 추출이 정한 경유지 종류. 'category' 일 때만 보강·추천이 돈다 */
  stopKind: 'brand' | 'category' | 'specific';
  /** 경로의 어느 쪽 끝에 붙어야 하나. 없으면 'any'(제약 없음)로 본다 */
  near?: NearSide;
  /** near 로 걸렀더니 한 곳도 안 남아 제약을 푼 것. 화면이 "그쪽엔 없어서…"라고 말한다 */
  nearRelaxed?: boolean;
  /** 여기서 할 일. 추출의 `why`. 계획이 확정될 때 그 경유지의 할 일 한 줄이 된다 —
      계산에는 쓰이지 않는다(순서·시간에 영향을 주면 안 된다) */
  why?: string;
  searchStatus?: SearchStatus;
  /** 마지막으로 쓴 검색 반지름(m). 로그 판정용 */
  searchRadiusM?: number;
  /** 이 슬롯이 부른 장소 검색 횟수. 로그 판정용 */
  searchCalls?: number;
};

export type PlanInput = {
  origin: LatLng;
  destination: LatLng;
  /** 하루 기준 분(0~1439) */
  departAtMin: number;
  arriveByMin?: number;
  mode: Mode;
  slots: Slot[];
  order: 'auto' | 'locked';
};

/**
 * 시간의 출처 — 화면 등급이다(`timingCopy`). 낮은 쪽이 이긴다.
 *
 * - `provider`            전부 공급자 응답을 **한 번에** 받았다. 마감 판정을 낼 수 있는 유일한 등급
 * - `provider_legs`       전부 공급자 응답이지만 **구간을 쪼개 이어 붙였다**(대중교통 7단계).
 *                         구간을 병렬로 불러 2구간 이후도 계획의 출발 시각으로 조회됐다 —
 *                         체류 뒤의 시간표·배차는 다르다. 숫자는 실측이라 '약'을 안 붙이되,
 *                         같은 O→D가 출발 시각만 달라져 20% 흔들린 적이 있어 판정은 안 한다
 *                         (`docs/transit-추정-오차.md`). 실제 출발 시각 재조회는 9단계
 * - `provider_direct_only` 직행만 공급자·경유 조합은 추정(대중교통 5단계)
 * - `estimate`            하버사인 목
 */
export type TimingSource = 'provider' | 'provider_legs' | 'provider_direct_only' | 'estimate';

export type TransitStop = { name: string; lat: number; lng: number };
export type TransitLeg =
  | { kind: 'walk'; durationMin: number; distanceM: number }
  | { kind: 'transit'; mode: 'SUBWAY' | 'BUS' | 'TRAIN' | 'OTHER'; line: string; from: TransitStop; to: TransitStop; durationMin: number; stops: number | null; departAt: string | null; arriveAt: string | null };
export type TransitItinerary = { durationMin: number; distanceM: number; legs: TransitLeg[] };

export type RouteSection = { durationMin: number; distanceKm: number };
export type RouteResult = {
  durationMin: number;
  distanceKm: number;
  polyline: LatLng[];
  /** points.length - 1 개. 경유지 사이 구간 */
  sections: RouteSection[];
  /** 없으면 estimate 로 본다 — 찍지 않은 쪽이 실측을 주장할 수 없다. 여기선 실측이냐 아니냐만 말한다 */
  source?: TimingSource;
  /**
   * 이 결과가 **구간을 쪼개 따로 부른 응답을 이어 붙인 것**인가(`joinLegRoutes`).
   * `source` 와 직교한다 — 쪼갰는지와 쟀는지는 다른 질문이고, 쪼갰어도 한 구간이 추정이면
   * `source` 는 estimate 로 떨어진다. 이걸 아는 자리는 실제로 쪼갠 공급자뿐이다.
   * 화면 등급 `provider_legs` 의 유일한 근거(plan.ts).
   */
  legJoined?: boolean;
  /** 대중교통 직행일 때 서버가 준 경로들(1위가 [0]). 앵커(6단계)의 재료 */
  transit?: TransitItinerary[];
};

export interface RouteProvider {
  /** points[0]=출발, 마지막=도착, 사이가 경유지(≤5) */
  route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult>;
}

/** 계획 속 한 방문 */
export type Visit = { slotId: string; candidate: PlaceCandidate; dwellMin: number };

/** 경유지가 경로의 어느 쪽 끝에 붙어야 하나. 'any'면 제약 없음 — 규칙은 src/lib/nearSide.ts */
export type NearSide = 'start' | 'end' | 'any';

export type SlotStatus = 'ok' | 'far' | 'none' | 'closed' | 'short';

export type PlanOption = {
  visits: Visit[];
  totalMin: number;
  deltaMin: number;
  /** 각 방문의 도착 시각(분), 마지막은 목적지 */
  arrivals: number[];
  /** arriveBy 대비 여유. arriveBy 없으면 null */
  slackMin: number | null;
  distanceKm: number;
};

export type Alternative = {
  slotId: string;
  candidate: PlaceCandidate;
  /** 1안 대비 추가 시간 */
  addedMin: number;
  detourKm: number;
  /** 실측 leg가 없어 추정치인가 */
  estimated: boolean;
};

export type Rescored = {
  totalMin: number;
  arrivals: number[];
  distanceKm: number;
  estimated: boolean;
  /** 방문별 도착 leg의 km. arrivals와 같은 길이·순서(마지막은 목적지 도착 leg) */
  legsKm: number[];
};

export type PlanResult = {
  directMin: number;
  directKm: number;
  options: PlanOption[];
  alternatives: Alternative[];
  slotStatus: Record<string, SlotStatus>;
  apiCalls: number;
  /** 실측 leg가 있으면 실측, 없으면 추정으로 임의 방문 순서를 다시 채점한다(교체 시트용) */
  rescore: (visits: Visit[]) => Rescored;
  /** 선택된 후보 전부 × 출발·도착의 leg 표. 키 'O>c1' · 'c1>D'. 확정 변환이 쓴다 */
  legTable: Record<string, { min: number; km: number; measured: boolean }>;
  /** 성공한 라우팅 호출 수(직행 포함). "실측 6회" */
  measuredCount: number;
  /** 직행 응답의 출처. 한 계획의 호출은 모두 같은 모드·공급자라 직행 하나로 대표한다 */
  timingSource: TimingSource;
};
