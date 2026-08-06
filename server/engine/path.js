// path.js — 사람이 걷는 길의 단일 정본 (Sprint 1 — "주민이 물 위를 걷는다"의 정공 해법).
//
// 이 저장소의 움직이는 것들은 저마다 통행 판정을 따로 들고 있었다:
//   · 짐승은 ecology.creatureMayStand (§17-4에서 고침)
//   · 적은 battle 의 자체 판정
//   · 동료 봇은 companions.walkable
//   · **주민은 아무것도 없었다** — stepVillagers 가 직선 보간만 해 호수를 그대로 질렀다.
// 여기 있는 것 셋:
//   ① walkableFor  — 「사람」의 통행 판정 정본(지형 walkable + 다리·매립. §17-13 규칙 그대로)
//   ② nearestWalkable — 물 위(낚시터·잘못 뽑힌 스폰)를 목적지로 받았을 때 가장 가까운 뭍으로 스냅
//   ③ findPath / advanceAlong — 경계 제한 A*. 주민 걸음(일 틱당 12칸)이 물을 돌아가게 한다.
// A* 는 결정적이다(힙 동순위는 삽입 순서로 갈린다) — 같은 씨앗은 같은 게임이어야 한다.
import { terrainAt, terrainIndex } from './world.js';
import { onBridge, onFill } from './research.js';

/** 「사람」이 이 칸에 설 수 있는가 — avatar.walkable(클라)·companions.walkable 과 같은 규칙 */
export function walkableFor(world, nation, data, x, y) {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const t = terrainAt(world.map, rx, ry);
  if (t == null) return false;
  const idx = terrainIndex(data);
  for (const c of data.world.terrain.walkable || []) if (idx[c] === t) return true;
  /* §17-13 — 다리·매립 위의 물은 사람에게만 길이다 */
  return t === idx.water && nation != null && (onBridge(nation, rx, ry) || onFill(nation, rx, ry));
}

/**
 * (x,y)에서 가장 가까운 설 수 있는 칸. 물 노드(낚시터)의 일자리 목적지,
 * 영토 밖 링에서 뽑힌 주민 스폰 자리가 이 문을 지난다. 없으면 null.
 */
export function nearestWalkable(world, nation, data, x, y, maxR = 8) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (walkableFor(world, nation, data, cx, cy)) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkableFor(world, nation, data, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return null;
}

const SQRT2 = Math.SQRT2;

/**
 * 경계 제한 A* — 시작·목표를 둘러싼 상자(pad 기본 16칸) 안에서만 찾는다.
 * 목표가 물이면 곁의 뭍으로 갈아 끼우고, 끝내 못 닿으면 **가장 가까이 간 지점까지의 길**을 돌려준다
 * (best-effort — 제자리 무한 걸음 대신 「갈 수 있는 데까지 간다」).
 * @returns {Array<{x,y}>|null} 시작 칸을 포함한 웨이포인트. 한 칸도 못 움직이면 null.
 */
export function findPath(world, nation, data, sx, sy, tx, ty, opts = {}) {
  const size = world.map?.size ?? data.world.size;
  const pad = opts.pad ?? 16;
  const maxNodes = opts.maxNodes ?? 4000;
  let gx = Math.round(tx);
  let gy = Math.round(ty);
  const st = { x: Math.round(sx), y: Math.round(sy) };
  if (!walkableFor(world, nation, data, gx, gy)) {
    const near = nearestWalkable(world, nation, data, gx, gy, opts.snapR ?? 6);
    if (near) { gx = near.x; gy = near.y; }
  }
  if (st.x === gx && st.y === gy) return [{ x: st.x, y: st.y }];

  const x0 = Math.max(0, Math.min(st.x, gx) - pad);
  const y0 = Math.max(0, Math.min(st.y, gy) - pad);
  const x1 = Math.min(size - 1, Math.max(st.x, gx) + pad);
  const y1 = Math.min(size - 1, Math.max(st.y, gy) + pad);
  const w = x1 - x0 + 1;
  const key = (x, y) => (y - y0) * w + (x - x0);

  const g = new Map();
  const from = new Map();
  const heap = [];       // [f, h, seq, x, y]
  let seq = 0;
  const push = (f, h, x, y) => {
    heap.push([f, h, seq++, x, y]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(heap[i], heap[p]) >= 0) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && cmp(heap[l], heap[m]) < 0) m = l;
        if (r < heap.length && cmp(heap[r], heap[m]) < 0) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  const oct = (x, y) => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  };

  const startK = key(st.x, st.y);
  g.set(startK, 0);
  push(oct(st.x, st.y), oct(st.x, st.y), st.x, st.y);
  let best = { x: st.x, y: st.y, h: oct(st.x, st.y) };
  let expanded = 0;
  const walk = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && walkableFor(world, nation, data, x, y);

  while (heap.length && expanded < maxNodes) {
    const [, h, , cx, cy] = pop();
    expanded += 1;
    if (cx === gx && cy === gy) { best = { x: cx, y: cy, h: 0 }; break; }
    if (h < best.h) best = { x: cx, y: cy, h };
    const cg = g.get(key(cx, cy));
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walk(nx, ny)) continue;
        /* 대각선은 양옆이 다 뚫려 있어야 지난다 — 모서리를 스치며 물을 넘지 않게 */
        if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
        const nk = key(nx, ny);
        const ng = cg + (dx && dy ? SQRT2 : 1);
        if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng);
        from.set(nk, key(cx, cy));
        const nh = oct(nx, ny);
        push(ng + nh, nh, nx, ny);
      }
    }
  }

  /* 목표(또는 가장 가까이 간 지점)까지 되짚는다 */
  const out = [];
  let cur = key(best.x, best.y);
  const unkey = (k) => ({ x: (k % w) + x0, y: Math.floor(k / w) + y0 });
  while (cur != null) {
    out.push(unkey(cur));
    if (cur === startK) break;
    cur = from.get(cur);
  }
  out.reverse();
  return out.length > 1 ? out : null;
}

/**
 * 웨이포인트 폴리라인을 따라 speed 만큼 간다 — stepVillagers 의 한 걸음.
 * @returns {{x:number, y:number}} 정수 칸(웨이포인트가 전부 정수 칸이라 물 위에 서지 않는다)
 */
export function advanceAlong(world, nation, data, sx, sy, tx, ty, speed, opts = {}) {
  const path = findPath(world, nation, data, sx, sy, tx, ty, opts);
  if (!path) return { x: Math.round(sx), y: Math.round(sy) };
  let budget = speed;
  let cx = sx;
  let cy = sy;
  for (let i = 1; i < path.length && budget > 0; i += 1) {
    const d = Math.hypot(path[i].x - cx, path[i].y - cy);
    if (d <= budget) { cx = path[i].x; cy = path[i].y; budget -= d; continue; }
    /* 걸음이 웨이포인트 사이에서 끝난다 — 마지막으로 밟은 정수 칸에 선다 */
    return { x: Math.round(path[i - 1].x), y: Math.round(path[i - 1].y) };
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}
