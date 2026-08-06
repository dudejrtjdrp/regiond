// data/*.json 로더. 매직넘버 금지 원칙에 따라 엔진은 이 모듈을 통해서만 수치를 얻는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicAppearance, publicChat } from './social.js';
import { publicBuildings } from './structures.js';
import { publicWaves } from './waves.js';
import { publicChapters } from './progression.js';
// ★ GDD3 §13-D — RPG 계층의 공개본(규칙만). 사람마다·나라마다의 실제 값은 state 로만 간다.
import { publicStats } from './traits.js';
import { publicEquipment } from './equipment.js';
import { publicResearch } from './research.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(here, '..', '..', 'data');

function readJson(name) {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));
}

let cache = null;

export function loadGameData({ reload = false } = {}) {
  if (cache && !reload) return cache;
  const data = {
    balance: readJson('balance.json'),
    resources: readJson('resources.json'),
    buildings: readJson('buildings.json'),
    roles: readJson('roles.json'),
    tags: readJson('tags.json'),
    invasions: readJson('invasions.json'),
    artifacts: readJson('artifacts.json'),
    aiNations: readJson('ai_nations.json'),
    events: readJson('events.json'),
    templates: readJson('templates.ko.json'),
    difficulty: readJson('difficulty.json'),
    ruins: readJson('ruins.json'),
    world: readJson('world.json'),
    // ★ GDD3 — 엔드리스 정착지 성장의 세 축
    tiers: readJson('tiers.json'),
    skills: readJson('skills.json'),
    waves: readJson('waves.json'),
    // ★ GDD3 §11 — 콘텐츠 사슬. 진행 감독(progression.js)이 이 표 하나로 게임의 모든 문을 연다.
    chapters: readJson('chapters.json'),
    // ★ GDD3 §13-C — 상시 생태계(동물·야생 적)와 도감의 층
    creatures: readJson('creatures.json'),
    // ★ GDD3 §13-D — RPG 계층: 장비·인첸트의 규격과 기술 트리
    equipment: readJson('equipment.json'),
    research: readJson('research.json'),
    // ★ GDD3 §15-C — 동료 봇(= 각료). 정원·이름·활동량 다이얼·자리별 선호 행동
    companions: readJson('companions.json'),
    // ★ §18-D2 — 링0 앞마당의 흔적(단서 사슬 · 미시 발견). 배치·보상·문구를 전부 이 파일이 쥔다.
    trails: readJson('trails.json'),
  };
  data.artifactsByKey = Object.fromEntries(data.artifacts.list.map((a) => [a.key, a]));
  cache = data;
  return cache;
}

export function listDataFiles() {
  return readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();
}

/**
 * 전술 옵션 공개본.
 * ★ 정보 비대칭: 전술 '선택지'만 공개한다. 상성표(어떤 적에 무엇이 듣는지)는
 *   국방대신 Lv3+ / 플레이어 국방 담당일 때만 NationView 로 간다.
 */
export function publicTactics(d = loadGameData()) {
  const t = d.invasions.tactics;
  return {
    options: t.options.map(({ key, name, desc }) => ({ key, name, desc })),
    default: { tactic: t.default.tactic },
  };
}

/** 건국 화면용 난이도 프리셋 공개본 */
export function publicDifficulty(d = loadGameData()) {
  return {
    default: d.difficulty.default,
    order: [...d.difficulty.order],
    presets: Object.fromEntries(d.difficulty.order.map((k) => {
      const p = d.difficulty.presets[k];
      return [k, {
        key: p.key, name: p.name, desc: p.desc,
        invasionPowerMultiplier: p.invasionPowerMultiplier,
        defeatLossMultiplier: p.defeatLossMultiplier,
        startingBonus: { ...p.startingBonus },
        migrationMultiplier: p.migrationMultiplier,
        hintJitterDays: p.hintJitterDays,
        midShock: { ...p.midShock },
        rubberBand: { ...p.rubberBand },
      }];
    })),
  };
}

/**
 * 성장 아크 공개본 — 클라의 '목표 카드'와 '연대기'가 이 표로 그린다.
 * ★ 여기 있는 것은 규칙(조건·해금·반경)뿐이다. 지금 그 나라가 몇 티어인지는 state 로만 간다.
 */
export function publicTiers(d = loadGameData()) {
  return {
    speedBonusPerTier: d.tiers.speedBonusPerTier,
    maxDefinedTier: d.tiers.maxDefinedTier,
    endless: { ...d.tiers.endless },
    levels: d.tiers.levels.map((l) => ({
      tier: l.tier, name: l.name, radius: l.radius,
      requires: structuredClone(l.requires || {}),
      unlocks: structuredClone(l.unlocks || {}),
      line: l.line ?? null,
      milestone: l.milestone ?? null,
    })),
  };
}

/** 개인 스킬 공개본 — 스윙 쿨/수확 배수/도구 해금 레벨 (클라 스킬 UI가 이 표로 그린다) */
export function publicSkills(d = loadGameData()) {
  return {
    order: [...d.skills.order],
    maxLevel: d.skills.maxLevel,
    defs: Object.fromEntries(Object.entries(d.skills.defs).map(([k, v]) => [k, {
      name: v.name, nodeTypes: [...(v.nodeTypes || [])], targets: [...(v.targets || [])], toolTrack: v.toolTrack,
    }])),
    swing: { ...d.skills.swing },
    xpCurve: [...d.skills.xpCurve],
    tools: structuredClone(d.skills.tools),
    smithyToolLevelDiscount: d.skills.smithyToolLevelDiscount,
    nodes: structuredClone(d.skills.nodes),
    site: { ...d.skills.site },
    combat: { ...d.skills.combat },
    /* ★ GDD3 §14-5 — 레벨 곡선과 능력치의 '규칙'. 내가 어디에 몇 점을 부었는지는 state 로만 간다. */
    player: structuredClone(d.skills.player ?? {}),
  };
}

/**
 * 오픈월드 다이얼 공개본.
 * ★ 정보 비대칭: 지형 시드·노드 좌표는 여기 없다. 월드 실체는 join 후 `world` 스냅샷으로만 간다.
 */
export function publicWorld(d = loadGameData()) {
  const w = d.world;
  return {
    size: w.size,
    /* ★ §17-17 — biomes 는 '어떤 코드가 새 땅인가'만 공개한다. 위도·문턱(어디에 나는가)은 지형 시드와
       같은 급의 비밀이라 내려보내지 않는다(정보 비대칭 원칙 — 걸어서 찾아야 한다). */
    terrain: {
      codes: [...w.terrain.codes], names: { ...w.terrain.names },
      buildable: [...w.terrain.buildable], walkable: [...w.terrain.walkable],
      biomeCodes: [...(w.terrain.biomes?.codes || [])],
    },
    nodes: {
      order: [...w.nodes.order],
      types: Object.fromEntries(Object.entries(w.nodes.types).map(([k, v]) => [k, {
        name: v.name, job: v.job, resource: v.resource, slots: v.slots,
        harvest: Boolean(v.harvest), explorable: Boolean(v.explorable), subsurface: Boolean(v.subsurface),
        contributes: v.contributes ?? null,
      }])),
      contribution: { perNode: w.nodes.contribution.perNode, cap: w.nodes.contribution.cap },
      // ★ §17-12 — 걷어내기 규격. 노드 패널이 [걷어낸다] 단추와 환급 예고를 이 표로 그린다.
      clear: w.nodes.clear ? {
        onlyTerritory: w.nodes.clear.onlyTerritory !== false,
        refundRatio: w.nodes.clear.refundRatio,
        refundResource: { ...w.nodes.clear.refundResource },
        minRefund: { ...(w.nodes.clear.minRefund || {}) },
      } : null,
      // ★ GDD3 §13-B — 군락·재생·유적 크기. 화면이 바닥 질감과 「옅어짐」을 같은 규칙으로 그린다.
      clusters: w.nodes.clusters ? {
        clearRadius: w.nodes.clusters.clearRadius, ring: [...(w.nodes.clusters.ring || [])],
      } : null,
      regrow: w.nodes.regrow ? { byType: structuredClone(w.nodes.regrow.byType), fadeAt: w.nodes.regrow.fadeAt } : null,
      ruinSizes: w.nodes.ruinSizes ? {
        revealRadius: w.nodes.ruinSizes.revealRadius,
        table: (w.nodes.ruinSizes.table || []).map((t) => ({ size: t.size, name: t.name, swings: t.swings })),
      } : null,
    },
    // ★ GDD3 §13-B-5 — 스폰 링. 화면이 링2 경고를 서버와 **같은 식으로** 잰다.
    rings: w.rings ? {
      ring0Margin: w.rings.ring0Margin, ring1Span: w.rings.ring1Span,
      warnRing: w.rings.warnRing, warnText: w.rings.warnText,
    } : null,
    territory: {
      baseRadius: w.territory.baseRadius,
      // ★ §17-14 — 깃발 점령 규격. 고스트가 「본영에서 너무 멉니다」를 서버와 같은 자로 잰다.
      claim: w.territory.claim ? (({ _note, ...c }) => c)(w.territory.claim) : null,
    },
    // ★ GDD3 §13-A-2 — 화면 밝기 다이얼(밤 하한·낮 상향·안개 장막). 화면이 이 표만 보고 조명을 켠다.
    light: w.light ? {
      phases: (w.light.phases || []).map((p) => ({ ...p })),
      fogVeil: w.light.fogVeil,
      buildVeil: w.light.buildVeil,
      minLuma: w.light.minLuma,
    } : null,
    // ★ §17-16 — 이웃 도읍 찾아가기 반경. 화면이 「E — 찾아가기」를 서버와 **같은 자**로 잰다.
    towns: { visitRadius: w.towns.visitRadius ?? 6 },
    /* ★ §18-D2 — 흔적에 손이 닿는 거리. 같은 까닭이다: 화면의 말머리 상자와 서버의 판정이
       다른 자를 쓰면 「E 가 떴는데 너무 멀다고 한다」가 된다.
       ★ 정보 비대칭 — 여기 나가는 것은 **팔 길이 하나**뿐이다. 무엇이 어디 있는지, 무슨 보상이
       나오는지는 자료가 쥐고 서버가 판정한다(사슬의 다음 발자국은 안개가 열려야만 온다). */
    trails: { reachTiles: d.trails?.reachTiles ?? d.balance.handWork?.reachTiles ?? 3 },
    // ★ GDD3 §12-8 — 화면도 같은 식으로 시야를 잰다(기본 + 티어 × visionPerTier)
    fog: {
      chunk: w.fog.chunk,
      vision: { ...w.fog.vision },
      visionPerTier: w.fog.visionPerTier ?? 0,
      nightVisionMultiplier: w.fog.nightVisionMultiplier,
    },
    villagers: {
      maxUnits: w.villagers.maxUnits,
      jobs: [...w.villagers.jobs],
      jobNames: { ...w.villagers.jobNames },
      jobTargets: Object.fromEntries(Object.entries(w.villagers.jobTargets)
        .filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => [k, { nodeTypes: [...(v.nodeTypes || [])], posts: [...(v.posts || [])] }])),
      postSlots: { ...w.villagers.postSlots },
      // ★ GDD3 §13-A-3 — 노동 연출과 수치를 같은 시계에 맞추는 다이얼
      work: w.villagers.work ? { ...w.villagers.work } : null,
      moveTilesPerTick: w.villagers.moveTilesPerTick,
    },
    laborDerivation: {
      jobToDept: { ...w.laborDerivation.jobToDept },
      gatherJobs: { ...w.laborDerivation.gatherJobs },
      referenceMix: { ...w.laborDerivation.referenceMix },
      referenceDeptSum: w.laborDerivation.referenceDeptSum,
    },
    buildingPlacement: {
      minSpacing: w.buildingPlacement.minSpacing,
      nodeClearance: w.buildingPlacement.nodeClearance,
      adjacency: {
        radius: w.buildingPlacement.adjacency.radius,
        perNode: w.buildingPlacement.adjacency.perNode,
        max: w.buildingPlacement.adjacency.max,
        byBuilding: structuredClone(w.buildingPlacement.adjacency.byBuilding),
      },
    },
    // ★ GDD3 §7 — 울타리 조각(드래그 배치). 클라의 고스트 선이 이 규칙을 그대로 복제한다.
    fences: { ...w.fences },
    reclaim: {
      cost: { ...w.reclaim.cost }, terrain: [...w.reclaim.terrain],
      minSpacing: w.reclaim.minSpacing, maxFields: w.reclaim.maxFields,
    },
    camps: { leadDays: w.camps.leadDays, scoutRadius: w.camps.scoutRadius },
    combatScene: { phases: [...w.combatScene.phases], phaseNames: { ...w.combatScene.phaseNames } },
    avatar: {
      interactRadius: w.avatar.interactRadius, dayNightCycle: w.avatar.dayNightCycle,
      // ★ §19-B — 내 걸음을 서버에 알리는 최소 간격. 이 값이 곧 남의 화면에서 내가 움직이는 박자다.
      moveReportMs: w.avatar.moveReportMs ?? 220,
    },
    /* ★ §19-B — 화면만 보는 다이얼 묶음(보간 버퍼·타격감·대화창·프레임 예산)을 규격에 싣는다.
       서버는 이 값을 한 번도 읽지 않는다. 여기 빠져 있던 탓에 화면은 늘 코드 안의 예비값으로 돌았고
       data/world.json render 는 **죽은 다이얼**이었다 — 보간 수치를 자료가 쥐려면 먼저 이 문이 있어야 한다. */
    render: w.render ? structuredClone(w.render) : null,
    roleTiming: { unlockAfterEmotionDay: w.roleTiming.unlockAfterEmotionDay, defaultVacant: w.roleTiming.defaultVacant },
    appearance: publicAppearance(d),
    chat: publicChat(d),
  };
}

/**
 * 생태계 공개본 — ★ 정보 비대칭. 종의 **이름·능력치·드롭·일화는 실리지 않는다.**
 * 그것을 여는 것은 도감이고(state.codex), 도감을 여는 것은 조우와 처치다.
 * 여기 있는 것은 화면이 '그리는 데' 필요한 규칙뿐이다: 보간 주기·링 경계·도감 문턱.
 */
export function publicCreatures(d = loadGameData()) {
  const c = d.creatures;
  return {
    order: [...c.order],
    sim: {
      stepSeconds: c.sim.stepSeconds, broadcastSeconds: c.sim.broadcastSeconds,
      attackRangeTiles: c.sim.attackRangeTiles, viewRadius: c.sim.viewRadius,
    },
    codex: { nameAt: c.codex.nameAt, statsAt: c.codex.statsAt, loreAt: c.codex.loreAt },
    // 종별 '겉모습' 힌트만 — 실루엣을 그리려면 크기 갈래는 알아야 한다
    sprites: Object.fromEntries(Object.entries(c.defs).map(([k, v]) => [k, { kind: v.kind, ring: v.ring }])),
  };
}

/** /api/config 용 병합본 */
export function publicConfig() {
  const d = loadGameData();
  return {
    balance: d.balance,
    resources: d.resources,
    // ★ GDD3 §7 — 건물 도감(카테고리·개별 티어·해금 티어·효과 요약)
    buildings: publicBuildings(d),
    roles: d.roles,
    tags: d.tags,
    tactics: publicTactics(d),
    artifacts: d.artifacts,
    aiNations: d.aiNations.nations.map(({ id, name, concept, diplomacyDifficulty }) => ({ id, name, concept, diplomacyDifficulty })),
    difficulty: publicDifficulty(d),
    // ★ GDD3 §1·§3·§6
    tiers: publicTiers(d),
    skills: publicSkills(d),
    waves: publicWaves(d),
    // ★ GDD3 §11-2 — 콘텐츠 사슬(규칙만). 지금 몇 장인지는 state.chapter 로만 간다.
    chapters: publicChapters(d),
    // ★ GDD3 §13-C — 생태계 공개본. 종 이름·능력치는 **여기 없다**(도감이 그것을 여는 열쇠다).
    creatures: publicCreatures(d),
    // ★ GDD3 §13-D-1 — 주민 능력치의 '규칙'(이름·눈금·직업 적합). 사람마다의 수치는 state 로만 간다.
    residentStats: publicStats(d),
    // ★ GDD3 §13-D-2 — 모집 값(식량 20 · 쿨다운 1일). 지금 쓸 수 있는지는 state.housing.recruit 이 안다.
    recruit: { ...d.balance.residents.recruit, cost: { ...d.balance.residents.recruit.cost } },
    // ★ GDD3 §13-D-3·4 — 장비·인첸트 규격(티어·재료·특성표). 내가 무엇을 끼고 있는지는 state 로만 간다.
    equipment: publicEquipment(d),
    // ★ GDD3 §13-D-5 — 기술 트리 규격(선행·값·날수·해금). 어디까지 했는지는 state.research 로만 간다.
    research: publicResearch(d),
    /* ★ GDD3 §15-C — 동료 봇 공개본. 정원과 자동 플레이의 규칙만 간다.
       누가 어느 자리를 맡았는지·어디 서 있는지는 state·avatars 로만 온다. */
    companions: {
      enabled: d.companions.enabled !== false,
      seats: d.companions.seats ?? 5,
      nameplateColors: [...(d.companions.nameplateColors || [])],
      autoPlay: { suspendSeconds: d.companions.autoPlay?.suspendSeconds ?? 30 },
    },
    world: publicWorld(d),
    time: {
      dayRealSeconds: d.balance.time.dayRealSeconds,
      subtickSeconds: d.waves.battle.subtickSeconds,
      dayPhases: [...d.balance.time.dayPhases],
    },
  };
}
