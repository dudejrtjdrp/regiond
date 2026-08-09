import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, migrateWorld } from '../server/engine/state.js';
import { terrainAt, terrainIndex, playerHqReserveRect } from '../server/engine/world.js';
import { syncCompanionSeats, stepCompanions } from '../server/engine/companions.js';
import { completeStructure } from '../server/engine/structures.js';

const data = loadGameData();

test('companions recover from water onto dry land', () => {
  const world = createWorld({ seed: 20260809, data, playerName: 'tester' });
  const nation = world.nations.player;
  nation.companions.awake = true;
  syncCompanionSeats(world, nation, data);
  const water = terrainIndex(data).water;
  let target = null;
  for (let y = 2; y < world.map.size - 2 && !target; y += 1) {
    for (let x = 2; x < world.map.size - 2; x += 1) {
      if (terrainAt(world.map, x, y) === water) { target = { x, y }; break; }
    }
  }
  assert.ok(target, 'test map has water');
  const bot = nation.companions.list.find((c) => c.active);
  nation.avatars[bot.id].x = target.x;
  nation.avatars[bot.id].y = target.y;
  stepCompanions(world, nation, data, 1);
  const av = nation.avatars[bot.id];
  assert.notEqual(terrainAt(world.map, Math.round(av.x), Math.round(av.y)), water);
});

test('continued saves restore the player role owner from the roster', () => {
  const world = createWorld({ seed: 7, data, playerName: 'tester' });
  const nation = world.nations.player;
  nation.roles.farm.holder = 'player';
  nation.roles.farm.owner = null;
  nation.members = [{ avatarId: 'resume-player', name: 'resume-player', role: 'farm', bot: false }];
  world.migrationRev = 0;
  migrateWorld(world, data);
  assert.equal(nation.roles.farm.owner, 'resume-player');
});

test('continued saves clear and evacuate the campfire 13×13 expansion parcel', () => {
  const world = createWorld({ seed: 93, data, playerName: 'tester' });
  const nation = world.nations.player;
  const town = world.map.towns.find((t) => t.isPlayer);
  const reserve = playerHqReserveRect(town, data);
  const x = reserve.x0, y = reserve.y0;
  const chars = world.map.terrain.split('');
  chars[y * world.map.size + x] = String.fromCharCode(48 + terrainIndex(data).water);
  world.map.terrain = chars.join('');
  world.map.nodes.push({ id: 'inside-reserve', type: 'tree', x, y, hidden: false });
  completeStructure(world, nation, { building: 'hut', tier: 1, x, y, placed: true }, data);
  nation.avatars.lord = { id: 'lord', x, y };
  nation.villagers.push({ id: 'inside-villager', x, y });
  world.migrationRev = 0;

  migrateWorld(world, data);

  assert.equal(world.map.nodes.some((n) => n.id === 'inside-reserve'), false);
  assert.equal(nation.structures.some((s) => s.key === 'hut' && s.x === x && s.y === y), false);
  assert.notEqual(terrainAt(world.map, x, y), terrainIndex(data).water);
  for (const person of [nation.avatars.lord, nation.villagers.at(-1)]) {
    assert.equal(person.x >= reserve.x0 && person.x <= reserve.x1 && person.y >= reserve.y0 && person.y <= reserve.y1, false);
    assert.notEqual(terrainAt(world.map, person.x, person.y), terrainIndex(data).water);
  }
});
