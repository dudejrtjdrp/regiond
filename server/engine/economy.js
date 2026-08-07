// 경제 엔진 — 순수 함수. 모든 계수는 data/*.json 에서 온다 (매직넘버 금지).

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Y = A × L^alpha × K^beta */
export function cobbDouglas(A, L, K, alpha, beta) {
  if (!(L > 0) || !(K > 0) || !(A > 0)) return 0;
  return A * Math.pow(L, alpha) * Math.pow(K, beta);
}

// TODO(기획): capitalPerBuildingTier 는 전부 0으로 두었다. 0이 아니면 밸런스 §6-4 검증표(서지 671 등)가
//            재현되지 않는다. SPEC §3-1의 'K는 건물 티어에 비례 성장'을 살릴지 확정 필요.
/** 부처 자본 K — 기준값 × (인구/기준인구) × (1 + 건물티어 자본성장) */
export function departmentCapital(nation, dept, data) {
  const p = data.balance.production;
  const base = p.baselineCapital[dept] ?? 0;
  const popScale = nation.population / p.baselinePopulation;
  const perTier = p.capitalPerBuildingTier[dept] ?? 0;
  const tier = departmentBuildingTier(nation, dept);
  return base * popScale * (1 + perTier * tier);
}

function departmentBuildingTier(nation, dept) {
  const b = nation.buildings || {};
  switch (dept) {
    case 'farm': return b.granary || 0;
    case 'factory': return (b.tools?.hoe || 0 + b.tools?.pickaxe || 0) / 2;
    case 'build': return b.road || 0;
    case 'defense': return b.barracks || 0;
    default: return 0;
  }
}

/** O(g) — 장관 보정. 공석 0.65 / 재임 1.00 + perLevel×Lv (상한 max) / 인수인계 중 handoverOfficer */
export function officerFactor(nation, roleKey, data, tick = nation.lastSeenTick ?? 0) {
  const cfg = data.roles.officer;
  const role = nation.roles?.[roleKey];
  if (!role || !role.holder) return cfg.vacant;
  if (role.handoverUntilTick != null && tick < role.handoverUntilTick) return data.balance.career.handoverOfficer;
  return Math.min(cfg.max, cfg.baseTenure + cfg.perLevel * (role.level || 0));
}

/** B(g) — 건물·도구·스킬 곱연산 보너스 */
export function buildingFactor(nation, resource, data, extra = 0) {
  let bonus = extra;
  const b = nation.buildings || {};
  if (resource === 'grain') {
    const g = b.granary || 0;
    if (g > 0) bonus += data.buildings.granary.tiers[g - 1].output.grain;
    const hoe = b.tools?.hoe || 0;
    if (hoe > 0) bonus += data.buildings.tools.hoe.tiers[hoe - 1].bonus;
    if (hasSkill(nation, 'farm', data)) bonus += data.roles.defs.farm.skill.output.grain;
  }
  if (resource === 'ironOre') {
    const pick = b.tools?.pickaxe || 0;
    if (pick > 0) bonus += data.buildings.tools.pickaxe.tiers[pick - 1].bonus;
  }
  return 1 + bonus;
}

export function hasSkill(nation, roleKey, data) {
  const role = nation.roles?.[roleKey];
  if (!role || !role.holder) return false;
  return (role.level || 0) >= (data.roles.defs[roleKey].skillLevel ?? 99);
}

/** O × B ≤ clamp (기본 1.8). 초과 시 곱을 상한으로 눌러 반환한다. */
export function clampedOfficerBuilding(O, B, cap) {
  const product = O * B;
  return product > cap ? cap : product;
}

/** T(g) — 지역 태그 보정 */
export function tagFactor(nation, resource, data, kind = 'output') {
  let f = 1;
  for (const tag of nation.tags || []) {
    const def = data.tags[tag];
    if (!def) continue;
    const table = def.effects?.[kind];
    if (table && table[resource] != null) f += table[resource];
  }
  return Math.max(0, f);
}

export function producesResource(nation, resource, data) {
  const meta = data.resources.meta[resource];
  if (meta?.requiresTag) return (nation.tags || []).includes(meta.requiresTag);
  return true;
}

/**
 * 재고 목표 = 인구 × 소비계수 × 목표일수.
 * ★ GDD3 §8(레이트 기준 재보정): 인구가 0~5인 초반에는 목표가 0에 수렴해 전 재화가 가격 상한(4배)에
 *   상시로 붙어 버린다. 그래서 인구를 minStockTarget 아래로는 세지 않는다. 공식 자체는 그대로다.
 */
export function targetStock(nation, resource, data) {
  const meta = data.resources.meta[resource];
  const p = data.balance.price;
  const pop = Math.max(nation.population || 0, p.minStockTarget ?? 0);
  return pop * (meta.stockCoefficient ?? 0) * p.targetStockDays;
}

/**
 * 창고 용량 = 재고 목표 × 창고 배수.
 * ★ 배수는 저장고 티어(레거시 거울 nation.buildings.storage)에서 오고, 저장 궤짝·곡창 같은
 *   작은 보관 건물의 합산 보너스(nation.storageBonus — structures.storageBonus 가 매 틱 채운다)가 더해진다.
 */
export function storageCapacity(nation, resource, data) {
  const p = data.balance.price;
  const tier = nation.buildings?.storage || 0;
  const mult = p.storageMultiplierByTier[Math.min(tier, p.storageMultiplierByTier.length - 1)]
    + (nation.storageBonus || 0);
  return targetStock(nation, resource, data) * mult;
}

/** P_local = P_ref × clamp((S_target/S_now)^0.6, 0.30, 4.00) */
export function localPrice(nation, resource, data) {
  const meta = data.resources.meta[resource];
  const p = data.balance.price;
  const tgt = targetStock(nation, resource, data);
  const now = nation.resources?.[resource] ?? 0;
  if (tgt <= 0) return meta.referencePrice;
  const ratio = now <= 0 ? Infinity : tgt / now;
  const raw = Number.isFinite(ratio) ? Math.pow(ratio, p.elasticity) : Infinity;
  return meta.referencePrice * clamp(raw, p.clampMin, p.clampMax);
}

export function localPriceTable(nation, data) {
  const out = {};
  for (const r of data.resources.order) {
    out[r] = {
      price: round2(localPrice(nation, r, data)),
      stock: round2(nation.resources?.[r] ?? 0),
      target: round2(targetStock(nation, r, data)),
      capacity: round2(storageCapacity(nation, r, data)),
    };
  }
  return out;
}

/**
 * 창고 초과분 부패.
 * @param {number} floor ★ §19-E(QA-A) — 부패가 물러설 자리(곳간 상한). storage.spoilFloor 가 준다.
 *   무른 문턱(storageCapacity)이 단단한 상한보다 낮으면 그 사이가 「매일 깎이고 매일 다시 차는」
 *   되튐 구간이 된다 — 그 구간을 부패에서 뺀다. 0이면 옛 규칙 그대로다.
 */
export function applySpoilage(nation, data, floor = 0) {
  const rate = data.balance.price.spoilagePerDay;
  const spoiled = {};
  for (const r of data.resources.order) {
    const cap = Math.max(storageCapacity(nation, r, data), floor);
    const now = nation.resources[r] ?? 0;
    if (cap > 0 && now > cap) {
      const loss = (now - cap) * rate;
      nation.resources[r] = now - loss;
      if (loss > 0.001) spoiled[r] = round2(loss);
    }
  }
  return spoiled;
}

/** 관세 = 기본 − 영사관 티어×감소폭, 최저 minTariff. 최하위국 면제. */
export function effectiveTariff(nation, data, { lastPlace = false, artifactDelta = 0, exemptNationId = null, nationId = null } = {}) {
  const t = data.balance.trade;
  if (lastPlace && t.lastPlaceTariffExempt) return 0;
  if (exemptNationId && nationId && exemptNationId === nationId) return 0;
  const tier = nation.buildings?.consulate || 0;
  const raw = t.baseTariff - t.tariffReductionPerConsulateTier * tier + artifactDelta;
  return Math.max(t.minTariff, raw);
}

export function freightRate(nation, data, { artifactDelta = 0, eventDelta = 0 } = {}) {
  const t = data.balance.trade;
  const tier = nation.buildings?.road || 0;
  const base = t.freightByRoadTier[Math.min(tier, t.freightByRoadTier.length - 1)];
  return Math.max(0, base + artifactDelta + eventDelta);
}

export function hasDiplomat(nation) {
  return Boolean(nation.roles?.trade?.holder);
}

export function infoLossRate(nation, data) {
  const t = data.balance.trade;
  if (!hasDiplomat(nation)) return t.infoLoss.withoutDiplomat;
  if (hasSkill(nation, 'trade', data)) return data.roles.defs.trade.skill.infoLoss;
  return t.infoLoss.withDiplomat;
}

export function fxSpreadRate(nation, data) {
  const t = data.balance.trade;
  return hasDiplomat(nation) ? t.fxSpread.withDiplomat : t.fxSpread.withoutDiplomat;
}

/** 무역 실효배수 = (1+관세)(1+운임)(1+환스프레드)(1+정보손실) */
export function tradeMultiplier({ tariff, freight, fxSpread, infoLoss }) {
  return (1 + tariff) * (1 + freight) * (1 + fxSpread) * (1 + infoLoss);
}

/** 시나리오 파라미터(관세·도로티어·외교관 유무) → 실효배수. 밸런스 검증표 재현용. */
export function scenarioTradeMultiplier(scenario, data) {
  const t = data.balance.trade;
  return tradeMultiplier({
    tariff: scenario.tariff,
    freight: t.freightByRoadTier[scenario.roadTier],
    fxSpread: scenario.diplomat ? t.fxSpread.withDiplomat : t.fxSpread.withoutDiplomat,
    infoLoss: scenario.diplomat ? t.infoLoss.withDiplomat : t.infoLoss.withoutDiplomat,
  });
}

/** ★ §17-15 — 외교관 개성. 자리가 채워져 있으면 사고팔 때 양쪽으로 3% 더 유리하게 흥정한다. */
export function tradeMarginBonus(nation, data) {
  return nation?.roles?.trade?.holder ? (data.roles.defs.trade.perk?.tradeMarginBonus ?? 0) : 0;
}

export function importPrice(foreignPrice, nation, data, opts = {}) {
  return foreignPrice * tradeMultiplier({
    tariff: effectiveTariff(nation, data, opts),
    freight: freightRate(nation, data, opts),
    fxSpread: fxSpreadRate(nation, data),
    infoLoss: infoLossRate(nation, data),
  }) * (1 - tradeMarginBonus(nation, data));
}

/** @param {object|null} nation ★ §17-15 — 파는 쪽도 외교관의 흥정이 붙는다(옛 호출은 nation 없이 그대로) */
export function exportPrice(localP, data, nation = null) {
  return localP * (1 - data.balance.trade.exportFriction) * (1 + tradeMarginBonus(nation, data));
}

export const round4 = (v) => Math.round(v * 10000) / 10000;
export const round2 = (v) => Math.round(v * 100) / 100;
export const round3 = (v) => Math.round(v * 1000) / 1000;
