// 울타리·석벽 조각 — docs/GDD3.md §7. 자동 성곽 링은 폐지됐다.
// 플레이어가 드래그로 선을 그으면 서버가 그 선을 '조각'으로 쪼개 세운다. 조각마다 내구도가 있고
// 목책(T1) → 석벽(T2) 으로 올린다. gate:true 조각은 문이다(사람은 지나고 적은 두드린다).
import { townOf, inTerritory, terrainNameAt, dist, cheb } from './world.js';
import { settlementTier } from './tiers.js';
import { round2, round3 } from './economy.js';
// ★ §17-13 — 매립한 물 칸은 뭍이다(울타리도 그 위에 선다)
import { onFill } from './research.js';

export const fenceCfg = (data) => data.world.fences;

const err = (code, message) => ({ ok: false, error: { code, message } });

export const fenceDefOf = (gate, data) => (gate ? data.buildings.gate : data.buildings.fence);
export function fenceTierSpec(gate, tier, data) {
  return fenceDefOf(gate, data).tiers?.[tier - 1] ?? null;
}

/** 선분을 타일 단위 조각으로 — 브레젠험(대각 포함) */
export function walkLine(x0, y0, x1, y1, limit = 200) {
  const pts = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let e = dx - dy;
  let guard = 0;
  pts.push({ x, y });
  while ((x !== tx || y !== ty) && guard++ < limit) {
    const e2 = 2 * e;
    if (e2 > -dy) { e -= dy; x += sx; }
    if (e2 < dx) { e += dx; y += sy; }
    pts.push({ x, y });
  }
  return pts;
}

/** 드래그 경로(points) → 조각 후보 목록 [{x1,y1,x2,y2}] */
export function segmentsFromPoints(points, data) {
  const cfg = fenceCfg(data);
  const clean = [];
  for (const p of points || []) {
    const x = Math.round(Number(p?.x));
    const y = Math.round(Number(p?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (clean.length && clean[clean.length - 1].x === x && clean[clean.length - 1].y === y) continue;
    clean.push({ x, y });
  }
  if (clean.length < 2) return [];
  const tiles = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    const a = clean[i];
    const b = clean[i + 1];
    if (dist(a.x, a.y, b.x, b.y) > cfg.maxSegmentSpan) return null;   // 한 획이 너무 길다
    const walk = walkLine(a.x, a.y, b.x, b.y, cfg.maxSegmentSpan * 2 + 4);
    for (const t of walk) {
      if (tiles.length && tiles[tiles.length - 1].x === t.x && tiles[tiles.length - 1].y === t.y) continue;
      tiles.push(t);
    }
  }
  const segs = [];
  for (let i = 0; i < tiles.length - 1; i += 1) {
    segs.push({ x1: tiles[i].x, y1: tiles[i].y, x2: tiles[i + 1].x, y2: tiles[i + 1].y });
  }
  return segs;
}

export function fenceKey(s) {
  const a = `${s.x1},${s.y1}`;
  const b = `${s.x2},${s.y2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function fenceMid(s) {
  return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
}

function validateSegment(world, nation, seg, data) {
  const cfg = fenceCfg(data);
  const size = data.world.size;
  for (const [x, y] of [[seg.x1, seg.y1], [seg.x2, seg.y2]]) {
    if (x < 0 || y < 0 || x >= size || y >= size) return { ok: false, code: 'BAD_POSITION', message: '지도 밖입니다.' };
    if (cfg.blockedTerrain.includes(terrainNameAt(world.map, x, y, data))
      /* ★ §17-13 매립 — 메운 물 칸은 뭍이다. 울타리도 그 위에 선다. */
      && !onFill(nation, x, y)) {
      return { ok: false, code: 'BAD_TERRAIN', message: '물 위에는 세울 수 없습니다.' };
    }
  }
  if (cfg.requiresTerritory) {
    const town = townOf(world, nation.id);
    if (!town) return { ok: false, code: 'NO_TOWN', message: '정착지가 없습니다.' };
    const m = fenceMid(seg);
    /* ★ §17-14 — 깃발로 얻은 점령지(claims)도 우리 땅이다. 새 땅에도 울타리를 두른다. */
    if (!inTerritory(world, nation, m.x, m.y, data)) {
      return { ok: false, code: 'OUT_OF_TERRITORY', message: '아직 우리 땅이 아닙니다.' };
    }
  }
  for (const s of nation.structures || []) {
    if (cheb(s.x, s.y, seg.x1, seg.y1) === 0 || cheb(s.x, s.y, seg.x2, seg.y2) === 0) {
      return { ok: false, code: 'ON_STRUCTURE', message: '건물 자리입니다.' };
    }
  }
  return { ok: true };
}

/**
 * placeFence {points:[{x,y}...], gates:[idx], tier}
 * 자재는 조각 수만큼 든다. 값이 싸고 즉시 서므로 건설 대기열을 타지 않는다(GDD3 §7 드래그 배치).
 */
export function placeFence(world, nation, cmd, data) {
  const cfg = fenceCfg(data);
  // ★ v3.1 — 울타리의 문도 진행 감독이 쥔다(7장 낯선 발자국). commands.applyCommand 가 먼저 막는다.
  if (!nation.isPlayer && settlementTier(nation) < (data.buildings.fence.requiresTier ?? 2)) {
    return err('TIER_LOCKED', '아직 울타리를 두를 만큼 자라지 않았습니다.');
  }
  const points = cmd.points ?? cmd.payload?.points;
  if (!Array.isArray(points) || points.length < 2) return err('BAD_POINTS', '두 점 이상을 이어야 합니다.');
  if (points.length > cfg.maxPointsPerRequest) return err('TOO_MANY_POINTS', '한 번에 그을 수 있는 길이를 넘었습니다.');
  const segs = segmentsFromPoints(points, data);
  if (segs === null) return err('SEGMENT_TOO_LONG', '한 획이 너무 깁니다.');
  if (!segs.length) return err('BAD_POINTS', '세울 자리가 없습니다.');

  const list = (nation.fences ||= []);
  if (list.length + segs.length > cfg.maxSegments) return err('FENCE_CAP', '울타리를 더 두를 수 없습니다.');

  const gateSet = new Set((cmd.gates ?? cmd.payload?.gates ?? []).map(Number));
  const tier = Math.max(1, Math.min(2, Number(cmd.tier ?? cmd.payload?.tier ?? 1)));
  const existing = new Set(list.map(fenceKey));

  const planned = [];
  const cost = {};
  const skipped = [];
  segs.forEach((seg, i) => {
    const key = fenceKey(seg);
    if (existing.has(key)) { skipped.push({ ...seg, reason: 'EXISTS' }); return; }
    const v = validateSegment(world, nation, seg, data);
    if (!v.ok) { skipped.push({ ...seg, reason: v.code }); return; }
    const gate = gateSet.has(i);
    const spec = fenceTierSpec(gate, tier, data);
    if (!spec) { skipped.push({ ...seg, reason: 'BAD_TIER' }); return; }
    for (const [r, amount] of Object.entries(spec.cost || {})) cost[r] = round2((cost[r] || 0) + amount);
    existing.add(key);
    planned.push({ seg, gate, spec });
  });
  if (!planned.length) return err('NO_VALID_SEGMENT', '세울 수 있는 자리가 없습니다.');
  for (const [r, v] of Object.entries(cost)) {
    if ((nation.resources[r] || 0) < v) {
      return err('NO_RESOURCE', `${data.resources.meta[r]?.name ?? r}이(가) 부족합니다. (${Math.ceil(v)} 필요)`);
    }
  }
  for (const [r, v] of Object.entries(cost)) nation.resources[r] -= v;

  const created = [];
  for (const { seg, gate, spec } of planned) {
    const piece = {
      id: `f${nation.nextFenceId++}`,
      x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
      gate, tier, hp: spec.hp, maxHp: spec.hp,
      builtTick: world.tick,
    };
    nation.fences.push(piece);
    created.push(piece);
  }
  return {
    ok: true,
    placed: created.length,
    skipped: skipped.length,
    cost,
    segments: created.map(fenceView.bind(null, data)),
  };
}

/** upgradeFence {segmentIds:[...]} — 목책 → 석벽 */
export function upgradeFence(world, nation, cmd, data) {
  const ids = cmd.segmentIds ?? cmd.payload?.segmentIds ?? (cmd.segmentId ? [cmd.segmentId] : null);
  const list = nation.fences || [];
  const targets = ids ? list.filter((f) => ids.includes(f.id)) : list.filter((f) => f.tier < 2);
  if (!targets.length) return err('NO_FENCE', '올릴 조각이 없습니다.');
  const cost = {};
  const doable = [];
  for (const f of targets) {
    if (f.tier >= 2) continue;
    const spec = fenceTierSpec(f.gate, 2, data);
    if (!spec) continue;
    for (const [r, v] of Object.entries(spec.cost || {})) cost[r] = round2((cost[r] || 0) + v);
    doable.push({ f, spec });
  }
  if (!doable.length) return err('MAX_TIER', '이미 석벽입니다.');
  for (const [r, v] of Object.entries(cost)) {
    if ((nation.resources[r] || 0) < v) return err('NO_RESOURCE', `${data.resources.meta[r]?.name ?? r}이(가) 부족합니다.`);
  }
  for (const [r, v] of Object.entries(cost)) nation.resources[r] -= v;
  for (const { f, spec } of doable) {
    const ratio = f.maxHp ? f.hp / f.maxHp : 1;
    f.tier = 2;
    f.maxHp = spec.hp;
    f.hp = round2(spec.hp * Math.max(0.5, ratio));
  }
  return { ok: true, upgraded: doable.length, cost, segments: doable.map(({ f }) => fenceView(data, f)) };
}

/** repairFence {segmentIds?} — 없으면 파손된 조각 전부 */
export function repairFence(world, nation, cmd, data) {
  const cfg = fenceCfg(data);
  const ids = cmd.segmentIds ?? cmd.payload?.segmentIds ?? null;
  const list = nation.fences || [];
  const targets = (ids ? list.filter((f) => ids.includes(f.id)) : list).filter((f) => (f.hp ?? 0) < (f.maxHp ?? 0));
  if (!targets.length) return err('NOT_DAMAGED', '성한 울타리입니다.');
  const cost = {};
  for (const f of targets) {
    const spec = fenceTierSpec(f.gate, f.tier, data);
    const ratio = 1 - (f.hp ?? 0) / (f.maxHp || 1);
    for (const [r, v] of Object.entries(spec?.cost || {})) cost[r] = round2((cost[r] || 0) + v * ratio * cfg.repairCostRatio / 0.35 * 0.35);
  }
  for (const [r, v] of Object.entries(cost)) {
    if ((nation.resources[r] || 0) < v) return err('NO_RESOURCE', `${data.resources.meta[r]?.name ?? r}이(가) 부족합니다.`);
  }
  for (const [r, v] of Object.entries(cost)) nation.resources[r] -= v;
  for (const f of targets) f.hp = f.maxHp;
  return { ok: true, repaired: targets.length, cost };
}

/** removeFence {segmentIds} — 낸 값의 절반을 돌려준다 */
export function removeFence(world, nation, cmd, data) {
  const ids = cmd.segmentIds ?? cmd.payload?.segmentIds ?? (cmd.segmentId ? [cmd.segmentId] : []);
  const list = (nation.fences ||= []);
  const kept = [];
  const removed = [];
  for (const f of list) (ids.includes(f.id) ? removed : kept).push(f);
  if (!removed.length) return err('NO_FENCE', '그런 조각이 없습니다.');
  nation.fences = kept;
  const refund = {};
  for (const f of removed) {
    const spec = fenceTierSpec(f.gate, f.tier, data);
    for (const [r, v] of Object.entries(spec?.cost || {})) {
      const back = round2(v * 0.5);
      refund[r] = round2((refund[r] || 0) + back);
      nation.resources[r] = (nation.resources[r] || 0) + back;
    }
  }
  return { ok: true, removed: removed.length, refund };
}

// ────────────────────────────────────────────────────────────────
// 전투 접합
// ────────────────────────────────────────────────────────────────
export const aliveFences = (nation) => (nation.fences || []).filter((f) => (f.hp ?? 0) > 0);

// ────────────────────────────────────────────────────────────────
// ★ Sprint 3 — 울타리 칸 색인 (파생 캐시. 저장되지 않는다)
//
// 왜. 짐승 한 마리가 한 걸음을 뗄 때마다 후보 세 자리를 시험하고, 그때마다 울타리 전부와
// 선분 교차를 잰다(ecology.crossesFence). 조각이 400개, 짐승이 90마리, 초당 한 걸음이면
// 초당 십만 번을 훌쩍 넘는다 — 실측 216,000회/초. 그런데 한 걸음은 길어야 한두 타일이라,
// 그 걸음과 만날 수 있는 조각은 언제나 코앞의 몇 조각뿐이다.
//
// 무효화. 울타리 조각은 **한번 선 자리에서 움직이지 않는다**(부서져도 그 자리다). 그래서
// 색인은 목록이라는 그릇 자체가 바뀌거나(removeFence 가 새 배열을 끼운다) 길이가 달라질 때만
// 다시 지으면 된다(placeFence 는 같은 배열에 밀어 넣으므로 길이가 반드시 는다).
// 부서짐(hp)은 색인이 아니라 **쓰는 쪽**이 그때그때 본다.
//
// ⚠ 칸을 크게 잡으면 색인이 도로 헛일이 된다. 첫 판(16칸)을 실측했더니 200,000번의 걸음 판정이
//   67ms → 108ms 로 **느려졌다**: 마을을 두른 울타리는 스물너덧 칸짜리 네모라 16칸 격자에서는
//   조각 전부가 한두 칸에 몰려 앉고, 그러고도 Set·정렬·새 배열 값을 치렀기 때문이다.
//   그래서 ① 칸을 8로 줄이고 ② **한 칸만 걸리는 물음**(걸음은 언제나 한 칸 미만이다)에는
//   그 칸의 목록을 그대로 돌려주어 값을 한 톨도 치르지 않는다.
// ────────────────────────────────────────────────────────────────
/** 칸 크기(타일). 걸음 하나(≤1칸)가 대개 한 칸 안에 들어가도록 잘게 썬다. */
const FENCE_BUCKET = 8;
/** 빈 답은 늘 같은 그릇을 돌려준다 — 초당 십만 번 부르는 자리라 빈 배열도 쓰레기가 된다. */
const NO_FENCES = Object.freeze([]);
/** @type {WeakMap<Array, {len:number, grid:Map<string, {idx:number[], items:object[]}>}>} */
const FENCE_GRID = new WeakMap();

function fenceGridOf(list) {
  const hit = FENCE_GRID.get(list);
  if (hit && hit.len === list.length) return hit;
  const grid = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    const gx0 = Math.floor(Math.min(f.x1, f.x2) / FENCE_BUCKET);
    const gx1 = Math.floor(Math.max(f.x1, f.x2) / FENCE_BUCKET);
    const gy0 = Math.floor(Math.min(f.y1, f.y2) / FENCE_BUCKET);
    const gy1 = Math.floor(Math.max(f.y1, f.y2) / FENCE_BUCKET);
    for (let gy = gy0; gy <= gy1; gy += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        const k = `${gx},${gy}`;
        const b = grid.get(k);
        // 번호와 조각을 나란히 담는다 — 한 칸짜리 물음은 items 를 그대로 돌려주고(값 0),
        // 여러 칸이 걸릴 때만 idx 로 원래 차례를 되세운다. 칸 안의 차례는 지을 때부터 원래 차례다.
        if (b) { b.idx.push(i); b.items.push(f); }
        else grid.set(k, { idx: [i], items: [f] });
      }
    }
  }
  const made = { len: list.length, grid };
  FENCE_GRID.set(list, made);
  return made;
}

/**
 * 이 사각형에 **걸칠 수 있는** 조각들 — 칸 단위라 언제나 「진짜 답의 상위집합」이다.
 * 돌려주는 차례는 원래 배열 차례다(첫 일치가 승부를 가르는 자리가 있어 차례를 지켜야 한다).
 * 부서진 조각도 그대로 들어 있다 — 살았는가는 부르는 쪽이 판정한다.
 * ⚠ 돌려주는 배열은 **색인의 것이다. 읽기만 할 것**(고치면 색인이 함께 상한다).
 */
export function fencesNear(nation, x0, y0, x1, y1) {
  const list = nation?.fences;
  if (!Array.isArray(list) || !list.length) return NO_FENCES;
  const { grid } = fenceGridOf(list);
  const gx0 = Math.floor(Math.min(x0, x1) / FENCE_BUCKET);
  const gx1 = Math.floor(Math.max(x0, x1) / FENCE_BUCKET);
  const gy0 = Math.floor(Math.min(y0, y1) / FENCE_BUCKET);
  const gy1 = Math.floor(Math.max(y0, y1) / FENCE_BUCKET);
  // ★ 뜨거운 길 — 걸음 하나는 대개 한 칸 안에서 끝난다. 그때는 아무것도 짓지 않는다.
  if (gx0 === gx1 && gy0 === gy1) return grid.get(`${gx0},${gy0}`)?.items ?? NO_FENCES;
  const idx = new Set();
  for (let gy = gy0; gy <= gy1; gy += 1) {
    for (let gx = gx0; gx <= gx1; gx += 1) {
      const b = grid.get(`${gx},${gy}`);
      if (b) for (let k = 0; k < b.idx.length; k += 1) idx.add(b.idx[k]);
    }
  }
  if (!idx.size) return NO_FENCES;
  const sorted = [...idx].sort((a, b) => a - b);
  const out = new Array(sorted.length);
  for (let k = 0; k < sorted.length; k += 1) out[k] = list[sorted[k]];
  return out;
}

/**
 * 적이 부딪히는 조각 — 적→중심 직선에 걸린 것 중 가장 가까운 것.
 * ★ Sprint 3 — 옛 구현은 부를 때마다 `aliveFences(nation)` 로 **새 배열을 하나 빚었다**.
 *   전투 서브틱마다 적 40마리가 저마다 400칸짜리 배열을 만드니 초당 6만 개가 났다 — 계산보다
 *   쓰레기 수거가 더 아팠다. 이제 목록을 그 자리에서 훑으며 살았는지를 함께 본다: 훑는 차례도
 *   (aliveFences 가 차례를 지켰으므로) 고르는 결과도 옛것과 한 톨도 다르지 않다.
 */
export function blockingFence(nation, from, core) {
  const list = nation.fences;
  if (!Array.isArray(list) || !list.length) return null;
  const vx = core.x - from.x;
  const vy = core.y - from.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.0001) return null;
  let best = null;
  let bestT = Infinity;
  for (const f of list) {
    if ((f.hp ?? 0) <= 0) continue;                 // 부서진 조각은 막지 못한다(옛 aliveFences 와 같은 문)
    const m = fenceMid(f);
    const t = ((m.x - from.x) * vx + (m.y - from.y) * vy) / len2;
    if (t < -0.02 || t > 1.02) continue;
    const px = from.x + vx * t;
    const py = from.y + vy * t;
    const perp = Math.hypot(m.x - px, m.y - py);
    if (perp > 1.6) continue;
    if (t < bestT) { bestT = t; best = f; }
  }
  return best;
}

export function damageFence(f, amount) {
  f.hp = Math.max(0, (f.hp ?? 0) - amount);
  return f.hp;
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
export function fenceView(data, f) {
  const spec = fenceTierSpec(f.gate, f.tier, data);
  return {
    id: f.id, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
    gate: Boolean(f.gate), tier: f.tier,
    name: spec?.name ?? (f.gate ? '문' : '울타리'),
    hp: round2(f.hp ?? 0), maxHp: f.maxHp ?? 0,
    condition: f.maxHp ? round3((f.hp ?? 0) / f.maxHp) : 1,
    broken: (f.hp ?? 0) <= 0,
  };
}

export function fenceViews(nation, data) {
  return (nation.fences || []).map((f) => fenceView(data, f));
}

export function fenceSummary(nation, data) {
  const list = nation.fences || [];
  const broken = list.filter((f) => (f.hp ?? 0) <= 0).length;
  return {
    segments: list.length,
    gates: list.filter((f) => f.gate).length,
    stone: list.filter((f) => f.tier >= 2).length,
    broken,
    damaged: list.filter((f) => (f.hp ?? 0) > 0 && (f.hp ?? 0) < (f.maxHp ?? 0)).length,
    maxSegments: fenceCfg(data).maxSegments,
    costs: {
      wood: { ...(data.buildings.fence.tiers[0].cost || {}) },
      stone: { ...(data.buildings.fence.tiers[1].cost || {}) },
      gate: { ...(data.buildings.gate.tiers[0].cost || {}) },
    },
  };
}
