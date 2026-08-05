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
  const sites0 = (nation.construction || []).length;
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1, { now: i * 1000 });
  const started = (nation.construction || []).slice(sites0);
  assert.ok(started.length >= 1, '집사가 착공했다');
  const housing = new Set(data.companions.steward.housing);
  assert.ok(started.some((s) => housing.has(s.building)),
    `집(주거)을 앉혔다 — ${started.map((s) => s.building).join(',')}`);
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
