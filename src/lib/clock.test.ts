import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHHMM, toMin } from './clock';

test('반올림을 먼저 한다 — 시를 내림하고 분만 반올림하면 599.7이 09:00이 된다', () => {
  assert.equal(toHHMM(599.7), '10:00');
  assert.equal(toHHMM(599.4), '09:59');
});

test('소수를 그대로 받는다 — 경로 계산은 25.716분 같은 값을 낸다', () => {
  assert.equal(toHHMM(491.468), '08:11');
  assert.equal(toHHMM(510.643), '08:31');
  assert.equal(toHHMM(521.056), '08:41');
});

test('시·분을 0으로 채운다 — 호출부마다 padStart 를 붙이던 걸 여기서 끝낸다', () => {
  assert.equal(toHHMM(65), '01:05');
  assert.equal(toHHMM(0), '00:00');
});

test('자정을 넘기면 다시 0시부터 — 날짜는 이 함수가 알 바가 아니다', () => {
  assert.equal(toHHMM(24 * 60), '00:00');
  assert.equal(toHHMM(25 * 60 + 30), '01:30');
});

test('toMin 은 0이 없는 표기도 받는다 — 옛 데이터에 8:11 이 남아 있다', () => {
  assert.equal(toMin('8:11'), 491);
  assert.equal(toMin('08:11'), 491);
});

test('toHHMM 과 toMin 은 분 단위에서 서로를 되돌린다', () => {
  for (const m of [0, 1, 59, 60, 491, 1439]) {
    assert.equal(toMin(toHHMM(m)), m, `${m}분`);
  }
});
