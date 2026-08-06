// 실시간 액션 — docs/GDD3.md §3. 스윙(actionSwing)이 이 게임의 손맛이다.
// ★ 아키텍처: 이 명령들은 '일 틱'을 기다리지 않는다. 소켓에서 즉시 처리되고 곧바로 결과가 돌아간다.
//   서버가 정본으로 쥐는 것 — 스윙 쿨타임(플레이어 단위) · 사거리 · 노드별 스윙 카운트 · 노드 잔량.
import { nodeById, townOf, territoryRadius, dist, markDepleted, removeNode } from './world.js';
// ★ §17-17 — 숨은 궤에서도 유물이 나온다. 등급표를 두 벌 두지 않으려고 유적 쪽 문을 그대로 쓴다.
import { grantRandomArtifact } from './king.js';
// ★ §17-17 — 궤 보상은 노드 id 로 지은 개인 난수다(월드 난수를 축내면 같은 씨앗이 다른 게임이 된다).
import { statRng } from './traits.js';
// ★ GDD3 §13-C-3 — 도감. 유적을 뒤진 기록도 서버가 권위로 쥔다.
import { recordRuin } from './codex.js';
import {
  ensurePlayer, canSwing, markSwing, grantXp, yieldMultiplier, toolFor,
  swingCooldownMs, skillsCfg, swingCfg, skillLevel,
} from './skills.js';

import {
  gatherBonus, completeStructure, finishSite, siteView, syncLegacyBuildings, structureView, structureName,
  centerOf, footprint,
} from './structures.js';
import { markHarvestCycle, fieldStage, fieldStageView, isHarvestReady } from './villagers.js';
import { housewarmArrival } from './residents.js';   // ★ §17-6 집들이
// ★ GDD3 §13-A-5 — 국고로 들어오는 문은 storage.deposit 하나다.
import { deposit, isFull, storageLimit, FULL_MESSAGE } from './storage.js';
import { round2, round3 } from './economy.js';
// ★ GDD3 §13-D-4 — 장비에 깃든 특성. 「거두는 손」·「나무 결」이 여기서 실제 몫이 된다.
import { equipEffects } from './equipment.js';
// ★ §17-15 — 역할 개성. 건축가 본인의 망치질은 더 나간다(siteWorkMultiplier).
import { rolePerk } from './npc.js';

const err = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });

export const nodeSwingSpec = (type, data) => skillsCfg(data).nodes[type] ?? null;
export const siteSwingSpec = (data) => skillsCfg(data).site;

/** 이 대상에 붙는 스킬 */
export function skillForTarget(kind, type, data) {
  if (kind === 'site') return siteSwingSpec(data).skill;
  return nodeSwingSpec(type, data)?.skill ?? null;
}

/**
 * actionSwing {nodeId} | {siteId} — 한 번 휘두른다.
 * @param {number} now 밀리초. 테스트·시뮬은 cmd.now 로 주입한다(결정론).
 * @returns {{ok:true, ...}|{ok:false,error}}
 */
export function actionSwing(world, nation, cmd, data, now = Date.now()) {
  if (!nation.isPlayer) return err('NOT_PLAYER', '플레이어 국가만 몸소 일합니다.');
  const avatarId = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const player = ensurePlayer(nation, avatarId, data, cmd.playerName ?? null);
  if ((player.downUntil || 0) > 0) return err('DOWNED', '아직 일어서지 못했습니다.');

  const siteId = cmd.siteId ?? cmd.payload?.siteId ?? null;
  const nodeId = cmd.nodeId ?? cmd.payload?.nodeId ?? cmd.targetId ?? cmd.payload?.targetId ?? null;
  if (siteId) return swingSite(world, nation, player, siteId, cmd, data, now);
  if (!nodeId) return err('BAD_TARGET', '무엇을 칠지 골라야 합니다.');
  return swingNode(world, nation, player, nodeId, cmd, data, now);
}

// ────────────────────────────────────────────────────────────────
// 자원 노드
// ────────────────────────────────────────────────────────────────
function swingNode(world, nation, player, nodeId, cmd, data, now) {
  const node = nodeById(world, nodeId);
  if (!node) return err('BAD_NODE', '그런 자리가 없습니다.');
  if (node.hidden) return err('HIDDEN_NODE', '아직 드러나지 않은 자리입니다.');
  if (node.concealed && !node.revealed) return err('HIDDEN_NODE', '아직 드러나지 않은 자리입니다.');
  const spec = nodeSwingSpec(node.type, data);
  if (!spec) return err('NOT_WORKABLE', '여기서는 거둘 것이 없습니다.');
  if (node.depleted) return err('DEPLETED', '다 캐낸 곳입니다.');

  /* ★ GDD3 §13-B-2 — **영토 밖 채집은 언제나 허용된다.**
     자원 군락이 영토 바깥 8~20타일에 앉게 된 이상, 「우리 땅이 아닙니다」로 막으면 1장부터 게임이 멎는다.
     서버가 지키는 것은 그대로 셋이다: 아바타가 손 닿는 거리에 있는가 · 쿨타임 · 노드 잔량. */
  const range = swingCfg(data).rangeTiles;
  const av = nation.avatars?.[player.id];
  if (av && dist(av.x, av.y, node.x, node.y) > range + 0.6) {
    return err('OUT_OF_RANGE', '더 가까이 가야 합니다.');
  }
  // ★ 밭 계열은 여물어야 거둔다 — 재배 루프(파종→새싹→성장→수확기)의 정본 판정
  if (spec.requiresRipe && !isHarvestReady(node, data, world.tick)) {
    // ★ nodeId 를 함께 준다 — 클라가 "저 밭은 아직 아니다"를 그 자리에서 장부에 적어야
    //   여물지 않은 밭을 계속 두드리지 않는다(일 틱을 기다리지 않는 구조의 필수 조건).
    return err('NOT_READY', '아직 여물지 않았습니다.', {
      nodeId: node.id, readyAt: node.readyAt ?? null, harvestReady: false,
    });
  }

  /* ★ GDD3 §13-A-5 — 곳간이 다 찼으면 **채집 자체가 무효다.**
     쿨타임을 태우거나 노드를 축내기 전에 막는다. 헛손질로 나무만 줄어드는 일이 없어야 한다. */
  const wanted = [...new Set([...Object.keys(spec.yield || {}), ...Object.keys(spec.cycleBonus || {})])];
  if (wanted.length && wanted.every((res) => isFull(nation, res, data))) {
    return err('STORAGE_FULL', FULL_MESSAGE, {
      nodeId: node.id, limit: storageLimit(nation, data), resources: wanted,
    });
  }

  const cd = canSwing(nation, player, spec.skill, data, now);
  if (!cd.ok) return err('COOLDOWN', '아직 휘두를 수 없습니다.', { waitMs: cd.waitMs, cooldownMs: cd.cooldownMs });

  markSwing(player, now, spec.skill);
  /* ★ §13-D-4 — 인첸트의 몫. 「거두는 손」은 모든 채집에, 「나무 결」은 벌목에만 얹힌다.
     스킬·도구 배수와 곱하지 않고 **더해서** 한 번만 곱한다 — 특성 둘이 서로를 부풀리지 않게. */
  const fx = equipEffects(player, data);
  const charm = 1 + (fx.harvest || 0) + (spec.skill === 'lumber' ? (fx.lumber || 0) : 0);
  const mult = round3(yieldMultiplier(nation, player, spec.skill, data) * charm);

  // 노드별 스윙 카운트 — 한 주기(나무 한 그루·바위 한 덩이)를 끝내면 보너스가 터진다
  // ★ §13-B-4 — 유적은 제 크기만큼 시간이 든다: 노드에 박힌 swingsPerCycle 이 규격을 이긴다.
  const perCycle = Math.max(1, node.swingsPerCycle ?? spec.swings);
  node.swings = (node.swings || 0) + 1;
  const cycleDone = node.swings % perCycle === 0;

  const gained = {};
  const addYield = (table, scale = 1) => {
    for (const [res, v] of Object.entries(table || {})) {
      const bonus = 1 + gatherBonus(nation, res, data);
      const want = round2(v * mult * scale * bonus);
      if (want <= 0) continue;
      /* ★ GDD3 §13-A-5 — 곳간에 들어간 만큼만 내 것이다. 넘치는 몫은 버려진다. */
      const got = deposit(nation, res, want, data);
      if (got <= 0) continue;
      gained[res] = round2((gained[res] || 0) + got);
      player.stats.gathered[res] = round2((player.stats.gathered[res] || 0) + got);
    }
  };
  addYield(spec.yield);
  if (cycleDone) addYield(spec.cycleBonus);

  /* ★ §16-17 — 광역 스윙(스타듀밸리의 충전 도끼에서 배웠다). 솜씨가 오르면 한 번의 스윙이
     곁의 **같은 자리**까지 스친다 — 레벨업 보상이 「쿨타임 감소」뿐이던 성장에 손맛을 더한다.
     스친 자리는 제 잔량이 깎인다(공짜가 아니다). 여물어야 하는 밭은 여문 이웃만 스친다. */
  let cleaved = 0;
  const cv = swingCfg(data).cleave;
  const lvl0 = skillLevel(player, spec.skill);
  if (cv && cv.enabled !== false && lvl0 >= (cv.level ?? 7) && spec.drain > 0) {
    const maxN = Math.min(cv.maxTargets ?? 3, 1 + Math.floor((lvl0 - (cv.level ?? 7)) / (cv.step ?? 5)));
    const R = cv.radiusTiles ?? 1.9;
    const ratio = cv.ratio ?? 0.3;
    for (const nb of world.map?.nodes || []) {
      if (cleaved >= maxN) break;
      if (nb === node || nb.type !== node.type || nb.depleted || nb.hidden) continue;
      if (nb.concealed && !nb.revealed) continue;
      if (spec.requiresRipe && !isHarvestReady(nb, data, world.tick)) continue;
      if (dist(nb.x, nb.y, node.x, node.y) > R) continue;
      addYield(spec.yield, ratio);
      if (nb.max > 0) {
        nb.amount = Math.max(0, round2(nb.amount - spec.drain * ratio));
        if (nb.amount <= 0) markDepleted(nb, data, world.tick);
        nb.stamp = world.tick;
      }
      cleaved += 1;
    }
  }

  // 잔량 · 고갈
  // ★ 잔량 감소는 획득량에 (거의) 비례한다 — 좋은 도구는 '더 빨리' 캐는 것이지 '무한히' 캐는 게 아니다.
  //   장기 채집 속도의 진짜 상한은 노드 잔량(amount)과 재생(regenPerTick)이 쥔다.
  if (spec.drain > 0 && node.max > 0) {
    const drain = spec.drain * Math.pow(mult, swingCfg(data).drainExponent ?? 1);
    node.amount = Math.max(0, round2(node.amount - drain));
    // ★ §13-B-3 — 다 캔 자리는 그루터기로 남고, 되살아날 날이 그 자리에서 정해진다
    if (node.amount <= 0) markDepleted(node, data, world.tick);
  }
  // 거두면 곧바로 재파종된다 (다음 수확기까지 기다린다)
  if (data.world.nodes.types[node.type]?.harvest && cycleDone) {
    node.readyAt = world.tick + data.balance.harvest.readyEveryTicks;
    node.stage = fieldStage(node, data, world.tick);
  }
  node.stamp = world.tick;

  // 유적은 자원 대신 탐사 게이지가 찬다 — ★ §13-B-4 클수록 빨리 차고 값진 것이 나온다
  let ruin = null;
  if (spec.ruinGauge && cycleDone) {
    const gain = node.ruinGauge ?? spec.ruinGauge;
    nation.ruinGauge = (nation.ruinGauge || 0) + gain;
    nation.ruinGradeBoost = Math.max(nation.ruinGradeBoost || 0, node.gradeBoost || 0);
    ruin = {
      gauge: nation.ruinGauge, threshold: data.ruins.gaugeThreshold,
      size: node.size ?? 1, name: node.ruinName ?? null, gradeBoost: node.gradeBoost || 0,
    };
    recordRuin(nation, node, world.tick);
  }

  // ★ §17-17 — 숨은 궤. 유적과 달리 카드가 없다: 뚜껑이 열리면 값이 나오고 자리는 세상에서 사라진다.
  let cache = null;
  if (spec.cacheReward && cycleDone) cache = openCache(world, nation, node, data);

  const xpCfg = swingCfg(data);
  const xp = grantXp(player, spec.skill, xpCfg.xpPerSwing + (cycleDone ? xpCfg.xpPerCycle : 0), data);

  return {
    ok: true,
    nodeId: node.id,
    nodeType: node.type,
    skill: spec.skill,
    gained,
    cycle: cycleDone,
    swings: node.swings,
    swingsPerCycle: spec.swings,
    amount: round2(node.amount),
    depleted: Boolean(node.depleted),
    // ★ §13-B-3 — 그루터기가 언제 되살아나는지. 화면이 '아직 아니다'를 그 자리에서 안다.
    respawnAt: node.respawnAt ?? null,
    // ★ 재배 루프의 현재 상태 — 거두고 나면 곧바로 재파종되므로, 이 값을 함께 주지 않으면
    //   화면은 다음 일 틱(최대 10분)까지 '아직 여물어 있다'고 믿고 헛손질한다.
    readyAt: node.readyAt ?? null,
    harvestReady: isHarvestReady(node, data, world.tick),
    ...fieldStageView(node, data, world.tick),
    cooldownMs: cd.cooldownMs,
    multiplier: round2(mult),
    cleaved,
    charm: round3(charm),
    tool: toolFor(nation, player, spec.skill, data),
    level: skillLevel(player, spec.skill),
    leveled: xp.leveled,
    xp: round2(player.skills[spec.skill].xp),
    ruin,
    cache,
  };
}

/**
 * ★ §17-17 — 궤를 연다.
 *
 * 보상 난수가 **월드 난수가 아니라** 노드 id 로 지은 개인 난수인 까닭은 §13-C 에서 이미 겪었다:
 * 실시간 스윙이 월드 난수를 한 톨이라도 축내면 웨이브 구성·사건·이름이 통째로 밀려 같은 씨앗이
 * 다른 게임이 된다. 덕분에 「같은 지도의 같은 궤는 언제 열어도 같은 것을 낸다」가 공짜로 따라온다.
 *
 * 연 궤는 removeNode 로 지운다 — 그루터기(markDepleted)가 아니다. 다시 차는 궤는 궤가 아니다.
 */
function openCache(world, nation, node, data) {
  const cfg = data.world.nodes.types[node.type]?.reward;
  if (!cfg) return null;
  const rng = statRng(`${world.seed}:cache:${node.id}`);
  const gold = rng.int(cfg.gold[0], cfg.gold[1]);
  nation.gold = round2((nation.gold || 0) + gold);
  nation.stats.goldEarned = round2((nation.stats.goldEarned || 0) + gold);
  let artifact = null;
  if (rng.chance(cfg.artifactChance)) artifact = grantRandomArtifact(nation, data, rng, world.tick);
  removeNode(world, node.id);
  return { nodeId: node.id, gold, artifact, total: round2(nation.gold) };
}

// ────────────────────────────────────────────────────────────────
// 건설 현장
// ────────────────────────────────────────────────────────────────
function swingSite(world, nation, player, siteId, cmd, data, now) {
  const site = (nation.construction || []).find((c) => c.id === siteId);
  if (!site) return err('NO_SITE', '그런 공사가 없습니다.');
  const spec = siteSwingSpec(data);
  const range = swingCfg(data).rangeTiles;
  const av = nation.avatars?.[player.id];
  if (av && site.x != null) {
    // ★ §12-1 — 큰 현장은 중심에서 재고, 풋프린트 절반만큼 손이 더 닿는다
    const c = centerOf(site.building, site.x, site.y, data);
    const fp = footprint(site.building, data);
    const reach = range + 0.6 + Math.max(fp.w, fp.h) / 2;
    if (dist(av.x, av.y, c.x, c.y) > reach) return err('OUT_OF_RANGE', '더 가까이 가야 합니다.');
  }
  const cd = canSwing(nation, player, spec.skill, data, now);
  if (!cd.ok) return err('COOLDOWN', '아직 휘두를 수 없습니다.', { waitMs: cd.waitMs, cooldownMs: cd.cooldownMs });

  markSwing(player, now, spec.skill);
  const mult = yieldMultiplier(nation, player, spec.skill, data);
  site.swings = (site.swings || 0) + 1;
  const cycleDone = site.swings % spec.swings === 0;
  /* ★ §17-15 — 건축가 **본인**의 망치질은 25% 더 나간다. 그 자리를 맡은 사람(roles.build.owner)
     또는 그 자리에 앉은 동료 봇(roles.build.botId)이 휘두를 때만이다 — 자리가 채워졌다고
     모두의 공사가 빨라지는 것이 아니라, 그 사람이 현장에 서는 것이 값이다. */
  const br = nation.roles?.build;
  const architectSelf = br?.holder
    && ((br.holder === 'npc' && br.botId === player.id) || (br.holder === 'player' && br.owner === player.id));
  const perk = architectSelf ? rolePerk(nation, 'build', 'siteWorkMultiplier', data) : 1;
  const points = round2((spec.buildPointsPerSwing + (cycleDone ? spec.cycleBonus : 0)) * mult * perk);
  site.remaining = Math.max(0, round2(site.remaining - points));

  const xpCfg = swingCfg(data);
  const xp = grantXp(player, spec.skill, xpCfg.xpPerSwing + (cycleDone ? xpCfg.xpPerCycle : 0), data);

  const out = {
    ok: true,
    siteId: site.id,
    building: site.building,
    mode: site.mode ?? (site.structureId ? 'upgrade' : 'build'),
    phase: site.phase ?? null,
    skill: spec.skill,
    buildPoints: points,
    remaining: site.remaining,
    total: site.total,
    progress: round3(1 - site.remaining / Math.max(1, site.total)),
    cycle: cycleDone,
    cooldownMs: cd.cooldownMs,
    level: skillLevel(player, spec.skill),
    leveled: xp.leveled,
    xp: round2(player.skills[spec.skill].xp),
    done: false,
  };

  // ★ 마지막 망치질이 건물을 세운다 (GDD3 §11-1 — 시간이 완공을 여는 것이 아니다).
  //   예전에는 스윙으로 남은 일을 0 으로 만들어도 **다음 일 틱(최대 10분)** 이 와야 건물이 섰다.
  //   목표 카드가 「천막을 세우세요」인데 다 두드리고도 아무 일이 안 일어나는 순간이 생겼다.
  if (site.remaining <= 0.0001) {
    const mode = site.mode ?? (site.structureId ? 'upgrade' : 'build');
    // ★ §12-12 — 철거·이전도 같은 망치질로 밀어붙인다
    if (mode === 'demolish' || mode === 'relocate') {
      const r = finishSite(world, nation, site, data);
      syncLegacyBuildings(nation, data);
      if (r && r.kind === 'takedown') {
        // 해체가 끝났다 — 현장은 그대로 남아 새 자리에서 재건 마디를 산다
        out.phase = 'rebuild';
        out.remaining = site.remaining;
        out.total = site.total;
        out.progress = 0;
        out.site = siteView(nation, site, data);
        return out;
      }
      const idx = (nation.construction || []).indexOf(site);
      if (idx >= 0) nation.construction.splice(idx, 1);
      const info = {
        structureId: r?.structureId ?? site.structureId ?? null, building: site.building, key: site.building,
        name: r?.name ?? structureName(site.building, site.tier, data),
        tier: site.tier, x: r?.x ?? site.x ?? null, y: r?.y ?? site.y ?? null,
        mode, refund: r?.refund ?? null, upgrade: false,
      };
      out.done = true;
      out.mode = mode;
      out.structure = r?.structure ?? null;
      out.refund = r?.refund ?? null;
      out.resources = { ...nation.resources };
      out.buildingDone = info;
      out.events = [{ kind: 'building_done', nationId: nation.id, data: info }];
      return out;
    }
    const idx = (nation.construction || []).indexOf(site);
    if (idx >= 0) nation.construction.splice(idx, 1);
    const built = completeStructure(world, nation, site, data);
    syncLegacyBuildings(nation, data);
    // ★ §17-6 집들이 — 마지막 망치질로 지붕이 오르면 한 사람이 곧장 들어온다
    const guest = built ? housewarmArrival(world, nation, built, data) : null;
    const info = {
      structureId: built?.id ?? null, building: site.building, key: site.building,
      name: structureName(site.building, site.tier, data),
      tier: site.tier, x: site.x ?? null, y: site.y ?? null,
      mode, upgrade: Boolean(site.structureId),
    };
    out.done = true;
    out.structure = built ? structureView(nation, built, data) : null;
    out.buildingDone = info;
    out.events = [{ kind: 'building_done', nationId: nation.id, data: info }];
    if (guest) {
      nation.stats.residentsArrived = (nation.stats.residentsArrived || 0) + 1;
      out.housewarm = { id: guest.id, name: guest.name };
      out.events.push({
        kind: 'resident_arrived', nationId: nation.id,
        data: {
          id: guest.id, name: guest.name, appearance: guest.appearance, x: guest.x, y: guest.y,
          total: nation.stats.residentsArrived, population: Math.floor(nation.population),
          capacity: nation.populationCap ?? null, housewarm: true,
        },
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// 클라 표시용 — 스윙 가능 여부 미리보기
// ────────────────────────────────────────────────────────────────
export function swingPreview(nation, avatarId, data) {
  const player = nation.players?.[avatarId ?? 'lord'];
  if (!player) return null;
  const out = {};
  for (const [type, spec] of Object.entries(skillsCfg(data).nodes)) {
    if (type.startsWith('_')) continue;              // 자료 파일의 설명문(_note)은 규약에 싣지 않는다
    out[type] = {
      skill: spec.skill,
      swings: spec.swings,
      cooldownMs: swingCooldownMs(nation, player, spec.skill, data),
      multiplier: round2(yieldMultiplier(nation, player, spec.skill, data)),
      yield: { ...spec.yield },
      cycleBonus: { ...spec.cycleBonus },
    };
  }
  const site = siteSwingSpec(data);
  out.site = {
    skill: site.skill, swings: site.swings,
    cooldownMs: swingCooldownMs(nation, player, site.skill, data),
    buildPointsPerSwing: site.buildPointsPerSwing,
  };
  return { rangeTiles: swingCfg(data).rangeTiles, targets: out };
}

export { markHarvestCycle, isHarvestReady };
