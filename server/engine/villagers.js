// 백성 배치 권위 — docs/WORLD.md §2 · §5.
// 서버는 "누가 어떤 노드/일자리에 배치됐나"만 권위로 관리한다. 걷는 연출·경로는 클라의 몫이다.
// ★ 이 모듈의 핵심 계약: laborAlloc 은 더 이상 슬라이더가 아니라 '배치의 파생값'이다.
//   referenceMix 대로 배치하면 옛 balance.json labor.defaultAlloc 과 채집 계수가 그대로 재현된다.
import { townOf, territoryRadius, dist, nodeById } from './world.js';

export const vCfg = (data) => data.world.villagers;
export const labCfg = (data) => data.world.laborDerivation;

export const JOB_ORDER = (data) => vCfg(data).jobs;

// ────────────────────────────────────────────────────────────────
// 일자리(target) 해석
// ────────────────────────────────────────────────────────────────
/** 이 나라가 지금 쓸 수 있는 '일자리' 전부. 노드 + 도읍/성벽/건물/건설 현장. */
export function listTargets(world, nation, data) {
  const cfg = vCfg(data);
  const town = townOf(world, nation.id);
  const out = [];
  if (town) {
    out.push({ id: 'hall', kind: 'post', post: 'hall', name: '정착지', x: town.x, y: town.y, slots: cfg.postSlots.hall });
    // ★ GDD3 §7 — 자동 성곽 링은 폐지됐다. 수비 자리는 울타리 조각 위에 선다.
    const fences = (nation.fences || []).filter((f) => (f.hp ?? 0) > 0);
    const step = Math.max(1, Math.ceil(fences.length / 8));
    for (let i = 0; i < fences.length; i += step) {
      const f = fences[i];
      out.push({
        id: `fence:${f.id}`, kind: 'post', post: 'fence',
        name: f.gate ? '문' : '울타리',
        x: Math.round((f.x1 + f.x2) / 2), y: Math.round((f.y1 + f.y2) / 2),
        slots: 3,
      });
    }
  }
  for (const s of nation.structures || []) {
    const slots = data.buildings[s.key]?.workSlots ?? cfg.postSlots[s.key];
    if (!slots) continue;
    out.push({
      id: s.id, kind: 'post', post: s.key,
      name: data.buildings[s.key]?.name ?? s.key,
      x: s.x, y: s.y, slots,
    });
  }
  for (const c of nation.construction || []) {
    if (c.x == null) continue;
    out.push({ id: c.id, kind: 'site', post: 'site', name: `${data.buildings[c.building]?.name ?? c.building} 공사`, x: c.x, y: c.y, slots: cfg.postSlots.site });
  }
  // ★ GDD3 §13-B-2 — 자원 군락은 영토 **밖**에 앉는다. 그래서 일자리 반경도 영토를 넘는다.
  //   (영토 안만 보면 노드가 하나도 없어 배치가 통째로 무너진다 — 군락 개편의 필수 짝이다.)
  const town2 = town;
  const radius = territoryRadius(nation, data) + (vCfg(data).workRadiusBonus ?? 0);
  for (const n of world.map?.nodes || []) {
    if (n.hidden || n.depleted) continue;
    if (n.concealed && !n.revealed) continue;
    if (!town2 || dist(n.x, n.y, town2.x, town2.y) > radius + 0.001) continue;
    const def = data.world.nodes.types[n.type];
    if (!def) continue;
    out.push({ id: n.id, kind: 'node', nodeType: n.type, name: def.name, x: n.x, y: n.y, slots: def.slots, node: n });
  }
  return out;
}

export function resolveTarget(world, nation, id, data) {
  return listTargets(world, nation, data).find((t) => t.id === id) ?? null;
}

/** 이 일자리에서 할 수 있는 직업들 */
export function jobsForTarget(target, data) {
  const map = vCfg(data).jobTargets;
  const jobs = [];
  for (const job of vCfg(data).jobs) {
    const spec = map[job];
    if (!spec) continue;
    if (target.kind === 'node' && (spec.nodeTypes || []).includes(target.nodeType)) jobs.push(job);
    if (target.kind !== 'node' && (spec.posts || []).includes(target.post)) jobs.push(job);
  }
  return jobs;
}

/** 그 직업이 붙을 수 있는 일자리 — 도읍에서 가까운 순 */
export function targetsForJob(world, nation, job, data) {
  const spec = vCfg(data).jobTargets[job];
  if (!spec) return [];
  const town = townOf(world, nation.id);
  return listTargets(world, nation, data)
    .filter((t) => (t.kind === 'node'
      ? (spec.nodeTypes || []).includes(t.nodeType)
      : (spec.posts || []).includes(t.post)))
    .sort((a, b) => (town ? dist(a.x, a.y, town.x, town.y) - dist(b.x, b.y, town.x, town.y) : 0));
}

// ────────────────────────────────────────────────────────────────
// 레지스트리
// ────────────────────────────────────────────────────────────────
/**
 * 대표 백성 유닛 생성.
 * ★ 유닛 수는 maxUnits 로 고정한다. 인구는 매크로 수치 그대로이고 1유닛 ≈ 인구/유닛수 명이다.
 *   (유닛 수를 인구에 비례시키면 초반 12유닛에서 배치 비율의 눈금이 8%가 되어
 *    파생 laborAlloc 이 검증 밸런스를 벗어난다 — 정밀도 때문에 고정으로 둔다.)
 */
/**
 * ★ GDD3 §4 — 인구 0에서 시작한다. 마차에서 내린 자리에는 아무도 없다.
 *   주민은 residents.stepArrivals 가 한 명씩 들인다(주거 수용력·식량·매력도 조건).
 *   AI 국가는 매크로 인구만 쓰므로 유닛을 만들지 않는다.
 */
export function createVillagers(world, nation, data) {
  nation.villagers = [];
  nation.population = 0;
  return nation.villagers;
}

export function peoplePerUnit(nation) {
  const n = (nation.villagers || []).length || 1;
  return (nation.population || n) / n;
}

export function jobCounts(nation, data) {
  const counts = Object.fromEntries(vCfg(data).jobs.map((j) => [j, 0]));
  for (const u of nation.villagers || []) counts[u.job] = (counts[u.job] || 0) + 1;
  return counts;
}

// ────────────────────────────────────────────────────────────────
// 배치 → 매크로 입력 (WORLD.md §5 접합 규칙)
// ────────────────────────────────────────────────────────────────
/**
 * 부처별 환산 배수 — defaultAlloc[dept] ÷ (그 부처에 매핑된 referenceMix 합).
 * referenceMix 가 60유닛의 정확한 60분의 n 이라, 기준 배치에서는 옛 기본 배분이 오차 없이 재현된다.
 */
export function deptScales(data) {
  const cfg = labCfg(data);
  const base = data.balance.labor.defaultAlloc;
  const refByDept = {};
  for (const [job, dept] of Object.entries(cfg.jobToDept)) {
    refByDept[dept] = (refByDept[dept] || 0) + (cfg.referenceMix[job] || 0);
  }
  const out = {};
  for (const dept of Object.keys(base)) out[dept] = refByDept[dept] > 0 ? base[dept] / refByDept[dept] : 0;
  return out;
}

/**
 * 배치 비율 → laborAlloc · 채집 스케일 (WORLD.md §5 접합 규칙).
 *   laborAlloc[dept] = (그 부처 직업 비율 합) × deptScale[dept]
 *   gatherScale[res] = (그 채집 직업 비율) ÷ referenceMix[job]
 * referenceMix 로 배치하면 둘 다 옛 기본값(농40·공20·건16·방20·무역4 / 채집 ×1.0)이 정확히 나온다.
 */
export function deriveLabor(nation, data) {
  const cfg = labCfg(data);
  const units = (nation.villagers || []).length;
  if (!units) return null;
  const counts = jobCounts(nation, data);
  const mix = Object.fromEntries(Object.entries(counts).map(([j, c]) => [j, c / units]));
  const scales = deptScales(data);

  const alloc = {};
  for (const dept of Object.keys(data.balance.labor.defaultAlloc)) alloc[dept] = 0;
  for (const [job, dept] of Object.entries(cfg.jobToDept)) {
    if (alloc[dept] == null) continue;
    alloc[dept] += (mix[job] || 0) * scales[dept];
  }
  const gatherScale = {};
  for (const [job, res] of Object.entries(cfg.gatherJobs)) {
    const ref = cfg.referenceMix[job] || 1;
    gatherScale[res] = Math.min(cfg.gatherScaleCap, (mix[job] || 0) / ref);
  }
  return { alloc, gatherScale, mix, counts, units };
}

/** alloc(부처 비율) → mix(직업 비율) 역변환. 정책 봇·[각료에게 맡기기]가 쓴다. deriveLabor 의 정확한 역함수다. */
export function mixFromAlloc(alloc, data, opts = {}) {
  const cfg = labCfg(data);
  const ref = cfg.referenceMix;
  const scales = deptScales(data);
  const mix = Object.fromEntries(vCfg(data).jobs.map((j) => [j, 0]));
  const deptJobs = {};
  for (const [job, dept] of Object.entries(cfg.jobToDept)) (deptJobs[dept] ||= []).push(job);

  for (const [dept, jobs] of Object.entries(deptJobs)) {
    const scale = scales[dept] || 1;
    const share = Math.max(0, Number(alloc?.[dept] ?? 0)) / scale;
    if (jobs.length === 1) { mix[jobs[0]] += share; continue; }
    const weights = jobs.map((j) => (ref[j] || 0));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    jobs.forEach((j, i) => { mix[j] += share * (weights[i] / total); });
  }
  const gatherMult = opts.gather || {};
  for (const job of Object.keys(cfg.gatherJobs)) {
    mix[job] = (ref[job] || 0) * (gatherMult[job] ?? 1);
  }
  mix.scout = opts.scout ?? (ref.scout || 0);

  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  if (sum > 1) for (const k of Object.keys(mix)) mix[k] /= sum;
  return mix;
}

/** 최대 잔여법 — 합이 정확히 units 가 되도록 반올림한다(파생 laborAlloc 오차 최소화) */
export function quota(mix, units, data) {
  const jobs = vCfg(data).jobs;
  const raw = jobs.map((j) => Math.max(0, Number(mix[j] ?? 0)) * units);
  const base = raw.map((v) => Math.floor(v));
  let rest = units - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (rest > 0 && order.length) {
    base[order[k % order.length].i] += 1;
    rest -= 1;
    k += 1;
  }
  // 남으면(합이 넘치면) 뒤에서부터 깎는다
  let over = base.reduce((a, b) => a + b, 0) - units;
  for (let i = jobs.length - 1; i >= 0 && over > 0; i -= 1) {
    const take = Math.min(over, base[i]);
    base[i] -= take;
    over -= take;
  }
  return Object.fromEntries(jobs.map((j, i) => [j, base[i]]));
}

// ────────────────────────────────────────────────────────────────
// 배치
// ────────────────────────────────────────────────────────────────
function place(world, nation, unit, target, job, data) {
  unit.job = job;
  unit.targetId = target ? target.id : null;
  unit.destX = target ? target.x : unit.x;
  unit.destY = target ? target.y : unit.y;
  if (target && target.kind === 'node') markHarvestCycle(target.node, data, world.tick);
  return unit;
}

/**
 * 비율 배치 API — 좌표 없이 직업 비율만 준다. 정책 봇·시뮬·[각료에게 맡기기]가 이걸 쓴다.
 * 노드가 모자라 배치할 자리가 없으면 그 유닛은 대기(idle)가 된다 — "아무도 벌목 안 하면 0" 규칙.
 */
export function assignByMix(world, nation, mix, data) {
  const units = nation.villagers || [];
  if (!units.length) return null;
  const want = quota(mix, units.length, data);
  const pool = [...units];
  const assigned = new Set();
  const used = new Map();       // targetId -> 사용 슬롯

  const takeFor = (job, n) => {
    const out = [];
    // 이미 그 일을 하던 유닛부터 — 배치가 덜 출렁이게
    for (const u of pool) {
      if (out.length >= n) break;
      if (assigned.has(u.id) || u.job !== job) continue;
      out.push(u); assigned.add(u.id);
    }
    for (const u of pool) {
      if (out.length >= n) break;
      if (assigned.has(u.id)) continue;
      out.push(u); assigned.add(u.id);
    }
    return out;
  };

  const jobs = vCfg(data).jobs.filter((j) => j !== 'idle');
  for (const job of jobs) {
    const n = want[job] || 0;
    if (n <= 0) continue;
    const crew = takeFor(job, n);
    if (job === 'scout') {
      for (const u of crew) place(world, nation, u, null, 'scout', data);
      continue;
    }
    const targets = targetsForJob(world, nation, job, data);
    if (!targets.length) { for (const u of crew) place(world, nation, u, null, 'idle', data); continue; }
    // 라운드로빈 — 한 노드에 몰지 않고 넓게 편다(가동 노드 수 = 노드 기여의 근거).
    let i = 0;
    for (const u of crew) {
      let target = null;
      for (let k = 0; k < targets.length; k += 1) {
        const cand = targets[(i + k) % targets.length];
        if ((used.get(cand.id) || 0) < cand.slots) { target = cand; break; }
      }
      i += 1;
      if (!target) { place(world, nation, u, null, 'idle', data); continue; }
      used.set(target.id, (used.get(target.id) || 0) + 1);
      place(world, nation, u, target, job, data);
    }
  }
  const hall = { id: 'hall', kind: 'post', x: 0, y: 0 };
  const town = townOf(world, nation.id);
  if (town) { hall.x = town.x; hall.y = town.y; }
  for (const u of pool) {
    if (assigned.has(u.id)) continue;
    place(world, nation, u, town ? hall : null, 'idle', data);
  }
  syncNodeWorkers(world, nation, data);
  return deriveLabor(nation, data);
}

/** 부처 비율(alloc) 로 재배치 — setLabor / [각료에게 맡기기] / 논리회로 DEFEND 가 여기로 온다 */
export function assignByAlloc(world, nation, alloc, data, opts = {}) {
  return assignByMix(world, nation, mixFromAlloc(alloc, data, opts), data);
}

/**
 * 개별 명령 — commandVillagers {ids, order}.
 * order.type: 'work'(노드/일자리 배치) | 'move'(이동·대기) | 'scout'(정찰)
 */
export function commandVillagers(world, nation, cmd, data) {
  const ids = Array.isArray(cmd.ids) ? cmd.ids : [];
  const order = cmd.order || {};
  const units = (nation.villagers || []).filter((u) => ids.includes(u.id));
  if (!units.length) return { ok: false, error: { code: 'NO_VILLAGER', message: '고른 백성이 없습니다.' } };

  if (order.type === 'move' || order.type === 'scout') {
    const x = Math.round(Number(order.x));
    const y = Math.round(Number(order.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= data.world.size || y >= data.world.size) {
      return { ok: false, error: { code: 'BAD_POSITION', message: '지도 밖입니다.' } };
    }
    for (const u of units) {
      u.job = order.type === 'scout' ? 'scout' : 'idle';
      u.targetId = null;
      u.destX = x;
      u.destY = y;
    }
    syncNodeWorkers(world, nation, data);
    return { ok: true, moved: units.length, job: order.type === 'scout' ? 'scout' : 'idle', dest: { x, y } };
  }

  if (order.type !== 'work') return { ok: false, error: { code: 'BAD_ORDER', message: '알 수 없는 명령입니다.' } };

  const target = resolveTarget(world, nation, order.nodeId ?? order.targetId, data);
  if (!target) return { ok: false, error: { code: 'BAD_TARGET', message: '영토 안에 그런 일터가 없습니다.' } };
  const jobs = jobsForTarget(target, data);
  const job = order.job && jobs.includes(order.job) ? order.job : jobs[0];
  if (!job) return { ok: false, error: { code: 'NO_JOB', message: '그곳에서 할 수 있는 일이 없습니다.' } };
  if (target.kind === 'node' && target.node?.depleted) {
    return { ok: false, error: { code: 'DEPLETED', message: '다 캐낸 곳입니다.' } };
  }

  let used = (nation.villagers || []).filter((u) => u.targetId === target.id && !ids.includes(u.id)).length;
  const placed = [];
  for (const u of units) {
    if (used >= target.slots) break;
    place(world, nation, u, target, job, data);
    used += 1;
    placed.push(u.id);
  }
  syncNodeWorkers(world, nation, data);
  return {
    ok: true, job, targetId: target.id, placed,
    rejected: units.filter((u) => !placed.includes(u.id)).map((u) => u.id),
    slots: target.slots, used,
  };
}

/** 노드의 workers 카운터 동기화 (고갈·기여 계산의 기준) */
export function syncNodeWorkers(world, nation, data) {
  const counts = new Map();
  for (const u of nation.villagers || []) {
    if (!u.targetId) continue;
    counts.set(u.targetId, (counts.get(u.targetId) || 0) + 1);
  }
  for (const n of world.map?.nodes || []) {
    const c = counts.get(n.id);
    if (c == null && n.workers === 0) continue;
    n.workers = c || 0;
  }
  return counts;
}

// ────────────────────────────────────────────────────────────────
// 매 틱 유지 — 이동 · 고갈 · 재생 · 재배치
// ────────────────────────────────────────────────────────────────
export function stepVillagers(world, nation, data, tick) {
  const speed = vCfg(data).moveTilesPerTick;
  for (const u of nation.villagers || []) {
    const dx = (u.destX ?? u.x) - u.x;
    const dy = (u.destY ?? u.y) - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= speed) { u.x = u.destX ?? u.x; u.y = u.destY ?? u.y; continue; }
    u.x = Math.round(u.x + (dx / d) * speed);
    u.y = Math.round(u.y + (dy / d) * speed);
  }
  return nation.villagers;
}

/**
 * 노드 고갈·재생. 산출 수치는 매크로 공식이 내므로 여기서 자원을 주지는 않는다 —
 * 고갈은 "숲이 옅어짐" 연출과 재배치 압력(가동 노드 수 = 노드 기여)만 만든다.
 */
export function stepNodes(world, data, tick) {
  const types = data.world.nodes.types;
  const tagsOf = (id) => world.nations?.[id]?.tags || [];
  const owner = (n) => (world.map.towns || []).find((t) => dist(t.x, t.y, n.x, n.y)
    <= territoryRadius(world.nations[t.nationId] || {}, data) + 0.001);
  const changed = [];
  for (const n of world.map?.nodes || []) {
    // 자리의 '성숙' — 사람이 붙어 있는 동안만 쌓이고, 비면 처음부터 (노드 기여의 램프)
    if ((n.workers || 0) > 0) n.workedTicks = (n.workedTicks || 0) + 1;
    else if (n.workedTicks) n.workedTicks = 0;
    const def = types[n.type];
    if (!def || !(def.max > 0 || def.amount > 0)) continue;
    const before = n.amount;
    const drain = (def.drainPerWorker || 0) * (n.workers || 0);
    let regen = def.regenPerTick || 0;
    if (def.regenTagMultiplier) {
      const tw = owner(n);
      const tags = tw ? tagsOf(tw.nationId) : [];
      for (const [tag, mult] of Object.entries(def.regenTagMultiplier)) if (tags.includes(tag)) regen *= mult;
    }
    n.amount = Math.max(0, Math.min(n.max, n.amount - drain + regen));
    const wasDepleted = n.depleted;
    n.depleted = n.max > 0 && n.amount <= 0;
    if (n.amount !== before || n.depleted !== wasDepleted) { n.stamp = tick; changed.push(n.id); }
  }
  return changed;
}

/** 고갈된 노드에 붙어 있던 백성을 근처 같은 종류로 자동 이동 (§3 마지막 항목) */
export function reassignDepleted(world, nation, data) {
  if (!vCfg(data).reassignOnDepletion) return [];
  const moved = [];
  for (const u of nation.villagers || []) {
    if (!u.targetId || !u.targetId.startsWith('n')) continue;
    const node = nodeById(world, u.targetId);
    if (node && !node.depleted && !node.hidden) continue;
    const targets = targetsForJob(world, nation, u.job, data)
      .filter((t) => t.kind !== 'node' || !t.node.depleted);
    const used = (id) => (nation.villagers || []).filter((x) => x.targetId === id).length;
    const next = targets.find((t) => used(t.id) < t.slots) ?? null;
    if (next) { place(world, nation, u, next, u.job, data); moved.push({ id: u.id, to: next.id }); }
    else { place(world, nation, u, null, 'idle', data); moved.push({ id: u.id, to: null }); }
  }
  if (moved.length) syncNodeWorkers(world, nation, data);
  return moved;
}

// ────────────────────────────────────────────────────────────────
// 노드 기여 · 정액 산출 (옛 tileContribution / tileFlatYield 의 이관)
// ────────────────────────────────────────────────────────────────
/**
 * 가동 중(백성이 붙은) 노드 1곳당 해당 산출 +perNode×weight, rich 면 곱절, 상한 cap.
 * ★ 옛 타일 지정 곡선을 그대로 옮기기 위한 두 가지 문턱이 있다(data/world.json nodes.contribution._note):
 *   - requiresEmotionDay: 땅의 내력이 드러나기 전에는 기여가 없다 (옛 타일은 감정의 날에 공개됐다)
 *   - maturityTicks: 사람이 붙어 며칠 일해야 그 자리가 제 몫을 한다 (옛 '하루 몇 칸씩 지정' 램프)
 */
export function nodeContribution(world, nation, data) {
  const cfg = data.world.nodes.contribution;
  const out = { grain: 0, wood: 0, stone: 0 };
  if (cfg.requiresEmotionDay && !world.emotionDayDone) return out;
  const mature = cfg.maturityTicks ?? 0;
  for (const n of workedNodes(world, nation, data)) {
    if ((n.workedTicks || 0) < mature) continue;
    const def = data.world.nodes.types[n.type];
    const res = def?.contributes;
    if (!res || out[res] == null) continue;
    out[res] += cfg.perNode * (def.contributionWeight ?? 1) * (n.rich ? (def.richMultiplier ?? 2) : 1);
  }
  for (const k of Object.keys(out)) out[k] = Math.min(cfg.cap, out[k]);
  return out;
}

/** 철광맥·유막처럼 '붙어 있으면 정액으로 나오는' 산출 (옛 광맥 노두 +2/일) */
export function nodeFlatYield(world, nation, data) {
  const out = {};
  for (const n of workedNodes(world, nation, data)) {
    const def = data.world.nodes.types[n.type];
    if (!def?.flatYield) continue;
    for (const [r, v] of Object.entries(def.flatYield)) {
      out[r] = (out[r] || 0) + v * (n.rich ? (def.richMultiplier ?? 2) : 1);
    }
  }
  return out;
}

export function workedNodes(world, nation, data) {
  const ids = new Set();
  for (const u of nation.villagers || []) if (u.targetId && u.targetId.startsWith('n')) ids.add(u.targetId);
  const out = [];
  for (const n of world.map?.nodes || []) {
    if (!ids.has(n.id) || n.depleted || n.hidden) continue;
    out.push(n);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// 수확 (§C-2 이관) — 밭 노드
// ────────────────────────────────────────────────────────────────
export function markHarvestCycle(node, data, tick) {
  if (!node) return null;
  const def = data.world.nodes.types[node.type];
  if (!def?.harvest) { node.readyAt = null; node.stage = null; return null; }
  if (node.readyAt == null) node.readyAt = tick + data.balance.harvest.readyEveryTicks;
  node.stage = fieldStage(node, data, tick);
  return node.readyAt;
}

export function isHarvestReady(node, data, tick) {
  if (!node) return false;
  const def = data.world.nodes.types[node.type];
  return Boolean(def?.harvest) && node.readyAt != null && tick >= node.readyAt;
}

// ────────────────────────────────────────────────────────────────
// 밭 성장 단계 (WORLD.md §13 재배 루프) — 파종 → 새싹 → 성장 → 수확기.
// ★ 서버가 노드 상태(node.stage)로 관리한다. 산출 수치에는 전혀 관여하지 않는 '클라 스프라이트용' 필드다.
// ────────────────────────────────────────────────────────────────
export const harvestStages = (data) => data.balance.harvest.stages || [];

/** 한 주기 안의 진행도 0~1 (readyAt 이 없으면 방금 파종한 것으로 본다) */
export function fieldGrowth(node, data, tick) {
  const cfg = data.balance.harvest;
  const def = data.world.nodes.types[node?.type];
  if (!def?.harvest) return null;
  if (node.readyAt == null) return 0;
  const period = Math.max(1, cfg.readyEveryTicks);
  const left = node.readyAt - tick;
  if (left <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - left / period));
}

/** 진행도 → 단계 키 */
export function fieldStage(node, data, tick) {
  const stages = harvestStages(data);
  const g = fieldGrowth(node, data, tick);
  if (g == null || !stages.length) return null;
  let key = stages[0].key;
  for (const s of stages) if (g + 1e-9 >= s.at) key = s.key;
  return key;
}

/** 클라용 상세 — 단계 키·표시명·진행도 */
export function fieldStageView(node, data, tick) {
  const stages = harvestStages(data);
  const key = fieldStage(node, data, tick);
  if (key == null) return { stage: null, stageName: null, growth: null };
  const def = stages.find((s) => s.key === key) ?? null;
  return { stage: key, stageName: def?.name ?? key, growth: Math.round(fieldGrowth(node, data, tick) * 100) / 100 };
}

/**
 * 매 틱 밭 단계 갱신. 단계가 바뀐 노드만 stamp 를 찍어 worldDiff 로 흘려보낸다.
 * 수확하지 않고 두면 '수확기'에 머문다 — 접속 못 한 죄책감 금지 원칙(§13-6).
 */
export function stepFields(world, data, tick) {
  const changed = [];
  for (const n of world.map?.nodes || []) {
    const def = data.world.nodes.types[n.type];
    if (!def?.harvest) continue;
    if (n.readyAt == null) continue;
    const next = fieldStage(n, data, tick);
    if (next === n.stage) continue;
    n.stage = next;
    n.stamp = tick;
    changed.push({ id: n.id, stage: next });
  }
  return changed;
}
