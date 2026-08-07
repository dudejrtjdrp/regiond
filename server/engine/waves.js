// 엔드리스 웨이브 — docs/GDD3.md §6. 시즌 고정 스케줄(해적5일·바이킹9일·드래곤13일)은 폐기됐다.
// ★ v3.1: 첫 위협은 '티어'가 아니라 **7장(낯선 발자국)에서 흔적을 살핀 뒤**에 잡힌다 — 진행 감독이 문을 쥔다.
// 그 뒤로는 4~6게임일 간격으로 끝없이 온다.
// 파워 = basePower × growth^n × 난이도 배수 × 변형 배수. 적은 로테이션으로 돌아오고 한 바퀴마다 강해진다.
import { townOf, territoryRadius, dist, terrainAt, isWaterAt } from './world.js';
import { isVisible } from './fog.js';
import { canSeeTacticHint } from './tactics.js';
// ★ Sprint 5 — 야영지를 치는 손은 **적을 치는 손과 같은 손**이다(쿨타임·피해·장비·눈금이 한 벌).
import { ensurePlayer, swingDamage, canSwing, markSwing, grantXp, skillLevel } from './skills.js';
import { equipEffects } from './equipment.js';
// ★ Sprint 5 — 야영지 경비는 여느 짐승과 **같은 목록**에 앉는다(그리는 길도 베는 길도 하나다).
import { ensureWild } from './ecology.js';
// ★ Sprint 5 — 경비 배치는 세계 난수를 한 톨도 축내지 않는다(actions.js 의 은닉물과 같은 규율).
import { statRng } from './traits.js';
import { record } from './chronicle.js';
// ★ §19-E(F04-4) — 침공 조건은 **장 목표와 같은 계측기**로 잰다(§13-A-1 조건 행의 단일 정본).
import { featureUnlocked, measure } from './progression.js';
import { warnBonusDays, turretList, militiaSlots, militiaBonus } from './structures.js';
import { difficultyPreset } from './difficulty.js';
import { round2, round3 } from './economy.js';

export const wavesCfg = (data) => data.waves;
export const battleCfg = (data) => data.waves.battle;
export const warnCfg = (data) => data.waves.warn;
/** ★ Sprint 5 — 야영지 선제 타격 다이얼(data/waves.json strike). 없으면 옛 자료 — 문이 닫힌 채로 돈다. */
export const strikeCfg = (data) => wavesCfg(data).strike ?? null;

const err = (code, message, extra = null) => ({ ok: false, error: { code, message, ...(extra || {}) } });

/** 성녀의 예언 — 도착 시점과 구성이 정확히 열린다 */
export function hasSaintSight(nation, data, hooks = {}) {
  if (nation.roles?.saint?.holder) return true;
  return Boolean(hooks.flags?.prophecyAlways);
}

// ────────────────────────────────────────────────────────────────
// 웨이브 정의
// ────────────────────────────────────────────────────────────────
/** 한 무리의 실체 — 종류 하나가 몇이서 어떤 몸으로 오는가 (본대·호위대가 같은 틀을 쓴다) */
function groupOf(type, def, statMult, power) {
  const units = Math.max(1, Math.round(power / (def.powerCost * statMult)));
  return {
    type, units, sprite: def.sprite ?? type,
    unitHp: round2(def.hp * statMult), unitDps: round2(def.dps * statMult),
    speed: def.speed, flying: Boolean(def.flying),
    structureDamageBonus: def.structureDamageBonus ?? 1,
    rangeTiles: def.rangeTiles ?? null, detonate: def.detonate ?? null,
  };
}

/**
 * ★ §19-F2(F07-3) — 이 웨이브에 누가 따라오는가. 없으면 null(옛 구성 그대로).
 * 「왜」 fromWave 인가: 앞 다섯 웨이브는 밸런스 체크포인트가 매달린 자리라 한 마리도 건드리지 않는다.
 */
function escortKey(index, cfg, biome) {
  const e = cfg.escort;
  if (!e || index + 1 < (e.fromWave ?? Infinity)) return null;
  const key = (biome && e.byBiome?.[biome]) || e.fallback;
  return cfg.types[key] ? key : null;
}

/**
 * n번째 웨이브(0-based)의 실체.
 * @returns {{index,type,name,cycle,power,units,groups,unitHp,unitDps,speed,direction,weakTo,flying,...}}
 */
export function waveSpec(index, data, { difficultyMultiplier = 1, settlementScale = 1, biome = null } = {}) {
  const cfg = wavesCfg(data);
  const rot = cfg.rotation;
  const type = rot[index % rot.length];
  const cycle = Math.floor(index / rot.length);
  const def = cfg.types[type];
  const statMult = Math.pow(cfg.variant.statMultiplier, cycle);
  // ★ 첫 위협은 부드럽게 — 처음 earlyRamp.waves 번은 파워에 완만한 램프가 걸린다.
  //   갓 울타리를 두른 촌락에게 '늑대 떼'는 겁을 주는 것이지 무너뜨리는 것이 아니다(GDD3 §2·§6).
  const ramp = cfg.earlyRamp && index < cfg.earlyRamp.waves
    ? cfg.earlyRamp.from + (1 - cfg.earlyRamp.from) * (index / cfg.earlyRamp.waves)
    : 1;
  const power = cfg.basePower
    * Math.pow(cfg.growth, index)
    * Math.pow(cfg.variant.powerMultiplier, cycle)
    * difficultyMultiplier
    * settlementScale
    * ramp;
  /* ★ §19-F2(F07-3) — 총 파워를 본대와 호위대로 가른다. 합은 언제나 power 다(위협의 크기는 그대로). */
  const esc = escortKey(index, cfg, biome);
  const share = esc ? (cfg.escort.share ?? 0) : 0;
  const unitCost = def.powerCost * statMult;
  const units = Math.max(2, Math.round((power * (1 - share)) / unitCost));
  const groups = [{ ...groupOf(type, def, statMult, power * (1 - share)), units }];
  if (esc) groups.push(groupOf(esc, cfg.types[esc], statMult, power * share));
  const prefix = cfg.variant.prefixes[Math.min(cycle, cfg.variant.prefixes.length - 1)];
  return {
    index,
    type,
    cycle,
    name: `${prefix}${def.name}`,
    baseName: def.name,
    desc: def.desc ?? null,
    power: round2(power),
    units: groups.reduce((a, g) => a + g.units, 0),
    groups,
    escort: esc ? { type: esc, name: cfg.types[esc].name, units: groups[1].units } : null,
    unitHp: round2(def.hp * statMult),
    unitDps: round2(def.dps * statMult),
    speed: def.speed,
    direction: def.direction ?? 'sea',
    weakTo: def.weakTo ?? null,
    flying: Boolean(def.flying),
    prefersLoot: Boolean(def.prefersLoot),
    structureDamageBonus: def.structureDamageBonus ?? 1,
    sprite: def.sprite ?? type,
  };
}

/**
 * ★ 정착지 규모 보정 (GDD3 §6 보강 — 엔드리스 균형의 핵심).
 *   웨이브 번호만으로 세지는 1.18^n 은 '인구 0에서 시작해 폭발적으로 자라는' 정착지를 따라가지 못한다.
 *   그래서 파워에 정착지 규모(인구·티어)를 한 항으로 곱한다 — 작게 살면 작게 오고, 크게 살면 크게 온다.
 *   pivot 만큼 크면 배수 2가 되는 완만한 곡선이다.
 */
export function defenseIndex(nation, data) {
  const cfg = wavesCfg(data).settlementScale;
  const m = battleCfg(data).militia;
  /* ★ §15-B — 터렛의 몫은 화력만이 아니라 **닿는 넓이**다.
     옛 식은 dps 만 셌다. 그래서 §15-A 로 사거리가 늘고 노포·화포가 초반에 열리자,
     실제 방어력은 크게 올랐는데 규모 보정은 그 절반만 알아챘다(실측: 웨이브5 생존율 65%→90%).
     사거리가 길수록 적이 사정권에 머무는 시간이 길고 = 같은 dps 가 더 많은 피해를 낸다.
     rangeReference 는 그 항이 1이 되는 기준 사거리(화살탑 1단계)다. */
  const rangeRef = cfg?.turretRangeReference ?? 0;
  let turret = 0;
  for (const t of turretList(nation, data)) {
    turret += rangeRef > 0 ? t.dps * (t.range / rangeRef) : t.dps;
  }
  const defenders = (nation.villagers || []).filter((u) => u.job === 'defense').length;
  const trained = Math.min(defenders, militiaSlots(nation, data));
  const militiaDps = (trained * (1 + militiaBonus(nation, data))
    + (defenders - trained) * (m.untrainedDpsRatio ?? 0.35)) * m.dps;
  let fenceHp = 0;
  for (const f of nation.fences || []) fenceHp += Math.max(0, f.hp || 0);
  return turret + militiaDps + fenceHp * (cfg?.fenceWeight ?? 0.02);
}

export function settlementScale(nation, data) {
  const cfg = wavesCfg(data).settlementScale;
  if (!cfg?.enabled) return 1;
  const raw = defenseIndex(nation, data);
  const scale = Math.pow(Math.max(0.05, raw) / cfg.reference, cfg.exponent);
  return Math.min(cfg.max, Math.max(cfg.min, scale));
}

/**
 * ★ §19-F2(F07-3) — 내 도읍 둘레에서 가장 흔한 **새 땅**. 없으면 가장 흔한 옛 지형.
 * 난수를 쓰지 않는다(같은 지도·같은 도읍이면 언제나 같은 답) — 웨이브 결정론을 지킨다.
 */
export function dominantBiome(world, nation, data) {
  const town = townOf(world, nation.id);
  const cfg = wavesCfg(data).escort;
  if (!town || !cfg || !world.map) return null;
  const codes = data.world.terrain.codes;
  const biomes = new Set(data.world.terrain.biomes?.codes || []);
  const tally = new Map();
  for (let i = 0; i < 192; i += 1) {
    const a = (i * 2 * Math.PI) / 24;
    const r = ((Math.floor(i / 24) + 1) * (cfg.biomeSampleRadius ?? 70)) / 8;
    const t = terrainAt(world.map, Math.round(town.x + Math.cos(a) * r), Math.round(town.y + Math.sin(a) * r));
    if (t != null) tally.set(codes[t], (tally.get(codes[t]) || 0) + 1);
  }
  return topCode(tally, biomes);
}

/** 표에서 이긴 코드 — 새 땅이 하나라도 있으면 그중에서, 없으면 옛 지형 중에서 고른다 */
function topCode(tally, biomes) {
  let best = null;
  for (const only of [true, false]) {
    for (const [code, n] of tally) {
      if (only !== biomes.has(code)) continue;
      if (!best || n > best.n) best = { code, n };
    }
    if (best) return best.code;
  }
  return null;
}

/** 이 나라의 다음 웨이브 정의 */
export function nextWaveSpec(world, nation, data) {
  const diff = difficultyPreset(world, data);
  const index = nation.wave?.index ?? 0;
  return waveSpec(index, data, {
    difficultyMultiplier: diff.invasionPowerMultiplier ?? 1,
    settlementScale: settlementScale(nation, data),
    biome: dominantBiome(world, nation, data),
  });
}

// ────────────────────────────────────────────────────────────────
// 일정
// ────────────────────────────────────────────────────────────────
export function ensureWaveState(nation) {
  nation.wave ||= { index: 0, arrivalTick: null, scheduledTick: null, history: [] };
  nation.wave.history ||= [];
  return nation.wave;
}

/**
 * 웨이브 일정 갱신 — 매 일 틱. 티어 조건을 갓 넘겼으면 첫 웨이브를 잡고,
 * 지난 웨이브가 끝났으면 다음 일정을 뽑는다. rng 소비: 간격 1회.
 */
export function updateWaveSchedule(world, nation, data, rng) {
  const cfg = wavesCfg(data);
  const w = ensureWaveState(nation);
  if (!nation.isPlayer) return w;
  // ★ GDD3 §11-1 — 「웨이브 자동 예고」의 문. 티어가 아니라 **7장에서 낯선 발자국을 살핀 뒤**에만 일정이 잡힌다.
  //   진행 감독이 'waves' 를 열어 주기 전에는 며칠이 지나도 아무것도 오지 않는다.
  if (!featureUnlocked(nation, 'waves', data)) return w;
  if (w.arrivalTick != null) return w;
  const gap = w.index === 0
    ? cfg.firstDelayDays
    : rng.int(cfg.intervalDays[0], cfg.intervalDays[1]);
  w.arrivalTick = world.tick + gap;
  w.scheduledTick = world.tick;
  return w;
}

/** 웨이브가 끝난 뒤 — 다음 번호로 넘기고 일정을 비운다 */
export function advanceWave(nation, result) {
  const w = ensureWaveState(nation);
  w.history.push(result);
  if (w.history.length > 60) w.history.splice(0, w.history.length - 60);
  w.index += 1;
  w.arrivalTick = null;
  w.scheduledTick = null;
  w.lastResult = result;
  return w;
}

export function daysUntilWave(world, nation) {
  const w = nation.wave;
  if (!w || w.arrivalTick == null) return null;
  return w.arrivalTick - world.tick;
}

// ────────────────────────────────────────────────────────────────
// ★ §19-E(F04-4) — 침공 앞당기기. 「무작정 대기」를 없앤다.
//
// 왜. 흔적을 살핀 뒤 적이 오기까지 엿새다. 그 엿새 동안 화면은 아무 말도 하지 않았고,
// 플레이어는 「무엇을 더 갖춰야 하는지」도 「언제 끝나는지」도 모른 채 기다렸다(QA 1차 F04-4).
// 고침은 둘이다: ① 침공 조건을 **늘 보이게** 적어 준다 ② 그 조건을 다 채우면 **본인이 앞당긴다**.
// 시간이 여는 것은 여전히 없다 — 앞당기는 것도 플레이어의 행동이다(§11 대원칙).
// ────────────────────────────────────────────────────────────────
export const rushCfg = (data) => wavesCfg(data).rush ?? null;

/** 침공 준비가 되었는가 — 조건 행은 chapters.json 의 조건 문법을 그대로 쓴다 */
export function waveReadiness(world, nation, data) {
  const cfg = rushCfg(data);
  if (!cfg?.enabled) return null;
  const rows = (cfg.conditions || []).map((c) => {
    const m = measure(world, nation, c, data);
    return { label: c.label ?? '', have: m.have, need: m.need, ok: m.ok };
  });
  return { ok: rows.every((r) => r.ok), daysAhead: cfg.daysAhead ?? 1, rows };
}

/** 지금 앞당길 수 있는가 — 준비가 끝났고, 아직 그날이 하루보다 멀리 있을 때만 */
export function canRushWave(world, nation, data) {
  const cfg = rushCfg(data);
  if (!cfg?.enabled || !nation?.isPlayer) return false;
  if (!featureUnlocked(nation, 'waves', data)) return false;
  if (nation.battle && !nation.battle.over) return false;
  const days = daysUntilWave(world, nation);
  if (days == null || days <= (cfg.daysAhead ?? 1)) return false;
  return Boolean(waveReadiness(world, nation, data)?.ok);
}

/** 적을 불러들인다 — 도착일을 '다음날'로 당긴다. 서버 권위(명령 rushWave 하나만 이 문을 쓴다). */
export function rushWave(world, nation, data) {
  if (!canRushWave(world, nation, data)) return null;
  const w = ensureWaveState(nation);
  w.arrivalTick = world.tick + (rushCfg(data).daysAhead ?? 1);
  w.rushedIndex = w.index;
  return w.arrivalTick;
}

// ────────────────────────────────────────────────────────────────
// 예고 — 캠프 · 예언
// ────────────────────────────────────────────────────────────────
function edgePoint(world, data, angleDeg) {
  const size = data.world.size;
  const margin = data.world.camps.edgeMargin;
  const town = townOf(world, world.playerNationId) ?? { x: size / 2, y: size / 2 };
  const a = (angleDeg * Math.PI) / 180;
  let x = town.x;
  let y = town.y;
  for (let step = 1; step < size * 2; step += 1) {
    const nx = town.x + Math.cos(a) * step;
    const ny = town.y + Math.sin(a) * step;
    if (nx < margin || ny < margin || nx > size - 1 - margin || ny > size - 1 - margin) break;
    x = nx;
    y = ny;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function directionAngle(direction, data) {
  return data.world.camps.directionAngles[direction] ?? 0;
}

/**
 * D-campLeadDays 에 맵 가장자리에 선발대 캠프가 선다.
 * ★ Sprint 5 — 며칠 앞인가의 정본은 **data/waves.json warn.campLeadDays** 다. 화면이 /api/config 로
 *   받아 보는 값이 그것이고, 같은 숫자를 두 파일에 두면 반드시 어긋난다. world.json camps.leadDays 는
 *   그 칸이 없는 옛 자료용 대비값으로만 남는다.
 */
export function ensureCamps(world, nation, data) {
  const cfg = data.world.camps;
  world.camps ||= [];
  const created = [];
  const days = daysUntilWave(world, nation);
  if (days == null) return created;
  const lead = (warnCfg(data).campLeadDays ?? cfg.leadDays) + warnBonusDays(nation, data);
  if (days > lead || days < 0) return created;
  const spec = nextWaveSpec(world, nation, data);
  const id = `camp_${nation.wave.index}`;
  if (world.camps.some((c) => c.id === id)) return created;
  const p = edgePoint(world, data, directionAngle(spec.direction, data));
  /* ★ Sprint 5 — 야영지에 **체력**이 생겼다. 이제 이것은 정찰 마커가 아니라 때릴 수 있는 것이다.
     체력은 그 무리의 파워에 비례한다(strike.hpPerPower) — 큰 무리의 야영지는 크게 짓는다. */
  const st = strikeCfg(data);
  const maxHp = st?.enabled ? Math.round(spec.power * (st.hpPerPower ?? 0)) : 0;
  const camp = {
    id, waveIndex: spec.index, type: spec.type, name: spec.name,
    x: p.x, y: p.y, direction: spec.direction,
    arrivalTick: nation.wave.arrivalTick,
    spottedTick: world.tick, scouted: false,
    power: spec.power, units: spec.units,
    maxHp, hp: maxHp,
  };
  world.camps.push(camp);
  spawnCampGuards(world, nation, data, camp);
  created.push(camp);
  return created;
}

/**
 * ★ Sprint 5 — 야영지 곁을 지키는 것들. 「위험 보상」의 위험 쪽이다: 맨몸으로 걸어가면
 * 야영지를 부수기 전에 제가 먼저 쓰러진다.
 *
 * 규율 둘.
 *   ① 난수는 statRng — 세계 난수도 생태 난수도 한 톨 축내지 않는다(같은 씨앗이면 같은 자리·같은 종).
 *   ② 이름표(id)를 제 손으로 짓는다 — wild.nextId 를 건드리면 그 뒤에 태어나는 들짐승의 이름이 밀린다.
 * 링(ring)은 없다(null): 야영지는 지도 가장자리에 서므로 어떤 띠에도 매이지 않는다
 * (ecology.ensureCreatures 의 띠별 정원 셈에도 들지 않는다 — 경비가 들짐승의 자리를 뺏지 않는다).
 */
function spawnCampGuards(world, nation, data, camp) {
  const cfg = strikeCfg(data);
  const count = Math.max(0, Math.round(cfg?.guards ?? 0));
  const def = data.creatures?.defs?.[cfg?.guardSpecies];
  if (!cfg?.enabled || !count || !def) return [];
  const w = ensureWild(nation);
  const rng = statRng(`${world.seed}:camp:${camp.waveIndex}`);
  const born = [];
  for (let i = 0; i < count; i += 1) {
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(1.5, 3.5);
    let x = Math.round(camp.x + Math.cos(a) * r);
    let y = Math.round(camp.y + Math.sin(a) * r);
    // 물이면 야영지 발치에 세운다 — 난수를 더 뽑지 않는다(결정론)
    if (isWaterAt(world.map, x, y, data)) { x = camp.x; y = camp.y; }
    const c = {
      id: `${camp.id}_g${i}`, sp: cfg.guardSpecies,
      x, y, tx: x, ty: y,
      hp: def.hp, maxHp: def.hp,
      ring: null,
      /* ★ 이 세 칸이 「야영지의 것」이라는 표식이다: 배회하지 않고(생태 난수 불변) 제 자리로 돌아오며,
         야영지가 사라질 때 함께 사라진다. */
      camp: camp.id, campX: camp.x, campY: camp.y,
      state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
    };
    w.creatures.push(c);
    born.push(c);
  }
  return born;
}

/**
 * 그 웨이브의 야영지를 걷는다 — ★ Sprint 5: 남은 경비도 함께 걷는다(야영지가 없으면 지킬 것도 없다).
 * @param {object|null} nation 경비가 사는 나라. 없으면 이 세상의 사람 나라들을 훑는다(옛 호출부 호환).
 */
export function clearCamps(world, waveIndex, nation = null) {
  const gone = new Set((world.camps || []).filter((c) => c.waveIndex === waveIndex).map((c) => c.id));
  world.camps = (world.camps || []).filter((c) => c.waveIndex !== waveIndex);
  if (!gone.size) return;
  const nations = nation ? [nation] : Object.values(world.nations || {}).filter((n) => n.isPlayer);
  for (const n of nations) {
    const list = n?.wild?.creatures;
    if (!list?.length) continue;
    n.wild.creatures = list.filter((c) => !c.camp || !gone.has(c.camp));
  }
}

export function updateCampIntel(world, nation, data) {
  const cfg = data.world.camps;
  const found = [];
  for (const camp of world.camps || []) {
    if (camp.scouted) continue;
    let seen = isVisible(nation, camp.x, camp.y);
    if (!seen) {
      for (const u of nation.villagers || []) {
        if (dist(u.x, u.y, camp.x, camp.y) <= cfg.scoutRadius) { seen = true; break; }
      }
    }
    if (!seen) {
      for (const a of Object.values(nation.avatars || {})) {
        if (dist(a.x, a.y, camp.x, camp.y) <= cfg.scoutRadius) { seen = true; break; }
      }
    }
    if (seen) { camp.scouted = true; found.push(camp); }
  }
  return found;
}

export function sizeLabel(power, data) {
  for (const b of data.world.camps.sizeBuckets) if (power <= b.max) return b.label;
  return data.world.camps.sizeBuckets.at(-1).label;
}

export function campEventView(camp, data) {
  return {
    id: camp.id, waveIndex: camp.waveIndex, type: camp.type, name: camp.name, direction: camp.direction,
    x: camp.x, y: camp.y,
    spottedTick: camp.spottedTick ?? null,
    scouted: Boolean(camp.scouted),
    sizeHint: camp.scouted ? sizeLabel(camp.power, data) : null,
    power: null,
    /* ★ Sprint 5 — 체력은 **내가 때린 만큼의 장부**다. 정보 비대칭 바깥이라 가리지 않는다
       (가려 놓으면 「때렸는데 아무 일도 안 일어난다」가 된다). 병력·파워는 지금처럼 가려진다. */
    hp: camp.maxHp > 0 ? round2(Math.max(0, camp.hp ?? 0)) : null,
    maxHp: camp.maxHp > 0 ? camp.maxHp : null,
  };
}

export function campViews(world, nation, viewerRole, data) {
  const canSee = canSeeTacticHint(nation, viewerRole, data);
  return (world.camps || []).map((camp) => {
    const base = {
      id: camp.id, waveIndex: camp.waveIndex, type: camp.type, name: camp.name,
      direction: camp.direction, x: camp.x, y: camp.y,
      spottedTick: camp.spottedTick, scouted: camp.scouted,
      /* ★ Sprint 5 — 체력만은 가리지 않는다: 이것은 적의 비밀이 아니라 **내 손이 남긴 자국**이다.
         파워·머릿수는 여전히 국방부의 몫이다(정보 비대칭 계약 불변). */
      hp: camp.maxHp > 0 ? round2(Math.max(0, camp.hp ?? 0)) : null,
      maxHp: camp.maxHp > 0 ? camp.maxHp : null,
    };
    if (!camp.scouted) return { ...base, sizeHint: null, power: null, units: null };
    return {
      ...base,
      sizeHint: sizeLabel(camp.power, data),
      power: canSee ? camp.power : null,
      units: canSee ? camp.units : null,
      intel: canSee ? '국방부가 적의 머릿수를 헤아렸습니다.' : '정찰병이 멀리서 규모만 어림했습니다.',
    };
  });
}

// ────────────────────────────────────────────────────────────────
// ★ Sprint 5 — 선제 타격. 「기다림」을 「고르는 일」로 바꾼다.
//
// 왜. §19-E 가 앞당기기를 냈지만, 그것은 「빨리 오게 하는」 한 갈래뿐이었다. 대기 엿새 동안
// 지도 가장자리에 선 야영지는 **보이기만 하고 만질 수 없는 것**이었다. 이제 걸어가서 부술 수 있다:
// 부순 만큼 그 무리가 줄고, 다 부수면 그 무리는 오지 않는다(막아 낸 것으로 친다).
// 대신 그 자리는 사나운 띠다 — 경비가 지킨다. 얻는 것과 잃는 것을 사람이 저울질한다.
// ────────────────────────────────────────────────────────────────
/** 지금 웨이브의 야영지 하나 — id 를 주면 그것, 안 주면 이번 웨이브의 첫 야영지 */
export function campForWave(world, nation, campId = null) {
  const index = nation?.wave?.index ?? 0;
  const list = (world.camps || []).filter((c) => c.waveIndex === index);
  if (campId) return list.find((c) => c.id === campId) ?? null;
  return list[0] ?? null;
}

/**
 * strikeCamp — 야영지를 한 번 친다. 서버 권위(사거리·쿨타임·피해가 전부 여기서 난다).
 * @returns {{ok:true, hp, maxHp, destroyed, damage, waveCancelled, xp, events}|{ok:false,error}}
 */
export function strikeCamp(world, nation, cmd, data, now = Date.now()) {
  const cfg = strikeCfg(data);
  if (!cfg?.enabled) return err('NO_CAMP', '칠 야영지가 없습니다.');
  const w = ensureWaveState(nation);
  const camp = campForWave(world, nation, cmd.campId ?? cmd.payload?.campId ?? null);
  if (!camp || !(camp.maxHp > 0) || camp.hp <= 0) return err('NO_CAMP', '칠 야영지가 없습니다.');
  if (nation.battle && !nation.battle.over) return err('NO_CAMP', '이미 싸움이 붙었습니다.');

  const avatarId = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const player = ensurePlayer(nation, avatarId, data, cmd.playerName ?? null);
  if ((player.downUntil || 0) > 0) return err('DOWNED', '아직 일어서지 못했습니다.');

  const av = nation.avatars?.[avatarId];
  const from = av ? { x: av.x, y: av.y } : townOf(world, nation.id);
  if (!from || dist(from.x, from.y, camp.x, camp.y) > (cfg.rangeTiles ?? 2.5)) {
    return err('OUT_OF_RANGE', '야영지 곁까지 걸어가야 합니다.');
  }

  /* 쿨타임은 전투 스윙과 **같은 자**를 쓴다(skills.canSwing/markSwing) — 야영지를 치는 동안
     적을 치는 손이 따로 쉬고 있으면 그것은 두 개의 손이다. */
  const cd = canSwing(nation, player, 'combat', data, now);
  if (!cd.ok) return err('COOLDOWN', '아직 휘두를 수 없습니다.', { waitMs: cd.waitMs, cooldownMs: cd.cooldownMs });
  markSwing(player, now, 'combat');

  const gearFx = equipEffects(player, data);
  const damage = round2(swingDamage(nation, player, data) * gearFx.damage);
  camp.hp = round2(Math.max(0, camp.hp - damage));
  const xp = grantXp(player, 'combat', cfg.xpPerSwing ?? 0, data);

  const events = [];
  let destroyed = false;
  let waveCancelled = false;
  if (camp.hp <= 0) {
    destroyed = true;
    waveCancelled = true;
    const index = camp.waveIndex;
    const units = camp.units ?? 0;
    /* 「오지 않은 무리」를 **막아 낸 무리로 적는다.** 까닭: 7장은 wavesHeld/wavesFaced 로 흐르는데,
       선제 타격이 이야기를 멈춰 세우면 「잘한 사람이 갇히는」 문이 된다(§19-E ③ 과 같은 규율). */
    advanceWave(nation, {
      index, number: index + 1, type: camp.type, name: camp.name, tick: world.tick,
      won: true, enemiesKilled: units, enemiesTotal: units,
      struck: true,
    });
    w.struckIndex = index;
    record(world, {
      kind: 'wave',
      title: `제${index + 1}차 습격 — ${camp.name}`,
      text: `${camp.name}의 야영지를 먼저 무너뜨렸다. 그 무리는 끝내 오지 않았다.`,
      data: { won: true, struck: true, killed: units, total: units },
    }, data);
    events.push({
      kind: 'camp_destroyed', nationId: nation.id,
      data: { waveIndex: index, name: camp.name, x: camp.x, y: camp.y },
    });
    clearCamps(world, index, nation);
  }

  return {
    ok: true,
    campId: camp.id,
    hp: Math.max(0, camp.hp),
    maxHp: camp.maxHp,
    destroyed,
    damage,
    waveCancelled,
    xp: round2(player.skills.combat.xp),
    cooldownMs: cd.cooldownMs,
    skill: 'combat',
    level: skillLevel(player, 'combat'),
    leveled: xp.leveled,
    gearDamage: gearFx.damage,
    events,
  };
}

/**
 * ★ Sprint 5 — 부순 만큼 덜 온다. 야영지가 상한 채 남아 있으면 그 무리의 머릿수를 체력 비율만큼 덜어 낸다.
 * 난수를 한 톨도 쓰지 않는다 — 봇이 치지 않는 시뮬에서는 이 함수가 spec 을 **그대로** 돌려주므로
 * 전투 난수의 뽑는 차례도 마릿수도 옛것과 한 톨 다르지 않다(체크포인트 곡선 보존).
 */
export function campWeakenedSpec(world, spec, data) {
  const cfg = strikeCfg(data);
  if (!cfg?.enabled || !spec) return spec;
  const camp = (world.camps || []).find((c) => c.waveIndex === spec.index && c.maxHp > 0);
  if (!camp || !(camp.hp < camp.maxHp)) return spec;
  const before = spec.units;
  const ratio = Math.max(0, camp.hp) / camp.maxHp;
  const cut = Math.floor((1 - ratio) * before);
  if (cut <= 0) return spec;
  const keep = Math.max(1, before - cut);           // 전부 부수지 못했으면 하나는 남는다
  const groups = (spec.groups || []).map((g) => ({ ...g }));
  if (!groups.length) return { ...spec, units: keep, power: round2(spec.power * (keep / before)) };
  /* 무리마다 비례로 덜어 낸다 — 남은 몫은 본대가 진다(호위대만 남는 그림은 없다) */
  let left = keep;
  for (let i = groups.length - 1; i > 0; i -= 1) {
    const n = Math.max(0, Math.min(left - 1, Math.floor((groups[i].units * keep) / before)));
    groups[i].units = n;
    left -= n;
  }
  groups[0].units = Math.max(1, left);
  const kept = groups.filter((g) => g.units > 0);
  const units = kept.reduce((a, g) => a + g.units, 0);
  return {
    ...spec,
    groups: kept,
    units,
    power: round2(spec.power * (units / before)),   // 화면에 뜨는 파워도 함께 줄어든다(같은 저울)
    escort: spec.escort && kept.length > 1 ? { ...spec.escort, units: kept[1].units } : null,
    weakened: { campId: camp.id, hp: round2(Math.max(0, camp.hp)), maxHp: camp.maxHp, unitsBefore: before },
  };
}

// ────────────────────────────────────────────────────────────────
// 뷰 — 정보 비대칭(성녀 예언)
// ────────────────────────────────────────────────────────────────
/**
 * NationView.wave.
 * 성녀가 있으면 도착일(정확)과 구성(적 종류·머릿수)까지, 없으면 흐린 범위만 준다.
 */
export function waveView(world, nation, viewerRole, data, hooks = {}) {
  const cfg = wavesCfg(data);
  const w = ensureWaveState(nation);
  const unlocked = featureUnlocked(nation, 'waves', data);
  const base = {
    index: w.index,
    number: w.index + 1,
    unlocked,
    startTier: cfg.startTier,
    active: Boolean(nation.battle && !nation.battle.over),
    /* ★ §19-E(F04-4) — 조건과 앞당김은 **정보 비대칭 바깥**이다. 적이 언제 오는지는 흐려도,
       「내가 무엇을 더 갖춰야 하는지」는 언제나 또렷해야 한다(대기 중 할 일 제로 방지). */
    readiness: waveReadiness(world, nation, data),
    canRush: canRushWave(world, nation, data),
    rushed: w.rushedIndex === w.index,
    history: (w.history || []).slice(-10).map((h) => ({
      index: h.index, number: h.index + 1, type: h.type, name: h.name, tick: h.tick,
      won: h.won, enemiesKilled: h.enemiesKilled, enemiesTotal: h.enemiesTotal,
    })),
  };
  if (!unlocked || w.arrivalTick == null) {
    return { ...base, arrivalTick: null, daysUntil: null, daysUntilMin: null, precise: false, enemy: null, hint: null };
  }
  const days = w.arrivalTick - world.tick;
  const saint = hasSaintSight(nation, data, hooks);
  /* ★ Sprint 5 — 성녀의 리드는 **바닥**이지 뚜껑이 아니다.
     옛 식은 둘 중 하나를 골랐다(saint ? 4 : 3). hintLeadDays 를 7로 올리자 그 식이 뒤집혔다 —
     성녀를 모신 나라가 D-6 에 아무것도 못 보고, 성녀 없는 나라는 흐린 카운트다운을 보는 그림이다.
     성녀가 보는 것은 언제나 「남들이 보는 것 + 정확함」이어야 한다. 그래서 둘 중 **큰 쪽**을 쓴다:
     saint.warnLeadDays 는 흐린 리드가 그보다 짧을 때 성녀가 먼저 보는 날수로 그대로 산다. */
  const lead = Math.max(warnCfg(data).hintLeadDays, saint ? warnCfg(data).saint.warnLeadDays : 0)
    // ★ §20-R1 — 정찰병의 망원경이 감시탑과 **다른 소스**로 하루를 더 앞당긴다(중첩)
    + warnBonusDays(nation, data) + (hooks.warnLeadDelta || 0);
  const visible = days <= lead;
  const spec = nextWaveSpec(world, nation, data);
  const jitter = difficultyPreset(world, data).hintJitterDays ?? warnCfg(data).withoutSaint.jitterDays;
  if (!visible) {
    return { ...base, arrivalTick: null, daysUntil: null, daysUntilMin: null, precise: false, enemy: null, hint: null };
  }
  if (saint) {
    return {
      ...base,
      arrivalTick: w.arrivalTick,
      daysUntil: days,
      daysUntilMin: days,
      precise: true,
      enemy: {
        type: spec.type, name: spec.name, desc: spec.desc, units: spec.units,
        power: spec.power, unitHp: spec.unitHp, unitDps: spec.unitDps,
        direction: spec.direction, weakTo: spec.weakTo, flying: spec.flying, sprite: spec.sprite,
        /* ★ §19-F2(F07-3) — 예언은 「몇이 오는가」만이 아니라 **무엇이 섞여 오는가**까지 본다.
           성녀가 없으면 이 칸도 없다(§11-1 잠긴 계층은 부재다). */
        groups: spec.groups.map((g) => ({ type: g.type, units: g.units, sprite: g.sprite })),
        escort: spec.escort,
      },
      blessing: warnCfg(data).saint.damageBonus,
      hint: `성녀의 예언 — ${spec.name} ${spec.units}이(가) ${days}일 뒤 ${directionName(spec.direction, data)}에서 옵니다.`
        + (spec.escort ? ` ${spec.escort.name} ${spec.escort.units}이(가) 섞여 있습니다.` : ''),
    };
  }
  return {
    ...base,
    arrivalTick: null,
    daysUntil: null,
    daysUntilMin: Math.max(0, days - jitter),
    precise: false,
    enemy: revealedEnemy(spec, hooks, data),
    hint: `${lead}일 안에 무언가 다가옵니다. 성녀가 없어 시점이 흐립니다.`
      + revealedHint(spec, hooks, data),
  };
}

/**
 * ★ §20-R1 — 성녀가 없을 때 유물이 열어 주는 만큼만 연다(유물기획 §20-2 정찰병의 망원경·별자리 지도).
 * 「왜」 층을 나누나 — §11-1 「잠긴 계층은 부재다」. 종류만 아는 나라에는 규모 칸이 **없어야** 한다.
 */
function revealedEnemy(spec, hooks, data) {
  const type = hooks.flags?.revealInvasionType ? spec.type : null;
  const base = { type, name: type ? spec.name : null, units: null, power: null,
    direction: spec.direction, sprite: type ? spec.sprite : null };
  if (!hooks.flags?.revealInvasionScale) return base;
  return { ...base, scaleGrade: scaleGradeOf(spec, data) };
}

function revealedHint(spec, hooks, data) {
  if (!hooks.flags?.revealInvasionType) return '';
  const scale = hooks.flags?.revealInvasionScale ? ` 규모는 ${scaleGradeOf(spec, data)}입니다.` : '';
  return ` 다만 오는 것이 ${spec.name}임은 압니다.${scale}`;
}

/** 규모 등급(소·중·대) — 문턱은 data/waves.json warn.scaleGrades 가 정본이다(매직넘버 금지). */
export function scaleGradeOf(spec, data) {
  const grades = warnCfg(data).scaleGrades || [];
  const hit = grades.find((g) => (spec.units ?? 0) <= g.maxUnits);
  return (hit ?? grades[grades.length - 1])?.name ?? '알 수 없음';
}

const DIRECTION_NAMES = { sea: '바다', north: '북쪽', east: '동쪽', west: '서쪽', south: '남쪽' };
export function directionName(d, data) { return DIRECTION_NAMES[d] ?? d; }

/** /api/config 공개본 — 규칙과 값표. 지금 몇 번째 웨이브가 언제인지는 여기 없다(정보 비대칭). */
export function publicWaves(data) {
  const cfg = wavesCfg(data);
  return {
    startTier: cfg.startTier,
    firstDelayDays: cfg.firstDelayDays,
    intervalDays: [...cfg.intervalDays],
    basePower: cfg.basePower,
    growth: cfg.growth,
    rotation: [...cfg.rotation],
    variant: { powerMultiplier: cfg.variant.powerMultiplier, statMultiplier: cfg.variant.statMultiplier, prefixes: [...cfg.variant.prefixes] },
    types: Object.fromEntries(Object.entries(cfg.types).map(([k, v]) => [k, {
      name: v.name, desc: v.desc, hp: v.hp, dps: v.dps, speed: v.speed,
      weakTo: v.weakTo, direction: v.direction, sprite: v.sprite ?? k, flying: Boolean(v.flying),
    }])),
    warn: { campLeadDays: cfg.warn.campLeadDays, hintLeadDays: cfg.warn.hintLeadDays, saint: { ...cfg.warn.saint } },
    /* ★ Sprint 5 — 야영지 선제 타격의 **규칙**은 공개다(값표이지 정보가 아니다).
       화면은 이것으로 「얼마나 가까이 가야 하는가·경비가 몇인가」를 그린다. */
    strike: cfg.strike
      ? {
        enabled: Boolean(cfg.strike.enabled), hpPerPower: cfg.strike.hpPerPower,
        rangeTiles: cfg.strike.rangeTiles, guards: cfg.strike.guards, guardSpecies: cfg.strike.guardSpecies,
      }
      : null,
    battle: {
      subtickSeconds: cfg.battle.subtickSeconds,
      maxSeconds: cfg.battle.maxSeconds,
      spawnRadiusTiles: cfg.battle.spawnRadiusTiles,
      coreRadiusTiles: cfg.battle.coreRadiusTiles,
      meleeRangeTiles: cfg.battle.meleeRangeTiles,
      militia: { ...cfg.battle.militia },
      tacticDamageBonus: cfg.battle.tacticDamageBonus,
      tacticPenalty: cfg.battle.tacticPenalty,
    },
    // 다음 웨이브 파워를 미리 보여 주는 표 — 클라의 '위협 곡선' 그래프용(어떤 나라가 몇 번째인지는 안 준다)
    powerCurve: Array.from({ length: 12 }, (_, i) => round2(waveSpec(i, data).power)),
  };
}

export { round3 };
