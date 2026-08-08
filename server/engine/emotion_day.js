// 감정의 날 — ★ v3.1(GDD3 §11-4): **시간도 티어도 이것을 열지 않는다.**
//   3일차 자동 발동도, 티어 3 마일스톤도 폐기됐다. 유일한 문은 `appraiseLand` 명령 하나다:
//   감정소(측량소, 목재 60·석재 30)를 다 세우고, 그 건물을 눌러 [땅을 감정한다]를 고를 때만 열린다.
// ★ WORLD.md 재해석: 타일 공개가 아니라 「영토 안 지하 자원(철광맥·유막)이 안개 걷히듯 드러나는」 연출이다.
// ★ WORLD.md §9: 감정의 날 직후 '관제 선포' — 여기서 비로소 역할을 고를 수 있게 된다.
import { townOf, territoryRadius, dist, terrainNameAt } from './world.js';
import { createRng } from './rng.js';
import { round2 } from './economy.js';

/**
 * 감정할 수 있는 상태인가 — **감정소가 서 있고 아직 감정하지 않았다**.
 * (틱 파이프라인은 이 함수를 부르지 않는다. 부르는 것은 commands.appraiseLand 뿐이다.)
 */
export function canAppraise(world) {
  if (world.emotionDayDone) return false;
  const p = world.nations[world.playerNationId];
  return (p?.structures || []).some((s) => s.key === 'appraisal_post');
}

/** 태그 확정 + 영토 안 지하 자원 공개 + 관제 선포. rng 소비. */
export function runEmotionDay(world, data, rng) {
  const events = [];
  const player = world.nations[world.playerNationId];

  const revealedByNation = {};
  for (const nation of Object.values(world.nations)) {
    /* ★ §20-R4(§20-5 수에르의 균형 4개 완성) — 「감정의 날 보너스 2배」. 이 날이 실제로 내주는
       보너스는 **땅의 됨됨이(태그)** 하나다 — 나머지(지하 자원 공개·관제 선포)는 배수를 곱할
       수 있는 값이 아니라 한 번 열리고 마는 문이다. 그래서 뽑는 태그 수에 배수를 건다.
       추가분은 전부 강점이다(assignTags 의 마지막 채움이 강점 풀에서만 뽑는다) — 약점 상한은
       그대로라 「보너스 2배」가 「약점도 2배」가 되지 않는다. 거울은 tick.js 가 박는다. */
    if (nation.isPlayer) nation.tags = nation.pendingTags ?? assignTags(data, rng, nation.artifactEmotionDay ?? 1);
    nation.tagsRevealed = true;
    revealedByNation[nation.id] = revealSubsurface(world, nation, data);
  }

  world.emotionDayDone = true;
  // ★ §19-F3(F07-8) — 재감정 주기를 세는 기준점. 옛 세이브에는 없어 0으로 읽히고, 그러면 곧바로 열린다.
  world.emotionDayTick = world.tick;
  world.phase = 'act2';

  const tagNames = player.tags.map((t) => data.tags[t]?.name ?? t);
  const revealed = revealedByNation.player || [];
  events.push({
    kind: 'emotion_day',
    nationId: player.id,
    data: {
      tags: tagNames,
      tagKeys: player.tags,
      tagLine: tagNames.join(' · '),
      revealedNodes: revealed.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y })),
      nodesRevealed: revealed.length,
      // ★ §17-18 — 컷신이 지나가고 난 뒤에도 태그마다의 이야기를 곱씹을 수 있게 따로 실어 보낸다
      tagStories: player.tags.map((t) => tagStory(t, data)),
      cutscene: buildCutscene(world, player, data),
      worldTags: Object.values(world.nations).map((n) => ({
        id: n.id, name: n.name, tags: n.tags.map((t) => data.tags[t]?.name ?? t),
      })),
    },
  });

  events.push(...openMandate(world, player, data));
  return events;
}

/** 태그 하나의 이름과 한 줄 이야기. 옛 세이브에 flavor 없는 태그가 있어도 빈 줄로 버틴다. */
function tagStory(key, data) {
  const def = data.tags[key] || {};
  return { key, name: def.name ?? key, flavor: def.flavor ?? '' };
}

/** 영토 안 지하 자원(철광맥·유막)을 드러낸다 */
export function revealSubsurface(world, nation, data) {
  const town = townOf(world, nation.id);
  if (!town) return [];
  const r = territoryRadius(nation, data);
  const out = [];
  for (const n of world.map?.nodes || []) {
    if (!n.hidden) continue;
    if (dist(n.x, n.y, town.x, town.y) > r + 0.001) continue;
    n.hidden = false;
    n.stamp = world.tick;
    out.push(n);
  }
  return out;
}

/**
 * 관제 선포 (§9) — 역할 선택이 여기서 열린다.
 * 아무도 안 고르고 방치해도 나라가 굴러가야 하므로(섭정 원칙) 기본 위임을 서버가 깔아 준다.
 * 이미 누군가 자리를 쥐고 있으면(시뮬·테스트가 명시 배정) 건드리지 않는다.
 */
export function openMandate(world, nation, data) {
  const cfg = data.world.roleTiming;
  world.mandateOpen = true;
  const anyHolder = data.roles.order.some((k) => nation.roles?.[k]?.holder);
  let delegated = null;
  if (cfg.autoDelegateOnMandate && !anyHolder) {
    delegated = {};
    for (const key of data.roles.order) {
      const holder = key === cfg.defaultVacant ? null : 'npc';
      nation.roles[key].holder = holder;
      if (holder && !nation.roles[key].name) nation.roles[key].name = data.roles.defs[key].name;
      delegated[key] = holder;
    }
  }
  return [{
    kind: 'mandate',
    nationId: nation.id,
    data: {
      // PROTOCOL v2 mandate: 클라의 '관제 선포' 화면이 이 목록으로 카드를 그린다
      roles: data.roles.order.map((key) => ({
        key,
        name: data.roles.defs[key].name,
        tier: data.roles.defs[key].tier,
        exclusiveInfo: data.roles.defs[key].exclusiveInfo,
        holder: nation.roles[key].holder,
      })),
      autoDelegated: delegated,
      vacant: cfg.defaultVacant,
      warning: '성녀를 비우면 침공일이 흐려지고 서지 효율이 절반이 됩니다.',
    },
  }];
}

// ────────────────────────────────────────────────────────────────
// ★ §19-F3(F07-8) 재감정 — 「한 번 쓰고 나면 서 있기만 하는 건물」이 아니게
//   감정소는 이제 헐 수도 옮길 수도 없다(buildings.json immovable). 대신 며칠에 한 번
//   「기운이 다시 고인다」: 금화를 들여 태그 하나를 다시 뽑고, 그 사이 넓어진 영토의
//   지하 자원을 마저 드러낸다. 감정의 날의 코드(assignTags·revealSubsurface)를 그대로 쓴다.
// ★ 난수는 세계 난수를 축내지 않는다 — 씨앗·나라·횟수로 제 흐름을 짓는다(§13-C 와 같은 규율).
// ────────────────────────────────────────────────────────────────
export const reappraisalCfg = (data) => data.balance.emotionDay.reappraisal ?? null;

/** 지금 다시 감정할 수 있는가 — 감정소가 서 있고, 주기가 찼거나 표(옛 지도 조각)가 있다. */
export function reappraisalState(world, nation, data) {
  const cfg = reappraisalCfg(data);
  const post = (nation.structures || []).some((s) => s.key === 'appraisal_post' && !s.inactive);
  if (!cfg || !world.emotionDayDone || !post) return { open: false, post, daysLeft: null, charges: 0 };
  const since = world.tick - (world.lastAppraisalTick ?? world.emotionDayTick ?? 0);
  const daysLeft = Math.max(0, (cfg.intervalDays ?? 12) - since);
  const charges = nation.reappraisalCharges || 0;
  return { open: daysLeft <= 0 || charges > 0, post, daysLeft, charges, gold: cfg.gold ?? 0 };
}

/** 다시 감정한다 — 태그 하나를 갈아 끼우고, 넓어진 영토의 지하를 마저 연다. */
export function runReappraisal(world, nation, data) {
  const cfg = reappraisalCfg(data);
  const st = reappraisalState(world, nation, data);
  const paid = payReappraisal(nation, st, cfg);
  if (!paid.ok) return paid;
  const count = (nation.reappraisalCount = (nation.reappraisalCount || 0) + 1);
  const rng = createRng(hashSeed(`${world.seed}:${nation.id}:reappraise:${count}`));
  const swapped = swapOneTag(nation, data, rng, cfg);
  const revealed = revealSubsurface(world, nation, data);
  world.lastAppraisalTick = world.tick;
  return { ok: true, ...paid, swapped, count,
    tagKeys: [...nation.tags], tagNames: nation.tags.map((t) => data.tags[t]?.name ?? t),
    tagStories: nation.tags.map((t) => tagStory(t, data)),
    revealedNodes: revealed.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y })) };
}

/** 표가 있으면 표를 쓰고, 없으면 주기가 찬 뒤 금화를 낸다. */
function payReappraisal(nation, st, cfg) {
  if (!st.post) return { ok: false, error: { code: 'NO_STRUCTURE', message: '감정소가 없습니다.' } };
  if (st.charges > 0) { nation.reappraisalCharges -= 1; return { ok: true, usedCharge: true, gold: 0 }; }
  if (st.daysLeft > 0) {
    return { ok: false, error: { code: 'NOT_READY', message: `아직 기운이 고이지 않았습니다 — ${st.daysLeft}일 남았습니다.` } };
  }
  const gold = cfg.gold ?? 0;
  if (nation.gold < gold) return { ok: false, error: { code: 'NO_GOLD', message: `금화가 모자랍니다 — ${gold} 이 듭니다.` } };
  nation.gold = round2(nation.gold - gold);
  nation.stats.goldSpent = round2((nation.stats.goldSpent || 0) + gold);
  return { ok: true, usedCharge: false, gold };
}

/** 태그 한 자리를 다시 뽑는다 — 약점이 있으면 그 자리부터 간다(땅이 나아질 여지). */
function swapOneTag(nation, data, rng, cfg) {
  const tags = nation.tags || [];
  if (!tags.length) return null;
  const weak = tags.findIndex((t) => data.tags[t]?.kind === 'weakness');
  const idx = weak >= 0 ? weak : rng.int(0, tags.length - 1);
  const pool = tagKeysOfKind(data, cfg.rerollKind ?? 'strength').filter((k) => !tags.includes(k));
  if (!pool.length) return null;
  const from = tags[idx];
  tags[idx] = rng.pick(pool);
  return { from, fromName: data.tags[from]?.name ?? from,
    to: tags[idx], toName: data.tags[tags[idx]]?.name ?? tags[idx] };
}

/** 문자열 → 32비트 씨앗. 세계 난수와 겹치지 않는 제 흐름을 짓는 데만 쓴다. */
function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 한 갈래(강점·약점·양날)의 태그 열쇠만 골라 낸다. */
function tagKeysOfKind(data, kind) {
  return Object.entries(data.tags).filter(([, v]) => v.kind === kind).map(([k]) => k);
}

/**
 * 후보에서 겹치지 않게 뽑아 picked 를 target 길이까지 채운다.
 * ★ 「왜」 헛돌이 방패(guard)가 있는가 — 후보가 이미 다 뽑힌 상태에서 while 이 돌면 서버가 멈춘다.
 *   후보가 마르면 짧은 채로 돌려주고, 뒤에 오는 채움이 나머지를 메우게 둔다.
 */
function drawInto(picked, pool, target, rng) {
  let guard = 0;
  while (picked.length < target && guard < 200) {
    guard += 1;
    const key = rng.pick(pool);
    if (picked.includes(key)) continue;
    picked.push(key);
  }
}

/**
 * ★ §17-18b — 땅의 됨됨이 추첨. 구성 규칙은 balance.emotionDay.playerTags 가 쥔다
 *   (count 종 · 강점 최소 minStrength · 약점 최대 maxWeakness · 중복 없음).
 * ★ 「왜」 약점을 '반드시 하나'에서 '최대 하나'로 풀었나 — 옛 규칙은 어느 시드로 시작해도
 *   시작 땅이 늘 절름발이였다. 이제 약점 없는 순한 땅도, 약점을 안은 땅도 나온다.
 *   양날(mixed) 태그는 강점도 약점도 아니어서 추첨에서 빠진다(요새지는 아직 AI 국가의 몫).
 */
/**
 * @param {number} mult ★ §20-R4 — 유물 배수(세트 「수에르의 균형」 4개 완성이면 2). 뽑는 **종 수**만
 *   늘린다: 앞의 두 걸음(강점 최소·약점 최대)은 손대지 않고 마지막 채움만 멀리 간다.
 *   1 이면 target 이 dial.count 그대로라 난수 소비도 결과도 한 톨도 다르지 않다(옛 판 불변).
 */
export function assignTags(data, rng, mult = 1) {
  const dial = data.balance.emotionDay.playerTags;
  const target = Math.max(dial.count, Math.round(dial.count * (mult || 1)));
  const strengths = tagKeysOfKind(data, 'strength');
  const picked = [];
  drawInto(picked, strengths, dial.minStrength, rng);
  drawInto(picked, tagKeysOfKind(data, 'weakness'), picked.length + rng.int(0, dial.maxWeakness), rng);
  drawInto(picked, strengths, target, rng);
  return picked.slice(0, target);
}

/**
 * ★ §17-18b — 세계 시드만으로 굴리는 시작 태그 추첨(월드 생성 시점에 한 번).
 * ★ 「왜」 전용 난수를 따로 파는가 — 월드 생성 난수를 여기서 축내면 같은 시드의 지형·군락이
 *   통째로 밀린다. 시드에서 갈라져 나온 별도 흐름이라 결정론(같은 시드 = 같은 태그)은 그대로고,
 *   실시간 로직이 월드 난수를 건드리지 않는다는 원칙에도 걸리지 않는다.
 */
export function rollPlayerTags(seed, data) {
  const dial = data.balance.emotionDay.playerTags;
  return assignTags(data, createRng(((seed >>> 0) ^ dial.seedSalt) >>> 0));
}

/**
 * ★ §17-18 — 컷신을 이야기답게 두껍게 한다.
 *   피드백 「감정의 날에 감정되는 요소가 너무 적다」에 대한 답이다. 앞의 다섯 장은 예전 그대로
 *   '땅이 갈라지는' 연출이고, 그 뒤에 **배정받은 태그마다 한 장씩** 그 땅의 성정을 읽어 준 뒤
 *   마지막 한 장으로 닫는다. 그래서 프레임 수는 5 + 태그 수 + 1 로 태그에 따라 달라진다.
 *   (클라 cutscene.js 는 프레임 수를 세지 않고 길이에 맞춰 재생 시간을 늘린다 — 하드코딩 없음.)
 */
export function buildCutscene(world, nation, data) {
  return [
    { text: '세 밤을 갈아온 땅이 흔들린다.', color: '#1b1b28' },
    { text: '균열 사이로 빛이 새어 나온다.', color: '#3a2f4f' },
    { text: terrainLine(world, nation, data), color: '#6b5b95' },
    { text: nation.tags.map((t) => data.tags[t]?.name ?? t).join(' · '), color: '#e8c07d' },
    { text: '이제 각자의 자리가 정해진다.', color: '#f4efe6' },
    ...flavorFrames(nation, data),
    closingFrame(data),
  ];
}

/**
 * 태그 한 장 = 「이름 — 한 줄 이야기」. 문구는 전부 data/tags.json 의 flavor 가 쥔다.
 * flavor 가 없는 옛 태그가 섞여 들어와도 이름만으로 한 장을 낸다(연출이 끊기면 안 되므로).
 */
function flavorFrames(nation, data) {
  const color = data.balance.emotionDay.cutscene.flavorColor;
  return (nation.tags || []).map((key) => {
    const def = data.tags[key] || {};
    const name = def.name ?? key;
    if (!def.flavor) return { text: name, color };
    return { text: `${name} — ${def.flavor}`, color };
  });
}

/** 마무리 한 줄 — 태그를 다 읽고 나서 이야기를 닫는다 */
function closingFrame(data) {
  const c = data.balance.emotionDay.cutscene.closing;
  return { text: c.text, color: c.color };
}

/** 영토 안 지형을 세어 「풀밭 120 · 숲 40 …」 한 줄로 만든다(많은 순 넷) */
function terrainLine(world, nation, data) {
  const names = data.world.terrain.names;
  return Object.entries(terrainCounts(world, nation, data))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${names[k] ?? k} ${v}`)
    .join(' · ');
}

/** 도읍 반경 안 지형 칸 수. 도읍이 없으면(테스트용 빈 월드) 빈 셈이다. */
function terrainCounts(world, nation, data) {
  const town = townOf(world, nation.id);
  const counts = {};
  if (!town) return counts;
  const r = territoryRadius(nation, data);
  const hi = world.map.size - 1;
  for (let y = Math.max(0, Math.floor(town.y - r)); y <= Math.min(hi, Math.ceil(town.y + r)); y += 1) {
    for (let x = Math.max(0, Math.floor(town.x - r)); x <= Math.min(hi, Math.ceil(town.x + r)); x += 1) {
      countTile(world, data, counts, { town, r, x, y });
    }
  }
  return counts;
}

function countTile(world, data, counts, { town, r, x, y }) {
  if (dist(x, y, town.x, town.y) > r) return;
  const name = terrainNameAt(world.map, x, y, data);
  if (!name) return;
  counts[name] = (counts[name] || 0) + 1;
}
