/**
 * 주변 · 한줄 소식 시드 — 확정된 경유지에서 만들어 낸다.
 *
 * 하드코딩 배열이던 시절엔 앵커가 `올리브영 평창점` 같은 고정 문자열이라,
 * 실제 경유지(카카오가 준 실명)와 맞을 일이 없어 **계획을 확정하면 목록이 늘 비었다.**
 * 그래서 앵커를 실제 경유지 이름에서 만든다.
 *
 * 서버가 없으므로 이 층은 **데모용 시드**다. 다만 같은 입력에 같은 결과가 나오게
 * 해 둔다 — 렌더마다 작성자·시간이 바뀌면 화면이 살아 있는 게 아니라 고장 나 보인다.
 */

export type NearbyPost = {
  id: string;
  text: string;
  place: string;
  when: string;
  author: string;
  avatarColor: string;
  likes: number;
  likedByMe?: boolean;
  /** 관련 경유지 이름 — 경로 필터·방문 순서 정렬의 앵커 */
  anchor?: string;
  /** 그 경유지로 가는 구간 소식 — 경유지 소식보다 먼저 정렬 */
  road?: boolean;
};

/** 가게 이름에서 읽어 내는 말할 거리. 위에서부터 먼저 맞는 것을 쓴다 */
const TOPICS: { match: RegExp; lines: string[] }[] = [
  {
    // 포장을 기다리는 곳 — 체류시간이 곧 지각 위험이라 이 앱에서 제일 쓸모 있는 제보다.
    // `닭` 은 상호에 '치킨'이 없는 닭집을 위해서다 — 실제로 "치킨 포장"에 카카오가
    // `농부와닭동네` 를 줬고, 그때 이 표가 통째로 헛돌았다.
    match: /치킨|닭|피자|버거|족발|보쌈|분식|김밥|도시락|베이커리|빵/,
    lines: ['포장 주문 밀리지 않아요', '지금 포장 걸어두면 바로 받아요', '포장 대기 좀 있어요'],
  },
  {
    match: /올리브영|다이소|드럭|마트|슈퍼|편의점|백화점|아울렛/,
    lines: ['웨이팅 없어요', '계산대 줄 짧아요', '계산대 한 곳만 열었어요'],
  },
  {
    match: /카페|커피|스타벅스|투썸|이디야|메가|빽다방/,
    lines: ['자리 있어요', '테이블 거의 찼어요', '2층은 한산해요'],
  },
  { match: /약국|병원|의원|치과/, lines: ['대기 많지 않아요', '접수 줄 조금 있어요'] },
  { match: /주유소|충전소/, lines: ['대기 없이 바로 넣어요', '세차 줄이 길어요'] },
  { match: /역|터미널|공항/, lines: ['개찰구 쪽 한산해요', '사람 많아요'] },
];

const DEFAULT_LINES = ['지금 한산해요', '사람 좀 있어요'];

const ROAD_LINES = ['지금은 잘 빠져요', '조금씩 밀려요', '신호 대기가 길어요', '공사 구간 있어요'];

/* 계획 전에는 앵커 삼을 가게가 없다. 구·동 단위로 말이 되는 것만 — 날씨처럼
   틀렸는지 바로 들통나는 건 넣지 않는다.

   `anon` 은 동네 이름을 모를 때 쓴다. 웹에서 위치 권한을 **허용**하면 좌표만 오고
   역지오코딩이 없어 area 가 null 이다 — 거기서 빈 목록을 주면 권한을 거부한 쪽보다
   허용한 쪽 화면이 더 나빠진다. '근처'는 지어낸 말이 아니라 이 탭의 전제다. */
const REGION_LINES: { named: string; anon: string }[] = [
  { named: '일대 도로 지금 잘 빠져요', anon: '이 근처 도로 지금 잘 빠져요' },
  { named: '쪽 공영주차장 자리 있어요', anon: '근처 공영주차장 자리 있어요' },
  { named: '일대 퇴근 시간대라 조금씩 밀려요', anon: '이 근처 퇴근 시간대라 조금씩 밀려요' },
];

function linesFor(name: string): string[] {
  return TOPICS.find(t => t.match.test(name))?.lines ?? DEFAULT_LINES;
}

const AUTHORS = ['민지', '준호', '수현', '지우', '태윤', '하린', '서진', '도윤'];
const AVATARS = ['#1B57D6', '#0F5C3E', '#8A5108', '#6B3FA0', '#B0403A', '#0E6A7A'];

/** 이름에서 나오는 안정된 정수 — 같은 가게면 늘 같은 작성자·문구가 붙는다 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 이미 쓴 값을 피해 가며 고른다 — 경유지끼리 작성자·문구가 겹치면 시드 티가 난다 */
function pickUnique<T>(pool: T[], seed: number, used: Set<T>): T {
  for (let i = 0; i < pool.length; i++) {
    const v = pool[(seed + i) % pool.length];
    if (!used.has(v)) {
      used.add(v);
      return v;
    }
  }
  return pool[seed % pool.length]; // 후보보다 경유지가 많으면 중복을 받아들인다
}

/** 최근 1시간 안, 서로 겹치지 않는 분 단위. 제보는 오래될수록 쓸모가 없으니 범위를 좁게 잡는다 */
function minutesAgo(seed: number, used: Set<number>): number {
  for (let i = 0; i < 60; i++) {
    const m = ((seed + i * 7) % 58) + 2;
    if (!used.has(m)) {
      used.add(m);
      return m;
    }
  }
  return (seed % 58) + 2;
}

export function buildNearbyFeed(input: {
  stops: { name: string }[];
  region: string | null;
}): NearbyPost[] {
  const usedAuthors = new Set<string>();
  const usedTexts = new Set<string>();
  const usedMinutes = new Set<number>();

  // 계획을 아직 안 세운 화면. 경유지가 없으니 앵커도 없다 — 지역 단위로만 말할 수 있다.
  if (input.stops.length === 0) {
    const region = input.region;
    return REGION_LINES.map((line, i) => {
      const h = hash(`${region ?? 'here'}:${i}`);
      return {
        id: `n-region${i}`,
        // 동네 이름은 아는 경우에만 쓴다 — 모르면 '근처'로만 말하고 지어내지 않는다
        text: region ? `${region} ${line.named}` : line.anon,
        place: region ? `${region} 일대` : '내 주변',
        when: `${minutesAgo(h, usedMinutes)}분 전`,
        author: pickUnique(AUTHORS, h, usedAuthors),
        avatarColor: AVATARS[h % AVATARS.length],
        likes: 1 + (h % 14),
      };
    });
  }

  const first = input.stops[0];
  const road: NearbyPost[] = first
    ? [
        (() => {
          const h = hash(`road:${first.name}`);
          return {
            id: 'n-road',
            // 도로 이름은 짓지 않는다 — 경로 API 가 준 게 아니면 틀린 길을 말하게 된다
            text: `${first.name} 가는 길 ${pickUnique(ROAD_LINES, h, usedTexts)}`,
            place: `${first.name} 가는 길`,
            when: `${minutesAgo(h, usedMinutes)}분 전`,
            author: pickUnique(AUTHORS, h, usedAuthors),
            avatarColor: AVATARS[h % AVATARS.length],
            likes: 1 + (h % 14),
            anchor: first.name,
            road: true,
          };
        })(),
      ]
    : [];

  const stops = input.stops.map((stop, i) => {
    const h = hash(stop.name);
    const line = pickUnique(linesFor(stop.name), h, usedTexts);
    return {
      id: `n${i}`,
      text: `${stop.name} ${line}`,
      place: stop.name,
      when: `${minutesAgo(h, usedMinutes)}분 전`,
      author: pickUnique(AUTHORS, h, usedAuthors),
      avatarColor: AVATARS[h % AVATARS.length],
      likes: 1 + (h % 14),
      anchor: stop.name,
    };
  });

  return [...road, ...stops];
}
