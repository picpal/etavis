/**
 * 고른 매장을 다시 재는 일의 두 판단 — "불러도 되나"와 "이 응답을 화면에 반영해도 되나".
 * 플래너(`plan.test.ts` 의 measureSwap)는 **잴 수 있나**를 시험하고, 여기는 **재서 무엇이
 * 달라지나**를 시험한다. 돈이 나가는 쪽이라 둘 다 필요하다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwapMeasurer, shouldMeasureSwap } from './measureSwap';
import type { PlanResult, TimeClass, TimingSource, Visit } from '../lib/routePlan/types';

const visit = (id: string): Visit => ({
  slotId: id,
  candidate: { id, name: id, coord: { latitude: 37.5, longitude: 127 } },
  dwellMin: 10,
});

/**
 * 계획 하나를 흉내 낸다. `legCls` 로 "지금 어느 구간이 실측인가"를, `swap` 으로
 * `measureSwap` 의 결과(성공·예산초과·던짐)를 정한다
 */
const fakeResult = (opts: {
  timingSource: TimingSource;
  legCls: TimeClass[];
  swap?: (visits: Visit[], idx: number) => Promise<boolean>;
  onCall?: (visits: Visit[], idx: number) => void;
}): PlanResult => {
  const r = {
    timingSource: opts.timingSource,
    rescore: () => ({ totalMin: 0, arrivals: [], distanceKm: 0, estimated: false, legsKm: [], legCls: opts.legCls }),
    measureSwap: async (visits: Visit[], idx: number) => {
      opts.onCall?.(visits, idx);
      return opts.swap ? opts.swap(visits, idx) : true;
    },
  };
  return r as unknown as PlanResult;
};

test('실측 계획에서 바뀐 두 구간만 추정이면 잰다 — 그 둘을 사면 약이 지워지는 유일한 모양이다', () => {
  const visits = [visit('a'), visit('b')];
  const r = fakeResult({ timingSource: 'provider_legs', legCls: ['estimated', 'estimated', 'measured'] });
  assert.equal(shouldMeasureSwap(r, visits, 0), true);
});

test('provider_direct_only 에서는 부르지 않는다 — 기준 안의 시드가 추정이라 두 번을 써도 약이 안 지워진다', () => {
  /* `rescoreFrom` 의 관문은 `hit && b.legCls[k] === 'measured'` 다. 직행만 실측인 계획은
     기준 안 쪽에서 막히므로 후보 카드의 등급이 'estimated' 그대로다 — 돈만 나간다.
     플래너는 일부러 안 막았다("잴 수 있나"는 플래너의 질문이다). 거르는 자리는 여기다. */
  const visits = [visit('a')];
  const direct = fakeResult({ timingSource: 'provider_direct_only', legCls: ['estimated', 'estimated'] });
  assert.equal(shouldMeasureSwap(direct, visits, 0), false);
  const mock = fakeResult({ timingSource: 'estimate', legCls: ['estimated', 'estimated'] });
  assert.equal(shouldMeasureSwap(mock, visits, 0), false);
});

test('바뀌는 둘 말고 다른 구간이 추정이면 안 부른다 — 그 둘을 사도 배너의 약은 그대로다', () => {
  // 시드 예산이 모자라 다른 구간이 추정으로 남은 안(V≥3). 두 구간을 재도 `estimated` 가 참이라
  // 화면은 하나도 안 바뀐다
  const visits = [visit('a'), visit('b'), visit('c')];
  const r = fakeResult({ timingSource: 'provider_legs', legCls: ['estimated', 'estimated', 'estimated', 'measured'] });
  assert.equal(shouldMeasureSwap(r, visits, 0), false);
});

test('성공하면 파생을 다시 돌리고, 재는 동안에만 조회 중이 켜진다', async () => {
  const visits = [visit('a')];
  const learned: number[] = [];
  const flags: boolean[] = [];
  const m = createSwapMeasurer({ onMeasuring: v => flags.push(v), onLearned: (_v, idx) => learned.push(idx) });

  assert.equal(await m.measure(fakeResult({ timingSource: 'provider', legCls: ['estimated', 'estimated'] }), visits, 0), true);
  assert.deepEqual(flags, [true, false]);
  assert.deepEqual(learned, [0], '`measureSwap` 은 값을 안 돌려준다 — 이 신호가 없으면 화면은 영영 약이다');
});

test('예산 초과·공급자 실패는 조용히 약으로 남는다 — 고르기를 막을 이유가 없다', async () => {
  const visits = [visit('a')];
  const learned: number[] = [];
  const flags: boolean[] = [];
  const m = createSwapMeasurer({ onMeasuring: v => flags.push(v), onLearned: () => learned.push(0) });

  const over = fakeResult({ timingSource: 'provider', legCls: ['estimated', 'estimated'], swap: async () => false });
  assert.equal(await m.measure(over, visits, 0), false);
  // 계약을 어기고 던지는 공급자가 와도 화면은 멀쩡해야 한다
  const threw = fakeResult({
    timingSource: 'provider', legCls: ['estimated', 'estimated'],
    swap: async () => { throw new Error('/transit 500'); },
  });
  assert.equal(await m.measure(threw, visits, 0), false);

  assert.deepEqual(learned, [], '파생을 다시 돌리지 않는다 — 안 잰 구간이 실측인 척하면 안 된다');
  assert.deepEqual(flags, [true, false, true, false], '조회 중은 반드시 꺼진다 — 안 끄면 없는 요청을 말한다');
});

test('안 부르기로 한 고르기는 조회 중도 안 켠다 — 없는 요청을 배너가 말하면 거짓말이다', async () => {
  const flags: boolean[] = [];
  const m = createSwapMeasurer({ onMeasuring: v => flags.push(v), onLearned: () => {} });
  const direct = fakeResult({ timingSource: 'provider_direct_only', legCls: ['estimated', 'estimated'] });

  assert.equal(await m.measure(direct, [visit('a')], 0), false);
  assert.deepEqual(flags, []);
});

test('늦게 온 옛 응답은 새 선택을 되돌리지 않는다 — 반영은 그 시점 방문 배열로 낸 표라 되돌리면 옛 매장이 선다', async () => {
  const learned: string[] = [];
  const flags: boolean[] = [];
  const m = createSwapMeasurer({
    onMeasuring: v => flags.push(v),
    onLearned: vs => learned.push(vs[0].candidate.id),
  });
  let releaseSlow: () => void = () => {};
  const slow = fakeResult({
    timingSource: 'provider', legCls: ['estimated', 'estimated'],
    swap: () => new Promise<boolean>(res => { releaseSlow = () => res(true); }),
  });
  const fast = fakeResult({ timingSource: 'provider', legCls: ['estimated', 'estimated'] });

  const first = m.measure(slow, [visit('옛매장')], 0);   // 사용자가 A 를 골랐다
  const second = await m.measure(fast, [visit('새매장')], 0); // 재는 동안 B 로 바꿨고 B 가 먼저 왔다
  releaseSlow();
  const firstOk = await first;

  assert.equal(second, true);
  assert.deepEqual(learned, ['새매장'], '옛 응답으로 파생을 돌리면 방금 고른 매장이 조용히 되돌아간다');
  assert.equal(firstOk, false, '늦은 응답은 반영했다고 말하지 않는다');
  assert.deepEqual(flags, [true, true, false], '옛 응답은 조회 중도 안 끈다 — 끄면 나가 있는 요청을 없다고 말한다');
});
