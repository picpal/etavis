import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNearbyFeed } from './nearbyFeed.ts';

test('경유지가 있으면 그 경유지 이름에 앵커된 소식이 나온다', () => {
  // 하드코딩 시드의 앵커('올리브영 평창점')는 실제 경유지 이름과 안 맞아서
  // 계획을 확정하면 목록이 늘 비었다. 앵커는 실제 경유지에서 나와야 한다.
  const feed = buildNearbyFeed({
    stops: [{ name: '올리브영 동여의도점' }],
    region: '영등포구'
  });

  assert.ok(feed.length > 0, '소식이 하나는 나와야 한다');
  assert.ok(
    feed.every(p => p.anchor === '올리브영 동여의도점'),
    '모든 앵커가 실제 경유지 이름이어야 한다',
  );
});

test('업종에 맞는 문구가 붙는다 — 치킨집은 포장, 드럭스토어는 웨이팅', () => {
  // 어디든 "한산해요"면 소식이 아니라 잡음이다. 가게 종류가 말할 거리를 정한다.
  const chicken = buildNearbyFeed({ stops: [{ name: '바른치킨 여의도로봇점' }], region: '영등포구' });
  const drug = buildNearbyFeed({ stops: [{ name: '올리브영 동여의도점' }], region: '영등포구' });

  assert.ok(
    chicken.some(p => p.text.includes('포장')),
    `치킨집 소식에 포장 얘기가 있어야 한다: ${chicken.map(p => p.text).join(' / ')}`,
  );
  assert.ok(
    drug.some(p => p.text.includes('웨이팅') || p.text.includes('계산대')),
    `드럭스토어 소식은 줄 얘기여야 한다: ${drug.map(p => p.text).join(' / ')}`,
  );
});

test('상호에 치킨이 없어도 닭집이면 포장 얘기를 한다', () => {
  // 실측: "치킨 포장" 으로 계획을 세우면 카카오가 `농부와닭동네` 를 준다. 정규식에
  // `치킨` 만 있으면 기본 문구('지금 한산해요')로 떨어진다 — 포장 대기는 이 앱에서
  // 곧 지각 위험이라, 바로 그 자리에서 제일 쓸모 있는 제보가 사라진다.
  const feed = buildNearbyFeed({ stops: [{ name: '농부와닭동네' }], region: '영등포구' });
  const post = feed.find(p => !p.road);

  assert.ok(
    post && post.text.includes('포장'),
    `닭집 소식에 포장 얘기가 있어야 한다: ${feed.map(p => p.text).join(' / ')}`,
  );
});

test('경유지가 여럿이면 작성자와 문구가 겹치지 않는다', () => {
  // 같은 사람이 같은 말을 반복하면 시드라는 게 티가 난다
  const feed = buildNearbyFeed({
    stops: [{ name: '바른치킨 여의도로봇점' }, { name: '올리브영 동여의도점' }, { name: '스타벅스 여의도점' }],
    region: '영등포구'
  });
  const stopPosts = feed.filter(p => !p.road);

  assert.equal(new Set(stopPosts.map(p => p.author)).size, stopPosts.length, '작성자가 겹쳤다');
  assert.equal(new Set(stopPosts.map(p => p.text)).size, stopPosts.length, '문구가 겹쳤다');
});

test('같은 입력이면 같은 결과다 — 렌더마다 흔들리지 않는다', () => {
  const args = { stops: [{ name: '올리브영 동여의도점' }], region: '영등포구' };
  assert.deepEqual(buildNearbyFeed(args), buildNearbyFeed(args));
});

test('시간 표기가 소식마다 다르고 최근 한 시간 안이다', () => {
  // 전부 "3분 전"이면 한 사람이 한 번에 쓴 티가 난다
  const feed = buildNearbyFeed({
    stops: [{ name: '바른치킨 여의도로봇점' }, { name: '올리브영 동여의도점' }, { name: '스타벅스 여의도점' }],
    region: '영등포구'
  });

  assert.equal(new Set(feed.map(p => p.when)).size, feed.length, '시간 표기가 겹쳤다');
  for (const p of feed) {
    const m = /^(\d+)분 전$/.exec(p.when);
    assert.ok(m, `"${p.when}" 은 'N분 전' 꼴이어야 한다`);
    assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 60, `${p.when} 은 최근 1시간 안이어야 한다`);
  }
});

test('지금 달리는 구간 소식이 하나 붙고, 첫 경유지에 앵커된다', () => {
  // 화면은 road 를 그 경유지 소식보다 먼저 세운다(orderOf). 가는 길 상황이 먼저 궁금하니까.
  const feed = buildNearbyFeed({
    stops: [{ name: '바른치킨 여의도로봇점' }, { name: '올리브영 동여의도점' }],
    region: '영등포구'
  });
  const roads = feed.filter(p => p.road);

  assert.equal(roads.length, 1, '구간 소식은 지금 가는 구간 하나만');
  assert.equal(roads[0].anchor, '바른치킨 여의도로봇점');
  assert.ok(!/여의대로|올림픽대로|강변북로/.test(roads[0].text), '있는지 모르는 도로 이름을 지어내면 안 된다');
});

test('경유지가 없으면 지역 단위 소식을 준다 — 심사위원의 첫 화면이 비지 않게', () => {
  const feed = buildNearbyFeed({ stops: [], region: '영등포구' });

  assert.ok(feed.length >= 2, '지역 소식이 몇 건은 있어야 한다');
  assert.ok(feed.every(p => p.text.includes('영등포구')), '지역 이름이 문구에 들어가야 한다');
  assert.ok(feed.every(p => p.anchor === undefined), '앵커 없는 소식이라야 경로 필터에 안 걸린다');
});

test('지역을 몰라도 소식은 나온다 — 다만 동네 이름을 지어내지 않는다', () => {
  // 웹에서 위치 권한을 **허용**하면 좌표만 오고 역지오코딩이 없어 area 가 null 이다
  // (currentPlace.web.ts). 거기서 빈 목록을 주면 거부했을 때보다 허용했을 때가 더
  // 나빠진다 — 완성된 기능이 고장 난 것처럼 보인다.
  const feed = buildNearbyFeed({ stops: [], region: null });

  assert.ok(feed.length >= 2, '소식이 몇 건은 있어야 한다');
  assert.ok(feed.every(p => p.anchor === undefined), '앵커 없는 소식이라야 경로 필터에 안 걸린다');
  assert.ok(
    feed.every(p => /근처/.test(p.text)),
    `동네 이름 대신 '근처'로 말해야 한다: ${feed.map(p => p.text).join(' / ')}`,
  );
  assert.ok(
    feed.every(p => p.place === '내 주변'),
    `장소 표기도 동네 이름을 쓰면 안 된다: ${feed.map(p => p.place).join(' / ')}`,
  );
});
