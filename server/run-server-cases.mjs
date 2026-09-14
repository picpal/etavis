/**
 * 케이스 러너 — 배포된 서버 `/extract`(진짜 LLM)에 돌린다.
 *
 *   node server/run-server-cases.mjs            # 그룹당 1개 = 27개 (기본)
 *   node server/run-server-cases.mjs --group typo
 *   node server/run-server-cases.mjs --all      # 147개 전부 — 비용 주의
 *
 * **이건 돈이 나간다.** 시뮬레이션은 codex(구독제)로 하고 — `node server/run-llm.mjs` —
 * 이 러너는 **배선을 바꾼 뒤 확신을 얻는 용도**로만 쓴다. 그래서 기본이 전수가 아니라
 * 그룹당 1개다: 27개 범주를 한 번씩 훑으면 배선이 살아 있는지는 확실히 알 수 있고,
 * 모델 품질을 재는 건 어차피 codex 기준선의 몫이다.
 *
 * 채점은 `case-score.mjs`를 쓴다 — 목 러너와 같은 자라야 두 숫자가 비교된다.
 */
import { readFileSync } from 'node:fs';
import { scoreCase, summarize, KNOWN_PLACES } from './case-score.mjs';

/** .env 를 직접 읽는다. wrangler 도 dotenv 도 여기선 필요 없다 */
function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* .env 가 없으면 아래에서 안내하고 끝낸다 */
  }
  return out;
}

const env = loadEnv();
const BASE = (process.env.SERVER_URL ?? env.SERVER_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.APP_TOKEN ?? env.APP_TOKEN ?? '';
if (!BASE || !TOKEN) {
  console.error('SERVER_URL·APP_TOKEN 이 없다. .env 를 확인할 것.');
  process.exit(1);
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const gi = args.indexOf('--group');
const only = gi >= 0 ? args[gi + 1] : null;

/* /extract 는 기기당 분당 10회다(server/src/guard.ts). 넘기면 429 가 오고
   그건 '목으로 떨어짐'이지 '모델이 틀림'이 아니라서 숫자를 오염시킨다.
   상한을 늘리는 대신 러너가 기다린다 — 방어선을 테스트 때문에 흔들지 않는다 */
const DELAY_MS = Number(process.env.DELAY_MS ?? 6500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cases = readFileSync(new URL('./prompts/cases.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l));

/** 그룹당 첫 케이스 — 27개 범주를 한 번씩 훑는다 */
function representative(rows) {
  const seen = new Set();
  return rows.filter(c => (seen.has(c.g) ? false : (seen.add(c.g), true)));
}

const picked = only ? cases.filter(c => c.g === only) : all ? cases : representative(cases);

console.log(
  `${picked.length}개를 ${BASE}/extract 로 보낸다 · 간격 ${DELAY_MS}ms · 예상 ${Math.ceil((picked.length * DELAY_MS) / 60000)}분\n`,
);

const rows = [];
const errors = [];

for (const [i, c] of picked.entries()) {
  const res = await fetch(`${BASE}/extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-token': TOKEN,
      'x-device-id': 'case-runner',
    },
    body: JSON.stringify({ text: c.text, context: { currentStops: c.ctx ?? [], knownPlaces: KNOWN_PLACES } }),
  }).catch(e => ({ ok: false, status: 0, _err: e.message }));

  if (!res.ok) {
    // 서버가 답을 못 준 건 채점 대상이 아니다. 섞으면 '모델이 틀렸다'로 잘못 읽힌다
    const body = res.json ? await res.json().catch(() => ({})) : {};
    errors.push({ g: c.g, text: c.text, status: res.status, body: JSON.stringify(body) });
  } else {
    rows.push(scoreCase(c, await res.json()));
  }

  process.stdout.write(`\r  ${i + 1}/${picked.length}`);
  if (i < picked.length - 1) await sleep(DELAY_MS);
}
process.stdout.write('\n\n');

if (errors.length) {
  console.log(`--- 서버가 답하지 못한 ${errors.length}건 (채점에서 제외) ---`);
  for (const e of errors) console.log(`[${e.g}] "${e.text}" → HTTP ${e.status} ${e.body}`);
  console.log('');
}

if (rows.length === 0) {
  console.log('채점할 응답이 하나도 없다. 서버·키를 먼저 고칠 것.');
  process.exit(1);
}

const sum = summarize(rows);
console.log('그룹별 (실패 / 미검증 / 전체)');
for (const [g, v] of Object.entries(sum.byGroup)) {
  const mark = v.bad === 0 ? (v.un ? '⚠️ ' : '✅') : '❌';
  console.log(`  ${mark} ${g.padEnd(10)} ${v.bad} / ${v.un} / ${v.n}`);
}
console.log(`\n전체 ${sum.total} · 검증됨 ${sum.checked} · 실패 ${sum.failed} · 미검증 ${sum.unchecked}\n`);

for (const r of sum.bad) {
  console.log(`[${r.g}] "${r.text}"`);
  console.log(`   → ${r.fails.join(' · ')}${r.note ? `  (${r.note})` : ''}`);
}

console.log('\n같은 자로 잰 목 기준선: node server/run-cases.mjs');
