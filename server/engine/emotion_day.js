// 감정의 날 — ★ v3.1(GDD3 §11-4): **시간도 티어도 이것을 열지 않는다.**
//   3일차 자동 발동도, 티어 3 마일스톤도 폐기됐다. 유일한 문은 `appraiseLand` 명령 하나다:
//   감정소(측량소, 목재 60·석재 30)를 다 세우고, 그 건물을 눌러 [땅을 감정한다]를 고를 때만 열린다.
// ★ WORLD.md 재해석: 타일 공개가 아니라 「영토 안 지하 자원(철광맥·유막)이 안개 걷히듯 드러나는」 연출이다.
// ★ WORLD.md §9: 감정의 날 직후 '관제 선포' — 여기서 비로소 역할을 고를 수 있게 된다.
import { townOf, territoryRadius, dist, terrainNameAt } from './world.js';

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
    if (nation.isPlayer) nation.tags = nation.pendingTags ?? assignTags(data, rng);
    nation.tagsRevealed = true;
    revealedByNation[nation.id] = revealSubsurface(world, nation, data);
  }

  world.emotionDayDone = true;
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

function assignTags(data, rng) {
  const cfg = data.balance.emotionDay;
  const strengths = Object.entries(data.tags).filter(([, v]) => v.kind === 'strength').map(([k]) => k);
  const weaknesses = Object.entries(data.tags).filter(([, v]) => v.kind === 'weakness').map(([k]) => k);
  const count = rng.int(cfg.tagCountMin, cfg.tagCountMax);
  const picked = new Set();
  picked.add(rng.pick(strengths));
  picked.add(rng.pick(weaknesses));
  while (picked.size < count) picked.add(rng.pick(strengths));
  return [...picked];
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
