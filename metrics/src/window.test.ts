import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourWindow } from './window.ts';

test('직전 한 시간을 잡는다 — 지금 시간은 아직 안 끝났다', () => {
  // 05:03 에 돌면서 05:00~06:00 을 보고하면 3분치만 세고 나머지를 버린다.
  const w = hourWindow(new Date('2026-09-21T05:03:00Z'));
  assert.equal(w.from, '2026-09-21 04:00:00');
  assert.equal(w.to, '2026-09-21 05:00:00');
});

test('직전의 직전 시간도 준다 — 증감을 내려면 비교 대상이 있어야 한다', () => {
  const w = hourWindow(new Date('2026-09-21T05:03:00Z'));
  assert.equal(w.prevFrom, '2026-09-21 03:00:00');
});

test('라벨은 KST 다 — 워커는 UTC 로 도는데 보는 사람은 한국에 있다', () => {
  // 04:00~05:00 UTC = 13:00~14:00 KST
  assert.equal(hourWindow(new Date('2026-09-21T05:03:00Z')).label, '09-21 13:00~14:00');
});

test('자정을 넘는 구간도 KST 날짜로 맞게 적는다', () => {
  // 15:00~16:00 UTC = 09-22 00:00~01:00 KST — UTC 날짜(09-21)로 적으면 하루 어긋난다
  assert.equal(hourWindow(new Date('2026-09-21T16:20:00Z')).label, '09-22 00:00~01:00');
});

test('자정 직전 구간은 끝이 00:00 으로 적힌다', () => {
  // 14:00~15:00 UTC = 23:00~00:00 KST
  assert.equal(hourWindow(new Date('2026-09-21T15:20:00Z')).label, '09-21 23:00~00:00');
});

test('정각에 돌아도 직전 시간을 본다', () => {
  const w = hourWindow(new Date('2026-09-21T05:00:00Z'));
  assert.equal(w.from, '2026-09-21 04:00:00');
  assert.equal(w.to, '2026-09-21 05:00:00');
});

test('하루 구간은 직전 24시간이고 끝에도 날짜를 적는다', () => {
  // 09:00 UTC = 18:00 KST 에 도는 일일 리포트
  const w = hourWindow(new Date('2026-09-27T09:00:00Z'), 24);
  assert.equal(w.from, '2026-09-26 09:00:00');
  assert.equal(w.to, '2026-09-27 09:00:00');
  assert.equal(w.prevFrom, '2026-09-25 09:00:00');
  assert.equal(w.label, '09-26 18:00~09-27 18:00');
});
