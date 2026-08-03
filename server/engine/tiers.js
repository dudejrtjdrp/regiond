// 정착지 성장 아크 — docs/GDD3.md §1. 게임의 척추다.
// 티어가 영토 반경·건물 해금·기능 해금·전역 작업 속도를 전부 결정한다.
// ★ 옛 '개척령(expand)'은 폐기됐다 — 영토는 티어가 오르면 저절로 넓어진다.
import { townOf, dist } from './world.js';

export const tiersCfg = (data) => data.tiers;

/** 정착지 티어 (스냅샷에 없으면 0) */
export const settlementTier = (nation) => Math.max(0, nation?.tier ?? 0);

/**
 * 티어 정의. 표에 없는 티어(엔드리스 구간)는 규칙으로 만들어 낸다.
 * @returns {{tier,name,radius,requires,unlocks,line,endless?}}
 */
export function tierDef(tier, data) {
  const cfg = tiersCfg(data);
  const found = cfg.levels.find((l) => l.tier === tier);
  if (found) return found;
  const last = cfg.levels[cfg.levels.length - 1];
  if (tier < 0) return cfg.levels[0];
  const e = cfg.endless;
  const over = tier - last.tier;
  return {
    tier,
    name: e.namePattern.replace('{n}', String(over + 1)),
    radius: last.radius + e.radiusPerTier * over,
    requires: { population: (last.requires?.population ?? 0) + e.populationStep * over },
    unlocks: { buildings: [], features: [], ui: [] },
    line: '끝이 없는 길에 들어섰다.',
    endless: true,
  };
}

export function tierName(tier, data) { return tierDef(tier, data).name; }
export function tierRadius(tier, data) { return tierDef(tier, data).radius; }

/** 전역 작업 속도 보너스 — 스윙 쿨타임이 티어당 speedBonusPerTier 만큼 짧아진다 */
export function tierSpeedBonus(nation, data) {
  return tiersCfg(data).speedBonusPerTier * settlementTier(nation);
}

// ────────────────────────────────────────────────────────────────
// 조건 판정
// ────────────────────────────────────────────────────────────────
/** 이 나라가 지은(완공된) 건물 중 key 인 것의 수 */
export function structureCount(nation, key) {
  return (nation.structures || []).filter((s) => s.key === key).length;
}

/**
 * 다음 티어 조건 상태.
 * @returns {Array<{key,ok,need,have,text}>}
 */
export function requirementStatus(nation, requires, data) {
  const out = [];
  const req = requires || {};
  if (req.population != null) {
    out.push({
      key: 'population', ok: nation.population >= req.population,
      need: req.population, have: Math.floor(nation.population),
      text: `주민 ${req.population}명`,
    });
  }
  for (const [key, count] of Object.entries(req.structures || {})) {
    const have = structureCount(nation, key);
    out.push({
      key: `structure:${key}`, ok: have >= count, need: count, have,
      text: `${data.buildings[key]?.name ?? key} ${count}채`,
    });
  }
  for (const [res, amount] of Object.entries(req.resources || {})) {
    const have = nation.resources?.[res] || 0;
    out.push({
      key: `resource:${res}`, ok: have >= amount, need: amount, have: Math.floor(have),
      text: `${data.resources.meta[res]?.name ?? res} ${amount}`,
    });
  }
  return out;
}

/** 지금 다음 티어로 오를 수 있는가 + 그 조건표 (뷰·목표 카드가 이걸로 그린다) */
export function nextTierStatus(nation, data) {
  const cur = settlementTier(nation);
  const next = tierDef(cur + 1, data);
  const reqs = requirementStatus(nation, next.requires, data);
  return {
    tier: next.tier,
    name: next.name,
    radius: next.radius,
    fromRadius: tierRadius(cur, data),
    ready: reqs.every((r) => r.ok),
    reqs,
    unlocks: unlockSummary(next, data),
    line: next.line ?? null,
    endless: Boolean(next.endless),
  };
}

function unlockSummary(def, data) {
  return {
    buildings: (def.unlocks?.buildings || []).map((k) => ({ key: k, name: data.buildings[k]?.name ?? k })),
    features: [...(def.unlocks?.features || [])],
    ui: [...(def.unlocks?.ui || [])],
  };
}

// ────────────────────────────────────────────────────────────────
// 승격 — ★ GDD3 §12-2: 저절로 오르지 않는다. 본부의 [승격] 단추가 유일한 방아쇠다.
//
//   왜 바꿨나: "영토 넓어지는 조건을 모르겠다"는 피드백. 조건이 차는 순간 몰래 올라 버리면
//   플레이어는 자기가 무엇을 해서 넓어졌는지 영영 모른다. 이제 조건표를 본부에서 눈으로 읽고,
//   다 차면 초록 단추를 눌러 스스로 올린다 — 연출도 그 순간에 터진다.
//   (사슬 장 전환은 tier 를 조건으로 쓰지 않으므로 이 변경이 진행 감독과 어긋나지 않는다.)
// ────────────────────────────────────────────────────────────────
/** 한 단계 올린다 (조건 검사 없음 — 부르는 쪽이 nextTierStatus.ready 를 봤다는 뜻) */
function applyPromotion(world, nation, data) {
  const st = nextTierStatus(nation, data);
  const from = tierRadius(settlementTier(nation), data);
  nation.tier = st.tier;
  nation.territory = { ...(nation.territory || {}), radius: st.radius };
  const gained = nodesGained(world, nation, from, st.radius);
  return {
    tier: st.tier, name: st.name, radius: st.radius, fromRadius: from,
    unlocks: st.unlocks, line: st.line, nodesGained: gained.length, addedNodeIds: gained,
    milestone: tierDef(st.tier, data).milestone ?? null,
  };
}

/**
 * ★ [승격] — 정착지를 한 단계 올린다 (promoteSettlement 명령의 알맹이).
 * @returns {{ok:true, up}|{ok:false,error}}
 */
export function promoteSettlement(world, nation, data) {
  const st = nextTierStatus(nation, data);
  if (!st.ready) {
    const missing = st.reqs.filter((r) => !r.ok).map((r) => r.text).join(' · ');
    return { ok: false, error: { code: 'NOT_READY', message: `아직 조건이 모자랍니다 — ${missing}` } };
  }
  return { ok: true, up: applyPromotion(world, nation, data) };
}

/**
 * 조건이 찬 만큼 연달아 올린다 — **사람 손이 닿지 않는 국가(AI·시뮬 보정)** 전용.
 * 플레이어 정착지는 promoteSettlement 로만 오른다.
 * @returns {Array} 이번에 오른 단계들
 */
export function evaluateTier(world, nation, data) {
  const leveled = [];
  let guard = 0;
  while (guard++ < 16) {
    if (!nextTierStatus(nation, data).ready) break;
    leveled.push(applyPromotion(world, nation, data));
  }
  return leveled;
}

/** 새 반경 안으로 들어온 노드 — 티어업 연출의 '새 땅의 보상' */
function nodesGained(world, nation, fromRadius, toRadius) {
  const town = townOf(world, nation.id);
  if (!town) return [];
  const out = [];
  for (const n of world.map?.nodes || []) {
    if (n.hidden) continue;
    const d = dist(n.x, n.y, town.x, town.y);
    if (d <= fromRadius + 0.001 || d > toRadius + 0.001) continue;
    out.push(n.id);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// 티어 해금표 — ★ v3.1: 더 이상 '정본'이 아니다.
// 해금의 단일 관장은 진행 감독(server/engine/progression.js)이고,
// 이 목록은 **마지막 장(엔드리스)에 들어선 뒤에만** 거기에 합류한다.
// 그 전에는 티어가 올라도 아무 문도 열리지 않는다 — 티어는 반경·작업 속도·승격 연출만 맡는다.
// (인구가 빨리 늘어 티어 3이 되는 바람에 무역이 사슬을 앞질러 열리는 사고를 원천 봉쇄한다.)
// ────────────────────────────────────────────────────────────────
/** 티어표가 품은 해금 목록 (엔드리스 구간 전용) */
export function tierUnlockedList(nation, data) {
  const cur = settlementTier(nation);
  const buildings = [];
  const features = [];
  const ui = [];
  for (const level of tiersCfg(data).levels) {
    if (level.tier > cur) break;
    buildings.push(...(level.unlocks?.buildings || []));
    features.push(...(level.unlocks?.features || []));
    ui.push(...(level.unlocks?.ui || []));
  }
  return {
    buildings: [...new Set(buildings)], features: [...new Set(features)],
    ui: [...new Set(ui)], commands: [],
  };
}

/** NationView.tier 블록 — unlocked 는 진행 감독이 채운다(view.js) */
export function tierView(nation, data) {
  const cur = settlementTier(nation);
  const def = tierDef(cur, data);
  return {
    tier: cur,
    name: def.name,
    radius: def.radius,
    line: def.line ?? null,
    speedBonus: tierSpeedBonus(nation, data),
    next: nextTierStatus(nation, data),
  };
}
