import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departureReminderSeconds, DEPARTURE_LEAD_MIN } from './dwellReminder';

test('체류가 끝나기 리드 시간 전에 울린다 — 20분 체류면 15분 뒤', () => {
  assert.equal(departureReminderSeconds(20, { compress: false }), (20 - DEPARTURE_LEAD_MIN) * 60);
});

test('체류가 리드 시간보다 짧으면 예약하지 않는다 — 도착하자마자 "5분 남았어요"는 거짓말이다', () => {
  assert.equal(departureReminderSeconds(DEPARTURE_LEAD_MIN, { compress: false }), null);
  assert.equal(departureReminderSeconds(3, { compress: false }), null);
});

test('이미 지난 만큼은 빼고 센다 — 도착 알림이 늦게 처리돼도 예약 시각이 밀리면 안 된다', () => {
  assert.equal(departureReminderSeconds(20, { compress: false, elapsedMin: 8 }), (20 - 8 - DEPARTURE_LEAD_MIN) * 60);
});

test('이미 리드 시간 안에 들어와 있으면 예약하지 않는다', () => {
  assert.equal(departureReminderSeconds(20, { compress: false, elapsedMin: 16 }), null);
});

test('가상 주행에서는 시간을 압축한다 — 실제 15분을 기다릴 수 없다', () => {
  const s = departureReminderSeconds(20, { compress: true });

  assert.ok(s != null && s > 0 && s <= 10, `압축된 값이어야 한다: ${s}`);
});

test('압축 모드에서도 너무 짧은 체류는 예약하지 않는다 — 규칙이 모드마다 다르면 안 된다', () => {
  assert.equal(departureReminderSeconds(3, { compress: true }), null);
});
