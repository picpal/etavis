import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleReason, parseReasonRequest, parseReasonResponse, MAX_REASON_BODY_BYTES } from './reason';

const okBody = {
  text: '지하철 타고 가는데 마트 들러서 장 보고 약국 갔다 집에 갈게',
  mode: 'transit',
  fast: { stops: ['이마트 역삼점', '온누리약국'], totalMin: 40 },
  comfort: { stops: ['온누리약국', '이마트 역삼점'], totalMin: 52 },
};

/* ── 입력 ─────────────────────────────────────────────
   v1·v2 는 출력만 검증하고 입력을 안 봤다. 그건 방어선이 아니다 */

test('정상 요청은 그대로 통과한다', () => {
  const r = parseReasonRequest(okBody);
  assert.ok(r);
  assert.equal(r.mode, 'transit');
  assert.equal(r.fast.totalMin, 40);
  assert.deepEqual(r.comfort.stops, ['온누리약국', '이마트 역삼점']);
});

test('객체가 아니면 거부한다', () => {
  for (const bad of [null, undefined, 'x', 3, []]) assert.equal(parseReasonRequest(bad), null);
});

test('모드가 셋 중 하나가 아니면 거부한다 — 편의 판단이 모드에 달려 있다', () => {
  assert.equal(parseReasonRequest({ ...okBody, mode: 'bike' }), null);
  assert.equal(parseReasonRequest({ ...okBody, mode: undefined }), null);
});

test('두 안 중 하나라도 없으면 거부한다 — 비교할 게 없다', () => {
  assert.equal(parseReasonRequest({ ...okBody, comfort: undefined }), null);
  assert.equal(parseReasonRequest({ ...okBody, fast: { stops: [], totalMin: 40 } }), null);
});

test('소요시간이 수가 아니거나 범위를 벗어나면 거부한다', () => {
  for (const bad of [0, -5, 1440, 99999, NaN, Infinity, '40']) {
    assert.equal(parseReasonRequest({ ...okBody, fast: { stops: ['ㄱ'], totalMin: bad } }), null, String(bad));
  }
});

test('문장과 장소명은 자른다 — 프롬프트를 부풀리지 못하게', () => {
  const r = parseReasonRequest({
    ...okBody,
    text: 'ㄱ'.repeat(900),
    fast: { stops: ['ㄴ'.repeat(90)], totalMin: 40 },
  });
  assert.equal(r?.text.length, 500);
  assert.equal(r?.fast.stops[0].length, 40);
});

test('경유지가 너무 많으면 자른다', () => {
  const r = parseReasonRequest({ ...okBody, fast: { stops: Array(20).fill('ㄱ'), totalMin: 40 } });
  assert.equal(r?.fast.stops.length, 6);
});

/* ── 출력 ─────────────────────────────────────────────
   codex 가 'why 는 임의 문자열이고 숫자만 검사한다'고 지적했다.
   아래 거절 케이스는 전부 그때 codex 가 든 예시다 — 숫자 없이 통과하던 것들이다 */

test('정상 설명은 통과한다', () => {
  assert.equal(parseReasonResponse({ why: '장 본 걸 들고 약국에 들어가지 않아도 돼요' }),
    '장 본 걸 들고 약국에 들어가지 않아도 돼요');
  assert.equal(parseReasonResponse({ why: '무거운 짐을 마지막에 들어요' }), '무거운 짐을 마지막에 들어요');
});

test('숫자가 있으면 버린다 — 시간은 코드가 잰다', () => {
  assert.equal(parseReasonResponse({ why: '12분 더 걸려요' }), null);
});

test('숫자 없는 사실 주장도 버린다 — codex 가 뚫은 예시들', () => {
  for (const why of [
    '두 배 더 걸려요',
    '십 분쯤 늦어요',
    '반나절 걸려요',
    '한 시간 안에 도착해요',
    '훨씬 빠른 길이에요',
    '문 닫기 전에 갈 수 있어요',
    '가장 가까운 곳이에요',
  ]) {
    assert.equal(parseReasonResponse({ why }), null, why);
  }
});

test('빈 문자열·공백만이면 버린다', () => {
  assert.equal(parseReasonResponse({ why: '' }), null);
  assert.equal(parseReasonResponse({ why: '   ' }), null);
  assert.equal(parseReasonResponse({ why: 3 }), null);
  assert.equal(parseReasonResponse(null), null);
});

test('개행·제어문자는 지운다 — 한 줄 자리에 들어간다', () => {
  assert.equal(parseReasonResponse({ why: '짐을 들고\n갈아타지 않아도 돼요' }), '짐을 들고 갈아타지 않아도 돼요');
});

test('60자를 넘으면 자른다 — 한 줄 높이가 고정이다', () => {
  const long = '짐'.repeat(100);
  assert.equal(parseReasonResponse({ why: long })?.length, 60);
});

test('본문 상한은 JSON 파싱 전에 쓸 수 있게 바이트로 준다', () => {
  assert.equal(typeof MAX_REASON_BODY_BYTES, 'number');
  assert.ok(MAX_REASON_BODY_BYTES > 0 && MAX_REASON_BODY_BYTES <= 16 * 1024);
});

/* ── 핸들러 ───────────────────────────────────────────
   설명은 장식이지 기능이 아니다 — 무슨 일이 나도 경로 화면이 시끄러워지면 안 된다 */

const ENV = { OPENAI_API_KEY: 'k' };
const reply = (content: string) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch;

test('정상이면 문구가 온다', async () => {
  const res = await handleReason(okBody, ENV, { fetch: reply('{"why":"장 본 걸 들고 약국에 들어가지 않아도 돼요"}') });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { why: '장 본 걸 들고 약국에 들어가지 않아도 돼요' });
});

test('요청이 이상하면 422 — LLM 을 부르기도 전에 막는다', async () => {
  let called = false;
  const res = await handleReason({ mode: 'bike' }, ENV, {
    fetch: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
  });
  assert.equal(res.status, 422);
  assert.equal(called, false, '돈이 나가는 호출 앞에서 끊어야 의미가 있다');
});

test('금지된 주장이 오면 문구를 버리고 200 을 낸다 — 토글은 그대로 뜬다', async () => {
  const res = await handleReason(okBody, ENV, { fetch: reply('{"why":"훨씬 빠른 길이에요"}') });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { why: null });
});

test('OpenAI 가 죽어도 200 에 why: null — 경로 화면을 시끄럽게 만들지 않는다', async () => {
  const dead = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const res = await handleReason(okBody, ENV, { fetch: dead });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { why: null });

  const err = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await (await handleReason(okBody, ENV, { fetch: err })).json(), { why: null });
});

test('두 안과 사용자 문장이 프롬프트가 아니라 user 역할로 실린다', async () => {
  let sent: { messages: { role: string; content: string }[] } | null = null;
  const spy = (async (_u: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"why":"짐을 나중에 들어요"}' } }] }));
  }) as unknown as typeof fetch;

  await handleReason(okBody, ENV, { fetch: spy });
  assert.ok(sent);
  const msgs = sent!.messages;
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user', '사용자 문장은 지시가 아니라 데이터다');
  const payload = JSON.parse(msgs[1].content);
  assert.equal(payload.mode, 'transit');
  assert.deepEqual(payload.comfort.stops, ['온누리약국', '이마트 역삼점']);
  assert.ok(!/빠르|가까|분/.test(msgs[0].content.split('규칙:')[0]), '프롬프트가 먼저 속도를 언급하면 답도 따라간다');
});
