/**
 * 경로 이탈 판정용 지오 계산 — 목이 아니라 실제로 동작하는 로직.
 * 폴리라인까지의 수직거리(cross-track)를 구해 이탈을 판정한다.
 */
import { LatLng } from '../data/mockData';

/**
 * 예보성 도착 시각 표기 — 5분 반올림 + '경'.
 * 교통 상황은 그보다 정확할 수 없으므로 정밀해 보이는 것보다 안 틀려 보이는 게 낫다.
 */
export function formatEta(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.round((h * 60 + m) / 5) * 5;
  return `${Math.floor(total / 60) % 24}:${String(total % 60).padStart(2, '0')}경`;
}

/**
 * 거리 표기 — 1km 미만은 m, 100km 미만은 소수 한 자리 km, 그 이상은 정수 km.
 * 멀수록 소수점은 의미가 없다 (9035.5km보다 9,036km가 읽기 쉽다).
 */
export function formatDistanceM(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)}km`;
  return `${String(Math.round(m / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}km`;
}

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 두 점 사이 거리(m) */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 기준점 중심 로컬 평면(m) 좌표로 변환 */
function toXY(p: LatLng, ref: LatLng) {
  return {
    x: toRad(p.longitude - ref.longitude) * R * Math.cos(toRad(ref.latitude)),
    y: toRad(p.latitude - ref.latitude) * R,
  };
}
function fromXY(xy: { x: number; y: number }, ref: LatLng): LatLng {
  return {
    latitude: ref.latitude + toDeg(xy.y / R),
    longitude: ref.longitude + toDeg(xy.x / (R * Math.cos(toRad(ref.latitude)))),
  };
}

export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

/** 경유지들을 잇는 폴리라인 생성 (목: 실제 내비 폴리라인 대신 구간 보간) */
export function buildPolyline(points: LatLng[], perLeg = 16): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < perLeg; s++) out.push(lerp(points[i], points[i + 1], s / perLeg));
  }
  out.push(points[points.length - 1]);
  return out;
}

/** 폴리라인 누적 길이(m) */
export function polylineLengthM(poly: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length - 1; i++) sum += haversineM(poly[i], poly[i + 1]);
  return sum;
}

export type CrossTrack = {
  /** 경로에서 벗어난 수직거리(m) */
  distanceM: number;
  /** 가장 가까운 선분 인덱스 */
  index: number;
  /** 폴리라인 위 투영점 */
  point: LatLng;
  /** 경로 시작부터 투영점까지 진행 거리(m) */
  progressM: number;
};

/** 현재 위치에서 폴리라인까지의 수직거리 + 투영점 + 진행도 */
export function crossTrack(p: LatLng, poly: LatLng[]): CrossTrack {
  let best: CrossTrack = { distanceM: Infinity, index: 0, point: poly[0], progressM: 0 };
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const segLen = haversineM(a, b);
    // 현재 위치를 원점으로 두면 투영점까지 거리 = 그대로 수직거리
    const A = toXY(a, p);
    const B = toXY(b, p);
    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 === 0 ? 0 : (-A.x * abx - A.y * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = A.x + abx * t;
    const py = A.y + aby * t;
    const d = Math.hypot(px, py);
    if (d < best.distanceM) {
      best = { distanceM: d, index: i, point: fromXY({ x: px, y: py }, p), progressM: acc + segLen * t };
    }
    acc += segLen;
  }
  return best;
}

/** 경로 시작부터 meters만큼 진행한 지점 */
export function pointAtProgress(poly: LatLng[], meters: number): { point: LatLng; index: number } {
  let acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const segLen = haversineM(poly[i], poly[i + 1]);
    if (acc + segLen >= meters) {
      const t = segLen === 0 ? 0 : (meters - acc) / segLen;
      return { point: lerp(poly[i], poly[i + 1], t), index: i };
    }
    acc += segLen;
  }
  return { point: poly[poly.length - 1], index: poly.length - 2 };
}

/** 해당 선분의 수직 방향으로 meters만큼 밀어낸 좌표 (이탈 시뮬레이션용) */
export function offsetPerpendicular(poly: LatLng[], index: number, from: LatLng, meters: number): LatLng {
  const a = poly[Math.max(0, index)];
  const b = poly[Math.min(poly.length - 1, index + 1)];
  const A = toXY(a, from);
  const B = toXY(b, from);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  // 좌측 수직 단위벡터
  const nx = -dy / len;
  const ny = dx / len;
  return fromXY({ x: nx * meters, y: ny * meters }, from);
}
