import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from './schema';

test('ambiguous options — 문자열만, 최대 4개, 각 20자', () => {
  const i = parseIntent({
    stops: [], endpoints: {}, ambiguous: [
      { field: 'stop:빵집', question: '어떤 빵집으로 할까요?', options: ['파리바게뜨', '뚜레쥬르', '동네 빵집', '상관없어요', '다섯번째'] },
    ],
  });
  assert.equal(i!.ambiguous[0].field, 'stop:빵집');
  assert.deepEqual(i!.ambiguous[0].options, ['파리바게뜨', '뚜레쥬르', '동네 빵집', '상관없어요']);
});

test('ambiguous options — 없거나 이상하면 빈 배열', () => {
  const none = parseIntent({ stops: [], endpoints: {}, ambiguous: [{ field: 'mode', question: '어떤 이동수단으로 갈까요?' }] });
  assert.deepEqual(none!.ambiguous[0].options, []);
  const junk = parseIntent({ stops: [], endpoints: {}, ambiguous: [{ field: 'mode', question: '뭘로 갈까요?', options: [1, null, { a: 1 }, '카페'] }] });
  assert.deepEqual(junk!.ambiguous[0].options, ['카페'], '문자열 아닌 건 버린다');
});
