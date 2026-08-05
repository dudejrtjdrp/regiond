// §16 플레이테스트 5차 피드백 회귀 — 스폰 링 밀착 · 영토 성역 · 타겟팅 괄호 · 집사(건설·모집·사냥)
//
// 이 파일이 붙드는 문장은 넷이다.
//   ① 사나운 것은 제 띠(ring)에 매여 산다 — 떠돌다 정착지 곁에 눌러앉지 않는다(§16-1).
//   ② **영토는 성역이다** — 짐승이 설 수 없는 땅 안의 사람은 쫓기지도 물리지도 않는다(§16-2).
//      (웨이브는 별개 계층이다 — 그쪽은 설계대로 문을 부수고 들어온다.)
//   ③ 스윙 사거리는 「지금」과 「직전 스텝」의 괄호로 잰다 — 화면이 그린 놈을 겨눈 스윙이
//      소리 없이 빗나가지 않는다(§16-4).
//   ④ 자동 플레이·동료는 캐고 짓고 사람을 모으고 사냥한다 — 집사(§16-5·§16-6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, territoryRadius, ringRadii, dist, inTerritory } from '../server/engine/world.js';
import { ensurePlayer, playerMaxHp } from '../server/engine/skills.js';
import {
  ensureWild, stepEcology, huntSwing, ringBand, creatureDefs,
} from '../server/engine/ecology.js';
import { combatSwing, startBattle } from '../server/engine/battle.js';
import { freeBeds, grainDays } from '../server/engine/residents.js';
import {
  syncCompanionSeats, stepCompanions, setAutoPlay,
} from '../server/engine/companions.js';

const data = loadGameData();
const DEFS = creatureDefs(data);
const SEED = 20260806;

function scene(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(null, nation, data, opts.chapter ?? 5);
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  return { world, nation, t };
}

function putCreature(nation, sp, x, y, ring = DEFS[sp].ring) {
  const w = ensureWild(nation);
  const c = {
    id: `w${w.nextId++}`, sp, x, y, tx: x, ty: y,
    hp: DEFS[sp].hp, maxHp: DEFS[sp].hp, ring,
    state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
  };
  w.creatures.push(c);
  return c;
}

// ────────────────────────────────────────────────────────────────
// ① §16-1 — 스폰 링 밀착
// ────────────────────────────────────────────────────────────────
test('★ §16-1 링 밀착 — 정착지 곁으로 흘러든 링2 포식자는 제 띠로 돌아간다', () => {
  const { world, nation, t } = scene();
  // 사람이 곁에 없어야 순수한 떠돌이 걸음만 남는다
  delete nation.avatars.lord;
  const { r1 } = ringRadii(nation, data);
  // 영토 경계 바로 밖 — §16-1 이전에는 keepTargetOutside 가 이 자리를 오히려 겨누게 했다
  const c = putCreature(nation, 'direwolf', t.x + territoryRadius(nation, data) + 3, t.y);
  for (let i = 0; i < 600; i += 1) stepEcology(world, nation, data, 1);
  const d = dist(c.x, c.y, t.x, t.y);
  assert.ok(d > r1 - 0.001, `다이어울프가 제 띠(링2, ${r1.toFixed(1)}타일 밖)로 돌아갔다 — 지금 ${d.toFixed(1)}타일`);
});

test('★ §16-1 링 밀착 — 떠돌이 목적지는 늘 제 띠 안이다(영토가 자라면 띠도 함께 밀려난다)', () => {
  const { world, nation, t } = scene();
  delete nation.avatars.lord;
  const band = ringBand(nation, data, 2);
  const c = putCreature(nation, 'bear', t.x + band.inner + 4, t.y);
  for (let i = 0; i < 240; i += 1) {
    stepEcology(world, nation, data, 1);
    const dt = dist(c.tx, c.ty, t.x, t.y);
    assert.ok(dt >= band.inner - 1.5 && dt <= band.outer + 1.5,
      `곰의 목적지가 띠를 벗어났다 (${dt.toFixed(1)} ∉ [${band.inner}, ${band.outer}])`);
  }
});

// ────────────────────────────────────────────────────────────────
// ② §16-2 — 영토는 성역이다
// ────────────────────────────────────────────────────────────────
test('★ §16-2 성역 — 영토 안의 사람은 경계 밖 포식자에게 물리지 않는다', () => {
  const { world, nation, t } = scene();
  const r = territoryRadius(nation, data);
  // 사람은 경계 안쪽 반 칸, 늑대는 경계 바로 밖 — 사거리(1.4) 안에 마주 선 최악의 자리
  nation.avatars.lord.x = t.x + r - 0.5;
  nation.avatars.lord.y = t.y;
  const c = putCreature(nation, 'wolf', t.x + r + 0.6, t.y, 1);
  c.provoked = 999;                                     // 성이 잔뜩 났어도
  const p = nation.players.lord;
  const hp0 = p.hp ?? playerMaxHp(p, data);
  let bites = 0;
  for (let i = 0; i < 120; i += 1) {
    const { events } = stepEcology(world, nation, data, 1);
    bites += events.filter((e) => e.kind === 'wild_hit' || e.kind === 'player_down').length;
  }
  assert.equal(bites, 0, '영토 안의 사람을 물었다');
  assert.equal(p.hp ?? hp0, hp0, '체력이 깎이지 않았다');
  assert.notEqual(c.state, 'chase', '성역의 사람을 계속 쫓지 않는다');
});

test('★ §16-2 성역 — 경계 밖으로 나서면 다시 물린다(성역은 영토까지다)', () => {
  const { world, nation, t } = scene();
  const r = territoryRadius(nation, data);
  nation.avatars.lord.x = t.x + r + 4;
  nation.avatars.lord.y = t.y;
  const c = putCreature(nation, 'wolf', t.x + r + 5, t.y, 1);
  c.provoked = 999;
  let bites = 0;
  for (let i = 0; i < 30; i += 1) {
    const { events } = stepEcology(world, nation, data, 1);
    bites += events.filter((e) => e.kind === 'wild_hit' || e.kind === 'player_down').length;
  }
  assert.ok(bites > 0, '영토 밖에서는 여전히 문다 — 성역이 세상 전체가 되면 안 된다');
});

// ────────────────────────────────────────────────────────────────
// ③ §16-4 — 타겟팅 괄호(지금 · 직전 스텝)
// ────────────────────────────────────────────────────────────────
test('★ §16-4 사냥 괄호 — 한 스텝 만에 사거리를 벗어난 놈도 직전 자리로 잡힌다', () => {
  const { world, nation, t } = scene();
  const c = putCreature(nation, 'deer', t.x + 2, t.y, 1);
  // 서버는 이미 한 스텝을 밀었다(사슴 3.4타일) — 화면은 아직 직전 자리를 그리고 있다
  c.px = c.x; c.py = c.y;
  c.x += 4.5;
  const cfgC = data.skills.combat;
  const range = cfgC.huntRangeTiles ?? cfgC.rangeTiles;
  assert.ok(dist(c.x, c.y, t.x, t.y) > range + (data.creatures.sim.targetSlackTiles ?? 1),
    '전제: 지금 자리만 재면 닿지 않는 거리다');
  const res = huntSwing(world, nation, { targetId: c.id, avatarId: 'lord' }, data, 1000);
  assert.equal(res.ok, true, `직전 자리 괄호로 닿아야 한다 — ${JSON.stringify(res.error ?? null)}`);
  assert.ok(res.damage > 0, '실제로 벴다');
});

test('★ §16-4 사냥 괄호 — 직전 자리마저 멀면 그대로 빗나간다(괄호는 보간 지연의 몫만 넓힌다)', () => {
  const { world, nation, t } = scene();
  const c = putCreature(nation, 'deer', t.x + 20, t.y, 1);
  c.px = c.x; c.py = c.y;
  const res = huntSwing(world, nation, { targetId: c.id, avatarId: 'lord' }, data, 1000);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'OUT_OF_RANGE');
});

test('★ §16-4 전투 괄호 — 웨이브의 적도 직전 서브틱 자리로 잡힌다', () => {
  const { world, nation, t } = scene({ chapter: 8 });
  startBattle(world, nation, data, { type: 'wolves', power: 200 });
  const b = nation.battle;
  assert.ok(b && b.enemies.length, '전투가 섰다');
  const e = b.enemies[0];
  const cfgC = data.skills.combat;
  // 적이 한 서브틱에 성큼 지나갔다 — 직전 자리는 검 앞, 지금 자리는 검 밖
  e.px = t.x + 1; e.py = t.y;
  e.x = t.x + cfgC.rangeTiles + 3; e.y = t.y;
  nation.avatars.lord.x = t.x; nation.avatars.lord.y = t.y;
  const res = combatSwing(world, nation, { targetId: e.id, avatarId: 'lord' }, data, 5000);
  assert.equal(res.ok, true, `직전 서브틱 괄호로 닿아야 한다 — ${JSON.stringify(res.error ?? null)}`);
});

// ────────────────────────────────────────────────────────────────
// ④ §16-5 · §16-6 — 사냥하고, 짓고, 사람을 모으는 두뇌
// ────────────────────────────────────────────────────────────────
test('★ §16-5 사냥 — 곡물이 마르면 자동 플레이가 들의 짐승을 사냥해 고기를 채운다', () => {
  const { world, nation, t } = scene({ chapter: 5 });
  setAutoPlay(nation, 'lord', data, { enabled: true, now: 0 });
  nation.resources.grain = 0;                     // 식량 위기
  nation.resources.meat = 0;
  ensureWild(nation).creatures.length = 0;        // 표적을 하나만 둔다
  putCreature(nation, 'rabbit', t.x + 8, t.y, 0);
  let killed = false;
  for (let i = 0; i < 300 && !killed; i += 1) {
    const r = stepCompanions(world, nation, data, 1, { now: i * 1000 });
    killed = r.actions.some((a) => a.hunt && a.killed);
  }
  assert.equal(killed, true, '짐승을 쫓아가 잡았다');
  assert.ok((nation.resources.meat || 0) > 0, `고기가 곳간에 들었다 (${nation.resources.meat})`);
});

test('★ §16-6 집사 — 잠자리가 다 차면 자동 플레이가 집을 앉힌다', () => {
  const { world, nation } = scene({ chapter: 5 });
  setAutoPlay(nation, 'lord', data, { enabled: true, now: 0 });
  nation.resources.wood = 400;
  nation.resources.stone = 200;
  nation.resources.grain = 200;                   // 식량 걱정이 없어야 살림에 손이 간다
  // 잠자리를 인구로 꽉 채운다
  const cap = Math.max(1, freeBeds(nation, data) + Math.floor(nation.population || 0));
  nation.population = cap;
  nation.villagers = Array.from({ length: cap }, (_, i) => ({ id: `v${i}`, name: `주민${i}`, x: 0, y: 0 }));
  assert.ok(freeBeds(nation, data) < 1, '전제: 빈 잠자리가 없다');
  const housing = new Set(data.companions.steward.housing);
  const homes0 = (nation.structures || []).filter((s) => housing.has(s.key)).length;
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1, { now: i * 1000 });
  /* ★ 동료들이 망치를 보태므로 30초 안에 **완공까지** 갈 수 있다 — 공사 목록이 아니라
     「선 집 + 짓는 중인 집」을 함께 센다(공사 목록만 보면 다 지은 성실함이 실패로 읽힌다). */
  const homesNow = (nation.structures || []).filter((s) => housing.has(s.key)).length
    + (nation.construction || []).filter((s) => housing.has(s.building)).length;
  assert.ok(homesNow > homes0, `집사가 집을 앉혔다 (${homes0} → ${homesNow})`);
});

test('★ §16-6 집사 — 모집이 열려 있고 식량이 넉넉하면 사람을 부른다', () => {
  const { world, nation } = scene({ chapter: 5 });
  setAutoPlay(nation, 'lord', data, { enabled: true, now: 0 });
  nation.resources.grain = 300;                   // grainDays 넉넉
  assert.ok(grainDays(nation, data) >= (data.companions.steward.recruitGrainDays ?? 4), '전제: 식량이 넉넉하다');
  const pop0 = Math.floor(nation.population || 0);
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1, { now: i * 1000 });
  assert.ok(Math.floor(nation.population || 0) > pop0, '사람이 하나 늘었다');
});

test('★ §16-6 집사 — 동료 단독으로는 튜토리얼 장을 앞지르지 않는다(첫 웨이브 전에는 착공 금지)', () => {
  const { world, nation } = scene({ chapter: 3 });
  // 자동 플레이 없는 솔로 — 동료만 있다
  syncCompanionSeats(world, nation, data);
  nation.resources.wood = 400;
  nation.resources.stone = 200;
  const cap = Math.max(1, freeBeds(nation, data) + Math.floor(nation.population || 0));
  nation.population = cap;
  nation.villagers = Array.from({ length: cap }, (_, i) => ({ id: `v${i}`, name: `주민${i}`, x: 0, y: 0 }));
  const sites0 = (nation.construction || []).length;
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1, { now: i * 1000 });
  assert.equal((nation.construction || []).length, sites0,
    '3장(허기)에서 동료가 제멋대로 착공했다 — 「처음 세워 보세요」는 사람의 몫이다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ §16-7 · §16-8 — 리듬과 형편
// ────────────────────────────────────────────────────────────────
test('★ §16-7 첫 숨 — 동료는 태어난 첫 분 안에 실제로 일한다(크레딧이 차 있다)', () => {
  const { world, nation } = scene({ chapter: 3 });
  syncCompanionSeats(world, nation, data);
  const start = (nation.companions.list || []).filter((c) => c.active)
    .map((c) => ({ id: c.id, x: nation.avatars[c.id].x, y: nation.avatars[c.id].y }));
  let acts = 0;
  for (let i = 0; i < 60; i += 1) acts += stepCompanions(world, nation, data, 1).actions.length;
  assert.ok(acts > 0, `첫 60초 안에 무언가를 했다 (${acts}번)`);
  const roamed = start.some((s) => {
    const av = nation.avatars[s.id];
    return av && dist(av.x, av.y, s.x, s.y) > 2;
  });
  assert.ok(roamed, '첫 분 안에 일터로 걸어 나갔다(마차 곁에 서 있지 않는다)');
});

test('★ §16-8 형편 배수 — 티어·사기·건물이 주민의 하루 산출에 얹힌다', async () => {
  const { settlementGatherFactor, residentYield } = await import('../server/engine/residents.js');
  const { world, nation } = scene({ chapter: 5 });
  const u = { id: 'v1', name: '주민', job: 'lumber', stats: { diligence: 5, strength: 6, craft: 5, courage: 6 } };
  const node = (world.map.nodes || []).find((n) => n.type === 'forest');

  nation.tier = 0;
  nation.gatherMorale = 1;
  const base = residentYield(u, node, data, false, nation).perDay;

  nation.tier = 3;                                  // 티어가 오르면
  const tiered = residentYield(u, node, data, false, nation).perDay;
  assert.ok(tiered > base, `티어 3 산출이 더 크다 (${base} → ${tiered})`);

  nation.gatherMorale = data.balance.morale.max;    // 사기가 높으면
  const cheered = residentYield(u, node, data, false, nation).perDay;
  assert.ok(cheered > tiered, `사기가 높으면 더 크다 (${tiered} → ${cheered})`);

  nation.gatherMorale = data.balance.morale.min;    // 사기가 낮으면
  const gloomy = residentYield(u, node, data, false, nation).perDay;
  assert.ok(gloomy < tiered, `사기가 낮으면 준다 (${tiered} → ${gloomy})`);

  assert.ok(settlementGatherFactor(nation, data, 'wood') > 0, '배수는 언제나 양수다');
});

test('★ §16-14 일괄 명령 분산 — 여덟을 나무 하나에 보내면 곁의 나무들로 흩어진다', async () => {
  const { commandVillagers } = await import('../server/engine/villagers.js');
  const { world, nation, t } = scene({ chapter: 5 });
  // 서로 곁에 선 숲 노드 무리를 찾는다
  const forests = (world.map.nodes || []).filter((n) => n.type === 'forest' && !n.depleted);
  let anchor = null;
  for (const n of forests) {
    const near = forests.filter((m) => m !== n && dist(m.x, m.y, n.x, n.y) <= 9);
    if (near.length >= 2) { anchor = n; break; }
  }
  assert.ok(anchor, '곁에 이웃이 있는 숲이 있다');
  // 주민 여덟
  nation.villagers = Array.from({ length: 8 }, (_, i) => ({
    id: `v${i}`, name: `주민${i}`, job: 'idle', targetId: null,
    x: t.x, y: t.y, destX: t.x, destY: t.y,
  }));
  nation.population = 8;
  const res = commandVillagers(world, nation, {
    ids: nation.villagers.map((u) => u.id),
    order: { type: 'work', nodeId: anchor.id },
  }, data);
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.ok(res.placed.length > res.slots, `자리(${res.slots})보다 많은 사람이 일한다 (${res.placed.length}명)`);
  assert.ok(res.spread > 0, `남는 사람이 곁으로 흩어졌다 (${res.spread}명 → ${res.spreadNodes}곳)`);
  const targets = new Set(nation.villagers.filter((u) => u.targetId).map((u) => u.targetId));
  assert.ok(targets.size >= 2, `두 그루 이상에 나눠 섰다 (${targets.size}곳)`);
});

// ────────────────────────────────────────────────────────────────
// ⑥ §16-7b · §16-17 · §16-18 · §16-19 — 하차 전 동결 · 광역 스윙 · 집결지 · 수비 깃발
// ────────────────────────────────────────────────────────────────
test('★ §16-7b 하차 — 사람이 내리기 전(tick 0 · 아바타 없음)에는 동료도 잠들어 있다', () => {
  const world = createWorld({ seed: SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  // 아직 아무도 내리지 않았다 — 사람 아바타가 없다
  let acts = 0;
  let moved = 0;
  for (let i = 0; i < 30; i += 1) {
    const r = stepCompanions(world, nation, data, 1);
    acts += r.actions.length;
    moved += r.moved;
  }
  assert.equal(acts + moved, 0, '마차에서 내리기 전에는 아무도 움직이지 않는다');
  // 첫 발걸음(lordMove 가 만든 아바타)이 닿으면 깨어난다
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x + 3, y: t.y + 2, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  let after = 0;
  for (let i = 0; i < 60; i += 1) {
    const r = stepCompanions(world, nation, data, 1);
    after += r.actions.length + r.moved;
  }
  assert.ok(after > 0, '내린 순간부터 움직이기 시작한다');
});

test('★ §16-17 광역 스윙 — 솜씨가 오르면 한 스윙이 곁의 같은 자리를 스친다', async () => {
  const { actionSwing } = await import('../server/engine/actions.js');
  const { world, nation, t } = scene({ chapter: 3 });
  const cv = data.skills.swing.cleave;
  // 곁에 이웃이 있는 숲을 찾아 아바타를 세운다
  const forests = (world.map.nodes || []).filter((n) => n.type === 'forest' && !n.depleted);
  let anchor = null;
  for (const n of forests) {
    if (forests.some((m) => m !== n && dist(m.x, m.y, n.x, n.y) <= (cv.radiusTiles ?? 1.9))) { anchor = n; break; }
  }
  assert.ok(anchor, '이웃이 붙은 숲이 있다');
  nation.avatars.lord.x = anchor.x + 1;
  nation.avatars.lord.y = anchor.y;

  // 낮은 솜씨 — 스치지 않는다
  const p = nation.players.lord;
  p.skills.lumber.xp = 0;
  p.skills.lumber.level = 1;
  const low = actionSwing(world, nation, { nodeId: anchor.id, avatarId: 'lord' }, data, 1000);
  assert.equal(low.ok, true, JSON.stringify(low.error ?? null));
  assert.equal(low.cleaved || 0, 0, '낮은 솜씨는 한 그루만 벤다');

  // 솜씨를 올린다 — 곁의 나무가 함께 흔들린다
  p.skills.lumber.level = (cv.level ?? 7) + 1;
  const high = actionSwing(world, nation, { nodeId: anchor.id, avatarId: 'lord' }, data, 60000);
  assert.equal(high.ok, true, JSON.stringify(high.error ?? null));
  assert.ok((high.cleaved || 0) >= 1, `광역 스윙이 곁을 스쳤다 (${high.cleaved}자리)`);
});

test('★ §16-18 집결지 — 꽂아 두면 갓 도착한 주민이 그 일터로 곧장 간다', async () => {
  const { spawnResident } = await import('../server/engine/residents.js');
  const { applyCommand } = await import('../server/engine/commands.js');
  const { createRng } = await import('../server/engine/rng.js');
  const { world, nation, t } = scene({ chapter: 5 });
  const rng = createRng(11);
  const forest = (world.map.nodes || []).filter((n) => n.type === 'forest' && !n.depleted)
    .sort((a, b) => dist(a.x, a.y, t.x, t.y) - dist(b.x, b.y, t.x, t.y))[0];
  const set = applyCommand(world, 'player', { type: 'setRally', targetId: forest.id }, data, rng);
  assert.equal(set.ok, true, JSON.stringify(set.error ?? null));
  const r1 = spawnResident(world, nation, data, rng);
  assert.equal(r1.job, 'lumber', '새 사람이 곧장 벌목 일을 받았다');
  assert.ok(r1.targetId, '일터가 배정됐다');
  // 걷는다 — 다음 사람은 여느 때처럼 논다
  applyCommand(world, 'player', { type: 'setRally', targetId: null }, data, rng);
  const r2 = spawnResident(world, nation, data, rng);
  assert.equal(r2.job, 'idle', '집결지를 걷으면 여느 때처럼 온다');
});

test('★ §16-19 수비 깃발 — 수비 배치 주민이 깃발 곁으로 모여 선다', async () => {
  const { applyCommand } = await import('../server/engine/commands.js');
  const { createRng } = await import('../server/engine/rng.js');
  const { world, nation, t } = scene({ chapter: 8 });
  const rng = createRng(12);
  nation.villagers = Array.from({ length: 4 }, (_, i) => ({
    id: `v${i}`, name: `주민${i}`, job: i < 3 ? 'defense' : 'farm', targetId: null,
    x: t.x, y: t.y, destX: t.x, destY: t.y,
  }));
  nation.population = 4;
  const fx = t.x + 5;
  const fy = t.y;
  const res = applyCommand(world, 'player', { type: 'setDefenseFlag', x: fx, y: fy }, data, rng);
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.equal(res.moved, 3, '수비 배치 주민 셋이 명을 받았다');
  for (const u of nation.villagers) {
    if (u.job !== 'defense') continue;
    assert.ok(dist(u.destX, u.destY, fx, fy) <= 2, '목적지가 깃발 곁이다');
  }
  const off = applyCommand(world, 'player', { type: 'setDefenseFlag', x: null }, data, rng);
  assert.equal(off.ok, true);
  assert.equal(nation.defenseFlag, null, '깃발을 걷었다');
});
