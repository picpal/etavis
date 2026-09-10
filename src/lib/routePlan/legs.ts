/**
 * leg 저장소. 설계 4단계의 재사용 규칙:
 *   자동차  Δ≤5분 그대로 · 5~15분 불확실성 max(1, 0.1×leg) · >15분 미실측
 *   도보    시각 무시
 * 키는 (from, to, mode). 같은 키에 여러 시각의 실측이 쌓일 수 있다.
 */
import type { Mode, RouteResult } from './types';

export const ORIGIN_ID = 'O';
export const DEST_ID = 'D';

export type MeasuredLeg = { durationMin: number; distanceKm: number; departAtMin: number };
export type LegLookup = { durationMin: number; distanceKm: number; uncertaintyMin: number };

const EXACT_MIN = 5;
const PROVISIONAL_MIN = 15;

export class LegStore {
  private map = new Map<string, MeasuredLeg[]>();

  private key(from: string, to: string, mode: Mode) {
    return `${from}>${to}|${mode}`;
  }

  get size(): number {
    let n = 0;
    for (const v of this.map.values()) n += v.length;
    return n;
  }

  add(from: string, to: string, mode: Mode, leg: MeasuredLeg): void {
    const k = this.key(from, to, mode);
    const list = this.map.get(k) ?? [];
    list.push(leg);
    this.map.set(k, list);
  }

  lookup(from: string, to: string, mode: Mode, departAtMin: number): LegLookup | null {
    const list = this.map.get(this.key(from, to, mode));
    if (!list || list.length === 0) return null;
    const best = list.reduce((a, b) =>
      Math.abs(b.departAtMin - departAtMin) < Math.abs(a.departAtMin - departAtMin) ? b : a,
    );
    const delta = Math.abs(best.departAtMin - departAtMin);
    if (mode === 'walk' || delta <= EXACT_MIN) {
      return { durationMin: best.durationMin, distanceKm: best.distanceKm, uncertaintyMin: 0 };
    }
    if (delta <= PROVISIONAL_MIN) {
      return {
        durationMin: best.durationMin,
        distanceKm: best.distanceKm,
        uncertaintyMin: Math.max(1, 0.1 * best.durationMin),
      };
    }
    return null;
  }
}

/** route 응답의 section을 leg로 쪼개 넣는다. 출발시각은 이동 + dwell을 누적한다 */
export function learnLegs(
  store: LegStore,
  pointIds: string[],
  route: RouteResult,
  departAtMin: number,
  dwellsMin: number[],
  mode: Mode,
): void {
  let clock = departAtMin;
  for (let i = 0; i < route.sections.length; i++) {
    const sec = route.sections[i];
    store.add(pointIds[i], pointIds[i + 1], mode, {
      durationMin: sec.durationMin,
      distanceKm: sec.distanceKm,
      departAtMin: clock,
    });
    clock += sec.durationMin + (dwellsMin[i] ?? 0);
  }
}
