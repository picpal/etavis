import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departAtString, serverRouteProvider } from './serverProvider';

const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const now = () => new Date(2026, 8, 11, 8, 0, 0); // 2026-09-11 08:00 로컬

test('departAtString — 지금이면 undefined, 뒤면 YYYYMMDDHHMM', () => {
  assert.equal(departAtString(480, now()), undefined);
  assert.equal(departAtString(481, now()), undefined);
  assert.equal(departAtString(482, now()), '202609110802');
  assert.equal(departAtString(9 * 60 + 5, now()), '202609110905');
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const okBody = { durationMin: 20, distanceKm: 10, polyline: [], sections: [{ durationMin: 20, distanceKm: 10 }] };

test('요청 형식 — 헤더·좌표 변환·polyline은 2점일 때만', async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: okBody }));
  const p = serverRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'dev1', fetchFn: fn, now });
  await p.route([at(37.5, 127), at(37.6, 127.1)], 480, 'car');
  await p.route([at(37.5, 127), at(37.55, 127.05), at(37.6, 127.1)], 540, 'car');
  assert.equal(calls[0].url, 'https://x.test/route');
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h['x-app-token'], 'T');
  assert.equal(h['x-device-id'], 'dev1');
  const b0 = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(b0.points[0], { lat: 37.5, lng: 127 });
  assert.equal(b0.polyline, true);
  assert.equal(b0.departAt, undefined);
  const b1 = JSON.parse(calls[1].init.body as string);
  assert.equal(b1.polyline, false);
  assert.equal(b1.departAt, '202609110900');
});

test('서버 오류·모양 불량은 throw', async () => {
  const bad = fakeFetch(() => ({ status: 502, body: { error: 'upstream' } }));
  const p = serverRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: bad.fn, now });
  await assert.rejects(p.route([at(37.5, 127), at(37.6, 127.1)], 480, 'car'), /502/);
  const shape = fakeFetch(() => ({ status: 200, body: { nope: 1 } }));
  const q = serverRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: shape.fn, now });
  await assert.rejects(q.route([at(37.5, 127), at(37.6, 127.1)], 480, 'car'), /bad shape/);
});

test('자동차 외 모드는 거절', async () => {
  const { fn } = fakeFetch(() => ({ status: 200, body: okBody }));
  const p = serverRouteProvider({ baseUrl: 'https://x.test', appToken: 'T', deviceId: 'd', fetchFn: fn, now });
  await assert.rejects(p.route([at(37.5, 127), at(37.6, 127.1)], 480, 'walk'), /미지원/);
});
