// 생태계·도감 — docs/GDD3.md §13-C. 상시 생태 · 울타리 차단 · 사냥 · 도감 카운트.
//
// 이 파일이 지키는 계약:
//   ① 링마다 사는 것이 다르다 — 링0 은 온순한 짐승만, 사나운 것은 그 밖에서만 태어난다
//   ② **울타리 안으로는 못 들어온다** — 경로 탐색 없이, 살아 있는 조각을 가로지르는 걸음이 무효다
//   ③ 사냥은 전투 스윙 하나로 돌고, 쓰러뜨리면 드롭이 곳간에 들어간다(곳간 상한도 그대로 걸린다)
//   ④ 도감의 조우·처치 수는 **서버가** 센다. 층이 열리기 전에는 그 필드가 아예 없다
//   ⑤ 생태계는 월드 난수를 축내지 않는다 — 축내면 같은 씨앗으로 잰 밸런스가 통째로 어긋난다
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, dist, ringAt, ringRadii } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { step } from '../server/engine/tick.js';
import {
  ensureCreatures, stepEcology, crossesFence, segmentsCross, creatureViews, huntYield, ensureWild,
} from '../server/engine/ecology.js';
import { codexView, recordKill, recordEncounter } from '../server/engine/codex.js';

const data = loadGameData();
const DEFS = data.creatures.defs;

function scene(seed = 5, chapter = 4) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, chapter);
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '테스트');
  return { world, nation, town, rng: createRng(seed) };
}

// ────────────────────────────────────────────────────────────────
// ① 스폰 링 규칙
// ────────────────────────────────────────────────────────────────
test('★ §13-B-5 링 스폰 — 링0(영토+근교)에는 온순한 짐승만 산다', () => {
  const { world, nation } = scene(41);
  ensureCreatures(world, nation, data);
  const list = nation.wild.creatures;
  assert.ok(list.length > 0, '들에 무언가 산다');
  for (const c of list) {
    const def = DEFS[c.sp];
    assert.equal(def.ring, c.ring, '태어난 띠와 종의 띠가 같다');
    if (c.ring === 0) assert.equal(def.kind, 'animal', `${def.name}은(는) 링0 에 살 수 없다`);
  }
  const ring0 = list.filter((c) => c.ring === 0);
  assert.ok(ring0.length > 0, '근교에도 짐승이 있다');
  assert.equal(ring0.every((c) => DEFS[c.sp].kind === 'animal'), true);
});

test('★ §13-B-5 링 스폰 — 사나운 것은 태어난 자리부터 링1 밖이다', () => {
  const { world, nation, town } = scene(43);
  ensureCreatures(world, nation, data);
  const { r0 } = ringRadii(nation, data);
  for (const c of nation.wild.creatures) {
    if (DEFS[c.sp].kind !== 'predator') continue;
    assert.ok(dist(c.x, c.y, town.x, town.y) > r0 - 0.001,
      `${DEFS[c.sp].name}이(가) 근교(${r0.toFixed(1)}타일) 안에서 태어났다`);
    assert.ok(ringAt(world, nation, c.x, c.y, data) >= 1);
  }
});

test('★ §13-C 스폰 — 아바타 코앞에서 솟아나지 않는다', () => {
  const { world, nation } = scene(47);
  ensureCreatures(world, nation, data);
  const min = data.creatures.spawn.minSpawnDistance;
  const av = nation.avatars.lord;
  for (const c of nation.wild.creatures) {
    assert.ok(dist(c.x, c.y, av.x, av.y) >= min - 0.001, '눈앞에서 태어나지 않는다');
  }
});

// ────────────────────────────────────────────────────────────────
// ② 울타리 차단
// ────────────────────────────────────────────────────────────────
test('선분 교차 — 스치는 끝점은 교차로 치지 않는다', () => {
  assert.equal(segmentsCross(0, 0, 4, 4, 0, 4, 4, 0), true, '×자로 만나면 교차다');
  assert.equal(segmentsCross(0, 0, 1, 0, 2, 0, 3, 0), false, '한 줄로 늘어선 것은 아니다');
  assert.equal(segmentsCross(0, 0, 2, 0, 1, 0, 1, 2), false, '끝점이 닿기만 한 것은 아니다');
});

test('★ §13-C-2 울타리 차단 — 살아 있는 조각을 가로지르는 걸음은 무효다', () => {
  const { world, nation } = scene(53);
  nation.fences = [{ id: 'f1', x1: 10, y1: 8, x2: 10, y2: 12, hp: 60, maxHp: 60, tier: 1, gate: false }];
  assert.equal(crossesFence(nation, 8, 10, 12, 10), true, '울타리를 뚫고 지날 수 없다');
  assert.equal(crossesFence(nation, 8, 10, 9, 10), false, '앞까지는 갈 수 있다');
  // 문(gate)도 짐승은 못 연다
  nation.fences[0].gate = true;
  assert.equal(crossesFence(nation, 8, 10, 12, 10), true, '문도 짐승에게는 벽이다');
  // 부서진 조각은 막지 못한다 — 웨이브가 헐고 간 밤에는 여우도 들어온다
  nation.fences[0].hp = 0;
  assert.equal(crossesFence(nation, 8, 10, 12, 10), false);
});

test('★ §13-C-2 울타리 안 — 짐승이 담을 넘어 들어오지 않는다 (열 걸음을 지켜본다)', () => {
  const { world, nation, town } = scene(59);
  // 본부를 둘러싼 네모 울타리
  const R = 5;
  const c = [
    [town.x - R, town.y - R, town.x + R, town.y - R],
    [town.x + R, town.y - R, town.x + R, town.y + R],
    [town.x + R, town.y + R, town.x - R, town.y + R],
    [town.x - R, town.y + R, town.x - R, town.y - R],
  ];
  nation.fences = c.map((s, i) => ({ id: `f${i}`, x1: s[0], y1: s[1], x2: s[2], y2: s[3], hp: 60, maxHp: 60, tier: 1, gate: false }));
  // 울타리 바로 밖에 굶주린 늑대를 하나 세우고, 아바타를 울타리 한복판에 둔다
  ensureWild(nation);
  nation.wild.creatures = [{
    id: 'w1', sp: 'wolf', x: town.x, y: town.y - R - 2, tx: town.x, ty: town.y,
    hp: 34, maxHp: 34, ring: 1, state: 'chase', retarget: 0, atkCd: 0, provoked: 60, seen: true,
  }];
  nation.avatars.lord.x = town.x;
  nation.avatars.lord.y = town.y;
  const inside = (p) => Math.abs(p.x - town.x) < R && Math.abs(p.y - town.y) < R;
  for (let i = 0; i < 10; i += 1) stepEcology(world, nation, data, 1);
  assert.equal(inside(nation.wild.creatures[0]), false, '열 걸음을 걸어도 담 안으로는 못 들어온다');
  assert.equal(nation.players.lord.hp, nation.players.lord.maxHp, '울타리 안 사람은 물리지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ③ 사냥
// ────────────────────────────────────────────────────────────────
test('★ §13-C-8 사냥 — 전투 스윙으로 잡으면 드롭이 곳간에 들어온다', () => {
  const { world, nation, town, rng } = scene(61);
  ensureWild(nation);
  nation.wild.creatures = [{
    id: 'w1', sp: 'deer', x: town.x + 1, y: town.y, tx: town.x + 1, ty: town.y,
    hp: 22, maxHp: 22, ring: 1, state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
  }];
  const before = { ...nation.resources };
  let now = 1000;
  let res = null;
  for (let i = 0; i < 20; i += 1) {
    res = applyCommand(world, 'player', { type: 'combatSwing', targetId: 'w1', avatarId: 'lord', now }, data, rng);
    now += 2500;
    if (res.ok && res.killed) break;
  }
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.equal(res.killed, true, '사슴이 쓰러진다');
  assert.equal(res.hunt, true, '웨이브가 아니라 사냥이다');
  assert.ok(res.gained.meat > 0, '고기가 나온다');
  assert.ok(nation.resources.meat > (before.meat || 0));
  assert.ok(nation.resources.hide > (before.hide || 0), '가죽도 나온다');
  assert.equal(nation.wild.creatures.length, 0, '잡힌 놈은 들에서 사라진다');
  assert.equal(nation.codex.species.deer.kills, 1, '도감의 처치 수가 오른다');
});

test('★ §13-C-8 사냥 — 사거리 밖은 서버가 막는다', () => {
  const { world, nation, town, rng } = scene(63);
  ensureWild(nation);
  nation.wild.creatures = [{
    id: 'w1', sp: 'rabbit', x: town.x + 30, y: town.y, tx: town.x + 30, ty: town.y,
    hp: 7, maxHp: 7, ring: 0, state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
  }];
  const r = applyCommand(world, 'player', { type: 'combatSwing', targetId: 'w1', avatarId: 'lord', now: 1000 }, data, rng);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'OUT_OF_RANGE');
});

test('★ §13-C-2 반격 — 때리면 덤빈다', () => {
  const { world, nation, town, rng } = scene(67);
  ensureWild(nation);
  nation.wild.creatures = [{
    id: 'w1', sp: 'boar', x: town.x + 1, y: town.y, tx: town.x + 1, ty: town.y,
    hp: 46, maxHp: 46, ring: 1, state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
  }];
  const r = applyCommand(world, 'player', { type: 'combatSwing', targetId: 'w1', avatarId: 'lord', now: 1000 }, data, rng);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(nation.wild.creatures[0].provoked > 0, '맞은 놈은 성이 난다');
  // 성난 멧돼지가 사람을 문다 — 죽지는 않는다
  const hp0 = nation.players.lord.hp;
  for (let i = 0; i < 6; i += 1) stepEcology(world, nation, data, 1);
  assert.ok(nation.players.lord.hp < hp0, '가만히 있으면 물린다');
});

test('★ §13-C-2 다운 — 죽지 않는다. 모닥불 자리에서 일어난다', () => {
  const { world, nation, town } = scene(71);
  ensureWild(nation);
  nation.avatars.lord.x = town.x + 20;
  nation.avatars.lord.y = town.y + 20;
  nation.wild.creatures = [{
    id: 'w1', sp: 'bear', x: town.x + 20, y: town.y + 20, tx: 0, ty: 0,
    hp: 110, maxHp: 110, ring: 2, state: 'chase', retarget: 0, atkCd: 0, provoked: 99, seen: true,
  }];
  const events = [];
  for (let i = 0; i < 40 && (nation.players.lord.downUntil || 0) <= 0; i += 1) {
    events.push(...stepEcology(world, nation, data, 1).events);
  }
  assert.ok((nation.players.lord.downUntil || 0) > 0, '체력이 다하면 쓰러진다');
  assert.equal(nation.avatars.lord.x, town.x, '모닥불 자리로 옮겨진다');
  assert.equal(nation.avatars.lord.y, town.y);
  assert.ok(events.some((e) => e.kind === 'player_down'));
  // downSeconds 가 지나면 다시 선다
  for (let i = 0; i < data.skills.combat.downSeconds + 2; i += 1) stepEcology(world, nation, data, 1);
  assert.equal(nation.players.lord.downUntil, 0, '다시 일어선다');
  assert.equal(nation.players.lord.hp, nation.players.lord.maxHp, '체력이 돌아온다');
});

// ────────────────────────────────────────────────────────────────
// ④ 도감
// ────────────────────────────────────────────────────────────────
test('★ §13-C-3 도감 — 층이 열리기 전에는 그 필드가 아예 없다', () => {
  const { nation } = scene(73);
  const th = data.creatures.codex;
  let v = codexView(nation, data);
  const card = () => codexView(nation, data).species.find((s) => s.key === 'rabbit');

  assert.equal(v.species.length, data.creatures.order.length);
  assert.equal(card().known, false);
  assert.equal(card().name, undefined, '조우 0 이면 이름조차 없다(실루엣)');
  assert.equal(card().stats, undefined);
  assert.equal(card().lore, undefined);
  assert.equal(card().next.what, 'name');

  recordEncounter(nation, 'rabbit', 1);
  assert.equal(card().known, true);
  assert.equal(card().name, DEFS.rabbit.name, '한 번 마주치면 이름이 열린다');
  assert.ok(card().habitat, '사는 곳도 열린다');
  assert.equal(card().stats, undefined, '아직 능력치는 아니다');
  assert.equal(card().next.what, 'stats');

  for (let i = 0; i < th.statsAt; i += 1) recordKill(nation, 'rabbit', 2);
  assert.ok(card().stats, `${th.statsAt}을 잡으면 능력치가 열린다`);
  assert.ok(card().drops.length > 0, '드롭표도 열린다');
  assert.equal(card().lore, undefined);
  assert.equal(card().next.what, 'lore');

  for (let i = card().kills; i < th.loreAt; i += 1) recordKill(nation, 'rabbit', 3);
  assert.ok(card().lore, `${th.loreAt}을 잡으면 일화가 열린다`);
  assert.equal(card().next, null, '더 열릴 것이 없다');
});

test('★ §13-C-3 도감 — 마주치면 조우 수가 오른다 (같은 개체는 한 번만)', () => {
  const { world, nation, town } = scene(79);
  ensureWild(nation);
  nation.avatars.lord.x = town.x;
  nation.avatars.lord.y = town.y;
  nation.wild.creatures = [{
    id: 'w1', sp: 'chicken', x: town.x + 1, y: town.y, tx: town.x + 1, ty: town.y,
    hp: 8, maxHp: 8, ring: 0, state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
  }];
  stepEcology(world, nation, data, 1);
  assert.equal(nation.codex.species.chicken.encounters, 1, '눈에 들면 도감에 적힌다');
  for (let i = 0; i < 5; i += 1) stepEcology(world, nation, data, 1);
  assert.equal(nation.codex.species.chicken.encounters, 1, '같은 놈을 계속 봐도 한 번이다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 결정론 · 사냥꾼 오두막 · 식량
// ────────────────────────────────────────────────────────────────
test('★ 생태계는 월드 난수를 축내지 않는다 (같은 씨앗의 밸런스를 지킨다)', () => {
  const { world, nation } = scene(83);
  const before = world.rngState;
  ensureCreatures(world, nation, data);
  stepEcology(world, nation, data, 5);
  assert.equal(world.rngState, before, '들의 일은 세계의 난수를 건드리지 않는다');
  assert.ok(nation.wild.rngState != null, '생태계는 제 난수 상태를 따로 들고 산다');
});

test('★ §13-C-8 사냥꾼 오두막 — 짐승이 남아 있는 만큼만 난다', () => {
  const { world, nation } = scene(89, 7);
  const none = huntYield(world, nation, data);
  assert.equal(none.huts, 0, '오두막이 없으면 아무것도 안 난다');
  assert.deepEqual(none.resources, {});
});

test('★ §13-C-1 고기 — 곡물이 떨어지면 사람을 먹인다 (고기 1 = 곡물 3)', () => {
  const { world, nation } = scene(97, 5);
  nation.villagers = [];
  nation.population = 6;
  nation.resources.grain = 0;
  nation.resources.meat = 10;
  const out = step(world, [], null, data);
  const after = out.state.nations.player;
  assert.equal(after.rationing, false, '고기가 있으면 굶지 않는다');
  const eaten = 10 - after.resources.meat;
  assert.ok(eaten > 0, '고기가 줄어든다');
  assert.ok(Math.abs(eaten * data.resources.meta.meat.foodValue - 6) < 0.05,
    `고기 ${eaten} × ${data.resources.meta.meat.foodValue} = 사람 6명분`);
});

test('★ §13-C 화면에 실리는 것 — 눈이 닿는 데까지만', () => {
  const { world, nation, town } = scene(101);
  ensureWild(nation);
  nation.wild.creatures = [
    { id: 'w1', sp: 'chicken', x: town.x + 2, y: town.y, hp: 8, maxHp: 8, ring: 0, state: 'wander' },
    { id: 'w2', sp: 'wolf', x: town.x + 200, y: town.y, hp: 34, maxHp: 34, ring: 1, state: 'wander' },
  ];
  const views = creatureViews(world, nation, data);
  assert.equal(views.length, 1, '멀리 있는 것은 실리지 않는다');
  assert.equal(views[0].id, 'w1');
  assert.equal(views[0].name, DEFS.chicken.name);
});
