import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestStopsFromChips } from './planRequest';
import type { IntentChip } from './plan';

const stop = (over: Partial<Extract<IntentChip, { kind: 'stop' }>> = {}): IntentChip => ({
  id: 's-1',
  kind: 'stop',
  label: '약국',
  queries: ['약국'],
  stopKind: 'category',
  openNow: false,
  flexible: true,
  ...over,
});

test('openNow 가 슬롯까지 내려간다 — "문 연 약국"의 \'문 연\'이 여기서 죽으면 안 된다', () => {
  const [s] = requestStopsFromChips([stop({ openNow: true })]);
  assert.equal(s.openNow, true);
});

test('flexible=false 가 슬롯까지 내려간다 — 특정 지점 고정은 최적화 대상에서 빠져야 한다', () => {
  const [s] = requestStopsFromChips([stop({ flexible: false, stopKind: 'specific' })]);
  assert.equal(s.flexible, false);
  assert.equal(s.stopKind, 'specific');
});

test('검색어는 첫 후보를 쓴다', () => {
  const [s] = requestStopsFromChips([stop({ queries: ['우체국', '편의점'] })]);
  assert.deepEqual(s.queries, ['우체국']);
});

test('count 는 항상 1 — 개수는 APPLY_INTENT 가 칩을 복제해 표현한다', () => {
  const slots = requestStopsFromChips([stop({ id: 's-1' }), stop({ id: 's-2' })]);
  assert.deepEqual(slots.map(s => s.count), [1, 1]);
  assert.deepEqual(slots.map(s => s.id), ['s-1', 's-2']);
});

test('경유지가 아닌 칩은 빠진다', () => {
  const chips: IntentChip[] = [
    stop(),
    { id: 'a-1', kind: 'arriveBy', label: '21:00까지', value: 1260 },
  ];
  assert.equal(requestStopsFromChips(chips).length, 1);
});

/* 옛 상태 방어 — 칩에 필드가 없던 시절의 값이 남아 있을 수 있다 */

test('필드가 없는 옛 칩은 기본값으로 떨어진다 — 없다고 계산이 멈추면 안 된다', () => {
  const legacy = { id: 's-9', kind: 'stop', label: '약국', queries: ['약국'] } as unknown as IntentChip;
  const [s] = requestStopsFromChips([legacy]);
  assert.equal(s.flexible, true, '기본은 유연 — 최적화 대상에 넣는다');
  assert.equal(s.openNow, false, '기본은 영업시간 무관 — 없는 조건을 지어내지 않는다');
  assert.equal(s.stopKind, 'category', '업종으로 본다 — 보강이 도는 쪽이 기본');
});

test('빈 칩 목록이면 빈 슬롯', () => {
  assert.deepEqual(requestStopsFromChips([]), []);
});

/* 이 테스트는 NARROW_STOP 을 검증하지 않는다 — 그 좁히기 규칙(queries/narrowed 변경)은
   narrowStopChips(chips.test.ts) 가 검증한다. 여기서는 좁혀진 모양의 칩 —
   queries: [고른 값] 하나, stopKind: 'category' 그대로, narrowed: true — 을 손으로
   만들어, 그 모양이 requestStopsFromChips 를 거쳐 검색 파이프라인 슬롯까지 그대로
   내려가는 것만 본다. stopKind 는 좁히기로 바뀌지 않는다 — runPlan.ts 의 보강·트렌드
   스왑이 계속 이 슬롯에 돌아야 하기 때문이다. narrowed 는 슬롯에서 읽는 곳이 없어
   여기로 넘어가지 않는다. */

test('좁혀진 모양의 칩(queries 한 개·stopKind는 category 유지) — 검색어가 그대로 내려간다', () => {
  const narrowed = stop({ queries: ['파리바게뜨'], stopKind: 'category', narrowed: true });
  const [s] = requestStopsFromChips([narrowed]);
  assert.deepEqual(s.queries, ['파리바게뜨']);
  assert.equal(s.stopKind, 'category');
});

/* why — 추출이 잡은 용무. '옷수선 맡기고'의 '맡기고'가 여기서 죽으면, 수선집을
   찾아 주고도 무엇을 하러 가는지는 화면 어디에도 안 남는다. openNow 와 같은
   종류의 누수(받을 쪽은 준비돼 있는데 값이 안 온다)라 같은 자리에 묶어 둔다 */

test('why 가 슬롯까지 내려간다 — 장소가 정해지면 그 경유지의 할 일이 된다', () => {
  const [s] = requestStopsFromChips([stop({ queries: ['옷수선', '수선집'], why: '옷 수선 맡기기' })]);
  assert.equal(s.why, '옷 수선 맡기기');
});

test('빈 why 는 내려가지 않는다 — 글자 없는 할 일 한 줄을 만들면 안 된다', () => {
  assert.equal(requestStopsFromChips([stop()])[0].why, undefined);
  assert.equal(requestStopsFromChips([stop({ why: '' })])[0].why, undefined);
  assert.equal(requestStopsFromChips([stop({ why: '   ' })])[0].why, undefined);
});

test('requestStopsFromChips — 칩의 검색어 후보를 전부 나르고 업종어로 넓힌다', () => {
  const chips = [
    { id: 'c1', kind: 'stop' as const, label: '샌드위치 파는 카페', queries: ['샌드위치 파는 카페'],
      flexible: true, openNow: false, stopKind: 'category' as const, why: '샌드위치 사기' },
  ];
  const [s] = requestStopsFromChips(chips as never);
  assert.deepEqual(s.queries, ['샌드위치 파는 카페', '카페']);
});
