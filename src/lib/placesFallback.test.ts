import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMockFallback, type SearchProviderLike } from './placesFallback.ts';

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
