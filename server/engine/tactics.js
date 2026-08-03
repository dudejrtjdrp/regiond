// 침공 지휘(작전 회의) — docs/GAMEPLAY2.md §C-3.
// 판정은 기존 로지스틱 그대로. 여기서 나온 값은 승률에 '퍼센트포인트로 가산'된다.
import { round3 } from './economy.js';

export function tacticsConfig(data) { return data.invasions.tactics; }

export function tacticOptions(data) {
  return tacticsConfig(data).options.map((o) => ({ key: o.key, name: o.name, desc: o.desc }));
}

export function isTactic(key, data) {
  return tacticsConfig(data).options.some((o) => o.key === key);
}

/**
 * 성벽 약점 구간 — (seed, 침공 타입)에서 결정론적으로 뽑는다.
 * 같은 시드의 시뮬/재현이 항상 같은 결과를 내야 하므로 rng 스트림을 쓰지 않는다.
 */
export function weakSegmentFor(seed, type, segments) {
  const s = `${seed}:${type}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % segments;
}

/** 클라가 보낸 작전을 검증·정규화한다. 실패 시 {error} 반환. */
export function normalizeBattlePlan(input, data) {
  const cfg = tacticsConfig(data);
  const tactic = input?.tactic ?? null;
  if (!isTactic(tactic, data)) return { error: { code: 'BAD_TACTIC', message: '알 수 없는 전술입니다.' } };
  const segments = cfg.surge.segments;
  let split = Array.isArray(input?.surgeSplit) ? input.surgeSplit.slice(0, segments) : null;
  if (!split || split.length !== segments) split = cfg.default.surgeSplit.slice();
  split = split.map((v) => Math.max(0, Number(v) || 0));
  const sum = split.reduce((a, b) => a + b, 0);
  if (sum <= 0) split = cfg.default.surgeSplit.slice();
  else split = split.map((v) => v / sum);
  return { plan: { tactic, surgeSplit: split.map((v) => Math.round(v * 1000) / 1000) } };
}

/**
 * 전술 보정(퍼센트포인트). 작전을 세우지 않았으면 0 — 「안 열어도 기본 전술로 진행」이
 * 불이익이 되지 않게 하고, 검증된 밸런스(시뮬 체크포인트)를 흔들지 않기 위한 규칙이다.
 */
export function tacticWinDelta(nation, spec, data, { weakSegment = null } = {}) {
  const cfg = tacticsConfig(data);
  const plan = nation?.battlePlan;
  if (!plan?.tactic) return { total: 0, matchup: 0, surge: 0, tactic: null };
  const matchup = cfg.matchup?.[spec.type]?.[plan.tactic] ?? 0;
  let surge = 0;
  const split = plan.surgeSplit;
  if (weakSegment != null && Array.isArray(split) && split.length === cfg.surge.segments) {
    const top = Math.max(...split);
    if (split[weakSegment] >= top - 1e-9 && split[weakSegment] >= cfg.surge.hitThreshold) surge = cfg.surge.hitBonus;
  }
  return { total: round3(matchup + surge), matchup: round3(matchup), surge: round3(surge), tactic: plan.tactic };
}

/**
 * 상성 힌트 공개 조건 — 국방대신 Lv3+ 또는 플레이어가 국방을 직접 담당할 때만.
 * (정보 비대칭 규칙: 서버에서 강제하고 클라를 신뢰하지 않는다)
 */
export function canSeeTacticHint(nation, viewerRole, data) {
  const cfg = tacticsConfig(data).hint;
  const role = nation?.roles?.defense;
  if (!role?.holder) return false;
  if (role.holder === 'player' && viewerRole === 'defense') return true;
  return (role.level || 0) >= (cfg?.defenseLevelMin ?? 3);
}

/**
 * ★ GDD3 §6 — 웨이브 상성 힌트. 옛 침공 상성표(±8%p)는 적 종류마다 '듣는 전술(weakTo)'로 계승됐고,
 *   실시뮬에서는 방어 피해 배수(waves.battle.tacticDamageBonus)로 들어간다.
 *   이 문장은 국방부(국방대신 Lv3+ 또는 플레이어 국방 담당)에게만 나간다.
 */
export function waveTacticHint(spec, data) {
  if (!spec?.weakTo) return null;
  const cfg = tacticsConfig(data);
  const opt = cfg.options.find((o) => o.key === spec.weakTo) ?? null;
  return {
    enemyType: spec.type,
    enemyName: spec.name,
    recommended: spec.weakTo,
    recommendedName: opt?.name ?? spec.weakTo,
    bonus: data.waves.battle.tacticDamageBonus,
    penalty: data.waves.battle.tacticPenalty,
    text: opt ? `${spec.name}에는 ${opt.name}이(가) 듣습니다.` : null,
  };
}

/** 국방부에게만 나가는 힌트 문장 + 약점 구간 (옛 시즌 침공용 — 참고 보존) */
export function tacticHint(nation, spec, data, weakSegment) {
  if (!spec) return null;
  const cfg = tacticsConfig(data);
  const table = cfg.matchup?.[spec.type] ?? {};
  const best = Object.entries(table).sort((a, b) => b[1] - a[1])[0];
  const bestName = cfg.options.find((o) => o.key === best?.[0])?.name ?? null;
  return {
    enemyType: spec.type,
    enemyName: spec.name,
    recommended: best?.[0] ?? null,
    recommendedName: bestName,
    deltas: table,
    weakSegment,
    weakSegmentName: weakSegment == null ? null : cfg.surge.segmentNames[weakSegment],
    text: bestName ? `${spec.name}에는 ${bestName}이(가) 듣습니다.` : null,
  };
}
