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

test('목 — 좁은 질의는 되묻지 않는다', () => {
  const i = extractIntent('올리브영 들르고 싶어', { currentStops: [] });
  assert.equal(i.ambiguous.filter(a => a.field.startsWith('stop:')).length, 0);
});
