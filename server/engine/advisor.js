// 각료 조언 — 「어렵다」의 진짜 해법(문명 고문).
// 순수 함수: (world, nation, data) -> advice[]. 상태를 바꾸지 않는다.
// 조언의 action 은 전부 '기존 프로토콜 이벤트를 그대로 쏘는 매크로'다 — adviceAct 는 새 검증을 만들지 않는다.
// ★ GDD3: 성벽·개척령 규칙은 폐기됐고 주거·울타리·터렛·민병 규칙으로 대체됐다.
import { buildingCost, canAfford } from './build_cost.js';
import { collectHooks } from './artifacts.js';
import { freeBeds, militiaList } from './residents.js';
import { turretList, structuresOf } from './structures.js';
import { settlementTier } from './tiers.js';
import { buildingUnlocked, departmentsActive, featureUnlocked } from './progression.js';
import { daysUntilWave } from './waves.js';

const grainDaysOf = (nation, data) =>
  (nation.resources?.grain || 0) / Math.max(1, nation.population * data.balance.population.grainPerCapita);

/** 성녀 유무와 무관하게 조언이 쓸 수 있는 '보수적' 남은 일수 (정보 비대칭 유지) */
function waveDays(world, nation) {
  const d = daysUntilWave(world, nation);
  return d == null ? null : d;
}

/** 지을 수 있고 자재가 있는 건물인가 — '눌러도 안 되는 단추' 금지 */
function buildable(ctx, key) {
  const { world, nation, data } = ctx;
  if (!buildingUnlocked(nation, key, data)) return null;
  if ((nation.construction || []).some((c) => c.building === key && !c.structureId)) return null;
  const priced = buildingCost(nation, key, 1, data, collectHooks(nation, data));
  if (!priced || !canAfford(nation, priced.cost, priced.gold)) return null;
  return priced;
}

const EVALUATORS = {
  housing_full(ctx, th) {
    if (settlementTier(ctx.nation) < 1) return null;
    if (freeBeds(ctx.nation, ctx.data) >= (th.freeBedsBelow ?? 1)) return null;
    const key = buildable(ctx, 'hut') ? 'hut' : (buildable(ctx, 'tent') ? 'tent' : null);
    if (!key) return null;
    const priced = buildable(ctx, key);
    return { payload: { building: key }, extra: { cost: priced.cost, building: key } };
  },
  grain_low(ctx, th) {
    if (grainDaysOf(ctx.nation, ctx.data) >= th.grainDaysBelow) return null;
    if (!departmentsActive(ctx.nation, ctx.data)) {
      const priced = buildable(ctx, 'hunter_hut');
      if (!priced) return null;
      return { payload: { building: 'hunter_hut' }, extra: { cost: priced.cost }, label: '사냥꾼 오두막 짓기', event: 'placeBuilding' };
    }
    return { payload: { recommended: true } };
  },
  defense_thin(ctx, th) {
    const days = waveDays(ctx.world, ctx.nation);
    if (days == null || days > th.waveWithinDays) return null;
    if (turretList(ctx.nation, ctx.data).length >= th.turretsBelow) return null;
    const key = ['arrow_tower', 'ballista', 'cannon'].find((k) => buildable(ctx, k));
    if (!key) return null;
    const priced = buildable(ctx, key);
    return { payload: { building: key }, extra: { cost: priced.cost, building: key } };
  },
  mobilize(ctx, th) {
    const days = waveDays(ctx.world, ctx.nation);
    if (days == null || days > th.waveWithinDays) return null;
    if (militiaList(ctx.nation, ctx.data).length >= th.militiaBelow) return null;
    if (!(ctx.nation.villagers || []).length) return null;
    const alloc = { ...ctx.data.balance.labor.defaultAlloc, defense: 0.5, farm: 0.3, build: 0.1, factory: 0.07, trade: 0.03 };
    return { payload: { alloc } };
  },
  weapon_none(ctx, th) {
    if (!departmentsActive(ctx.nation, ctx.data)) return null;
    const days = waveDays(ctx.world, ctx.nation);
    if (days == null || days > th.waveWithinDays) return null;
    const tier = ctx.nation.buildings?.tools?.weapon || 0;
    if (tier >= th.weaponTierBelow) return null;
    const def = ctx.data.buildings.tools.weapon.tiers[tier];
    if (!def) return null;
    if (ctx.nation.gold < def.gold + (th.goldMargin || 0)) return null;
    if ((ctx.nation.resources?.oil || 0) < (def.oil || 0)) return null;
    return { payload: { tool: 'weapon', tier: tier + 1 } };
  },
  oil_none(ctx, th) {
    if (!departmentsActive(ctx.nation, ctx.data)) return null;
    if (!structuresOf(ctx.nation, 'trading_post').length) return null;
    const days = waveDays(ctx.world, ctx.nation);
    if (days == null || days > th.waveWithinDays) return null;
    if ((ctx.nation.resources?.oil || 0) >= th.oilBelow) return null;
    if ((ctx.nation.buildings?.tools?.weapon || 0) >= th.weaponTierBelow) return null;
    return oilTradePayload(ctx);
  },
};

function oilTradePayload(ctx) {
  const rule = ctx.data.balance.advisor.rules.find((r) => r.id === 'oil_none');
  const params = rule.params || {};
  const seller = ctx.world.nations?.[params.nationId];
  if (!seller || (seller.resources?.[params.resource] || 0) < params.amount) return null;
  const ref = ctx.data.resources.meta[params.resource]?.referencePrice ?? 0;
  if (ctx.nation.gold < ref * params.amount) return null;
  return { payload: { ...params, side: 'buy' } };
}

/**
 * 조언 카드 생성. 우선순위 내림차순으로 maxPerDay 건까지.
 * @returns {Array<{id, role, roleName, text, label, priority, action:{event, payload}}>}
 */
export function buildAdvices(world, nation, data) {
  if (!nation?.isPlayer) return [];
  // ★ GDD3 §11-1 — 「조언 자동 생성」의 문. 각료가 생기기 전(6장 감정의 날 이전)에는
  //   조언이라는 개념 자체가 없다. 뷰에 빈 배열조차 아니라 아예 안 나간다(view.js).
  if (!featureUnlocked(nation, 'advisor', data)) return [];
  const cfg = data.balance.advisor;
  const ctx = { world, nation, data };
  const out = [];
  for (const rule of cfg.rules) {
    const evaluate = EVALUATORS[rule.id];
    if (!evaluate) continue;
    let hit = null;
    try { hit = evaluate(ctx, rule.thresholds || {}); } catch { hit = null; }
    if (!hit) continue;
    out.push({
      id: rule.id,
      role: rule.role,
      roleName: data.roles.defs[rule.role]?.name ?? rule.role,
      text: rule.text,
      label: hit.label ?? rule.label,
      priority: rule.priority,
      action: { event: hit.event ?? rule.event, payload: { ...(rule.params || {}), ...(hit.payload || {}) } },
      ...(hit.extra || {}),
    });
  }
  out.sort((a, b) => b.priority - a.priority);
  return out.slice(0, cfg.maxPerDay);
}

/** adviceAct {adviceId} → 실행할 명령. 없는 조언이면 null. */
export function adviceCommand(world, nation, adviceId, data) {
  const advice = buildAdvices(world, nation, data).find((a) => a.id === adviceId);
  if (!advice) return null;
  return { cmd: { type: advice.action.event, ...advice.action.payload }, advice };
}

/**
 * 각료 자동 보좌 — 섭정(오프라인)으로 방치하면 최우선 조언 1건을 대신 실행한다.
 * **접속 중에는 절대 자동 실행하지 않는다** — 왕의 결정을 뺏지 않는다.
 */
export function autoAssist(world, nation, data) {
  const cfg = data.balance.advisor;
  if (!nation?.isPlayer) return null;
  if (nation.autoAssist === false) return null;
  if (nation.online) { nation.autoAssistIdleTicks = 0; return null; }
  const advices = buildAdvices(world, nation, data);
  if (!advices.length) { nation.autoAssistIdleTicks = 0; return null; }
  nation.autoAssistIdleTicks = (nation.autoAssistIdleTicks || 0) + 1;
  if (nation.autoAssistIdleTicks < cfg.autoAssistOfflineTicks) return null;
  nation.autoAssistIdleTicks = 0;
  const advice = advices[0];
  return { advice, cmd: { type: advice.action.event, ...advice.action.payload } };
}
