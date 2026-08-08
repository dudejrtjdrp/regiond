// 유물 — effect descriptor 집계 + 드랍 판정 + 소모형 사용
// 유물은 50종이 정본이다(19+17+6+7 + 왕관의 조각). SPEC 초안의 '47종'은 오기였고 docs/SPEC.md §9 를 50 으로 정정했다.
// ★ §20-R1 (docs/유물기획.md §20-1·§20-2) — 등급 재편·효과 상향·충전제 일반화가 여기 얹혔다.
import { clamp, storageCapacity } from './economy.js';
import { settlementTier } from './tiers.js';
// ★ §20-R2 — 연출의 빛기둥이 설 자리를 모를 때 물러설 곳(도읍)
import { townOf } from './world.js';

/**
 * 유물 엔트리가 아직 지닌 충전 수.
 * ★ §20-R1 — 옛 세이브에는 이 칸이 없다. 그때는 **정의표의 charges 가 아니라 1**로 물러선다:
 * 정의표가 2·3회로 늘었다고 저장분을 소급해 늘리면 「이미 써 버린 사람」만 손해를 본다.
 */
export function chargesOf(owned, def) {
  if (owned?.chargesLeft != null) return Math.max(0, owned.chargesLeft);
  return owned?.consumed ? 0 : 1;
}

/**
 * ★ §20-R1 세이브 이관 — 보유 엔트리에 chargesLeft 를 채운다(state.js migrateWorld 가 부르는 규칙과 같다).
 * 「왜」 안전 기본값이 1인가: 옛 세이브의 「아직 안 쓴 소모형」은 한 번 쓸 수 있는 물건이었다.
 * 정의표가 2회로 늘었다고 옛 저장분을 소급해 늘리면 이미 쓴 사람만 손해를 본다.
 */
export function migrateArtifactCharges(nation) {
  for (const owned of nation.artifacts || []) {
    if (owned.chargesLeft != null) continue;
    owned.chargesLeft = owned.consumed ? 0 : 1;
  }
}

function emptyHooks() {
  return {
    flags: {}, outputBonus: {}, enemyPowerMultipliers: {}, eventWeightMultipliers: {}, immunities: {},
    surgeMultiplier: 1, populationLossMultiplier: 1, rewardGoldMultiplier: 1, goldMultiplier: 1,
    xpMultiplier: 1, buildCostMultiplier: 1, tariffDelta: 0, tariffZeroCharges: 0, freightDelta: 0,
    discoverChanceBonus: 0, weaponOilDelta: 0, populationCapDelta: 0, warnLeadDelta: 0,
    autoAssignDefenders: 0, exemptNationId: null, revealSupplyNationId: null, premiumTrade: {},
    expressionQuality: 1, cosmetics: [], freeUpgrades: {}, costDiscounts: {}, costDiscountCategories: {},
    nextInvasionPowerMultiplier: null, blindNextInvasion: false, instantSettle: false,
    // ★ §20-R1 신규 — 아래 다섯은 전부 소비처가 있다(성벽·무기 강재·환스프레드·격퇴 사기·무역로 거점).
    wallHpMultiplier: 1, weaponSteelMultiplier: 1, fxSpreadMultiplier: 1, moraleDeltaOnVictory: 0,
    buildingCostByKey: {}, tariffExemptAll: false,
  };
}

/** 소모형이 남긴 지속 효과(사용 후 상태)는 nation.artifactState 에 누적된다. */
function applyState(h, nation) {
  const st = nation.artifactState || {};
  for (const [tag, charges] of Object.entries(st.immunities || {})) if (charges > 0) h.immunities[tag] = charges;
  if (st.freeUpgrades) for (const [b, n] of Object.entries(st.freeUpgrades)) if (n > 0) h.freeUpgrades[b] = n;
  if (st.costDiscounts) for (const [b, v] of Object.entries(st.costDiscounts)) h.costDiscounts[b] = v;
  if (st.costDiscountCategories) for (const [c, v] of Object.entries(st.costDiscountCategories)) h.costDiscountCategories[c] = v;
  if (st.tariffZeroCharges) h.tariffZeroCharges += st.tariffZeroCharges;
  if (st.populationLossOverride != null) h.populationLossMultiplier = Math.min(h.populationLossMultiplier, st.populationLossOverride);
  if (st.blindNextInvasion) h.blindNextInvasion = true;
  if (st.nextInvasionPowerMultiplier) h.nextInvasionPowerMultiplier = st.nextInvasionPowerMultiplier;
}

/**
 * 보유 유물의 effect descriptor 를 엔진 훅 묶음으로 집계한다.
 * ★ §20-R1 — 다 쓴 소모형이라도 **onUse 가 아닌 효과는 계속 산다**(불멸의 주춧돌의 성벽 내구,
 *   국경의 인장의 거점 할인처럼 「쓰고도 남는 것」이 §20-2 표에 생겼기 때문이다).
 */
export function collectHooks(nation, data) {
  const h = emptyHooks();
  for (const owned of nation.artifacts || []) {
    const def = data.artifactsByKey[owned.key];
    if (!def) continue;
    const spent = chargesOf(owned, def) <= 0;
    for (const e of def.effects || []) {
      if (spent && e.hook === 'onUse') continue;
      applyDescriptor(h, e, owned, def);
    }
  }
  applyState(h, nation);
  h.discoverChanceBonus = Math.min(h.discoverChanceBonus, data.balance.artifacts.discoverChanceCap);
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
    default: applyR1Descriptor(h, e); break;   // ★ §20-R1 신규 op · onUse 계열은 useArtifact 에서
  }
}

/** ★ §20-R1 신규 op — 전부 소비처가 있다(주석의 파일명이 그 자리다). */
function applyR1Descriptor(h, e) {
  switch (e.op) {
    case 'wallHpMultiplier': h.wallHpMultiplier *= e.multiplier; break;                 // battle.js
    case 'weaponSteelMultiplier': h.weaponSteelMultiplier *= e.multiplier; break;       // equipment.js
    case 'spreadMultiplier': h.fxSpreadMultiplier *= e.multiplier; break;               // economy.js
    case 'moraleDeltaOnVictory': h.moraleDeltaOnVictory += e.amount; break;             // battle.js
    case 'tariffExemptAll': h.tariffExemptAll = true; break;                            // economy.js
    case 'tradeRouteCostMultiplier':                                                    // build_cost.js
      for (const b of e.buildings || []) h.buildingCostByKey[b] = (h.buildingCostByKey[b] ?? 1) * e.multiplier;
      break;
    /* ★ §20-R1 — 아직 없는 시스템(W4 국가 이벤트)에 걸린 효과. 수집만 한다:
       factionChoiceBonus(세계수의 파편) · contractGrace(동방의 인장) · nationEventForecastDays(우정의 서약서).
       W4 가 서면 아래 한 줄을 지우고 훅 칸을 열면 된다 — 데이터는 이미 정본이다. */
    default: break;
  }
}

/**
 * ★ §20-R1.5 — 발견 사실 한 벌. 세 경로(어전 회의 상자·유적 카드·숨은 궤)가 **같은 모양**으로 낸다.
 * 「왜」 여기서 문장을 만들지 않나 — 서사는 표현 계층(server/expression)의 몫이다.
 * 엔진은 사실과 **뽑기 씨앗**만 넘긴다: 그래야 시뮬·검사가 도는 자리에서 난수도 LLM 도 끼어들지 않는다.
 */
export function artifactFoundEvent(world, nation, key, source, data, opts = {}) {
  const def = data.artifactsByKey[key];
  if (!def) return null;
  const label = data.templates.artifactNarrative?.sourceNames?.[source] ?? source;
  const who = finderOf(nation, opts.avatarId);
  return {
    tick: world.tick, kind: 'artifact_found', nationId: nation.id,
    data: { artifact: def.name, key: def.key, grade: def.grade, category: def.category,
      effect: def.desc, source, role: label,
      // ★ §20-R2 — 연출 급과 자리. 더하기만 한 칸이라 이것을 모르는 옛 화면도 그대로 산다.
      fxTier: fxTierOf(def, data), foundBy: who?.name ?? null, foundById: opts.avatarId ?? null,
      nodePos: foundPos(world, nation, who, opts),
      // 서사 뽑기의 씨앗 — 월드 난수를 축내지 않는다(같은 판의 같은 발견은 같은 서사를 낸다)
      narrativeSeed: `${world.seed}:artifactNarrative:${def.key}:${world.tick}` },
  };
}

/** 연출 급 — 유물이 제 값을 적었으면 그것이, 아니면 등급표의 기본값이 이긴다(§20-11). */
export function fxTierOf(def, data) {
  return def?.fxTier ?? data.artifacts.grades[def?.grade]?.fxTier ?? 1;
}

const finderOf = (nation, avatarId) => (avatarId ? nation.avatars?.[avatarId] ?? null : null);

/**
 * ★ §20-R2 — 빛기둥이 설 자리. 「왜」 세 겹으로 물러서나 —
 * 궤는 제 자리를 알고(opts.pos), 어전 회의는 자리가 없다(찾은 사람 곁 → 그마저 없으면 도읍).
 * 방 안의 다른 사람에게도 같은 좌표가 가므로 아무도 「어디서 났는지」를 놓치지 않는다.
 */
function foundPos(world, nation, who, opts) {
  const at = opts.pos ?? who ?? townOf(world, nation.id);
  if (!at || at.x == null) return null;
  return { x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 };
}

/**
 * ★ §20-R1.5 — 언어의 돌이 올려 주는 표현 품질. 훅 묶음 전체를 빚지 않고 이 한 칸만 훑는다:
 * 이 값을 묻는 자리(server/index.js 의 이벤트 장식)는 스윙마다 도는 가장 뜨거운 길목이다.
 */
export function expressionQualityOf(nation, data) {
  const levels = (nation?.artifacts || [])
    .flatMap((owned) => data.artifactsByKey[owned.key]?.effects || [])
    .filter((e) => e.op === 'expressionQuality')
    .map((e) => e.level);
  return Math.max(1, ...levels);
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
  const def = data.artifactsByKey[key];
  if (!def) return null;
  if ((nation.artifacts || []).some((a) => a.key === key)) return null;
  // ★ §20-R1 — 「N회 충전」은 정의표의 charges 가 정본. 없으면 옛 규칙 그대로 1회.
  const entry = { key, obtainedTick: tick, consumed: false, chargesLeft: Math.max(1, def.charges ?? 1) };
  if (opts.boundNationId) entry.boundNationId = opts.boundNationId;
  (nation.artifacts ||= []).push(entry);
  for (const e of def.effects || []) {
    if (e.hook === 'onObtain' && e.op === 'oneTimeOutputPenalty') {
      (nation.buffs ||= []).push({ id: `artifact_penalty_${key}`, name: `${def.name} 대가`, outputBonus: -e.ratio, expiresTick: tick + e.durationTicks });
    }
  }
  return entry;
}

/**
 * ★ §20-R1 소모형 스케일링 — 고정치는 후반에 무의미해진다(§20-2 상향 원칙 ②).
 * 비율·최소치는 전부 descriptor(data/artifacts.json)에 있다 — 여기 숫자는 없다.
 */
function scaledResourceAmount(nation, data, e) {
  const cap = storageCapacity(nation, e.resource, data);
  return Math.round(Math.max(e.min ?? 0, cap * (e.capRatio ?? 0)));
}

function scaledGoldAmount(nation, e) {
  return Math.round(Math.max(e.min ?? 0, (e.perTier ?? 0) * settlementTier(nation)));
}

/** 소모형 유물 사용 — ★ §20-R1: 충전이 남아 있는 동안 여러 번 쓴다. */
export function useArtifact(nation, key, tick, data) {
  const def = data.artifactsByKey[key];
  if (!def) return { ok: false, code: 'UNKNOWN_ARTIFACT', message: '알 수 없는 유물입니다.' };
  const owned = (nation.artifacts || []).find((a) => a.key === key);
  if (!owned) return { ok: false, code: 'NOT_OWNED', message: '보유하지 않은 유물입니다.' };
  if (chargesOf(owned, def) <= 0) return { ok: false, code: 'ALREADY_USED', message: '이미 사용한 유물입니다.' };
  const uses = (def.effects || []).filter((e) => e.hook === 'onUse');
  if (!uses.length) return { ok: false, code: 'NOT_CONSUMABLE', message: '사용할 수 있는 유물이 아닙니다.' };

  const st = (nation.artifactState ||= { immunities: {}, freeUpgrades: {}, costDiscounts: {}, tariffZeroCharges: 0 });
  const applied = [];
  for (const e of uses) applyUse(nation, st, e, data, applied);
  spendCharge(owned, def, tick);
  return { ok: true, artifact: def, applied, chargesLeft: owned.chargesLeft, consumed: owned.consumed };
}

/** 충전 하나를 쓴다. 다 쓰면 그때 소진(consumed)으로 넘어간다. */
function spendCharge(owned, def, tick) {
  owned.chargesLeft = chargesOf(owned, def) - 1;
  if (owned.chargesLeft > 0) return;
  owned.consumed = true;
  owned.consumedTick = tick;
}

function applyUse(nation, st, e, data, applied) {
  switch (e.op) {
    case 'grantResource': nation.resources[e.resource] = (nation.resources[e.resource] || 0) + e.amount; applied.push(`${e.resource}+${e.amount}`); break;
    case 'grantResourceScaled': {
      const amount = scaledResourceAmount(nation, data, e);
      nation.resources[e.resource] = (nation.resources[e.resource] || 0) + amount;
      applied.push(`${e.resource}+${amount}`);
      break;
    }
    case 'grantGold': nation.gold += e.amount; applied.push(`gold+${e.amount}`); break;
    case 'grantGoldScaled': {
      const amount = scaledGoldAmount(nation, e);
      nation.gold += amount;
      applied.push(`gold+${amount}`);
      break;
    }
    case 'grantImmunity': st.immunities[e.eventTag] = (st.immunities[e.eventTag] || 0) + e.charges; applied.push(`immunity:${e.eventTag}`); break;
    case 'damageReduction': st.damageReduction = { eventTag: e.eventTag, ratio: e.ratio, charges: e.charges }; applied.push(`mitigate:${e.eventTag}`); break;
    case 'freeUpgrade': st.freeUpgrades[e.building] = (st.freeUpgrades[e.building] || 0) + e.charges; applied.push(`free:${e.building}`); break;
    case 'costDiscount': st.costDiscounts[e.building] = e.ratio; applied.push(`discount:${e.building}`); break;
    // ★ §20-R1 — 「생산 건물 아무 것이나」. 건물 하나가 아니라 계열(buildings.json category)에 붙는다.
    case 'costDiscountCategory': (st.costDiscountCategories ||= {})[e.category] = e.ratio; applied.push(`discount:${e.category}`); break;
    case 'tariffZeroOnce': st.tariffZeroCharges = (st.tariffZeroCharges || 0) + e.charges; applied.push('tariff0'); break;
    case 'tariffDeltaAllNations': st.tariffDeltaAll = { amount: e.amount, charges: e.charges }; applied.push('tariffAll'); break;
    case 'instantCouncil': st.instantCouncil = true; applied.push('council'); break;
    case 'instantTradeRoute': st.instantTradeRoute = true; applied.push('route'); break;
    // ★ §20-R1 — 악마와의 계약서의 값. 다음 전투 하나에만 붙고 startBattle 이 쓰고 지운다.
    case 'nextInvasionPowerBump': st.artifactNextInvasionMultiplier = e.multiplier; applied.push('invasionUp'); break;
    default: applyUseRole(nation, st, e, data, applied); break;
  }
}

function applyUseRole(nation, st, e, data, applied) {
  switch (e.op) {
    case 'npcLevelUp': {
      const r = nation.roles?.[e.role];
      if (r) { r.level = (r.level || 0) + e.levels; applied.push(`${e.role}+${e.levels}Lv`); }
      break;
    }
    case 'maxOneRoleLevel': maxOneRole(nation, e, data, applied); break;
    case 'revealTag': st.tagLeaked = true; st.tagLeakCount = e.count ?? 1; applied.push('revealTag'); break;
    case 'blindNextInvasion': st.blindNextInvasion = true; applied.push('blind'); break;
    default: break;
  }
}

function maxOneRole(nation, e, data, applied) {
  // TODO(R4 · 유물기획 §20-11): 어느 역할을 최대치로 올릴지 고르는 tyrantPick 명령이 필요하다.
  //   R1 에서는 정본 수치(othersPenalty)만 갱신하고, 고르는 자리는 최고 레벨 역할로 둔다.
  const roles = Object.entries(nation.roles || {}).filter(([, r]) => r.holder);
  if (!roles.length) return;
  roles.sort((a, b) => (b[1].level || 0) - (a[1].level || 0));
  roles[0][1].level = data.roles.xp.levelCurve.length - 1;
  for (const [, r] of roles.slice(1)) r.level = Math.max(0, (r.level || 0) * (1 - e.othersPenalty));
  applied.push(`maxRole:${roles[0][0]}`);
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
