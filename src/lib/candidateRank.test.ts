import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, CANDIDATE_SORTS, sortsFor } from './candidateRank.ts';
import type { Candidate } from '../data/mockData.ts';

const base: Omit<Candidate, 'id' | 'addedMin' | 'detourKm' | 'parking'> = {
  name: 'x', note: '', arriveAt: '09:00', dwellMin: 5,
  openState: 'open', openNote: '', coord: { latitude: 0, longitude: 0 },
};
const c = (id: string, addedMin: number, detourKm: number, parking: Candidate['parking'], extra: Partial<Candidate> = {}): Candidate =>
  ({ ...base, id, addedMin, detourKm, parking, ...extra });

const ids = (list: Candidate[]) => list.map(x => x.id);

test('탭 라벨은 추천·추가시간·주차', () => {
  assert.deepEqual([...CANDIDATE_SORTS], ['추천', '추가시간', '주차']);
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
  assert.deepEqual(ids(rankCandidates(list, 1)), ['b', 'c', 'a']);
});

test('주차순 — 가능 > 어려움 > 없음, 동률이면 추가시간', () => {
  const list = [c('a', 9, 1, '없음'), c('b', 8, 1, '가능'), c('c', 5, 1, '어려움'), c('d', 3, 1, '가능')];
  assert.deepEqual(ids(rankCandidates(list, 2)), ['d', 'b', 'c', 'a']);
});

test('추천 정렬은 trend.score 내림차순', () => {
  const list = [
    c('a', 5, 1, '가능', { trend: { score: 0.2, reasons: [], hot: false } }),
    c('b', 9, 1, '가능', { trend: { score: 0.9, reasons: [], hot: true } }),
    c('c', 1, 1, '가능', { trend: { score: 0.5, reasons: [], hot: false } }),
  ];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['b', 'c', 'a']);
});

test('trend 가 없는 후보는 추천 정렬에서 뒤로 간다', () => {
  const list = [
    c('a', 5, 1, '가능'),
    c('b', 9, 1, '가능', { trend: { score: 0.3, reasons: [], hot: false } }),
  ];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['b', 'a']);
});

test('추천 정렬 — 전부 trend 가 없으면(보강 전부 실패) 추가시간으로 타이브레이크', () => {
  const list = [
    c('a', 9, 1, '가능'),
    c('b', 2, 1, '가능'),
    c('c', 5, 1, '가능'),
  ];
  assert.deepEqual(ids(rankCandidates(list, 0)), ['b', 'c', 'a']);
});

test('주차 탭은 자동차일 때만, 추천 탭은 신호가 있을 때만 — 라벨과 sort 인덱스가 같이 맞아야 한다', () => {
  // label만 보면 '추천'/sort:1, '추가시간'/sort:0 처럼 뒤바뀌어도 통과한다 —
  // 전체 객체를 비교해 라벨↔인덱스 매핑 자체를 고정한다. mode×hasTrend 6칸을 전부 덮는다.
  assert.deepEqual(sortsFor('car', true), [
    { label: '추천', sort: 0 }, { label: '추가시간', sort: 1 }, { label: '주차', sort: 2 },
  ]);
  assert.deepEqual(sortsFor('car', false), [
    { label: '추가시간', sort: 1 }, { label: '주차', sort: 2 },
  ]);
  assert.deepEqual(sortsFor('walk', true), [
    { label: '추천', sort: 0 }, { label: '추가시간', sort: 1 },
  ]);
  assert.deepEqual(sortsFor('walk', false), [
    { label: '추가시간', sort: 1 },
  ]);
  assert.deepEqual(sortsFor('transit', true), [
    { label: '추천', sort: 0 }, { label: '추가시간', sort: 1 },
  ]);
  assert.deepEqual(sortsFor('transit', false), [
    { label: '추가시간', sort: 1 },
  ]);
});

test('입력 배열은 건드리지 않는다', () => {
  const list = [c('a', 9, 1, '가능'), c('b', 1, 1, '가능')];
  rankCandidates(list, 0);
  assert.deepEqual(ids(list), ['a', 'b']);
});
