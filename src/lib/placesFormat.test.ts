/**
 * 내 장소·최근 목적지 포맷 — 파일이 깨져도 앱이 서는가, 같은 곳을 두 번 세지 않는가.
 *
 * 순수 모듈이라 스텁이 필요 없다. 파일 I/O 는 placesStore.test.ts 가 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_MAX,
  knownPlaces,
  parsePlaces,
  removeSaved,
  savedAt,
  serializePlaces,
  upsertRecent,
  upsertSaved,
  type PlacesFile,
  type SavedPlace,
} from './placesFormat';

const HERE = { latitude: 37.5219, longitude: 126.9245 };
/* 위도 1도 ≈ 111.2km. 경계(50m) 양쪽을 1m 차이로 집는다 */
const M49 = { latitude: HERE.latitude + 0.00044066, longitude: HERE.longitude };
const M51 = { latitude: HERE.latitude + 0.00045865, longitude: HERE.longitude };

const file = (over: Partial<PlacesFile> = {}): PlacesFile => ({ saved: [], recents: [], ...over });

const aSaved = (over: Partial<SavedPlace> = {}): SavedPlace => ({
  id: 's1',
  slot: null,
  label: '단골 미용실',
  name: '목동 헤어샵',
  address: '서울 양천구 목동',
  coord: HERE,
  createdAt: 100,
  ...over,
});

test('못 읽는 입력은 전부 빈 목록 — 앱은 그래도 선다', () => {
  for (const bad of [null, undefined, '', '{', 'null', '[]', '"글자"']) {
    // 공유 상수(EMPTY_PLACES)와 비교하지 않는다 — 이 테스트가 그 객체에 기대면
    // 안 되고, parsePlaces 가 매번 새로 낸 빈 값의 모양만 확인하면 된다
    assert.deepEqual(parsePlaces(bad as string | null | undefined), { saved: [], recents: [] });
  }
});

test('원소 하나가 깨져도 나머지는 살린다 — 한 줄 때문에 등록해 둔 장소를 다 날리지 않는다', () => {
  const text = JSON.stringify({
    saved: [aSaved(), { id: 's2', name: '좌표없음' }],
    recents: [
      { name: '회사', address: '서울 양천구', coord: HERE, usedAt: 5 },
      { name: '좌표없음', address: '', usedAt: 9 },
    ],
  });
  const got = parsePlaces(text);
  assert.equal(got.saved.length, 1);
  assert.equal(got.saved[0].id, 's1');
  assert.equal(got.recents.length, 1);
  assert.equal(got.recents[0].name, '회사');
});

test('최근은 맨 앞에 쌓이고 usedAt 내림차순이다', () => {
  let f = file();
  f = upsertRecent(f, { name: '회사', address: '서울 양천구', coord: HERE }, 100);
  f = upsertRecent(f, { name: '올리브영', address: '서울 강서구', coord: { latitude: 37.55, longitude: 126.85 } }, 200);
  assert.deepEqual(f.recents.map(r => r.name), ['올리브영', '회사']);
  assert.equal(f.recents[0].usedAt, 200);
});

test('49m 떨어진 곳은 같은 곳 — 개수는 그대로, 이름·주소는 최신으로 갱신된다', () => {
  let f = upsertRecent(file(), { name: '옛 이름', address: '옛 주소', coord: HERE }, 100);
  f = upsertRecent(f, { name: '새 이름', address: '새 주소', coord: M49 }, 200);
  assert.equal(f.recents.length, 1);
  assert.equal(f.recents[0].name, '새 이름');
  assert.equal(f.recents[0].address, '새 주소');
  assert.equal(f.recents[0].usedAt, 200);
});

test('51m 떨어진 곳은 다른 곳이다', () => {
  let f = upsertRecent(file(), { name: '옛 이름', address: '옛 주소', coord: HERE }, 100);
  f = upsertRecent(f, { name: '새 이름', address: '새 주소', coord: M51 }, 200);
  assert.equal(f.recents.length, 2);
});

test('상한을 넘기면 가장 오래된 것이 빠진다', () => {
  let f = file();
  for (let i = 0; i < RECENT_MAX + 3; i++) {
    f = upsertRecent(f, { name: `곳${i}`, address: '', coord: { latitude: 37.5 + i * 0.01, longitude: 126.9 } }, i);
  }
  assert.equal(f.recents.length, RECENT_MAX);
  assert.equal(f.recents[0].name, `곳${RECENT_MAX + 2}`);
  assert.ok(!f.recents.some(r => r.name === '곳0'));
});

test('같은 id 로 저장하면 교체된다', () => {
  let f = upsertSaved(file(), aSaved());
  f = upsertSaved(f, aSaved({ label: '바뀐 별칭' }));
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].label, '바뀐 별칭');
});

test('집은 하나뿐 — 새로 지정하면 기존 집이 일반 장소로 내려온다', () => {
  let f = upsertSaved(file(), aSaved({ id: 'old', slot: 'home', label: '집' }));
  f = upsertSaved(f, aSaved({ id: 'new', slot: 'home', label: '집', coord: M51, createdAt: 200 }));
  const homes = f.saved.filter(s => s.slot === 'home');
  assert.equal(homes.length, 1);
  assert.equal(homes[0].id, 'new');
  assert.equal(f.saved.find(s => s.id === 'old')?.slot, null);
});

test('정렬은 집 → 회사 → 등록 순이다', () => {
  let f = file();
  f = upsertSaved(f, aSaved({ id: 'c', slot: null, createdAt: 10 }));
  f = upsertSaved(f, aSaved({ id: 'd', slot: null, createdAt: 20 }));
  f = upsertSaved(f, aSaved({ id: 'w', slot: 'work', createdAt: 30 }));
  f = upsertSaved(f, aSaved({ id: 'h', slot: 'home', createdAt: 40 }));
  assert.deepEqual(f.saved.map(s => s.id), ['h', 'w', 'c', 'd']);
});

test('지운 항목만 사라진다', () => {
  let f = upsertSaved(file(), aSaved({ id: 'a' }));
  f = upsertSaved(f, aSaved({ id: 'b', createdAt: 200 }));
  f = removeSaved(f, 'a');
  assert.deepEqual(f.saved.map(s => s.id), ['b']);
});

test('savedAt 은 50m 안이면 찾고 밖이면 못 찾는다 — 최근 목록의 북마크 배지용', () => {
  const f = upsertSaved(file(), aSaved({ coord: HERE }));
  assert.equal(savedAt(f, M49)?.id, 's1');
  assert.equal(savedAt(f, M51), undefined);
});

test('knownPlaces 는 별칭과 상호를 둘 다 낸다 — "집"으로도 "여의도 자이"로도 말이 통해야 한다', () => {
  let f = upsertSaved(file(), aSaved({ slot: 'home', label: '집', name: '여의도 자이', address: '서울 영등포구' }));
  f = upsertRecent(f, { name: '올리브영', address: '서울 강서구', coord: { latitude: 37.55, longitude: 126.85 } }, 1);
  f = upsertRecent(f, { name: '집', address: '중복', coord: { latitude: 37.6, longitude: 127.0 } }, 2);
  const names = knownPlaces(f).map(p => p.name);
  assert.deepEqual(names, ['집', '여의도 자이', '올리브영']);
  assert.equal(knownPlaces(f)[0].address, '서울 영등포구');
});

test('직렬화하고 다시 읽으면 같다', () => {
  let f = upsertSaved(file(), aSaved({ slot: 'work' }));
  f = upsertRecent(f, { name: '회사', address: '서울 양천구', coord: HERE }, 100);
  assert.deepEqual(parsePlaces(serializePlaces(f)), f);
});
