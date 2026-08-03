// data/*.json 로더. 매직넘버 금지 원칙에 따라 엔진은 이 모듈을 통해서만 수치를 얻는다.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicAppearance, publicChat } from './social.js';
import { publicBuildings } from './structures.js';
import { publicWaves } from './waves.js';
import { publicChapters } from './progression.js';

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
    terrain: { codes: [...w.terrain.codes], names: { ...w.terrain.names }, buildable: [...w.terrain.buildable], walkable: [...w.terrain.walkable] },
    nodes: {
      order: [...w.nodes.order],
      types: Object.fromEntries(Object.entries(w.nodes.types).map(([k, v]) => [k, {
        name: v.name, job: v.job, resource: v.resource, slots: v.slots,
        harvest: Boolean(v.harvest), explorable: Boolean(v.explorable), subsurface: Boolean(v.subsurface),
        contributes: v.contributes ?? null,
      }])),
      contribution: { perNode: w.nodes.contribution.perNode, cap: w.nodes.contribution.cap },
    },
    territory: { baseRadius: w.territory.baseRadius },
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
    avatar: { interactRadius: w.avatar.interactRadius, dayNightCycle: w.avatar.dayNightCycle },
    roleTiming: { unlockAfterEmotionDay: w.roleTiming.unlockAfterEmotionDay, defaultVacant: w.roleTiming.defaultVacant },
    appearance: publicAppearance(d),
    chat: publicChat(d),
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
    world: publicWorld(d),
    time: {
      dayRealSeconds: d.balance.time.dayRealSeconds,
      subtickSeconds: d.waves.battle.subtickSeconds,
      dayPhases: [...d.balance.time.dayPhases],
    },
  };
}
