// 방어 요약 — docs/GDD3.md §6.
// ★ 옛 로지스틱 일괄 판정(P = 1/(1+e^(-k(R-1))), 서지/영구 이원 방어)은 폐기됐다.
//   전투는 battle.js 의 결정론 서브틱 실시뮬이 한다. 이 모듈은 '지금 우리 방어가 어느 정도인가'를
//   화면과 조언·봇에게 설명해 주는 요약만 만든다(판정에는 쓰이지 않는다).
import { clamp, round2, round3 } from './economy.js';
import { turretList, permanentDefense as structureDefense } from './structures.js';
import { militiaList } from './residents.js';
import { aliveFences } from './fences.js';
import { nextWaveSpec, battleCfg, warnCfg, hasSaintSight } from './waves.js';
import { battleMultipliers } from './battle.js';
import { combatSkillCfg, swingCooldownSeconds, swingDamage } from './skills.js';

/** 무기 티어의 상비 전투력(민병 무장) — 유지 항목 */
export function weaponPower(nation, data) {
  const tier = nation.buildings?.tools?.weapon || 0;
  if (tier <= 0) return 0;
  return data.buildings.tools.weapon.tiers[tier - 1].power;
}

/** 상비 방어 — 병영 등 permanentDefense 를 가진 건물 + 무기 티어 */
export function permanentDefense(nation, data) {
  return structureDefense(nation, data) + weaponPower(nation, data);
}

/** 서지 적립 창(D-3) — 웨이브 준비 창으로 계승됐다 */
export function inSurgeWindow(daysUntil, data) {
  return daysUntil != null && daysUntil >= 0 && daysUntil <= data.balance.combat.surgeWindowDays;
}

/** 플레이어들의 예상 DPS — 접속자 아바타가 검을 들었을 때 */
export function playerDps(nation, data) {
  let total = 0;
  for (const p of Object.values(nation.players || {})) {
    const cd = swingCooldownSeconds(nation, p, 'combat', data);
    total += swingDamage(nation, p, data) / Math.max(0.1, cd);
  }
  return total;
}

/**
 * 방어 요약. 다음 웨이브를 상대로 '우리 화력 대 적 체력' 을 견적낸다.
 * 실시뮬의 결과를 예단하지 않는다 — 배치·울타리 배치에 따라 실제 결과는 달라진다.
 */
export function defenseSummary(world, nation, data, hooks = {}) {
  const turrets = turretList(nation, data);
  const militia = militiaList(nation, data);
  const fences = aliveFences(nation);
  const mult = battleMultipliers(nation, nextWaveSpec(world, nation, data), data, hooks);

  const turretDps = turrets.reduce((a, t) => a + t.dps, 0);
  const militiaDps = militia.reduce((a, m) => a + m.dps, 0);
  const pDps = playerDps(nation, data);
  const totalDps = (turretDps + militiaDps + pDps) * mult.defender;

  const spec = nextWaveSpec(world, nation, data);
  const enemyHp = spec.unitHp * spec.units;
  const enemyDps = spec.unitDps * spec.units;
  const fenceHp = fences.reduce((a, f) => a + (f.hp || 0), 0);
  const timeToClear = totalDps > 0 ? enemyHp / totalDps : Infinity;
  const timeToBreach = enemyDps > 0 ? fenceHp / enemyDps : 0;

  return {
    turrets: turrets.map((t) => ({ id: t.id, key: t.key, name: t.name, dps: round2(t.dps), range: t.range, x: t.x, y: t.y, counters: t.counters })),
    turretCount: turrets.length,
    turretDps: round2(turretDps),
    militiaCount: militia.length,
    militiaDps: round2(militiaDps),
    playerDps: round2(pDps),
    totalDps: round2(totalDps),
    permanent: round2(permanentDefense(nation, data)),
    fenceSegments: fences.length,
    fenceHp: round2(fenceHp),
    multipliers: { defender: round3(mult.defender), enemy: round3(mult.enemy) },
    saint: hasSaintSight(nation, data, hooks),
    saintBonus: warnCfg(data).saint.damageBonus,
    // ★ 견적: 적을 다 베는 데 걸리는 시간 vs 울타리가 버티는 시간. 둘 다 초 단위다.
    estimate: {
      enemyHp: round2(enemyHp),
      enemyDps: round2(enemyDps),
      secondsToClear: Number.isFinite(timeToClear) ? round2(timeToClear) : null,
      secondsFenceHolds: round2(timeToBreach),
      maxSeconds: battleCfg(data).maxSeconds,
      comfortable: Number.isFinite(timeToClear) && timeToClear < battleCfg(data).maxSeconds * 0.6,
    },
  };
}

/** 국방부 전용 — 약점 문장 */
export function weakSpots(world, nation, data) {
  const sum = defenseSummary(world, nation, data);
  const spots = [];
  if (sum.fenceSegments === 0) spots.push('울타리가 한 조각도 없습니다.');
  if (sum.turretCount === 0) spots.push('쏠 것이 없습니다 — 화살탑을 세우십시오.');
  if (sum.militiaCount === 0) spots.push('성 앞에 설 사람이 없습니다 — 주민을 수비로 배치하십시오.');
  if (!sum.saint) spots.push('성녀 부재 — 웨이브 시점이 흐리고 축복이 없습니다.');
  if (sum.estimate.secondsToClear == null) spots.push('우리 화력이 0입니다.');
  return spots;
}

export { clamp, hasSaintSight };
