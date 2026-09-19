import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  errorCopy,
  initialSpeech,
  mapErrorCode,
  mergeTranscript,
  reduceSpeech,
  volumeToLevel,
} from './speechSession';

test('start → listening, 이전 결과·오류는 지운다', () => {
  const s = reduceSpeech({ ...initialSpeech, finalText: '옛말', error: 'no-speech' }, { type: 'start' });
  assert.deepEqual(s, { phase: 'listening', interim: '', finalText: null, error: null });
});

test('부분 결과는 interim 에 쌓이고 phase 는 listening 그대로', () => {
  let s = reduceSpeech(initialSpeech, { type: 'start' });
  s = reduceSpeech(s, { type: 'result', transcript: '스타벅스', isFinal: false });
  s = reduceSpeech(s, { type: 'result', transcript: '스타벅스 들러서', isFinal: false });
  assert.equal(s.phase, 'listening');
  assert.equal(s.interim, '스타벅스 들러서');
  assert.equal(s.finalText, null);
});

test('최종 결과 → done, finalText 에 담긴다', () => {
  let s = reduceSpeech(initialSpeech, { type: 'start' });
  s = reduceSpeech(s, { type: 'result', transcript: '스타벅스 들러서 가자', isFinal: true });
  assert.deepEqual(s, { phase: 'done', interim: '', finalText: '스타벅스 들러서 가자', error: null });
});

test('최종 없이 end 가 오면 interim 을 최종으로 승격한다 — iOS 가 isFinal 없이 끝내는 경우', () => {
  let s = reduceSpeech(initialSpeech, { type: 'start' });
  s = reduceSpeech(s, { type: 'result', transcript: '약국도', isFinal: false });
  s = reduceSpeech(s, { type: 'end' });
  assert.equal(s.phase, 'done');
  assert.equal(s.finalText, '약국도');
});

test('아무 말도 없이 end 면 no-speech 오류', () => {
  let s = reduceSpeech(initialSpeech, { type: 'start' });
  s = reduceSpeech(s, { type: 'end' });
  assert.deepEqual(s, { phase: 'error', interim: '', finalText: null, error: 'no-speech' });
});

test('done 뒤에 오는 end 는 무시한다 — 결과를 두 번 내보내지 않는다', () => {
  let s = reduceSpeech(initialSpeech, { type: 'start' });
  s = reduceSpeech(s, { type: 'result', transcript: '끝', isFinal: true });
  const after = reduceSpeech(s, { type: 'end' });
  assert.deepEqual(after, s);
});

test('no-speech 오류라도 interim 이 있으면 결과로 살린다', () => {
  let s = reduceSpeech(initialSpeech, { type: 'start' });
  s = reduceSpeech(s, { type: 'result', transcript: '편의점', isFinal: false });
  s = reduceSpeech(s, { type: 'error', code: 'no-speech' });
  assert.equal(s.phase, 'done');
  assert.equal(s.finalText, '편의점');
});

test('오류 코드 매핑 — 웹 스피치 이름을 앱의 다섯 가지로', () => {
  assert.equal(mapErrorCode('not-allowed'), 'not-allowed');
  assert.equal(mapErrorCode('no-speech'), 'no-speech');
  assert.equal(mapErrorCode('network'), 'network');
  assert.equal(mapErrorCode('service-not-allowed'), 'unavailable');
  assert.equal(mapErrorCode('language-not-supported'), 'unavailable');
  assert.equal(mapErrorCode('audio-capture'), 'other');
  assert.equal(mapErrorCode('aborted'), 'other');
});

test('오류 문구 — 한 줄 존댓말, 권한은 설정 안내', () => {
  assert.equal(errorCopy('not-allowed'), '설정에서 마이크·음성 인식을 켜 주세요');
  assert.equal(errorCopy('no-speech'), '잘 못 들었어요. 다시 말해 주세요');
  assert.equal(errorCopy('network'), '인터넷이 없어 음성 인식을 못 했어요');
  assert.equal(errorCopy('unavailable'), '이 기기에서는 음성 인식을 쓸 수 없어요');
  assert.equal(errorCopy('other'), '음성 인식이 중단됐어요. 다시 눌러 주세요');
});

test('이어 붙이기 — 공백 하나, 양끝 정리, 빈 쪽은 무시', () => {
  assert.equal(mergeTranscript('', '스타벅스 들러서'), '스타벅스 들러서');
  assert.equal(mergeTranscript('약국도 ', ' 스타벅스 들러서 '), '약국도 스타벅스 들러서');
  assert.equal(mergeTranscript('약국도', ''), '약국도');
  assert.equal(mergeTranscript('   ', '  '), '');
});

test('음량 정규화 — -2~10 을 0~1 로, 0 이하는 안 들리는 것', () => {
  assert.equal(volumeToLevel(-2), 0);
  assert.equal(volumeToLevel(0), 0);
  assert.equal(volumeToLevel(5), 0.5);
  assert.equal(volumeToLevel(10), 1);
  assert.equal(volumeToLevel(14), 1);
});
