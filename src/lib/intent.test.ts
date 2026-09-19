import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askWhenNothingFound, extractIntent, type Intent } from './intent';

test('목 — 넓은 업종은 선택지를 함께 낸다', () => {
  const i = extractIntent('가는 길에 빵 사고 싶어', { currentStops: [] });
  assert.equal(i.stops.length, 1);
  const q = i.ambiguous.find(a => a.field.startsWith('stop:'));
  assert.ok(q, '되묻기가 있어야 한다');
  assert.ok(q!.options.length >= 2, `선택지 ${q!.options.length}개`);
  assert.ok(q!.options.includes('상관없어요'), '고르지 않을 길을 남긴다');
  // 선택지는 그 업종의 검색어여야 한다 — 고르면 그대로 검색어가 된다
  assert.ok(q!.options.some(o => o.includes('파리바게뜨') || o.includes('빵')));
});

test('목 — 카테고리 스톱이 둘이면 각자 자기 질문을 받는다 (엉뚱한 스톱에 안 붙는다)', () => {
  const i = extractIntent('마트에서 장보고 빵도 사자', { currentStops: [] });
  assert.equal(i.stops.length, 2);
  const bread = i.ambiguous.find(a => a.field === 'stop:파리바게뜨');
  const mart = i.ambiguous.find(a => a.field === 'stop:이마트');
  assert.ok(bread, '빵집 되묻기가 있어야 한다');
  assert.ok(mart, '마트 되묻기가 있어야 한다');
  assert.equal(bread!.question, '어떤 빵집으로 할까요?');
  assert.equal(mart!.question, '어떤 마트로 할까요?');
});

test('목 — NARROW 표에 없는 카테고리는 되묻지 않는다', () => {
  const i = extractIntent('빵이랑 약 사야 해', { currentStops: [] });
  assert.equal(i.stops.length, 2);
  const bread = i.ambiguous.find(a => a.field === 'stop:파리바게뜨');
  const pharmacy = i.ambiguous.find(a => a.field === 'stop:약국');
  assert.ok(bread, '빵집 되묻기가 있어야 한다');
  assert.equal(pharmacy, undefined, '약국은 NARROW 표에 없으니 되묻지 않는다');
});

test('목 — 생활 서비스와 다른 업종이 한 문장에 있으면 둘 다 잡는다', () => {
  // 2026-09-16 실기기: 이 문장이 '이마트' 하나로 떨어져 옷수선집이 통째로 사라졌다.
  // '수선'이 사전에 아예 없었다 — 못 잡은 게 아니라 볼 줄 몰랐던 것이다
  const i = extractIntent('옷수선 맡기고 마트에서 장보고 가려고', { currentStops: [] });
  assert.equal(i.stops.length, 2);
  assert.ok(
    i.stops.some(s => s.queries.includes('옷수선')),
    `수선이 빠졌다: ${i.stops.map(s => s.queries.join('|')).join(', ')}`,
  );
  assert.ok(i.stops.some(s => s.queries.includes('이마트')));
});

test('목 — 세탁"기"를 세탁소로 끌고 가지 않는다', () => {
  // 키를 '세탁'으로 짧게 자르면 여기서 경유지를 지어낸다.
  // placeCategory.ts 의 이마트24/이마트와 같은 함정이라 키를 길게 잡았다
  const i = extractIntent('세탁기 고장났는데 수리비 얼마야', { currentStops: [] });
  assert.equal(i.stops.length, 0, `환각: ${i.stops.map(s => s.queries.join('|')).join(', ')}`);
});

test('목 — 생활 서비스는 되묻지 않는다', () => {
  // 수선·열쇠·도장은 전국 브랜드가 없어 어떤 답을 들어도 검색어가 안 바뀐다.
  // 되묻기는 답이 검색어를 바꿀 때만 값어치가 있다(NARROW 주석)
  const i = extractIntent('옷수선 맡기고 갈게', { currentStops: [] });
  assert.equal(i.stops.length, 1);
  assert.equal(i.ambiguous.filter(a => a.field.startsWith('stop:')).length, 0);
});

test('목 — 브랜드로 이미 좁혀졌으면 되묻지 않는다', () => {
  // '이마트'는 브랜드명 자체에 '마트'가 들어 있어 NARROW 키워드와 겹친다.
  // kind:'brand' 가드가 없으면 이미 정해진 브랜드에도 "어떤 마트로 할까요?"를 묻게 된다.
  const i = extractIntent('이마트 들러줘', { currentStops: [] });
  assert.equal(i.stops.length, 1);
  assert.equal(i.stops[0].kind, 'brand');
  assert.equal(i.ambiguous.filter(a => a.field.startsWith('stop:')).length, 0);
});

test('near — 목도 가장 분명한 말은 잡는다. 서버가 죽어도 "회사 근처"는 살아야 한다', () => {
  assert.equal(extractIntent('회사 근처 카페에서 커피 사서 갈게', { currentStops: [] }).stops[0].near, 'end');
  assert.equal(extractIntent('집 앞 편의점 들렀다가 출발할게', { currentStops: [] }).stops[0].near, 'start');
  assert.equal(extractIntent('지하철 내려서 빵집 들렀다 갈게', { currentStops: [] }).stops[0].near, 'end');
});

test('near — 위치를 말하지 않으면 any. 목이 제약을 지어내면 안 된다', () => {
  assert.equal(extractIntent('커피 사서 회사 가려고', { currentStops: [] }).stops[0].near, 'any');
  assert.equal(extractIntent('올리브영 들렀다 갈게', { currentStops: [] }).stops[0].near, 'any');
});

test("near — '빵집 앞'의 '집'에 걸리면 안 된다. 틀리게 잡는 건 못 잡는 것보다 나쁘다", () => {
  assert.equal(extractIntent('빵집 앞 편의점 들렀다 갈게', { currentStops: [] }).stops[0].near, 'any');
  assert.equal(extractIntent('고깃집 앞 편의점 들렀다 갈게', { currentStops: [] }).stops[0].near, 'any');
  // 진짜 '집 앞'은 계속 잡혀야 한다
  assert.equal(extractIntent('집 앞 편의점 들렀다가 출발할게', { currentStops: [] }).stops[0].near, 'start');
});

test('목은 태그를 보수적으로만 낸다', () => {
  const got = extractIntent('마트 들렀다 집에 가자', { currentStops: [] });
  const add = got.stops.find(s => s.op === 'add');
  assert.equal(add?.loadBefore, 'none');
  assert.equal(add?.loadAfter, 'none');
  assert.equal(add?.needWhen, 'unknown');
});

/* known — 아래 세 테스트는 src/lib/knownPlaceMatch.ts 의 findKnownMatch 규칙을 목이
   그대로 따르는지 본다. src/state/plan.test.ts 의
   "짧은 라벨이 긴 말을 삼키지 않는다 — '포장마차집'은 집이 아니다" 가 같은 표를
   plan.tsx 의 pick() 쪽에서 돈다 — 한쪽만 고치면 둘 중 하나가 깨진다 */

test("known — 완전 일치는 한 글자여도 잡는다('집'). plan.test.ts 의 같은 이름 테스트와 짝이다", () => {
  const i = extractIntent('목적지를 집으로 바꿔줘', { currentStops: [], knownPlaces: ['집'] });
  assert.deepEqual(i.endpoints, { destination: '집' });
  assert.equal(i.ambiguous.length, 0, '아는 곳이면 안 되묻는다');
});

test("known — 짧은 라벨이 긴 말을 삼키지 않는다('포장마차집'은 '집'이 아니다). plan.test.ts 의 짝", () => {
  const i = extractIntent('목적지를 포장마차집으로 바꿔줘', { currentStops: [], knownPlaces: ['집'] });
  assert.deepEqual(i.endpoints, { destination: '포장마차집' });
  const q = i.ambiguous.find(a => a.field === 'endpoints');
  assert.ok(q, '아는 곳이 아니니 되물어야 한다 — 여기서 안 되물으면 plan.tsx 의 pick() 은 못 잡는데' + ' 화면은 아무 반응 없이 끝난다');
});

test("known — 두 글자 이상 앞자리 일치 + 공백 정규화('여의도공원 출입구8'이 '여의도 공원'으로 걸린다)", () => {
  const i = extractIntent('목적지를  여의도 공원 으로 바꿔줘', { currentStops: [], knownPlaces: ['여의도공원 출입구8'] });
  assert.deepEqual(i.endpoints, { destination: '여의도 공원' });
  assert.equal(i.ambiguous.length, 0, '아는 곳이면 안 되묻는다');
});

/* ── 아무것도 못 알아들었을 때 침묵하지 않는다 ─────────────────────────────
   이 판정은 로컬 목 안에만 있었고, 정작 비는 쪽인 **서버 응답에는 안 걸렸다**
   (`intentClient.ts` 가 모양만 보고 그대로 통과시킨다). 2026-09-19 측정에서
   LLM 이 45 케이스-회차 중 2회 경유지를 0건으로 냈는데, 화면엔 "알아들었어요"만
   뜨고 칩도 질문도 없었다. 그래서 판정을 순수 함수로 빼 양쪽이 같은 걸 쓴다. */

const empty = (over: Partial<Intent> = {}): Intent => ({
  resetStops: false, stops: [], endpoints: {}, order: 'auto',
  arriveBy: null, mode: null, reject: null, ambiguous: [], say: null, ...over,
} as Intent);

test('아무것도 못 뽑았는데 부탁처럼 보이면 되묻는다', () => {
  const out = askWhenNothingFound('나가는 길에 우산 하나 사야 해', empty());
  assert.deepEqual(out.ambiguous.map(a => a.field), ['text']);
});

test('청유형도 부탁이다 — "사자"가 정규식에서 빠져 있었다', () => {
  const out = askWhenNothingFound('걸어가면서 먹을 아이스크림 하나 사자', empty());
  assert.deepEqual(out.ambiguous.map(a => a.field), ['text'], '사자/하자/먹자 같은 청유형이 새고 있었다');
});

test('인사에는 침묵한다 — 부탁이 아닌 말까지 되물으면 성가시다', () => {
  assert.deepEqual(askWhenNothingFound('안녕', empty()).ambiguous, []);
});

test('이미 되묻고 있으면 덧붙이지 않는다', () => {
  const withAsk = empty({ ambiguous: [{ field: 'endpoints', question: '어느 집인가요?', options: [] }] });
  assert.deepEqual(askWhenNothingFound('집으로 가자', withAsk).ambiguous.map(a => a.field), ['endpoints']);
});

test('이동수단·도착시각만 바뀐 것도 알아들은 것이다', () => {
  assert.deepEqual(askWhenNothingFound('걸어서 가자', empty({ mode: 'walk' })).ambiguous, []);
  assert.deepEqual(askWhenNothingFound('9시까지 가야 해', empty({ arriveBy: 540 })).ambiguous, []);
});

test('이미 있어서 뺀 것은 못 알아들은 게 아니다', () => {
  assert.deepEqual(askWhenNothingFound('마트 들를게', empty(), { droppedAsPlanned: true }).ambiguous, []);
});

test('원본을 건드리지 않는다 — 서버 응답에도 쓰는 순수 함수다', () => {
  const src = empty();
  const out = askWhenNothingFound('우산 사야 해', src);
  assert.deepEqual(src.ambiguous, [], '입력이 변형됐다');
  assert.notEqual(out, src);
});
