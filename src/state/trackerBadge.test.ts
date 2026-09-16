import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackerBadge } from './trackerBadge';

const base = { mode: 'driving' as const, hasPosition: true, etaDeltaMin: 0, crossTrackText: '120m' };

test('추적이 꺼져 있으면 뱃지를 그리지 않는다 — 회색 점은 고장으로 읽힌다', () => {
  assert.equal(trackerBadge({ ...base, mode: 'off', status: 'moving' }), null);
});

test('우회는 도착 지연을 라벨에 싣는다 — 이게 추적기의 존재 이유다', () => {
  const b = trackerBadge({ ...base, status: 'detour', etaDeltaMin: 7 });
  assert.equal(b?.label, '우회 중 · 도착 +7분');
  assert.equal(b?.tone, 'warn');
});

test("'확인 중'은 앰버가 아니다 — 잠깐 스쳐가는 상태에 경고색을 쓰면 진짜 경고를 안 믿는다", () => {
  assert.equal(trackerBadge({ ...base, status: 'suspect' })?.tone, 'idle');
  assert.equal(trackerBadge({ ...base, status: 'idle' })?.tone, 'idle');
});

test('경로에서 떨어지면 왜 멈춰 있는지 설명한다', () => {
  const b = trackerBadge({ ...base, status: 'faraway', crossTrackText: '2.4km' });
  assert.equal(b?.tone, 'warn');
  assert.match(b?.note ?? '', /경로까지 2\.4km/);
});

test('정상 상태에는 note 를 달지 않는다 — 빈 자리를 잡아두면 카드가 들쭉날쭉해진다', () => {
  for (const status of ['moving', 'stalled', 'idle', 'suspect', 'offroute'] as const) {
    assert.equal(trackerBadge({ ...base, status })?.note, null, status);
  }
});

test('위치가 아직 없으면 모드에 맞게 기다린다고 말한다', () => {
  assert.equal(trackerBadge({ ...base, hasPosition: false, mode: 'live', status: 'idle' })?.label, 'GPS 기다리는 중');
  assert.equal(trackerBadge({ ...base, hasPosition: false, status: 'idle' })?.label, '위치 대기 중');
});

test('모든 상태가 뱃지를 낸다 — 빠뜨리면 카드에 구멍이 생긴다', () => {
  for (const status of ['idle', 'moving', 'stalled', 'suspect', 'detour', 'offroute', 'faraway'] as const) {
    assert.ok(trackerBadge({ ...base, status })?.label, status);
  }
});

test('바 색은 상태가 아니라 신뢰도를 말한다 — 안 그러면 경고 세기가 진행률에 종속된다', () => {
  // 100% 지점에서 이탈하면 앰버가 카드를 덮고, 5% 지점이면 같은 경고가 거의 안 보인다
  assert.equal(trackerBadge({ ...base, status: 'offroute' })?.progressTrusted, false);
  assert.equal(trackerBadge({ ...base, status: 'faraway' })?.progressTrusted, false);
  assert.equal(trackerBadge({ ...base, hasPosition: false, status: 'idle' })?.progressTrusted, false);
  // 우회는 경로를 벗어난 게 아니다 — 경고이지만 진행률은 유효하다
  assert.equal(trackerBadge({ ...base, status: 'detour', etaDeltaMin: 5 })?.progressTrusted, true);
  assert.equal(trackerBadge({ ...base, status: 'moving' })?.progressTrusted, true);
  assert.equal(trackerBadge({ ...base, status: 'stalled' })?.progressTrusted, true);
});
