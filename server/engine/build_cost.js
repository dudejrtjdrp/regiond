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
  const discount = hooks.costDiscounts?.[building];
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
