import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAP_BYTES, KEEP_DAYS, fileNameFor, isTrackFile, overCap, pruneList, serialize,
  shouldLogFix, shouldLogGeofence, type GeofenceMark,
} from './trackLogFormat.ts';

test('파일명은 로컬 날짜 기준 track-YYYYMMDD.jsonl', () => {
  // 로컬 자정 직후 — UTC로 바꾸면 전날이 될 수 있는 시각
  const d = new Date(2026, 8, 11, 0, 10);
  assert.equal(fileNameFor(d), 'track-20260911.jsonl');
  assert.equal(fileNameFor(new Date(2026, 0, 5)), 'track-20260105.jsonl');
});

test('isTrackFile은 우리 파일만 고른다', () => {
  assert.equal(isTrackFile('track-20260911.jsonl'), true);
  assert.equal(isTrackFile('track-export.jsonl'), false);
  assert.equal(isTrackFile('notes.txt'), false);
});

test('pruneList: 7일보다 오래된 파일만 지운다 (오늘 포함 7일 보관)', () => {
  const today = new Date(2026, 8, 11);
  const names = [
    'track-20260911.jsonl',
    'track-20260905.jsonl', // 6일 전 — 남는다
    'track-20260904.jsonl', // 7일 전 — 지운다
    'track-20260801.jsonl',
    'other.txt',
  ];
  assert.deepEqual(pruneList(names, today), ['track-20260904.jsonl', 'track-20260801.jsonl']);
  assert.equal(KEEP_DAYS, 7);
});

test('serialize: t와 k가 앞에 오고 한 줄 JSON + 개행', () => {
  const now = new Date(2026, 8, 11, 9, 41, 3, 120);
  const line = serialize({ k: 'fix', lat: 37.5, lng: 126.9, acc: 30, spd: null, src: 'fg' }, now);
  assert.ok(line.endsWith('\n'));
  const obj = JSON.parse(line);
  assert.equal(obj.k, 'fix');
  assert.equal(obj.src, 'fg');
  assert.equal(obj.spd, null);
  assert.ok(obj.t.startsWith('2026-09-11T09:41:03.120'));
  // 로컬 오프셋이 붙는다 (+09:00 같은 형태). Z가 아니다
  assert.match(obj.t, /[+-]\d{2}:\d{2}$/);
  assert.deepEqual(Object.keys(obj).slice(0, 2), ['t', 'k']);
});

test('overCap: 2MB 이상이면 true', () => {
  assert.equal(CAP_BYTES, 2 * 1024 * 1024);
  assert.equal(overCap(CAP_BYTES - 1), false);
  assert.equal(overCap(CAP_BYTES), true);
  assert.equal(overCap(10, 5), true);
});

test('act 이벤트는 t·r·k·a·d 순서로 직렬화된다', () => {
  const line = serialize(
    { k: 'act', a: 'cand.replace', d: { slot: 's-1', from: '파리바게뜨 A', to: '뚜레쥬르 B' } },
    new Date(2026, 8, 13, 10, 31, 5),
    'r7k2',
  );
  const o = JSON.parse(line);
  assert.deepEqual(Object.keys(o), ['t', 'r', 'k', 'a', 'd']);
  assert.equal(o.r, 'r7k2');
  assert.equal(o.a, 'cand.replace');
  assert.equal(o.d.to, '뚜레쥬르 B');
  assert.ok(line.endsWith('\n'));
});

test('runId 가 없으면 r 필드를 아예 넣지 않는다 — 계획 시작 전 이벤트', () => {
  const o = JSON.parse(serialize({ k: 'act', a: 'dest.set', d: { name: '회사' } }, new Date(), null));
  assert.equal('r' in o, false);
  assert.equal(o.a, 'dest.set');
});

test('net 이벤트는 호출 한 번을 남긴다', () => {
  const o = JSON.parse(serialize(
    { k: 'net', ep: '/enrich', ms: 3690, ok: true, d: { places: 30, signals: 5 } },
    new Date(), 'r1',
  ));
  assert.equal(o.k, 'net');
  assert.equal(o.ep, '/enrich');
  assert.equal(o.ms, 3690);
  assert.equal(o.ok, true);
  assert.equal(o.d.signals, 5);
});

test('d 가 없으면 d 필드를 넣지 않는다 — 빈 객체로 줄을 늘리지 않는다', () => {
  const o = JSON.parse(serialize({ k: 'act', a: 'endpoints.swap' }, new Date(), 'r1'));
  assert.equal('d' in o, false);
});

test('기존 이벤트도 runId 를 받는다 — 어느 계획 소속인지 갈린다', () => {
  const o = JSON.parse(serialize(
    { k: 'notify', kind: 'arrival', id: 's-1' }, new Date(), 'r9',
  ));
  assert.equal(o.r, 'r9');
  assert.equal(o.kind, 'arrival');
});

const mark = (lat: number, lng: number, at: number) => ({ lat, lng, atMs: at });

test('같은 자리에 서 있으면 fix 를 건너뛴다 — 5초마다 같은 좌표가 쌓이던 것', () => {
  const prev = mark(37.5, 127.0, 1_000);
  assert.equal(shouldLogFix(prev, mark(37.5, 127.0, 6_000)), false);
});

test('첫 fix 는 항상 남긴다', () => {
  assert.equal(shouldLogFix(null, mark(37.5, 127.0, 0)), true);
});

test('15m 넘게 움직이면 남긴다', () => {
  const prev = mark(37.5, 127.0, 1_000);
  // 위도 0.0002도 ≈ 22m
  assert.equal(shouldLogFix(prev, mark(37.5002, 127.0, 2_000)), true);
  // 0.00005도 ≈ 5.5m — 아직 아니다
  assert.equal(shouldLogFix(prev, mark(37.50005, 127.0, 2_000)), false);
});

test('안 움직여도 30초가 지나면 남긴다 — 멈춰 있다는 사실도 정보다', () => {
  const prev = mark(37.5, 127.0, 1_000);
  assert.equal(shouldLogFix(prev, mark(37.5, 127.0, 31_500)), true);
});

const gmark = (o: Partial<GeofenceMark> = {}): GeofenceMark =>
  ({ target: 's-1', atStop: false, hasEvents: false, atMs: 1_000, ...o });

test('geofence 는 판정이 일어난 순간(events)이면 무조건 남긴다', () => {
  assert.equal(shouldLogGeofence(gmark(), gmark({ hasEvents: true, atMs: 1_100 })), true);
});

test('geofence 는 atStop 이 바뀌면 남긴다', () => {
  assert.equal(shouldLogGeofence(gmark(), gmark({ atStop: true, atMs: 1_100 })), true);
});

test('geofence 는 target 이 바뀌면 남긴다 — 다음 경유지로 넘어간 순간', () => {
  assert.equal(shouldLogGeofence(gmark(), gmark({ target: 's-2', atMs: 1_100 })), true);
});

test('geofence 는 아무것도 안 바뀌면 30초에 한 번만', () => {
  assert.equal(shouldLogGeofence(gmark(), gmark({ atMs: 5_000 })), false);
  assert.equal(shouldLogGeofence(gmark(), gmark({ atMs: 31_500 })), true);
});
