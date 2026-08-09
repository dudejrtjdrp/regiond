// Sprint 1 — 크리티컬 버그 8건의 회귀 (§18 예정 배치의 선행 수리).
//
// 이 파일이 지키는 계약:
//   ① 사람의 통행 정본은 server/engine/path.js 하나다 — 물은 못 밟고, 다리·매립 위 물은 길이다
//   ② 주민 걸음(stepVillagers)은 어떤 목적지를 받아도 **물 위에 서지 않는다** (§17-4 의 주민 판)
//   ③ 새 주민은 물 위에서 태어나지 않는다
//   ④ 쓰러져 있는 동안 lordMove 는 거부된다 — 부활 좌표(모닥불)를 죽은 자리로 되덮지 못한다
//   ⑤ 화면 길찾기(public/js/path.js)는 물을 돌아가고, 모서리를 끊어 걷지 않고,
//      못 가는 곳이면 「갈 수 있는 데까지」의 길을 돌려준다(제자리 무한 걸음 금지)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadGameData } from '../server/engine/data.js';
import { disableCompanions } from '../server/engine/companions.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf, terrainNameAt } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { walkableFor, nearestWalkable, findPath, advanceAlong, structureBlocks, respawnSpot } from '../server/engine/path.js';
import { completeStructure, footprint } from '../server/engine/structures.js';
import { stepVillagers } from '../server/engine/villagers.js';
import { spawnResident } from '../server/engine/residents.js';

const data = loadGameData();
disableCompanions(data);

function scene(seed = 7) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '테스트');
  return { world, nation, town, rng: createRng(seed) };
}

function findWater(world, town, maxR = 120) {
  const size = world.map.size;
  for (let r = 2; r <= maxR; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = town.x + dx;
        const y = town.y + dy;
        if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
        if (terrainNameAt(world.map, x, y, data) === 'water') return { x, y };
      }
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// ① 통행 정본
// ────────────────────────────────────────────────────────────────
test('Sprint1 ① walkableFor — 건물과 물은 못 밟고, 뭍은 밟는다', () => {
  const { world, nation, town } = scene(7);
  assert.equal(walkableFor(world, nation, data, town.x, town.y), false, '정착지 본부가 이동을 막지 않는다');
  const w = findWater(world, town);
  assert.ok(w, '이 씨앗의 맵에 물이 없다 — 씨앗을 바꿔야 한다');
  assert.equal(walkableFor(world, nation, data, w.x, w.y), false, '물을 밟았다');
});

test('Sprint1 ① nearestWalkable — 물 한복판을 줘도 곁의 뭍을 돌려준다', () => {
  const { world, nation, town } = scene(7);
  const w = findWater(world, town);
  const spot = nearestWalkable(world, nation, data, w.x, w.y, 24);
  assert.ok(spot, '물 곁에 뭍이 없다');
  assert.equal(walkableFor(world, nation, data, spot.x, spot.y), true);
});

test('Sprint1 ① findPath — 웨이포인트는 전부 밟을 수 있는 칸이고 이웃끼리 이어져 있다', () => {
  const { world, nation, town } = scene(7);
  const w = findWater(world, town);
  const goal = nearestWalkable(world, nation, data, w.x, w.y, 24);
  const start = nearestWalkable(world, nation, data, town.x, town.y, 8);
  assert.ok(start, '본부 밖에 출발할 뭍이 없다');
  const path = findPath(world, nation, data, start.x, start.y, goal.x, goal.y);
  assert.ok(path && path.length >= 2, '길이 없다');
  for (let i = 0; i < path.length; i += 1) {
    assert.equal(walkableFor(world, nation, data, path[i].x, path[i].y), true,
      `웨이포인트 ${i} (${path[i].x},${path[i].y}) 가 물이다`);
    if (i > 0) {
      assert.ok(Math.max(Math.abs(path[i].x - path[i - 1].x), Math.abs(path[i].y - path[i - 1].y)) <= 1,
        '웨이포인트가 한 칸 넘게 건너뛴다');
    }
  }
  assert.equal(path[path.length - 1].x, goal.x);
  assert.equal(path[path.length - 1].y, goal.y);
});

// ────────────────────────────────────────────────────────────────
// ② 주민 걸음 — 물 위에 서지 않는다
// ────────────────────────────────────────────────────────────────
test('Sprint1 ② stepVillagers — 목적지가 물이어도 어느 틱에도 물 위에 서지 않는다', () => {
  const { world, nation, town } = scene(7);
  const w = findWater(world, town);
  nation.villagers = [{
    id: 'r1', job: 'idle', targetId: null,
    x: town.x, y: town.y, destX: w.x, destY: w.y,
  }];
  for (let t = 0; t < 40; t += 1) {
    stepVillagers(world, nation, data, t);
    const u = nation.villagers[0];
    assert.equal(walkableFor(world, nation, data, u.x, u.y), true,
      `틱 ${t}: 주민이 물 위(${u.x},${u.y})에 섰다`);
  }
});

test('Sprint1 ② stepVillagers — 먼 뭍 목적지도 물을 돌아 결국 닿는다(제자리 무한 걸음 금지)', () => {
  const { world, nation, town } = scene(7);
  const w = findWater(world, town);
  const goal = nearestWalkable(world, nation, data, w.x, w.y, 24);
  nation.villagers = [{
    id: 'r1', job: 'idle', targetId: null,
    x: town.x, y: town.y, destX: goal.x, destY: goal.y,
  }];
  let arrived = false;
  for (let t = 0; t < 60 && !arrived; t += 1) {
    stepVillagers(world, nation, data, t);
    const u = nation.villagers[0];
    assert.equal(walkableFor(world, nation, data, u.x, u.y), true, `틱 ${t}: 물 위에 섰다`);
    arrived = u.x === goal.x && u.y === goal.y;
  }
  assert.equal(arrived, true, '60틱이 지나도 목적지에 닿지 못했다');
});

test('Sprint1 ② advanceAlong — 한 걸음의 결과도 항상 뭍이다', () => {
  const { world, nation, town } = scene(7);
  const w = findWater(world, town);
  const next = advanceAlong(world, nation, data, town.x, town.y, w.x, w.y, 12);
  assert.equal(walkableFor(world, nation, data, next.x, next.y), true);
});

// ────────────────────────────────────────────────────────────────
// ③ 스폰 — 물에서 태어나지 않는다
// ────────────────────────────────────────────────────────────────
test('Sprint1 ③ spawnResident — 서른 명을 들여도 물 위 출생은 없다', () => {
  const { world, nation, rng } = scene(11);
  for (let i = 0; i < 30; i += 1) {
    const r = spawnResident(world, nation, data, rng);
    assert.equal(walkableFor(world, nation, data, r.x, r.y), true,
      `${r.name} 이(가) 물 위(${r.x},${r.y})에서 태어났다`);
  }
});

// ────────────────────────────────────────────────────────────────
// ④ 쓰러짐 — lordMove 거부
// ────────────────────────────────────────────────────────────────
test('Sprint1 ④ lordMove — 쓰러져 있는 동안에는 거부되고, 일어나면 다시 받는다', () => {
  const { world, nation, town, rng } = scene(7);
  nation.players.lord.downUntil = 5;
  const denied = applyCommand(world, 'player',
    { type: 'lordMove', avatarId: 'lord', playerName: '테스트', x: town.x + 3, y: town.y }, data, rng);
  assert.equal(denied.ok, false, '쓰러진 몸이 걸었다');
  assert.equal(denied.error.code, 'DOWNED');
  assert.equal(nation.avatars.lord.x, town.x, '거부됐는데 좌표가 움직였다');

  nation.players.lord.downUntil = 0;
  const okRes = applyCommand(world, 'player',
    { type: 'lordMove', avatarId: 'lord', playerName: '테스트', x: town.x + 3, y: town.y }, data, rng);
  assert.equal(okRes.ok, true, '일어났는데도 걷지 못한다');
  assert.equal(nation.avatars.lord.x, town.x + 3);
});

// ────────────────────────────────────────────────────────────────
// ⑤ 화면 길찾기 (public/js/path.js) — 합성 격자로 잰다
// ────────────────────────────────────────────────────────────────
test('building footprint blocks paths and lordMove on every occupied cell', () => {
  const { world, nation, town, rng } = scene(31);
  const x = town.x + 6;
  const y = town.y + 6;
  const s = completeStructure(world, nation, { building: 'hut', tier: 1, x, y, placed: true }, data);
  assert.ok(s, 'test building was placed');
  const denied = applyCommand(world, 'player',
    { type: 'lordMove', avatarId: 'lord', x: x + 1, y: y + 1 }, data, rng);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'STRUCTURE_BLOCKED');
  assert.equal(nation.avatars.lord.x, town.x, 'server keeps the last valid position');
});

test('upgraded settlement HQ expands its blocking footprint', () => {
  const { world, nation, town, rng } = scene(37);
  const hq = nation.structures.find((s) => s.key === 'campfire');
  hq.tier = 6;
  const f = footprint('campfire', data, hq.tier);
  const x = hq.x + f.w - 1;
  const y = hq.y + f.h - 1;

  assert.deepEqual([f.w, f.h], [11, 9]);
  assert.equal(structureBlocks(nation, data, x, y), true, 'final HQ footprint is blocked');
  const denied = applyCommand(world, 'player', { type: 'lordMove', avatarId: 'lord', x, y }, data, rng);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'STRUCTURE_BLOCKED');
  assert.equal(nation.avatars.lord.x, town.x, 'HQ collision keeps the previous position');
});

test('respawn appears in front of the upgraded settlement HQ', () => {
  const { world, nation } = scene(41);
  const hq = nation.structures.find((s) => s.key === 'campfire');
  hq.tier = 6;
  const f = footprint(hq.key, data, hq.tier);
  const at = respawnSpot(world, nation, data);

  assert.ok(at, 'a respawn spot exists');
  assert.equal(at.y >= hq.y + f.h, true, 'respawn is below the HQ footprint');
  assert.equal(structureBlocks(nation, data, at.x, at.y), false, 'respawn is not inside the HQ');
  assert.equal(walkableFor(world, nation, data, at.x, at.y), true, 'respawn is walkable');
});

function clientPath() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync('public/js/path.js', 'utf8'), ctx);
  return ctx.window.GM.path;
}

/** 웨이포인트 사이 직선을 촘촘히 밟아 본다 — 걷기 연출이 실제로 지나는 자취다 */
function assertPolylineDry(path, walk) {
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
    for (let k = 0; k <= n; k += 1) {
      const t = k / n;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      assert.equal(walk(x, y), true, `자취 (${x},${y}) 가 물을 지난다`);
    }
  }
}

test('Sprint1 ⑤ 화면 A* — 물줄기를 돌아가고 모든 웨이포인트가 뭍이다', () => {
  const P = clientPath();
  /* x=10 세로 물줄기, y=18 에만 여울(틈) */
  const wet = (x, y) => x === 10 && y !== 18;
  const walk = (x, y) => x >= 0 && y >= 0 && x < 40 && y < 40 && !wet(x, y);
  const path = P.find(4, 4, 16, 4, walk, { size: 40 });
  assert.ok(path && path.length >= 2, '길이 없다');
  for (const p of path) assert.equal(walk(p.x, p.y), true, `웨이포인트 (${p.x},${p.y}) 가 물이다`);
  const end = path[path.length - 1];
  assert.equal(end.x, 16);
  assert.equal(end.y, 4);
  /* 여울(10,18)로만 건널 수 있다 — 걷는 자취 전체가 마른 땅이어야 한다 */
  assertPolylineDry(path, walk);
});

test('Sprint1 ⑤ 화면 A* — 목표가 물이면 곁의 뭍으로 스냅한다', () => {
  const P = clientPath();
  const wet = (x, y) => x >= 12 && x <= 20 && y >= 12 && y <= 20;
  const walk = (x, y) => x >= 0 && y >= 0 && x < 40 && y < 40 && !wet(x, y);
  const path = P.find(4, 16, 16, 16, walk, { size: 40 });     // 호수 한복판을 찍었다
  assert.ok(path && path.length >= 2);
  const end = path[path.length - 1];
  assert.equal(walk(end.x, end.y), true, '끝점이 물이다');
  assert.ok(Math.abs(end.x - 16) + Math.abs(end.y - 16) <= 10, '스냅이 호숫가가 아니라 엉뚱한 데다');
});

test('Sprint1 ⑤ 화면 A* — 아예 못 가는 섬이면 「갈 수 있는 데까지」의 길이다', () => {
  const P = clientPath();
  /* 목표를 사방 물로 봉한다 */
  const wet = (x, y) => Math.max(Math.abs(x - 30), Math.abs(y - 30)) === 3;
  const walk = (x, y) => x >= 0 && y >= 0 && x < 60 && y < 60 && !wet(x, y);
  const path = P.find(4, 30, 30, 30, walk, { size: 60 });
  if (path) {
    for (const p of path) assert.equal(walk(p.x, p.y), true, '봉쇄를 뚫었다');
    const end = path[path.length - 1];
    assert.ok(Math.max(Math.abs(end.x - 30), Math.abs(end.y - 30)) > 3, '섬 안에 들어갔다');
  }
});

test('Sprint1 ⑤ 화면 A* — 대각선은 모서리를 끊어 걷지 않는다', () => {
  const P = clientPath();
  /* (5,5) 만 물 — (4,4)→(6,6) 대각선 지름길은 (5,4)·(4,5) 가 뚫려 있어도
     (5,5) 모서리를 스치면 안 된다 → 길은 격자 이웃으로만 이어진다 */
  const walk = (x, y) => x >= 0 && y >= 0 && x < 20 && y < 20 && !(x === 5 && y === 5);
  const path = P.find(4, 4, 6, 6, walk, { size: 20 });
  assert.ok(path && path.length >= 2);
  for (const p of path) assert.equal(walk(p.x, p.y), true);
  assertPolylineDry(path, walk);
});
