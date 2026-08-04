// 각료 숙련 — XP / 레벨 / Lv5 스킬 / 전직 인수인계
//
// ★ GDD3 §15-C — 「자리를 맡은 사람」은 이제 **동료 봇**이다(companions.js 가 roles[key].botId 로 묶는다).
//   여기 있는 이름표(NPC_NAMES)는 동료보다 자리가 많을 때(솔로는 자리 여섯에 동료 넷)
//   남는 자리를 메우는 예비다 — 나라는 사람이 모자라도 멎지 않는다.
//   숙련(XP·레벨·Lv5 스킬)과 역할 보정 O(g) 는 옛 규칙 그대로다: 누가 맡았는가만 바뀌었다.
import { hasSkill } from './economy.js';

export const NPC_NAMES = {
  farm: ['하르만', '들녘의 미라', '보리단'],
  factory: ['철장 두린', '가마의 로안', '기름손 카이'],
  build: ['석공 베르', '도면의 이나', '망치 요한'],
  defense: ['성벽의 군터', '창끝 리안', '방패 소냐'],
  trade: ['상관 유하', '주판 마르코', '길잡이 세라'],
  saint: ['성녀 리에', '무녀 아린', '신탁의 유나'],
};

export function levelFromXp(xp, data) {
  const curve = data.roles.xp.levelCurve;
  let lv = 0;
  for (let i = 0; i < curve.length; i += 1) if (xp >= curve[i]) lv = i;
  return lv;
}

/** 담당 틱마다 XP 적립(실적 가중). 레벨업 시 이벤트를 반환. */
export function accrueXp(nation, data, performance = {}, hooks = {}) {
  const cfg = data.roles.xp;
  const events = [];
  for (const roleKey of data.roles.order) {
    const role = nation.roles?.[roleKey];
    if (!role || !role.holder) continue;
    const perf = performance[roleKey] ?? 0; // 0~1
    const gain = (cfg.perTickOnDuty + cfg.performanceWeight * perf) * (hooks.xpMultiplier ?? 1);
    role.xp = (role.xp || 0) + gain;
    const newLevel = levelFromXp(role.xp, data);
    if (newLevel > (role.level || 0)) {
      role.level = newLevel;
      events.push({
        kind: 'npc_levelup', role: roleKey,
        data: { name: role.name || defaultName(roleKey), role: data.roles.defs[roleKey].name, level: newLevel },
      });
    }
  }
  return events;
}

export function defaultName(roleKey, idx = 0) {
  const list = NPC_NAMES[roleKey] || ['이름 없는 신하'];
  return list[idx % list.length];
}

/** 전직 — 숙련 50% 상실 + 인수인계 기간 */
export function reassign(nation, roleKey, holder, tick, data) {
  const role = (nation.roles[roleKey] ||= { holder: null, level: 0, xp: 0 });
  const c = data.balance.career;
  role.xp = (role.xp || 0) * (1 - c.reassignSkillLossRatio);
  role.level = levelFromXp(role.xp, data);
  role.holder = holder;
  role.handoverUntilTick = tick + c.handoverTicks;
  if (!role.name) role.name = defaultName(roleKey);
  return role;
}

export function roleSummary(nation, data) {
  const out = {};
  for (const roleKey of data.roles.order) {
    const r = nation.roles?.[roleKey] || { holder: null, level: 0, xp: 0 };
    out[roleKey] = {
      name: data.roles.defs[roleKey].name,
      holder: r.holder,
      npcName: r.name || null,
      level: r.level || 0,
      xp: Math.round((r.xp || 0) * 10) / 10,
      skillUnlocked: hasSkill(nation, roleKey, data),
      skill: data.roles.defs[roleKey].skill?.name ?? null,
      tier: data.roles.defs[roleKey].tier,
      // ★ WORLD.md §12 — 멀티에서 '이 자리를 맡은 접속자'. 싱글이나 위임이면 null.
      owner: r.holder === 'player' ? (r.owner ?? null) : null,
      /* ★ GDD3 §15-C — 이 자리를 맡은 **동료**의 아바타. 화면은 이 값으로 각료 카드와
         들에 서 있는 사람을 같은 인물로 잇는다(따로 세운 신하는 없다). */
      botId: r.holder === 'npc' ? (r.botId ?? null) : null,
    };
  }
  return out;
}
