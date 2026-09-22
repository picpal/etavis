/**
 * 계획 하나의 채점. 실측 leg는 실측값, 없는 leg만 추정치(C 추정 × ρ).
 * 도착시각을 누적하고 영업시간을 그 시각으로 검사한다. 설계 4단계.
 */
import { haversineM } from '../geo';
import type { StopTags } from '../nearSide';
import { corridorLegM, destinationPoint, estimateC, originPoint, type CorridorPoint } from './corridor';
import { DEST_ID, LegStore, ORIGIN_ID } from './legs';
import type { LatLng, Mode, PlaceCandidate, TimeClass, Visit } from './types';

export type ScoreContext = {
  origin: LatLng;
  destination: LatLng;
  corridorOf: (id: string) => CorridorPoint;
  corridorLengthM: number;
  /** 분/km. 직행 실측에서 온다 */
  rhoMinPerKm: number;
  mode: Mode;
  departAtMin: number;
  legs: LegStore;
  /**
   * 슬롯의 물성 태그. 없으면 짐이 없는 것으로 본다 — 기존 호출부를 안 깨려고 선택 인자다.
   * `burdenMin` 이 이걸 본다.
   */
  tagsOf?: (slotId: string) => StopTags | undefined;
};

export type Scored = {
  visits: Visit[];
  totalMin: number;
  distanceKm: number;
  /** 방문별 도착, 마지막은 목적지 */
  arrivals: number[];
  unknownLegs: number;
  uncertaintyMin: number;
  legsMin: number[];
  /** 방문별 도착 leg의 km. legsMin·arrivals와 같은 길이·순서 */
  legsKm: number[];
  /** 구간마다 실측(lookup 적중)인지 추정인지. `unknownLegs` 가 개수라면 이건 자리다 — 같은 길이·순서 */
  legCls: TimeClass[];
  /**
   * 짐을 진 채 이동한 시간. `totalMin` 에는 **안 들어간다** — 화면에 보이는 숫자는
   * 계속 진짜 소요시간이어야 한다. 순위에만 쓴다(`comfortMin`).
   *
   * 왜 필요한가: 채점이 총 시간만 보면 "마트 들렀다 약국 갔다 집"이 이긴다.
   * 장바구니를 들고 약국에 들어가는 비용이 점수에 없기 때문이다.
   */
  burdenMin: number;
};

/**
 * 짐을 진 채 이동한 시간.
 *
 * `legsMin` 은 `[출발→v0, v0→v1, …, vN→도착]` 이라 방문 i 이후 이동은 `slice(i+1)` 이다.
 * - `loadAfter: 'hard'` — 거기서 짐이 **생긴다** → 그 뒤 전부
 * - `loadBefore: 'hard'` — 거기까지 짐을 **들고 간다** → 그 앞 전부
 *
 * 짐이 여럿이면 겹치는 구간이 두 번 세진다. 둘을 같이 들고 있으니 맞다.
 * `count > 1` 슬롯도 방문마다 각자의 위치에서 계산돼 자연히 처리된다.
 *
 * 자동차는 0 이다 — 트렁크에 실으면 그만이고, 차의 지배 축은 정차 용이성이다
 * (`nearSide.ts` 의 `decideNear` 가 차를 일찍 빼는 것과 같은 이유).
 */
/**
 * 짐 1분을 이동 몇 분으로 칠까.
 *
 * 임의의 상수가 아니라 제품 문장이다 — **"짐을 든 1분을 이동 1.5분으로 친다."**
 * 바꾸려면 이 값과 테스트를 같이 고친다. 측정값이 아니므로 근거를 여기 남긴다:
 * 1.0 이면 짐이 순위를 못 뒤집고(같은 1분), 2.0 이면 조금만 무거워도 크게 돌아간다.
 */
export const BURDEN_WEIGHT = 1.5;

/** 순위용 점수. `totalMin` 은 화면용이라 안 건드린다 */
export const comfortMin = (s: Scored): number => s.totalMin + BURDEN_WEIGHT * s.burdenMin;

function burdenOf(visits: Visit[], legsMin: number[], ctx: ScoreContext): number {
  if (ctx.mode === 'car' || !ctx.tagsOf) return 0;
  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
  let burden = 0;
  for (let i = 0; i < visits.length; i++) {
    const tags = ctx.tagsOf(visits[i].slotId);
    if (!tags) continue;
    if (tags.loadAfter === 'hard') burden += sum(legsMin.slice(i + 1));
    if (tags.loadBefore === 'hard') burden += sum(legsMin.slice(0, i + 1));
  }
  return burden;
}

export function estimateLegKm(from: LatLng, to: LatLng, cFrom: CorridorPoint, cTo: CorridorPoint): number {
  return estimateC(corridorLegM(cFrom, cTo), haversineM(from, to)) / 1000;
}

export function scorePlan(visits: Visit[], ctx: ScoreContext): Scored {
  const ids = [ORIGIN_ID, ...visits.map(v => v.candidate.id), DEST_ID];
  const coords = [ctx.origin, ...visits.map(v => v.candidate.coord), ctx.destination];
  const cps = [originPoint(), ...visits.map(v => ctx.corridorOf(v.candidate.id)), destinationPoint(ctx.corridorLengthM)];

  let clock = ctx.departAtMin;
  let distanceKm = 0;
  let unknownLegs = 0;
  let uncertaintyMin = 0;
  const arrivals: number[] = [];
  const legsMin: number[] = [];
  const legsKm: number[] = [];
  const legCls: TimeClass[] = [];

  for (let i = 0; i < ids.length - 1; i++) {
    const hit = ctx.legs.lookup(ids[i], ids[i + 1], ctx.mode, clock);
    let legMin: number;
    let legKm: number;
    if (hit) {
      legMin = hit.durationMin;
      legKm = hit.distanceKm;
      distanceKm += hit.distanceKm;
      uncertaintyMin += hit.uncertaintyMin;
      legCls.push('measured');
    } else {
      const km = estimateLegKm(coords[i], coords[i + 1], cps[i], cps[i + 1]);
      legMin = km * ctx.rhoMinPerKm;
      legKm = km;
      distanceKm += km;
      unknownLegs++;
      legCls.push('estimated');
    }
    legsMin.push(legMin);
    legsKm.push(legKm);
    clock += legMin;
    arrivals.push(clock);
    if (i < visits.length) clock += visits[i].dwellMin;
  }

  return {
    visits, totalMin: clock - ctx.departAtMin, distanceKm, arrivals,
    unknownLegs, uncertaintyMin, legsMin, legsKm, legCls,
    burdenMin: burdenOf(visits, legsMin, ctx),
  };
}

export function isOpenAt(c: PlaceCandidate, minuteOfDay: number): boolean {
  if (!c.hours) return true;
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const { openMin, closeMin } = c.hours;
  if (openMin <= closeMin) return m >= openMin && m < closeMin;
  return m >= openMin || m < closeMin; // 자정을 넘는 영업
}

/** 계획의 모든 방문지가 도착 시각에 닫혀 있나 */
export function allClosedAtArrival(s: Scored): boolean {
  if (s.visits.length === 0) return false;
  return s.visits.every((v, i) => !isOpenAt(v.candidate, s.arrivals[i]));
}

/**
 * `fromMin`~`toMin` 내내 닫혀 있나 — **어떤 순서로 짜도 못 들르는 곳**을 가리는 판정이다.
 *
 * 도착 시각으로 거르지 못하는 이유가 있다: 도착 시각은 계획을 세워야 알고, 계획은 후보가
 * 있어야 세운다(닭과 달걀). 그래서 도착 시각이 필요 없는 것만 묻는다 — 출발부터 도착 기한까지
 * 한 번도 안 여는 곳이라면, 그 곳을 어디에 끼워 넣든 닫힌 문 앞에 선다.
 *
 * `hours` 가 없으면 **false** 다. 모름은 닫힘이 아니다 — 여기서 true 를 내면 영업시간을
 * 못 받은 곳이 통째로 사라진다(F6 에서 화면이 저지른 것과 같은 거짓말의 반대편).
 * `openMin === closeMin` 도 false 다. 0분 영업인지 24시간인지 모르므로 안 거르는 쪽으로 읽는다.
 *
 * 분은 정수다(앱의 모든 시계가 분 단위). 창과 영업 구간이 **정수 분 하나라도** 겹치면 열려 있다.
 */
export function closedThroughout(
  c: Pick<PlaceCandidate, 'hours'>,
  fromMin: number,
  toMin: number,
): boolean {
  if (!c.hours) return false;
  const { openMin, closeMin } = c.hours;
  if (openMin === closeMin) return false;
  if (toMin - fromMin >= 1440) return false; // 하루를 통째로 덮는 창이면 언젠가는 연다

  // 창을 하루 안으로 내리고 길이를 유지한다. 영업 구간은 매일 반복되므로 0일·1일 뒤만 보면 된다
  const from = ((fromMin % 1440) + 1440) % 1440;
  const to = from + (toMin - fromMin);
  // [열림, 닫힘) — 자정을 넘으면 두 토막이다
  const spans: [number, number][] = openMin <= closeMin
    ? [[openMin, closeMin]]
    : [[openMin, 1440], [0, closeMin]];
  for (const [a, b] of spans) {
    for (const day of [0, 1440]) {
      if (Math.max(from, a + day) <= Math.min(to, b + day - 1)) return false;
    }
  }
  return true;
}
