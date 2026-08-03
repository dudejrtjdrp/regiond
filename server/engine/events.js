// 랜덤 이벤트 · 중간 충격 · 버프 만료
import { consumeEventProtection, collectHooks } from './artifacts.js';

export function weightedPool(pool, hooks) {
  return pool.map((e) => {
    let w = e.weight ?? 1;
    for (const tag of e.tags || []) w *= hooks.eventWeightMultipliers?.[tag] ?? 1;
    return { value: e, weight: w };
  });
}

/** 국가별 랜덤 이벤트 판정. rng 소비 가변. */
export function rollRandomEvent(nation, data, rng) {
  const cfg = data.events.random;
  if (!rng.chance(cfg.perTickChance)) return null;
  const hooks = collectHooks(nation, data);
  const def = rng.weighted(weightedPool(cfg.pool, hooks));
  if (!def) return null;
  const prot = consumeEventProtection(nation, def.tags || []);
  if (prot.immune) {
    return { id: def.id, name: def.name, text: `${def.name}이(가) 닥쳤지만 유물의 힘으로 막아냈습니다.`, blocked: true };
  }
  return { id: def.id, name: def.name, text: def.text, effect: def.effect, mitigation: prot.mitigation, tags: def.tags };
}

export function applyEventEffect(nation, ev, tick, data) {
  if (!ev || ev.blocked || !ev.effect) return;
  const e = ev.effect;
  const mitigate = 1 - (ev.mitigation || 0);
  switch (e.kind) {
    case 'outputModifier':
    case 'globalOutputModifier':
      (nation.buffs ||= []).push({
        id: `${ev.id}_${tick}`, name: ev.name,
        outputBonusByResource: { [e.resource]: e.delta * mitigate },
        expiresTick: tick + e.durationTicks,
      });
      break;
    case 'freightModifier':
      (nation.buffs ||= []).push({
        id: `${ev.id}_${tick}`, name: ev.name,
        freightDelta: e.delta * mitigate,
        expiresTick: tick + e.durationTicks,
      });
      break;
    case 'resourceLoss':
      for (const r of Object.keys(nation.resources)) nation.resources[r] *= 1 - e.ratio * mitigate;
      break;
    case 'nextInvasionPower':
      (nation.artifactState ||= {}).nextInvasionPowerMultiplier = e.multiplier;
      break;
    default: break;
  }
}

/** 중간 충격 — 6~9일차 1회, 선두국에 가중 */
export function rollMidShock(world, data, rng) {
  const cfg = data.events.midShock;
  const [from, to] = cfg.windowTicks;
  if (world.tick < from || world.tick > to) return null;
  if (world.midShockFired) return null;
  // 창 안에서 균등 확률로 1회 발동 (남은 틱 수 기준)
  const remaining = to - world.tick + 1;
  if (!rng.chance(1 / remaining)) return null;
  const def = rng.pick(cfg.pool);
  return { ...def, leaderWeight: cfg.leaderWeight };
}

export function expireBuffs(nation, tick) {
  const before = (nation.buffs || []).length;
  nation.buffs = (nation.buffs || []).filter((b) => b.expiresTick == null || b.expiresTick > tick);
  return before - nation.buffs.length;
}

/** 활성 버프를 산출/운임 보정으로 합산 */
export function buffModifiers(nation) {
  const mod = { output: 0, outputByResource: {}, outputByDept: {}, gather: 0, freight: 0 };
  for (const b of nation.buffs || []) {
    if (b.outputBonus) mod.output += b.outputBonus;
    if (b.gatherBonus) mod.gather += b.gatherBonus;
    if (b.freightDelta) mod.freight += b.freightDelta;
    if (b.outputBonusByResource) {
      for (const [r, v] of Object.entries(b.outputBonusByResource)) mod.outputByResource[r] = (mod.outputByResource[r] || 0) + v;
    }
    // 격려 순행(AP) 등 '부처 단위' 보정 — GAMEPLAY2 §C-1
    if (b.outputBonusByDept) {
      for (const [d, v] of Object.entries(b.outputBonusByDept)) mod.outputByDept[d] = (mod.outputByDept[d] || 0) + v;
    }
  }
  return mod;
}
