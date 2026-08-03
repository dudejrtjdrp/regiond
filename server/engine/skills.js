// 개인 스킬 · 스윙 — docs/GDD3.md §3.
// 액션은 '스윙' 단위다. 서버가 정본으로 쥐는 것: 스킬 레벨 · 마지막 스윙 시각 · 노드별 스윙 카운트 · 거리.
// ★ 클라 신뢰 금지: 쿨타임과 사거리는 여기서만 판정한다. 옛 '하루 체감 곡선(피로)'은 폐지됐다.
import { tierSpeedBonus, settlementTier } from './tiers.js';
import { round2 } from './economy.js';

export const skillsCfg = (data) => data.skills;
export const swingCfg = (data) => data.skills.swing;
export const combatSkillCfg = (data) => data.skills.combat;

export const SKILL_KEYS = (data) => data.skills.order;

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
      lastSwingAt: 0,
      nodeSwings: {},
      stats: { swings: 0, gathered: {}, kills: 0, swingsBySkill: {} },
    };
  }
  const p = players[id];
  if (name && p.name !== name) p.name = name;
  for (const k of SKILL_KEYS(data)) p.skills[k] ||= { xp: 0, level: 1 };
  p.nodeSwings ||= {};
  p.stats ||= { swings: 0, gathered: {}, kills: 0 };
  // ★ 진행 감독(progression.js)의 '나무를 세 번 베어 보세요' 같은 칸이 이 장부를 읽는다.
  p.stats.swingsBySkill ||= {};
  if (p.maxHp == null) { p.maxHp = combatSkillCfg(data).playerHp; p.hp = p.maxHp; }
  return p;
}

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
/** 스윙 쿨타임(밀리초) = base × (1 − perLevel×(Lv−1)) × (1 − 정착지 티어 보너스), 하한 floor */
export function swingCooldownMs(nation, player, skillKey, data) {
  const cfg = swingCfg(data);
  const lv = skillLevel(player, skillKey);
  const skillCut = 1 - cfg.cooldownPerLevel * (lv - 1);
  const tierCut = 1 - tierSpeedBonus(nation, data);
  const sec = Math.max(cfg.cooldownFloorSec, cfg.baseCooldownSec * Math.max(0.1, skillCut) * Math.max(0.1, tierCut));
  return Math.round(sec * 1000);
}

export function swingCooldownSeconds(nation, player, skillKey, data) {
  return swingCooldownMs(nation, player, skillKey, data) / 1000;
}

/** 수확 배수 = (1 + yieldPerLevel×(Lv−1)) × 도구 배수 */
export function yieldMultiplier(nation, player, skillKey, data) {
  const cfg = swingCfg(data);
  const lv = skillLevel(player, skillKey);
  return (1 + cfg.yieldPerLevel * (lv - 1)) * toolFor(nation, player, skillKey, data).multiplier;
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
    levels: Object.fromEntries(SKILL_KEYS(data).map((k) => [k, skillLevel(p, k)])),
  }));
}

export function playerView(nation, avatarId, data) {
  const p = nation.players?.[avatarId ?? 'lord'];
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    hp: round2(p.hp ?? 0),
    maxHp: p.maxHp,
    down: (p.downUntil || 0) > 0,
    downUntil: p.downUntil || 0,
    skills: skillView(nation, p, data),
    stats: {
      swings: p.stats?.swings || 0, kills: p.stats?.kills || 0, gathered: p.stats?.gathered || {},
      swingsBySkill: { ...(p.stats?.swingsBySkill || {}) },
    },
    tierSpeedBonus: tierSpeedBonus(nation, data),
    settlementTier: settlementTier(nation),
  };
}
