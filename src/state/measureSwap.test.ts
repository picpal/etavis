/**
 * 고른 매장을 다시 재는 일의 두 판단 — "불러도 되나"와 "이 응답을 화면에 반영해도 되나".
 * 플래너(`plan.test.ts` 의 measureSwap)는 **잴 수 있나**를 시험하고, 여기는 **재서 무엇이
 * 달라지나**를 시험한다. 돈이 나가는 쪽이라 둘 다 필요하다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwapMeasurer, shouldMeasureSwap } from './measureSwap';
import { plan } from '../lib/routePlan/plan';
import { mockRouteProvider } from '../lib/routePlan/mockProvider';
import type { PlaceCandidate, PlanResult, Slot, TimeClass, TimingSource, Visit } from '../lib/routePlan/types';

const visit = (id: string): Visit => ({
  slotId: id,
  candidate: { id, name: id, coord: { latitude: 37.5, longitude: 127 } },
  dwellMin: 10,
});

/**
 * 계획 하나를 흉내 낸다. `legCls` 는 **기준 안**의 구간 등급이다 — 관문이 묻는 것이 거기이므로.
 * `swap` 으로 `measureSwap` 의 결과(성공·예산초과·던짐)를 정한다
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

test('기준 안이 전부 실측이면 잰다 — 그 둘을 사면 약이 지워지는 유일한 모양이다', () => {
  const base = [visit('a'), visit('b')];
  const swapped = [visit('새a'), visit('b')];
  const r = fakeResult({ timingSource: 'provider_legs', legCls: ['measured', 'measured', 'measured'] });
  assert.equal(shouldMeasureSwap(r, base, swapped, 0), true);
});

test('방문 수가 다르면 안 잰다 — 교체가 아니라 다른 계획이다', () => {
  const r = fakeResult({ timingSource: 'provider_legs', legCls: ['measured', 'measured', 'measured'] });
  assert.equal(shouldMeasureSwap(r, [visit('a'), visit('b')], [visit('a')], 0), false);
});

test('provider_direct_only 에서는 부르지 않는다 — 기준 안의 시드가 추정이라 두 번을 써도 약이 안 지워진다', () => {
  /* `rescoreFrom` 의 관문은 `hit && b.legCls[k] === 'measured'` 다. 직행만 실측인 계획은
     기준 안 쪽에서 막히므로 후보 카드의 등급이 'estimated' 그대로다 — 돈만 나간다.
     플래너는 일부러 안 막았다("잴 수 있나"는 플래너의 질문이다). 거르는 자리는 여기다. */
  /* 구간 등급을 **전부 실측으로 두고** 묻는다 — 그래야 이 테스트가 출처 관문만 가른다.
     목 공급자로 돈 계획이 실제로 이 모양이다: 직행이 source 를 안 달아 'estimate' 인데
     저장소엔 목 응답이 '실측'으로 쌓여 있다. 구간 관문만으로는 안 걸린다 */
  const visits = [visit('a')];
  const direct = fakeResult({ timingSource: 'provider_direct_only', legCls: ['measured', 'measured'] });
  assert.equal(shouldMeasureSwap(direct, visits, visits, 0), false);
  const mock = fakeResult({ timingSource: 'estimate', legCls: ['measured', 'measured'] });
  assert.equal(shouldMeasureSwap(mock, visits, visits, 0), false);
});

test('기준 안에 추정 구간이 남아 있으면 안 부른다 — 그 둘을 사도 배너의 약은 그대로다', () => {
  // 시드 예산이 모자라 뒤 구간이 추정으로 남은 안(V≥3). 앞 두 구간을 재도 `estimated` 가 참이라
  // 화면은 하나도 안 바뀐다 — 돈만 나간다
  const base = [visit('a'), visit('b'), visit('c')];
  const swapped = [visit('새a'), visit('b'), visit('c')];
  const r = fakeResult({ timingSource: 'provider_legs', legCls: ['measured', 'measured', 'estimated', 'measured'] });
  assert.equal(shouldMeasureSwap(r, base, swapped, 0), false);
});

test('성공하면 파생을 다시 돌리고, 재는 동안에만 조회 중이 켜진다', async () => {
  const visits = [visit('a')];
  const learned: number[] = [];
  const flags: boolean[] = [];
  const m = createSwapMeasurer({ onMeasuring: v => flags.push(v), onLearned: (_v, idx) => learned.push(idx) });

  assert.equal(await m.measure(fakeResult({ timingSource: 'provider', legCls: ['measured', 'measured'] }), visits, visits, 0), true);
  assert.deepEqual(flags, [true, false]);
  assert.deepEqual(learned, [0], '`measureSwap` 은 값을 안 돌려준다 — 이 신호가 없으면 화면은 영영 약이다');
});

test('예산 초과·공급자 실패는 조용히 약으로 남는다 — 고르기를 막을 이유가 없다', async () => {
  const visits = [visit('a')];
  const learned: number[] = [];
  const flags: boolean[] = [];
  const m = createSwapMeasurer({ onMeasuring: v => flags.push(v), onLearned: () => learned.push(0) });

  const over = fakeResult({ timingSource: 'provider', legCls: ['measured', 'measured'], swap: async () => false });
  assert.equal(await m.measure(over, visits, visits, 0), false);
  // 계약을 어기고 던지는 공급자가 와도 화면은 멀쩡해야 한다
  const threw = fakeResult({
    timingSource: 'provider', legCls: ['measured', 'measured'],
    swap: async () => { throw new Error('/transit 500'); },
  });
  assert.equal(await m.measure(threw, visits, visits, 0), false);

  assert.deepEqual(learned, [], '파생을 다시 돌리지 않는다 — 안 잰 구간이 실측인 척하면 안 된다');
  assert.deepEqual(flags, [true, false, true, false], '조회 중은 반드시 꺼진다 — 안 끄면 없는 요청을 말한다');
});

test('안 부르기로 한 고르기는 조회 중도 안 켠다 — 없는 요청을 배너가 말하면 거짓말이다', async () => {
  const flags: boolean[] = [];
  const m = createSwapMeasurer({ onMeasuring: v => flags.push(v), onLearned: () => {} });
  const direct = fakeResult({ timingSource: 'provider_direct_only', legCls: ['measured', 'measured'] });

  assert.equal(await m.measure(direct, [visit('a')], [visit('a')], 0), false);
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
    timingSource: 'provider', legCls: ['measured', 'measured'],
    swap: () => new Promise<boolean>(res => { releaseSlow = () => res(true); }),
  });
  const fast = fakeResult({ timingSource: 'provider', legCls: ['measured', 'measured'] });

  const first = m.measure(slow, [visit('옛매장')], [visit('옛매장')], 0);   // 사용자가 A 를 골랐다
  const second = await m.measure(fast, [visit('새매장')], [visit('새매장')], 0); // 재는 동안 B 로 바꿨고 B 가 먼저 왔다
  releaseSlow();
  const firstOk = await first;

  assert.equal(second, true);
  assert.deepEqual(learned, ['새매장'], '옛 응답으로 파생을 돌리면 방금 고른 매장이 조용히 되돌아간다');
  assert.equal(firstOk, false, '늦은 응답은 반영했다고 말하지 않는다');
  assert.deepEqual(flags, [true, true, false], '옛 응답은 조회 중도 안 끈다 — 끄면 나가 있는 요청을 없다고 말한다');
});


/* ── 경유지 둘짜리 실측 계획에서 첫 곳을 바꾼다 — A6 에서 관측된 자리 ────────────────
   기기(2026-09-21, 서교동→코엑스 대중교통, 경유 2곳): 확정 뒤 첫 스톱을 시드 밖 후보로
   바꾸자 끝까지 '약'이었고 '조회 중'은 한 번도 안 떴다. 예산은 4가 통째로 남아 있었다.

   위의 목(`fakeResult`)은 `legCls` 를 손으로 박아 이 자리를 못 덮는다. 진짜 플래너로 돌려야
   드러난다 — 바꾼 두 구간이 추정이 되면 **그 뒤 구간의 조회 시각까지 같이 밀리고**,
   LegStore 의 창이 15분이라(legs.ts `PROVISIONAL_MIN`) 안 바뀐 구간마저 'estimated' 로
   읽힌다. 관문을 **바뀐 뒤의 안**에 물으면 V≥2 의 마지막이 아닌 자리는 영영 못 잰다. */

const at = (lat: number, lng: number) => ({ latitude: lat, longitude: lng });
const place = (id: string, coord: ReturnType<typeof at>): PlaceCandidate => ({ id, name: id, coord });
const twoSlot = (id: string, candidates: PlaceCandidate[]): Slot =>
  ({ id, query: id, candidates, dwellMin: 10, count: 1, flexible: true, openNow: false, stopKind: 'category' });

const A1 = place('a1', at(37.5, 127.0113));
const A2 = place('a2', at(37.5, 127.0125));   // 시드 — 회랑 위, 기준과 코앞이라 시계가 거의 안 밀린다
const AG = place('aG', at(37.5027, 127.0113)); // 시드 밖 — 300m 북쪽. 실제로 사용자가 고르는 쪽이다
const B1 = place('b1', at(37.5, 127.07));

/** 공급자가 실측이라고 말하는 경유 2곳 계획. 목은 source 를 안 붙여 estimate 로 떨어진다 */
async function twoStopPlan(): Promise<PlanResult> {
  const inner = mockRouteProvider();
  const provider = {
    route: async (pts: Parameters<typeof inner.route>[0], d: number, m: Parameters<typeof inner.route>[2]) =>
      ({ ...(await inner.route(pts, d, m)), source: 'provider' as const, legJoined: true }),
  };
  return plan(
    { origin: at(37.5, 127.0), destination: at(37.5, 127.1136), departAtMin: 1343, mode: 'transit',
      slots: [twoSlot('a', [A1, A2, AG]), twoSlot('b', [B1])], order: 'auto' },
    provider,
  );
}

test('경유지 둘짜리 실측 계획에서 첫 곳을 바꿔도 잰다 — 뒤 구간이 밀려 보이는 건 아직 안 쟀기 때문이다', async () => {
  const r = await twoStopPlan();
  const base = r.options[0].visits;
  assert.equal(r.timingSource, 'provider_legs', '전제: 실측 계획이다');
  assert.equal(base.length, 2, '전제: 경유 2곳 — A5 의 V=1 은 바뀐 두 구간이 곧 전부라 이 결함을 못 본다');
  assert.deepEqual(r.rescore(base).legCls, ['measured', 'measured', 'measured'], '전제: 기준 안은 전부 실측');

  const swapped = base.map((v, i) => (i === 0 ? { ...v, candidate: AG } : v));
  // 바꾼 뒤의 안에서는 안 바뀐 마지막 구간까지 'estimated' 로 보인다 — 추정 두 구간이 시계를
  // 30분 가까이 당겨 LegStore 의 15분 창을 벗어나기 때문이다. 그건 저 구간을 못 쟀다는 뜻이 아니다
  assert.equal(r.rescore(swapped).legCls[2], 'estimated', '전제: 바뀐 뒤의 안에 물으면 뒤 구간이 추정으로 읽힌다');

  assert.equal(shouldMeasureSwap(r, base, swapped, 0), true, '기준 안이 전부 실측이면 재서 약을 지울 수 있다');
});
