// 클라이언트 명령 적용 — 서버 권위. 모든 검증은 여기서 한다 (클라 신뢰 금지).
// ★ v3(GDD3): 스윙(actionSwing/combatSwing) · 개별 건물 업그레이드(upgradeStructure) · 수리(repairStructure)
//   · 울타리 조각(placeFence/upgradeFence) 이 새로 들어왔고, 개척령(expand) · 자동 성곽(setWallFocus)
//   · 터렛 전용 명령(placeTurret) · 몸소 일하기(apAction work) · 현장 가속(workSite) 은 폐기됐다.
import {
  collectHooks, useArtifact, artifactFoundEvent,
  // ★ §20-R4(유물기획 §20-11) — 유물이 세계에 손을 대는 세 가지. 판정은 전부 저쪽에 있고
  //   여기는 인자를 재고 넘길 뿐이다(명령 계층은 얇게, 규칙은 도메인에).
  sealArtifact, plantArtifact, pickTyrantRole,
  // ★ §20-R4b — 국가 이벤트 보상도 같은 문을 쓴다
  grantVia,
} from './artifacts.js';
import { resolveTempleChoice, enterTemple } from './temple.js';   // ★ §20-R4b — 고대 신전의 세 단
import { localPrice, importPrice, exportPrice, round2, clamp } from './economy.js';
import { validateOrders } from './orders.js';
import { reassign } from './npc.js';
// ★ §17-16 — 찾아간 나라의 시세표(방문 모달이 그대로 읽는다)
import { isLastPlace, foreignPriceTable } from './ai_nation.js';
// ★ §세계관 W3 — 매듭형 엔딩(초대장 열기·재회 근사 게이지·재회 매입 우대)
import { acceptEnding, countTradeGold, reunionSellPremium } from './ending.js';
// ★ §세계관 W4 — 관계 결: 거래 성사·거절이 게이지를 움직인다
import { onTradeDone, onOfferRefused, relationView } from './relations.js';
import { performApAction, harvestNode, resolveRuinChoice } from './king.js';
import { townOf, ringAt, revealConcealed, nodeById, inTerritory, removeNode } from './world.js';
import { recordRuinFound, discoverBiomes } from './codex.js';
import {
  validateAppearance, normalizeAppearance, pushChat, memberAppearance, upsertMember, normalizeMembers,
} from './social.js';
import { normalizeBattlePlan } from './tactics.js';
// ★ §19-E(F04-4) — 침공 앞당기기. 준비를 끝낸 사람이 제 손으로 그날을 당긴다.
import {
  rushWave, canRushWave, nextWaveSpec, ensureCamps, campEventView, daysUntilWave,
  // ★ Sprint 5 — 야영지 선제 타격. 기다리는 동안 「할 수 있는 일」의 둘째 문이다.
  strikeCamp,
} from './waves.js';
import { adviceCommand } from './advisor.js';
import {
  assignByAlloc, assignByMix, commandVillagers as placeVillagers, deriveLabor, mixFromAlloc,
  resolveTarget, jobsForTarget,
} from './villagers.js';
import {
  startBuild, startUpgrade, repairStructure, reclaimField as doReclaim, structureDef,
  toolDiscount, adjacencyDetail, syncLegacyBuildings,
  startDemolish, startRelocate, cancelStructureWork, structureView, structuresOf, maxTier,
} from './structures.js';
import { autoPlaceIdle } from './assign.js';
import { placeFence, upgradeFence, repairFence, removeFence } from './fences.js';
import { actionSwing } from './actions.js';
// ★ GDD3 §14-5 — 레벨·스탯도 서버가 정본이다(allocStat).
import { ensurePlayer, allocStat, playerView, playerMaxHp, grantXp } from './skills.js';
// ★ §17-9 — 건물 손일(handWork): 산출은 창고 상한을 지킨다
import { deposit } from './storage.js';
import { findStructure, isRuined, footprint } from './structures.js';
import { dist } from './world.js';
import { revealAvatar } from './fog.js';
import { combatSwing } from './battle.js';
// ★ GDD3 §13-C-8 — 웨이브 밖의 검. 들에 사는 것들을 벤다.
import { huntSwing, tameCreature } from './ecology.js';
// ★ §19-F2(F07-4) — 굴 앞의 경고. 용의 자리는 서버만 안다.
import { dragonWarning } from './dragon.js';
import { settlementTier, promoteSettlement, nextTierStatus, tierDef } from './tiers.js';
// ★ GDD3 §13-D — RPG 계층: 모집 · 장비/인첸트 · 연구/철로
import { recruitResident, recruitStatus } from './residents.js';
import { craftEquipment, enhanceEquipment, enchantEquipment, equipmentView } from './equipment.js';
import {
  startResearch, researchView, placeRail, removeRail,
  // ★ §17-13 — 다리·매립: 철로와 같은 칸 배치, 다만 물 위에만 놓인다
  placeBridge, removeBridge, placeFill, removeFill,
  // ★ §19-F3(F07-5) — 금화로 궁리를 하루 앞당긴다(특산품 「지혜의 잎」도 같은 문으로 들어온다)
  hastenResearch, applyResearchDays,
} from './research.js';
// ★ §19-F4(F09-2) — 기차: 정거장에서 타고, 다음 정거장에서 내린다
import { boardTrain, leaveTrain, riding, trainViews, trainSummary } from './train.js';
// ★ §19-F3(F07-7) — 나라마다 다른 시세와 특산품 좌판
import { foreignUnitPrice, tradeProfileView, specialtyList, specialtyStock, nationDef } from './trade.js';
import {
  featureUnlocked, buildingUnlocked, departmentsActive, commandUnlocked, setFlag, checkTrace,
  evaluateProgress, currentChapter,
} from './progression.js';
import { runEmotionDay, reappraisalState, runReappraisal } from './emotion_day.js';
// ★ GDD3 §15-C — 동료 봇(= 각료)과 자동 플레이 · ★ §17-11 — 동료 지시·꾸미기
import { setAutoPlay, bindCompanionRoles, syncCompanionSeats, autoPlayView, companionById } from './companions.js';
import { record as chronicle } from './chronicle.js';
// ★ §18-D2 — 링0 앞마당의 흔적 조사(E 한 손잡이가 여는 세 번째 것)
import { investigateTrail } from './trails.js';

const err = (code, message) => ({ ok: false, error: { code, message } });
const ok = (data = {}) => ({ ok: true, ...data });

function structureBlocks(nation, data, x, y) {
  for (const s of nation.structures || []) {
    // `campfire` remains the persistent key of the settlement HQ after
    // promotion, so it must block avatar position reports like any building.
    const { w, h } = footprint(s.key ?? s.building, data, s.tier);
    if (x >= s.x && x < s.x + w && y >= s.y && y < s.y + h) return true;
  }
  for (const site of nation.construction || []) {
    if (site.mode !== 'build' || site.x == null || site.y == null) continue;
    const { w, h } = footprint(site.building, data);
    if (x >= site.x && x < site.x + w && y >= site.y && y < site.y + h) return true;
  }
  return false;
}

/**
 * ★ §12-2 — 본부는 정착지 티어를 그대로 입는다(모닥불→야영 본부→촌락 회관→…).
 *   손으로 개축하지 않는다(autoTier). 승격이 함께 키우고, 내구도도 새 티어 기준으로 되살아난다.
 */
function growHq(nation, data) {
  const want = settlementTier(nation) + 1;
  for (const s of nation.structures || []) {
    const def = data.buildings[s.key];
    if (!def?.autoTier) continue;
    const t = Math.min(maxTier(s.key, data), want);
    if (t <= s.tier) continue;
    const ratio = s.maxHp ? Math.min(1, (s.hp ?? s.maxHp) / s.maxHp) : 1;
    s.tier = t;
    s.maxHp = def.tiers[t - 1]?.hp ?? s.maxHp;
    s.hp = Math.round(s.maxHp * Math.max(ratio, 0.6) * 100) / 100;
  }
}

export { toolDiscount };

export function recommendedLabor(nation, data) {
  const base = { ...data.balance.labor.defaultAlloc };
  const days = nation.wave?.arrivalTick != null ? nation.wave.arrivalTick - (nation.lastSeenTick ?? 0) : null;
  if (days != null && days <= data.balance.combat.surgeWindowDays) {
    const shift = 0.2;
    base.defense = clamp(base.defense + shift, 0, 0.9);
    base.factory = Math.max(0.05, base.factory - shift / 2);
    base.build = Math.max(0.05, base.build - shift / 2);
  }
  const grainDays = (nation.resources?.grain || 0) / Math.max(1, nation.population);
  if (grainDays < 3) {
    base.farm = clamp(base.farm + 0.1, 0, 0.8);
    base.build = Math.max(0.02, base.build - 0.1);
  }
  return normalizeAlloc(base, data);
}

export function normalizeAlloc(alloc, data) {
  const keys = Object.keys(data.balance.labor.defaultAlloc);
  const out = {};
  let sum = 0;
  for (const k of keys) { out[k] = Math.max(0, Number(alloc?.[k] ?? 0)); sum += out[k]; }
  const max = data.balance.labor.maxTotal;
  if (sum > max) for (const k of keys) out[k] = (out[k] / sum) * max;
  return out;
}

/** 노동 배분 적용 — 배치가 정본이다. 주민이 없으면 아무 일도 하지 않는다. */
/**
 * ★ §19-C — 나눔 직후의 「노는 손」을 그 자리에서 앉히고, 파생 laborAlloc 을 다시 낸다.
 * tick.js 1-c 가 하루에 한 번 하던 일과 같은 셈이다 — 다른 것은 **기다리지 않는다**는 것뿐.
 */
function reseatIdle(world, nation, data) {
  const seated = autoPlaceIdle(world, nation, data);
  if (!seated.length) return 0;
  const derived = deriveLabor(nation, data);
  if (!derived) return seated.length;
  nation.laborAlloc = normalizeAlloc(derived.alloc, data);
  nation.gatherScale = derived.gatherScale;
  return seated.length;
}

export function applyLabor(world, nation, alloc, data) {
  const norm = normalizeAlloc(alloc, data);
  if (!(nation.villagers || []).length) {
    nation.laborAlloc = norm;
    return { alloc: norm, derived: false };
  }
  const derived = assignByAlloc(world, nation, norm, data);
  nation.laborAlloc = normalizeAlloc(derived.alloc, data);
  nation.gatherScale = derived.gatherScale;
  return { alloc: nation.laborAlloc, requested: norm, mix: derived.mix, counts: derived.counts, derived: true };
}

export { buildingCost } from './build_cost.js';

/* ★ §17-16 — 이웃 나라 찾아가기.
   세 나라는 여태 '교역 목록의 이름'이었다. 도읍이 지도 위에 서 있는데도 걸어가 볼 일이 없었다.
   이제 도읍 중심 towns.visitRadius 안에 내 아바타가 서면 그 나라를 **만난 나라**로 적는다
   (metNations[상대] = 그날). 만난 나라의 시세는 외교관 자리가 비어도 계속 보인다 —
   발로 얻은 정보는 사람이 자리를 비운다고 잊히지 않는다(view.js buildWorldState 가 이 표를 읽는다). */
export const visitRadius = (data) => data.world.towns.visitRadius ?? 6;

/** 찾아간 나라의 첩(帖) — 이름·컨셉·태그·시세. 방문 화면이 이대로 읽는다. */
function nationBrief(other, data) {
  const def = data.aiNations.nations.find((a) => a.id === other.id) ?? null;
  return {
    nationId: other.id,
    name: other.name,
    concept: def?.concept ?? null,
    tagNames: (other.tags || []).map((t) => data.tags[t]?.name ?? t),
    prices: foreignPriceTable(other, data),
    /* ★ §19-F3(F07-7) — 무엇을 헐값에 내주고 무엇을 후하게 사는가. 이 첩 하나가 무역의 까닭이다. */
    tradeProfile: tradeProfileView(other.id, data),
  };
}

export function visitNation(world, nation, cmd, data) {
  const av = nation.avatars?.[cmd.avatarId ?? cmd.playerName ?? 'lord'];
  if (!av) return err('NO_AVATAR', '아바타가 없습니다.');
  const other = world.nations[String(cmd.nationId ?? cmd.payload?.nationId ?? '')];
  if (!other || other.id === nation.id) return err('NO_NATION', '그런 나라가 없습니다.');
  const town = townOf(world, other.id);
  if (!town) return err('NO_TOWN', '그 나라의 도읍을 아직 찾지 못했습니다.');
  if (dist(av.x, av.y, town.x, town.y) > visitRadius(data)) {
    return err('OUT_OF_RANGE', '도읍 앞까지 더 걸어가야 합니다.');
  }
  const met = (nation.metNations ||= {});
  const first = met[other.id] == null;
  met[other.id] = world.tick;
  return ok({
    ...nationBrief(other, data), first, tick: world.tick, x: town.x, y: town.y,
    specialties: specialtyList(world, nation, other.id, data),
    relation: relationView(world, nation, data, other.id),   // ★ §세계관 W4 — 첩에 「우리 사이」가 실린다
  });
}

/**
 * ★ §19-F3(F07-7) 특산품 구매 — 금화가 다시 물건이 되는 자리.
 * 교역소가 서고(무역 해금) 그 나라를 만나 본 뒤에만 좌판이 열린다 — 값은 발로 얻는다는 규율 그대로다.
 */
function buySpecialty(world, nation, cmd, data) {
  if (data.balance.trade.requiresTradingPost && !featureUnlocked(nation, 'trade', data)) {
    return err('TRADE_LOCKED', '아직 바깥과 값을 주고받을 수 없습니다. 교역소를 세우십시오.');
  }
  const partnerId = String(cmd.nationId ?? cmd.payload?.nationId ?? '');
  if (!hasMet(nation, partnerId)) return err('NOT_MET', '먼저 그 나라의 문 앞까지 걸어가야 합니다.');
  const item = (nationDef(partnerId, data)?.specialties || [])
    .find((s) => s.key === (cmd.key ?? cmd.payload?.key));
  if (!item) return err('NO_ITEM', '그런 물건이 좌판에 없습니다.');
  const st = specialtyStock(nation, partnerId, item);
  if (!(st.left > 0)) return err('SOLD_OUT', '다 팔렸습니다 — 며칠 뒤에 다시 들어옵니다.');
  if (nation.gold < item.gold) return err('NO_GOLD', `금화가 모자랍니다 — ${item.gold} 이 듭니다.`);
  return payAndGrant(world, nation, { partnerId, item, st }, data);
}

/** 값을 치르고 물건을 안긴다 — 자원이든 연구 하루든 감정소 표든 같은 문으로 나간다. */
function payAndGrant(world, nation, { partnerId, item, st }, data) {
  nation.gold = round2(nation.gold - item.gold);
  nation.stats.goldSpent = round2((nation.stats.goldSpent || 0) + item.gold);
  st.left -= 1;
  if (st.left <= 0) st.restockTick = world.tick + (item.restockDays ?? 3);
  const granted = grantSpecialty(nation, item.grant || {}, data);
  return ok({
    nationId: partnerId, key: item.key, name: item.name, gold: item.gold, granted,
    left: st.left, resources: { ...nation.resources }, research: researchView(nation, data),
  });
}

/** 특산품이 안기는 것 — 자원 · 연구 하루 · 재감정 표. 새 낱말이 필요하면 여기만 는다. */
function grantSpecialty(nation, grant, data) {
  const out = {};
  if (grant.resource && grant.amount > 0) {
    nation.resources[grant.resource] = round2((nation.resources[grant.resource] || 0) + grant.amount);
    out.resource = { key: grant.resource, amount: grant.amount };
  }
  if (grant.researchDays > 0) out.researchDays = applyResearchDays(nation, grant.researchDays, data);
  if (grant.reappraiseCharges > 0) {
    nation.reappraisalCharges = (nation.reappraisalCharges || 0) + grant.reappraiseCharges;
    out.reappraiseCharges = nation.reappraisalCharges;
  }
  return out;
}

/**
 * ★ §19-F3(F07-9) 꾸미기 값 — 소액 금화. 0 이면 공짜다(옛 세이브·시험이 그대로 돈다).
 * @returns {{ok:true, cost:number}|{ok:false,error}}
 */
function chargeCustomize(nation, kind, data) {
  const cost = data.balance.gold?.customize?.[kind] ?? 0;
  if (!(cost > 0)) return { ok: true, cost: 0 };
  if (nation.gold < cost) return err('NO_GOLD', `금화가 모자랍니다 — ${cost} 이 듭니다.`);
  nation.gold = round2(nation.gold - cost);
  nation.stats.goldSpent = round2((nation.stats.goldSpent || 0) + cost);
  return { ok: true, cost };
}

/** 이름·외형 입력을 한 번에 검사한다 — 동료와 주민이 같은 자를 쓴다. */
function readCustomize(cmd, target, data) {
  const rawName = cmd.name ?? cmd.payload?.name;
  const rawLook = cmd.appearance ?? cmd.payload?.appearance;
  const max = data.world.appearance.nameMaxLength;
  let name = null;
  if (rawName != null) {
    if (typeof rawName !== 'string') return err('BAD_NAME', '이름이 올바르지 않습니다.');
    name = rawName.trim();
    if (!name.length || name.length > max) return err('BAD_NAME', `이름은 1~${max}자여야 합니다.`);
  }
  const appearance = rawLook != null ? normalizeAppearance(rawLook, data, target.appearance).appearance : null;
  if (name == null && appearance == null) return err('NOTHING_TO_CHANGE', '바꿀 것이 없습니다.');
  return { ok: true, name, appearance };
}

/** ★ §17-16 — 이 나라를 만난 적이 있는가(가격 마스킹 완화의 정본) */
export const hasMet = (nation, otherId) => (nation?.metNations?.[otherId] ?? null) != null;

/** 역할 명령 잠금 — 티어 3(감정의 날) 전에는 역할이 없다 */
function roleLocked(world, nation, data) {
  if (!data.world.roleTiming.unlockAfterEmotionDay) return false;
  return !world.emotionDayDone || !featureUnlocked(nation, 'roles', data);
}

/**
 * ★ 진행 감독 관문 (GDD3 §11-1).
 *   chapters.json 에 '이 장에서 열린다'고 적힌 명령은 그 장 전에는 아예 받지 않는다.
 *   화면은 그 단추를 애초에 그리지 않으므로(§11-5) 여기까지 오는 것은 봇·구버전 클라·조작뿐이다.
 *   어디에도 안 적힌 명령(걷기·채팅 등)은 언제나 통과한다 — '선언된 문'만 잠근다.
 */
export function applyCommand(world, nationId, cmd, data, rng) {
  const nation = world.nations[nationId];
  if (!nation) return err('NO_NATION', '국가를 찾을 수 없습니다.');
  if (!commandUnlocked(nation, cmd.type, data)) {
    return err('CHAPTER_LOCKED', `${commandLabel(cmd.type)}은(는) 아직 열리지 않았습니다. 왼쪽 목표를 완료해 다음 단계로 진행하세요.`);
  }
  const res = runCommand(world, nationId, cmd, data, rng);
  if (!res.ok || !nation.isPlayer) return res;
  // 장 사슬은 명령 직후에 다시 잰다 — 일 틱(최대 10분)을 기다리면 "다음에 뭘 하지"가 멈춘다.
  const progressed = evaluateProgress(world, nation, data);
  if (progressed.length) res.events = [...(res.events || []), ...progressed];
  return res;
}

function commandLabel(type) {
  return ({ placeBuilding: '건설', startResearch: '연구', trade: '교역',
    recruitResident: '주민 모집', councilAck: '어전 회의', enterTemple: '신전 조사' })[type] || '이 행동';
}

function runCommand(world, nationId, cmd, data, rng) {
  const nation = world.nations[nationId];
  if (!nation) return err('NO_NATION', '국가를 찾을 수 없습니다.');
  const hooks = collectHooks(nation, data);
  // ★ 시각 주입 — 테스트·시뮬은 cmd.now 로 결정론 시각을 넣는다. 0도 유효한 값이라 ?? 로만 받는다.
  const nowRaw = Number(cmd.now ?? cmd.payload?.now);
  const now = Number.isFinite(nowRaw) ? nowRaw : Date.now();

  switch (cmd.type) {
    // ── GDD3 §3 — 스윙 (실시간, 틱을 기다리지 않는다) ────────────
    case 'actionSwing': {
      const res = actionSwing(world, nation, cmd, data, now);
      /* ★ §20-R1.5 — 숨은 궤가 유물을 내어준 순간. 조사 행동의 **직접 피드백**이므로
         상자·유적과 똑같이 발견 사실을 띄운다(연출은 클라, 판정은 이미 끝났다). */
      if (res.ok && res.cache?.artifact) {
        res.events = [...(res.events || []), artifactFoundEvent(world, nation, res.cache.artifact.key, 'cache', data)];
      }
      return res.ok ? ok(res) : res;
    }
    case 'combatSwing': {
      /* ★ GDD3 §13-C-8 — 같은 명령이 두 자리에서 쓰인다.
         웨이브 전투 중이면 밀려온 적을, 아니면 들에 사는 짐승·야생 적을 벤다.
         (명령을 새로 만들지 않은 까닭: 손에 든 것은 같은 검이고 규칙도 같다 — 쿨타임·사거리·다운.) */
      const res = (nation.battle && !nation.battle.over)
        ? combatSwing(world, nation, cmd, data, now)
        : huntSwing(world, nation, cmd, data, now);
      return res.ok ? ok(res) : res;
    }

    /* ★ §19-F1(F08-4) — 잡는 대신 데려온다. 사냥(combatSwing)과 나란히 선 별개의 손짓이라
       명령도 따로 둔다: 같은 짐승 앞에서 유저가 무엇을 고를지가 갈리기 때문이다. */
    case 'tameCreature': {
      const res = tameCreature(world, nation, cmd, data);
      return res.ok ? ok(res) : res;
    }

    case 'setLabor': {
      const target = cmd.recommended ? recommendedLabor(nation, data) : cmd.alloc;
      const res = applyLabor(world, nation, target, data);
      /* ★ §19-C — 나눈 자리에서 곧장 일터로 보낸다. 몫이 반올림되며 남은 손은 도읍에 유휴로
         섰고, 그들을 앉히는 유지보수 패스는 **다음 일 틱**(최대 10분)에나 돌았다 — 「알아서
         나누기를 눌렀는데 다들 정착지에 모여 있다」(B05-1)의 절반이 이 기다림이었다. */
      return ok({ ...res, seated: reseatIdle(world, nation, data) });
    }

    case 'setVillagerMix': {
      if (!(nation.villagers || []).length) return err('NO_VILLAGERS', '움직일 주민이 없습니다.');
      const mix = cmd.mix ?? mixFromAlloc(cmd.alloc ?? nation.laborAlloc, data, {
        gather: cmd.gather, scout: cmd.scout,
      });
      const derived = assignByMix(world, nation, mix, data);
      nation.laborAlloc = normalizeAlloc(derived.alloc, data);
      nation.gatherScale = derived.gatherScale;
      const seated = reseatIdle(world, nation, data);          // ★ §19-C — setLabor 와 같은 문
      return ok({ mix: derived.mix, counts: derived.counts, alloc: nation.laborAlloc,
        gatherScale: derived.gatherScale, seated });
    }

    /* ★ §16-18 — 랠리 포인트(RTS 의 집결지). 본부에 깃발을 꽂아 두면
       갓 도착한 주민이 손 갈 것 없이 그 일터로 걸어가 일을 시작한다. null 이면 걷는다. */
    case 'setRally': {
      const targetId = cmd.targetId ?? cmd.payload?.targetId ?? null;
      if (targetId == null) {
        nation.rally = null;
        return ok({ rally: null });
      }
      const target = resolveTarget(world, nation, targetId, data);
      if (!target) return err('BAD_TARGET', '그런 일터가 없습니다.');
      if (!jobsForTarget(target, data).length) return err('NO_JOB', '그곳에서 할 수 있는 일이 없습니다.');
      nation.rally = { targetId, x: target.x, y: target.y, name: target.name };
      return ok({ rally: { ...nation.rally } });
    }

    /* ★ §16-19 — 수비 깃발(어택땅에서 배웠다). 꽂아 두면 수비 배치 주민이 그리로 모여 서고,
       국방을 맡은 동료도 그 곁을 지킨다. 웨이브가 그 방향에서 오면 민병이 이미 진을 치고 있다.
       null 이면 걷는다 — 주민은 제 초소로 돌아간다. */
    case 'setDefenseFlag': {
      const fx = cmd.x ?? cmd.payload?.x ?? null;
      const fy = cmd.y ?? cmd.payload?.y ?? null;
      if (fx == null || fy == null) {
        nation.defenseFlag = null;
        return ok({ defenseFlag: null });
      }
      const x = Math.round(Number(fx));
      const y = Math.round(Number(fy));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= data.world.size || y >= data.world.size) {
        return err('BAD_POSITION', '지도 밖입니다.');
      }
      nation.defenseFlag = { x, y };
      // 수비 배치 주민은 그 자리로 모여 선다(민병은 전투가 서는 순간 제가 선 자리에서 싸운다)
      let moved = 0;
      for (const u of nation.villagers || []) {
        if (u.job !== 'defense') continue;
        u.destX = x + ((moved % 3) - 1);
        u.destY = y + (Math.floor(moved / 3) % 3) - 1;
        moved += 1;
      }
      return ok({ defenseFlag: { ...nation.defenseFlag }, moved });
    }

    case 'commandVillagers': {
      if (!(nation.villagers || []).length) return err('NO_VILLAGERS', '움직일 주민이 없습니다.');
      const res = placeVillagers(world, nation, cmd, data);
      if (!res.ok) return res;
      const derived = deriveLabor(nation, data);
      if (derived) {
        nation.laborAlloc = normalizeAlloc(derived.alloc, data);
        nation.gatherScale = derived.gatherScale;
      }
      return ok({ ...res, alloc: nation.laborAlloc, counts: derived?.counts ?? null });
    }

    case 'setQueue': {
      const q = cmd.factory || {};
      const keys = ['steel', 'fuel', 'weapon'];
      let sum = 0;
      const out = {};
      for (const k of keys) { out[k] = Math.max(0, Number(q[k] ?? 0)); sum += out[k]; }
      if (sum <= 0) return err('BAD_QUEUE', '공장 큐 배분이 비어 있습니다.');
      for (const k of keys) out[k] /= sum;
      nation.factoryQueue = out;
      return ok({ factoryQueue: out });
    }

    // ── GDD3 §7 — 건물: 배치 · 개별 업그레이드 · 수리 ─────────────
    case 'placeBuilding':
    case 'placeTurret':                    // ★ 별칭(하위 호환): 터렛도 그냥 건물이다
    case 'buildStart': {                   // ★ 좌표 없는 착공 — 봇·섭정·조언 매크로 전용
      const key = cmd.building ?? cmd.key ?? cmd.turretType ?? cmd.payload?.building;
      if (!structureDef(key, data)) return err('BAD_BUILDING', '알 수 없는 건물입니다.');
      // ★ 해금은 티어가 아니라 '지금 장'이 정본이다(GDD3 §11-1). 화면의 배치대에는 애초에
      //   현재 장에서 지을 수 있는 것만 실리므로, 이 오류는 봇·구버전 클라만 본다.
      if (nation.isPlayer && !buildingUnlocked(nation, key, data)) {
        return err('CHAPTER_LOCKED', `${data.buildings[key].name}은(는) 아직 세울 때가 아닙니다.`);
      }
      const res = startBuild(world, nation, { ...cmd, building: key }, data, hooks);
      if (!res.ok) return res;
      syncLegacyBuildings(nation, data);
      return ok(res);
    }
    case 'upgradeStructure': {
      const res = startUpgrade(world, nation, cmd, data, hooks);
      if (!res.ok) return res;
      syncLegacyBuildings(nation, data);
      return ok(res);
    }
    case 'repairStructure': {
      const res = repairStructure(world, nation, cmd, data, hooks);
      return res.ok ? ok(res) : res;
    }

    // ── ★ GDD3 §12-12 — 철거 · 이전 · 되돌리기 ────────────────────
    case 'demolishStructure': {
      const res = startDemolish(world, nation, cmd, data, hooks);
      if (!res.ok) return res;
      syncLegacyBuildings(nation, data);
      return ok(res);
    }
    case 'relocateStructure': {
      const res = startRelocate(world, nation, cmd, data, hooks);
      if (!res.ok) return res;
      syncLegacyBuildings(nation, data);
      return ok(res);
    }
    case 'cancelStructureWork': {
      const res = cancelStructureWork(world, nation, cmd, data);
      if (!res.ok) return res;
      syncLegacyBuildings(nation, data);
      return ok(res);
    }

    // ── ★ GDD3 §12-2 — 정착지 승격. 본부의 [승격] 단추가 유일한 방아쇠다 ──
    case 'promoteSettlement': {
      if (!nation.isPlayer) return err('NO_NATION', '이 나라는 승격하지 않습니다.');
      const res = promoteSettlement(world, nation, data);
      if (!res.ok) return res;
      growHq(nation, data);
      syncLegacyBuildings(nation, data);
      chronicle(world, {
        kind: 'tier_up', title: res.up.name,
        text: res.up.line ?? `정착지가 ${res.up.name}이(가) 되었다.`, data: res.up,
      }, data);
      return ok({
        up: res.up,
        tier: res.up.tier,
        next: nextTierStatus(nation, data),
        events: [{ kind: 'tier_up', nationId: nation.id, data: { ...res.up, unlockedAll: tierDef(res.up.tier, data).unlocks } }],
      });
    }

    // ── GDD3 §7 — 울타리 조각(드래그 배치) ────────────────────────
    // ── ★ GDD3 §13-D-2 — 본부의 [모집] ─────────────────────────
    case 'recruitResident': {
      const res = recruitResident(world, nation, data, rng);
      if (!res.ok) return res;
      const info = {
        id: res.resident.id, name: res.resident.name, x: res.resident.x, y: res.resident.y,
        stats: { ...res.resident.stats }, population: Math.floor(nation.population || 0),
        recruited: true,
      };
      return ok({
        resident: info, cost: res.cost, recruit: res.status,
        resources: { ...nation.resources },
        events: [{ kind: 'resident_arrived', nationId: nation.id, data: info }],
      });
    }

    /* ── ★ GDD3 §14-5 — 스탯 포인트 나누기 (캐릭터 창 C) ──────────
       레벨은 서버가 스킬 XP 총합으로 낸다. 화면은 「이 능력치에 한 점」이라고 청할 뿐이고,
       남은 점수가 있는지·그런 능력치가 있는지는 여기서만 판정한다. 리스펙은 없다. */
    case 'allocStat': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const key = String(cmd.stat ?? cmd.payload?.stat ?? '');
      const res = allocStat(player, key, data, cmd.count ?? cmd.payload?.count ?? 1);
      if (!res.ok) return res;
      return ok({
        ...res,
        player: playerView(nation, player.id, data),
      });
    }

    // ── ★ GDD3 §13-D-3·4 — 대장간에서 벼리고, 더 벼리고, 깃들인다 ──
    case 'craftEquipment': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const res = craftEquipment(nation, player, { ...cmd, tick: world.tick }, data, hooks);
      if (!res.ok) return res;
      return ok({ ...res, equipment: equipmentView(nation, player, data, hooks), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }
    case 'enhanceEquipment': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const res = enhanceEquipment(nation, player, cmd, data);
      if (!res.ok) return res;
      return ok({ ...res, equipment: equipmentView(nation, player, data, hooks), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }
    case 'enchantEquipment': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const res = enchantEquipment(nation, player, cmd, data, rng);
      if (!res.ok) return res;
      return ok({ ...res, equipment: equipmentView(nation, player, data, hooks), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }

    // ── ★ GDD3 §13-D-5 — 기술 트리와 철로 ───────────────────────
    case 'startResearch': {
      const res = startResearch(world, nation, cmd, data);
      if (!res.ok) return res;
      return ok({ ...res, research: researchView(nation, data), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }
    /* ★ §19-F3(F07-5) — 붙들고 있는 궁리에 금화를 부어 하루를 앞당긴다.
       무역으로 번 금화가 흘러갈 첫 자리다: 늦어질 연구를 웨이브 앞에 맞춰 끝내는 선택이 생긴다. */
    case 'hastenResearch': {
      const res = hastenResearch(world, nation, data);
      if (!res.ok) return res;
      return ok({ ...res, research: researchView(nation, data), gold: round2(nation.gold) });
    }
    case 'placeRail': {
      const res = placeRail(world, nation, cmd, data);
      return res.ok ? ok({ ...res, resources: { ...nation.resources } }) : res;
    }
    case 'removeRail': {
      const res = removeRail(world, nation, cmd, data);
      return res.ok ? ok({ ...res, resources: { ...nation.resources } }) : res;
    }

    /* ── ★ §19-F4(F09-2) 기차 — 정거장에 선 기차 곁에서 [E]. 탄 동안 자리는 서버가 쥔다 ── */
    case 'boardTrain': {
      const res = boardTrain(world, nation, cmd, data);
      return res.ok ? ok({ ...res, trains: trainViews(nation) }) : res;
    }
    case 'leaveTrain': {
      const res = leaveTrain(world, nation, cmd, data);
      return res.ok ? ok({ ...res, trains: trainViews(nation) }) : res;
    }
    case 'trainSummary': {
      return ok({ trainSummary: trainSummary(nation, data), trains: trainViews(nation) });
    }

    // ── ★ §17-13 — 다리·매립: 물을 건너고(가교), 물을 덮는다(매립) ──
    case 'placeBridge': {
      const res = placeBridge(world, nation, cmd, data);
      return res.ok ? ok({ ...res, resources: { ...nation.resources } }) : res;
    }
    case 'removeBridge': {
      const res = removeBridge(world, nation, cmd, data);
      return res.ok ? ok({ ...res, resources: { ...nation.resources } }) : res;
    }
    case 'placeFill': {
      const res = placeFill(world, nation, cmd, data);
      return res.ok ? ok({ ...res, resources: { ...nation.resources } }) : res;
    }
    case 'removeFill': {
      const res = removeFill(world, nation, cmd, data);
      return res.ok ? ok({ ...res, resources: { ...nation.resources } }) : res;
    }

    /* ── ★ §17-12 — 걷어내기(clearNode). 영토 안의 자원 자리를 치워 건물 놓을 땅을 낸다 ──
       피드백: "영토 내의 나무나 땅(재배할 수 있는 곳)을 제거할 수 있어야 함 — 나무를 다량 확보".
       무엇을 걷을 수 있고 얼마를 돌려받는지는 전부 data/world.json nodes.clear 가 정한다.
       환급은 storage.deposit 하나로만 들어간다(창고 상한 준수 — §13-A-5). */
    case 'clearNode': {
      const ccfg = data.world.nodes.clear || {};
      const node = nodeById(world, cmd.nodeId ?? cmd.payload?.nodeId);
      if (!node) return err('NO_NODE', '그런 자리가 없습니다.');
      const table = ccfg.refundResource || {};
      if (!(node.type in table)) return err('NOT_CLEARABLE', '걷어 낼 수 없는 자리입니다.');
      if (ccfg.onlyTerritory !== false && !inTerritory(world, nation, node.x, node.y, data)) {
        return err('OUT_OF_TERRITORY', '아직 우리 땅이 아닙니다.');
      }
      // 잔량이 0(그루터기)이어도 걷을 수 있다 — minRefund 가 있으면 그만큼은 나온다
      const res = table[node.type] ?? null;
      let amount = 0;
      if (res) {
        const want = Math.max(ccfg.minRefund?.[node.type] ?? 0, (node.amount || 0) * (ccfg.refundRatio ?? 0.5));
        amount = deposit(nation, res, want, data);
      }
      removeNode(world, node.id);
      /* 그 자리를 겨누던 주민은 그 자리에서 손을 뗀다 — 유령 타깃을 다음 틱에 넘기지 않는다 */
      const clearTown = townOf(world, nation.id);
      let unassigned = 0;
      for (const u of nation.villagers || []) {
        if (u.targetId !== node.id) continue;
        u.job = 'idle';
        u.targetId = 'hall';
        u.destX = clearTown?.x ?? u.x;
        u.destY = clearTown?.y ?? u.y;
        unassigned += 1;
      }
      return ok({
        nodeId: node.id, type: node.type,
        refund: { res, amount },
        unassigned,
        resources: { ...nation.resources },
      });
    }

    case 'placeFence': {
      const res = placeFence(world, nation, cmd, data);
      return res.ok ? ok(res) : res;
    }
    case 'upgradeFence': {
      const res = upgradeFence(world, nation, cmd, data, hooks);
      return res.ok ? ok(res) : res;
    }
    case 'repairFence': {
      const res = repairFence(world, nation, cmd, data);
      return res.ok ? ok(res) : res;
    }
    case 'removeFence': {
      const res = removeFence(world, nation, cmd, data);
      return res.ok ? ok(res) : res;
    }

    case 'reclaimField': {
      const res = doReclaim(world, nation, Math.round(Number(cmd.x)), Math.round(Number(cmd.y)), data);
      return res.ok ? ok(res) : res;
    }

    // ── ★ 감정의 날 (GDD3 §11-4) — 시간이 아니라 이 명령 하나로만 열린다 ──────
    //   3일차 자동 발동은 폐기됐다. 감정소(측량소)를 다 세우고, 그 건물을 눌러
    //   [땅을 감정한다]를 고르는 것 — 그것이 유일한 방아쇠다.
    case 'appraiseLand': {
      if (!nation.isPlayer) return err('NO_NATION', '이 나라는 땅을 감정하지 않습니다.');
      if (world.emotionDayDone) return err('ALREADY_DONE', '이 땅은 이미 감정했습니다.');
      const post = (nation.structures || []).find((s) => s.key === 'appraisal_post');
      if (!post) return err('NO_STRUCTURE', '감정소를 먼저 세워야 합니다.');
      if (cmd.structureId && cmd.structureId !== post.id) return err('NO_STRUCTURE', '감정소가 아닙니다.');
      setFlag(nation, 'appraised');
      const evs = runEmotionDay(world, data, rng);
      return ok({
        appraised: true, structureId: post.id,
        tags: nation.tags, tagNames: nation.tags.map((t) => data.tags[t]?.name ?? t),
        events: evs,
      });
    }

    /* ── ★ §19-F3(F07-8) 재감정 — 감정소는 한 번 쓰고 마는 건물이 아니다 ─────
       감정의 날로부터 며칠에 한 번 「기운이 다시 고인다」: 금화(또는 옛 지도 조각)를 들여
       태그 하나를 다시 뽑고, 그 사이 넓어진 영토의 지하를 마저 연다. */
    case 'reappraiseLand': {
      if (!nation.isPlayer) return err('NO_NATION', '이 나라는 땅을 감정하지 않습니다.');
      if (!world.emotionDayDone) return err('NOT_APPRAISED', '아직 이 땅을 처음 감정하지도 않았습니다.');
      const res = runReappraisal(world, nation, data);
      if (!res.ok) return res.error ? { ok: false, error: res.error } : res;
      return ok({ ...res, gold: round2(nation.gold) });
    }

    // ── ★ §17-9 건물 손일 — 건물 곁에서 직접 거드는 상호작용(피드백: "제련소에서 직접 제련") ──
    //   무엇을 주고 무엇을 받는지는 전부 data/buildings.json 의 handWork 가 정한다(매직넘버 금지).
    case 'handWork': {
      const s = findStructure(nation, cmd.structureId);
      if (!s) return err('NO_STRUCTURE', '그런 건물이 없습니다.');
      if (isRuined(s)) return err('RUINED', '무너진 건물입니다 — 수리부터 하십시오.');
      if (s.inactive) return err('INACTIVE', '이 건물은 지금 옮기는 중입니다.');
      const hw = data.buildings[s.key]?.handWork;
      if (!hw) return err('NO_HANDWORK', '여기서 거들 손일이 없습니다.');
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      const av = nation.avatars?.[who];
      if (!av) return err('NO_AVATAR', '아바타가 없습니다.');
      const fp = footprint(s.key, data);
      const cx = s.x + (fp.w - 1) / 2;
      const cy = s.y + (fp.h - 1) / 2;
      const reach = (data.balance.handWork?.reachTiles ?? 3) + Math.max(fp.w, fp.h) / 2;
      if (dist(av.x, av.y, cx, cy) > reach) return err('OUT_OF_RANGE', '더 가까이 가야 합니다.');
      const now = Number(cmd._now) || Date.now();
      if (hw.cooldownDays) {
        const lastTick = s.handTickBy?.[who];
        if (lastTick != null && world.tick - lastTick < hw.cooldownDays) {
          return err('COOLDOWN', '오늘은 이미 올렸습니다 — 내일 다시.');
        }
      } else {
        const last = s.hand?.[who] ?? 0;
        const cd = (hw.cooldownSeconds ?? 3) * 1000;
        if (now - last < cd) return err('COOLDOWN', '숨을 고르는 중입니다.', { waitMs: cd - (now - last) });
      }
      for (const [k, v] of Object.entries(hw.cost || {})) {
        if ((nation.resources[k] ?? 0) < v) {
          const name = data.resources.meta[k]?.name ?? k;
          return err('NO_RESOURCES', `${name}이(가) 모자랍니다.`);
        }
      }
      for (const [k, v] of Object.entries(hw.cost || {})) nation.resources[k] = round2(nation.resources[k] - v);
      const gained = {};
      for (const [k, v] of Object.entries(hw.yield || {})) gained[k] = deposit(nation, k, v, data);
      if (hw.gold) nation.gold = round2(nation.gold + hw.gold);
      if (hw.buildPoints) nation.buildPoints = round2((nation.buildPoints || 0) + hw.buildPoints);
      let healed = 0;
      if (hw.heal) {
        const p = ensurePlayer(nation, who, data, cmd.playerName ?? null);
        const maxHp = playerMaxHp(p, data);
        const before = p.hp ?? maxHp;
        p.hp = round2(Math.min(maxHp, before + hw.heal));
        healed = round2(p.hp - before);
      }
      if (hw.morale) {
        const m = data.balance.morale;
        nation.morale = Math.min(m.max, round2(((nation.morale ?? m.default) + hw.morale) * 100) / 100);
      }
      let xp = null;
      if (hw.xp?.skill) {
        const p = ensurePlayer(nation, who, data, cmd.playerName ?? null);
        xp = grantXp(p, hw.xp.skill, hw.xp.amount ?? 1, data);
      }
      if (hw.cooldownDays) (s.handTickBy ||= {})[who] = world.tick;
      else (s.hand ||= {})[who] = now;
      return ok({
        structureId: s.id, key: s.key, label: hw.label, gained,
        healed, gold: hw.gold ?? 0, buildPoints: hw.buildPoints ?? 0,
        morale: hw.morale ? nation.morale : null, xp,
        x: cx, y: cy,
        resources: { ...nation.resources },
      });
    }

    // ── ★ §17-7 다같이 잠자기 — 사람 아바타가 모두 잠들면 하루가 곧장 넘어간다 ──────
    //   (피드백: "초반에 일차를 넘기려면 10분을 기다려야 함 — 다같이 잠자기로 넘기자")
    //   실제 하루 진행은 런타임(index.js apply)이 advanceDay 표시를 보고 한다.
    case 'sleepVote': {
      if (!nation.isPlayer) return err('NO_NATION', '이 나라는 잠들지 않습니다.');
      if (nation.battle && !nation.battle.over) return err('BATTLE_LIVE', '싸움 중에는 잠들 수 없습니다.');
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      if (!nation.avatars?.[who]) return err('NO_AVATAR', '아바타가 없습니다.');
      const botPrefix = data.companions?.idPrefix ?? 'bot~';
      const isBot = (id) => id.startsWith(botPrefix) || Boolean(nation.players?.[id]?.bot);
      const votes = (nation.sleepVotes ||= {});
      if (cmd.on === false) delete votes[who]; else votes[who] = true;
      const humans = Object.keys(nation.avatars || {}).filter((id) => !isBot(id));
      for (const id of Object.keys(votes)) if (!humans.includes(id) || isBot(id)) delete votes[id];
      const slept = humans.filter((id) => votes[id]).length;
      const need = humans.length;
      const advance = need > 0 && slept >= need;
      if (advance) nation.sleepVotes = {};
      return ok({ slept, need, advanceDay: advance });
    }

    // ── ★ §17-16 이웃 나라 찾아가기 — 세 나라가 지도 위에 실제로 서 있게 한다 ──────
    //   교역 상대가 이름만 있는 목록이 아니라 걸어가 볼 수 있는 자리가 된다.
    case 'visitNation': return visitNation(world, nation, cmd, data);

    // ── ★ §18-D2 흔적 조사 — 앞마당의 발자국·돌무더기·우물에 손을 댄다 ──────────
    //   퀘스트를 주는 사람은 없다. 흔적이 다음 흔적을 부르고, 조사가 여는 것은 **안개**뿐이다.
    //   선택지가 있는 흔적은 같은 명령을 두 번 받는다(1차 = 선택지 펴기 · 2차 = choice 확정).
    case 'investigateTrail': return investigateTrail(world, nation, cmd, data);

    // ── 군주 아바타 (연출·안개용) ────────────────────────────────
    case 'lordMove': {
      const size = data.world.size;
      const x = Math.round(Number(cmd.x));
      const y = Math.round(Number(cmd.y));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size || y >= size) {
        return err('BAD_POSITION', '지도 밖입니다.');
      }
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      /* ★ Sprint 1 — 쓰러져 있는 동안에는 자리 보고를 받지 않는다.
         부활은 서버가 아바타를 모닥불로 옮기는데(ecology §14-6), 위치는 클라 권위라
         클라가 0.9초 안에 죽은 자리 좌표를 다시 보고해 그 이동을 덮어썼다 —
         「카메라만 정착지로 가고 몸은 죽은 자리에서 일어난다」의 서버 쪽 절반이다.
         (남은 절반은 down.js 가 부활 좌표로 몸을 옮기는 것 — 멀티에서도 치팅 이동을 막는 빗장) */
      const plDown = nation.players?.[who];
      if (plDown && (plDown.downUntil || 0) > 0) {
        return err('DOWNED', '쓰러져 있는 동안에는 걸을 수 없습니다.');
      }
      /* ★ §19-F4(F09-2) — 기차에 탄 동안에는 자리 보고를 받지 않는다. 쓰러짐(위)과 같은 빗장이다:
         몸을 옮기는 쪽이 서버라, 클라가 옛 좌표를 다시 보고하면 기차에서 몸만 떨어져 나간다. */
      if (riding(nation, who)) return err('RIDING', '기차에 타고 있는 동안에는 걸을 수 없습니다.');
      if (structureBlocks(nation, data, x, y)) {
        return err('STRUCTURE_BLOCKED', '건물이 있는 자리에는 들어갈 수 없습니다.');
      }
      const avatars = (nation.avatars ||= {});
      const prev = avatars[who] ?? null;
      const look = normalizeAppearance(cmd.appearance, data, prev?.appearance ?? memberAppearance(nation, who, data));
      avatars[who] = {
        id: who, name: cmd.playerName ?? prev?.name ?? '개척자',
        x, y, tick: world.tick, appearance: look.appearance,
      };
      /* 첫 자리 보고는 오프닝 마차에서 내렸다는 서버 쪽 신호다. */
      if (nation.companions && !nation.companions.awake) nation.companions.awake = true;
      // ★ 안개 즉시 스탬프 — 걸어 들어간 자리는 그 자리에서 밝아진다.
      //   (예전에는 recomputeFog 가 일 틱에만 돌아, 새 지역의 노드가 최대 10분 뒤에야 내려갔다)
      //   같은 칸을 다시 보고하면 아무 일도 하지 않는다 = 이동 스로틀.
      const moved = !prev || prev.x !== x || prev.y !== y;
      const revealed = moved ? revealAvatar(nation, data, world.tick, x, y, who) : [];
      // ★ 7장 정찰 — 「안개 속 낯선 발자국」은 그 자리까지 걸어가야 열린다(시간이 아니라 발걸음).
      if (moved && nation.isPlayer) checkTrace(world, nation, data);
      /* ★ GDD3 §13-B-4·5 — 걸어 들어간 자리가 여는 것 둘.
         ① 은닉 유적은 가까이 가야 지도에 나타난다 ② 위험 띠(링)를 넘으면 그 사실을 ack 에 실어 준다.
         링은 서버가 정본으로 판정한다 — 화면이 제 셈으로 경고를 띄우면 영토가 자란 뒤 어긋난다. */
      const found = moved && nation.isPlayer ? revealConcealed(world, nation, data, world.tick) : [];
      for (const n of found) recordRuinFound(nation, n, world.tick);
      /* ★ §17-17 — 새 땅의 첫 발견. 안개가 아니라 **발**이 기준이다: 멀리서 흰 산줄기를 보는 것과
         그 위에 서는 것은 다르다. 한 지형에 한 번뿐이고, 몫(사기)과 문구는 자료가 쥔다. */
      const biomes = moved ? discoverBiomes(world, nation, data, world.tick) : [];
      /* ★ §19-F2(F07-4) — 굴 앞에 섰다. 「무엇이 다가온다」가 아니라 「여기 무엇이 산다」는 경고라
         한 번만 울린다(본 사실을 나라 장부에 적어 둔다). 자리는 서버가 쥔다 — 화면이 제 셈으로
         용의 자리를 알아내면 안 된다(정보 비대칭: 걸어가 봐야 안다). */
      const dragonWarn = moved && nation.isPlayer ? dragonWarning(world, nation, data, x, y) : null;
      const ring = nation.isPlayer ? ringAt(world, nation, x, y, data) : 0;
      const lastRing = prev?.ring ?? 0;
      if (avatars[who]) avatars[who].ring = ring;
      const warnAt = data.world.rings?.warnRing ?? 2;
      return ok({
        avatar: avatars[who], moved, revealed,
        ring,
        ringEntered: ring >= warnAt && lastRing < warnAt,
        ringText: ring >= warnAt ? (data.world.rings?.warnText ?? null) : null,
        revealedNodes: found.map((n) => n.id),
        // ★ §17-17 — 이제 은닉 자리가 유적만이 아니다(숨은 궤). 화면이 「무엇을 찾았는가」를 가려 말한다.
        revealedKinds: found.map((n) => n.type),
        biomes,
        dragonWarn,
        events: biomes.map((b) => ({ kind: 'biome_found', nationId: nation.id, data: b })),
      });
    }

    case 'setAppearance':
      /* 플레이 중 외형·이름 변경은 제공하지 않는다. 역할을 맡으면 그 역할의 고정 스프라이트와
         초상을 사용하며, 클라이언트가 남아 있더라도 서버에서 변경을 받아들이지 않는다. */
      return err('APPEARANCE_LOCKED', '플레이 중 이름과 모습은 바꿀 수 없습니다.');

    case 'chat': {
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      const res = pushChat(world, nation, {
        text: cmd.text ?? cmd.payload?.text,
        name: cmd.playerName ?? nation.avatars?.[who]?.name ?? '개척자',
        avatarId: who,
        appearance: nation.avatars?.[who]?.appearance ?? memberAppearance(nation, who, data),
      }, data);
      return res.ok ? ok({ message: res.message }) : res;
    }

    // ── 대장간 도구 (티어 3+) ────────────────────────────────────
    case 'buyTool': {
      if (nation.isPlayer && settlementTier(nation) < (data.buildings.tools.requiresTier ?? 3)) {
        return err('TIER_LOCKED', '대장간이 서야 도구를 살 수 있습니다.');
      }
      const tool = cmd.tool ?? cmd.payload?.tool ?? 'weapon';
      const def = data.buildings.tools[tool];
      if (!def) return err('BAD_TOOL', '알 수 없는 도구입니다.');
      const current = nation.buildings.tools[tool] ?? 0;
      const tier = Number(cmd.tier ?? current + 1);
      if (tier !== current + 1) return err('BAD_TIER', `다음 티어는 ${current + 1} 입니다.`);
      const t = def.tiers[tier - 1];
      if (!t) return err('MAX_TIER', '최대 티어입니다.');
      const price = Math.round(t.gold * (1 - toolDiscount(nation, data)));
      if (nation.gold < price) return err('NO_GOLD', '골드가 부족합니다.');
      const oilNeed = Math.max(0, (t.oil ?? 0) + (tool === 'weapon' ? hooks.weaponOilDelta : 0));
      if (oilNeed > 0 && (nation.resources.oil || 0) < oilNeed) return err('NO_OIL', '원유가 부족합니다.');
      nation.gold -= price;
      nation.stats.goldSpent += price;
      if (oilNeed > 0) nation.resources.oil -= oilNeed;
      nation.buildings.tools[tool] = tier;
      return ok({ tool, tier, gold: price, listGold: t.gold, oil: oilNeed });
    }
    case 'sellWeapon': {
      const current = nation.buildings.tools.weapon ?? 0;
      if (current <= 0) return err('NO_WEAPON', '판매할 무기 티어가 없습니다.');
      const refundRatio = data.buildings.tools.weapon.refundRatio;
      let refund = 0;
      for (let t = 1; t <= current; t += 1) refund += data.buildings.tools.weapon.tiers[t - 1].gold * refundRatio;
      nation.buildings.tools.weapon = 0;
      nation.gold += refund;
      nation.stats.goldEarned += refund;
      return ok({ refund: round2(refund), soldTiers: current });
    }

    // ── 무역 (교역소가 서야 열린다) ──────────────────────────────
    case 'trade': {
      if (nation.isPlayer && data.balance.trade.requiresTradingPost && !featureUnlocked(nation, 'trade', data)) {
        return err('TRADE_LOCKED', '아직 바깥과 값을 주고받을 수 없습니다. 교역소를 세우십시오.');
      }
      const { nationId: partnerId, side, resource, amount } = cmd;
      const partner = world.nations[partnerId];
      if (!partner || partner.isPlayer) return err('BAD_PARTNER', '거래 상대를 찾을 수 없습니다.');
      const amt = Number(amount);
      if (!(amt > 0)) return err('BAD_AMOUNT', '수량이 올바르지 않습니다.');
      /* ★ §19-F3(F07-7) — 나라마다 싸게 내주는 것과 비싸게 쳐주는 것이 다르다.
         살 때는 exports 배수가, 팔 때는 demands 배수가 붙는다(data/ai_nations.json tradeProfile). */
      const foreign = foreignUnitPrice(partner, resource, side === 'sell' ? 'sell' : 'buy', data);
      const lastPlace = isLastPlace(world, nation);
      const tariffZero = (nation.artifactState?.tariffZeroCharges || 0) > 0;
      const opts = {
        lastPlace: lastPlace || tariffZero,
        artifactDelta: hooks.tariffDelta,
        exemptNationId: hooks.exemptNationId,
        // ★ §20-R1 — 여행자의 인장(전면 면제)·상인의 저울(환스프레드 −20%)이 여기로 들어간다
        exemptAll: hooks.tariffExemptAll,
        fxSpreadMultiplier: hooks.fxSpreadMultiplier,
        nationId: partnerId,
        eventDelta: freightEventDelta(nation),
      };
      if (side === 'buy') {
        // ★ §세계관 W4 — 특수 제안(특가·도움 요청)의 단가 보정. respondOffer 만 채울 수 있다(클라 페이로드는 _키가 벗겨진다).
        const unit = importPrice(foreign, nation, data, opts) * (1 + (cmd._offerAdj || 0));
        const cost = unit * amt;
        if (nation.gold < cost) return err('NO_GOLD', '골드가 부족합니다.');
        if ((partner.resources[resource] || 0) < amt) return err('NO_STOCK', '상대국 재고가 부족합니다.');
        nation.gold -= cost;
        nation.stats.goldSpent += cost;
        nation.stats.imports += cost;
        nation.resources[resource] = (nation.resources[resource] || 0) + amt;
        partner.resources[resource] -= amt;
        partner.gold += cost;
        if (tariffZero) nation.artifactState.tariffZeroCharges -= 1;
        nation.stats.tradeVolume += cost;
        countTradeGold(nation, partnerId, cost);   // ★ §세계관 W3 — 재회의 근사 게이지
        onTradeDone(world, nation, partnerId, cost, data, cmd._relBonus || 0);   // ★ §세계관 W4
        recordTradeFlow(world, nation.id, partnerId, resource, amt, 'buy');
        /* ★ §21-C3 — 값을 주고받아 봤다는 사실 하나. 8장의 「첫 거래」 칸이 이 깃발만 본다
           (사고파는 방향도 액수도 묻지 않는다 — 배우는 것은 '주고받는다'는 동사 하나다). */
        setFlag(nation, 'traded');
        return ok({ side, resource, amount: amt, unitPrice: round2(unit), gold: round2(-cost) });
      }
      if (side === 'sell') {
        if ((nation.resources[resource] || 0) < amt) return err('NO_STOCK', '재고가 부족합니다.');
        // ★ §세계관 W3 재회 — 엔딩 뒤 에르니아는 매입가를 조금 더 쳐준다(빈 손으로 보내지 않는 사이)
        const premium = (hooks.premiumTrade?.[partnerId] || 0) + reunionSellPremium(world, partnerId, data)
          + (cmd._offerAdj || 0);   // ★ §세계관 W4 — 도움 요청(웃돈 매입)의 단가 보정
        const unit = exportPrice(foreign, data, nation) * (1 + premium);
        const gain = unit * amt * (hooks.goldMultiplier ?? 1);
        if (partner.gold < gain) return err('PARTNER_NO_GOLD', '상대국의 국고가 부족합니다.');
        nation.resources[resource] -= amt;
        partner.resources[resource] = (partner.resources[resource] || 0) + amt;
        nation.gold += gain;
        partner.gold -= gain;
        nation.stats.goldEarned += gain;
        nation.stats.tradeVolume += gain;
        countTradeGold(nation, partnerId, gain);   // ★ §세계관 W3 — 재회의 근사 게이지
        onTradeDone(world, nation, partnerId, gain, data, cmd._relBonus || 0);   // ★ §세계관 W4
        recordTradeFlow(world, nation.id, partnerId, resource, amt, 'sell');
        /* ★ §21-C3 — 값을 주고받아 봤다는 사실 하나. 8장의 「첫 거래」 칸이 이 깃발만 본다
           (사고파는 방향도 액수도 묻지 않는다 — 배우는 것은 '주고받는다'는 동사 하나다). */
        setFlag(nation, 'traded');
        return ok({ side, resource, amount: amt, unitPrice: round2(unit), gold: round2(gain) });
      }
      return err('BAD_SIDE', 'side 는 buy 또는 sell 입니다.');
    }
    /* ── ★ §19-F3(F07-7) 특산품 — 우리가 못 만드는 것 ─────────────
       「왜」 자원을 금화로 살 수 있게 하나 — 시세 차만으로는 금화가 다시 물건이 되지 못한다.
       유막 없는 땅의 석유, 석탄 채굴 이전의 석탄, 엘프의 실타래처럼 **우리 땅에서 나지 않는 것**만
       좌판에 올린다. 재고가 있고 며칠에 걸쳐 다시 차므로 금화로 살림을 통째로 대신할 수는 없다. */
    case 'buySpecialty': return buySpecialty(world, nation, cmd, data);

    case 'respondOffer': {
      const idx = world.offers.findIndex((o) => o.offerId === cmd.offerId);
      if (idx < 0) return err('NO_OFFER', '만료되었거나 없는 제안입니다.');
      const offer = world.offers[idx];
      world.offers.splice(idx, 1);
      if (!cmd.accept) {
        // ★ §세계관 W4 — 거절에도 값이 있다: 게이지가 내리고, 청명은 세 번이면 문을 닫는다
        const refused = onOfferRefused(world, nation, offer.nationId, data);
        return ok({ accepted: false, offerId: offer.offerId, events: refused });
      }
      const res = runCommand(world, nationId, {
        type: 'trade', nationId: offer.nationId, side: offer.side, resource: offer.resource, amount: offer.amount,
        // ★ §세계관 W4 — 특수 제안의 단가 보정·관계 웃돈은 서버 내부에서만 채워진다
        _offerAdj: offer.special?.adj || 0, _relBonus: offer.special?.relBonus || 0,
      }, data, rng);
      if (!res.ok) return res;
      /* ★ §20-R4b — 거들었으면 몫이 있다(유물기획 §20-9 「국가 이벤트 보상」). 「이벤트가 났다」가
         아니라 **손을 보탰다**가 조건이다 — 기관장의 인장의 hint 가 「손을 보태 준 나라의 몫」이라
         적었으므로 성사 자리에서만 준다. 이미 가졌거나 이 방에서 나온 전설이면 grantVia 가 접는다. */
      const relic = offer.special?.artifact
        ? grantVia(world, nation, data, rng, offer.special.artifact, world.tick) : null;
      const relicEvents = relic
        ? [artifactFoundEvent(world, nation, relic.key, 'event', data, { avatarId: cmd.avatarId ?? null })] : [];
      return ok({ accepted: true, offerId: offer.offerId, ...res,
        artifact: relic ? { key: relic.key, name: relic.name, grade: relic.grade } : null,
        events: [...(res.events || []), ...relicEvents] });
    }
    /* ── ★ §세계관 W3 — 초대장을 연다(매듭형 엔딩). 이야기(엔딩·크레딧·쿠키)는 ending_started
       사건을 본 story.js 가 얹는다. 웨이브 당일·중복 열기는 ending.js 가 막는다. */
    case 'acceptEnding': {
      const r = acceptEnding(world, nation, data, cmd.playerName);
      if (!r.ok) return err(r.code, r.message);
      return ok({ events: r.events });
    }
    case 'decide': {
      const idx = nation.decisionQueue.findIndex((d) => d.decisionId === cmd.decisionId);
      if (idx < 0) return err('NO_DECISION', '없는 결정입니다.');
      const [decision] = nation.decisionQueue.splice(idx, 1);
      decision.choice = cmd.choice;
      decision.resolvedTick = world.tick;
      if (decision.kind === 'trade_offer' && cmd.choice === 'accept' && decision.offer) {
        const r = runCommand(world, nationId, {
          type: 'trade', nationId: decision.offer.nationId, side: decision.offer.side,
          resource: decision.offer.resource, amount: decision.offer.amount,
        }, data, rng);
        return ok({ decision, trade: r });
      }
      /* ★ §20-R4b — 고대 신전은 한 자취에서 세 번 연달아 묻는다(수수께끼→시련→안치소).
         유적 카드와 같은 문(decide)으로 들어오되 답을 내는 곳만 다르다. */
      if (decision.kind === data.ruins.temple?.decisionKind && decision.temple) {
        const t = resolveTempleChoice(world, nation, decision, cmd.choice, data);
        if (!t.ok) return err(t.error.code, t.error.message);
        decision.result = t.result;
        return ok({ decision, temple: t.result, events: t.events ?? [] });
      }
      if (decision.kind === data.ruins.decisionKind && decision.ruin) {
        const r = resolveRuinChoice(world, nation, decision, cmd.choice, data, rng);
        if (!r.ok) return r;
        decision.result = r.result;
        // ★ §20-R1.5 — 유적 카드가 유물을 내면 상자와 같은 발견 사실을 함께 띄운다
        const found = r.result.artifact
          ? [artifactFoundEvent(world, nation, r.result.artifact.key, 'ruin', data)] : [];
        /* ★ §22-2 층3 — 단서가 연 안개를 함께 올린다. 좌표는 소켓 계층이 ack 에서 지운다
           (server/index.js, investigateTrail 과 같은 자리·같은 까닭 — 마커 금지). */
        return ok({ decision, ruin: r.result, revealed: r.revealed ?? [],
          events: [{ kind: 'ruin_resolved', nationId: nation.id, data: r.result }, ...found] });
      }
      return ok({ decision });
    }
    case 'ordersSet': {
      if (nation.isPlayer && !featureUnlocked(nation, 'orders', data)) {
        return err('TIER_LOCKED', '국법은 읍(티어 4)부터 세웁니다.');
      }
      try {
        nation.orders = validateOrders(cmd.orders, data);
        return ok({ orders: nation.orders });
      } catch (e) {
        return err('BAD_ORDER', e.message);
      }
    }
    case 'saintBuff': {
      const s = data.balance.saint;
      if (!nation.roles?.saint?.holder && !hooks.flags?.prophecyAlways) return err('NO_SAINT', '성녀가 없습니다.');
      if (s.forbiddenTargets.includes(cmd.resource)) return err('FORBIDDEN', '전투력 계열에는 성역을 펼 수 없습니다.');
      if (!data.resources.order.includes(cmd.resource)) return err('BAD_RESOURCE', '알 수 없는 재화입니다.');
      if (world.tick < (nation.sanctuary?.cooldownUntilTick ?? 0)) return err('COOLDOWN', '아직 성역을 다시 펼 수 없습니다.');
      const bonus = nation.roles?.saint && (nation.roles.saint.level >= data.roles.defs.saint.skillLevel)
        ? data.roles.defs.saint.skill.sanctuaryDurationBonus : 0;
      nation.sanctuary = {
        active: true,
        resource: cmd.resource,
        expiresTick: world.tick + s.sanctuaryDurationTicks + bonus,
        cooldownUntilTick: world.tick + s.sanctuaryCooldownTicks,
      };
      return ok({ sanctuary: nation.sanctuary });
    }
    case 'useArtifact': {
      const r = useArtifact(nation, cmd.key, world.tick, data);
      // ★ §20-R1(PROTOCOL 0-R-2) — 남은 충전을 함께 돌려준다. 옛 화면은 이 칸을 몰라도 그대로 굴러간다.
      return r.ok ? ok({ artifact: r.artifact.name, applied: r.applied, chargesLeft: r.chargesLeft, consumed: r.consumed })
        : err(r.code, r.message);
    }

    // ── 왕의 하루 (AP) — 격려 순행 · 유적 탐사 · 조사 ─────────────
    /* ★ §20-R4e — 신전 문 앞에서 E. 어전 행동이 아니라 **군주의 발**이 여는 문이다
       (explore 는 영토 안만 고를 수 있어 200타일 밖 신전에는 닿지 않는다). */
    case 'enterTemple': {
      const avatarId = cmd.avatarId ?? cmd.payload?.avatarId ?? 'lord';
      const nodeId = cmd.nodeId ?? cmd.payload?.nodeId ?? null;
      const res = enterTemple(world, nation, avatarId, nodeId, data);
      if (!res.ok) return err(res.code, res.message);
      return ok({ card: res.card, events: [{ kind: 'ruin_event', nationId: nation.id, data: { card: res.card } }] });
    }
    case 'apAction': {
      const res = performApAction(world, nation, cmd, data, rng);
      if (!res.ok) return res;
      const { events, ...rest } = res;
      return ok({ ...rest, ...(events?.length ? { events } : {}) });
    }
    case 'harvestNode': {
      const res = harvestNode(world, nation, cmd, data);
      return res.ok ? ok(res) : res;
    }

    // ── 웨이브 작전 — 전술 1택(상성). 서지 3구간 배분은 폐기됐다. ──
    case 'setBattlePlan': {
      const norm = normalizeBattlePlan(cmd, data);
      if (norm.error) return { ok: false, error: norm.error };
      nation.battlePlan = { tactic: norm.plan.tactic, setTick: world.tick };
      return ok({ battlePlan: nation.battlePlan });
    }

    /* ── ★ §19-E(F04-4) 침공 앞당기기 ────────────────────────────
       준비 조건(data/waves.json rush.conditions)을 다 채웠을 때만 열린다. 서버가 다시 재고
       당긴다 — 화면이 보낸 「준비됐다」는 믿지 않는다. 캠프도 그 자리에서 세워 예고가 보이게 한다. */
    case 'rushWave': {
      if (!canRushWave(world, nation, data)) return err('NOT_READY', '아직 적을 부를 준비가 되지 않았습니다.');
      const at = rushWave(world, nation, data);
      const spec = nextWaveSpec(world, nation, data);
      const events = ensureCamps(world, nation, data)
        .map((c) => ({ kind: 'camp_spotted', nationId: nation.id, data: campEventView(c, data) }));
      events.push({ kind: 'wave_rushed', nationId: nation.id,
        data: { index: spec.index, number: spec.index + 1, name: spec.name, daysUntil: daysUntilWave(world, nation) } });
      return ok({ arrivalTick: at, daysUntil: daysUntilWave(world, nation), events });
    }

    /* ── ★ Sprint 5 야영지 선제 타격 ────────────────────────────
       예고와 함께 선 야영지를 걸어가서 부순다. 부순 만큼 그 무리가 줄고, 다 부수면 오지 않는다.
       사거리·쿨타임·피해는 전부 waves.strikeCamp 가 잰다 — 화면이 보낸 「닿았다」는 믿지 않는다. */
    case 'strikeCamp': {
      const res = strikeCamp(world, nation, cmd, data, now);
      return res.ok ? ok(res) : res;
    }

    case 'setAutoAssist': {
      nation.autoAssist = Boolean(cmd.enabled);
      nation.autoAssistIdleTicks = 0;
      return ok({ autoAssist: nation.autoAssist });
    }

    /* ── ★ GDD3 §15-C — 자동 플레이 ────────────────────────────
       켜면 내 아바타를 동료 두뇌가 몬다. 손이 닿으면(수동 입력) 화면이 suspend 를 보내고,
       서버는 그때부터 suspendSeconds 만큼 손을 뗀다 — 끄는 것이 아니라 **잠깐 비켜 주는 것**이다.
       그래서 한 번 켠 사람은 다시 켤 일이 없다. */
    case 'setAutoPlay': {
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      const res = setAutoPlay(nation, who, data, {
        enabled: cmd.enabled ?? cmd.payload?.enabled,
        suspend: Boolean(cmd.suspend ?? cmd.payload?.suspend),
        now,
      });
      return ok({ avatarId: who, ...res });
    }

    /* ── ★ §17-11 — 동료에게 손가락으로 지시한다 ────────────────
       피드백: "일부 NPC(동료 봇)가 가만히 있으며 상호작용과 지시가 되지 않음."
       동료를 눌러 「이곳으로 보낸다」로 자리를 찍으면 두뇌(companions.decide)의 어떤 갈래보다
       먼저 그 자리로 걸어가 지시 대기로 선다. order: null 은 지시를 걷는 것이다. */
    case 'commandCompanion': {
      const comp = companionById(nation, cmd.companionId ?? cmd.payload?.companionId);
      if (!comp) return err('NO_COMPANION', '그런 동료가 없습니다.');
      if (!comp.active || !nation.avatars?.[comp.id]) return err('COMPANION_AWAY', '그 동료는 지금 자리를 비웠습니다.');
      const mem = (comp.mem ||= {});
      const raw = cmd.order ?? cmd.payload?.order ?? null;
      if (raw == null) {
        mem.order = null;
        // 지시를 걷었다 — 다음 걸음에 곧바로 제 일감을 다시 고른다
        mem.target = null;
        mem.think = 0;
        return ok({ companionId: comp.id, order: null });
      }
      if (raw.kind !== 'move') return err('BAD_ORDER', '알 수 없는 지시입니다.');
      const x = Number(raw.x);
      const y = Number(raw.y);
      const size = data.world.size;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size || y >= size) {
        return err('BAD_POSITION', '지도 밖입니다.');
      }
      mem.order = { kind: 'move', x: round2(x), y: round2(y) };
      // 하던 일을 그 자리에서 물린다 — 두뇌가 다음 걸음에 지시부터 다시 판단한다
      mem.target = null;
      mem.think = 0;
      return ok({ companionId: comp.id, order: { ...mem.order } });
    }

    /* ── ★ §17-11 — 동료 꾸미기(이름·모양새) ─────────────────────
       외형은 setAppearance 와 같은 규격(레이어 인덱스)이고, 이름은 명부의 nameMaxLength 를 지킨다.
       세 장부(companions.list · avatars · members)에 같은 값을 적는다 — 명부와 이름표가 갈리지 않게. */
    case 'customizeCompanion': {
      const comp = companionById(nation, cmd.companionId ?? cmd.payload?.companionId);
      if (!comp) return err('NO_COMPANION', '그런 동료가 없습니다.');
      const rawName = cmd.name ?? cmd.payload?.name;
      const rawLook = cmd.appearance ?? cmd.payload?.appearance;
      let name;
      if (rawName != null) {
        if (typeof rawName !== 'string') return err('BAD_NAME', '이름이 올바르지 않습니다.');
        name = rawName.trim();
        const max = data.world.appearance.nameMaxLength;
        if (!name.length || name.length > max) return err('BAD_NAME', `이름은 1~${max}자여야 합니다.`);
      }
      let appearance;
      if (rawLook != null) {
        // 범위를 벗어난 칸만 지금 모습으로 되돌린다(전체 거부 금지 — setAppearance 계열과 같은 규율)
        appearance = normalizeAppearance(rawLook, data, comp.appearance).appearance;
      }
      if (name == null && appearance == null) return err('NOTHING_TO_CHANGE', '바꿀 것이 없습니다.');
      const bill = chargeCustomize(nation, 'companion', data);
      if (!bill.ok) return bill;
      if (name != null) comp.name = name;
      if (appearance != null) comp.appearance = appearance;
      const av = nation.avatars?.[comp.id];
      if (av) {
        if (name != null) av.name = comp.name;
        if (appearance != null) av.appearance = comp.appearance;
      }
      // 솜씨 장부와 맡은 자리(각료 카드)의 이름표도 같은 사람을 가리켜야 한다
      if (name != null && nation.players?.[comp.id]) nation.players[comp.id].name = comp.name;
      if (name != null && comp.role && nation.roles?.[comp.role]?.botId === comp.id) {
        nation.roles[comp.role].name = comp.name;
      }
      upsertMember(nation, { avatarId: comp.id, name, appearance, bot: true }, data);
      return ok({ companionId: comp.id, name: comp.name, appearance: { ...comp.appearance },
                  gold: round2(nation.gold), cost: bill.cost });
    }

    /* ── ★ §19-F3(F07-9) 주민 꾸미기 — 봇만이 아니라 **사는 사람**도 이름과 옷을 고른다 ──
       동료 꾸미기(customizeCompanion)와 같은 규격이다: 이름은 명부의 nameMaxLength 를 지키고,
       외형은 레이어 인덱스만 받아 범위를 벗어난 칸만 지금 모습으로 되돌린다.
       값(소액 금화)은 balance.gold.customize 가 쥔다 — 옷감과 품삯이라는 뜻이고, 금화의 첫 쓸모이기도 하다.
       주민은 nation.villagers 에 살고 그 목록이 그대로 모두에게 흘러가므로(residents.villagerViews)
       멀티에서도 같은 이름·같은 옷이 보인다 — 따로 동기 경로를 파지 않는다. */
    case 'customizeResident': {
      const who = String(cmd.residentId ?? cmd.payload?.residentId ?? '');
      const u = (nation.villagers || []).find((v) => v.id === who);
      if (!u) return err('NO_RESIDENT', '그런 주민이 없습니다.');
      const look = readCustomize(cmd, u, data);
      if (!look.ok) return look;
      const bill = chargeCustomize(nation, 'resident', data);
      if (!bill.ok) return bill;
      if (look.name != null) u.name = look.name;
      if (look.appearance != null) u.appearance = look.appearance;
      return ok({ residentId: u.id, name: u.name, appearance: { ...u.appearance },
                  gold: round2(nation.gold), cost: bill.cost });
    }

    case 'adviceAct': {
      const found = adviceCommand(world, nation, cmd.adviceId, data);
      if (!found) return err('NO_ADVICE', '이미 지난 조언입니다.');
      const res = runCommand(world, nationId, found.cmd, data, rng);
      return res.ok ? ok({ adviceId: cmd.adviceId, executed: found.cmd.type, ...res }) : res;
    }

    // ── 역할은 티어 3(감정의 날) 뒤에만 ──────────────────────────
    case 'delegate': {
      if (roleLocked(world, nation, data)) return err('ROLE_LOCKED', '아직 관제를 선포하지 않았습니다. 마을(티어 3)이 되어야 자리가 생깁니다.');
      const assignments = cmd.assignments || {};
      const explicit = Object.keys(assignments).length > 0;
      for (const key of data.roles.order) {
        let holder;
        if (key === cmd.vacant) holder = null;
        else if (explicit) holder = assignments[key] ?? null;
        else holder = nation.roles[key].holder;
        if (holder != null && holder !== 'npc' && holder !== 'player') {
          return err('BAD_HOLDER', "assignments 값은 'npc' 또는 'player' 여야 합니다.");
        }
        if (nation.roles[key].holder !== holder) reassign(nation, key, holder, world.tick, data);
        nation.roles[key].owner = holder === 'player' ? (cmd.avatarId ?? cmd.playerName ?? null) : null;
      }
      nation.mandateDone = true;
      world.mandateOpen = false;
      /* ★ GDD3 §15-C — 자리가 바뀌었으면 그 자리에 설 사람도 다시 정해진다.
         사람이 가져간 자리의 동료는 손을 떼고, 비어 있는 자리로 옮겨 간다. */
      bindCompanionRoles(nation, data);
      return ok({ roles: nation.roles });
    }
    case 'pickRole': {
      if (roleLocked(world, nation, data)) return err('ROLE_LOCKED', '아직 관제를 선포하지 않았습니다. 마을(티어 3)이 되어야 자리가 생깁니다.');
      if (!data.roles.order.includes(cmd.role)) return err('BAD_ROLE', '알 수 없는 역할입니다.');
      const who = cmd.avatarId ?? cmd.playerName ?? null;
      const takenFrom = nation.roles[cmd.role].holder === 'player' && (nation.roles[cmd.role].owner ?? null) !== who
        ? (nation.roles[cmd.role].owner ?? null) : null;
      for (const key of data.roles.order) {
        const r2 = nation.roles[key];
        if (r2.holder !== 'player') continue;
        const owner = r2.owner ?? null;
        if (who != null && owner != null && owner !== who) continue;
        r2.holder = 'npc';
        r2.owner = null;
      }
      nation.roles[cmd.role].holder = 'player';
      nation.roles[cmd.role].owner = who;
      if (!nation.roles[cmd.role].name) nation.roles[cmd.role].name = data.roles.defs[cmd.role].name;
      nation.mandateDone = true;
      world.mandateOpen = false;
      bindCompanionRoles(nation, data);          // ★ §15-C — 사람이 앉은 자리에서 동료가 비켜난다
      return ok({ role: cmd.role, owner: who, takenFrom });
    }
    case 'councilAck': {
      const c = world.councils.find((x) => x.councilId === cmd.councilId);
      if (c) c.acked = true;
      return ok({ councilId: cmd.councilId });
    }
    case 'setExportFloor': {
      const floors = {};
      for (const [r2, v] of Object.entries(cmd.floors || {})) {
        if (!data.resources.order.includes(r2)) continue;
        floors[r2] = Math.max(0, Number(v) || 0);
      }
      nation.exportFloors = floors;
      return ok({ exportFloors: floors });
    }
    case 'setAutoExport': {
      nation.autoExport = Boolean(cmd.enabled);
      return ok({ autoExport: nation.autoExport });
    }
    /* ★ §20-R4(유물기획 §20-6) — 저주 봉인·해봉. 「값을 치르는 힘」을 되돌릴 수 있게 하는 유일한 문이다.
       화면이 보낸 「저주다」·「보유했다」는 믿지 않는다 — sealArtifact 가 정의표와 보유 목록을 다시 잰다. */
    case 'sealArtifact': {
      const key = String(cmd.key ?? cmd.payload?.key ?? '');
      const want = cmd.sealed == null && cmd.payload?.sealed == null
        ? true : Boolean(cmd.sealed ?? cmd.payload?.sealed);
      const res = sealArtifact(nation, key, data, want);
      if (!res.ok) return err(res.code, res.message, res.need != null ? { need: res.need } : undefined);
      return ok({ ...res, events: [{ kind: 'artifact_sealed', nationId: nation.id, data: { key, name: res.name, sealed: res.sealed } }] });
    }
    /* ★ §20-R4(§20-3 세계수의 씨앗) — 심는다. 자리를 고르는 것 자체가 이 유물의 놀이라
       좌표는 반드시 유한수여야 하고(NaN 이 들어오면 나무가 지도 밖에 선다) 본영 반경 안이어야 한다. */
    case 'plantArtifact': {
      const key = String(cmd.key ?? cmd.payload?.key ?? '');
      const x = Number(cmd.x ?? cmd.payload?.x);
      const y = Number(cmd.y ?? cmd.payload?.y);
      const res = plantArtifact(world, nation, key, x, y, data);
      if (!res.ok) return err(res.code, res.message);
      return ok({ ...res, events: [{ kind: 'artifact_planted', nationId: nation.id, data: { key, name: res.name, ...res.planted } }] });
    }
    /* ★ §20-R4(§20-11) — 폭군의 왕관이 세울 자리를 미리 고른다. 고르기만 하고 효과는 useArtifact 가
       낸다: 고르는 것과 쓰는 것을 갈라 두어야 「골라 놓고 안 쓰는」 것도 되돌릴 수 있다. */
    case 'tyrantPick': {
      const role = String(cmd.role ?? cmd.payload?.role ?? '');
      const res = pickTyrantRole(nation, role, data);
      if (!res.ok) return err(res.code, res.message);
      return ok({ pendingTyrantRole: res.role });
    }
    default:
      return err('UNKNOWN_COMMAND', `알 수 없는 명령: ${cmd.type}`);
  }
}

/** 최근 틱 거래 흐름 — worldState.tradeRoutes 계산에 쓰인다. */
export function recordTradeFlow(world, fromId, toId, resource, amount, side) {
  if (!world) return;
  (world.tradeFlow ||= []).push({ tick: world.tick, from: fromId, to: toId, resource, amount, side });
  if (world.tradeFlow.length > 200) world.tradeFlow.splice(0, world.tradeFlow.length - 200);
}

export function freightEventDelta(nation) {
  let d = 0;
  for (const b of nation.buffs || []) if (b.freightDelta) d += b.freightDelta;
  return d;
}

export { adjacencyDetail, departmentsActive };
