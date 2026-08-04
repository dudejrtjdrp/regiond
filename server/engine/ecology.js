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
import {
  townOf, territoryRadius, dist, terrainAt, terrainIndex, ringAt, ringRadii, inTerritory,
} from './world.js';
import { isRuined, turretList } from './structures.js';
import { rngFromState } from './rng.js';
import {
  combatSkillCfg, ensurePlayer, canSwing, markSwing, grantXp, swingDamage, skillLevel,
  // ★ GDD3 §14-5·§14-6 — 능력치가 낸 최대 HP · 일어난 직후의 무적 · 행운
  playerMaxHp, isInvulnerable, statEffects, playerLevel,
} from './skills.js';
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
// ────────────────────────────────────────────────────────────────
// ★ GDD3 §14-4 — 영토 진입 금지 · 목장
//
// 피드백: "동물이 마을 한복판을 걸어 다닌다". 울타리(§13-C-2)는 **친 곳만** 막았으므로,
// 아직 울타리를 두르지 않은 초반에는 여우도 늑대도 광장을 가로질렀다.
// 이제 **영토 경계 자체**가 벽이다(웨이브는 예외다 — 그쪽은 battle.js 의 별도 계층이다).
//
// 다만 벽만 세우면 목축이 사라진다. 그래서 **목장**을 냈다: 목장이 서면 그 둘레
// ranchRadius 안쪽만은 **온순한 짐승**에게 열린다. 포식자에게는 여전히 닫혀 있다.
// ────────────────────────────────────────────────────────────────
export const ranchCfg = (data) => data.creatures.ranch ?? { building: 'ranch', radius: 6 };

/** 다 지어져 효과가 도는 목장들 */
function activeRanches(nation, data) {
  const key = ranchCfg(data).building ?? 'ranch';
  return (nation.structures || []).filter((s) => s.key === key && !s.inactive && !isRuined(s));
}

/**
 * 이 종이 이 자리(영토 안)에 들어와도 되는가 — 목장이 여는 유일한 문.
 * @param {string} sp 종 열쇠말
 */
export function ranchOpenFor(world, nation, data, sp, x, y) {
  const def = creatureDefs(data)[sp];
  if (!def || def.kind !== 'animal') return false;          // 사나운 것은 목장이 있어도 못 든다
  const cfg = ranchCfg(data);
  const r = cfg.radius ?? 6;
  for (const s of activeRanches(nation, data)) {
    const fp = data.buildings?.[s.key]?.footprint ?? [1, 1];
    const cx = s.x + (fp[0] - 1) / 2;
    const cy = s.y + (fp[1] - 1) / 2;
    if (dist(cx, cy, x, y) <= r) return true;
  }
  return false;
}

/** 짐승이 이 칸에 설 수 있는가 — 영토 밖이면 언제나 참, 안이면 목장이 열어 준 자리만 */
export function creatureMayStand(world, nation, data, c, x, y) {
  if (!inTerritory(world, nation, Math.round(x), Math.round(y), data)) return true;
  return ranchOpenFor(world, nation, data, c.sp, x, y);
}

/**
 * 이미 영토 안에 서 있는 것을 바깥으로 민다(§14-4 "이미 안이면 밀어냄").
 * 본부에서 멀어지는 쪽으로 곧게 민다 — 경로 탐색은 하지 않는다(울타리도 여기서는 안 따진다:
 * 안에 갇힌 짐승을 울타리가 다시 붙들면 영영 못 나간다).
 *
 * ★ `retarget` 은 건드리지 않는다. 여기서 0 으로 되돌리면 다음 걸음이 곧바로 새 목적지를 뽑아
 *   **생태계 난수를 한 번 더 축낸다** — 그 한 톨이 사냥꾼 오두막의 수확을 밀고, 밀린 식량이
 *   봇의 건설 차례를 바꿔, 같은 씨앗의 웨이브 결과가 뒤집힌다(실측: 씨앗 53 이 실제로 뒤집혔다).
 * @returns {boolean} 밀었는가
 */
function pushOutOfTerritory(world, nation, data, c, step) {
  const town = townOf(world, nation.id);
  if (!town) return false;
  const dx = c.x - town.x;
  const dy = c.y - town.y;
  const d = Math.hypot(dx, dy);
  const ux = d > 0.01 ? dx / d : 1;
  const uy = d > 0.01 ? dy / d : 0;
  const push = Math.max(step, 0.6);
  const size = world.map?.size ?? data.world.size;
  c.x = clamp(Math.round((c.x + ux * push) * 100) / 100, 1, size - 2);
  c.y = clamp(Math.round((c.y + uy * push) * 100) / 100, 1, size - 2);
  return true;
}

/**
 * 목적지가 영토 안이면 **경계 밖으로 밀어낸 자리**를 대신 준다.
 *
 * 왜 목적지를 고치나: 목적지를 그대로 두고 걸음만 막으면, 경계를 마주 본 짐승이 매 걸음 막혀
 * `retarget = 0` 을 부르고, 그때마다 난수를 두 번씩 더 뽑는다. 그 어긋남이 쌓이면 같은 씨앗의
 * 밸런스가 통째로 밀린다(§13-C 가 생태계 난수를 세계 난수와 갈라 놓은 것과 같은 까닭이다).
 * 목적지를 미리 고치면 **난수를 한 톨도 더 쓰지 않고** 짐승이 애초에 안쪽을 겨누지 않는다.
 */
function keepTargetOutside(world, nation, data, c, tx, ty) {
  if (creatureMayStand(world, nation, data, c, tx, ty)) return { x: tx, y: ty };
  const town = townOf(world, nation.id);
  if (!town) return { x: tx, y: ty };
  const size = world.map?.size ?? data.world.size;
  const r = territoryRadius(nation, data) + 2;
  const dx = tx - town.x;
  const dy = ty - town.y;
  const d = Math.hypot(dx, dy);
  const ux = d > 0.01 ? dx / d : 1;
  const uy = d > 0.01 ? dy / d : 0;
  return {
    x: clamp(Math.round(town.x + ux * r), 1, size - 2),
    y: clamp(Math.round(town.y + uy * r), 1, size - 2),
  };
}

function moveToward(world, nation, data, c, tx, ty, step) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return false;
  const nx = c.x + (dx / d) * Math.min(step, d);
  const ny = c.y + (dy / d) * Math.min(step, d);
  // ★ 울타리를 가로지르는 걸음은 통째로 무효다
  if (crossesFence(nation, c.x, c.y, nx, ny)) return false;
  // ★ §14-4 — 영토 안으로 들어서는 걸음도 통째로 무효다(목장이 연 자리는 예외)
  if (!creatureMayStand(world, nation, data, c, nx, ny)) return false;
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

  /* ── 쓰러진 사람 일으키기 (모닥불 부활) ──
     ★ GDD3 §14-6 — 일어나는 순간이 이제 **사건**이다: 체력 절반 · 짧은 무적 · 자리는 본부.
        화면은 이 이벤트를 받아 카운트다운을 걷고 무적 표시를 띄운다. */
  const cCfg = combatSkillCfg(data);
  const town0 = townOf(world, nation.id);
  for (const p of Object.values(nation.players || {})) {
    if ((p.invulnUntil || 0) > 0) p.invulnUntil = Math.max(0, round2(p.invulnUntil - dt));
    if ((p.downUntil || 0) <= 0) continue;
    p.downUntil = Math.max(0, round2(p.downUntil - dt));
    if (p.downUntil > 0) continue;
    p.maxHp = playerMaxHp(p, data);
    p.hp = round2(p.maxHp * (cCfg.reviveHpRatio ?? 0.5));
    p.invulnUntil = cCfg.invulnSeconds ?? 3;
    const av = nation.avatars?.[p.id];
    if (av && town0) { av.x = town0.x; av.y = town0.y; }
    events.push({
      kind: 'player_revived', nationId: nation.id,
      data: {
        avatarId: p.id, hp: p.hp, maxHp: p.maxHp,
        invulnSeconds: p.invulnUntil,
        x: town0?.x ?? av?.x ?? 0, y: town0?.y ?? av?.y ?? 0,
      },
    });
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

    /* ── 도감: 처음 눈에 든 순간 (§13-C-3) ──
       ★ 걸음보다 **먼저** 센다. 밀려나는 놈도 눈에는 들었기 때문이다(§14-4 로 이 갈래가 생겼다). */
    if (!c.seen && near && near.d <= codexRadius) {
      c.seen = true;
      recordEncounter(nation, c.sp, world.tick);
      events.push({ kind: 'creature_seen', nationId: nation.id, data: { species: c.sp, name: def.name, id: c.id } });
    }

    /* ★ §14-4 — 이미 영토 안에 서 있으면 무엇보다 먼저 밖으로 민다.
       (지도가 다시 그려졌거나 영토가 자라 그 자리를 삼켰을 때, 그리고 웨이브가 헐고 간 뒤에 생긴다.
        목장이 연 자리는 그대로 둔다.) 미는 동안에는 물지도 도망가지도 않는다 — 나가는 것이 먼저다. */
    if (!creatureMayStand(world, nation, data, c, c.x, c.y)) {
      pushOutOfTerritory(world, nation, data, c, Math.max(speed, 0.6));
      c.state = 'flee';
      moved += 1;
      continue;
    }

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
      } else if (moveToward(world, nation, data, c, near.avatar.x, near.avatar.y, speed)) moved += 1;
    } else if (wantsFlee) {
      c.state = 'flee';
      const away = Math.atan2(c.y - near.avatar.y, c.x - near.avatar.x);
      const tx = clamp(c.x + Math.cos(away) * 4, 1, size - 2);
      const ty = clamp(c.y + Math.sin(away) * 4, 1, size - 2);
      if (moveToward(world, nation, data, c, tx, ty, speed * 1.15)) moved += 1;
    } else {
      c.state = 'wander';
      if (c.retarget <= 0) {
        c.retarget = cfg.wanderRetargetSeconds ?? 6;
        const a = r.float(0, Math.PI * 2);
        const rad = r.float(1, cfg.wanderRadius ?? 7);
        /* ★ §14-4 — 목적지를 뽑은 **그 자리에서** 영토 밖으로 밀어낸다(난수를 더 쓰지 않는다) */
        const want = keepTargetOutside(world, nation, data, c,
          clamp(Math.round(c.x + Math.cos(a) * rad), 1, size - 2),
          clamp(Math.round(c.y + Math.sin(a) * rad), 1, size - 2));
        c.tx = want.x;
        c.ty = want.y;
      }
      if (!moveToward(world, nation, data, c, c.tx, c.ty, speed * 0.55)) c.retarget = 0;
      else moved += 1;
    }
  }
  save();
  /* ★ §15-A-1 — 터렛은 웨이브만 기다리지 않는다. 들의 것이 사거리에 들면 그 자리에서 쏜다. */
  const guard = turretGuard(world, nation, data, dt);
  return { events, moved, shots: guard.shots, kills: guard.kills };
}

// ────────────────────────────────────────────────────────────────
// ★ 터렛 상시 사격 (GDD3 §15-A-1·2·3)
//
// P0 실측 (씨앗 20260805 · 화살탑 3기 · 900초):
//   ① 터렛 판정은 `battle.js stepBattle` **한 곳에만** 있었다. 웨이브가 아닌 시간에는
//      터렛이 코드상 아무 일도 하지 않는다 — 깎은 체력 총합 0.00, 처치 0.
//   ② 게다가 §14-4 가 짐승을 영토 밖으로 못박은 뒤로, 본부 옆(+5칸)에 세운 사거리 7 터렛은
//      **기하학적으로도** 닿을 수 없었다(영토 반경 T3=16 → 최근접 실측 11.05칸).
//      그래서 사거리 원(§15-A-4)이 함께 들어간다: 어디에 세워야 닿는지가 보여야 한다.
//
// 규칙
//   · 웨이브 중에는 쉰다 — 그 시각의 터렛은 stepBattle 이 이미 굴린다(사격을 두 번 세지 않는다).
//   · 목장이 열어 준 자리에 든 온순한 짐승은 **가축**이다. 쏘지 않는다(§15-A-3).
//     그 밖의 짐승·포식자는 온순하든 사납든 모두 쏜다(사용자: "동물들과 적을 모두 공격").
//   · 처치 드롭은 그 자리에서 국고로 간다. 저장 상한은 `deposit` 이 그대로 지킨다(§15-A-2).
// ────────────────────────────────────────────────────────────────
export const guardCfg = (data) => data.creatures?.turretGuard ?? {
  enabled: true, fireEverySeconds: 1.5, dropMultiplier: 0.6,
  counterMultiplier: 1.5, maxShotsPerStep: 4, skipDuringBattle: true,
};

/** 이 터렛이 겨눌 만한 가장 가까운 것 (목장 가축은 건너뛴다) */
function pickGuardTarget(world, nation, data, t, defs) {
  let best = null;
  let bd = t.range;
  for (const c of nation.wild?.creatures || []) {
    const def = defs[c.sp];
    if (!def) continue;
    if (def.kind === 'animal' && ranchOpenFor(world, nation, data, c.sp, c.x, c.y)) continue;
    const d = dist(c.x, c.y, t.x, t.y);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * 저빈도 루프 한 걸음만큼의 터렛 사격.
 * @returns {{shots:Array, kills:Array}} 화면이 쏘는 그림과 뜬 수치를 만드는 재료
 */
export function turretGuard(world, nation, data, dt = 1) {
  const cfg = guardCfg(data);
  const out = { shots: [], kills: [] };
  if (cfg.enabled === false) return out;
  if (cfg.skipDuringBattle !== false && nation.battle && !nation.battle.over) return out;
  const w = ensureWild(nation);
  if (!w.creatures.length) return out;
  const turrets = turretList(nation, data);
  if (!turrets.length) return out;

  const defs = creatureDefs(data);
  const every = Math.max(0.25, cfg.fireEverySeconds ?? 1.5);
  const maxShots = Math.max(1, cfg.maxShotsPerStep ?? 4);
  const dropMult = cfg.dropMultiplier ?? 0.6;
  const byId = new Map((nation.structures || []).map((s) => [s.id, s]));

  for (const t of turrets) {
    const s = byId.get(t.id);
    if (!s) continue;
    s.turretCd = round2((s.turretCd || 0) - dt);
    let fired = 0;
    while (s.turretCd <= 0 && fired < maxShots) {
      const target = pickGuardTarget(world, nation, data, t, defs);
      if (!target) break;
      fired += 1;
      s.turretCd = round2(s.turretCd + every);
      const def = defs[target.sp];
      const counter = (t.counters || []).includes(target.sp) ? (cfg.counterMultiplier ?? 1.5) : 1;
      const dmg = round2(t.dps * every * counter);
      target.hp = round2(target.hp - dmg);
      // 맞으면 성이 난다 — 사람이 벤 것과 같은 규칙(§13-C-8)
      target.provoked = simCfg(data).provokedSeconds ?? 20;
      if (!target.seen) { target.seen = true; recordEncounter(nation, target.sp, world.tick); }
      const killed = target.hp <= 0;
      out.shots.push({
        id: t.id, key: t.key, x: t.x, y: t.y,
        tx: target.x, ty: target.y, targetId: target.id, damage: dmg, killed,
      });
      if (!killed) continue;
      const gained = {};
      for (const [res, n] of Object.entries(def?.drops || {})) {
        const got = deposit(nation, res, round2(n * dropMult), data);
        if (got > 0) gained[res] = got;
      }
      recordKill(nation, target.sp, world.tick);
      out.kills.push({
        turretId: t.id, turretName: t.name, species: target.sp,
        name: def?.name ?? target.sp, x: target.x, y: target.y, gained,
      });
      removeCreature(nation, target, data, world.tick);
    }
    /* 일 틱처럼 dt 가 큰 걸음에서 빚이 쌓이지 않게 — 다음 걸음은 늘 제 박자로 시작한다 */
    if (s.turretCd <= 0) s.turretCd = every;
  }
  return out;
}

/** 짐승이 사람을 문다. 죽음은 없다 — 쓰러지면 모닥불에서 일어난다(GDD3 §6 기존 규칙). */
function bite(world, nation, def, avatar, data) {
  const p = ensurePlayer(nation, avatar.id, data, avatar.name ?? null);
  if ((p.downUntil || 0) > 0) return null;
  // ★ §14-6 — 막 일어난 사람은 잠깐 아무도 건드리지 못한다(연달아 쓰러지는 죽음의 굴레 방지)
  if (isInvulnerable(p)) return null;
  const c = combatSkillCfg(data);
  const dmg = round2((def.dps || 0) * (data.creatures.sim.attackEverySeconds ?? 1.2));
  p.hp = round2(Math.max(0, (p.hp ?? p.maxHp) - dmg));
  if (p.hp > 0) {
    return { kind: 'wild_hit', nationId: nation.id, data: { avatarId: avatar.id, damage: dmg, hp: p.hp, by: def.name } };
  }
  /* 다운 — ★ §14-6. 화면은 이 이벤트로 10초 카운트다운을 띄우고, 다 세면 player_revived 가 온다.
     쓰러진 자리에서 그대로 세는 것이 아니라 **일어날 자리(본부)** 를 함께 알려 준다. */
  p.downUntil = c.downSeconds;
  nation.morale = Math.max(data.balance.morale.min, (nation.morale ?? 1) - c.downMoralePenalty);
  const town = townOf(world, nation.id);
  if (town) { avatar.x = town.x; avatar.y = town.y; }
  return {
    kind: 'player_down', nationId: nation.id,
    data: {
      avatarId: avatar.id, by: def.name, downSeconds: c.downSeconds,
      reviveHpRatio: c.reviveHpRatio ?? 0.5,
      invulnSeconds: c.invulnSeconds ?? 3,
      moralePenalty: c.downMoralePenalty,
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
    // ★ §14-5 — 행운이 드롭에 얹힌다(점당 +3%). 손재주가 아니라 '운수'의 몫이다.
    const huntBonus = 1 + (gearFx.huntYield || 0) + (statEffects(player, data).luck || 0);
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
