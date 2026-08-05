// 어로(물가 스윙) — docs/GDD3.md §2·§3 · data/skills.json nodes.water.
// ★ 회귀 방지: config.skills.defs.farm.nodeTypes 에 'water' 가 있는데 config.skills.nodes 에
//   water 항목이 없어, 물가를 치면 NOT_WORKABLE 로 튕겼다(계약 불일치). 이제 규격이 있다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf, dist } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { swingPreview } from '../server/engine/actions.js';
import { stepNodes } from '../server/engine/villagers.js';

const data = loadGameData();
const SPEC = data.skills.nodes.water;

/** 물가는 지형 따라 나므로 시작 영토 안에 있다는 보장이 없다 —
 *  물가가 하나라도 잡힐 때까지 티어(=영토 반경)를 올려 가며 장면을 만든다. */
function waterScene(seed = 5) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '테스트');
  for (const tier of [0, 1, 2, 3, 4, 5, 6, 10, 20]) {
    nation.tier = tier;
    const r = data.tiers.levels.find((l) => l.tier === Math.min(tier, 6))?.radius ?? 6;
    const node = (world.map.nodes || [])
      .filter((n) => n.type === 'water' && dist(n.x, n.y, town.x, town.y) <= r)
      .sort((a, b) => dist(a.x, a.y, town.x, town.y) - dist(b.x, b.y, town.x, town.y))[0];
    if (node) {
      nation.avatars.lord.x = node.x;
      nation.avatars.lord.y = node.y;
      return { world, nation, town, node, rng: createRng(seed) };
    }
  }
  return null;
}

const swing = (world, node, rng, now) =>
  applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now }, data, rng);

test('규격 정합 — farm 이 맡는 노드는 전부 스윙 규격이 있다', () => {
  for (const [skill, def] of Object.entries(data.skills.defs)) {
    for (const type of def.nodeTypes || []) {
      const spec = data.skills.nodes[type];
      assert.ok(spec, `${skill} 이(가) 맡는 ${type} 에 스윙 규격이 있다`);
      assert.equal(spec.skill, skill, `${type} 의 스킬이 ${skill} 로 맞다`);
      assert.ok(data.world.nodes.types[type], `${type} 는 실제 월드 노드다`);
    }
  }
});

test('어로 — 물가를 치면 식량이 들어온다 (여물기를 기다리지 않는다)', () => {
  const sc = waterScene();
  assert.ok(sc, '물가가 있는 장면을 만들었다');
  const { world, nation, node, rng } = sc;

  assert.equal(node.max > 0, true, '물목에 물고기가 들어 있다');
  const r = swing(world, node, rng, 1000);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.skill, 'farm');
  assert.equal(r.swingsPerCycle, SPEC.swings);
  assert.ok(r.gained.meat > 0, '고기가 들어온다');   // ★ §17-5 — 물고기는 고기다
  assert.ok(node.amount < node.max, '물고기가 줄어든다');
  assert.equal(nation.players.lord.skills.farm.xp > 0, true, '농사 솜씨로 쌓인다');
});

test('어로 — 한 주기를 끝내면 큰 몫이 터진다', () => {
  const sc = waterScene(17);
  assert.ok(sc);
  const { world, nation, node, rng } = sc;
  let now = 0;
  let total = 0;
  for (let i = 0; i < SPEC.swings; i += 1) {
    const r = swing(world, node, rng, now);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    total += r.gained.meat ?? 0;
    assert.equal(r.cycle, i === SPEC.swings - 1);
    now += 2000;
  }
  const perCycle = SPEC.yield.meat * SPEC.swings + SPEC.cycleBonus.meat;
  assert.ok(Math.abs(total - perCycle) < 0.01, `한 주기 ${total} = ${perCycle}`);
  assert.ok((nation.resources.meat ?? 0) >= (data.balance.startingResources.meat ?? 0) + perCycle - 0.01);
});

test('어로 — 물목은 바닥나고 며칠에 걸쳐 다시 몰려온다 (무한 식량 금지)', () => {
  const sc = waterScene(23);
  assert.ok(sc);
  const { world, node, rng } = sc;
  let now = 0;
  for (let i = 0; i < 200 && !node.depleted; i += 1) {
    swing(world, node, rng, now);
    now += 2000;
  }
  assert.equal(node.depleted, true, '훑으면 바닥이 난다');
  const dry = swing(world, node, rng, now + 5000);
  assert.equal(dry.ok, false);
  assert.equal(dry.error.code, 'DEPLETED');

  stepNodes(world, data, world.tick + 1);
  assert.ok(node.amount > 0, '하루 지나면 다시 몰려온다');
  assert.equal(node.depleted, false);
  assert.ok(node.amount <= node.max, '물목 크기를 넘지 않는다');
});

test('어로 — 스윙 미리보기 표에 물가가 들어 있다 (클라 표시 계약)', () => {
  const sc = waterScene(29);
  assert.ok(sc);
  const { nation } = sc;
  const pv = swingPreview(nation, 'lord', data);
  assert.ok(pv.targets.water, '물가 항목이 있다');
  assert.equal(pv.targets.water.skill, 'farm');
  assert.equal(pv.targets.water.swings, SPEC.swings);
  assert.deepEqual(pv.targets.water.yield, SPEC.yield);
  assert.equal(pv.targets._note, undefined, '자료 파일의 설명문은 규약에 실리지 않는다');
});

test('맨손 시작 — 목재 0 으로 내리고, 나무 한 그루가 곧 천막 한 채다 (GDD3 §2)', () => {
  assert.equal(data.balance.startingResources.wood, 0, '마차에서 내릴 때 목재는 없다');

  const world = createWorld({ seed: 5, data, playerName: '테스트' });
  const nation = world.nations.player;
  assert.equal(nation.resources.wood, 0);
  // 모닥불은 이미 피워져 있다 — 그래서 첫 목재는 오직 도끼질로만 생긴다
  assert.ok((nation.structures || []).some((s) => s.key === 'campfire'), '모닥불 하나로 시작한다');

  const forest = data.skills.nodes.forest;
  const oneTree = forest.yield.wood * forest.swings + forest.cycleBonus.wood;
  const tent = data.buildings.tent.tiers[0].cost.wood;
  assert.ok(oneTree >= tent, `한 그루(${oneTree}) 로 천막(${tent}) 이 선다`);
  assert.ok(oneTree < tent * 2, '한 그루로 두 채가 서지는 않는다 — 첫 목표가 헐거워지지 않게');
});
