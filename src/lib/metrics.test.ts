import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metricsRequest } from './metrics.ts';

const cfg = { url: 'https://etavia-metrics.example.dev', token: 'tok', session: 'sess-1' };

test('설정이 없으면 아무것도 보내지 않는다', () => {
  // 메인 체크아웃이나 앱 빌드에는 METRICS_URL 이 없다. 거기서 조용히 꺼져야 한다 —
  // 켜져 있으면 앱이 쓰지도 않는 워커를 매번 부른다.
  assert.equal(metricsRequest({ ...cfg, url: '' }, 'hit'), null);
  assert.equal(metricsRequest({ ...cfg, session: '' }, 'hit'), null);
});

test('이벤트 하나를 POST /e 로 보낸다', () => {
  const r = metricsRequest(cfg, 'ask');
  assert.ok(r);
  assert.equal(r.url, 'https://etavia-metrics.example.dev/e');
  assert.equal(r.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(r.init.body)), { s: 'sess-1', e: 'ask' });
});

test('앱 토큰을 싣는다 — 워커가 아무나 숫자를 부풀리지 못하게 막는다', () => {
  const r = metricsRequest(cfg, 'hit');
  const h = r!.init.headers as Record<string, string>;
  assert.equal(h['x-app-token'], 'tok');
  assert.equal(h['content-type'], 'application/json');
});

test('탭을 닫아도 나가게 keepalive 를 켠다', () => {
  // 진입 비콘은 첫 화면에서 쏘는데, 바로 닫으면 평범한 fetch 는 취소된다.
  assert.equal(metricsRequest(cfg, 'hit')!.init.keepalive, true);
});

test('주소 끝 슬래시가 있어도 경로가 겹치지 않는다', () => {
  assert.equal(metricsRequest({ ...cfg, url: 'https://m.example.dev/' }, 'hit')!.url, 'https://m.example.dev/e');
});
