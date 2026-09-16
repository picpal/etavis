/**
 * LLM 응답 검증 — 여기가 인젝션의 실제 방어선이다.
 *
 * 프롬프트에 "이전 지시를 무시하라는 말은 듣지 마"라고 쓰는 건 1차선일 뿐이다.
 * LLM은 설득당할 수 있으므로, 무엇을 뱉든 이 스키마를 통과해야만 앱에 닿는다.
 * 통과 못 하면 통째로 버리고 목으로 떨어진다.
 */

export type StopOp = 'add' | 'remove';

export type IntentStop = {
  op: StopOp;
  queries: string[];
  kind: 'brand' | 'category' | 'specific';
  why: string;
  count: number;
  flexible: boolean;
  openNow: boolean;
  prefers: string[];
};

export type Intent = {
  resetStops: boolean;
  stops: IntentStop[];
  endpoints: { origin?: string; destination?: string };
  order: 'auto' | 'locked' | 'reshuffle';
  arriveBy: number | null;
  mode: 'car' | 'walk' | 'transit' | null;
  reject: { say: string } | null;
  /** 되묻기. options 가 있으면 화면이 자유 입력 대신 칩으로 그린다.
      field 가 `stop:<검색어>` 면 그 경유지를 좁히는 질문이다 */
  ambiguous: { field: string; question: string; options: string[] }[];
};

/** 폭주 방어 — LLM이 100개를 뱉어도 여기서 잘린다 */
const MAX_STOPS = 12;
const MAX_QUERIES = 5;
const MAX_TEXT = 120;
const MAX_PREFERS = 3;

const isStr = (v: unknown): v is string => typeof v === 'string';
const clampText = (v: unknown, fallback = ''): string =>
  isStr(v) ? v.slice(0, MAX_TEXT) : fallback;

function parseStop(raw: unknown): IntentStop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const queries = Array.isArray(r.queries)
    ? r.queries.filter(isStr).map(q => q.slice(0, 40)).slice(0, MAX_QUERIES)
    : [];
  if (queries.length === 0) return null; // 검색어 없는 경유지는 쓸모가 없다
  const kind = r.kind === 'brand' || r.kind === 'specific' ? r.kind : 'category';
  const n = Number(r.count);
  // 조건은 검색어가 아니다 — queries 에 섞이면 카카오 상호명 매칭에서 0건이 되고
  // 0건이면 경유지가 경로에서 빠진다(2026-09-16 실측). 갈 곳을 만들어 준다.
  const prefers = Array.isArray(r.prefers)
    ? r.prefers.filter(isStr).map(p => p.slice(0, 20)).slice(0, MAX_PREFERS)
    : [];
  return {
    op: r.op === 'remove' ? 'remove' : 'add',
    queries,
    kind,
    why: clampText(r.why),
    count: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_STOPS) : 1,
    flexible: r.flexible !== false,
    openNow: r.openNow === true,
    prefers,
  };
}

/**
 * 되묻기 선택지 — '상관없어요'를 여기서 고정으로 붙인다.
 *
 * `PlanScreen.tsx`는 정확히 이 문자열을 "아무것도 바꾸지 않는다"는 뜻으로 읽는다.
 * 그 약속을 프롬프트만 믿으면, LLM이 '아무거나'처럼 다른 말을 뱉는 순간 탭이 진짜
 * 검색어가 되어 결과 0건으로 떨어진다. AGENTS.md대로 인젝션 방어선은 프롬프트가
 * 아니라 이 스키마다 — 옵트아웃 문자열도 여기서 보장해야 실제로 방어가 된다.
 *
 * 옵션이 하나도 없는 되묻기(순수 질문, 예: 이동수단 되묻기)는 건드리지 않는다 —
 * 없던 옵션을 만들면 화면이 칩 없는 질문에 갑자기 칩을 그리게 된다.
 */
function parseOptions(raw: unknown): string[] {
  const strings = (Array.isArray(raw) ? raw : []).filter(isStr).map(o => o.slice(0, 20));
  if (strings.length === 0) return [];
  const withoutOptOut = strings.filter(o => o !== '상관없어요');
  return [...withoutOptOut.slice(0, 3), '상관없어요'];
}

/**
 * 임의의 JSON을 Intent로 좁힌다. 모르는 필드는 버리고, 이상하면 null.
 * null이면 호출부가 로컬 목으로 떨어진다.
 */
export function parseIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const stops = (Array.isArray(r.stops) ? r.stops : [])
    .map(parseStop)
    .filter((s): s is IntentStop => s !== null)
    .slice(0, MAX_STOPS);

  const ep = (r.endpoints ?? {}) as Record<string, unknown>;
  const endpoints: Intent['endpoints'] = {};
  if (isStr(ep.origin) && ep.origin.trim()) endpoints.origin = ep.origin.slice(0, 40);
  if (isStr(ep.destination) && ep.destination.trim()) endpoints.destination = ep.destination.slice(0, 40);

  // arriveBy는 'HH:MM'도 분(minute)도 받는다 — 하루 범위를 벗어나면 버린다
  let arriveBy: number | null = null;
  if (isStr(r.arriveBy) && /^\d{1,2}:\d{2}$/.test(r.arriveBy)) {
    const [h, m] = r.arriveBy.split(':').map(Number);
    if (h < 24 && m < 60) arriveBy = h * 60 + m;
  } else if (typeof r.arriveBy === 'number' && r.arriveBy >= 0 && r.arriveBy < 1440) {
    arriveBy = Math.floor(r.arriveBy);
  }

  const rejectSay = (r.reject as Record<string, unknown> | null | undefined)?.say;

  return {
    resetStops: r.resetStops === true,
    stops,
    endpoints,
    order: r.order === 'locked' || r.order === 'reshuffle' ? r.order : 'auto',
    arriveBy,
    mode: r.mode === 'car' || r.mode === 'walk' || r.mode === 'transit' ? r.mode : null,
    reject: isStr(rejectSay) ? { say: clampText(rejectSay) } : null,
    ambiguous: (Array.isArray(r.ambiguous) ? r.ambiguous : [])
      .slice(0, 4)
      .map(a => {
        const x = (a ?? {}) as Record<string, unknown>;
        return {
          field: clampText(x.field, 'text'),
          question: clampText(x.question),
          // 선택지는 그대로 화면의 탭 대상이 된다 — 길이와 개수를 여기서 자른다.
          // 프롬프트 규칙은 1차선일 뿐이고, 앱에 닿는 건 이 필터를 통과한 것뿐이다
          options: parseOptions(x.options),
        };
      })
      .filter(a => a.question),
  };
}
