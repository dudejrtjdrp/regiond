// AI 3국 — 단순 정책 봇(자급 우선·잉여 수출·부족 수입) + 무역 오퍼 생성
import { localPrice, targetStock, round2, clamp } from './economy.js';
import { reunionOfferMult } from './ending.js';   // ★ §세계관 W3 — 재회 보상(제안 빈도)

/** 자급 우선: 부족 재화 쪽으로 노동을 소폭 이동시킨다. */
export function aiAdjustPolicy(nation, data, rng) {
  if (nation.isPlayer) return;
  const alloc = nation.laborAlloc;
  const grainRatio = (nation.resources.grain || 0) / Math.max(1, targetStock(nation, 'grain', data));
  const step = 0.04;
  // 공장 최소 지분 — 산유국이 여기를 비우면 세계에서 원유가 사라진다(플레이어 무기 공급망 붕괴)
  const factoryFloor = nation.aiPersona === 'petro' ? 0.25 : 0.15;
  if (grainRatio < 0.5 && alloc.farm < 0.6) {
    const take = Math.min(step, Math.max(0, alloc.factory - factoryFloor));
    alloc.farm += take; alloc.factory -= take;
  } else if (grainRatio > 1.4 && alloc.factory < 0.4) {
    const take = Math.min(step, alloc.farm - 0.2);
    if (take > 0) { alloc.factory += take; alloc.farm -= take; }
  }
  // 산유국은 정유 비중을 높인다
  if (nation.aiPersona === 'petro') {
    // 산유국은 원유를 상당량 남겨 수출한다 (플레이어 무기 제작의 유일한 공급원)
    nation.factoryQueue = { steel: 0.6, fuel: 0.15, weapon: 0.25 };
  } else if (nation.aiPersona === 'mercantile') {
    nation.factoryQueue = { steel: 0.7, fuel: 0.2, weapon: 0.1 };
  }
  // 가끔 가격 조작 / 덤핑 성향 플래그를 세운다
  const p = nation.aiPolicy || {};
  nation.priceBias = 0;
  if (p.priceManipulationChance && rng.chance(p.priceManipulationChance)) {
    nation.priceBias = p.priceManipulationRange;
  } else if (p.dumpingChance && rng.chance(p.dumpingChance)) {
    nation.priceBias = -p.dumpingDiscount;
  }
}

export function foreignPriceTable(nation, data) {
  const out = {};
  for (const r of data.resources.order) {
    out[r] = round2(localPrice(nation, r, data) * (1 + (nation.priceBias || 0)));
  }
  return out;
}

/** 매 틱 플레이어에게 무역 오퍼 생성 */
export function generateOffers(world, data, rng) {
  const cfg = data.aiNations.offers;
  const offers = [];
  const player = world.nations[world.playerNationId];
  for (const nation of Object.values(world.nations)) {
    if (nation.isPlayer) continue;
    // ★ §세계관 W3 재회 — 엔딩 뒤 에르니아의 제안이 잦아진다. rng 소비 횟수는 그대로다(결정론).
    const chance = Math.min(1, cfg.perTickChance * reunionOfferMult(world, nation.id, data));
    if (!rng.chance(chance)) continue;
    const policy = nation.aiPolicy || {};
    const wantsToSell = rng.chance(0.55);
    const pool = wantsToSell ? (policy.preferredExports || ['wood']) : (policy.criticalImports || ['grain']);
    const resource = rng.pick(pool);
    if (!resource) continue;
    const amount = rng.int(cfg.amountRange[0], cfg.amountRange[1]);
    const base = localPrice(nation, resource, data) * (1 + (nation.priceBias || 0));
    const price = round2(base * (1 + rng.float(-cfg.priceJitter, cfg.priceJitter)));
    offers.push({
      offerId: `of_${world.tick}_${nation.id}_${offers.length}`,
      nationId: nation.id,
      nationName: nation.name,
      envoy: envoyOf(nation.id, data),
      // side 는 플레이어 관점: AI가 팔면 플레이어는 buy
      side: wantsToSell ? 'buy' : 'sell',
      resource,
      amount,
      price,
      expiresTick: world.tick + cfg.expiryTicks,
    });
  }
  // 최하위국 배려: 플레이어가 최하위면 오퍼 가격을 소폭 낮춘다
  if (isLastPlace(world, player)) for (const o of offers) if (o.side === 'buy') o.price = round2(o.price * 0.95);
  return offers;
}

/* ★ §세계관 W1(§5) — 제안을 들고 오는 것은 나라가 아니라 사람이다.
   사절 이름은 데이터(ai_nations.json envoy)에 있고, 오퍼에 실려 템플릿의 {{envoy}} 로 흐른다. */
function envoyOf(nationId, data) {
  const def = data.aiNations?.nations?.find((n) => n.id === nationId);
  return def?.envoy || '';
}

export function isLastPlace(world, nation) {
  const scores = Object.values(world.nations).map((n) => ({ id: n.id, v: nationWealth(n) }));
  scores.sort((a, b) => a.v - b.v);
  return scores[0]?.id === nation.id;
}

export function nationWealth(nation, data) {
  let v = nation.gold;
  if (data) for (const r of data.resources.order) v += (nation.resources[r] || 0) * (data.resources.meta[r].referencePrice ?? 1);
  else for (const r of Object.keys(nation.resources)) v += nation.resources[r] || 0;
  return v;
}

/** AI 국가의 부족 재화 자동 조달 — 세계 시장에서 골드로 사온다 (기획 §10-6 검증 시나리오). */
export function aiProcure(nation, data) {
  if (nation.isPlayer) return 0;
  const cfg = data.balance.ai;
  const policy = nation.aiPolicy || {};
  let spent = 0;
  for (const r of policy.criticalImports || []) {
    const meta = data.resources.meta[r];
    const daily = nation.population * (meta.stockCoefficient ?? 0);
    const want = daily * cfg.procureThresholdDays - (nation.resources[r] || 0);
    if (want <= 0) continue;
    const unit = meta.referencePrice * cfg.procureTradeMultiplier;
    const affordable = Math.min(want, cfg.procureMaxPerTick, nation.gold / unit);
    if (affordable <= 0) continue;
    nation.resources[r] += affordable;
    nation.gold -= affordable * unit;
    spent += affordable * unit;
  }
  return spent;
}

/** AI 자체 무역 정산 — AI끼리는 교역하지 않는다(SPEC §10). 잉여만 시장에 팔아 골드로 전환. */
export function aiSettle(nation, data) {
  if (nation.isPlayer) return 0;
  let gold = 0;
  for (const r of data.resources.order) {
    const tgt = targetStock(nation, r, data);
    const surplus = (nation.resources[r] || 0) - tgt;
    if (surplus > 0) {
      const sell = surplus * 0.25;
      nation.resources[r] -= sell;
      gold += sell * localPrice(nation, r, data) * (1 - data.balance.trade.exportFriction);
    }
  }
  nation.gold += gold;
  return gold;
}

/** AI 국가의 침공 자동 판정 결과(리포트용) — 실제 전투 판정은 combat.js가 담당 */
export function aiInvasionOutcome(nation, spec, data, rng) {
  const power = spec.power * 0.9; // AI는 난이도 보정
  const total = (nation.buildings.wall ? data.buildings.wall.tiers[nation.buildings.wall - 1].permanentDefense : 0)
    + nation.population * 0.9;
  const ratio = total / power;
  const p = clamp(1 / (1 + Math.exp(-data.balance.combat.logisticK * (ratio - 1))), 0.05, 0.98);
  return { won: rng.chance(p), ratio: round2(ratio), winChance: round2(p) };
}
