#!/usr/bin/env node
/**
 * 내려받은 추적 로그(JSONL)를 타임라인으로 펼친다. 의존성 없음.
 *
 * 왜: 실기기 로그를 화면 캡처 대신 시각순으로 읽기 위해.
 *
 *   node scripts/tracklog-timeline.mjs track-export.jsonl
 *
 * plan 줄에서 지점 이름을 익히고 act·net·geofence·track·mode·notify를 시각순으로 찍는다.
 * fix는 접어서 이벤트 사이 샘플 수·정확도 범위만 요약한다.
 *
 * 계획이 여러 번이면 r(runId)로 갈린다 — --run <id> 로 하나만 볼 수 있다.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const runIdx = args.indexOf('--run');
const onlyRun = runIdx >= 0 ? args[runIdx + 1] : null;
// --run 이 없으면 runIdx 가 -1 이라, runIdx+1 을 그냥 빼면 첫 인자가 사라진다
const skip = runIdx >= 0 ? runIdx + 1 : -1;
const path = args.find((a, i) => !a.startsWith('--') && i !== skip);
if (!path) {
  console.error('usage: node scripts/tracklog-timeline.mjs <file.jsonl> [--run <runId>]');
  process.exit(1);
}

const rows = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter(r => !onlyRun || r.r === onlyRun)
  .sort((a, b) => (a.t < b.t ? -1 : 1));

if (rows.length === 0) {
  console.error(onlyRun ? `run ${onlyRun} 에 해당하는 줄이 없다` : '읽을 줄이 없다');
  process.exit(1);
}

/** 한 겹 상세를 'k=v · k=v' 로 — 빈 값은 지운다 */
const detail = d =>
  !d ? '' : Object.entries(d)
    .filter(([, v]) => v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');

const names = new Map();
const name = id => (id == null ? '-' : (names.get(id) ?? id));
const hm = t => t.slice(11, 19);
const m = v => (v == null ? '-' : `${Math.round(v)}m`);

let fixes = [];
function flushFixes() {
  if (fixes.length === 0) return;
  const acc = fixes.map(f => f.acc).filter(a => a != null);
  const spd = fixes.map(f => f.spd).filter(s => s != null);
  const range = (xs, unit) => (xs.length ? `${Math.min(...xs).toFixed(0)}~${Math.max(...xs).toFixed(0)}${unit}` : '-');
  console.log(`         · fix ${fixes.length}건 (acc ${range(acc, 'm')}, spd ${range(spd, 'm/s')}, src ${[...new Set(fixes.map(f => f.src))].join('/')})`);
  fixes = [];
}

for (const r of rows) {
  if (r.k === 'fix') {
    fixes.push(r);
    continue;
  }
  flushFixes();
  const t = hm(r.t);
  switch (r.k) {
    case 'plan': {
      names.set('D', '목적지');
      const stops = r.stops ?? [];
      for (const s of stops) names.set(s.id, s.name);
      const via = stops.length ? `경유 ${stops.map(s => s.name).join(' → ')} → ` : '';
      console.log(`${t} PLAN  ${r.mode} · ${r.source} · ${via}목적지`);
      break;
    }
    case 'act': {
      const d = detail(r.d);
      console.log(`${t} ACT   ${r.a}${d ? `  ${d}` : ''}`);
      break;
    }
    case 'net': {
      const d = detail(r.d);
      console.log(`${t} NET   ${r.ep} ${r.ok ? '' : '실패 '}${r.ms}ms${d ? `  ${d}` : ''}`);
      break;
    }
    case 'geofence': {
      // events 가 없는 줄에서 죽던 것 — 옛 파일·부분 기록도 읽혀야 한다
      const ev = r.events?.length ? `  ⇒ ${r.events.join(', ')}` : '';
      const ig = r.ignored ? `  (무시: ${r.ignored})` : '';
      console.log(`${t} GEO   ${name(r.target)} ${m(r.dTarget)}/${m(r.arriveR)} ${r.atStop ? '체류' : '접근'} · next ${name(r.next)} ${m(r.dNext)} · 출발R ${m(r.departR)}${ig}${ev}`);
      break;
    }
    case 'track':
      console.log(`${t} TRACK ${r.from} → ${r.to} · 경로에서 ${m(r.crossTrack)} · 진행 ${m(r.progress)}`);
      break;
    case 'mode':
      console.log(`${t} MODE  ${r.from} → ${r.to} (${r.via})`);
      break;
    case 'notify':
      console.log(`${t} NOTI  ${r.kind} ${name(r.id)}`);
      break;
    default:
      console.log(`${t} ${r.k}`);
  }
}
flushFixes();
