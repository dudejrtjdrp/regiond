// 건설 비용 계산 — 순수 함수.
// commands.js · structures.js · advisor.js 가 함께 쓰므로 별도 모듈로 뺐다(순환 임포트 방지).
import { round2 } from './economy.js';

/**
 * 건물 티어 비용 = 표 비용 × (건축가 재임 −25%) × (요새지 태그) × (유물 보정) × (1 − 할인)
 * @returns {null | {cost:{res:amount}, gold:number, buildPoints:number, tierDef:object}}
 */
export function buildingCost(nation, building, tier, data, hooks = {}) {
  const def = data.buildings[building];
  if (!def || !Array.isArray(def.tiers)) return null;
  const t = def.tiers[tier - 1];
  if (!t) return null;
  const architect = Boolean(nation.roles?.build?.holder);
  let mult = 1;
  if (architect) mult *= data.roles.defs.build.tenureBonus.buildCostMultiplier;
  if ((nation.tags || []).includes('fortress')) mult *= 1 + data.tags.fortress.effects.buildCost;
  mult *= hooks.buildCostMultiplier ?? 1;
  // ★ §20-R1 — 국경의 인장: 무역로 거점(교역소·영사관)만 골라 깎는다. 어느 건물인지는 descriptor 가 안다.
  mult *= hooks.buildingCostByKey?.[building] ?? 1;
  // ★ §20-R1 — 여문 씨앗 주머니: 건물 하나가 아니라 「생산 계열 아무 것이나」 1회. 계열은 buildings.json category.
  const discount = hooks.costDiscounts?.[building] ?? hooks.costDiscountCategories?.[def.category];
  if (discount) mult *= 1 - discount;
  const cost = {};
  for (const [r, v] of Object.entries(t.cost || {})) cost[r] = round2(v * mult);
  return {
    cost,
    gold: Math.round((t.gold ?? 0) * mult),
    buildPoints: round2((t.buildPoints ?? 0) * mult),
    tierDef: t,
  };
}

/** 지금 이 자재로 지을 수 있는가 */
export function canAfford(nation, cost, gold = 0) {
  const okRes = Object.entries(cost || {}).every(([r, v]) => (nation.resources?.[r] || 0) >= v);
  return okRes && (nation.gold || 0) >= gold;
}
