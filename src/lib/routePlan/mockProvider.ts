/**
 * 테스트용 라우팅 공급자. haversine × 우회율, 선택적 장벽(강)을 가로지르면 penaltyKm.
 * 장벽은 "추정기가 틀리는 동네"를 흉내 낸다 — 2라운드 트리거를 시험하는 데 쓴다.
 */
import { buildPolyline, haversineM } from '../geo';
import type { LatLng, Mode, RouteProvider, RouteResult } from './types';

export type MockRouteOptions = {
  minPerKm?: number;
  circuity?: number;
  barrier?: { a: LatLng; b: LatLng; penaltyKm: number };
};

const orient = (p: LatLng, q: LatLng, r: LatLng) =>
  (q.longitude - p.longitude) * (r.latitude - p.latitude) - (q.latitude - p.latitude) * (r.longitude - p.longitude);

export function segmentsIntersect(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function mockRouteProvider(opts: MockRouteOptions = {}): RouteProvider & { calls: number; log: LatLng[][] } {
  const minPerKm = opts.minPerKm ?? 2;
  const circuity = opts.circuity ?? 1.3;
  const barrier = opts.barrier;
  const self = {
    calls: 0,
    log: [] as LatLng[][],
    async route(points: LatLng[], _departAtMin: number, _mode: Mode): Promise<RouteResult> {
      self.calls++;
      self.log.push(points);
      const sections = [];
      for (let i = 0; i < points.length - 1; i++) {
        let km = (haversineM(points[i], points[i + 1]) / 1000) * circuity;
        if (barrier && segmentsIntersect(points[i], points[i + 1], barrier.a, barrier.b)) km += barrier.penaltyKm;
        sections.push({ distanceKm: km, durationMin: km * minPerKm });
      }
      return {
        durationMin: sections.reduce((s, x) => s + x.durationMin, 0),
        distanceKm: sections.reduce((s, x) => s + x.distanceKm, 0),
        polyline: buildPolyline(points, 16),
        sections,
      };
    },
  };
  return self;
}
