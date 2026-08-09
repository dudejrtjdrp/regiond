// 웨이브 실시뮬 — docs/GDD3.md §6. 서버 결정론 서브틱 시뮬.
// ★ 옛 로지스틱 일괄 판정(P = 1/(1+e^(-k(R-1))))은 폐기됐다. 이제 적 유닛 하나하나가 걸어와
//   울타리를 두드리고, 터렛이 쏘고, 민병과 플레이어가 붙는다. 같은 입력이면 언제나 같은 결과다
//   (rng 상태를 전투 객체에 담아 다닌다 — 실시간이든 헤드리스든 결과가 같다).
//
// 아키텍처: 일 틱(기존 파이프라인)은 그대로 두고, 전투만 subtickSeconds 단위로 따로 돈다.
//   · 서버 실시간: GameRuntime 이 subtick 타이머로 stepBattle 을 부르고 battleTick 을 흘려보낸다
//   · 헤드리스(테스트·시뮬): runBattle 이 같은 함수를 루프로 돌린다 → 결과 동일
import { townOf, territoryRadius, dist, isWaterAt } from './world.js';
import {
  turretList, damageStructure, isRuined, structureName,
  // ★ §19-F1(F05-3) — 길목의 건물을 부수며 들어온다
  blockingStructure, isBreached, structureRadius, centerOf, findStructure,
} from './structures.js';
import { militiaList } from './residents.js';
// ★ GDD3 §13-D-3 — 손에 든 것과 두른 것. 무기는 피해를, 방어구는 맞는 피해와 다운 시간을 바꾼다.
import { equipEffects } from './equipment.js';
import { aliveFences, blockingFence, damageFence, fenceMid } from './fences.js';
import {
  nextWaveSpec, battleCfg, warnCfg, hasSaintSight, directionAngle, advanceWave, clearCamps,
  // ★ Sprint 5 — 야영지를 부순 만큼 덜 온다. 적을 세우기 **전에** 무리를 깎는다.
  campWeakenedSpec,
} from './waves.js';
import {
  ensurePlayer, swingDamage, canSwing, markSwing, grantXp, combatSkillCfg, skillLevel,
  // ★ GDD3 §14-5·§14-6 — 능력치가 낸 최대 HP · 일어난 직후의 무적
  playerMaxHp, isInvulnerable,
} from './skills.js';
import { createRng, rngFromState } from './rng.js';
import { round2, round3, clamp } from './economy.js';
// ★ §20-R1 — 격퇴 보상(골드·사기)에 유물이 얹힌다. 결산 한 번에 한 번만 걷는다.
import { collectHooks, grantVia } from './artifacts.js';
import { statRng } from './traits.js';
/* ★ §20-R4 — 웨이브당 부활 충전. 서브틱은 실시간 경로라 collectHooks 를 부르지 않는다:
   되감기는 startBattle 한 번, 소비는 쓰러지는 순간 한 번(거울 nation.artifactReviveLeft). */
import { resetReviveCharges, consumeRevive } from './artifacts.js';
// ★ §20-R4 — 치명타·회피 굴림은 넷이 같은 한 벌을 쓴다(combat.js 머리말 참고)
import { artifactCritRoll, artifactDodgeRoll } from './combat.js';
// ★ Sprint 2 — 전투의 발: 수비는 깃발로, 영토 밖 일꾼은 마을로. 끝나면 제 일터로.
import { battleStations, standDown } from './assign.js';
// ★ §19-C — 스폰 자리 검사(물에서 태어나 갇히는 사고를 막는다)
import { nearestWalkable, findPath, respawnSpot } from './path.js';

const err = (code, message) => ({ ok: false, error: { code, message } });

const MILITIA_SPEED = 2.2;
const STRUCTURE_HIT_EVENT_EVERY = 1.0;

// ────────────────────────────────────────────────────────────────
// 시작
// ────────────────────────────────────────────────────────────────
/**
 * ★ §19-C — 여기 설 수 있는가. 뭍으로 스냅한 뒤 **도읍까지 길이 있는지**까지 본다.
 * 「왜」 — §17-4 이후 적은 물을 못 건넌다. 물에서 태어나면 미끄러질 곳이 없어 그 자리에
 * 영원히 갇히고, 웨이브는 끝나지 않는다(B05-2). 호수 건너편 뭍도 마찬가지다.
 * 나라를 null 로 넘기는 것은 일부러다 — 다리·매립은 사람의 길이지 적의 길이 아니다.
 */
function landingSpot(world, data, core, x, y) {
  const near = nearestWalkable(world, null, data, x, y, 8);
  if (!near) return null;
  const path = findPath(world, null, data, near.x, near.y, core.x, core.y, { pad: 24, maxNodes: 2500 });
  const end = path?.[path.length - 1];
  if (!end || dist(end.x, end.y, core.x, core.y) > 1.5) return null;
  return near;
}

/** 물이면 각을 조금씩 틀고 조금씩 안쪽으로 물리며 설 자리를 찾는다 (결정론 — 난수를 쓰지 않는다) */
function spawnSpot(world, data, town, angle, radius, flying) {
  const at = (a, r) => ({ x: round2(town.x + Math.cos(a) * r), y: round2(town.y + Math.sin(a) * r) });
  if (flying) return at(angle, radius);
  for (let i = 0; i < 8; i += 1) {
    const p = at(angle + ((i % 2) ? -1 : 1) * Math.ceil(i / 2) * 0.22, radius - Math.floor(i / 4) * 4);
    const spot = landingSpot(world, data, town, p.x, p.y);
    if (spot) return spot;
  }
  return at(angle, radius);      // 끝내 못 찾으면 옛 규칙 그대로 — 전투가 서지 못하게 하지는 않는다
}

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
  enemy *= artifactEnemyMultiplier(spec, hooks);
  return { defender: Math.max(0.3, defender), enemy: Math.max(0.3, enemy) };
}

/**
 * ★ §20-R1 — 유물이 적의 팔심에 얹는 배수(유물기획 §20-2 전투 계열).
 * 「왜」 이제서야 꽂나 — 옛 로지스틱 판정이 폐기되면서 enemyPowerMultipliers 는 걷히기만 하고
 * 아무 데도 쓰이지 않았다. 그래서 탐욕의 반지의 「값」(전 침공 +15%)이 값이 아니었다(§20-6 위반).
 * '*' 는 모든 침공에 붙는 별표다 — 종류별 배수와 곱해진다(§20-10 중첩 규칙: 같은 축은 곱연산).
 */
function artifactEnemyMultiplier(spec, hooks) {
  const m = hooks.enemyPowerMultipliers || {};
  return (m['*'] ?? 1) * (m[spec.type] ?? 1);
}

/** 적 하나를 세운다 — 무리(본대·호위대)의 규격을 그대로 몸에 새긴다 */
function spawnEnemy(world, data, town, rng, mult, g, baseAngle, id) {
  const a = baseAngle + rng.float(-0.45, 0.45);
  const r = battleCfg(data).spawnRadiusTiles + rng.float(-2, 4);
  /* ★ §19-C — 뽑은 자리가 물이면 곁의 뭍으로. 난수는 위에서 이미 다 뽑았다(결정론 유지) */
  const at = spawnSpot(world, data, town, a, r, g.flying);
  return {
    id, type: g.type, x: at.x, y: at.y,
    hp: round2(g.unitHp * rng.float(0.9, 1.1)),
    maxHp: round2(g.unitHp),
    dps: round2(g.unitDps * rng.float(0.9, 1.1) * mult.enemy),
    speed: g.speed * rng.float(0.92, 1.08),
    flying: g.flying,
    structureDamageBonus: g.structureDamageBonus,
    // ★ §19-F2(F07-3) — 원거리형의 사거리와 자폭형의 배수. 없으면 null 이라 옛 적과 똑같이 군다.
    rangeTiles: g.rangeTiles ?? null,
    detonate: g.detonate ?? null,
    alive: true, looting: 0, target: null, targetKind: null,
  };
}

/**
 * 전투 개시. nation.battle 에 상태를 만든다.
 * @param {object} opts {virtualPlayers:[{dps}]}  시뮬 봇이 '플레이어 스윙 평균치'를 넣는 자리
 */
export function startBattle(world, nation, data, opts = {}) {
  const cfg = battleCfg(data);
  /* ★ Sprint 5 — 선제 타격이 남긴 자국을 여기서 갚는다. 야영지가 성하면(또는 옛 세이브라 체력이 없으면)
     campWeakenedSpec 은 spec 을 **그대로** 돌려주므로, 아래 난수의 뽑는 차례도 마릿수도 옛것과 같다. */
  const spec = campWeakenedSpec(world, opts.spec ?? nextWaveSpec(world, nation, data), data);
  const town = townOf(world, nation.id);
  if (!town) return null;
  const seed = ((world.seed >>> 0) ^ Math.imul(spec.index + 1, 2654435761)) >>> 0;
  const rng = createRng(seed);
  const hooks = opts.hooks || {};
  const mult = battleMultipliers(nation, spec, data, hooks);
  /* ★ §20-R1 — 악마와의 계약서가 적어 둔 값(다음 침공 규모 +10%)을 여기서 치른다.
     이 전투 하나에만 붙고 그 자리에서 지워진다 — 「다음 침공」이라는 말 그대로다. */
  const bump = nation.artifactState?.artifactNextInvasionMultiplier ?? null;
  if (bump) { mult.enemy *= bump; delete nation.artifactState.artifactNextInvasionMultiplier; }
  const baseAngle = (directionAngle(spec.direction, data) * Math.PI) / 180;

  /* ★ §19-F2(F07-3) — 무리마다 차례로 세운다. 호위대가 없으면 무리는 하나뿐이고, 그때는
     난수를 뽑는 차례도 마릿수도 옛것과 한 톨도 다르지 않다(앞 다섯 웨이브의 결정론 보존). */
  const enemies = [];
  const groups = spec.groups ?? [{ ...spec, units: spec.units }];
  for (const g of groups) {
    for (let i = 0; i < g.units; i += 1) {
      enemies.push(spawnEnemy(world, data, town, rng, mult, g, baseAngle, `e${enemies.length}`));
    }
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
    /* ★ §20-R1 — 불멸의 주춧돌의 「성벽 내구 +10%」. 조각마다 maxHp 를 다시 쓰는 대신 **맞는 피해**를
       그 배수로 나눈다: 이미 서 있는 울타리와 앞으로 세울 울타리가 같은 규칙을 받고, 유물을 잃어도
       조각의 체력표가 어긋나지 않는다. 옛 스냅샷에는 이 칸이 없으므로 stepBattle 은 1 로 물러선다. */
    wallHpMultiplier: hooks.wallHpMultiplier ?? 1,
    virtualPlayers: opts.virtualPlayers ?? [],
    timeline: [{
      t: 0, kind: 'spawn', count: enemies.length, name: spec.name, type: spec.type,
      direction: spec.direction,
      // ★ §19-F2(F07-3) — 무엇이 섞여 왔는지도 함께 남긴다(전투 보고가 구성을 말할 수 있게)
      groups: groups.map((g) => ({ type: g.type, units: g.units })),
    }],
    lastStructureEventAt: -99,
    rngSeed: seed,
    rngState: rng.getState(),
    over: false,
    won: false,
    spec: {
      index: spec.index, type: spec.type, name: spec.name, units: spec.units,
      power: spec.power, direction: spec.direction, weakTo: spec.weakTo,
      unitHp: spec.unitHp, unitDps: spec.unitDps, sprite: spec.sprite, flying: spec.flying,
      // ★ §19-F2(F07-3) — 구성. 화면·보고가 「무엇이 섞여 왔는가」를 그대로 읽는다.
      groups: groups.map((g) => ({ type: g.type, units: g.units, sprite: g.sprite ?? g.type })),
      escort: spec.escort ?? null,
    },
  };
  nation.battle = battle;
  // 전투 중에는 아바타 체력을 되살려 시작한다(죽음은 없다 — 다운뿐)
  for (const p of Object.values(nation.players || {})) {
    p.hp = p.maxHp ?? combatSkillCfg(data).playerHp;
    p.downUntil = 0;
  }
  /* ★ §20-R4(유물기획 §20-3) — 「웨이브당 N회」의 정본이 여기다. 되감는 자리를 하나로 못 박아야
     들판(ecology)에서 쓴 충전과 전투에서 쓴 충전이 같은 지갑에서 나간다 — 지갑이 둘이면
     웨이브 직전에 일부러 짐승에게 물려 충전을 「비축」하는 이상한 셈이 생긴다. */
  resetReviveCharges(nation);
  /* ★ Sprint 2 — 종이 울렸다. 수비 주민은 깃발 곁으로, 영토 밖 일꾼은 마을로 발을 옮긴다.
     (민병 전력은 위에서 이미 스냅샷됐다 — 이 발걸음은 행동·연출의 층이다) */
  battleStations(world, nation, data);
  return battle;
}

// ────────────────────────────────────────────────────────────────
// 서브틱
// ────────────────────────────────────────────────────────────────
const alive = (list) => list.filter((x) => x.alive);

/**
 * ★ §19-F1(F08-3) 서리 — 걸음이 factor 배로 준다.
 * 겹쳐도 **가장 센 것 하나만** 듣는다(여러 탑이 곱해지면 적이 그 자리에 못 박힌다).
 */
function chill(e, slow) {
  e.chillFactor = Math.min(e.chillFactor ?? 1, slow.factor);
  e.chill = Math.max(e.chill ?? 0, slow.seconds);
}

/** ★ §19-F1(F08-3) 불길 — 겨눈 자리 둘레의 적까지 ratio 만큼 함께 지진다 */
function scorch(b, living, hit, t, dmg, data) {
  for (const o of living) {
    if (o === hit || !o.alive) continue;
    if (dist(o.x, o.y, hit.x, hit.y) > t.splash.radius) continue;
    o.hp -= dmg * t.splash.ratio;
    if (o.hp <= 0) killEnemy(b, o, data, 'turret', t.id);
  }
}

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
  /* ★ §20-R4(유물기획 §20-3) — 용의 심장의 「전투원 피해 +25%」. 이름 그대로 **나라 전체 전투원**이라
     터렛·민병·시뮬 봇·사람의 칼에 똑같이 얹는다(적이 넣는 피해에는 얹지 않는다).
     유물이 없으면 1 이라 옛 셈과 한 톨도 다르지 않다 — 그래서 늘 **맨 뒤에** 곱한다. */
  const artifactDamage = nation.artifactCombat?.damage ?? 1;

  // ── 1. 터렛 ──────────────────────────────────────────────────
  for (const t of turretList(nation, data)) {
    const found = nearest(livingEnemies, t.x, t.y, t.range);
    if (!found) continue;
    const counter = (t.counters || []).includes(b.type) ? 1.5 : 1;
    const dmg = t.dps * counter * b.multipliers.defender * dt * artifactDamage;
    found.entity.hp -= dmg;
    /* ★ §19-F1(F08-3) — 터렛의 「덤」. data 에 적힌 것만 돈다(화살탑은 한 톨도 안 바뀐다). */
    if (t.slow) chill(found.entity, t.slow);
    if (t.splash) scorch(b, livingEnemies, found.entity, t, dmg, data);
    if (found.entity.hp <= 0) killEnemy(b, found.entity, data, 'turret', t.id);
  }
  /* 얼어붙은 것들의 시계 — 시간이 다하면 제 걸음으로 돌아온다 */
  for (const e of livingEnemies) {
    if (!(e.chill > 0)) continue;
    e.chill = round2(Math.max(0, e.chill - dt));
    if (e.chill <= 0) e.chillFactor = 1;
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
      const dmg = m.dps * b.multipliers.defender * dt * artifactDamage;
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
    const dmg = (vp.dps || 0) * b.multipliers.defender * dt * artifactDamage;
    found.entity.hp -= dmg;
    if (found.entity.hp <= 0) killEnemy(b, found.entity, data, 'player', vp.id ?? 'sim');
  }
  /* ★ GDD3 §14-6 — 전투 중에 쓰러진 사람도 같은 규칙으로 일어난다:
     체력 절반 · 짧은 무적 · 본부 자리. 생태계 루프(ecology.stepEcology)와 **같은 문**을 쓴다. */
  const cCfg = combatSkillCfg(data);
  for (const p of Object.values(nation.players || {})) {
    if ((p.invulnUntil || 0) > 0) p.invulnUntil = Math.max(0, round2(p.invulnUntil - dt));
    if (!(p.downUntil > 0)) continue;
    p.downUntil = Math.max(0, round2(p.downUntil - dt));
    if (p.downUntil > 0) continue;
    /* ★ §20-R4 — 피의 계약서의 최대 체력 감소는 playerMaxHp 가 이미 안고 있다(player.hpMultiplier).
       ecology 의 같은 블록과 한 글자도 다르지 않게 둔다 — 두 문이 갈라지면 규칙이 둘이 된다. */
    p.maxHp = playerMaxHp(p, data);
    p.hp = round2(p.maxHp * (cCfg.reviveHpRatio ?? 0.5));
    p.invulnUntil = cCfg.invulnSeconds ?? 3;
    const av = nation.avatars?.[p.id];
    const at = respawnSpot(world, nation, data) ?? b.core;
    if (av) { av.x = at.x; av.y = at.y; }
    push(b, {
      t: round2(b.t), kind: 'playerRevived', targetId: p.id,
      hp: p.hp, maxHp: p.maxHp, invulnSeconds: p.invulnUntil, x: at.x, y: at.y,
    }, data);
  }

  // ── 4. 적 ───────────────────────────────────────────────────
  /* ★ §19-F1(F05-3) — 이 서브틱에 길목을 새로 찾아볼 수 있는 적 수(프레임 예산) */
  b.scanLeft = breachCfg(cfg)?.scanBudget ?? 0;
  const fences = aliveFences(nation);
  const defenders = [
    ...alive(b.militia).map((m) => ({ kind: 'militia', ref: m, x: m.x, y: m.y })),
    ...Object.values(nation.avatars || {})
      .filter((a) => (nation.players?.[a.id]?.downUntil ?? 0) <= 0)
      .map((a) => ({ kind: 'player', ref: nation.players?.[a.id] ?? null, x: a.x, y: a.y })),
  ].filter((d) => d.ref);

  for (const e of b.enemies) {
    if (!e.alive) continue;
    /* ★ §16-4 — 한 서브틱 전 자리. combatSwing 이 「지금」과 「직전」 중 가까운 쪽을 재서
       화면이 그린 자리를 겨눈 스윙이 빗나가지 않게 한다(생태계 px·py 와 같은 규칙). */
    e.px = e.x;
    e.py = e.y;
    const dCore = dist(e.x, e.y, b.core.x, b.core.y);

    // 4-a. 코앞의 방어자부터 친다
    /* ★ §19-F2(F07-3) — 투석꾼은 붙지 않고 선 자리에서 던진다. 사거리가 없는 놈은 옛 그대로 근접이다. */
    const near = nearest(defenders, e.x, e.y, (e.rangeTiles ?? cfg.meleeRangeTiles) + 0.6);
    if (near) {
      /* ★ §13-D-3 — 두른 것이 맞는 피해를 던다(플레이어에게만; 민병은 능력치가 그 몫을 한다). */
      const reduce = near.entity.kind === 'player' ? (equipEffects(near.entity.ref, data).reduction || 0) : 0;
      const target = near.entity.ref;
      // ★ §14-6 — 막 일어난 사람은 잠깐 아무도 건드리지 못한다
      if (near.entity.kind === 'player' && isInvulnerable(target)) continue;
      /* ★ §20-R4(유물기획 §20-4) — 피하는 힘. 사람에게만 붙는다(민병은 능력치가 그 몫을 한다,
         바로 위 방어구 감산과 같은 갈래다). 피해를 짓기 **전에** 판정하고, 피하면 이 서브틱의
         그 적은 헛손질로 끝난다. 확률이 0이면 굴리지 않으므로 유물 없는 판의 난수는 불변이다. */
      if (near.entity.kind === 'player' && artifactDodgeRoll(world, nation)) continue;
      const dmg = e.dps * dt * (1 - reduce);
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
        } else if (consumeRevive(nation)) {
          /* ★ §20-R4(유물기획 §20-3) — 쓰러짐을 갈음하는 충전. 그 **자리에서** 다시 선다:
             본영으로 끌려가지 않는 것이 이 유물이 파는 값이다(ecology.bite 와 같은 규칙).
             쓰러진 적이 없으므로 playersDowned 를 올리지 않는다 — 그 숫자는 결산에서 사기를
             깎는 자라서, 올리면 「부활했는데 마을은 무너진」 앞뒤 안 맞는 결말이 난다. */
          const cC = combatSkillCfg(data);
          target.maxHp = playerMaxHp(target, data);
          target.hp = round2(target.maxHp * (cC.reviveHpRatio ?? 0.5));
          target.invulnUntil = cC.invulnSeconds ?? 3;
          push(b, {
            t: round2(b.t), kind: 'playerRevived', targetId: target.id,
            hp: target.hp, maxHp: target.maxHp, invulnSeconds: target.invulnUntil,
            bySigil: true, x: near.entity.x, y: near.entity.y,
          }, data);
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
          /* ★ §19-F2(F07-3) 자폭 — 닿는 순간 제 몸과 함께 터진다. 한 번뿐이라 그 한 방이 굵고,
             터진 놈은 그 자리에서 사라진다(웨이브 총 마릿수 안에서 제 값을 다 쓴 셈이다). */
          const blast = e.detonate ? e.dps * e.detonate * e.structureDamageBonus : 0;
          // ★ §20-R1 — 성벽이 두꺼워진 만큼 같은 매질이 덜 든다(b.wallHpMultiplier, 옛 전투는 1)
          damageFence(f, (blast || e.dps * e.structureDamageBonus * dt) / (b.wallHpMultiplier || 1));
          if (before2 > 0 && f.hp <= 0) {
            b.fencesBroken += 1;
            push(b, { t: round2(b.t), kind: 'fenceBreak', fenceId: f.id, x: m.x, y: m.y }, data);
          }
          if (blast) {
            push(b, { t: round2(b.t), kind: 'detonate', targetId: e.id, x: round2(e.x), y: round2(e.y) }, data);
            killEnemy(b, e, data, 'detonate', e.id);
          }
          continue;
        }
        moveToward(e, m.x, m.y, dt, world, data);
        continue;
      }
    }

    /* 4-b-2. ★ §19-F1(F05-3) — 석벽을 넘었으면 길목의 건물이 기다린다.
       부수는 값(체력 비례)이 돌아가는 값보다 싸면 부수고, 비싸면 비껴 간다. */
    if (dCore > b.coreRadius + 1.5 && pushThrough(world, nation, e, b, data, cfg, dt)) continue;

    // 4-c. 중심까지 왔으면 건물을 부수고 계속 약탈한다 (쫓아내지 못하면 곳간이 마른다)
    if (dCore <= b.coreRadius + 1.5) {
      if (!e.atCore) {
        e.atCore = true;
        push(b, { t: round2(b.t), kind: 'breach', targetId: e.id, x: round2(e.x), y: round2(e.y) }, data);
      }
      const s = pickStructure(nation, e, rng);
      if (s) hitStructure(b, s, e.dps * e.structureDamageBonus * (cfg.structureDamagePerSecond / 6) * dt, cfg, data);
      takeLoot(nation, b, cfg.lootRatioPerSecond * dt, data);
      continue;
    }

    moveToward(e, b.core.x, b.core.y, dt, world, data);
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

/**
 * 건물 한 대 — 도읍 한복판(4-c)과 길목(4-b-2)이 **같은 문**을 쓴다.
 * ★ GDD3 §6 패배 관대 — 한 번의 습격으로 건물이 통째로 사라지지는 않는다:
 *   내구도는 floor 아래로 내려가지 않는다(수리하면 되살아난다). 폐허 나선을 막는 안전장치다.
 */
function hitStructure(b, s, dmg, cfg, data) {
  const wasRuined = isRuined(s);
  const floor = (s.maxHp || 0) * cfg.structureDamageFloor;
  damageStructure(s, Math.min(dmg, Math.max(0, (s.hp ?? 0) - floor)));
  b.structureDamage[s.id] = round2((b.structureDamage[s.id] || 0) + dmg);
  if (!wasRuined && isRuined(s)) {
    push(b, { t: round2(b.t), kind: 'structureRuined', structureId: s.id, key: s.key, x: s.x, y: s.y }, data);
    return;
  }
  if (b.t - b.lastStructureEventAt < STRUCTURE_HIT_EVENT_EVERY) return;
  b.lastStructureEventAt = b.t;
  push(b, { t: round2(b.t), kind: 'structureHit', structureId: s.id, key: s.key, x: s.x, y: s.y }, data);
}

const breachCfg = (cfg) => cfg.breach ?? null;

/**
 * ★ §19-F1(F05-3) — 길목의 건물 하나를 고른다(예산제). 「왜 예산인가」 — 길목 판정은 건물 수만큼의
 * 선분 계산이고, 적 서른이 서브틱마다 그것을 다시 풀면 전투 한 판이 무거워진다. 그래서
 * ① 한 번 찾은 길목은 rescanTiles 를 걷기 전까지 그대로 쓰고 ② 한 서브틱에 새로 찾는 적 수를 막는다.
 */
function findBlocker(nation, e, b, data, br) {
  const cached = e.blockId ? findStructure(nation, e.blockId) : null;
  const moved = Math.hypot(e.x - (e.blockScanX ?? -99), e.y - (e.blockScanY ?? -99));
  if (cached && !isBreached(cached, br.openHpRatio) && moved < br.rescanTiles) return cached;
  if (b.scanLeft <= 0) return (cached && !isBreached(cached, br.openHpRatio)) ? cached : null;
  b.scanLeft -= 1;
  e.blockScanX = e.x;
  e.blockScanY = e.y;
  const found = blockingStructure(nation, e, b.core, data, br);
  e.blockId = found?.id ?? null;
  return found;
}

/** 부수는 값(칸으로 환산) — 남은 체력 ÷ 미는 힘 × 걸음. 체력 비례 가중치가 이 한 줄이다. */
function breakCostTiles(e, s, br) {
  const need = Math.max(0, (s.hp ?? 0) - (s.maxHp || 0) * br.openHpRatio);
  const dps = Math.max(0.01, e.dps * e.structureDamageBonus * br.damageScale);
  return (need / dps) * e.speed;
}

/** 돌아가기로 했다 — 건물 몸집 밖 옆자리를 찍는다(난수 없음: 지금 서 있는 쪽으로 비킨다) */
function detourPoint(e, s, data, br) {
  const c = centerOf(s.key, s.x, s.y, data);
  const r = structureRadius(s.key, data) + br.corridorTiles + 0.8;
  const nx = -(e.y - c.y);
  const ny = (e.x - c.x);
  const len = Math.max(0.001, Math.hypot(nx, ny));
  const side = (e.x - c.x) * ny - (e.y - c.y) * nx >= 0 ? 1 : -1;
  return { x: round2(c.x + (nx / len) * r * side), y: round2(c.y + (ny / len) * r * side) };
}

/**
 * 길목 한 칸 — 부수거나 비껴 가거나. 처리했으면 true(그 서브틱은 여기서 끝난다).
 * ★ §19-F1(F05-3) 정본: 「돌아가는 것보다 부수는 게 싸면 부순다」.
 * ★ §19-F2(F07-3) 와의 결합 — 저울질 **바깥**에 두 갈래가 더 있다. 「왜」 저울질을 안 하나:
 *   자폭형은 부수는 값이 곧 제 목숨이라 「몇 초 걸리나」를 잴 수 없고(한 방뿐이다),
 *   원거리형은 길목 앞에 서 있어도 이미 때리고 있는 중이라 돌아갈 까닭이 없다.
 */
function pushThrough(world, nation, e, b, data, cfg, dt) {
  const br = breachCfg(cfg);
  if (!br || e.flying) return false;
  if (e.detourTo) return walkDetour(e, b, dt, world, data);
  const s = findBlocker(nation, e, b, data, br);
  if (!s) return false;
  if (e.detonate) return detonateBlocker(e, s, b, data, cfg, br, dt, world);
  if (inShotRange(e, s, data)) return smashBlocker(e, s, b, data, cfg, br, dt, world);
  if (breakCostTiles(e, s, br) > br.detourTiles || (e.breachT || 0) >= br.maxSecondsPerStructure) {
    return startDetour(e, s, b, data, br, dt, world);
  }
  return smashBlocker(e, s, b, data, cfg, br, dt, world);
}

/** 돌아가기로 했다 — 옆자리를 찍고 그 걸음을 시작한다(길목 기억도 그 자리에서 비운다) */
function startDetour(e, s, b, data, br, dt, world) {
  e.detourTo = detourPoint(e, s, data, br);
  e.detourUntil = round2(b.t + br.detourTiles / Math.max(0.1, e.speed));
  e.blockId = null;
  e.breachT = 0;
  return walkDetour(e, b, dt, world, data);
}

/** ★ §19-F2(F07-3) — 원거리형이 제 사거리 안에 길목을 두었는가. 없는 놈은 늘 false(옛 갈래). */
function inShotRange(e, s, data) {
  if (!e.rangeTiles) return false;
  const c = centerOf(s.key, s.x, s.y, data);
  return dist(e.x, e.y, c.x, c.y) <= structureRadius(s.key, data) + e.rangeTiles + 0.4;
}

/**
 * ★ §19-F2(F07-3) 자폭 × §19-F1(F05-3) 길목 — 울타리에 하던 그대로 건물에도 한다:
 * 닿는 순간 제 몸과 함께 터지고 사라진다. 한 방이라 damageScale 을 dt 없이 통째로 받는다
 * (부수는 데 몇 초 걸리는 놈이 낼 값을 그 자리에서 한꺼번에 내는 셈이다).
 */
function detonateBlocker(e, s, b, data, cfg, br, dt, world) {
  const c = centerOf(s.key, s.x, s.y, data);
  const reach = structureRadius(s.key, data) + cfg.meleeRangeTiles + 0.4;
  if (dist(e.x, e.y, c.x, c.y) > reach) { moveToward(e, c.x, c.y, dt, world, data); return true; }
  hitStructure(b, s, e.dps * e.detonate * e.structureDamageBonus * br.damageScale, cfg, data);
  push(b, { t: round2(b.t), kind: 'detonate', targetId: e.id, x: round2(e.x), y: round2(e.y) }, data);
  if (isBreached(s, br.openHpRatio)) {
    push(b, { t: round2(b.t), kind: 'structureBreach', structureId: s.id, key: s.key, x: s.x, y: s.y }, data);
  }
  killEnemy(b, e, data, 'detonate', e.id);
  return true;
}

/** 비껴 가는 중 — 찍은 옆자리에 닿거나 시간이 다하면 다시 도읍을 본다 */
function walkDetour(e, b, dt, world, data) {
  const to = e.detourTo;
  if (!to || b.t >= (e.detourUntil ?? 0) || dist(e.x, e.y, to.x, to.y) <= 0.9) {
    e.detourTo = null;
    return false;
  }
  moveToward(e, to.x, to.y, dt, world, data);
  return true;
}

/**
 * 두드린다 — 사거리 밖이면 다가서고, 안이면 민다. openHpRatio 아래로 밀리면 길이 열린다.
 * ★ §19-F2(F07-3) — 「사거리」는 이제 놈마다 다르다: 투석꾼은 붙지 않고 선 자리에서 쏜다
 *   (부수기 대신 사격 — 값을 내는 문은 같고, 그 문 앞에 서는 거리만 다르다).
 */
function smashBlocker(e, s, b, data, cfg, br, dt, world) {
  const c = centerOf(s.key, s.x, s.y, data);
  const reach = structureRadius(s.key, data) + (e.rangeTiles ?? cfg.meleeRangeTiles) + 0.4;
  if (dist(e.x, e.y, c.x, c.y) > reach) { moveToward(e, c.x, c.y, dt, world, data); return true; }
  e.breachT = round2((e.breachT || 0) + dt);
  hitStructure(b, s, e.dps * e.structureDamageBonus * br.damageScale * dt, cfg, data);
  if (!isBreached(s, br.openHpRatio)) return true;
  push(b, { t: round2(b.t), kind: 'structureBreach', structureId: s.id, key: s.key, x: s.x, y: s.y }, data);
  e.blockId = null;
  e.breachT = 0;
  return true;
}

/** ★ §19-F1(F08-3) — 서리에 잡힌 걸음. 얼지 않았으면 제 속도 그대로다. */
const paceOf = (e) => e.speed * (e.chill > 0 ? (e.chillFactor ?? 1) : 1);

function moveToward(e, tx, ty, dt, world, data) {
  const d = dist(e.x, e.y, tx, ty);
  if (d <= 0.001) return;
  const k = Math.min(1, (paceOf(e) * dt) / d);
  const nx = round2(e.x + (tx - e.x) * k);
  const ny = round2(e.y + (ty - e.y) * k);
  /* ★ §17-4 — 나는 것 말고는 물을 못 건넌다(피드백: "적이 물에 들어감").
     곧장이 막히면 생태계(§16-3)와 같은 축 미끄러짐 — 난수 없음, 결정론 유지. */
  if (e.flying || !world || !isWaterAt(world.map, nx, ny, data)) { e.x = nx; e.y = ny; return; }
  const step = Math.min(paceOf(e) * dt, d);
  const cand = [
    { x: round2(e.x + Math.sign(tx - e.x) * Math.min(step, Math.abs(tx - e.x))), y: e.y },
    { x: e.x, y: round2(e.y + Math.sign(ty - e.y) * Math.min(step, Math.abs(ty - e.y))) },
  ];
  for (const c of cand) {
    if ((c.x !== e.x || c.y !== e.y) && !isWaterAt(world.map, c.x, c.y, data)) { e.x = c.x; e.y = c.y; return; }
  }
}

/**
 * 부술 건물 고르기 — 가까운 셋 중 하나를 (결정론 rng 로) 고른다. 한 채만 집중해서 무너뜨리지 않는다.
 *
 * ★ Sprint 3 — 옛 구현은 적 하나가 본부에 닿을 때마다 건물 전부를 걸러 배열을 빚고, 다시 {건물,거리}
 *   짝을 빚고, 정렬한 뒤 셋만 남겼다. 서브틱마다 적 수십이 이 길을 지나므로 쓰레기가 쏟아진다.
 *   이제 **한 번만 훑으며 가장 가까운 셋을 손에 든다**. 결과는 옛것과 같다:
 *   JS 정렬은 안정 정렬이라 거리가 같으면 **먼저 온 것이 앞**이었고, 아래 끼워 넣기도
 *   같은 거리면 새로 온 것을 뒤에 세운다(`bd[i] <= d` 인 동안 지나친다).
 */
function pickStructure(nation, enemy, rng) {
  const best = [];
  const bd = [];
  for (const s of nation.structures || []) {
    if (isRuined(s)) continue;
    const d = dist(s.x, s.y, enemy.x, enemy.y);
    // 이미 셋이 찼고 그 셋보다 가깝지 않으면(같아도) 들어설 자리가 없다 — 안정 정렬과 같은 판정이다
    if (best.length >= 3 && d >= bd[2]) continue;
    let i = 0;
    while (i < best.length && bd[i] <= d) i += 1;
    best.splice(i, 0, s);
    bd.splice(i, 0, d);
    if (best.length > 3) { best.pop(); bd.pop(); }
  }
  if (!best.length) return null;
  return best[Math.min(best.length - 1, Math.floor(rng.next() * best.length))];
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
  /* ★ §16-4 — 화면은 서브틱 스냅샷 사이를 보간해 그린다. 「지금 자리」와 「직전 서브틱 자리」 중
     가까운 쪽을 재야 화면에서 닿는 놈이 서버에서도 닿는다(생태계 huntSwing 과 같은 규칙). */
  const reach = (e) => Math.min(
    dist(e.x, e.y, from.x, from.y),
    e.px != null ? dist(e.px, e.py, from.x, from.y) : Infinity,
  );
  let target = null;
  const wanted = cmd.targetId ?? cmd.payload?.targetId ?? null;
  if (wanted) target = living.find((e) => e.id === wanted) ?? null;
  if (!target) {
    let bd = Infinity;
    for (const e of living) { const d = reach(e); if (d < bd) { bd = d; target = e; } }
    if (target && bd > c.rangeTiles) target = null;
  }
  if (!target) return err('OUT_OF_RANGE', '닿지 않습니다.');
  if (reach(target) > c.rangeTiles + 0.6) {
    return err('OUT_OF_RANGE', '닿지 않습니다.');
  }

  markSwing(player, now, 'combat');
  /* ★ §13-D-3 — 무기가 얹는 배수. 스킬 도구(skills.json)와는 다른 축이라 곱해진다:
     레벨이 여는 것과 손으로 벼린 것이 서로를 갉아먹지 않는다. */
  const gearFx = equipEffects(player, data);
  /* ★ §20-R4(유물기획 §20-3) — 두 축을 옛 항 **뒤에** 덧붙인다(차례를 바꾸지 않는다):
     ① 용의 심장의 전투원 피해 배수 — stepBattle 의 터렛·민병과 같은 자를 쓴다.
     ② 번개의 창끝의 치명타 — 확률이 0이면 굴리지 않으므로 유물 없는 판의 난수는 불변이다. */
  const critFx = artifactCritRoll(world, nation);
  const dmg = round2(swingDamage(nation, player, data) * gearFx.damage * b.multipliers.defender
    * (nation.artifactCombat?.damage ?? 1) * critFx.multiplier);
  target.hp = round2(target.hp - dmg);
  b.playerDamage[avatarId] = round2((b.playerDamage[avatarId] || 0) + dmg);
  /* 치명타일 때만 칸을 실는다 — 타임라인은 그대로 저장·중계되는 물건이라, 늘 false 인 칸을
     하나 더 얹으면 옛 스냅샷과 낯이 달라진다(§21-A 전투 스트림 비교). */
  push(b, { t: round2(b.t), kind: 'playerHit', targetId: target.id, by: avatarId, damage: dmg, ...(critFx.crit ? { crit: true } : null) }, data);
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

  /* ★ §20-R1 — 유물의 격퇴 보상(노획한 투구의 골드 +25%, 용맹의 깃발의 사기 +5%p)이 여기서 붙는다.
     ★ §20-R1 미결: 「패배 시 인구 손실」 판정은 실시뮬 전환(GDD3 §6)으로 사라졌다. 용의 이빨·용맹의
     깃발의 populationLossMultiplier 는 그래서 아직 수집만 된다 — 그 판정이 돌아오면 이 자리에 꽂는다. */
  const hooks = collectHooks(nation, data);
  let moraleDelta = 0;
  if (b.won) moraleDelta += cfg.moraleBonusOnHold + (hooks.moraleDeltaOnVictory || 0);
  else moraleDelta -= cfg.moralePenaltyOnBreach;
  moraleDelta -= b.playersDowned * combatSkillCfg(data).downMoralePenalty;
  // ★ 사람 수 기준(militiaHurt). 옛 스냅샷에는 없는 값이라 없으면 횟수로 물러선다.
  moraleDelta -= (b.militiaHurt ?? b.militiaDowned) * cfg.militia.downMoralePenalty;
  nation.morale = clamp(round2((nation.morale ?? 1) + moraleDelta), m.min, m.max);

  const gold = b.won ? Math.round(b.power * cfg.rewardGoldPerPower * (hooks.rewardGoldMultiplier ?? 1)) : 0;
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
  const loot = battleRelic(world, nation, data, result);
  if (loot) result.artifact = loot;

  advanceWave(nation, {
    index: result.index, type: result.type, name: result.name, tick: result.tick,
    won: result.won, enemiesKilled: result.enemiesKilled, enemiesTotal: result.enemiesTotal,
  });
  // ★ Sprint 5 — 야영지와 함께 남은 경비도 걷는다(나라를 넘겨 줘야 그 나라의 짐승 목록을 훑는다)
  clearCamps(world, b.waveIndex, nation);
  nation.battlePlan = null;
  nation.battle = null;
  /* ★ Sprint 3 — 세이브에 남기는 몫만 자른다. 타임라인은 웨이브 하나에 수백 줄이고
     nation.lastBattleResult 는 스냅샷에 통째로 실려 저장 파일을 계속 부풀린다(뷰는 개수만 쓴다).
     **돌려주는 result 는 온전하다** — 연대기·리플레이·회귀 시험이 보는 것은 그쪽이다. */
  const keep = data.world.simulation?.battleResultTimelineMax ?? 200;
  nation.lastBattleResult = keep > 0 && result.timeline.length > keep
    ? { ...result, timeline: result.timeline.slice(-keep) }
    : result;
  /* ★ Sprint 2 — 종이 그쳤다. 저마다 제 일터의 발치로 돌아간다. */
  standDown(world, nation, data);
  return result;
}

function battleRelic(world, nation, data, result) {
  const cfg = data.balance.artifacts.battleLoot;
  if (!cfg || !result.won || result.number < cfg.minWave || result.enemiesTotal < cfg.minEnemies || result.power < cfg.minPower) return null;
  const flawless = result.playersDowned === 0 && result.militiaDowned === 0 && result.fencesBroken === 0;
  const chance = Math.min(cfg.cap, cfg.base + Math.max(0, result.number - cfg.minWave) * cfg.perWave + (flawless ? cfg.flawlessBonus : 0));
  const rng = statRng(`${world.seed}:battleLoot:${nation.id}:${result.index}`);
  return grantVia(world, nation, data, rng, { via: 'battle:elite', chance }, world.tick);
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
/** 온전한 한 판 — battleStart · 되맞춤 · NationView 가 쓴다(서브틱 스트림은 아래 델타가 나른다). */
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
    turrets: turretRows(nation, data),
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

/* ★ §21-A2 — battleTick 을 나눠 보낸다.
   「왜」. 서브틱은 초에 넷이다. 그 넷 모두에 적·민병·터렛·플레이어 **전량**을 실었더니 전투 중
   초당 수십 KB 가 사람마다 나갔다. 그런데 그 안에서 서브틱마다 실제로 달라지는 것은 **적의 좌표**뿐이다:
   터렛은 전투 내내 한 자리에 서 있고(사거리·종류도 그대로), 이름·최대 체력·도읍 자리는 전투가
   끝날 때까지 한 글자도 안 바뀌며, 민병의 걸음은 절반 박자로도 족하다 — 화면은 GM.interp 가
   박자를 **스스로 배워** 그 사이를 이어 준다(public/js/interp.js learnGap).
   그래서 나눈다. **적은 4Hz 그대로다** — 보간의 전제이고, 여기를 줄이면 걸음이 끊긴다.
   민병·터렛은 2Hz 의 **바뀐 줄만**, 플레이어는 바뀔 때만, 정적 필드는 아예 안 보낸다.
   잃어버린 한 장을 되찾는 길은 둘: 입장·개시의 풀 스냅샷(battleStart)과,
   `world.json simulation.battleFullEvery` 서브틱마다 한 번 끼워 넣는 되맞춤(`full:true`).
   판정은 한 눈금도 안 바뀐다 — 여기는 전송 계층이고, 캐시는 월드가 아니라 서버 런타임이 쥔다. */
const FULL_EVERY = 40;
const fullEvery = (data) => Math.max(1, data.world?.simulation?.battleFullEvery ?? FULL_EVERY);

const turretRows = (nation, data) => turretList(nation, data)
  .map((t) => ({ id: t.id, x: t.x, y: t.y, range: t.range, key: t.key }));
const playerList = (nation) => Object.values(nation.players || {});
const militiaSig = (m) => `${m.x},${m.y},${round2(m.hp)},${m.alive ? 1 : 0}`;
const playerSig = (p) => `${round2(p.hp ?? 0)},${p.maxHp},${(p.downUntil || 0) > 0 ? 1 : 0}`;

/* 델타 한 줄 = 그 유닛의 **동적 필드 한 벌**이다. 빠진 칸은 거짓으로 읽고(looting·alive·down),
   정적 칸(최대 체력·생김새)은 그 줄이 처음 실릴 때만 붙인다. */
function enemyRow(e, fresh) {
  const o = { id: e.id, x: e.x, y: e.y, hp: round2(e.hp) };
  if (e.looting > 0) o.looting = true;
  if (fresh) { o.maxHp = e.maxHp; o.type = e.type; }
  return o;
}

function militiaRow(m, fresh) {
  const o = { id: m.id, x: m.x, y: m.y, hp: round2(m.hp) };
  if (!m.alive) o.alive = false;
  if (fresh) o.maxHp = m.maxHp;
  return o;
}

/** 사람은 손에 꼽는다 — 최대 체력(능력치로 자란다)까지 늘 함께 싣는다. */
function playerRow(p) {
  const o = { id: p.id, hp: round2(p.hp ?? 0), maxHp: p.maxHp };
  if ((p.downUntil || 0) > 0) o.down = true;
  return o;
}

/** 방 하나가 「지금까지 무엇을 받았는지」 — 서버 런타임이 들고 다닌다(세이브에 넣지 않는다). */
export function battleStreamCache() {
  return { n: 0, enemies: new Set(), militia: new Map(), players: new Map(), turrets: '' };
}

function rememberAll(cache, nation, snap) {
  cache.n = 1;
  cache.enemies = new Set(snap.enemies.map((e) => e.id));
  cache.militia = new Map(nation.battle.militia.map((m) => [m.id, militiaSig(m)]));
  cache.players = new Map(playerList(nation).map((p) => [p.id, playerSig(p)]));
  cache.turrets = JSON.stringify(snap.turrets);
}

/**
 * 풀 스냅샷 한 장 — battleStart · 되맞춤. 방 전체에 보내는 것이면 cache 를 넘겨
 * 「방금 이만큼을 보냈다」를 새긴다(한 사람에게만 보내는 되맞춤은 cache 를 건드리지 않는다).
 */
export function battleFull(nation, data, cache) {
  const snap = battleSnapshot(nation, data);
  if (!snap) return null;
  if (cache) rememberAll(cache, nation, snap);
  return { ...snap, full: true };
}

/** 서브틱 한 장 — 되맞춤 차례면 풀 스냅샷, 아니면 델타. */
export function battleStreamTick(nation, data, cache) {
  if (!nation.battle) return null;
  if (cache.n % fullEvery(data) === 0) return battleFull(nation, data, cache);
  cache.n += 1;
  return battleDelta(nation, data, cache);
}

/** 살아 있는 적 전량 — 4Hz. 처음 보는 놈에게만 생김새·최대 체력을 붙인다. */
function enemyRows(b, cache) {
  const out = [];
  const live = new Set();
  for (const e of b.enemies) {
    if (!e.alive) continue;
    live.add(e.id);
    out.push(enemyRow(e, !cache.enemies.has(e.id)));
  }
  cache.enemies = live;
  return out;
}

/** 지난번과 달라진 줄만 — 같은 값이면 아예 싣지 않는다. */
function changedRows(list, seen, sig, row) {
  const out = [];
  for (const it of list) {
    const s = sig(it);
    if (seen.get(it.id) === s) continue;
    out.push(row(it, !seen.has(it.id)));
    seen.set(it.id, s);
  }
  return out;
}

/** 터렛은 전투 내내 한 자리다 — 목록이 실제로 달라졌을 때만 통째로 다시 보낸다. */
function turretDelta(nation, data, cache) {
  const list = turretRows(nation, data);
  const sig = JSON.stringify(list);
  if (sig === cache.turrets) return null;
  cache.turrets = sig;
  return list;
}

/** 민병·터렛은 절반 박자(2Hz)에만 얹는다 — 이 한 장이 그 차례인가. */
function addSlowRows(out, nation, data, cache) {
  if (cache.n % 2 !== 0) return out;
  const militia = changedRows(nation.battle.militia, cache.militia, militiaSig, militiaRow);
  if (militia.length) out.militia = militia;
  const turrets = turretDelta(nation, data, cache);
  if (turrets) out.turrets = turrets;
  return out;
}

function battleDelta(nation, data, cache) {
  const b = nation.battle;
  const out = {
    full: false, waveIndex: b.waveIndex, t: round2(b.t), over: b.over, won: b.won,
    killed: b.killed, escaped: b.escaped, enemies: enemyRows(b, cache),
  };
  const players = changedRows(playerList(nation), cache.players, playerSig, playerRow);
  if (players.length) out.players = players;
  return addSlowRows(out, nation, data, cache);
}
