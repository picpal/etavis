import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSpeechAvailable, readSpeechResults, micLevelFromTimeDomain } from './speechBrowser.ts';

test('브라우저가 음성 인식을 지원하는지 본다 — 표준·webkit 둘 다', () => {
  // Chrome·Edge 는 webkit 접두사로만 준다. 하나라도 있으면 버튼을 보여야 하고,
  // 없으면(Firefox) 숨어야 한다 — 눌러도 아무 일 없는 버튼이 제일 나쁘다.
  assert.equal(isSpeechAvailable({ SpeechRecognition: class {} }), true);
  assert.equal(isSpeechAvailable({ webkitSpeechRecognition: class {} }), true);
  assert.equal(isSpeechAvailable({}), false);
  assert.equal(isSpeechAvailable(undefined), false);
});

test('부분 결과가 여러 조각으로 와도 하나로 이어 읽는다', () => {
  // Web Speech 는 results 를 누적 배열로 준다. 마지막 조각만 읽으면
  // 앞서 확정된 말이 화면에서 사라진다.
  assert.deepEqual(readSpeechResults([{ transcript: '스타벅스', isFinal: false }]), {
    transcript: '스타벅스',
    isFinal: false,
  });
  assert.deepEqual(
    readSpeechResults([
      { transcript: '스타벅스', isFinal: true },
      { transcript: '들러서 가자', isFinal: false },
    ]),
    { transcript: '스타벅스 들러서 가자', isFinal: false },
  );
});

test('마지막 조각까지 확정돼야 최종이다', () => {
  // 하나라도 흐르는 중이면 입력창에 밀어 넣으면 안 된다 — 말이 잘린 채 들어간다.
  assert.equal(
    readSpeechResults([
      { transcript: '교촌치킨', isFinal: true },
      { transcript: '들러줘', isFinal: true },
    ]).isFinal,
    true,
  );
  assert.equal(
    readSpeechResults([
      { transcript: '교촌치킨', isFinal: true },
      { transcript: '들러', isFinal: false },
    ]).isFinal,
    false,
  );
});

test('결과가 비어 있어도 터지지 않는다', () => {
  assert.deepEqual(readSpeechResults([]), { transcript: '', isFinal: false });
  assert.equal(readSpeechResults([{ transcript: '  스타벅스  ', isFinal: true }]).transcript, '스타벅스');
});

test('조용하면 음량 0, 최대 진폭이면 1', () => {
  // Web Speech 에는 volumechange 가 없다. 파형을 직접 재는데, 여기서 0 을 못 내면
  // 말하지 않아도 막대가 흔들려 "듣고 있다"는 거짓 신호를 준다.
  const silence = new Uint8Array(64).fill(128); // 8비트 시간영역의 무음은 128
  assert.equal(micLevelFromTimeDomain(silence), 0);

  const fullScale = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0));
  assert.equal(micLevelFromTimeDomain(fullScale), 1);
});

test('음량은 0~1 에 갇히고 커질수록 커진다', () => {
  const at = (amp: number) => micLevelFromTimeDomain(Uint8Array.from({ length: 64 }, (_, i) => 128 + (i % 2 ? amp : -amp)));
  const quiet = at(3);
  const loud = at(13);

  assert.ok(quiet > 0 && quiet < 1, `작은 소리는 0과 1 사이여야 한다: ${quiet}`);
  assert.ok(loud > quiet, `큰 소리가 더 커야 한다: ${loud} vs ${quiet}`);
  assert.ok(at(127) <= 1, '1을 넘으면 막대가 통을 뚫는다');
});
