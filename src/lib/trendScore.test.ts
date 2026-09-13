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

test('미조회 후보가 조회된 후보를 공짜로 이기지 않는다 — 없는 축은 관측 중앙값으로 채운다', () => {
  // 예전엔 없는 축을 빼고 남은 가중치를 후보마다 다시 나눴다. 그러면 미조회 후보의
  // 점수가 fit 그대로가 되어, 없는 평점이 "자기 fit 과 같은 평점"으로 채워진 셈이었다.
  // 가까운 후보일수록 이 공짜 보너스가 커져 '측정 안 한 가게'가 이겼다.
  const r = scoreTrend([
    inp('rated', 0, { google: { rating: 2.0, ratingCount: 300 } }),
    inp('unknown', 0),
    inp('far', 10, { google: { rating: 2.0, ratingCount: 300 } }),
  ]);
  // 관측된 품질 중앙값(0.4)으로 채우면 rated 와 unknown 이 같은 점수라 입력 순서로 갈린다
  assert.deepEqual(ids(r), ['rated', 'unknown', 'far']);
  // 채운 값은 점수에만 쓰고, 관측하지 않았다는 사실은 그대로 남긴다
  assert.equal(r[1].quality, null);
});

test('축을 채우는 기준은 그 후보의 fit 이 아니라 슬롯 전체의 관측 중앙값이다', () => {
  // 평점이 좋은 후보들만 관측됐으면, 미조회 후보도 그만큼 좋다고 보는 게 맞다
  const r = scoreTrend([
    inp('unknown', 3),
    inp('good', 3, { google: { rating: 4.8, ratingCount: 300 } }),
    inp('alsoGood', 3, { google: { rating: 4.6, ratingCount: 300 } }),
  ]);
  // 중앙값이 높으니 unknown 은 good 들과 겨룰 만한 점수를 받는다 — fit 이 같으므로
  // 세 후보 점수 차는 관측 평점 차에서만 나온다
  assert.ok(r[0].id === 'good');
  assert.ok(r[1].score > r[2].score || r[1].id === 'alsoGood');
});

test('아무도 관측 안 된 축은 모든 후보에게 똑같이 꺼진다 — 순서는 추가시간 순', () => {
  const r = scoreTrend([inp('a', 9), inp('b', 2), inp('c', 5)]);
  assert.deepEqual(ids(r), ['b', 'c', 'a']);
});

test('조회한 후보만 커버리지 분모다 — 미조회 18곳이 buzz 축을 죽이지 않는다', () => {
  const list: TrendInput[] = [];
  for (let i = 0; i < 12; i++) {
    list.push(inp(`q${i}`, 3, { blogQueried: true, blog: { weighted: 5 } }));
  }
  for (let i = 0; i < 18; i++) list.push(inp(`u${i}`, 3));
  const r = scoreTrend(list);
  // 조회분 12곳 전부 언급이 있으니 축이 살아있다. 미조회 18곳을 '언급 0'으로
  // 세면 30곳 중 18곳(60%)이 0이 되어 예전 규칙으로는 위태로웠다
  assert.ok(r.find(x => x.id === 'q0')!.buzz != null);
});

test('조회분의 80% 이상이 언급 0이면 buzz 축이 꺼진다 — 분모는 조회분', () => {
  const list: TrendInput[] = [];
  for (let i = 0; i < 10; i++) {
    list.push(inp(`z${i}`, 3, { blogQueried: true, blog: { weighted: 0 } }));
  }
  for (let i = 0; i < 2; i++) {
    list.push(inp(`h${i}`, 3, { blogQueried: true, blog: { weighted: 8 } }));
  }
  for (let i = 0; i < 18; i++) list.push(inp(`u${i}`, 3));
  const r = scoreTrend(list);
  assert.ok(r.every(x => x.buzz == null));
});

test('조회분 일부만 신호가 와도 개수가 차면 buzz 축을 쓴다 — 비율이 아니라 개수 기준', () => {
  const list: TrendInput[] = [];
  // 6곳을 물었고 4곳만 신호가 왔다. 비율 기준(0.8)이면 꺼지지만, 표본이 작을 땐
  // 개수가 맞는 기준이다 — 실측에서 이 경우 90일 48건짜리 신호가 버려졌다
  for (let i = 0; i < 4; i++) {
    list.push(inp(`o${i}`, 3, { blogQueried: true, blog: { weighted: 6 } }));
  }
  for (let i = 0; i < 2; i++) list.push(inp(`n${i}`, 3, { blogQueried: true }));
  for (let i = 0; i < 24; i++) list.push(inp(`u${i}`, 3));
  const r = scoreTrend(list);
  assert.ok(r.find(x => x.id === 'o0')!.buzz != null, '신호가 살아있어야 한다');
});

test('신호가 최소 개수에 못 미치면 buzz 축이 꺼진다', () => {
  const list: TrendInput[] = [];
  // 6곳을 물었는데 2곳만 왔다 → 최소 3곳에 미달
  for (let i = 0; i < 2; i++) {
    list.push(inp(`o${i}`, 3, { blogQueried: true, blog: { weighted: 6 } }));
  }
  for (let i = 0; i < 4; i++) list.push(inp(`n${i}`, 3, { blogQueried: true }));
  const r = scoreTrend(list);
  assert.ok(r.every(x => x.buzz == null));
});
