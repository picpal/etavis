import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCaseRuns } from './case-score.mjs';

const TAGS = ['near', 'loadBefore', 'loadAfter', 'needWhen'];
/** 경유지 하나짜리 응답 */
const withStop = (tags) => ({ stops: [{ near: 'any', loadBefore: 'none', loadAfter: 'none', needWhen: 'unknown', ...tags }] });
/** 응답은 왔는데 경유지를 못 뽑은 회차 */
const noStop = () => ({ stops: [] });

test('태그가 안 갈리면 흔들림 없음', () => {
  const r = analyzeCaseRuns([withStop({}), withStop({}), withStop({})], TAGS);
  assert.equal(r.extractionFails, 0);
  assert.deepEqual(TAGS.filter(t => r.flips[t]), []);
});

test('태그가 갈리면 그 태그만 짚는다', () => {
  const r = analyzeCaseRuns([withStop({ loadAfter: 'hard' }), withStop({ loadAfter: 'none' })], TAGS);
  assert.deepEqual(TAGS.filter(t => r.flips[t]), ['loadAfter']);
  assert.deepEqual(r.values.loadAfter, ['hard', 'none']);
});

/* 회귀: 2026-09-19 측정에서 needWhen 이 실제로는 한 번도 안 갈렸는데 22% 로 보고됐다.
   경유지 0건 회차를 `-` 라는 **태그 값**으로 세는 바람에, 0건 한 번이 네 태그를
   동시에 불안정으로 만들었다. 두 신호는 성격이 다르다 —
   태그가 갈리면 방향이 조금 달라지고, 경유지 0건이면 사용자 요청이 통째로 사라진다. */
test('경유지 0건 회차는 태그 흔들림으로 세지 않는다 — 별도 지표다', () => {
  const runs = [withStop({ needWhen: 'beforeArrival' }), withStop({ needWhen: 'beforeArrival' }), noStop(), withStop({ needWhen: 'beforeArrival' })];

  const r = analyzeCaseRuns(runs, TAGS);

  assert.equal(r.extractionFails, 1, '0건 회차를 따로 센다');
  assert.equal(r.withStop, 3);
  assert.deepEqual(TAGS.filter(t => r.flips[t]), [], '값은 한 번도 안 갈렸다');
  assert.deepEqual(r.values.needWhen, ['beforeArrival', 'beforeArrival', 'beforeArrival']);
});

test('경유지 0건과 태그 흔들림이 같이 있어도 따로 센다', () => {
  const runs = [withStop({ loadAfter: 'none' }), withStop({ loadAfter: 'hard' }), noStop()];

  const r = analyzeCaseRuns(runs, TAGS);

  assert.equal(r.extractionFails, 1);
  assert.deepEqual(TAGS.filter(t => r.flips[t]), ['loadAfter']);
});

test('무응답 회차는 아예 빼고 센다 — 못 물어본 것과 못 뽑은 것은 다르다', () => {
  const r = analyzeCaseRuns([withStop({}), null, withStop({})], TAGS);
  assert.equal(r.answered, 2);
  assert.equal(r.extractionFails, 0);
});

test('전 회차가 경유지 0건이면 태그는 판정 불가다', () => {
  const r = analyzeCaseRuns([noStop(), noStop()], TAGS);
  assert.equal(r.extractionFails, 2);
  assert.equal(r.withStop, 0);
  assert.deepEqual(TAGS.filter(t => r.flips[t]), [], '값이 없으면 갈렸다고 말할 수 없다');
});
