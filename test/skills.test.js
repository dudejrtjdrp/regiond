// 개인 스킬 · 스윙 — docs/GDD3.md §3. 쿨타임·사거리·노드 스윙 카운트·도구 해금.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf, dist, nodeById } from '../server/engine/world.js';
import {
  ensurePlayer, swingCooldownMs, yieldMultiplier, toolFor, levelFromXp, grantXp, skillLevel,
} from '../server/engine/skills.js';
import { completeStructure } from '../server/engine/structures.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const S = data.skills;

function scene(seed = 5, chapter = 4) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  // ★ v3.1 — 스윙·건설 검사는 '지을 것이 있는 장'에서 돈다(해금은 진행 감독이 쥔다)
  openChapterForDebug(world, nation, data, chapter);
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '테스트');
  return { world, nation, town, rng: createRng(seed) };
}

function nearestNode(world, town, type, radius = 6) {
  return (world.map.nodes || [])
    .filter((n) => n.type === type && !n.hidden && dist(n.x, n.y, town.x, town.y) <= radius)
    .sort((a, b) => dist(a.x, a.y, town.x, town.y) - dist(b.x, b.y, town.x, town.y))[0] ?? null;
}

test('스윙 쿨타임 — 기본 1.2초, 레벨당 −3%, 하한 0.5초, 티어 보너스 곱', () => {
  const { nation } = scene();
  const p = nation.players.lord;
  assert.equal(swingCooldownMs(nation, p, 'lumber', data), 1200);
  p.skills.lumber.level = 11;                                  // −30%
  assert.equal(swingCooldownMs(nation, p, 'lumber', data), 840);
  p.skills.lumber.level = 20;                                  // −57% → 516ms
  assert.equal(swingCooldownMs(nation, p, 'lumber', data), 516);
  p.skills.lumber.level = 6;                                   // −15%
  nation.tier = 4; // 정착지 +20% 속도
  __openChapter(nation, 10);
  assert.equal(swingCooldownMs(nation, p, 'lumber', data), Math.round(1200 * 0.85 * 0.8));
});

test('쿨타임 하한 — 아무리 올려도 0.5초 아래로는 안 내려간다', () => {
  const { nation } = scene();
  const p = nation.players.lord;
  p.skills.lumber.level = 20;
  nation.tier = 20;
  __openChapter(nation, 10);
  assert.equal(swingCooldownMs(nation, p, 'lumber', data), S.swing.cooldownFloorSec * 1000);
});

test('수확 배수 — 레벨당 +5%, 도구 티어는 레벨로 열린다', () => {
  const { nation } = scene();
  const p = nation.players.lord;
  assert.equal(toolFor(nation, p, 'lumber', data).key, 'stone_axe');
  assert.ok(Math.abs(yieldMultiplier(nation, p, 'lumber', data) - 1) < 1e-9);
  p.skills.lumber.level = 5;
  assert.ok(Math.abs(yieldMultiplier(nation, p, 'lumber', data) - 1.2) < 1e-9, 'Lv5 → +20%');
  p.skills.lumber.level = 6;
  assert.equal(toolFor(nation, p, 'lumber', data).key, 'iron_axe', 'Lv6 에 철도끼');
  assert.ok(Math.abs(yieldMultiplier(nation, p, 'lumber', data) - 1.25 * 2) < 1e-9, '도구가 스윙당 획득을 2배로');
  p.skills.lumber.level = 13;
  assert.equal(toolFor(nation, p, 'lumber', data).key, 'steel_axe');
});

test('대장간 — 도구 해금이 두 레벨 일찍 열린다', () => {
  const { world, nation, town } = scene();
  const p = nation.players.lord;
  p.skills.lumber.level = 4;
  assert.equal(toolFor(nation, p, 'lumber', data).key, 'stone_axe');
  completeStructure(world, nation, { building: 'smithy', tier: 1, x: town.x + 4, y: town.y, placed: true }, data);
  assert.equal(toolFor(nation, p, 'lumber', data).key, 'iron_axe', '대장간이 있으면 Lv4에 철도끼');
});

test('XP 곡선 — Lv1에서 시작해 maxLevel 에서 멈춘다', () => {
  assert.equal(levelFromXp(0, data), 1);
  assert.equal(levelFromXp(S.xpCurve[1] - 1, data), 1);
  assert.equal(levelFromXp(S.xpCurve[1], data), 2);
  assert.equal(levelFromXp(1e9, data), S.maxLevel);
  const p = { skills: { lumber: { xp: 0, level: 1 } } };
  const r = grantXp(p, 'lumber', S.xpCurve[1], data);
  assert.ok(r.leveled);
  assert.equal(r.level, 2);
});

test('actionSwing — 서버가 쿨타임을 판정한다 (연타는 거부)', () => {
  const { world, nation, town, rng } = scene(21);
  const node = nearestNode(world, town, 'forest');
  assert.ok(node, '시작 영토에 숲이 보장된다');
  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;

  const a = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 10_000 }, data, rng);
  assert.ok(a.ok, JSON.stringify(a.error));
  assert.ok(a.gained.wood > 0);
  assert.equal(a.swings, 1);
  assert.equal(a.swingsPerCycle, S.nodes.forest.swings);

  const tooSoon = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 10_300 }, data, rng);
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.error.code, 'COOLDOWN');
  assert.ok(tooSoon.error.waitMs > 0);

  const ok2 = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 11_400 }, data, rng);
  assert.ok(ok2.ok);
  assert.equal(ok2.swings, 2);
});

test('actionSwing — 노드별 스윙 카운트가 주기를 만든다(주기 끝에 보너스)', () => {
  const { world, nation, town, rng } = scene(23);
  const node = nearestNode(world, town, 'forest');
  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;
  let now = 0;
  const results = [];
  for (let i = 0; i < S.nodes.forest.swings; i += 1) {
    results.push(applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now }, data, rng));
    now += 2000;
  }
  assert.equal(results.filter((r) => r.cycle).length, 1, '주기당 한 번만 cycle');
  assert.ok(results.at(-1).cycle, '마지막 스윙에서 주기가 닫힌다');
  assert.ok(results.at(-1).gained.wood > results[0].gained.wood, '주기 보너스가 얹힌다');
});

test('actionSwing — 사거리 밖·영토 밖·고갈은 서버가 막는다', () => {
  const { world, nation, town, rng } = scene(29);
  const node = nearestNode(world, town, 'forest');
  nation.avatars.lord.x = node.x + 20;
  nation.avatars.lord.y = node.y + 20;
  const far = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 1000 }, data, rng);
  assert.equal(far.ok, false);
  assert.equal(far.error.code, 'OUT_OF_RANGE');

  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;
  node.amount = 0;
  node.depleted = true;
  const dead = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 5000 }, data, rng);
  assert.equal(dead.ok, false);
  assert.equal(dead.error.code, 'DEPLETED');
});

test('actionSwing — 노드 잔량이 획득에 비례해 줄어든다 (무한 자원 금지)', () => {
  const { world, nation, town, rng } = scene(31);
  const node = nearestNode(world, town, 'forest');
  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;
  const before = node.amount;
  applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 1000 }, data, rng);
  const drop1 = before - node.amount;
  assert.ok(drop1 > 0);

  nation.players.lord.skills.lumber.level = 13;           // 강철도끼 — 훨씬 많이 캔다
  const mid = node.amount;
  applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 4000 }, data, rng);
  const drop2 = mid - node.amount;
  assert.ok(drop2 > drop1 * 2, '많이 캐면 그만큼 빨리 마른다');
});

test('actionSwing — 밭은 여물어야 거둔다(재배 루프)', () => {
  const { world, nation, town, rng } = scene(37);
  const node = nearestNode(world, town, 'fertile');
  assert.ok(node, '시작 영토에 기름진 땅이 보장된다');
  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;
  let now = 0;
  let last = null;
  for (let i = 0; i < S.nodes.fertile.swings; i += 1) {
    last = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now }, data, rng);
    assert.ok(last.ok, JSON.stringify(last.error));
    now += 2000;
  }
  assert.ok(node.readyAt > world.tick, '거두면 곧바로 재파종되어 다음 수확기를 기다린다');
  // ★ ack 이 재배 상태를 데리고 온다 — 화면이 일 틱을 기다리지 않고 '이제 아니다'를 알아야 한다
  assert.equal(last.harvestReady, false, '거둔 직후의 ack 은 더 이상 여물지 않았다고 알려 준다');
  assert.equal(last.readyAt, node.readyAt, '다음 수확기도 함께 온다');
  assert.ok(last.stage, '자람 단계도 함께 온다');

  const again = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: now + 5000 }, data, rng);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'NOT_READY');
  assert.equal(again.error.nodeId, node.id, '어느 자리가 아직인지 알려 준다');
  assert.equal(again.error.harvestReady, false);
});

test('actionSwing(siteId) — 건설 현장에 건설 포인트가 들어간다', () => {
  const { world, nation, town, rng } = scene(41);
  nation.resources.wood = 500;
  nation.resources.stone = 200;
  const placed = applyCommand(world, 'player', { type: 'placeBuilding', building: 'hut' }, data, rng);
  assert.ok(placed.ok, JSON.stringify(placed.error));
  const site = nation.construction[0];
  nation.avatars.lord.x = site.x;
  nation.avatars.lord.y = site.y;
  const before = site.remaining;
  const r = applyCommand(world, 'player', { type: 'actionSwing', siteId: site.id, avatarId: 'lord', now: 1000 }, data, rng);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.skill, 'build');
  assert.ok(site.remaining < before);
  assert.ok(skillLevel(nation.players.lord, 'build') >= 1);
});

test('폐지 — 하루 체감 곡선(work fatigue)과 현장 가속(workSite)은 사라졌다', () => {
  const { world, rng } = scene(43);
  assert.equal(data.balance.actionPoints.actions.work, undefined);
  const r = applyCommand(world, 'player', { type: 'workSite', siteId: 'c1' }, data, rng);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UNKNOWN_COMMAND');
});
