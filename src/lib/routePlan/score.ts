/**
 * 계획 하나의 채점. 실측 leg는 실측값, 없는 leg만 추정치(C 추정 × ρ).
 * 도착시각을 누적하고 영업시간을 그 시각으로 검사한다. 설계 4단계.
 */
import { haversineM } from '../geo';
import { corridorLegM, destinationPoint, estimateC, originPoint, type CorridorPoint } from './corridor';
import { DEST_ID, LegStore, ORIGIN_ID } from './legs';
import type { LatLng, Mode, PlaceCandidate, Visit } from './types';

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
};

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

  for (let i = 0; i < ids.length - 1; i++) {
    const hit = ctx.legs.lookup(ids[i], ids[i + 1], ctx.mode, clock);
    let legMin: number;
    if (hit) {
      legMin = hit.durationMin;
      distanceKm += hit.distanceKm;
      uncertaintyMin += hit.uncertaintyMin;
    } else {
      const km = estimateLegKm(coords[i], coords[i + 1], cps[i], cps[i + 1]);
      legMin = km * ctx.rhoMinPerKm;
      distanceKm += km;
      unknownLegs++;
    }
    legsMin.push(legMin);
    clock += legMin;
    arrivals.push(clock);
    if (i < visits.length) clock += visits[i].dwellMin;
  }

  return { visits, totalMin: clock - ctx.departAtMin, distanceKm, arrivals, unknownLegs, uncertaintyMin, legsMin };
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
