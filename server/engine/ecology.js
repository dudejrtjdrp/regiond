// 상시 생태계 — docs/GDD3.md §13-C. 웨이브와 **완전히 별개**다.
//
// 웨이브는 날짜를 잡고 몰려오는 사건이고(waves.js·battle.js), 여기 있는 것들은 그냥 그 땅에 사는 것들이다.
// 닭이 풀밭을 쪼고, 사슴이 숲을 지나고, 굶주린 늑대가 울타리 밖을 서성인다.
//
// ★ 위치의 소유권 (§12-11 의 반대편 규칙).
//   주민은 **클라가** 위치를 쥔다 — 서버 좌표는 목표점일 뿐이라 보간이 리셋되지 않는다.
//   야생은 **서버가** 쥔다 — 자유 의지로 돌아다니는 것들이라 목표점만으로는 그림이 안 나온다.
//   대신 서버는 저빈도(stepSeconds=1초)로만 굴리고, 화면은 받은 좌표 **사이를 보간**해 그린다.
//   그래서 텔레포트가 나지 않는다: 클라는 서버 좌표로 '튀지' 않고 그리로 '다가간다'.
//
// ★ 울타리 (§13-C-2). 경로 탐색은 없다(A* 불요). 한 걸음이 살아 있는 울타리 조각을 **가로지르면**
//   그 걸음이 통째로 무효다. 문(gate)도 짐승은 못 연다. 그래서 울타리를 두른 안쪽은 정말로 안전하다.
import { townOf, territoryRadius, dist, terrainAt, terrainIndex, ringAt, ringRadii } from './world.js';
import { rngFromState } from './rng.js';
import { combatSkillCfg, ensurePlayer, canSwing, markSwing, grantXp, swingDamage, skillLevel } from './skills.js';
// ★ GDD3 §13-D-3 — 사냥에도 손에 든 것이 따라온다
import { equipEffects } from './equipment.js';
import { deposit } from './storage.js';
import { recordEncounter, recordKill } from './codex.js';
import { round2 } from './economy.js';

export const creatureCfg = (data) => data.creatures;
export const creatureDefs = (data) => data.creatures.defs;
export const simCfg = (data) => data.creatures.sim;
export const spawnCfg = (data) => data.creatures.spawn;
export const huntCfg = (data) => data.creatures.hunting;

const err = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ────────────────────────────────────────────────────────────────
// 상태
// ────────────────────────────────────────────────────────────────
export function ensureWild(nation) {
  const w = (nation.wild ||= {});
  w.creatures ||= [];
  w.nextId ??= 1;
  w.respawnQueue ||= [];
  w.rngState ??= null;
  w.acc ??= 0;
  return w;
}

/**
 * 생태계 전용 난수.
 * ★ 월드 rng(world.rngState)를 건드리지 않는다 — 실시간 루프가 그 상태를 축내면 같은 시드로 돌린
 *   일 틱·전투가 어긋난다(결정론 계약 위반). 생태계는 제 씨앗과 제 상태를 따로 들고 산다.
 */
function wildRng(world, nation) {
  const w = ensureWild(nation);
  const seed = ((world.seed >>> 0) ^ 0x5bf03635) >>> 0;
  const r = rngFromState(seed, w.rngState ?? undefined);
  return { r, save: () => { w.rngState = r.getState(); } };
}

// ────────────────────────────────────────────────────────────────
// 울타리 — 선분 가로막기 (§13-C-2)
// ────────────────────────────────────────────────────────────────
function ccw(ax, ay, bx, by, cx, cy) {
  return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
}

/** 두 선분이 실제로 교차하는가 (끝점이 스치는 것은 교차로 치지 않는다) */
export function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = ccw(cx, cy, dx, dy, ax, ay);
  const d2 = ccw(cx, cy, dx, dy, bx, by);
  const d3 = ccw(ax, ay, bx, by, cx, cy);
  const d4 = ccw(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * 이 한 걸음이 울타리를 뚫는가. 부서진 조각(hp<=0)은 막지 못한다 —
 * 웨이브가 울타리를 부순 밤에는 여우도 들어온다.
 */
export function crossesFence(nation, x0, y0, x1, y1) {
  for (const f of nation.fences || []) {
    if ((f.hp ?? 0) <= 0 || f.broken) continue;
    if (segmentsCross(x0, y0, x1, y1, f.x1, f.y1, f.x2, f.y2)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────
// 스폰
// ────────────────────────────────────────────────────────────────
function ringPool(data, ring) {
  const defs = creatureDefs(data);
  return data.creatures.order
    .map((k) => ({ key: k, def: defs[k] }))
    .filter(({ def }) => def && def.ring === ring);
}

function habitatOk(map, data, def, x, y) {
  if (!def.habitat?.length) return true;
  const idx = terrainIndex(data);
  const t = terrainAt(map, x, y);
  return def.habitat.some((c) => idx[c] === t);
}

/** 링 안 아무 자리 — 서식지가 맞고, 울타리 안이 아니고, 아바타 코앞이 아닌 곳 */
function pickSpawn(world, nation, data, def, ring, rng) {
  const town = townOf(world, nation.id);
  if (!town) return null;
  const size = world.map?.size ?? data.world.size;
  const { r0, r1 } = ringRadii(nation, data);
  const inner = ring === 0 ? territoryRadius(nation, data) + 2 : (ring === 1 ? r0 : r1);
  const outer = ring === 0 ? r0 : (ring === 1 ? r1 : r1 + 40);
  const minAvatar = spawnCfg(data).minSpawnDistance ?? 14;
  const water = terrainIndex(data).water;
  for (let i = 0; i < 40; i += 1) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(inner, outer);
    const x = Math.round(town.x + Math.cos(a) * r);
    const y = Math.round(town.y + Math.sin(a) * r);
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
    if (terrainAt(world.map, x, y) === water) continue;
    if (!habitatOk(world.map, data, def, x, y)) continue;
    // 눈앞에서 솟아나지 않는다
    let tooNear = false;
    for (const av of Object.values(nation.avatars || {})) {
      if (dist(av.x, av.y, x, y) < minAvatar) { tooNear = true; break; }
    }
    if (tooNear) continue;
    return { x, y };
  }
  return null;
}

function spawnOne(world, nation, data, key, ring, rng, at = null) {
  const def = creatureDefs(data)[key];
  if (!def) return null;
  const spot = at ?? pickSpawn(world, nation, data, def, ring, rng);
  if (!spot) return null;
  const w = ensureWild(nation);
  const c = {
    id: `w${w.nextId++}`,
    sp: key,
    x: spot.x, y: spot.y,
    tx: spot.x, ty: spot.y,
    hp: def.hp, maxHp: def.hp,
    ring,
    state: 'wander',
    retarget: 0,
    atkCd: 0,
    provoked: 0,
    seen: false,
  };
  w.creatures.push(c);
  return c;
}

/**
 * 링마다 정원을 채운다. 한 번에 몰아서 태우지 않고 부족분만 조금씩 — 세상이 '차오르는' 느낌이 나게.
 * @returns {Array} 이번에 태어난 것들
 */
export function ensureCreatures(world, nation, data, rngOverride = null) {
  const cfg = spawnCfg(data);
  const w = ensureWild(nation);
  const { r, save } = rngOverride ? { r: rngOverride, save: () => {} } : wildRng(world, nation);
  const born = [];
  const alive = w.creatures;
  if (alive.length >= (cfg.maxAlive ?? 90)) return born;
  for (const ring of [0, 1, 2]) {
    const want = cfg.perRing?.[String(ring)] ?? 0;
    const have = alive.filter((c) => c.ring === ring).length;
    const pool = ringPool(data, ring);
    if (!pool.length) continue;
    let need = Math.max(0, want - have);
    let guard = 0;
    while (need > 0 && guard++ < want * 3 + 12 && w.creatures.length < (cfg.maxAlive ?? 90)) {
      const pick = r.weighted(pool.map((p) => ({ value: p, weight: p.def.weight ?? 1 })));
      if (!pick) break;
      const first = spawnOne(world, nation, data, pick.key, ring, r);
      if (!first) { need -= 1; continue; }
      born.push(first);
      need -= 1;
      // 떼로 다니는 것들 — 들개·다이어울프는 곁에 몇을 더 데려온다
      const pack = pick.def.packSize;
      if (pack) {
        const extra = r.int(pack[0], pack[1]) - 1;
        for (let k = 0; k < extra && need > 0; k += 1) {
          const near = { x: first.x + r.int(-2, 2), y: first.y + r.int(-2, 2) };
          const mate = spawnOne(world, nation, data, pick.key, ring, r, near);
          if (mate) { born.push(mate); need -= 1; }
        }
      }
    }
  }
  save();
  return born;
}

// ────────────────────────────────────────────────────────────────
// 한 걸음
// ────────────────────────────────────────────────────────────────
function moveToward(nation, c, tx, ty, step) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return false;
  const nx = c.x + (dx / d) * Math.min(step, d);
  const ny = c.y + (dy / d) * Math.min(step, d);
  // ★ 울타리를 가로지르는 걸음은 통째로 무효다
  if (crossesFence(nation, c.x, c.y, nx, ny)) return false;
  c.x = Math.round(nx * 100) / 100;
  c.y = Math.round(ny * 100) / 100;
  return true;
}

function nearestAvatar(nation, c) {
  let best = null;
  let bestD = Infinity;
  for (const av of Object.values(nation.avatars || {})) {
    const p = nation.players?.[av.id];
    if ((p?.downUntil ?? 0) > 0) continue;      // 쓰러진 사람은 더 밟지 않는다
    const d = dist(av.x, av.y, c.x, c.y);
    if (d < bestD) { bestD = d; best = av; }
  }
  return best ? { avatar: best, d: bestD } : null;
}

/**
 * 저빈도 생태 시뮬 한 걸음.
 * @param {number} dt 초. 실시간 루프는 1초, 일 틱은 dayStepSeconds 를 한꺼번에 밀어 넣는다.
 * @returns {{events:Array, moved:number}}
 */
export function stepEcology(world, nation, data, dt = 1, opts = {}) {
  const cfg = simCfg(data);
  const w = ensureWild(nation);
  const { r, save } = wildRng(world, nation);
  const defs = creatureDefs(data);
  const events = [];
  const size = world.map?.size ?? data.world.size;
  const codexRadius = creatureCfg(data).codex?.encounterRadius ?? 9;

  // ── 쓰러진 사람 일으키기 (모닥불 부활) ──
  for (const p of Object.values(nation.players || {})) {
    if ((p.downUntil || 0) <= 0) continue;
    p.downUntil = Math.max(0, round2(p.downUntil - dt));
    if (p.downUntil === 0) p.hp = p.maxHp;
  }

  let moved = 0;
  for (const c of w.creatures) {
    const def = defs[c.sp];
    if (!def) continue;
    c.retarget = (c.retarget || 0) - dt;
    c.atkCd = Math.max(0, (c.atkCd || 0) - dt);
    c.provoked = Math.max(0, (c.provoked || 0) - dt);

    const near = nearestAvatar(nation, c);
    const speed = def.speed * dt;

    // ── 사람을 본 반응 ──
    const hostile = def.kind === 'predator';
    const wantsChase = near && (
      (hostile && near.d <= (def.aggroRadius || 0))
      || (c.provoked > 0 && near.d <= (cfg.chaseGiveUpTiles ?? 18))
    );
    const wantsFlee = near && !hostile && near.d <= (def.fleeRadius || 0);

    if (wantsChase) {
      c.state = 'chase';
      // 사거리 안이면 문다
      if (near.d <= (cfg.attackRangeTiles ?? 1.4)) {
        if (c.atkCd <= 0 && (def.dps || 0) > 0) {
          c.atkCd = cfg.attackEverySeconds ?? 1.2;
          const hit = bite(world, nation, def, near.avatar, data);
          if (hit) events.push(hit);
        }
      } else if (moveToward(nation, c, near.avatar.x, near.avatar.y, speed)) moved += 1;
    } else if (wantsFlee) {
      c.state = 'flee';
      const away = Math.atan2(c.y - near.avatar.y, c.x - near.avatar.x);
      const tx = clamp(c.x + Math.cos(away) * 4, 1, size - 2);
      const ty = clamp(c.y + Math.sin(away) * 4, 1, size - 2);
      if (moveToward(nation, c, tx, ty, speed * 1.15)) moved += 1;
    } else {
      c.state = 'wander';
      if (c.retarget <= 0) {
        c.retarget = cfg.wanderRetargetSeconds ?? 6;
        const a = r.float(0, Math.PI * 2);
        const rad = r.float(1, cfg.wanderRadius ?? 7);
        c.tx = clamp(Math.round(c.x + Math.cos(a) * rad), 1, size - 2);
        c.ty = clamp(Math.round(c.y + Math.sin(a) * rad), 1, size - 2);
      }
      if (!moveToward(nation, c, c.tx, c.ty, speed * 0.55)) c.retarget = 0;
      else moved += 1;
    }

    // ── 도감: 처음 눈에 든 순간 (§13-C-3) ──
    if (!c.seen && near && near.d <= codexRadius) {
      c.seen = true;
      recordEncounter(nation, c.sp, world.tick);
      events.push({ kind: 'creature_seen', nationId: nation.id, data: { species: c.sp, name: def.name, id: c.id } });
    }
  }
  save();
  return { events, moved };
}

/** 짐승이 사람을 문다. 죽음은 없다 — 쓰러지면 모닥불에서 일어난다(GDD3 §6 기존 규칙). */
function bite(world, nation, def, avatar, data) {
  const p = ensurePlayer(nation, avatar.id, data, avatar.name ?? null);
  if ((p.downUntil || 0) > 0) return null;
  const c = combatSkillCfg(data);
  const dmg = round2((def.dps || 0) * (data.creatures.sim.attackEverySeconds ?? 1.2));
  p.hp = round2(Math.max(0, (p.hp ?? p.maxHp) - dmg));
  if (p.hp > 0) {
    return { kind: 'wild_hit', nationId: nation.id, data: { avatarId: avatar.id, damage: dmg, hp: p.hp, by: def.name } };
  }
  // 다운 — 모닥불 자리에서 일어난다
  p.downUntil = c.downSeconds;
  nation.morale = Math.max(data.balance.morale.min, (nation.morale ?? 1) - c.downMoralePenalty);
  const town = townOf(world, nation.id);
  if (town) { avatar.x = town.x; avatar.y = town.y; }
  return {
    kind: 'player_down', nationId: nation.id,
    data: {
      avatarId: avatar.id, by: def.name, downSeconds: c.downSeconds,
      x: town?.x ?? avatar.x, y: town?.y ?? avatar.y,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// 사냥 — combatSwing 이 전투 밖에서도 통한다 (§13-C-8)
// ────────────────────────────────────────────────────────────────
export function creatureById(nation, id) {
  return (nation.wild?.creatures || []).find((c) => c.id === id) ?? null;
}

/**
 * 사냥 스윙. 웨이브 전투가 아닐 때의 combatSwing 이 여기로 온다.
 * 서버가 쥐는 것: 쿨타임 · 사거리 · 다운 상태 · 드롭. 클라는 이펙트만 만든다.
 */
export function huntSwing(world, nation, cmd, data, now = Date.now()) {
  const cfgC = combatSkillCfg(data);
  const avatarId = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const player = ensurePlayer(nation, avatarId, data, cmd.playerName ?? null);
  if ((player.downUntil || 0) > 0) return err('DOWNED', '아직 일어서지 못했습니다.');
  const w = ensureWild(nation);
  if (!w.creatures.length) return err('NO_TARGET', '벨 것이 없습니다.');

  const av = nation.avatars?.[avatarId];
  const from = av ? { x: av.x, y: av.y } : (townOf(world, nation.id) ?? { x: 0, y: 0 });
  const range = cfgC.huntRangeTiles ?? cfgC.rangeTiles;
  const wanted = cmd.targetId ?? cmd.payload?.targetId ?? null;
  let target = wanted ? creatureById(nation, wanted) : null;
  if (!target) {
    let best = null;
    let bestD = Infinity;
    for (const c of w.creatures) {
      const d = dist(c.x, c.y, from.x, from.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD <= range + 0.6) target = best;
  }
  if (!target) return err('NO_TARGET', '닿는 곳에 짐승이 없습니다.');
  if (dist(target.x, target.y, from.x, from.y) > range + 0.6) return err('OUT_OF_RANGE', '닿지 않습니다.');

  const cd = canSwing(nation, player, 'combat', data, now);
  if (!cd.ok) return err('COOLDOWN', '아직 휘두를 수 없습니다.', { waitMs: cd.waitMs, cooldownMs: cd.cooldownMs });

  markSwing(player, now, 'combat');
  const def = creatureDefs(data)[target.sp];
  // ★ §13-D-3 — 손에 든 것은 웨이브에서나 들판에서나 같은 검이다(§13-C-8 과 같은 규칙).
  const gearFx = equipEffects(player, data);
  const dmg = round2(swingDamage(nation, player, data) * gearFx.damage);
  target.hp = round2(target.hp - dmg);
  // 맞으면 덤빈다 — 온순한 짐승도 성이 나고, 포식자는 끝까지 쫓는다
  target.provoked = simCfg(data).provokedSeconds ?? 20;
  if (!target.seen) { target.seen = true; recordEncounter(nation, target.sp, world.tick); }

  let xp = grantXp(player, 'combat', cfgC.xpPerHit, data);
  let killed = false;
  const gained = {};
  if (target.hp <= 0) {
    killed = true;
    /* ★ §13-D-3 — 무기의 '사냥 효율'. 좋은 칼은 더 빨리 벨 뿐 아니라 더 곱게 발라낸다. */
    const huntBonus = 1 + (gearFx.huntYield || 0);
    for (const [res, n] of Object.entries(def.drops || {})) {
      const got = deposit(nation, res, round2(n * huntBonus), data);
      if (got > 0) gained[res] = got;
    }
    player.stats.kills = (player.stats.kills || 0) + 1;
    recordKill(nation, target.sp, world.tick);
    removeCreature(nation, target, data, world.tick);
    xp = grantXp(player, 'combat', cfgC.xpPerHuntKill ?? cfgC.xpPerKill, data);
  }
  return {
    ok: true,
    hunt: true,
    targetId: target.id,
    species: target.sp,
    speciesName: def.name,
    damage: dmg,
    targetHp: Math.max(0, target.hp),
    killed,
    gained,
    x: target.x, y: target.y,
    cooldownMs: cd.cooldownMs,
    skill: 'combat',
    level: skillLevel(player, 'combat'),
    leveled: xp.leveled,
    xp: round2(player.skills.combat.xp),
  };
}

function removeCreature(nation, c, data, tick) {
  const w = ensureWild(nation);
  const i = w.creatures.indexOf(c);
  if (i >= 0) w.creatures.splice(i, 1);
  w.respawnQueue.push({ ring: c.ring, at: tick + (spawnCfg(data).respawnDays ?? 1) });
  return c;
}

// ────────────────────────────────────────────────────────────────
// 일 틱 — 하루치 몰아 돌리기 · 리스폰 · 사냥꾼 오두막
// ────────────────────────────────────────────────────────────────
/**
 * 하루에 한 번. 접속자가 없어도 세상은 멎지 않는다:
 *   ① 정원을 채우고 ② 잡힌 것들의 리스폰 날을 처리하고 ③ dayStepSeconds 만큼 몰아서 굴린다.
 * 실시간 루프(server/index.js)와 겹쳐도 문제가 없다 — 둘 다 같은 함수를 다른 dt 로 부를 뿐이다.
 */
export function stepEcologyDay(world, nation, data) {
  if (!nation.isPlayer) return [];
  const w = ensureWild(nation);
  const events = [];
  w.respawnQueue = (w.respawnQueue || []).filter((q) => q.at > world.tick);
  events.push(...(ensureCreatures(world, nation, data).length
    ? [{ kind: 'wild_spawned', nationId: nation.id, data: { alive: w.creatures.length } }] : []));
  const dt = simCfg(data).dayStepSeconds ?? 30;
  const r = stepEcology(world, nation, data, dt);
  events.push(...r.events);
  return events;
}

/**
 * 사냥꾼 오두막의 하루 수확 (§13-C-8).
 * 배치된 주민이 근처 짐승을 잡아 온다 — **짐승이 남아 있어야** 난다(nearbyRadius 안의 마릿수가 뚜껑이다).
 * 이따금 실제로 한 마리를 솎아 낸다(cullChance) — 도감의 처치 수에는 넣지 않는다. 잡은 것은 주민이지
 * 플레이어가 아니고, 도감은 「내가 무엇을 보고 무엇을 잡았는가」의 기록이기 때문이다.
 */
export function huntYield(world, nation, data) {
  const cfg = huntCfg(data);
  const out = { resources: {}, workers: 0, huts: 0, animals: 0 };
  const huts = (nation.structures || []).filter((s) => s.key === 'hunter_hut' && !s.inactive && (s.hp ?? 1) > 0);
  if (!huts.length) return out;
  out.huts = huts.length;
  const w = ensureWild(nation);
  const town = townOf(world, nation.id);
  const near = w.creatures.filter((c) => creatureDefs(data)[c.sp]?.kind === 'animal'
    && town && dist(c.x, c.y, town.x, town.y) <= (cfg.nearbyRadius ?? 22));
  out.animals = near.length;
  if (!near.length) return out;

  let capacity = Math.floor(near.length / Math.max(1, cfg.animalsPerWorker ?? 3));
  for (const hut of huts) {
    if (capacity <= 0) break;
    const workers = (nation.villagers || []).filter((u) => u.targetId === hut.id).length;
    if (workers <= 0) continue;
    const mult = cfg.tierMultiplier?.[Math.max(0, (hut.tier || 1) - 1)] ?? 1;
    const use = Math.min(workers, capacity);
    capacity -= use;
    out.workers += use;
    for (const [res, per] of Object.entries(cfg.perWorkerPerDay || {})) {
      out.resources[res] = round2((out.resources[res] || 0) + per * use * mult);
    }
  }
  return out;
}

/**
 * 사냥꾼이 실제로 한 마리를 솎아 낸다 — 짐승이 무한하지 않다는 감각.
 * ★ 여기서도 **월드 rng 를 쓰지 않는다.** 생태계가 세계의 난수를 한 번이라도 축내면
 *   그 뒤의 웨이브 구성·사건·이름이 통째로 밀려, 같은 시드로 잰 밸런스가 어긋난다
 *   (실제로 그 사고가 났다: 사냥꾼 오두막이 선 판만 웨이브5 생존율이 65%→40% 로 떨어졌다).
 */
export function cullForHunters(world, nation, data) {
  const cfg = huntCfg(data);
  if (!(cfg.cullChancePerDay > 0)) return null;
  const y = huntYield(world, nation, data);
  if (!(y.workers > 0)) return null;
  const { r: rng, save } = wildRng(world, nation);
  const roll = rng.chance(cfg.cullChancePerDay);
  save();
  if (!roll) return null;
  const w = ensureWild(nation);
  const town = townOf(world, nation.id);
  const prey = w.creatures.find((c) => creatureDefs(data)[c.sp]?.kind === 'animal'
    && town && dist(c.x, c.y, town.x, town.y) <= (cfg.nearbyRadius ?? 22));
  if (!prey) return null;
  removeCreature(nation, prey, data, world.tick);
  return prey;
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
/** 화면이 그릴 것 — 아바타 둘레 viewRadius 안만. 지도 전체를 흘리면 정찰이 무의미해진다. */
export function creatureViews(world, nation, data) {
  const w = nation.wild;
  if (!w?.creatures?.length) return [];
  const defs = creatureDefs(data);
  const radius = simCfg(data).viewRadius ?? 46;
  const eyes = [
    ...Object.values(nation.avatars || {}),
    ...(townOf(world, nation.id) ? [townOf(world, nation.id)] : []),
  ];
  const out = [];
  for (const c of w.creatures) {
    if (!eyes.some((e) => dist(e.x, e.y, c.x, c.y) <= radius)) continue;
    const def = defs[c.sp];
    out.push({
      id: c.id, sp: c.sp, name: def?.name ?? c.sp, kind: def?.kind ?? 'animal',
      x: c.x, y: c.y, hp: round2(c.hp), maxHp: c.maxHp, ring: c.ring, state: c.state,
    });
  }
  return out;
}

export { ringAt };
