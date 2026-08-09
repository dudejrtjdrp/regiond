// §21-A4 — 파생 캐시는 세이브에 실리지 않는다. 이 파일이 붙드는 문장 넷:
//   ① 저장·재기동 왕복을 지나도 onBridge/onFill/onRail 이 그대로 답한다 (예전엔 여기서 서버가 죽었다)
//   ② 스냅샷 JSON 에 칸 집합 캐시가 한 글자도 실리지 않는다
//   ③ 캐시를 나라에 얹어 두었던 **옛 세이브**(`_bridgeSet: {}`)를 읽어도 아무 일도 없다
//   ④ 지운 자리에 같은 수만큼 다시 놓아도 답이 낡지 않는다 — 길이가 같아지는 찰나가 함정이다
//
// 왜 이 파일이 있나. Set 은 JSON.stringify 를 지나면 `{}` 가 된다. 캐시를 nation 에 얹었더니
// 그 빈 객체가 snapshot.json 에 굳었고, 세이브를 물고 뜬 서버는 「스탬프가 맞으니 유효한 캐시」로
// 읽어 `overlaySet(...).has is not a function` 로 첫 생태 박자에 통째로 꺼졌다 — 재시작할 때마다 똑같이.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { townOf, terrainNameAt } from '../server/engine/world.js';
import { onBridge, onFill, onRail, removeBridge } from '../server/engine/research.js';

const data = loadGameData();

function scene(seed = 771) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  return { world, nation, town: townOf(world, 'player') };
}

/** 마을 둘레에서 물 칸 하나 — 다리를 놓을 자리. */
function waterNear(world, town) {
  for (let r = 1; r < 60; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const x = town.x + dx;
        const y = town.y + dy;
        if (x < 0 || y < 0 || x >= world.map.size || y >= world.map.size) continue;
        if (terrainNameAt(world.map, x, y, data) === 'water') return { x, y };
      }
    }
  }
  return null;
}

test('★ 캐시는 세이브에 실리지 않는다 — 저장 왕복 뒤에도 다리 위를 묻는 말이 답을 받는다', () => {
  const { world, nation, town } = scene();
  const w = waterNear(world, town);
  assert.ok(w, '물 칸을 못 찾았다 — 씨앗을 바꿔야 한다');

  nation.bridges = [{ id: 'br1', x: w.x, y: w.y, builtTick: 0 }];
  nation.fills = [];
  nation.rails = [{ id: 'rl1', x: town.x, y: town.y, builtTick: 0 }];

  // 캐시를 데운다 — 예전 구현은 이 한 줄이 nation 에 Set 을 얹었다
  assert.equal(onBridge(nation, w.x, w.y), true);
  assert.equal(onRail(nation, town.x, town.y), true);

  // ② 진짜 저장이 그렇듯 순수 JSON 으로 굳힌다
  const json = JSON.stringify(world);
  for (const k of ['_bridgeSet', '_fillSet', '_railSet', '_bridgeStamp', '_fillStamp', '_railStamp']) {
    assert.equal(json.includes(k), false, `스냅샷에 파생 캐시(${k})가 실렸다`);
  }

  // ① 되읽은 세상이 같은 답을 준다 (예전엔 여기서 TypeError 로 프로세스가 내려갔다)
  const reloaded = JSON.parse(json).nations.player;
  assert.equal(onBridge(reloaded, w.x, w.y), true);
  assert.equal(onBridge(reloaded, w.x + 7, w.y + 7), false);
  assert.equal(onFill(reloaded, w.x, w.y), false);
  assert.equal(onRail(reloaded, town.x, town.y), true);
});

test('★ 옛 세이브 — 나라에 굳어 있는 `{}` 캐시를 읽어도 아무 일도 없다', () => {
  const { nation, town } = scene(772);
  nation.bridges = [{ id: 'br1', x: town.x, y: town.y, builtTick: 0 }];
  nation.rails = [];
  // 옛 판이 남긴 그대로: Set 이 JSON 을 지나 빈 객체가 되었고 스탬프는 멀쩡히 맞는다
  nation._bridgeSet = {};
  nation._bridgeStamp = 1;
  nation._railSet = {};
  nation._railStamp = 0;

  assert.equal(onBridge(nation, town.x, town.y), true);
  assert.equal(onRail(nation, town.x, town.y), false);
});

test('★ 지우고 다시 놓기 — 길이가 같아지는 찰나에도 답이 낡지 않는다', () => {
  const { world, nation, town } = scene(773);
  const a = { x: town.x, y: town.y };
  const b = { x: town.x + 3, y: town.y + 1 };
  nation.bridges = [{ id: 'br1', x: a.x, y: a.y, builtTick: 0 }];
  assert.equal(onBridge(nation, a.x, a.y), true);      // 캐시를 데운다

  const gone = removeBridge(world, nation, { tileIds: ['br1'] }, data);
  assert.equal(gone.ok, true);
  nation.bridges.push({ id: 'br2', x: b.x, y: b.y, builtTick: 0 });   // 다시 길이 1

  assert.equal(onBridge(nation, a.x, a.y), false, '지운 다리가 아직 살아 있다 — 캐시가 낡았다');
  assert.equal(onBridge(nation, b.x, b.y), true);
});
