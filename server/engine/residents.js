// 주민 — docs/GDD3.md §4. 인구 0에서 시작해 한 명씩 걸어온다.
// ★ 옛 '인구 50 시작 · 이주민 %'는 폐기됐다. 주민은 실인원이다: unitCompressionFrom 명까지 1유닛=1명.
import { townOf, territoryRadius, dist, inTerritory } from './world.js';
// ★ Sprint 3 — 노드 조회는 파생 색인 하나로 모은다(옛 find 는 방송마다 60×5,000 을 두 번 훑었다)
import { nodeById } from './spatial.js';
// ★ §16-18 — 집결지: 갓 도착한 주민을 지정한 일터로 곧장 보낸다
import { rallyResident } from './villagers.js';
import {
  housingCapacity, attractivenessBonus, moraleBonus, militiaSlots, militiaBonus,
  militiaDpsBonus, shrinePopulationCap, hasBuilding, gatherBonus, tierSpec,
} from './structures.js';
import { settlementTier } from './tiers.js';
import { featureUnlocked, departmentsActive } from './progression.js';
import { round2, round3, clamp } from './economy.js';
// ★ GDD3 §14-1 — 실시간 크레딧도 저장 상한(§13-A-5)의 같은 문으로 들어간다.
import { deposit } from './storage.js';
// ★ GDD3 §13-A-1 — 유입 조건도 티어 조건과 **같은 공장**에서 찍는다.
import { resourceReq, countReq } from './requirements.js';
// ★ GDD3 §13-D-1 — 사람마다 다른 네 수치. 평균이 정확히 중립이라 마을 곡선은 그대로다.
import {
  rollStats, statRng, ensureStats, yieldFactor, militiaHpFactor, militiaDpsFactor, haulFactor,
  statsView, jobFit,
} from './traits.js';
// ★ §17-15 — 역할 개성. 농정관은 주민 채집을, 국방대신은 민병의 칼끝을 벼린다.
import { rolePerk } from './npc.js';
// ★ Sprint 1 — 새 사람이 호수 한복판에서 태어나지 않게. 통행 정본은 path.js 다.
import { nearestWalkable } from './path.js';
// ★ Sprint 4 — 연구 채집 보정(농정술·석공술). 형편 배수에 함께 얹는다.
import { gatherResearchBonus } from './research.js';

export const residentCfg = (data) => data.balance.residents;
export const arrivalCfg = (data) => data.balance.residents.arrival;
export const gatherCfg = (data) => data.balance.residents.gather;

// ────────────────────────────────────────────────────────────────
// 수용력 · 매력도
// ────────────────────────────────────────────────────────────────
/** 주거 수용력 = 주거 건물 합(천막1/오두막2/가옥4/저택6 …). 성지가 있으면 그 상한에도 걸린다. */
export function capacity(nation, data) {
  // ★ §20-R1 — 유물 몫(tick.js 가 매 틱 채우는 거울). 성지 상한과 잠자리 **양쪽**에 함께 얹는다:
  //   한쪽에만 얹으면 성지가 선 나라에서 왕관의 조각이 아무 일도 하지 않는다.
  const extra = nation.artifactCapDelta || 0;
  const beds = housingCapacity(nation, data) + extra;
  const shrineCap = shrinePopulationCap(nation, data);
  return shrineCap > 0 ? Math.min(beds, shrineCap + extra) : beds;
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
  /* ★ §20-R4(유물기획 §20-3 죽음의 낫) — 유물이 얹는 유입 배수(tick.js 가 박는 거울).
     「왜」 주기가 아니라 **매력도**에 곱하나 — 주기는 매력도로 나눈 값이라(arrivalIntervalDays)
     여기 0.75 를 곱하면 주기가 정확히 4/3 배로 늘어난다 = 유입 −25%. 부호가 저절로 맞는다.
     또 매력도는 화면에도 나가는 값이라, 「왜 사람이 덜 오지」의 답이 한 자리에 모인다.
     유물이 없으면 1 이라 곱해도 옛 값 그대로다. */
  const inflow = nation.artifactPopInflow ?? 1;
  return clamp((1 + surplus + decor + morale) * inflow, 0.2, cfg.attractivenessMax);
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
  let from = {
    x: Math.max(0, Math.min(data.world.size - 1, Math.round((town?.x ?? 0) + Math.cos(angle) * r))),
    y: Math.max(0, Math.min(data.world.size - 1, Math.round((town?.y ?? 0) + Math.sin(angle) * r))),
  };
  /* ★ Sprint 1 — 뽑힌 자리가 물이면 곁의 뭍에서 걸어 들어온다. 물 위 스폰은
     「주민이 물 위를 걷는다」의 세 갈래 중 하나였다(스폰·목적지·걸음). */
  from = nearestWalkable(world, nation, data, from.x, from.y, 24)
    ?? (town ? { x: town.x, y: town.y } : from);
  // ★ §세계관 W2 — 첫 이민자는 순례자 세라다(세계관기획 §5 — 성녀 후보이자 이야기의 화자).
  //   이름만 정본으로 고정하고 능력치·외형은 여느 사람과 같은 규칙을 따른다(결정론 유지).
  const isFirst = nation.isPlayer && (nation.villagers?.length ?? 0) === 0;
  const resident = {
    id: `r${nation.nextResidentId++}`,
    name: isFirst ? '세라' : pickName(rng, data),
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
  /* ★ §16-18 — 집결지가 꽂혀 있으면 새 사람은 그 일터로 곧장 간다(없거나 차 있으면 여느 때처럼) */
  rallyResident(world, nation, resident, data);
  return resident;
}

/**
 * ★ §17-6 — 집들이(피드백: "주민 도착이 너무 길다 — 오두막 지으면 한 명 오게").
 * 잠자리 건물이 **완공되는 순간** 빈 침상이 있으면 한 사람이 곧장 들어온다.
 * 자연 유입(stepArrivals)과 별개의 문이고, 난수는 세계 난수를 축내지 않는 statRng 를 쓴다.
 * @returns {object|null} 들어온 주민(없으면 null)
 */
export function housewarmArrival(world, nation, s, data) {
  const cfg = arrivalCfg(data);
  if (!cfg.onHousingComplete) return null;
  const beds = tierSpec(s.key, s.tier ?? 1, data)?.residents || 0;
  if (beds <= 0) return null;
  if (freeBeds(nation, data) <= 0) return null;
  const rng = statRng(`${world.seed}:${nation.id}:housewarm:${s.id}:${s.tier ?? 1}`);
  return spawnResident(world, nation, data, rng);
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
/**
 * ★ §16-8 — **마을의 형편**이 주민의 손에 얹히는 배수.
 * 피드백: "주민 산출이 영지 승격·건물·사기의 영향을 받으면 좋겠다."
 *   · 티어 — 정착지가 격을 올리면 연장과 요령이 좋아진다(+tierBonusPerLevel/티어)
 *   · 사기 — 부처 산출(콥더글러스 M)과 같은 방향으로, 다만 폭은 절반쯤(±moraleWeight)
 *   · 건물 — 플레이어 스윙에만 붙던 채집 보너스(gatherBonus — 제재소·채석장 등)가 주민에게도 붙는다
 * 셋 다 nation 만으로 계산되므로 뷰(world 없음)에서도 같은 값이 나온다(§13-A-3 의 약속 유지).
 */
export function settlementGatherFactor(nation, data, resource = null) {
  const cfg = gatherCfg(data);
  const tier = 1 + settlementTier(nation) * (cfg.tierBonusPerLevel ?? 0.05);
  const m = data.balance.morale;
  /* ★ 사기는 **하루 단위 스냅샷**(gatherMorale — 일 틱이 정산 직전에 찍는다)을 쓴다.
     실시간 값이 틱 도중에 흔들리면 「뜬 숫자의 합 = 국고 증가분」(§13-A-3)이 깨진다. */
  const morale0 = nation.gatherMorale ?? nation.morale ?? m.default ?? 1;
  const ratio = clamp((morale0 - (m.default ?? 1)) / Math.max(0.001, (m.max ?? 1.25) - (m.default ?? 1)), -1, 1);
  const morale = 1 + ratio * (cfg.moraleWeight ?? 0.12);
  const building = resource ? 1 + gatherBonus(nation, resource, data) : 1;
  /* ★ Sprint 4 — 연구 채집 보정(농정술·석공술). 3티어+ 매크로(tick.produceNation)와
     같은 함수의 같은 값이 붙는다 — 두 층이 다른 답을 내면 티어 진입 순간 산출이 튄다. */
  const research = resource ? 1 + gatherResearchBonus(nation, data, resource) : 1;
  /* ★ §17-15 — 농정관 개성. 자리가 채워져 있으면 주민의 손이 10% 더 거둔다(공석이면 1). */
  return round3(tier * morale * building * research * rolePerk(nation, 'farm', 'residentGatherMultiplier', data));
}

export function residentYield(u, node, data, outdoor = false, nation = null) {
  const cfg = gatherCfg(data);
  if (!u) return { kind: 'none', perDay: 0 };
  const factor = yieldFactor(u, data, Boolean(outdoor));
  if (u.job === 'idle') return { kind: 'resource', resource: 'grain', perDay: cfg.idleGrainPerDay, idle: true, factor: 1 };
  /* ★ §16-8 — 마을의 형편(티어·사기·건물)이 얹힌다. nation 이 없으면 1 (옛 호출과 호환) */
  const town = (res) => (nation ? settlementGatherFactor(nation, data, res) : 1);
  if (u.job === 'build') {
    return { kind: 'buildPoints', perDay: round2(cfg.buildPointsPerResidentPerDay * factor * town(null)), factor };
  }
  const res = JOB_RESOURCE[u.job];
  if (!res) return { kind: 'none', perDay: 0 };
  if (node && node.type === 'oil') {
    return { kind: 'resource', resource: 'oil', perDay: round2(cfg.perResidentPerDay.oil * factor * town('oil')), factor };
  }
  // ★ §13-D-5 — 석탄. 「석탄 채굴」 연구가 열기 전에는 이런 자리가 없으므로 이 갈래도 닿지 않는다.
  if (node && node.type === 'coal') {
    return { kind: 'resource', resource: 'coal', perDay: round2((cfg.perResidentPerDay.coal ?? cfg.perResidentPerDay.ironOre) * factor * town('coal')), factor };
  }
  let amount = cfg.perResidentPerDay[res] || 0;
  if (!node) amount *= 0.5;                         // 일자리(건물)에 붙어 있으면 절반
  else if (node.depleted) amount = 0;
  else if (node.rich) amount *= cfg.richMultiplier;
  if (node && node.type === 'iron') amount = cfg.perResidentPerDay.ironOre;
  return { kind: 'resource', resource: res, perDay: round2(amount * factor * town(res)), factor };
}

/**
 * 이 자리가 영토 밖인가 — 산출 표시(뷰)와 국고 적립(일 틱)이 **같은 답**을 써야 한다.
 * 그러지 않으면 「뜬 숫자의 합 = 국고 증가분」이 깨진다(§13-A-3 의 약속).
 */
export function isOutdoorNode(world, nation, node, data) {
  if (!node || !world || !nation) return false;
  return !inTerritory(world, nation, node.x, node.y, data);
}

/**
 * 주민이 지금 붙어 있는 노드 (건물 일자리면 null).
 * ★ Sprint 3 — 옛 구현은 `nodes.find(...)` 였다. residentViews 가 사람마다 부르고, 그 뷰가
 *   state 와 worldDiff 두 곳에서 다시 만들어지므로 방송 한 번에 60×5,000×2 번을 훑었다.
 */
export const nodeOfResident = (world, u) =>
  (u?.targetId ? nodeById(world, u.targetId) : null) || null;

/**
 * 주민 개별 노동 산출(하루). 노드에 붙은 주민만 낸다.
 * ★ §13-A-3 — 합산만 한다. 한 사람 몫은 residentYield 가 정본이다.
 * @returns {{resources:{}, buildPoints:number, workers:number}}
 */
export function residentGather(world, nation, data) {
  const out = { resources: {}, buildPoints: 0, workers: 0 };
  /* ★ Sprint 3 — 부를 때마다 노드 5,000개로 Map 을 새로 짓던 자리. 이제 파생 색인을 그대로 본다. */
  for (const u of nation.villagers || []) {
    const node = u.targetId ? nodeById(world, u.targetId) : null;
    const y = residentYield(u, node, data, isOutdoorNode(world, nation, node, data), nation);
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
// ★ GDD3 §14-1 — 작업 사이클 즉시 크레딧
//
// 실측이 먼저였다(harness 계측, 씨앗 20260804 · 벌목 3명):
//   · 화면의 첫 숫자가 뜨기까지 **154.4초**, 그다음은 157.6초 뒤. 자루 하나(perDay÷4)를 채우는 데
//     드는 시간이 언제나 하루길이÷4 = 150초였기 때문이다(자원 종류와 무관).
//   · 국고(nation.resources.wood)는 그 15분 내내 **0.00** 이었다 — 일 틱(600초)에만 올랐다.
//   즉 아무것도 고장 나지 않았다. 박자가 사람이 알아볼 수 없을 만큼 느렸을 뿐이다.
//
// 고친 규칙:
//   · 사이클 길이 = 하루길이 ÷ cyclesPerDay (기본 30 → 20초). 사이클마다 perDay÷cyclesPerDay 를
//     **그 자리에서** 국고에 넣고 같은 값을 그 사람 자리에 띄운다.
//   · 사람마다 사이클 위상을 어긋나게 뿌린다(phaseJitter) — 안 그러면 셋이 동시에 터져
//     "20초에 세 개, 그다음 20초는 정적"이 된다(옛 계측의 「0.0, 0.0, 157.6」이 바로 그 모습이다).
//   · **하루 합계 동일성**: 사람마다 `workCredited` 에 이번 하루에 이미 받은 몫을 적어 두고,
//     일 틱은 `perDay − workCredited` 만 채운다(residentSettle). 그래서 옛 산출식과 한 톨도 다르지 않다.
//   · 저장 상한(§13-A-5)은 그대로다 — 넣는 문은 여전히 storage.deposit 하나뿐이다.
// ────────────────────────────────────────────────────────────────
export const workCfg = (data) => data.world.villagers.work ?? {};

/** 한 작업 사이클의 길이(실시간 초) */
export function workCycleSeconds(data) {
  const cycles = Math.max(1, workCfg(data).cyclesPerDay ?? 30);
  return (data.balance.time.dayRealSeconds ?? 600) / cycles;
}

/** 사람마다 다른 시작 위상 — id 에서 뽑는다(난수를 축내지 않는다) */
function phaseOf(u, data) {
  const jitter = workCfg(data).phaseJitter ?? 0;
  if (!(jitter > 0)) return 0;
  let h = 2166136261;
  for (const ch of String(u.id || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000 * jitter;
}

/**
 * 이 사람의 노동 장부(하루 단위로 비워진다).
 *   · produced — 이번 하루에 **낸** 몫. 하루 산출을 넘겨 주지 않게 막는 뚜껑이다.
 *   · credited — 이번 하루에 **곳간에 실제로 들어간** 몫. 일 틱이 나머지를 채울 때 쓰는 값이다.
 * 둘을 가른 까닭: 곳간이 차 있으면 낸 것과 들어간 것이 다르다(§13-A-5 는 넘치는 몫을 버린다).
 * 또 storage.deposit 은 소수 둘째 자리에서 끊으므로, 잘려 나간 먼지를 일 틱이 마저 갚아야
 * 하루 합계가 옛 산출식과 정확히 같아진다(실측: 이 구분이 없으면 오차 2.4%).
 */
export function ensureWork(u, data) {
  const w = (u.work ||= {});
  if (w.acc == null) w.acc = phaseOf(u, data);
  w.produced ||= {};
  w.credited ||= {};
  return w;
}

/**
 * 실시간 저빈도 루프의 한 걸음. 생태계 1초 루프에 편승한다(§14-1).
 * @param {number} dt 초
 * @returns {{credits:Array<{id,name,x,y,resource,amount}>, resources:Object}}
 *          credits — 이번에 실제로 국고에 들어간 사이클들(화면이 이 자리에 수치를 띄운다)
 */
export function stepResidentWork(world, nation, data, dt = 1) {
  const out = { credits: [], resources: {} };
  if (!(dt > 0) || !nation?.isPlayer) return out;
  const cycles = Math.max(1, workCfg(data).cyclesPerDay ?? 30);
  const cycleSec = workCycleSeconds(data);
  /* ★ Sprint 3 — 1초 루프가 매 걸음 노드 5,000개로 Map 을 새로 짓고 있었다(초당 5,000회 삽입).
     파생 색인은 노드가 늘거나 줄 때만 다시 지어지므로, 여느 걸음에서는 조회 값이 공짜다. */
  for (const u of nation.villagers || []) {
    const node = u.targetId ? nodeById(world, u.targetId) : null;
    const y = residentYield(u, node, data, isOutdoorNode(world, nation, node, data), nation);
    // 노는 사람·수비·공사는 실시간으로 적립하지 않는다 — 일 틱이 통째로 맡는다(합계는 그대로다).
    if (y.kind !== 'resource' || y.idle || !(y.perDay > 0)) continue;
    const w = ensureWork(u, data);
    w.acc += dt / cycleSec;
    let guard = 0;
    while (w.acc >= 1 && guard++ < 8) {
      w.acc -= 1;
      const share = y.perDay / cycles;
      const made = w.produced[y.resource] || 0;
      // 하루 몫을 넘겨 주지 않는다 — 이 뚜껑이 「일 합계 동일성」의 마지막 자물쇠다
      const want = Math.min(share, Math.max(0, y.perDay - made));
      if (!(want > 0)) break;
      w.produced[y.resource] = round3(made + want);
      const got = deposit(nation, y.resource, want, data);
      w.credited[y.resource] = round3((w.credited[y.resource] || 0) + got);
      out.resources[y.resource] = round3((out.resources[y.resource] || 0) + got);
      out.credits.push({
        id: u.id, name: u.name ?? u.id,
        x: u.x, y: u.y,
        resource: y.resource, amount: round3(want), stored: round3(got),
      });
    }
  }
  return out;
}

/**
 * 노동 장부를 비운다 — 하루가 바뀌었으니 다시 하루치를 낼 수 있다.
 * ★ 이 함수를 가른 까닭 — 옛 코드는 장부를 residentSettle **안에서만** 비웠고,
 *   residentSettle 은 부처가 안 도는 티어 0~2 에서만 불렸다. 그래서 3티어에 오르는 순간
 *   장부가 영영 안 비워졌고, 사람마다 하루치(y.perDay)를 한 번 채우고 나면 want 가 0 이 되어
 *   **실시간 채집이 통째로 멎었다**(걷는 연출만 남고 곳간은 한 톨도 안 올랐다).
 */
export function clearWorkLedgers(nation) {
  for (const u of nation.villagers || []) {
    if (!u.work) continue;
    u.work.credited = {};
    u.work.produced = {};
  }
}

/**
 * 일 틱 정산 — 하루 산출에서 **이미 실시간으로 준 몫**을 뺀 나머지.
 * 아무도 안 보고 있어 실시간 루프가 멎어 있었다면 credited 가 비어 있으므로 residentGather 와 같다.
 * @returns {{resources:{}, buildPoints:number, workers:number, gross:{}, prepaid:{}}}
 */
export function residentSettle(world, nation, data) {
  const gross = residentGather(world, nation, data);
  const prepaid = {};
  for (const u of nation.villagers || []) {
    const c = u.work?.credited;
    if (!c) continue;
    for (const [res, v] of Object.entries(c)) prepaid[res] = round3((prepaid[res] || 0) + v);
  }
  clearWorkLedgers(nation);

  const resources = {};
  for (const [res, v] of Object.entries(gross.resources)) {
    const owed = round2(Math.max(0, v - (prepaid[res] || 0)));
    if (owed > 0) resources[res] = owed;
  }
  return { resources, buildPoints: gross.buildPoints, workers: gross.workers, gross: gross.resources, prepaid };
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
      /* ★ §17-15 — 국방대신 개성. 자리가 채워져 있으면 민병의 공격이 15% 는다(공석이면 1). */
      dps: round2((cfg.dps + weaponDps + dpsFlat) * (trained ? 1 + bonus : untrainedDps) * dpsF
        * rolePerk(nation, 'defense', 'militiaDpsMultiplier', data)),
      range: cfg.rangeTiles,
    };
  });
}

// ────────────────────────────────────────────────────────────────
// 뷰
// ────────────────────────────────────────────────────────────────
/** 유닛 압축 — 80명까지는 1유닛=1명, 그 위로는 대표 유닛이 여럿을 대신한다 */
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
    const y = residentYield(u, node, data, outdoor, nation);
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
