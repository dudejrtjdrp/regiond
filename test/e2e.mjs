// E2E — 엔드리스 정착지 한 사이클 (실서버 + socket.io-client)
// 개척 시작 → 스윙 노동 → 오두막 → 주민 도착 → 티어업 → 울타리 → 개별 업그레이드 → 웨이브 전투
// ★ PROTOCOL v3 의 왕복 계약(ack · 이벤트 · 정보 비대칭)을 실제 소켓으로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.NODE_ENV = 'test';
process.env.GALLAEMALLAE_SAVES_DIR = mkdtempSync(join(tmpdir(), 'gm-e2e-'));

import { io as ioClient } from 'socket.io-client';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { savesDir } from '../server/persistence.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

async function boot() {
  const { http, games } = await import('../server/index.js');
  await new Promise((res) => http.listen(0, res));
  const port = http.address().port;
  return { http, games, base: `http://127.0.0.1:${port}` };
}

/**
 * ★ 접속 순서 계약(PROTOCOL §3-0) — `joined` 뒤에 world·state·worldState 가 곧바로 따라온다.
 *   그래서 테스트는 소켓을 만들자마자 마지막 payload 를 붙잡아 둔다(뒤늦게 붙으면 놓친다).
 */
function connect(base) {
  const socket = ioClient(base, { transports: ['websocket'], forceNew: true });
  socket.latest = {};
  /* ★ 도착 순서도 함께 적어 둔다 — 계약이 말하는 것은 '순서'이지 '같은 순간'이 아니다.
     payload 가 커지면 world 와 state 가 다른 프레임에 실려 오기도 하는데(규약이 자란 뒤 실제로 그랬다),
     그때 latest 를 곧바로 들여다보면 아직 비어 있다. 순서를 적고, 없으면 기다려서 본다. */
  socket.order = [];
  for (const evt of ['state', 'worldState', 'world']) {
    socket.on(evt, (payload) => { socket.latest[evt] = payload; socket.order.push(evt); });
  }
  socket.awaitLatest = async (evt, timeout = 8000) =>
    socket.latest[evt] ?? await socket.next(evt, timeout);
  socket.next = (evt, timeout = 8000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${evt}`)), timeout);
    socket.once(evt, (payload) => { clearTimeout(timer); resolve(payload); });
  });
  return socket;
}

const once = (socket, event, timeout = 8000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});

const send = (socket, event, payload = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000);
  socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
});

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

test('E2E — 개척 시작에서 첫 웨이브까지 (v3 전체 루프)', async () => {
  const { http, games, base } = await boot();
  const socket = connect(base);
  const gameId = `e2e_${Date.now()}`;
  try {
    // ── 1. 접속 ────────────────────────────────────────────────
    const worldP = once(socket, 'world');
    const joined = await send(socket, 'join', { gameId, playerName: '개척자', seed: 4242, avatarId: 'p1' });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    assert.equal(joined.protocol, '3.3');   /* ★ §15-B-3 — 세이브 판번호가 올라 규약도 3.3 이다 */
    assert.equal(joined.tier, 0, '마차에서 내린 자리는 티어 0');
    assert.ok(joined.config.tiers && joined.config.skills && joined.config.waves, 'config 에 v3 블록이 실린다');

    const world = await worldP;
    assert.equal(world.protocol, 3);
    assert.equal(world.size, data.world.size);
    assert.ok(world.terrain.rle.length > 0);
    assert.ok(Array.isArray(world.fences), 'world 스냅샷에 울타리 배열이 있다');
    assert.equal(world.structures.length, 1, '모닥불 하나로 시작');
    assert.equal(world.structures[0].key, 'campfire');

    const rt = games.get(gameId);
    rt.stop();                                    // 일 틱은 테스트가 손으로 돌린다
    const state0 = await socket.awaitLatest('state');
    assert.ok(state0, 'joined 뒤에 state 가 따라온다');
    assert.deepEqual(socket.order.slice(0, 2), ['world', 'state'], '순서 계약: world 다음이 state 다');
    assert.equal(state0.tier.tier, 0);
    assert.equal(state0.nation.population, 0, '인구 0에서 시작');
    assert.equal(state0.nation.residents.length, 0);
    assert.ok(state0.tier.next.reqs.length > 0, '다음 티어 조건표가 내려온다');
    assert.ok(state0.you.player, '내 스킬 장부가 내려온다');
    assert.equal(state0.you.player.skills.lumber.level, 1);
    assert.ok(state0.unlocked.features.includes('swing'));
    assert.equal(state0.unlocked.features.includes('waves'), false, '웨이브는 아직 안 열렸다');
    // ★ v3.1 — 콘텐츠 사슬. 1장에서는 배치대가 비어 있다("지을 게 없습니다"가 나올 자리가 없다)
    assert.equal(state0.chapter.id, 1, '1장 불씨에서 시작');
    assert.equal(state0.chapter.goal.key, 'first_swings');
    assert.ok(state0.chapter.goal.targets.length > 0, '목표가 가리킬 대상 후보가 함께 온다');
    assert.equal(state0.chapter.goal.targets[0].kind, 'node');
    assert.deepEqual(state0.nation.buildable, [], '1장 배치대는 비어 있다');
    assert.equal(state0.wave, null, '웨이브 블록 자체가 없다');
    assert.equal(state0.market, undefined, '시장 블록 자체가 없다');
    assert.equal(state0.mandate, undefined, '관제 블록 자체가 없다');

    // ── 2. 스윙 노동 ───────────────────────────────────────────
    const town = world.towns.find((t) => t.isPlayer);
    /* ★ GDD3 §13-B-2 — 시작 영토 안은 **빈 땅**이다(건물 놓을 자리를 비워 둔다).
       첫 군락은 영토 바로 밖 8~14타일에 있고, 시작 탐사 반경 안이라 처음부터 눈에 보인다. */
    const dTown = (n) => Math.hypot(n.x - town.x, n.y - town.y);
    assert.equal(world.nodes.filter((n) => n.mine).length, 0, '시작 영토 안에는 자원 노드가 하나도 없다');
    const forests = world.nodes.filter((n) => n.type === 'forest').sort((a, b) => dTown(a) - dTown(b));
    const rocks = world.nodes.filter((n) => n.type === 'rock').sort((a, b) => dTown(a) - dTown(b));
    assert.ok(forests.length > 0 && rocks.length > 0, '영토 바로 밖에 숲 군락·바위 지대가 보장된다');
    assert.ok(dTown(forests[0]) <= 16, `첫 나무까지 ${dTown(forests[0]).toFixed(1)}타일 — 왕복이 부담스럽지 않다`);
    const forest = forests[0];
    assert.equal(forest.swingsPerCycle, data.skills.nodes.forest.swings);

    assert.equal((await send(socket, 'lordMove', { x: forest.x, y: forest.y })).ok, true);

    let now = 1_000_000;
    const first = await send(socket, 'actionSwing', { nodeId: forest.id, now });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    assert.ok(first.resources, '스윙 ack 에 창고 잔고가 실린다 — 화면이 일 틱을 안 기다린다');
    assert.equal(first.resources.wood, rt.world.nations.player.resources.wood);
    assert.ok(first.gained.wood > 0, '나무가 튄다');
    assert.equal(first.swings, 1);
    assert.ok(first.cooldownMs >= data.skills.swing.cooldownFloorSec * 1000);

    const spam = await send(socket, 'actionSwing', { nodeId: forest.id, now: now + 100 });
    assert.equal(spam.ok, false, '연타는 서버가 막는다');
    assert.equal(spam.error.code, 'COOLDOWN');

    let fi = 0;
    for (let i = 0; i < 50; i += 1) {
      now += 2500;
      const node = forests[fi % forests.length];
      await send(socket, 'lordMove', { x: node.x, y: node.y });
      const r = await send(socket, 'actionSwing', { nodeId: node.id, now });
      if (!r.ok) fi += 1;
    }
    let ri = 0;
    for (let i = 0; i < 30; i += 1) {
      now += 2500;
      const node = rocks[ri % rocks.length];
      await send(socket, 'lordMove', { x: node.x, y: node.y });
      const r = await send(socket, 'actionSwing', { nodeId: node.id, now });
      if (!r.ok) ri += 1;
    }
    const afterSwings = rt.world.nations.player;
    assert.ok(afterSwings.resources.wood >= 45, `목재 ${afterSwings.resources.wood}`);
    assert.ok(afterSwings.resources.stone >= 10, `석재 ${afterSwings.resources.stone}`);
    assert.ok(afterSwings.players.p1.skills.lumber.xp > 0, '스윙이 숙련으로 쌓인다');

    // ── 2-b. ★ 사슬이 스스로 넘어간다 — 목재 10 → 2장(첫 지붕) ──
    assert.ok(rt.world.nations.player.progress.chapter >= 2, '목재 10 을 넘기면 2장이 열린다');
    const tentPlace = await send(socket, 'placeBuilding', { building: 'tent' });
    assert.equal(tentPlace.ok, true, JSON.stringify(tentPlace.error));
    await send(socket, 'lordMove', { x: tentPlace.x, y: tentPlace.y });
    for (let i = 0; i < 8; i += 1) {
      now += 2500;
      const r = await send(socket, 'actionSwing', { siteId: tentPlace.siteId, now });
      if (r.ok && r.done) { assert.ok(r.structure, '완공된 건물이 ack 에 실려 온다'); break; }
    }
    await post(base, '/api/debug/step', { gameId });
    assert.equal(rt.world.nations.player.progress.chapter, 3, '천막이 서면 3장(허기)');
    // 3장 첫 칸(식량 20)을 지나야 오두막이 열린다 — 그 전에는 명령 자체가 튕긴다
    const tooEarly = await send(socket, 'placeBuilding', { building: 'hut' });
    assert.equal(tooEarly.ok, false);
    assert.equal(tooEarly.error.code, 'CHAPTER_LOCKED');

    // ── 3. 오두막 배치 + 현장 스윙 ─────────────────────────────
    rt.world.nations.player.resources.grain = 40;        // 어로·채집으로 모은 셈
    await post(base, '/api/debug/step', { gameId });
    assert.ok(rt.world.nations.player.progress.cleared.includes('3:grain20'), '식량 20 칸 통과');
    const placed = await send(socket, 'placeBuilding', { building: 'hut' });
    assert.equal(placed.ok, true, JSON.stringify(placed.error));
    assert.ok(placed.siteId);
    await send(socket, 'lordMove', { x: placed.x, y: placed.y });
    for (let i = 0; i < 14; i += 1) {
      now += 2500;
      const r = await send(socket, 'actionSwing', { siteId: placed.siteId, now });
      if (r.ok) assert.equal(r.skill, 'build');
    }
    // ★ v3.1 — 마지막 망치질이 건물을 세운다. 공사 목록에서 곧바로 빠지고 건물이 선다.
    assert.equal(rt.world.nations.player.construction.length, 0, '스윙만으로 공사가 끝났다');
    assert.ok(rt.world.nations.player.structures.some((s) => s.key === 'hut'), '오두막이 그 자리에서 섰다');

    // ── 4. 일 틱 → ★ 본부에서 [승격] (GDD3 §12-2) ──────────────
    //   ★ 오두막이 서는 순간 4장이 열리므로, 첫 주민은 **이 틱**에 이미 걸어 들어온다.
    //     그래서 도착 대기는 승격보다 먼저 걸어 둔다.
    const arrivedP = once(socket, 'residentArrived');
    await post(base, '/api/debug/step', { gameId });
    // 시간은 승격도 열지 않는다 — 조건이 다 찼어도 저절로는 안 오른다
    assert.equal(rt.world.nations.player.tier, 0, '일 틱은 티어를 올리지 않는다');
    const next = socket.latest.state.tier.next;
    assert.equal(next.ready, true, JSON.stringify(next.reqs));
    assert.ok(next.reqs.every((r) => r.have !== undefined && r.need !== undefined),
      '조건마다 현재값/필요값이 실려 온다 (§12-3 조건 가시화)');

    const tierUpP = once(socket, 'tierUp');
    const promote = await send(socket, 'promoteSettlement', {});
    assert.equal(promote.ok, true, JSON.stringify(promote.error));
    const tierUp = await tierUpP;
    assert.equal(tierUp.tier, 1);
    assert.equal(tierUp.radius, 9, '영토가 6 → 9 로 넓어진다');
    // ★ §12-2 — 본부가 정착지를 따라 자란다
    const hqView = socket.latest.state.nation.structures.find((s) => s.hq);
    assert.ok(hqView, '본부가 뷰에 실린다');
    assert.equal(hqView.fw, 4, '본부는 4×4');
    assert.equal(hqView.tier, 2, '티어 1 정착지의 본부는 2단(야영 본부)');
    assert.equal(hqView.immovable, true, '본부는 옮기지도 헐지도 못한다');
    // ★ v3.1 — 주민 유입을 여는 것은 티어가 아니라 4장(오두막 완공)이다
    assert.equal(rt.world.nations.player.progress.chapter, 4, '오두막이 서면 4장(첫 이웃)');
    assert.ok(socket.latest.state.unlocked.features.includes('residentArrival'));

    // ── 5. 주민 도착 ───────────────────────────────────────────
    const arrived = await arrivedP;
    assert.ok(arrived.name && arrived.name.length > 0, '이름을 달고 온다');
    assert.ok(arrived.appearance, '외형도 함께');
    assert.equal(arrived.population, 1);

    // ── 6. 티어 2 · 울타리 조각 ────────────────────────────────
    const n = rt.world.nations.player;
    n.tier = 2;
    __openChapter(n, 8);
    n.resources.wood = 800;
    n.resources.stone = 400;
    n.resources.steel = 60;                              // 철문 개조분
    const fence = await send(socket, 'placeFence', {
      points: [{ x: town.x + 5, y: town.y - 4 }, { x: town.x + 5, y: town.y + 4 }],
      gates: [0],
    });
    assert.equal(fence.ok, true, JSON.stringify(fence.error));
    assert.ok(fence.placed >= 1, '조각이 선다');
    assert.equal(fence.placed + fence.skipped, 8, '드래그한 선이 8조각으로 쪼개진다(물·건물 자리는 걸러진다)');
    const upFence = await send(socket, 'upgradeFence', {});
    assert.equal(upFence.ok, true, JSON.stringify(upFence.error));
    assert.ok(rt.world.nations.player.fences.every((f) => f.tier === 2), '목책 → 석벽');

    // ── 7. 개별 건물 업그레이드 ────────────────────────────────
    const hut = rt.world.nations.player.structures.find((s) => s.key === 'hut');
    rt.world.nations.player.resources.wood = 800;
    rt.world.nations.player.resources.stone = 400;
    const up = await send(socket, 'upgradeStructure', { structureId: hut.id });
    assert.equal(up.ok, true, JSON.stringify(up.error));
    assert.equal(up.structureId, hut.id);
    assert.equal(up.tier, 2, '그 한 채만 2티어로');

    // ── 8. 웨이브 전투 ─────────────────────────────────────────
    const p = rt.world.nations.player;
    p.wave.arrivalTick = rt.world.tick + 1;
    const battleStartP = once(socket, 'battleStart');
    const incomingP = once(socket, 'waveIncoming');
    await post(base, '/api/debug/step', { gameId });
    const incoming = await incomingP;
    assert.equal(incoming.number, 1);
    const battle = await battleStartP;
    assert.ok(battle.enemies.length > 0, '적이 실제 유닛으로 걸어 들어온다');
    assert.equal(battle.total, battle.enemies.length);

    const resultP = once(socket, 'waveResult', 12000);
    const resolved = await post(base, '/api/debug/battle', { gameId });
    assert.equal(resolved.ok, true);
    const result = await resultP;
    assert.equal(result.number, 1);
    assert.equal(typeof result.won, 'boolean');
    assert.ok(result.timeline.length > 0, '리플레이 타임라인이 함께 온다');
    assert.equal(result.timeline.filter((e) => e.kind === 'kill').length, result.enemiesKilled);
    assert.equal(rt.world.nations.player.wave.index, 1, '다음 웨이브로 넘어간다');

    // ── 9. 연대기 ──────────────────────────────────────────────
    const chron = await send(socket, 'requestChronicle', {});
    assert.equal(chron.ok, true);
    assert.ok(chron.chronicle.entries.some((e) => e.kind === 'tier_up'));
    assert.ok(chron.chronicle.entries.some((e) => e.kind === 'wave'));
    assert.equal(chron.chronicle.totals.wavesFaced, 1);
  } finally {
    socket.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId), { recursive: true, force: true });
  }
});

test('E2E — 정보 비대칭: 성녀가 없으면 어디에도 정확한 습격일이 없다', async () => {
  const { http, games, base } = await boot();
  const socket = connect(base);
  const gameId = `e2e_saint_${Date.now()}`;
  try {
    await send(socket, 'join', { gameId, playerName: '개척자', seed: 99, avatarId: 'p1' });
    const rt = games.get(gameId);
    rt.stop();
    const n = rt.world.nations.player;
    n.tier = 3;
    __openChapter(n, 10);
    n.roles.saint.holder = null;
    n.wave.arrivalTick = rt.world.tick + 2;

    const config = await (await fetch(`${base}/api/config`)).json();
    assert.ok(!JSON.stringify(config).includes('arrivalTick'), 'config 에 도착 틱이 없다');

    const stateP = socket.next('state');
    await post(base, '/api/debug/step', { gameId });
    const state = await stateP;
    assert.equal(state.wave.precise, false);
    assert.equal(state.wave.arrivalTick, null);
    assert.equal(state.wave.enemy?.type ?? null, null, '적 종류도 안 보인다');

    const ws = socket.latest.worldState;
    assert.equal(ws.waveArrow?.tick ?? null, null);
    assert.equal(ws.waveArrow?.type ?? null, null);

    // 성녀를 세우면 예언이 열린다
    rt.world.nations.player.roles.saint.holder = 'npc';
    rt.world.nations.player.wave.arrivalTick = rt.world.tick + 2;
    const state2P = socket.next('state');
    await post(base, '/api/debug/step', { gameId });
    const state2 = await state2P;
    assert.equal(state2.wave.precise, true);
    assert.ok(state2.wave.enemy.units > 0, '구성까지 열린다');
  } finally {
    socket.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId), { recursive: true, force: true });
  }
});

/**
 * ★ 회귀 — 안개 즉시 공개(PROTOCOL v3.0).
 *   예전에는 안개가 '일 틱'에서만 다시 계산돼, 검은 땅으로 걸어 들어가도 그 자리의 노드가
 *   최대 10분 뒤에야 내려왔다. 이제 lordMove 가 그 자리에서 시야를 찍고 worldDiff 를 흘린다.
 *   안개 마스크는 나라 공용이라 같이 접속한 동료도 같은 자리를 함께 받는다.
 */
test('E2E — 안개: 걸어 들어간 자리가 일 틱을 기다리지 않고 내려온다', async () => {
  const { http, games, base } = await boot();
  const a = connect(base);
  const b = connect(base);
  const gameId = `e2e_fog_${Date.now()}`;
  try {
    const worldP = once(a, 'world');
    await send(a, 'join', { gameId, playerName: '가온', avatarId: '가온', seed: 909 });
    await send(b, 'join', { gameId, playerName: '나래', avatarId: '나래' });
    const world = await worldP;
    const rt = games.get(gameId);
    rt.stop();                                   // 일 틱은 절대 돌지 않는다 — 즉시성만 본다
    const tick0 = rt.world.tick;

    const known = new Set(world.nodes.map((n) => n.id));
    const town = rt.world.map.towns.find((t) => t.isPlayer);
    const vision = data.world.fog.vision.lord;
    const target = rt.world.map.nodes.find((n) => !n.hidden && !known.has(n.id)
      && dist(n.x, n.y, town.x, town.y) > vision + 6);
    assert.ok(target, '아직 못 본 노드가 있다');

    const diffA = a.next('worldDiff');
    const diffB = b.next('worldDiff');
    const moved = await send(a, 'lordMove', { x: target.x, y: target.y });
    assert.equal(moved.ok, true);
    assert.ok(moved.reveal, 'ack 에도 즉시 공개분이 실린다');

    const dA = await diffA;
    const dB = await diffB;
    assert.equal(rt.world.tick, tick0, '일 틱은 돌지 않았다');
    assert.equal(dA.reveal, true);
    assert.ok(dA.fog.length > 0, '안개 청크가 실린다');
    assert.ok(dA.nodes.some((n) => n.id === target.id), '걸어간 자리의 노드가 곧바로 내려온다');
    assert.ok(dB.nodes.some((n) => n.id === target.id), '동료도 같은 자리를 함께 받는다');

    // 같은 칸을 다시 보고하면 아무것도 새로 내려오지 않는다(이동 스로틀)
    const again = await send(a, 'lordMove', { x: target.x, y: target.y });
    assert.equal(again.ok, true);
    assert.equal(again.reveal, null, '이미 본 땅은 다시 보내지 않는다');
  } finally {
    a.close(); b.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId), { recursive: true, force: true });
  }
});

test('E2E — 멀티 왕복 (초대 코드 · 외형 · 채팅 · 스윙 중계 · 역할 잠금)', async () => {
  const { http, games, base } = await boot();
  const a = connect(base);
  const b = connect(base);
  let back = null;                    // ★ 되돌아온 접속 — 도중에 넘어져도 finally 가 반드시 닫는다
  const gameId = `e2e_multi_${Date.now()}`;
  try {
    await send(a, 'join', { gameId, playerName: '가온', avatarId: '가온', seed: 7 });
    const joinedB = await send(b, 'join', { gameId, playerName: '나래', avatarId: '나래' });
    assert.equal(joinedB.gameId, gameId, '같은 초대 코드로 같은 정착지에 들어간다');
    const rt = games.get(gameId);
    rt.stop();

    const avatarsP = once(b, 'avatars');
    const look = await send(a, 'setAppearance', { appearance: { skin: 2, hair: 3, hairColor: 4, outfit: 1, outfitColor: 5 } });
    assert.equal(look.ok, true);
    const avatars = await avatarsP;
    assert.equal(avatars.find((x) => x.id === '가온').appearance.skin, 2);

    const chatP = once(b, 'chat');
    await send(a, 'chat', { text: '나무 좀 베어 주게 <b>' });
    const msg = await chatP;
    assert.equal(msg.from.name, '가온');
    assert.ok(msg.text.includes('&lt;b&gt;'), '꺾쇠는 이스케이프된다');

    // 스윙은 방 안의 다른 접속자에게 연출용으로 중계된다
    const town = rt.world.map.towns.find((t) => t.isPlayer);
    // ★ §13-B-2 — 나무는 영토 밖 군락에 있다. 시작 탐사 반경(14) 안에서 가장 가까운 것을 고른다.
    const node = rt.world.map.nodes.find((x) => x.type === 'forest'
      && dist(x.x, x.y, town.x, town.y) <= data.world.fog.startExploredRadius);
    const swingP = once(b, 'swing');
    await send(a, 'lordMove', { x: node.x, y: node.y });
    await send(a, 'actionSwing', { nodeId: node.id, now: 5_000_000 });
    const relayed = await swingP;
    assert.equal(relayed.avatarId, '가온');
    assert.equal(relayed.type, 'actionSwing');

    // ★ v3.1 — 역할은 6장(감정소를 세우고 [땅을 감정한다])을 지나야 존재한다.
    //   그 전에는 명령이 진행 감독 관문에서 그대로 튕긴다.
    const locked = await send(a, 'pickRole', { role: 'defense' });
    assert.equal(locked.ok, false);
    assert.equal(locked.error.code, 'CHAPTER_LOCKED');

    rt.world.emotionDayDone = true;
    rt.world.nations.player.tier = 3;
    __openChapter(rt.world.nations.player, 10);
    const youP = once(b, 'you');
    const pick = await send(a, 'pickRole', { role: 'defense' });
    assert.equal(pick.ok, true, JSON.stringify(pick.error));
    assert.equal(pick.role, 'defense');
    const pickB = await send(b, 'pickRole', { role: 'farm' });
    assert.equal(pickB.role, 'farm');
    await youP;
    assert.equal(rt.world.nations.player.roles.defense.owner, '가온', '서로 다른 자리를 동시에 맡는다');
    assert.equal(rt.world.nations.player.roles.farm.owner, '나래');

    // ── 한 명이 나갔다가 돌아온다 ──────────────────────────────
    b.close();
    await new Promise((r) => setTimeout(r, 250));
    const member = rt.world.nations.player.members.find((m) => m.avatarId === '나래');
    assert.equal(member.online, false, '나간 사람은 명부에서 꺼진다');
    assert.equal(rt.world.nations.player.online, true, '남은 사람이 있으면 정착지는 깨어 있다');

    back = connect(base);
    /* ★ 접속 순서 계약(PROTOCOL §3-0)은 joined → chatHistory → avatars → **world → state → worldState** 다.
       world 를 받은 그 자리에서 state 를 단정하면 안 된다 — 둘은 다른 입출력 차례에 도착할 수 있고,
       실제로 월드 스냅샷이 커지자(군락·링) 갈라졌다. 각각을 제 이름으로 기다린다. */
    const worldBackP = once(back, 'world', 8000);
    const stateBackP = once(back, 'state', 8000);
    const rejoin = await send(back, 'join', { gameId, playerName: '나래', avatarId: '나래' });
    assert.equal(rejoin.ok, true, JSON.stringify(rejoin));
    assert.equal(rejoin.gameId, gameId, '같은 정착지로 돌아온다');
    const worldBack = await worldBackP.catch(() => back.latest.world);
    const stateBack = await stateBackP.catch(() => back.latest.state);
    assert.ok(worldBack || back.latest.world, '돌아온 사람도 지도를 다시 받는다');
    assert.ok(stateBack || back.latest.state, '상태도 다시 온다');
    assert.equal(rt.world.nations.player.members.find((m) => m.avatarId === '나래').online, true,
      '명부에 다시 불이 들어온다');
    assert.equal(rt.world.nations.player.roles.farm.owner, '나래', '맡았던 자리는 그대로다');

    // 돌아온 뒤에도 왕복이 그대로 돈다 — 채팅 · 스윙 ack
    const chatBackP = once(a, 'chat');
    await send(back, 'chat', { text: '다녀왔네' });
    assert.equal((await chatBackP).from.name, '나래', '돌아온 사람의 말이 남에게 닿는다');
    const node2 = rt.world.map.nodes.find((x) => x.type === 'forest'
      && dist(x.x, x.y, town.x, town.y) <= data.world.fog.startExploredRadius);
    await send(back, 'lordMove', { x: node2.x, y: node2.y });
    const swingBack = await send(back, 'actionSwing', { nodeId: node2.id, now: 9_000_000 });
    assert.equal(swingBack.ok, true, JSON.stringify(swingBack.error));
    assert.ok(swingBack.resources, '돌아온 사람의 스윙 ack 에도 잔고가 실린다');
  } finally {
    /* 소켓 하나라도 살아 있으면 http.close() 가 영영 돌아오지 않아 실패한 테스트가 **아무 말 없이 멎는다**.
       무엇이 어긋났는지 보려면 여기서 전부 닫아야 한다. */
    a.close(); b.close(); back?.close();
    games.get(gameId)?.stop();
    await new Promise((res) => http.close(res));
    await rm(join(savesDir(), gameId), { recursive: true, force: true });
  }
});
