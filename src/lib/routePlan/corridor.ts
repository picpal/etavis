/**
 * 직행 폴리라인 기준 회랑 좌표.
 * x = 진행 거리(m), y = 부호 있는 수직 거리(m, 진행 방향 왼쪽이 +), s = x/L.
 * 설계 2단계 — 추정기 A(회랑), B(haversine), C(결합).
 */
import { crossTrack, haversineM, polylineLengthM } from '../geo';
import type { LatLng } from './types';

export type CorridorPoint = { x: number; y: number; s: number };

const toRad = (d: number) => (d * Math.PI) / 180;

/** 부호: 선분 a→b 기준으로 p가 왼쪽이면 +1 */
function sideSign(a: LatLng, b: LatLng, p: LatLng): 1 | -1 {
  const k = Math.cos(toRad(a.latitude));
  const abx = toRad(b.longitude - a.longitude) * k;
  const aby = toRad(b.latitude - a.latitude);
  const apx = toRad(p.longitude - a.longitude) * k;
  const apy = toRad(p.latitude - a.latitude);
  return abx * apy - aby * apx >= 0 ? 1 : -1;
}

export function projectOnCorridor(poly: LatLng[], p: LatLng): CorridorPoint {
  const L = polylineLengthM(poly);
  const ct = crossTrack(p, poly);
  const a = poly[ct.index];
  const b = poly[Math.min(poly.length - 1, ct.index + 1)];
  return { x: ct.progressM, y: sideSign(a, b, p) * ct.distanceM, s: L === 0 ? 0 : ct.progressM / L };
}

export const originPoint = (): CorridorPoint => ({ x: 0, y: 0, s: 0 });
export const destinationPoint = (lengthM: number): CorridorPoint => ({ x: lengthM, y: 0, s: 1 });

/** g(u,v) = |p(u)−p(v)| + 0.5·max(0, x(u)−x(v)) — 역주행 벌점 */
export function corridorLegM(a: CorridorPoint, b: CorridorPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y) + 0.5 * Math.max(0, a.x - b.x);
}

export function estimateA(seq: CorridorPoint[]): number {
  let sum = 0;
  for (let i = 0; i < seq.length - 1; i++) sum += corridorLegM(seq[i], seq[i + 1]);
  return sum;
}

export function estimateB(seq: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < seq.length - 1; i++) sum += haversineM(seq[i], seq[i + 1]);
  return sum;
}

export const estimateC = (a: number, b: number): number => 0.35 * a + 0.65 * b;
