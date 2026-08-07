// 엔드리스 웨이브 — docs/GDD3.md §6. 시즌 고정 스케줄(해적5일·바이킹9일·드래곤13일)은 폐기됐다.
// ★ v3.1: 첫 위협은 '티어'가 아니라 **7장(낯선 발자국)에서 흔적을 살핀 뒤**에 잡힌다 — 진행 감독이 문을 쥔다.
// 그 뒤로는 4~6게임일 간격으로 끝없이 온다.
// 파워 = basePower × growth^n × 난이도 배수 × 변형 배수. 적은 로테이션으로 돌아오고 한 바퀴마다 강해진다.
import { townOf, territoryRadius, dist, terrainAt } from './world.js';
import { isVisible } from './fog.js';
import { canSeeTacticHint } from './tactics.js';
import { featureUnlocked } from './progression.js';
import { warnBonusDays, turretList, militiaSlots, militiaBonus } from './structures.js';
import { difficultyPreset } from './difficulty.js';
import { round2, round3 } from './economy.js';

export const wavesCfg = (data) => data.waves;
export const battleCfg = (data) => data.waves.battle;
export const warnCfg = (data) => data.waves.warn;

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

/** D-leadDays 에 맵 가장자리에 선발대 캠프가 선다 */
export function ensureCamps(world, nation, data) {
  const cfg = data.world.camps;
  world.camps ||= [];
  const created = [];
  const days = daysUntilWave(world, nation);
  if (days == null) return created;
  const lead = cfg.leadDays + warnBonusDays(nation, data);
  if (days > lead || days < 0) return created;
  const spec = nextWaveSpec(world, nation, data);
  const id = `camp_${nation.wave.index}`;
  if (world.camps.some((c) => c.id === id)) return created;
  const p = edgePoint(world, data, directionAngle(spec.direction, data));
  const camp = {
    id, waveIndex: spec.index, type: spec.type, name: spec.name,
    x: p.x, y: p.y, direction: spec.direction,
    arrivalTick: nation.wave.arrivalTick,
    spottedTick: world.tick, scouted: false,
    power: spec.power, units: spec.units,
  };
  world.camps.push(camp);
  created.push(camp);
  return created;
}

export function clearCamps(world, waveIndex) {
  world.camps = (world.camps || []).filter((c) => c.waveIndex !== waveIndex);
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
  };
}

export function campViews(world, nation, viewerRole, data) {
  const canSee = canSeeTacticHint(nation, viewerRole, data);
  return (world.camps || []).map((camp) => {
    const base = {
      id: camp.id, waveIndex: camp.waveIndex, type: camp.type, name: camp.name,
      direction: camp.direction, x: camp.x, y: camp.y,
      spottedTick: camp.spottedTick, scouted: camp.scouted,
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
  const lead = (saint ? warnCfg(data).saint.warnLeadDays : warnCfg(data).hintLeadDays) + warnBonusDays(nation, data);
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
    enemy: { type: null, name: null, units: null, power: null, direction: spec.direction, sprite: null },
    hint: `${lead}일 안에 무언가 다가옵니다. 성녀가 없어 시점이 흐립니다.`,
  };
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
