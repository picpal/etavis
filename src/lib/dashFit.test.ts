/**
 * 세로 점선 주기 맞추기 — 조각을 이어 붙였을 때 이음매에서 리듬이 깨지지 않아야 한다.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DASH_OFF, DASH_ON, type DashFit, fitDashV } from './dashFit';

const PERIOD = DASH_ON + DASH_OFF;

test('주기가 딱 떨어지는 높이는 원안 그대로 5:4', () => {
  assert.deepEqual(fitDashV(90), { on: 5, off: 4 });
});

test('어떤 높이든 주기가 정수 개 들어간다 — 이게 이음매가 매끄러운 유일한 조건', () => {
  for (let h = 1; h <= 400; h += 1) {
    const fit = fitDashV(h);
    assert.ok(fit, `높이 ${h} 에서 null`);
    const periods = h / (fit.on + fit.off);
    assert.ok(
      Math.abs(periods - Math.round(periods)) < 1e-9,
      `높이 ${h}: 주기가 ${periods} 개 — 정수가 아니면 조각 끝이 dash 한가운데서 잘린다`,
    );
  }
});

test('on:off 비율은 높이와 무관하게 5:4로 지킨다 — 굵기가 들쭉날쭉하면 그것대로 눈에 띈다', () => {
  for (const h of [7, 31, 88, 137, 260]) {
    const fit = fitDashV(h)!;
    assert.ok(Math.abs(fit.on / fit.off - DASH_ON / DASH_OFF) < 1e-9, `높이 ${h} 에서 비율이 틀어졌다`);
  }
});

test('주기는 원안(9pt)에서 크게 벗어나지 않는다 — 조각마다 점선 밀도가 달라 보이면 안 된다', () => {
  for (let h = 20; h <= 400; h += 1) {
    const fit = fitDashV(h)!;
    const period = fit.on + fit.off;
    // 반올림이라 최대 오차는 주기의 절반을 주기 개수로 나눈 만큼. 20pt 이상이면 ±25% 안
    assert.ok(period > PERIOD * 0.75 && period < PERIOD * 1.25, `높이 ${h}: 주기 ${period}`);
  }
});

test('한 주기도 안 되는 조각도 dash 를 하나는 그린다 — 안 그리면 거기만 뚫린 것처럼 보인다', () => {
  const fit = fitDashV(4)!;
  assert.ok(fit.on > 0 && fit.off > 0);
  assert.ok(Math.abs(fit.on + fit.off - 4) < 1e-9);
});

test('잴 수 없는 높이는 null — 0 을 나누면 dash 가 0 이 되어 선이 통째로 사라진다', () => {
  assert.equal(fitDashV(0), null);
  assert.equal(fitDashV(-3), null);
  assert.equal(fitDashV(Number.NaN), null);
});

/**
 * 조각 하나가 실제로 그리는 run 목록. 위에서부터 [dash, 간격, dash, ...] 로 채우고
 * 높이에서 잘린다. 이걸로 이음매를 눈 대신 자로 잰다.
 */
function runs(height: number, fit: DashFit): Array<{ ink: boolean; len: number }> {
  const out: Array<{ ink: boolean; len: number }> = [];
  let y = 0;
  for (let ink = true; y < height - 1e-9; ink = !ink) {
    const len = Math.min(ink ? fit.on : fit.off, height - y);
    out.push({ ink, len });
    y += len;
  }
  return out;
}

/** 이어 붙이고 같은 종류끼리 합친다 — 화면에서 눈에 보이는 건 합쳐진 뒤의 길이다 */
function seamRuns(a: Array<{ ink: boolean; len: number }>, b: Array<{ ink: boolean; len: number }>) {
  const merged: Array<{ ink: boolean; len: number }> = [];
  for (const r of [...a, ...b]) {
    const last = merged[merged.length - 1];
    if (last && last.ink === r.ink) last.len += r.len;
    else merged.push({ ...r });
  }
  return merged;
}

const HEIGHT_PAIRS: Array<[number, number]> = [
  [47, 63],
  [12, 205],
  [88, 88],
  [31, 7],
  [113, 96],
  [64, 151],
];

test('맞춘 주기로는 이음매에서 dash 가 붙거나 구멍이 나지 않는다', () => {
  for (const [hA, hB] of HEIGHT_PAIRS) {
    const a = fitDashV(hA)!;
    const b = fitDashV(hB)!;
    const merged = seamRuns(runs(hA, a), runs(hB, b));
    const maxInk = Math.max(...merged.filter(r => r.ink).map(r => r.len));
    const maxGap = Math.max(...merged.filter(r => !r.ink).map(r => r.len));
    assert.ok(maxInk <= Math.max(a.on, b.on) + 1e-9, `${hA}+${hB}: dash 가 ${maxInk} 까지 붙었다`);
    assert.ok(maxGap <= Math.max(a.off, b.off) + 1e-9, `${hA}+${hB}: 간격이 ${maxGap} 까지 벌어졌다`);
  }
});

test('고치기 전(고정 5,4)에는 같은 높이에서 실제로 붙거나 벌어진다 — 이 테스트가 헛돌지 않는다는 증거', () => {
  const fixed: DashFit = { on: DASH_ON, off: DASH_OFF };
  const broken = HEIGHT_PAIRS.filter(([hA, hB]) => {
    const merged = seamRuns(runs(hA, fixed), runs(hB, fixed));
    const maxInk = Math.max(...merged.filter(r => r.ink).map(r => r.len));
    const maxGap = Math.max(...merged.filter(r => !r.ink).map(r => r.len));
    return maxInk > DASH_ON + 1e-9 || maxGap > DASH_OFF + 1e-9;
  });
  assert.ok(broken.length > 0, '고정 주기로도 멀쩡하면 이 케이스들은 버그를 재현하지 못한다');
});
