import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipLabel, narrowStopChips, resetChatChips, resetConditionChips, shouldKeepCommittedPlan, syncConditionChips } from './chips';
import type { IntentChip } from './plan';

let seq = 0;
const nextId = (k: 'a') => `${k}-${seq++}`;
const stop = (id: string, queries: string[] = ['약국']): IntentChip => ({
  id, kind: 'stop', label: '약국', queries, stopKind: 'category', openNow: false, flexible: true,
});
const arriveChip = (id: string, value: number, label: string): IntentChip =>
  ({ id, kind: 'arriveBy', label, value });

test('이동수단은 칩으로 만들지 않는다 — 헤더 셀렉트가 유일한 조작점이다', () => {
  const out = syncConditionChips([stop('s-1')], { mode: 'transit', arriveByMin: null }, nextId);
  assert.deepEqual(out.map(c => c.kind), ['stop'], '지워도 안 지워지는 이동수단 칩을 두지 않는다');
});

test('이미 있던 도착 시각 칩은 id 를 유지한다 — 새 id 를 주면 목록이 다시 그려져 깜빡인다', () => {
  const out = syncConditionChips([arriveChip('a-keep', 540, '09:00까지')], { mode: 'car', arriveByMin: 600 }, nextId);
  const a = out.find(c => c.kind === 'arriveBy')!;
  assert.equal(a.id, 'a-keep');
  assert.equal(a.label, '10:00까지');
});

test('도착 시각을 정하면 칩이 생기고, 상관없어요로 바꾸면 사라진다', () => {
  const withTime = syncConditionChips([], { mode: 'car', arriveByMin: 540 }, nextId);
  assert.equal(withTime.find(c => c.kind === 'arriveBy')!.label, '09:00까지');

  const cleared = syncConditionChips(withTime, { mode: 'car', arriveByMin: null }, nextId);
  assert.equal(cleared.find(c => c.kind === 'arriveBy'), undefined, '없는 조건을 칩으로 두면 지울 수 있는 것처럼 보인다');
});

test('경유지 칩은 건드리지 않고 순서도 유지한다', () => {
  const out = syncConditionChips([stop('s-1'), stop('s-2')], { mode: 'walk', arriveByMin: 600 }, nextId);
  assert.deepEqual(out.filter(c => c.kind === 'stop').map(c => c.id), ['s-1', 's-2']);
  // 경유지 → 도착 시각 (APPLY_INTENT 와 같은 순서)
  assert.deepEqual(out.map(c => c.kind), ['stop', 'stop', 'arriveBy']);
});

test('도착 시각 칩이 중복으로 쌓이지 않는다 — 여러 번 바꿔도 하나다', () => {
  let chips: IntentChip[] = [stop('s-1')];
  for (const min of [540, 600, 660]) {
    chips = syncConditionChips(chips, { mode: 'car', arriveByMin: min }, nextId);
  }
  assert.equal(chips.filter(c => c.kind === 'arriveBy').length, 1);
  assert.equal(chips.find(c => c.kind === 'arriveBy')!.label, '11:00까지');
});

/* resetConditionChips — A2 뒤로가기에서 "대화 전"으로 되돌릴 때 쓴다.
   경유지 칩은 대화가 만든 것이라 버리고, 조건은 진입 시점 값으로 다시 맞춘다 */

test('resetConditionChips — 대화가 만든 경유지 칩이 사라진다', () => {
  const out = resetConditionChips(
    [stop('s-1'), stop('s-2'), arriveChip('a-1', 540, '09:00까지')],
    { mode: 'car', arriveByMin: 540 }, nextId,
  );
  assert.deepEqual(out.map(c => c.kind), ['arriveBy']);
});

test('resetConditionChips — 대화가 바꾼 도착 시각도 진입 시점 값으로 되돌아온다', () => {
  // 대화로 21:00까지가 됐지만, A2에 들어올 때는 09:00까지였다
  const out = resetConditionChips(
    [stop('s-1'), arriveChip('a-1', 1260, '21:00까지')],
    { mode: 'car', arriveByMin: 540 }, nextId,
  );
  assert.equal(out.find(c => c.kind === 'arriveBy')!.label, '09:00까지');
});

test('resetConditionChips — 진입 시점이 상관없어요였으면 도착 시각 칩도 남지 않는다', () => {
  const out = resetConditionChips(
    [stop('s-1'), arriveChip('a-1', 1260, '21:00까지')],
    { mode: 'car', arriveByMin: null }, nextId,
  );
  assert.deepEqual(out, []);
});

test('narrowStopChips — 고른 값 하나로 queries 를 좁히고 narrowed 를 세운다. stopKind 는 그대로 둔다', () => {
  const target = stop('s-1');
  const [narrowed] = narrowStopChips([target], 's-1', '파리바게뜨');
  // queries[0] 만 보면 요소를 덧붙이고도 통과한다 — 배열 자체를 [query] 하나로 단언한다
  assert.deepEqual(narrowed.kind === 'stop' ? narrowed.queries : null, ['파리바게뜨']);
  assert.equal(narrowed.label, '파리바게뜨');
  // stopKind 는 "사용자가 무엇이라 불렀나"라 좁히기로 안 바뀐다 — runPlan.ts 의
  // 보강·트렌드 스왑이 category 를 보고 계속 돌아야 한다
  assert.equal(narrowed.kind === 'stop' ? narrowed.stopKind : null, 'category');
  assert.equal(narrowed.kind === 'stop' ? narrowed.narrowed : null, true);
});

test('narrowStopChips — queries 가 다른 칩은 건드리지 않는다(같은 객체 참조)', () => {
  const target = stop('s-1');
  const other = stop('s-2', ['약']); // queries 가 target 과 달라 같이 좁혀지면 안 된다
  const arrive = arriveChip('a-1', 540, '09:00까지');
  const out = narrowStopChips([target, other, arrive], 's-1', '파리바게뜨');
  assert.equal(out[1], other, '다른 queries 를 가진 칩은 같은 객체여야 한다');
  assert.equal(out[2], arrive, '조건 칩은 같은 객체여야 한다');
});

test('narrowStopChips — 모르는 chipId 면 같은 배열 참조를 돌려준다', () => {
  const chips: IntentChip[] = [stop('s-1')];
  const out = narrowStopChips(chips, 'no-such-id', '파리바게뜨');
  assert.equal(out, chips, '매칭이 없으면 새 배열을 만들지 않는다 — 호출부가 이걸로 무변화를 판단한다');
});

test('narrowStopChips — count>1 로 칩이 복제됐어도 같은 queries 의 칩을 전부 좁힌다', () => {
  const a = stop('s-1', ['빵집']);
  const b = stop('s-2', ['빵집']); // APPLY_INTENT 가 count=2 로 복제한 같은 스톱
  const c = stop('s-3', ['마트']); // 다른 스톱 — 건드리면 안 된다
  const out = narrowStopChips([a, b, c], 's-1', '파리바게뜨');
  const [na, nb] = out;
  assert.deepEqual(na.kind === 'stop' ? na.queries : null, ['파리바게뜨']);
  assert.deepEqual(nb.kind === 'stop' ? nb.queries : null, ['파리바게뜨'], 'chipId 로 탭하지 않은 두 번째 빵집 칩도 같이 좁혀져야 한다');
  assert.equal(nb.kind === 'stop' ? nb.narrowed : null, true);
  assert.equal(out[2], c, '다른 스톱(마트) 칩은 같은 객체여야 한다');
});

test('narrowStopChips — 이미 좁힌 칩을 다시 좁히려 하면 같은 배열을 그대로 돌려준다', () => {
  const chips: IntentChip[] = [
    { id: 's-1', kind: 'stop', label: '파리바게뜨', queries: ['파리바게뜨'], stopKind: 'category', openNow: false, flexible: true, narrowed: true },
  ];
  assert.equal(narrowStopChips(chips, 's-1', '뚜레쥬르'), chips, '참조가 같아야 재계산을 건너뛴다');
});

test('확정한 뒤의 대화 되돌리기는 칩을 건드리지 않는다', () => {
  /* 2026-09-16 실기 로그: `plan.apply {count:2}` 바로 다음 줄이 `chat.reset {stops:2}`였고
     진행 중 탭이 경유지 0곳으로 떴다. A5의 확인이 A2를 스택에서 빼면서 `beforeRemove`가
     포커스 없이 깨어나 "대화를 버린다" 가지를 탄 것이다 — 버릴 대화가 이미 계획이 된 뒤였다 */
  const chips = [stop('s-1'), arriveChip('a-1', 540, '09:00까지')];
  const out = resetChatChips(chips, { mode: 'car', arriveByMin: 540 }, nextId, true);
  assert.equal(out, chips, '같은 배열 참조 — 호출부가 이걸로 재계산을 건너뛴다');
});

test('확정 전이면 그대로 되돌린다 — 경유지 칩은 대화가 만든 것이다', () => {
  const chips = [stop('s-1'), stop('s-2')];
  const out = resetChatChips(chips, { mode: 'car', arriveByMin: null }, nextId, false);
  assert.deepEqual(out.map(c => c.kind), [], '경유지 칩은 전부 버린다');
});

/* `resetChat` 을 부르는 자리가 둘인데 목적이 다르다. 하나로 뭉뚱그렸더니 확정 뒤
   '새로 계획하기' 로 들어가도 이전 대화의 경유지 칩('약국'·'닭강정집')이 그대로 남았다 */

test('대화에서 나갈 때는 확정된 계획을 지키지 않는다 — 방금 확정한 것이 지워지면 안 된다', () => {
  assert.equal(shouldKeepCommittedPlan('leavingChat', true), true);
});

test('확정한 적 없으면 나갈 때도 대화를 되돌린다', () => {
  assert.equal(shouldKeepCommittedPlan('leavingChat', false), false);
});

test('새 계획을 시작할 때는 확정돼 있어도 지운다 — 이전 대화의 칩이 남으면 안 된다', () => {
  assert.equal(shouldKeepCommittedPlan('startingNewPlan', true), false);
});


/* ── 칩이 정해진 가게 이름을 말한다 ──────────────────────────────────────
   확정된 계획으로 돌아온 대화 화면이 `마트 ✕` 라고 쓰면 사용자는 그걸 **키워드**로
   읽는다. 실제로는 이미 `한청할인마트` 한 곳으로 정해져 있는데. 그 어긋남이
   "대화로 하나 더 추가했더니 가게가 바뀌었다"를 이상하게 느끼지 않게 만든 원인이다 —
   화면이 애초에 무엇이 정해졌는지 말하지 않았다.

   **칩의 `label` 을 고쳐 쓰지 않는다.** 고쳐 쓰면 같은 사실의 사본이 하나 더 생겨
   리듀서마다 동기화해야 한다(v1 이 반려된 이유). 그릴 때 `state.stops` 에서 읽는다. */
const resolvedStop = (baseId: string, name: string) => ({ baseId, name });

test('정해진 가게가 있으면 칩이 그 이름을 말한다 — 화면이 무엇이 정해졌는지 말해야 한다', () => {
  assert.equal(chipLabel(stop('c1', ['마트']), [resolvedStop('c1', '한청할인마트')]), '한청할인마트');
});

test('아직 안 정해졌으면 원래 라벨 그대로 — 없는 사실을 지어내지 않는다', () => {
  assert.equal(chipLabel(stop('c1', ['마트']), []), '약국');
  assert.equal(chipLabel(stop('c1', ['마트']), [resolvedStop('c2', '한청할인마트')]), '약국');
});

test('조건 칩은 건드리지 않는다 — 가게 이름이 붙을 자리가 아니다', () => {
  assert.equal(chipLabel(arriveChip('a1', 1080, '18:00까지'), [resolvedStop('a1', '한청할인마트')]), '18:00까지');
});
