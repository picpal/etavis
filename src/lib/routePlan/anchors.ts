/**
 * itinerary → 앵커. 대중교통에서 경유지가 붙을 만한 자리는 직선 위 아무 점이 아니라
 * 내가 실제로 발을 딛는 곳이다 — 출발지·승차역·환승역·하차역·목적지.
 *
 * progressM 은 5단계 itineraryToRoute 가 만드는 폴리라인
 * ([출발지, …정류장(연속 중복 제거)…, 목적지])의 진행 거리와 같은 좌표계다.
 * 같은 점 목록을 같은 순서로 걷기 때문이지, 투영해서 맞추는 게 아니다.
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
    if (last && (last.name === s.name || haversineM(toCoord(last), toCoord(s)) <= SAME_STOP_M)) return;
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
