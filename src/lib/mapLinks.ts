/**
 * 외부 지도 앱 딥링크 — 확정된 경로를 URL로 직렬화한다.
 *
 * 여기 적힌 파라미터는 목이 아니라 각 앱의 공식 URL scheme 스펙이다.
 *   네이버지도  nmap://route/{car|walk|public}  경유지 v1~v5 (5개), appname 필수
 *   카카오맵    kakaomap://route                경유지 vp~vp5 (5개), 앱키 불필요
 *   Google Maps https://www.google.com/maps/dir/?api=1&...  경유지 9개
 *
 * 카카오내비는 제외했다. 순수 URL scheme이 없고 네이티브 SDK(NaviApi)와 앱키가 필요한데,
 * 카카오맵으로 넘기면 거기서 내비를 띄울 수 있어 SDK를 들일 이득이 없다.
 */
import { LatLng } from '../data/mockData';

export type MapAppId = 'naver' | 'kakaomap' | 'gmaps';

export type RouteMode = 'car' | 'walk' | 'transit';

export type RoutePoint = { name: string; coord: LatLng };

export type RoutePlan = {
  /** null이면 출발지를 생략한다 — 세 앱 모두 현재 위치로 대체한다 */
  origin: RoutePoint | null;
  waypoints: RoutePoint[];
  destination: RoutePoint;
  mode: RouteMode;
};

export type BuiltLink = {
  url: string;
  /** 실제로 전달되는 경유지 수 */
  sent: number;
  /** 한도 때문에 빠지는 경유지 수 */
  dropped: number;
};

/** app.json의 ios.bundleIdentifier — 네이버가 호출자 식별에 요구한다 */
const APP_NAME = 'com.etavia.app';

const coord = (p: LatLng) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
const enc = encodeURIComponent;

/**
 * 대중교통에서는 세 앱 모두 경유지를 받지 않는 것으로 본다.
 * 카카오맵은 문서가 명시적으로 미지원이라 하고, 네이버·구글은 대중교통 경유지 예시가
 * 문서에 없다. 못 넘기는 걸 넘긴다고 표시하느니 덜 약속하는 쪽이 낫다.
 */
const maxWaypoints = (id: MapAppId, mode: RouteMode): number => {
  if (mode === 'transit') return 0;
  return id === 'gmaps' ? 9 : 5;
};

function split(plan: RoutePlan, id: MapAppId) {
  const max = maxWaypoints(id, plan.mode);
  const sent = plan.waypoints.slice(0, max);
  return { sent, dropped: plan.waypoints.length - sent.length };
}

function buildNaver(plan: RoutePlan): string {
  const path = plan.mode === 'car' ? 'car' : plan.mode === 'walk' ? 'walk' : 'public';
  const { sent } = split(plan, 'naver');
  const params: string[] = [];
  if (plan.origin) {
    params.push(`slat=${plan.origin.coord.latitude}`, `slng=${plan.origin.coord.longitude}`, `sname=${enc(plan.origin.name)}`);
  }
  params.push(
    `dlat=${plan.destination.coord.latitude}`,
    `dlng=${plan.destination.coord.longitude}`,
    `dname=${enc(plan.destination.name)}`,
  );
  sent.forEach((w, i) => {
    const n = i + 1;
    params.push(`v${n}lat=${w.coord.latitude}`, `v${n}lng=${w.coord.longitude}`, `v${n}name=${enc(w.name)}`);
  });
  params.push(`appname=${APP_NAME}`);
  return `nmap://route/${path}?${params.join('&')}`;
}

function buildKakaoMap(plan: RoutePlan): string {
  const by = plan.mode === 'car' ? 'car' : plan.mode === 'walk' ? 'foot' : 'publictransit';
  const { sent } = split(plan, 'kakaomap');
  const params: string[] = [];
  if (plan.origin) params.push(`sp=${coord(plan.origin.coord)}`);
  // 경유지 키는 vp, vp2, vp3 … (vp1이 아니다)
  sent.forEach((w, i) => params.push(`${i === 0 ? 'vp' : `vp${i + 1}`}=${coord(w.coord)}`));
  params.push(`ep=${coord(plan.destination.coord)}`, `by=${by}`);
  return `kakaomap://route?${params.join('&')}`;
}

function buildGoogle(plan: RoutePlan): string {
  const travelmode = plan.mode === 'car' ? 'driving' : plan.mode === 'walk' ? 'walking' : 'transit';
  const { sent } = split(plan, 'gmaps');
  const params: string[] = ['api=1'];
  if (plan.origin) params.push(`origin=${enc(coord(plan.origin.coord))}`);
  params.push(`destination=${enc(coord(plan.destination.coord))}`);
  if (sent.length) params.push(`waypoints=${enc(sent.map(w => coord(w.coord)).join('|'))}`);
  params.push(`travelmode=${travelmode}`);
  // 커스텀 스킴이 아니라 universal link — 앱이 설치돼 있으면 앱이 가로챈다
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

export type MapAppSpec = {
  id: MapAppId;
  name: string;
  tint: string;
  /** 설치 여부 판정용. Info.plist의 LSApplicationQueriesSchemes에 등록돼 있어야 동작한다 */
  probeUrl: string;
  /** 미설치 시 보낼 App Store 페이지 */
  storeUrl: string;
  build: (plan: RoutePlan) => string;
};

export const MAP_APPS: MapAppSpec[] = [
  {
    id: 'naver',
    name: '네이버지도',
    tint: '#E4F0E8',
    probeUrl: 'nmap://',
    storeUrl: 'https://apps.apple.com/kr/app/id311867728',
    build: buildNaver,
  },
  {
    id: 'kakaomap',
    name: '카카오맵',
    tint: '#FBF3DC',
    probeUrl: 'kakaomap://',
    storeUrl: 'https://apps.apple.com/kr/app/id304608425',
    build: buildKakaoMap,
  },
  {
    id: 'gmaps',
    name: 'Google Maps',
    tint: '#EAEFF6',
    probeUrl: 'comgooglemaps://',
    storeUrl: 'https://apps.apple.com/kr/app/id585027354',
    build: buildGoogle,
  },
];

/** 이 앱으로 보내면 경유지가 몇 개 전달되고 몇 개가 빠지는지 */
export function linkFor(spec: MapAppSpec, plan: RoutePlan): BuiltLink {
  const { sent, dropped } = split(plan, spec.id);
  return { url: spec.build(plan), sent: sent.length, dropped };
}

/** 행 부제 — 이 앱에 무엇이 전달되는지 그대로 적는다 */
export function transferNote(link: BuiltLink, plan: RoutePlan): string {
  if (plan.waypoints.length === 0) return '목적지만 전달';
  if (plan.mode === 'transit') return '대중교통은 목적지만 전달';
  if (link.dropped > 0) return `경유지 ${link.sent}개 전달 · ${link.dropped}개 생략`;
  return `경유지 ${link.sent}개 그대로 전달`;
}
