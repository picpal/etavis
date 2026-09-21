import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterCandidates, leadOrder, SAME_TIME_M } from './cluster';
import type { Clusterable } from './cluster';

/** 서교동 기준. 위도 1e-5 ≈ 1.1m 라 m 를 도로 바꿔 쓴다 */
const BASE = { latitude: 37.5528, longitude: 126.9245 };
const north = (m: number) => ({ latitude: BASE.latitude + m / 111_320, longitude: BASE.longitude });

const cand = (id: string, m: number, extra: Partial<Clusterable> = {}): Clusterable => ({
  id,
  name: id,
  coord: north(m),
  ...extra,
});

test('250m 안 후보는 한 묶음이다 — 그 안의 시간 차이는 추정 오차보다 작아 정보가 아니다', () => {
  const out = clusterCandidates([cand('a', 0), cand('b', 120), cand('c', 240)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].members.map(c => c.id).sort(), ['a', 'b', 'c']);
});

test('250m 를 넘으면 다른 묶음이다', () => {
  const out = clusterCandidates([cand('a', 0), cand('b', 400)]);
  assert.equal(out.length, 2);
});

test('묶음은 이어 붙어 길어지지 않는다 — 기준점은 첫 멤버지 움직이는 중심이 아니다', () => {
  // 0 → 200 → 400 → 600. 중심을 따라가면 전부 한 묶음이 되어 600m 짜리 '같은 자리'가 된다
  const out = clusterCandidates([cand('a', 0), cand('b', 200), cand('c', 400), cand('d', 600)]);
  assert.deepEqual(out.map(g => g.members.map(c => c.id)), [['a', 'b'], ['c', 'd']]);
});

test('묶음 대표는 실측된 후보가 있으면 그것이다 — 묶음의 시간을 말하는 자리다', () => {
  const out = clusterCandidates([
    cand('추정높은점수', 0, { trend: { score: 90 } }),
    cand('실측', 80, { cls: 'measured', trend: { score: 10 } }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].lead.id, '실측');
  assert.equal(out[0].members[0].id, '실측', '대표는 늘 첫 번째다');
});

test('실측이 없으면 대표는 trend 1위, 신호도 없으면 이름순 — 같은 목록이 실행마다 달라지지 않는다', () => {
  const byTrend = clusterCandidates([cand('낮음', 0, { trend: { score: 1 } }), cand('높음', 50, { trend: { score: 9 } })]);
  assert.equal(byTrend[0].lead.id, '높음');

  const byName = clusterCandidates([cand('나', 0), cand('가', 50)]);
  assert.equal(byName[0].lead.id, '가');
});

test('묶음 안 나머지는 들어온 순서 그대로다 — 안쪽 정렬은 영업까지 보는 rankClusters 몫이다', () => {
  const out = clusterCandidates([cand('첫', 0), cand('둘', 30), cand('셋', 60, { cls: 'measured' })]);
  assert.deepEqual(out[0].members.map(c => c.id), ['셋', '첫', '둘']);
});

test('묶음 사이 순서는 들어온 순서를 지킨다 — 호출부가 Δ 오름차순으로 넣는다', () => {
  const out = clusterCandidates([cand('가까움', 0), cand('멈', 5000), cand('가까움2', 100)]);
  assert.deepEqual(out.map(g => g.id), ['가까움', '멈']);
  assert.deepEqual(out[0].members.map(c => c.id), ['가까움', '가까움2']);
});

test('반경은 인자로 열려 있고 기본값은 제품 문장인 250m 다', () => {
  assert.equal(SAME_TIME_M, 250);
  assert.equal(clusterCandidates([cand('a', 0), cand('b', 120)], 100).length, 2);
});

test('영업이 확인된 곳이 모르는 곳보다 앞이다 — 시간이 같으면 남는 차이는 들를 수 있나다', () => {
  const out = clusterCandidates([cand('가모름', 0, { openState: 'unknown' }), cand('나영업', 60, { openState: 'open' })]);
  assert.deepEqual(out[0].members.map(c => c.id), ['나영업', '가모름']);
});

test('모름은 곧 마감보다 앞이다 — 30분 뒤 닫는 게 확실한 곳보다 헛걸음 확률이 낮다', () => {
  const out = clusterCandidates([
    cand('가곧마감', 0, { openState: 'closing_soon' }),
    cand('나모름', 60, { openState: 'unknown' }),
  ]);
  assert.deepEqual(out[0].members.map(c => c.id), ['나모름', '가곧마감']);
});

test('대표와 묶음 안 순서는 같은 규칙을 쓴다 — 곧 마감하는 곳이 대표로 맨 위에 서지 않는다', () => {
  // 규칙을 따로 두었더니 이름순에 걸려 '곧 마감'이 대표가 되고, 바로 아래 목록에서는 뒤로
  // 밀려 있었다. 같은 화면에서 한 곳이 1등이자 꼴등이 된다
  const out = clusterCandidates([cand('가곧마감', 0, { openState: 'closing_soon' }), cand('나영업', 60)]);
  assert.equal(out[0].lead.id, '나영업');
});

test('leadOrder — 실측이 trend 를 이기고, trend 가 이름을 이긴다', () => {
  assert.ok(leadOrder(cand('a', 0, { cls: 'measured' }), cand('b', 0, { trend: { score: 99 } })) < 0);
  assert.ok(leadOrder(cand('a', 0, { trend: { score: 1 } }), cand('b', 0)) < 0);
});

test('빈 목록은 빈 묶음이다 — 후보가 0곳일 때 화면이 터지지 않는다', () => {
  assert.deepEqual(clusterCandidates([]), []);
});
