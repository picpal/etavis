import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prescore, scoreTrend, type TrendInput } from './trendScore.ts';

const inp = (id: string, addedMin: number, extra: Partial<TrendInput> = {}): TrendInput =>
  ({ id, addedMin, ...extra });
const ids = (list: { id: string }[]) => list.map(x => x.id);

test('신호가 하나도 없으면 추가시간이 짧은 순', () => {
  const r = scoreTrend([inp('a', 9), inp('b', 2), inp('c', 5)]);
  assert.deepEqual(ids(r), ['b', 'c', 'a']);
  assert.equal(r[0].quality, null);
  assert.equal(r[0].buzz, null);
});

test('추가시간이 같으면 평점이 순서를 정한다', () => {
  const r = scoreTrend([
    inp('a', 3, { google: { rating: 3.5, ratingCount: 300 } }),
    inp('b', 3, { google: { rating: 4.8, ratingCount: 300 } }),
  ]);
  assert.deepEqual(ids(r), ['b', 'a']);
});

test('리뷰 수가 적으면 높은 평점이 깎인다', () => {
  const r = scoreTrend([
    inp('few', 3, { google: { rating: 5, ratingCount: 3 } }),
    inp('many', 3, { google: { rating: 4.4, ratingCount: 300 } }),
  ]);
  assert.deepEqual(ids(r), ['many', 'few']);
});

test('축이 빠지면 남은 가중치를 다시 나눠 합이 1이 된다', () => {
  // 신호가 전혀 없고 addedMin 이 최댓값이면 fit=0 → score 0
  const [only] = scoreTrend([inp('a', 10)]);
  assert.equal(only.score, 0);
  // fit 이 1(가장 짧음)이고 다른 축이 없으면 score 는 1
  const both = scoreTrend([inp('a', 0), inp('b', 10)]);
  assert.equal(both[0].score, 1);
});

test('후보의 80% 이상이 blog weighted 0 이면 buzz 축을 통째로 버린다', () => {
  const list = [
    inp('a', 3, { blog: { weighted: 0 } }),
    inp('b', 3, { blog: { weighted: 0 } }),
    inp('c', 3, { blog: { weighted: 0 } }),
    inp('d', 3, { blog: { weighted: 0 } }),
    inp('e', 3, { blog: { weighted: 9 } }),
  ];
  const r = scoreTrend(list);
  assert.ok(r.every(x => x.buzz === null), 'buzz 가 전부 null 이어야 한다');
  assert.ok(r.every(x => !x.reasons.some(s => s.includes('블로그'))));
});

test('80% 미만이면 buzz 축을 쓴다', () => {
  const list = [
    inp('a', 3, { blog: { weighted: 0 } }),
    inp('b', 3, { blog: { weighted: 0 } }),
    inp('c', 3, { blog: { weighted: 4 } }),
    inp('d', 3, { blog: { weighted: 9 } }),
    inp('e', 3, { blog: { weighted: 20 } }),
  ];
  const r = scoreTrend(list);
  assert.equal(ids(r)[0], 'e');
  assert.ok(r[0].buzz !== null);
});

test('buzz 는 로그 정규화 — weighted 10 이면 1', () => {
  const r = scoreTrend([
    inp('a', 3, { blog: { weighted: 10 } }),
    inp('b', 3, { blog: { weighted: 2.3 } }),
  ]);
  const a = r.find(x => x.id === 'a')!;
  const b = r.find(x => x.id === 'b')!;
  assert.ok(Math.abs(a.buzz! - 1) < 1e-9);
  assert.ok(b.buzz! > 0.45 && b.buzz! < 0.55, `기대 0.5 근처, 실제 ${b.buzz}`);
});

test('점수가 같으면 추가시간이 짧은 쪽이 먼저', () => {
  const r = scoreTrend([inp('late', 7), inp('early', 7)]);
  // 완전히 같으면 입력 순서가 유지된다(안정 정렬)
  assert.deepEqual(ids(r), ['late', 'early']);
  const r2 = scoreTrend([inp('a', 7), inp('b', 3), inp('c', 7)]);
  assert.equal(ids(r2)[0], 'b');
});

test('reasons 는 있는 신호만 이 순서로 — 평점·블로그', () => {
  const [r] = scoreTrend([
    inp('a', 4, { google: { rating: 4.5, ratingCount: 320 }, blog: { weighted: 8 } }),
  ]);
  // 추가시간은 카드에 이미 별도 자리(추가시간 라벨)로 나온다 — reasons에 다시 넣으면
  // 부제가 중복으로 길어져 두 줄로 넘친다(파리바게뜨 여의도2호점에서 실측)
  assert.deepEqual(r.reasons, ['구글 4.5 (320)', '최근 블로그 8건']);
});

test('신호가 없으면 reasons 는 빈 배열 — 추가시간은 여기 넣지 않는다', () => {
  const [r] = scoreTrend([inp('a', 0)]);
  assert.deepEqual(r.reasons, []);
});

test('요즘 인기 배지는 buzz 0.6 이상이고 3위 안일 때만', () => {
  const r = scoreTrend([
    inp('a', 3, { blog: { weighted: 20 } }),
    inp('b', 3, { blog: { weighted: 9 } }),
    inp('c', 3, { blog: { weighted: 3 } }),
    inp('d', 3, { blog: { weighted: 0.2 } }),
    inp('e', 3, { blog: { weighted: 0 } }),
  ]);
  assert.equal(r[0].hot, true);
  assert.equal(r[4].hot, false);
  assert.ok(r.filter(x => x.hot).length <= 3);
});

test('prescore 는 fit·buzz 만으로 상위 10개 id 를 준다', () => {
  // p15 는 추가시간만 보면 16위지만 언급이 많아 올라와야 한다.
  // (p29 처럼 fit 이 0인 후보는 buzz 만점이어도 0.4 라 10위 밖이다 — 의도된 동작)
  const many = Array.from({ length: 30 }, (_, i) =>
    inp(`p${i}`, i, { blog: { weighted: i === 15 ? 50 : 0 } }));
  const picked = prescore(many);
  assert.equal(picked.length, 10);
  assert.ok(picked.includes('p0'), '추가시간이 가장 짧은 후보는 뽑혀야 한다');
  assert.ok(picked.includes('p15'), '언급이 많은 후보는 추가시간이 중간이어도 뽑혀야 한다');
});

test('prescore 에서 fit 이 바닥인 후보는 buzz 만점이어도 밀린다', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    inp(`p${i}`, i, { blog: { weighted: i === 29 ? 50 : 0 } }));
  assert.ok(!prescore(many).includes('p29'));
});

test('prescore 는 후보가 10개 미만이면 전부 준다', () => {
  assert.equal(prescore([inp('a', 1), inp('b', 2)]).length, 2);
});

test('평점 축(0.35)이 버즈 축(0.25)보다 우선한다 — 가중치를 바꿔치기하면 이 테스트가 깨진다', () => {
  // addedMin 이 같아 fit 은 두 후보에 동일하게 기여 — 순위는 quality·buzz 가중치 차이로만 갈린다.
  // q: 평점은 만점, 언급은 0 / z: 평점은 바닥(리뷰도 1개뿐), 언급은 만점 — 서로 거울상.
  // 0.35 > 0.25 이면 q 가 이기고, 둘을 바꾸면 z 가 이긴다(손계산: 0.63 vs 0.539 → 0.53 vs 0.637).
  const r = scoreTrend([
    inp('q', 3, { google: { rating: 5, ratingCount: 200 }, blog: { weighted: 0 } }),
    inp('z', 3, { google: { rating: 1, ratingCount: 1 }, blog: { weighted: 10 } }),
  ]);
  assert.deepEqual(ids(r), ['q', 'z']);
});

test('요즘 인기 배지는 buzz 가 높아도 4위부터는 붙지 않는다 (HOT_RANK)', () => {
  // buzz 를 전부 동일하게 만점으로 맞춰서 순위를 fit(addedMin) 만으로 결정한다.
  // 그래서 buzz 조건은 5개 전부 통과하는데도 4·5위는 배지가 붙으면 안 된다 —
  // HOT_RANK 가 3이 아니라 4·5로 느슨해지면 이 테스트가 깨진다.
  const many = [
    inp('r0', 0, { blog: { weighted: 10 } }),
    inp('r1', 1, { blog: { weighted: 10 } }),
    inp('r2', 2, { blog: { weighted: 10 } }),
    inp('r3', 3, { blog: { weighted: 10 } }),
    inp('r4', 4, { blog: { weighted: 10 } }),
  ];
  const r = scoreTrend(many);
  assert.deepEqual(ids(r), ['r0', 'r1', 'r2', 'r3', 'r4']);
  assert.ok(r.every(x => x.buzz! >= 0.6), '5개 전부 buzz 조건은 만족해야 이 테스트가 HOT_RANK 만 검증한다');
  assert.deepEqual(r.map(x => x.hot), [true, true, true, false, false]);
});
