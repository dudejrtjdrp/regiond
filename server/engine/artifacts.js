// 유물 — effect descriptor 집계 + 드랍 판정 + 소모형 사용
// 유물은 50종이 정본이다(19+17+6+7 + 왕관의 조각). SPEC 초안의 '47종'은 오기였고 docs/SPEC.md §9 를 50 으로 정정했다.
// ★ §20-R1 (docs/유물기획.md §20-1·§20-2) — 등급 재편·효과 상향·충전제 일반화가 여기 얹혔다.
import { clamp, storageCapacity } from './economy.js';
import { settlementTier } from './tiers.js';
// ★ §20-R2 — 연출의 빛기둥이 설 자리를 모를 때 물러설 곳(도읍)
import { townOf } from './world.js';
// ★ §20-R3 — 발견은 정착지의 역사다. 연대기에 발견자 이름과 함께 남는다.
import { record as chronicle } from './chronicle.js';

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
    /* ★ §20-R4(유물기획 §20-3~6) — 신규 축. 「왜」 여기 한 벌로 모으나 — 소비처가 열두 파일에
       흩어져 있어서(tick·ecology·battle·waves·residents·research·train·fog·trails·structures·skills·view),
       각자 nation 을 다시 훑으면 뜨거운 길목마다 유물 목록을 도는 꼴이 된다. 훅은 하루 한 번 걷고,
       실시간 경로는 tick 이 국가에 박아 두는 거울(nation.artifact*)을 읽는다(§20-R4 mirrors). */
    dayOutputBonus: {},            // tick.js — 웨이브 당일이 아닌 날만 산다
    moveSpeedDelta: 0, moveSpeedWaveDelta: 0,   // view.clientStats → public/js/avatar.js
    dodgeChance: 0,                // battle.js 피격 · ecology.js 물기
    critChance: 0, critMultiplier: 1,           // skills.swingDamage 를 쓰는 네 자리
    attackMultiplier: 1, combatDamageMultiplier: 1, huntShareMultiplier: 1,
    reviveCharges: 0,              // down 대신 그 자리에서 일어난다(웨이브당 N회)
    speciesDamageStack: null,      // { perKill, cap } — 도감 처치 수와 곱한다
    auraTiles: [],                 // 설치형(심은 것만) — { key, radius, depts, delta, ... }
    snowBuildLimit: 0, fogAutoReveal: 0, healMultiplier: 1,
    popInflowMultiplier: 1, maxHpMultiplier: 1, npcSpeedDelta: 0,
    trailSenseDelta: 0, chainRewardTierDelta: 0,
    trainCargoMultiplier: 1, researchSpeedMultiplier: 1, craftTimeMultiplier: 1,
    moraleDelta: 0, emotionDayMultiplier: 1, spoilImmune: false,
    buildingOutputBonus: {}, dailyGrants: [], revealCacheHints: [], chronicleTags: [],
    sets: {},                      // { setKey: { owned, name, tiers:[2,4] } } — 도감·화면용
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
    // ★ §20-R4 — 봉인한 저주는 **기록은 남고 효과만 꺼진다**(§20-6). 「낄까 말까」를 되돌릴 수 있어야
    //   실험이 일어난다. 되돌린 것까지 지우면 그 실험의 흔적마저 사라진다.
    if (owned.sealed) continue;
    // 설치형은 심기 전까지 아무 일도 하지 않는다 — 씨앗은 들고 있는 동안 열매를 맺지 않는다.
    if (def.type === 'installable' && !owned.planted) continue;
    const spent = chargesOf(owned, def) <= 0;
    for (const e of def.effects || []) {
      if (spent && e.hook === 'onUse') continue;
      applyDescriptor(h, e, owned, def);
    }
  }
  applySetBonuses(h, nation, data);   // ★ §20-R4(§20-5) — 단품과 **합산**이다(중첩 규칙 §20-10-5)
  applyState(h, nation);
  h.discoverChanceBonus = Math.min(h.discoverChanceBonus, data.balance.artifacts.discoverChanceCap);
  return h;
}

/**
 * ★ §20-R4(유물기획 §20-5) — 세트 보너스. 조각 수를 세어 **충족한 문턱을 전부** 얹는다:
 * 4개짜리를 다 모으면 2개 보너스도 함께 산다(누적). 「왜」 최고 문턱만 주지 않나 —
 * 세트는 「모으는 재미」가 값이고, 마지막 조각에서 앞의 보너스가 사라지면 손해 본 기분이 든다.
 * 봉인·미설치는 위에서 이미 걸렀지만 **조각 수는 보유 기준**이다(봉인해도 세트는 셈에 든다):
 * 저주 조각을 봉인했다고 세트가 깨지면 봉인이 실질적 파기가 되어 §20-6 의 약속을 어긴다.
 */
function applySetBonuses(h, nation, data) {
  const sets = data.artifacts.sets || {};
  const owned = new Set((nation.artifacts || []).map((a) => a.key));
  for (const [setKey, def] of Object.entries(sets)) {
    const have = (def.pieces || []).filter((k) => owned.has(k)).length;
    if (!have) continue;
    const tiers = Object.keys(def.bonuses || {}).map(Number).filter((n) => n <= have).sort((a, b) => a - b);
    h.sets[setKey] = { name: def.name ?? setKey, owned: have, total: (def.pieces || []).length, tiers };
    for (const t of tiers) for (const e of def.bonuses[String(t)] || []) applyDescriptor(h, e, {}, def);
  }
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
    default: applyR4Descriptor(h, e); break;
  }
}

/**
 * ★ §20-R4 신규 op — 주석의 파일명이 그 효과가 실제로 사는 자리다.
 * 「곱하나 더하나」의 규칙(§20-10-5): 같은 축의 **배수는 곱**, 확률·평탄값은 **더한다**.
 * 회피처럼 「둘 다 걸리면 안 되는」 확률만 여집합 곱(1−(1−a)(1−b))으로 상한 1을 넘지 않게 한다.
 */
function applyR4Descriptor(h, e) {
  switch (e.op) {
    case 'dayOutputBonus':                                                              // tick.js
      h.dayOutputBonus[e.resource] = (h.dayOutputBonus[e.resource] || 0) + e.delta; break;
    case 'moveSpeedDelta':                                                              // view.js → avatar.js
      h.moveSpeedDelta += e.amount || 0; h.moveSpeedWaveDelta += e.waveAmount || 0; break;
    case 'dodgeChance': h.dodgeChance = 1 - (1 - h.dodgeChance) * (1 - (e.chance || 0)); break; // battle·ecology
    case 'critChance':                                                                  // skills.swingDamage 소비처
      h.critChance = 1 - (1 - h.critChance) * (1 - (e.chance || 0));
      h.critMultiplier = Math.max(h.critMultiplier, e.multiplier || 1); break;
    case 'attackMultiplier': h.attackMultiplier *= e.multiplier; break;                 // ecology·battle·waves
    case 'combatDamageMultiplier': h.combatDamageMultiplier *= e.multiplier; break;     // battle.js
    case 'huntShareMultiplier': h.huntShareMultiplier *= e.multiplier; break;           // ecology.js
    case 'reviveCharge': h.reviveCharges += e.perWave || 0; break;                      // ecology·battle
    case 'speciesDamageStack':                                                          // ecology.js + codex.js
      h.speciesDamageStack = { perKill: Math.max(h.speciesDamageStack?.perKill ?? 0, e.perKill || 0),
                               cap: Math.max(h.speciesDamageStack?.cap ?? 0, e.cap || 0) }; break;
    case 'auraTile':                                                                    // tick.js(설치형)
      h.auraTiles.push({ radius: e.radius, depts: e.depts || [], delta: e.delta,
                         growthStages: e.growthStages ?? 1, growthDays: e.growthDays ?? 0 }); break;
    case 'snowBuildUnlock': h.snowBuildLimit = Math.max(h.snowBuildLimit, e.limit || 0); break;  // structures.js
    case 'fogAutoReveal': h.fogAutoReveal += e.radiusPerDay || 0; break;                // tick.js·fog.js
    case 'healMultiplier': h.healMultiplier *= e.multiplier; break;                     // ecology.js
    case 'popInflowMultiplier': h.popInflowMultiplier *= e.multiplier; break;           // residents.js
    case 'maxHpMultiplier': h.maxHpMultiplier *= e.multiplier; break;                   // skills.js
    case 'npcSpeedDelta': h.npcSpeedDelta += e.amount || 0; break;                      // villagers(뷰)
    case 'trailSenseDelta': h.trailSenseDelta += e.amount || 0; break;                  // trails.js
    case 'chainRewardTierDelta': h.chainRewardTierDelta += e.amount || 0; break;        // trails.js
    case 'trainCargoMultiplier': h.trainCargoMultiplier *= e.multiplier; break;         // train.js
    case 'researchSpeedMultiplier': h.researchSpeedMultiplier *= e.multiplier; break;   // research.js
    case 'craftTimeMultiplier': h.craftTimeMultiplier *= e.multiplier; break;           // equipment.js
    case 'moraleDelta': h.moraleDelta += e.amount || 0; break;                          // tick.js(상시 사기)
    case 'emotionDayMultiplier': h.emotionDayMultiplier *= e.multiplier; break;         // emotion_day.js
    case 'spoilImmune': h.spoilImmune = true; break;                                    // tick.js(부패)
    case 'buildingOutputBonus':                                                         // tick.js
      for (const b of e.buildings || []) h.buildingOutputBonus[b] = (h.buildingOutputBonus[b] || 0) + e.delta;
      break;
    case 'dailyGrant': h.dailyGrants.push({ resource: e.resource, amount: e.amount, requireStage: e.requireStage ?? 0 }); break;
    case 'revealCacheHint': h.revealCacheHints.push({ count: e.count ?? 1, biome: e.biome ?? null }); break;
    case 'unlockChronicle': h.chronicleTags.push(e.tag); break;
    default: break;   // 아직 시스템이 없는 효과는 조용히 수집만 — 데이터가 정본, 훅은 나중
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
  recordArtifactFound(world, nation, key, data, opts);      // ★ §20-R3 — 세계에 먼저 적는다
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

/**
 * ★ §20-R3 — 연대기 한 줄. 「왜」 이름을 병기하나 — 「내가 찾았다」의 저작권이 이 리워크의 값이다.
 * 발견자를 모르면(어전 회의 상자) 나라의 일이므로 예전처럼 이름 없이 적는다.
 * @param {object} found artifactFoundEvent 가 낸 것 @param {object} drop {name, desc, grade, key}
 */
export function chronicleArtifact(world, found, drop, data) {
  const by = found?.data?.foundBy ?? null;
  const title = by ? `${drop.name} — ${by}` : drop.name;
  return chronicle(world, { kind: 'artifact', title, text: drop.desc,
    data: { ...drop, foundBy: by, foundDate: found?.data?.foundDate ?? null } }, data);
}

/**
 * ★ §20-R3(유물기획 §20-8) — 발견을 **기록**으로 남긴다. 「기록이 보상이다」의 뼈대.
 * 두 곳에 적는다: ① 보유 엔트리(누가·언제 얻었나) ② 방 등록부(그 유물의 **최초** 발견자).
 * 「왜」 둘인가 — 엔트리는 「우리 나라의 것」이고 등록부는 「이 방의 역사」다. 유물을 소모해도,
 * 방에 나라가 여럿이라 같은 유물이 다시 나와도, 최초 발견의 이름은 한 번 적히면 바뀌지 않는다.
 */
export function recordArtifactFound(world, nation, key, data, opts = {}) {
  const owned = (nation.artifacts || []).find((a) => a.key === key);
  const who = finderOf(nation, opts.avatarId);
  const stamp = { foundBy: who?.name ?? null, foundById: opts.avatarId ?? null,
                  foundDate: gameDate(world.tick, data), foundRealAt: opts.realAt ?? new Date().toISOString() };
  if (owned && owned.foundDate == null) Object.assign(owned, stamp);
  return registerArtifact(world, key, world.tick, stamp);
}

/** 방 등록부 — 최초 발견자는 덮어쓰지 않는다. count 는 이 방에서 나온 누적 횟수다. */
function registerArtifact(world, key, tick, stamp) {
  const reg = (world.artifactRegistry ||= {});
  const cur = reg[key];
  if (cur) { cur.count = (cur.count || 0) + 1; return cur; }
  reg[key] = { firstFoundBy: stamp.foundBy, firstFoundById: stamp.foundById,
               firstFoundTick: tick, firstFoundDate: stamp.foundDate, count: 1 };
  return reg[key];
}

/**
 * ★ §20-R3 — 하루 눈금(tick)을 사람 말(N년 M일)로 옮긴다. **표시 전용**이다.
 * 달력의 정본은 balance.time.daysPerYear 하나뿐이고, 어떤 판정도 「해」를 읽지 않는다.
 */
export function gameDate(tick, data) {
  const per = data.balance.time.daysPerYear || 0;
  const day = Math.max(0, Math.floor(tick));
  if (per <= 0) return { year: 1, day: day + 1 };
  return { year: Math.floor(day / per) + 1, day: (day % per) + 1 };
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

/**
 * ★ §20-R4(유물기획 §20-1·§20-9) — **상자 밖 축**의 문지기. 「희소는 경로로 만든다」가 여기 한 함수에 산다.
 * 세 가지를 함께 건다:
 *   ① `acquireVia` — 그 유물이 이 경로에서 나올 수 있다고 **제 입으로 적었을 때만** 나온다.
 *      옛 50종은 전부 chest·ruin·cache 를 적어 두었으므로 기존 세 풀은 한 톨도 바뀌지 않는다
 *      (= 시드 42 가 그대로 산다). 신규 21종은 어느 것도 그 셋을 적지 않아 자동으로 빠진다.
 *   ② `exclusive: "room"` — 이 방에서 이미 나온 전설은 다시 나오지 않는다(§20-4 잼 규칙).
 *   ③ 보유분 제외 — 기존 규칙 그대로.
 * 「왜」 등급표를 안 고치고 풀만 거르나 — 등급표(gradeWeights)는 팀 원안의 정본이고(§20-R1.5),
 * 표를 흔들면 상자·유적·궤가 한꺼번에 움직인다. 표는 그대로 두고 **명단**만 좁힌다.
 */
export function dropPool(world, nation, data, grade, via) {
  const owned = new Set((nation.artifacts || []).map((a) => a.key));
  const reg = world?.artifactRegistry || {};
  return data.artifacts.list.filter((a) => {
    if (a.grade !== grade || owned.has(a.key)) return false;
    if (a.exclusive === 'room' && reg[a.key]) return false;
    const via1 = a.acquireVia;
    if (!via1 || !via1.length) return true;          // 경로를 안 적은 옛 엔트리는 예전처럼 어디서나
    return via1.includes(via);
  });
}

/**
 * ★ §20-R4 — 링3 전용 고유 굴림. 기본 굴림이 **빈손으로 끝난 뒤에만** 한 번 더 던진다(§20-9 링3 고유 5%).
 * 「왜」 나중에 던지나 — 앞의 굴림이 소비하는 난수를 한 톨도 건드리지 않아야 옛 지도의 옛 궤가
 * 예전과 같은 것을 낸다. 궤의 난수는 노드마다 따로 흐르므로(statRng `seed:cache:nodeId`)
 * 여기서 몇 번을 더 던져도 다른 궤·월드 난수에는 닿지 않는다.
 */
export function rollRing3Unique(world, nation, data, rng, ring) {
  const table = data.balance.artifacts.ringDropTable || {};
  const chance = table.ring3UniqueChance ?? 0;
  if (ring < 3 || chance <= 0) return null;
  if (!rng.chance(chance)) return null;
  const pool = dropPool(world, nation, data, 'unique', 'cache3');
  if (!pool.length) return null;
  return rng.pick(pool).key;
}

/** 어전 회의 상자 판정. rng 2~3회 소비. */
export function rollArtifactDrop(nation, data, rng, roleActivity = {}, world = null) {
  const cfg = data.balance.artifacts;
  const hooks = collectHooks(nation, data);
  const chance = clamp(cfg.chestChancePerCouncil + hooks.discoverChanceBonus, 0, cfg.discoverChanceCap);
  if (!rng.chance(chance)) return { opened: false, chance };

  const grade = rng.weighted(Object.entries(cfg.gradeWeights).map(([value, weight]) => ({ value, weight })));
  const pool = dropPool(world, nation, data, grade, 'chest');
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
  /* ★ 4단계 — 봉인은 「힘이 잠든다」는 약속이다. 집계(collectHooks)에서만 빼고 손으로 쓰는 문은
     열어 두면 그 약속이 반만 참이 된다 — 봉인해 둔 소모형이 그대로 터진다. 풀면 다시 쓸 수 있다. */
  if (owned.sealed) return { ok: false, code: 'SEALED', message: '봉인된 유물입니다. 먼저 봉인을 푸십시오.' };
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
  /* ★ §20-R4 — R1 의 빚을 갚는다. 그때는 「최고 레벨 역할」로 대신 골랐는데, 그건 고르는 게 아니라
     따라가는 것이었다 — 폭군의 왕관은 **누구를 세울지 정하는** 값이 전부인 유물이다.
     이제 tyrantPick 명령이 적어 둔 자리를 먼저 읽고, 안 적혔으면 예전 규칙으로 물러선다
     (화면이 못 고르게 된 판에서도 유물이 죽지 않아야 하니까). 쓴 자리는 그 즉시 비운다. */
  const roles = Object.entries(nation.roles || {}).filter(([, r]) => r.holder);
  if (!roles.length) return;
  const picked = nation.pendingTyrantRole;
  nation.pendingTyrantRole = null;
  let chosen = picked && nation.roles?.[picked]?.holder ? picked : null;
  if (!chosen) {
    roles.sort((a, b) => (b[1].level || 0) - (a[1].level || 0));
    chosen = roles[0][0];
  }
  nation.roles[chosen].level = data.roles.xp.levelCurve.length - 1;
  for (const [k, r] of roles) {
    if (k === chosen) continue;
    r.level = Math.max(0, (r.level || 0) * (1 - e.othersPenalty));
  }
  applied.push(`maxRole:${chosen}`);
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

// ────────────────────────────────────────────────────────────────
// ★ §20-R4 — 유물이 세계에 손을 대는 세 가지 (봉인·설치·선택)
// ────────────────────────────────────────────────────────────────

/**
 * 유물 봉인 (유물기획 §20-6) — 「지금 이 힘을 끌 수 있다」는 유일한 문.
 * 기록은 남고 효과만 꺼진다: 발견의 저작권(§20-8)은 어떤 경우에도 지우지 않는다.
 * 되돌리기(해봉)도 같은 값을 받고 열어 둔다 — 「낄까 말까」가 한 번뿐이면 실험이 아니라 도박이 된다.
 *
 * ★ 4단계(2026-08-10) — 「왜」 저주만이 아니라 **모든 유물**로 넓혔나.
 * 이 게임에는 착용/해제가 없다. 유물은 얻는 순간부터 영영 켜져 있고, 유저가 「이건 지금 끄고 싶다」고
 * 생각할 자리(사냥터를 바꾼다·세트를 갈아 낀다·이번 침공만 다르게 싸운다)가 통째로 없었다.
 * 봉인은 이미 「효과만 끄고 기록은 남긴다」를 하는 자다 — 새 규약을 짓지 않고 그 문을 넓히는 것이
 * 착용/해제의 1차 대체다. 저주만 값을 무는 것은 그대로 둔다(§20-6 「버릴 수 있다」의 값):
 * 저주는 **끄는 것이 이득**이라 값이 없으면 저주가 저주가 아니게 된다. 여느 유물은 끄면 손해이므로
 * 값을 물릴 까닭이 없다 — 값의 정본은 balance.artifacts 의 두 다이얼이다.
 */
export const sealCostOf = (def, data) => Math.max(0, (def?.curse
  ? data.balance.artifacts.sealCostGold
  : data.balance.artifacts.sealCostGoldPlain) ?? 0);

export function sealArtifact(nation, key, data, want = true) {
  const def = data.artifactsByKey[key];
  if (!def) return { ok: false, code: 'UNKNOWN_ARTIFACT', message: '알 수 없는 유물입니다.' };
  const owned = (nation.artifacts || []).find((a) => a.key === key);
  if (!owned) return { ok: false, code: 'NOT_OWNED', message: '보유하지 않은 유물입니다.' };
  const sealed = Boolean(owned.sealed);
  if (sealed === want) {
    return { ok: false, code: 'ALREADY', message: want ? '이미 봉인했습니다.' : '봉인되어 있지 않습니다.' };
  }
  const cost = sealCostOf(def, data);
  if ((nation.gold || 0) < cost) return { ok: false, code: 'NO_GOLD', message: '골드가 부족합니다.', need: cost };
  nation.gold = Math.round((nation.gold - cost) * 100) / 100;
  nation.stats.goldSpent = Math.round(((nation.stats.goldSpent || 0) + cost) * 100) / 100;
  owned.sealed = want;
  return { ok: true, key, name: def.name, sealed: want, cost, gold: nation.gold };
}

/**
 * 설치형 심기 (유물기획 §20-3 세계수의 씨앗) — **어디에 심느냐가 의사결정**이다.
 * 자리를 국가 영역 안으로 묶는 까닭: 반경 보너스가 남의 땅이나 안개 속에서 자라면
 * 「심을 자리 선정」이 성립하지 않는다. 심은 뒤에는 옮기지 못한다 — 나무는 그런 것이다.
 */
export function plantArtifact(world, nation, key, x, y, data) {
  const def = data.artifactsByKey[key];
  if (!def) return { ok: false, code: 'UNKNOWN_ARTIFACT', message: '알 수 없는 유물입니다.' };
  if (def.type !== 'installable') return { ok: false, code: 'NOT_INSTALLABLE', message: '심을 수 있는 유물이 아닙니다.' };
  const owned = (nation.artifacts || []).find((a) => a.key === key);
  if (!owned) return { ok: false, code: 'NOT_OWNED', message: '보유하지 않은 유물입니다.' };
  if (owned.planted) return { ok: false, code: 'ALREADY_PLANTED', message: '이미 심었습니다.' };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, code: 'BAD_POS', message: '자리가 올바르지 않습니다.' };
  const town = townOf(world, nation.id);
  const radius = data.balance.artifacts.plantRadiusTiles ?? 24;
  if (town && Math.hypot(town.x - x, town.y - y) > radius) {
    return { ok: false, code: 'TOO_FAR', message: '본영에서 너무 멉니다.' };
  }
  owned.planted = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, tick: world.tick, stage: 0 };
  return { ok: true, key, name: def.name, planted: owned.planted };
}

/**
 * 자란다 — 하루 한 눈금. 「왜」 tick 에서 부르나: 성장은 날의 일이고, 실시간 스윙이 알 바가 아니다.
 * 단계가 오른 것만 돌려준다(연출·알림은 부른 쪽 몫).
 */
export function growPlanted(nation, tick, data) {
  const grown = [];
  for (const owned of nation.artifacts || []) {
    const p = owned.planted;
    if (!p) continue;
    const def = data.artifactsByKey[owned.key];
    const aura = (def?.effects || []).find((e) => e.op === 'auraTile');
    if (!aura) continue;
    const per = Math.max(1, aura.growthDays ?? 1);
    const max = Math.max(1, aura.growthStages ?? 1);
    const want = Math.min(max, Math.floor((tick - p.tick) / per));
    if (want <= p.stage) continue;
    p.stage = want;
    grown.push({ key: owned.key, name: def.name, stage: want, max, x: p.x, y: p.y });
  }
  return grown;
}

/**
 * 심은 것의 반경 보너스 — 다 자란 것만 제 값을 낸다(그 전에는 단계 비례).
 * 부서(dept)별로 돌려준다: 산출 집계(tick.js departmentMultiplier)가 부서 단위로 곱하기 때문이다.
 * 「왜」 반경 안 건물 수를 세지 않나 — 산출은 부서로 뭉쳐 계산되고 건물별로 쪼개져 있지 않다.
 * 대신 **본영에서 반경 안에 심었을 때만** 부서 전체에 얹어(§20-3 「본영에 심는」) 자리 선정의 값을 남긴다.
 */
export function auraDeptBonus(world, nation, data) {
  const out = {};
  const town = townOf(world, nation.id);
  for (const owned of nation.artifacts || []) {
    const p = owned.planted;
    if (!p || owned.sealed) continue;
    const def = data.artifactsByKey[owned.key];
    for (const e of def?.effects || []) {
      if (e.op !== 'auraTile') continue;
      if (!town || Math.hypot(town.x - p.x, town.y - p.y) > (e.radius ?? 0)) continue;
      const ratio = Math.min(1, (p.stage || 0) / Math.max(1, e.growthStages ?? 1));
      if (ratio <= 0) continue;
      for (const dept of e.depts || []) out[dept] = (out[dept] || 0) + (e.delta || 0) * ratio;
    }
  }
  return out;
}

/**
 * 폭군의 왕관이 고르는 자리 (R1 의 TODO 를 여기서 갚는다 — 유물기획 §20-11 tyrantPick).
 * R1 은 「최고 레벨 역할」로 대신 골랐다: 그건 고르는 게 아니라 따라가는 것이었다.
 * 이제 고른 역할을 국가에 적어 두고(pendingTyrantRole), useArtifact 가 그것을 읽는다.
 */
export function pickTyrantRole(nation, role, data) {
  if (!data.roles?.defs?.[role] && !nation.roles?.[role]) {
    return { ok: false, code: 'UNKNOWN_ROLE', message: '알 수 없는 역할입니다.' };
  }
  if (!nation.roles?.[role]?.holder) return { ok: false, code: 'NO_HOLDER', message: '그 자리에는 사람이 없습니다.' };
  nation.pendingTyrantRole = role;
  return { ok: true, role };
}

/**
 * ★ §20-R4 거울 — 하루 한 번 걷은 훅을 국가에 박아 둔다. 실시간 경로(스윙·물기·이동)는
 * collectHooks 를 부르지 않고 이 칸만 읽는다: 스윙마다 유물 목록을 도는 것을 막는 기존 관례
 * (nation.artifactCapDelta · nation.storageBonus)를 그대로 넓힌 것이다.
 */
export function mirrorArtifactHooks(nation, hooks) {
  nation.artifactCombat = {
    crit: hooks.critChance, critMultiplier: hooks.critMultiplier,
    dodge: hooks.dodgeChance, attack: hooks.attackMultiplier,
    damage: hooks.combatDamageMultiplier, huntShare: hooks.huntShareMultiplier,
    revive: hooks.reviveCharges, species: hooks.speciesDamageStack,
    heal: hooks.healMultiplier,
  };
  nation.artifactMaxHpMultiplier = hooks.maxHpMultiplier;
  nation.artifactTrailSense = hooks.trailSenseDelta;
  nation.artifactPopInflow = hooks.popInflowMultiplier;
  nation.artifactSnowBuildLimit = hooks.snowBuildLimit;
  for (const p of Object.values(nation.players || {})) p.hpMultiplier = hooks.maxHpMultiplier;
}

/** 웨이브가 시작될 때 되감는다 — 「웨이브당 1회」의 정본. */
export function resetReviveCharges(nation) {
  nation.artifactReviveLeft = nation.artifactCombat?.revive ?? 0;
}

/**
 * 쓰러짐을 부활로 갈음한다 — 성표·계약서의 값. 남은 충전이 있으면 그 **자리에서** 일어난다
 * (본영으로 끌려가지 않는 것이 이 유물의 값이다). 쓴 만큼 줄고, 없으면 예전처럼 쓰러진다.
 */
export function consumeRevive(nation) {
  if ((nation.artifactReviveLeft ?? 0) <= 0) return false;
  nation.artifactReviveLeft -= 1;
  return true;
}

/** 종별 누적 피해 배수 — 도감 처치 수가 곧 전투력이 된다(§20-3 사냥꾼의 맹세). */
export function speciesDamageMultiplier(nation, speciesKey) {
  const s = nation.artifactCombat?.species;
  if (!s || !speciesKey) return 1;
  const kills = nation.codex?.species?.[speciesKey]?.kills || 0;
  return 1 + Math.min(s.cap || 0, (s.perKill || 0) * kills);
}

/**
 * ★ §20-R4b — 「경로가 유물을 낸다」의 공용 문. 사슬 결말·유적 카드·고대 신전·국가 이벤트가
 * 전부 이 하나를 지난다. 두 가지를 받는다:
 *   · `key` — 확정 지급(전설이 여기로 온다: §20-4 「판정도 확정이다」)
 *   · `via` — 그 태그를 적은 것 중에서 하나(dropPool 이 이미 방 유일·보유분을 걸러 준다)
 * 「왜」 여기 두나 — 부르는 자리가 넷인데 각자 dropPool 을 조립하면 「이미 가진 것을 또 준다」
 * 「이 방에서 나온 전설이 또 나온다」 같은 어긋남이 한 자리에서만 고쳐지지 않는다.
 * 난수는 부른 쪽이 쥔다(사슬은 statRng, 유적 카드는 월드 rng) — 여기서 새로 짓지 않는다.
 * @returns {object|null} 지급된 정의(def). 못 주면 null.
 */
export function grantVia(world, nation, data, rng, spec, tick) {
  if (!spec) return null;
  const chance = spec.chance ?? 1;
  if (chance < 1 && !rng.chance(chance)) return null;
  let key = spec.key ?? null;
  if (!key) {
    /* 등급표(55/32/8/5)의 **모양은 지키되**, 후보가 없는 등급은 셈에서 뺀다.
       「왜」 그냥 한 줄로 섞지 않나 — 신전 풀은 고유 2·전설 2 뿐이라 고르게 섞으면 전설이 절반이
       된다. 등급표를 다시 정규화하면 「전설은 드물다」가 풀이 좁아져도 살아남는다.
       「왜」 grantRandomArtifact 를 안 쓰나 — 그쪽은 등급을 먼저 굴리고 나서 거르기 때문에
       그 등급에 후보가 없으면 빈손으로 끝난다(신전이 그래서 열 번에 여덟 번 비었다). */
    const cfg = data.balance.artifacts.gradeWeights;
    const byGrade = Object.keys(cfg)
      .map((grade) => ({ grade, pool: dropPool(world, nation, data, grade, spec.via) }))
      .filter((g) => g.pool.length);
    if (!byGrade.length) return null;
    const grade = byGrade.length === 1 ? byGrade[0].grade
      : rng.weighted(byGrade.map((g) => ({ value: g.grade, weight: cfg[g.grade] ?? 1 })));
    key = rng.pick(byGrade.find((g) => g.grade === grade).pool).key;
  }
  const def = data.artifactsByKey[key];
  if (!def) return null;
  // 확정 지급이라도 이미 가졌거나 이 방에서 나온 전설이면 조용히 접는다 — 두 번 주지 않는다.
  if ((nation.artifacts || []).some((a) => a.key === key)) return null;
  if (def.exclusive === 'room' && world?.artifactRegistry?.[key]) return null;
  return grantArtifact(nation, key, tick, data) ? def : null;
}
