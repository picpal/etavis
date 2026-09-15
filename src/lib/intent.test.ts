import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIntent } from './intent';

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

test('목 — 브랜드로 이미 좁혀졌으면 되묻지 않는다', () => {
  // '이마트'는 브랜드명 자체에 '마트'가 들어 있어 NARROW 키워드와 겹친다.
  // kind:'brand' 가드가 없으면 이미 정해진 브랜드에도 "어떤 마트로 할까요?"를 묻게 된다.
  const i = extractIntent('이마트 들러줘', { currentStops: [] });
  assert.equal(i.stops.length, 1);
  assert.equal(i.stops[0].kind, 'brand');
  assert.equal(i.ambiguous.filter(a => a.field.startsWith('stop:')).length, 0);
});
