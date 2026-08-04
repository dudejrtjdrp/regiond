// 장비·인첸트 — docs/GDD3.md §13-D-3·4. **사람마다** 무기 하나, 방어구 하나.
//
// 세 축을 헷갈리지 말 것:
//   ① data/buildings.json tools   — 나라의 도구. 골드로 사고, 매크로 산출과 민병 무장에 들어간다.
//   ② data/skills.json    tools   — 개인 스킬의 도구. 레벨이 저절로 열고, 스윙 배수를 준다.
//   ③ 여기(data/equipment.json)   — **손으로 벼리는 물건.** 자재를 들여 대장간에서 만들고,
//                                    강화(+1~+3)와 인첸트(특성 하나)가 붙는다.
//
// 서버가 권위로 쥐는 것: 무엇을 만들 수 있는가(관료·건물·자재) · 무엇이 붙었는가 · 인첸트 뽑기의 난수.
import { clamp, round2, round3 } from './economy.js';
import { hasBuilding } from './structures.js';
// ★ GDD3 §14-5 — 행운이 인첸트 상위 등급 확률에 얹힌다
import { statEffects } from './skills.js';

export const equipCfg = (data) => data.equipment;
export const SLOTS = (data) => equipCfg(data).slots;

const err = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });

/** 이 슬롯의 티어표 */
export const tierList = (slot, data) => equipCfg(data).tiers[slot] || [];
export const tierAt = (slot, index, data) => tierList(slot, data)[index] ?? null;
export const tierByKey = (slot, key, data) => tierList(slot, data).find((t) => t.key === key) ?? null;

/** 관료(공장장)가 자리에 있는가 — 상위 티어와 강화의 문 */
export const officerOn = (nation, data) => Boolean(nation?.roles?.[equipCfg(data).officerRole]?.holder);
/** 성녀가 자리에 있는가 — 인첸트 상위 등급 확률의 곱절 */
export const saintOn = (nation, data) => Boolean(nation?.roles?.[equipCfg(data).enchant.saintRole]?.holder);
/** 대장간이 섰는가 */
export const smithyOn = (nation, data) => hasBuilding(nation, equipCfg(data).requiresBuilding, data);

/** 이 사람의 장비 장부 (없으면 만든다) */
export function ensureGear(player, data) {
  if (!player) return null;
  const gear = (player.equipment ||= {});
  for (const slot of SLOTS(data)) gear[slot] ??= null;
  return gear;
}

export const gearOf = (player, slot, data) => (ensureGear(player, data) || {})[slot] ?? null;

// ────────────────────────────────────────────────────────────────
// 효과 — 붙은 것 전부를 하나의 표로 접는다
// ────────────────────────────────────────────────────────────────
/** 특성 정의 */
export const traitDef = (key, data) => equipCfg(data).enchant.traits.find((t) => t.key === key) ?? null;
export const gradeDef = (key, data) => equipCfg(data).enchant.grades.find((g) => g.key === key) ?? null;

/** 인첸트 한 개가 실제로 내는 값 = 기본값 × 등급 배수 */
export function enchantValue(ench, data) {
  if (!ench) return 0;
  const t = traitDef(ench.trait, data);
  const g = gradeDef(ench.grade, data);
  if (!t || !g) return 0;
  return round3(t.value * g.scale);
}

/**
 * 이 사람이 지금 누리는 것 전부.
 * @returns {{damage,huntYield,reduction,downResist,harvest,lumber,moveSpeed,nightVision}}
 */
export function equipEffects(player, data) {
  const out = {
    damage: 1, huntYield: 0, reduction: 0, downResist: 0,
    harvest: 0, lumber: 0, moveSpeed: 0, nightVision: 0,
  };
  const gear = ensureGear(player, data);
  if (!gear) return out;
  const enh = equipCfg(data).enhance;
  for (const slot of SLOTS(data)) {
    const g = gear[slot];
    if (!g) continue;
    const spec = tierByKey(slot, g.key, data);
    if (!spec) continue;
    const plus = clamp(Number(g.plus) || 0, 0, enh.max);
    if (slot === 'weapon') {
      out.damage *= (spec.damage || 1) + (enh.weapon.damage || 0) * plus;
      out.huntYield += (spec.huntYield || 0) + (enh.weapon.huntYield || 0) * plus;
    } else if (slot === 'armor') {
      out.reduction += (spec.reduction || 0) + (enh.armor.reduction || 0) * plus;
      out.downResist += (spec.downResist || 0) + (enh.armor.downResist || 0) * plus;
    }
    if (g.enchant) {
      const t = traitDef(g.enchant.trait, data);
      if (t) {
        const v = enchantValue(g.enchant, data);
        if (t.effect === 'defense') out.reduction += v;
        else out[t.effect] = round3((out[t.effect] || 0) + v);
      }
    }
  }
  out.damage = round3(out.damage);
  out.huntYield = round3(out.huntYield);
  // 경감은 절반을 넘지 않는다 — 어떤 갑옷도 세상을 지우지는 못한다
  out.reduction = round3(Math.min(0.5, out.reduction));
  out.downResist = round3(Math.min(0.75, out.downResist));
  return out;
}

/** 나라 전체에서 가장 밝은 밤눈 — 안개는 나라 공용이라 가장 잘 보는 눈을 따른다 */
export function bestNightVision(nation, data) {
  let best = 0;
  for (const p of Object.values(nation?.players || {})) {
    best = Math.max(best, equipEffects(p, data).nightVision || 0);
  }
  return best;
}

/** 이 아바타의 밤눈 (fog.visionSources 가 아바타별로 쓴다) */
export function nightVisionOf(nation, avatarId, data) {
  const p = nation?.players?.[avatarId];
  return p ? (equipEffects(p, data).nightVision || 0) : 0;
}

// ────────────────────────────────────────────────────────────────
// 값 치르기
// ────────────────────────────────────────────────────────────────
function costFor(spec, mult = 1) {
  const out = {};
  for (const [k, v] of Object.entries(spec.cost || {})) out[k] = round2(v * mult);
  return out;
}

function checkAndPay(nation, cost, gold, data) {
  for (const [res, need] of Object.entries(cost)) {
    if ((nation.resources[res] || 0) < need - 0.001) {
      return err('NO_RESOURCE', `${data.resources.meta[res]?.name ?? res}이(가) 부족합니다. (${Math.ceil(need)} 필요)`,
        { resource: res, need: round2(need), have: round2(nation.resources[res] || 0) });
    }
  }
  if (gold > 0 && (nation.gold || 0) < gold - 0.001) {
    return err('NO_GOLD', `골드가 부족합니다. (${Math.ceil(gold)} 필요)`, { need: gold, have: round2(nation.gold || 0) });
  }
  for (const [res, need] of Object.entries(cost)) nation.resources[res] = round2(nation.resources[res] - need);
  if (gold > 0) {
    nation.gold = round2(nation.gold - gold);
    nation.stats.goldSpent = round2((nation.stats.goldSpent || 0) + gold);
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────
// 제작 · 강화 · 인첸트
// ────────────────────────────────────────────────────────────────
/** craftEquipment {slot, key} — 대장간에서 한 자루 벼린다 */
export function craftEquipment(nation, player, cmd, data) {
  const slot = String(cmd.slot ?? cmd.payload?.slot ?? '');
  if (!SLOTS(data).includes(slot)) return err('BAD_SLOT', '그런 자리가 없습니다.');
  if (!smithyOn(nation, data)) return err('NO_SMITHY', '대장간이 서야 벼릴 수 있습니다.');
  const key = String(cmd.key ?? cmd.payload?.key ?? '');
  const spec = tierByKey(slot, key, data);
  if (!spec) return err('BAD_TIER', '그런 물건이 없습니다.');
  if (spec.officer && !officerOn(nation, data)) {
    return err('NO_OFFICER', '공장장이 자리에 있어야 이만한 물건을 벼립니다.');
  }
  const gear = ensureGear(player, data);
  const cur = gear[slot];
  if (cur && cur.key === key) return err('SAME_TIER', '이미 그것을 들고 있습니다.');

  const paid = checkAndPay(nation, costFor(spec), spec.gold || 0, data);
  if (!paid.ok) return paid;

  /* ★ 새로 벼리면 강화와 인첸트는 함께 사라진다 — 옮겨 붙지 않는다.
     (그래야 「좋은 인첸트를 들고 티어만 갈아탄다」는 무한 상승이 생기지 않는다.) */
  gear[slot] = { key, plus: 0, enchant: null, madeTick: cmd.tick ?? null };
  return {
    ok: true, slot, key, name: spec.name, grade: spec.grade,
    cost: costFor(spec), gold: spec.gold || 0,
    replaced: cur ? { key: cur.key, plus: cur.plus || 0, enchant: cur.enchant ?? null } : null,
    gear: gearView(player, data),
  };
}

/** 강화 비용 — 단계가 오를수록 costGrowth 배씩 */
export function enhanceCost(plusTo, data) {
  const enh = equipCfg(data).enhance;
  const mult = Math.pow(enh.costGrowth ?? 1, Math.max(0, plusTo - 1));
  const cost = {};
  for (const [k, v] of Object.entries(enh.costPerStep || {})) cost[k] = round2(v * mult);
  return { cost, gold: Math.round((enh.goldPerStep || 0) * mult) };
}

/** enhanceEquipment {slot} — +1 씩. 공장장이 있어야 한다. */
export function enhanceEquipment(nation, player, cmd, data) {
  const slot = String(cmd.slot ?? cmd.payload?.slot ?? '');
  if (!SLOTS(data).includes(slot)) return err('BAD_SLOT', '그런 자리가 없습니다.');
  if (!smithyOn(nation, data)) return err('NO_SMITHY', '대장간이 서야 벼릴 수 있습니다.');
  const enh = equipCfg(data).enhance;
  if (enh.requiresOfficer && !officerOn(nation, data)) {
    return err('NO_OFFICER', '공장장이 자리에 있어야 물건을 더 벼립니다.');
  }
  const gear = ensureGear(player, data);
  const g = gear[slot];
  if (!g) return err('NO_GEAR', '벼릴 물건이 없습니다.');
  const to = (Number(g.plus) || 0) + 1;
  if (to > enh.max) return err('MAX_PLUS', `강화는 +${enh.max}까지입니다.`);
  const price = enhanceCost(to, data);
  const paid = checkAndPay(nation, price.cost, price.gold, data);
  if (!paid.ok) return paid;
  g.plus = to;
  return { ok: true, slot, plus: to, cost: price.cost, gold: price.gold, gear: gearView(player, data) };
}

/**
 * 등급 뽑기 — 성녀가 있으면 상위 등급의 무게가 곱절이 된다(§13-D-4).
 * ★ §14-5 — 여기에 **행운**이 얹힌다(점당 상위 등급 무게 +3%). 성녀의 곱절과는 곱해진다.
 * @returns {{key,name,scale}}
 */
export function rollGrade(rng, nation, data, player = null) {
  const cfg = equipCfg(data).enchant;
  const boost = upperBoost(nation, data, player);
  const entries = cfg.grades.map((g) => ({ value: g, weight: g.weight * (g.upper ? boost : 1) }));
  return rng.weighted(entries) ?? cfg.grades[0];
}

/** 상위 등급 무게에 곱해지는 값 — 성녀(곱절) × 행운(점당 +3%) */
export function upperBoost(nation, data, player = null) {
  const cfg = equipCfg(data).enchant;
  const saint = saintOn(nation, data) ? (cfg.saintGradeMultiplier ?? 1) : 1;
  const luck = 1 + (player ? (statEffects(player, data).luck || 0) : 0);
  return saint * luck;
}

/** 이 등급이 뽑힐 확률 (화면이 「성녀가 있으면 두 배」를 눈으로 보여 준다) */
export function gradeOdds(nation, data, player = null) {
  const cfg = equipCfg(data).enchant;
  const boost = upperBoost(nation, data, player);
  const weights = cfg.grades.map((g) => g.weight * (g.upper ? boost : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return cfg.grades.map((g, i) => ({
    key: g.key, name: g.name, color: g.color, upper: Boolean(g.upper),
    chance: round3(weights[i] / total), scale: g.scale,
  }));
}

/** enchantEquipment {slot} — 특성 하나를 깃들인다. 이미 있으면 덮어쓴다. */
export function enchantEquipment(nation, player, cmd, data, rng) {
  const slot = String(cmd.slot ?? cmd.payload?.slot ?? '');
  if (!SLOTS(data).includes(slot)) return err('BAD_SLOT', '그런 자리가 없습니다.');
  if (!smithyOn(nation, data)) return err('NO_SMITHY', '대장간이 서야 특성을 깃들입니다.');
  const gear = ensureGear(player, data);
  const g = gear[slot];
  if (!g) return err('NO_GEAR', '특성을 깃들일 물건이 없습니다.');

  const cfg = equipCfg(data).enchant;
  const paid = checkAndPay(nation, { ...cfg.cost }, cfg.gold || 0, data);
  if (!paid.ok) return paid;

  const grade = rollGrade(rng, nation, data, player);
  const pool = cfg.traits.filter((t) => (t.slots || []).includes(slot));
  const trait = rng.pick(pool.length ? pool : cfg.traits);
  const before = g.enchant ?? null;
  g.enchant = { trait: trait.key, grade: grade.key };
  return {
    ok: true, slot,
    enchant: enchantView(g.enchant, data),
    replaced: before ? enchantView(before, data) : null,
    saint: saintOn(nation, data),
    odds: gradeOdds(nation, data, player),
    cost: { ...cfg.cost }, gold: cfg.gold || 0,
    gear: gearView(player, data),
  };
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
export function enchantView(ench, data) {
  if (!ench) return null;
  const t = traitDef(ench.trait, data);
  const g = gradeDef(ench.grade, data);
  if (!t || !g) return null;
  const value = enchantValue(ench, data);
  const shown = t.unit === 'tiles' ? `${round2(value)}칸` : `${Math.round(value * 1000) / 10}%`;
  return {
    trait: t.key, name: t.name, effect: t.effect, grade: g.key, gradeName: g.name, color: g.color,
    value, unit: t.unit, text: (t.desc || '').replace('{v}', shown),
  };
}

export function slotView(player, slot, data) {
  const g = gearOf(player, slot, data);
  if (!g) return { slot, key: null, name: null, grade: 0, plus: 0, enchant: null };
  const spec = tierByKey(slot, g.key, data);
  const enh = equipCfg(data).enhance;
  const plus = clamp(Number(g.plus) || 0, 0, enh.max);
  const facts = [];
  if (spec) {
    if (slot === 'weapon') {
      facts.push({ k: '피해', v: `×${round2((spec.damage || 1) + enh.weapon.damage * plus)}` });
      facts.push({ k: '사냥', v: `+${Math.round(((spec.huntYield || 0) + enh.weapon.huntYield * plus) * 100)}%` });
    } else {
      facts.push({ k: '피해 경감', v: `${Math.round(((spec.reduction || 0) + enh.armor.reduction * plus) * 100)}%` });
      facts.push({ k: '다운 저항', v: `${Math.round(((spec.downResist || 0) + enh.armor.downResist * plus) * 100)}%` });
    }
  }
  return {
    slot, key: g.key, name: spec?.name ?? g.key, grade: spec?.grade ?? 0,
    plus, maxPlus: enh.max, facts,
    enchant: enchantView(g.enchant, data),
  };
}

export function gearView(player, data) {
  return Object.fromEntries(SLOTS(data).map((s) => [s, slotView(player, s, data)]));
}

/**
 * 캐릭터 창이 그리는 전부 — 지금 낀 것 · 벼릴 수 있는 것(조건 가시화) · 인첸트 확률.
 * ★ §12-3 전역 원칙: 못 만드는 까닭은 '왜'만이 아니라 **얼마나 모자란지**까지 낸다.
 */
export function equipmentView(nation, player, data) {
  if (!player) return null;
  const smithy = smithyOn(nation, data);
  const officer = officerOn(nation, data);
  const enh = equipCfg(data).enhance;
  const gear = gearView(player, data);
  const catalog = {};
  for (const slot of SLOTS(data)) {
    catalog[slot] = tierList(slot, data).map((spec) => {
      const missing = [];
      for (const [res, need] of Object.entries(spec.cost || {})) {
        const have = round2(nation.resources[res] || 0);
        if (have < need - 0.001) missing.push({ resource: res, name: data.resources.meta[res]?.name ?? res, have, need });
      }
      const goldShort = (spec.gold || 0) > (nation.gold || 0) ? { have: round2(nation.gold || 0), need: spec.gold } : null;
      const locked = spec.officer && !officer;
      return {
        key: spec.key, name: spec.name, grade: spec.grade, officer: Boolean(spec.officer),
        cost: { ...spec.cost }, gold: spec.gold || 0,
        damage: spec.damage ?? null, huntYield: spec.huntYield ?? null,
        reduction: spec.reduction ?? null, downResist: spec.downResist ?? null,
        equipped: gear[slot].key === spec.key,
        locked,
        lockReason: locked ? '공장장이 자리에 있어야 열립니다' : null,
        missing, goldShort,
        ok: smithy && !locked && !missing.length && !goldShort && gear[slot].key !== spec.key,
      };
    });
  }
  const nextPlus = {};
  for (const slot of SLOTS(data)) {
    const g = gearOf(player, slot, data);
    const to = (Number(g?.plus) || 0) + 1;
    if (!g || to > enh.max) { nextPlus[slot] = null; continue; }
    const price = enhanceCost(to, data);
    const missing = [];
    for (const [res, need] of Object.entries(price.cost)) {
      const have = round2(nation.resources[res] || 0);
      if (have < need - 0.001) missing.push({ resource: res, name: data.resources.meta[res]?.name ?? res, have, need });
    }
    nextPlus[slot] = {
      to, cost: price.cost, gold: price.gold, missing,
      locked: enh.requiresOfficer && !officer,
      ok: smithy && (!enh.requiresOfficer || officer) && !missing.length && (nation.gold || 0) >= price.gold,
    };
  }
  const ecfg = equipCfg(data).enchant;
  const eMissing = [];
  for (const [res, need] of Object.entries(ecfg.cost || {})) {
    const have = round2(nation.resources[res] || 0);
    if (have < need - 0.001) eMissing.push({ resource: res, name: data.resources.meta[res]?.name ?? res, have, need });
  }
  return {
    smithy, officer, saint: saintOn(nation, data),
    officerRoleName: data.roles.defs[equipCfg(data).officerRole]?.name ?? equipCfg(data).officerRole,
    gear,
    effects: equipEffects(player, data),
    catalog,
    enhance: { max: enh.max, next: nextPlus, requiresOfficer: Boolean(enh.requiresOfficer) },
    enchant: {
      cost: { ...ecfg.cost }, gold: ecfg.gold || 0, missing: eMissing,
      odds: gradeOdds(nation, data, player),
      saintMultiplier: ecfg.saintGradeMultiplier ?? 1,
      /* ★ §14-5 — 행운이 상위 등급 무게에 얹은 몫(0 이면 아직 안 준 것) */
      luckBonus: round3(statEffects(player, data).luck || 0),
      ok: smithy && !eMissing.length && (nation.gold || 0) >= (ecfg.gold || 0)
        && SLOTS(data).some((s) => gearOf(player, s, data)),
    },
  };
}

/** 공개본 — 규격만. 내가 무엇을 끼고 있는지는 state 로만 간다. */
export function publicEquipment(data) {
  const c = equipCfg(data);
  return {
    slots: [...c.slots],
    slotDefs: structuredClone(c.slotDefs),
    requiresBuilding: c.requiresBuilding,
    officerRole: c.officerRole,
    grades: { ...c.grades },
    tiers: structuredClone(c.tiers),
    enhance: structuredClone(c.enhance),
    enchant: {
      cost: { ...c.enchant.cost }, gold: c.enchant.gold,
      saintGradeMultiplier: c.enchant.saintGradeMultiplier,
      grades: c.enchant.grades.map((g) => ({ ...g })),
      traits: c.enchant.traits.map((t) => ({ ...t, slots: [...t.slots] })),
    },
    sprite: structuredClone(c.sprite),
  };
}
