// §21-A2 battleTick 페이로드 축소 회귀 — 「전투 중 초당 60~160KB」를 나눠 보내기로 푼 자리.
//
// 옛 규칙은 서브틱(4Hz)마다 적·민병·터렛·플레이어 **전량**과 이름·최대 체력·도읍 자리까지
// 통째로 다시 보냈다. 이 파일이 지키는 것 다섯:
//   ① 적은 매 서브틱(4Hz) 그대로 — 보간의 전제다. 그러나 민병·터렛 전량은 매번 실리지 않는다.
//   ② 바뀐 것은 반드시 닿는다 — 민병이 다치거나 터렛이 새로 서면 그 줄이 온다(안 바뀌면 안 온다).
//   ③ 화면의 판은 서버의 판과 한 글자도 다르지 않다 — 풀 한 장 위에 델타를 얹어 되세운다.
//   ④ 되맞춤 — battleFullEvery 마다 풀 한 장이 끼어들고, 늦게 든 사람은 그 한 장으로 판을 세운다.
//   ⑤ 판정은 한 눈금도 안 바뀐다 — 스트림을 뽑든 안 뽑든 전투 결과가 바이트 단위로 같다.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { townOf } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { spawnResident } from '../server/engine/residents.js';
import {
  startBattle, stepBattle, finishBattle,
  battleSnapshot, battleFull, battleStreamCache, battleStreamTick,
} from '../server/engine/battle.js';

const data = loadGameData();
const FULL_EVERY = data.world.simulation.battleFullEvery;
const bytes = (o) => JSON.stringify(o).length;

const put = (w, n, key, tier, dx, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);

/** 민병 여럿과 터렛 여럿을 갖춘 정착지 — 전투가 붙으면 옛 페이로드가 가장 부풀던 판이다 */
function settlement(seed = 4321, { residents = 14, towers = 5 } = {}) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const rng = createRng(seed);
  nation.tier = 4;
  openChapterForDebug(null, nation, data, 10);
  put(world, nation, 'manor', 3, 3);
  nation.resources.grain = 900;
  for (let i = 0; i < residents; i += 1) spawnResident(world, nation, data, rng);
  for (const u of nation.villagers) u.job = 'defense';
  for (let i = 0; i < towers; i += 1) put(world, nation, 'arrow_tower', 2, 4 + i * 2, -4);
  return { world, nation, rng };
}

/** 전투를 열고 스트림 장부를 한 채 쥔다 — battleStart 의 풀 한 장까지가 여기다 */
function openStream(seed) {
  const { world, nation } = settlement(seed);
  startBattle(world, nation, data);
  const cache = battleStreamCache();
  const start = battleFull(nation, data, cache);
  return { world, nation, cache, start };
}

/** 화면 한 채 — public/js/state.js 만 올려 병합 규칙을 그대로 꺼내 본다 */
function client() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync('public/js/state.js', 'utf8'), ctx);
  return ctx.window.GM.state;
}
/** vm 안에서 빚은 객체는 프로토타입이 다른 realm 의 것이다 — 값만 남겨 견준다 */
const plain = (v) => JSON.parse(JSON.stringify(v));

test('★ §21-A2 ① 서브틱 — 적은 4Hz 그대로, 민병·터렛 전량은 매번 실리지 않는다', () => {
  const { world, nation, cache, start } = openStream(4321);
  assert.ok(start.militia.length >= 8, `민병 ${start.militia.length}명`);
  assert.ok(start.turrets.length >= 5, `터렛 ${start.turrets.length}대`);

  const ticks = [];
  for (let i = 0; i < 20 && !nation.battle.over; i += 1) {
    stepBattle(world, nation, data);
    ticks.push(battleStreamTick(nation, data, cache));
  }
  assert.ok(ticks.length >= 12, '스무 서브틱쯤은 돈다');
  assert.ok(ticks.every((p) => p.full === false), '되맞춤 주기 안에서는 전부 델타다');
  assert.ok(ticks.every((p) => Array.isArray(p.enemies)), '적은 한 장도 빠지지 않는다 — 4Hz');

  const withMilitia = ticks.filter((p) => p.militia).length;
  assert.ok(withMilitia <= Math.ceil(ticks.length / 2),
    `민병이 실린 장 ${withMilitia}/${ticks.length} — 절반 박자를 넘었다`);
  assert.equal(ticks.filter((p) => p.turrets).length, 0, '터렛은 제자리에 서 있다 — 한 장도 안 실린다');

  for (const p of ticks) {
    assert.equal(p.maxSeconds, undefined, '정적 칸(최대 시간)은 델타에 없다');
    assert.equal(p.name, undefined, '정적 칸(이름)은 델타에 없다');
    assert.equal(p.core, undefined, '정적 칸(도읍 자리)은 델타에 없다');
    assert.equal(p.total, undefined, '정적 칸(총원)은 델타에 없다');
  }
  const last = ticks[ticks.length - 1];
  assert.ok(last.enemies.every((e) => e.maxHp === undefined && e.type === undefined),
    '이미 아는 적에게 생김새·최대 체력을 다시 붙이지 않는다');
  assert.ok(bytes(last) * 2 < bytes(battleSnapshot(nation, data)),
    `델타 ${bytes(last)}B 가 풀 ${bytes(battleSnapshot(nation, data))}B 의 절반을 넘는다`);
});

test('★ §21-A2 ② 바뀐 줄은 반드시 닿는다 — 안 바뀌면 안 오고, 다치면 온다', () => {
  const { world, nation, cache } = openStream(777);
  // 시간을 멈춰 둔다(stepBattle 을 안 부른다) — 「무엇이 바뀌어서 왔는가」만 남는다
  const quiet = [battleStreamTick(nation, data, cache), battleStreamTick(nation, data, cache)];
  assert.ok(quiet.every((p) => !p.militia), '아무도 안 움직였으면 민병 줄은 아예 안 실린다');
  assert.ok(quiet.every((p) => !p.turrets && !p.players), '터렛·플레이어도 마찬가지다');

  const hurt = nation.battle.militia[2];
  hurt.hp = Math.round(hurt.maxHp * 0.4);
  const gotMilitia = drainUntil(nation, cache, (p) => p.militia);
  assert.ok(gotMilitia, '다친 민병의 줄이 온다');
  assert.equal(gotMilitia.militia.length, 1, '다친 한 사람만 온다 — 전량이 아니다');
  assert.equal(gotMilitia.militia[0].id, hurt.id);
  assert.equal(gotMilitia.militia[0].hp, hurt.hp);

  const downed = nation.battle.militia[3];
  downed.alive = false;
  const gotDown = drainUntil(nation, cache, (p) => p.militia);
  assert.deepEqual(gotDown.militia.map((m) => m.id), [downed.id]);
  assert.equal(gotDown.militia[0].alive, false, '쓰러진 것은 빠짐없이 실린다(빠진 칸은 참으로 읽으므로)');

  put(world, nation, 'arrow_tower', 2, -6, 5);
  const gotTurret = drainUntil(nation, cache, (p) => p.turrets);
  assert.ok(gotTurret, '새로 선 터렛이 목록째 온다');
  assert.equal(gotTurret.turrets.length, battleSnapshot(nation, data).turrets.length);

  const me = Object.values(nation.players)[0] || (nation.players.lord = { id: 'lord', hp: 60, maxHp: 60 });
  me.hp = 12;
  const gotPlayer = drainUntil(nation, cache, (p) => p.players);
  assert.equal(gotPlayer.players[0].hp, 12, '사람의 체력도 바뀐 그 순간에 온다');
});

/** 조건에 맞는 장이 나올 때까지 서브틱 페이로드를 뽑는다(민병·터렛은 절반 박자라 최대 두 장) */
function drainUntil(nation, cache, ok) {
  for (let i = 0; i < 3; i += 1) {
    const p = battleStreamTick(nation, data, cache);
    if (ok(p)) return p;
  }
  return null;
}

test('★ §21-A2 ③ 화면의 판 — 풀 한 장 위에 델타를 얹으면 서버의 판과 한 글자도 다르지 않다', () => {
  const { world, nation, cache, start } = openStream(2024);
  const S = client();
  S.applyBattle(start);
  assert.deepEqual(plain(S.battleLive().enemies), start.enemies, '첫 풀 스냅샷이 그대로 앉는다');

  let slowChecks = 0;
  for (let i = 0; i < 30 && !nation.battle.over; i += 1) {
    stepBattle(world, nation, data);
    const p = battleStreamTick(nation, data, cache);
    S.applyBattle(p);
    const truth = battleSnapshot(nation, data);
    const seen = plain(S.battleLive());
    assert.deepEqual(seen.enemies, truth.enemies, `${i}번째 장 — 적이 어긋났다`);
    assert.equal(seen.t, truth.t);
    assert.equal(seen.killed, truth.killed);
    assert.equal(seen.name, truth.name, '정적 칸은 앞의 판에서 그대로 이어진다');
    assert.equal(seen.maxSeconds, truth.maxSeconds);
    assert.deepEqual(seen.core, truth.core);
    assert.deepEqual(seen.turrets, truth.turrets, '한 번 받은 터렛은 그대로 남는다');
    if (!p.militia && p.full !== true) continue;
    slowChecks += 1;
    assert.deepEqual(seen.militia, truth.militia, `${i}번째 장 — 민병이 어긋났다`);
    assert.deepEqual(seen.players, truth.players);
  }
  assert.ok(slowChecks >= 5, `민병까지 맞춰 본 장이 ${slowChecks}장뿐이다`);
});

test('★ §21-A2 ④ 되맞춤 — 주기마다 풀 한 장, 늦게 든 사람도 그 한 장으로 판을 세운다', () => {
  const { world, nation, cache } = openStream(9090);
  const ticks = [];
  for (let i = 0; i < FULL_EVERY + 4 && !nation.battle.over; i += 1) {
    stepBattle(world, nation, data);
    ticks.push(battleStreamTick(nation, data, cache));
  }
  const fulls = ticks.filter((p) => p.full === true);
  assert.equal(fulls.length, 1, `${ticks.length}장 가운데 되맞춤은 한 장이다`);
  assert.equal(ticks.indexOf(fulls[0]) + 1, FULL_EVERY, `되맞춤은 ${FULL_EVERY}번째 서브틱에 온다`);
  assert.ok(fulls[0].militia.length && fulls[0].turrets.length && fulls[0].maxSeconds > 0,
    '되맞춤 장에는 전량과 정적 칸이 다 실린다');

  // 늦게 든 사람 — 방의 장부는 건드리지 않는 풀 한 장(입장·관전)만으로 판이 온전해진다
  const late = client();
  late.applyBattle(battleFull(nation, data, null));
  assert.deepEqual(plain(late.battleLive()).militia, battleSnapshot(nation, data).militia);
  assert.deepEqual(plain(late.battleLive()).enemies, battleSnapshot(nation, data).enemies);

  // 풀을 한 장도 못 받은 채 델타부터 온 화면은 그것을 버린다 — 다음 되맞춤이 판을 세운다
  const blind = client();
  stepBattle(world, nation, data);
  assert.equal(blind.applyBattle(battleStreamTick(nation, data, cache)), null);
  assert.equal(blind.battleLive(), null, '반쪽짜리 판을 그리지 않는다');
});

test('★ §21-A2 ⑤ 판정 불변 — 스트림을 뽑든 안 뽑든 전투 결과가 바이트 단위로 같다', () => {
  const plain = settlement(31337);
  startBattle(plain.world, plain.nation, data);
  while (!plain.nation.battle.over) stepBattle(plain.world, plain.nation, data);
  const a = finishBattle(plain.world, plain.nation, data);

  const streamed = settlement(31337);
  startBattle(streamed.world, streamed.nation, data);
  const cache = battleStreamCache();
  battleFull(streamed.nation, data, cache);
  while (!streamed.nation.battle.over) {
    stepBattle(streamed.world, streamed.nation, data);
    battleStreamTick(streamed.nation, data, cache);
  }
  const b = finishBattle(streamed.world, streamed.nation, data);
  assert.equal(JSON.stringify(b), JSON.stringify(a), '전송 계층이 판정을 한 눈금도 건드리지 않는다');
});
