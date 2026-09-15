import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOOGLE_FIELD_MASK, googleTransitBody, normalizeGoogleTransit } from './transitGoogle';
import type { TransitRequest } from './transitTypes';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/google-transit-sinjeong.json', import.meta.url), 'utf8'));
const req: TransitRequest = { origin: { lat: 37.5246, lng: 126.8607 }, destination: { lat: 37.5295, lng: 126.9187 }, departAt: '2026-09-16T00:30:00.000Z', alternatives: 3, preferSubway: false };

test('요청 본문 — TRANSIT, 대안 요청, 한국어, 출발시각', () => {
  const b = googleTransitBody(req) as Record<string, unknown>;
  assert.equal(b.travelMode, 'TRANSIT');
  assert.equal(b.computeAlternativeRoutes, true);
  assert.equal(b.languageCode, 'ko');
  assert.equal(b.departureTime, '2026-09-16T00:30:00.000Z');
  assert.deepEqual(b.origin, { location: { latLng: { latitude: 37.5246, longitude: 126.8607 } } });
  assert.equal('transitPreferences' in b, false);
});

test('요청 본문 — preferSubway 면 SUBWAY·TRAIN 만, departAt 없으면 departureTime 없음', () => {
  const b = googleTransitBody({ ...req, departAt: undefined, preferSubway: true }) as Record<string, unknown>;
  assert.deepEqual(b.transitPreferences, { allowedTravelModes: ['SUBWAY', 'TRAIN'] });
  assert.equal('departureTime' in b, false);
});

test('필드마스크 — 정류장·시각을 받는 데 필요한 필드만', () => {
  for (const f of ['routes.duration', 'routes.distanceMeters', 'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration', 'routes.legs.steps.distanceMeters', 'routes.legs.steps.transitDetails']) {
    assert.ok(GOOGLE_FIELD_MASK.split(',').includes(f), f);
  }
});

test('정규화 — 연속 WALK 합치기, transit leg 정류장·좌표·시각', () => {
  const r = normalizeGoogleTransit(fixture, { ...req, alternatives: 3 });
  assert.ok(r.ok);
  const it = r.itineraries;
  // 중복 정류장 열(0·1번)은 빠른 1번만 → 총 2개, 빠른 순
  assert.equal(it.length, 2);
  assert.equal(it[0].durationMin, 23.6);
  assert.equal(it[1].durationMin, 40.1);
  assert.equal(it[0].distanceM, 7218);
  // 1번 경로: walk(382s→6.4분, 379m) · 5호선 · walk · 9호선 · walk
  assert.deepEqual(it[0].legs.map(l => l.kind), ['walk', 'transit', 'walk', 'transit', 'walk']);
  const w0 = it[0].legs[0];
  assert.ok(w0.kind === 'walk');
  assert.equal(w0.durationMin, 6.4);
  assert.equal(w0.distanceM, 379);
  const t0 = it[0].legs[1];
  assert.ok(t0.kind === 'transit');
  assert.equal(t0.mode, 'SUBWAY');
  assert.equal(t0.line, '5호선');
  assert.equal(t0.from.name, '목동');
  assert.equal(t0.to.name, '여의도');
  assert.equal(t0.from.lat, 37.526097);
  assert.equal(t0.from.lng, 126.864538);
  assert.equal(t0.stops, 6);
  assert.equal(t0.departAt, '2026-09-16T00:47:00Z'); // 1번 경로의 열차
  const t1 = it[0].legs[3];
  assert.ok(t1.kind === 'transit');
  assert.equal(t1.line, '9호선');
  assert.equal(t1.to.name, '국회의사당');
  // 2번 경로: 버스는 BUS
  const bus = it[1].legs.filter(l => l.kind === 'transit')[1];
  assert.ok(bus.kind === 'transit');
  assert.equal(bus.mode, 'BUS');
  assert.equal(bus.line, '10');
});

test('정규화 — alternatives 로 자른다', () => {
  const r = normalizeGoogleTransit(fixture, { ...req, alternatives: 1 });
  assert.ok(r.ok && r.itineraries.length === 1 && r.itineraries[0].durationMin === 23.6);
});

test('정규화 — routes 없음은 none, 모양이 다르면 shape', () => {
  assert.deepEqual(normalizeGoogleTransit({ routes: [] }, req), { ok: false, code: 'none', msg: 'routes 없음' });
  assert.equal(normalizeGoogleTransit(null, req).ok, false);
  assert.equal((normalizeGoogleTransit({ routes: [{ duration: '10s', legs: 'x' }] }, req) as { code: string }).code, 'shape');
});

test('정규화 — transit 정류장에 좌표가 없으면 shape (앵커에 못 쓴다)', () => {
  const broken = JSON.parse(JSON.stringify(fixture));
  delete broken.routes[1].legs[0].steps[5].transitDetails.stopDetails.departureStop.location;
  const r = normalizeGoogleTransit(broken, req);
  assert.equal(r.ok, false);
});
