import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractAnchors } from './anchors.ts';
import type { TransitItinerary } from './types.ts';

// 픽스처는 readFileSync 로 읽는다 — transitProvider.test.ts 와 같은 방식
const fixture = JSON.parse(readFileSync(new URL('./fixtures/transit-sinjeong.json', import.meta.url), 'utf8')) as { itineraries: TransitItinerary[] };

const O = { latitude: 37.5188, longitude: 126.8575 }; // 신정동 1000-10
const D = { latitude: 37.5285, longitude: 126.9187 }; // 현대카드빌딩 2관

const first = fixture.itineraries[0];

test('환승 1회 — 출발지·승차·환승·하차·목적지 5개', () => {
  const a = extractAnchors(first, O, D);
  assert.deepEqual(a.map(x => x.kind), ['origin', 'board', 'transfer', 'alight', 'destination']);
  assert.deepEqual(a.map(x => x.name), ['출발지', '목동', '여의도', '국회의사당', '목적지']);
  assert.deepEqual(a.map(x => x.id), ['a0', 'a1', 'a2', 'a3', 'a4']);
  // 같은 역에서 갈아타면 정류장이 두 번 나오지만 앵커는 하나다
  assert.equal(a.filter(x => x.name === '여의도').length, 1);
});

test('progressM — 0에서 시작해 단조 증가한다', () => {
  const a = extractAnchors(first, O, D);
  assert.equal(a[0].progressM, 0);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].progressM > a[i - 1].progressM, `${i}번 앵커가 뒤로 갔다`);
});

test('환승 없음 — 승차·하차만', () => {
  const it: TransitItinerary = {
    durationMin: 20, distanceM: 5000,
    legs: [
      { kind: 'walk', durationMin: 5, distanceM: 300 },
      { kind: 'transit', mode: 'SUBWAY', line: '5호선',
        from: { name: '목동', lat: 37.526097, lng: 126.864538 },
        to: { name: '여의도', lat: 37.521624, lng: 126.924221 },
        durationMin: 11, stops: 6, departAt: null, arriveAt: null },
      { kind: 'walk', durationMin: 4, distanceM: 200 },
    ],
  };
  assert.deepEqual(extractAnchors(it, O, D).map(x => x.kind), ['origin', 'board', 'alight', 'destination']);
});

test('대중교통 구간이 없으면 출발지·목적지뿐', () => {
  const it: TransitItinerary = { durationMin: 12, distanceM: 900, legs: [{ kind: 'walk', durationMin: 12, distanceM: 900 }] };
  assert.deepEqual(extractAnchors(it, O, D).map(x => x.kind), ['origin', 'destination']);
});

test('이름이 달라도 200m 안이면 한 환승역', () => {
  const it: TransitItinerary = {
    durationMin: 30, distanceM: 6000,
    legs: [
      { kind: 'transit', mode: 'SUBWAY', line: '5호선',
        from: { name: '목동', lat: 37.526097, lng: 126.864538 },
        to: { name: '여의도', lat: 37.521624, lng: 126.924221 },
        durationMin: 11, stops: 6, departAt: null, arriveAt: null },
      { kind: 'transit', mode: 'SUBWAY', line: '9호선',
        from: { name: '여의도역 9호선', lat: 37.52165, lng: 126.92430 }, // 같은 역, 다른 이름·8m
        to: { name: '국회의사당', lat: 37.528143, lng: 126.917856 },
        durationMin: 1, stops: 1, departAt: null, arriveAt: null },
    ],
  };
  assert.deepEqual(extractAnchors(it, O, D).map(x => x.kind), ['origin', 'board', 'transfer', 'alight', 'destination']);
});
