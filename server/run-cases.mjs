/**
 * 케이스 러너 — 목 추출기(src/lib/intent.ts)를 cases.jsonl에 돌린다.
 *
 * 지금은 목을 재는 것이지 LLM을 재는 게 아니다.
 * 값은 '스키마 구멍 찾기'와 'OpenAI 붙인 뒤 비교할 기준선'에 있다.
 *
 *   node server/run-cases.mjs [그룹명]
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// TS를 그대로 못 읽으므로 tsc로 한 번 떨궈 쓴다
const OUT = '/tmp/etavia-intent';
execSync(
  `npx tsc src/lib/intent.ts --ignoreConfig --outDir ${OUT} --module es2022 --target es2022 --moduleResolution bundler`,
  { stdio: 'inherit' },
);
const { extractIntent } = await import(`${OUT}/intent.js`);

const cases = readFileSync(new URL('./prompts/cases.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l));

const only = process.argv[2];
const rows = [];

for (const c of cases) {
  if (only && c.g !== only) continue;
  const got = extractIntent(c.text, { currentStops: c.ctx ?? [], knownPlaces: ['회사', '집', '오크밸리 숙소'] });
  const e = c.expect ?? {};
  const fails = [];

  const flat = got.stops.filter(s => s.op !== 'remove').flatMap(s => s.queries);
  if (e.qhas && !e.qhas.some(q => flat.includes(q))) fails.push(`qhas ${e.qhas}`);
  if (e.qmulti && !got.stops.some(s => s.queries.length > 1)) fails.push('qmulti');
  if (e.qnot && e.qnot.some(q => flat.includes(q))) fails.push(`qnot ${e.qnot}`);
  const adds = got.stops.filter(s => s.op !== 'remove').length;
  if (e.nstops != null && adds !== e.nstops) fails.push(`stops=${adds}≠${e.nstops}`);
  if (e.minstops != null && adds < e.minstops) fails.push(`stops=${adds}<${e.minstops}`);
  if (e.n != null && !got.stops.every(s => s.count === e.n)) {
    if (got.stops.length) fails.push(`n=${got.stops[0].count}≠${e.n}`);
  }
  if ('at' in e && got.arriveBy !== e.at) fails.push(`at=${got.arriveBy}≠${e.at}`);
  if ('m' in e && got.mode !== e.m) fails.push(`m=${got.mode}≠${e.m}`);
  if (e.op === 'remove' && !got.stops.some(s2 => s2.op === 'remove')) fails.push('remove 없음');
  if (e.swap && !(got.stops.some(s2 => s2.op === 'remove') && got.stops.some(s2 => s2.op === 'add')))
    fails.push('교체(remove+add) 아님');
  if (e.reset && !got.resetStops) fails.push('resetStops 아님');
  if (e.dest && got.endpoints.destination !== e.dest) fails.push(`dest=${got.endpoints.destination}≠${e.dest}`);
  if (e.origin && got.endpoints.origin !== e.origin) fails.push(`origin=${got.endpoints.origin}≠${e.origin}`);
  if (e.order && got.order !== e.order) fails.push(`order=${got.order}≠${e.order}`);
  if ('lock' in e && (got.order === 'locked') !== e.lock) fails.push(`order=${got.order}`);
  if ('flex' in e && got.stops.length && got.stops[0].flexible !== e.flex) fails.push(`flex=${got.stops[0].flexible}`);
  if (e.open && !got.stops.some(s => s.openNow)) fails.push('open');
  if (e.rej === true && !got.reject) fails.push('reject 안 함');
  if (e.rej === false && got.reject) fails.push('잘못 거절');
  if (e.amb && got.ambiguous.length === 0) fails.push('되묻지 않음');
  // 가장 중요한 축 — 쓰레기 입력에 경유지를 지어내지 않는가
  if (e.nostop && got.stops.length > 0) fails.push(`환각: ${flat.join(',')}`);

  /* note만 있고 검증 조건이 없는 케이스는 '통과'가 아니라 '미검증'이다.
     자동 통과를 통과로 세면 합격률이 부풀려진다 */
  const checked = [
    'qhas', 'qmulti', 'n', 'at', 'm', 'op', 'lock', 'flex', 'open', 'rej', 'amb', 'nostop',
    'swap', 'reset', 'dest', 'origin', 'order', 'qnot', 'nstops', 'minstops',
  ].some(k => k in e);
  rows.push({ g: c.g, text: c.text, fails, note: e.note, flat, got, checked });
}

const byGroup = {};
for (const r of rows) {
  byGroup[r.g] ??= { n: 0, bad: 0, un: 0 };
  byGroup[r.g].n++;
  if (!r.checked) byGroup[r.g].un++;
  else if (r.fails.length) byGroup[r.g].bad++;
}

console.log('그룹별 (실패 / 미검증 / 전체)');
for (const [g, v] of Object.entries(byGroup)) {
  const mark = v.bad === 0 ? (v.un ? '⚠️ ' : '✅') : '❌';
  console.log(`  ${mark} ${g.padEnd(10)} ${v.bad} / ${v.un} / ${v.n}`);
}

const bad = rows.filter(r => r.checked && r.fails.length);
const unchecked = rows.filter(r => !r.checked);
console.log(
  `\n전체 ${rows.length} · 검증됨 ${rows.length - unchecked.length} · 실패 ${bad.length} · 미검증 ${unchecked.length}\n`,
);
for (const r of bad) {
  console.log(`[${r.g}] "${r.text}"`);
  console.log(`   → ${r.fails.join(' · ')}${r.note ? `  (${r.note})` : ''}`);
}
console.log(`\n--- 미검증 ${unchecked.length}개 (기대값을 정해야 한다) ---`);
for (const r of unchecked) {
  console.log(`[${r.g}] "${r.text}" → stops=[${r.flat.join(',')}] ${r.note ? `(${r.note})` : ''}`);
}
