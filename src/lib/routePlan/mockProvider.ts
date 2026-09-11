/**
 * 테스트·서버 없음 대비용 라우팅 공급자. haversine × 우회율, 선택적 장벽(강)을 가로지르면 penaltyKm.
 * 장벽은 "추정기가 틀리는 동네"를 흉내 낸다 — 2라운드 트리거를 시험하는 데 쓴다.
 *
 * 모드별 추정(2026-09-11): 대중교통·도보까지 자동차 속도로 계산해 실제보다 짧게 나왔다.
 * 실측 공급자가 붙기 전까지는 구간마다 접근·대기·환승을 더한 추정을 쓴다. 숫자는 실기기
 * 추적 로그와 비교해 조정할 것.
 */
import { buildPolyline, haversineM } from '../geo';
import type { LatLng, Mode, RouteProvider, RouteResult } from './types';

export type MockRouteOptions = {
  /** 자동차 분/km. 도보·대중교통은 MODE_ESTIMATE를 쓴다 */
  minPerKm?: number;
  /** 우회율. 미지정 시 도보 1.2, 그 외 1.3 */
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

/** 서버 없이 쓰는 모드별 추정 상수 */
export const MODE_ESTIMATE = {
  walk: { minPerKm: 12, circuity: 1.2 },
  transit: {
    /** 정류장까지 걷기 + 배차 대기(지하철 3~5분·버스 7~10분의 절반) — 구간마다 한 번 */
    accessWaitMin: 8,
    /** 차내 시속 25km */
    minPerKm: 2.4,
    /** 이 거리를 넘으면 환승 한 번으로 본다 */
    transferOverKm: 5,
    transferMin: 5,
  },
} as const;

/** 구간 하나의 소요 분. 대중교통은 아주 짧으면 걷는 시간을 넘지 않는다 */
export function estimateSectionMin(km: number, mode: Mode, carMinPerKm: number): number {
  if (mode === 'walk') return km * MODE_ESTIMATE.walk.minPerKm;
  if (mode === 'transit') {
    const t = MODE_ESTIMATE.transit;
    const ride = t.accessWaitMin + km * t.minPerKm + (km > t.transferOverKm ? t.transferMin : 0);
    return Math.min(ride, km * MODE_ESTIMATE.walk.minPerKm);
  }
  return km * carMinPerKm;
}

export function mockRouteProvider(opts: MockRouteOptions = {}): RouteProvider & { calls: number; log: LatLng[][] } {
  const minPerKm = opts.minPerKm ?? 2;
  const barrier = opts.barrier;
  const self = {
    calls: 0,
    log: [] as LatLng[][],
    async route(points: LatLng[], _departAtMin: number, mode: Mode): Promise<RouteResult> {
      self.calls++;
      self.log.push(points);
      const circuity = opts.circuity ?? (mode === 'walk' ? MODE_ESTIMATE.walk.circuity : 1.3);
      const sections = [];
      for (let i = 0; i < points.length - 1; i++) {
        let km = (haversineM(points[i], points[i + 1]) / 1000) * circuity;
        if (barrier && segmentsIntersect(points[i], points[i + 1], barrier.a, barrier.b)) km += barrier.penaltyKm;
        sections.push({ distanceKm: km, durationMin: estimateSectionMin(km, mode, minPerKm) });
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
