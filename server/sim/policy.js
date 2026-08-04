// 무접속 시뮬레이션용 정책 봇 — 「성실한 플레이어」를 흉내낸다.
// 엔진 명령(commands.js)만 사용하므로 실제 플레이와 동일한 경로를 탄다.
// ★ GDD3 §10 — 봇은 **플레이어 스윙 노동**까지 근사한다: 하루 botPlayerSwingsPerDay 회를
//   실제 actionSwing 으로 흘려보낸다(쿨타임·사거리·노드 잔량·스킬 XP 전부 진짜 경로를 탄다).
import { collectHooks } from '../engine/artifacts.js';
import { buildingCost, canAfford } from '../engine/build_cost.js';
import { townOf, territoryRadius, dist } from '../engine/world.js';
import { applyCommand } from '../engine/commands.js';
import { settlementTier, nextTierStatus } from '../engine/tiers.js';
import {
  buildingUnlocked, departmentsActive, featureUnlocked, chapterIndex, chapterView, ensureProgress,
} from '../engine/progression.js';
import { freeBeds, grainDays, militiaList } from '../engine/residents.js';
import { turretList, structuresOf, findStructure, maxTier } from '../engine/structures.js';
import { aliveFences } from '../engine/fences.js';
import { daysUntilWave, nextWaveSpec } from '../engine/waves.js';
import { swingCooldownMs, ensurePlayer } from '../engine/skills.js';
// ★ GDD3 §13-A-5 — 곳간이 차면 채집이 무효다. 봇도 사람처럼 궤짝을 더 짓는다.
import { storageLimit } from '../engine/storage.js';

const BOT_AVATAR = 'sim';

/**
 * 건설 우선순위 — 위에서부터 지을 수 있는 것을 짓는다.
 * ★ v3.1 — 해금 판정은 buildingUnlocked(=지금 장) 하나가 한다. 여기 `when` 은 '필요한가'만 본다.
 *   장 사슬의 목표 건물은 아래 chainCommands 가 **먼저** 집어 주므로, 이 목록은 그 사이를 메우는 살림살이다.
 */
const BUILD_PLAN = [
  { key: 'tent', when: (c) => c.freeBeds < 1 && c.chapter <= 3, max: 2 },
  { key: 'hut', when: (c) => c.freeBeds < 2, max: 6 },
  { key: 'hunter_hut', when: (c) => c.grainDays < 6, max: 2 },
  { key: 'granary', when: () => true, max: 1 },
  { key: 'sawmill', when: () => true, max: 1 },
  { key: 'quarry_camp', when: () => true, max: 1 },
  { key: 'house', when: (c) => c.freeBeds < 3, max: 8 },
  { key: 'arrow_tower', when: () => true, max: 8 },
  { key: 'storage', when: () => true, max: 3 },
  { key: 'well', when: () => true, max: 2 },
  { key: 'woodpile', when: () => true, max: 2 },
  { key: 'trading_post', when: () => true, max: 1 },
  { key: 'smithy', when: () => true, max: 1 },
  { key: 'smelter', when: () => true, max: 1 },
  { key: 'mine_shaft', when: () => true, max: 1 },
  { key: 'watchpost', when: () => true, max: 1 },
  { key: 'barracks', when: () => true, max: 3 },
  { key: 'shrine', when: () => true, max: 1 },
  { key: 'ballista', when: () => true, max: 5 },
  { key: 'manor', when: (c) => c.freeBeds < 4, max: 8 },
  { key: 'mill', when: () => true, max: 1 },
  { key: 'market', when: () => true, max: 1 },
  { key: 'cannon', when: () => true, max: 2 },
];

/** 그 순간의 정착지 형편 */
/** 상한 대비 가장 꽉 찬 자원의 비율 (0~1) */
function storageUsedRatio(nation, data) {
  const limit = storageLimit(nation, data);
  if (!(limit > 0)) return 0;
  let worst = 0;
  for (const res of data.resources.order) {
    worst = Math.max(worst, (nation.resources?.[res] || 0) / limit);
  }
  return Math.min(1, worst);
}

function context(world, nation, data) {
  const chapter = chapterView(world, nation, data);
  return {
    tier: settlementTier(nation),
    chapter: chapter?.id ?? 1,
    goal: chapter?.goal ?? null,
    freeBeds: freeBeds(nation, data),
    grainDays: grainDays(nation, data),
    waveDays: daysUntilWave(world, nation),
    turrets: turretList(nation, data).length,
    fences: aliveFences(nation).length,
    militia: militiaList(nation, data).length,
    population: Math.floor(nation.population),
    /* ★ §13-A-5 — 가장 많이 쌓인 자원이 상한의 몇 할까지 찼는가 */
    storageUsed: storageUsedRatio(nation, data),
  };
}

/**
 * ★ 사슬을 따라가는 손 — 「마커가 가리키는 대로만」 움직이는 플레이어의 근사.
 *   목표 카드의 조건을 그대로 읽어서, 그 조건을 끝낼 명령 하나를 집는다.
 *   (자원 목표는 botSwings 가 우선순위로 받아 처리하고, 웨이브 목표는 기다리는 것 말고 할 일이 없다.)
 */
function chainCommands(world, nation, data, ctx) {
  const goal = ctx.goal;
  if (!goal) return [];
  const out = [];
  const conds = goal.condition?.type === 'all' || goal.condition?.type === 'any'
    ? (goal.condition.of || []) : [goal.condition];
  for (const c of conds) {
    if (!c) continue;
    if (c.type === 'structure') {
      const key = c.building;
      const have = structuresOf(nation, key).length;
      const building = (nation.construction || []).some((x) => x.building === key && !x.structureId);
      if (have < (c.count ?? 1) && !building && buildingUnlocked(nation, key, data)) {
        out.push({ type: 'placeBuilding', building: key });
      }
    } else if (c.type === 'flag' && c.flag === 'appraised') {
      if (structuresOf(nation, 'appraisal_post').length && !world.emotionDayDone) {
        out.push({ type: 'appraiseLand' });
      }
    } else if (c.type === 'flag' && c.flag === 'traceFound') {
      // 흔적이 있는 자리까지 걸어간다 — 시간이 아니라 발걸음이 웨이브를 연다
      const trace = ensureProgress(nation).trace;
      if (trace) out.push({ type: 'lordMove', x: trace.x, y: trace.y, avatarId: BOT_AVATAR });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// 스윙 노동 — '플레이어가 붙어서 일한 하루'의 근사
// ────────────────────────────────────────────────────────────────
function needOrder(world, nation, data, ctx) {
  // ★ v3.1 — 맨 앞은 '지금 목표가 요구하는 자원'이다. 목표 카드를 보고 일하는 플레이어의 근사.
  const out = [];
  const goalRes = ctx.goal?.condition?.type === 'resource' ? ctx.goal.condition.resource : null;
  const kindOf = { wood: 'wood', stone: 'stone', grain: 'grain' };
  if (goalRes && kindOf[goalRes]) out.push(kindOf[goalRes]);
  if ((nation.construction || []).length) out.push('site');
  if (ctx.grainDays < 8) out.push('grain');
  out.push('wood', 'stone');
  if (ctx.grainDays >= 8) out.push('grain');
  return [...new Set(out)];
}

/**
 * 봇이 다음에 두드릴 자리.
 * ★ GDD3 §13-B-2 — 자원 군락이 영토 **밖**에 앉으면서, 영토 안만 뒤지면 아무것도 못 찾는다.
 *   반경은 주민 일자리와 같은 자(영토 + workRadiusBonus)를 쓰고, 고르는 기준은 도읍이 아니라
 *   **지금 봇이 서 있는 자리**다 — 사람은 발밑의 군락을 마저 캐지, 매번 집으로 돌아갔다 오지 않는다.
 */
function pickNode(world, nation, data, kind, fromX = null, fromY = null) {
  const town = townOf(world, nation.id);
  const r = territoryRadius(nation, data) + (data.world.villagers.workRadiusBonus ?? 0);
  const ox = fromX == null ? town.x : fromX;
  const oy = fromY == null ? town.y : fromY;
  const types = kind === 'wood' ? ['forest'] : kind === 'stone' ? ['rock'] : ['berry', 'fertile', 'field', 'water'];
  let best = null;
  let bd = Infinity;
  for (const n of world.map?.nodes || []) {
    if (n.hidden || n.depleted || !types.includes(n.type)) continue;
    if (n.concealed && !n.revealed) continue;
    if (dist(n.x, n.y, town.x, town.y) > r + 0.001) continue;
    const d = dist(n.x, n.y, ox, oy);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/**
 * 하루치 스윙을 흘려보낸다. 진짜 actionSwing 을 부르므로 쿨타임·사거리·노드 잔량·스킬 성장이 그대로 적용된다.
 * @returns {{swings:number, byKind:object}}
 */
export function botSwings(world, nation, data, rng, opts = {}) {
  const budget = opts.swingsPerDay ?? data.world.simulation.botPlayerSwingsPerDay ?? 0;
  if (budget <= 0) return { swings: 0, byKind: {} };
  const player = ensurePlayer(nation, BOT_AVATAR, data, '시뮬 개척자');
  const avatars = (nation.avatars ||= {});
  const town = townOf(world, nation.id);
  avatars[BOT_AVATAR] ||= { id: BOT_AVATAR, name: '시뮬 개척자', x: town.x, y: town.y, tick: world.tick, appearance: {} };
  const ctx = context(world, nation, data);
  const order = needOrder(world, nation, data, ctx);
  const byKind = {};
  let done = 0;
  // 결정론: 스윙 시각은 '게임일 시작 + 쿨타임 누적'으로 만든다(실시간 시계를 쓰지 않는다)
  let now = world.tick * data.balance.time.dayRealSeconds * 1000 + 1;

  const baseCd = data.skills.swing.baseCooldownSec * 1000;
  const share = Math.max(1, Math.floor(budget / order.length));
  /* ★ GDD3 §13-B-2 — **걷는 데도 하루가 든다.**
     자원이 영토 밖으로 나간 뒤로 봇을 노드 위에 공짜로 순간이동시키면, 사람이 실제로 겪는
     왕복 시간이 통째로 사라져 시뮬이 게임을 실제보다 후하게 잰다.
     그래서 걸음을 스윙 몫으로 환산해 하루 예산에서 깎는다 —
     한 스윙 시간(1.2초)에 아바타가 걷는 거리(4.6칸/초 × 1.2초 ≈ 5.5칸)가 환산 단위다. */
  const walkPerSwing = data.world.simulation.botWalkTilesPerSwing ?? 5.5;
  const travelCost = (tx, ty) => {
    const a = avatars[BOT_AVATAR];
    const d = dist(a.x, a.y, tx, ty);
    return Math.floor(d / Math.max(0.5, walkPerSwing));
  };
  for (const kind of order) {
    let quota = share;
    let misses = 0;
    while (quota-- > 0 && done < budget && misses < 6) {
      let res;
      if (kind === 'site') {
        const site = (nation.construction || [])[0];
        if (!site) break;
        const walk = travelCost(site.x, site.y);
        if (walk > 0) { done += walk; now += walk * (baseCd + 20); if (done >= budget) break; }
        avatars[BOT_AVATAR].x = site.x; avatars[BOT_AVATAR].y = site.y;
        res = applyCommand(world, nation.id, { type: 'actionSwing', siteId: site.id, avatarId: BOT_AVATAR, now }, data, rng);
      } else {
        const node = pickNode(world, nation, data, kind, avatars[BOT_AVATAR].x, avatars[BOT_AVATAR].y);
        if (!node) break;
        const walk = travelCost(node.x, node.y);
        if (walk > 0) { done += walk; now += walk * (baseCd + 20); if (done >= budget) break; }
        avatars[BOT_AVATAR].x = node.x; avatars[BOT_AVATAR].y = node.y;
        res = applyCommand(world, nation.id, { type: 'actionSwing', nodeId: node.id, avatarId: BOT_AVATAR, now }, data, rng);
      }
      // ★ 시각은 '가장 긴 쿨타임'만큼 밀어 준다 — 스킬마다 쿨이 달라 짧은 쪽 기준으로 밀면 다른 스킬이 막힌다.
      now += baseCd + 20;
      if (!res.ok) { misses += 1; continue; }
      done += 1;
      byKind[kind] = (byKind[kind] || 0) + 1;
    }
  }
  return { swings: done, byKind };
}

// ────────────────────────────────────────────────────────────────
// 하루치 명령
// ────────────────────────────────────────────────────────────────
export function planCommands(world, data, opts = {}) {
  const nation = world.nations[world.playerNationId];
  const cmds = [];
  const hooks = collectHooks(nation, data);
  const ctx = context(world, nation, data);

  // ── 0) ★ 사슬 먼저 — 목표 카드가 가리키는 것을 집는다 ─────────
  cmds.push(...chainCommands(world, nation, data, ctx));

  // ── 0-b) ★ GDD3 §12-2 — 승격은 이제 손이 눌러야 한다.
  //   조건이 차면 곧바로 누르는 것이 '보통 플레이어'의 근사다(땅이 넓어져야 지을 자리가 생긴다).
  if (nextTierStatus(nation, data).ready) cmds.push({ type: 'promoteSettlement' });

  // ── 1) 주민 배치 ─────────────────────────────────────────────
  if ((nation.villagers || []).length) {
    // ★ 성녀가 없으면 '언제 오는지'를 모른다 — 봇도 늦게서야 동원한다(정보 비대칭을 봇도 지킨다).
    const saint = Boolean(nation.roles?.saint?.holder);
    const prepLead = saint ? data.waves.simulation.botPrepareLeadDays : 1;
    const wave = ctx.waveDays;
    const prep = wave != null && wave <= prepLead;
    let alloc;
    if (prep) {
      alloc = { farm: 0.3, factory: 0.06, build: 0.1, defense: 0.5, trade: 0.04 };
    } else if (ctx.grainDays < 3) {
      alloc = { farm: 0.55, factory: 0.1, build: 0.2, defense: 0.12, trade: 0.03 };
    } else if (departmentsActive(nation, data)) {
      alloc = { farm: 0.34, factory: 0.24, build: 0.2, defense: 0.18, trade: 0.04 };
    } else {
      alloc = { farm: 0.34, factory: 0.02, build: 0.3, defense: 0.14, trade: 0.02 };
    }
    cmds.push({ type: 'setVillagerMix', alloc, scout: data.world.simulation.botScoutShare });
  }

  // ── 2) 공장 큐 (부처가 돌 때만 의미가 있다) ───────────────────
  if (departmentsActive(nation, data)) {
    const needFuel = (nation.resources.fuel || 0) < 8 && (nation.resources.oil || 0) > 25;
    cmds.push({ type: 'setQueue', factory: needFuel ? { steel: 0.85, fuel: 0.15, weapon: 0 } : { steel: 1, fuel: 0, weapon: 0 } });
  }

  /* ── 2-b) ★ §13-A-5 곳간 — **정말 넘칠 때만, 덤으로** 짓는다 ──
     상한에 닿으면 캐는 손이 통째로 멎으니 지어야 한다. 다만 두 가지를 지킨다.
       ① 살림 목록(BUILD_PLAN)에 끼워 넣지 않는다 — 하루 한 칸을 빼앗으면 방어가 늦는다.
       ② **넘치기 직전에만** 짓는다. 실측: 문턱 0.85에서 미리 지으니 웨이브5 생존율이 70%→35%로 무너졌다(0.99에서 65%).
          쌓일 자리가 남았는데 곳간부터 늘리는 것은 사람도 하지 않는 짓이다.
     저장고(250)를 궤짝(80)보다 먼저 본다 — 한 칸으로 세 배를 번다. */
  const waveSoon = ctx.waveDays != null && ctx.waveDays <= 4;
  const idleYard = (nation.construction || []).length === 0;      // 짓던 것이 없을 때만
  if (ctx.storageUsed > 0.99 && !waveSoon && idleYard) {
    for (const key of ['storage', 'storage_crate']) {
      if (!buildingUnlocked(nation, key, data)) continue;
      if (structuresOf(nation, key).length >= (key === 'storage_crate' ? 6 : 3)) continue;
      if ((nation.construction || []).some((c) => c.building === key && !c.structureId)) continue;
      const priced = buildingCost(nation, key, 1, data, hooks);
      if (!priced || !canAfford(nation, priced.cost, priced.gold)) continue;
      cmds.push({ type: 'placeBuilding', building: key });
      break;
    }
  }

  // ── 3) 건설 — 우선순위 하나씩 ────────────────────────────────
  const pending = (nation.construction || []).length;
  if (pending < 2) {
    for (const plan of BUILD_PLAN) {
      if (!plan.when(ctx)) continue;
      if (!buildingUnlocked(nation, plan.key, data)) continue;
      if (structuresOf(nation, plan.key).length >= plan.max) continue;
      if ((nation.construction || []).some((c) => c.building === plan.key && !c.structureId)) continue;
      const priced = buildingCost(nation, plan.key, 1, data, hooks);
      if (!priced || !canAfford(nation, priced.cost, priced.gold)) continue;
      cmds.push({ type: 'placeBuilding', building: plan.key });
      break;
    }
  }

  // ── 4) 개별 업그레이드 — 자재가 남으면 가장 값싼 것을 올린다 ──
  if (pending < 2 && departmentsActive(nation, data)) {
    const candidates = (nation.structures || [])
      .filter((s) => s.tier < maxTier(s.key, data) && !(nation.construction || []).some((c) => c.structureId === s.id))
      .map((s) => ({ s, priced: buildingCost(nation, s.key, s.tier + 1, data, hooks) }))
      .filter((x) => x.priced && canAfford(nation, scaled(x.priced.cost, 1.6), x.priced.gold + 40))
      .sort((a, b) => costWeight(a.priced.cost) - costWeight(b.priced.cost));
    if (candidates.length) cmds.push({ type: 'upgradeStructure', structureId: candidates[0].s.id });
  }

  // ── 5) 울타리 — 티어 2부터 한 조각씩 두른다 ───────────────────
  const fenceCmd = planFence(world, nation, data, ctx);
  if (fenceCmd) cmds.push(fenceCmd);

  // ── 6) 수리 ─────────────────────────────────────────────────
  const broken = (nation.structures || []).find((s) => (s.hp ?? 0) < (s.maxHp ?? 0) * 0.6);
  if (broken) cmds.push({ type: 'repairStructure', structureId: broken.id });
  if (aliveFences(nation).length < (nation.fences || []).length) cmds.push({ type: 'repairFence' });

  // ── 7) 작전 — 상성 전술을 고른다 (성녀가 있어야 적을 미리 안다) ─
  if (ctx.waveDays != null && ctx.waveDays <= 3) {
    const spec = nextWaveSpec(world, nation, data);
    if (nation.roles?.saint?.holder && spec.weakTo) cmds.push({ type: 'setBattlePlan', tactic: spec.weakTo });
  }

  // ── 8) 도구 · 무역 (티어 3+) ─────────────────────────────────
  if (structuresOf(nation, 'smithy').length) {
    const wTier = (nation.buildings.tools.weapon || 0) + 1;
    const wDef = data.buildings.tools.weapon.tiers[wTier - 1];
    if (wDef && nation.gold >= wDef.gold + 60 && (nation.resources.oil || 0) >= (wDef.oil || 0)) {
      cmds.push({ type: 'buyTool', tool: 'weapon', tier: wTier });
    }
  }

  // ── 9) 성역 버프 ─────────────────────────────────────────────
  const sanct = nation.sanctuary || {};
  if (nation.roles?.saint?.holder && !sanct.active && world.tick + 1 >= (sanct.cooldownUntilTick ?? 0)) {
    cmds.push({ type: 'saintBuff', resource: 'grain' });
  }

  // ── 10) 결정 큐 정리 ─────────────────────────────────────────
  for (const d of (nation.decisionQueue || []).slice(0, 3)) {
    const accept = d.kind === 'trade_offer' && d.offer?.side === 'sell';
    cmds.push({ type: 'decide', decisionId: d.decisionId, choice: accept ? 'accept' : 'reject' });
  }
  return cmds;
}

const scaled = (cost, k) => Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, v * k]));
const costWeight = (cost) => Object.values(cost).reduce((a, b) => a + b, 0);

/**
 * 울타리 계획 — 정착지 둘레를 한 번에 다 두르지 않는다(자재가 다 빨린다).
 * 8분할 호를 하나씩, 자재가 넉넉할 때만 친다.
 */
function planFence(world, nation, data, ctx) {
  if (!buildingUnlocked(nation, 'fence', data)) return null;
  const town = townOf(world, nation.id);
  const r = Math.max(4, territoryRadius(nation, data) - 3);
  const arcs = 8;
  const done = nation.fenceArcs || 0;
  if (done >= arcs) return null;
  const perSegment = data.buildings.fence.tiers[0].cost.wood;
  const estimate = Math.ceil((2 * Math.PI * r) / arcs) + 2;
  if ((nation.resources.wood || 0) < estimate * perSegment + 60) return null;
  const points = [];
  const from = (done / arcs) * Math.PI * 2 - Math.PI / 2;
  const to = ((done + 1) / arcs) * Math.PI * 2 - Math.PI / 2;
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    points.push({ x: Math.round(town.x + Math.cos(a) * r), y: Math.round(town.y + Math.sin(a) * r) });
  }
  nation.fenceArcs = done + 1;
  return { type: 'placeFence', points, gates: done === 0 ? [0] : [] };
}

export { BUILD_PLAN, BOT_AVATAR };
