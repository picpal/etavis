/**
 * Workers 프록시(/route)를 부르는 RouteProvider. 키는 서버에만 있다.
 *
 * - 호출당 타임아웃. 플래너는 시드 하나가 죽어도 나머지로 계획을 세운다.
 * - departAtMin(하루 분)이 지금보다 뒤면 YYYYMMDDHHMM(로컬 시각)으로 보내 미래운행정보를 쓴다.
 * - 서버는 자동차만 받는다. 도보·대중교통은 아직 추정만 한다(설계 문서 "대중교통").
 */
import type { LatLng, Mode, RouteProvider, RouteResult } from './types';

export type ServerProviderOptions = {
  baseUrl: string;
  appToken: string;
  deviceId: string;
  timeoutMs?: number;
  /** 테스트용 주입. 기본 globalThis.fetch */
  fetchFn?: typeof fetch;
  /** 테스트용 — 지금 시각(하루 분)과 오늘 날짜 */
  now?: () => Date;
};

/** 하루 분 → YYYYMMDDHHMM. 지금보다 2분 이상 뒤일 때만 값을 낸다(카카오는 과거 시각을 거절한다) */
export function departAtString(departAtMin: number, now: Date): string | undefined {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (departAtMin - nowMin < 2) return undefined;
  const d = new Date(now);
  d.setHours(Math.floor(departAtMin / 60), departAtMin % 60, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function serverRouteProvider(opts: ServerProviderOptions): RouteProvider {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const now = opts.now ?? (() => new Date());
  return {
    async route(points: LatLng[], departAtMin: number, mode: Mode): Promise<RouteResult> {
      if (mode !== 'car') throw new Error(`server route: ${mode} 미지원`);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${opts.baseUrl}/route`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-app-token': opts.appToken,
            'x-device-id': opts.deviceId,
          },
          body: JSON.stringify({
            points: points.map(p => ({ lat: p.latitude, lng: p.longitude })),
            mode: 'car',
            departAt: departAtString(departAtMin, now()),
            // 폴리라인은 직행(회랑 투영)에만 필요하다. 경유지 경로는 section만
            polyline: points.length === 2,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`server route ${res.status}`);
        const data = (await res.json()) as RouteResult;
        if (!Array.isArray(data.sections) || typeof data.durationMin !== 'number') throw new Error('server route: bad shape');
        return data;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
