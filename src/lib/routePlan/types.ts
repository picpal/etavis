/**
 * 최적 경로 플래너의 계약. 런타임 코드 없음.
 * 설계: docs/최적경로-설계.md
 */
import type { LatLng } from '../../data/mockData';
import type { Load, NeedWhen } from '../nearSide';

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

/**
 * 검색 단계가 붙이는 상태. 플래너는 이걸 슬롯 status로 승격한다
 *
 * 'none' 과 'unchecked' 를 섞지 않는다: 'none' 은 찾아봤는데 없는 것,
 * 'unchecked' 는 검색이 죽어 아예 보지 못한 것이다. 둘을 같은 말로 묶으면
 * 사용자에게 없는 사실을 말하게 된다.
 */
export type SearchStatus = 'ok' | 'far' | 'none' | 'short' | 'unchecked';

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
  /** 방향이 어디서 왔나. 화면은 안 보지만 로그는 본다 */
  nearSource?: 'stated' | 'inferred' | 'none';
  /** applyNear 전 후보 수 */
  nearBefore?: number;
  /** applyNear 후 후보 수 */
  nearAfter?: number;
  /** 어느 완화 단계에서 멈췄나(m). null 이면 전부 되돌렸거나 제약이 없었다 */
  nearRadiusM?: number | null;
  /** 추론까지 포함한 실제 완화 여부. 화면용 nearRelaxed 와 별개다 —
      화면은 사용자가 말한 제약이 안 먹었을 때만 사과하지만, 로그는 전부 봐야 한다 */
  nearRelaxedRaw?: boolean;
  /** 출발~도착 기한 내내 닫혀 있어 후보에서 뺀 곳 수. 어떤 순서로도 못 들르는 곳이다
      (`score.closedThroughout`). 영업시간을 못 받은 곳은 여기 안 든다 — 모름은 닫힘이 아니다 */
  closedDropped?: number;
  /** 그렇게 걸렀더니 한 곳도 안 남아 되돌린 것. 화면이 "그 시간엔 여는 곳이 없어서…"라고 말한다 */
  closedRelaxed?: boolean;
  /** 추출이 낸 물성·시점. 방향은 여기서 파생된다 — 진단과 재계산을 위해 슬롯까지 들고 온다.
      추출 시점에 방향을 확정하면 사용자가 모드를 바꿨을 때 다시 계산할 근거가 사라진다 */
  loadBefore?: Load;
  loadAfter?: Load;
  needWhen?: NeedWhen;
  /** 여기서 할 일. 추출의 `why`. 계획이 확정될 때 그 경유지의 할 일 한 줄이 된다 —
      계산에는 쓰이지 않는다(순서·시간에 영향을 주면 안 된다) */
  why?: string;
  searchStatus?: SearchStatus;
  /** 마지막으로 쓴 검색 반지름(m). 로그 판정용 */
  searchRadiusM?: number;
  /** 이 슬롯이 부른 장소 검색 횟수. 로그 판정용 */
  searchCalls?: number;
  /** 사용자가 이미 정한 가게로 닫힌 슬롯. `candidates[0]` 가 이 가게고 `flexible` 은 false 다.
   *
   *  `source` 는 **그 가게가 어디서 왔는지 사실대로** 적는다 — 검색·near 메타데이터를
   *  빌려 쓰지 않는다(`nearRelaxedRaw` 는 `applyNear` 가 완화했을 때만 true 다).
   *  - `search`   검색 결과 안에 있었다. 영업시간·신호가 다른 후보와 같은 수준이다
   *  - `filtered` 검색은 찾았는데 주차 정책·near·상한에서 떨어진 것을 되살렸다
   *  - `request`  검색이 못 찾아 요청에 실린 이름·좌표로 세웠다. **신호도 영업시간도 없다** */
  fixed?: { placeId: string; source: 'search' | 'filtered' | 'request' };
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

/**
 * 시간 **값 하나**의 등급. `TimingSource` 가 계획 전체의 출처라면 이건 숫자 하나에 붙는다 —
 * 실측 계획 안에서 매장을 바꾸면 그 두 구간만 추정이 되고, 화면은 값마다 등급을 물어야
 * '약'을 맞게 붙인다. 계획 등급으로 추측하면 바꾼 뒤 23:15 가 실측인 척 나간다(2026-09-20).
 * 등급을 문구로 바꾸는 곳은 `timingCopy.ts` 하나다
 */
export type TimeClass = 'measured' | 'estimated';
/** 등급을 들고 다니는 분 값. 실측 − 추정 같은 뺄셈은 같은 `cls` 끼리만 한다 */
export type Timed = { min: number; cls: TimeClass };

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

export type SlotStatus = 'ok' | 'far' | 'none' | 'closed' | 'short' | 'unchecked';

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

/**
 * 기준 안에서 경유지 하나를 바꾼 대안. 숫자는 전부 `rescoreFrom` 이 낸 같은-자 값이다 —
 * 여기엔 "합계 둘"이 없어서 호출부가 실측에서 추정을 뺄 재료가 없다(2026-09-20 의 −32분)
 */
export type Alternative = {
  slotId: string;
  candidate: PlaceCandidate;
  /** 기준 안 대비 추가 시간. 등급은 바뀐 구간 중 낮은 쪽 */
  addedMin: Timed;
  /** 바꾼 경유지의 도착 시각(분). 기준 도착에 **앞 구간 차이만** 얹은 값 — 여행 전체 차이가 아니다 */
  arriveMin: Timed;
  /** 회랑 수직거리(km). 기하값이라 등급이 없다 — 추정 km 에서 실측 km 를 뺀 '0m' 가 아니다 */
  detourKm: number;
};

export type Rescored = {
  totalMin: number;
  arrivals: number[];
  distanceKm: number;
  estimated: boolean;
  /** 방문별 도착 leg의 km. arrivals와 같은 길이·순서(마지막은 목적지 도착 leg) */
  legsKm: number[];
  /** 구간마다의 등급. arrivals 와 같은 길이·순서 — 값 하나의 '약'은 여기서 나온다 */
  legCls: TimeClass[];
};

/** 기준 안 대비 차이. `rescoreFrom` 만 만든다 — 차이는 관문 안에서 같은 자로만 난다 */
export type RescoredDelta = {
  /** 총 소요시간 차이. 등급은 바뀐 구간들의 최저, 바뀐 구간이 없으면 measured(0) */
  totalMin: Timed;
  /** 방문 i 도착 시각 차이 = i 까지의 구간 차이 합. 마지막은 목적지 */
  arrivals: Timed[];
};
export type RescoredFrom = Rescored & { delta: RescoredDelta };

export type PlanResult = {
  directMin: number;
  directKm: number;
  options: PlanOption[];
  /**
   * `추천 순서` 가 가리킬 options 인덱스. 짐을 안 재는 계획이면 null.
   * 0 이면 최단안이 곧 편한 안이라 두 기준이 같은 안을 가리킨다.
   */
  comfortIdx: number | null;
  alternatives: Alternative[];
  slotStatus: Record<string, SlotStatus>;
  apiCalls: number;
  /** 실측 leg가 있으면 실측, 없으면 추정으로 임의 방문 순서를 다시 채점한다(교체 시트용) */
  rescore: (visits: Visit[]) => Rescored;
  /**
   * 기준 안 `base` 대비 변형 `visits` 의 시간과 **차이**. 방문 수가 같아야 한다(교체만 잰다).
   *
   * 구간을 짝지어(`from>to` id) 안 바뀐 구간은 기준 값·등급 그대로, 바뀐 구간만 다시 낸다 —
   * 둘 다 실측이면 실측 차이, 아니면 **둘 다 같은 추정기**(km × ρ)로 잰 차이를 기준 값 위에 얹는다.
   * 실측 합계에서 추정 합계를 빼는 일이 여기선 구조적으로 없다. 대중교통 실측엔 구간마다
   * 접근·대기 8분이 들어 있고 추정엔 없어서, 그걸 빼면 300m 옆 후보가 −32분이 됐다(2026-09-20)
   */
  rescoreFrom: (base: Visit[], visits: Visit[]) => RescoredFrom;
  /**
   * `base[idx]` 를 `candidate` 로 바꾼 대안 하나. `rescoreFrom` 위에서 도착·차이·우회를 낸다 —
   * 브리지와 플래너의 대안 목록이 이 하나를 쓴다. 호출부에 합계 둘을 주지 않는 것이 관문이다
   */
  alternativeAt: (base: Visit[], idx: number, candidate: PlaceCandidate) => Alternative;
  /**
   * `visits[idx]` 로 들어오고 나가는 **두 구간만** 공급자에 물어 leg 저장소에 넣는다.
   * 성공하면 다음 `rescoreFrom`·`rescore` 부터 그 구간이 `measured` 로 올라가 '약'이 지워진다 —
   * 값을 돌려주지 않는 건 화면이 이미 그 둘로 숫자를 만들기 때문이다(합계를 두 개 쥐여 주지 않는다).
   *
   * 왜 "고르면 계획을 다시 계산"이 아니라 이 모양인가: 다시 계산은 `/transit` 10 + `/places` 10~20 +
   * 12초인데다 **고른 후보를 재 준다는 보장이 없다**(시드는 estC 로 뽑힌다). 바뀌는 구간은 정확히
   * 둘이므로 2회면 진실을 산다. 예산은 계획당 `TRANSIT_SWAP_BUDGET` 누적이고, 넘으면 아무것도
   * 부르지 않고 `false` — 못 고르는 게 아니라 '약'이 붙은 채로 남는다.
   *
   * 이미 잰 구간(시드였던 구간)은 묻지 않는다. 그래서 `false` 는 "예산을 넘었거나 공급자가 실패했다"고만
   * 읽는다. 던지지 않는다 — 실패가 매장 고르기를 막을 이유가 없다.
   */
  measureSwap: (visits: Visit[], idx: number) => Promise<boolean>;
  /** 선택된 후보 전부 × 출발·도착의 leg 표. 키 'O>c1' · 'c1>D'. 확정 변환이 쓴다 */
  legTable: Record<string, { min: number; km: number; measured: boolean }>;
  /** 성공한 라우팅 호출 수(직행 포함). "실측 6회" */
  measuredCount: number;
  /** 직행 응답의 출처. 한 계획의 호출은 모두 같은 모드·공급자라 직행 하나로 대표한다 */
  timingSource: TimingSource;
};
