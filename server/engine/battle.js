// 웨이브 실시뮬 — docs/GDD3.md §6. 서버 결정론 서브틱 시뮬.
// ★ 옛 로지스틱 일괄 판정(P = 1/(1+e^(-k(R-1))))은 폐기됐다. 이제 적 유닛 하나하나가 걸어와
//   울타리를 두드리고, 터렛이 쏘고, 민병과 플레이어가 붙는다. 같은 입력이면 언제나 같은 결과다
//   (rng 상태를 전투 객체에 담아 다닌다 — 실시간이든 헤드리스든 결과가 같다).
//
// 아키텍처: 일 틱(기존 파이프라인)은 그대로 두고, 전투만 subtickSeconds 단위로 따로 돈다.
//   · 서버 실시간: GameRuntime 이 subtick 타이머로 stepBattle 을 부르고 battleTick 을 흘려보낸다
//   · 헤드리스(테스트·시뮬): runBattle 이 같은 함수를 루프로 돌린다 → 결과 동일
import { townOf, territoryRadius, dist } from './world.js';
import { turretList, damageStructure, isRuined, structureName } from './structures.js';
import { militiaList } from './residents.js';
// ★ GDD3 §13-D-3 — 손에 든 것과 두른 것. 무기는 피해를, 방어구는 맞는 피해와 다운 시간을 바꾼다.
import { equipEffects } from './equipment.js';
import { aliveFences, blockingFence, damageFence, fenceMid } from './fences.js';
import {
  nextWaveSpec, battleCfg, warnCfg, hasSaintSight, directionAngle, advanceWave, clearCamps,
} from './waves.js';
import { ensurePlayer, swingDamage, canSwing, markSwing, grantXp, combatSkillCfg, skillLevel } from './skills.js';
import { createRng, rngFromState } from './rng.js';
import { round2, round3, clamp } from './economy.js';

const err = (code, message) => ({ ok: false, error: { code, message } });

const MILITIA_SPEED = 2.2;
const STRUCTURE_HIT_EVENT_EVERY = 1.0;

// ────────────────────────────────────────────────────────────────
// 시작
// ────────────────────────────────────────────────────────────────
/** 전술 상성·성녀 예언의 계승 — 옛 전술 가산(±8%p)을 실시뮬의 '피해 배수'로 옮긴 것 */
export function battleMultipliers(nation, spec, data, hooks = {}) {
  const cfg = battleCfg(data);
  let defender = 1;
  let enemy = 1;
  if (hasSaintSight(nation, data, hooks)) defender += warnCfg(data).saint.damageBonus;
  const tactic = nation.battlePlan?.tactic ?? null;
  if (tactic) {
    if (spec.weakTo && tactic === spec.weakTo) defender += cfg.tacticDamageBonus;
    else defender -= cfg.tacticPenalty;
  }
  if ((nation.tags || []).includes('fortress')) defender += data.balance.combat.fortressTagBonus;
  const morale = clamp(nation.morale ?? 1, data.balance.morale.min, data.balance.morale.max);
  defender *= morale;
  if (nation.rubberBandMultiplier) enemy *= nation.rubberBandMultiplier;
  return { defender: Math.max(0.3, defender), enemy: Math.max(0.3, enemy) };
}

/**
 * 전투 개시. nation.battle 에 상태를 만든다.
 * @param {object} opts {virtualPlayers:[{dps}]}  시뮬 봇이 '플레이어 스윙 평균치'를 넣는 자리
 */
export function startBattle(world, nation, data, opts = {}) {
  const cfg = battleCfg(data);
  const spec = opts.spec ?? nextWaveSpec(world, nation, data);
  const town = townOf(world, nation.id);
  if (!town) return null;
  const seed = ((world.seed >>> 0) ^ Math.imul(spec.index + 1, 2654435761)) >>> 0;
  const rng = createRng(seed);
  const mult = battleMultipliers(nation, spec, data, opts.hooks || {});
  const baseAngle = (directionAngle(spec.direction, data) * Math.PI) / 180;

  const enemies = [];
  for (let i = 0; i < spec.units; i += 1) {
    const a = baseAngle + rng.float(-0.45, 0.45);
    const r = cfg.spawnRadiusTiles + rng.float(-2, 4);
    enemies.push({
      id: `e${i}`,
      type: spec.type,
      x: round2(town.x + Math.cos(a) * r),
      y: round2(town.y + Math.sin(a) * r),
      hp: round2(spec.unitHp * rng.float(0.9, 1.1)),
      maxHp: round2(spec.unitHp),
      dps: round2(spec.unitDps * rng.float(0.9, 1.1) * mult.enemy),
      speed: spec.speed * rng.float(0.92, 1.08),
      flying: spec.flying,
      structureDamageBonus: spec.structureDamageBonus,
      alive: true,
      looting: 0,
      target: null,
      targetKind: null,
    });
  }

  const militia = militiaList(nation, data).map((m) => ({
    ...m, hp: round2(m.hp), maxHp: round2(m.hp), alive: true, down: 0,
  }));

  const battle = {
    waveIndex: spec.index,
    type: spec.type,
    name: spec.name,
    power: spec.power,
    startedTick: world.tick,
    t: 0,
    core: { x: town.x, y: town.y },
    coreRadius: cfg.coreRadiusTiles,
    enemies,
    militia,
    total: enemies.length,
    killed: 0,
    escaped: 0,
    looted: {},
    structureDamage: {},
    fencesBroken: 0,
    militiaDowned: 0,      // 쓰러진 '횟수' (연출·보고용)
    militiaHurt: 0,        // 한 번이라도 쓰러진 '사람 수' (사기 계산의 기준)
    playersDowned: 0,
    playerDamage: {},
    multipliers: mult,
    virtualPlayers: opts.virtualPlayers ?? [],
    timeline: [{ t: 0, kind: 'spawn', count: enemies.length, name: spec.name, type: spec.type, direction: spec.direction }],
    lastStructureEventAt: -99,
    rngSeed: seed,
    rngState: rng.getState(),
    over: false,
    won: false,
    spec: {
      index: spec.index, type: spec.type, name: spec.name, units: spec.units,
      power: spec.power, direction: spec.direction, weakTo: spec.weakTo,
      unitHp: spec.unitHp, unitDps: spec.unitDps, sprite: spec.sprite, flying: spec.flying,
    },
  };
  nation.battle = battle;
  // 전투 중에는 아바타 체력을 되살려 시작한다(죽음은 없다 — 다운뿐)
  for (const p of Object.values(nation.players || {})) {
    p.hp = p.maxHp ?? combatSkillCfg(data).playerHp;
    p.downUntil = 0;
  }
  return battle;
}

// ────────────────────────────────────────────────────────────────
// 서브틱
// ────────────────────────────────────────────────────────────────
const alive = (list) => list.filter((x) => x.alive);

function nearest(list, x, y, maxRange = Infinity) {
  let best = null;
  let bd = maxRange;
  for (const e of list) {
    if (e.alive === false) continue;               // 이미 쓰러진 대상은 고르지 않는다
    const d = dist(e.x, e.y, x, y);
    if (d <= bd) { bd = d; best = e; }
  }
  return best ? { entity: best, d: bd } : null;
}

function push(battle, ev, data) {
  const cap = battleCfg(data).timelineMaxEvents;
  if (battle.timeline.length < cap) battle.timeline.push(ev);
  return ev;
}

/** ★ 같은 서브틱에 둘 이상이 마지막 일격을 넣어도 처치는 한 번만 센다(타임라인과 결과의 정합) */
function killEnemy(battle, e, data, byKind, byId) {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  battle.killed += 1;
  push(battle, { t: round2(battle.t), kind: 'kill', targetId: e.id, by: byKind, byId: byId ?? null }, data);
}

/**
 * 서브틱 한 걸음. 상태를 그 자리에서 바꾸고 이번 걸음에 생긴 이벤트를 돌려준다.
 * @returns {{events:Array, done:boolean}}
 */
export function stepBattle(world, nation, data, dt = battleCfg(data).subtickSeconds) {
  const b = nation.battle;
  if (!b || b.over) return { events: [], done: true };
  const cfg = battleCfg(data);
  const rng = rngFromState(b.rngSeed, b.rngState);
  const before = b.timeline.length;
  b.t = round3(b.t + dt);

  const livingEnemies = alive(b.enemies);

  // ── 1. 터렛 ──────────────────────────────────────────────────
  for (const t of turretList(nation, data)) {
    const found = nearest(livingEnemies, t.x, t.y, t.range);
    if (!found) continue;
    const counter = (t.counters || []).includes(b.type) ? 1.5 : 1;
    const dmg = t.dps * counter * b.multipliers.defender * dt;
    found.entity.hp -= dmg;
    if (found.entity.hp <= 0) killEnemy(b, found.entity, data, 'turret', t.id);
  }

  // ── 2. 민병 ─────────────────────────────────────────────────
  for (const m of b.militia) {
    if (!m.alive) {
      // 쓰러진 주민은 죽지 않는다 — downSeconds 뒤 절반 체력으로 다시 선다(GDD3 §6 전멸 없음)
      m.down -= dt;
      if (m.down <= 0) { m.alive = true; m.hp = round2(m.maxHp * 0.5); }
      continue;
    }
    const found = nearest(livingEnemies, m.x, m.y);
    if (!found) continue;
    if (found.d <= m.range + 0.4) {
      const dmg = m.dps * b.multipliers.defender * dt;
      found.entity.hp -= dmg;
      if (found.entity.hp <= 0) killEnemy(b, found.entity, data, 'militia', m.id);
    } else {
      const k = (MILITIA_SPEED * dt) / Math.max(0.001, found.d);
      m.x = round2(m.x + (found.entity.x - m.x) * Math.min(1, k));
      m.y = round2(m.y + (found.entity.y - m.y) * Math.min(1, k));
    }
  }

  // ── 3. 플레이어(가상 포함) — 검을 든 사람들의 지속 피해 ─────
  //   실제 플레이어의 타격은 combatSwing 이 즉시 반영한다. 여기 있는 건 시뮬 봇의 근사치다.
  for (const vp of b.virtualPlayers || []) {
    const found = nearest(livingEnemies, b.core.x, b.core.y, cfg.spawnRadiusTiles);
    if (!found) break;
    const dmg = (vp.dps || 0) * b.multipliers.defender * dt;
    found.entity.hp -= dmg;
    if (found.entity.hp <= 0) killEnemy(b, found.entity, data, 'player', vp.id ?? 'sim');
  }
  for (const p of Object.values(nation.players || {})) {
    if (p.downUntil > 0) {
      p.downUntil = Math.max(0, round2(p.downUntil - dt));
      if (p.downUntil === 0) p.hp = p.maxHp;
    }
  }

  // ── 4. 적 ───────────────────────────────────────────────────
  const fences = aliveFences(nation);
  const defenders = [
    ...alive(b.militia).map((m) => ({ kind: 'militia', ref: m, x: m.x, y: m.y })),
    ...Object.values(nation.avatars || {})
      .filter((a) => (nation.players?.[a.id]?.downUntil ?? 0) <= 0)
      .map((a) => ({ kind: 'player', ref: nation.players?.[a.id] ?? null, x: a.x, y: a.y })),
  ].filter((d) => d.ref);

  for (const e of b.enemies) {
    if (!e.alive) continue;
    const dCore = dist(e.x, e.y, b.core.x, b.core.y);

    // 4-a. 코앞의 방어자부터 친다
    const near = nearest(defenders, e.x, e.y, cfg.meleeRangeTiles + 0.6);
    if (near) {
      /* ★ §13-D-3 — 두른 것이 맞는 피해를 던다(플레이어에게만; 민병은 능력치가 그 몫을 한다). */
      const reduce = near.entity.kind === 'player' ? (equipEffects(near.entity.ref, data).reduction || 0) : 0;
      const dmg = e.dps * dt * (1 - reduce);
      const target = near.entity.ref;
      target.hp = round2((target.hp ?? 0) - dmg);
      if (target.hp <= 0) {
        if (near.entity.kind === 'militia') {
          target.alive = false;
          target.down = cfg.militia.downSeconds;
          b.militiaDowned += 1;
          // ★ 사기는 '사람 수'로 센다 — 같은 사람이 두 번 쓰러졌다고 마을이 두 배로 무너지지는 않는다.
          //   (쓰러진 민병은 downSeconds 뒤 다시 일어서므로, 긴 전투에서는 한 사람이 여러 번 쓰러진다.
          //    옛 셈법은 그 횟수를 그대로 사기에서 깎아, 사람이 많고 오래 버틸수록 사기가 더 크게
          //    무너지는 뒤집힌 곡선을 만들었다 — GDD3 §12-4 로 인구가 빨리 느는 지금은 더 심해진다.)
          if (!target.everDowned) { target.everDowned = true; b.militiaHurt = (b.militiaHurt || 0) + 1; }
          push(b, { t: round2(b.t), kind: 'militiaDown', targetId: target.id }, data);
        } else {
          target.hp = 0;
          /* ★ §13-D-3 — 방어구의 다운 저항. 쓰러지긴 해도 더 빨리 일어선다(죽음은 없다). */
          const resist = equipEffects(target, data).downResist || 0;
          target.downUntil = round2(combatSkillCfg(data).downSeconds * (1 - resist));
          b.playersDowned += 1;
          push(b, { t: round2(b.t), kind: 'playerDown', targetId: target.id }, data);
        }
      }
      continue;
    }

    // 4-b. 울타리에 막히면 두드린다 (나는 것은 넘어간다)
    if (!e.flying && fences.length) {
      const f = blockingFence(nation, e, b.core);
      if (f) {
        const m = fenceMid(f);
        const df = dist(e.x, e.y, m.x, m.y);
        if (df <= cfg.meleeRangeTiles + 0.6) {
          const before2 = f.hp;
          damageFence(f, e.dps * e.structureDamageBonus * dt);
          if (before2 > 0 && f.hp <= 0) {
            b.fencesBroken += 1;
            push(b, { t: round2(b.t), kind: 'fenceBreak', fenceId: f.id, x: m.x, y: m.y }, data);
          }
          continue;
        }
        moveToward(e, m.x, m.y, dt);
        continue;
      }
    }

    // 4-c. 중심까지 왔으면 건물을 부수고 계속 약탈한다 (쫓아내지 못하면 곳간이 마른다)
    if (dCore <= b.coreRadius + 1.5) {
      if (!e.atCore) {
        e.atCore = true;
        push(b, { t: round2(b.t), kind: 'breach', targetId: e.id, x: round2(e.x), y: round2(e.y) }, data);
      }
      const s = pickStructure(nation, e, rng);
      if (s) {
        const dmg = e.dps * e.structureDamageBonus * (cfg.structureDamagePerSecond / 6) * dt;
        const wasRuined = isRuined(s);
        // ★ GDD3 §6 패배 관대 — 한 번의 습격으로 건물이 통째로 사라지지는 않는다.
        //   내구도는 floor 아래로 내려가지 않는다(수리하면 되살아난다). 폐허 나선을 막는 안전장치다.
        const floor = (s.maxHp || 0) * cfg.structureDamageFloor;
        damageStructure(s, Math.min(dmg, Math.max(0, (s.hp ?? 0) - floor)));
        b.structureDamage[s.id] = round2((b.structureDamage[s.id] || 0) + dmg);
        if (!wasRuined && isRuined(s)) {
          push(b, { t: round2(b.t), kind: 'structureRuined', structureId: s.id, key: s.key, x: s.x, y: s.y }, data);
        } else if (b.t - b.lastStructureEventAt >= STRUCTURE_HIT_EVENT_EVERY) {
          b.lastStructureEventAt = b.t;
          push(b, { t: round2(b.t), kind: 'structureHit', structureId: s.id, key: s.key, x: s.x, y: s.y }, data);
        }
      }
      takeLoot(nation, b, cfg.lootRatioPerSecond * dt, data);
      continue;
    }

    moveToward(e, b.core.x, b.core.y, dt);
  }

  // ── 5. 종료 판정 ─────────────────────────────────────────────
  //   ★ 이기려면 '한 놈도 남기지 않고' 쫓아내야 한다. 시간이 다 되면 남은 적은 챙긴 것을 들고
  //     물러간다 — 전멸도 게임오버도 없다(GDD3 §6 패배 관대).
  const stillAlive = alive(b.enemies).length;
  if (stillAlive === 0) {
    b.over = true;
    b.won = true;
  } else if (b.t >= cfg.maxSeconds) {
    for (const e of alive(b.enemies)) { e.alive = false; b.escaped += 1; }
    b.over = true;
    b.won = false;
  }
  if (b.over) {
    push(b, { t: round2(b.t), kind: b.won ? 'hold' : 'withdraw', killed: b.killed, escaped: b.escaped }, data);
  }
  b.rngState = rng.getState();
  return { events: b.timeline.slice(before), done: b.over };
}

function moveToward(e, tx, ty, dt) {
  const d = dist(e.x, e.y, tx, ty);
  if (d <= 0.001) return;
  const k = Math.min(1, (e.speed * dt) / d);
  e.x = round2(e.x + (tx - e.x) * k);
  e.y = round2(e.y + (ty - e.y) * k);
}

/** 부술 건물 고르기 — 가까운 셋 중 하나를 (결정론 rng 로) 고른다. 한 채만 집중해서 무너뜨리지 않는다. */
function pickStructure(nation, enemy, rng) {
  const list = (nation.structures || []).filter((s) => !isRuined(s));
  if (!list.length) return null;
  const near = list
    .map((s) => ({ s, d: dist(s.x, s.y, enemy.x, enemy.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  return near[Math.min(near.length - 1, Math.floor(rng.next() * near.length))].s;
}

/** 적 하나가 마을 한복판에서 한 서브틱 동안 퍼 가는 양 */
function takeLoot(nation, battle, ratio, data) {
  if (!(ratio > 0)) return battle.looted;
  for (const r of data.resources.order) {
    const have = nation.resources[r] || 0;
    if (have <= 0) continue;
    const take = have * ratio;
    if (take <= 0.0001) continue;
    nation.resources[r] = round2(have - take);
    battle.looted[r] = round2((battle.looted[r] || 0) + take);
  }
  return battle.looted;
}

// ────────────────────────────────────────────────────────────────
// 플레이어 참전 — combatSwing
// ────────────────────────────────────────────────────────────────
/**
 * combatSwing {targetId?} — 전투 중에만. 쿨타임·사거리·다운 상태를 서버가 판정한다.
 * 죽음은 없다: 체력이 0이면 다운되고 downSeconds 뒤 모닥불에서 일어난다(사기 페널티).
 */
export function combatSwing(world, nation, cmd, data, now = Date.now()) {
  const b = nation.battle;
  if (!b || b.over) return err('NO_BATTLE', '지금은 싸울 것이 없습니다.');
  const c = combatSkillCfg(data);
  const avatarId = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const player = ensurePlayer(nation, avatarId, data, cmd.playerName ?? null);
  if ((player.downUntil || 0) > 0) return err('DOWNED', '아직 일어서지 못했습니다.');
  const cd = canSwing(nation, player, 'combat', data, now);
  if (!cd.ok) return { ok: false, error: { code: 'COOLDOWN', message: '아직 휘두를 수 없습니다.', waitMs: cd.waitMs } };

  const av = nation.avatars?.[avatarId];
  const from = av ? { x: av.x, y: av.y } : b.core;
  const living = alive(b.enemies);
  if (!living.length) return err('NO_TARGET', '벨 것이 남지 않았습니다.');
  let target = null;
  const wanted = cmd.targetId ?? cmd.payload?.targetId ?? null;
  if (wanted) target = living.find((e) => e.id === wanted) ?? null;
  if (!target) {
    const found = nearest(living, from.x, from.y, c.rangeTiles);
    target = found?.entity ?? null;
  }
  if (!target) return err('OUT_OF_RANGE', '닿지 않습니다.');
  if (dist(target.x, target.y, from.x, from.y) > c.rangeTiles + 0.6) {
    return err('OUT_OF_RANGE', '닿지 않습니다.');
  }

  markSwing(player, now, 'combat');
  /* ★ §13-D-3 — 무기가 얹는 배수. 스킬 도구(skills.json)와는 다른 축이라 곱해진다:
     레벨이 여는 것과 손으로 벼린 것이 서로를 갉아먹지 않는다. */
  const gearFx = equipEffects(player, data);
  const dmg = round2(swingDamage(nation, player, data) * gearFx.damage * b.multipliers.defender);
  target.hp = round2(target.hp - dmg);
  b.playerDamage[avatarId] = round2((b.playerDamage[avatarId] || 0) + dmg);
  push(b, { t: round2(b.t), kind: 'playerHit', targetId: target.id, by: avatarId, damage: dmg }, data);
  let killed = false;
  let xp = grantXp(player, 'combat', c.xpPerHit, data);
  if (target.hp <= 0) {
    killEnemy(b, target, data, 'player', avatarId);
    player.stats.kills = (player.stats.kills || 0) + 1;
    killed = true;
    xp = grantXp(player, 'combat', c.xpPerKill, data);
  }
  return {
    ok: true,
    targetId: target.id,
    damage: dmg,
    targetHp: Math.max(0, target.hp),
    killed,
    cooldownMs: cd.cooldownMs,
    skill: 'combat',
    level: skillLevel(player, 'combat'),
    leveled: xp.leveled,
    gearDamage: gearFx.damage,
  };
}

// ────────────────────────────────────────────────────────────────
// 종료 · 결산
// ────────────────────────────────────────────────────────────────
export function finishBattle(world, nation, data) {
  const b = nation.battle;
  if (!b) return null;
  const cfg = battleCfg(data);
  const m = data.balance.morale;

  let moraleDelta = 0;
  if (b.won) moraleDelta += cfg.moraleBonusOnHold;
  else moraleDelta -= cfg.moralePenaltyOnBreach;
  moraleDelta -= b.playersDowned * combatSkillCfg(data).downMoralePenalty;
  // ★ 사람 수 기준(militiaHurt). 옛 스냅샷에는 없는 값이라 없으면 횟수로 물러선다.
  moraleDelta -= (b.militiaHurt ?? b.militiaDowned) * cfg.militia.downMoralePenalty;
  nation.morale = clamp(round2((nation.morale ?? 1) + moraleDelta), m.min, m.max);

  const gold = b.won ? Math.round(b.power * cfg.rewardGoldPerPower) : 0;
  if (gold > 0) {
    nation.gold = round2(nation.gold + gold);
    nation.stats.goldEarned = round2((nation.stats.goldEarned || 0) + gold);
  }
  nation.stats.invasionsWon = (nation.stats.invasionsWon || 0) + (b.won ? 1 : 0);
  nation.stats.invasionsLost = (nation.stats.invasionsLost || 0) + (b.won ? 0 : 1);

  // 고무줄 보정(난이도) — 뚫렸으면 다음 웨이브가 조금 약해진다
  const diff = data.difficulty.presets[world.difficulty] ?? null;
  nation.rubberBandMultiplier = (!b.won && diff?.rubberBand?.enabled)
    ? (diff.rubberBand.nextInvasionPowerMultiplier ?? 1) : null;

  const damaged = Object.entries(b.structureDamage).map(([id, dmg]) => {
    const s = (nation.structures || []).find((x) => x.id === id);
    return {
      id, key: s?.key ?? null, name: s ? structureName(s.key, s.tier, data) : null,
      damage: round2(dmg), ruined: s ? isRuined(s) : false,
      hp: s ? round2(s.hp) : 0, maxHp: s?.maxHp ?? 0,
    };
  });

  const result = {
    index: b.waveIndex,
    number: b.waveIndex + 1,
    tick: world.tick,
    type: b.type,
    name: b.name,
    power: b.power,
    won: b.won,
    duration: round2(b.t),
    enemiesTotal: b.total,
    enemiesKilled: b.killed,
    enemiesEscaped: b.escaped,
    fencesBroken: b.fencesBroken,
    militiaDowned: b.militiaDowned,
    militiaHurt: b.militiaHurt ?? b.militiaDowned,
    playersDowned: b.playersDowned,
    looted: { ...b.looted },
    structuresDamaged: damaged,
    playerDamage: { ...b.playerDamage },
    moraleDelta: round2(moraleDelta),
    gold,
    timeline: b.timeline,
    text: b.won
      ? `${b.name} ${b.total}을(를) 모두 막아 냈습니다.`
      : `${b.name} ${b.escaped}이(가) 곳간을 헤집고 물러갔습니다.`,
  };

  advanceWave(nation, {
    index: result.index, type: result.type, name: result.name, tick: result.tick,
    won: result.won, enemiesKilled: result.enemiesKilled, enemiesTotal: result.enemiesTotal,
  });
  clearCamps(world, b.waveIndex);
  nation.battlePlan = null;
  nation.battle = null;
  nation.lastBattleResult = result;
  return result;
}

/**
 * 헤드리스 완주 — 테스트·시뮬이 쓴다. 실시간 서버와 같은 stepBattle 을 돌리므로 결과가 같다.
 * @returns 결과 객체(finishBattle 반환값)
 */
export function runBattle(world, nation, data, opts = {}) {
  const cfg = battleCfg(data);
  if (!nation.battle) startBattle(world, nation, data, opts);
  const dt = opts.dt ?? cfg.subtickSeconds;
  let guard = 0;
  const maxSteps = Math.ceil(cfg.maxSeconds / dt) + 8;
  while (!nation.battle.over && guard++ < maxSteps) stepBattle(world, nation, data, dt);
  return finishBattle(world, nation, data);
}

// ────────────────────────────────────────────────────────────────
// 뷰 — 실시간 스트림
// ────────────────────────────────────────────────────────────────
/** battleTick 페이로드 — 위치·체력만. 매 서브틱 방 전체에 흘려보낸다. */
export function battleSnapshot(nation, data) {
  const b = nation.battle;
  if (!b) return null;
  return {
    waveIndex: b.waveIndex,
    number: b.waveIndex + 1,
    type: b.type,
    name: b.name,
    t: round2(b.t),
    maxSeconds: battleCfg(data).maxSeconds,
    core: b.core,
    over: b.over,
    won: b.won,
    total: b.total,
    killed: b.killed,
    escaped: b.escaped,
    enemies: b.enemies.filter((e) => e.alive).map((e) => ({
      id: e.id, x: e.x, y: e.y, hp: round2(e.hp), maxHp: e.maxHp,
      type: e.type, looting: e.looting > 0,
    })),
    militia: b.militia.map((m) => ({ id: m.id, x: m.x, y: m.y, hp: round2(m.hp), maxHp: m.maxHp, alive: m.alive })),
    turrets: turretList(nation, data).map((t) => ({ id: t.id, x: t.x, y: t.y, range: t.range, key: t.key })),
    players: Object.values(nation.players || {}).map((p) => ({
      id: p.id, hp: round2(p.hp ?? 0), maxHp: p.maxHp, down: (p.downUntil || 0) > 0,
    })),
  };
}

/** NationView.battle — 전투가 없으면 null */
export function battleView(nation, data) {
  const b = nation.battle;
  if (!b) return null;
  const snap = battleSnapshot(nation, data);
  return { ...snap, multipliers: { defender: round3(b.multipliers.defender), enemy: round3(b.multipliers.enemy) } };
}
