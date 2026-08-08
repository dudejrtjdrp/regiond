// 기차 — docs/QA1차/09_연구.md F09-2 · ★ §19-F4.
//
// 「왜」 레일 그래프를 짓지 않는가. 철로(research.js placeRail)는 **바닥**이다 — 위를 걷는 걸음이
// 두 배가 되는 칸일 뿐, 이어져 있을 의무도 없고 갈래를 나눌 문법도 없다. 없는 그래프를 억지로
// 지어내면 「깔다 만 철로 위에서 기차가 멈춘다」는 규칙을 새로 가르쳐야 한다. 그래서 길은
// **정거장이 쥔다**: 세운 차례대로 곧게 잇고 그 위를 왕복한다. 철로는 여전히 걸음을 두 배로 한다.
//
// 자리는 서버가 쥔다. 탄 사람의 아바타 좌표를 서버가 옮기고(moveAvatar 는 그동안 막힌다),
// 화면은 여느 남의 좌표와 똑같이 §19-B 보간 띠로 받는다 — 기차만을 위한 새 규칙이 없다.
//
// 이번에 싣지 않은 것: 화물. 사람만 탄다(후속 과제).
import { researchFeature } from './research.js';
import { isRuined } from './structures.js';
import { dist } from './world.js';
import { round2 } from './economy.js';

export const trainCfg = (data) => data.research?.trains ?? null;

/**
 * 한 량에 몇 사람이 타는가.
 * ★ §20-R4(§20-3 기관장의 인장) — 유물의 적재 배수(+50%)를 여기 한 자리에서 곱한다.
 * 배수는 tick.js 가 하루 한 번 박아 두는 거울이다(collectHooks 는 부르지 않는다 — 타고 내리는
 * 판정과 뷰는 둘 다 실시간 길목이다). 자리는 사람 수라 반드시 내림한다 — 4×1.5 = 6, 4×1 = 4.
 * 유물이 없으면 배수가 1 이라 옛 값(cfg.capacity ?? 4)과 한 톨도 다르지 않다.
 */
export const trainCapacity = (nation, cfg) =>
  Math.floor((cfg?.capacity ?? 4) * (nation?.artifactTrainCargo ?? 1));

const err = (code, message) => ({ ok: false, error: { code, message } });

/** 정거장 한 채의 한가운데 — 풋프린트(2×2)의 복판이다 */
export function stationCenter(s, data) {
  const fp = data.buildings.station?.footprint ?? [1, 1];
  return { x: s.x + (fp[0] - 1) / 2, y: s.y + (fp[1] - 1) / 2 };
}

/** 길이 되는 정거장들 — 세운 차례 그대로다(결정론: 배열 순서가 곧 노선). */
export function stationList(nation) {
  return (nation.structures || []).filter((s) => s.key === 'station' && !isRuined(s) && !s.inactive);
}

export function ensureTrains(nation) {
  nation.trains ||= [];
  if (nation.nextTrainId == null) nation.nextTrainId = 1;
  return nation.trains;
}

/** 기차가 설 수 있는 판인가 — 철로를 배웠고 정거장이 minStations 채 이상 */
export function trainsOpen(nation, data) {
  const cfg = trainCfg(data);
  if (!cfg) return false;
  return researchFeature(nation, 'rails', data) && stationList(nation).length >= cfg.minStations;
}

/** 정거장이 헐렸거나 연구가 없던 판이면 기차를 거둔다. 조건이 서면 한 대를 세운다. */
export function syncTrains(world, nation, data) {
  const cfg = trainCfg(data);
  const list = ensureTrains(nation);
  if (!cfg) return list;
  if (!trainsOpen(nation, data)) { dropAll(nation); nation.trains = []; return nation.trains; }
  const stations = stationList(nation);
  for (const t of list) t.to = Math.min(t.to, stations.length - 1);
  if (list.length < (cfg.maxTrains ?? 1)) list.push(newTrain(nation, stations, data, world.tick));
  return list;
}

function newTrain(nation, stations, data, tick) {
  const at = stationCenter(stations[0], data);
  return {
    id: `tr${nation.nextTrainId++}`, x: at.x, y: at.y,
    from: 0, to: 1, dir: 1, dwell: trainCfg(data).dwellSeconds ?? 3,
    riders: [], bornTick: tick,
  };
}

/** 태운 사람을 모두 내려 놓는다(자리는 그대로 — 기차가 사라져도 사람은 남는다) */
function dropAll(nation) {
  for (const t of nation.trains || []) t.riders = [];
}

// ────────────────────────────────────────────────────────────────
// 한 걸음 — 생태 루프(1초)가 부른다
// ────────────────────────────────────────────────────────────────
/**
 * @returns {{moved:boolean, arrivals:Array, avatars:boolean}}
 */
export function stepTrains(world, nation, data, dt) {
  const cfg = trainCfg(data);
  if (!cfg) return { moved: false, arrivals: [], avatars: false };
  const list = syncTrains(world, nation, data);
  const stations = stationList(nation);
  const out = { moved: false, arrivals: [], avatars: false };
  for (const t of list) {
    if (stations.length < (cfg.minStations ?? 2)) break;
    const res = stepOne(t, stations, nation, data, cfg, dt);
    out.moved = out.moved || res.moved;
    out.avatars = out.avatars || res.moved || Boolean(res.arrival);
    if (res.arrival) out.arrivals.push(res.arrival);
  }
  return out;
}

function stepOne(t, stations, nation, data, cfg, dt) {
  if (t.dwell > 0) { t.dwell = round2(Math.max(0, t.dwell - dt)); return { moved: false, arrival: null }; }
  const goal = stationCenter(stations[t.to] ?? stations[0], data);
  const gap = dist(t.x, t.y, goal.x, goal.y);
  const stride = (cfg.speed ?? 6) * dt;
  if (gap <= stride || gap < 0.001) return arrive(t, stations, nation, goal, cfg);
  t.x = round2(t.x + ((goal.x - t.x) / gap) * stride);
  t.y = round2(t.y + ((goal.y - t.y) / gap) * stride);
  carry(t, nation);
  return { moved: true, arrival: null };
}

/** 다다랐다 — 사람을 내리고, 머물다, 다음 정거장을 잡는다(끝이면 되돌아선다) */
function arrive(t, stations, nation, goal, cfg) {
  t.x = round2(goal.x); t.y = round2(goal.y);
  carry(t, nation);
  const dropped = t.riders.slice();
  t.riders = [];
  t.from = t.to;
  t.dwell = cfg.dwellSeconds ?? 3;
  if (t.from >= stations.length - 1) t.dir = -1;
  if (t.from <= 0) t.dir = 1;
  t.to = Math.min(stations.length - 1, Math.max(0, t.from + t.dir));
  return { moved: true, arrival: { trainId: t.id, stationId: stations[t.from].id, x: t.x, y: t.y, dropped } };
}

/** 탄 사람의 몸을 기차에 붙여 옮긴다 — 자리는 서버 권위다 */
function carry(t, nation) {
  for (const id of t.riders) {
    const av = nation.avatars?.[id];
    if (!av) continue;
    av.x = t.x; av.y = t.y;
  }
}

// ────────────────────────────────────────────────────────────────
// 타고 내리기
// ────────────────────────────────────────────────────────────────
export const riding = (nation, who) =>
  (nation.trains || []).find((t) => (t.riders || []).includes(who)) ?? null;

/** boardTrain — 정거장에 선 기차 곁에서 [E]. 달리는 기차에는 못 탄다. */
export function boardTrain(world, nation, cmd, data) {
  const cfg = trainCfg(data);
  const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const av = nation.avatars?.[who];
  if (!cfg) return err('NO_TRAIN', '기차가 없습니다.');
  if (!av) return err('NO_AVATAR', '아바타가 없습니다.');
  if (riding(nation, who)) return err('ALREADY_ABOARD', '이미 타고 있습니다.');
  const t = nearestIdle(nation, av, cfg, cmd.trainId ?? cmd.payload?.trainId ?? null);
  if (!t) return err('NO_TRAIN_NEAR', '곁에 선 기차가 없습니다.');
  if (t.riders.length >= trainCapacity(nation, cfg)) return err('TRAIN_FULL', '자리가 없습니다.');
  t.riders.push(who);
  av.x = t.x; av.y = t.y;
  return { ok: true, trainId: t.id, avatarId: who, train: trainView(t) };
}

/** 곁에 서서 쉬고 있는 기차 하나 */
function nearestIdle(nation, av, cfg, wantId) {
  let best = null;
  for (const t of nation.trains || []) {
    if (wantId && t.id !== wantId) continue;
    if (!(t.dwell > 0)) continue;
    if (dist(av.x, av.y, t.x, t.y) > (cfg.boardRadius ?? 3)) continue;
    if (!best || dist(av.x, av.y, t.x, t.y) < dist(av.x, av.y, best.x, best.y)) best = t;
  }
  return best;
}

/** leaveTrain — 스스로 내린다(다음 정거장에 닿으면 저절로 내리기도 한다) */
export function leaveTrain(world, nation, cmd, data) {
  const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const t = riding(nation, who);
  if (!t) return err('NOT_ABOARD', '기차에 타고 있지 않습니다.');
  t.riders = t.riders.filter((id) => id !== who);
  return { ok: true, trainId: t.id, avatarId: who, x: t.x, y: t.y };
}

// ────────────────────────────────────────────────────────────────
// 화면이 읽는 칸
// ────────────────────────────────────────────────────────────────
export const trainView = (t) => ({
  id: t.id, x: t.x, y: t.y, to: t.to, dwell: round2(t.dwell), riders: [...(t.riders || [])],
});

export function trainViews(nation) {
  return (nation.trains || []).map(trainView);
}

/** 정거장 노선 한 벌 — 화면이 선을 긋고, 조언이 「정거장 한 채가 더 있어야 한다」를 적는다 */
export function trainSummary(nation, data) {
  const cfg = trainCfg(data);
  const stations = stationList(nation).map((s) => ({ id: s.id, ...stationCenter(s, data) }));
  return {
    open: trainsOpen(nation, data),
    minStations: cfg?.minStations ?? 2,
    boardRadius: cfg?.boardRadius ?? 3,
    capacity: trainCapacity(nation, cfg),      // ★ §20-R4 — 화면도 유물이 얹은 자리 수를 그대로 본다
    stations,
    list: trainViews(nation),
  };
}
