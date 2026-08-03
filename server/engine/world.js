// 오픈월드 생성 — docs/WORLD.md §1. 128×128 공유 월드, 시드 재현.
// 이 모듈은 '공간'만 안다. 경제·전투 공식은 건드리지 않는다(WORLD.md §5 무수정 규칙).
import { createRng } from './rng.js';

export const worldCfg = (data) => data.world;
export const terrainCodes = (data) => data.world.terrain.codes;

/** 지형 코드(문자열) ↔ 정수 인덱스. RLE 전송 계약이라 순서를 바꾸면 클라가 깨진다. */
export function terrainIndex(data) {
  return Object.fromEntries(terrainCodes(data).map((c, i) => [c, i]));
}

// ────────────────────────────────────────────────────────────────
// 값노이즈 — coarse grid + bilinear. 시드만 있으면 언제든 같은 지형이 나온다.
// ────────────────────────────────────────────────────────────────
function noiseField(rng, grid) {
  const g = [];
  for (let i = 0; i <= grid; i += 1) {
    const row = [];
    for (let j = 0; j <= grid; j += 1) row.push(rng.next());
    g.push(row);
  }
  return g;
}

const smooth = (t) => t * t * (3 - 2 * t);

function sampleField(field, grid, x, y, size) {
  const fx = (x / size) * grid;
  const fy = (y / size) * grid;
  const x0 = Math.min(grid - 1, Math.floor(fx));
  const y0 = Math.min(grid - 1, Math.floor(fy));
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const a = field[y0][x0] * (1 - tx) + field[y0][x0 + 1] * tx;
  const b = field[y0 + 1][x0] * (1 - tx) + field[y0 + 1][x0 + 1] * tx;
  return a * (1 - ty) + b * ty;
}

function octaveSample(fields, grids, x, y, size) {
  let v = 0;
  let amp = 1;
  let total = 0;
  for (let i = 0; i < fields.length; i += 1) {
    v += sampleField(fields[i], grids[i], x, y, size) * amp;
    total += amp;
    amp *= 0.5;
  }
  return v / total;
}

/** 지형 생성 → 길이 size² 의 문자열(코드 인덱스를 문자로 저장 — 스냅샷·구조복제가 싸다) */
export function generateTerrain(rng, data) {
  const cfg = worldCfg(data);
  const t = cfg.terrain;
  const size = cfg.size;
  const idx = terrainIndex(data);
  const grids = [];
  const elevFields = [];
  const moistFields = [];
  for (let o = 0; o < t.octaves; o += 1) {
    const g = t.noiseGrid * Math.pow(2, o);
    grids.push(g);
    elevFields.push(noiseField(rng, g));
  }
  for (let o = 0; o < t.octaves; o += 1) moistFields.push(noiseField(rng, grids[o]));

  const out = new Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const elev = octaveSample(elevFields, grids, x, y, size);
      const moist = octaveSample(moistFields, grids, x, y, size);
      let code = 'grass';
      if (elev < t.seaLevel) code = 'water';
      else if (elev > t.rockLevel) code = 'rock';
      else if (moist > t.forestMoisture) code = 'forest';
      else if (moist >= t.fertileMoisture[0] && moist <= t.fertileMoisture[1]
        && elev >= t.fertileElevation[0] && elev <= t.fertileElevation[1]) code = 'fertile';
      out[y * size + x] = String.fromCharCode(48 + idx[code]);
    }
  }
  return out.join('');
}

export function terrainAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return null;
  return map.terrain.charCodeAt(y * map.size + x) - 48;
}

export function terrainNameAt(map, x, y, data) {
  const i = terrainAt(map, x, y);
  return i == null ? null : terrainCodes(data)[i];
}

export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ────────────────────────────────────────────────────────────────
// 도읍
// ────────────────────────────────────────────────────────────────
function landSpotNear(map, cx, cy, data, maxR = 24) {
  const walkable = new Set(worldCfg(data).terrain.walkable.map((c) => terrainIndex(data)[c]));
  for (let r = 0; r <= maxR; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 4 || y < 4 || x >= map.size - 4 || y >= map.size - 4) continue;
        if (walkable.has(terrainAt(map, x, y))) return { x, y };
      }
    }
  }
  return { x: cx, y: cy };
}

export function generateTowns(map, rng, data, nationDefs) {
  const cfg = worldCfg(data);
  const t = cfg.towns;
  const size = cfg.size;
  const center = Math.floor(size / 2);
  const towns = [];
  const jitter = () => rng.int(-t.jitter, t.jitter);

  const px = center + t.playerOffset[0] + jitter();
  const py = center + t.playerOffset[1] + jitter();
  const p = landSpotNear(map, px, py, data);
  towns.push({ nationId: 'player', x: p.x, y: p.y, preset: presetFor(p, t), isPlayer: true });

  const radius = size * t.aiDistanceRatio;
  for (const def of nationDefs) {
    const angle = ((t.aiAngles[def.id] ?? 0) * Math.PI) / 180;
    const ax = Math.round(center + Math.cos(angle) * radius) + jitter();
    const ay = Math.round(center + Math.sin(angle) * radius) + jitter();
    const a = landSpotNear(map, ax, ay, data);
    towns.push({ nationId: def.id, x: a.x, y: a.y, preset: presetFor(a, t), isPlayer: false });
  }
  return towns;
}

function presetFor(pos, t) {
  return t.presetLayout.map((b) => ({ key: b.key, x: pos.x + b.dx, y: pos.y + b.dy }));
}

// ────────────────────────────────────────────────────────────────
// 자원 노드
// ────────────────────────────────────────────────────────────────
function makeNode(id, type, x, y, def, rng) {
  const rich = def.richChance > 0 ? rng.chance(def.richChance) : false;
  return {
    id,
    type,
    x,
    y,
    rich,
    richness: rich ? (def.richMultiplier ?? 2) : 1,
    amount: (def.amount ?? 0) * (rich ? (def.richMultiplier ?? 2) : 1),
    max: (def.amount ?? 0) * (rich ? (def.richMultiplier ?? 2) : 1),
    depleted: false,
    hidden: Boolean(def.subsurface),   // 감정의 날(티어 3)에 드러난다
    workers: 0,
    // ★ 밭 계열(harvest)은 처음부터 여물어 있다 — 마차에서 내린 첫날 바로 거둘 것이 있어야 한다(GDD3 §2)
    readyAt: def.harvest ? 0 : null,
    swings: 0,
    stamp: 0,
  };
}

/**
 * 노드 배치 — 지형 조건 + 같은 종류끼리 최소 거리(체비셰프) + 태그국 인근 제한.
 * ★ 유막은 유전 태그국 인근에만, 철광맥은 철광맥 태그국 인근에만 생긴다 (WORLD.md §1 태그 정합).
 */
export function generateNodes(map, towns, rng, data, nationTags) {
  const cfg = worldCfg(data);
  const size = cfg.size;
  const tIndex = terrainIndex(data);
  const nodes = [];
  const byType = {};
  let nextId = 1;

  const taggedTowns = (tags) => towns.filter((tw) => (nationTags[tw.nationId] || []).some((g) => tags.includes(g)));

  for (const type of cfg.nodes.order) {
    const def = cfg.nodes.types[type];
    if (!def || !(def.count > 0)) continue;
    byType[type] = [];
    const wantTerrain = def.terrain != null ? tIndex[def.terrain] : null;
    const anchors = def.nearTags ? taggedTowns(def.nearTags) : null;
    if (anchors && anchors.length === 0) continue;      // 태그 보유국이 없으면 아예 안 난다
    let tries = 0;
    const maxTries = def.count * 240;
    while (byType[type].length < def.count && tries < maxTries) {
      tries += 1;
      let x;
      let y;
      if (anchors) {
        const anchor = rng.pick(anchors);
        const r = rng.float(3, def.nearTownRadius ?? 24);
        const a = rng.float(0, Math.PI * 2);
        x = Math.round(anchor.x + Math.cos(a) * r);
        y = Math.round(anchor.y + Math.sin(a) * r);
      } else {
        x = rng.int(1, size - 2);
        y = rng.int(1, size - 2);
      }
      if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
      if (wantTerrain != null && terrainAt(map, x, y) !== wantTerrain) continue;
      if (def.terrain == null && terrainAt(map, x, y) === tIndex.water) continue;
      if (tooClose(byType[type], x, y, def.minSpacing)) continue;
      if (towns.some((tw) => cheb(tw.x, tw.y, x, y) <= 1)) continue;
      const node = makeNode(`n${nextId}`, type, x, y, def, rng);
      nextId += 1;
      byType[type].push(node);
      nodes.push(node);
    }
  }

  // 도읍 주변 시작 자원 보장 — 부족하면 초기 영토 안 빈 자리에 끼워 넣는다
  const guard = cfg.nodes.startGuarantee;
  const guardRadius = Math.floor(cfg.territory.baseRadius * guard.radiusRatio);
  for (const town of towns) {
    for (const [type, need] of Object.entries(guard.counts)) {
      const def = cfg.nodes.types[type];
      if (!def) continue;
      if (def.nearTags && !(nationTags[town.nationId] || []).some((g) => def.nearTags.includes(g))) continue;
      const have = () => (byType[type] || []).filter((n) => dist(n.x, n.y, town.x, town.y) <= guardRadius).length;
      let attempts = 0;
      while (have() < need && attempts < 900) {
        attempts += 1;
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(2.5, guardRadius);
        const x = Math.round(town.x + Math.cos(a) * r);
        const y = Math.round(town.y + Math.sin(a) * r);
        if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
        if (cheb(town.x, town.y, x, y) <= 1) continue;
        if (terrainAt(map, x, y) === tIndex.water && type !== 'water') continue;
        if (type === 'water' && terrainAt(map, x, y) !== tIndex.water) continue;
        if (nodes.some((n) => n.x === x && n.y === y)) continue;
        if (tooClose(byType[type] || [], x, y, def.minSpacing)) continue;
        const node = makeNode(`n${nextId}`, type, x, y, def, rng);
        nextId += 1;
        (byType[type] ||= []).push(node);
        nodes.push(node);
      }
    }
  }

  return { nodes, nextNodeId: nextId };
}

function tooClose(list, x, y, spacing) {
  if (!(spacing > 0)) return false;
  for (const n of list) if (cheb(n.x, n.y, x, y) < spacing) return true;
  return false;
}

// ────────────────────────────────────────────────────────────────
// 월드 조립
// ────────────────────────────────────────────────────────────────
/**
 * 공유 월드 생성. 같은 (seed, data) 는 언제나 같은 월드를 만든다 — 재현성 테스트의 계약이다.
 * @param {number} seed
 * @param {object} data loadGameData()
 * @param {object} opts {playerTags:[..]}  플레이어 태그는 감정의 날 전이라도 '지하 자원 배치'에는 쓰인다
 */
export function generateWorldMap(seed, data, opts = {}) {
  const cfg = worldCfg(data);
  const rng = createRng((seed >>> 0) ^ 0x9e3779b9);
  const size = cfg.size;
  const terrain = generateTerrain(rng, data);
  const map = { size, seed, terrain };
  const nationDefs = data.aiNations.nations;
  const towns = generateTowns(map, rng, data, nationDefs);
  const nationTags = { player: opts.playerTags ?? [] };
  for (const def of nationDefs) nationTags[def.id] = def.tags || [];
  const { nodes, nextNodeId } = generateNodes(map, towns, rng, data, nationTags);
  map.towns = towns;
  map.nodes = nodes;
  map.nextNodeId = nextNodeId;
  map.caravans = buildCaravans(towns, cfg);
  return map;
}

function buildCaravans(towns, cfg) {
  if (!cfg.towns.caravan?.enabled) return [];
  const player = towns.find((t) => t.isPlayer);
  if (!player) return [];
  return towns.filter((t) => !t.isPlayer).map((t, i) => ({
    id: `cv${i}`, from: { x: player.x, y: player.y }, to: { x: t.x, y: t.y },
    nationId: t.nationId, speed: cfg.towns.caravan.speedTilesPerTick,
  }));
}

// ────────────────────────────────────────────────────────────────
// 조회 도우미
// ────────────────────────────────────────────────────────────────
export function townOf(world, nationId) {
  return (world.map?.towns || []).find((t) => t.nationId === nationId) ?? null;
}

export function nodeById(world, id) {
  return (world.map?.nodes || []).find((n) => n.id === id) ?? null;
}

/**
 * 영토 반경.
 * ★ GDD3 §1 — 반경의 정본은 **정착지 티어**다(개척령 폐지). 저장된 territory.radius 는 거울일 뿐이고,
 *   티어가 있으면 언제나 티어 표에서 다시 계산한다 — 둘이 어긋나 생기는 버그를 원천 차단한다.
 *   (tiers.js 를 임포트하면 순환이 되므로 표를 여기서 직접 읽는다)
 */
export function territoryRadius(nation, data) {
  const tier = nation?.tier;
  const levels = data?.tiers?.levels;
  if (tier != null && Array.isArray(levels)) {
    const found = levels.find((l) => l.tier === tier);
    if (found) return found.radius;
    const last = levels[levels.length - 1];
    if (tier > last.tier) return last.radius + (data.tiers.endless?.radiusPerTier ?? 4) * (tier - last.tier);
    return levels[0].radius;
  }
  return nation?.territory?.radius ?? data.world.territory.baseRadius;
}

export function inTerritory(world, nation, x, y, data) {
  const town = townOf(world, nation.id);
  if (!town) return false;
  return dist(town.x, town.y, x, y) <= territoryRadius(nation, data) + 0.001;
}

/** 자국 영토 안의 노드 목록 (숨은 지하 자원은 hidden 이면 제외) */
export function territoryNodes(world, nation, data, { includeHidden = false } = {}) {
  const town = townOf(world, nation.id);
  if (!town) return [];
  const r = territoryRadius(nation, data);
  return (world.map?.nodes || []).filter((n) => {
    if (n.hidden && !includeHidden) return false;
    return dist(n.x, n.y, town.x, town.y) <= r + 0.001;
  });
}

/** 새 노드 추가(개간 등) */
export function addNode(world, type, x, y, data, { rich = false, tick = 0 } = {}) {
  const def = data.world.nodes.types[type];
  const id = `n${world.map.nextNodeId++}`;
  const node = {
    id, type, x, y, rich,
    richness: rich ? (def.richMultiplier ?? 2) : 1,
    amount: def.amount ?? 0, max: def.amount ?? 0,
    depleted: false, hidden: false, workers: 0, readyAt: null, stamp: tick,
  };
  world.map.nodes.push(node);
  return node;
}

// ────────────────────────────────────────────────────────────────
// RLE / 청크 인코딩 — PROTOCOL v2 world · worldDiff
// ────────────────────────────────────────────────────────────────
/** [v,count,v,count,...] 평탄 배열. 128×128 지형이 보통 수백 쌍으로 줄어든다. */
export function encodeRle(values) {
  const out = [];
  let prev = null;
  let run = 0;
  for (const v of values) {
    if (v === prev) { run += 1; continue; }
    if (prev !== null) out.push(prev, run);
    prev = v;
    run = 1;
  }
  if (prev !== null) out.push(prev, run);
  return out;
}

export function decodeRle(rle) {
  const out = [];
  for (let i = 0; i < rle.length; i += 2) for (let k = 0; k < rle[i + 1]; k += 1) out.push(rle[i]);
  return out;
}

/** 지형 문자열 → RLE(정수) */
export function encodeTerrain(map) {
  const vals = new Array(map.terrain.length);
  for (let i = 0; i < map.terrain.length; i += 1) vals[i] = map.terrain.charCodeAt(i) - 48;
  return encodeRle(vals);
}
