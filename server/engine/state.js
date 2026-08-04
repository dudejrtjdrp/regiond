// 상태 스키마 & 초기 상태 생성 — docs/GDD3.md.
// ★ v3(엔드리스 정착지): 시즌·인구 50 시작·국가 티어 건물·자동 성곽은 전부 폐기됐다.
//   플레이어는 마차에서 내린 개척자다 — 주민 0, 모닥불 하나, 티어 0.
import { createRng } from './rng.js';
import { defaultName } from './npc.js';
import { normalizeDifficulty } from './difficulty.js';
import { generateWorldMap, townOf } from './world.js';
import { createVillagers } from './villagers.js';
import { createFog } from './fog.js';
import { tierRadius, settlementTier } from './tiers.js';
import { completeStructure, syncLegacyBuildings, anchorFromCell } from './structures.js';
// ★ GDD3 §13-D-1 — 옛 세이브의 주민에게 능력치를 채워 넣을 때 쓴다
import { rollStats, statRng } from './traits.js';

function emptyResources(data, overrides = null) {
  const start = data.balance.startingResources || {};
  return Object.fromEntries(data.resources.order.map((r) => [r, (overrides?.[r] ?? start[r] ?? 0)]));
}

/**
 * 역할 초기 구성.
 * ★ GDD3 §1 — 역할은 티어 3(감정의 날) 전에는 존재하지 않는다. assignments 를 명시하면(시뮬·테스트) 그대로 쓴다.
 */
function makeRoles(data, { isPlayer, assignments = null, vacant = null }) {
  const roles = {};
  data.roles.order.forEach((key, i) => {
    let holder;
    if (assignments) holder = key === vacant ? null : (assignments[key] ?? null);
    else holder = isPlayer ? null : 'npc';
    roles[key] = {
      holder,
      name: holder ? defaultName(key, i) : null,
      level: 0,
      xp: 0,
      handoverUntilTick: null,
      activity: 0,
    };
  });
  return roles;
}

/** 테스트·시뮬용 기본 위임 구성 — 6역할 전부 NPC(또는 vacant 1자리 공석) */
export function npcAssignments(data, { vacant = null } = {}) {
  return Object.fromEntries(data.roles.order.filter((k) => k !== vacant).map((k) => [k, 'npc']));
}

export function createNation(id, name, opts, data, rng) {
  const b = data.balance;
  const res = emptyResources(data, opts.startingResources);
  const isPlayer = Boolean(opts.isPlayer);
  const nation = {
    id,
    name,
    isPlayer,
    aiPersona: opts.aiPersona ?? null,
    aiPolicy: opts.aiPolicy ?? null,
    tags: opts.tags ?? [],
    tagsRevealed: Boolean(opts.tagsRevealed),
    // ── 성장 아크 (GDD3 §1) ─────────────────────────────────────
    tier: isPlayer ? 0 : 3,                    // AI 3국은 이미 자리 잡은 나라다
    territory: { radius: isPlayer ? tierRadius(0, data) : data.world.territory.aiBaseRadius },
    prestige: 0,
    // ── 공간 계층 ───────────────────────────────────────────────
    structures: [],
    nextStructureId: 1,
    fences: [],
    nextFenceId: 1,
    villagers: [],
    nextResidentId: 1,
    arrivalProgress: 0,
    avatars: {},
    players: {},                                // 아바타별 스킬·체력 (GDD3 §3)
    fog: null,
    // ── 매크로 계층 (검증된 엔진 그대로) ─────────────────────────
    population: opts.startingPopulation ?? (isPlayer ? b.population.startingPopulation : 50),
    populationCap: 0,
    morale: b.morale.default,
    gold: opts.startingGold ?? b.gold.startingGold,
    resources: res,
    laborAlloc: { ...b.labor.defaultAlloc },
    gatherScale: { wood: 1, stone: 1 },
    storageBonus: 0,
    factoryQueue: { ...b.factoryQueue },
    roles: makeRoles(data, { isPlayer, assignments: opts.assignments, vacant: opts.vacant }),
    // ★ 레거시 거울 — 검증된 매크로 공식이 읽는다(structures.syncLegacyBuildings 가 매 틱 채운다)
    buildings: {
      granary: 0, storage: 0, shrine: 0, barracks: 0, consulate: 0, road: 0, workshop: 0, wall: 0,
      tools: { hoe: 0, pickaxe: 0, weapon: 0 },
    },
    construction: [],
    nextSiteId: 1,
    buildPoints: 0,
    defense: { permanent: 0, surge: 0 },
    // ── 엔드리스 웨이브 (GDD3 §6) ────────────────────────────────
    wave: { index: 0, arrivalTick: null, scheduledTick: null, history: [] },
    battle: null,
    lastBattleResult: null,
    battlePlan: null,
    rubberBandMultiplier: null,
    orders: [],
    artifacts: [],
    artifactState: { immunities: {}, freeUpgrades: {}, costDiscounts: {}, tariffZeroCharges: 0 },
    decisionQueue: [],
    reports: [],
    buffs: [],
    sanctuary: { active: false, resource: null, expiresTick: null, cooldownUntilTick: 0 },
    soilFatigue: 0,
    starvationDays: 0,
    rationing: false,
    online: isPlayer,
    lastSeenTick: 0,
    autoExport: b.gold.autoExportDefault,
    exportFloors: {},
    stats: {
      goldEarned: 0, goldSpent: 0, tradeVolume: 0, imports: 0, consumption: 0,
      invasionsWon: 0, invasionsLost: 0, peakPopulation: 0, residentsArrived: 0,
    },
    members: [],
    ap: { current: b.actionPoints.max, max: b.actionPoints.max, day: 0 },
    apState: { inspiredDepts: [], workedNodes: [] },
    ruinGauge: 0,
    // ★ GDD3 §13-B-4 — 뒤진 유적 중 가장 큰 것의 등급 보정. 다음에 열 상자의 급을 밀어 올린다.
    ruinGradeBoost: 0,
    // ★ GDD3 §13-C — 들에 사는 것들 · 도감(조우·처치 장부)
    wild: { creatures: [], nextId: 1, respawnQueue: [], rngState: null, acc: 0 },
    codex: { species: {}, ruins: {} },
    survey: null,
    autoAssist: b.advisor.autoAssistDefault,
    autoAssistIdleTicks: 0,
    mandateDone: false,
  };
  return nation;
}

export function createWorld({ gameId, seed = 42, data, playerName = '플레이어', assignments, vacant, difficulty } = {}) {
  const rng = createRng(seed);
  const difficultyKey = normalizeDifficulty(difficulty, data);
  const pendingTags = ['fertile', 'holy'];

  const world = {
    gameId: gameId ?? `g_${seed}_${Date.now().toString(36)}`,
    schema: 5,                       // ★ v3.2 = 월드 2.0(군락·유한 자원·유적 크기) + 생태계. schema<5 세이브는 읽지 않는다.
    seed,
    difficulty: difficultyKey,
    rngState: rng.getState(),
    tick: 0,
    phase: 'endless',
    paused: false,
    emotionDayDone: false,
    mandateOpen: false,
    midShockFired: false,
    playerNationId: 'player',
    nations: {},
    camps: [],
    offers: [],
    councils: [],
    chat: [],
    chronicle: [],
    chronicleSeq: 0,
    log: [],
    createdAt: Date.now(),
  };

  world.map = generateWorldMap(seed, data, { playerTags: pendingTags });

  world.nations.player = createNation('player', `${playerName}의 정착지`, {
    isPlayer: true,
    tags: [],
    assignments,
    vacant,
  }, data, rng);
  world.nations.player.pendingTags = pendingTags;

  const bonus = data.difficulty.presets[difficultyKey].startingBonus || {};
  for (const [res, v] of Object.entries(bonus)) {
    world.nations.player.resources[res] = (world.nations.player.resources[res] || 0) + v;
  }

  for (const ai of data.aiNations.nations) {
    world.nations[ai.id] = createNation(ai.id, ai.name, {
      isPlayer: false,
      aiPersona: ai.persona,
      aiPolicy: ai.policy,
      tags: ai.tags,
      tagsRevealed: false,
      startingPopulation: ai.startingPopulation,
      startingGold: ai.startingGold,
      startingResources: ai.startingResources,
    }, data, rng);
  }

  for (const nation of Object.values(world.nations)) {
    if (!nation.isPlayer) continue;
    createVillagers(world, nation, data);
    createFog(world, nation, data);
    // ★ GDD3 §2 · §12-2 — 마차가 멈춘 자리에 모닥불 하나. 게임의 첫 건물이자 부활 지점이고,
    //   정착지가 자라면 그대로 본부(야영 본부→촌락 회관→…)가 되는 4×4 대형 구조물이다.
    //   도읍 좌표가 풋프린트의 **중심**이 되도록 앵커를 물려 잡는다.
    const town = townOf(world, nation.id);
    const anchor = anchorFromCell('campfire', town?.x ?? 0, town?.y ?? 0, data);
    completeStructure(world, nation, { building: 'campfire', tier: 1, x: anchor.x, y: anchor.y, placed: true }, data);
    syncLegacyBuildings(nation, data);
  }
  return world;
}

export { townOf };

// ────────────────────────────────────────────────────────────────
// 세이브 정책
// v1(8×8 타일)·v2(시즌 오픈월드)·**v3(128×128 · 티어 해금)** 스냅샷은 이관하지 않는다.
// ★ v3.1 에서 월드가 256×256 이 되고 해금의 정본이 장(chapter)으로 옮겨졌다.
// ★ v3.2(schema 5) 에서 **땅 자체가 다시 그려졌다** — 자원이 군락으로 앉고, 시작 영토가 비워지고,
//   유적에 크기가 생기고, 들에 짐승이 산다. 옛 지도에는 군락도 딸기 들도 없고 영토 한복판에
//   나무가 박혀 있다. 억지로 이어 붙이면 「새 규칙 위에 옛 땅」이 되므로 만나면 버리고 새로 판다.
// ────────────────────────────────────────────────────────────────
export function isLegacySnapshot(world) {
  if (!world) return false;
  return !(world.schema >= 5);
}

export function migrateWorld(world, data) {
  if (!world) return world;
  if (isLegacySnapshot(world)) return null;
  if (world.difficulty == null) world.difficulty = data.difficulty.default;
  world.camps ||= [];
  world.chat ||= [];
  world.chronicle ||= [];
  for (const nation of Object.values(world.nations || {})) {
    nation.tier ??= nation.isPlayer ? 0 : 3;
    nation.territory ||= { radius: tierRadius(settlementTier(nation), data) };
    nation.structures ||= [];
    nation.nextStructureId ||= 1;
    nation.fences ||= [];
    nation.nextFenceId ||= 1;
    nation.nextResidentId ||= 1;
    nation.players ||= {};
    nation.avatars ||= {};
    nation.wave ||= { index: 0, arrivalTick: null, scheduledTick: null, history: [] };
    nation.gatherScale ||= { wood: 1, stone: 1 };
    nation.apState ||= { inspiredDepts: [], workedNodes: [] };
    nation.buildings ||= {};
    nation.buildings.tools ||= { hoe: 0, pickaxe: 0, weapon: 0 };
    nation.stats ||= {};
    nation.prestige ??= 0;
    // ★ 진행 감독 — 장 상태(국가 단위). 없으면 1장부터.
    nation.progress ||= { chapter: 1, step: 0, cleared: [], flags: {}, trace: null };
    // ★ GDD3 §13-C — 생태계·도감. 둘 다 국가 단위라 같이 접속한 동료와 공유된다.
    nation.wild ||= { creatures: [], nextId: 1, respawnQueue: [], rngState: null, acc: 0 };
    nation.codex ||= { species: {}, ruins: {} };
    /* ★ GDD3 §13-D — RPG 계층. 셋 다 **없으면 없는 대로** 굴러가는 자리라 세이브를 버리지 않는다.
       옛 세이브의 주민에게는 능력치가 없다 — 아이디로 씨앗을 지어 사람마다 다른 값을 채운다
       (전부 5.5 로 채우면 옛 마을만 개성 없는 판박이가 된다). */
      if (!u.stats) u.stats = rollStats(statRng(`${world.seed}:${nation.id}:${u.id}`), data);
    }
  }
  return world;
}

/** ★ 엔드리스 — 국면은 시즌이 아니라 정착지 티어다 */
export function phaseForTick(tick, world, data) {
  return 'endless';
}

export function cloneState(state) {
  return structuredClone(state);
}
