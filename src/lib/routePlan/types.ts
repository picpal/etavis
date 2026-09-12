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
  searchStatus?: SearchStatus;
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

export type RouteSection = { durationMin: number; distanceKm: number };
export type RouteResult = {
  durationMin: number;
  distanceKm: number;
  polyline: LatLng[];
  /** points.length - 1 개. 경유지 사이 구간 */
  sections: RouteSection[];
};

export interface RouteProvider {
  /** points[0]=출발, 마지막=도착, 사이가 경유지(≤5) */
  route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult>;
}

/** 계획 속 한 방문 */
export type Visit = { slotId: string; candidate: PlaceCandidate; dwellMin: number };

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
};
