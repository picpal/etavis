/**
 * 카카오모빌리티 자동차 길찾기 — 요청 URL 조립과 응답 정규화. 순수 함수라 node 테스트가 돈다.
 *
 *   GET https://apis-navi.kakaomobility.com/v1/directions         (지금 출발)
 *   GET https://apis-navi.kakaomobility.com/v1/future/directions  (departure_time=YYYYMMDDHHMM)
 *   경유지 ≤ 5. 요금: 일 10,000건 무료(미래 5,000), 초과 8원/건 (2026-09-11 요금표)
 *
 * 응답은 앱의 RouteResult(분·km)로 바꾼다. 앱은 카카오 형식을 모른다.
 */
import type { RouteRequest } from './routeSchema';

export const KAKAO_BASE = 'https://apis-navi.kakaomobility.com';

export function kakaoDirectionsUrl(req: RouteRequest, base = KAKAO_BASE): string {
  const xy = (p: { lat: number; lng: number }) => `${p.lng},${p.lat}`;
  const params = new URLSearchParams({
    origin: xy(req.points[0]),
    destination: xy(req.points[req.points.length - 1]),
    priority: 'RECOMMEND',
    // sections가 필요하므로 요약 모드는 쓰지 않는다. roads는 폴리라인이 필요할 때만
    summary: 'false',
    road_details: 'false',
  });
  const way = req.points.slice(1, -1);
  if (way.length) params.set('waypoints', way.map(xy).join('|'));
  if (req.departAt) {
    params.set('departure_time', req.departAt);
    return `${base}/v1/future/directions?${params}`;
  }
  return `${base}/v1/directions?${params}`;
}

/** 앱과 공유하는 결과 형식 (src/lib/routePlan/types.ts RouteResult와 같다) */
export type NormalizedRoute = {
  durationMin: number;
  distanceKm: number;
  polyline: { latitude: number; longitude: number }[];
  sections: { durationMin: number; distanceKm: number }[];
};

type KakaoRoad = { vertexes?: number[] };
type KakaoSection = { distance?: number; duration?: number; roads?: KakaoRoad[] };
type KakaoRoute = { result_code?: number; result_msg?: string; sections?: KakaoSection[] };

export type NormalizeResult =
  | { ok: true; route: NormalizedRoute }
  | { ok: false; code: number | 'shape'; msg: string };

export function normalizeKakao(raw: unknown, wantPolyline: boolean): NormalizeResult {
  const routes = (raw as { routes?: KakaoRoute[] } | null)?.routes;
  const r = routes?.[0];
  if (!r) return { ok: false, code: 'shape', msg: 'routes 없음' };
  if (r.result_code !== 0) return { ok: false, code: r.result_code ?? 'shape', msg: r.result_msg ?? '' };
  if (!Array.isArray(r.sections) || r.sections.length === 0) return { ok: false, code: 'shape', msg: 'sections 없음' };

  const sections = r.sections.map(s => ({
    durationMin: Number(s.duration ?? 0) / 60,
    distanceKm: Number(s.distance ?? 0) / 1000,
  }));
  if (sections.some(s => !Number.isFinite(s.durationMin) || !Number.isFinite(s.distanceKm))) {
    return { ok: false, code: 'shape', msg: 'section 숫자 아님' };
  }

  const polyline: NormalizedRoute['polyline'] = [];
  if (wantPolyline) {
    for (const s of r.sections) {
      for (const road of s.roads ?? []) {
        const v = road.vertexes ?? [];
        for (let i = 0; i + 1 < v.length; i += 2) polyline.push({ longitude: v[i], latitude: v[i + 1] });
      }
    }
  }

  return {
    ok: true,
    route: {
      durationMin: sections.reduce((a, s) => a + s.durationMin, 0),
      distanceKm: sections.reduce((a, s) => a + s.distanceKm, 0),
      polyline,
      sections,
    },
  };
}
