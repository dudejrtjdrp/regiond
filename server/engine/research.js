// 기술 트리와 철로 — docs/GDD3.md §13-D-5.
//
// 규칙 하나: **시간은 아무것도 열지 않는다**(§11-1). 연구도 마찬가지다 — 저절로 뜨지 않고,
// 본부 [연구] 탭에서 손으로 붙들어야 시작된다. 다만 한 번 붙들면 그때부터는 날이 흘러야 끝난다
// (값은 착수할 때 한 번에 치른다). 한 번에 하나만 붙든다 — 무엇을 먼저 할지가 선택이 되도록.
//
// 잠긴 연구를 목록에서 지우지 않는 까닭: 조건 가시화 원칙(§12-3). 「티어 4 (지금 3)」처럼
// 빨강으로 무엇이 얼마나 모자란지 적어 두는 편이, 아무것도 안 보이는 것보다 낫다.
import { townOf, addNode, ringRadii, terrainNameAt, dist, cheb } from './world.js';
import { settlementTier } from './tiers.js';
import { round2, round3, clamp } from './economy.js';

export const researchCfg = (data) => data.research;
export const railCfg = (data) => data.research.rails;
// ★ §17-13 — 다리·매립. 철로와 같은 배치 문법이되 자리가 정반대다(물 위에만 놓인다).
export const bridgeCfg = (data) => data.research.bridges;
export const fillCfg = (data) => data.research.fill;
export const researchDef = (key, data) => researchCfg(data).defs[key] ?? null;
export const RESEARCH_KEYS = (data) => researchCfg(data).order;

const err = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });

export function ensureResearch(nation) {
  const r = (nation.research ||= { done: {}, active: null });
  r.done ||= {};
  if (r.active === undefined) r.active = null;
  return r;
}

export const researchDone = (nation, key) => Boolean(ensureResearch(nation).done?.[key] != null);

/** 이 연구가 여는 것을 지금 누리고 있는가 (기능 게이트) */
export function researchFeature(nation, feature, data) {
  for (const key of RESEARCH_KEYS(data)) {
    if (!researchDone(nation, key)) continue;
    if ((researchDef(key, data)?.unlocks?.features || []).includes(feature)) return true;
  }
  return false;
}

/** 끝난 연구가 주는 산출 보정 — 지금은 증기기관의 생산 건물 +15% 하나다 */
export function productionBonus(nation, data) {
  let bonus = 0;
  for (const key of RESEARCH_KEYS(data)) {
    if (!researchDone(nation, key)) continue;
    bonus += researchDef(key, data)?.effects?.productionBonus ?? 0;
  }
  return round3(bonus);
}

// ────────────────────────────────────────────────────────────────
// 조건
// ────────────────────────────────────────────────────────────────
/**
 * 이 연구를 지금 붙들 수 있는가 + 못 붙드는 조건 하나하나.
 * ★ §12-3 — 미충족 조건은 have/need 를 그대로 실어 화면이 빨강으로 「3/4」를 그린다.
 */
export function researchStatus(nation, key, data) {
  const def = researchDef(key, data);
  if (!def) return null;
  const r = ensureResearch(nation);
  const tier = settlementTier(nation);
  const reqs = [];
  if (def.requiresTier != null) {
    reqs.push({
      key: 'tier', kind: 'tier', text: '정착지 단계',
      have: tier, need: def.requiresTier, ok: tier >= def.requiresTier, unit: '단', dec: 0,
    });
  }
  for (const pre of def.requires || []) {
    const ok = researchDone(nation, pre);
    reqs.push({
      key: `pre:${pre}`, kind: 'research', text: `${researchDef(pre, data)?.name ?? pre} 완료`,
      have: ok ? 1 : 0, need: 1, ok, unit: '', dec: 0,
    });
  }
  if (def.gold > 0) {
    const have = round2(nation.gold || 0);
    reqs.push({ key: 'gold', kind: 'gold', text: '골드', have, need: def.gold, ok: have >= def.gold, unit: '', dec: 0 });
  }
  for (const [res, need] of Object.entries(def.cost || {})) {
    const have = round2(nation.resources?.[res] || 0);
    reqs.push({
      key: `res:${res}`, kind: 'resource', resource: res, text: data.resources.meta[res]?.name ?? res,
      have, need, ok: have >= need - 0.001, unit: '', dec: 0,
    });
  }
  const done = researchDone(nation, key);
  const active = r.active?.key === key;
  const busy = Boolean(r.active) && !active;
  return {
    key, name: def.name, desc: def.desc, line: def.line ?? null,
    days: def.days, gold: def.gold || 0, cost: { ...(def.cost || {}) },
    requires: [...(def.requires || [])], requiresTier: def.requiresTier ?? null,
    unlocks: structuredClone(def.unlocks || {}),
    effects: structuredClone(def.effects || {}),
    done, doneTick: r.done?.[key] ?? null,
    active,
    remainingDays: active ? round2(r.active.remainingDays) : null,
    progress: active ? round3(1 - r.active.remainingDays / Math.max(0.001, def.days)) : (done ? 1 : 0),
    busy,
    reqs,
    ready: !done && !active && !busy && reqs.every((x) => x.ok),
  };
}

export function researchView(nation, data) {
  const r = ensureResearch(nation);
  const list = RESEARCH_KEYS(data).map((k) => researchStatus(nation, k, data));
  return {
    order: [...RESEARCH_KEYS(data)],
    list,
    active: r.active ? { ...r.active } : null,
    productionBonus: productionBonus(nation, data),
    railsOpen: researchFeature(nation, 'rails', data),
    doneCount: list.filter((x) => x.done).length,
  };
}

// ────────────────────────────────────────────────────────────────
// 착수 · 진행 · 완료
// ────────────────────────────────────────────────────────────────
/** startResearch {key} — 값을 한 번에 치르고 날을 세기 시작한다 */
export function startResearch(world, nation, cmd, data) {
  const key = String(cmd.key ?? cmd.payload?.key ?? '');
  const def = researchDef(key, data);
  if (!def) return err('BAD_RESEARCH', '그런 연구가 없습니다.');
  const st = researchStatus(nation, key, data);
  if (st.done) return err('ALREADY_DONE', '이미 끝낸 연구입니다.');
  const r = ensureResearch(nation);
  if (r.active) return err('BUSY', `${researchDef(r.active.key, data)?.name ?? r.active.key}을(를) 먼저 끝내야 합니다.`);
  const bad = st.reqs.find((x) => !x.ok);
  if (bad) {
    return err('NOT_READY', `아직 모자랍니다 — ${bad.text} ${round2(bad.have)}/${round2(bad.need)}`, {
      requirement: bad.key, have: bad.have, need: bad.need,
    });
  }
  if (def.gold > 0) {
    nation.gold = round2(nation.gold - def.gold);
    nation.stats.goldSpent = round2((nation.stats.goldSpent || 0) + def.gold);
  }
  for (const [res, need] of Object.entries(def.cost || {})) {
    nation.resources[res] = round2((nation.resources[res] || 0) - need);
  }
  r.active = { key, remainingDays: def.days, startedTick: world.tick, totalDays: def.days };
  return { ok: true, research: researchStatus(nation, key, data), paid: { gold: def.gold || 0, cost: { ...(def.cost || {}) } } };
}

/**
 * 하루치 진행 — 일 틱이 부른다. 다 되면 완료 처리하고 그 자리에서 여는 것들을 연다.
 * @returns {Array} 이번에 일어난 일들(연구 완료 이벤트)
 */
export function stepResearch(world, nation, data, rng) {
  const r = ensureResearch(nation);
  if (!r.active) return [];
  r.active.remainingDays = round2(r.active.remainingDays - 1);
  if (r.active.remainingDays > 0) return [];
  const key = r.active.key;
  const def = researchDef(key, data);
  r.done[key] = world.tick;
  r.active = null;
  const spawned = applyUnlock(world, nation, key, data, rng);
  return [{
    kind: 'research_done', nationId: nation.id,
    data: {
      key, name: def?.name ?? key, line: def?.line ?? null, desc: def?.desc ?? null,
      unlocks: structuredClone(def?.unlocks || {}), spawnedNodes: spawned.length,
      nodeIds: spawned.map((n) => n.id), nodeType: def?.spawn?.node ?? null,
    },
  }];
}

/**
 * 연구가 여는 땅 — 석탄·석유 노두를 링1~2 에 심는다.
 * ★ 세계 난수를 쓰지 않는다. 노드를 심는 일로 웨이브 구성·사건·이름이 통째로 밀리면
 *   같은 씨앗의 밸런스가 어긋난다(§13-C 난수 분리와 같은 이유). 제 씨앗을 지어 쓴다.
 */
export function applyUnlock(world, nation, key, data, rng = null) {
  const def = researchDef(key, data);
  const spawn = def?.spawn;
  if (!spawn) return [];
  const town = townOf(world, nation.id);
  if (!town) return [];
  const nodeDef = data.world.nodes.types[spawn.node];
  if (!nodeDef) return [];
  const r = rng ?? localRng(`${world.seed}:${nation.id}:${key}`);
  const { r0, r1 } = ringRadii(nation, data);
  const bands = { 1: [r0, r1], 2: [r1, r1 + (r1 - r0)] };
  const size = data.world.size;
  const taken = new Set((world.map?.nodes || []).map((n) => `${n.x},${n.y}`));
  const out = [];
  const clusters = spawn.clusters ?? 4;
  for (let c = 0; c < clusters; c += 1) {
    const ring = spawn.ring[c % spawn.ring.length];
    const band = bands[ring] ?? bands[1];
    let center = null;
    for (let i = 0; i < 120 && !center; i += 1) {
      const a = r.float(0, Math.PI * 2);
      const rad = r.float(band[0], band[1]);
      const x = Math.round(town.x + Math.cos(a) * rad);
      const y = Math.round(town.y + Math.sin(a) * rad);
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
      if (terrainNameAt(world.map, x, y, data) === 'water') continue;
      center = { x, y };
    }
    if (!center) continue;
    const want = r.int(spawn.size[0], spawn.size[1]);
    let grown = 0;
    for (let i = 0; i < want * 20 && grown < want; i += 1) {
      const a = r.float(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * 3.2;
      const x = Math.round(center.x + Math.cos(a) * rad);
      const y = Math.round(center.y + Math.sin(a) * rad);
      if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
      if (terrainNameAt(world.map, x, y, data) === 'water') continue;
      if (taken.has(`${x},${y}`)) continue;
      if (cheb(town.x, town.y, x, y) <= 2) continue;
      taken.add(`${x},${y}`);
      const node = addNode(world, spawn.node, x, y, data, { rich: r.chance(nodeDef.richChance ?? 0), tick: world.tick });
      // 연구가 연 자리는 지하가 아니다 — 캐낼 수 있어야 연구한 보람이 있다
      node.hidden = false;
      out.push(node);
      grown += 1;
    }
  }
  return out;
}

/** 연구 전용 난수 — 세계 난수를 축내지 않는다 */
function localRng(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  let state = (h >>> 0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (a, b) => a + next() * (b - a),
    int: (a, b) => Math.floor(a + next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// ────────────────────────────────────────────────────────────────
// 철로 — 배치형 조각(칸). 위를 걷는 걸음이 두 배가 된다.
// ────────────────────────────────────────────────────────────────
export const railKey = (x, y) => `${x},${y}`;

export function railSet(nation) {
  if (!nation._railSet || nation._railStamp !== (nation.rails || []).length) {
    nation._railSet = new Set((nation.rails || []).map((t) => railKey(t.x, t.y)));
    nation._railStamp = (nation.rails || []).length;
  }
  return nation._railSet;
}

export const onRail = (nation, x, y) =>
  railSet(nation).has(railKey(Math.round(x), Math.round(y)));

/** 드래그 경로 → 칸 목록(브레젠험). fences.walkLine 과 같은 걸음이되 결과가 칸이다.
    ★ §17-13 — 다리·매립도 같은 걸음을 쓴다: cfg 를 넘기면 그 규격(maxSegmentSpan)으로 잰다. */
export function tilesFromPoints(points, data, cfgIn = null) {
  const cfg = cfgIn ?? railCfg(data);
  const clean = [];
  for (const p of points || []) {
    const x = Math.round(Number(p?.x));
    const y = Math.round(Number(p?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (clean.length && clean[clean.length - 1].x === x && clean[clean.length - 1].y === y) continue;
    clean.push({ x, y });
  }
  if (!clean.length) return [];
  const tiles = [];
  const push = (x, y) => {
    if (tiles.length && tiles[tiles.length - 1].x === x && tiles[tiles.length - 1].y === y) return;
    tiles.push({ x, y });
  };
  push(clean[0].x, clean[0].y);
  for (let i = 0; i < clean.length - 1; i += 1) {
    const a = clean[i];
    const b = clean[i + 1];
    if (dist(a.x, a.y, b.x, b.y) > cfg.maxSegmentSpan) return null;
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - x);
    const dy = Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    let e = dx - dy;
    let guard = 0;
    while ((x !== b.x || y !== b.y) && guard++ < cfg.maxSegmentSpan * 2 + 4) {
      const e2 = 2 * e;
      if (e2 > -dy) { e -= dy; x += sx; }
      if (e2 < dx) { e += dx; y += sy; }
      push(x, y);
    }
  }
  return tiles;
}

/** placeRail {points:[{x,y}...]} — 값은 칸마다 강재. 즉시 깔린다(공사 대기열을 타지 않는다). */
export function placeRail(world, nation, cmd, data) {
  if (!researchFeature(nation, 'rails', data)) return err('NO_RESEARCH', '철로를 아직 모릅니다.');
  const cfg = railCfg(data);
  const points = cmd.points ?? cmd.payload?.points;
  if (!Array.isArray(points) || !points.length) return err('BAD_POINTS', '깔 자리를 찍어야 합니다.');
  if (points.length > cfg.maxPointsPerRequest) return err('TOO_MANY_POINTS', '한 번에 깔 수 있는 길이를 넘었습니다.');
  const tiles = tilesFromPoints(points, data);
  if (tiles === null) return err('SEGMENT_TOO_LONG', '한 획이 너무 깁니다.');
  if (!tiles.length) return err('BAD_POINTS', '깔 자리가 없습니다.');

  const list = (nation.rails ||= []);
  const have = new Set(list.map((t) => railKey(t.x, t.y)));
  const town = townOf(world, nation.id);
  const reach = (data.world.territory.baseRadius ?? 6) + (cfg.requiresTerritoryMargin ?? 30);
  const size = data.world.size;
  const planned = [];
  const skipped = [];
  for (const t of tiles) {
    const k = railKey(t.x, t.y);
    if (have.has(k)) { skipped.push({ ...t, reason: 'EXISTS' }); continue; }
    if (t.x < 0 || t.y < 0 || t.x >= size || t.y >= size) { skipped.push({ ...t, reason: 'BAD_POSITION' }); continue; }
    if ((cfg.blockedTerrain || []).includes(terrainNameAt(world.map, t.x, t.y, data))) {
      skipped.push({ ...t, reason: 'BAD_TERRAIN' }); continue;
    }
    if (town && dist(town.x, town.y, t.x, t.y) > reach) { skipped.push({ ...t, reason: 'TOO_FAR' }); continue; }
    have.add(k);
    planned.push(t);
  }
  if (!planned.length) return err('NO_VALID_TILE', '깔 수 있는 자리가 없습니다.');
  if (list.length + planned.length > cfg.maxTiles) return err('RAIL_CAP', '철로를 더 깔 수 없습니다.');

  const cost = {};
  for (const [res, per] of Object.entries(cfg.costPerTile || {})) cost[res] = round2(per * planned.length);
  for (const [res, need] of Object.entries(cost)) {
    if ((nation.resources[res] || 0) < need - 0.001) {
      return err('NO_RESOURCE', `${data.resources.meta[res]?.name ?? res}이(가) 부족합니다. (${Math.ceil(need)} 필요)`);
    }
  }
  for (const [res, need] of Object.entries(cost)) nation.resources[res] = round2(nation.resources[res] - need);

  const created = [];
  for (const t of planned) {
    const piece = { id: `rl${nation.nextRailId++}`, x: t.x, y: t.y, builtTick: world.tick };
    list.push(piece);
    created.push(piece);
  }
  nation._railSet = null;
  return { ok: true, placed: created.length, skipped: skipped.length, cost, tiles: created.map(railView) };
}

/** removeRail {tileIds} — 낸 값의 절반을 돌려준다 */
export function removeRail(world, nation, cmd, data) {
  const cfg = railCfg(data);
  const ids = cmd.tileIds ?? cmd.payload?.tileIds ?? (cmd.tileId ? [cmd.tileId] : []);
  const list = (nation.rails ||= []);
  const kept = [];
  const removed = [];
  for (const t of list) (ids.includes(t.id) ? removed : kept).push(t);
  if (!removed.length) return err('NO_RAIL', '그런 조각이 없습니다.');
  nation.rails = kept;
  nation._railSet = null;
  const refund = {};
  for (const [res, per] of Object.entries(cfg.costPerTile || {})) {
    const back = round2(per * removed.length * (cfg.refundRatio ?? 0.5));
    refund[res] = back;
    nation.resources[res] = round2((nation.resources[res] || 0) + back);
  }
  return { ok: true, removed: removed.length, refund };
}

export const railView = (t) => ({ id: t.id, x: t.x, y: t.y });

export function railViews(nation) {
  return (nation.rails || []).map(railView);
}

export function railSummary(nation, data) {
  const cfg = railCfg(data);
  return {
    tiles: (nation.rails || []).length,
    maxTiles: cfg.maxTiles,
    costPerTile: { ...cfg.costPerTile },
    speedMultiplier: cfg.speedMultiplier,
    open: researchFeature(nation, 'rails', data),
  };
}

// ────────────────────────────────────────────────────────────────
// ★ §17-13 — 다리(bridge)·매립(fill): 물 위의 칸 조각.
//
// 철로(placeRail)의 근사 복제이되 딱 하나가 뒤집혀 있다 — 철로는 물이 blockedTerrain 이고,
// 이 둘은 물이 allowedTerrain 이다(물 위에**만** 놓인다). 위를 지나는 문은 사람에게만 열린다:
// avatar.walkable(클라) · companions.walkable(서버)이 onBridge/onFill 을 본다.
// **짐승(ecology.creatureMayStand)과 적(battle)은 다리를 못 쓴다** — 물은 여전히 그들의 벽이다.
// 매립은 한 발 더 간다: structures.validatePlacement · fences.validateSegment 가 메운 물 칸을
// 뭍으로 쳐 준다 — 후반 영토가 물에 막히지 않게 하는 장치다.
// ────────────────────────────────────────────────────────────────
const OVERLAYS = {
  bridge: {
    cfgOf: bridgeCfg, feature: 'bridges', list: 'bridges', nextId: 'nextBridgeId', prefix: 'br',
    memoSet: '_bridgeSet', memoStamp: '_bridgeStamp',
    noResearch: '다리를 아직 모릅니다.', noPiece: '그런 다리 조각이 없습니다.',
    capMsg: '다리를 더 놓을 수 없습니다.',
  },
  fill: {
    cfgOf: fillCfg, feature: 'landfill', list: 'fills', nextId: 'nextFillId', prefix: 'fl',
    memoSet: '_fillSet', memoStamp: '_fillStamp',
    noResearch: '매립을 아직 모릅니다.', noPiece: '그런 매립 칸이 없습니다.',
    capMsg: '더 메울 수 없습니다.',
  },
};

function overlaySet(nation, o) {
  const list = nation[o.list] || [];
  if (!nation[o.memoSet] || nation[o.memoStamp] !== list.length) {
    nation[o.memoSet] = new Set(list.map((t) => railKey(t.x, t.y)));
    nation[o.memoStamp] = list.length;
  }
  return nation[o.memoSet];
}

export const onBridge = (nation, x, y) =>
  overlaySet(nation, OVERLAYS.bridge).has(railKey(Math.round(x), Math.round(y)));
export const onFill = (nation, x, y) =>
  overlaySet(nation, OVERLAYS.fill).has(railKey(Math.round(x), Math.round(y)));

/** placeRail 의 문법 그대로 — 다만 지형 판정이 반대다(allowedTerrain 밖이면 BAD_TERRAIN) */
function placeOverlay(world, nation, cmd, data, o) {
  if (!researchFeature(nation, o.feature, data)) return err('NO_RESEARCH', o.noResearch);
  const cfg = o.cfgOf(data);
  const points = cmd.points ?? cmd.payload?.points;
  if (!Array.isArray(points) || !points.length) return err('BAD_POINTS', '놓을 자리를 찍어야 합니다.');
  if (points.length > cfg.maxPointsPerRequest) return err('TOO_MANY_POINTS', '한 번에 놓을 수 있는 길이를 넘었습니다.');
  const tiles = tilesFromPoints(points, data, cfg);
  if (tiles === null) return err('SEGMENT_TOO_LONG', '한 획이 너무 깁니다.');
  if (!tiles.length) return err('BAD_POINTS', '놓을 자리가 없습니다.');

  const list = (nation[o.list] ||= []);
  const have = new Set(list.map((t) => railKey(t.x, t.y)));
  const town = townOf(world, nation.id);
  const reach = (data.world.territory.baseRadius ?? 6) + (cfg.requiresTerritoryMargin ?? 30);
  const size = data.world.size;
  const planned = [];
  const skipped = [];
  for (const t of tiles) {
    const k = railKey(t.x, t.y);
    if (have.has(k)) { skipped.push({ ...t, reason: 'EXISTS' }); continue; }
    if (t.x < 0 || t.y < 0 || t.x >= size || t.y >= size) { skipped.push({ ...t, reason: 'BAD_POSITION' }); continue; }
    // ★ 철로와 뒤집힌 문 — 물 **위에만** 놓인다
    if (!(cfg.allowedTerrain || []).includes(terrainNameAt(world.map, t.x, t.y, data))) {
      skipped.push({ ...t, reason: 'BAD_TERRAIN' }); continue;
    }
    if (town && dist(town.x, town.y, t.x, t.y) > reach) { skipped.push({ ...t, reason: 'TOO_FAR' }); continue; }
    have.add(k);
    planned.push(t);
  }
  if (!planned.length) return err('NO_VALID_TILE', '놓을 수 있는 자리가 없습니다.');
  if (list.length + planned.length > cfg.maxTiles) return err('OVERLAY_CAP', o.capMsg);

  const cost = {};
  for (const [res, per] of Object.entries(cfg.costPerTile || {})) cost[res] = round2(per * planned.length);
  for (const [res, need] of Object.entries(cost)) {
    if ((nation.resources[res] || 0) < need - 0.001) {
      return err('NO_RESOURCE', `${data.resources.meta[res]?.name ?? res}이(가) 부족합니다. (${Math.ceil(need)} 필요)`);
    }
  }
  for (const [res, need] of Object.entries(cost)) nation.resources[res] = round2(nation.resources[res] - need);

  const created = [];
  for (const t of planned) {
    const piece = { id: `${o.prefix}${nation[o.nextId]++}`, x: t.x, y: t.y, builtTick: world.tick };
    list.push(piece);
    created.push(piece);
  }
  nation[o.memoSet] = null;
  return { ok: true, placed: created.length, skipped: skipped.length, cost, tiles: created.map(railView) };
}

/** removeRail 의 문법 그대로 — 낸 값의 절반을 돌려준다 */
function removeOverlay(world, nation, cmd, data, o) {
  const cfg = o.cfgOf(data);
  const ids = cmd.tileIds ?? cmd.payload?.tileIds ?? (cmd.tileId ? [cmd.tileId] : []);
  const list = (nation[o.list] ||= []);
  const kept = [];
  const removed = [];
  for (const t of list) (ids.includes(t.id) ? removed : kept).push(t);
  if (!removed.length) return err('NO_PIECE', o.noPiece);
  nation[o.list] = kept;
  nation[o.memoSet] = null;
  const refund = {};
  for (const [res, per] of Object.entries(cfg.costPerTile || {})) {
    const back = round2(per * removed.length * (cfg.refundRatio ?? 0.5));
    refund[res] = back;
    nation.resources[res] = round2((nation.resources[res] || 0) + back);
  }
  return { ok: true, removed: removed.length, refund };
}

export const placeBridge = (world, nation, cmd, data) => placeOverlay(world, nation, cmd, data, OVERLAYS.bridge);
export const removeBridge = (world, nation, cmd, data) => removeOverlay(world, nation, cmd, data, OVERLAYS.bridge);
export const placeFill = (world, nation, cmd, data) => placeOverlay(world, nation, cmd, data, OVERLAYS.fill);
export const removeFill = (world, nation, cmd, data) => removeOverlay(world, nation, cmd, data, OVERLAYS.fill);

export const bridgeViews = (nation) => (nation.bridges || []).map(railView);
export const fillViews = (nation) => (nation.fills || []).map(railView);

function overlaySummary(nation, data, o) {
  const cfg = o.cfgOf(data);
  return {
    tiles: (nation[o.list] || []).length,
    maxTiles: cfg.maxTiles,
    costPerTile: { ...cfg.costPerTile },
    open: researchFeature(nation, o.feature, data),
  };
}
export const bridgeSummary = (nation, data) => overlaySummary(nation, data, OVERLAYS.bridge);
export const fillSummary = (nation, data) => overlaySummary(nation, data, OVERLAYS.fill);

/** 공개본 — 규격만. 어디까지 했는지는 state.research 로만 간다. */
export function publicResearch(data) {
  const c = researchCfg(data);
  return {
    order: [...c.order],
    defs: Object.fromEntries(c.order.map((k) => {
      const d = c.defs[k];
      return [k, {
        name: d.name, desc: d.desc, line: d.line ?? null,
        requiresTier: d.requiresTier ?? null, requires: [...(d.requires || [])],
        days: d.days, gold: d.gold || 0, cost: { ...(d.cost || {}) },
        effects: structuredClone(d.effects || {}), unlocks: structuredClone(d.unlocks || {}),
      }];
    })),
    rails: {
      costPerTile: { ...c.rails.costPerTile },
      speedMultiplier: c.rails.speedMultiplier,
      maxTiles: c.rails.maxTiles,
      maxPointsPerRequest: c.rails.maxPointsPerRequest,
      maxSegmentSpan: c.rails.maxSegmentSpan,
      blockedTerrain: [...c.rails.blockedTerrain],
      requiresTerritoryMargin: c.rails.requiresTerritoryMargin,
    },
    // ★ §17-13 — 다리·매립 규격. 클라의 고스트 판정(build.js)이 이 표를 그대로 복제한다.
    bridges: {
      costPerTile: { ...c.bridges.costPerTile },
      maxTiles: c.bridges.maxTiles,
      maxPointsPerRequest: c.bridges.maxPointsPerRequest,
      maxSegmentSpan: c.bridges.maxSegmentSpan,
      allowedTerrain: [...c.bridges.allowedTerrain],
      requiresTerritoryMargin: c.bridges.requiresTerritoryMargin,
    },
    fill: {
      costPerTile: { ...c.fill.costPerTile },
      maxTiles: c.fill.maxTiles,
      maxPointsPerRequest: c.fill.maxPointsPerRequest,
      maxSegmentSpan: c.fill.maxSegmentSpan,
      allowedTerrain: [...c.fill.allowedTerrain],
      requiresTerritoryMargin: c.fill.requiresTerritoryMargin,
    },
  };
}
