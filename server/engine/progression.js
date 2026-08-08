// 진행 감독(Progression Director) — docs/GDD3.md §11. 이 파일이 게임의 모든 문을 쥔다.
//
// ★ 대원칙: **시간은 아무것도 열지 않는다.**
//   감정의 날·어전 회의·조언·무역 오퍼·유물·웨이브 예고 — 전부 '그 장이 열린 뒤'에만 존재한다.
//   장을 여는 것은 언제나 플레이어의 행동(스윙·건설·발동)이고, 게임일이 몇 번 지났는지는 조건에 들어가지 않는다.
//
// ★ 단일 관장: 예전에는 해금이 세 군데(티어표 unlocks · 건물 requiresTier · 기능별 하드코딩)에 흩어져 있었다.
//   지금은 여기 하나다. tiers.js 는 반경·작업 속도·승격 연출만 맡고, 해금 목록은 **마지막 장(엔드리스)에 들어선 뒤에만**
//   이 모듈이 합류시킨다. 그래서 "인구가 빨리 늘어 티어 3이 되는 바람에 무역이 먼저 열리는" 새치기가 원천 봉쇄된다.
//
// ★ 국가 단위: 장 상태는 nation.progress 에 산다 — 같은 정착지에 접속한 사람은 같은 장을 함께 본다(멀티 공유).
import { townOf, dist, terrainNameAt } from './world.js';
import { tierUnlockedList, settlementTier } from './tiers.js';
// ★ GDD3 §13-A-1 — 목표 카드의 have 도 조건 행과 같은 계측기를 쓴다.
import { haveResource, haveStructures, havePopulation } from './requirements.js';
// ★ §21-C1 — 장이 열릴 때 흔적의 링도 한 겹 자란다(onChapterOpen 이 유일한 문).
import { growTrailsFor } from './trails.js';

export const chaptersCfg = (data) => data.chapters;
export const chapterList = (data) => data.chapters.chapters;

const EMPTY = { buildings: [], features: [], ui: [], commands: [] };

/** 명령 별칭 — 같은 문 하나로 묶어 잠근다 */
const COMMAND_ALIAS = {
  placeTurret: 'placeBuilding',
  buildStart: 'placeBuilding',
};

// ────────────────────────────────────────────────────────────────
// 상태
// ────────────────────────────────────────────────────────────────
/** nation.progress 를 보장한다(구스냅샷 이관 포함) */
export function ensureProgress(nation) {
  const p = (nation.progress ||= {});
  p.chapter ??= 1;
  p.step ??= 0;
  p.cleared ||= [];
  p.flags ||= {};
  p.trace ??= null;
  p.log ||= [];
  /* ★ §21-C2 — 끝없는 장의 매듭. cycle 은 지금까지 지은 매듭 수, mark 는 **이번 매듭이 시작될 때의
     눈금**이다. 옛 세이브에는 둘 다 없다 — null 로 두고 evaluateProgress 가 그 자리에서 찍는다
     (시간이 아니라 '끝없는 장에 서 있다'는 사실이 눈금을 만든다). */
  p.cycle ??= 0;
  p.mark ??= null;
  return p;
}

export function chapterDef(id, data) {
  return chapterList(data).find((c) => c.id === id) ?? null;
}

/** 지금 열려 있는 장 (플레이어 국가 전용 개념) */
export function currentChapter(nation, data) {
  return chapterDef(ensureProgress(nation).chapter, data) ?? chapterList(data)[0];
}

export function chapterIndex(nation) {
  return ensureProgress(nation).chapter;
}

/** 마지막 장(엔드리스)에 들어섰는가 — 이때부터 티어 해금이 합류한다 */
export function inEndless(nation, data) {
  const def = currentChapter(nation, data);
  return Boolean(def?.endless);
}

// ────────────────────────────────────────────────────────────────
// 해금 — 전부 파생값이다(저장하지 않는다). 자료 파일을 고치면 그 자리에서 반영된다.
// ────────────────────────────────────────────────────────────────
function mergeInto(acc, opens) {
  if (!opens) return acc;
  for (const k of ['buildings', 'features', 'ui', 'commands']) {
    for (const v of opens[k] || []) acc[k].add(v);
  }
  return acc;
}

/**
 * 지금까지 열린 것 전부.
 * 규칙(하나뿐이다):
 *   ① 현재 장까지의 `opens`
 *   ② 이미 지나온 장의 `reward.opens`
 *   ③ 통과한 칸(step)의 `opens`
 *   ④ **엔드리스 장에 들어선 뒤에만** 티어 해금 합류
 */
/**
 * ★ Sprint 3 — 해금 목록 메모 (declaredCommands 가 이미 쓰던 것과 같은 규칙의 캐시).
 *
 * 왜. buildingUnlocked·featureUnlocked·commandUnlocked 가 전부 이 함수를 부르고, NationView 한 장을
 * 빚는 데만 76번 넘게 지난다. 그때마다 열 장을 처음부터 훑고 Set 넷을 새로 짓고 배열 넷을 뽑았다.
 *
 * 무효화 열쇠. 이 함수의 답을 바꾸는 것은 **네 가지뿐**이다 — 지금 장 · 지금 칸 · 통과한 칸의 수
 * (cleared 는 늘기만 한다) · 정착지 티어(엔드리스에 들어선 뒤 티어 해금이 합류한다).
 * 자료판(data)이 통째로 갈릴 수도 있으므로 그 신원도 함께 본다(테스트가 reload 로 바꿔 낀다).
 * 캐시는 nation 에 매달린 WeakMap 이라 저장되지 않고, 일 틱의 복제가 새 nation 을 내면 저절로 새로 난다.
 * @type {WeakMap<object, {key:string, data:object, value:object}>}
 */
const UNLOCK_CACHE = new WeakMap();

const unlockKey = (nation, p) =>
  `${p ? `${p.chapter}:${p.step}:${p.cleared.length}` : '-'}:${settlementTier(nation)}`;

export function unlockedList(nation, data) {
  if (!nation?.isPlayer) return tierUnlockedList(nation, data);
  const p = ensureProgress(nation);
  const key = unlockKey(nation, p);
  const hit = UNLOCK_CACHE.get(nation);
  if (hit && hit.key === key && hit.data === data) return hit.value;
  const value = computeUnlocked(nation, p, data);
  UNLOCK_CACHE.set(nation, { key, data, value });
  return value;
}

/** 실제 셈 — unlockedList 의 규칙 ①~④ 가 여기에 그대로 산다 */
function computeUnlocked(nation, p, data) {
  const acc = { buildings: new Set(), features: new Set(), ui: new Set(), commands: new Set() };
  const cleared = new Set(p.cleared);
  for (const ch of chapterList(data)) {
    if (ch.id > p.chapter) break;
    mergeInto(acc, ch.opens);
    if (ch.id < p.chapter) mergeInto(acc, ch.reward?.opens);
    for (const st of ch.steps || []) {
      if (cleared.has(stepKey(ch, st))) mergeInto(acc, st.opens);
    }
  }
  if (inEndless(nation, data)) {
    const t = tierUnlockedList(nation, data);
    mergeInto(acc, t);
  }
  return {
    buildings: [...acc.buildings],
    features: [...acc.features],
    ui: [...acc.ui],
    commands: [...acc.commands],
  };
}

export function featureUnlocked(nation, feature, data) {
  if (!nation?.isPlayer) return true;                 // AI 3국은 이미 자리 잡은 나라다
  return unlockedList(nation, data).features.includes(feature);
}

/** 건물 해금 — ★ requiresTier 가 아니라 '지금 장'이 정본이다 */
export function buildingUnlocked(nation, key, data) {
  const def = data.buildings[key];
  if (!def || !def.tiers) return false;
  if (!nation?.isPlayer) return settlementTier(nation) >= (def.requiresTier ?? 0);
  return unlockedList(nation, data).buildings.includes(key);
}

/**
 * 명령 해금 — chapters.json 의 `commands` 에 한 번이라도 적힌 명령은 그 장이 열려야 받는다.
 * 어디에도 안 적힌 명령(이동·채팅 등 언제나 되는 것)은 그냥 통과한다 — '선언된 문'만 잠근다.
 */
let declaredCommandsCache = null;
export function declaredCommands(data) {
  if (declaredCommandsCache) return declaredCommandsCache;
  const s = new Set();
  for (const ch of chapterList(data)) {
    for (const c of ch.opens?.commands || []) s.add(c);
    for (const c of ch.reward?.opens?.commands || []) s.add(c);
    for (const st of ch.steps || []) for (const c of st.opens?.commands || []) s.add(c);
  }
  declaredCommandsCache = s;
  return s;
}

export function commandUnlocked(nation, type, data) {
  if (!nation?.isPlayer) return true;
  const key = COMMAND_ALIAS[type] ?? type;
  if (!declaredCommands(data).has(key)) return true;
  return unlockedList(nation, data).commands.includes(key);
}

/** 부처(콥더글러스)·각료가 도는가 — 감정의 날(6장) 뒤에만 */
export function departmentsActive(nation, data) {
  if (!nation?.isPlayer) return settlementTier(nation) >= (data.balance.production.departmentsFromTier ?? 3);
  return featureUnlocked(nation, 'departments', data);
}

// ────────────────────────────────────────────────────────────────
// 조건 판정
// ────────────────────────────────────────────────────────────────
const stepKey = (ch, st) => `${ch.id}:${st.key}`;

const structureCount = haveStructures;

/**
 * 이 나라 **사람들**이 그 솜씨로 휘두른 횟수.
 * ★ GDD3 §15-C — 동료 봇(p.bot)의 팔은 세지 않는다. 「나무를 세 번 베어 보세요」는
 *   손으로 해 보라는 말이지 곳간을 채우라는 말이 아니다. 동료가 대신 두드려 칸이 넘어가면
 *   안내가 스스로 사라지고 사람은 무엇을 배웠는지 모른 채 다음 장에 선다.
 *   (곳간을 채우는 자원 조건은 그대로 함께 센다 — 창고는 나라 공용이기 때문이다.)
 */
function totalSwings(nation, skill) {
  let n = 0;
  for (const p of Object.values(nation.players || {})) {
    if (p.bot) continue;
    n += (p.stats?.swingsBySkill?.[skill] ?? 0);
  }
  return n;
}

/**
 * ★ §21-C2 — 이 매듭에 들어와서 얼마나.
 *
 * 왜. 끝없는 장의 순환 목표를 「지금까지 겪은 무리 20회」처럼 절대값으로 적으면, 매듭을 지을 때마다
 * 숫자를 어디서부터 세는지 사람이 알 수 없고 첫 매듭은 들어서자마자 저절로 채워져 있다.
 * 눈금(mark)을 빼고 나면 카드에 「2/2 무리」가 그대로 남는다 — 이번 매듭에 한 일만.
 * since 가 없는 옛 칸(1~9장)은 한 톨도 달라지지 않는다.
 */
function sinceMark(nation, cond, have, key) {
  if (!cond.since) return have;
  const m = ensureProgress(nation).mark;
  return Math.max(0, have - (m?.[key] ?? 0));
}

/** 매듭이 거듭될수록 높아지는 문턱 — growMax 가 천장이다(없으면 언젠가 못 짓는 매듭이 온다) */
function needOf(nation, cond, base) {
  const grow = cond.grow ?? 0;
  if (!grow) return base;
  const add = grow * (ensureProgress(nation).cycle ?? 0);
  return base + Math.min(add, cond.growMax ?? add);
}

/**
 * 조건 하나를 재어 {ok, have, need} 로 돌려준다.
 * 목표 카드의 진행바가 이 값을 그대로 쓴다.
 */
export function measure(world, nation, cond, data) {
  if (!cond) return { ok: true, have: 1, need: 1 };
  switch (cond.type) {
    case 'swings': {
      const have = totalSwings(nation, cond.skill);
      return { ok: have >= cond.count, have, need: cond.count };
    }
    case 'resource': {
      const have = Math.floor(haveResource(nation, cond.resource));
      return { ok: have >= cond.amount, have, need: cond.amount };
    }
    case 'structure': {
      const have = haveStructures(nation, cond.building);
      return { ok: have >= (cond.count ?? 1), have, need: cond.count ?? 1 };
    }
    case 'population': {
      const have = sinceMark(nation, cond, havePopulation(nation), 'population');
      const need = needOf(nation, cond, cond.count);
      return { ok: have >= need, have, need };
    }
    case 'fenceSegments': {
      const have = (nation.fences || []).length;
      return { ok: have >= cond.count, have, need: cond.count };
    }
    case 'wavesHeld': {
      const won = (nation.wave?.history || []).filter((h) => h.won).length;
      const have = sinceMark(nation, cond, won, 'wavesHeld');
      const need = needOf(nation, cond, cond.count);
      return { ok: have >= need, have, need };
    }
    /* ★ §19-E(F04-5) — 「겪은 무리」. 이긴 것만 세면, 첫 무리를 못 막은 사람은 영원히 7장에 갇힌다.
       졌으면 곳간을 헤집히고 건물이 상하는 **벌은 이미 받았다**(battle.js 전리품·구조물 피해).
       그 위에 '장을 못 넘긴다'를 얹을 까닭이 없다 — 두 번째 무리를 겪으면 이야기는 흐른다. */
    case 'wavesFaced': {
      const faced = (nation.wave?.history || []).length;
      const have = sinceMark(nation, cond, faced, 'wavesFaced');
      const need = needOf(nation, cond, cond.count);
      return { ok: have >= need, have, need };
    }
    case 'tier': {
      const have = settlementTier(nation);
      return { ok: have >= cond.tier, have, need: cond.tier };
    }
    case 'flag': {
      const have = ensureProgress(nation).flags[cond.flag] ? 1 : 0;
      return { ok: have === 1, have, need: 1 };
    }
    case 'all': {
      const parts = (cond.of || []).map((c) => measure(world, nation, c, data));
      const done = parts.filter((p) => p.ok).length;
      return { ok: parts.every((p) => p.ok), have: done, need: parts.length, parts };
    }
    case 'any': {
      const parts = (cond.of || []).map((c) => measure(world, nation, c, data));
      const best = parts.reduce((a, b) => (b.have / Math.max(1, b.need) > a.have / Math.max(1, a.need) ? b : a), parts[0] ?? { have: 0, need: 1 });
      return { ok: parts.some((p) => p.ok), have: best.have, need: best.need, parts };
    }
    default:
      return { ok: false, have: 0, need: 1 };
  }
}

// ────────────────────────────────────────────────────────────────
// ★ §21-C2 매듭 — 끝없는 장의 순환 목표
//
// 왜 필요했나. 마지막 장(ch10 엔드리스)은 steps 가 비어 있어서, 들어서는 순간 목표 카드가
// **영원히 공백**이 되었다. 「뭘 해야 할지 모르는 순간 제로」(§13-A)가 게임의 마지막 국면에서만
// 깨져 있던 셈이다. 그렇다고 장을 하나 더 붙이면 '끝없는'이 아니게 된다 — 그래서 칸을 다 지나면
// 장을 넘기는 대신 **매듭 하나를 짓고 첫 칸으로 돌아온다**. 매듭 수가 곧 그 나라의 위신 기록이다.
// ────────────────────────────────────────────────────────────────
/** 이번 매듭의 눈금 — 여기서부터 센다 */
function markEndless(nation, p) {
  p.mark = {
    population: havePopulation(nation),
    wavesFaced: (nation.wave?.history || []).length,
    wavesHeld: (nation.wave?.history || []).filter((h) => h.won).length,
  };
}

/** 순환 장에 서 있는데 눈금이 없으면 그 자리에서 찍는다(옛 세이브 이관) */
function markEndlessIfNeeded(nation, p, data) {
  if (p.mark) return;
  if (!chapterDef(p.chapter, data)?.cycle) return;
  markEndless(nation, p);
}

/** 매듭 하나 — 눈금을 다시 찍고 첫 칸으로. 카드는 없다(매듭마다 모달이 뜨면 잔소리가 된다) */
function tieKnot(nation, p, ch) {
  p.cycle = (p.cycle ?? 0) + 1;
  p.step = 0;
  markEndless(nation, p);
  const line = ch.reward?.line ?? null;
  return {
    kind: 'chapter_done', nationId: nation.id,
    data: { id: ch.id, key: ch.key, name: ch.name, cycle: p.cycle, line,
            fanfare: ch.reward?.fanfare ?? null, card: null, opened: null, openCouncil: false },
  };
}

// ────────────────────────────────────────────────────────────────
// 진행 — 이 함수가 장을 넘긴다. 시간은 인자로도 받지 않는다.
// ────────────────────────────────────────────────────────────────
/**
 * 조건을 다시 재고, 통과한 칸·장을 넘긴다.
 * @returns {Array} 이벤트 목록 (`step_done` · `chapter_done` · `chapter_open`)
 */
export function evaluateProgress(world, nation, data) {
  if (!nation?.isPlayer) return [];
  const p = ensureProgress(nation);
  const out = [];
  let guard = 0;
  markEndlessIfNeeded(nation, p, data);
  while (guard++ < 32) {
    const ch = chapterDef(p.chapter, data);
    if (!ch) break;
    const steps = ch.steps || [];
    if (p.step >= steps.length) {
      // 장 완료 — 보상 연출 + 다음 장
      const next = chapterDef(ch.id + 1, data);
      if (!next) {
        // ★ §21-C2 — 다음 장이 없다. 순환 장이면 매듭을 짓고 첫 칸으로 돌아온다.
        if (!ch.cycle || !steps.length) break;
        out.push(tieKnot(nation, p, ch));
        continue;
      }
      out.push({
        kind: 'chapter_done', nationId: nation.id,
        data: {
          id: ch.id, key: ch.key, name: ch.name,
          line: ch.reward?.line ?? null,
          fanfare: ch.reward?.fanfare ?? null,
          card: ch.reward?.card ?? null,
          opened: summarizeOpens(ch.reward?.opens, data),
          openCouncil: Boolean(ch.reward?.openCouncil),
        },
      });
      p.chapter = next.id;
      p.step = 0;
      onChapterOpen(world, nation, next, data);
      out.push({
        kind: 'chapter_open', nationId: nation.id,
        data: {
          id: next.id, key: next.key, name: next.name, subtitle: next.subtitle ?? null,
          opened: summarizeOpens(next.opens, data),
        },
      });
      continue;
    }
    const st = steps[p.step];
    const m = measure(world, nation, st.condition, data);
    if (!m.ok) break;
    const key = stepKey(ch, st);
    if (!p.cleared.includes(key)) p.cleared.push(key);
    p.step += 1;
    out.push({
      kind: 'step_done', nationId: nation.id,
      data: { chapter: ch.id, step: st.key, title: st.title, opened: summarizeOpens(st.opens, data) },
    });
  }
  return out;
}

function summarizeOpens(opens, data) {
  if (!opens) return null;
  const b = (opens.buildings || []).map((k) => ({ key: k, name: data.buildings[k]?.name ?? k }));
  return {
    buildings: b,
    features: [...(opens.features || [])],
    ui: [...(opens.ui || [])],
  };
}

/** 장이 열릴 때 딱 한 번 — 그 장이 필요로 하는 월드 준비 */
function onChapterOpen(world, nation, ch, data) {
  if (ch.key === 'strange_tracks') placeTrace(world, nation, data);
  /* ★ §21-C1 — 장이 열리면 세계도 한 겹 자란다(data/trails.json rings[].openAtChapter).
     「이제 저기까지 갈 수 있다」와 「저기에 뭔가 있다」는 같은 순간에 와야 한다. 규칙은 이 한 줄뿐이고
     어느 장이 어느 링을 여는지는 자료가 쥔다 — 코드에 장 번호를 적지 않는다. */
  if (nation.isPlayer) growTrailsFor(world, data, ch.id);
  /* ★ §21-C2 — 순환 장에 들어선 그 순간이 첫 매듭의 눈금이다. 여기서 찍지 않으면 들어서자마자
     「지금까지 겪은 무리」가 통째로 들어와 첫 매듭이 저절로 채워진다. */
  if (ch.cycle) markEndless(nation, ensureProgress(nation));
}

/**
 * 7장 정찰 지점 — 「안개 속 늑대 흔적」.
 * 영토 바깥 조금 먼 곳에 하나 찍는다. 시간이 아니라 '가서 보는 행동'이 웨이브를 연다.
 */
export function placeTrace(world, nation, data) {
  const p = ensureProgress(nation);
  if (p.trace) return p.trace;
  const town = townOf(world, nation.id);
  if (!town) return null;
  const r = (nation.territory?.radius ?? data.world.territory.baseRadius) + 7;
  const size = world.map?.size ?? data.world.size;
  const walkable = new Set(data.world.terrain.walkable);
  for (let i = 0; i < 48; i += 1) {
    const a = (Math.PI * 2 * i) / 48;
    const x = Math.round(town.x + Math.cos(a) * r);
    const y = Math.round(town.y + Math.sin(a) * r);
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) continue;
    const name = terrainNameAt(world.map, x, y, data);
    if (!walkable.has(nameToCode(name, data))) continue;
    p.trace = { x, y, radius: data.world.camps.scoutRadius ?? 6 };
    return p.trace;
  }
  p.trace = { x: Math.min(size - 2, town.x + r), y: town.y, radius: 6 };
  return p.trace;
}

function nameToCode(name, data) {
  const names = data.world.terrain.names;
  for (const [code, n] of Object.entries(names)) if (n === name) return code;
  return name;
}

/** 아바타·주민이 정찰 지점에 닿았는가 — lordMove·일 틱에서 부른다 */
export function checkTrace(world, nation, data) {
  const p = ensureProgress(nation);
  if (!p.trace || p.flags.traceFound) return false;
  const r = p.trace.radius ?? 6;
  const near = (x, y) => dist(x, y, p.trace.x, p.trace.y) <= r;
  for (const a of Object.values(nation.avatars || {})) if (near(a.x, a.y)) { p.flags.traceFound = true; break; }
  if (!p.flags.traceFound) {
    for (const u of nation.villagers || []) if (near(u.x, u.y)) { p.flags.traceFound = true; break; }
  }
  return Boolean(p.flags.traceFound);
}

/** 깃발 하나 세우기 (appraiseLand 등) */
export function setFlag(nation, flag) {
  ensureProgress(nation).flags[flag] = true;
}

/**
 * ★ GDD3 §14-7 — 이 건물은 **언제** 열리는가.
 *
 * 피드백: "화살탑이 목록에 없어서 없는 줄 알았다". §11-1(잠긴 계층은 UI 에 부재)은
 * **시스템·갈래 단위**의 규칙이고, 이미 열린 갈래 안의 개별 건물은 §12-3(조건 가시화)를 따른다.
 * 그러려면 「언제 열리는가」를 글로 낼 수 있어야 한다 — 그 답을 여기서 낸다.
 *
 * 문은 둘이다: ① 어느 장의 opens 에 적혀 있는가 ② (어디에도 없으면) 마지막 장에 든 뒤 티어가 연다.
 * @returns {{kind:'chapter'|'tier'|'never', chapter?:number, chapterName?:string, tier?:number, text:string}}
 */
export function buildingUnlockInfo(nation, key, data) {
  const def = data.buildings?.[key];
  if (!def) return { kind: 'never', text: '지을 수 없는 것입니다.' };
  for (const ch of chapterList(data)) {
    const inOpens = (ch.opens?.buildings || []).includes(key);
    const inReward = (ch.reward?.opens?.buildings || []).includes(key);
    const step = (ch.steps || []).find((st) => (st.opens?.buildings || []).includes(key));
    if (!inOpens && !inReward && !step) continue;
    return {
      kind: 'chapter', chapter: ch.id, chapterName: ch.name,
      text: `${ch.id}장 「${ch.name}」에서 해금`,
    };
  }
  // 어느 장에도 안 적혀 있다 = 엔드리스(마지막 장)에 들어선 뒤 정착지 티어가 연다
  const tier = def.requiresTier ?? 0;
  const last = chapterList(data)[chapterList(data).length - 1];
  const name = data.tiers?.levels?.find((l) => l.tier === tier)?.name ?? `티어 ${tier}`;
  return {
    kind: 'tier', tier, chapter: last?.id ?? null, chapterName: last?.name ?? null,
    text: inEndless(nation, data)
      ? `${name}(티어 ${tier})에서 해금`
      : `${last?.id ?? ''}장 「${last?.name ?? ''}」 뒤 ${name}(티어 ${tier})에서 해금`,
  };
}

/**
 * ★ 개발·테스트·시뮬 전용 — 장을 통째로 열어 둔다.
 *   실제 플레이에서는 절대 불리지 않는다(소켓 명령이 없다). 테스트가 '7장 이후의 규칙'만
 *   따로 확인할 수 있게, 그리고 개발 패널이 뒷장을 바로 볼 수 있게 두는 손잡이다.
 */
export function openChapterForDebug(world, nation, data, id) {
  const p = ensureProgress(nation);
  const target = Math.max(1, Math.min(chapterList(data).length, Number(id) || 1));
  for (const ch of chapterList(data)) {
    if (ch.id >= target) break;
    for (const st of ch.steps || []) {
      const k = stepKey(ch, st);
      if (!p.cleared.includes(k)) p.cleared.push(k);
    }
  }
  p.chapter = target;
  p.step = 0;
  if (target > 6) p.flags.appraised = true;
  if (target > 7) p.flags.traceFound = true;
  const ch = chapterDef(target, data);
  if (ch && world?.map) onChapterOpen(world, nation, ch, data);
  return p;
}

export function hasFlag(nation, flag) {
  return Boolean(ensureProgress(nation).flags[flag]);
}

// ────────────────────────────────────────────────────────────────
// 뷰 — state.chapter (PROTOCOL v3.1)
// ────────────────────────────────────────────────────────────────
/**
 * 목표 카드가 그릴 것 전부 + **마커가 가리킬 대상 후보**.
 * 「뭘 해야 할지 모르는 순간 제로」의 서버 몫이다 — 클라는 여기 실린 targets 로 화살표를 세운다.
 */
export function chapterView(world, nation, data) {
  if (!nation?.isPlayer) return null;
  const p = ensureProgress(nation);
  const ch = chapterDef(p.chapter, data);
  if (!ch) return null;
  const total = chapterList(data).length;
  const steps = ch.steps || [];
  const st = steps[p.step] ?? null;
  const m = st ? measure(world, nation, st.condition, data) : null;
  return {
    id: ch.id,
    key: ch.key,
    name: ch.name,
    subtitle: ch.subtitle ?? null,
    total,
    endless: Boolean(ch.endless),
    /* ★ §21-C2 — 지금까지 지은 매듭 수. 목표 카드가 「세 번째 매듭」을 적는다(순환 장에서만 0 이 아니다). */
    cycle: p.cycle ?? 0,
    stepIndex: p.step,
    stepCount: steps.length,
    /* ★ §19-E(F04-6) — 이 장에 남은 칸들. 목표 카드가 「그다음엔 무엇이」를 한 줄로 미리 보인다.
       왜 제목만 주나 — 조건 계측은 그 칸이 열린 뒤의 몫이고, 미리 재면 스포일러이자 헛계산이다. */
    remaining: steps.slice(p.step + 1).map((s) => ({ key: s.key, title: s.short ?? s.title })),
    goal: st ? {
      key: st.key,
      title: st.title,
      short: st.short ?? null,      // 자원 팝의 「(천막까지 6)」에 쓰이는 짧은 이름
      sub: st.sub ?? '',
      verb: st.verb ?? null,
      condition: st.condition,
      have: m.have,
      need: m.need,
      done: m.ok,
      hint: st.hint ?? null,
      hintOnFail: st.hintOnFail ?? null,
      targets: targetsFor(world, nation, st.target, data),
    } : null,
    flags: { ...p.flags },
    trace: p.trace ? { x: p.trace.x, y: p.trace.y, found: Boolean(p.flags.traceFound) } : null,
  };
}

/**
 * 마커 대상 후보 — 가까운 순서로 최대 3개.
 * 노드는 **탐사된 곳만** 싣는다(안개 계약을 깨지 않는다).
 */
function targetsFor(world, nation, target, data) {
  if (!target) return [];
  const out = [];
  const av = Object.values(nation.avatars || {})[0] ?? townOf(world, nation.id) ?? { x: 0, y: 0 };
  const near = (a, b) => dist(a.x, a.y, av.x, av.y) - dist(b.x, b.y, av.x, av.y);

  if (target.type === 'node') {
    /* ★ GDD3 §13-B-2 — 자원 군락은 **영토 밖** 8~20타일에 앉는다. 그러니 목표 마커도 영토를 넘어야
       가리킬 것이 있다(영토 안만 뒤지면 「나무를 베세요」인데 가리킬 나무가 없는 사고가 난다).
       반경은 주민 일자리와 같은 자 — 영토 + workRadiusBonus — 를 쓴다. 다만 화살표는
       **아바타에서 가까운 순** 세 개라, 멀리 있는 군락이 뽑혀도 화면을 어지럽히지 않는다. */
    const types = new Set(target.nodeTypes || []);
    const town = townOf(world, nation.id);
    const radius = (nation.territory?.radius ?? data.world.territory.baseRadius)
      + (data.world.villagers.workRadiusBonus ?? 0);
    const cands = (world.map?.nodes || []).filter((n) => {
      if (n.hidden || n.depleted || !types.has(n.type)) return false;
      if (n.concealed && !n.revealed) return false;
      if (!town) return false;
      return dist(n.x, n.y, town.x, town.y) <= radius + 0.001;
    });
    cands.sort(near);
    for (const n of cands.slice(0, 3)) out.push({ kind: 'node', id: n.id, x: n.x, y: n.y, name: n.type });
  } else if (target.type === 'site') {
    for (const c of nation.construction || []) {
      if (c.building !== target.building) continue;
      out.push({ kind: 'site', id: c.id, x: c.x, y: c.y, name: data.buildings[c.building]?.name ?? c.building });
    }
  } else if (target.type === 'structure') {
    for (const s of nation.structures || []) {
      if (target.building && s.key !== target.building) continue;
      out.push({ kind: 'structure', id: s.id, x: s.x, y: s.y, name: data.buildings[s.key]?.name ?? s.key });
    }
    out.sort(near);
    out.length = Math.min(out.length, 3);
  } else if (target.type === 'housing') {
    // ★ 「사람이 더 와야 한다」의 마커. 셋 중 하나를 가리킨다:
    //   ① 올리다 만 집이 있으면 **그 현장**(가서 두드려라)
    //   ② 빈 잠자리가 없으면 **집 지을 자리**(배치대)
    //   ③ 둘 다 아니면 이미 선 집(기다리면 온다)
    //   ①을 빼먹으면 「또 놓아라」만 가리켜 공사장만 늘어난다 — 실제로 그 사고가 있었다.
    const pending = (nation.construction || []).find((c) => HOUSING.includes(c.building) && !c.structureId);
    const beds = housingBeds(nation, data);
    if (pending) {
      out.push({ kind: 'site', id: pending.id, x: pending.x, y: pending.y,
        name: data.buildings[pending.building]?.name ?? pending.building });
    } else if (beds.free <= 0 && beds.key) {
      out.push({ kind: 'buildSlot', id: beds.key, sel: '#tb-build',
        name: data.buildings[beds.key]?.name ?? beds.key, reason: 'noBeds' });
    } else {
      for (const s of nation.structures || []) {
        if (!HOUSING.includes(s.key)) continue;
        out.push({ kind: 'structure', id: s.id, x: s.x, y: s.y, name: data.buildings[s.key]?.name ?? s.key });
      }
      out.sort(near);
      out.length = Math.min(out.length, 3);
    }
  } else if (target.type === 'point' && target.source === 'trace') {
    const p = ensureProgress(nation);
    if (p.trace) out.push({ kind: 'point', id: 'trace', x: p.trace.x, y: p.trace.y, name: '낯선 발자국' });
  } else if (target.type === 'camp') {
    for (const c of world.camps || []) {
      if (c.nationId && c.nationId !== nation.id) continue;
      out.push({ kind: 'camp', id: c.id, x: c.x, y: c.y, name: c.name ?? '적' });
    }
  }

  if (!out.length && target.fallback) {
    if (target.fallback.type === 'buildSlot') {
      out.push({ kind: 'buildSlot', id: target.fallback.building, sel: target.fallback.sel ?? '#tb-build',
        name: data.buildings[target.fallback.building]?.name ?? target.fallback.building });
    } else if (target.fallback.type === 'ui') {
      out.push({ kind: 'ui', id: target.fallback.sel, sel: target.fallback.sel, name: target.fallback.name ?? '' });
    }
  }
  if (!out.length && target.type === 'ui') {
    out.push({ kind: 'ui', id: target.sel, sel: target.sel, name: target.name ?? '' });
  }
  if (!out.length && target.type === 'buildSlot') {
    out.push({ kind: 'buildSlot', id: target.building, sel: target.sel ?? '#tb-build',
      name: data.buildings[target.building]?.name ?? target.building });
  }
  return out;
}

const HOUSING = ['tent', 'hut', 'house', 'manor'];

/** 빈 잠자리와, 지금 지을 수 있는 가장 좋은 주거 */
function housingBeds(nation, data) {
  let cap = 0;
  for (const s of nation.structures || []) {
    const spec = data.buildings[s.key]?.tiers?.[s.tier - 1];
    cap += spec?.residents ?? 0;
  }
  const open = unlockedList(nation, data).buildings;
  let key = null;
  for (const k of HOUSING) if (open.includes(k)) key = k;      // 뒤로 갈수록 좋은 집
  return { free: cap - Math.floor(nation.population || 0), capacity: cap, key };
}

/** /api/config 공개본 — 규칙만 나간다(어느 장인지는 state 로만) */
export function publicChapters(data) {
  return {
    chapters: chapterList(data).map((c) => ({
      id: c.id, key: c.key, name: c.name, subtitle: c.subtitle ?? null,
      endless: Boolean(c.endless),
      steps: (c.steps || []).map((s) => ({ key: s.key, title: s.title, sub: s.sub ?? '', verb: s.verb ?? null })),
      opens: {
        buildings: [...(c.opens?.buildings || [])],
        features: [...(c.opens?.features || [])],
        ui: [...(c.opens?.ui || [])],
      },
      reward: c.reward ? { line: c.reward.line ?? null, card: c.reward.card ?? null } : null,
    })),
  };
}
