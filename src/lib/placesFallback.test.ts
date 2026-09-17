import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMockFallback, BREAKER_COOLDOWN_MS, type SearchProviderLike } from './placesFallback.ts';

const place = (name: string) => ({ id: `id-${name}`, name, address: '서울 영등포구', coord: { latitude: 37.5271, longitude: 126.9327 } });

const ok: SearchProviderLike = { key: 'kakao', async search(q) { return [place(q)]; } };
const boom: SearchProviderLike = { key: 'kakao', async search() { throw new Error('kakao keyword 429'); } };
const mock: SearchProviderLike = { key: 'mock', async search() { return [place('목-올리브영')]; } };

test('성공하면 primary 결과를 그대로 준다', async () => {
  const p = withMockFallback(ok, mock, { enabled: true });
  assert.deepEqual((await p.search('올리브영', null)).map(r => r.name), ['올리브영']);
});

test('enabled 면 실패 시 목으로 내려간다 — 빈 배열이 아니다', async () => {
  const p = withMockFallback(boom, mock, { enabled: true });
  const r = await p.search('올리브영', null);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, '목-올리브영');
});

test('enabled 가 false 면 그대로 던진다 — 네이티브는 실패 배너를 띄워야 한다', async () => {
  const p = withMockFallback(boom, mock, { enabled: false });
  await assert.rejects(() => p.search('올리브영', null), /429/);
});

test('key 는 primary 것을 유지한다 — 어느 공급자를 쓰려 했는지가 로그에 남아야 한다', () => {
  assert.equal(withMockFallback(boom, mock, { enabled: true }).key, 'kakao');
});

test('primary 가 이미 목이면 감싸지 않는다', () => {
  assert.equal(withMockFallback(mock, mock, { enabled: true }), mock);
});

test('강등 사유를 onFallback 으로 넘긴다', async () => {
  const seen: unknown[] = [];
  await withMockFallback(boom, mock, { enabled: true, onFallback: e => seen.push(e) }).search('x', null);
  assert.equal(seen.length, 1);
  assert.match(String(seen[0]), /429/);
});

test('near·radiusM 인자를 목에 그대로 넘긴다', async () => {
  let got: unknown[] = [];
  const spy: SearchProviderLike = { key: 'mock', async search(...args) { got = args; return []; } };
  const near = { latitude: 37.5, longitude: 127 };
  await withMockFallback(boom, spy, { enabled: true }).search('빵집', near, 1500);
  assert.deepEqual(got, ['빵집', near, 1500]);
});

// 회로차단기 — corridorSearch 의 반경 루프가 죽은 공급자를 라운드마다 다시 때리지 않게 한다.
// (배경: src/lib/corridorSearch.ts:67 의 while(true) 루프가 반경을 늘려가며 반복 호출하는데,
//  폴백이 실패를 삼키므로 루프 입장에선 "성공했지만 후보가 없다"로 보여 계속 돈다.)

test('primary 가 한 번 던지면 쿨다운 안의 다음 호출은 primary 를 아예 안 부른다', async () => {
  let calls = 0;
  const flaky: SearchProviderLike = { key: 'kakao', async search() { calls++; throw new Error('501'); } };
  let t = 1_000;
  const p = withMockFallback(flaky, mock, { enabled: true, now: () => t });
  await p.search('올리브영', null); // 1번째 — primary 호출, 실패 → 차단기 open
  assert.equal(calls, 1);
  t += 1_000; // 쿨다운(60s) 안
  const r = await p.search('올리브영', null); // 2번째 — primary 건너뛰고 곧장 목
  assert.equal(calls, 1, 'primary 는 다시 불리면 안 된다');
  assert.equal(r[0].name, '목-올리브영');
});

test('쿨다운이 지나면 primary 를 다시 시도한다', async () => {
  let calls = 0;
  const flaky: SearchProviderLike = { key: 'kakao', async search() { calls++; throw new Error('501'); } };
  let t = 1_000;
  const p = withMockFallback(flaky, mock, { enabled: true, now: () => t });
  await p.search('올리브영', null);
  assert.equal(calls, 1);
  t += BREAKER_COOLDOWN_MS + 1;
  await p.search('올리브영', null);
  assert.equal(calls, 2, '쿨다운이 지나면 primary 를 다시 불러야 한다');
});

test('차단된 동안에도 onFallback 이 불린다', async () => {
  const flaky: SearchProviderLike = { key: 'kakao', async search() { throw new Error('501'); } };
  let t = 1_000;
  const seen: unknown[] = [];
  const p = withMockFallback(flaky, mock, { enabled: true, now: () => t, onFallback: e => seen.push(e) });
  await p.search('올리브영', null);
  assert.equal(seen.length, 1);
  t += 1_000; // 쿨다운 안
  await p.search('올리브영', null);
  assert.equal(seen.length, 2, '차단 중 건너뛴 호출도 onFallback 을 불러야 한다 — searchDegraded 캡션이 안 꺼지려면');
});

test('primary 가 계속 성공하면 차단기는 절대 열리지 않는다', async () => {
  let calls = 0;
  const healthy: SearchProviderLike = { key: 'kakao', async search(q) { calls++; return [place(q)]; } };
  let t = 1_000;
  const p = withMockFallback(healthy, mock, { enabled: true, now: () => t });
  await p.search('a', null);
  t += 1_000;
  await p.search('b', null);
  t += 1_000;
  await p.search('c', null);
  assert.equal(calls, 3, 'primary 호출 수는 search 호출 수와 같아야 한다');
});

test('차단 중에도 near·radiusM 인자가 fallback 에 그대로 전달된다', async () => {
  let got: unknown[] = [];
  const spy: SearchProviderLike = { key: 'mock', async search(...args) { got = args; return []; } };
  const flaky: SearchProviderLike = { key: 'kakao', async search() { throw new Error('501'); } };
  let t = 1_000;
  const p = withMockFallback(flaky, spy, { enabled: true, now: () => t });
  const near = { latitude: 37.5, longitude: 127 };
  await p.search('빵집', near, 1500); // open
  t += 1_000; // 쿨다운 안 — 이번엔 primary 건너뛰고 바로 fallback
  got = [];
  await p.search('빵집', near, 1500);
  assert.deepEqual(got, ['빵집', near, 1500]);
});
