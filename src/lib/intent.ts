/**
 * 채팅 문장 → 의도 추출.
 *
 * server/prompts/extract-intent.md 의 v2 스키마를 그대로 구현한 로컬 목이다.
 * 나중에 이 함수 몸통만 서버 호출로 바꾸면 되도록 입출력을 프롬프트와 맞춰 뒀다.
 *
 * 규칙도 프롬프트와 같다 — 소요시간·가능 여부는 만들지 않는다.
 * '10분 안에 마트'가 가능한지는 라우팅 결과로 코드가 판정한다.
 */

/** 경유지마다 붙는 동작. v2에서는 문장당 하나였고, 그래서
    '올리브영 대신 이마트'(제거+추가)를 표현할 수 없었다 */
export type StopOp = 'add' | 'remove';

export type IntentStop = {
  op: StopOp;
  /** 검색어 후보. 하나로 좁히지 않는다 — '택배'는 우체국일 수도 편의점일 수도 있다 */
  queries: string[];
  kind: 'brand' | 'category' | 'specific';
  /** 그 경유지에서 할 일. 첫 할 일로 그대로 들어간다 */
  why: string;
  count: number;
  /** false면 특정 지점 고정 — 최적화 대상에서 뺀다 */
  flexible: boolean;
  openNow: boolean;
};

export type Intent = {
  /** true면 기존 경유지를 비우고 stops로 새로 시작한다 */
  resetStops: boolean;
  stops: IntentStop[];
  /** 출발지·목적지 변경. 경유지가 아니다 —
      좌표를 아는 곳이 아니면 적용하지 않고 되묻는다 */
  endpoints: { origin?: string; destination?: string };
  /** auto=코드가 정렬 · locked=사용자가 순서를 지정 · reshuffle=다시 짜달라 */
  order: 'auto' | 'locked' | 'reshuffle';
  /** 자정 기준 분 */
  arriveBy: number | null;
  mode: 'car' | 'walk' | 'transit' | null;
  /** 길찾기와 무관한 요청 */
  reject: { say: string } | null;
  ambiguous: { field: string; question: string }[];
};

export type IntentContext = {
  currentStops: string[];
  /** 좌표를 아는 장소 이름들 — 목적지 변경은 여기 있을 때만 적용한다 */
  knownPlaces?: string[];
};

/* 목 사전 — 실제 서버에서는 LLM이 뽑고 카카오 로컬이 후보를 찾는다.
   여기서는 데이터셋 풀에 있는 이름까지 후보에 넣어야 매칭이 된다 */
const BRANDS = ['올리브영', '스타벅스', '파리바게뜨', '교촌', 'CU', 'GS25', '이마트'];

const CATEGORIES: { keys: string[]; queries: string[]; why: string }[] = [
  { keys: ['빵', '베이커리', '제과'], queries: ['파리바게뜨', '베이커리'], why: '빵 사기' },
  { keys: ['커피', '카페', '아메리카노'], queries: ['스타벅스', '카페'], why: '커피 사기' },
  { keys: ['택배', '등기', '소포'], queries: ['우체국', '편의점'], why: '택배 부치기' },
  { keys: ['약국', '약'], queries: ['약국'], why: '약 사기' },
  { keys: ['은행', '입금', '출금', '현금', 'ATM'], queries: ['은행'], why: '은행 업무' },
  { keys: ['편의점'], queries: ['CU', 'GS25', '편의점'], why: '편의점 들르기' },
  { keys: ['마트', '장보기'], queries: ['이마트', '마트'], why: '장보기' },
  { keys: ['밥', '식사', '점심', '저녁'], queries: ['음식점'], why: '식사' },
  { keys: ['치킨'], queries: ['교촌', '치킨'], why: '치킨 포장' },
  { keys: ['화장품', '선크림'], queries: ['올리브영'], why: '화장품 사기' },
  { keys: ['기름', '주유', '휘발유'], queries: ['주유소'], why: '주유' },
];

/** 길찾기와 무관한 요청 */
const OFF_TOPIC = ['날씨', '뉴스', '주가', '번역', '노래', '농담'];

const NUM_WORDS: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6 };

/** '9시까지', '오후 6시반까지' → 자정 기준 분.
    여러 개면 가장 이른 것 — 마감은 빡빡한 쪽으로 잡아야 안전하다 */
function parseArriveBy(text: string): number | null {
  const re = /(오전|오후|아침|저녁|밤)?\s*([0-9]{1,2})\s*시\s*(반|[0-9]{1,2}\s*분)?\s*(까지|전에)/g;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    let h = parseInt(m[2], 10);
    const half = m[3];
    const min = half ? (half.includes('반') ? 30 : parseInt(half, 10)) : 0;
    const pm = m[1] === '오후' || m[1] === '저녁' || m[1] === '밤';
    if (pm && h < 12) h += 12;
    if (h > 23 || min > 59) continue;
    const v = h * 60 + min;
    if (best == null || v < best) best = v;
  }
  return best;
}

function parseCount(text: string): number {
  const m = text.match(/([0-9]+|한|두|세|네|다섯|여섯)\s*(개|곳|군데)/);
  if (!m) return 1;
  const n = NUM_WORDS[m[1]] ?? parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function modeHits(text: string): Intent['mode'][] {
  const hits: Intent['mode'][] = [];
  if (/지하철|버스|대중교통|전철/.test(text)) hits.push('transit');
  if (/걸어|도보/.test(text)) hits.push('walk');
  if (/차로|운전|자차|자동차/.test(text)) hits.push('car');
  return hits;
}

/** 계획에 들어 있는 경유지 중 문장이 가리키는 것을 찾는다 */
function findInPlan(text: string, currentStops: string[]): string | undefined {
  return currentStops.find(s => {
    const brand = s.split(' ')[0];
    if (text.includes(brand)) return true;
    return CATEGORIES.some(c => c.keys.some(k => text.includes(k) && c.queries.some(q => s.includes(q))));
  });
}

/** '목적지를 강남역으로', '회사 말고 집으로' → 출발지·목적지 변경 */
function parseEndpoints(text: string): Intent['endpoints'] {
  const out: Intent['endpoints'] = {};
  const dest = text.match(/목적지(?:를|는)?\s*([가-힣A-Za-z0-9 ]{1,20}?)(?:으로|로)/);
  if (dest) out.destination = dest[1].trim();
  const origin = text.match(/출발지(?:를|는)?\s*([가-힣A-Za-z0-9 ]{1,20}?)(?:으로|로)/);
  if (origin) out.origin = origin[1].trim();
  // '회사 말고 집으로 가자' — 목적지 교체
  if (!out.destination) {
    const swap = text.match(/([가-힣A-Za-z0-9]{1,12})\s*말고\s*([가-힣A-Za-z0-9]{1,12}?)(?:으로|로)\s*(?:가|갈|갑)/);
    if (swap) out.destination = swap[2];
  }
  if (!out.origin && /([가-힣A-Za-z0-9]{1,12})에서\s*출발/.test(text)) {
    out.origin = text.match(/([가-힣A-Za-z0-9]{1,12})에서\s*출발/)![1];
  }
  return out;
}

export function extractIntent(text: string, ctx: IntentContext): Intent {
  const modes = modeHits(text);
  const base: Intent = {
    resetStops: false,
    stops: [],
    endpoints: {},
    order: /순서\s*(바꿔|다시|재배치)|다시\s*짜/.test(text)
      ? 'reshuffle'
      : /먼저|순서대로|그다음|그 다음/.test(text)
        ? 'locked'
        : 'auto',
    arriveBy: parseArriveBy(text),
    mode: modes.length === 1 ? modes[0] : null,
    reject: null,
    ambiguous: [],
  };

  if (modes.length > 1) {
    base.ambiguous.push({ field: 'mode', question: '어떤 이동수단으로 갈까요?' });
  }

  // 길찾기와 무관하면 경유지를 억지로 만들지 않는다
  if (OFF_TOPIC.some(k => text.includes(k))) {
    return { ...base, reject: { say: '길 찾는 것만 도와드릴 수 있어요.' } };
  }
  // 시스템을 캐거나 조종하려는 말 — 계획을 건드리지 않고 거절한다.
  // 진짜 방어는 서버의 스키마 검증이고, 이건 1차선일 뿐이다
  if (/이전\s*지시|시스템\s*프롬프트|규칙\s*(다\s*)?무시|너는\s*이제|API\s*키/i.test(text)) {
    return { ...base, reject: { say: '길 찾는 것만 도와드릴 수 있어요.' } };
  }

  // 출발지·목적지 변경은 경유지가 아니다
  const endpoints = parseEndpoints(text);
  if (endpoints.origin || endpoints.destination) {
    const known = ctx.knownPlaces ?? [];
    const name = endpoints.destination ?? endpoints.origin!;
    if (!known.some(k => k.includes(name) || name.includes(k))) {
      return {
        ...base,
        endpoints,
        ambiguous: [{ field: 'endpoints', question: `'${name}'이 어디인지 검색해서 골라주세요.` }],
      };
    }
    return { ...base, endpoints };
  }

  // 전체 초기화
  if (/다\s*(지우|지워|취소)|처음부터|전부\s*(지우|삭제)/.test(text)) {
    return { ...base, resetStops: true };
  }

  // 'A 대신 B' — 제거와 추가가 한 문장에 있다. v2에서 표현 못 하던 자리다
  const swap = text.match(/([가-힣A-Za-z0-9]{1,12})\s*(?:대신|말고)\s*([가-힣A-Za-z0-9]{1,12})/);
  if (swap) {
    const gone = findInPlan(swap[1], ctx.currentStops) ?? swap[1];
    const add = extractStops(swap[2], false, 1);
    if (add.length) {
      return {
        ...base,
        stops: [
          { op: 'remove', queries: [gone], kind: 'specific', why: '', count: 1, flexible: false, openNow: false },
          ...add,
        ],
      };
    }
  }

  // 제거만 하는 말
  if (/빼|삭제|취소/.test(text)) {
    const target = findInPlan(text, ctx.currentStops);
    if (target) {
      return {
        ...base,
        stops: [{ op: 'remove', queries: [target], kind: 'specific', why: '', count: 1, flexible: false, openNow: false }],
      };
    }
  }

  const openNow = /문 ?연|영업 ?중|열려/.test(text);
  const count = parseCount(text);

  // 사람은 장소가 아니다 — 어디서 태울지 모르면 되묻는다
  if (/픽업|태우|태워|데리러|모시러/.test(text)) {
    base.ambiguous.push({ field: 'stops', question: '어디서 태우면 될까요?' });
  }
  // '동생 집', '친구 집' — 사람 이름이 붙은 장소는 좌표를 모른다
  if (/(동생|친구|엄마|아빠|형|누나|언니|오빠)\s*집/.test(text)) {
    base.ambiguous.push({ field: 'stops', question: '그곳 주소를 검색해서 골라주세요.' });
  }

  /* 부정 — 통째로 비우면 '커피는 됐고 은행만'의 은행까지 날아간다.
     부정어 앞은 버리고 뒤만 본다 */
  const NEG = /안 ?들러|들르지 ?마|안 ?가|가지 ?마|필요 ?없|됐고|됐어|말고/;
  let scope = text;
  if (NEG.test(text)) {
    scope = text.split(NEG).pop() ?? '';
    if (/딴 ?데|다른 ?데|다른 ?곳/.test(text)) {
      base.ambiguous.push({ field: 'stops', question: '어떤 곳으로 바꿀까요?' });
    }
  }

  const stops = extractStops(scope, openNow, count);

  /* 아무것도 못 뽑았는데 문장이 '부탁'처럼 보이면 침묵하지 않는다.
     오타·줄임말·영문·다국어가 여기로 떨어진다 — 조용히 비면 인사와 구별이 안 된다 */
  const looksLikeRequest =
    /들르|들러|들렀|들를|갔다|가야|가자|사야|사고|해야|필요|급해|뽑아|넣어|추가|있는 ?데|좀|줘|래|하고 싶|寄り|去|stop by|want/i.test(
      text,
    );
  const nothingFound =
    stops.length === 0 &&
    base.arriveBy == null &&
    base.mode == null &&
    !base.resetStops &&
    base.ambiguous.length === 0;
  if (nothingFound && looksLikeRequest) {
    base.ambiguous.push({ field: 'text', question: '어디를 들르실지 다시 말씀해 주세요.' });
  }

  return { ...base, stops };
}

/** 문장에서 브랜드·카테고리를 뽑아 add 경유지로 만든다 */
function extractStops(text: string, openNow: boolean, count: number): IntentStop[] {
  const found: IntentStop[] = [];
  const seen = new Set<string>();

  for (const brand of BRANDS) {
    if (!text.includes(brand) || seen.has(brand)) continue;
    seen.add(brand);
    // '강남역 스타벅스'처럼 앞에 지역이 붙으면 특정 지점으로 본다
    const specific = new RegExp(`[가-힣A-Za-z0-9]+(역|점|동|구)\\s*${brand}|${brand}\\s*[가-힣]+점`).test(text);
    found.push({
      op: 'add',
      queries: [brand],
      kind: specific ? 'specific' : 'brand',
      why: CATEGORIES.find(c => c.queries.includes(brand))?.why ?? `${brand} 들르기`,
      count,
      flexible: !specific,
      openNow,
    });
  }

  for (const cat of CATEGORIES) {
    if (!cat.keys.some(k => text.includes(k))) continue;
    if (cat.queries.some(q => seen.has(q))) continue;
    cat.queries.forEach(q => seen.add(q));
    found.push({ op: 'add', queries: cat.queries, kind: 'category', why: cat.why, count, flexible: true, openNow });
  }
  return found;
}
