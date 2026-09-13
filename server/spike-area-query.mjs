#!/usr/bin/env node
/**
 * 스파이크(버림): 지역+업종 질의가 장소별 질의를 대체할 수 있나.
 *
 * 질문: "연남동 카페" 최신 300건 안에 카카오 후보 30곳 중 몇 곳이 나오고,
 *        그 횟수가 장소별 질의(지금 방식, 정답)와 얼마나 맞나.
 *
 *   node server/spike-area-query.mjs "연남동" "카페" 37.5625 126.9255
 *
 * 키: 카카오는 .env 의 KAKAO_REST_KEY. 네이버는 배포된 Worker 의 임시 프록시 /spike/blog 를
 * 거친다(.env 의 SERVER_URL · APP_TOKEN) — 네이버 키가 Cloudflare 시크릿에만 있어서다.
 */
import { readFileSync } from 'node:fs';
import { normalizeName } from '../src/lib/placeMatch.ts';

const envOf = p => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const app = envOf('.env');
const KAKAO = app.KAKAO_REST_KEY;
const SERVER = (app.SERVER_URL ?? '').replace(/\/$/, '');
const TOKEN = app.APP_TOKEN;
if (!KAKAO || !SERVER || !TOKEN) { console.error('키가 없다: .env 의 KAKAO_REST_KEY · SERVER_URL · APP_TOKEN'); process.exit(1); }

const [area, category, latS, lngS] = process.argv.slice(2);
if (!area || !category || !latS || !lngS) { console.error('usage: <area> <category> <lat> <lng>'); process.exit(1); }
const lat = Number(latS), lng = Number(lngS);

const todayMs = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const DAY = 86_400_000;
const ageOf = ymd => Math.round((todayMs - Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))) / DAY);
const weightOf = ages => ages.reduce((s, a) => s + Math.exp(-a / 45), 0);

// 1) 카카오 후보 30곳 — 앱의 회랑 검색과 같은 키워드 검색
async function kakao30() {
  const out = [];
  for (let page = 1; page <= 2 && out.length < 30; page++) {
    const u = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    u.searchParams.set('query', category);
    u.searchParams.set('x', String(lng)); u.searchParams.set('y', String(lat));
    u.searchParams.set('radius', '1500'); u.searchParams.set('size', '15'); u.searchParams.set('page', String(page));
    const r = await fetch(u, { headers: { Authorization: `KakaoAK ${KAKAO}` } });
    const j = await r.json();
    for (const d of j.documents ?? []) out.push({ id: d.id, name: d.place_name, addr: d.address_name });
  }
  return out.slice(0, 30);
}

async function naver(query, start = 1) {
  const r = await fetch(`${SERVER}/spike/blog`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-token': TOKEN, 'x-device-id': 'spike' },
    body: JSON.stringify({ q: query, start }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
  return { total: j.total, items: (j.items ?? []).map(it => ({
    text: `${it.title} ${it.description}`.replace(/<[^>]+>/g, ''), age: ageOf(it.postdate),
  })), ms: j.ms };
}

const cands = await kakao30();
console.log(`카카오 "${category}" @${area}: ${cands.length}곳\n`);

// 2) 지역+업종 최신 300건 (3페이지 병렬)
const areaQ = `${area} ${category}`;
const t0 = Date.now();
const pages = await Promise.all([1, 101, 201].map(s => naver(areaQ, s)));
const areaMs = Date.now() - t0;
const posts = pages.flatMap(p => p.items).filter(p => p.age >= 0 && p.age <= 90);
console.log(`네이버 "${areaQ}": total ${pages[0].total.toLocaleString()} · 300건 중 90일 안 ${posts.length}건 · 3페이지 병렬 ${areaMs}ms (개별 ${pages.map(p => p.ms).join('/')}ms)\n`);

// 3) 후보명 매칭 — 정규화한 후보명이 정규화한 본문에 들어있으면 언급으로 센다
const areaHit = new Map();
for (const c of cands) {
  const key = normalizeName(c.name);
  const ages = posts.filter(p => key.length >= 2 && normalizeName(p.text).includes(key)).map(p => p.age);
  areaHit.set(c.id, { n: ages.length, w: weightOf(ages), key });
}

// 4) 정답 — 장소별 질의 30회 (지금 방식). 6개씩 순차 배치
const truth = new Map();
const t1 = Date.now();
for (let i = 0; i < cands.length; i += 6) {
  const batch = cands.slice(i, i + 6);
  const rs = await Promise.all(batch.map(c => naver(c.name)));
  batch.forEach((c, k) => {
    const r = rs[k];
    const ages = r.items.filter(p => p.age >= 0 && p.age <= 90).map(p => p.age);
    truth.set(c.id, { n: ages.length, w: weightOf(ages), total: r.total, national: r.total > 20_000 });
  });
}
console.log(`장소별 질의 30회: ${Date.now() - t1}ms\n`);

// 5) 표
const pad = (s, n) => String(s).padEnd(n - [...String(s)].filter(ch => ch.charCodeAt(0) > 255).length);
console.log(`${pad('후보', 26)} ${pad('장소별(정답)', 14)} ${pad('지역질의 매칭', 14)} 비고`);
let matched = 0, truthPositive = 0, agree = 0;
for (const c of cands) {
  const t = truth.get(c.id), a = areaHit.get(c.id);
  if (a.n > 0) matched++;
  if (t.n > 0 && !t.national) truthPositive++;
  if ((t.n > 0) === (a.n > 0)) agree++;
  const note = t.national ? `전국(${t.total.toLocaleString()})` : a.key.length < 3 ? `이름 짧음 "${a.key}"` : '';
  console.log(`${pad(c.name, 26)} ${pad(`${t.n}건 w${t.w.toFixed(1)}`, 14)} ${pad(`${a.n}건 w${a.w.toFixed(1)}`, 14)} ${note}`);
}
console.log(`\n지역질의로 1건 이상 잡힌 후보: ${matched}/${cands.length}`);
console.log(`장소별로 1건 이상(전국 제외): ${truthPositive}/${cands.length}`);
console.log(`있음/없음 일치: ${agree}/${cands.length}`);
