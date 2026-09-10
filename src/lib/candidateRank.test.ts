import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, CANDIDATE_SORTS } from './candidateRank.ts';
import type { Candidate } from '../data/mockData.ts';

const base: Omit<Candidate, 'id' | 'addedMin' | 'detourKm' | 'parking'> = {
  name: 'x', note: '', arriveAt: '09:00', dwellMin: 5,
  openState: 'open', openNote: '', coord: { latitude: 0, longitude: 0 },
};
const c = (id: string, addedMin: number, detourKm: number, parking: Candidate['parking'], extra: Partial<Candidate> = {}): Candidate =>
  ({ ...base, id, addedMin, detourKm, parking, ...extra });

const ids = (list: Candidate[]) => list.map(x => x.id);

test('탭 라벨은 추가시간·주차·거리', () => {
  assert.deepEqual([...CANDIDATE_SORTS], ['추가시간', '주차', '거리']);
});

test('마감·선택불가 후보는 목록에서 빠진다', () => {
  const list = [c('a', 5, 1, '가능'), c('b', 3, 1, '가능', { openState: 'closed' }), c('c', 4, 1, '가능', { disabled: true })];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['a']);
});

test('곧 마감은 남는다', () => {
  const list = [c('a', 5, 1, '가능', { openState: 'closing_soon' })];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['a']);
});

test('추가시간순', () => {
  const list = [c('a', 9, 0.1, '없음'), c('b', 2, 5, '없음'), c('c', 5, 3, '없음')];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['b', 'c', 'a']);
});

test('주차순 — 가능 > 어려움 > 없음, 동률이면 추가시간', () => {
  const list = [c('a', 9, 1, '없음'), c('b', 8, 1, '가능'), c('c', 5, 1, '어려움'), c('d', 3, 1, '가능')];
  assert.deepEqual(ids(rankCandidates(list, 1)), ['d', 'b', 'c', 'a']);
});

test('거리순 — detourKm 숫자로 정렬, 동률이면 추가시간', () => {
  const list = [c('a', 2, 3.0, '가능'), c('b', 9, 0.4, '가능'), c('c', 1, 0.4, '가능')];
  assert.deepEqual(ids(rankCandidates(list, 2)), ['c', 'b', 'a']);
});

test('입력 배열은 건드리지 않는다', () => {
  const list = [c('a', 9, 1, '가능'), c('b', 1, 1, '가능')];
  rankCandidates(list, 0);
  assert.deepEqual(ids(list), ['a', 'b']);
});
