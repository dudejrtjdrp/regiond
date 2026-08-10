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
/* ★ §19-F4(F09-1) — 연구소가 늘려 주는 하루 걸음. structures.js 와 서로를 부르지만(순환)
   둘 다 모듈이 다 세워진 **뒤에** 함수 안에서만 부른다 — ESM 의 살아 있는 바인딩이라 안전하다. */
import { researchSpeedBonus, researchHasteDiscount } from './structures.js';

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

/** 끝난 연구가 주는 산출 보정 — 증기기관 +15% · ★ Sprint 4 내연기관 +20% (합산) */
export function productionBonus(nation, data) {
  let bonus = 0;
  for (const key of RESEARCH_KEYS(data)) {
    if (!researchDone(nation, key)) continue;
    bonus += researchDef(key, data)?.effects?.productionBonus ?? 0;
  }
  return round3(bonus);
}

/** ★ Sprint 4 — 끝난 연구가 주는 **채집** 보정(자원별 합산). 농정술(곡물)·석공술(석재)이 쓴다.
    productionBonus 와 같은 결(effects 합산)이고, 주민 채집(티어 0~2 residentYield 의 형편 배수)과
    3티어+ 매크로 채집(tick.produceNation) **양쪽에** 같은 값이 붙는다 — 두 층이 다른 답을 내면
    3티어 진입 순간 산출이 튄다(§13-A-3 「같은 값은 같은 함수」 원칙). */
export function gatherResearchBonus(nation, data, resource) {
  let bonus = 0;
  for (const key of RESEARCH_KEYS(data)) {
    if (!researchDone(nation, key)) continue;
    bonus += researchDef(key, data)?.effects?.gatherBonus?.[resource] ?? 0;
  }
  return round3(bonus);
}

// ────────────────────────────────────────────────────────────────
// ★ §19-F4(F09-1) 연구소 — 여는 문은 그대로, 하루의 걸음만 늘린다
// ────────────────────────────────────────────────────────────────
export const labsCfg = (data) => researchCfg(data).labs ?? null;

/** 이 연구가 속한 갈래(land·machine). 안 적힌 옛 자료는 갈래가 없다 — 가속도 없다. */
export const researchField = (key, data) => researchDef(key, data)?.field ?? null;

/** 하루가 깎는 날수 = 1 + 연구소 배수. 연구소가 없으면 정확히 1 이다(옛 세이브 불변).
    ★ §20-R4(§20-3 기관장의 인장) — 유물의 연구 속도 배수를 여기서 곱한다. collectHooks 를
    부르지 않고 tick.js 가 하루 한 번 박아 두는 거울을 읽는다: 이 함수는 하루 정산뿐 아니라
    화면·조언이 「며칠 남았나」를 셀 때도 불리는 자리라 그때마다 유물 목록을 돌 수 없다.
    유물이 없으면 배수가 1 이라 곱셈이 값을 바꾸지 않는다. */
export function researchStep(nation, key, data) {
  const artifact = nation.artifactResearchSpeed ?? 1;
  return round3((1 + researchSpeedBonus(nation, researchField(key, data), data)) * artifact);
}

/** 화면이 읽는 칸 — 갈래마다 지금 몇 할이 붙어 있는가 */
export function labsView(nation, data) {
  const cfg = labsCfg(data);
  if (!cfg) return null;
  const fields = Object.entries(cfg.fields || {}).map(([key, f]) => ({
    key, name: f.name, bonus: researchSpeedBonus(nation, key, data),
  }));
  return { fields, maxBonus: cfg.maxBonus ?? 1, hasteDiscount: researchHasteDiscount(nation, data) };
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
    // ★ §19-F4(F09-1) — 갈래와 지금 붙은 걸음. 화면이 「하루에 1.4일」을 그대로 적는다.
    field: def.field ?? null, step: researchStep(nation, key, data),
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
    // ★ §19-F3(F07-5) — 붙들고 있는 궁리를 금화로 앞당길 수 있는가. 화면이 이 칸만 보고 단추를 그린다.
    haste: hasteView(nation, data),
    // ★ §19-F4(F09-1) — 연구소가 갈래마다 얹어 준 걸음
    labs: labsView(nation, data),
    productionBonus: productionBonus(nation, data),
    railsOpen: researchFeature(nation, 'rails', data),
    doneCount: list.filter((x) => x.done).length,
  };
}

// ────────────────────────────────────────────────────────────────
// ★ §19-F3(F07-5) 연구 가속 — 금화가 흘러갈 자리 하나
//   「왜」 하루씩만 당기는가 — 한 번에 다 사 버리면 연구가 '기다림'이 아니라 '값'이 된다.
//   하루치씩 사게 두면 급한 궁리에만 돈을 붓는 선택이 남는다.
// ────────────────────────────────────────────────────────────────
export const hasteCfg = (data) => researchCfg(data).haste ?? null;

/** 하루를 당기는 값 = 그 연구가 들었던 금화의 goldRatio 배(최소 goldMin).
    ★ §19-F4 — 대학당이 서 있으면 그 몫만큼 깎인다(nation 을 안 주면 예전 값 그대로). */
export function hasteCost(key, data, nation = null) {
  const h = hasteCfg(data);
  if (!h) return 0;
  const def = researchDef(key, data);
  const base = Math.max(h.goldMin ?? 0, Math.round((def?.gold ?? 0) * (h.goldRatio ?? 0)));
  return Math.round(base * (1 - (nation ? researchHasteDiscount(nation, data) : 0)));
}

/** 화면이 읽는 칸 — 지금 당길 수 있는가, 얼마인가 */
export function hasteView(nation, data) {
  const h = hasteCfg(data);
  const active = ensureResearch(nation).active;
  if (!h || !active) return null;
  const gold = hasteCost(active.key, data, nation);
  const room = active.remainingDays > (h.minRemainingDays ?? 1);
  return { key: active.key, gold, days: h.maxDaysPerUse ?? 1, ready: room && nation.gold >= gold, room };
}

/**
 * 남은 날을 days 만큼 깎는다 — 금화든 특산품(지혜의 잎)이든 같은 문으로 들어온다.
 * @returns {number} 실제로 깎인 날수(0 이면 깎을 자리가 없었다)
 */
export function applyResearchDays(nation, days, data) {
  const h = hasteCfg(data);
  const active = ensureResearch(nation).active;
  if (!active || !(days > 0)) return 0;
  const floor = h?.minRemainingDays ?? 1;
  const cut = Math.min(days, Math.max(0, active.remainingDays - floor));
  active.remainingDays = round2(active.remainingDays - cut);
  return cut;
}

/** hastenResearch — 금화로 하루를 산다 */
export function hastenResearch(world, nation, data) {
  const h = hasteCfg(data);
  const active = ensureResearch(nation).active;
  if (!h) return err('NO_HASTE', '연구를 앞당기는 길이 없습니다.');
  if (!active) return err('NO_RESEARCH', '붙들고 있는 연구가 없습니다.');
  const gold = hasteCost(active.key, data, nation);
  if (nation.gold < gold) return err('NO_GOLD', `금화가 모자랍니다 — ${gold} 이 듭니다.`);
  const cut = applyResearchDays(nation, h.maxDaysPerUse ?? 1, data);
  if (!cut) return err('ALMOST_DONE', '내일이면 끝납니다 — 더 당길 자리가 없습니다.');
  nation.gold = round2(nation.gold - gold);
  nation.stats.goldSpent = round2((nation.stats.goldSpent || 0) + gold);
  return { ok: true, key: active.key, days: cut, gold, remainingDays: active.remainingDays };
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
  /* ★ §19-F4(F09-1) — 하루가 깎는 날수. 연구소가 없으면 1 이라 옛 판과 한 칸도 다르지 않다. */
  r.active.remainingDays = round2(r.active.remainingDays - researchStep(nation, r.active.key, data));
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
    /* ★ 2단계B — 띠 안에서 다시 몫을 자른다(spawn.band, 없으면 띠 전체 = 옛 값 그대로).
       「왜」 — 링1 은 영토+10 부터 영토+32 까지인데 주민·동료의 작업 반경은 영토+26 이다. 띠를 통째로
       쓰면 심은 것의 4분의 1이 손이 닿지 않는 자리에 앉는다. 뽑는 난수의 횟수는 한 번 그대로다. */
    const frac = spawn.band ?? [0, 1];
    const span = band[1] - band[0];
    const lo = band[0] + span * frac[0];
    const hi = band[0] + span * frac[1];
    let center = null;
    for (let i = 0; i < 120 && !center; i += 1) {
      const a = r.float(0, Math.PI * 2);
      const rad = r.float(lo, hi);
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

/* ★ 파생 캐시는 **나라 객체에 얹지 않는다** (spatial.js 규율 ① · fog.js RATIO_CACHE 와 같은 자리).
   Set 은 JSON.stringify 를 지나면 `{}` 가 된다. 캐시를 nation 에 얹어 두었더니 그 빈 객체가
   snapshot.json 에 실려 저장됐고, 세이브를 물고 뜬 서버는 「스탬프가 맞으니 유효한 캐시」로 읽어
   `.has is not a function` 로 첫 걸음(companions.walkable)에서 죽었다 — 재시작할 때마다 똑같이.
   WeakMap 에 매달면 일 틱의 structuredClone 이 새 나라를 만들 때 캐시도 저절로 새로 나고,
   스냅샷에는 한 바이트도 실리지 않는다.
   @type {WeakMap<object, Map<string, {set:Set<string>, len:number}>>} */
const TILE_SETS = new WeakMap();

/** 나라가 가진 칸 집합 하나(rails·bridges·fills). 길이가 달라지면 다시 짓는다. */
function tileSet(nation, key, list) {
  let per = TILE_SETS.get(nation);
  if (!per) { per = new Map(); TILE_SETS.set(nation, per); }
  const hit = per.get(key);
  if (hit && hit.len === list.length) return hit.set;
  const set = new Set(list.map((t) => railKey(t.x, t.y)));
  per.set(key, { set, len: list.length });
  return set;
}

/** 캐시를 버린다 — 길이가 그대로인 채 내용만 바뀌는 찰나(놓고 지우기)를 막는 자물쇠. */
function dropTileSet(nation, key) {
  TILE_SETS.get(nation)?.delete(key);
}

export function railSet(nation) {
  return tileSet(nation, 'rails', nation.rails || []);
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
  dropTileSet(nation, 'rails');
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
  dropTileSet(nation, 'rails');
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
    noResearch: '다리를 아직 모릅니다.', noPiece: '그런 다리 조각이 없습니다.',
    capMsg: '다리를 더 놓을 수 없습니다.',
  },
  fill: {
    cfgOf: fillCfg, feature: 'landfill', list: 'fills', nextId: 'nextFillId', prefix: 'fl',
    noResearch: '매립을 아직 모릅니다.', noPiece: '그런 매립 칸이 없습니다.',
    capMsg: '더 메울 수 없습니다.',
  },
};

function overlaySet(nation, o) {
  return tileSet(nation, o.list, nation[o.list] || []);
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
  dropTileSet(nation, o.list);
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
  dropTileSet(nation, o.list);
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
