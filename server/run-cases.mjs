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
import { scoreCase, summarize, KNOWN_PLACES } from './case-score.mjs';

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

const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const asJson = process.argv.includes('--json');
const rows = [];

for (const c of cases) {
  if (only && c.g !== only) continue;
  const got = extractIntent(c.text, { currentStops: c.ctx ?? [], knownPlaces: KNOWN_PLACES });
  // 채점은 case-score.mjs 가 한다 — 서버 러너와 같은 자를 써야 두 숫자가 비교된다
  rows.push(scoreCase(c, got));
}

const sum = summarize(rows);

if (asJson) {
  // 엑셀 기록용 — server/results.json 으로 받아 쓴다
  console.log(
    JSON.stringify(
      rows.map(r => ({
        group: r.g,
        text: r.text,
        stops: r.flat.join(', '),
        arriveBy: r.got.arriveBy,
        mode: r.got.mode,
        order: r.got.order,
        reject: r.got.reject?.say ?? '',
        ambiguous: r.got.ambiguous.map(a => a.question).join(' / '),
        verdict: !r.checked ? '미검증' : r.fails.length ? '실패' : '통과',
        fails: r.fails.join(' · '),
        note: r.note ?? '',
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log('그룹별 (실패 / 미검증 / 전체)');
for (const [g, v] of Object.entries(sum.byGroup)) {
  const mark = v.bad === 0 ? (v.un ? '⚠️ ' : '✅') : '❌';
  console.log(`  ${mark} ${g.padEnd(10)} ${v.bad} / ${v.un} / ${v.n}`);
}

const { bad, uncheckedRows: unchecked } = sum;
console.log(
  `\n전체 ${sum.total} · 검증됨 ${sum.checked} · 실패 ${sum.failed} · 미검증 ${sum.unchecked}\n`,
);
for (const r of bad) {
  console.log(`[${r.g}] "${r.text}"`);
  console.log(`   → ${r.fails.join(' · ')}${r.note ? `  (${r.note})` : ''}`);
}
console.log(`\n--- 미검증 ${unchecked.length}개 (기대값을 정해야 한다) ---`);
for (const r of unchecked) {
  console.log(`[${r.g}] "${r.text}" → stops=[${r.flat.join(',')}] ${r.note ? `(${r.note})` : ''}`);
}
