#!/usr/bin/env node
/**
 * 3단계 스파이크 — 대중교통 경로 공급자 비교. 앱 코드와 무관한 결정 게이트.
 *
 *   node server/spike-transit.mjs                 # Google (기본)
 *   node server/spike-transit.mjs --provider tmap
 *   node server/spike-transit.mjs --provider both --out docs/transit-spike.md
 *   node server/spike-transit.mjs --dry           # 요청 본문만 출력, 호출 없음
 *
 * 키는 루트 .env 에서 읽는다: GOOGLE_ROUTES_KEY(없으면 GOOGLE_PLACES_KEY), TMAP_APP_KEY, KAKAO_REST_KEY(지오코딩).
 * 케이스: server/prompts/transit-cases.jsonl — origin/destination 은 주소·장소명, 카카오 로컬로 좌표를 잡는다.
 *
 * 확인 항목(단계 문서 3단계): ① 승차·환승·하차 정류장 좌표가 오는가 ② 실패 케이스 1위가 5호선인가
 * ③ 도보 구간 시간이 오는가(한국) ④ 지연 ⑤ 출발시각을 바꾸면 응답이 달라지는가(배차 반영)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(`--${name}`);
const provider = opt('provider', 'google');
const outPath = opt('out', null);
const dry = flag('dry');

// .env — 값에 '=' 가 있어도 되게 첫 '=' 만 자른다
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
const GOOGLE_KEY = env.GOOGLE_ROUTES_KEY || env.GOOGLE_PLACES_KEY;
const TMAP_KEY = env.TMAP_APP_KEY;
const KAKAO_KEY = env.KAKAO_REST_KEY;

const cases = fs.readFileSync(path.join(ROOT, 'server/prompts/transit-cases.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

/** 오늘 날짜 + HH:MM(KST) → Date. 이미 지난 시각이면 내일 */
function departDate(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), h - 9, m, 0));
  if (d.getTime() < now.getTime() + 5 * 60e3) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const fmtKst = d => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const yyyymmddhhmi = d => new Date(d.getTime() + 9 * 3600e3).toISOString().replace(/[-T:]/g, '').slice(0, 12);

// ── 지오코딩: 카카오 로컬 (주소 → 없으면 키워드) ──────────────────────────
async function geocode(q) {
  if (!KAKAO_KEY) throw new Error('KAKAO_REST_KEY 없음');
  const h = { Authorization: `KakaoAK ${KAKAO_KEY}` };
  let r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}`, { headers: h }).then(r => r.json());
  let d = r.documents?.[0];
  if (!d) {
    r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=1`, { headers: h }).then(r => r.json());
    d = r.documents?.[0];
  }
  if (!d) throw new Error(`지오코딩 실패: ${q}`);
  return { lat: Number(d.y), lng: Number(d.x), name: d.place_name ?? d.address_name };
}

// ── 정규화 결과 (4단계 TransitItinerary 의 원형) ──────────────────────────
// { provider, durationMin, legs: [{ kind:'walk'|'transit', mode, line, from:{name,lat,lng}, to:{name,lat,lng}, durationMin, stops }], departAt, arriveAt }

// ── Google Routes (TRANSIT) ────────────────────────────────────────────
function googleBody(o, d, depart, pref) {
  const body = {
    origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    travelMode: 'TRANSIT',
    departureTime: depart.toISOString(),
    computeAlternativeRoutes: true,
    languageCode: 'ko',
  };
  if (pref) body.transitPreferences = pref;
  return body;
}
const GOOGLE_MASK = [
  'routes.duration', 'routes.distanceMeters',
  'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration', 'routes.legs.steps.distanceMeters',
  'routes.legs.steps.startLocation', 'routes.legs.steps.endLocation',
  'routes.legs.steps.transitDetails',
].join(',');
async function googleRoute(o, d, depart, pref) {
  const body = googleBody(o, d, depart, pref);
  if (dry) return { dry: body };
  if (!GOOGLE_KEY) throw new Error('GOOGLE_ROUTES_KEY/GOOGLE_PLACES_KEY 없음');
  const t0 = Date.now();
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': GOOGLE_MASK },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = await res.json();
  if (!res.ok) return { error: `${res.status} ${json.error?.message ?? ''}`.trim(), ms };
  const itineraries = (json.routes ?? []).map(r => {
    const steps = r.legs?.[0]?.steps ?? [];
    // 연속 WALK 는 하나로 합친다
    const legs = [];
    for (const s of steps) {
      const min = Number(String(s.staticDuration ?? '0s').replace('s', '')) / 60;
      if (s.travelMode === 'TRANSIT') {
        const td = s.transitDetails ?? {};
        const sd = td.stopDetails ?? {};
        legs.push({
          kind: 'transit', mode: td.transitLine?.vehicle?.type ?? 'TRANSIT',
          line: td.transitLine?.nameShort ?? td.transitLine?.name ?? '',
          from: { name: sd.departureStop?.name, ...ll(sd.departureStop?.location?.latLng) },
          to: { name: sd.arrivalStop?.name, ...ll(sd.arrivalStop?.location?.latLng) },
          durationMin: round1(min), stops: td.stopCount ?? null, headway: td.headway ?? null,
          departAt: sd.departureTime ?? null, arriveAt: sd.arrivalTime ?? null,
        });
      } else {
        const last = legs[legs.length - 1];
        if (last && last.kind === 'walk') { last.durationMin = round1(last.durationMin + min); last.distanceM += s.distanceMeters ?? 0; last.to = ll(s.endLocation?.latLng); }
        else legs.push({ kind: 'walk', from: ll(s.startLocation?.latLng), to: ll(s.endLocation?.latLng), durationMin: round1(min), distanceM: s.distanceMeters ?? 0 });
      }
    }
    return { provider: 'google', durationMin: round1(Number(String(r.duration ?? '0s').replace('s', '')) / 60), distanceM: r.distanceMeters, legs };
  });
  return { itineraries, ms };
}
const ll = p => (p ? { lat: p.latitude, lng: p.longitude } : {});
const round1 = n => Math.round(n * 10) / 10;

// ── TMAP 대중교통 ─────────────────────────────────────────────────────
function tmapBody(o, d, depart) {
  return { startX: String(o.lng), startY: String(o.lat), endX: String(d.lng), endY: String(d.lat), count: 3, lang: 0, format: 'json', searchDttm: yyyymmddhhmi(depart) };
}
async function tmapRoute(o, d, depart) {
  const body = tmapBody(o, d, depart);
  if (dry) return { dry: body };
  if (!TMAP_KEY) throw new Error('TMAP_APP_KEY 없음');
  const t0 = Date.now();
  const res = await fetch('https://apis.openapi.sk.com/transit/routes', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', appKey: TMAP_KEY }, body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = await res.json();
  if (!res.ok || json.result?.status && json.result.status !== 200) return { error: `${res.status} ${json.result?.message ?? JSON.stringify(json).slice(0, 200)}`, ms };
  const itineraries = (json.metaData?.plan?.itineraries ?? []).map(it => ({
    provider: 'tmap', durationMin: round1((it.totalTime ?? 0) / 60), distanceM: it.totalDistance,
    legs: (it.legs ?? []).map(l => ({
      kind: l.mode === 'WALK' ? 'walk' : 'transit', mode: l.mode, line: l.route ?? '',
      from: { name: l.start?.name, lat: l.start?.lat, lng: l.start?.lon }, to: { name: l.end?.name, lat: l.end?.lat, lng: l.end?.lon },
      durationMin: round1((l.sectionTime ?? 0) / 60), distanceM: l.distance, stops: l.passStopList?.stationList?.length ?? null,
    })),
  }));
  return { itineraries, ms };
}

// ── 요약 ──────────────────────────────────────────────────────────────
function summarize(it) {
  const t = it.legs.filter(l => l.kind === 'transit');
  const w = it.legs.filter(l => l.kind === 'walk');
  return {
    총분: it.durationMin,
    승차: t[0] ? `${t[0].from.name}(${t[0].line})` : '-',
    환승: t.slice(1).map(l => `${l.from.name}(${l.line})`).join(' → ') || '없음',
    하차: t.length ? t[t.length - 1].to.name : '-',
    도보분: round1(w.reduce((s, l) => s + l.durationMin, 0)),
    좌표: t.every(l => l.from.lat != null && l.to.lat != null) ? 'O' : 'X',
  };
}

async function run() {
  const lines = [`# 대중교통 공급자 스파이크 — ${fmtKst(new Date())} KST`, ''];
  const say = s => { lines.push(s); console.log(s); };
  const providers = provider === 'both' ? ['google', 'tmap'] : [provider];
  for (const c of cases) {
    say(`## ${c.id} — ${c.origin} → ${c.destination} · ${c.departAt} 출발`);
    say(`기대: ${c.expected.board} ${c.expected.line} → ${c.expected.alight}`);
    const [o, d] = dry ? [{ lat: 37.52, lng: 126.86 }, { lat: 37.525, lng: 126.925 }] : await Promise.all([geocode(c.origin), geocode(c.destination)]);
    say(`좌표: O ${o.lat},${o.lng} · D ${d.lat},${d.lng}`);
    const depart = departDate(c.departAt);
    for (const p of providers) {
      const runs = [{ label: '기본', pref: undefined, at: depart }];
      if (p === 'google') runs.push({ label: '지하철우선', pref: { allowedTravelModes: ['SUBWAY', 'TRAIN'] }, at: depart });
      runs.push({ label: '+40분 출발(배차 반영 확인)', pref: undefined, at: new Date(depart.getTime() + 40 * 60e3) });
      for (const r of runs) {
        const res = p === 'google' ? await googleRoute(o, d, r.at, r.pref) : await tmapRoute(o, d, r.at);
        if (res.dry) { say(`\n[${p} · ${r.label}] 요청 본문:\n\`\`\`json\n${JSON.stringify(res.dry, null, 2)}\n\`\`\``); continue; }
        if (res.error) { say(`\n[${p} · ${r.label}] 오류: ${res.error} (${res.ms}ms)`); continue; }
        say(`\n[${p} · ${r.label}] ${fmtKst(r.at)} 출발 · ${res.ms}ms · 경로 ${res.itineraries.length}개`);
        say('| # | 총분 | 승차 | 환승 | 하차 | 도보분 | 좌표 |');
        say('|---|---|---|---|---|---|---|');
        res.itineraries.forEach((it, i) => { const s = summarize(it); say(`| ${i + 1} | ${s.총분} | ${s.승차} | ${s.환승} | ${s.하차} | ${s.도보분} | ${s.좌표} |`); });
        if (flag('legs')) say('```json\n' + JSON.stringify(res.itineraries[0]?.legs, null, 1) + '\n```');
      }
    }
    say('');
  }
  if (outPath) { fs.writeFileSync(path.join(ROOT, outPath), lines.join('\n') + '\n'); console.log(`\n→ ${outPath}`); }
}
run().catch(e => { console.error('실패:', e.message); process.exit(1); });
