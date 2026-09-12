import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnrichFn } from './mockEnrich.ts';
import type { EnrichPlace } from './types.ts';

const place = (id: string, name: string): EnrichPlace => ({ id, name, address: '', lat: 37.5, lng: 127.0 });

test('같은 이름은 매번 같은 신호를 낸다 — 시뮬레이터 화면이 실행마다 같아야 한다', async () => {
  const enrich1 = mockEnrichFn();
  const enrich2 = mockEnrichFn(); // 별개 인스턴스에서도 결정적이어야 한다
  const out1 = await enrich1([place('a', '올리브영 강남점')]);
  const out2 = await enrich2([place('a', '올리브영 강남점')]);
  // fetchedAt은 호출 시각이라 다를 수 있다 — 그 필드만 빼고 비교한다
  const strip = (s: typeof out1.a) => ({ ...s, fetchedAt: undefined });
  assert.deepEqual(strip(out1.a), strip(out2.a));
});

test('같은 이름을 두 번 보강해도 이번 호출 안에서 같은 값', async () => {
  const enrich = mockEnrichFn();
  const out = await enrich([place('a', '스타벅스 역삼점'), place('b', '스타벅스 역삼점')]);
  const strip = (s: typeof out.a) => ({ ...s, fetchedAt: undefined });
  assert.deepEqual(strip(out.a), strip(out.b));
});

test('이름이 다르면 신호도 달라진다', async () => {
  const enrich = mockEnrichFn();
  const out = await enrich([place('a', '올리브영 강남점'), place('b', '파리바게뜨 역삼점')]);
  assert.notDeepEqual(out.a.blog, out.b.blog);
});

test('블로그 인기 업종 이름은 weighted가 그 밖 업종보다 확실히 높다', async () => {
  const enrich = mockEnrichFn();
  const out = await enrich([place('a', '스타벅스 카페'), place('b', '올리브영 강남점')]);
  assert.ok(out.a.blog!.weighted >= 5, '카페류는 가중치 하한이 5 이상이어야 한다');
  assert.ok(out.b.blog!.weighted < 6, '비인기 업종은 가중치가 낮은 범위여야 한다');
});

test('source는 항상 kakao — 개발 메뉴에서 진짜와 구분된다', async () => {
  const enrich = mockEnrichFn();
  const out = await enrich([place('a', '아무 가게')]);
  assert.equal(out.a.blog!.source, 'kakao');
});

test('5곳 중 1곳 꼴로 구글 신호가 없다', async () => {
  const enrich = mockEnrichFn();
  const places = Array.from({ length: 50 }, (_, i) => place(`p${i}`, `가게${i}`));
  const out = await enrich(places);
  const missing = places.filter(p => out[p.id].google === undefined).length;
  assert.ok(missing > 0, '구글 신호가 없는 곳이 하나도 없으면 안 된다');
  assert.ok(missing < places.length, '전부 없어도 안 된다');
});

test('빈 배열이면 빈 결과', async () => {
  const enrich = mockEnrichFn();
  const out = await enrich([]);
  assert.deepEqual(out, {});
});
