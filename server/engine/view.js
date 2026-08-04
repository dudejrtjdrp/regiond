// NationView / world 스냅샷 생성 — 역할별 정보 비대칭을 서버에서 강제한다 (docs/PROTOCOL.md v3)
import { localPriceTable, round2, hasDiplomat, effectiveTariff, freightRate, round3 } from './economy.js';
import { collectHooks } from './artifacts.js';
import { foreignPriceTable } from './ai_nation.js';
import { recommendedLabor, freightEventDelta } from './commands.js';
import { roleSummary } from './npc.js';
import { difficultyView, difficultyPreset } from './difficulty.js';
import { canSeeTacticHint, tacticOptions, waveTacticHint } from './tactics.js';
import { buildAdvices } from './advisor.js';
import { townOf, territoryRadius, encodeTerrain, dist, ringRadii } from './world.js';
// ★ GDD3 §13-C — 상시 생태계 · 도감
import { creatureViews } from './ecology.js';
import { codexView } from './codex.js';
// ★ GDD3 §13-D — RPG 계층. 장비는 사람의 것, 연구·철로는 나라의 것이다.
import { equipmentView } from './equipment.js';
import { researchView, railViews, railSummary, researchFeature } from './research.js';
import {
  deriveLabor, nodeContribution, listTargets, isHarvestReady, jobsForTarget, fieldStageView,
} from './villagers.js';
import { normalizeMembers as membersView, normalizeAppearance } from './social.js';
// ★ GDD3 §15-C — 동료 봇(= 각료). 이름표 색·맡은 자리·자동 플레이 상태가 여기서 나간다.
import { companionViews, companionById, autoPlayView } from './companions.js';
import { fogSnapshot, fogChunksSince, isExplored, exploredRatio, encodeChunk } from './fog.js';
import {
  structureView, siteView, adjacencyDetail, isRuined, buildingKeys, maxTier, structureDef, footprint,
  effectSummary,
} from './structures.js';
import { fenceViews, fenceSummary } from './fences.js';
import { residentViews, housingView, peoplePerUnit, capacity } from './residents.js';
import { tierView, settlementTier } from './tiers.js';
import {
  unlockedList, buildingUnlocked, departmentsActive, featureUnlocked, chapterView,
  // ★ GDD3 §14-7 — 잠긴 건물이 「언제 열리는가」
  buildingUnlockInfo,
} from './progression.js';
import { waveView, campViews, nextWaveSpec, daysUntilWave, hasSaintSight } from './waves.js';
import { battleView } from './battle.js';
import { defenseSummary, weakSpots } from './combat.js';
import { playerView, playersView, swingCooldownSeconds } from './skills.js';
import { swingPreview } from './actions.js';
import { chronicleView } from './chronicle.js';
// ★ GDD3 §13-A-5 — 저장 상한(서버 권위)
import { storageLimit, fullResources } from './storage.js';

const hasRole = (nation, key, viewerRole) => nation.roles?.[key]?.holder === 'player' && viewerRole === key;
const roleStaffed = (nation, key) => Boolean(nation.roles?.[key]?.holder);

const round3Map = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, round3(v)]));

export function buildNationView(world, nationId, viewerRole, data, opts = {}) {
  const nation = world.nations[nationId];
  if (!nation) return null;
  const hooks = collectHooks(nation, data);
  const town = townOf(world, nation.id);
  const derived = deriveLabor(nation, data);
  const architect = roleStaffed(nation, 'build');
  const avatarId = opts.avatarId ?? null;
  // ★ 진행 감독이 해금의 단일 정본이다(GDD3 §11-1). 아래 게이트는 전부 이 목록 하나만 본다.
  const unlocked = unlockedList(nation, data);
  const on = (f) => unlocked.features.includes(f);
  const wavesOn = on('waves');
  const rolesOn = on('roles');
  const tradeOn = on('trade');
  const councilOn = on('council');
  // ★ GDD3 §14-7 — 지을 수 있는 것과 아직 잠긴 것을 같은 자에서 잰다(갈래가 열렸는가로 가른다)
  const buildable = buildableCatalog(nation, data);

  const view = {
    protocol: 3,
    tick: world.tick,
    day: world.tick,
    phase: world.phase,
    paused: Boolean(world.paused),
    difficulty: difficultyView(world, data),
    time: {
      dayRealSeconds: data.balance.time.dayRealSeconds,
      dayPhases: [...data.balance.time.dayPhases],
      subtickSeconds: data.waves.battle.subtickSeconds,
    },
    // ★ GDD3 §1 — 성장 아크(반경·작업 속도·승격 연출). 해금 목록은 진행 감독이 채운다.
    tier: { ...tierView(nation, data), unlocked },
    unlocked,
    // ★ GDD3 §11-2 — 콘텐츠 사슬. 목표 카드 1장과 퀘스트 마커가 전부 이 블록에서 나온다.
    chapter: chapterView(world, nation, data),
    // 관제 선포는 감정(appraiseLand)을 마친 뒤에만 존재한다 — 그 전에는 필드 자체가 없다.
    ...(rolesOn ? {
      mandate: {
        open: Boolean(world.mandateOpen),
        unlocked: Boolean(world.emotionDayDone),
        done: Boolean(nation.mandateDone),
        vacantDefault: data.world.roleTiming.defaultVacant,
      },
    } : {}),
    you: {
      avatarId,
      role: viewerRole ?? null,
      roleName: viewerRole ? (data.roles.defs[viewerRole]?.name ?? viewerRole) : null,
      // ★ GDD3 §3 — 내 스킬·도구·쿨타임. 멀티에서 남의 레벨은 nation.players 로 요약만 본다.
      player: avatarId ? playerView(nation, avatarId, data) : null,
      swing: avatarId ? swingPreview(nation, avatarId, data) : null,
      /* ★ GDD3 §13-D-3·4 — 캐릭터 창(C). 내가 든 것·두른 것과 지금 벼릴 수 있는 것.
         장비는 **사람마다** 다르므로 you 아래에 둔다 — 같이 접속한 동료의 칼은 내 것이 아니다.
         ★ 대장간이 서는 장(9장) 전에는 필드 자체가 없다 — 잠긴 계층은 '비활성'이 아니라 부재다(§11-1). */
      ...(on('equipment') && avatarId
        ? { equipment: equipmentView(nation, nation.players?.[avatarId] ?? null, data) } : {}),
      /* ★ GDD3 §15-C — 자동 플레이. 켰는가 · 지금 실제로 몰고 있는가 · 손이 닿아 몇 초 쉬는가.
         서버가 정본이다: 화면은 이 값으로 「자동」 배지를 켜고 끈다. */
      autoPlay: avatarId ? autoPlayView(nation, avatarId, data) : null,
    },
    nation: {
      id: nation.id,
      name: nation.name,
      isPlayer: nation.isPlayer,
      tags: nation.tagsRevealed ? nation.tags : [],
      tagNames: nation.tagsRevealed ? nation.tags.map((t) => data.tags[t]?.name ?? t) : [],
      // ── 공간 ────────────────────────────────────────────────
      town: town ? { x: town.x, y: town.y } : null,
      territory: { radius: territoryRadius(nation, data), cx: town?.x ?? null, cy: town?.y ?? null },
      // ★ GDD3 §4 — 주민은 실인원이다
      residents: residentViews(nation, data, world),
      housing: housingView(nation, data, world),
      peoplePerUnit: round2(peoplePerUnit(nation, data)),
      villagerMix: derived ? { counts: derived.counts, mix: round3Map(derived.mix), units: derived.units } : null,
      // ★ GDD3 §7 — 개별 건물 티어
      structures: (nation.structures || []).map((s) => structureView(nation, s, data, { architect })),
      sites: (nation.construction || []).map((c) => siteView(nation, c, data)),
      // ★ GDD3 §7 — 울타리 조각
      fences: fenceViews(nation, data),
      fenceSummary: fenceSummary(nation, data),
      buildable,
      /* ★ GDD3 §14-7 — 열린 갈래 안의 잠긴 건물. 흐림 + 자물쇠 + 해금 조건으로 그려진다. */
      lockedBuildings: lockedCatalog(nation, data,
        new Set(buildable.map((b) => b.category).filter(Boolean))),
      workPosts: listTargets(world, nation, data).map((t) => ({
        id: t.id, kind: t.kind, name: t.name, x: t.x, y: t.y, slots: t.slots,
        nodeType: t.nodeType ?? null, post: t.post ?? null, jobs: jobsForTarget(t, data),
        workers: (nation.villagers || []).filter((u) => u.targetId === t.id).length,
      })),
      // 적 캠프는 '웨이브'가 열린 뒤에만 존재한다 — 그 전에는 지도에 아무 표시도 없다.
      camps: wavesOn ? campViews(world, nation, viewerRole, data) : [],
      exploredRatio: round3(exploredRatio(nation)),
      avatars: avatarViews(nation, data),
      players: playersView(nation, data),
      /* ★ GDD3 §15-C — 정원 5인 중 동료가 채운 자리. 명부·이름표·각료 화면이 같은 표를 본다. */
      companions: companionViews(nation, data),
      seats: data.companions?.seats ?? 5,
      // ── 매크로 ──────────────────────────────────────────────
      population: Math.floor(nation.population),
      populationCap: capacity(nation, data),
      morale: round2(nation.morale),
      gold: round2(nation.gold),
      resources: Object.fromEntries(Object.entries(nation.resources).map(([k, v]) => [k, round2(v)])),
      // ★ GDD3 §13-A-5 — 자원마다 이만큼까지만 쌓인다. HUD 자원칸의 「가득」 표시가 이 값을 본다.
      storage: { limit: storageLimit(nation, data), full: fullResources(nation, data) },
      laborAlloc: nation.laborAlloc,
      gatherScale: nation.gatherScale ?? { wood: 1, stone: 1 },
      factoryQueue: nation.factoryQueue,
      departmentsActive: departmentsActive(nation, data),
      // ── ★ 잠긴 계층은 '비활성'이 아니라 부재다 (GDD3 §11-1 · §11-5) ────────
      //   역할·유물·국법·조언 관련 필드는 그 장이 열리기 전까지 뷰에 아예 실리지 않는다.
      //   화면이 "회색 단추"조차 그릴 수 없게 만드는 것이 이 게이트의 목적이다.
      ...(rolesOn ? {
        roles: roleSummary(nation, data),
        advices: buildAdvices(world, nation, data),
        autoAssist: nation.autoAssist !== false,
        ap: buildApView(nation, data),
        survey: nation.survey ?? null,
      } : {}),
      ...(councilOn ? {
        artifacts: (nation.artifacts || []).map((a) => ({
          key: a.key, name: data.artifactsByKey[a.key]?.name, grade: data.artifactsByKey[a.key]?.grade,
          desc: data.artifactsByKey[a.key]?.desc, type: data.artifactsByKey[a.key]?.type,
          obtainedTick: a.obtainedTick, consumed: a.consumed,
        })),
        decisionQueue: nation.decisionQueue,
        ruinGauge: nation.ruinGauge || 0,
        ruinThreshold: data.ruins.gaugeThreshold,
      } : {}),
      ...(on('orders') ? { orders: nation.orders } : {}),
      ...(tradeOn ? {
        autoExport: nation.autoExport,
        factoryQueue: nation.factoryQueue,
        recommendations: { labor: recommendedLabor(nation, data) },
      } : {}),
      ...(wavesOn ? { battlePlan: buildBattlePlanView(world, nation, data, viewerRole) } : {}),
      buildings: structuredClone(nation.buildings),      // 레거시 거울(가격·무역 공식이 읽는 값)
      buildPoints: round2(nation.buildPoints),
      prestige: nation.prestige ?? 0,
      buffs: nation.buffs,
      sanctuary: nation.sanctuary,
      rationing: nation.rationing,
      online: nation.online,
      members: membersView(nation, data),
      stats: nation.stats,
      cosmetics: hooks.cosmetics,
      clientStats: hooks.clientStats ?? {},
      nodeContribution: nodeContributionView(world, nation, data),
      // ★ GDD3 §13-B-5 — 위험 띠. HUD 가 지금 내가 어느 띠에 서 있는지를 이 값으로 읽는다.
      rings: ringRadii(nation, data),
      /* ★ GDD3 §13-D-5 — 기술 트리와 철로. 두 겹의 문을 구별해 둔다.
         ① **장**(10장 끝이 없는 길)이 열기 전에는 필드 자체가 없다 — 연구 탭도 그려지지 않는다(§11-1).
         ② 장이 열린 뒤에는 **잠긴 연구도 목록에 남는다** — 조건 가시화 원칙(§12-3)대로
            「단계 3/4」를 빨강으로 적어 다음 걸음이 무엇인지 보여야 하기 때문이다. */
      ...(on('research') ? {
        research: researchView(nation, data),
        rails: researchFeature(nation, 'rails', data) ? railViews(nation) : [],
        railSummary: railSummary(nation, data),
      } : {}),
    },
    // ★ GDD3 §13-C-3 — 도감(J). 조우·처치 수는 서버가 권위로 세고, 잠긴 층은 필드 자체가 없다.
    codex: codexView(nation, data),
    // ★ GDD3 §6 — 웨이브·전투. 7장 전에는 세 블록 모두 null 이다(위협 게이지도 없다).
    wave: wavesOn ? waveView(world, nation, viewerRole, data, hooks) : null,
    battle: wavesOn ? battleView(nation, data) : null,
    lastBattle: wavesOn && nation.lastBattleResult ? summarizeBattle(nation.lastBattleResult) : null,
    defense: wavesOn ? defenseSummary(world, nation, data, hooks) : null,
    // 시장·상단·회의도 마찬가지 — 열리기 전에는 필드가 없다.
    ...(tradeOn ? {
      market: {
        local: localPriceTable(nation, data),
        foreign: null,
        open: true,
        tariff: round3(effectiveTariff(nation, data, { artifactDelta: hooks.tariffDelta })),
        freight: round3(freightRate(nation, data, { artifactDelta: hooks.freightDelta, eventDelta: freightEventDelta(nation) })),
      },
      offers: world.offers.filter((o) => o.nationId !== nation.id),
    } : {}),
    ...(councilOn ? { councils: world.councils.filter((c) => c.nationId === nation.id).slice(-3) } : {}),
    // ★ GDD3 §5 — 시즌 결산 대신 연대기
    chronicle: chronicleView(world, nation, data),
  };

  // ── 역할 전용 정보 ─────────────────────────────────────────────
  if (hasRole(nation, 'farm', viewerRole)) {
    view.nation.soilFatigue = round3(nation.soilFatigue || 0);
    view.nation.harvestForecast = round2((world.lastProduction?.[nation.id]?.grain) || 0);
  } else if (roleStaffed(nation, 'farm')) {
    view.nation.farmBrief = nation.soilFatigue > 0.05 ? '농정관: 땅이 지쳤습니다.' : '농정관: 작황은 무난합니다.';
  }

  if (hasRole(nation, 'factory', viewerRole)) {
    view.nation.bottleneck = detectBottleneck(nation, data);
    view.nation.inventoryTurnover = round2((nation.resources.steel || 0) / Math.max(1, nation.population * 0.24));
  } else if (roleStaffed(nation, 'factory')) {
    view.nation.factoryBrief = '공장장: 용광로는 돌아가고 있습니다.';
  }

  if (hasRole(nation, 'build', viewerRole)) {
    view.nation.durability = (nation.structures || [])
      .filter((s) => (s.hp ?? 0) < (s.maxHp ?? 0))
      .map((s) => ({ id: s.id, key: s.key, condition: round3((s.hp ?? 0) / (s.maxHp || 1)), ruined: isRuined(s) }));
    view.nation.adjacency = {
      bonus: data.roles.defs.build.tenureBonus.adjacencyBonus,
      radius: data.world.buildingPlacement.adjacency.radius,
      perNode: data.world.buildingPlacement.adjacency.perNode,
      max: data.world.buildingPlacement.adjacency.max,
      byBuilding: structuredClone(data.world.buildingPlacement.adjacency.byBuilding),
      placed: (nation.structures || []).map((s) => ({ id: s.id, key: s.key, x: s.x, y: s.y, ...adjacencyDetail(world, nation, s.key, s.x, s.y, data) })),
    };
  } else if (roleStaffed(nation, 'build')) {
    view.nation.buildBrief = nation.construction.length ? '건축가: 공사가 진행 중입니다.' : '건축가: 대기 중입니다.';
  }

  if (hasRole(nation, 'defense', viewerRole) && wavesOn) {
    view.nation.weakSpots = weakSpots(world, nation, data);
    view.wave.tacticHint = waveTacticHint(nextWaveSpec(world, nation, data), data);
  } else if (roleStaffed(nation, 'defense') && wavesOn) {
    view.nation.defenseBrief = '국방부: 울타리를 점검했습니다.';
  }

  if (hasDiplomat(nation) && view.market?.open) {
    view.market.foreign = {};
    for (const other of Object.values(world.nations)) {
      if (other.id === nation.id) continue;
      view.market.foreign[other.id] = { name: other.name, prices: foreignPriceTable(other, data) };
    }
  }

  if (wavesOn && !hasSaintSight(nation, data, hooks)) {
    view.nation.saintBrief = '성녀가 없어 습격 시점이 흐립니다.';
  }
  return view;
}

/**
 * 지금 지을 수 있는 건물 목록.
 * ★ GDD3 §11-1 — **잠긴 건물은 아예 실리지 않는다.** 「아직 세울 수 있는 것이 없습니다」 같은
 *   문구가 뜨는 상황 자체가 설계 실패이므로, 배치대는 이 목록이 비면 단추를 그리지 않는다.
 *   (해금 판정은 티어가 아니라 진행 감독의 '지금 장'이다.)
 */
function buildableCatalog(nation, data) {
  const out = [];
  for (const key of buildingKeys(data)) {
    const def = structureDef(key, data);
    if (def.piece) continue;
    if (!buildingUnlocked(nation, key, data)) continue;
    const t = def.tiers[0];
    out.push({
      key,
      name: def.name,
      // ★ §15-B-2 — 카드가 이름 아래에 그대로 적는 한 줄
      purpose: def.purpose ?? null,
      category: def.category ?? null,
      requiresTier: def.requiresTier ?? 0,
      unlocked: true,
      // ★ §15-B-2 — 「핵심 수치 1~2개」. 1단계 효과표의 앞 두 줄이 곧 그것이다.
      keyFacts: effectSummary(key, 1, data).slice(0, 2),
      action: def.action ?? null,
      actionLabel: def.actionLabel ?? null,
      multi: def.multi !== false,
      built: (nation.structures || []).filter((s) => s.key === key).length,
      maxTier: maxTier(key, data),
      cost: { ...(t.cost || {}) },
      gold: t.gold ?? 0,
      buildPoints: t.buildPoints ?? 0,
      affordable: Object.entries(t.cost || {}).every(([r, v]) => (nation.resources[r] || 0) >= v)
        && (nation.gold || 0) >= (t.gold ?? 0),
    });
  }
  return out;
}

/**
 * ★ GDD3 §14-7 — **열린 갈래 안**의 잠긴 건물 목록.
 *
 * "화살탑이 안 보여서 없는 줄 알았다"의 정면 답이다. §11-1(잠긴 계층은 UI 에 부재)은
 * 갈래·시스템 단위에만 적용한다 — 갈래가 통째로 안 열렸으면 여기에도 한 줄도 안 실린다.
 * 이미 열린 갈래 안에서는 §12-3(조건 가시화)이 이긴다: 흐리게, 자물쇠를 달고, **언제 열리는지**를 적는다.
 */
function lockedCatalog(nation, data, openCategories) {
  const out = [];
  if (!openCategories.size) return out;               // 배치대 자체가 없는 장 — 잠긴 목록도 없다
  for (const key of buildingKeys(data)) {
    const def = structureDef(key, data);
    if (def.piece || def.hq) continue;
    if (buildingUnlocked(nation, key, data)) continue;
    const cat = def.category ?? null;
    if (!cat || !openCategories.has(cat)) continue;    // 아직 안 열린 갈래는 아예 없는 것으로
    const t = def.tiers[0];
    const info = buildingUnlockInfo(nation, key, data);
    out.push({
      key,
      name: def.name,
      purpose: def.purpose ?? null,
      category: cat,
      requiresTier: def.requiresTier ?? 0,
      unlocked: false,
      keyFacts: effectSummary(key, 1, data).slice(0, 2),
      multi: def.multi !== false,
      cost: { ...(t.cost || {}) },
      gold: t.gold ?? 0,
      buildPoints: t.buildPoints ?? 0,
      affordable: false,
      lockKind: info.kind,
      lockChapter: info.chapter ?? null,
      lockTier: info.tier ?? null,
      lockReason: info.text,
    });
  }
  return out;
}

function summarizeBattle(r) {
  const { timeline, ...rest } = r;
  return { ...rest, timelineEvents: (timeline || []).length };
}

function nodeContributionView(world, nation, data) {
  const c = nodeContribution(world, nation, data);
  const cap = data.world.nodes.contribution.cap;
  return { grain: round3(c.grain), wood: round3(c.wood), stone: round3(c.stone), cap };
}

function buildApView(nation, data) {
  const cfg = data.balance.actionPoints;
  const ap = nation.ap || { current: cfg.max, max: cfg.max };
  return {
    current: Math.max(0, ap.current ?? 0),
    max: ap.max ?? cfg.max,
    actions: Object.fromEntries(Object.entries(cfg.actions).map(([k, v]) => [k, { cost: v.cost }])),
    usedDepts: [...(nation.apState?.inspiredDepts || [])],
  };
}

function avatarViews(nation, data) {
  return Object.values(nation.avatars || {}).map((a) => {
    /* ★ GDD3 §15-C — 이 아바타가 동료인가. 화면은 **아이디를 뜯어보지 않는다**:
       봇 여부·이름표 색·맡은 자리를 서버가 실어 보낸다(신원 판정은 서버의 몫이다). */
    const comp = companionById(nation, a.id);
    return {
      id: a.id, name: a.name ?? '개척자', x: a.x, y: a.y, tick: a.tick ?? 0,
      appearance: normalizeAppearance(a.appearance, data).appearance,
      down: (nation.players?.[a.id]?.downUntil ?? 0) > 0,
      hp: round2(nation.players?.[a.id]?.hp ?? 0),
      maxHp: nation.players?.[a.id]?.maxHp ?? 0,
      ...(comp ? {
        bot: true,
        color: comp.color,
        role: comp.role ?? null,
        roleName: comp.role ? (data.roles.defs[comp.role]?.name ?? comp.role) : null,
        state: comp.mem?.state ?? 'idle',
      } : { bot: false }),
    };
  });
}

function buildBattlePlanView(world, nation, data, viewerRole) {
  const plan = nation.battlePlan ?? null;
  const out = {
    tactic: plan?.tactic ?? null,
    setTick: plan?.setTick ?? null,
    options: tacticOptions(data),
    bonus: data.waves.battle.tacticDamageBonus,
    penalty: data.waves.battle.tacticPenalty,
  };
  if (canSeeTacticHint(nation, viewerRole, data)) {
    out.hint = waveTacticHint(nextWaveSpec(world, nation, data), data);
  }
  return out;
}

function detectBottleneck(nation, data) {
  const rec = data.balance.recipes.steel;
  if ((nation.resources.ironOre || 0) < rec.ironOre) return 'ironOre';
  if ((nation.resources.fuel || 0) < rec.fuel) return 'fuel';
  if ((nation.resources.oil || 0) <= 0) return 'oil';
  return null;
}

export { normalizeMembers } from './social.js';

// ────────────────────────────────────────────────────────────────
// PROTOCOL v3 — world 스냅샷 / worldDiff
// ────────────────────────────────────────────────────────────────
/**
 * NodeView.
 * ★ v3.1 (256×256) — **기본값인 항목은 싣지 않는다.** 월드가 네 배로 넓어지면서 노드도 네 배가 됐고,
 *   전면 탐사 스냅샷이 0.6MB 를 넘었다. 대부분의 노드는 `rich:false · workers:0 · swings:0 · stage:null`
 *   처럼 '아무 일도 없는' 상태라, 그 열쇠말을 빼는 것만으로 절반 가까이가 줄어든다.
 *   **계약**: 빠진 항목은 「기본값」이다(false · 0 · null). 클라의 노드 병합은 이미 `!= null` 로 읽는다.
 */
function nodeView(world, nation, n, data) {
  const def = data.world.nodes.types[n.type];
  const swingSpec = data.skills.nodes[n.type] ?? null;
  const stage = fieldStageView(n, data, world.tick);
  const v = {
    id: n.id, type: n.type, x: n.x, y: n.y,
    name: def?.name ?? n.type,
    amount: round2(n.amount), max: round2(n.max),
    ratio: n.max > 0 ? round2(n.amount / n.max) : 1,
    slots: def?.slots ?? 0,
    job: def?.job ?? null,
    // ★ GDD3 §3 — 노드별 스윙 카운트(서버 권위). 클라의 타격 이펙트가 이 값으로 주기를 맞춘다.
    //   ★ §13-B-4 — 유적은 크기만큼 오래 걸린다: 노드에 박힌 값이 규격을 이긴다.
    swingsPerCycle: n.swingsPerCycle ?? swingSpec?.swings ?? null,
    skill: swingSpec?.skill ?? null,
    mine: dist(n.x, n.y, ...townXY(world, nation)) <= territoryRadius(nation, data) + 0.001,
  };
  if (n.rich) v.rich = true;
  if (n.depleted) v.depleted = true;
  // ★ §13-B-3 — 그루터기가 되살아날 날. 화면이 「곧 다시 자란다」를 그린다.
  if (n.respawnAt != null) v.respawnAt = n.respawnAt;
  if (n.cluster) v.cluster = n.cluster;
  if (n.size != null) v.size = n.size;
  if (n.ruinName) v.ruinName = n.ruinName;
  if (n.concealed) v.wasConcealed = true;
  if (n.workers) v.workers = n.workers;
  if (n.swings) v.swings = n.swings;
  if (n.readyAt != null) v.readyAt = n.readyAt;
  if (isHarvestReady(n, data, world.tick)) v.harvestReady = true;
  if (stage.stage != null) { v.stage = stage.stage; v.stageName = stage.stageName; v.growth = stage.growth; }
  return v;
}

/** 화면에 실릴 수 있는 노드인가 — 숨은 지하 자원과 **아직 못 찾은 은닉 유적**은 빠진다 (§13-B-4) */
const nodeVisible = (n) => !n.hidden && !(n.concealed && !n.revealed);

/** 군락 목록 — 탐사된 것만. 클라가 이 원들로 바닥 질감을 달리 칠한다 (§13-B-1) */
function clusterViews(world, nation) {
  return (world.map?.clusters || [])
    .filter((c) => isExplored(nation, c.x, c.y))
    .map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, r: c.r, n: c.n }));
}

function townXY(world, nation) {
  const t = townOf(world, nation.id);
  return t ? [t.x, t.y] : [-999, -999];
}

/** ★ §12-6 — 무역이 열리기 전에는 캐러밴이 아예 없다(생성도 렌더도 서버가 막는다) */
function caravansFor(nation, map, data) {
  return featureUnlocked(nation, 'trade', data) ? (map?.caravans || []) : [];
}

/** join 직후 1회 — 월드 전체 스냅샷. 노드는 '탐사된 곳'만 간다(안개 계약). */
export function buildWorldSnapshot(world, nationId, data) {
  const nation = world.nations[nationId];
  if (!nation) return null;
  const map = world.map;
  if (!map || !map.size) return null;
  return {
    protocol: 3,
    tick: world.tick,
    size: map.size,
    seed: map.seed,
    terrain: { codes: [...data.world.terrain.codes], rle: encodeTerrain(map) },
    nodes: (map.nodes || [])
      .filter((n) => nodeVisible(n) && isExplored(nation, n.x, n.y))
      .map((n) => nodeView(world, nation, n, data)),
    // ★ GDD3 §13-B-1 — 자원 군락. 숲 군락·딸기 들·바위 지대·강가 어장이 '지역'으로 읽히게 한다.
    clusters: clusterViews(world, nation),
    // ★ GDD3 §13-B-5 — 스폰 링 경계(본부 기준). 화면이 서버와 같은 식으로 링2 경고를 잰다.
    rings: ringRadii(nation, data),
    towns: (map.towns || []).map((t) => ({
      nationId: t.nationId, name: world.nations[t.nationId]?.name ?? t.nationId,
      x: t.x, y: t.y, isPlayer: Boolean(t.isPlayer),
      radius: territoryRadius(world.nations[t.nationId] || {}, data),
      preset: t.preset,
      known: t.nationId === nationId || isExplored(nation, t.x, t.y),
    })),
    // ★ GDD3 §12-6 — 상단 마차는 **무역이 열린 뒤에만** 존재한다(8장).
    //   그 전에 지도를 가로지르던 것은 "자동차 같은 것"이라는 말을 들었다: 아직 없는 세계의 물건이었다.
    caravans: caravansFor(nation, map, data),
    fog: fogSnapshot(nation, data),
    territory: { cx: townXY(world, nation)[0], cy: townXY(world, nation)[1], radius: territoryRadius(nation, data) },
    structures: (nation.structures || []).map((s) => structureView(nation, s, data)),
    fences: fenceViews(nation, data),
    tier: settlementTier(nation),
  };
}

/** 매 틱 — 바뀐 것만. 안개는 청크 RLE, 노드는 stamp 기반. */
export function buildWorldDiff(world, nationId, data, sinceTick = -1) {
  const nation = world.nations[nationId];
  if (!nation) return null;
  const fogChunks = fogChunksSince(nation, sinceTick);
  const chunk = nation.fog?.chunk ?? data.world.fog.chunk;
  const changedChunks = new Set(fogChunks.map((c) => `${c[0]},${c[1]}`));
  const nodes = [];
  for (const n of world.map?.nodes || []) {
    if (!nodeVisible(n) || !isExplored(nation, n.x, n.y)) continue;
    const key = `${Math.floor(n.x / chunk)},${Math.floor(n.y / chunk)}`;
    const fresh = n.stamp > sinceTick || n.stamp === world.tick;
    if (fresh || changedChunks.has(key)) nodes.push(nodeView(world, nation, n, data));
  }
  return {
    tick: world.tick,
    sinceTick,
    fog: fogChunks,
    nodes,
    clusters: clusterViews(world, nation),
    rings: ringRadii(nation, data),
    // ★ GDD3 §13-C — 들에 사는 것들. 위치의 정본은 서버이고 화면은 그 사이를 보간한다.
    creatures: creatureViews(world, nation, data),
    // ★ §12-6 — 무역이 열린 뒤에야 상단이 다닌다. 열리기 전에는 늘 빈 목록이라
    //   join 뒤에 8장이 열려도 다시 붙지 않고 그 자리에서 나타난다.
    caravans: caravansFor(nation, world.map, data),
    towns: (world.map?.towns || []).map((t) => ({
      nationId: t.nationId, x: t.x, y: t.y,
      radius: territoryRadius(world.nations[t.nationId] || {}, data),
      known: t.nationId === nationId || isExplored(nation, t.x, t.y),
    })),
    territory: { cx: townXY(world, nation)[0], cy: townXY(world, nation)[1], radius: territoryRadius(nation, data) },
    structures: (nation.structures || []).map((s) => structureView(nation, s, data)),
    sites: (nation.construction || []).map((c) => siteView(nation, c, data)),
    fences: fenceViews(nation, data),
    residents: residentViews(nation, data, world),
    camps: campViews(world, nation, null, data),
    avatars: avatarViews(nation, data),
  };
}

/**
 * ★ 즉시 공개분 — 아바타가 걸어 들어가 방금 밝아진 청크만 담은 작은 worldDiff.
 *   (일 틱을 기다리지 않는다. docs/PROTOCOL.md v3.0 §안개 즉시 공개)
 *   chunkStamp 는 '게임일' 단위라 같은 날 안에 두 번 밝아진 것을 sinceTick 으로 가려낼 수 없다 —
 *   그래서 어디가 밝아졌는지는 fog.stampVisionDisc 가 돌려준 청크 목록을 그대로 쓴다.
 * @param {Array<[number,number]>} chunks 새로 바뀐 청크 좌표
 */
export function buildRevealDiff(world, nationId, data, chunks) {
  const nation = world.nations[nationId];
  if (!nation?.fog || !chunks?.length) return null;
  const fog = nation.fog;
  const keys = new Set(chunks.map(([cx, cy]) => `${cx},${cy}`));
  const nodes = [];
  for (const n of world.map?.nodes || []) {
    if (!nodeVisible(n) || !isExplored(nation, n.x, n.y)) continue;
    if (!keys.has(`${Math.floor(n.x / fog.chunk)},${Math.floor(n.y / fog.chunk)}`)) continue;
    nodes.push(nodeView(world, nation, n, data));
  }
  return {
    tick: world.tick,
    sinceTick: world.tick,
    reveal: true,
    fog: chunks.map(([cx, cy]) => encodeChunk(fog, cx, cy)),
    nodes,
    clusters: clusterViews(world, nation),
    towns: (world.map?.towns || [])
      .filter((t) => keys.has(`${Math.floor(t.x / fog.chunk)},${Math.floor(t.y / fog.chunk)}`))
      .map((t) => ({
        nationId: t.nationId, x: t.x, y: t.y,
        radius: territoryRadius(world.nations[t.nationId] || {}, data),
        known: t.nationId === nationId || isExplored(nation, t.x, t.y),
      })),
  };
}

/** 세계 뷰 — 외교관 없으면 가격 마스킹 */
export function buildWorldState(world, nationId, data) {
  const me = world.nations[nationId];
  const diplomat = hasDiplomat(me);
  const hooks = collectHooks(me, data);
  const precise = hasSaintSight(me, data, hooks);
  const days = daysUntilWave(world, me);
  const spec = nextWaveSpec(world, me, data);
  return {
    nations: Object.values(world.nations).map((n) => {
      const t = townOf(world, n.id);
      return {
        id: n.id,
        name: n.name,
        isPlayer: n.isPlayer,
        concept: data.aiNations.nations.find((a) => a.id === n.id)?.concept ?? null,
        tags: n.tagsRevealed ? n.tags.map((tag) => data.tags[tag]?.name ?? tag) : null,
        prices: diplomat ? foreignPriceTable(n, data) : null,
        masked: !diplomat,
        population: n.isPlayer || diplomat ? Math.round(n.population) : null,
        town: t ? { x: t.x, y: t.y } : null,
        territoryRadius: territoryRadius(n, data),
        tier: n.tier ?? 0,
      };
    }),
    tradeRoutes: Object.values(world.nations).filter((n) => !n.isPlayer).map((n) => ({
      from: nationId, to: n.id, tier: me.buildings.road || 0,
      ...tradeRouteFlow(world, nationId, n.id, data),
    })),
    // ★ GDD3 §6 — 다음 웨이브 화살표. 성녀가 없으면 시점이 흐리고 종류도 안 보인다.
    waveArrow: days == null ? null : {
      number: (me.wave?.index ?? 0) + 1,
      from: spec.direction,
      to: nationId,
      type: precise ? spec.type : null,
      name: precise ? spec.name : null,
      tick: precise ? me.wave.arrivalTick : null,
      daysUntil: precise ? days : null,
      daysUntilMin: Math.max(0, days - (precise ? 0 : (difficultyPreset(world, data).hintJitterDays ?? 2))),
      precise,
    },
  };
}

function tradeRouteFlow(world, nationId, partnerId, data) {
  const cap = data.balance.trade.tradeRouteVolumeCap || 40;
  const byResource = {};
  let total = 0;
  for (const f of world.tradeFlow || []) {
    const involves = (f.from === nationId && f.to === partnerId) || (f.from === partnerId && f.to === nationId);
    if (!involves) continue;
    byResource[f.resource] = (byResource[f.resource] || 0) + f.amount;
    total += f.amount;
  }
  const top = Object.entries(byResource).sort((a, b) => b[1] - a[1])[0];
  return {
    resource: top ? top[0] : null,
    amount: round2(total),
    volume: round2(Math.min(1, total / cap)),
  };
}

export { swingCooldownSeconds };
