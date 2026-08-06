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

/**
 * ★ §17-17 바이옴 덧칠 — 옛 다섯 지형을 먼저 정하고 그 위를 위도로 덮는다.
 * 난수를 한 톨도 쓰지 않는다: 같은 씨앗은 언제나 같은 자리에 같은 설산·밀림을 낸다.
 * 지도 한복판(protectRadius)은 손대지 않는다 — 시작 밸런스는 옛 다섯 지형 위에서 검증된 값이다.
 * keepCodes 는 어떤 경우에도 덮이지 않는다(물·바위 노두 — 자료의 주석에 까닭이 있다).
 */
function biomeCode(t, code, x, y, elev, moist, size) {
  const b = t.biomes;
  if (!b || (b.keepCodes || []).includes(code)) return code;
  const c = (size - 1) / 2;
  if (Math.hypot(x - c, y - c) <= (b.protectRadius ?? 0)) return code;
  const lat = y / Math.max(1, size - 1);
  if (lat <= b.snow.latitudeMax && elev >= b.snow.elevationMin) return 'snow';
  if (lat >= b.jungle.latitudeMin && moist >= b.jungle.moistureMin) return 'jungle';
  return code;
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
      out[y * size + x] = String.fromCharCode(48 + idx[biomeCode(t, code, x, y, elev, moist, size)]);
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

/** ★ §17-4 — 이 칸이 물인가. 흩어져 있던 `terrainAt(...) === terrainIndex(data).water` 관용구의 정본. */
export function isWaterAt(map, x, y, data) {
  return terrainAt(map, Math.round(x), Math.round(y)) === terrainIndex(data).water;
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
// 자원 노드 — ★ GDD3 §13-B: 랜덤 산포 폐지, 군락(cluster) 배치
// ────────────────────────────────────────────────────────────────
export const clusterCfg = (data) => data.world.nodes.clusters;
export const regrowCfg = (data) => data.world.nodes.regrow;
export const ruinSizeCfg = (data) => data.world.nodes.ruinSizes;

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
    /* ★ §17-17 — 종류 자체가 숨어 있는 자리(숨은 궤). 유적은 크기표가 은닉을 정하므로 여기 걸리지 않는다.
       concealChance 가 0 이면 난수를 부르지 않는다 — 옛 종류의 월드 난수 소비를 한 톨도 바꾸지 않기 위해서다. */
    concealed: Boolean(def.concealChance > 0 && rng.chance(def.concealChance)),
    workers: 0,
    // ★ 밭 계열(harvest)은 처음부터 여물어 있다 — 마차에서 내린 첫날 바로 거둘 것이 있어야 한다(GDD3 §2)
    readyAt: def.harvest ? 0 : null,
    swings: 0,
    stamp: 0,
    // ★ §13-B-3 — 다 캔 자리는 그루터기로 남고 이 틱에 되살아난다(null = 아직 안 죽었다)
    respawnAt: null,
  };
}

/**
 * 이 노드가 되살아나기까지의 게임일. 없으면 null(= 영영 되살아나지 않는다).
 * 범위 [a,b] 면 그 사이에서 뽑는다 — 숲이 한날한시에 통째로 되살아나지 않게 하는 흔들림이다.
 */
export function regrowDays(type, data, rng = null) {
  const spec = regrowCfg(data)?.byType?.[type];
  if (!Array.isArray(spec) || !spec.length) return null;
  const [a, b] = spec.length > 1 ? spec : [spec[0], spec[0]];
  if (b <= a) return a;
  return rng ? rng.int(a, b) : Math.round((a + b) / 2);
}

/**
 * 노드 하나를 '다 캔 자리'로 만든다. 되살아날 날을 그 자리에서 정해 둔다.
 * ★ 결정론: rng 를 넘기지 않으면 노드 id 와 틱으로 뽑는다 — 실시간 스윙(actions.js)은 월드 rng 를
 *   건드리면 안 되기 때문이다(같은 시드로 돌린 시뮬이 어긋난다).
 */
export function markDepleted(node, data, tick, rng = null) {
  if (!node) return node;
  node.amount = 0;
  node.depleted = true;
  const days = regrowDays(node.type, data, rng ?? pseudoRng(node.id, tick));
  node.respawnAt = days == null ? null : tick + days;
  node.stamp = tick;
  return node;
}

/** id·틱에서 뽑은 작은 결정론 난수 — 월드 rng 를 축내지 않고 흔들림만 얻는다 */
function pseudoRng(seedStr, tick) {
  let h = 2166136261 ^ tick;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const v = ((h >>> 0) % 10000) / 10000;
  return { next: () => v, int: (a, b) => a + Math.floor(v * (b - a + 1)) };
}

// ── 스폰 링 (§13-B-5) ───────────────────────────────────────────
export const ringsCfg = (data) => data.world.rings;

/**
 * 본부에서의 거리로 정하는 위험 띠.
 *   링0 = 영토 + ring0Margin (온순한 짐승만) / 링1 = 그 밖 ring1Span 까지 / 링2 = 그 너머
 * 영토가 자라면 링0 도 함께 자란다 — 정착지가 커질수록 안전한 땅이 넓어진다.
 */
export function ringRadii(nation, data) {
  const cfg = ringsCfg(data);
  const r0 = territoryRadius(nation, data) + (cfg?.ring0Margin ?? 10);
  return { r0, r1: r0 + (cfg?.ring1Span ?? 22) };
}

export function ringAt(world, nation, x, y, data) {
  const town = townOf(world, nation?.id ?? 'player');
  if (!town) return 0;
  const { r0, r1 } = ringRadii(nation, data);
  const d = dist(town.x, town.y, x, y);
  if (d <= r0) return 0;
  if (d <= r1) return 1;
  return 2;
}

/** 이 도읍 둘레 얼마 안에는 자원 노드가 한 톨도 없는가 (§13-B-2) */
function clearRadiusOf(town, data) {
  const c = clusterCfg(data);
  return town.isPlayer ? (c?.clearRadius ?? 0) : (c?.aiClearRadius ?? 0);
}

/**
 * 노드 하나가 앉을 수 있는 자리인가.
 * ① 지도 안 ② 지형이 맞다 ③ 어느 도읍의 빈 땅(clearRadius)도 아니다
 * ④ 도읍 한복판이 아니다 ⑤ 같은 종류끼리 최소 간격 ⑥ 이미 다른 노드가 선 칸이 아니다
 * ★ §17-17 ⑦ minTownDistance 가 있으면 본영에서 그만큼 밖 — 걸어 나가야 찾는 것들(숨은 궤)의 조건이다.
 */
function spotOk(ctx, type, def, x, y, relax = false) {
  const { map, data, towns, byType, taken, size, tIndex, playerTown } = ctx;
  if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) return false;
  const minTown = def.minTownDistance ?? 0;
  if (minTown > 0 && playerTown && dist(playerTown.x, playerTown.y, x, y) < minTown) return false;
  const terr = terrainAt(map, x, y);
  const wants = def.terrains || (def.terrain != null ? [def.terrain] : null);
  // ★ 첫 군락 보장(nearGuarantee)은 지형을 느슨하게 본다 — 마차가 어디에 서든 8~13타일 안에
  //   첫 나무·첫 열매가 있어야 사슬 1~3장이 굴러간다. 물가만은 예외다(strictTerrain).
  const loose = relax && !def.strictTerrain;
  if (wants && !loose) { if (!wants.some((c) => tIndex[c] === terr)) return false; }
  else if (terr === tIndex.water && !(wants || []).includes('water')) return false;   // 물 위에는 안 선다
  for (const tw of towns) {
    if (cheb(tw.x, tw.y, x, y) <= 1) return false;
    if (dist(tw.x, tw.y, x, y) <= clearRadiusOf(tw, data)) return false;
  }
  if (taken.has(`${x},${y}`)) return false;
  return !tooClose(ctx, type, x, y, def.minSpacing);
}

function pushNode(ctx, type, def, x, y) {
  const node = makeNode(`n${ctx.nextId}`, type, x, y, def, ctx.rng);
  ctx.nextId += 1;
  (ctx.byType[type] ||= []).push(node);
  indexNode(ctx, type, def, x, y);
  ctx.taken.add(`${x},${y}`);
  ctx.nodes.push(node);
  return node;
}

/** 간격 판정용 격자 색인에 한 자리를 적는다 (칸 크기 = 그 종류의 minSpacing) */
function indexNode(ctx, type, def, x, y) {
  const s = def.minSpacing;
  if (!(s > 0)) return;
  const grid = (ctx.grid[type] ||= new Map());
  const key = `${Math.floor(x / s)},${Math.floor(y / s)}`;
  const bucket = grid.get(key);
  if (!bucket) { grid.set(key, [{ x, y }]); return; }
  bucket.push({ x, y });
}

/**
 * 군락 하나를 심는다 — 씨앗 한 점을 중심으로 원 안에 같은 종류를 흩뿌린다.
 * 반지름 안 균등 분포(√r)라 가운데가 빽빽하지 않고 '들'처럼 퍼진다.
 * @returns {{id,type,x,y,r,n}|null} 한 그루도 못 심었으면 null
 */
function growCluster(ctx, type, def, cx, cy, size, radius, relax = false) {
  const grown = [];
  let tries = 0;
  const maxTries = size * 26 + 40;
  while (grown.length < size && tries < maxTries) {
    tries += 1;
    const a = ctx.rng.float(0, Math.PI * 2);
    const r = Math.sqrt(ctx.rng.next()) * radius;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (!spotOk(ctx, type, def, x, y, relax)) continue;
    grown.push(pushNode(ctx, type, def, x, y));
  }
  if (!grown.length) return null;
  const cluster = {
    id: `cl${ctx.nextClusterId++}`, type,
    x: Math.round(cx), y: Math.round(cy),
    r: Math.round(radius * 10) / 10, n: grown.length,
  };
  for (const n of grown) n.cluster = cluster.id;
  ctx.clusters.push(cluster);
  return cluster;
}

/** 군락 씨앗 자리 고르기 — 플레이어 도읍에서 centerRadius 밖, 지형이 맞는 칸 */
function pickClusterCenter(ctx, def, opts = {}) {
  const { rng, size, map, data, tIndex, playerTown } = ctx;
  const c = clusterCfg(data);
  const loose = opts.relax && !def.strictTerrain;
  const wants = loose ? null : (def.terrains || (def.terrain != null ? [def.terrain] : null));
  const ring = opts.ring ?? null;
  for (let i = 0; i < 400; i += 1) {
    let x;
    let y;
    if (ring && playerTown) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(ring[0], ring[1]);
      x = Math.round(playerTown.x + Math.cos(a) * r);
      y = Math.round(playerTown.y + Math.sin(a) * r);
    } else if (opts.anchors) {
      const anchor = rng.pick(opts.anchors);
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(3, def.nearTownRadius ?? 24);
      x = Math.round(anchor.x + Math.cos(a) * r);
      y = Math.round(anchor.y + Math.sin(a) * r);
    } else {
      x = rng.int(2, size - 3);
      y = rng.int(2, size - 3);
    }
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
    const terr = terrainAt(map, x, y);
    if (wants && !wants.some((k) => tIndex[k] === terr)) continue;
    if (!wants && terr === tIndex.water) continue;
    if (!ring && playerTown && dist(playerTown.x, playerTown.y, x, y) < (c?.centerRadius ?? 0)) continue;
    return { x, y };
  }
  return null;
}

/**
 * 자원 노드 배치 — ★ GDD3 §13-B-1·2 **군락**.
 *
 * 예전에는 종류마다 count 만큼을 지도 전체에 고르게 흩뿌렸다. 그래서 나무 한 그루, 바위 한 덩이가
 * 사방에 널려 어디를 봐도 같은 그림이었고, 시작 영토 한복판에도 자원이 박혀 건물 놓을 자리가 없었다.
 * 이제는 씨앗 하나에 여럿을 붙여 **숲 군락·딸기 들·바위 지대·강가 어장**을 만들고, 도읍 둘레
 * clearRadius 안에는 한 톨도 두지 않는다. 첫 군락은 8~14타일 띠에 반드시 놓는다(nearGuarantee).
 *
 * ★ 유막은 유전 태그국 인근에만, 철광맥은 철광맥 태그국 인근에만 생긴다 (WORLD.md §1 태그 정합).
 * @returns {{nodes, nextNodeId, clusters}}
 */
export function generateNodes(map, towns, rng, data, nationTags) {
  const cfg = worldCfg(data);
  const cCfg = clusterCfg(data);
  const ctx = {
    map, data, rng, towns, size: cfg.size, tIndex: terrainIndex(data),
    nodes: [], byType: {}, taken: new Set(), clusters: [],
    // ★ §17-17 — 간격 판정용 격자 색인(종류별). 아래 tooClose 의 주석에 까닭이 있다.
    grid: {},
    nextId: 1, nextClusterId: 1,
    playerTown: towns.find((t) => t.isPlayer) ?? null,
  };

  const taggedTowns = (tags) => towns.filter((tw) => (nationTags[tw.nationId] || []).some((g) => tags.includes(g)));

  // ── ① 도읍 코앞의 첫 군락 — 사슬 1~3장이 이 거리를 전제로 굴러간다 ──
  //   지형이 안 맞으면 ⓐ 지형을 느슨하게 보고(물가만 예외) ⓑ 그래도 안 되면 띠를 넓혀 다시 찾는다.
  //   "마차가 어디에 섰든 8~13타일 안에 첫 나무가 있다"가 이 블록의 약속이다.
  for (const g of cCfg?.nearGuarantee || []) {
    const def = cfg.nodes.types[g.type];
    if (!def) continue;
    for (let k = 0; k < (g.clusters ?? 1); k += 1) {
      let center = null;
      let ring = [...g.ring];
      let relax = false;
      for (let attempt = 0; attempt < 6 && !center; attempt += 1) {
        center = pickClusterCenter(ctx, def, { ring, relax });
        if (center) break;
        if (!relax) relax = true;                        // ⓐ 지형 완화
        else { ring = [ring[0], ring[1] + 6]; relax = false; }   // ⓑ 띠 넓히기
      }
      if (!center) continue;
      const n = rng.int(g.size[0], g.size[1]);
      const radius = def.cluster ? rng.float(def.cluster.radius[0], def.cluster.radius[1]) : 3;
      growCluster(ctx, g.type, def, center.x, center.y, n, radius, relax);
    }
  }

  // ── ② 나머지 군락 — 종류마다 count 를 채울 때까지 씨앗을 뿌린다 ──
  for (const type of cfg.nodes.order) {
    const def = cfg.nodes.types[type];
    if (!def || !(def.count > 0)) continue;
    if (type === 'ruin') continue;                       // 유적은 군락이 아니다(아래 ③)
    ctx.byType[type] ||= [];
    const anchors = def.nearTags ? taggedTowns(def.nearTags) : null;
    if (anchors && anchors.length === 0) continue;       // 태그 보유국이 없으면 아예 안 난다
    const cl = def.cluster ?? { size: [1, 1], radius: [0.5, 0.5] };
    let guard = 0;
    let dry = 0;                                         // 헛손질 연속 횟수 — 한 번 실패로 포기하지 않는다
    while (ctx.byType[type].length < def.count && guard++ < def.count * 6 + 400 && dry < 60) {
      const center = pickClusterCenter(ctx, def, { anchors });
      if (!center) { dry += 1; continue; }
      const want = Math.min(rng.int(cl.size[0], cl.size[1]), def.count - ctx.byType[type].length);
      const radius = rng.float(cl.radius[0], cl.radius[1]);
      const made = growCluster(ctx, type, def, center.x, center.y, Math.max(1, want), radius);
      dry = made ? 0 : dry + 1;
    }
  }

  // ── ③ 유적 — ★ §13-B-4 크기 1×1~4×4. 클수록 멀고 사납고 값지다 ──
  placeRuins(ctx, cfg, rng, data);

  return { nodes: ctx.nodes, nextNodeId: ctx.nextId, clusters: ctx.clusters };
}

/**
 * 유적 배치. 크기표(ruinSizes.table)에서 무게로 하나를 뽑고, 그 크기가 요구하는
 * **최소 거리·최소 링**을 만족하는 자리에만 세운다 — 큰 유적일수록 멀고 사나운 땅에 있다.
 * 일부는 은닉(concealed)이라 가까이 가거나 정찰이 닿아야 지도에 나타난다.
 */
function placeRuins(ctx, cfg, rng, data) {
  const def = cfg.nodes.types.ruin;
  if (!def || !(def.count > 0)) return;
  const table = ruinSizeCfg(data)?.table || [];
  if (!table.length) return;
  const player = ctx.playerTown;
  const entries = table.map((t) => ({ value: t, weight: t.weight }));
  const ring1 = (cfg.territory.baseRadius) + (ringsCfg(data)?.ring0Margin ?? 10);
  const ring2 = ring1 + (ringsCfg(data)?.ring1Span ?? 22);
  ctx.byType.ruin ||= [];
  let guard = 0;
  while (ctx.byType.ruin.length < def.count && guard++ < def.count * 60) {
    const spec = rng.weighted(entries);
    const x = rng.int(2, ctx.size - 3);
    const y = rng.int(2, ctx.size - 3);
    if (!spotOk(ctx, 'ruin', def, x, y)) continue;
    if (player) {
      const d = dist(player.x, player.y, x, y);
      if (d < (spec.minDistance ?? 0)) continue;
      const ring = d <= ring1 ? 0 : (d <= ring2 ? 1 : 2);
      if (ring < (spec.minRing ?? 0)) continue;
    }
    const node = pushNode(ctx, 'ruin', def, x, y);
    node.size = spec.size;
    node.ruinName = spec.name;
    node.swingsPerCycle = spec.swings;
    node.ruinGauge = spec.gauge;
    node.gradeBoost = spec.gradeBoost ?? 0;
    node.concealed = rng.chance(spec.concealChance ?? 0);
  }
}

/**
 * 같은 종류끼리의 최소 간격 판정 — 격자 색인으로 **이웃 아홉 칸만** 본다.
 * ★ §17-17 — 지도가 384² 로 넓어지며 한 종류의 노드가 1800개까지 갔다. 목록을 전부 훑던 옛 셈은
 *   O(n²) 라 월드 생성이 100ms → 344ms 로 늘었다. 칸 크기를 spacing 으로 잡으면 cheb 거리가
 *   spacing 미만인 이웃은 반드시 아홉 칸 안에 있다 — 판정 결과는 한 톨도 달라지지 않는다.
 */
function tooClose(ctx, type, x, y, spacing) {
  if (!(spacing > 0)) return false;
  const grid = ctx.grid[type];
  if (!grid) return false;
  const cx = Math.floor(x / spacing);
  const cy = Math.floor(y / spacing);
  for (let gy = -1; gy <= 1; gy += 1) {
    for (let gx = -1; gx <= 1; gx += 1) {
      const b = grid.get(`${cx + gx},${cy + gy}`);
      if (b && b.some((n) => cheb(n.x, n.y, x, y) < spacing)) return true;
    }
  }
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
  // ★ §17-8 — 첫 땅에는 물이 차지 않는다(피드백: 시작 영토에 물이 있으면 이동·건설이 다 막힌다).
  //   플레이어 도읍 반경(시작 영토 + spawnWaterClearMargin) 안의 물 칸을 풀밭으로 메운다.
  //   난수를 쓰지 않으므로 재현성 계약은 그대로다.
  clearWaterAround(map, towns.find((t) => t.isPlayer), data);
  const nationTags = { player: opts.playerTags ?? [] };
  for (const def of nationDefs) nationTags[def.id] = def.tags || [];
  const { nodes, nextNodeId, clusters } = generateNodes(map, towns, rng, data, nationTags);
  map.towns = towns;
  map.nodes = nodes;
  map.nextNodeId = nextNodeId;
  // ★ §13-B-1 — 군락 목록. 클라가 이 원들을 보고 바닥 질감을 달리 칠한다(지역이 '지역'으로 읽히게).
  map.clusters = clusters;
  map.caravans = buildCaravans(towns, cfg);
  return map;
}

/** ★ §17-8 — 도읍 둘레의 물을 뭍(풀밭)으로 메운다. terrain 문자열을 제자리에서 고쳐 쓴다. */
function clearWaterAround(map, town, data) {
  if (!town) return;
  const t = worldCfg(data).territory;
  const r = (t.baseRadius ?? 6) + (t.spawnWaterClearMargin ?? 0);
  const idx = terrainIndex(data);
  const grassCh = String.fromCharCode(48 + idx.grass);
  const chars = map.terrain.split('');
  let changed = false;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = town.x + dx;
      const y = town.y + dy;
      if (x < 0 || y < 0 || x >= map.size || y >= map.size) continue;
      const i = y * map.size + x;
      if (chars[i].charCodeAt(0) - 48 === idx.water) { chars[i] = grassCh; changed = true; }
    }
  }
  if (changed) map.terrain = chars.join('');
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
  if (dist(town.x, town.y, x, y) <= territoryRadius(nation, data) + 0.001) return true;
  /* ★ §17-14 — 깃발로 얻은 새 영토(nation.claims)도 우리 땅이다. 여기는 짐승 성역·건물 배치·
     주민 영토 판정이 전부 지나는 뜨거운 길이라, 점령지(최대 4개)만 짧게 훑고 바로 나간다. */
  const claims = nation.claims;
  if (!claims || !claims.length) return false;
  for (const c of claims) if (dist(c.x, c.y, x, y) <= c.radius + 0.001) return true;
  return false;
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

/**
 * ★ §17-12 — 노드를 세상에서 걷어 낸다(걷어내기 clearNode). 지운 노드를 돌려준다(없으면 null).
 * 노드 배열은 지금까지 덧붙이기만 했다 — 지우는 문은 이 하나여야 한다.
 * 지운 사실은 map.removedNodes 에 틱과 함께 적는다: worldDiff 는 '있는 노드'만 실으므로,
 * 이 장부가 없으면 클라의 노드 사전에 유령 나무가 영영 남는다(markDepleted 와 다른 점이다 —
 * 그루터기는 노드가 남아 stamp 로 흐르지만, 걷어 낸 자리는 흔적 자체가 없다).
 */
export function removeNode(world, id) {
  const nodes = world.map?.nodes;
  if (!nodes) return null;
  const i = nodes.findIndex((n) => n.id === id);
  if (i < 0) return null;
  const [node] = nodes.splice(i, 1);
  const log = (world.map.removedNodes ||= []);
  log.push({ id: node.id, tick: world.tick ?? 0 });
  if (log.length > 200) log.splice(0, log.length - 200);
  return node;
}

/** 새 노드 추가(개간 등) */
export function addNode(world, type, x, y, data, { rich = false, tick = 0 } = {}) {
  const def = data.world.nodes.types[type];
  const id = `n${world.map.nextNodeId++}`;
  const node = {
    id, type, x, y, rich,
    richness: rich ? (def.richMultiplier ?? 2) : 1,
    amount: def.amount ?? 0, max: def.amount ?? 0,
    depleted: false, hidden: false, workers: 0, readyAt: null, stamp: tick, respawnAt: null,
  };
  world.map.nodes.push(node);
  return node;
}

/**
 * 자국이 일하러 갈 수 있는 노드 — ★ GDD3 §13-B-2.
 * 영토 안은 비워 두었으므로 '영토 안'만 보면 아무도 일하지 못한다. 반경은 영토 + workRadiusBonus 다.
 */
export function workableNodes(world, nation, data, { includeHidden = false } = {}) {
  const town = townOf(world, nation.id);
  if (!town) return [];
  const r = territoryRadius(nation, data) + (data.world.villagers.workRadiusBonus ?? 0);
  return (world.map?.nodes || []).filter((n) => {
    if (n.hidden && !includeHidden) return false;
    if (n.concealed && !n.revealed) return false;
    return dist(n.x, n.y, town.x, town.y) <= r + 0.001;
  });
}

/** 은닉 유적이 드러났는가 — 아바타·주민이 revealRadius 안에 닿으면 지도에 나타난다 (§13-B-4) */
export function revealConcealed(world, nation, data, tick = 0) {
  const radius = ruinSizeCfg(data)?.revealRadius ?? 5;
  const eyes = [
    ...Object.values(nation.avatars || {}),
    ...(nation.villagers || []),
  ];
  if (!eyes.length) return [];
  const found = [];
  for (const n of world.map?.nodes || []) {
    if (!n.concealed || n.revealed) continue;
    for (const e of eyes) {
      if (dist(e.x, e.y, n.x, n.y) > radius) continue;
      n.revealed = true;
      n.stamp = tick;
      found.push(n);
      break;
    }
  }
  return found;
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
