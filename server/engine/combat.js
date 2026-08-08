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
// ★ §20-R4 — 유물 굴림은 세계 난수를 한 톨도 축내지 않는다(relations·trails 와 같은 규율)
import { statRng } from './traits.js';

// ────────────────────────────────────────────────────────────────
// ★ §20-R4(유물기획 §20-3~4) — 유물 전투 굴림 한 벌.
//
// 「왜」 여기 사나 — 치명타·회피를 굴리는 자리가 넷이다(ecology.bite · ecology.huntSwing ·
// battle.combatSwing/피격 · waves.strikeCamp). 넷이 제 손으로 굴리면 규칙이 넷으로 갈라지고,
// 갈라진 순간 「같은 판이 같은 결과를 낸다」가 깨진다. 전투 공용 계산이 사는 이 파일에 한 벌만 둔다.
//
// 두 가지 규율을 못으로 박아 둔다:
//   ① **확률이 0이면 난수를 한 톨도 뽑지 않는다.** 신규 유물을 아무도 안 가진 판에서는 이 함수를
//      부르기 전과 부른 뒤의 난수 소비가 완전히 같아야 한다(시드 42 체크포인트의 목숨줄이다).
//   ② **월드 난수를 쓰지 않는다.** 굴림은 statRng 로 짓는다 — 국가마다 따로 흐르는 수열이라
//      스윙 한 번이 웨이브 스폰이나 생태 난수의 차례를 밀어내지 않는다.
// ────────────────────────────────────────────────────────────────

/** 치명타가 나지 않았을 때 늘 같은 것을 돌려준다 — 뜨거운 길목에서 객체를 새로 빚지 않는다. */
const NO_CRIT = Object.freeze({ crit: false, multiplier: 1 });

/** 이 국가 전용 굴림 수열의 다음 씨앗. 국가마다 따로 흐른다(월드 난수 불변). */
function artifactRoll(world, nation) {
  const seq = (nation.artifactRollSeq = (nation.artifactRollSeq || 0) + 1);
  return statRng(`${world?.seed ?? 0}:artifactRoll:${nation.id}:${seq}`);
}

/**
 * 치명타 굴림 (번개의 창끝). 확률이 0이면 굴리지 않고 NO_CRIT 을 돌려준다.
 * TODO(R4b · 유물기획 §20-3): 「치명 처치 시 다음 스윙 즉시」는 쿨다운을 되감는 축이라
 *   이 배치에서 다루지 않는다. skills.canSwing/markSwing 과 함께 손봐야 하는 일이다.
 * @returns {{crit:boolean, multiplier:number}}
 */
export function artifactCritRoll(world, nation) {
  const fx = nation?.artifactCombat;
  const chance = fx?.crit ?? 0;
  if (!(chance > 0)) return NO_CRIT;
  if (!artifactRoll(world, nation).chance(chance)) return NO_CRIT;
  return { crit: true, multiplier: fx.critMultiplier ?? 1 };
}

/** 회피 굴림 (바람의 망토 계열). 확률이 0이면 굴리지 않는다 — 굴리면 난수 차례가 밀린다. */
export function artifactDodgeRoll(world, nation) {
  const chance = nation?.artifactCombat?.dodge ?? 0;
  if (!(chance > 0)) return false;
  return artifactRoll(world, nation).chance(chance);
}

/**
 * 견적용 치명타 **기대값**. 견적은 굴리는 자리가 아니다 — 굴리면 화면을 한 번 그릴 때마다
 * 난수가 축나고, 같은 판이 볼 때마다 다른 방어 요약을 낸다.
 */
export function artifactCritExpectation(nation) {
  const fx = nation?.artifactCombat;
  const chance = fx?.crit ?? 0;
  if (!(chance > 0)) return 1;
  return 1 + chance * ((fx.critMultiplier ?? 1) - 1);
}

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
  /* ★ §20-R4 — 공격력 배수(죽음의 낫)는 swingDamage 안에 이미 들어 있다. 여기서는 치명타만
     기대값으로 얹는다: 견적은 굴리는 자리가 아니므로 「몇 번에 한 번 세게 친다」를 평균으로 편다. */
  return total * artifactCritExpectation(nation);
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
  /* ★ §20-R4 — 용의 심장의 「전투원 피해 +25%」는 **나라 전체 전투원**에 붙는다(민병·터렛 포함).
     stepBattle 이 실제로 그렇게 때리므로 견적도 같은 자를 써야 화면이 거짓말을 하지 않는다. */
  const artifactDamage = nation.artifactCombat?.damage ?? 1;
  const totalDps = (turretDps + militiaDps + pDps) * mult.defender * artifactDamage;

  const spec = nextWaveSpec(world, nation, data);
  /* ★ §19-F2(F07-3) — 호위대가 섞이면 「한 마리 체력 × 총 마릿수」는 거짓이 된다. 무리마다 제 몸이
     따로 있으므로 무리별로 더한다(호위대가 없으면 무리가 하나뿐이라 옛 셈과 한 톨도 다르지 않다). */
  const gs = spec.groups ?? [{ unitHp: spec.unitHp, unitDps: spec.unitDps, units: spec.units }];
  const enemyHp = gs.reduce((a, g) => a + g.unitHp * g.units, 0);
  const enemyDps = gs.reduce((a, g) => a + g.unitDps * g.units, 0);
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

/**
 * 국방부 전용 — 약점 문장.
 *
 * ★ Sprint 3 — 뷰가 이미 빚어 둔 방어 요약을 넘겨받는다. 옛 구현은 제 손으로 한 번 더 지었고,
 *   그래서 국방대신이 보는 화면 한 장마다 민병 목록·터렛 목록·다음 웨이브 규격이 **두 번씩** 났다.
 *   넘겨주지 않으면 예전처럼 스스로 짓는다(다른 호출자와의 계약은 그대로다).
 *
 * ⚠ 성녀 판정만은 넘겨받은 요약을 **보지 않는다**. 뷰가 빚는 요약에는 유물 갈고리(hooks)가 걸려
 *   있어 `saint` 가 유물로도 참이 되지만(prophecyAlways), 이 문장은 예로부터 갈고리 없이 —
 *   즉 「성녀 자리에 사람이 앉았는가」만으로 — 판정해 왔다. 성능을 고치는 자리에서 판정을 바꾸지
 *   않는다: 넘겨주든 안 주든 나오는 문장이 한 글자도 다르지 않아야 한다.
 * @param {object|null} summary 같은 판에서 이미 빚어 둔 defenseSummary
 */
export function weakSpots(world, nation, data, summary = null) {
  const sum = summary ?? defenseSummary(world, nation, data);
  const spots = [];
  if (sum.fenceSegments === 0) spots.push('울타리가 한 조각도 없습니다.');
  if (sum.turretCount === 0) spots.push('쏠 것이 없습니다 — 화살탑을 세우십시오.');
  if (sum.militiaCount === 0) spots.push('성 앞에 설 사람이 없습니다 — 주민을 수비로 배치하십시오.');
  if (!hasSaintSight(nation, data)) spots.push('성녀 부재 — 웨이브 시점이 흐리고 축복이 없습니다.');
  if (sum.estimate.secondsToClear == null) spots.push('우리 화력이 0입니다.');
  return spots;
}

export { clamp, hasSaintSight };
