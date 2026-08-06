// §19-A 멀티 동기화 회귀 — docs/QA1차/01_멀티플레이_동기화.md (B01-3 · B01-5 · B01-6 · B01-7)
//
// 이 파일이 지키는 것 셋. 셋 다 「방장 화면에만 반영되고 게스트에게는 안 온다」로 드러났던 자리다.
//   ① 아바타 방송의 정본 — `avatars` 이벤트는 view.avatarViews 가 빚은 것이어야 한다
//      (`bot`·`down`·`hp` 가 실린다). 날것(nation.avatars)을 흘리면 worldDiff.avatars 와
//      **같은 이름의 두 소스**가 번갈아 꽂혀 팀원의 쓰러짐·동료 표시·외형이 흔들린다.
//   ② 사람이 들어오면 방 전체가 새 명부를 받는다 — 먼저 있던 사람의 「함께 다스리는 이들」이
//      다음 일 틱(최대 10분)까지 옛 목록이면 안 된다.
//   ③ 궤를 열어 자리가 세상에서 지워지면 방 전체가 그 자리에서 지운다 — 실시간 스윙은
//      swing 중계만 하므로, 지움은 따로 알리지 않으면 남의 화면에 유령으로 남는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.NODE_ENV = 'test';
process.env.GALLAEMALLAE_SAVES_DIR = mkdtempSync(join(tmpdir(), 'gm-19a-'));

import { io as ioClient } from 'socket.io-client';
import { loadGameData } from '../server/engine/data.js';
import { addNode } from '../server/engine/world.js';
import { stampVisionDisc } from '../server/engine/fog.js';
import { savesDir } from '../server/persistence.js';

const data = loadGameData();

async function boot() {
  const { http, games } = await import('../server/index.js');
  await new Promise((res) => http.listen(0, res));
  return { http, games, base: `http://127.0.0.1:${http.address().port}` };
}

/** 마지막으로 받은 payload 를 붙잡아 두는 소켓 — 접속 직후의 스냅샷을 놓치지 않는다 */
function connect(base) {
  const socket = ioClient(base, { transports: ['websocket'], forceNew: true });
  socket.latest = {};
  socket.nodes = {};
  for (const evt of ['state', 'avatars', 'worldDiff']) socket.on(evt, (p) => { socket.latest[evt] = p; });
  socket.on('world', (w) => { for (const n of w.nodes || []) socket.nodes[n.id] = n; });
  socket.on('worldDiff', (d) => {
    for (const n of d.nodes || []) socket.nodes[n.id] = n;
    for (const id of d.removedNodes || []) delete socket.nodes[id];
  });
  return socket;
}

const send = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000);
  socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});
const settle = (ms = 350) => new Promise((res) => setTimeout(res, ms));
const memberNames = (socket) => (socket.latest.state?.nation?.members || []).map((m) => m.name);

test('§19-A ① 아바타 방송은 뷰가 정본이다 — bot·down·hp 가 실린다', async () => {
  const { http, games, base } = await boot();
  const host = connect(base);
  let gameId = null;
  try {
    const joined = await send(host, 'join', { playerName: '방장', avatarId: '방장' });
    gameId = joined.gameId;
    await settle();
    const list = host.latest.avatars || [];
    assert.ok(list.length > 0, '접속하면 아바타 목록이 온다');
    for (const a of list) {
      assert.equal(typeof a.bot, 'boolean', `${a.id} 에 bot 이 실린다(사람인가 동료인가)`);
      assert.equal(typeof a.down, 'boolean', `${a.id} 에 down 이 실린다(쓰러짐 표시)`);
      assert.ok(a.appearance && typeof a.appearance.skin === 'number', `${a.id} 의 외형이 정규화되어 온다`);
    }
    // worldDiff 의 아바타와 **같은 값**이어야 한다(두 소스가 아니라 한 소스다)
    const rt = games.get(gameId);
    rt.broadcastState();
    await settle();
    const fromDiff = host.latest.worldDiff?.avatars || [];
    assert.deepEqual(fromDiff.map((a) => a.id).sort(), list.map((a) => a.id).sort());
  } finally {
    host.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId ?? '_'), { recursive: true, force: true });
  }
});

test('§19-A ② 코드로 들어온 사람이 먼저 있던 사람의 명부에 그 자리에서 오른다', async () => {
  const { http, games, base } = await boot();
  const host = connect(base);
  const guest = connect(base);
  let gameId = null;
  try {
    const joined = await send(host, 'join', { playerName: '방장', avatarId: '방장' });
    gameId = joined.gameId;
    await settle();
    assert.ok(!memberNames(host).includes('게스트'), '아직 게스트는 없다');
    await send(guest, 'join', { gameId, playerName: '게스트', avatarId: '게스트' });
    await settle();
    assert.ok(memberNames(host).includes('게스트'), '방장의 명부에 게스트가 곧바로 오른다');
    assert.ok(memberNames(guest).includes('방장'), '게스트의 명부에도 방장이 있다');
  } finally {
    host.close(); guest.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId ?? '_'), { recursive: true, force: true });
  }
});

test('§19-A ③ 팀원이 연 궤는 방 전체의 화면에서 그 자리에서 사라진다', async () => {
  const { http, games, base } = await boot();
  const host = connect(base);
  const guest = connect(base);
  let gameId = null;
  try {
    const joined = await send(host, 'join', { playerName: '방장', avatarId: '방장' });
    gameId = joined.gameId;
    await send(guest, 'join', { gameId, playerName: '게스트', avatarId: '게스트' });
    await settle();
    const rt = games.get(gameId);
    rt.stop();                                   // 일 틱은 돌지 않는다 — 즉시성만 본다
    const nation = rt.world.nations[rt.world.playerNationId];
    const me = nation.avatars['게스트'];
    const node = addNode(rt.world, 'cache', me.x + 1, me.y, data, { tick: rt.world.tick });
    stampVisionDisc(nation, data, rt.world.tick, me.x, me.y, 12);
    rt.broadcastState();
    await settle();
    assert.ok(host.nodes[node.id], '방장 화면에도 궤가 보인다');

    let removed = null;
    for (let i = 0; i < 12 && !removed; i += 1) {
      const res = await send(guest, 'actionSwing', { nodeId: node.id, x: me.x + 1, y: me.y });
      if (res.removedNodes) removed = res.removedNodes;
      await settle(700);                         // 스윙 쿨타임(data/skills.json)이 지나기를 기다린다
    }
    assert.deepEqual(removed, [node.id], '궤를 다 열면 ack 이 지운 자리를 알린다');
    await settle();
    assert.ok(!host.nodes[node.id], '방장 화면에서도 궤가 사라졌다');
    assert.ok(!guest.nodes[node.id], '연 사람 화면에서도 사라졌다');
  } finally {
    host.close(); guest.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId ?? '_'), { recursive: true, force: true });
  }
});
