// 전장의 안개 — docs/WORLD.md §1 · §2. 자국 마스크만 서버가 만든다.
//   0 = 미탐사(검정) / 1 = 탐사됨(어둡게, 정적 정보만) / 2 = 시야(밝음)
// 청크(16×16) 단위 스탬프를 찍어 worldDiff 가 '바뀐 청크'만 보낸다.
//
// ★ §21-A3 — 마스크는 **런타임에서 Uint8Array**, **세이브 파일에서만 문자열**이다.
//   문자열은 불변이라 한 칸을 밝히려면 통째로 다시 지어야 했다: 384² = 147,456 글자를
//   split('') 로 흩고 join('') 으로 다시 붙였다 — 아바타가 한 걸음 뗄 때마다 30만 개의 할당이다.
//   Uint8Array 는 제자리에서 고쳐 쓰므로 그 전부가 사라진다(걸음당 밝아진 칸 수만큼만 쓴다).
//   전송 계약은 손대지 않았다 — 클라는 예나 지금이나 encodeChunk 의 RLE 만 받는다(PROTOCOL v3.0).
//   저장 계약도 그대로다 — packFogMasks 가 파일에 쓰기 직전에만 옛 '0'/'1'/'2' 문자열로 되돌린다.
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

// ────────────────────────────────────────────────────────────────
// ★ §21-A3 — 마스크 코덱. 런타임(Uint8Array) ↔ 세이브(문자열 '0'/'1'/'2').
//   경계는 딱 둘이다: 파일에 쓰기 직전(packFogMasks) · 옛 세이브를 열 때(toRuntimeFog).
// ────────────────────────────────────────────────────────────────
const LATIN1 = new TextDecoder('latin1');

/** Uint8Array → 옛 문자열 포맷. 저장 한 번에 한 번만 돈다(걸음마다가 아니다). */
export function maskToString(mask) {
  if (typeof mask === 'string') return mask;
  const chars = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) chars[i] = mask[i] + 48;   // 0,1,2 → '0','1','2'
  return LATIN1.decode(chars);
}

/** 옛 문자열 포맷 → Uint8Array. 세이브를 열 때 한 번만 돈다. */
export function maskFromString(text) {
  if (text instanceof Uint8Array) return text;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) - 48;
  return out;
}

/**
 * fog 하나를 런타임 모양으로 맞춘다 — **몇 번을 불러도 같다**(migrateWorld 가 매 틱 부른다).
 * gen 은 exploredRatio 캐시의 열쇠라 없으면 0 부터 시작한다(§21-A3 아래 주석 참고).
 */
export function toRuntimeFog(fog) {
  if (!fog) return fog;
  if (typeof fog.mask === 'string') fog.mask = maskFromString(fog.mask);
  fog.gen ??= 0;
  return fog;
}

/**
 * 저장 직전 한 번 — 마스크만 문자열로 되돌린 **얕은 사본**을 준다.
 * 「왜 사본인가」 — 살아 있는 월드의 fog.mask 를 문자열로 바꿔 버리면 그 다음 걸음이
 * 다시 split/join 세상으로 굴러떨어진다. 바꿔 끼우는 자리는 nations[].fog 뿐이라 얕은 복사로 충분하다.
 */
export function packFogMasks(state) {
  const nations = state?.nations;
  if (!nations) return state;
  const out = { ...state, nations: { ...nations } };
  for (const [id, nation] of Object.entries(nations)) {
    if (!(nation.fog?.mask instanceof Uint8Array)) continue;
    out.nations[id] = { ...nation, fog: { ...nation.fog, mask: maskToString(nation.fog.mask) } };
  }
  return out;
}

/** 새 나라의 초기 안개 — 도읍 주변만 탐사된 상태로 시작한다 */
export function createFog(world, nation, data) {
  const size = data.world.size;
  const n = chunkCount(data);
  const fog = {
    size,
    chunk: fogCfg(data).chunk,
    mask: new Uint8Array(size * size),
    gen: 0,
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
  /* ★ §17-14 — 깃발로 얻은 점령지도 본영처럼 스스로 밝다(우리 땅인데 안 보이면 이상하다) */
  for (const c of nation.claims || []) {
    out.push({ kind: 'claim', x: c.x, y: c.y, r: c.radius + 2 });
  }
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

  /* ★ §21-A3 — vis 를 그대로 새 마스크로 승격시킨다(1 → 2 로 덮어쓰고, 나머지는 옛 값을 물려받는다).
     예전엔 여기서 147k 짜리 Array 를 새로 잡고 join 으로 문자열까지 지었다 — 둘 다 없앤다. */
  const prev = toRuntimeFog(fog).mask;
  for (let i = 0; i < total; i += 1) {
    if (vis[i]) { vis[i] = 2; continue; }
    if (prev[i] > 0) vis[i] = 1;
  }
  fog.mask = vis;
  bumpGen(fog);

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

/**
 * 청크 하나의 FNV-1a 해시 — '이 청크가 바뀌었나'의 판정 기준.
 * ★ §21-A3 — `+ 48` 은 장식이 아니다. 옛 세이브에 적혀 있는 chunkHash 는 문자 코드('0'=48)로
 *   구운 값이다. 여기서 0/1/2 를 그대로 넣으면 **모든 청크가 처음 한 번 「바뀌었다」로 읽혀**
 *   접속하자마자 24×24 청크 전량이 worldDiff 로 쏟아진다. 값을 옛 눈금에 맞춰 두면 그 일이 없다.
 */
function chunkHashAt(fog, cx, cy) {
  const c = fog.chunk;
  const size = fog.size;
  let h = 2166136261 >>> 0;
  for (let y = cy * c; y < Math.min(size, (cy + 1) * c); y += 1) {
    for (let x = cx * c; x < Math.min(size, (cx + 1) * c); x += 1) {
      h ^= fog.mask[y * size + x] + 48;
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

  // ★ §21-A3 — 제자리 쓰기. 새로 밝아진 칸 하나당 바이트 하나만 건드린다(사본이 없다).
  const mask = toRuntimeFog(fog).mask;
  const dirty = new Set();
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * size + x;
      if (mask[i] >= 2) continue;                   // 이미 시야(2)
      mask[i] = 2;
      dirty.add(Math.floor(y / c) * per + Math.floor(x / c));
    }
  }
  if (!dirty.size) return [];                       // 같은 자리를 다시 두드리면 공짜다
  bumpGen(fog);

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
  return fog.mask[y * fog.size + x];
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
      const v = fog.mask[y * size + x];
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

/**
 * 탐사 진척도 — 목표 카드/업적용.
 *
 * ★ Sprint 3 — 이 한 줄이 384² = 147,456 칸을 세었다. NationView 마다 한 번이니 접속자 수만큼,
 *   명령 하나에도 방 전체가 그만큼을 다시 센다. 그래서 「마스크가 바뀌었는가」를 싸게 묻는
 *   지문을 캐시 열쇠로 삼는다.
 *
 * ★ §21-A3 — 그 지문을 **세대 카운터**로 갈아 끼웠다. 옛 지문은 청크 해시 576개의 합이었는데,
 *   ① 셈이 매번 576번 돌고 ② 합은 서로 다른 안개를 같은 값으로 읽을 수 있으며(덧셈은 자리를 잃는다)
 *   ③ 무엇보다 chunkHash 는 *전송*을 위한 값이라 캐시가 거기에 얹혀 있을 까닭이 없다.
 *   이제 마스크를 고쳐 쓰는 두 자리(recomputeFog · stampVisionDisc)가 gen 을 하나 올린다 —
 *   비교는 정수 하나이고, 「바뀌었는데 안 바뀐 척」이 원리적으로 불가능하다.
 *   ⚠ 마스크를 손으로 주무르는 코드(시험 도구 등)는 bumpGen 을 함께 불러야 한다.
 *
 * 캐시는 **WeakMap 이다**: fog 객체 자체는 스냅샷에 실리므로 거기에 값을 얹으면 저장 파일이
 * 캐시를 물고 다니게 되고, 일 틱의 structuredClone 이 낡은 값을 그대로 복제해 온다.
 * @type {WeakMap<object, {stamp:number, value:number}>}
 */
const RATIO_CACHE = new WeakMap();

/** ★ §21-A3 — 마스크가 바뀌었음을 알리는 유일한 표식. exploredRatio 캐시의 열쇠다. */
export function bumpGen(fog) {
  if (!fog) return 0;
  fog.gen = (fog.gen ?? 0) + 1;
  return fog.gen;
}

export function exploredRatio(nation) {
  const fog = nation.fog;
  if (!fog) return 1;
  const stamp = fog.gen ?? 0;
  const hit = RATIO_CACHE.get(fog);
  if (hit && hit.stamp === stamp) return hit.value;
  const mask = toRuntimeFog(fog).mask;
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i] > 0) n += 1;
  const value = n / mask.length;
  RATIO_CACHE.set(fog, { stamp, value });
  return value;
}
