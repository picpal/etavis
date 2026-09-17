/**
 * 내 장소 저장소 — 파일이 죽어도 이번 실행은 살아남는가, 안 바뀐 저장이 화면을 흔들지 않는가.
 *
 * `placesStore.ts` 는 expo-file-system 을 물어 node 가 그냥은 못 읽는다.
 * plan.test.ts 와 같은 방식으로 File·Paths 만 가짜로 끼운다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const disk = new Map<string, string>();
let writeFails = false;

class FakeFile {
  constructor(_dir: unknown, readonly name: string) {}
  get exists() {
    return disk.has(this.name);
  }
  textSync() {
    return disk.get(this.name) ?? '';
  }
  create() {
    if (!disk.has(this.name)) disk.set(this.name, '');
  }
  write(text: string) {
    if (writeFails) throw new Error('read-only volume');
    disk.set(this.name, text);
  }
}

/* 모듈이 읽히는 순간 load() 가 돌기 때문에, 디스크를 먼저 채워야 한다 */
disk.set(
  'places.json',
  JSON.stringify({
    saved: [
      { id: 'h', slot: 'home', label: '집', name: '여의도 자이', address: '서울 영등포구', coord: { latitude: 37.5219, longitude: 126.9245 }, createdAt: 1 },
    ],
    recents: [],
  }),
);

const Module = require('module');
const loadOrig = Module._load;
const stubs: Record<string, unknown> = {
  'expo-file-system': { File: FakeFile, Directory: class {}, Paths: { document: '/doc' } },
};
Module._load = (req: string, parent: unknown, isMain: boolean) =>
  req in stubs ? stubs[req] : loadOrig.call(Module, req, parent, isMain);

const store = require('./placesStore') as typeof import('./placesStore');

const SEOUL = { latitude: 37.5665, longitude: 126.978 };

test('처음 읽을 때 파일에서 온다 — 첫 프레임이 빈 목록으로 깜빡이면 안 된다', () => {
  assert.equal(store.placesSnapshot().saved.length, 1);
  assert.equal(store.placesSnapshot().saved[0].label, '집');
});

test('안 바뀌는 저장은 스냅샷 객체를 그대로 둔다 — 렌더마다 새 객체면 구독이 무한 루프에 빠진다', () => {
  const before = store.placesSnapshot();
  store.removePlace('없는-id');
  assert.equal(store.placesSnapshot(), before);
});

test('최근을 적재하면 스냅샷이 바뀌고 구독자가 불린다', () => {
  let calls = 0;
  const off = store.subscribePlaces(() => {
    calls++;
  });
  const before = store.placesSnapshot();
  store.recordRecent({ name: '올리브영 신정점', address: '서울 양천구', coord: SEOUL });
  off();
  assert.equal(calls, 1);
  assert.notEqual(store.placesSnapshot(), before);
  assert.equal(store.placesSnapshot().recents[0].name, '올리브영 신정점');
});

test('적재한 내용이 파일에도 간다', () => {
  const onDisk = JSON.parse(disk.get('places.json') as string);
  assert.equal(onDisk.recents[0].name, '올리브영 신정점');
});

test('구독을 끊으면 더 불리지 않는다', () => {
  let calls = 0;
  const off = store.subscribePlaces(() => {
    calls++;
  });
  off();
  store.recordRecent({ name: '어딘가', address: '', coord: { latitude: 37.1, longitude: 127.1 } });
  assert.equal(calls, 0);
});

test('파일을 못 써도 메모리 값으로는 산다 — 저장 실패가 앱을 세우지 않는다', () => {
  writeFails = true;
  store.savePlace({
    id: 'w',
    slot: 'work',
    label: '회사',
    name: '목동 사옥',
    address: '서울 양천구 신정동',
    coord: { latitude: 37.52, longitude: 126.86 },
    createdAt: 2,
  });
  writeFails = false;
  assert.ok(store.placesSnapshot().saved.some(s => s.slot === 'work'));
});

test('knownPlacesSnapshot 은 별칭·상호·최근을 합쳐 낸다', () => {
  const names = store.knownPlacesSnapshot().map(p => p.name);
  assert.ok(names.includes('집'));
  assert.ok(names.includes('여의도 자이'));
  assert.ok(names.includes('올리브영 신정점'));
});

test('새 id 는 매번 다르다', () => {
  assert.notEqual(store.newPlaceId(), store.newPlaceId());
});
