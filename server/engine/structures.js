// 건물 실체 — docs/GDD3.md §7. 배치 · **개별 건물 티어** · 수리 · 효과 합산.
// ★ v3 전환: 건물은 이제 '국가 티어 1개'가 아니라 '실체마다 자기 티어'를 갖는다.
//   같은 건물을 여러 채 지으면 효과가 합산되지만, 합산값은 data/buildings.json effectRules 의 상한에 눌린다
//   (기존 밸런스를 물려받은 항목은 배수 1 — 옛 상한 그대로라 경제가 흔들리지 않는다).
import { townOf, territoryRadius, inTerritory, terrainNameAt, dist, cheb, addNode } from './world.js';
import { buildingCost } from './build_cost.js';
import { settlementTier } from './tiers.js';
import { round2, round3 } from './economy.js';
// ★ §17-13 — 매립한 물 칸은 뭍으로 쳐 준다(매립의 핵심 보상: 그 위에 지을 수 있다)
import { onFill, researchDone } from './research.js';

export const placeCfg = (data) => data.world.buildingPlacement;
export const effectRules = (data) => data.buildings.effectRules;

const err = (code, message) => ({ ok: false, error: { code, message } });

/** 건물 정의 (도구·카테고리 표 같은 메타 키는 건물이 아니다) */
export function structureDef(key, data) {
  const def = data.buildings[key];
  if (!def || !Array.isArray(def.tiers)) return null;
  return def;
}

export function buildingKeys(data) {
  return Object.keys(data.buildings).filter((k) => structureDef(k, data));
}

/** 조각 배치(울타리·문)는 placeBuilding 이 아니라 placeFence 로 세운다 */
export const isPiece = (key, data) => Boolean(data.buildings[key]?.piece);

export function tierSpec(key, tier, data) {
  const def = structureDef(key, data);
  return def?.tiers?.[tier - 1] ?? null;
}

export function maxTier(key, data) {
  const def = structureDef(key, data);
  return def ? (def.maxTier ?? def.tiers.length) : 0;
}

/** 이 티어의 표시 이름 (모닥불→화톳불처럼 티어마다 이름이 다른 건물이 있다) */
export function structureName(key, tier, data) {
  const t = tierSpec(key, tier, data);
  return t?.name ?? data.buildings[key]?.name ?? key;
}

export function structuresOf(nation, key) {
  return (nation.structures || []).filter((s) => s.key === key);
}

export function findStructure(nation, id) {
  return (nation.structures || []).find((s) => s.id === id) ?? null;
}

// ────────────────────────────────────────────────────────────────
// ★ 풋프린트 (GDD3 §12-1) — 건물은 칸 하나가 아니라 사각형을 차지한다
//
// 앵커 규약: 건물의 (x,y) 는 **풋프린트 좌상단 칸**이다.
//   따라서 중심은 (x + (w-1)/2, y + (h-1)/2) 이고, 1×1 건물은 중심 = 앵커 —
//   즉 옛 좌표 체계와 완전히 같다(기존 좌표를 쓰던 곳이 그대로 유효하다).
// 간격 규약: 두 사각형 사이의 '체비쇼프 간격'이 minSpacing 미만이면 못 놓는다.
//   1×1 끼리면 간격 = cheb(a,b) 라서 옛 규칙과 정확히 같은 값이 나온다.
// ────────────────────────────────────────────────────────────────
/** 그 건물이 차지하는 칸 수 {w,h} (없으면 1×1) */
export function footprint(key, data) {
  const f = data.buildings?.[key]?.footprint;
  if (!Array.isArray(f) || f.length < 2) return { w: 1, h: 1 };
  return { w: Math.max(1, Math.round(f[0])), h: Math.max(1, Math.round(f[1])) };
}

/** 좌상단 앵커에서 잡은 사각형 {x0,y0,x1,y1} (양끝 포함) */
export function footRect(key, x, y, data) {
  const { w, h } = footprint(key, data);
  return { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 };
}

/** 건물 실체(또는 공사 현장)의 사각형 */
export function rectOf(s, data) {
  return footRect(s.key ?? s.building, s.x, s.y, data);
}

/** 렌더·거리 계산이 쓰는 중심 좌표 */
export function centerOf(key, x, y, data) {
  const { w, h } = footprint(key, data);
  return { x: x + (w - 1) / 2, y: y + (h - 1) / 2 };
}

/**
 * ★ 커서가 가리킨 칸 → 앵커(좌상단). 클라의 고스트도 **똑같은 식**을 쓴다 —
 *   두 쪽이 어긋나면 "초록이었는데 서버가 거절"이 난다.
 */
export function anchorFromCell(key, cx, cy, data) {
  const { w, h } = footprint(key, data);
  return { x: Math.round(cx) - Math.floor((w - 1) / 2), y: Math.round(cy) - Math.floor((h - 1) / 2) };
}

/** 두 사각형 사이의 체비쇼프 간격. 0 이하면 닿거나 겹쳤다는 뜻이다. */
export function rectGap(a, b) {
  const gx = Math.max(b.x0 - a.x1, a.x0 - b.x1);
  const gy = Math.max(b.y0 - a.y1, a.y0 - b.y1);
  return Math.max(gx, gy);
}

const cellRect = (x, y) => ({ x0: x, y0: y, x1: x, y1: y });

/** 사각형 안 칸을 하나씩 */
export function eachCell(rect, fn) {
  for (let y = rect.y0; y <= rect.y1; y += 1) for (let x = rect.x0; x <= rect.x1; x += 1) fn(x, y);
}

/** 이 칸을 밟고 선 건물 (클릭 판정·겹침 검사) */
export function structureAtCell(nation, x, y, data) {
  for (const s of nation.structures || []) {
    const r = rectOf(s, data);
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return s;
  }
  return null;
}

/** 이 건물이 정착지 본부인가 — 이전·철거가 막히고 티어가 정착지를 따라간다 (§12-2) */
export const isHq = (key, data) => Boolean(data.buildings?.[key]?.hq);
export const isImmovable = (key, data) => Boolean(data.buildings?.[key]?.immovable || data.buildings?.[key]?.hq);

/** ★ §19-F3(F07-8) — 왜 못 헐고 못 옮기는가. 건물마다 제 까닭을 자료가 쥔다(없으면 옛 문구). */
export function immovableReason(key, data, verb) {
  const def = data.buildings?.[key];
  return def?.immovableReason ?? `정착지 본부는 ${verb} 수 없습니다.`;
}

// ────────────────────────────────────────────────────────────────
// 효과 합산 (개별 티어 → 국가 효과)
// ────────────────────────────────────────────────────────────────
function readPath(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function ruleFor(path, data) {
  const rules = effectRules(data);
  const head = path.split('.')[0];
  return {
    mode: rules.mode?.[head] ?? 'sum',
    stack: rules.stackCap?.[head] ?? rules.stackCap._default,
  };
}

/** 그 건물 한 채가 낼 수 있는 최대치 (= 최고 티어 값). 상한 계산의 기준. */
export function peakEffect(key, path, data) {
  const def = structureDef(key, data);
  if (!def) return 0;
  let peak = 0;
  for (const t of def.tiers) {
    const v = Number(readPath(t, path));
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  return peak;
}

/**
 * 국가 전체 효과값.
 *   mode 'sum'  → 동종 합산 후 (그 건물 최고 티어 값 × stackCap) 으로 클램프
 *   mode 'max'  → 합산하지 않고 최고값
 * @param {string} path 'output.grain' · 'attractiveness' · 'storageMultiplier' …
 */
export function effectValue(nation, path, data, { onlyKey = null, healthy = true } = {}) {
  const { mode, stack } = ruleFor(path, data);
  const byKey = new Map();
  for (const s of nation.structures || []) {
    if (onlyKey && s.key !== onlyKey) continue;
    if (healthy && isRuined(s)) continue;
    if (s.inactive) continue;                       // ★ §12-12 이전·철거 중이면 효과가 멎는다
    const spec = tierSpec(s.key, s.tier, data);
    if (!spec) continue;
    const v = Number(readPath(spec, path));
    if (!Number.isFinite(v) || v === 0) continue;
    const scale = damageScale(s);
    byKey.set(s.key, (byKey.get(s.key) || 0) + v * scale);
  }
  let total = 0;
  for (const [key, sum] of byKey) {
    if (mode === 'max') { total = Math.max(total, sum); continue; }
    const cap = peakEffect(key, path, data) * stack;
    total += cap > 0 ? Math.min(sum, cap) : sum;
  }
  return total;
}

/** 파손 정도에 따른 효과 감쇠 — 내구도 절반 아래면 값을 반만 한다(수리 압력) */
export function damageScale(s) {
  if (!s.maxHp) return 1;
  const ratio = (s.hp ?? s.maxHp) / s.maxHp;
  if (ratio >= 0.5) return 1;
  return Math.max(0, ratio / 0.5);
}

export const isRuined = (s) => (s.hp != null && s.hp <= 0);

/** {resource: 하루 정액 산출} — 장작더미·사냥꾼 오두막·광산 갱도 같은 레이트 건물 */
export function flatOutputs(nation, data) {
  const out = {};
  for (const res of data.resources.order) {
    const v = effectValue(nation, `flatOutput.${res}`, data);
    if (v > 0) out[res] = v;
  }
  return out;
}

/** 곡창·우물·방앗간의 산출 가산(기존 buildingFactor 의 extra 항으로 들어간다) */
export function structureOutputBonus(nation, resource, data) {
  if (placeCfg(data).adjacency.requiresArchitect && !nation.roles?.build?.holder) {
    return effectValue(nation, `output.${resource}`, data);
  }
  const adjacency = (nation.structures || [])
    .filter((s) => !isRuined(s) && (s.adjacency || 0) > 0 && tierSpec(s.key, s.tier, data)?.output?.[resource])
    .reduce((a, s) => a + (s.adjacency || 0), 0);
  return effectValue(nation, `output.${resource}`, data) + Math.min(0.2, adjacency);
}

export function gatherBonus(nation, resource, data) {
  return effectValue(nation, `gatherBonus.${resource}`, data);
}

export function housingCapacity(nation, data) {
  return Math.floor(effectValue(nation, 'residents', data));
}

export function attractivenessBonus(nation, data) {
  return effectValue(nation, 'attractiveness', data);
}

export function moraleBonus(nation, data) {
  return effectValue(nation, 'moraleBonus', data);
}

export function logisticsTier(nation, data) {
  return Math.floor(effectValue(nation, 'logisticsTier', data));
}

export function storageMultiplier(nation, data) {
  return effectValue(nation, 'storageMultiplier', data);
}

export function storageBonus(nation, data) {
  return effectValue(nation, 'storageBonus', data);
}

export function shrinePopulationCap(nation, data) {
  return effectValue(nation, 'populationCap', data);
}

export function toolDiscount(nation, data) {
  return Math.min(0.5, effectValue(nation, 'toolDiscount', data));
}

export function prestige(nation, data) {
  return effectValue(nation, 'prestige', data);
}

export function warnBonusDays(nation, data) {
  return effectValue(nation, 'warnBonusDays', data);
}

export function goldPerDay(nation, data) {
  return effectValue(nation, 'goldPerDay', data);
}

/* ★ §19-F4(F09-1) — 연구소가 늘려 주는 하루의 걸음.
   「왜」 여기 두는가 — 값을 합산하고 상한에 누르는 셈(effectValue)은 이미 이 파일에 하나뿐이다.
   research.js 가 제 손으로 nation.structures 를 다시 훑으면 파손 감쇠(damageScale)·이전 중
   정지(inactive)·효과 상한(effectCap)이 두 벌이 되어 언젠가 갈린다. */
export function researchSpeedBonus(nation, field, data) {
  const all = effectValue(nation, 'researchSpeed.all', data);
  const own = field ? effectValue(nation, `researchSpeed.${field}`, data) : 0;
  const cap = data.research?.labs?.maxBonus ?? 1;
  return round3(Math.min(cap, all + own));
}

/** 대학당이 깎아 주는 「하루를 사는 값」의 몫 (0~0.9) */
export function researchHasteDiscount(nation, data) {
  return Math.min(0.9, effectValue(nation, 'researchHasteDiscount', data));
}

export function militiaSlots(nation, data) {
  return Math.floor(effectValue(nation, 'militiaSlots', data));
}

export function militiaBonus(nation, data) {
  return effectValue(nation, 'militiaBonus', data);
}

export function militiaDpsBonus(nation, data) {
  return effectValue(nation, 'militiaDps', data);
}

export function factoryBonus(nation, data) {
  return effectValue(nation, 'factoryBonus', data);
}

export function permanentDefense(nation, data) {
  return effectValue(nation, 'permanentDefense', data);
}

export function hasBuilding(nation, key) {
  return structuresOf(nation, key).some((s) => !isRuined(s) && !s.inactive);
}

/** 터렛 실체 목록 — 웨이브 실시뮬의 입력 */
export function turretList(nation, data) {
  const out = [];
  for (const s of nation.structures || []) {
    const spec = tierSpec(s.key, s.tier, data);
    if (!spec?.turret) continue;
    if (isRuined(s) || s.inactive) continue;
    /* ★ §15-A — 쏘는 자리는 앵커(좌상단)가 아니라 **중심**이다. 1×1 터렛에서는 둘이 같은 값이라
       옛 계산이 한 톨도 안 바뀌고, 노포·화포처럼 두 칸을 넘는 터렛에서만 자리가 제대로 잡힌다. */
    const c = centerOf(s.key, s.x, s.y, data);
    out.push({
      id: s.id, key: s.key, tier: s.tier, x: c.x, y: c.y, ax: s.x, ay: s.y,
      name: structureName(s.key, s.tier, data),
      dps: spec.turret.dps * damageScale(s),
      range: spec.turret.range,
      counters: data.buildings[s.key]?.counters || [],
      hp: s.hp, maxHp: s.maxHp,
      /* ★ §19-F1(F08-3) — 화살탑 말고도 쏘는 것이 생겼다. 「무엇을 더 하는가」는 전부 data 가 쥔다:
         slow 는 걸음을 늦추고 splash 는 겨눈 자리 둘레까지 태운다. 없으면 옛 화살탑 그대로다. */
      slow: spec.turret.slow ?? null,
      splash: spec.turret.splash ?? null,
    });
  }
  return out;
}

/**
 * ★ 레거시 거울 — 검증된 매크로 공식(economy.js)이 읽는 nation.buildings 를 개별 건물에서 파생시킨다.
 *   공식을 한 줄도 고치지 않고 새 건물 체계를 얹기 위한 접합면이다(GDD3 §9 유지 목록).
 */
export function syncLegacyBuildings(nation, data) {
  const b = (nation.buildings ||= { tools: { hoe: 0, pickaxe: 0, weapon: 0 } });
  b.tools ||= { hoe: 0, pickaxe: 0, weapon: 0 };
  const maxTierOf = (key) => structuresOf(nation, key)
    .reduce((m, s) => ((isRuined(s) || s.inactive) ? m : Math.max(m, s.tier)), 0);
  b.granary = maxTierOf('granary');
  b.storage = maxTierOf('storage');
  b.shrine = maxTierOf('shrine');
  b.barracks = maxTierOf('barracks');
  b.consulate = maxTierOf('consulate');
  b.workshop = maxTierOf('smithy');
  // 운임 티어는 이제 도로가 아니라 물류 건물(교역소·시장)에서 나온다 — 공식(freightByRoadTier)은 그대로다.
  b.road = Math.min(data.balance.trade.freightByRoadTier.length - 1, logisticsTier(nation, data));
  b.wall = 0;
  return b;
}

// ────────────────────────────────────────────────────────────────
// 배치 유효성
// ────────────────────────────────────────────────────────────────
/**
 * 배치 유효성 — ★ 판정 단위는 칸 하나가 아니라 **풋프린트 사각형 전체**다 (GDD3 §12-1).
 * @param {object} opts.ignoreId 이 건물은 못 본 척한다 (이전할 때 제자리 겹침 방지)
 */
export function validatePlacement(world, nation, key, x, y, data, opts = {}) {
  const size = data.world.size;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, code: 'BAD_POSITION', message: '지도 밖입니다.' };
  }
  const rect = footRect(key, x, y, data);
  if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 >= size || rect.y1 >= size) {
    return { ok: false, code: 'BAD_POSITION', message: '지도 밖입니다.' };
  }
  const town = townOf(world, nation.id);
  if (!town) return { ok: false, code: 'NO_TOWN', message: '정착지가 없습니다.' };
  /* ★ §17-14 — 개척 깃발(allowOutsideTerritory)은 유일하게 영토 밖에 선다. 다만 본영에서
     claim.maxRangeFromTown 안이어야 한다(지도 반대편에 깃발만 던져 두는 것을 막는다).
     그 밖의 건물은 영토 판정을 inTerritory 로 본다 — 본영 원에 더해 깃발로 얻은
     점령지(nation.claims) 안에도 지을 수 있다. */
  const allowOutside = Boolean(data.buildings?.[key]?.allowOutsideTerritory);
  const maxRange = data.world.territory.claim?.maxRangeFromTown ?? 70;
  let bad = null;
  eachCell(rect, (cx, cy) => {
    if (bad) return;
    if (allowOutside) {
      if (dist(town.x, town.y, cx, cy) > maxRange + 0.001) {
        bad = { ok: false, code: 'TOO_FAR', message: '본영에서 너무 멉니다.' };
        return;
      }
    } else if (!inTerritory(world, nation, cx, cy, data)) {
      bad = { ok: false, code: 'OUT_OF_TERRITORY', message: '아직 우리 땅이 아닙니다.' };
      return;
    }
    const terrain = terrainNameAt(world.map, cx, cy, data);
    if (!(data.world.terrain.buildable || []).includes(terrain)
      /* ★ §17-13 매립 — 메운 물 칸은 buildable 로 친다. 다리는 해당 없다(그 위에는 못 짓는다). */
      && !(terrain === 'water' && onFill(nation, cx, cy))
      /* ★ §20-R4(유물기획 §20-4 얼어붙은 왕의 홀) — 이 유물 하나만 「설산에는 못 짓는다」를 깬다.
         한도(limit)까지만이다: 몇 채든 서면 설산이 그냥 또 하나의 들판이 되어, 「사람이 살 수 없는
         땅에 기둥 하나」라는 이 유물의 값이 사라진다. 유물이 없으면 한도가 0 이라 옛 규칙 그대로다. */
      && !snowBuildAllowed(world, nation, terrain, data)) {
      bad = { ok: false, code: 'BAD_TERRAIN', message: '여기에는 지을 수 없습니다.' };
    }
  });
  if (bad) return bad;

  const spacing = placeCfg(data).minSpacing;
  for (const s of nation.structures || []) {
    if (opts.ignoreId && s.id === opts.ignoreId) continue;
    if (rectGap(rectOf(s, data), rect) < spacing) {
      return { ok: false, code: 'TOO_CLOSE', message: '다른 건물과 너무 가깝습니다.' };
    }
  }
  for (const c of nation.construction || []) {
    if (c.x == null) continue;
    if (opts.ignoreId && c.structureId === opts.ignoreId) continue;
    if (rectGap(footRect(c.building, c.x, c.y, data), rect) < spacing) {
      return { ok: false, code: 'TOO_CLOSE', message: '공사 중인 자리와 겹칩니다.' };
    }
  }
  const clear = placeCfg(data).nodeClearance;
  for (const n of world.map?.nodes || []) {
    if (n.hidden) continue;
    if (rectGap(cellRect(n.x, n.y), rect) < clear) {
      return { ok: false, code: 'ON_NODE', message: '자원이 나는 자리입니다.' };
    }
  }
  return { ok: true };
}

/**
 * ★ §20-R4(§20-4 얼어붙은 왕의 홀) — 설산 한 채 해금. 이미 설산에 세운 건물 수가 한도 미만이면 통과.
 * 「왜」 건물을 훑어 세나 — 「몇 채 지었나」의 정본은 nation.structures 뿐이다. 따로 셈을 적어 두면
 * 철거·이전(§12-12)마다 그 셈을 맞춰 줘야 하고, 한 번 어긋나면 영영 어긋난 채로 남는다.
 * 한도는 tick.js 가 박는 거울(artifactSnowBuildLimit)이다 — 배치 판정은 클릭마다 도는 길목이다.
 */
function snowBuildAllowed(world, nation, terrain, data) {
  const limit = nation.artifactSnowBuildLimit || 0;
  if (limit <= 0 || terrain !== 'snow') return false;
  let onSnow = 0;
  for (const s of nation.structures || []) {
    if (terrainNameAt(world.map, s.x, s.y, data) === 'snow') onSnow += 1;
  }
  return onSnow < limit;
}

/** 좌표를 안 준 건설(봇·섭정·조언 매크로)이 쓸 기본 자리 — 정착지에서 바깥으로 나선 탐색 */
export function autoSpot(world, nation, key, data) {
  const town = townOf(world, nation.id);
  if (!town) return null;
  const r = Math.floor(territoryRadius(nation, data));
  const { w, h } = footprint(key, data);
  for (let ring = 2; ring <= r; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        // ring 은 '중심에서 얼마나 떨어진 자리인가'다 — 앵커는 거기서 풋프린트 절반만큼 물린다
        const x = town.x + dx - Math.floor((w - 1) / 2);
        const y = town.y + dy - Math.floor((h - 1) / 2);
        if (validatePlacement(world, nation, key, x, y, data).ok) return { x, y };
      }
    }
  }
  return null;
}

export function adjacencyBonus(world, nation, key, x, y, data, { placed = true } = {}) {
  const cfg = placeCfg(data).adjacency;
  const wants = cfg.byBuilding?.[key];
  if (!wants || x == null) return 0;
  if (cfg.requiresPlacement && !placed) return 0;
  if (cfg.requiresArchitect && !nation.roles?.build?.holder) return 0;
  const c = centerOf(key, x, y, data);
  let n = 0;
  for (const node of world.map?.nodes || []) {
    if (node.hidden || !wants.includes(node.type)) continue;
    if (dist(node.x, node.y, c.x, c.y) <= cfg.radius) n += 1;
  }
  return Math.min(cfg.max, n * cfg.perNode);
}

export function adjacencyDetail(world, nation, key, x, y, data) {
  const cfg = placeCfg(data).adjacency;
  const wants = cfg.byBuilding?.[key] || [];
  const counts = {};
  const c = centerOf(key, x, y, data);
  for (const node of world.map?.nodes || []) {
    if (node.hidden || !wants.includes(node.type)) continue;
    if (dist(node.x, node.y, c.x, c.y) <= cfg.radius) counts[node.type] = (counts[node.type] || 0) + 1;
  }
  return { radius: cfg.radius, wants, counts, bonus: adjacencyBonus(world, nation, key, x, y, data) };
}

// ────────────────────────────────────────────────────────────────
// 건설 · 업그레이드 · 수리
// ────────────────────────────────────────────────────────────────
/**
 * 새 건물 착공 (placeBuilding).
 * @returns {{ok:true, site}|{ok:false,error}}
 */
export function startBuild(world, nation, cmd, data, hooks = {}) {
  const key = cmd.building ?? cmd.key;
  const def = structureDef(key, data);
  if (!def) return err('BAD_BUILDING', '알 수 없는 건물입니다.');
  if (isPiece(key, data)) return err('USE_PLACE_FENCE', '울타리·문은 드래그로 세웁니다(placeFence).');
  // ★ v3.1 — 해금 판정은 여기 없다. 진행 감독(commands.applyCommand → buildingUnlocked)이 단일 관장이다.
  //   여기서 requiresTier 를 한 번 더 보면 사슬(4장 곡창)과 티어표(곡창=티어2)가 어긋나 문이 두 개가 된다.
  //   AI 3국은 사슬이 없으므로 티어 기준을 그대로 쓴다.
  if (!nation.isPlayer && settlementTier(nation) < (def.requiresTier ?? 0)) {
    return err('TIER_LOCKED', `정착지 티어 ${def.requiresTier} 부터 지을 수 있습니다.`);
  }
  /* ★ §19-F4(F09-2) — 궁리가 먼저인 건물. 정거장은 철로를 배우기 전에는 세울 수 없다.
     티어·장(章)과 달리 이 문은 **연구 장부**가 연다 — 사람이든 AI 3국이든 같은 잣대다. */
  if (def.requiresResearch && !researchDone(nation, def.requiresResearch)) {
    const rname = data.research.defs?.[def.requiresResearch]?.name ?? def.requiresResearch;
    return err('RESEARCH_REQUIRED', `${rname} 연구를 끝내야 지을 수 있습니다.`);
  }
  /* ★ §17-15 — 건축가 전용 건물. 저택·노포·화포 같은 대형 구조물은 그 자리(requiresRole)가
     채워져 있어야 착공된다 — 사람이든 동료 봇이든 자리를 지키고 있으면 된다. */
  if (def.requiresRole && !nation.roles?.[def.requiresRole]?.holder) {
    const roleName = data.roles.defs?.[def.requiresRole]?.name ?? def.requiresRole;
    return err('ROLE_REQUIRED', `${roleName}이(가) 자리에 있어야 지을 수 있습니다.`);
  }
  if (def.multi === false && (structuresOf(nation, key).length > 0
    || (nation.construction || []).some((c) => c.building === key && !c.structureId))) {
    return err('ALREADY_BUILT', '정착지에 한 채만 세울 수 있습니다.');
  }

  let spot = null;
  let placed = false;
  if (cmd.x != null && cmd.y != null) {
    // ★ §12-1 — 받은 좌표는 '커서가 가리킨 칸'이다. 앵커(좌상단)로 옮겨 잡는다.
    const a = anchorFromCell(key, Number(cmd.x), Number(cmd.y), data);
    const v = validatePlacement(world, nation, key, a.x, a.y, data);
    if (!v.ok) return err(v.code, v.message);
    spot = a;
    placed = true;
  } else {
    spot = autoSpot(world, nation, key, data);
    if (!spot) return err('NO_SPACE', '영토 안에 지을 자리가 없습니다.');
  }

  const priced = buildingCost(nation, key, 1, data, hooks);
  if (!priced) return err('BAD_TIER', '알 수 없는 티어입니다.');
  const pay = chargeCost(nation, priced, data, hooks, key);
  if (!pay.ok) return pay;

  // 골드 통화 건물(영사관)은 즉시 완공된다
  if (def.currency === 'gold') {
    const s = completeStructure(world, nation, { building: key, tier: 1, x: spot.x, y: spot.y, placed }, data);
    return { ok: true, instant: true, structure: structureView(nation, s, data), cost: priced.cost, gold: priced.gold ?? 0 };
  }

  const site = {
    id: `c${nation.nextSiteId++}`,
    building: key, tier: 1, structureId: null, mode: 'build',
    remaining: priced.buildPoints, total: priced.buildPoints,
    startedTick: world.tick, x: spot.x, y: spot.y, placed,
  };
  (nation.construction ||= []).push(site);
  return {
    ok: true, siteId: site.id, building: key, tier: 1,
    buildPoints: priced.buildPoints, cost: priced.cost, x: spot.x, y: spot.y,
    adjacency: adjacencyDetail(world, nation, key, spot.x, spot.y, data),
  };
}

// ────────────────────────────────────────────────────────────────
// ★ 철거 · 이전 (GDD3 §12-12)
//   두 가지 다 nation.construction 의 '현장'으로 산다 — 스윙으로 밀어붙일 수도 있고,
//   주민 건설 인력이 밀어 주기도 하고, 취소하면 그냥 현장이 사라진다.
//   mode: 'demolish' | 'relocate'   (relocate 는 해체 마디 → 재건 마디 두 번을 산다)
// ────────────────────────────────────────────────────────────────
export const workCfg = (data) => data.balance.structureWork ?? {
  demolishPointsRatio: 0.4, refundRatio: 0.5, relocateTakedownRatio: 0.4, relocateRebuildRatio: 0.6,
};

/** 그 건물에 걸린 현장(공사·개축·철거·이전) */
export function siteFor(nation, structureId) {
  return (nation.construction || []).find((c) => c.structureId === structureId) ?? null;
}

/** 이전·철거 중이라 효과가 멎었는가 */
export const isInactive = (s) => Boolean(s.inactive);

function totalBuildPoints(nation, key, tier, data, hooks) {
  const priced = buildingCost(nation, key, tier, data, hooks);
  return priced?.buildPoints ?? (tierSpec(key, tier, data)?.buildPoints ?? 1);
}

/** 지금까지 들인 자재 합(1티어부터 현재 티어까지) — 철거 회수의 기준 */
export function investedCost(nation, s, data, hooks = {}) {
  const total = {};
  for (let t = 1; t <= s.tier; t += 1) {
    const priced = buildingCost(nation, s.key, t, data, hooks);
    for (const [r, v] of Object.entries(priced?.cost || {})) total[r] = (total[r] || 0) + v;
  }
  return total;
}

/** 철거 착수 (demolishStructure) */
export function startDemolish(world, nation, cmd, data, hooks = {}) {
  const id = cmd.structureId ?? cmd.id ?? cmd.payload?.structureId;
  const s = findStructure(nation, id);
  if (!s) return err('NO_STRUCTURE', '그런 건물이 없습니다.');
  if (isImmovable(s.key, data)) return err('IMMOVABLE', immovableReason(s.key, data, '헐'));
  if (siteFor(nation, s.id)) return err('IN_PROGRESS', '이미 무언가 하고 있는 건물입니다.');
  const cfg = workCfg(data);
  const base = totalBuildPoints(nation, s.key, s.tier, data, hooks);
  const points = Math.max(1, round2(base * cfg.demolishPointsRatio));
  const refund = {};
  for (const [r, v] of Object.entries(investedCost(nation, s, data, hooks))) {
    const back = round2(v * cfg.refundRatio);
    if (back > 0) refund[r] = back;
  }
  const site = {
    id: `c${nation.nextSiteId++}`,
    building: s.key, tier: s.tier, structureId: s.id, mode: 'demolish',
    remaining: points, total: points, refund,
    startedTick: world.tick, x: s.x, y: s.y, placed: Boolean(s.placed),
  };
  (nation.construction ||= []).push(site);
  s.inactive = true;
  return { ok: true, siteId: site.id, structureId: s.id, mode: 'demolish', buildPoints: points, refund };
}

/** 이전 착수 (relocateStructure {structureId, x, y}) */
export function startRelocate(world, nation, cmd, data, hooks = {}) {
  const id = cmd.structureId ?? cmd.id ?? cmd.payload?.structureId;
  const s = findStructure(nation, id);
  if (!s) return err('NO_STRUCTURE', '그런 건물이 없습니다.');
  if (isImmovable(s.key, data)) return err('IMMOVABLE', immovableReason(s.key, data, '옮길'));
  if (siteFor(nation, s.id)) return err('IN_PROGRESS', '이미 무언가 하고 있는 건물입니다.');
  if (cmd.x == null || cmd.y == null) return err('BAD_POSITION', '옮길 자리를 골라야 합니다.');
  const a = anchorFromCell(s.key, Number(cmd.x), Number(cmd.y), data);
  if (a.x === s.x && a.y === s.y) return err('BAD_POSITION', '지금 서 있는 자리입니다.');
  const v = validatePlacement(world, nation, s.key, a.x, a.y, data, { ignoreId: s.id });
  if (!v.ok) return err(v.code, v.message);

  const cfg = workCfg(data);
  const base = totalBuildPoints(nation, s.key, s.tier, data, hooks);
  const take = Math.max(1, round2(base * cfg.relocateTakedownRatio));
  const build = Math.max(1, round2(base * cfg.relocateRebuildRatio));
  const site = {
    id: `c${nation.nextSiteId++}`,
    building: s.key, tier: s.tier, structureId: s.id, mode: 'relocate',
    phase: 'takedown',
    remaining: take, total: take,
    takedownPoints: take, rebuildPoints: build,
    toX: a.x, toY: a.y,
    startedTick: world.tick, x: s.x, y: s.y, placed: true,
  };
  (nation.construction ||= []).push(site);
  s.inactive = true;
  return {
    ok: true, siteId: site.id, structureId: s.id, mode: 'relocate',
    buildPoints: round2(take + build), takedown: take, rebuild: build, x: a.x, y: a.y,
  };
}

/** 철거·이전 취소 (cancelStructureWork) — 낸 일은 사라지지만 건물은 그대로 남는다 */
export function cancelStructureWork(world, nation, cmd, data) {
  const id = cmd.structureId ?? cmd.siteId ?? cmd.id ?? cmd.payload?.structureId;
  const list = nation.construction || [];
  const idx = list.findIndex((c) => (c.structureId === id || c.id === id)
    && (c.mode === 'demolish' || c.mode === 'relocate'));
  if (idx < 0) return err('NO_SITE', '되돌릴 일이 없습니다.');
  const site = list[idx];
  if (site.mode === 'relocate' && site.phase === 'rebuild') {
    return err('TOO_LATE', '이미 헐어 버렸습니다 — 되돌릴 수 없습니다.');
  }
  list.splice(idx, 1);
  const s = findStructure(nation, site.structureId);
  if (s) s.inactive = false;
  return { ok: true, structureId: site.structureId, mode: site.mode };
}

/**
 * 현장 하나가 다 됐다 — 그 결과를 낸다.
 * 신축·개축은 completeStructure 가, 철거·이전은 여기가 맡는다.
 * @returns {{kind:'built'|'demolished'|'relocated'|'takedown', structure?, refund?}|null}
 */
export function finishSite(world, nation, site, data) {
  if (site.mode === 'demolish') {
    const list = nation.structures || [];
    const i = list.findIndex((s) => s.id === site.structureId);
    const s = i >= 0 ? list[i] : null;
    if (i >= 0) list.splice(i, 1);
    for (const [r, v] of Object.entries(site.refund || {})) {
      nation.resources[r] = round2((nation.resources[r] || 0) + v);
    }
    return { kind: 'demolished', structureId: site.structureId, key: site.building,
      name: structureName(site.building, site.tier, data), refund: { ...(site.refund || {}) },
      x: site.x, y: site.y, structure: s ? null : null };
  }
  if (site.mode === 'relocate') {
    const s = findStructure(nation, site.structureId);
    if (!s) return null;
    if (site.phase === 'takedown') {
      // 해체가 끝났다 — 이제 새 자리에서 다시 세운다
      site.phase = 'rebuild';
      site.remaining = site.rebuildPoints;
      site.total = site.rebuildPoints;
      site.x = site.toX;
      site.y = site.toY;
      s.x = site.toX;
      s.y = site.toY;
      return { kind: 'takedown', structureId: s.id, key: s.key, x: site.toX, y: site.toY };
    }
    s.x = site.toX;
    s.y = site.toY;
    s.placed = true;
    s.inactive = false;
    s.adjacency = adjacencyBonus(world, nation, s.key, s.x, s.y, data, { placed: true });
    return { kind: 'relocated', structureId: s.id, key: s.key,
      name: structureName(s.key, s.tier, data), x: s.x, y: s.y, structure: structureView(nation, s, data) };
  }
  return null;
}

/**
 * ★ 개별 건물 업그레이드 (upgradeStructure {structureId}) — GDD3 §7.
 *   건물을 클릭해 그 한 채만 다음 티어로 올린다. 자재를 내고 건설 대기열에 들어간다.
 */
export function startUpgrade(world, nation, cmd, data, hooks = {}) {
  const id = cmd.structureId ?? cmd.id ?? cmd.payload?.structureId;
  const s = findStructure(nation, id);
  if (!s) return err('NO_STRUCTURE', '그런 건물이 없습니다.');
  const def = structureDef(s.key, data);
  const next = s.tier + 1;
  // ★ §12-2 — 본부는 손으로 개축하지 않는다. [승격]이 함께 키운다.
  if (def.autoTier) return err('AUTO_TIER', '본부는 정착지가 승격할 때 함께 자랍니다.');
  if (next > maxTier(s.key, data)) return err('MAX_TIER', '더 올릴 수 없습니다.');
  if ((nation.construction || []).some((c) => c.structureId === s.id)) {
    return err('IN_PROGRESS', '이미 공사 중입니다.');
  }
  if (def.requiresArchitectAboveTier != null && next > def.requiresArchitectAboveTier && !nation.roles?.build?.holder) {
    return err('NEED_ARCHITECT', '건축가가 없으면 상위 티어가 잠깁니다.');
  }
  const priced = buildingCost(nation, s.key, next, data, hooks);
  if (!priced) return err('BAD_TIER', '알 수 없는 티어입니다.');
  const pay = chargeCost(nation, priced, data, hooks, s.key);
  if (!pay.ok) return pay;

  if (def.currency === 'gold') {
    s.tier = next;
    applyStructureHp(s, data);
    return { ok: true, instant: true, structure: structureView(nation, s, data), gold: priced.gold ?? 0 };
  }
  const site = {
    id: `c${nation.nextSiteId++}`,
    building: s.key, tier: next, structureId: s.id,
    remaining: priced.buildPoints, total: priced.buildPoints,
    startedTick: world.tick, x: s.x, y: s.y, placed: Boolean(s.placed),
  };
  (nation.construction ||= []).push(site);
  s.upgrading = true;
  return {
    ok: true, siteId: site.id, structureId: s.id, building: s.key, tier: next,
    buildPoints: priced.buildPoints, cost: priced.cost,
  };
}

/** 수리 (repairStructure {structureId}) — 잃은 내구도 비율만큼 자재를 낸다 */
export function repairStructure(world, nation, cmd, data, hooks = {}) {
  const id = cmd.structureId ?? cmd.id ?? cmd.payload?.structureId;
  const s = findStructure(nation, id);
  if (!s) return err('NO_STRUCTURE', '그런 건물이 없습니다.');
  applyStructureHp(s, data, { keepRatio: true });
  const missing = Math.max(0, (s.maxHp || 0) - (s.hp || 0));
  if (missing <= 0.01) return err('NOT_DAMAGED', '멀쩡합니다.');
  const ratio = missing / (s.maxHp || 1);
  const priced = buildingCost(nation, s.key, s.tier, data, hooks);
  if (!priced) return err('BAD_TIER', '알 수 없는 티어입니다.');
  const cost = {};
  for (const [r, v] of Object.entries(priced.cost)) {
    const need = round2(v * ratio * (data.world.fences.repairCostRatio ?? 0.35) * 2);
    if (need > 0) cost[r] = need;
  }
  for (const [r, v] of Object.entries(cost)) {
    if ((nation.resources[r] || 0) < v) return err('NO_RESOURCE', `${data.resources.meta[r]?.name ?? r}이(가) 부족합니다.`);
  }
  for (const [r, v] of Object.entries(cost)) nation.resources[r] -= v;
  s.hp = s.maxHp;
  return { ok: true, structureId: s.id, cost, structure: structureView(nation, s, data) };
}

function chargeCost(nation, priced, data, hooks, key) {
  const free = (hooks.freeUpgrades?.[key] || 0) > 0;
  if (free) {
    nation.artifactState.freeUpgrades[key] -= 1;
    return { ok: true, free: true };
  }
  const gold = priced.gold ?? 0;
  for (const [r, v] of Object.entries(priced.cost)) {
    if ((nation.resources[r] || 0) < v) return err('NO_RESOURCE', `${data.resources.meta[r]?.name ?? r}이(가) 부족합니다.`);
  }
  if (gold > 0 && nation.gold < gold) return err('NO_GOLD', '골드가 부족합니다.');
  for (const [r, v] of Object.entries(priced.cost)) nation.resources[r] -= v;
  if (gold > 0) { nation.gold -= gold; nation.stats.goldSpent += gold; }
  if (hooks.costDiscounts?.[key]) delete nation.artifactState.costDiscounts[key];
  // ★ §20-R1 — 계열 할인(여문 씨앗 주머니)도 한 번 쓰면 그 자리에서 꺼진다.
  const cat = data.buildings[key]?.category;
  if (cat && hooks.costDiscountCategories?.[cat]) delete nation.artifactState.costDiscountCategories[cat];
  return { ok: true, free: false };
}

function applyStructureHp(s, data, { keepRatio = false } = {}) {
  const spec = tierSpec(s.key, s.tier, data);
  const max = spec?.hp ?? 100;
  const ratio = keepRatio && s.maxHp ? Math.min(1, (s.hp ?? max) / s.maxHp) : 1;
  s.maxHp = max;
  s.hp = keepRatio ? round2(max * ratio) : max;
  return s;
}

/** 건설 완료 → 건물 실체 등록(신축) 또는 티어 갱신(업그레이드) */
export function completeStructure(world, nation, proj, data) {
  const list = (nation.structures ||= []);
  if (proj.structureId) {
    const s = findStructure(nation, proj.structureId);
    if (!s) return null;
    s.tier = proj.tier;
    s.upgrading = false;
    applyStructureHp(s, data);
    s.adjacency = adjacencyBonus(world, nation, s.key, s.x, s.y, data, { placed: Boolean(s.placed) });
    return s;
  }
  const spot = proj.x != null ? { x: proj.x, y: proj.y } : autoSpot(world, nation, proj.building, data);
  if (!spot) return null;
  const s = {
    id: `s${nation.nextStructureId++}`,
    key: proj.building,
    tier: proj.tier,
    x: spot.x, y: spot.y,
    placed: Boolean(proj.placed),
    builtTick: world.tick,
    adjacency: adjacencyBonus(world, nation, proj.building, spot.x, spot.y, data, { placed: Boolean(proj.placed) }),
  };
  applyStructureHp(s, data);
  list.push(s);
  return s;
}

/** 웨이브 전투에서 깎인다. hp 0 이면 폐허 — 수리하면 되살아난다(철거는 없다). */
export function damageStructure(s, amount) {
  s.hp = Math.max(0, (s.hp ?? s.maxHp ?? 0) - amount);
  return s.hp;
}

/** ★ §19-F1(F08-3) — 터렛의 「덤」 한 줄. 없으면 빈 글자라 옛 화살탑 설명이 그대로다. */
export function turretExtra(turret) {
  const out = [];
  const s = turret?.slow;
  const p = turret?.splash;
  if (s) out.push(`걸음 ${Math.round((1 - s.factor) * 100)}% 감속 ${s.seconds}초`);
  if (p) out.push(`둘레 ${p.radius}칸에 ${Math.round(p.ratio * 100)}%`);
  return out.length ? ` · ${out.join(' · ')}` : '';
}

/** ★ §19-F1(F05-3) — 이 건물은 아직 길을 막는가. openRatio 아래로 밀리면 뚫린 것으로 친다. */
export function isBreached(s, openRatio) {
  return (s.hp ?? 0) <= (s.maxHp || 0) * openRatio + 0.001;
}

/** 건물을 감싸는 원의 반지름 — 풋프린트 대각의 절반 */
export function structureRadius(key, data) {
  const { w, h } = footprint(key, data);
  return Math.max(w, h) / 2;
}

/**
 * ★ §19-F1(F05-3) — 적→도읍 선을 막고 선 **가장 앞의 건물**. 울타리(blockingFence)와 같은 규칙이다:
 * 선분에 내린 수선 거리가 그 건물의 몸집 안쪽이면 「길목」이고, 그중 t(진행률)가 가장 작은 것을 고른다.
 * 「왜」 A* 를 새로 돌리지 않는가 — 적 서른이 서브틱마다 격자를 다시 푸는 값은 전투 한 판을 무겁게 한다.
 * 길목 판정은 **선분 하나**로 끝나고(O(건물 수)), 부술지 돌아갈지는 battle.js 가 체력으로 저울질한다.
 */
export function blockingStructure(nation, from, core, data, cfg) {
  const vx = core.x - from.x;
  const vy = core.y - from.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.0001) return null;
  let best = null;
  let bestT = Infinity;
  for (const s of nation.structures || []) {
    const t = blockT(s, from, core, data, cfg, vx, vy, len2);
    if (t == null || t >= bestT) continue;
    bestT = t; best = s;
  }
  return best;
}

/** 길목 판정 한 채 — 막고 서 있으면 진행률 t, 아니면 null */
function blockT(s, from, core, data, cfg, vx, vy, len2) {
  /* 본부는 「길목」이 아니라 목적지다 — 도읍에 닿은 뒤의 약탈 처리(4-c)가 맡는다 */
  if (isRuined(s) || s.inactive || isHq(s.key, data)) return null;
  if (isBreached(s, cfg.openHpRatio)) return null;
  const c = centerOf(s.key, s.x, s.y, data);
  const t = ((c.x - from.x) * vx + (c.y - from.y) * vy) / len2;
  if (t < -0.02 || t > 1.02) return null;
  const perp = Math.hypot(c.x - (from.x + vx * t), c.y - (from.y + vy * t));
  return perp <= structureRadius(s.key, data) + cfg.corridorTiles ? t : null;
}

// ────────────────────────────────────────────────────────────────
// 개간 — 값싼 목재로 영토 안 풀밭에 밭 노드를 만든다
// ────────────────────────────────────────────────────────────────
export function validateReclaim(world, nation, x, y, data) {
  const cfg = data.world.reclaim;
  const size = data.world.size;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size || y >= size) {
    return { ok: false, code: 'BAD_POSITION', message: '지도 밖입니다.' };
  }
  const town = townOf(world, nation.id);
  if (!town) return { ok: false, code: 'NO_TOWN', message: '정착지가 없습니다.' };
  if (dist(town.x, town.y, x, y) > territoryRadius(nation, data) + 0.001) {
    return { ok: false, code: 'OUT_OF_TERRITORY', message: '아직 우리 땅이 아닙니다.' };
  }
  if (!cfg.terrain.includes(terrainNameAt(world.map, x, y, data))) {
    return { ok: false, code: 'BAD_TERRAIN', message: '갈아엎을 수 있는 땅이 아닙니다.' };
  }
  for (const n of world.map?.nodes || []) {
    if (cheb(n.x, n.y, x, y) < cfg.minSpacing) return { ok: false, code: 'TOO_CLOSE', message: '이미 무언가 나는 자리입니다.' };
  }
  for (const s of nation.structures || []) {
    // ★ §12-1 — 건물이 차지한 사각형 전체에서 떨어져야 한다
    if (rectGap(rectOf(s, data), cellRect(x, y)) < cfg.minSpacing) {
      return { ok: false, code: 'TOO_CLOSE', message: '건물과 너무 가깝습니다.' };
    }
  }
  const fields = (world.map?.nodes || []).filter((n) => n.type === 'field').length;
  if (fields >= cfg.maxFields) return { ok: false, code: 'MAX_FIELDS', message: '더 일굴 밭이 없습니다.' };
  for (const [r, v] of Object.entries(cfg.cost)) {
    if ((nation.resources?.[r] || 0) < v) return { ok: false, code: 'NO_RESOURCE', message: `${data.resources.meta[r].name}이(가) 부족합니다.` };
  }
  return { ok: true };
}

export function reclaimField(world, nation, x, y, data) {
  const v = validateReclaim(world, nation, x, y, data);
  if (!v.ok) return { ok: false, error: { code: v.code, message: v.message } };
  const cfg = data.world.reclaim;
  for (const [r, amount] of Object.entries(cfg.cost)) nation.resources[r] -= amount;
  const node = addNode(world, 'field', x, y, data, { tick: world.tick });
  node.readyAt = world.tick + data.balance.harvest.readyEveryTicks;
  return { ok: true, node: { id: node.id, type: node.type, x: node.x, y: node.y, readyAt: node.readyAt }, cost: { ...cfg.cost } };
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
export function structureView(nation, s, data, { architect = false } = {}) {
  const def = structureDef(s.key, data);
  const spec = tierSpec(s.key, s.tier, data);
  const auto = Boolean(def?.autoTier);
  const next = (!auto && s.tier + 1 <= maxTier(s.key, data)) ? tierSpec(s.key, s.tier + 1, data) : null;
  const fp = footprint(s.key, data);
  const c = centerOf(s.key, s.x, s.y, data);
  const site = siteFor(nation, s.id);
  return {
    id: s.id,
    key: s.key,
    name: structureName(s.key, s.tier, data),
    category: def?.category ?? null,
    tier: s.tier,
    maxTier: maxTier(s.key, data),
    x: s.x, y: s.y,
    // ★ §12-1 — 클라가 그림 크기·클릭 판정에 쓰는 풋프린트. (x,y)는 좌상단, (cx,cy)는 중심.
    fw: fp.w, fh: fp.h, cx: round2(c.x), cy: round2(c.y),
    // ★ §12-2 — 본부는 정착지 티어를 그대로 입는다(외형 진화). 이전·철거 불가.
    hq: Boolean(def?.hq),
    immovable: isImmovable(s.key, data),
    autoTier: auto,
    // ★ §12-12 — 지금 이 건물에 걸린 일 (없으면 null)
    work: site && (site.mode === 'demolish' || site.mode === 'relocate') ? {
      mode: site.mode,
      phase: site.phase ?? null,
      remaining: round2(site.remaining),
      total: round2(site.total),
      progress: round3(1 - site.remaining / Math.max(1, site.total)),
      refund: site.refund ? { ...site.refund } : null,
      toX: site.toX ?? null, toY: site.toY ?? null,
      cancelable: !(site.mode === 'relocate' && site.phase === 'rebuild'),
    } : null,
    inactive: Boolean(s.inactive),
    hp: round2(s.hp ?? 0),
    maxHp: s.maxHp ?? 0,
    condition: s.maxHp ? round3((s.hp ?? 0) / s.maxHp) : 1,
    ruined: isRuined(s),
    upgrading: Boolean(s.upgrading),
    residents: spec?.residents ?? 0,
    // ★ §15-A-4 — 눌렀을 때 그리는 사거리 원. 지금 이 티어의 값이다.
    turret: spec?.turret ? { dps: round2(spec.turret.dps * damageScale(s)), range: spec.turret.range } : null,
    effects: effectSummary(s.key, s.tier, data),
    nextTier: next ? { tier: s.tier + 1, name: structureName(s.key, s.tier + 1, data), cost: { ...(next.cost || {}) }, gold: next.gold ?? 0, buildPoints: next.buildPoints ?? 0, effects: effectSummary(s.key, s.tier + 1, data) } : null,
    adjacency: architect ? round3(s.adjacency || 0) : null,
    // ★ 건물이 품은 '한 번 누르는 동사' — 감정소의 [땅을 감정한다](GDD3 §11-4).
    //   클라의 건물 정보 패널이 이 두 값이 있을 때만 그 단추를 그린다.
    action: def?.action ?? null,
    actionLabel: def?.actionLabel ?? null,
    /* ★ §19-F3(F07-8) — 감정소는 첫 감정을 마친 뒤 [다시 감정한다]로 동사가 바뀐다.
       화면이 언제 갈아 끼울지는 서버가 실어 주는 postAction 유무만 보면 된다. */
    postAction: def?.postAction ?? null,
    postActionLabel: def?.postActionLabel ?? null,
    // ★ §17-9 — 건물 손일(직접 상호작용). 설정 원본을 그대로 실어 패널이 값·설명을 그린다.
    handWork: def?.handWork ? { ...def.handWork } : null,
  };
}

/** 공사 현장 하나의 뷰 — 신축·개축·철거·이전이 같은 그릇을 쓴다 (§12-12) */
export function siteView(nation, c, data) {
  const fp = footprint(c.building, data);
  const center = centerOf(c.building, c.x ?? 0, c.y ?? 0, data);
  const mode = c.mode ?? (c.structureId ? 'upgrade' : 'build');
  const MODE_NAME = { build: '공사', upgrade: '개축', demolish: '철거', relocate: '이전' };
  return {
    id: c.id ?? null,
    building: c.building,
    structureId: c.structureId ?? null,
    name: structureName(c.building, c.tier, data),
    mode,
    modeName: MODE_NAME[mode] ?? '공사',
    phase: c.phase ?? null,
    tier: c.tier,
    x: c.x ?? null, y: c.y ?? null,
    fw: fp.w, fh: fp.h,
    cx: c.x == null ? null : round2(center.x), cy: c.y == null ? null : round2(center.y),
    toX: c.toX ?? null, toY: c.toY ?? null,
    refund: c.refund ? { ...c.refund } : null,
    remaining: round2(c.remaining), total: round2(c.total),
    progress: round3(1 - c.remaining / Math.max(1, c.total)),
    upgrade: Boolean(c.structureId) && mode === 'upgrade',
    cancelable: mode === 'demolish' || (mode === 'relocate' && c.phase !== 'rebuild'),
  };
}

/** 사람이 읽을 수 있는 효과 요약 — 정보 패널이 이걸 그대로 쓴다 */
/** 연구 분야의 이름 — all 은 「모든 갈래」 (★ §19-F4) */
export function labFieldName(field, data) {
  if (field === 'all') return '모든 갈래';
  return data.research?.labs?.fields?.[field]?.name ?? field;
}

export function effectSummary(key, tier, data) {
  const spec = tierSpec(key, tier, data);
  if (!spec) return [];
  const out = [];
  const push = (label, value) => out.push({ label, value });
  if (spec.residents) push('수용 인원', `${spec.residents}명`);
  /* ★ §15-B-2 — 저장 계열의 핵심 수치는 「얼마나 더 쌓이나」다. 곳간이 차면 캐도 안 들어오므로
     이 값이야말로 그 건물을 짓는 까닭인데, 지금껏 어디에도 안 적혔다(storage_crate 는 표가 비었다). */
  if (data.buildings?.[key]?.storageCap > 0) {
    const mult = data.balance?.storage?.capPerTierMultiplier ?? 1.6;
    push('저장 상한', `+${Math.round(data.buildings[key].storageCap * Math.pow(mult, Math.max(0, tier - 1)))}`);
  }
  for (const [r, v] of Object.entries(spec.output || {})) push(`${data.resources.meta[r]?.name ?? r} 산출`, `+${Math.round(v * 100)}%`);
  for (const [r, v] of Object.entries(spec.gatherBonus || {})) push(`${data.resources.meta[r]?.name ?? r} 채집`, `+${Math.round(v * 100)}%`);
  for (const [r, v] of Object.entries(spec.flatOutput || {})) push(`${data.resources.meta[r]?.name ?? r}`, `+${v}/일`);
  /* ★ §19-F4(F09-1) — 연구소의 값어치는 「하루가 얼마나 큰 걸음이 되는가」다 */
  for (const [f, v] of Object.entries(spec.researchSpeed || {})) {
    push(`${labFieldName(f, data)} 연구`, `+${Math.round(v * 100)}%/일`);
  }
  if (spec.researchHasteDiscount) push('연구 가속 값', `−${Math.round(spec.researchHasteDiscount * 100)}%`);
  if (spec.storageMultiplier) push('창고 배수', `×${spec.storageMultiplier}`);
  if (spec.populationCap) push('인구 상한', `${spec.populationCap}`);
  if (spec.turret) push('화력', `${spec.turret.dps} DPS · 사거리 ${spec.turret.range}${turretExtra(spec.turret)}`);
  if (spec.permanentDefense) push('상비 방어', `+${spec.permanentDefense}`);
  if (spec.militiaSlots) push('민병 정원', `+${spec.militiaSlots}`);
  if (spec.militiaBonus) push('민병 강화', `+${Math.round(spec.militiaBonus * 100)}%`);
  if (spec.attractiveness) push('매력도', `+${Math.round(spec.attractiveness * 100)}%`);
  if (spec.moraleBonus) push('사기', `+${Math.round(spec.moraleBonus * 100)}%`);
  if (spec.vision) push('시야', `${spec.vision}`);
  if (spec.warnBonusDays) push('경보', `+${spec.warnBonusDays}일`);
  if (spec.logisticsTier) push('물류 티어', `${spec.logisticsTier}`);
  if (spec.tariffReduction) push('관세', `−${Math.round(spec.tariffReduction * 100)}%p`);
  if (spec.toolDiscount) push('도구 값', `−${Math.round(spec.toolDiscount * 100)}%`);
  if (spec.factoryBonus) push('제련 효율', `+${Math.round(spec.factoryBonus * 100)}%`);
  if (spec.goldPerDay) push('세수', `+${spec.goldPerDay}G/일`);
  if (spec.prestige) push('위신', `+${spec.prestige}`);
  return out;
}

/** /api/config 용 건물 도감 — 카테고리·티어·비용·해금 티어 전부 */
export function publicBuildings(data) {
  const out = { categories: {}, defs: {}, effectRules: structuredClone(data.buildings.effectRules) };
  for (const [key, cat] of Object.entries(data.buildings.categories)) {
    out.categories[key] = { name: cat.name, order: [...cat.order] };
  }
  for (const key of buildingKeys(data)) {
    const def = data.buildings[key];
    out.defs[key] = {
      key,
      name: def.name,
      category: def.category ?? null,
      // ★ §15-B-2 — 「왜 짓는가」 한 줄. 건설 카드와 건물 패널이 같은 문장을 쓴다.
      purpose: def.purpose ?? null,
      desc: def.desc ?? null,
      requiresTier: def.requiresTier ?? 0,
      // ★ §19-F4(F09-2) — 「무슨 연구가 먼저인가」. 고스트·건설 카드가 같은 문구를 쓴다.
      requiresResearch: def.requiresResearch ?? null,
      maxTier: maxTier(key, data),
      multi: def.multi !== false,
      piece: Boolean(def.piece),
      core: Boolean(def.core),
      // ★ §12-1 · §12-2
      footprint: [footprint(key, data).w, footprint(key, data).h],
      /* ★ §19-D(F03-9) — 그림만 키우는 덤 배율. 자리(footprint)는 위 한 줄이 그대로 쥐고 있고,
         이 값은 화면(world.structureRect)만 읽는다 — 서버 판정은 한 번도 보지 않는다. */
      spriteScale: def.spriteScale ?? null,
      hq: Boolean(def.hq),
      autoTier: Boolean(def.autoTier),
      immovable: isImmovable(key, data),
      stages: def.stages ? [...def.stages] : null,
      currency: def.currency ?? null,
      counters: def.counters ?? null,
      workSlots: def.workSlots ?? 0,
      job: def.job ?? null,
      // ★ §17-14 · §17-15 — 클라 고스트가 서버와 같은 판정을 그리기 위한 두 깃발
      allowOutsideTerritory: Boolean(def.allowOutsideTerritory),
      requiresRole: def.requiresRole ?? null,
      tiers: def.tiers.map((t, i) => ({
        tier: i + 1,
        name: t.name ?? def.name,
        cost: { ...(t.cost || {}) },
        gold: t.gold ?? 0,
        buildPoints: t.buildPoints ?? 0,
        hp: t.hp ?? 0,
        // ★ §15-A-4 — 사거리 원의 재료. 고스트 배치 중에도 그려야 하므로 도감에 실린다.
        turret: t.turret ? { dps: t.turret.dps, range: t.turret.range } : null,
        effects: effectSummary(key, i + 1, data),
      })),
    };
  }
  return out;
}
