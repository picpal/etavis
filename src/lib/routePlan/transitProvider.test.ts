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

// --- 7단계: N점은 구간마다 2점으로 쪼개 병렬 실측한다 ---

const C = { latitude: 37.52, longitude: 126.9 };
const C2 = { latitude: 37.54, longitude: 126.88 };

/** 요청 OD 를 보고 구간마다 다른 itinerary 를 돌려주는 스텁 */
function legFetch(table: Record<string, { durationMin: number; distanceM: number } | 'fail' | 'demoted'>) {
  return fakeFetch((_url, init) => {
    const b = JSON.parse(init.body as string) as { origin: { lat: number }; destination: { lat: number } };
    const k = `${b.origin.lat}>${b.destination.lat}`;
    const hit = table[k];
    if (hit === undefined) return { status: 404, body: { error: `모르는 구간 ${k}` } };
    if (hit === 'fail') return { status: 502, body: { error: 'upstream' } };
    const it = hit === 'demoted' ? { durationMin: 5, distanceM: 1000 } : hit;
    return {
      status: 200,
      body: {
        provider: 'google',
        source: hit === 'demoted' ? 'estimate' : 'provider',
        itineraries: [{ durationMin: it.durationMin, distanceM: it.distanceM, legs: [] }],
      },
    };
  });
}

test('3점 — 구간마다 /transit 을 부른다. sections 2개, durationMin 은 구간 합', async () => {
  const { fn, calls } = legFetch({ [`${O.latitude}>${C.latitude}`]: { durationMin: 9.8, distanceM: 1930 }, [`${C.latitude}>${D.latitude}`]: { durationMin: 25.5, distanceM: 4900 } });
  const est = estimateStub();
  const r = await mk(fn, { estimate: est }).route([O, C, D], 9 * 60, 'transit');
  assert.equal(calls.length, 2, '구간마다 한 번');
  assert.equal(est.calls, 0, '실측이 되면 추정은 부르지 않는다');
  assert.deepEqual(r.sections, [{ durationMin: 9.8, distanceKm: 1.93 }, { durationMin: 25.5, distanceKm: 4.9 }]);
  assert.ok(Math.abs(r.durationMin - 35.3) < 1e-9);
  assert.ok(Math.abs(r.distanceKm - 6.83) < 1e-9);
  assert.equal(r.source, 'provider');
  // 두 번째 구간의 출발지는 첫 구간의 도착지다
  const bodies = calls.map(c => JSON.parse(c.init.body as string));
  assert.deepEqual(bodies[0].destination, { lat: C.latitude, lng: C.longitude });
  assert.deepEqual(bodies[1].origin, { lat: C.latitude, lng: C.longitude });
});

test('3점 — 폴리라인은 구간 폴리라인을 이어 붙이고 이음매의 중복점을 지운다', async () => {
  const { fn } = legFetch({ [`${O.latitude}>${C.latitude}`]: { durationMin: 9.8, distanceM: 1930 }, [`${C.latitude}>${D.latitude}`]: { durationMin: 25.5, distanceM: 4900 } });
  const r = await mk(fn).route([O, C, D], 9 * 60, 'transit');
  assert.deepEqual(r.polyline.map(p => [p.latitude, p.longitude]), [
    [O.latitude, O.longitude], [C.latitude, C.longitude], [D.latitude, D.longitude],
  ]);
});

test('4점 — 구간 3개를 병렬로 부른다', async () => {
  const { fn, calls } = legFetch({
    [`${O.latitude}>${C.latitude}`]: { durationMin: 4, distanceM: 1000 },
    [`${C.latitude}>${C2.latitude}`]: { durationMin: 6, distanceM: 2000 },
    [`${C2.latitude}>${D.latitude}`]: { durationMin: 8, distanceM: 3000 },
  });
  const r = await mk(fn).route([O, C, C2, D], 9 * 60, 'transit');
  assert.equal(calls.length, 3);
  assert.equal(r.sections.length, 3);
  assert.equal(r.durationMin, 18);
  assert.equal(r.source, 'provider');
});

test('한 구간이 실패하면 그 구간만 추정으로 채우고 전체는 estimate 로 강등된다', async () => {
  const { fn, calls } = legFetch({ [`${O.latitude}>${C.latitude}`]: { durationMin: 9.8, distanceM: 1930 }, [`${C.latitude}>${D.latitude}`]: 'fail' });
  const est = estimateStub();
  const errs: unknown[] = [];
  const r = await mk(fn, { estimate: est, onFallback: e => errs.push(e) }).route([O, C, D], 9 * 60, 'transit');
  assert.equal(calls.length, 2);
  assert.equal(est.calls, 1, '실패한 구간만 추정으로 다시 잰다');
  assert.equal(errs.length, 1);
  assert.equal(r.sections.length, 2);
  assert.equal(r.sections[0].durationMin, 9.8, '살아남은 구간의 실측은 버리지 않는다');
  assert.equal(r.source, 'estimate', '한 구간이라도 추정이면 전체가 추정이다');
});

test('한 구간이 서버 자진 강등(source:estimate)이면 전체가 estimate', async () => {
  const { fn } = legFetch({ [`${O.latitude}>${C.latitude}`]: { durationMin: 9.8, distanceM: 1930 }, [`${C.latitude}>${D.latitude}`]: 'demoted' });
  const r = await mk(fn).route([O, C, D], 9 * 60, 'transit');
  assert.equal(r.source, 'estimate');
  assert.deepEqual(r.sections, [{ durationMin: 9.8, distanceKm: 1.93 }, { durationMin: 5, distanceKm: 1 }],
    '강등은 출처만 낮춘다 — 서버가 준 구간 값은 그대로 쓴다');
});

test('구간이 여럿이면 transit(대안 itinerary)은 담지 않는다 — OD 전체의 대안이 아니다', async () => {
  const { fn } = legFetch({ [`${O.latitude}>${C.latitude}`]: { durationMin: 9.8, distanceM: 1930 }, [`${C.latitude}>${D.latitude}`]: { durationMin: 25.5, distanceM: 4900 } });
  const r = await mk(fn).route([O, C, D], 9 * 60, 'transit');
  assert.equal(r.transit, undefined);
});

test('예산 초과 — 닿는 데까지 실측하고 남는 구간만 추정. 잰 구간을 버리지 않는다', async () => {
  const { fn, calls } = legFetch({
    [`${O.latitude}>${C.latitude}`]: { durationMin: 4, distanceM: 1000 },
    [`${C.latitude}>${C2.latitude}`]: { durationMin: 6, distanceM: 2000 },
    [`${C2.latitude}>${D.latitude}`]: { durationMin: 8, distanceM: 3000 },
  });
  const est = estimateStub();
  const errs: unknown[] = [];
  const r = await mk(fn, { estimate: est, maxLegs: 2, onFallback: e => errs.push(e) }).route([O, C, C2, D], 9 * 60, 'transit');
  assert.equal(calls.length, 2, '상한만큼만 서버에 묻는다');
  assert.equal(est.calls, 1, '남는 구간 하나만 추정으로 채운다');
  assert.equal(errs.length, 1, '예산에 걸렸다는 사실은 로그에 남긴다');
  assert.equal(r.sections.length, 3);
  assert.deepEqual(r.sections.slice(0, 2), [{ durationMin: 4, distanceKm: 1 }, { durationMin: 6, distanceKm: 2 }]);
  assert.equal(r.source, 'estimate', '한 구간이라도 추정이면 전체가 추정이다');
});

test('같은 구간을 동시에 물으면 한 번만 나간다 — 시드끼리 겹치는 구간은 재사용', async () => {
  const { fn, calls } = legFetch({
    [`${O.latitude}>${C.latitude}`]: { durationMin: 4, distanceM: 1000 },
    [`${C.latitude}>${D.latitude}`]: { durationMin: 6, distanceM: 2000 },
    [`${C.latitude}>${C2.latitude}`]: { durationMin: 5, distanceM: 1500 },
    [`${C2.latitude}>${D.latitude}`]: { durationMin: 8, distanceM: 3000 },
  });
  const p = mk(fn);
  // 두 안 모두 O→C 로 시작한다. 구간 요청은 2+3=5번이지만 서로 다른 구간은 4개다
  const [a, b] = await Promise.all([p.route([O, C, D], 9 * 60, 'transit'), p.route([O, C, C2, D], 9 * 60, 'transit')]);
  assert.equal(calls.length, 4, `O→C 가 두 번 나갔다: ${calls.length}`);
  assert.equal(a.durationMin, 10);
  assert.equal(b.durationMin, 17);
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

test('서버 자진 강등(source:estimate)은 존중, 승격/알 수 없는 값은 무시', async () => {
  const demoted = { ...fixture, source: 'estimate' };
  const r1 = await mk(fakeFetch(() => ({ status: 200, body: demoted })).fn).route([O, D], 9 * 60, 'transit');
  assert.equal(r1.source, 'estimate');
  const noSource = { ...fixture };
  delete (noSource as { source?: string }).source;
  const r2 = await mk(fakeFetch(() => ({ status: 200, body: noSource })).fn).route([O, D], 9 * 60, 'transit');
  assert.equal(r2.source, 'provider');
  const provider = { ...fixture, source: 'provider' };
  const r3 = await mk(fakeFetch(() => ({ status: 200, body: provider })).fn).route([O, D], 9 * 60, 'transit');
  assert.equal(r3.source, 'provider');
  const unknown = { ...fixture, source: 'anything-else' };
  const r4 = await mk(fakeFetch(() => ({ status: 200, body: unknown })).fn).route([O, D], 9 * 60, 'transit');
  assert.equal(r4.source, 'provider');
});

test('transit leg 좌표 없음(null) — 추정으로 폴백하고 onFallback 을 부른다', async () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  broken.itineraries[0].legs[1].from.lat = null;
  const est = estimateStub();
  const errs: unknown[] = [];
  const p = mk(fakeFetch(() => ({ status: 200, body: broken })).fn, { estimate: est, onFallback: e => errs.push(e) });
  const r = await p.route([O, D], 9 * 60, 'transit');
  assert.equal(r.source, 'estimate');
  assert.equal(errs.length, 1);
  assert.equal(est.calls, 1);
});

test('대중교통 외 모드는 거절', async () => {
  const p = mk(fakeFetch(() => ({ status: 200, body: fixture })).fn);
  await assert.rejects(() => p.route([O, D], 540, 'car'), /transit/);
});

// --- legJoined: 구간을 쪼개 이어 붙였다는 사실. 화면 등급(provider_legs)의 유일한 근거 ---

test('구간을 쪼개 이어 붙이면 legJoined 를 찍는다 — 2구간 이후가 계획 출발 시각으로 조회됐다는 표시', async () => {
  const W = { latitude: 37.5266, longitude: 126.8887 };
  const r = await mk(fakeFetch(() => ({ status: 200, body: fixture })).fn).route([O, W, D], 9 * 60 + 30, 'transit');
  assert.equal(r.source, 'provider');
  assert.equal(r.legJoined, true);
});

test('직행(2점)은 쪼갠 적이 없다 — legJoined 를 찍지 않는다', async () => {
  const r = await mk(fakeFetch(() => ({ status: 200, body: fixture })).fn).route([O, D], 9 * 60 + 30, 'transit');
  assert.equal(r.source, 'provider');
  assert.notEqual(r.legJoined, true);
});

test('쪼갰어도 한 구간이 추정이면 legJoined 는 찍되 source 는 estimate — 등급은 낮은 쪽이 이긴다', async () => {
  const W = { latitude: 37.5266, longitude: 126.8887 };
  let n = 0;
  const fn = fakeFetch(() => (n++ === 0 ? { status: 200, body: fixture } : { status: 502, body: {} })).fn;
  const r = await mk(fn, { estimate: estimateStub() }).route([O, W, D], 9 * 60 + 30, 'transit');
  assert.equal(r.source, 'estimate');
  assert.equal(r.legJoined, true);
});
