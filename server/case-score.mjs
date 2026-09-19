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
  'swap', 'reset', 'dest', 'origin', 'order', 'qnot', 'nstops', 'minstops', 'ambopt',
  'whyhas', 'whynot', 'why1', 'near', 'lb', 'la', 'nw',
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
  // 위치 — 사용자가 말한 쪽 끝을 뽑았나. 말하지 않았으면 any 여야 한다(지어내지 않는가)
  if (e.near && !got.stops.some(s => s.op !== 'remove' && (s.near ?? 'any') === e.near))
    fails.push(`near≠${e.near}`);
  // 태그는 add 된 경유지에서만 본다 — remove 의 태그는 스키마가 이미 버린다
  if (e.lb && !got.stops.some(s => s.op !== 'remove' && (s.loadBefore ?? 'none') === e.lb))
    fails.push(`loadBefore≠${e.lb}`);
  if (e.la && !got.stops.some(s => s.op !== 'remove' && (s.loadAfter ?? 'none') === e.la))
    fails.push(`loadAfter≠${e.la}`);
  if (e.nw && !got.stops.some(s => s.op !== 'remove' && (s.needWhen ?? 'unknown') === e.nw))
    fails.push(`needWhen≠${e.nw}`);
  if (e.rej === true && !got.reject) fails.push('reject 안 함');
  if (e.rej === false && got.reject) fails.push('잘못 거절');
  if (e.amb && got.ambiguous.length === 0) fails.push('되묻지 않음');
  // 가장 중요한 축 — 쓰레기 입력에 경유지를 지어내지 않는가
  if (e.nostop && got.stops.length > 0) fails.push(`환각: ${flat.join(',')}`);

  // 업종 되묻기 — 넓은 업종은 선택지를 함께 내고, 이미 좁은 질의는 묻지 않아야 한다.
  // 양방향을 다 세야 한다: Task 1 리뷰에서 "묻지 말아야 할 스톱에 되묻기가 붙는" 버그가
  // 나왔는데, '묻지 않음'만 실패로 세는 기존 e.amb 로는 절대 안 드러났다.
  if (e.ambopt != null) {
    const asks = got.ambiguous.filter(a => typeof a.field === 'string' && a.field.startsWith('stop:'));
    if (asks.length !== e.ambopt) fails.push(`stop되묻기=${asks.length}≠${e.ambopt}`);
    for (const a of asks) {
      const o = a.options ?? [];
      if (o.length < 2) fails.push(`선택지 ${o.length}개: ${a.field}`);
      else if (o[o.length - 1] !== '상관없어요') fails.push(`끝이 '상관없어요' 아님: ${o.join('/')}`);
      const q = a.field.slice('stop:'.length);
      if (!got.stops.some(s => s.op !== 'remove' && s.queries.includes(q)))
        fails.push(`없는 경유지를 가리킨다: ${a.field}`);
    }
  }

  /*
    할 일(why) — 이제 화면에 뜨는 문장이라 채점 대상이다.

    `whyhas`: add 경유지 중 **하나라도** why에 이 조각들을 전부 품어야 한다.
      부분 문자열로 본다 — '수선'과 '맡기'를 요구하면 '옷 수선 맡기기'도
      '수선 맡기기'도 통과한다. 어미까지 고정하면 채점기가 문체를 강요하게 된다.
    `whynot`: 이 말이 why에 들어가면 실패. 사용자가 말하지 않은 걸 불려 쓰는 걸 잡는다.
    `why1`: add 경유지 전부가 why 한 줄짜리여야 한다 — 쉼표·가운뎃점으로 이은
      나열은 허용하되(`우유·계란 사기`는 한 행동이다) 줄바꿈으로 쪼갠 목록은 막는다.
  */
  const addWhys = got.stops.filter(s => s.op !== 'remove').map(s => s.why ?? '');
  if (e.whyhas && !addWhys.some(w => e.whyhas.every(frag => w.includes(frag))))
    fails.push(`whyhas ${e.whyhas} (why=${JSON.stringify(addWhys)})`);
  if (e.whynot && addWhys.some(w => e.whynot.some(frag => w.includes(frag))))
    fails.push(`whynot ${e.whynot} (why=${JSON.stringify(addWhys)})`);
  if (e.why1 && addWhys.some(w => /[\n;]/.test(w)))
    fails.push(`why 가 여러 줄: ${JSON.stringify(addWhys)}`);

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

/**
 * 한 케이스를 여러 번 돌린 결과에서 **무엇이 흔들렸는지** 가른다.
 *
 * 두 신호를 절대 섞지 않는다:
 * - `extractionFails` — 그 회차가 경유지를 **하나도 못 뽑았다.** 사용자가 말한 요청이
 *   통째로 사라진다는 뜻이라, 태그가 갈리는 것보다 훨씬 무겁다.
 * - `flips` — 경유지를 뽑은 회차들 **사이에서** 태그 값이 갈렸다. 방향이 조금 달라진다.
 *
 * 왜 갈라야 하나: 2026-09-19 측정에서 `needWhen` 이 실제로는 한 번도 안 갈렸는데
 * 22% 로 보고됐다. 경유지 0건인 회차를 `-` 라는 **태그 값**으로 세는 바람에, 0건
 * 한 번이 네 태그를 동시에 불안정으로 만들었다. 그래서 진짜 신호(추출이 통째로
 * 실패한다)가 태그 통계에 묻혀 보이지 않았다.
 *
 * @param outs 회차별 Intent. 응답이 아예 없던 회차는 `null`
 * @returns `values[t]` 는 **경유지를 뽑은 회차만** 모은 값들이라 회차 번호와 길이가 다를 수 있다
 */
export function analyzeCaseRuns(outs, tags) {
  const answered = outs.filter(o => o != null);
  const withStop = answered.filter(o => (o.stops ?? []).length > 0);
  const values = {};
  const flips = {};
  for (const t of tags) {
    values[t] = withStop.map(o => o.stops[0][t] ?? '-');
    // 값이 0개나 1개면 "갈렸다"고 말할 수 없다
    flips[t] = new Set(values[t]).size > 1;
  }
  return { answered: answered.length, withStop: withStop.length, extractionFails: answered.length - withStop.length, values, flips };
}
