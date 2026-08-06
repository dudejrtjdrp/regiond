// assign.js — 노는 손이 없게 하는 유지보수 패스 (Sprint 2).
//
// 진단(코드 실측): 배치(assignByMix)는 플레이어 명령 때만 돌았고, 유휴는 **흡수 상태**였다 —
// 한 번 놀면 영원히 놀고, 새 주민도 집결지 없이는 영원히 유휴였다. 여기 있는 것 넷:
//   ① autoPlaceIdle — 유휴(와 3티어 전 산출 0 인 죽은 직업)를 필요도순으로 빈 자리에 앉힌다
//       · Manor Lords 「미배정 = 범용 노동 풀」 + RimWorld 「완료 시점 재선택」의 이식.
//       · 수동 배치(u.manual — commandVillagers 가 찍는다)는 **절대** 건드리지 않는다.
//   ② stepScouts — 정찰꾼이 진짜로 걷는다: 안개 경계의 가장 가까운 미탐험 지점이 목적지다.
//       시야는 이미 있었다(fog.vision.scout=9) — 없던 것은 **걸음**이다.
//   ③ battleStations / standDown — 전투가 열리면 수비는 깃발로, 영토 밖 일꾼은 마을로
//       (RimWorld 위협 반응의 축소판 — 직업은 그대로, 발만 움직인다). 끝나면 제자리로.
//   ④ 전부 결정론이다: 난수 없음, id 정렬 순회 — 같은 씨앗은 같은 게임이다.
import { townOf, territoryRadius, dist } from './world.js';
import { targetsForJob, resolveTarget, place, syncNodeWorkers, vCfg } from './villagers.js';
import { grainDays } from './residents.js';
import { departmentsActive } from './progression.js';
import { isExplored } from './fog.js';
import { walkableFor, nearestWalkable } from './path.js';

export const autoCfg = (data) => vCfg(data).autoAssign ?? {};

/** 지금 무엇이 급한가 — 곡물 위기 먼저, 그다음 재고 적은 순, 그다음 꼬리 수요. 결정론(동률은 이름순). */
export function needRank(nation, data) {
  const cfg = autoCfg(data);
  const res = nation.resources || {};
  const kinds = [];
  if (grainDays(nation, data) < (cfg.grainDaysUrgent ?? 6)) kinds.push('grain');
  const stocks = (cfg.stockKinds ?? ['wood', 'stone', 'grain']).slice()
    .sort((a, b) => ((res[a] || 0) - (res[b] || 0)) || a.localeCompare(b));
  kinds.push(...stocks);
  kinds.push(...(cfg.extraKinds ?? []));
  return [...new Set(kinds)];
}

/** 일하는 몸만 자리를 차지한다 — 유휴가 hall 을 명목상 채우고 있어도 일자리는 비어 있다 */
function workingCounts(nation) {
  const used = new Map();
  for (const u of nation.villagers || []) {
    if (!u.targetId || u.job === 'idle') continue;
    used.set(u.targetId, (used.get(u.targetId) || 0) + 1);
  }
  return used;
}

/**
 * 유휴(와 3티어 전 죽은 직업)를 필요도순으로 앉힌다.
 * @returns {Array<{id, job, to}>} 움직인 사람들
 */
export function autoPlaceIdle(world, nation, data) {
  const cfg = autoCfg(data);
  if (cfg.enabled === false) return [];
  const jobOf = cfg.jobOf ?? { grain: 'farm', wood: 'lumber', stone: 'quarry', ironOre: 'mine' };
  const dead = departmentsActive(nation, data) ? [] : (cfg.preDepartmentDeadJobs ?? []);
  const pool = (nation.villagers || [])
    .filter((u) => !u.manual && (u.job === 'idle' || dead.includes(u.job)))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!pool.length) return [];

  const used = workingCounts(nation);
  const targetCache = new Map();     // job -> 노드 먼저, 그다음 일자리 건물(건물 자리는 산출이 절반이다)
  const targetsOf = (job) => {
    if (!targetCache.has(job)) {
      const ts = targetsForJob(world, nation, job, data)
        .filter((t) => t.kind !== 'site');
      targetCache.set(job, [...ts.filter((t) => t.kind === 'node'), ...ts.filter((t) => t.kind !== 'node')]);
    }
    return targetCache.get(job);
  };

  const moved = [];
  const kinds = needRank(nation, data);
  for (const u of pool) {
    for (const kind of kinds) {
      const job = jobOf[kind];
      if (!job) continue;
      const t = targetsOf(job).find((c) => (used.get(c.id) || 0) < c.slots);
      if (!t) continue;
      place(world, nation, u, t, job, data);
      u.manual = false;
      used.set(t.id, (used.get(t.id) || 0) + 1);
      moved.push({ id: u.id, job, to: t.id });
      break;
    }
  }
  if (moved.length) syncNodeWorkers(world, nation, data);
  return moved;
}

/** 안개 경계 — 마을 기준 고리를 넓혀 가며 아직 못 본, 설 수 있는 칸 중 이 사람에게 가장 가까운 것 */
function nextFrontier(world, nation, data, u, town, cfg) {
  const size = data.world.size;
  const step = Math.max(2, cfg.ringStep ?? 7);
  const samples = Math.max(4, cfg.samplesPerRing ?? 16);
  const maxR = cfg.maxRadius ?? 90;
  for (let r = step; r <= maxR; r += step) {
    let best = null;
    let bd = Infinity;
    for (let i = 0; i < samples; i += 1) {
      const a = (2 * Math.PI * i) / samples;
      const x = Math.round(town.x + Math.cos(a) * r);
      const y = Math.round(town.y + Math.sin(a) * r);
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
      if (isExplored(nation, x, y)) continue;
      if (!walkableFor(world, nation, data, x, y)) continue;
      const d = dist(u.x, u.y, x, y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (best) return best;     // 가장 안쪽 고리의 미탐험 지점 — 가까운 어둠부터 걷는다
  }
  return null;
}

/**
 * 정찰꾼의 하루 — 목적지에 닿았으면 다음 미탐험 지점을 받는다.
 * 다 보았으면(경계가 없다) 유휴로 돌아와 노동 풀에 합류한다.
 */
export function stepScouts(world, nation, data) {
  const cfg = autoCfg(data).scout ?? {};
  const town = townOf(world, nation.id);
  if (!town) return 0;
  let sent = 0;
  const scouts = (nation.villagers || []).filter((u) => u.job === 'scout')
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const u of scouts) {
    const arrived = u.destX == null || (u.x === u.destX && u.y === u.destY);
    if (!arrived) continue;
    const next = nextFrontier(world, nation, data, u, town, cfg);
    if (next) {
      u.destX = next.x;
      u.destY = next.y;
      sent += 1;
    } else {
      /* 지도의 어둠이 다했다 — 정찰꾼의 일이 끝났다. 풀로 돌아간다. */
      u.job = 'idle';
      u.targetId = null;
      u.manual = false;
    }
  }
  return sent;
}

/** 하루 한 번의 유지보수 — tick.js 1-c 가 부른다 */
export function stepAssignments(world, nation, data) {
  const scouted = stepScouts(world, nation, data);
  const moved = autoPlaceIdle(world, nation, data);
  return { scouted, moved };
}

// ────────────────────────────────────────────────────────────────
// 비상 — 전투의 발 (RimWorld 위협 반응의 축소판. 직업·자리는 그대로, 발만 움직인다)
// ────────────────────────────────────────────────────────────────
/** 전투가 열렸다 — 수비는 깃발(없으면 모닥불)로, 영토 밖 일꾼은 마을로 몸을 피한다 */
export function battleStations(world, nation, data) {
  const town = townOf(world, nation.id);
  if (!town) return;
  const radius = territoryRadius(nation, data);
  const post = nation.defenseFlag ?? town;
  const spot = nearestWalkable(world, nation, data, post.x, post.y, 4) ?? town;
  for (const u of nation.villagers || []) {
    if (u.job === 'defense') {
      u.destX = spot.x;
      u.destY = spot.y;
      continue;
    }
    if (u.manual && !u.targetId) continue;      // 수동 대기 지시는 비상에도 지킨다(주인의 손가락이 먼저다)
    const out = dist(u.x, u.y, town.x, town.y) > radius
      || dist(u.destX ?? u.x, u.destY ?? u.y, town.x, town.y) > radius;
    if (out) {
      u.destX = town.x;
      u.destY = town.y;
    }
  }
}

/** 전투가 끝났다 — 저마다 제 일터의 발치로 돌아간다(place 가 목적지의 통행 스냅까지 해 준다) */
export function standDown(world, nation, data) {
  for (const u of nation.villagers || []) {
    if (!u.targetId) continue;
    const t = resolveTarget(world, nation, u.targetId, data);
    if (t) place(world, nation, u, t, u.job, data);
  }
  syncNodeWorkers(world, nation, data);
}
