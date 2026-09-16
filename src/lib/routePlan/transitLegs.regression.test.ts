/**
 * 2026-09-16 실측을 테스트로 굳힌다 — `docs/transit-추정-오차.md`.
 *
 * 스파이크가 본 것: 추정으로는 홈플러스익스프레스가 1위(32.379분)였고 하나로마트가
 * 0.2분 뒤 2위였다. 같은 아홉 구간을 서버 `/transit` 으로 재니 **하나로마트가 1위**(29.6분),
 * 홈플러스가 5.7분 뒤 2위였다. 순위가 뒤집힌다.
 *
 * 이 파일은 그 실측값을 스텁 공급자로 되돌려, 플래너가 구간을 실제로 재면 하나로마트를
 * 고르는지 본다. 결정적이고 API 를 쓰지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plan } from './plan';
import { mockRouteProvider } from './mockProvider';
import { transitRouteProvider } from './transitProvider';
import { TRANSIT_CALL_BUDGET } from './transitBudget';
import type { PlanInput, Slot } from './types';

type Leg = { durationMin: number; distanceKm: number };
type Fixture = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  departAtMin: number;
  dwellMin: number;
  direct: Leg;
  candidates: { id: string; name: string; lat: number; lng: number; in: Leg; out: Leg }[];
};

const fx = JSON.parse(
  readFileSync(new URL('./fixtures/transit-dangsan-legs.json', import.meta.url), 'utf8'),
) as Fixture;

const O = { latitude: fx.origin.lat, longitude: fx.origin.lng };
const D = { latitude: fx.destination.lat, longitude: fx.destination.lng };
const key = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

/** 실측 표 — 방향까지 포함한 구간 키 */
const measured = new Map<string, Leg>([[`${key(fx.origin.lat, fx.origin.lng)}>${key(fx.destination.lat, fx.destination.lng)}`, fx.direct]]);
for (const c of fx.candidates) {
  measured.set(`${key(fx.origin.lat, fx.origin.lng)}>${key(c.lat, c.lng)}`, c.in);
  measured.set(`${key(c.lat, c.lng)}>${key(fx.destination.lat, fx.destination.lng)}`, c.out);
}

const slot: Slot = {
  id: 'mart',
  query: '대형마트',
  stopKind: 'category',
  candidates: fx.candidates.map(c => ({ id: c.id, name: c.name, coord: { latitude: c.lat, longitude: c.lng } })),
  dwellMin: fx.dwellMin,
  count: 1,
  flexible: true,
  openNow: false,
};
const input = (): PlanInput => ({
  origin: O, destination: D, departAtMin: fx.departAtMin, mode: 'transit', slots: [slot], order: 'auto',
});

/** 출발(11:03)보다 앞선 '지금' — departAtIso 가 미래 시각을 싣도록 */
const now = () => new Date(2026, 8, 17, 10, 0, 0);

/** 실측 표를 그대로 돌려주는 /transit 스텁. 표에 없는 구간은 404 — 지어내지 않는다 */
function stubServer() {
  const asked: string[] = [];
  const missed: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string) as { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } };
    const k = `${key(b.origin.lat, b.origin.lng)}>${key(b.destination.lat, b.destination.lng)}`;
    asked.push(k);
    const hit = measured.get(k);
    if (!hit) {
      missed.push(k);
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        provider: 'fixture', source: 'provider',
        itineraries: [{ durationMin: hit.durationMin, distanceM: Math.round(hit.distanceKm * 1000), legs: [] }],
      }),
    } as Response;
  }) as unknown as typeof fetch;
  const provider = transitRouteProvider({
    baseUrl: 'https://fixture.test', appToken: 'T', deviceId: 'dev', fetchFn, now, estimate: mockRouteProvider(),
  });
  return { provider, asked, missed };
}

test('실측 구간을 넣으면 1위가 하나로마트로 바뀐다 — 추정은 홈플러스를 골랐다', async () => {
  const { provider, asked, missed } = stubServer();
  const r = await plan(input(), provider);

  assert.deepEqual(missed, [], '실측 표에 없는 구간을 물었다 — 스텁이 추정으로 새고 있다');
  assert.equal(r.options[0].visits[0].candidate.name, '영등포농협 하나로마트 당산역점');
  // 7.1 + 체류 15 + 22.5
  assert.ok(Math.abs(r.options[0].totalMin - 44.6) < 0.05, `총 ${r.options[0].totalMin}분`);
  assert.equal(r.timingSource, 'provider', '구간이 전부 실측이면 직행만 실측이 아니다');
  // 직행 1 + 시드 4안 × 구간 2개 = 9
  assert.equal(asked.length, 9);
  assert.ok(asked.length <= TRANSIT_CALL_BUDGET, `예산 ${TRANSIT_CALL_BUDGET} 초과: ${asked.length}`);
});

test('같은 후보를 추정으로만 재면 홈플러스가 1위다 — 실측이 뒤집은 것이 이 순위다', async () => {
  const r = await plan(input(), mockRouteProvider());
  assert.equal(r.options[0].visits[0].candidate.name, '홈플러스익스프레스 당산점');
  assert.equal(r.timingSource, 'estimate');
});

test('구간마다 실측한 순위 = 스파이크의 실측 순위', async () => {
  const { provider } = stubServer();
  const r = await plan(input(), provider);
  const byTime = [...r.alternatives].sort((a, b) => a.addedMin - b.addedMin).map(a => a.candidate.name);
  assert.deepEqual([r.options[0].visits[0].candidate.name, ...byTime], [
    '영등포농협 하나로마트 당산역점',
    '홈플러스익스프레스 당산점',
    'GS더프레시 선유도역점',
    '이마트 목동점',
  ]);
  assert.ok(r.alternatives.every(a => !a.estimated), '네 후보 모두 실측이라 추정 표시가 없어야 한다');
});
