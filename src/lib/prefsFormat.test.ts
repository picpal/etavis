/**
 * 설정 읽기 — 깨진 파일이 화면을 깨지 않아야 한다.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { DEFAULT_PREFS, parsePrefs, serializePrefs, type Prefs } from './prefsFormat';

test('저장된 게 없으면 기본값 — 팁은 아직 안 본 것으로 본다', () => {
  assert.deepEqual(parsePrefs(null), { tipSeen: false });
  assert.deepEqual(parsePrefs(undefined), { tipSeen: false });
  assert.deepEqual(parsePrefs(''), { tipSeen: false });
});

test('정상 JSON 은 그대로 읽는다', () => {
  assert.deepEqual(parsePrefs('{"tipSeen":true}'), { tipSeen: true });
});

test('깨진 JSON 은 기본값으로 — 던지면 A2 가 통째로 안 뜬다', () => {
  assert.deepEqual(parsePrefs('{tipSeen'), { tipSeen: false });
  assert.deepEqual(parsePrefs('null'), { tipSeen: false });
  assert.deepEqual(parsePrefs('[1,2]'), { tipSeen: false });
  assert.deepEqual(parsePrefs('42'), { tipSeen: false });
});

test('타입이 틀린 값은 그 키만 기본값 — 옛 버전이 남긴 모양을 화면에 들이지 않는다', () => {
  assert.deepEqual(parsePrefs('{"tipSeen":"yes"}'), { tipSeen: false });
  assert.deepEqual(parsePrefs('{"tipSeen":1}'), { tipSeen: false });
});

test('모르는 키는 버린다 — 지운 설정이 파일에 남았다가 되살아나면 안 된다', () => {
  const out = parsePrefs('{"tipSeen":true,"지운설정":"쓰레기"}') as Prefs & Record<string, unknown>;
  assert.deepEqual(Object.keys(out), Object.keys(DEFAULT_PREFS));
  assert.equal(out.tipSeen, true);
});

test('쓰고 다시 읽으면 같은 값 — 왕복이 맞아야 저장이 의미가 있다', () => {
  for (const p of [{ tipSeen: false }, { tipSeen: true }] as Prefs[]) {
    assert.deepEqual(parsePrefs(serializePrefs(p)), p);
  }
});

test('기본값을 남에게 빌려주지 않는다 — 부르는 쪽이 고쳐도 다음 호출이 오염되면 안 된다', () => {
  const a = parsePrefs(null);
  a.tipSeen = true;
  assert.equal(parsePrefs(null).tipSeen, false);
  assert.equal(DEFAULT_PREFS.tipSeen, false);
});
