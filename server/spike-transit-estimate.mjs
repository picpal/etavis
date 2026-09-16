#!/usr/bin/env node
/**
 * 7단계 준비 스파이크 — 대중교통 "추정 vs 실측" 오차 측정. 앱 코드는 읽기만 한다.
 *
 *   node server/spike-transit-estimate.mjs                        # 실측 9회(후보 4곳 × 2구간 + 직행)
 *   node server/spike-transit-estimate.mjs --dry                   # 호출 없음. 상수·추정·요청 본문만
 *   node server/spike-transit-estimate.mjs --out docs/transit-추정-오차.md
 *
 * 왜: transitProvider.ts 가 `points.length !== 2` 면 추정으로 넘긴다 — 직행만 실측이고
 * 경유 후보 비교는 전부 mockProvider 의 추정이다. 그 상수가 근거 없이 정해졌다
 * (mockProvider.ts 주석: "숫자는 실기기 추적 로그와 비교해 조정할 것"). 얼마나 틀렸는지를 숫자로 박는다.
 *
 * 좌표는 2026-09-16 11:02 실기기 실행 그대로. 출발 시각도 같은 조건(11:03 KST)으로 맞추되
 * 주말은 배차가 달라지므로 평일로 민다.
 *
 * 호출은 **우리 서버 /transit** — 앱의 transitProvider.ts 가 때리는 그 경로라 사과 대 사과다.
 * 응답의 `source` 를 반드시 같이 기록한다. 서버가 "estimate" 라고 하면 그건 실측이 아니다.
 *
 * 키는 루트 .env 또는 환경변수: SERVER_URL, APP_TOKEN (process.env 가 이긴다 — 워크트리엔 .env 가 없다).
 *   set -a && . /path/to/main/.env && set +a && node server/spike-transit-estimate.mjs
 * 키 값은 어디에도 찍지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(`--${name}`);
const dry = flag('dry');
const outPath = opt('out', null);

/** 실측 호출 상한. 지시된 9회를 넘기면 스스로 멈춘다 — 과금은 실수로 늘어난다 */
const MAX_CALLS = 9;

// .env — 값에 '=' 가 있어도 되게 첫 '=' 만 자른다 (spike-transit.mjs 와 같은 모양)
function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
const SERVER_URL = (env.SERVER_URL ?? '').replace(/\/$/, '');
const APP_TOKEN = env.APP_TOKEN;
const DEVICE_ID = 'spike-transit-estimate';

// ── 추정 상수는 소스에서 파싱한다 ─────────────────────────────────────────
// 베껴 쓰면 코드가 바뀔 때 스파이크만 조용히 옛 숫자로 남는다. 하나라도 못 찾으면 던지고 멈춘다.
function parseEstimateConstants() {
  const p = path.join(ROOT, 'src/lib/routePlan/mockProvider.ts');
  const src = fs.readFileSync(p, 'utf8');
  const pick = (text, re, what) => {
    const m = text.match(re);
    if (!m) throw new Error(`mockProvider.ts 에서 ${what} 를 못 찾았다 — 상수 모양이 바뀌었으면 파서를 고쳐라`);
    return Number(m[1]);
  };

  // transit 블록을 먼저 잘라낸다 — minPerKm 은 walk 에도 있어서 전체 검색이면 엉뚱한 값을 집는다
  const block = src.match(/transit:\s*\{([\s\S]*?)\n\s*\},/);
  if (!block) throw new Error('mockProvider.ts 에서 MODE_ESTIMATE.transit 블록을 못 찾았다');
  const t = block[1];

  const c = {
    accessWaitMin: pick(t, /accessWaitMin:\s*([\d.]+)/, 'transit.accessWaitMin'),
    minPerKm: pick(t, /minPerKm:\s*([\d.]+)/, 'transit.minPerKm'),
    transferOverKm: pick(t, /transferOverKm:\s*([\d.]+)/, 'transit.transferOverKm'),
    transferMin: pick(t, /transferMin:\s*([\d.]+)/, 'transit.transferMin'),
    walkMinPerKm: pick(src, /walk:\s*\{\s*minPerKm:\s*([\d.]+)/, 'walk.minPerKm'),
    walkCircuity: pick(src, /walk:\s*\{[^}]*circuity:\s*([\d.]+)/, 'walk.circuity'),
    circuity: pick(src, /mode === 'walk' \? MODE_ESTIMATE\.walk\.circuity : ([\d.]+)/, 'transit 우회율(circuity)'),
  };

  // 상수만 맞고 식이 바뀌었으면 결과가 거짓말이 된다 — 식의 모양도 확인한다
  const shape = [
    't.accessWaitMin + km * t.minPerKm + (km > t.transferOverKm ? t.transferMin : 0)',
    'Math.min(ride, km * MODE_ESTIMATE.walk.minPerKm)',
  ];
  for (const s of shape) {
    if (!src.includes(s)) throw new Error(`estimateSectionMin 의 식이 바뀌었다 — 이 스파이크의 계산과 어긋난다: ${s}`);
  }
  return c;
}

// ── 거리·추정 (src/lib/geo.ts · mockProvider.ts 와 같은 식) ───────────────
const R = 6371000;
const toRad = d => (d * Math.PI) / 180;
/** 두 점 사이 직선거리(m) — geo.ts 의 haversineM 과 같은 식·같은 R */
function haversineM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** 구간 하나의 추정 분 — estimateSectionMin(mode:'transit') 과 같은 식 */
function estimateSectionMin(km, c) {
  const ride = c.accessWaitMin + km * c.minPerKm + (km > c.transferOverKm ? c.transferMin : 0);
  return Math.min(ride, km * c.walkMinPerKm);
}

// ── 좌표 — 2026-09-16 11:02 실기기 실행 그대로 ────────────────────────────
const O = { name: 'O 현대카드빌딩2관', lat: 37.52965055021622, lng: 126.918961967742 };
const D = { name: 'D 에비앙하우스(목동로19길 33-1)', lat: 37.52448713315888, lng: 126.86070728532043 };
const CANDIDATES = [
  { id: 'C1', name: '홈플러스익스프레스 당산점', lat: 37.531871, lng: 126.901061, rankedByApp: 1 },
  { id: 'C2', name: '영등포농협 하나로마트 당산역점', lat: 37.533245, lng: 126.902291, rankedByApp: 2 },
  { id: 'C3', name: '이마트 목동점', lat: 37.526084, lng: 126.870355, rankedByApp: 3 },
  { id: 'C4', name: 'GS더프레시 선유도역점', lat: 37.5375132918972, lng: 126.895068183548, rankedByApp: null, note: '사용자가 직접 고른 곳' },
];
/** runPlan.ts 의 dwellFor('대형마트') — 마트는 15분 */
const DWELL_MIN = 15;

// ── 출발 시각: 다음 평일 11:03 KST ───────────────────────────────────────
/** 오늘 날짜 + HH:MM(KST) → Date. 이미 지난 시각이면 내일, 주말이면 월요일까지 민다 */
function departDate(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), h - 9, m, 0));
  if (d.getTime() < now.getTime() + 5 * 60e3) d.setUTCDate(d.getUTCDate() + 1);
  // 주말이면 배차가 달라진다 — 평일로 민다 (KST 기준 요일)
  for (let i = 0; i < 3; i++) {
    const dow = new Date(d.getTime() + 9 * 3600e3).getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtKst = d => {
  const k = new Date(d.getTime() + 9 * 3600e3);
  return `${k.toISOString().slice(0, 16).replace('T', ' ')}(${DOW[k.getUTCDay()]}) KST`;
};

// ── 서버 /transit 호출 — transitProvider.ts 의 fetch 본문 그대로 ──────────
let calls = 0;
async function transit(o, d, departAt) {
  const body = {
    origin: { lat: o.lat, lng: o.lng },
    destination: { lat: d.lat, lng: d.lng },
    departAt: departAt.toISOString(),
  };
  if (dry) return { dry: body };
  if (!SERVER_URL) throw new Error('SERVER_URL 없음');
  if (!APP_TOKEN) throw new Error('APP_TOKEN 없음');
  if (++calls > MAX_CALLS) throw new Error(`호출 상한 ${MAX_CALLS}회 초과 — 멈춘다`);
  const t0 = Date.now();
  const res = await fetch(`${SERVER_URL}/transit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-token': APP_TOKEN, 'x-device-id': DEVICE_ID },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => null);
  if (!res.ok) return { error: `${res.status} ${JSON.stringify(json).slice(0, 200)}`, ms };
  const list = json?.itineraries ?? [];
  if (!list.length) return { error: 'itineraries 없음', ms };
  return { top: list[0], count: list.length, source: json.source ?? '(없음)', provider: json.provider ?? '(없음)', ms };
}

/** 1위 itinerary 요약 — 승차/환승/하차 한 줄 */
function legLine(it) {
  const t = (it.legs ?? []).filter(l => l.kind === 'transit');
  if (!t.length) return '도보만';
  return t.map(l => `${l.line || l.mode}(${l.from?.name ?? '?'}→${l.to?.name ?? '?'})`).join(' → ');
}

const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;

async function run() {
  const c = parseEstimateConstants();
  const depart = departDate('11:03');
  const lines = [];
  const say = s => { lines.push(s); console.log(s); };

  say(`# 대중교통 추정 오차 — 추정 vs 서버 /transit 실측`);
  say('');
  say(`측정: ${fmtKst(new Date())} 실행 · 출발 시각 ${fmtKst(depart)} · ${dry ? '**--dry (호출 없음)**' : `서버 \`/transit\` ${MAX_CALLS}회`}`);
  say('');
  say('> 표는 `server/spike-transit-estimate.mjs` 가 만든다. 결론은 손으로 쓴다.');
  say('');

  // ── 파싱한 상수 ─────────────────────────────────────────────────────
  say('## 파싱한 상수 — `src/lib/routePlan/mockProvider.ts`');
  say('');
  say('| 상수 | 값 | 뜻 |');
  say('|---|---|---|');
  say(`| \`transit.accessWaitMin\` | ${c.accessWaitMin} | 정류장까지 걷기 + 배차 대기. 구간마다 한 번 |`);
  say(`| \`transit.minPerKm\` | ${c.minPerKm} | 차내 분/km (시속 ${r1(60 / c.minPerKm)}km) |`);
  say(`| \`transit.transferOverKm\` | ${c.transferOverKm} | 이 거리를 넘으면 환승 한 번 |`);
  say(`| \`transit.transferMin\` | ${c.transferMin} | 환승 가산 |`);
  say(`| \`walk.minPerKm\` | ${c.walkMinPerKm} | 도보 분/km. 추정의 상한(짧으면 걷는 게 빠르다) |`);
  say(`| circuity | ${c.circuity} | 직선거리 × 우회율 (도보는 ${c.walkCircuity}) |`);
  say('');
  say('```');
  say(`구간분 = min( ${c.accessWaitMin} + km×${c.minPerKm} + (km > ${c.transferOverKm} ? ${c.transferMin} : 0),  km×${c.walkMinPerKm} )`);
  say(`km    = haversine 직선거리 × ${c.circuity}`);
  say('```');
  say('');

  // ── 구간 목록 ───────────────────────────────────────────────────────
  const segs = [];
  for (const cand of CANDIDATES) {
    segs.push({ cand, label: 'O→C', a: O, b: cand });
    segs.push({ cand, label: 'C→D', a: cand, b: D });
  }
  segs.push({ cand: { id: 'DIR', name: '직행(경유 없음)' }, label: 'O→D', a: O, b: D });

  for (const s of segs) {
    s.straightKm = haversineM(s.a, s.b) / 1000;
    s.km = s.straightKm * c.circuity;
    s.estMin = estimateSectionMin(s.km, c);
    s.transferHit = s.km > c.transferOverKm;
  }

  if (dry) {
    say('## --dry · 추정값과 요청 본문');
    say('');
    say('| 후보 | 구간 | 직선km | 우회km | 추정분 | 환승가산 |');
    say('|---|---|---|---|---|---|');
    for (const s of segs) say(`| ${s.cand.name} | ${s.label} | ${r3(s.straightKm)} | ${r3(s.km)} | ${r1(s.estMin)} | ${s.transferHit ? `+${c.transferMin}` : '-'} |`);
    say('');
    for (const s of segs) {
      const r = await transit(s.a, s.b, depart);
      say(`[${s.cand.name} · ${s.label}] \`${JSON.stringify(r.dry)}\``);
    }
    say('');
    say(`요청 ${segs.length}건 · 실제 호출 0건`);
  } else {
    // ── 실측 ─────────────────────────────────────────────────────────
    for (const s of segs) {
      const r = await transit(s.a, s.b, depart);
      s.res = r;
      if (r.error) { console.error(`  ! ${s.cand.name} ${s.label}: ${r.error}`); continue; }
      s.actualMin = r.top.durationMin;
      s.actualKm = (r.top.distanceM ?? 0) / 1000;
      s.source = r.source;
      s.legs = legLine(r.top);
      console.error(`  · ${s.cand.name} ${s.label}: 추정 ${r1(s.estMin)} / 실측 ${s.actualMin} (${r.source}, ${r.ms}ms)`);
      await new Promise(res => setTimeout(res, 300)); // 분당 상한(20) 여유
    }

    say('## 구간별 오차');
    say('');
    say('오차 = 추정 − 실측. **양수면 추정이 과대**(실제보다 오래 걸린다고 봤다).');
    say('');
    say('| 후보 | 구간 | 직선km | 우회km | 추정분 | 실측분 | 실측km | 오차(분) | 오차율 | `source` |');
    say('|---|---|---|---|---|---|---|---|---|---|');
    for (const s of segs) {
      if (s.actualMin == null) { say(`| ${s.cand.name} | ${s.label} | ${r3(s.straightKm)} | ${r3(s.km)} | ${r1(s.estMin)} | — | — | — | — | 실패: ${s.res?.error ?? '?'} |`); continue; }
      const err = s.estMin - s.actualMin;
      say(`| ${s.cand.name} | ${s.label} | ${r3(s.straightKm)} | ${r3(s.km)} | ${r1(s.estMin)} | ${s.actualMin} | ${r2(s.actualKm)} | ${err >= 0 ? '+' : ''}${r1(err)} | ${err >= 0 ? '+' : ''}${r1((err / s.actualMin) * 100)}% | ${s.source} |`);
    }
    say('');

    say('### 실측 1위 경로');
    say('');
    say('| 후보 | 구간 | 실측분 | 대안 수 | 경로 |');
    say('|---|---|---|---|---|');
    for (const s of segs) {
      if (s.actualMin == null) continue;
      say(`| ${s.cand.name} | ${s.label} | ${s.actualMin} | ${s.res.count} | ${s.legs} |`);
    }
    say('');

    // ── 후보별 합계·순위 ──────────────────────────────────────────────
    const rows = CANDIDATES.map(cand => {
      const mine = segs.filter(s => s.cand.id === cand.id);
      const est = mine.reduce((a, s) => a + s.estMin, 0);
      const ok = mine.every(s => s.actualMin != null);
      const act = ok ? mine.reduce((a, s) => a + s.actualMin, 0) : null;
      return { cand, est, act };
    });
    const rank = (list, key) => {
      const sorted = [...list].filter(r => r[key] != null).sort((a, b) => a[key] - b[key]);
      return r => (r[key] == null ? '—' : String(sorted.indexOf(r) + 1));
    };
    const estRank = rank(rows, 'est');
    const actRank = rank(rows, 'act');

    say('## 후보별 합계와 순위');
    say('');
    say(`체류 ${DWELL_MIN}분은 \`runPlan.ts\` 의 \`dwellFor('대형마트')\`. 후보 전원에게 같은 값이라 순위는 바꾸지 못한다.`);
    say('');
    say(`| 후보 | 앱 순위 | 추정 합 | 추정 순위 | 실측 합 | 실측 순위 | 오차(분) | 추정+체류${DWELL_MIN} | 실측+체류${DWELL_MIN} |`);
    say('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const err = r.act == null ? null : r.est - r.act;
      say(`| ${r.cand.name}${r.cand.note ? ` (${r.cand.note})` : ''} | ${r.cand.rankedByApp ?? '—'} | ${r1(r.est)} | ${estRank(r)} | ${r.act == null ? '—' : r1(r.act)} | ${actRank(r)} | ${err == null ? '—' : `${err >= 0 ? '+' : ''}${r1(err)}`} | ${r1(r.est + DWELL_MIN)} | ${r.act == null ? '—' : r1(r.act + DWELL_MIN)} |`);
    }
    say('');

    const dir = segs[segs.length - 1];
    say('## 직행 (경유 없음)');
    say('');
    say('| | 직선km | 우회km | 추정분 | 실측분 | 오차(분) | `source` |');
    say('|---|---|---|---|---|---|---|');
    say(`| O→D | ${r3(dir.straightKm)} | ${r3(dir.km)} | ${r1(dir.estMin)} | ${dir.actualMin ?? '—'} | ${dir.actualMin == null ? '—' : `${dir.estMin - dir.actualMin >= 0 ? '+' : ''}${r1(dir.estMin - dir.actualMin)}`} | ${dir.source ?? '실패'} |`);
    say('');
    say(`2026-09-16 실기기 로그의 직행 실측은 30분이었다. 로그는 \`src:"provider"\` — 이 스파이크와 같은 경로다.`);
    say('');
    say(`실제 호출 ${calls}회 (상한 ${MAX_CALLS}).`);
  }

  if (outPath) {
    const p = path.join(ROOT, outPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, lines.join('\n') + '\n');
    console.error(`\n→ ${outPath}`);
  }
}
run().catch(e => { console.error('실패:', e.message); process.exit(1); });
