// 주민 — docs/GDD3.md §4. 인구 0에서 시작해 한 명씩 걸어온다.
// ★ 옛 '인구 50 시작 · 이주민 %'는 폐기됐다. 주민은 실인원이다: unitCompressionFrom 명까지 1유닛=1명.
import { townOf, territoryRadius, dist, inTerritory } from './world.js';
import {
  housingCapacity, attractivenessBonus, moraleBonus, militiaSlots, militiaBonus,
  militiaDpsBonus, shrinePopulationCap, hasBuilding,
} from './structures.js';
import { featureUnlocked, departmentsActive } from './progression.js';
import { round2, round3, clamp } from './economy.js';
// ★ GDD3 §13-A-1 — 유입 조건도 티어 조건과 **같은 공장**에서 찍는다.
import { resourceReq, countReq } from './requirements.js';
// ★ GDD3 §13-D-1 — 사람마다 다른 네 수치. 평균이 정확히 중립이라 마을 곡선은 그대로다.
import {
  rollStats, statRng, ensureStats, yieldFactor, militiaHpFactor, militiaDpsFactor, haulFactor,
  statsView, jobFit,
} from './traits.js';

export const residentCfg = (data) => data.balance.residents;
export const arrivalCfg = (data) => data.balance.residents.arrival;
export const gatherCfg = (data) => data.balance.residents.gather;

// ────────────────────────────────────────────────────────────────
// 수용력 · 매력도
// ────────────────────────────────────────────────────────────────
/** 주거 수용력 = 주거 건물 합(천막1/오두막2/가옥4/저택6 …). 성지가 있으면 그 상한에도 걸린다. */
export function capacity(nation, data) {
  const beds = housingCapacity(nation, data);
  const shrineCap = shrinePopulationCap(nation, data);
  return shrineCap > 0 ? Math.min(beds, shrineCap) : beds;
}

export function freeBeds(nation, data) {
  return Math.max(0, capacity(nation, data) - Math.floor(nation.population || 0));
}

/** 식량 여유(하루치) */
export function grainDays(nation, data) {
  const need = Math.max(1, (nation.population || 0) * data.balance.population.grainPerCapita);
  return (nation.resources?.grain || 0) / need;
}

/**
 * 매력도 — 도착 주기를 나누는 값. 1 이면 기본 주기 그대로, 2 면 두 배로 빨리 온다.
 * 구성: 1 + 식량 잉여 + 장식·발전 건물 + 사기.
 */
export function attractiveness(nation, data) {
  const cfg = arrivalCfg(data);
  const surplus = Math.min(cfg.surplusCap, Math.max(0, grainDays(nation, data) - cfg.requiresGrainDays) * cfg.surplusPerGrainDay);
  const decor = attractivenessBonus(nation, data);
  const m = data.balance.morale;
  const moraleRatio = clamp(((nation.morale ?? 1) - m.default) / (m.max - m.default), -1, 1);
  const morale = moraleRatio * cfg.moraleWeight;
  return clamp(1 + surplus + decor + morale, 0.2, cfg.attractivenessMax);
}

/**
 * 도착 주기(게임일).
 *
 * ★ GDD3 §12-4 — 초반을 빠르게. baseIntervalDays 는 이제 1.0 이라 매력도만 붙으면 반나절에 한 명이 온다.
 * ★ 다만 **붐빔(crowding)** 을 함께 넣었다. 아무도 없는 개척지에는 소문이 금세 닿지만,
 *   이미 사람이 그득한 곳에는 새로 올 이유가 줄어든다 — 주기가 인구에 비례해 늘어난다.
 *   이 항이 없으면 85일에 인구가 두 배로 불어 웨이브 규모(정착지 규모에 비례)가 방어 투자를 앞질러
 *   버린다(실측: 인구 37 → 70, 웨이브5 생존율 70% → 30%). 초반 체감은 살리고 후반 곡선은 지키는 다이얼이다.
 */
export function arrivalIntervalDays(nation, data) {
  const cfg = arrivalCfg(data);
  const crowd = 1 + (cfg.crowdingPerResident ?? 0) * Math.floor(nation.population || 0);
  return Math.max(cfg.minIntervalDays, (cfg.baseIntervalDays / attractiveness(nation, data)) * crowd);
}

/**
 * 지금 주민이 올 수 있는 상태인가 + 왜 안 오는가.
 * ★ GDD3 §12-3 — 못 오는 까닭은 '왜'만이 아니라 **얼마나 모자란지**까지 낸다(빨강 + 부족분).
 * ★ GDD3 §12-4 — 조건이 찼으면 "다음 사람까지" 진행바를 그릴 수 있게 남은 날수도 함께 낸다.
 */
export function arrivalStatus(nation, data) {
  const cfg = arrivalCfg(data);
  const beds = freeBeds(nation, data);
  const gd = grainDays(nation, data);
  const unlocked = featureUnlocked(nation, 'residentArrival', data);
  const pop = Math.floor(nation.population || 0);
  // ★ §13-A-1 — 보여 주는 need 와 실제로 막는 문턱을 **같은 식**으로 맞춘다.
  //   grainDays = 곡물 ÷ max(1, 인구×1인분) 이므로, 문턱도 같은 분모를 써야 "다 찼는데 안 된다"가 없다.
  //   (지금 다이얼 grainPerCapita=1 에서는 옛 값과 한 톨도 다르지 않다.)
  const needGrain = round2(cfg.requiresGrainDays * Math.max(1, pop * data.balance.population.grainPerCapita));

  // 조건 하나하나를 초록/빨강으로 그릴 수 있는 표 (§12-3 전역 원칙)
  // ★ §13-A-1 — 곡물 행은 resourceReq 로 찍는다. 화면이 지금 국고로 다시 잴 수 있게 kind·resource 가 붙는다.
  const reqs = [
    countReq({
      key: 'unlocked', text: '사람이 찾아올 만한 곳',
      have: unlocked ? 1 : 0, need: 1,
      detail: unlocked ? '소문이 났습니다' : '오두막을 세우면 소문이 납니다',
    }),
    countReq({
      key: 'beds', text: '빈 잠자리',
      have: beds, need: 1, unit: '자리',
      detail: `잠자리 ${capacity(nation, data)}개 중 ${beds}개가 비었습니다`,
    }),
    resourceReq(nation, 'grain', pop > 0 ? needGrain : 0, data, {
      key: 'grain', text: '먹일 것', unit: '', dec: 1,
      detail: `식량 여유 ${round2(gd)}일치 (${cfg.requiresGrainDays}일치는 있어야 합니다)`,
    }),
  ];
  const bad = reqs.find((r) => !r.ok);
  const REASON = {
    unlocked: '아직 사람이 찾아올 만한 곳이 아닙니다.',
    beds: '누울 자리가 없습니다.',
    grain: '먹일 것이 모자랍니다.',
  };
  const reason = bad ? REASON[bad.key] : null;
  const interval = arrivalIntervalDays(nation, data);
  const progress = Math.min(1, nation.arrivalProgress || 0);
  return {
    open: !reason,
    reason,
    reqs,
    freeBeds: beds,
    capacity: capacity(nation, data),
    attractiveness: round3(attractiveness(nation, data)),
    attractivenessMax: cfg.attractivenessMax,
    intervalDays: round2(interval),
    progress: round3(progress),
    daysUntil: reason ? null : round2(Math.max(0, (1 - progress) * interval)),
    grainDays: round2(gd),
  };
}

// ────────────────────────────────────────────────────────────────
// 도착
// ────────────────────────────────────────────────────────────────
function pickName(rng, data) {
  const n = residentCfg(data).names;
  const title = rng.pick(n.titles);
  const family = rng.pick(n.family);
  const given = rng.pick(n.given);
  return `${title}${family}${given}`;
}

function randomAppearance(rng, data) {
  const fields = data.world.appearance.fields;
  const out = {};
  for (const [k, spec] of Object.entries(fields)) out[k] = rng.int(0, spec.count - 1);
  return out;
}

/** 한 명을 정착지에 들인다. 도착 연출(걸어오는 그림)은 클라의 몫이다. */
export function spawnResident(world, nation, data, rng) {
  const town = townOf(world, nation.id);
  const angle = rng.float(0, Math.PI * 2);
  const r = territoryRadius(nation, data) + 3;
  const from = {
    x: Math.max(0, Math.min(data.world.size - 1, Math.round((town?.x ?? 0) + Math.cos(angle) * r))),
    y: Math.max(0, Math.min(data.world.size - 1, Math.round((town?.y ?? 0) + Math.sin(angle) * r))),
  };
  const resident = {
    id: `r${nation.nextResidentId++}`,
    name: pickName(rng, data),
    appearance: randomAppearance(rng, data),
    /* ★ §13-D-1 — 태어날 때 한 번 굴리고 평생 바뀌지 않는다.
       ★ **세계 난수를 쓰지 않는다.** 씨앗·나라·사람 번호로 제 난수를 지어 굴린다(§13-C 와 같은 규칙).
          세계 난수를 한 톨 축내면 웨이브 구성·사건·이름이 통째로 밀려 같은 씨앗이 다른 게임이 된다
          — 실제로 그렇게 해 보고 시뮬 웨이브5 가 60%→45% 로 움직이는 것을 확인한 뒤 갈라냈다. */
    stats: rollStats(statRng(`${world.seed}:${nation.id}:r${nation.nextResidentId}`), data),
    job: 'idle',
    targetId: 'hall',
    x: from.x, y: from.y,
    destX: town?.x ?? from.x, destY: town?.y ?? from.y,
    arrivedTick: world.tick,
    militia: false,
    hp: null,
  };
  (nation.villagers ||= []).push(resident);
  nation.population = (nation.villagers || []).length;
  return resident;
}

/**
 * 하루치 도착 판정 — 매 일 틱에 1회.
 * 진행도(arrivalProgress)를 1/주기 만큼 채우고, 1을 넘으면 한 명이 온다.
 * @returns {Array} 이번에 도착한 주민들
 */
export function stepArrivals(world, nation, data, rng) {
  const st = arrivalStatus(nation, data);
  const arrived = [];
  if (!st.open) return arrived;
  const cfg = arrivalCfg(data);
  // 첫 사람은 조건이 서는 순간 바로 온다 — 첫 30분의 결정적 순간(GDD3 §2)
  if (cfg.firstFreeArrival && (nation.population || 0) === 0) {
    arrived.push(spawnResident(world, nation, data, rng));
    nation.arrivalProgress = 0;
    return arrived;
  }
  nation.arrivalProgress = (nation.arrivalProgress || 0) + 1 / arrivalIntervalDays(nation, data);
  let guard = 0;
  while (nation.arrivalProgress >= 1 && freeBeds(nation, data) > 0 && guard++ < 8) {
    nation.arrivalProgress -= 1;
    arrived.push(spawnResident(world, nation, data, rng));
  }
  if (freeBeds(nation, data) <= 0) nation.arrivalProgress = Math.min(nation.arrivalProgress, 1);
  return arrived;
}

// ────────────────────────────────────────────────────────────────
// 모집 — ★ GDD3 §13-D-2. 본부의 [모집] 단추.
//
// 자연 유입은 그대로 둔다. 이것은 그 위에 낸 **두 번째 문**이다: 곡물을 치르고 지금 당장 한 사람.
// 잠자리 조건은 자연 유입과 똑같다 — 식량으로 잠자리를 살 수는 없다.
// 쿨다운이 하루라, 붐빔(§12-4 crowding)이 자연 유입을 늦추는 후반에도 하루 한 명이 뚜껑이다.
// ────────────────────────────────────────────────────────────────
export const recruitCfg = (data) => data.balance.residents.recruit;

/** 지금 모집할 수 있는가 + 못 하는 조건 하나하나 (§12-3 조건 가시화) */
export function recruitStatus(world, nation, data) {
  const cfg = recruitCfg(data);
  const tick = world?.tick ?? 0;
  const readyTick = nation.recruit?.readyTick ?? 0;
  const cooling = Math.max(0, readyTick - tick);
  const beds = freeBeds(nation, data);
  const unlocked = featureUnlocked(nation, 'residentArrival', data);
  const reqs = [
    countReq({
      key: 'unlocked', text: '사람이 찾아올 만한 곳',
      have: unlocked ? 1 : 0, need: 1,
      detail: unlocked ? '소문이 났습니다' : '오두막을 세우면 소문이 납니다',
    }),
    countReq({
      key: 'beds', text: '빈 잠자리', have: beds, need: 1, unit: '자리',
      detail: `잠자리 ${capacity(nation, data)}개 중 ${beds}개가 비었습니다`,
    }),
    countReq({
      key: 'cooldown', text: '다시 부를 수 있을 때까지',
      have: cooling > 0 ? 0 : 1, need: 1,
      detail: cooling > 0 ? `${round2(cooling)}일 뒤에 다시 부를 수 있습니다` : '지금 부를 수 있습니다',
    }),
  ];
  for (const [res, amount] of Object.entries(cfg.cost || {})) {
    reqs.push(resourceReq(nation, res, amount, data, { key: `cost:${res}`, text: data.resources.meta[res]?.name ?? res, dec: 0 }));
  }
  const bad = reqs.find((x) => !x.ok);
  return {
    open: !bad,
    reason: bad ? bad.text : null,
    reqs,
    cost: { ...(cfg.cost || {}) },
    cooldownDays: cfg.cooldownDays,
    cooldownLeft: round2(cooling),
    readyTick,
    count: nation.recruit?.count ?? 0,
  };
}

/**
 * recruitResident — 값을 치르고 그 자리에서 한 사람.
 * @returns {{ok:true, resident, status}|{ok:false,error}}
 */
export function recruitResident(world, nation, data, rng) {
  const st = recruitStatus(world, nation, data);
  if (!st.open) {
    const bad = st.reqs.find((x) => !x.ok);
    return {
      ok: false,
      error: {
        code: bad?.key === 'beds' ? 'NO_BED' : (bad?.key === 'cooldown' ? 'COOLDOWN' : 'NOT_READY'),
        message: bad?.detail ?? '지금은 부를 수 없습니다.',
      },
    };
  }
  const cfg = recruitCfg(data);
  for (const [res, amount] of Object.entries(cfg.cost || {})) {
    nation.resources[res] = round2((nation.resources[res] || 0) - amount);
  }
  const resident = spawnResident(world, nation, data, rng);
  nation.recruit = {
    readyTick: (world?.tick ?? 0) + (cfg.cooldownDays ?? 1),
    count: (nation.recruit?.count ?? 0) + 1,
  };
  nation.stats.residentsArrived = (nation.stats.residentsArrived || 0) + 1;
  return { ok: true, resident, cost: { ...(cfg.cost || {}) }, status: recruitStatus(world, nation, data) };
}

/** 굶주림으로 사람이 떠난다(죽지 않는다 — 짐을 싸서 나간다) */
export function loseResidents(nation, count) {
  const list = nation.villagers || [];
  const n = Math.min(count, list.length);
  const gone = list.splice(list.length - n, n);
  nation.population = list.length;
  return gone;
}

// ────────────────────────────────────────────────────────────────
// 개별 채집 (티어 0~2) — 부처(콥더글러스)가 아직 안 돌 때의 유일한 주민 생산원
// ────────────────────────────────────────────────────────────────
const JOB_RESOURCE = {
  farm: 'grain', lumber: 'wood', quarry: 'stone', mine: 'ironOre',
};

/**
 * ★ GDD3 §13-A-3 — 주민 **한 사람**의 하루 산출. 국고 적립과 화면 표시가 **이 함수 하나**를 쓴다.
 *
 * 왜 갈라냈나: 실측해 보니 주민 산출은 국고에 제대로 들어가고 있었다(벌목 3명 → 하루 +15.36).
 * 문제는 **보이지 않는다**는 것이었다 — 일 틱(10분)에 한 번 소리 없이 뭉텅이로 들어가는 동안
 * 화면은 40번쯤 지고 나르는 시늉만 했다. 화면이 띄울 숫자가 국고에 실제로 들어가는 값과
 * 반드시 같으려면, 두 쪽이 같은 함수에서 값을 받아야 한다.
 *
 * ★ GDD3 §13-D-1 — 여기에 **능력치 배수**가 붙는다. 손재주·근면이 반이고, 자리가 영토 밖이면
 * 용기가 근면 몫을 나눠 든다. 가중치 합이 언제나 1 이라 최대 편차는 ±18%(상한 ±20% 안)이고,
 * 능력치 평균이 정확히 5.5 이므로 사람이 여럿이면 배수의 평균은 1.0 이다 — 마을 곡선은 안 흔들린다.
 *
 * @param {object|null} node 이 주민이 붙어 있는 자원 노드(없으면 건물 일자리)
 * @param {boolean} outdoor 그 자리가 영토 밖인가 (residentGather·residentViews 가 같은 값을 준다)
 * @returns {{kind:'resource'|'buildPoints'|'none', resource?:string, perDay:number, idle?:boolean, factor?:number}}
 */
export function residentYield(u, node, data, outdoor = false) {
  const cfg = gatherCfg(data);
  if (!u) return { kind: 'none', perDay: 0 };
  const factor = yieldFactor(u, data, Boolean(outdoor));
  if (u.job === 'idle') return { kind: 'resource', resource: 'grain', perDay: cfg.idleGrainPerDay, idle: true, factor: 1 };
  if (u.job === 'build') {
    return { kind: 'buildPoints', perDay: round2(cfg.buildPointsPerResidentPerDay * factor), factor };
  }
  const res = JOB_RESOURCE[u.job];
  if (!res) return { kind: 'none', perDay: 0 };
  if (node && node.type === 'oil') return { kind: 'resource', resource: 'oil', perDay: cfg.perResidentPerDay.oil };
  let amount = cfg.perResidentPerDay[res] || 0;
  if (!node) amount *= 0.5;                         // 일자리(건물)에 붙어 있으면 절반
  else if (node.depleted) amount = 0;
  else if (node.rich) amount *= cfg.richMultiplier;
  if (node && node.type === 'iron') amount = cfg.perResidentPerDay.ironOre;
  return { kind: 'resource', resource: res, perDay: round2(amount) };
}

/** 주민이 지금 붙어 있는 노드 (건물 일자리면 null) */
export const nodeOfResident = (world, u) =>
  (u?.targetId ? (world?.map?.nodes || []).find((n) => n.id === u.targetId) : null) || null;

/**
 * 주민 개별 노동 산출(하루). 노드에 붙은 주민만 낸다.
 * ★ §13-A-3 — 합산만 한다. 한 사람 몫은 residentYield 가 정본이다.
 * @returns {{resources:{}, buildPoints:number, workers:number}}
 */
export function residentGather(world, nation, data) {
  const out = { resources: {}, buildPoints: 0, workers: 0 };
  const nodeById = new Map((world.map?.nodes || []).map((n) => [n.id, n]));
  for (const u of nation.villagers || []) {
    const node = u.targetId ? (nodeById.get(u.targetId) ?? null) : null;
    const y = residentYield(u, node, data);
    if (y.kind === 'buildPoints') { out.buildPoints += y.perDay; out.workers += 1; continue; }
    if (y.kind !== 'resource' || !(y.perDay > 0)) continue;
    out.resources[y.resource] = (out.resources[y.resource] || 0) + y.perDay;
    if (!y.idle) out.workers += 1;
  }
  for (const k of Object.keys(out.resources)) out.resources[k] = round2(out.resources[k]);
  out.buildPoints = round2(out.buildPoints);
  return out;
}

// ────────────────────────────────────────────────────────────────
// 민병 — 전투에 나서는 주민 (GDD3 §6)
// ────────────────────────────────────────────────────────────────
/** 전투에 설 수 있는 주민 목록. 수비 배치(defense) 주민이 곧 민병이다. */
export function militiaList(nation, data) {
  const cfg = data.waves.battle.militia;
  const slots = Math.max(0, militiaSlots(nation, data));
  const bonus = militiaBonus(nation, data);
  const dpsFlat = militiaDpsBonus(nation, data);
  const weaponTier = nation.buildings?.tools?.weapon || 0;
  const weaponDps = weaponTier > 0 ? (data.buildings.tools.weapon.tiers[weaponTier - 1].militiaDps || 0) : 0;
  const pool = (nation.villagers || []).filter((u) => u.job === 'defense');
  // ★ 병영이 없어도 수비 배치 주민은 나와 선다 — 다만 쇠스랑을 든 농부다(untrainedRatio).
  //   제대로 싸우는 민병은 병영 정원(militiaSlots)만큼이다. 방어력이 '인구'가 아니라 '투자'를 따라가게 하는
  //   장치이고, 엔드리스 후반에 인구만으로 웨이브를 뭉개지 못하게 하는 안전장치다(GDD3 §6).
  const trainedCount = Math.min(pool.length, slots);
  const untrainedHp = cfg.untrainedHpRatio ?? 0.6;
  const untrainedDps = cfg.untrainedDpsRatio ?? 0.35;
  return pool.map((u, i) => {
    const trained = i < trainedCount;
    /* ★ §13-D-1 — 용기가 버티는 힘을, 힘이 미는 힘을 정한다. 각각 ±18% 안이고 평균은 1.0 이다.
       (민병은 대개 여럿이라, 사람이 늘수록 전투 결과는 옛 값으로 수렴한다 — 시뮬 재보정이 없는 까닭.) */
    const hpF = militiaHpFactor(u, data);
    const dpsF = militiaDpsFactor(u, data);
    return {
      id: u.id,
      name: u.name ?? u.id,
      x: u.x, y: u.y,
      trained,
      stats: u.stats ? { ...u.stats } : null,
      hp: round2(cfg.hp * (trained ? 1 + bonus : untrainedHp) * hpF),
      dps: round2((cfg.dps + weaponDps + dpsFlat) * (trained ? 1 + bonus : untrainedDps) * dpsF),
      range: cfg.rangeTiles,
    };
  });
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
/** 유닛 압축 — 60명까지는 1유닛=1명, 그 위로는 대표 유닛이 여럿을 대신한다 */
export function peoplePerUnit(nation, data) {
  const from = residentCfg(data).unitCompressionFrom;
  const n = (nation.villagers || []).length || 1;
  return n <= from ? 1 : (nation.population || n) / Math.min(n, from);
}

export function housingView(nation, data, world = null) {
  const st = arrivalStatus(nation, data);
  const byKey = {};
  for (const s of nation.structures || []) {
    const spec = data.buildings[s.key]?.tiers?.[s.tier - 1];
    if (!spec?.residents) continue;
    byKey[s.key] = (byKey[s.key] || 0) + spec.residents;
  }
  return {
    population: Math.floor(nation.population || 0),
    capacity: st.capacity,
    freeBeds: st.freeBeds,
    byBuilding: byKey,
    arrival: st,
    /* ★ §13-D-2 — 본부의 [모집] 단추가 이 표로 그려진다(잠긴 까닭도 여기 다 있다).
       ★ 사람이 찾아오는 장(4장) 전에는 필드 자체가 없다 — 단추도 그려지지 않는다(§11-1). */
    ...(featureUnlocked(nation, 'recruit', data)
      ? { recruit: recruitStatus(world ?? { tick: 0 }, nation, data) } : {}),
    departmentsActive: departmentsActive(nation, data),
  };
}

export function residentViews(nation, data, world = null) {
  const names = data.world.villagers.jobNames;
  const per = peoplePerUnit(nation, data);
  return (nation.villagers || []).map((u) => {
    /* ★ §13-A-3 — 이 사람이 하루에 얼마를 버는가. 국고에 적립되는 값과 **같은 함수**가 낸다.
       화면은 이 값을 흐른 시간만큼 쪼개어 "+1.2 목재" 를 띄우므로, 뜬 숫자의 합 = 국고 증가분이다. */
    const node = nodeOfResident(world, u);
    const outdoor = isOutdoorNode(world, nation, node, data);
    const y = residentYield(u, node, data, outdoor);
    ensureStats(u, data);
    const fit = jobFit(u, u.job, data);
    return {
      id: u.id,
      name: u.name ?? u.id,
      appearance: u.appearance ?? null,
      // ★ §13-D-1 — 능력치는 사람의 것이라 언제나 실린다(잠긴 계층이 아니다).
      stats: { ...u.stats },
      statFactors: statsView(u, data),
      fit: { ok: fit.fit, keys: fit.keys, best: fit.best },
      outdoor,
      haul: haulFactor(u, data),
      job: u.job,
      jobName: names[u.job] ?? u.job,
      x: u.x, y: u.y,
      destX: u.destX ?? u.x, destY: u.destY ?? u.y,
      targetId: u.targetId ?? null,
      militia: u.job === 'defense',
      represents: per,
      selectable: true,
      ...(y.kind === 'resource' && y.perDay > 0 && !y.idle
        ? { yield: { resource: y.resource, perDay: y.perDay } } : {}),
    };
  });
}
