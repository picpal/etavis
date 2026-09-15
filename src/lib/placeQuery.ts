/**
 * 질의 → 카카오 검색 계획.
 *
 * 6.5가 붙인 `category_group_code`는 15개 남짓의 거친 묶음이고, 문구점·꽃집·세탁소·
 * 동네 마트는 **그룹 코드가 아예 비어 있다**(실측 2026-09-15: 문구점 30/30, 꽃집 30/30,
 * 세탁소 26/26이 빈 값). 그 업종에 존재하는 유일한 분류가 `category_name`이다.
 *
 * 그리고 `'동네 빵집'`은 **검색어가 아니다.** 카카오는 이름만 매칭하는데 가게 이름을
 * 그렇게 짓는 사람이 없어서 실측 0건이다. 6.7의 되묻기가 그 말을 그대로 검색어로
 * 보내고 있었다 — 여기서 `'빵집'` 검색 + 프랜차이즈 제외로 옮긴다.
 *
 * 표는 전부 운영 키 실측이다. 추론으로 쓰면 틀린다(6.5에서 7건이 그렇게 걸렸다).
 */
import { kakaoCategoryFor } from './placeCategory';

export type SearchPlan = {
  /** 카카오에 실제로 보낼 검색어. 원래 질의와 다를 수 있다 */
  query: string;
  /** 카카오 `category_group_code`. 모르면 null */
  categoryCode: string | null;
  /** `category_name`이 이 중 **하나라도** 포함해야 통과. 비면 안 거른다 */
  pathAny: string[];
  /** 이 조각이 경로에 있으면 버린다 */
  pathNot: string[];
  /** 아는 프랜차이즈 이름이 경로에 있으면 버린다 */
  localOnly: boolean;
};

/**
 * '동네 X' · '작은 X' · '소형 X' 는 X 를 찾고 프랜차이즈를 빼라는 뜻이다.
 * 표에 없는 업종이어도 접두사는 뗀다 — 못 거를지언정 0건보다 낫다.
 *
 * 접두사 뒤에 공백을 요구한다(`\s*`가 아니라 `\s+`) — '작은도서관'처럼 그 글자로
 * 시작하는 공식 시설 유형명까지 접두사로 오인해 '도서관'으로 잘라버리면 안 된다.
 * 공백 없이 바로 붙어 있으면 접두사가 아니라 그 단어의 일부다.
 */
const LOCAL_PREFIX = /^(?:동네|작은|소형)\s+/;

/**
 * 앞에서부터 먼저 걸리는 것이 이긴다. `placeCategory.ts`의 표와 같은 규칙이고,
 * 같은 함정이 있다 — 이마트24(편의점)가 이마트(마트)보다 **앞**이어야 한다.
 * 뒤에 두면 "가정,생활 > 편의점 > 이마트24"가 슈퍼마켓 조건에 걸려 전멸한다.
 *
 * `code`는 아는 업종에만 박아둔다(대형마트 행만 해당 — 아래 주석 참고). `local`은
 * '동네' 접두사가 붙었을 때만 쓰는 `pathAny`/`pathNot` 재정의로, 빠진 키는 이 행의
 * 기본값을 그대로 쓴다.
 */
const TABLE: {
  re: RegExp;
  query?: string;
  code?: string;
  pathAny: string[];
  pathNot?: string[];
  local?: { pathAny?: string[]; pathNot?: string[] };
}[] = [
  // 실측: "가정,생활 > 편의점 > GS25 / 세븐일레븐 / CU / 이마트24" — 30/30이 이 경로
  { re: /편의점|씨유|\bcu\b|gs25|세븐일레븐|이마트24|미니스톱/i, pathAny: ['편의점'] },
  // 실측: "가정,생활 > 대형마트 > 이마트" 와 "... > 슈퍼마켓 > 대형슈퍼 > 하나로마트"
  // 두 경로가 다 있다. 대형은 둘 다 받아야 한다.
  // code: 'MT1' — kakaoCategoryFor('마트')는 일부러 null이다(placeCategory.ts의
  // 정규식이 '대형마트|이마트|...'만 잡고 '마트' 단독은 안 잡는다). 검색어를 '마트'로
  // 바꾼 뒤에도 그룹 코드가 저절로 안 붙으니, '대형마트'라고 명시적으로 물어본 이
  // 행에서만 코드를 직접 준다.
  { re: /대형\s*마트|대형\s*슈퍼/i, query: '마트', code: 'MT1', pathAny: ['대형슈퍼', '대형마트'] },
  // code를 절대 넣지 않는다 — 여기 넣으면 평범한 "마트" 검색에도
  // category_group_code=MT1이 실려 나가고, 그룹 코드가 없는 홈마트·우리마트
  // (실측: 빈 값)는 카카오 응답에 아예 안 잡힌다. 그러면 이 태스크를 만든 이유
  // (그룹 코드가 빈 업종을 이름 매칭으로 살리는 것) 자체가 무너진다.
  //
  // local — '동네 마트'는 슈퍼마켓이되 대형슈퍼는 아니다. '대형마트'는 pathAny로
  // 대형슈퍼·대형마트를 둘 다 받아야 하지만(위 행), '동네'가 붙으면 정반대로 대형을
  // 뺀다. 이 예외를 별도 상수(LOCAL_PATH_NOT류)로 빼지 않고 마트 행에 얹어두는 이유:
  // '동네'는 두 겹이다 — 모든 업종에 적용되는 접두사 규칙(프랜차이즈 제외)과, 마트
  // 업종에만 적용되는 경로 재정의(대형 제외). 두 번째를 따로 떼어내면 마트 하나의
  // 규칙을 읽으려고 파일 두 곳을 오가야 한다.
  //
  // 끝에 고정한다 — '스마트폰'의 '마트'까지 잡으면 "가정,생활 > 전자제품 > ... >
  // 휴대폰판매"가 슈퍼마켓 조건에 걸려 0건이 된다. 업종어는 질의 끝에 온다
  // (마트·동네 마트·하나로마트·이마트). 중간에 박힌 건 다른 말이다
  // (스마트폰·슈퍼비전). 이 표의 다른 행은 이런 충돌이 실측되지 않아 고정하지 않는다.
  { re: /(?:마트|슈퍼마켓|슈퍼)$/, pathAny: ['슈퍼마켓', '대형마트'], local: { pathAny: ['슈퍼마켓'], pathNot: ['대형슈퍼'] } },
  // 실측: 150건 전부 "음식점 > 간식 > 제과,베이커리". 와플대학도 여기다 —
  // 그룹 코드로도 category_name 으로도 와플가게는 못 가른다(§6.6 정정)
  //
  // '빵'만 단독 일치로 좁힌다 — 원래 '빵'을 부분일치로 두면 '붕어빵'·'제과제빵학원'
  // 같은 무관한 질의까지 빵집 검색어로 바뀌어 경로 조건이 걸린다. 모르는 질의는
  // 안 거르는 쪽이 안전하다('제과'도 '제과점'으로 좁혀 같은 이유로 '제과제빵학원'을 피한다).
  { re: /^빵$|빵집|베이커리|제과점/i, query: '빵집', pathAny: ['제과,베이커리'] },
  { re: /카페|커피/i, pathAny: ['카페'] },
  { re: /정육|고기\s*사/i, query: '정육점', pathAny: ['정육점'] },
  { re: /문구/i, pathAny: ['문구,사무용품'] },
  { re: /꽃집|꽃\s*사|플라워/i, query: '꽃집', pathAny: ['꽃집,꽃배달'] },
  { re: /세탁소|빨래방|코인빨래/i, pathAny: ['세탁소'] },
  { re: /서점|책방/i, pathAny: ['서점'] },
  { re: /약국/i, pathAny: ['약국'] },
];

/**
 * 아는 프랜차이즈. **경로 어느 조각이든** 이 이름이면 '동네'가 아니다.
 *
 * 구조로 못 가른다 — 브랜드가 4단계에 있기도(…제과,베이커리 > 파리바게뜨),
 * 5단계에 있기도(…테마카페 > 디저트카페 > 백미당) 하고, 4단계가 하위 업종인
 * 경우도 많다(…테마카페 > 디저트카페, …서점 > 독립서점, …병원 > 피부과).
 *
 * 일부러 넣지 않은 것: 김영모과자점·하르당·복호두·버터풀앤크리멀러스처럼 지점이
 * 몇 안 되는 작은 체인. 사용자가 피하고 싶은 건 가맹점이지 작은 체인이 아니다.
 * 빠뜨린 체인은 '동네' 결과에 섞일 뿐이고, 잘못 적은 이름은 멀쩡한 가게를 지운다.
 */
const FRANCHISE = [
  // 빵 — 실측 150건에서 꼬리로 나온 것들
  // '파리바게트'(ㅌ)는 실측 스펠링 변이다 — 2026-09-15, '파리바게트 신트리점'은
  // category_name 이 "음식점 > 간식 > 제과,베이커리"(브랜드 조각 없음)로만 온다.
  // 카카오가 같은 브랜드를 '파리바게뜨'(ㄸ)로도 적어서 두 표기를 다 둔다.
  '파리바게뜨', '파리바게트', '뚜레쥬르', '파리크라상', '아티제', '앤티앤스프레즐', '와플대학', '브레댄코', '코코호도', '던킨',
  // 카페 — 실측
  '스타벅스', '투썸플레이스', '이디야커피', '컴포즈커피', '빽다방', '할리스', '커피빈', '폴바셋',
  '메가MGC커피', '매머드익스프레스', '텐퍼센트커피', '파스쿠찌', '엔제리너스', '탐앤탐스',
  '더벤티', '감성커피', '백미당', '블루보틀',
];

export function planSearch(raw: string): SearchPlan {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(LOCAL_PREFIX, '').trim();
  // 접두사를 뗐는데 남는 게 없으면('동네' 단독 등) 뗄 게 아니라 원래 질의였다 —
  // 빈 검색어를 카카오에 보내면 400이 돌아온다.
  const localOnly = LOCAL_PREFIX.test(trimmed) && stripped.length > 0;
  const base = localOnly ? stripped : trimmed;
  const flat = base.replace(/\s+/g, '');

  const hit = TABLE.find(t => t.re.test(flat));
  const query = hit?.query ?? base;
  const local = localOnly ? hit?.local : undefined;

  return {
    query,
    categoryCode: hit?.code ?? kakaoCategoryFor(query),
    pathAny: local?.pathAny ?? hit?.pathAny ?? [],
    pathNot: local?.pathNot ?? hit?.pathNot ?? [],
    localOnly,
  };
}

/** 계획의 경로 조건을 통과하는가. `category_name`이 없으면 거를 근거가 없으니 통과 */
export function keepByCategoryName(categoryName: string | undefined, plan: SearchPlan): boolean {
  if (!categoryName) return true;
  if (plan.pathAny.length > 0 && !plan.pathAny.some(p => categoryName.includes(p))) return false;
  if (plan.pathNot.some(p => categoryName.includes(p))) return false;
  if (plan.localOnly && FRANCHISE.some(f => categoryName.includes(f))) return false;
  return true;
}

/**
 * `keepByCategoryName`에 더해, **가게 이름**까지 프랜차이즈를 본다.
 *
 * 실측 2026-09-15: '파리바게트 신트리점'은 category_name 이 "음식점 > 간식 >
 * 제과,베이커리"로 끝난다 — 브랜드 조각이 아예 없다. 그런데 같은 브랜드의
 * '파리바게뜨 신정역점'은 "… > 제과,베이커리 > 파리바게뜨"로, 브랜드가 붙어서 온다.
 * 두 응답의 category_name 이 바이트 단위로 같을 수도, 다를 수도 있다는 뜻이라
 * 경로만으로는 이 브랜드를 걸러낼 방법이 구조적으로 없다 — 그래서 이름도 본다.
 *
 * 이름 검사는 일부러 `plan.localOnly`일 때만 켠다. '동네'로 좁힌 검색에서
 * 과하게 거르면 동네 후보 몇 개를 놓치는 정도지만, 모든 질의에 이름 검사를 걸면
 * 평범한 "파리바게뜨" 검색 자체가 텅 빌 수 있다 — 과소 필터링보다 과잉 필터링이
 * 훨씬 비싸다. 이 비대칭이 이 파일 전체의 원칙이다.
 */
export function keepPlace(placeName: string, categoryName: string | undefined, plan: SearchPlan): boolean {
  if (!keepByCategoryName(categoryName, plan)) return false;
  if (plan.localOnly && FRANCHISE.some(f => placeName.includes(f))) return false;
  return true;
}
