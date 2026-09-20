import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCandidates, rankClusters, CANDIDATE_SORTS, sortsFor } from './candidateRank.ts';
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

// ── 묶음 ─────────────────────────────────────────────────────────────────────
// 시트가 그리는 단위는 후보가 아니라 자리다. 250m 안 30곳을 30줄로 세우면 선택지가
// 30개라는 거짓말이고, 그 30줄의 시간 차이는 구간 추정 오차보다 작아 정보가 아니다

/** 위도 1e-5 ≈ 1.1m. m 를 좌표로 바꿔 쓴다 */
const at = (m: number) => ({ latitude: 37.5528 + m / 111_320, longitude: 126.9245 });
const g = (id: string, addedMin: number, m: number, extra: Partial<Candidate> = {}): Candidate =>
  ({ ...base, id, name: id, addedMin, detourKm: 0, parking: '모름', coord: at(m), ...extra });

test('rankClusters — 250m 안은 한 자리로 접힌다', () => {
  const list = [g('a', 5, 0), g('b', 6, 120), g('c', 7, 240), g('d', 9, 4000)];
  const out = rankClusters(list, 1);
  assert.deepEqual(out.map(x => x.members.length), [3, 1]);
  assert.deepEqual(out.map(x => x.id), ['a', 'd']);
});

test('추가시간 탭은 묶음 대표 Δ 로 묶음을 세우고 묶음 안은 흩지 않는다', () => {
  // 먼 자리가 더 빠르다 — 묶음 순서는 뒤집히지만 가까운 자리의 두 곳은 그대로 붙어 있다
  const list = [g('가', 8, 0), g('나', 9, 100), g('멀리', 2, 4000)];
  const out = rankClusters(list, 1);
  assert.deepEqual(out.map(x => x.id), ['멀리', '가']);
  assert.deepEqual(ids(out[1].members), ['가', '나']);
});

test('묶음 안 순서는 시간이 아니라 평점·언급이 정한다 — 시간이 같으니 시간으로 세우면 임의다', () => {
  const list = [
    g('시간1위', 3, 0),
    g('점수1위', 7, 60, { trend: { score: 90, reasons: [], hot: false } }),
    g('점수2위', 5, 90, { trend: { score: 50, reasons: [], hot: false } }),
  ];
  const [only] = rankClusters(list, 1);
  // 대표는 실측이 없으니 trend 1위. 나머지도 trend → 영업 → 이름이고 추가시간은 안 본다
  assert.deepEqual(ids(only.members), ['점수1위', '점수2위', '시간1위']);
});

test('묶음 안에서 곧 마감은 뒤로 — 시간이 같으면 못 들를 위험이 순서를 가른다', () => {
  const list = [g('곧마감', 3, 0, { openState: 'closing_soon' }), g('영업', 5, 60)];
  const [only] = rankClusters(list, 1);
  assert.deepEqual(ids(only.members), ['영업', '곧마감']);
});

test('묶음 대표는 실측된 후보다 — 묶음의 시간을 말하는 자리라 잰 값이 먼저다', () => {
  const list = [g('추정', 3, 0, { trend: { score: 99, reasons: [], hot: false } }), g('실측', 6, 60, { cls: 'measured' })];
  const [only] = rankClusters(list, 1);
  assert.equal(only.lead.id, '실측');
});

test('지금 경로에 든 곳이 자기 자리의 대표다 — 접힌 안쪽으로 사라지면 뭐가 들어가 있는지 못 찾는다', () => {
  // 묶기 전에는 추가시간 0 이라 늘 맨 위였다. 대표 규칙에 넣지 않았더니 화면에서 사라졌다
  const list = [g('현재', 0, 0), g('이웃', 2, 60, { trend: { score: 99, reasons: [], hot: false } })];
  const [only] = rankClusters(list, 1, '현재');
  assert.equal(only.lead.id, '현재');
  // 그리고 대표 Δ 로 묶음을 세우니 그 자리가 목록 맨 위다
  assert.equal(rankClusters([...list, g('먼곳', 1, 4000)], 1, '현재')[0].id, '현재');
});

test('마감한 곳은 묶이기 전에 빠진다 — 못 고르는 곳이 대표가 되면 그 자리 전체가 막힌다', () => {
  const list = [g('마감', 3, 0, { openState: 'closed', cls: 'measured' }), g('영업', 5, 60)];
  const [only] = rankClusters(list, 1);
  assert.deepEqual(ids(only.members), ['영업']);
});
