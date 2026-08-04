// 클라이언트 명령 적용 — 서버 권위. 모든 검증은 여기서 한다 (클라 신뢰 금지).
// ★ v3(GDD3): 스윙(actionSwing/combatSwing) · 개별 건물 업그레이드(upgradeStructure) · 수리(repairStructure)
//   · 울타리 조각(placeFence/upgradeFence) 이 새로 들어왔고, 개척령(expand) · 자동 성곽(setWallFocus)
//   · 터렛 전용 명령(placeTurret) · 몸소 일하기(apAction work) · 현장 가속(workSite) 은 폐기됐다.
import { collectHooks, useArtifact } from './artifacts.js';
import { localPrice, importPrice, exportPrice, round2, clamp } from './economy.js';
import { validateOrders } from './orders.js';
import { reassign } from './npc.js';
import { isLastPlace } from './ai_nation.js';
import { performApAction, harvestNode, resolveRuinChoice } from './king.js';
import { townOf, ringAt, revealConcealed } from './world.js';
import { recordRuinFound } from './codex.js';
import {
  validateAppearance, normalizeAppearance, pushChat, memberAppearance, upsertMember, normalizeMembers,
} from './social.js';
import { normalizeBattlePlan } from './tactics.js';
import { adviceCommand } from './advisor.js';
import {
  assignByAlloc, assignByMix, commandVillagers as placeVillagers, deriveLabor, mixFromAlloc,
} from './villagers.js';
import {
  startBuild, startUpgrade, repairStructure, reclaimField as doReclaim, structureDef,
  toolDiscount, adjacencyDetail, syncLegacyBuildings,
  startDemolish, startRelocate, cancelStructureWork, structureView, structuresOf, maxTier,
} from './structures.js';
import { placeFence, upgradeFence, repairFence, removeFence } from './fences.js';
import { actionSwing } from './actions.js';
import { ensurePlayer } from './skills.js';
import { revealAvatar } from './fog.js';
import { combatSwing } from './battle.js';
// ★ GDD3 §13-C-8 — 웨이브 밖의 검. 들에 사는 것들을 벤다.
import { huntSwing } from './ecology.js';
import { settlementTier, promoteSettlement, nextTierStatus, tierDef } from './tiers.js';
import { recruitResident, recruitStatus } from './residents.js';
import { craftEquipment, enhanceEquipment, enchantEquipment, equipmentView } from './equipment.js';
import { startResearch, researchView, placeRail, removeRail } from './research.js';
import {
  featureUnlocked, buildingUnlocked, departmentsActive, commandUnlocked, setFlag, checkTrace,
  evaluateProgress, currentChapter,
} from './progression.js';
import { runEmotionDay } from './emotion_day.js';
import { record as chronicle } from './chronicle.js';

const err = (code, message) => ({ ok: false, error: { code, message } });
const ok = (data = {}) => ({ ok: true, ...data });

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
    return err('CHAPTER_LOCKED', '아직 그럴 때가 아닙니다.');
  }
  const res = runCommand(world, nationId, cmd, data, rng);
  if (!res.ok || !nation.isPlayer) return res;
  // 장 사슬은 명령 직후에 다시 잰다 — 일 틱(최대 10분)을 기다리면 "다음에 뭘 하지"가 멈춘다.
  const progressed = evaluateProgress(world, nation, data);
  if (progressed.length) res.events = [...(res.events || []), ...progressed];
  return res;
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

    case 'setLabor': {
      const target = cmd.recommended ? recommendedLabor(nation, data) : cmd.alloc;
      const res = applyLabor(world, nation, target, data);
      return ok(res);
    }

    case 'setVillagerMix': {
      if (!(nation.villagers || []).length) return err('NO_VILLAGERS', '움직일 주민이 없습니다.');
      const mix = cmd.mix ?? mixFromAlloc(cmd.alloc ?? nation.laborAlloc, data, {
        gather: cmd.gather, scout: cmd.scout,
      });
      const derived = assignByMix(world, nation, mix, data);
      nation.laborAlloc = normalizeAlloc(derived.alloc, data);
      nation.gatherScale = derived.gatherScale;
      return ok({ mix: derived.mix, counts: derived.counts, alloc: nation.laborAlloc, gatherScale: derived.gatherScale });
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

    // ── ★ GDD3 §13-D-3·4 — 대장간에서 벼리고, 더 벼리고, 깃들인다 ──
    case 'craftEquipment': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const res = craftEquipment(nation, player, { ...cmd, tick: world.tick }, data);
      if (!res.ok) return res;
      return ok({ ...res, equipment: equipmentView(nation, player, data), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }
    case 'enhanceEquipment': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const res = enhanceEquipment(nation, player, cmd, data);
      if (!res.ok) return res;
      return ok({ ...res, equipment: equipmentView(nation, player, data), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }
    case 'enchantEquipment': {
      const player = ensurePlayer(nation, cmd.avatarId ?? cmd.playerName ?? 'lord', data, cmd.playerName ?? null);
      const res = enchantEquipment(nation, player, cmd, data, rng);
      if (!res.ok) return res;
      return ok({ ...res, equipment: equipmentView(nation, player, data), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }

    case 'startResearch': {
      const res = startResearch(world, nation, cmd, data);
      if (!res.ok) return res;
      return ok({ ...res, research: researchView(nation, data), resources: { ...nation.resources }, gold: round2(nation.gold) });
    }
    case 'placeFence': {
      const res = placeFence(world, nation, cmd, data);
      return res.ok ? ok(res) : res;
    }
    case 'upgradeFence': {
      const res = upgradeFence(world, nation, cmd, data);
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

    // ── 군주 아바타 (연출·안개용) ────────────────────────────────
    case 'lordMove': {
      const size = data.world.size;
      const x = Math.round(Number(cmd.x));
      const y = Math.round(Number(cmd.y));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size || y >= size) {
        return err('BAD_POSITION', '지도 밖입니다.');
      }
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      const avatars = (nation.avatars ||= {});
      const prev = avatars[who] ?? null;
      const look = normalizeAppearance(cmd.appearance, data, prev?.appearance ?? memberAppearance(nation, who, data));
      avatars[who] = {
        id: who, name: cmd.playerName ?? prev?.name ?? '개척자',
        x, y, tick: world.tick, appearance: look.appearance,
      };
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
      });
    }

    case 'setAppearance': {
      const input = cmd.appearance ?? cmd.payload?.appearance ?? null;
      const v = validateAppearance(input, data);
      if (!v.ok) return v;
      const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
      const name = cmd.playerName ?? null;
      const base = memberAppearance(nation, who, data);
      const { appearance } = normalizeAppearance(input, data, base);
      const avatars = (nation.avatars ||= {});
      const prev = avatars[who] ?? null;
      const town = townOf(world, nation.id);
      avatars[who] = {
        id: who, name: name ?? prev?.name ?? '개척자',
        x: prev?.x ?? town?.x ?? 0, y: prev?.y ?? town?.y ?? 0,
        tick: world.tick, appearance,
      };
      upsertMember(nation, { avatarId: who, name: name ?? undefined, appearance }, data);
      return ok({ avatarId: who, appearance, avatar: avatars[who], members: normalizeMembers(nation, data) });
    }

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
      const foreign = localPrice(partner, resource, data) * (1 + (partner.priceBias || 0));
      const lastPlace = isLastPlace(world, nation);
      const tariffZero = (nation.artifactState?.tariffZeroCharges || 0) > 0;
      const opts = {
        lastPlace: lastPlace || tariffZero,
        artifactDelta: hooks.tariffDelta,
        exemptNationId: hooks.exemptNationId,
        nationId: partnerId,
        eventDelta: freightEventDelta(nation),
      };
      if (side === 'buy') {
        const unit = importPrice(foreign, nation, data, opts);
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
        recordTradeFlow(world, nation.id, partnerId, resource, amt, 'buy');
        return ok({ side, resource, amount: amt, unitPrice: round2(unit), gold: round2(-cost) });
      }
      if (side === 'sell') {
        if ((nation.resources[resource] || 0) < amt) return err('NO_STOCK', '재고가 부족합니다.');
        const unit = exportPrice(foreign, data) * (1 + (hooks.premiumTrade?.[partnerId] || 0));
        const gain = unit * amt * (hooks.goldMultiplier ?? 1);
        if (partner.gold < gain) return err('PARTNER_NO_GOLD', '상대국의 국고가 부족합니다.');
        nation.resources[resource] -= amt;
        partner.resources[resource] = (partner.resources[resource] || 0) + amt;
        nation.gold += gain;
        partner.gold -= gain;
        nation.stats.goldEarned += gain;
        nation.stats.tradeVolume += gain;
        recordTradeFlow(world, nation.id, partnerId, resource, amt, 'sell');
        return ok({ side, resource, amount: amt, unitPrice: round2(unit), gold: round2(gain) });
      }
      return err('BAD_SIDE', 'side 는 buy 또는 sell 입니다.');
    }
    case 'respondOffer': {
      const idx = world.offers.findIndex((o) => o.offerId === cmd.offerId);
      if (idx < 0) return err('NO_OFFER', '만료되었거나 없는 제안입니다.');
      const offer = world.offers[idx];
      world.offers.splice(idx, 1);
      if (!cmd.accept) return ok({ accepted: false, offerId: offer.offerId });
      const res = runCommand(world, nationId, {
        type: 'trade', nationId: offer.nationId, side: offer.side, resource: offer.resource, amount: offer.amount,
      }, data, rng);
      return res.ok ? ok({ accepted: true, offerId: offer.offerId, ...res }) : res;
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
      if (decision.kind === data.ruins.decisionKind && decision.ruin) {
        const r = resolveRuinChoice(world, nation, decision, cmd.choice, data, rng);
        if (!r.ok) return r;
        decision.result = r.result;
        return ok({ decision, ruin: r.result, events: [{ kind: 'ruin_resolved', nationId: nation.id, data: r.result }] });
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
      return r.ok ? ok({ artifact: r.artifact.name, applied: r.applied }) : err(r.code, r.message);
    }

    // ── 왕의 하루 (AP) — 격려 순행 · 유적 탐사 · 조사 ─────────────
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

    case 'setAutoAssist': {
      nation.autoAssist = Boolean(cmd.enabled);
      nation.autoAssistIdleTicks = 0;
      return ok({ autoAssist: nation.autoAssist });
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
