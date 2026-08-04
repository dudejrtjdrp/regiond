// 개인 스킬 · 스윙 — docs/GDD3.md §3.
// 액션은 '스윙' 단위다. 서버가 정본으로 쥐는 것: 스킬 레벨 · 마지막 스윙 시각 · 노드별 스윙 카운트 · 거리.
// ★ 클라 신뢰 금지: 쿨타임과 사거리는 여기서만 판정한다. 옛 '하루 체감 곡선(피로)'은 폐지됐다.
import { tierSpeedBonus, settlementTier } from './tiers.js';
import { round2 } from './economy.js';

export const skillsCfg = (data) => data.skills;
export const swingCfg = (data) => data.skills.swing;
export const combatSkillCfg = (data) => data.skills.combat;

export const SKILL_KEYS = (data) => data.skills.order;

// ────────────────────────────────────────────────────────────────
// ★ GDD3 §14-5 — 플레이어 레벨 · 스탯
//
// 레벨은 **새 숫자가 아니다**. 이미 있는 다섯 스킬 XP 를 한 번 더 세어 곡선에 얹은 것이다
// (data/skills.json player.xpCurve). 그래서 「벌목 7 · 전투 3」인 사람과 레벨이 어긋날 일이 없고,
// 스킬을 고루 올린 사람이 손해 보지도 않는다.
// 레벨업마다 스탯 포인트가 하나 붙고, 캐릭터 창(C)에서 넷 중 하나에 준다. 리스펙은 없다.
// 서버가 정본이다 — 화면은 표시만 하고 allocStat 명령으로 청할 뿐이다.
// ────────────────────────────────────────────────────────────────
export const playerCfg = (data) => data.skills.player ?? {};
export const statDefs = (data) => playerCfg(data).stats ?? {};
export const statOrder = (data) => playerCfg(data).order ?? Object.keys(statDefs(data));

/** 이 사람이 쌓은 XP 전부 */
export function playerXpTotal(player) {
  let n = 0;
  for (const s of Object.values(player?.skills || {})) n += Number(s?.xp) || 0;
  return Math.round(n * 100) / 100;
}

export function playerLevel(player, data) {
  const cfg = playerCfg(data);
  const curve = cfg.xpCurve || [0];
  const xp = playerXpTotal(player);
  let lv = 1;
  for (let i = 1; i < curve.length; i += 1) if (xp >= curve[i]) lv = i + 1;
  return Math.min(cfg.maxLevel ?? curve.length, lv);
}

/** 다음 레벨까지 (HUD 의 XP 바가 이 값을 그린다) */
export function playerXpToNext(player, data) {
  const curve = playerCfg(data).xpCurve || [0];
  const lv = playerLevel(player, data);
  const from = curve[lv - 1] ?? 0;
  const next = curve[lv];
  const xp = playerXpTotal(player);
  if (next == null) return { xp, from, need: null, span: null, ratio: 1 };
  return {
    xp, from, need: next, span: next - from,
    ratio: Math.max(0, Math.min(1, (xp - from) / Math.max(1e-9, next - from))),
    remaining: Math.round((next - xp) * 10) / 10,
  };
}

/** 이 사람이 스탯에 부은 점수 표 */
export function ensureStatAlloc(player, data) {
  const st = (player.stats ||= {});
  const alloc = (st.alloc ||= {});
  for (const k of statOrder(data)) alloc[k] ??= 0;
  return alloc;
}

export function statSpent(player, data) {
  const alloc = ensureStatAlloc(player, data);
  let n = 0;
  for (const k of statOrder(data)) n += Math.max(0, alloc[k] || 0);
  return n;
}

/** 아직 안 쓴 스탯 포인트 = (레벨 − 1) × statPerLevel − 쓴 것 */
export function statPoints(player, data) {
  const per = playerCfg(data).statPerLevel ?? 1;
  return Math.max(0, (playerLevel(player, data) - 1) * per - statSpent(player, data));
}

/** 스탯 하나에 한 점(또는 여러 점). 리스펙은 없다 — 되돌리는 문이 아예 없다. */
export function allocStat(player, key, data, count = 1) {
  const defs = statDefs(data);
  if (!defs[key]) return { ok: false, error: { code: 'BAD_STAT', message: '그런 능력치가 없습니다.' } };
  const have = statPoints(player, data);
  const want = Math.max(1, Math.floor(Number(count) || 1));
  const give = Math.min(have, want);
  if (give <= 0) return { ok: false, error: { code: 'NO_POINTS', message: '나눠 줄 점수가 없습니다.' } };
  const alloc = ensureStatAlloc(player, data);
  alloc[key] = (alloc[key] || 0) + give;
  player.maxHp = playerMaxHp(player, data);
  player.hp = Math.min(player.maxHp, Math.max(0, player.hp ?? player.maxHp));
  return { ok: true, stat: key, given: give, alloc: { ...alloc }, points: statPoints(player, data) };
}

/** 스탯이 실제로 미는 값들 — 훅이 전부 이 표 하나만 본다 */
export function statEffects(player, data) {
  const defs = statDefs(data);
  const alloc = player ? ensureStatAlloc(player, data) : {};
  let maxHp = 0;
  let damage = 0;
  let harvest = 0;
  let moveSpeed = 0;
  let cooldown = 0;
  let luck = 0;
  for (const [k, def] of Object.entries(defs)) {
    const n = Math.max(0, alloc[k] || 0);
    if (!n) continue;
    maxHp += (def.maxHp || 0) * n;
    damage += (def.damage || 0) * n;
    harvest += (def.harvest || 0) * n;
    moveSpeed += (def.moveSpeed || 0) * n;
    cooldown += (def.cooldown || 0) * n;
    luck += (def.luck || 0) * n;
  }
  const cap = playerCfg(data).cooldownCap ?? 0.5;
  return {
    maxHp,
    damage: 1 + damage,
    harvest: 1 + harvest,
    moveSpeed: 1 + moveSpeed,
    cooldown: Math.max(1 - cap, 1 - cooldown),
    luck,
  };
}

/** 이 사람의 최대 HP — 기본값 + 체력 점수 */
export function playerMaxHp(player, data) {
  return round2(combatSkillCfg(data).playerHp + statEffects(player, data).maxHp);
}
export const maxHpOf = playerMaxHp;

/** 이 아바타의 플레이어 레코드를 보장한다(없으면 만든다) */
export function ensurePlayer(nation, avatarId, data, name = null) {
  const id = avatarId ?? 'lord';
  const players = (nation.players ||= {});
  if (!players[id]) {
    players[id] = {
      id,
      name: name ?? id,
      skills: Object.fromEntries(SKILL_KEYS(data).map((k) => [k, { xp: 0, level: 1 }])),
      hp: combatSkillCfg(data).playerHp,
      maxHp: combatSkillCfg(data).playerHp,
      downUntil: 0,
      // ★ §14-6 — 일어난 직후의 짧은 무적. 0 이면 평상시다.
      invulnUntil: 0,
      lastSwingAt: 0,
      nodeSwings: {},
      stats: { swings: 0, gathered: {}, kills: 0, swingsBySkill: {}, alloc: {} },
    };
  }
  const p = players[id];
  if (name && p.name !== name) p.name = name;
  for (const k of SKILL_KEYS(data)) p.skills[k] ||= { xp: 0, level: 1 };
  p.nodeSwings ||= {};
  p.stats ||= { swings: 0, gathered: {}, kills: 0 };
  // ★ 진행 감독(progression.js)의 '나무를 세 번 베어 보세요' 같은 칸이 이 장부를 읽는다.
  p.stats.swingsBySkill ||= {};
  p.invulnUntil ??= 0;
  // ★ §14-5 — 스탯 표를 보장하고, 최대 HP 를 그 표에서 다시 낸다(옛 세이브도 여기서 이관된다).
  ensureStatAlloc(p, data);
  const want = playerMaxHp(p, data);
  if (p.maxHp !== want) {
    const ratio = p.maxHp > 0 ? Math.min(1, (p.hp ?? p.maxHp) / p.maxHp) : 1;
    p.maxHp = want;
    p.hp = round2(want * (p.hp == null ? 1 : ratio));
  }
  return p;
}

/** 지금 무적인가 (§14-6 — 일어난 직후 3초) */
export const isInvulnerable = (player) => (player?.invulnUntil || 0) > 0;

export function levelFromXp(xp, data) {
  const curve = skillsCfg(data).xpCurve;
  let lv = 1;
  for (let i = 1; i < curve.length; i += 1) if (xp >= curve[i]) lv = i + 1;
  return Math.min(skillsCfg(data).maxLevel, lv);
}

export function xpToNext(xp, level, data) {
  const curve = skillsCfg(data).xpCurve;
  const next = curve[level];              // level 은 1부터 — curve[level] 이 다음 문턱
  if (next == null) return null;
  return { need: next, have: Math.round(xp * 10) / 10, remaining: Math.max(0, Math.round((next - xp) * 10) / 10) };
}

/** XP 적립. 레벨이 오르면 {leveled:true, level, tool} 을 함께 돌려준다. */
export function grantXp(player, skillKey, amount, data) {
  const s = (player.skills[skillKey] ||= { xp: 0, level: 1 });
  const before = s.level;
  s.xp = Math.round((s.xp + amount) * 100) / 100;
  s.level = levelFromXp(s.xp, data);
  if (s.level > before) {
    return { leveled: true, skill: skillKey, level: s.level, from: before };
  }
  return { leveled: false, skill: skillKey, level: s.level };
}

export const skillLevel = (player, key) => Math.max(1, player?.skills?.[key]?.level ?? 1);

// ────────────────────────────────────────────────────────────────
// 도구 티어 — 레벨로 해금된다. 대장간이 있으면 한 단계 일찍 열린다.
// ────────────────────────────────────────────────────────────────
export function smithyLevelDiscount(nation, data) {
  const has = (nation.structures || []).some((s) => s.key === 'smithy');
  return has ? (skillsCfg(data).smithyToolLevelDiscount ?? 0) : 0;
}

export function toolFor(nation, player, skillKey, data) {
  const def = skillsCfg(data).defs[skillKey];
  const track = skillsCfg(data).tools[def?.toolTrack];
  if (!track) return { key: null, name: null, multiplier: 1 };
  const lv = skillLevel(player, skillKey) + smithyLevelDiscount(nation, data);
  let best = track[0];
  for (const t of track) if (lv >= t.level) best = t;
  return { key: best.key, name: best.name, multiplier: best.multiplier, unlockLevel: best.level };
}

/** 다음 도구 해금까지 (UI 표시용) */
export function nextTool(nation, player, skillKey, data) {
  const def = skillsCfg(data).defs[skillKey];
  const track = skillsCfg(data).tools[def?.toolTrack];
  if (!track) return null;
  const lv = skillLevel(player, skillKey) + smithyLevelDiscount(nation, data);
  const next = track.find((t) => t.level > lv);
  return next ? { key: next.key, name: next.name, level: next.level, multiplier: next.multiplier } : null;
}

// ────────────────────────────────────────────────────────────────
// 쿨타임 · 수확 배수
// ────────────────────────────────────────────────────────────────
/**
 * 스윙 쿨타임(밀리초) = base × (1 − perLevel×(Lv−1)) × (1 − 정착지 티어 보너스) × 민첩, 하한 floor.
 * ★ §14-5 — 민첩이 여기 붙는다(점당 −2%, 합쳐서 최대 −50% 까지). 하한은 그대로다.
 */
export function swingCooldownMs(nation, player, skillKey, data) {
  const cfg = swingCfg(data);
  const lv = skillLevel(player, skillKey);
  const skillCut = 1 - cfg.cooldownPerLevel * (lv - 1);
  const tierCut = 1 - tierSpeedBonus(nation, data);
  const agility = statEffects(player, data).cooldown;
  const sec = Math.max(cfg.cooldownFloorSec,
    cfg.baseCooldownSec * Math.max(0.1, skillCut) * Math.max(0.1, tierCut) * Math.max(0.1, agility));
  return Math.round(sec * 1000);
}

export function swingCooldownSeconds(nation, player, skillKey, data) {
  return swingCooldownMs(nation, player, skillKey, data) / 1000;
}

/**
 * 수확 배수 = (1 + yieldPerLevel×(Lv−1)) × 도구 배수 × 힘.
 * ★ §14-5 — 힘이 「스윙 피해·수확」 둘 다에 붙는다(점당 +4%). 전투 스윙은 이 값을 그대로 타고
 *   피해가 되므로, 힘 한 점이 곧 도끼질과 칼질 모두를 조금씩 세게 만든다.
 */
export function yieldMultiplier(nation, player, skillKey, data) {
  const cfg = swingCfg(data);
  const lv = skillLevel(player, skillKey);
  const fx = statEffects(player, data);
  const stat = skillKey === 'combat' ? fx.damage : fx.harvest;
  return (1 + cfg.yieldPerLevel * (lv - 1)) * toolFor(nation, player, skillKey, data).multiplier * stat;
}

/** 전투 스윙 1회 피해 */
export function swingDamage(nation, player, data) {
  const c = combatSkillCfg(data);
  return c.damagePerSwing * yieldMultiplier(nation, player, 'combat', data);
}

// ────────────────────────────────────────────────────────────────
// 쿨타임 판정 (서버 권위)
// ────────────────────────────────────────────────────────────────
/**
 * 지금 스윙할 수 있는가.
 * @param {number} now 밀리초. 테스트·시뮬은 cmd.now 로 주입한다(결정론).
 */
export function canSwing(nation, player, skillKey, data, now) {
  const cd = swingCooldownMs(nation, player, skillKey, data);
  const grace = swingCfg(data).serverGraceMs ?? 0;
  const last = player.lastSwingAt || 0;
  if (last <= 0) return { ok: true, cooldownMs: cd };      // 아직 한 번도 안 휘둘렀다
  const since = now - last;
  if (since + grace < cd) {
    return { ok: false, waitMs: Math.max(0, cd - since), cooldownMs: cd };
  }
  return { ok: true, cooldownMs: cd };
}

export function markSwing(player, now, skill = null) {
  player.lastSwingAt = now;
  player.stats.swings = (player.stats.swings || 0) + 1;
  if (skill) {
    player.stats.swingsBySkill ||= {};
    player.stats.swingsBySkill[skill] = (player.stats.swingsBySkill[skill] || 0) + 1;
  }
  return player;
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
export function skillView(nation, player, data) {
  const out = {};
  for (const key of SKILL_KEYS(data)) {
    const s = player.skills[key] || { xp: 0, level: 1 };
    out[key] = {
      name: skillsCfg(data).defs[key]?.name ?? key,
      level: s.level,
      xp: round2(s.xp),
      next: xpToNext(s.xp, s.level, data),
      cooldownSec: round2(swingCooldownSeconds(nation, player, key, data)),
      yieldMultiplier: round2(yieldMultiplier(nation, player, key, data)),
      tool: toolFor(nation, player, key, data),
      nextTool: nextTool(nation, player, key, data),
    };
  }
  return out;
}

/** NationView.you.player · nation.players — 멀티에서 서로의 레벨이 보인다 */
export function playersView(nation, data) {
  return Object.values(nation.players || {}).map((p) => ({
    id: p.id,
    name: p.name,
    hp: round2(p.hp ?? 0),
    maxHp: p.maxHp ?? combatSkillCfg(data).playerHp,
    down: (p.downUntil || 0) > 0,
    level: playerLevel(p, data),
    levels: Object.fromEntries(SKILL_KEYS(data).map((k) => [k, skillLevel(p, k)])),
    // ★ GDD3 §15-C — 이 장부의 주인이 동료인가. 명부가 사람과 동료를 가려 그린다.
    bot: Boolean(p.bot),
  }));
}

/**
 * ★ §14-5 — HUD 좌하단이 그리는 표 하나. 레벨·XP 바·남은 포인트·능력치 효과가 전부 여기 있다.
 *   화면은 셈을 하지 않는다 — 서버가 낸 값을 그대로 그린다.
 */
export function playerProgressView(player, data) {
  const next = playerXpToNext(player, data);
  const defs = statDefs(data);
  const alloc = ensureStatAlloc(player, data);
  return {
    level: playerLevel(player, data),
    maxLevel: playerCfg(data).maxLevel ?? null,
    xp: next.xp,
    from: next.from,
    need: next.need,
    ratio: round2(next.ratio),
    remaining: next.remaining ?? null,
    points: statPoints(player, data),
    spent: statSpent(player, data),
    perLevel: playerCfg(data).statPerLevel ?? 1,
    respec: Boolean(playerCfg(data).respec),
    order: statOrder(data),
    stats: Object.fromEntries(statOrder(data).map((k) => [k, {
      name: defs[k]?.name ?? k,
      short: defs[k]?.short ?? k,
      desc: defs[k]?.desc ?? '',
      icon: defs[k]?.icon ?? 'person',
      value: alloc[k] || 0,
    }])),
    effects: statEffects(player, data),
  };
}

export function playerView(nation, avatarId, data) {
  const p = nation.players?.[avatarId ?? 'lord'];
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    hp: round2(p.hp ?? 0),
    maxHp: playerMaxHp(p, data),
    down: (p.downUntil || 0) > 0,
    downUntil: p.downUntil || 0,
    // ★ §14-6 — 일어난 직후의 무적. 화면이 이 값으로 표시를 띄운다.
    invulnUntil: round2(p.invulnUntil || 0),
    downSeconds: combatSkillCfg(data).downSeconds,
    skills: skillView(nation, p, data),
    // ★ §14-5 — 레벨·XP·스탯
    progress: playerProgressView(p, data),
    stats: {
      swings: p.stats?.swings || 0, kills: p.stats?.kills || 0, gathered: p.stats?.gathered || {},
      swingsBySkill: { ...(p.stats?.swingsBySkill || {}) },
    },
    tierSpeedBonus: tierSpeedBonus(nation, data),
    settlementTier: settlementTier(nation),
  };
}
