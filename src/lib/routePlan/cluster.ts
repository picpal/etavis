/**
 * 후보 묶기 — 같은 자리는 선택지 하나다.
 *
 * 교체 시트에 CU 30곳이 전부 "비슷해요"로 늘어선 적이 있다(2026-09-20). 숫자는 정직해졌지만
 * (1~4단계) 선택지가 30개라는 거짓말은 남았다. 홍대 골목 안 300m 안의 두 CU 는 **시간으로는
 * 같은 선택**이고, 다른 건 평점·언급·영업시간이다. 그러면 시간으로 30줄을 세우는 대신
 * 자리로 묶고 그 안은 다른 기준으로 세워야 한다.
 *
 * `SAME_TIME_M = 250` 은 제품 문장이다 — **"250m 안은 같은 시간 선택지다."** 도보 3분이고,
 * 구간 추정 MAE 5.1분·같은 OD 의 출발 시각 차이 20% 흔들림(docs/transit-추정-오차.md)보다
 * 작다. 그 안의 시간 차이는 정보가 아니라 잡음이다.
 *
 * 호출 0회다. 이미 받아 둔 후보를 다시 배열할 뿐, 무엇도 새로 재지 않는다.
 */
import { haversineM } from '../geo';
import type { LatLng, TimeClass } from './types';

/** 같은 시간 선택지로 볼 반경(m). 설계 §4 */
export const SAME_TIME_M = 250;

/** 묶는 데 필요한 것만. `Candidate` 를 그대로 받지 않는다 — 플래너가 화면 타입을 알 이유가 없다 */
export type Clusterable = {
  id: string;
  name: string;
  coord: LatLng;
  /** 시간 등급. 없으면 계획 등급을 따르는 값이라 '실측 아님'으로 본다 */
  cls?: TimeClass;
  trend?: { score: number };
  /** 마감한 곳은 호출부가 이미 뺀다(`isSelectable`). 여기서 가르는 건 영업 확인·모름·곧 마감이다 */
  openState?: 'open' | 'closing_soon' | 'closed' | 'unknown';
};

export type Cluster<T extends Clusterable> = {
  /** 대표의 id. 화면이 펼침 상태를 붙잡는 열쇠다 */
  id: string;
  /** 묶음의 시간·도착을 말하는 한 곳. 시트는 이것만 시간과 함께 그린다 */
  lead: T;
  /** 대표를 포함한 전부. 대표가 늘 첫 번째고, 나머지는 들어온 순서 그대로다 —
   *  묶음 **안**의 순서는 영업 상태까지 봐야 해서 `rankClusters` 가 정한다 */
  members: T[];
};

/**
 * 같은 자리 안에서 무엇을 먼저 보여 줄까 — **시간이 아니다.** 250m 안은 시간이 같다고
 * 선언했으니 거기서 다시 추가시간으로 줄을 세우면 잡음으로 순서를 매기는 셈이다.
 * 평점·언급(trend) → 영업(곧 마감은 뒤로) → 이름. 이름까지 내려오는 건 동률을 실행마다
 * 다르게 만들지 않으려는 것이다(정렬이 안정적이어야 화면이 안 깜빡인다)
 */
export function preferenceOrder(a: Clusterable, b: Clusterable): number {
  return (
    (b.trend?.score ?? -Infinity) - (a.trend?.score ?? -Infinity) ||
    openRank(a) - openRank(b) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * 영업 확인 → 모름 → 곧 마감. 시간이 같은 자리에서 남는 차이는 "들를 수 있나"이고,
 * 확인된 곳이 확인 못 한 곳보다 낫다. 다만 모름을 곧 마감보다 뒤로 보내지는 않는다 —
 * 30분 뒤 닫는 게 확실한 곳보다는, 모르는 곳이 헛걸음할 확률이 낮다
 */
const openRank = (c: Clusterable): number =>
  c.openState === 'closing_soon' ? 2 : c.openState === 'unknown' ? 1 : 0;

/**
 * 대표 고르기. 지금 경로에 들어가 있는 곳이 있으면 무조건 그것 — 묶기 전에는 추가시간 0 이라
 * 늘 맨 위였는데, 대표가 아니면 접힌 안쪽으로 사라진다(2026-09-20 화면에서 그랬다).
 * 사용자가 "지금 뭐가 들어가 있지"를 못 찾는 목록은 교체 시트가 아니다.
 *
 * 그다음은 실측된 후보 — 묶음의 시간을 말하는 자리라 잰 값이 있으면 그게 낫다. 그 뒤는
 * 묶음 안 순서와 **같은 규칙**이다. 두 규칙을 따로 두었더니 곧 마감하는 곳이 대표가 되어
 * 맨 위에 서고, 바로 아래 목록에서는 뒤로 밀려 있었다
 */
export function leadOrderWith(currentId?: string) {
  return (a: Clusterable, b: Clusterable): number => {
    const cur = (c: Clusterable) => (currentId !== undefined && c.id === currentId ? 0 : 1);
    const measured = (c: Clusterable) => (c.cls === 'measured' ? 0 : 1);
    return cur(a) - cur(b) || measured(a) - measured(b) || preferenceOrder(a, b);
  };
}

export const leadOrder = leadOrderWith();

/**
 * 탐욕 묶기. 들어온 순서대로 훑으며 기존 묶음의 **기준점**에서 `radiusM` 안이면 합치고
 * 아니면 새 묶음을 연다. 호출부는 Δ 오름차순으로 넣는다.
 *
 * 기준점은 묶음의 중심(무게중심)이 아니라 **첫 멤버**다. 설계는 중심이라고 썼는데, 중심은
 * 멤버가 붙을 때마다 움직여서 250m 씩 이어 붙으면 묶음이 얼마든지 길어진다("같은 자리"가
 * 아니게 된다). 첫 멤버로 고정하면 묶음의 지름이 2×radiusM 으로 묶인다.
 *
 * 앵커 구분은 넣지 않는다 — 같은 250m 안의 두 곳이 앵커가 달라서 다른 묶음이 되면
 * 화면에는 "같은 자리"가 두 번 뜬다. 사용자가 보는 건 자리이지 앵커가 아니다.
 */
export function clusterCandidates<T extends Clusterable>(
  cands: readonly T[],
  radiusM: number = SAME_TIME_M,
  currentId?: string,
): Cluster<T>[] {
  const order = leadOrderWith(currentId);
  const seeds: { origin: LatLng; members: T[] }[] = [];
  for (const c of cands) {
    const hit = seeds.find(s => haversineM(s.origin, c.coord) <= radiusM);
    if (hit) hit.members.push(c);
    else seeds.push({ origin: c.coord, members: [c] });
  }
  return seeds.map(s => {
    // 대표만 뽑아 앞으로 옮긴다. 나머지를 leadOrder 로 마저 세우지 않는 건, 묶음 안의
    // 순서가 실측 여부가 아니라 평점·영업·이름이기 때문이다(설계 §4) — 그건 화면 타입을
    // 아는 `rankClusters` 의 몫이다
    const lead = s.members.reduce((best, c) => (order(c, best) < 0 ? c : best));
    return { id: lead.id, lead, members: [lead, ...s.members.filter(c => c !== lead)] };
  });
}
