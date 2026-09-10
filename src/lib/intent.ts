/**
 * 채팅 문장 → 의도 추출.
 *
 * server/prompts/extract-intent.md 의 v2 스키마를 그대로 구현한 로컬 목이다.
 * 나중에 이 함수 몸통만 서버 호출로 바꾸면 되도록 입출력을 프롬프트와 맞춰 뒀다.
 *
 * 규칙도 프롬프트와 같다 — 소요시간·가능 여부는 만들지 않는다.
 * '10분 안에 마트'가 가능한지는 라우팅 결과로 코드가 판정한다.
 */

export type IntentStop = {
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
  op: 'replace' | 'add' | 'remove';
  stops: IntentStop[];
  /** 사용자가 순서를 지정했으면 재정렬하지 않는다 */
  orderLocked: boolean;
  /** 자정 기준 분 */
  arriveBy: number | null;
  mode: 'car' | 'walk' | 'transit' | null;
  /** 길찾기와 무관한 요청 */
  reject: { say: string } | null;
  ambiguous: { field: string; question: string }[];
};

export type IntentContext = { currentStops: string[] };

/* 목 사전 — 실제 서버에서는 LLM이 뽑고 카카오 로컬이 후보를 찾는다.
   여기서는 데이터셋 풀에 있는 이름까지 후보에 넣어야 매칭이 된다 */
const BRANDS = ['올리브영', '스타벅스', '파리바게뜨', '교촌', 'CU', 'GS25', '이마트'];

const CATEGORIES: { keys: string[]; queries: string[]; why: string }[] = [
  { keys: ['빵', '베이커리', '제과'], queries: ['파리바게뜨', '베이커리'], why: '빵 사기' },
  { keys: ['커피', '카페', '아메리카노'], queries: ['스타벅스', '카페'], why: '커피 사기' },
  { keys: ['택배', '등기', '소포'], queries: ['우체국', '편의점'], why: '택배 부치기' },
  { keys: ['약국', '약'], queries: ['약국'], why: '약 사기' },
  { keys: ['은행', '입금', '출금'], queries: ['은행'], why: '은행 업무' },
  { keys: ['편의점'], queries: ['CU', 'GS25', '편의점'], why: '편의점 들르기' },
  { keys: ['마트', '장보기'], queries: ['이마트', '마트'], why: '장보기' },
  { keys: ['밥', '식사', '점심', '저녁'], queries: ['음식점'], why: '식사' },
  { keys: ['치킨'], queries: ['교촌', '치킨'], why: '치킨 포장' },
  { keys: ['화장품', '선크림'], queries: ['올리브영'], why: '화장품 사기' },
];

/** 길찾기와 무관한 요청 */
const OFF_TOPIC = ['날씨', '뉴스', '주가', '번역', '노래', '농담'];

const NUM_WORDS: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6 };

/** '9시까지', '오후 6시반까지' → 자정 기준 분 */
function parseArriveBy(text: string): number | null {
  const m = text.match(/(오전|오후|아침|저녁|밤)?\s*([0-9]{1,2})\s*시\s*(반|[0-9]{1,2}\s*분)?\s*(까지|전에)/);
  if (!m) return null;
  let h = parseInt(m[2], 10);
  const half = m[3];
  const min = half ? (half.includes('반') ? 30 : parseInt(half, 10)) : 0;
  const pm = m[1] === '오후' || m[1] === '저녁' || m[1] === '밤';
  if (pm && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseCount(text: string): number {
  const m = text.match(/([0-9]+|한|두|세|네|다섯|여섯)\s*(개|곳|군데)/);
  if (!m) return 1;
  const n = NUM_WORDS[m[1]] ?? parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseMode(text: string): Intent['mode'] {
  if (/지하철|버스|대중교통|전철/.test(text)) return 'transit';
  if (/걸어|도보|걸어서/.test(text)) return 'walk';
  if (/차로|운전|자차|자동차/.test(text)) return 'car';
  return null;
}

export function extractIntent(text: string, ctx: IntentContext): Intent {
  const base: Intent = {
    op: 'replace',
    stops: [],
    orderLocked: /먼저|순서대로|그다음|그 다음/.test(text),
    arriveBy: parseArriveBy(text),
    mode: parseMode(text),
    reject: null,
    ambiguous: [],
  };

  // 길찾기와 무관하면 경유지를 억지로 만들지 않는다
  if (OFF_TOPIC.some(k => text.includes(k))) {
    return { ...base, reject: { say: '길 찾는 것만 도와드릴 수 있어요.' } };
  }

  // 앞선 계획을 고치는 말 — currentStops를 알아야 해석된다
  if (/빼|삭제|취소|말고/.test(text)) {
    const target = ctx.currentStops.find(s => {
      const brand = s.split(' ')[0];
      return text.includes(brand) || CATEGORIES.some(c => c.keys.some(k => text.includes(k) && s.includes(c.queries[0])));
    });
    if (target) {
      return {
        ...base,
        op: 'remove',
        stops: [{ queries: [target], kind: 'specific', why: '', count: 1, flexible: false, openNow: false }],
      };
    }
  }

  const openNow = /문 ?연|영업 ?중|열려/.test(text);
  const count = parseCount(text);
  const found: IntentStop[] = [];
  const seen = new Set<string>();

  for (const brand of BRANDS) {
    if (!text.includes(brand) || seen.has(brand)) continue;
    seen.add(brand);
    // '강남역 스타벅스'처럼 앞에 지역이 붙으면 특정 지점으로 본다
    const specific = new RegExp(`[가-힣A-Za-z0-9]+(역|점|동|구)\\s*${brand}|${brand}\\s*[가-힣]+점`).test(text);
    found.push({
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
    found.push({ queries: cat.queries, kind: 'category', why: cat.why, count, flexible: true, openNow });
  }

  // 사람은 장소가 아니다 — 어디서 태울지 모르면 되묻는다
  if (/픽업|태우|데리러|모시러/.test(text)) {
    base.ambiguous.push({ field: 'stops', question: '어디서 태우면 될까요?' });
  }

  return { ...base, stops: found };
}
