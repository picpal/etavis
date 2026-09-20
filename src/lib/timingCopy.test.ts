import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxOf, classOf, deltaCopy, introCopy, rationaleCopy, timingCopy } from './timingCopy';

test('실측이면 약 없음·배너 없음·판정 함', () => {
  assert.deepEqual(timingCopy('provider', 'car'), { approx: '', banner: null, showVerdict: true });
});

test('실측(provider)이라도 구간 하나가 추정이면 판정하지 않는다 — 추정 위의 여유는 거짓 정밀도다', () => {
  // 예전엔 '약'을 붙이고도 판정을 했다. +8분 추정이 실제 +15분이면 "3분 여유"가 늦음이 된다 —
  // 파일 머리말이 금하는 바로 그 일이고, runPlan 의 트렌드 스왑도 같은 이유로 추정 위 스왑을 거부한다
  assert.deepEqual(timingCopy('provider', 'car', { legEstimated: true }), { approx: '약 ', banner: '바꾼 매장 구간은 추정이에요', showVerdict: false });
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

test('입력 화면 안내 — 계산 전에 뜨는 줄이라 출처가 아니라 앱이 하는 일을 말한다', () => {
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

test('구간마다 실측(provider_legs) — 숫자는 그대로·배너로 미반영을 말하고·판정은 안 한다', () => {
  // 구간은 진짜로 쟀다. '약'을 붙이면 실측을 추정이라 말하는 것이다.
  // 다만 2구간 이후가 계획 출발 시각으로 조회돼(체류 뒤 배차가 다르다) 판정은 못 한다
  assert.deepEqual(timingCopy('provider_legs', 'transit'), {
    approx: '', banner: '구간마다 시간표 조회 · 체류 뒤 배차는 미반영', showVerdict: false,
  });
});

test('1안 근거 — 구간마다 실측은 실측 횟수를 말하되 한 번에 잰 것과 구분한다', () => {
  assert.equal(rationaleCopy('provider_legs', 9), '구간마다 실측 9회로 확인한 경로예요');
});

test('입력 화면 안내 — 대중교통도 이제 구간마다 조회한다', () => {
  assert.equal(introCopy('transit'), '구간마다 시간표를 조회해 실제 소요시간으로 계산해요');
});

test('구간 실측(provider_legs)이라도 바꾼 구간이 추정이면 약이 붙고 배너가 그걸 말하고 판정은 없다', () => {
  // 2026-09-20 관측: CU 를 바꾸자 23:47 → 23:15 가 '약' 없이, 배너는 "구간마다 시간표 조회" 그대로,
  // 버튼은 "23:15 도착 경로로 계속". 지어낸 숫자가 실측인 척 확정까지 흘렀다
  assert.deepEqual(timingCopy('provider_legs', 'transit', { legEstimated: true }), {
    approx: '약 ', banner: '구간마다 시간표 조회 · 바꾼 매장 구간은 추정', showVerdict: false,
  });
});

test('추정 등급은 legEstimated 가 있어도 문구가 안 바뀐다 — 이미 약·판정 없음이라 더 낮출 게 없다', () => {
  assert.deepEqual(timingCopy('provider_direct_only', 'transit', { legEstimated: true }), timingCopy('provider_direct_only', 'transit'));
  assert.deepEqual(timingCopy('estimate', 'walk', { legEstimated: true }), timingCopy('estimate', 'walk'));
  assert.deepEqual(timingCopy(undefined, 'car', { legEstimated: true }), timingCopy(undefined, 'car'));
});

test('deltaCopy — 실측은 부호 그대로, 추정은 약, 3분 미만 추정은 비슷해요, 실측 0은 같아요', () => {
  assert.equal(deltaCopy({ min: 7, cls: 'measured' }), '+7분');
  assert.equal(deltaCopy({ min: -3, cls: 'measured' }), '−3분');
  assert.equal(deltaCopy({ min: 0, cls: 'measured' }), '같아요');
  assert.equal(deltaCopy({ min: 2.4, cls: 'estimated' }), '비슷해요');
  assert.equal(deltaCopy({ min: -2, cls: 'estimated' }), '비슷해요');
  assert.equal(deltaCopy({ min: 6, cls: 'estimated' }), '약 +6분');
  assert.equal(deltaCopy({ min: -32, cls: 'estimated' }), '약 −32분');
});

test('값 등급 → 약 · 계획 등급 → 값 등급 — 실측은 provider·provider_legs 둘뿐이다', () => {
  assert.equal(approxOf('estimated'), '약 ');
  assert.equal(approxOf('measured'), '');
  assert.equal(classOf('provider'), 'measured');
  assert.equal(classOf('provider_legs'), 'measured');
  // 직행만 실측의 경유 추가시간은 추정이다
  assert.equal(classOf('provider_direct_only'), 'estimated');
  assert.equal(classOf('estimate'), 'estimated');
  assert.equal(classOf(undefined), 'estimated');
});

test('재는 동안은 배너에 조회 중이 붙고 끝나면 실측 행으로 올라간다 — 없는 조회를 말하지 않는다', () => {
  // 6단계: 고르면 바뀐 두 구간만 다시 잰다(`measureSwap`). 재는 동안 사용자가 보는 것은
  // "추정인데 지금 알아보는 중"이고, 응답이 오면 `legEstimated` 가 내려가 배너 자체가 사라진다.
  assert.deepEqual(timingCopy('provider_legs', 'transit', { legEstimated: true, measuring: true }), {
    approx: '약 ', banner: '구간마다 시간표 조회 · 바꾼 매장 구간은 추정 · 시간표 조회 중', showVerdict: false,
  });
  assert.deepEqual(timingCopy('provider', 'transit', { legEstimated: true, measuring: true }), {
    approx: '약 ', banner: '바꾼 매장 구간은 추정이에요 · 시간표 조회 중', showVerdict: false,
  });
  // 응답이 온 뒤 — 호출부가 measuring 을 끄기 전에 legEstimated 가 먼저 내려와도 조회 중이 남으면 안 된다
  assert.deepEqual(timingCopy('provider_legs', 'transit', { legEstimated: false, measuring: true }), {
    approx: '', banner: '구간마다 시간표 조회 · 체류 뒤 배차는 미반영', showVerdict: false,
  });
  assert.deepEqual(timingCopy('provider', 'transit', { legEstimated: false, measuring: true }), {
    approx: '', banner: null, showVerdict: true,
  });
});

test('재는 동안에도 판정은 꺼져 있다 — 조회 중은 아직 모른다는 뜻이지 알았다는 뜻이 아니다', () => {
  assert.equal(timingCopy('provider', 'car', { legEstimated: true, measuring: true }).showVerdict, false);
});

test('시간표는 대중교통에만 있다 — 자동차·도보는 다시 재는 중이다', () => {
  // '시간표 조회 중'을 자동차 경로에 쓰면 맞는 등급을 틀린 근거로 말하게 된다
  assert.equal(
    timingCopy('provider', 'car', { legEstimated: true, measuring: true }).banner,
    '바꾼 매장 구간은 추정이에요 · 다시 재는 중',
  );
  assert.equal(
    timingCopy('provider', 'walk', { legEstimated: true, measuring: true }).banner,
    '바꾼 매장 구간은 추정이에요 · 다시 재는 중',
  );
});
