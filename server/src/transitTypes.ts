/**
 * /transit 의 공급자 무관 형식. 앱은 이것만 본다 — Google·TMAP·카카오 형식을 모른다.
 * RouteResult(자동차)와 다른 이유: 앵커 모델(6단계)이 승차·환승·하차 정류장 좌표를 쓴다.
 */
export type LatLng = { lat: number; lng: number };
export type TransitStop = { name: string; lat: number; lng: number };
export type TransitMode = 'SUBWAY' | 'BUS' | 'TRAIN' | 'OTHER';
export type TransitLeg =
  | { kind: 'walk'; durationMin: number; distanceM: number }
  | {
      kind: 'transit'; mode: TransitMode; line: string;
      from: TransitStop; to: TransitStop;
      durationMin: number; stops: number | null;
      /** ISO 8601. 공급자가 시간표를 알면 온다 — 재승차 대기 계산(7단계)의 재료 */
      departAt: string | null; arriveAt: string | null;
    };
export type TransitItinerary = { durationMin: number; distanceM: number; legs: TransitLeg[] };
export type TransitProviderId = 'google' | 'tmap' | 'kakao';
/** source 는 항상 provider — 서버는 추정을 만들지 않는다. 앱의 timingSource 가 이걸 받는다 */
export type TransitResponse = { provider: TransitProviderId; source: 'provider'; itineraries: TransitItinerary[] };
export type TransitRequest = {
  origin: LatLng; destination: LatLng;
  /** ISO 8601(UTC). 없으면 지금 */
  departAt?: string;
  /** 돌려줄 경로 수 1~3 */
  alternatives: number;
  /** 지하철·기차만(버스 제외). 스파이크의 '지하철우선' */
  subwayOnly: boolean;
};
export type TransitNormalizeResult =
  | { ok: true; itineraries: TransitItinerary[] }
  | { ok: false; code: 'shape' | 'none'; msg: string };
export type TransitEnv = { GOOGLE_ROUTES_KEY?: string; GOOGLE_PLACES_KEY?: string; TMAP_APP_KEY?: string };
/** 공급자 하나 = 이 둘. 핸들러는 어댑터를 모른다 */
export interface TransitAdapter {
  id: TransitProviderId;
  fetchRaw(req: TransitRequest, env: TransitEnv, f: typeof fetch): Promise<Response>;
  normalize(raw: unknown, req: TransitRequest): TransitNormalizeResult;
}
