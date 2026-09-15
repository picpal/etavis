/**
 * itinerary → 앵커. 대중교통에서 경유지가 붙을 만한 자리는 직선 위 아무 점이 아니라
 * 내가 실제로 발을 딛는 곳이다 — 출발지·승차역·환승역·하차역·목적지.
 *
 * progressM 은 앵커 목록 자체를 출발지에서부터 누적한 직선거리다 — 뒤 단계가
 * 방문 순서를 이 값으로 정렬하기 때문에 존재한다.
 *
 * 5단계 itineraryToRoute 가 만드는 폴리라인의 진행 거리와 값이 "비슷"할 수는
 * 있지만 같다고 보장하지 않는다: itineraryToRoute 는 연속된 점을 좌표가 정확히
 * 같을 때만 접고, 여기서는 이름이 같거나 SAME_STOP_M 이내면 접기 때문이다
 * (이름은 다르지만 8m 떨어진 같은 역을 하나로 묶는 테스트가 그 증거다). 두 값을
 * 같다고 가정하는 코드를 쓰면 안 된다.
 */
import { haversineM } from '../geo';
import type { LatLng, TransitItinerary, TransitStop } from './types';

export type AnchorKind = 'origin' | 'board' | 'transfer' | 'alight' | 'destination';
export type Anchor = { id: string; kind: AnchorKind; name: string; coord: LatLng; progressM: number };

/** 같은 역인지 — 이름이 같거나 이만큼 안에 있으면 하나로 본다. 환승 통로가 이 정도다 */
const SAME_STOP_M = 200;

const toCoord = (s: TransitStop): LatLng => ({ latitude: s.lat, longitude: s.lng });

export function extractAnchors(it: TransitItinerary, origin: LatLng, destination: LatLng): Anchor[] {
  // 1. 대중교통 구간의 승·하차 정류장을 순서대로 늘어놓고 연속 중복을 접는다
  const stops: TransitStop[] = [];
  const push = (s: TransitStop) => {
    const last = stops[stops.length - 1];
    if (last && ((last.name !== '' && last.name === s.name) || haversineM(toCoord(last), toCoord(s)) <= SAME_STOP_M)) return;
    stops.push(s);
  };
  for (const l of it.legs) {
    if (l.kind !== 'transit') continue;
    push(l.from);
    push(l.to);
  }

  // 2. 첫 정류장은 승차, 마지막은 하차, 사이는 전부 환승
  const middle: Anchor[] = stops.map((s, i) => ({
    id: '', // 3에서 붙인다
    kind: (i === 0 ? 'board' : i === stops.length - 1 ? 'alight' : 'transfer') as AnchorKind,
    name: s.name,
    coord: toCoord(s),
    progressM: 0,
  }));

  const all: Anchor[] = [
    { id: '', kind: 'origin', name: '출발지', coord: origin, progressM: 0 },
    ...middle,
    { id: '', kind: 'destination', name: '목적지', coord: destination, progressM: 0 },
  ];

  // 3. id 와 진행 거리를 채운다
  let acc = 0;
  return all.map((a, i) => {
    if (i > 0) acc += haversineM(all[i - 1].coord, a.coord);
    return { ...a, id: `a${i}`, progressM: Math.round(acc) };
  });
}
