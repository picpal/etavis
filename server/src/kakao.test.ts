import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kakaoDirectionsUrl, normalizeKakao } from './kakao';

const req = (n: number, departAt?: string) => ({
  points: Array.from({ length: n }, (_, i) => ({ lat: 37.5 + i * 0.01, lng: 127 + i * 0.01 })),
  mode: 'car' as const, departAt, polyline: false,
});

test('URL — origin/destination은 x,y(경도,위도), 경유지는 |로', () => {
  const u = new URL(kakaoDirectionsUrl(req(4)));
  assert.equal(u.pathname, '/v1/directions');
  assert.equal(u.searchParams.get('origin'), '127,37.5');
  assert.equal(u.searchParams.get('destination'), '127.03,37.53');
  assert.equal(u.searchParams.get('waypoints'), '127.01,37.51|127.02,37.52');
  assert.equal(u.searchParams.get('summary'), 'false');
});

test('URL — 경유지 없으면 waypoints 파라미터 없음', () => {
  const u = new URL(kakaoDirectionsUrl(req(2)));
  assert.equal(u.searchParams.has('waypoints'), false);
});

test('URL — departAt이 있으면 미래운행 엔드포인트', () => {
  const u = new URL(kakaoDirectionsUrl(req(2, '202609111230')));
  assert.equal(u.pathname, '/v1/future/directions');
  assert.equal(u.searchParams.get('departure_time'), '202609111230');
});

const okRaw = {
  routes: [{
    result_code: 0, result_msg: '길찾기 성공',
    sections: [
      { distance: 4000, duration: 600, roads: [{ vertexes: [127.0, 37.5, 127.01, 37.51] }] },
      { distance: 6000, duration: 900, roads: [{ vertexes: [127.01, 37.51, 127.02, 37.52] }] },
    ],
  }],
};

test('정규화 — 초·m를 분·km로, section 합이 total', () => {
  const r = normalizeKakao(okRaw, false);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.route.sections.length, 2);
  assert.equal(r.route.sections[0].durationMin, 10);
  assert.equal(r.route.sections[0].distanceKm, 4);
  assert.equal(r.route.durationMin, 25);
  assert.equal(r.route.distanceKm, 10);
  assert.deepEqual(r.route.polyline, []);
});

test('정규화 — polyline 요청 시 vertexes를 lat/lng로 편다', () => {
  const r = normalizeKakao(okRaw, true);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.route.polyline.length, 4);
  assert.deepEqual(r.route.polyline[0], { latitude: 37.5, longitude: 127.0 });
});

test('정규화 — result_code≠0은 실패로', () => {
  const r = normalizeKakao({ routes: [{ result_code: 104, result_msg: '출발지와 목적지가 5 m 이내' }] }, false);
  assert.deepEqual(r, { ok: false, code: 104, msg: '출발지와 목적지가 5 m 이내' });
});

test('정규화 — 모양이 다르면 shape', () => {
  assert.equal(normalizeKakao(null, false).ok, false);
  assert.equal(normalizeKakao({ routes: [] }, false).ok, false);
  assert.equal(normalizeKakao({ routes: [{ result_code: 0, sections: [] }] }, false).ok, false);
});
