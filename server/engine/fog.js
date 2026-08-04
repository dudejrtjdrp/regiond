// 전장의 안개 — docs/WORLD.md §1 · §2. 자국 마스크만 서버가 만든다.
//   0 = 미탐사(검정) / 1 = 탐사됨(어둡게, 정적 정보만) / 2 = 시야(밝음)
// 마스크는 길이 size² 의 문자열로 들고 다닌다 — 스냅샷 JSON·structuredClone 이 싸고,
// 청크(16×16) 단위 스탬프를 찍어 worldDiff 가 '바뀐 청크'만 보낸다.
import { townOf, territoryRadius } from './world.js';
import { settlementTier } from './tiers.js';
// ★ GDD3 §13-D-4 — 「밤눈」 특성. 안개는 나라 공용이라 가장 잘 보는 눈이 이긴다.
import { nightVisionOf, bestNightVision } from './equipment.js';
import { centerOf } from './structures.js';

export const fogCfg = (data) => data.world.fog;

export function chunkCount(data) {
  const size = data.world.size;
  const c = fogCfg(data).chunk;
  const per = Math.ceil(size / c);
  return per * per;
}

export function chunksPerRow(data) {
  return Math.ceil(data.world.size / fogCfg(data).chunk);
}

/** 새 나라의 초기 안개 — 도읍 주변만 탐사된 상태로 시작한다 */
export function createFog(world, nation, data) {
  const size = data.world.size;
  const n = chunkCount(data);
  const fog = {
    size,
    chunk: fogCfg(data).chunk,
    mask: '0'.repeat(size * size),
    chunkStamp: new Array(n).fill(0),
    chunkHash: new Array(n).fill(0),
  };
  nation.fog = fog;
  recomputeFog(world, nation, data, 0, { initial: true });
  return fog;
}

function stampDisc(vis, size, cx, cy, r) {
  if (!(r > 0)) return;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) vis[y * size + x] = 1;
    }
  }
}

/**
 * ★ GDD3 §12-8 — 시야 가산. 정착지가 커질수록 세상이 넓게 보인다.
 *   아바타·건물(과 그 중심인 도읍)에만 붙는다 — 주민·현장은 그대로다.
 */
export function visionTierBonus(nation, data) {
  return (fogCfg(data).visionPerTier ?? 0) * settlementTier(nation);
}

/** 시야원 목록 — 클라가 "왜 여기가 밝지?"를 설명할 수 있게 뷰에도 실린다 */
export function visionSources(world, nation, data) {
  const v = fogCfg(data).vision;
  const bonus = visionTierBonus(nation, data);
  const out = [];
  const town = townOf(world, nation.id);
  if (town) out.push({ kind: 'town', x: town.x, y: town.y, r: v.town + bonus });
  for (const b of nation.structures || []) {
    // 큰 건물은 제 중심에서 본다 (§12-1 풋프린트)
    const c = centerOf(b.key, b.x, b.y, data);
    out.push({ kind: 'building', x: c.x, y: c.y, r: v.building + bonus });
  }
  for (const s of nation.construction || []) {
    if (s.x == null) continue;
    const c = centerOf(s.building, s.x, s.y, data);
    out.push({ kind: 'site', x: c.x, y: c.y, r: v.site });
  }
  for (const u of nation.villagers || []) {
    out.push({ kind: 'villager', x: u.x, y: u.y, r: u.job === 'scout' ? v.scout : v.villager });
  }
  for (const a of Object.values(nation.avatars || {})) {
    // ★ GDD3 §13-D-4 — 「밤눈」이 깃든 장비는 안개를 그만큼 더 걷는다(사람마다 따로 잰다)
    out.push({ kind: 'lord', x: a.x, y: a.y, r: v.lord + bonus + nightVisionOf(nation, a.id, data) });
  }
  return out;
}

/**
 * 안개 재계산. 탐사됨(1)은 지워지지 않고 누적된다 — 정찰이 곧 개척이다.
 * 청크 해시가 바뀐 곳만 stamp 를 올린다(= worldDiff 전송 단위).
 */
export function recomputeFog(world, nation, data, tick, { initial = false } = {}) {
  const fog = nation.fog;
  if (!fog) return null;
  const size = fog.size;
  const total = size * size;
  const vis = new Uint8Array(total);

  for (const s of visionSources(world, nation, data)) stampDisc(vis, size, s.x, s.y, s.r);
  if (initial) {
    const town = townOf(world, nation.id);
    if (town) stampDisc(vis, size, town.x, town.y, Math.max(fogCfg(data).startExploredRadius, territoryRadius(nation, data)));
  }

  const prev = fog.mask;
  const next = new Array(total);
  for (let i = 0; i < total; i += 1) {
    if (vis[i]) next[i] = '2';
    else next[i] = prev.charCodeAt(i) > 48 ? '1' : '0';
  }
  fog.mask = next.join('');

  // 청크 스탬프
  const per = chunksPerRow(data);
  for (let cy = 0; cy < per; cy += 1) {
    for (let cx = 0; cx < per; cx += 1) {
      const ci = cy * per + cx;
      const h = chunkHashAt(fog, cx, cy);
      if (fog.chunkHash[ci] !== h) {
        fog.chunkHash[ci] = h;
        fog.chunkStamp[ci] = tick;
      }
    }
  }
  return fog;
}

/** 청크 하나의 FNV-1a 해시 — '이 청크가 바뀌었나'의 판정 기준 */
function chunkHashAt(fog, cx, cy) {
  const c = fog.chunk;
  const size = fog.size;
  let h = 2166136261 >>> 0;
  for (let y = cy * c; y < Math.min(size, (cy + 1) * c); y += 1) {
    for (let x = cx * c; x < Math.min(size, (cx + 1) * c); x += 1) {
      h ^= fog.mask.charCodeAt(y * size + x);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h;
}

/**
 * ★ 시야 원 하나를 지금 당장 찍는다 — 일 틱(최대 10분)을 기다리지 않는다.
 *   (GDD3 §8 "아바타 주변 즉시 공개" · docs/PROTOCOL.md v3.0 §안개 즉시 공개)
 *
 * recomputeFog 는 월드 전체(size²)를 다시 칠하고 전 청크를 해싱한다 — 걸음마다 부를 수 없다.
 * 이 함수는 **원이 덮는 칸만** 훑고, 실제로 새로 밝아진 칸이 하나라도 있을 때만 마스크를 다시 만든다.
 * 즉 비용이 '메시지 수'가 아니라 '새로 알게 된 정보량'에 비례한다 — 같은 자리를 계속 두드려도 공짜다.
 *
 * @returns {Array<[number,number]>} 새로 바뀐 청크 좌표 목록(= 즉시 내려보낼 worldDiff.fog 의 대상)
 */
export function stampVisionDisc(nation, data, tick, cx, cy, r) {
  const fog = nation.fog;
  if (!fog || !(r > 0)) return [];
  const size = fog.size;
  const c = fog.chunk;
  const per = Math.ceil(size / c);
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));

  let arr = null;                 // 새로 밝아진 칸이 나올 때까지는 문자열을 건드리지 않는다
  const dirty = new Set();
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * size + x;
      if (fog.mask.charCodeAt(i) >= 50) continue;   // 이미 시야(2)
      if (!arr) arr = fog.mask.split('');
      arr[i] = '2';
      dirty.add(Math.floor(y / c) * per + Math.floor(x / c));
    }
  }
  if (!arr) return [];
  fog.mask = arr.join('');

  const out = [];
  for (const ci of dirty) {
    const qx = ci % per;
    const qy = Math.floor(ci / per);
    const h = chunkHashAt(fog, qx, qy);
    if (fog.chunkHash[ci] === h) continue;
    fog.chunkHash[ci] = h;
    fog.chunkStamp[ci] = tick;
    out.push([qx, qy]);
  }
  return out;
}

/** 아바타(군주)가 선 자리를 즉시 밝힌다 — lordMove 가 부른다 */
export function revealAvatar(nation, data, tick, x, y, avatarId = null) {
  const charm = avatarId ? nightVisionOf(nation, avatarId, data) : bestNightVision(nation, data);
  return stampVisionDisc(nation, data, tick, x, y,
    fogCfg(data).vision.lord + visionTierBonus(nation, data) + charm);
}

export function fogValue(nation, x, y) {
  const fog = nation.fog;
  if (!fog) return 2;
  if (x < 0 || y < 0 || x >= fog.size || y >= fog.size) return 0;
  return fog.mask.charCodeAt(y * fog.size + x) - 48;
}

export const isExplored = (nation, x, y) => fogValue(nation, x, y) >= 1;
export const isVisible = (nation, x, y) => fogValue(nation, x, y) >= 2;

/** 청크 하나를 RLE 로 — [cx, cy, v,count, v,count, ...] */
export function encodeChunk(fog, cx, cy) {
  const c = fog.chunk;
  const size = fog.size;
  const out = [cx, cy];
  let prev = null;
  let run = 0;
  for (let y = cy * c; y < Math.min(size, (cy + 1) * c); y += 1) {
    for (let x = cx * c; x < Math.min(size, (cx + 1) * c); x += 1) {
      const v = fog.mask.charCodeAt(y * size + x) - 48;
      if (v === prev) { run += 1; continue; }
      if (prev !== null) out.push(prev, run);
      prev = v;
      run = 1;
    }
  }
  if (prev !== null) out.push(prev, run);
  return out;
}

/** sinceTick 이후에 바뀐 청크만 뽑는다 (PROTOCOL v2 worldDiff.fog) */
export function fogChunksSince(nation, sinceTick) {
  const fog = nation.fog;
  if (!fog) return [];
  const per = Math.ceil(fog.size / fog.chunk);
  const out = [];
  for (let ci = 0; ci < fog.chunkStamp.length; ci += 1) {
    if (fog.chunkStamp[ci] <= sinceTick) continue;
    out.push(encodeChunk(fog, ci % per, Math.floor(ci / per)));
  }
  return out;
}

/** 전체 안개 스냅샷 (join 시 1회) */
export function fogSnapshot(nation, data) {
  const fog = nation.fog;
  if (!fog) return null;
  const per = Math.ceil(fog.size / fog.chunk);
  const chunks = [];
  for (let cy = 0; cy < per; cy += 1) for (let cx = 0; cx < per; cx += 1) chunks.push(encodeChunk(fog, cx, cy));
  return { size: fog.size, chunk: fog.chunk, chunks };
}

/** 탐사 진척도 — 목표 카드/업적용 */
export function exploredRatio(nation) {
  const fog = nation.fog;
  if (!fog) return 1;
  let n = 0;
  for (let i = 0; i < fog.mask.length; i += 1) if (fog.mask.charCodeAt(i) > 48) n += 1;
  return n / fog.mask.length;
}
