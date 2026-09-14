/**
 * 케이스 채점 — 목과 LLM이 **같은 자를 쓰게** 하는 유일한 자리.
 *
 * `run-cases.mjs`(목)와 `run-server-cases.mjs`(서버 /extract)가 이걸 공유한다.
 * 자가 둘이면 두 숫자를 나란히 놓는 순간 의미가 없어진다.
 *
 * 여기서 판정하지 않는 것: 소요시간·거리·도착 가능 여부.
 * 그건 라우팅과 코드의 몫이고 LLM이 지어내면 안 된다(AGENTS.md).
 */

/** `expect`에 이 키가 하나라도 있어야 '검증됨'이다. note만 있으면 미검증 — 통과가 아니다 */
export const CHECKED_KEYS = [
  'qhas', 'qmulti', 'n', 'at', 'm', 'op', 'lock', 'flex', 'open', 'rej', 'amb', 'nostop',
  'swap', 'reset', 'dest', 'origin', 'order', 'qnot', 'nstops', 'minstops',
];

/**
 * 케이스 하나를 채점한다.
 * @param {object} c    cases.jsonl 한 줄
 * @param {object} got  Intent (목이 냈든 서버가 냈든 모양이 같다)
 * @returns {{ g:string, text:string, fails:string[], note?:string, flat:string[], got:object, checked:boolean }}
 */
export function scoreCase(c, got) {
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
  const checked = CHECKED_KEYS.some(k => k in e);
  return { g: c.g, text: c.text, fails, note: e.note, flat, got, checked };
}

/** 케이스 러너가 공유하는 컨텍스트 — 좌표를 아는 곳은 이 셋뿐이다(mockData RECENT_DESTINATIONS) */
export const KNOWN_PLACES = ['회사', '집', '오크밸리 숙소'];

/** 그룹별 집계 + 전체 한 줄. 두 러너의 출력이 같은 모양이어야 비교가 된다 */
export function summarize(rows) {
  const byGroup = {};
  for (const r of rows) {
    byGroup[r.g] ??= { n: 0, bad: 0, un: 0 };
    byGroup[r.g].n++;
    if (!r.checked) byGroup[r.g].un++;
    else if (r.fails.length) byGroup[r.g].bad++;
  }
  const bad = rows.filter(r => r.checked && r.fails.length);
  const unchecked = rows.filter(r => !r.checked);
  return {
    byGroup,
    total: rows.length,
    checked: rows.length - unchecked.length,
    failed: bad.length,
    unchecked: unchecked.length,
    bad,
    uncheckedRows: unchecked,
  };
}
