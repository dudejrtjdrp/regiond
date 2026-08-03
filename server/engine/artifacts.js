// 유물 — effect descriptor 집계 + 드랍 판정 + 소모형 사용
// 유물은 50종이 정본이다(19+17+6+7 + 왕관의 조각). SPEC 초안의 '47종'은 오기였고 docs/SPEC.md §9 를 50 으로 정정했다.
import { clamp } from './economy.js';

/** 보유 유물의 effect descriptor 를 엔진 훅 묶음으로 집계한다. */
export function collectHooks(nation, data) {
  const h = {
    flags: {},
    outputBonus: {},
    enemyPowerMultipliers: {},
    eventWeightMultipliers: {},
    immunities: {},
    surgeMultiplier: 1,
    populationLossMultiplier: 1,
    rewardGoldMultiplier: 1,
    goldMultiplier: 1,
    xpMultiplier: 1,
    buildCostMultiplier: 1,
    tariffDelta: 0,
    tariffZeroCharges: 0,
    freightDelta: 0,
    discoverChanceBonus: 0,
    weaponOilDelta: 0,
    populationCapDelta: 0,
    warnLeadDelta: 0,
    autoAssignDefenders: 0,
    exemptNationId: null,
    revealSupplyNationId: null,
    premiumTrade: {},
    expressionQuality: 1,
    cosmetics: [],
    freeUpgrades: {},
    costDiscounts: {},
    nextInvasionPowerMultiplier: null,
    blindNextInvasion: false,
    instantSettle: false,
  };
  const cap = data.balance.artifacts.discoverChanceCap;

  for (const owned of nation.artifacts || []) {
    const def = data.artifactsByKey[owned.key];
    if (!def) continue;
    if (owned.consumed && def.type === 'consumable') continue;
    for (const e of def.effects || []) {
      applyDescriptor(h, e, owned, def);
    }
  }
  // 소모형이 남긴 지속 효과(사용 후 상태)는 nation.artifactState 에 누적된다.
  const st = nation.artifactState || {};
  for (const [tag, charges] of Object.entries(st.immunities || {})) if (charges > 0) h.immunities[tag] = charges;
  if (st.freeUpgrades) for (const [b, n] of Object.entries(st.freeUpgrades)) if (n > 0) h.freeUpgrades[b] = n;
  if (st.costDiscounts) for (const [b, v] of Object.entries(st.costDiscounts)) h.costDiscounts[b] = v;
  if (st.tariffZeroCharges) h.tariffZeroCharges += st.tariffZeroCharges;
  if (st.populationLossOverride != null) h.populationLossMultiplier = Math.min(h.populationLossMultiplier, st.populationLossOverride);
  if (st.blindNextInvasion) h.blindNextInvasion = true;
  if (st.nextInvasionPowerMultiplier) h.nextInvasionPowerMultiplier = st.nextInvasionPowerMultiplier;

  h.discoverChanceBonus = Math.min(h.discoverChanceBonus, cap);
  return h;
}

function applyDescriptor(h, e, owned, def) {
  switch (e.op) {
    case 'flag': h.flags[e.flag] = true; break;
    case 'outputBonus': h.outputBonus[e.resource] = (h.outputBonus[e.resource] || 0) + e.delta; break;
    case 'enemyPowerMultiplier':
      h.enemyPowerMultipliers[e.invasionType] = (h.enemyPowerMultipliers[e.invasionType] ?? 1) * e.multiplier; break;
    case 'surgeMultiplier': h.surgeMultiplier *= e.multiplier; break;
    case 'populationLossMultiplier':
      if (def.type === 'permanent') h.populationLossMultiplier *= e.multiplier; break;
    case 'rewardGoldMultiplier': h.rewardGoldMultiplier *= e.multiplier; break;
    case 'goldMultiplier': h.goldMultiplier *= e.multiplier; break;
    case 'xpMultiplier': h.xpMultiplier *= e.multiplier; break;
    case 'costMultiplier': h.buildCostMultiplier *= e.multiplier; break;
    case 'tariffDelta': h.tariffDelta += e.amount; break;
    case 'exemptBoundNation': h.exemptNationId = owned.boundNationId ?? null; break;
    case 'freightDelta': h.freightDelta += e.amount; break;
    case 'chanceDelta': h.discoverChanceBonus += e.amount; break;
    case 'oilDelta': h.weaponOilDelta += e.amount; break;
    case 'capDelta': h.populationCapDelta += e.amount; break;
    case 'warnLeadDelta': h.warnLeadDelta += e.amount; break;
    case 'autoAssignDefenders': h.autoAssignDefenders = Math.max(h.autoAssignDefenders, e.amount); break;
    case 'eventWeightMultiplier':
      h.eventWeightMultipliers[e.eventTag] = (h.eventWeightMultipliers[e.eventTag] ?? 1) * e.multiplier; break;
    case 'unlockPremiumGoods': h.premiumTrade[e.nationId] = e.marginBonus; break;
    case 'revealNationSupply': h.revealSupplyNationId = owned.boundNationId ?? null; break;
    case 'expressionQuality': h.expressionQuality = Math.max(h.expressionQuality, e.level); break;
    case 'cosmetic': h.cosmetics.push(e.slot); break;
    case 'instantSettle': h.instantSettle = true; break;
    case 'clientStat': (h.clientStats ||= {})[e.stat] = (h.clientStats?.[e.stat] || 0) + e.delta; break;
    case 'visionDelta': h.visionDelta = (h.visionDelta || 0) + e.amount; break;
    default: break; // onUse 계열은 useArtifact 에서 처리
  }
}

/** 어전 회의 상자 판정. rng 2~3회 소비. */
export function rollArtifactDrop(nation, data, rng, roleActivity = {}) {
  const cfg = data.balance.artifacts;
  const hooks = collectHooks(nation, data);
  const chance = clamp(cfg.chestChancePerCouncil + hooks.discoverChanceBonus, 0, cfg.discoverChanceCap);
  if (!rng.chance(chance)) return { opened: false, chance };

  const grade = rng.weighted(Object.entries(cfg.gradeWeights).map(([value, weight]) => ({ value, weight })));
  const owned = new Set((nation.artifacts || []).map((a) => a.key));
  const pool = data.artifacts.list.filter((a) => a.grade === grade && !owned.has(a.key));
  if (!pool.length) return { opened: true, chance, grade, artifact: null };

  const topRole = Object.entries(roleActivity).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const entries = pool.map((a) => ({ value: a.key, weight: a.role && a.role === topRole ? cfg.roleActivityWeightBonus : 1 }));
  const key = rng.weighted(entries);
  return { opened: true, chance, grade, artifact: key };
}

export function grantArtifact(nation, key, tick, data, opts = {}) {
  if (!data.artifactsByKey[key]) return null;
  if ((nation.artifacts || []).some((a) => a.key === key)) return null;
  const entry = { key, obtainedTick: tick, consumed: false };
  if (opts.boundNationId) entry.boundNationId = opts.boundNationId;
  (nation.artifacts ||= []).push(entry);
  const def = data.artifactsByKey[key];
  for (const e of def.effects || []) {
    if (e.hook === 'onObtain' && e.op === 'oneTimeOutputPenalty') {
      (nation.buffs ||= []).push({ id: `artifact_penalty_${key}`, name: `${def.name} 대가`, outputBonus: -e.ratio, expiresTick: tick + e.durationTicks });
    }
  }
  return entry;
}

/** 소모형 유물 사용 */
export function useArtifact(nation, key, tick, data) {
  const def = data.artifactsByKey[key];
  if (!def) return { ok: false, code: 'UNKNOWN_ARTIFACT', message: '알 수 없는 유물입니다.' };
  const owned = (nation.artifacts || []).find((a) => a.key === key);
  if (!owned) return { ok: false, code: 'NOT_OWNED', message: '보유하지 않은 유물입니다.' };
  if (owned.consumed) return { ok: false, code: 'ALREADY_USED', message: '이미 사용한 유물입니다.' };
  const uses = (def.effects || []).filter((e) => e.hook === 'onUse');
  if (!uses.length) return { ok: false, code: 'NOT_CONSUMABLE', message: '사용할 수 있는 유물이 아닙니다.' };

  const st = (nation.artifactState ||= { immunities: {}, freeUpgrades: {}, costDiscounts: {}, tariffZeroCharges: 0 });
  const applied = [];
  for (const e of uses) {
    switch (e.op) {
      case 'grantResource': nation.resources[e.resource] = (nation.resources[e.resource] || 0) + e.amount; applied.push(`${e.resource}+${e.amount}`); break;
      case 'grantGold': nation.gold += e.amount; applied.push(`gold+${e.amount}`); break;
      case 'grantImmunity': st.immunities[e.eventTag] = (st.immunities[e.eventTag] || 0) + e.charges; applied.push(`immunity:${e.eventTag}`); break;
      case 'damageReduction': st.damageReduction = { eventTag: e.eventTag, ratio: e.ratio, charges: e.charges }; applied.push(`mitigate:${e.eventTag}`); break;
      case 'freeUpgrade': st.freeUpgrades[e.building] = (st.freeUpgrades[e.building] || 0) + e.charges; applied.push(`free:${e.building}`); break;
      case 'costDiscount': st.costDiscounts[e.building] = e.ratio; applied.push(`discount:${e.building}`); break;
      case 'tariffZeroOnce': st.tariffZeroCharges = (st.tariffZeroCharges || 0) + e.charges; applied.push('tariff0'); break;
      case 'tariffDeltaAllNations': st.tariffDeltaAll = { amount: e.amount, charges: e.charges }; applied.push('tariffAll'); break;
      case 'instantCouncil': st.instantCouncil = true; applied.push('council'); break;
      case 'instantTradeRoute': st.instantTradeRoute = true; applied.push('route'); break;
      case 'npcLevelUp': {
        const r = nation.roles?.[e.role];
        if (r) { r.level = (r.level || 0) + e.levels; applied.push(`${e.role}+${e.levels}Lv`); }
        break;
      }
      case 'maxOneRoleLevel': {
        // TODO(기획): 어느 역할을 최대치로 올릴지 선택 UI가 필요. 현재는 최고 레벨 역할을 강화한다.
        const roles = Object.entries(nation.roles || {}).filter(([, r]) => r.holder);
        if (roles.length) {
          roles.sort((a, b) => (b[1].level || 0) - (a[1].level || 0));
          const maxLevel = data.roles.xp.levelCurve.length - 1;
          roles[0][1].level = maxLevel;
          for (const [, r] of roles.slice(1)) r.level = Math.max(0, (r.level || 0) * (1 - e.othersPenalty));
          applied.push(`maxRole:${roles[0][0]}`);
        }
        break;
      }
      case 'revealTag': st.tagLeaked = true; applied.push('revealTag'); break;
      case 'blindNextInvasion': st.blindNextInvasion = true; applied.push('blind'); break;
      default: break;
    }
  }
  owned.consumed = true;
  owned.consumedTick = tick;
  return { ok: true, artifact: def, applied };
}

/** 이벤트 면역/피해경감 소비 */
export function consumeEventProtection(nation, eventTags = []) {
  const st = nation.artifactState;
  if (!st) return { immune: false, mitigation: 0 };
  for (const tag of eventTags) {
    if ((st.immunities?.[tag] || 0) > 0) { st.immunities[tag] -= 1; return { immune: true, mitigation: 0 }; }
  }
  if (st.damageReduction && eventTags.includes(st.damageReduction.eventTag) && st.damageReduction.charges > 0) {
    st.damageReduction.charges -= 1;
    return { immune: false, mitigation: st.damageReduction.ratio };
  }
  return { immune: false, mitigation: 0 };
}
