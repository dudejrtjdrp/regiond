// §19-E(F04-9) 멀티 시간 가속 회귀 — docs/QA1차/04_게임디자인.md F04-9.
//
// 이 파일이 지키는 것 셋:
//   ① 시간은 **서버가** 돌린다 — 소켓 세션이 곧 신원이고 방이다(REST 처럼 아무 방이나 집지 않는다)
//   ② **방장만** 돌린다 — 나중에 들어온 사람은 거절된다(NOT_HOST)
//   ③ 바뀐 하루 길이는 **방 전체**에 흘러간다(timeScale) — 사람마다 다른 속도의 해가 뜨면 안 된다
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.NODE_ENV = 'test';
process.env.GALLAEMALLAE_SAVES_DIR = mkdtempSync(join(tmpdir(), 'gm-19e-'));

import { io as ioClient } from 'socket.io-client';
import { savesDir } from '../server/persistence.js';

async function boot() {
  const { http, games } = await import('../server/index.js');
  await new Promise((res) => http.listen(0, res));
  return { http, games, base: `http://127.0.0.1:${http.address().port}` };
}

function connect(base) {
  const socket = ioClient(base, { transports: ['websocket'], forceNew: true });
  socket.scales = [];
  socket.on('timeScale', (p) => socket.scales.push(p));
  return socket;
}

const send = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000);
  socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});
const settle = (ms = 300) => new Promise((res) => setTimeout(res, ms));

test('§19-E(F04-9) 시간 가속 — 방장만 돌리고, 방 전체가 같은 하루를 산다', async () => {
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
    rt.stop();

    // ② 게스트는 거절된다
    const denied = await send(guest, 'devTime', { tickRealSeconds: 1 });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'NOT_HOST');

    // ① 방장은 받아들여지고, 서버의 시계가 실제로 바뀐다
    guest.scales.length = 0;
    const ok = await send(host, 'devTime', { tickRealSeconds: 2 });
    assert.equal(ok.ok, true);
    assert.equal(ok.tickRealSeconds, 2);
    assert.equal(rt.tickRealSeconds, 2);

    // ③ 게스트에게도 같은 하루 길이가 흘러간다
    await settle();
    assert.ok(guest.scales.some((p) => p.tickRealSeconds === 2), '방 전체가 timeScale 을 받는다');

    // 하루 넘기기·멈춤도 같은 문을 지난다
    const stepped = await send(host, 'devTime', { step: true });
    assert.equal(stepped.tick, rt.world.tick);
    const paused = await send(host, 'devTime', { togglePause: true });
    assert.equal(paused.paused, true);
    rt.setPaused(false);
    rt.stop();
  } finally {
    host.close(); guest.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId ?? '_'), { recursive: true, force: true });
  }
});
