/**
 * 내 장소 저장소 — 최초 읽기가 던졌을 때, 그 실행은 디스크를 건드리면 안 된다.
 *
 * placesStore.test.ts 와 같은 방식(File·Paths 스텁)을 쓰지만, 모듈은 로드 시점에
 * 한 번 캐시되므로 "읽기가 실패한 실행"을 흉내내려면 그 실행 전용 모듈 인스턴스가
 * 필요하다 — 그래서 별도 파일로 뗀다(node:test 는 파일마다 프로세스를 따로 띄운다).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const disk = new Map<string, string>();
/* 읽기가 실패해도 디스크의 바이트 자체는 멀쩡했다는 것을 보이는 게 이 테스트의 핵심이다 —
   그래서 등록해 둔 장소가 있는 내용을 먼저 심어 둔다 */
const ORIGINAL = JSON.stringify({
  saved: [
    { id: 'h', slot: 'home', label: '집', name: '여의도 자이', address: '서울 영등포구', coord: { latitude: 37.5219, longitude: 126.9245 }, createdAt: 1 },
  ],
  recents: [],
});
disk.set('places.json', ORIGINAL);

/* .exists 를 딱 한 번만 던지게 한다 — 앱이 켜지는 순간(load())의 일시적 I/O 오류를
   흉내낸다. 그 다음(commit() 시점)부터는 파일시스템이 다시 멀쩡하다고 가정한다 */
let existsCalls = 0;

class FakeFile {
  constructor(_dir: unknown, readonly name: string) {}
  get exists() {
    existsCalls++;
    if (existsCalls === 1) throw new Error('일시적 읽기 실패(권한·기기 보호 등)');
    return disk.has(this.name);
  }
  textSync() {
    return disk.get(this.name) ?? '';
  }
  create() {
    if (!disk.has(this.name)) disk.set(this.name, '');
  }
  write(text: string) {
    disk.set(this.name, text);
  }
}

const Module = require('module');
const loadOrig = Module._load;
const stubs: Record<string, unknown> = {
  'expo-file-system': { File: FakeFile, Directory: class {}, Paths: { document: '/doc' } },
};
Module._load = (req: string, parent: unknown, isMain: boolean) =>
  req in stubs ? stubs[req] : loadOrig.call(Module, req, parent, isMain);

const store = require('./placesStore') as typeof import('./placesStore');

test('읽기가 실패한 실행은 빈 값으로 시작한다', () => {
  assert.deepEqual(store.placesSnapshot(), { saved: [], recents: [] });
});

test('그 실행에서도 메모리 갱신·구독 알림은 정상 동작한다', () => {
  let calls = 0;
  const off = store.subscribePlaces(() => {
    calls++;
  });
  store.recordRecent({ name: '올리브영 신정점', address: '서울 양천구', coord: { latitude: 37.5665, longitude: 126.978 } });
  off();

  assert.equal(calls, 1, '구독자는 평소처럼 불려야 한다');
  assert.equal(store.placesSnapshot().recents[0].name, '올리브영 신정점', '메모리 스냅샷은 갱신돼야 한다');
});

test('디스크는 손대지 않는다 — 읽기 실패 이전의 바이트가 그대로 남아야 한다', () => {
  assert.equal(disk.get('places.json'), ORIGINAL, '읽기가 실패했으면 빈 값으로 실제 파일을 덮어써서는 안 된다');
});
