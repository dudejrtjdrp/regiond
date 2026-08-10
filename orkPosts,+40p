// NationView / world 스냅샷 생성 — 역할별 정보 비대칭을 서버에서 강제한다 (docs/PROTOCOL.md v3)
import {
  localPriceTable, round2, hasDiplomat, effectiveTariff, freightRate, round3, importPrice, exportPrice,
} from './economy.js';
import { collectHooks } from './artifacts.js';
import { foreignPriceTable } from './ai_nation.js';
import { reappraisalState } from './emotion_day.js';
// ★ §19-F3(F07-7) — 나라마다 다른 값(성정 배수)과 특산품 좌판
import { foreignUnitPrice, tradeProfileView, specialtyList } from './trade.js';
import { relationView } from './relations.js';   // ★ §세계관 W4 — 외교 카드의 관계 결
// ★ §17-16 — hasMet: 직접 찾아가 본 나라인가(가격·태그 마스킹 완화의 정본)
import { recommendedLabor, freightEventDelta, hasMet } from './commands.js';
import { roleSummary } from './npc.js';
import { difficultyView, difficultyPreset } from './difficulty.js';
import { canSeeTacticHint, tacticOptions, waveTacticHint } from './tactics.js';
import { buildAdvices } from './advisor.js';
import { townOf, territoryRadius, encodeTerrain, dist, ringRadii } from './world.js';
// ★ GDD3 §13-C — 상시 생태계 · 도감
import { creatureViews } from './ecology.js';
import { codexView } from './codex.js';
import { templeNodes } from './temple.js';   // ★ §20-R4e — 지도에서 신전을 알아보게 한다
// ★ GDD3 §13-D — RPG 계층. 장비는 사람의 것, 연구·철로는 나라의 것이다.
import { equipmentView } from './equipment.js';
import {
  researchView, railViews, railSummary, researchFeature,
  // ★ §17-13 — 다리·매립 뷰(철로와 같은 계약)
  bridgeViews, bridgeSummary, fillViews, fillSummary,
} from './research.js';
import {
  deriveLabor, nodeContribution, listTargets, isHarvestReady, jobsForTarget, fieldStageView,
} from './villagers.js';
import { normalizeMembers as membersView, normalizeAppearance } from './social.js';
// ★ GDD3 §15-C — 동료 봇(= 각료). 이름표 색·맡은 자리·자동 플레이 상태가 여기서 나간다.
import { companionViews, companionById, autoPlayView } from './companions.js';
import { fogSnapshot, fogChunksSince, isExplored, exploredRatio, encodeChunk } from './fog.js';
// ★ §18-D2 — 앞마당의 흔적. 안개가 유일한 문이다(가 본 적 없는 자리의 흔적은 **필드째** 빠진다).
import { trailViews } from './trails.js';
// ★ §19-F4(F09-2) — 기차 한 대와 그 노선
import { trainViews, trainSummary } from './train.js';
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

// ────────────────────────────────────────────────────────────────
// ★ Sprint 3 — **한 번의 방송 동안만** 사는 파생 캐시
//
// 명령 하나에 방 전체가 새 판을 받는다. 그런데 그 판의 큰 조각들 — 주민 목록, 울타리 목록,
// 일자리 목록, 짐승 목록, 세계 뷰 — 은 **누가 보든 같은 값**이다(역할 마스킹이 걸리는 것은
// 농정관 작황·국방 약점 같은 몇 줄뿐이다). 그런데도 세션 수만큼 처음부터 다시 빚었다.
//
// 그래서 캐시를 **밖에서 만들어 넣는다**: broadcastState 가 그릇 하나를 지어 그 방송에 쓰이는
// 모든 호출에 건네고, 방송이 끝나면 그릇째 버린다. 모듈에 값을 눌러 두지 않으므로
// 「낡은 좌표가 남는」 사고가 원천적으로 없다 — 다음 방송은 언제나 처음부터 다시 빚는다.
// 캐시를 안 주면(테스트·단발 호출) 옛날처럼 그때그때 빚는다.
// ────────────────────────────────────────────────────────────────
export function newViewCache() { return new Map(); }

function shared(cache, key, make) {
  if (!cache) return make();
  if (cache.has(key)) return cache.get(key);
  const made = make();
  cache.set(key, made);
  return made;
}

const hasOp = (def, op) => (def?.effects || []).some((e) => e.op === op);

/* ★ §20-R4c — 세트 칸에 **문턱의 글**을 붙인다. 셈(owned·tiers)은 collectHooks 가 이미 했고,
   여기서는 정의표의 문구만 옮겨 적는다. 「왜」 화면이 규격에서 못 읽나 — publicArtifacts 가
   유물의 속살과 함께 sets 도 규격에서 걷어 냈다(§0-U-8). 문턱의 정본은 여전히 한 곳뿐이다. */
function setsWithSteps(sets, data) {
  const defs = data.artifacts.sets || {};
  const out = {};
  for (const [key, s] of Object.entries(sets || {})) {
    const steps = Object.keys(defs[key]?.bonuses || {})
      .map((need) => ({ need: Number(need), text: defs[key]?.tierText?.[need] ?? '',
                        on: (s.tiers || []).includes(Number(need)) }));
    out[key] = { ...s, steps };
  }
  return out;
}

/* ★ §20-R4e — 세 곳뿐인 신전에 이름표를 붙인다. 한 번만 골라 훑는다(노드마다 다시 고르면 제곱이 된다). */
function markTemples(world, nation, data, views) {
  const picked = templeNodes(world, nation, data);
  const byId = new Map(Object.values(picked).map((p) => [p.node.id, p.kind]));
  if (!byId.size) return views;
  for (const v of views) {
    const kind = byId.get(v.id);
    if (kind) { v.temple = kind.id; v.name = kind.name; }
  }
  return views;
}

/* 유물 사냥의 목적지는 서버가 정한다. 화면에는 이미 밟아 본 신전만 "발견"으로 보낸다. */
function artifactHuntView(world, nation, data) {
  const retryDays = data.balance.artifacts.templeRetryDays ?? 0;
  const temples = Object.values(templeNodes(world, nation, data)).map((p) => ({
    id: p.kind.id, nodeId: p.node.id, name: p.kind.name,
    found: isExplored(nation, p.node.x, p.node.y), completed: Boolean(nation.temples?.[p.node.id]?.done),
    retryAt: nation.temples?.[p.node.id]?.failedTick != null
      ? nation.temples[p.node.id].failedTick + retryDays : null,
    stage: nation.temples?.[p.node.id]?.stage ?? 'riddle',
  }));
  const clues = nation.templeClues ?? 0;
  return { clues, nextAt: 3 - (clues % 3), temples };
}

export function buildNationView(world, nationId, viewerRole, data, opts = {}) {
  const nation = world.nations[nationId];
  if (!nation) return null;
  const hooks = collectHooks(nation, data);
  const town = townOf(world, nation.id);
  const derived = deriveLabor(nation, data);
  const architect = roleStaffed(nation, 'build');
  const avatarId = opts.avatarId ?? null;
  // ★ Sprint 3 — 역할과 무관한 조각들은 이 방송 안에서 한 번만 빚는다(위 머리말 참고)
  const cache = opts.cache ?? null;
  const once = (key, make) => shared(cache, `${nationId}:${key}`, make);
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
    /* ★ §19-F3(F07-8) — 감정소는 첫 감정 뒤에도 할 일이 있다. 「언제 다시 열리는가」는 서버가 센다
       (화면이 날을 세면 옛 세이브·멀티에서 서로 다른 날을 가리킨다). 감정 전에는 필드가 없다. */
    ...(world.emotionDayDone ? { reappraisal: reappraisalState(world, nation, data) } : {}),
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
        ? { equipment: equipmentView(nation, nation.players?.[avatarId] ?? null, data, hooks) } : {}),
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
      // ★ §17-14 — claims: 깃발로 얻은 점령 원 목록. 화면이 본영 밧줄 곁에 점선 원을 더 그린다.
      territory: {
        radius: territoryRadius(nation, data), cx: town?.x ?? null, cy: town?.y ?? null,
        claims: claimViews(nation),
      },
      /* ★ §16-18 · §16-19 — 집결지·수비 깃발. 화면이 깃발을 그리고 단추의 상태를 안다. */
      rally: nation.rally ? { ...nation.rally } : null,
      defenseFlag: nation.defenseFlag ? { ...nation.defenseFlag } : null,
      // ★ GDD3 §4 — 주민은 실인원이다
      residents: once('residents', () => residentViews(nation, data, world)),
      housing: once('housing', () => housingView(nation, data, world)),
      peoplePerUnit: round2(peoplePerUnit(nation, data)),
      villagerMix: derived ? { counts: derived.counts, mix: round3Map(derived.mix), units: derived.units } : null,
      // ★ GDD3 §7 — 개별 건물 티어
      structures: once('structures', () => (nation.structures || []).map((s) => structureView(nation, s, data, { architect }))),
      sites: once('sites', () => (nation.construction || []).map((c) => siteView(nation, c, data))),
      // ★ GDD3 §7 — 울타리 조각
      fences: once('fences', () => fenceViews(nation, data)),
      fenceSummary: once('fenceSummary', () => fenceSummary(nation, data)),
      buildable,
      /* ★ GDD3 §14-7 — 열린 갈래 안의 잠긴 건물. 흐림 + 자물쇠 + 해금 조건으로 그려진다. */
      lockedBuildings: lockedCatalog(nation, data,
        new Set(buildable.map((b) => b.category).filter(Boolean))),
      workPosts: once('workPosts', () => listTargets(world, nation, data).map((t) => ({
        id: t.id, kind: t.kind, name: t.name, x: t.x, y: t.y, slots: t.slots,
        nodeType: t.nodeType ?? null, post: t.post ?? null, jobs: jobsForTarget(t, data),
        workers: (nation.villagers || []).filter((u) => u.targetId === t.id).length,
      }))),
      // 적 캠프는 '웨이브'가 열린 뒤에만 존재한다 — 그 전에는 지도에 아무 표시도 없다.
      camps: wavesOn ? campViews(world, nation, viewerRole, data) : [],
      exploredRatio: round3(exploredRatio(nation)),
      avatars: once('avatars', () => avatarViews(nation, data)),   // ★ Sprint 3 — worldDiff 와 같은 값이다
      players: once('players', () => playersView(nation, data)),
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
      /* ★ 2단계A — 탐험의 안내는 어전(10장)을 기다리지 않는다.
         「왜」 옮겼나 — 유적 카드(decisionQueue)와 유물 추적(artifactHunt)은 **3장부터 실제로
         일어나는 일**인데 뷰의 문이 councilOn(9장 완료) 안에 있었다. 그래서 방을 다 뒤져도
         알림 스택에 아무 줄이 서지 않았고, 유물을 주웠는데 「무엇을 모으는 중인가」를 볼 데가
         없었다 — 「일어난 일을 볼 수 없다」는 잠긴 것과 다른 종류의 사고다(§11-1 은 **없는 것**을
         감추라 했지, 있는 것을 감추라 하지 않았다).
         codex(3장, 도감)에 문을 맞춘 까닭 — 도감이 열리는 순간이 「기록을 읽는 눈」이 생기는
         자리다. 그 전에는 유적 자체를 만날 일이 드물어 빈 안내만 뜬다. */
      ...(on('codex') ? {
        artifactHunt: artifactHuntView(world, nation, data),
        decisionQueue: nation.decisionQueue,
      } : {}),
      /* ★ 2026-08 — 손에 든 유물은 어전(9장)을 기다리지 않는다. 문을 아예 걷어냈다.
         「왜」 — 유적은 앞 장부터 유물을 내어 주고 서버도 useArtifact 를 앞 장부터 받는다
         (progression.commandUnlocked). 그런데 이 목록만 councilOn 안에 있어서, 주운 것을
         보관함에서 볼 수도 쓸 수도 없었다 — 있는 것을 감춘 셈이다(§11-1 은 **없는 것**을 감추라 했지
         있는 것을 감추라 하지 않았다). 가진 게 없으면 빈 배열이라 앞 장의 화면에는 아무 일도 없다.
         어전 회의 자체(councils)와 그 밖의 해금은 차례 그대로다. */
      ...({
        artifacts: (nation.artifacts || []).map((a) => ({
          key: a.key, name: data.artifactsByKey[a.key]?.name, grade: data.artifactsByKey[a.key]?.grade,
          desc: data.artifactsByKey[a.key]?.desc, lore: data.artifactsByKey[a.key]?.lore ?? '',
          type: data.artifactsByKey[a.key]?.type,
          obtainedTick: a.obtainedTick, consumed: a.consumed,
          /* ★ §20-R4 — 심은 것(설치형)의 자리와 자란 단계. 「씨앗을 어디에 심었나」는 화면이
             지도에 그려야 하는 사실이라 뷰에 함께 나간다. 안 심었으면 null 이다. */
          planted: a.planted ?? null,
          /* ★ §20-R1 — 「N회 충전」 소모형이 몇 번 남았는가. 옛 화면은 consumed 만 보므로
             이 칸을 몰라도 깨지지 않는다(표시 개선은 R2 몫). 옛 세이브면 null 이 아니라 1이 온다. */
          chargesLeft: a.chargesLeft ?? (a.consumed ? 0 : 1),
          charges: data.artifactsByKey[a.key]?.charges ?? 1,
          /* ★ §20-R4c — 화면이 「봉인한다·심는다·자리를 고른다」 단추를 어디에 붙일지 알려면
             정의표의 네 칸이 필요하다. 규격(/api/config)에서는 유물의 속살을 걷어 냈으므로(§0-U-8)
             **가진 것에 한해** 뷰가 실어 보낸다 — 안 가진 유물의 성질은 여전히 알 수 없다. */
          curse: data.artifactsByKey[a.key]?.curse === true,
          sealed: Boolean(a.sealed),
          setKey: data.artifactsByKey[a.key]?.setKey ?? null,
          plantable: data.artifactsByKey[a.key]?.type === 'installable',
          picksRole: hasOp(data.artifactsByKey[a.key], 'maxOneRoleLevel'),
        })),
        // ★ §20-R4c — 봉인 값은 화면이 미리 알려 줘야 「금 80이 듭니다」라고 물을 수 있다.
        sealCostGold: data.balance.artifacts.sealCostGold ?? 0,
        /* ★ 4단계 — 봉인이 모든 유물로 넓어졌다. 저주가 아닌 것의 값은 따로다(보통 0) —
           화면이 「저주면 180, 아니면 0」을 제 손으로 알면 다이얼을 고칠 때마다 두 곳을 고쳐야 한다. */
        sealCostGoldPlain: data.balance.artifacts.sealCostGoldPlain ?? 0,
        /* ★ §20-R4(§20-5) — 세트 현황 {setKey:{name,owned,total,tiers}}. 도감·유물함이 「3/4」와
           「어느 문턱이 켜졌나」를 그리려면 조각 수를 화면이 다시 세면 안 된다(세는 규칙이 둘이
           되면 언젠가 어긋난다). 하나도 안 가졌으면 빈 객체라 옛 화면에도 아무 일이 없다. */
        artifactSets: setsWithSteps(hooks.sets, data),
        // ★ §22 — ruinGauge·ruinThreshold 송출은 폐지됐다. 유적 진행은 노드 뷰가 쥔다(rooms·roomsOpened·spent).
        //    decisionQueue 는 위 codex 문으로 옮겼다(2단계A) — 판단은 유물함보다 먼저 온다.
      }),
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
      /* ★ §20-R4(§20-3 폭풍의 망토 · §20-5 바람의 깃) — 이동 속도를 화면 몫으로 내보낸다.
         걸음은 클라가 재고 서버는 결과만 검산하므로(§19-B) 배수의 자리는 여기다.
         ⚠ 소비(public/js/avatar.js)는 **R4b 이월**이다 — 그 파일은 지금 다른 트랙이 고치고 있어
         손대지 않았다. 그때까지 이 두 칸은 「실려는 있고 아무도 안 읽는」 값이다.
         유물이 없으면 둘 다 0 이라 지금 화면이 이 칸을 읽어도 걸음이 달라지지 않는다.
         npcSpeedDelta(바람의 깃)도 같은 사정이라 R4b 로 함께 미룬다. */
      clientStats: {
        ...(hooks.clientStats ?? {}),
        moveSpeed: hooks.moveSpeedDelta, moveSpeedWave: hooks.moveSpeedWaveDelta,
      },
      nodeContribution: nodeContributionView(world, nation, data),
      // ★ GDD3 §13-B-5 — 위험 띠. HUD 가 지금 내가 어느 띠에 서 있는지를 이 값으로 읽는다.
      rings: ringRadii(nation, data),
      // ★ §17-17 — 처음 밟은 바이옴과 그날. 화면이 「이미 아는 땅」과 「처음 보는 땅」을 가른다.
      biomesSeen: { ...(nation.biomesSeen || {}) },
      /* ★ GDD3 §13-D-5 — 기술 트리와 철로. 두 겹의 문을 구별해 둔다.
         ① **장**(10장 끝이 없는 길)이 열기 전에는 필드 자체가 없다 — 연구 탭도 그려지지 않는다(§11-1).
         ② 장이 열린 뒤에는 **잠긴 연구도 목록에 남는다** — 조건 가시화 원칙(§12-3)대로
            「단계 3/4」를 빨강으로 적어 다음 걸음이 무엇인지 보여야 하기 때문이다. */
      ...(on('research') ? {
        research: researchView(nation, data),
        rails: researchFeature(nation, 'rails', data) ? railViews(nation) : [],
        railSummary: railSummary(nation, data),
        /* ★ §17-13 — 다리·매립. 철로와 같은 계약: 연구가 열기 전에는 빈 목록이다. */
        bridges: researchFeature(nation, 'bridges', data) ? bridgeViews(nation) : [],
        bridgeSummary: bridgeSummary(nation, data),
        fills: researchFeature(nation, 'landfill', data) ? fillViews(nation) : [],
        fillSummary: fillSummary(nation, data),
        /* ★ §19-F4(F09-2) — 기차. 철로와 같은 계약이다: 연구 전에는 open:false 인 빈 노선. */
        trains: trainViews(nation),
        trainSummary: trainSummary(nation, data),
      } : {}),
    },
    // ★ GDD3 §13-C-3 — 도감(J). 조우·처치 수는 서버가 권위로 세고, 잠긴 층은 필드 자체가 없다.
    codex: codexView(nation, data, world),
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
        tariff: round3(effectiveTariff(nation, data, { artifactDelta: hooks.tariffDelta, exemptAll: hooks.tariffExemptAll })),
        freight: round3(freightRate(nation, data, { artifactDelta: hooks.freightDelta, eventDelta: freightEventDelta(nation) })),
      },
      offers: world.offers.filter((o) => o.nationId !== nation.id),
      /* ★ §19-F3(F07-7) — 「어디에 팔면 더 받나」를 화면이 셈하지 않게 서버가 값을 다 빚어 보낸다.
         만나 본 나라만 실린다(값은 발로 얻는다 — §17-16 규율 그대로). */
      tradePartners: tradePartnerViews(world, nation, data, hooks),
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
    // ★ Sprint 3 — 위(view.defense)에서 이미 빚은 요약을 그대로 넘긴다. 옛 구현은 여기서 한 번 더
    //   지어 민병·터렛 목록과 다음 웨이브 규격을 국방대신 화면 한 장마다 두 번씩 셈했다.
    view.nation.weakSpots = weakSpots(world, nation, data, view.defense);
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
 * ★ §19-F3(F07-7) 교역 상대 한 곳의 첩 — 살 값 · 팔 값 · 성정 · 좌판.
 * 「왜」 두 값을 따로 보내나 — 같은 재화라도 그 나라에서 사는 값과 그 나라에 파는 값이 다르다.
 *   그 차이가 무역의 까닭이므로, 화면이 짐작하지 않도록 서버가 두 줄을 다 빚어 보낸다.
 */
function tradePartnerView(world, nation, other, data, hooks) {
  const buy = {}; const sell = {};
  // ★ §20-R1 — 화면이 보는 값도 유물을 함께 셈한다(서버가 빚는 두 줄이 실제 체결가와 어긋나면 안 된다)
  const opts = { artifactDelta: hooks.tariffDelta, exemptNationId: hooks.exemptNationId,
    exemptAll: hooks.tariffExemptAll, fxSpreadMultiplier: hooks.fxSpreadMultiplier,
    nationId: other.id, eventDelta: freightEventDelta(nation) };
  for (const r of data.resources.order) {
    buy[r] = round2(importPrice(foreignUnitPrice(other, r, 'buy', data), nation, data, opts));
    sell[r] = round2(exportPrice(foreignUnitPrice(other, r, 'sell', data), data, nation));
  }
  return { id: other.id, name: other.name, buy, sell,
    profile: tradeProfileView(other.id, data), specialties: specialtyList(world, nation, other.id, data) };
}

/** 만나 본 나라만 좌판을 편다 — 이름만 아는 나라의 값은 아직 우리 것이 아니다. */
function tradePartnerViews(world, nation, data, hooks) {
  return Object.values(world.nations)
    .filter((n) => !n.isPlayer && hasMet(nation, n.id))
    .map((n) => tradePartnerView(world, nation, n, data, hooks));
}

/**
 * 지금 지을 수 있는 건물 목록.
 * ★ GDD3 §11-1 — **잠긴 건물은 아예 실리지 않는다.** 「아직 세울 수 있는 것이 없습니다」 같은
 *   문구가 뜨는 상황 자체가 설계 실패이므로, 배치대는 이 목록이 비면 단추를 그리지 않는다.
 *   (해금 판정은 티어가 아니라 진행 감독의 '지금 장'이다.)
 */
/** ★ §17-14 — 깃발로 얻은 점령 원 목록(뷰 공용). 화면·미니맵이 이 원으로 새 땅을 그린다. */
function claimViews(nation) {
  return (nation.claims || []).map((c) => ({ id: c.id, x: c.x, y: c.y, radius: c.radius }));
}

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
      /* ★ §17-15 — 건축가 전용 건물. 자리(requiresRole)가 비어 있으면 카드에 자물쇠 사유를 적는다. */
      requiresRole: def.requiresRole ?? null,
      roleReady: !def.requiresRole || Boolean(nation.roles?.[def.requiresRole]?.holder),
      roleName: def.requiresRole ? (data.roles.defs[def.requiresRole]?.name ?? def.requiresRole) : null,
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

/**
 * ★ §19-A — 아바타 목록의 **정본**. `state.nation.avatars` · `worldDiff.avatars` · `avatars` 이벤트가
 *   모두 이 하나를 쓴다(PROTOCOL §0-P: bot·color·role·roleName·state·down·hp 는 서버가 실어 준다).
 */
export function avatarViews(nation, data) {
  return Object.values(nation.avatars || {}).map((a) => {
    /* ★ GDD3 §15-C — 이 아바타가 동료인가. 화면은 **아이디를 뜯어보지 않는다**:
       봇 여부·이름표 색·맡은 자리를 서버가 실어 보낸다(신원 판정은 서버의 몫이다). */
    const comp = companionById(nation, a.id);
    const role = comp?.role ?? Object.entries(nation.roles || {}).find(([, seat]) =>
      seat.holder === 'player' && seat.owner === a.id,
    )?.[0] ?? null;
    return {
      id: a.id, name: a.name ?? '개척자', x: a.x, y: a.y, tick: a.tick ?? 0,
      appearance: normalizeAppearance(a.appearance, data).appearance,
      down: (nation.players?.[a.id]?.downUntil ?? 0) > 0,
      hp: round2(nation.players?.[a.id]?.hp ?? 0),
      maxHp: nation.players?.[a.id]?.maxHp ?? 0,
      role,
      roleName: role ? (data.roles.defs[role]?.name ?? role) : null,
      ...(comp ? {
        bot: true,
        color: comp.color,
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
  /* ★ §22 — 「아직 몇 방 남았나」는 화면이 멀리서도 알아야 갈 이유가 된다(✦ n). 다 뒤진 자취는
     지워지지 않고 회색 폐허로 남으므로, 그 상태도 함께 실어야 화면이 「비었다」를 그릴 수 있다. */
  if (n.rooms != null) v.rooms = n.rooms;
  if (n.roomsOpened) v.roomsOpened = n.roomsOpened;
  if (n.spent) v.spent = true;
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

/**
 * ★ §18-D2 — 앞마당의 흔적. 노드와 달리 스냅샷도 변경분도 **통째로** 나른다.
 * 링0 안에 많아야 예닐곱이라 「무엇이 바뀌었나」를 가려내는 값이 목록 자체보다 비싸고,
 * 소진된 흔적이 목록에서 빠지는 것 하나로 화면의 지움까지 끝난다(removedNodes 같은 장부가 없어도 된다).
 */
const trailsFor = (world, nation, data) => trailViews(world, nation, data, isExplored);

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
    /* ★ §20-R4e — 신전은 지도에서 알아볼 수 있어야 한다. 유적 198곳이 다 같은 모양이면
       세 곳뿐인 신전을 찾는 것은 놀이가 아니라 노동이다. 안개 규칙은 그대로 —
       걸어 본 자리(isExplored)의 노드만 나가므로 가 보지 않은 신전은 애초에 오지 않는다. */
    nodes: markTemples(world, nation, data, (map.nodes || [])
      .filter((n) => nodeVisible(n) && isExplored(nation, n.x, n.y))
      .map((n) => nodeView(world, nation, n, data))),
    // ★ GDD3 §13-B-1 — 자원 군락. 숲 군락·딸기 들·바위 지대·강가 어장이 '지역'으로 읽히게 한다.
    clusters: clusterViews(world, nation),
    // ★ §18-D2 — 앞마당의 흔적(가 본 자리의 것만)
    trails: trailsFor(world, nation, data),
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
    territory: {
      cx: townXY(world, nation)[0], cy: townXY(world, nation)[1],
      radius: territoryRadius(nation, data), claims: claimViews(nation),
    },
    structures: (nation.structures || []).map((s) => structureView(nation, s, data)),
    fences: fenceViews(nation, data),
    tier: settlementTier(nation),
  };
}

/** 이 틱에 바뀐(또는 새로 밝아진 자리의) 노드만 — 안개 청크와 stamp 를 함께 본다 */
function worldNodeRows(world, nation, data, sinceTick, fogChunks) {
  const chunk = nation.fog?.chunk ?? data.world.fog.chunk;
  const changedChunks = new Set(fogChunks.map((c) => `${c[0]},${c[1]}`));
  const nodes = [];
  for (const n of world.map?.nodes || []) {
    if (!nodeVisible(n) || !isExplored(nation, n.x, n.y)) continue;
    const key = `${Math.floor(n.x / chunk)},${Math.floor(n.y / chunk)}`;
    const fresh = n.stamp > sinceTick || n.stamp === world.tick;
    if (fresh || changedChunks.has(key)) nodes.push(nodeView(world, nation, n, data));
  }
  return nodes;
}

/**
 * ★ §21-A1 — worldDiff 의 **일곱 컬렉션**(구조물·울타리·주민·야영지·아바타·군락·마을).
 * 여기서 한 번만 빚고, 장부가 있으면 아래 streamRows 가 그 가운데 바뀐 줄만 골라낸다.
 * ★ Sprint 3 — 목록 자체는 누가 보든 같은 값이라 한 방송 안에서 한 번만 빚는다(그릇 공유).
 */
function worldCollections(world, nation, nationId, data, once) {
  return {
    structures: once('diffStructures', () => (nation.structures || []).map((s) => structureView(nation, s, data))),
    fences: once('fences', () => fenceViews(nation, data)),
    camps: campViews(world, nation, null, data),
    clusters: clusterViews(world, nation),
    towns: (world.map?.towns || []).map((t) => ({
      nationId: t.nationId, x: t.x, y: t.y,
      radius: territoryRadius(world.nations[t.nationId] || {}, data),
      known: t.nationId === nationId || isExplored(nation, t.x, t.y),
    })),
  };
}

/**
 * 매 틱 — 바뀐 것만. 안개는 청크 RLE, 노드는 stamp 기반.
 * @param {object} opts {cache, stream}
 *   · cache  — ★ Sprint 3. 한 방송 안에서 buildNationView 와 **같은 그릇**을 받으면
 *     주민·울타리·공사장 목록을 그쪽이 이미 빚어 둔 것으로 쓴다(값이 같은 조각들이다).
 *   · stream — ★ §21-A1. 이 사람이 「지금까지 받은 것」의 장부. 주면 일곱 컬렉션이 변경분으로 나간다.
 *   둘 다 안 주면 예전처럼 전량을 그때그때 빚는다 — 시험과 단발 호출의 계약은 그대로다.
 */
export function buildWorldDiff(world, nationId, data, sinceTick = -1, opts = {}) {
  const nation = world.nations[nationId];
  if (!nation) return null;
  const cache = opts.cache ?? null;
  const once = (key, make) => shared(cache, `${nationId}:${key}`, make);
  const fogChunks = fogChunksSince(nation, sinceTick);
  const cols = worldCollections(world, nation, nationId, data, once);
  const base = {
    tick: world.tick,
    sinceTick,
    fog: fogChunks,
    nodes: worldNodeRows(world, nation, data, sinceTick, fogChunks),
    /* ★ §17-12 — 걷어 낸 자리. 노드 diff 는 '있는 것'만 실으므로 지워진 것은 이 목록이 알린다 —
       없으면 클라의 노드 사전에 유령 나무가 남는다. 같은 틱 안의 걷어내기도 실어야 하므로
       nodeView 의 fresh 판정과 같은 괄호(> sinceTick 또는 == 지금 틱)를 쓴다. */
    removedNodes: (world.map?.removedNodes || [])
      .filter((r) => r.tick > sinceTick || r.tick === world.tick)
      .map((r) => r.id),
    // ★ §18-D2 — 앞마당의 흔적. 조사로 소진된 것은 이 목록에서 사라지는 것으로 화면에서도 지워진다.
    trails: trailsFor(world, nation, data),
    rings: ringRadii(nation, data),
    // ★ GDD3 §13-C — 들에 사는 것들. 위치의 정본은 서버이고 화면은 그 사이를 보간한다.
    //   ★ Sprint 3 — 짐승 목록은 누가 보든 같다. 한 방송 안에서는 한 번만 빚는다.
    creatures: once('creatures', () => creatureViews(world, nation, data)),
    // ★ §12-6 — 무역이 열린 뒤에야 상단이 다닌다. 열리기 전에는 늘 빈 목록이라
    //   join 뒤에 8장이 열려도 다시 붙지 않고 그 자리에서 나타난다.
    caravans: caravansFor(nation, world.map, data),
    territory: {
      cx: townXY(world, nation)[0], cy: townXY(world, nation)[1],
      radius: territoryRadius(nation, data), claims: claimViews(nation),
    },
    /* 공사장은 나라 판(state.nation.sites)이 정본이고 여기 것은 거울이다 — 손에 꼽는 수라 그대로 둔다. */
    sites: once('sites', () => (nation.construction || []).map((c) => siteView(nation, c, data))),
    /* ★ §19-A · §21-A1 — 아바타는 **매번 전량**이다: 걸음이 곧 위치라 거의 모든 장에서 달라지고,
       사람 수는 손에 꼽는다. 골라내는 값이 아끼는 값보다 비싼 유일한 컬렉션이다. */
    avatars: once('avatars', () => avatarViews(nation, data)),
  };
  if (!opts.stream) return { ...base, ...cols, residents: once('residents', () => residentViews(nation, data, world)) };
  return { ...base, ...streamRows(opts.stream, cols, data) };
}

// ────────────────────────────────────────────────────────────────
// ★ §21-A1 — worldDiff 가 이름값을 한다: 일곱 컬렉션의 **변경분** 전송
//
// 「왜」. 이름은 diff 인데 실제로 변경분이던 것은 안개 청크와 노드뿐이었다. 나머지는 사람마다,
// 방송마다 **전량**이 다시 나갔다: 건물 마흔 채(효과표·다음 티어 값까지 한 채에 1KB 가까이),
// 주민 서른(능력치·적성·산출), 울타리 백 조각, 야영지·군락·마을. 후반 정착지에서 한 장이
// 60~150KB 였고, 그 가운데 실제로 달라진 것은 대개 **한 줄도 없었다**(하루가 조용히 지나가면
// 건물도 울타리도 어제 그대로다).
//
// 그래서 A-2(battleTick)가 세운 방식을 그대로 옮긴다 — 방이 아니라 **세션**이 장부를 쥔다
// (worldDiff 는 사람마다 다른 sinceTick 으로 나가므로 「누가 무엇까지 받았는가」도 사람마다 다르다).
//   · 구조물·울타리·야영지·군락·마을 — 지난번과 **지문이 달라진 줄만**. 사라진 것은 removed* 가 알린다.
//   · 주민 — **판(state.nation.residents)에만 싣는다.** 같은 방송에서 두 벌이 나가고 있었고,
//     화면의 병합은 애초에 판 쪽만 읽는다(public/js/state.js residents()). 세계 변경분에는 부재다.
//   · 아바타 — 전량 그대로(위 머리말).
// 되맞춤은 둘: 입장(world 스냅샷 + 첫 장은 언제나 full)과 `world.json simulation.worldFullEvery`
// 장마다 한 번 끼는 풀. 화면은 `counts`(서버가 아는 줄 수)로 스스로 어긋남을 알아채 지도를 다시 청한다.
// 판정·세이브·결정론은 한 눈금도 안 건드린다 — 여기는 전송 계층이다.
// ────────────────────────────────────────────────────────────────
const WORLD_FULL_EVERY = 20;
const worldFullEvery = (data) => Math.max(1, data.world?.simulation?.worldFullEvery ?? WORLD_FULL_EVERY);

/** 컬렉션마다 「사라진 것」을 알리는 열쇠말(군락·마을은 사라지지 않지만 계약은 같게 둔다) */
const REMOVED_KEY = {
  structures: 'removedStructures', fences: 'removedFences', camps: 'removedCamps',
  clusters: 'removedClusters', towns: 'removedTowns',
};

/** 세션 하나가 「지금까지 받은 것」 — 서버 런타임이 들고 다닌다(세이브에 넣지 않는다). */
export function worldStreamCache() { return { n: 0, cols: new Map() }; }

const rowId = (it) => it.id ?? it.nationId;

/** 컬렉션 하나의 장부 — id → 그 줄을 그대로 찍은 지문 */
function ledgerOf(stream, col) {
  if (!stream.cols.has(col)) stream.cols.set(col, new Map());
  return stream.cols.get(col);
}

/** 지난번과 **달라진 줄만**, 그리고 사라진 id 만. 장부는 늘 지금 목록과 같아진다. */
function collectionDelta(stream, col, list) {
  const seen = ledgerOf(stream, col);
  const rows = [];
  const live = new Set();
  for (const it of list) {
    const sig = JSON.stringify(it);
    live.add(rowId(it));
    if (seen.get(rowId(it)) !== sig) rows.push(it);
    seen.set(rowId(it), sig);
  }
  const removed = [...seen.keys()].filter((id) => !live.has(id));
  for (const id of removed) seen.delete(id);
  return { rows, removed, count: live.size };
}

/** 되맞춤 한 장 — 전량을 싣고 장부를 지금 목록으로 새로 새긴다. */
function worldFullRows(stream, cols) {
  stream.n = 1;
  const out = { full: true, counts: {} };
  for (const [name, list] of Object.entries(cols)) {
    out.counts[name] = collectionDelta(stream, name, list).count;
    out[name] = list;
  }
  return out;
}

/** 변경분 한 장 — 안 바뀐 컬렉션은 **열쇠말 자체가 없다**. */
function worldDeltaRows(stream, cols) {
  const out = { full: false, counts: {} };
  for (const [name, list] of Object.entries(cols)) {
    const d = collectionDelta(stream, name, list);
    out.counts[name] = d.count;
    if (d.rows.length) out[name] = d.rows;
    if (d.removed.length) out[REMOVED_KEY[name]] = d.removed;
  }
  return out;
}

/** 이 장이 되맞춤 차례(첫 장 포함)면 전량, 아니면 변경분. */
function streamRows(stream, cols, data) {
  if (stream.n % worldFullEvery(data) === 0) return worldFullRows(stream, cols);
  stream.n += 1;
  return worldDeltaRows(stream, cols);
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
    /* ★ §18-D2 — 흔적을 여기에도 싣는 까닭: 사슬을 한 번 조사하면 **그 순간** 다음 흔적 둘레의
       안개가 열린다. 이 즉시분에 흔적이 안 실리면 새 발자국은 다음 일 틱(최대 10분)까지 안 보인다. */
    trails: trailsFor(world, nation, data),
    towns: (world.map?.towns || [])
      .filter((t) => keys.has(`${Math.floor(t.x / fog.chunk)},${Math.floor(t.y / fog.chunk)}`))
      .map((t) => ({
        nationId: t.nationId, x: t.x, y: t.y,
        radius: territoryRadius(world.nations[t.nationId] || {}, data),
        known: t.nationId === nationId || isExplored(nation, t.x, t.y),
      })),
  };
}

/**
 * 세계 뷰 — 외교관 없으면 가격 마스킹.
 * ★ §17-16 — 다만 **직접 찾아가 본 나라**는 예외다: 도읍 앞까지 걸어간 값이 metNations 에 적혀 있으면
 *   외교관 자리가 비어도 그 나라의 시세는 계속 보인다(발로 얻은 정보는 사람이 자리를 비워도 남는다).
 */
export function buildWorldState(world, nationId, data) {
  const me = world.nations[nationId];
  const diplomat = hasDiplomat(me);
  const knownPrices = (id) => diplomat || hasMet(me, id);
  const hooks = collectHooks(me, data);
  const precise = hasSaintSight(me, data, hooks);
  const days = daysUntilWave(world, me);
  const spec = nextWaveSpec(world, me, data);
  return {
    nations: Object.values(world.nations).map((n) => {
      const t = townOf(world, n.id);
      const open = knownPrices(n.id);
      return {
        id: n.id,
        name: n.name,
        isPlayer: n.isPlayer,
        concept: data.aiNations.nations.find((a) => a.id === n.id)?.concept ?? null,
        /* ★ §17-16 — 찾아가 본 나라는 그 땅이 무엇을 품었는지도 함께 열린다(눈으로 봤으니까) */
        tags: n.tagsRevealed || hasMet(me, n.id) ? n.tags.map((tag) => data.tags[tag]?.name ?? tag) : null,
        prices: open ? foreignPriceTable(n, data) : null,
        masked: !open,
        // ★ §17-16 — 만난 날(게임일). 화면이 「언제 다녀왔는가」를 적는다. 못 만났으면 필드가 없다.
        ...(hasMet(me, n.id) ? { metTick: me.metNations[n.id] } : {}),
        population: n.isPlayer || diplomat ? Math.round(n.population) : null,
        town: t ? { x: t.x, y: t.y } : null,
        territoryRadius: territoryRadius(n, data),
        tier: n.tier ?? 0,
        // ★ §세계관 W4 — 관계 결(점수·호칭·다음 문턱). 만난 나라만 열린다 — 낯선 이의 마음은 모른다.
        relation: !n.isPlayer && hasMet(me, n.id) ? relationView(world, me, data, n.id) : null,
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
