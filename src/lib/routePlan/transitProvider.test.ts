import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { departAtIso, itineraryToRoute, transitRouteProvider } from './transitProvider';
import type { RouteProvider, RouteResult } from './types';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/transit-sinjeong.json', import.meta.url), 'utf8'));
const O = { latitude: 37.5246, longitude: 126.8607 };
const D = { latitude: 37.5295, longitude: 126.9187 };
const now = () => new Date(2026, 8, 16, 9, 0, 0); // 2026-09-16 09:00 로컬

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown } | Promise<never>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const estimateStub = (): RouteProvider & { calls: number } => {
  const s = { calls: 0, async route(points: { latitude: number; longitude: number }[]): Promise<RouteResult> {
    s.calls++;
    return { durationMin: 99, distanceKm: 9, polyline: points, sections: points.slice(1).map(() => ({ durationMin: 1, distanceKm: 1 })), source: 'estimate' };
  } };
  return s;
};
const mk = (fn: typeof fetch, extra: Partial<Parameters<typeof transitRouteProvider>[0]> = {}) =>
  transitRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'dev1', fetchFn: fn, now, estimate: estimateStub(), ...extra });

test('departAtIso — 지금이면 undefined, 2분 이상 뒤면 그 시각의 ISO(UTC)', () => {
  assert.equal(departAtIso(9 * 60, now()), undefined);
  assert.equal(departAtIso(9 * 60 + 1, now()), undefined);
  const iso = departAtIso(9 * 60 + 30, now());
  assert.ok(iso);
  assert.equal(new Date(iso!).getTime(), new Date(2026, 8, 16, 9, 30, 0).getTime());
});

test('itineraryToRoute — 시간·거리·정류장 폴리라인·source', () => {
  const r = itineraryToRoute(fixture.itineraries[0], O, D, fixture.itineraries);
  assert.equal(r.durationMin, 23.6);
  assert.equal(r.distanceKm, 7.218);
  assert.equal(r.source, 'provider');
  assert.deepEqual(r.sections, [{ durationMin: 23.6, distanceKm: 7.218 }]);
  // 출발지 → 목동 → 여의도 → 국회의사당 → 목적지. 여의도는 하차·승차가 같은 점이라 한 번만
  assert.deepEqual(r.polyline.map(p => [p.latitude, p.longitude]), [
    [37.5246, 126.8607], [37.526097, 126.864538], [37.521624, 126.924221], [37.528143, 126.917856], [37.5295, 126.9187],
  ]);
  assert.equal(r.transit?.length, 2);
});

test('2점 — /transit 을 부르고 1위 경로를 RouteResult 로', async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: fixture }));
  const p = mk(fn);
  const r = await p.route([O, D], 9 * 60 + 30, 'transit');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.test/transit');
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.origin, { lat: 37.5246, lng: 126.8607 });
  assert.deepEqual(body.destination, { lat: 37.5295, lng: 126.9187 });
  assert.ok(typeof body.departAt === 'string');
  assert.equal((calls[0].init.headers as Record<string, string>)['x-app-token'], 'T');
  assert.equal(r.durationMin, 23.6);
  assert.equal(r.source, 'provider');
  assert.equal(r.polyline[1].latitude, 37.526097);
});

test('3점 이상 — 서버를 부르지 않고 추정 공급자로 위임한다', async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: fixture }));
  const est = estimateStub();
  const p = mk(fn, { estimate: est });
  const r = await p.route([O, { latitude: 37.52, longitude: 126.9 }, D], 9 * 60, 'transit');
  assert.equal(calls.length, 0);
  assert.equal(est.calls, 1);
  assert.equal(r.source, 'estimate');
});

test('서버 실패·모양 불량·타임아웃은 추정으로 폴백하고 onFallback 을 부른다', async () => {
  const errs: unknown[] = [];
  const est = estimateStub();
  const bad = mk(fakeFetch(() => ({ status: 502, body: { error: 'upstream' } })).fn, { estimate: est, onFallback: e => errs.push(e) });
  const r1 = await bad.route([O, D], 9 * 60, 'transit');
  assert.equal(r1.source, 'estimate');
  const shape = mk(fakeFetch(() => ({ status: 200, body: { provider: 'google', itineraries: [] } })).fn, { estimate: est, onFallback: e => errs.push(e) });
  const r2 = await shape.route([O, D], 9 * 60, 'transit');
  assert.equal(r2.source, 'estimate');
  const hang = mk(fakeFetch(() => new Promise<never>(() => {})).fn, { estimate: est, onFallback: e => errs.push(e), timeoutMs: 20 });
  const r3 = await hang.route([O, D], 9 * 60, 'transit');
  assert.equal(r3.source, 'estimate');
  assert.equal(errs.length, 3);
  assert.equal(est.calls, 3);
});

test('대중교통 외 모드는 거절', async () => {
  const p = mk(fakeFetch(() => ({ status: 200, body: fixture })).fn);
  await assert.rejects(() => p.route([O, D], 540, 'car'), /transit/);
});
