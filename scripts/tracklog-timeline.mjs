#!/usr/bin/env node
/**
 * 내려받은 추적 로그(JSONL)를 타임라인으로 펼친다. 의존성 없음.
 *
 * 왜: 실기기 로그를 화면 캡처 대신 시각순으로 읽기 위해.
 *
 *   node scripts/tracklog-timeline.mjs track-export.jsonl
 *
 * plan 줄에서 지점 이름을 익히고 geofence·track·mode·notify를 시각순으로 한 줄씩 찍는다.
 * fix는 접어서 이벤트 사이 샘플 수·정확도 범위만 요약한다.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/tracklog-timeline.mjs <file.jsonl>');
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
  .sort((a, b) => (a.t < b.t ? -1 : 1));

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
    case 'plan':
      names.set('D', '목적지');
      for (const s of r.stops) names.set(s.id, s.name);
      console.log(`${t} PLAN  ${r.mode} · ${r.source} · 경유 ${r.stops.map(s => s.name).join(' → ')} → 목적지`);
      break;
    case 'geofence': {
      const ev = r.events.length ? `  ⇒ ${r.events.join(', ')}` : '';
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
