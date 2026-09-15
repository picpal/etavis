import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introCopy, rationaleCopy, timingCopy } from './timingCopy';

test('실측이면 약 없음·배너 없음·판정 함', () => {
  assert.deepEqual(timingCopy('provider', 'car'), { approx: '', banner: null, showVerdict: true });
});

test('실측이라도 leg 하나가 추정이면 약은 붙고 판정은 한다 — 자동차 교체 시트의 기존 동작', () => {
  assert.deepEqual(timingCopy('provider', 'car', true), { approx: '약 ', banner: null, showVerdict: true });
});

test('추정이면 약·배너·판정 안 함 — 배너는 모드별', () => {
  assert.deepEqual(timingCopy('estimate', 'transit'), { approx: '약 ', banner: '소요시간은 추정이에요 · 배차·환승 미반영', showVerdict: false });
  assert.deepEqual(timingCopy('estimate', 'walk'), { approx: '약 ', banner: '소요시간은 추정이에요 · 거리 기준', showVerdict: false });
  assert.deepEqual(timingCopy('estimate', 'car'), { approx: '약 ', banner: '소요시간은 추정이에요 · 서버 연결 전', showVerdict: false });
});

test('출처를 모르면 추정으로 본다 — 목 데이터셋', () => {
  assert.equal(timingCopy(undefined, 'car').showVerdict, false);
  assert.equal(timingCopy(undefined, 'car').approx, '약 ');
});

test('직행만 실측(provider_direct_only) — 약·전용 배너·판정 안 함', () => {
  assert.deepEqual(timingCopy('provider_direct_only', 'transit'), { approx: '약 ', banner: '직행은 시간표 조회 · 경유 추가시간은 추정', showVerdict: false });
});

test('입력 화면 안내 — 대중교통은 직행 실측 사실을 말한다', () => {
  assert.equal(introCopy('transit'), '대중교통 직행은 시간표 기준 · 경유지 추가시간은 아직 추정이에요');
  assert.equal(introCopy('walk'), '도보 시간은 아직 추정이에요 · 도착 시각은 참고만');
  assert.equal(introCopy('car'), '직선거리가 아니라 실제 소요시간으로 계산해요');
});

test('1안 근거 — 직행만 실측', () => {
  assert.equal(rationaleCopy('provider_direct_only', 3), '직행은 실측, 경유는 추정으로 계산한 경로예요');
});

test('1안 근거 — 실측이면 횟수, 추정이면 실측 전', () => {
  assert.equal(rationaleCopy('provider', 9), '실측 9회로 확인한 경로예요.');
  assert.equal(rationaleCopy('estimate', 9), '추정으로 계산한 경로예요 · 실측 전');
});
