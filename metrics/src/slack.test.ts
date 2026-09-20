import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from './slack.ts';
import type { Stats } from './aggregate.ts';

const busy: Stats = { visitors: 23, asks: 41, askers: 12, plans: 7, avgAsks: 3.4, maxAsks: 9 };
const quiet: Stats = { visitors: 0, asks: 0, askers: 0, plans: 0, avgAsks: 0, maxAsks: 0 };

const make = (stats: Stats, prevVisitors: number | null = null) =>
  buildReport({ stats, prevVisitors, windowLabel: '09-21 14:00~15:00', demoUrl: 'https://etavia-demo.picpal.workers.dev' });

const dump = (p: unknown) => JSON.stringify(p);

test('헤더는 plain_text 다 — Slack 은 header 블록에 mrkdwn 을 거부한다', () => {
  const header = (make(busy).blocks as { type: string; text?: { type: string } }[]).find(b => b.type === 'header');
  assert.ok(header, 'header 블록이 있어야 한다');
  assert.equal(header.text?.type, 'plain_text');
});

test('굵게는 별 하나다 — 마크다운 `**` 은 Slack 에서 그대로 보인다', () => {
  const s = dump(make(busy));
  assert.ok(!s.includes('**'), `별 두 개가 남아 있다: ${s}`);
  assert.ok(s.includes('*'), '굵게 표기를 아예 안 쓰면 읽기 어렵다');
});

test('마크다운 헤딩과 표 문법을 쓰지 않는다 — Slack 은 못 알아본다', () => {
  const s = dump(make(busy));
  assert.ok(!/\\n#{1,6} /.test(s), '`# 제목` 은 Slack 에서 글자로 보인다');
  assert.ok(!s.includes('|---'), '표는 Slack 에 없다');
});

test('링크는 Slack 문법이다', () => {
  const s = dump(make(busy));
  assert.ok(s.includes('<https://etavia-demo.picpal.workers.dev|'), `Slack 링크 문법이 아니다: ${s}`);
  assert.ok(!/\[[^\]]+\]\(https?:/.test(s), '마크다운 링크는 그대로 글자로 보인다');
});

test('숫자는 필드로 나눠 한눈에 보이게 한다', () => {
  const blocks = make(busy).blocks as { type: string; fields?: { type: string; text: string }[] }[];
  const fields = blocks.find(b => Array.isArray(b.fields))?.fields ?? [];
  assert.ok(fields.length >= 4, '방문·질문·확정·질문자는 각각 보여야 한다');
  assert.ok(fields.length <= 10, 'Slack 은 section 당 필드 10개까지다');
  assert.ok(fields.every(f => f.type === 'mrkdwn'), '필드는 mrkdwn 이어야 굵게가 먹는다');
  const joined = fields.map(f => f.text).join(' ');
  for (const n of ['23', '41', '7', '12']) assert.ok(joined.includes(n), `${n} 이 필드에 없다: ${joined}`);
});

test('직전 시간 대비 증감을 붙인다', () => {
  assert.ok(dump(make(busy, 15)).includes('+8'), '늘었으면 +8');
  assert.ok(dump(make(busy, 30)).includes('-7'), '줄었으면 -7');
  const same = dump(make(busy, 23));
  assert.ok(!same.includes('+0') && !same.includes('-0'), '변화가 없으면 +0 을 쓰지 않는다');
});

test('직전 시간 값이 없으면 증감을 지어내지 않는다', () => {
  const s = dump(make(busy, null));
  assert.ok(!s.includes('+') || !/[+-]\d+/.test(s), `비교 대상이 없는데 증감을 붙였다: ${s}`);
});

test('아무도 안 왔으면 한 줄로 줄인다 — 밤새 같은 카드가 쌓이면 아무도 안 본다', () => {
  const blocks = make(quiet).blocks as { type: string }[];
  assert.equal(blocks.length, 1, `조용한 시간엔 블록 하나여야 한다: ${dump(make(quiet))}`);
  assert.notEqual(blocks[0].type, 'header');
  assert.ok(dump(make(quiet)).includes('09-21 14:00~15:00'), '언제인지는 남아야 cron 이 살아 있는지 안다');
});

test('시간 구간을 반드시 적는다', () => {
  assert.ok(dump(make(busy)).includes('09-21 14:00~15:00'));
});

test('집계를 못 읽었으면 "방문 없음"이 아니라 고장났다고 말한다', () => {
  // AE 조회가 실패해도 빈 배열이 오면 리포트는 "방문 없음"과 구별되지 않는다.
  // 토큰이 만료돼 아무것도 못 읽는 상태가 조용한 새벽처럼 보이면, 며칠을 모르고 지난다.
  const p = buildReport({
    stats: quiet, prevVisitors: null, windowLabel: '09-21 14:00~15:00',
    demoUrl: 'https://etavia-demo.picpal.workers.dev', failed: true,
  });
  const s = dump(p);
  assert.ok(!s.includes('방문 없음'), '고장을 조용한 시간으로 보고하면 안 된다');
  assert.ok(/집계|조회|실패/.test(s), `무엇이 잘못됐는지 말해야 한다: ${s}`);
});
