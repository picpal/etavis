import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordParams } from './placesParams';

const SEOUL = { latitude: 37.5665, longitude: 126.978 }; // 서울시청
const SF = { latitude: 37.7749, longitude: -122.4194 };

test('이름으로 찾을 때는 국내에서도 거리순으로 정렬하지 않는다 — 9km 떨어진 강남역이 잘려 나갔다', () => {
  const p = keywordParams({ query: '강남역', near: SEOUL, intent: 'byName' });

  assert.equal(p.get('sort'), null, "sort=distance 가 붙으면 카카오가 '가장 가까운 15건'만 준다");
});

test('이름으로 찾아도 좌표는 넘긴다 — 같은 이름이 여럿이면 가까운 쪽이 위로 와야 한다', () => {
  const p = keywordParams({ query: '강남역', near: SEOUL, intent: 'byName' });

  assert.equal(p.get('x'), '126.978');
  assert.equal(p.get('y'), '37.5665');
});

test('경유지를 찾을 때는 거리순이 맞다 — 회랑에서 가까운 곳을 골라야 한다', () => {
  const p = keywordParams({ query: '올리브영', near: SEOUL, intent: 'nearby', radiusM: 3000 });

  assert.equal(p.get('sort'), 'distance');
  assert.equal(p.get('radius'), '3000');
});

test('이름 검색에는 반경을 걸지 않는다 — 목적지는 회랑 밖에 있을 수 있다', () => {
  const p = keywordParams({ query: '강남역', near: SEOUL, intent: 'byName', radiusM: 3000 });

  assert.equal(p.get('radius'), null);
});

test('해외에서는 좌표를 아예 넘기지 않는다 — 거리순이 무의미하다', () => {
  const p = keywordParams({ query: '강남역', near: SF, intent: 'nearby', radiusM: 3000 });

  assert.equal(p.get('x'), null);
  assert.equal(p.get('sort'), null);
});

test('반경은 카카오 상한 20km 로 자른다', () => {
  const p = keywordParams({ query: '올리브영', near: SEOUL, intent: 'nearby', radiusM: 50000 });

  assert.equal(p.get('radius'), '20000');
});

test('업종 코드가 있으면 붙인다 — 주차장이 1순위로 오던 것을 서버에서 거른다', () => {
  const p = keywordParams({ query: '국민은행', near: SEOUL, intent: 'nearby', categoryCode: 'BK9' });

  assert.equal(p.get('category_group_code'), 'BK9');
});

test('검색어와 size 는 그대로 실린다', () => {
  const p = keywordParams({ query: '올리브영', near: null, intent: 'byName' });

  assert.equal(p.get('query'), '올리브영');
  assert.equal(p.get('size'), '15');
});
