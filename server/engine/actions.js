// 실시간 액션 — docs/GDD3.md §3. 스윙(actionSwing)이 이 게임의 손맛이다.
// ★ 아키텍처: 이 명령들은 '일 틱'을 기다리지 않는다. 소켓에서 즉시 처리되고 곧바로 결과가 돌아간다.
//   서버가 정본으로 쥐는 것 — 스윙 쿨타임(플레이어 단위) · 사거리 · 노드별 스윙 카운트 · 노드 잔량.
import { nodeById, townOf, territoryRadius, dist } from './world.js';
import {
  ensurePlayer, canSwing, markSwing, grantXp, yieldMultiplier, toolFor,
  swingCooldownMs, skillsCfg, swingCfg, skillLevel,
} from './skills.js';

import {
  gatherBonus, completeStructure, finishSite, siteView, syncLegacyBuildings, structureView, structureName,
  centerOf, footprint,
} from './structures.js';
import { markHarvestCycle, fieldStage, fieldStageView, isHarvestReady } from './villagers.js';
// ★ GDD3 §13-A-5 — 국고로 들어오는 문은 storage.deposit 하나다.
import { deposit, isFull, storageLimit, FULL_MESSAGE } from './storage.js';
import { round2, round3 } from './economy.js';

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
  const spec = nodeSwingSpec(node.type, data);
  if (!spec) return err('NOT_WORKABLE', '여기서는 거둘 것이 없습니다.');
  if (node.depleted) return err('DEPLETED', '다 캐낸 곳입니다.');

  const town = townOf(world, nation.id);
  if (!town || dist(node.x, node.y, town.x, town.y) > territoryRadius(nation, data) + 0.001) {
    return err('OUT_OF_TERRITORY', '우리 땅이 아닙니다.');
  }
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
  const mult = yieldMultiplier(nation, player, spec.skill, data);

  // 노드별 스윙 카운트 — 한 주기(나무 한 그루·바위 한 덩이)를 끝내면 보너스가 터진다
  node.swings = (node.swings || 0) + 1;
  const cycleDone = node.swings % spec.swings === 0;

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

  // 잔량 · 고갈
  // ★ 잔량 감소는 획득량에 (거의) 비례한다 — 좋은 도구는 '더 빨리' 캐는 것이지 '무한히' 캐는 게 아니다.
  //   장기 채집 속도의 진짜 상한은 노드 잔량(amount)과 재생(regenPerTick)이 쥔다.
  if (spec.drain > 0 && node.max > 0) {
    const drain = spec.drain * Math.pow(mult, swingCfg(data).drainExponent ?? 1);
    node.amount = Math.max(0, round2(node.amount - drain));
    node.depleted = node.amount <= 0;
  }
  // 거두면 곧바로 재파종된다 (다음 수확기까지 기다린다)
  if (data.world.nodes.types[node.type]?.harvest && cycleDone) {
    node.readyAt = world.tick + data.balance.harvest.readyEveryTicks;
    node.stage = fieldStage(node, data, world.tick);
  }
  node.stamp = world.tick;

  // 유적은 자원 대신 탐사 게이지가 찬다
  let ruin = null;
  if (spec.ruinGauge && cycleDone) {
    nation.ruinGauge = (nation.ruinGauge || 0) + spec.ruinGauge;
    ruin = { gauge: nation.ruinGauge, threshold: data.ruins.gaugeThreshold };
  }

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
    // ★ 재배 루프의 현재 상태 — 거두고 나면 곧바로 재파종되므로, 이 값을 함께 주지 않으면
    //   화면은 다음 일 틱(최대 10분)까지 '아직 여물어 있다'고 믿고 헛손질한다.
    readyAt: node.readyAt ?? null,
    harvestReady: isHarvestReady(node, data, world.tick),
    ...fieldStageView(node, data, world.tick),
    cooldownMs: cd.cooldownMs,
    multiplier: round2(mult),
    tool: toolFor(nation, player, spec.skill, data),
    level: skillLevel(player, spec.skill),
    leveled: xp.leveled,
    xp: round2(player.skills[spec.skill].xp),
    ruin,
  };
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
  const points = round2((spec.buildPointsPerSwing + (cycleDone ? spec.cycleBonus : 0)) * mult);
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
