/**
 * 서버·키가 없을 때의 보강. 이름 해시로 결정적 값을 만든다 —
 * 시뮬레이터에서 같은 화면이 매번 같게 나와야 디자인을 점검할 수 있다.
 * 실제 값처럼 보이지만 실제가 아니다. source 는 항상 'kakao' 로 둬서
 * 개발 메뉴에서 진짜와 구분된다.
 */
import type { EnrichFn } from './enrichClient';
import type { PlaceSignals } from './types';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** 0~1 사이 결정적 난수 */
const unit = (s: string, salt: string) => (hash(s + salt) % 10_000) / 10_000;

const POPULAR = /카페|커피|베이커리|빵|디저트|브런치/;

export function mockEnrichFn(): EnrichFn {
  return async places => {
    const out: Record<string, PlaceSignals> = {};
    const fetchedAt = new Date().toISOString();
    for (const p of places) {
      const hot = POPULAR.test(p.name);
      const u = unit(p.name, 'blog');
      const weighted = hot ? 5 + u * 20 : u * 6;
      const g = unit(p.name, 'g');
      out[p.id] = {
        fetchedAt,
        blog: {
          weighted,
          count90d: Math.round(weighted * 1.6),
          latestDaysAgo: Math.round(u * 20),
          source: 'kakao',
        },
        // 5곳 중 1곳은 구글 신호가 없다 — 일부만 신호 있는 화면을 볼 수 있어야 한다
        google: hash(p.name) % 5 === 0 ? undefined : {
          rating: Math.round((3.8 + g * 0.9) * 10) / 10,
          ratingCount: 20 + Math.round(g * 380),
          hours: null,
          matchedName: p.name,
        },
      };
    }
    return out;
  };
}
