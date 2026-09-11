import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAP_BYTES, KEEP_DAYS, fileNameFor, isTrackFile, overCap, pruneList, serialize } from './trackLogFormat.ts';

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
