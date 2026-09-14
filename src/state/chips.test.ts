import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncConditionChips } from './chips';
import type { IntentChip } from './plan';

let seq = 0;
const nextId = (k: 'm' | 'a') => `${k}-${seq++}`;
const stop = (id: string): IntentChip => ({
  id, kind: 'stop', label: '약국', queries: ['약국'], stopKind: 'category', openNow: false, flexible: true,
});
const modeChip = (id: string, v: 'car' | 'walk' | 'transit', label: string): IntentChip =>
  ({ id, kind: 'mode', label, value: v });

test('이동수단을 바꾸면 칩 라벨도 바뀐다 — 헤더와 칩이 다른 말을 하면 안 된다', () => {
  const out = syncConditionChips([modeChip('m-1', 'car', '자동차')], { mode: 'transit', arriveByMin: null }, nextId);
  const m = out.find(c => c.kind === 'mode')!;
  assert.equal(m.label, '대중교통');
  assert.equal(m.kind === 'mode' && m.value, 'transit');
});

test('이미 있던 칩은 id 를 유지한다 — 새 id 를 주면 목록이 다시 그려져 깜빡인다', () => {
  const out = syncConditionChips([modeChip('m-keep', 'car', '자동차')], { mode: 'walk', arriveByMin: null }, nextId);
  assert.equal(out.find(c => c.kind === 'mode')!.id, 'm-keep');
});

test('이동수단 칩이 없으면 만든다 — 항상 하나는 있어야 한다', () => {
  const out = syncConditionChips([stop('s-1')], { mode: 'car', arriveByMin: null }, nextId);
  assert.equal(out.filter(c => c.kind === 'mode').length, 1);
});

test('도착 시각을 정하면 칩이 생기고, 상관없어요로 바꾸면 사라진다', () => {
  const withTime = syncConditionChips([modeChip('m-1', 'car', '자동차')], { mode: 'car', arriveByMin: 540 }, nextId);
  const a = withTime.find(c => c.kind === 'arriveBy')!;
  assert.equal(a.label, '09:00까지');

  const cleared = syncConditionChips(withTime, { mode: 'car', arriveByMin: null }, nextId);
  assert.equal(cleared.find(c => c.kind === 'arriveBy'), undefined, '없는 조건을 칩으로 두면 지울 수 있는 것처럼 보인다');
});

test('경유지 칩은 건드리지 않고 순서도 유지한다', () => {
  const out = syncConditionChips(
    [stop('s-1'), stop('s-2'), modeChip('m-1', 'car', '자동차')],
    { mode: 'walk', arriveByMin: 600 }, nextId,
  );
  assert.deepEqual(out.filter(c => c.kind === 'stop').map(c => c.id), ['s-1', 's-2']);
  // 경유지 → 도착 시각 → 이동수단 (APPLY_INTENT 와 같은 순서)
  assert.deepEqual(out.map(c => c.kind), ['stop', 'stop', 'arriveBy', 'mode']);
});

test('이동수단 칩이 중복으로 쌓이지 않는다 — 여러 번 바꿔도 하나다', () => {
  let chips: IntentChip[] = [stop('s-1')];
  for (const m of ['car', 'walk', 'transit', 'car'] as const) {
    chips = syncConditionChips(chips, { mode: m, arriveByMin: null }, nextId);
  }
  assert.equal(chips.filter(c => c.kind === 'mode').length, 1);
  assert.equal(chips.find(c => c.kind === 'mode')!.label, '자동차');
});
