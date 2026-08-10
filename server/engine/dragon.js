// ★ §19-F2(F07-4) 세계에 한 마리뿐인 용 — docs/QA1차/07_콘텐츠.md
//
// 웨이브와는 아무 상관이 없다. 웨이브는 날을 잡고 몰려오는 사건이고(battle.js),
// 이 놈은 **그냥 거기 사는 것**이다(ecology.js 의 짐승과 같은 층). 다른 것이 셋뿐이다:
//   ① 세상에 하나다 — 잡히면 다시 태어나지 않는다(world.dragon.slainTick 이 남는다).
//   ② 자리를 난수로 뽑지 않는다 — 지도에서 **가장 깊은 화산재 땅**이 곧 굴이다.
//      그래서 월드 생성 난수를 한 톨도 축내지 않는다(같은 씨앗 = 같은 지도 = 같은 굴).
//   ③ 링에 매이지 않는다 — 제 굴을 떠나지 않는다(ecology.keepTargetInBand 가 boss 를 비켜 간다).
//
// 옛 세이브에는 화산재 땅이 없으므로 굴 자리도 없다 — 용이 나타나지 않고 아무 일도 일어나지 않는다.
import { terrainNameAt, townOf, dist } from './world.js';
import { record } from './chronicle.js';
import { grantArtifact, recordArtifactFound } from './artifacts.js';
import { round2 } from './economy.js';

export const bossCfg = (data) => data.creatures?.worldBoss ?? null;
const bossDef = (data) => data.creatures?.defs?.[bossCfg(data)?.species] ?? null;

/** 이 칸이 그 땅 **속으로** 얼마나 들어와 있는가 — 둘레 5×5 중 같은 땅의 칸 수(0~25) */
function depthAt(world, data, biome, x, y) {
  let n = 0;
  for (let dy = -4; dy <= 4; dy += 2) {
    for (let dx = -4; dx <= 4; dx += 2) {
      if (terrainNameAt(world.map, x + dx, y + dy, data) === biome) n += 1;
    }
  }
  return n;
}

/**
 * 굴 자리 — 도읍에서 minDistance 밖의 화산재 땅 가운데 **가장 깊은** 칸(같으면 더 먼 쪽).
 * 「왜」 가장 먼 칸이 아닌가: 그러면 언제나 지도 모서리다 — 굴은 벼랑 끝이 아니라 땅 한가운데 있어야 한다.
 * 난수를 쓰지 않으므로 같은 지도면 언제나 같은 칸이 나온다. scanStep 으로 성기게 훑는다(384²를 다 보지 않는다).
 */
export function lairSpot(world, data) {
  const cfg = bossCfg(data);
  const town = townOf(world, 'player') ?? { x: world.map.size / 2, y: world.map.size / 2 };
  let best = null;
  for (let y = 6; y < world.map.size - 6; y += cfg.scanStep) {
    for (let x = 6; x < world.map.size - 6; x += cfg.scanStep) {
      if (terrainNameAt(world.map, x, y, data) !== cfg.biome) continue;
      const d = dist(town.x, town.y, x, y);
      if (d < cfg.minDistanceFromTown) continue;
      const deep = depthAt(world, data, cfg.biome, x, y);
      if (!best || deep > best.deep || (deep === best.deep && d > best.d)) best = { x, y, d, deep };
    }
  }
  return best;
}

/** 용을 한 번 심는다. 이미 심었거나 잡혔거나 잿땅이 없으면 아무 일도 하지 않는다. */
export function ensureDragon(world, nation, data) {
  const cfg = bossCfg(data);
  const def = bossDef(data);
  if (!cfg || !def || !nation?.isPlayer) return null;
  const st = (world.dragon ||= { placed: false, slainTick: null });
  if (st.placed || st.slainTick != null) return null;
  const spot = lairSpot(world, data);
  if (!spot) return null;
  st.placed = true;
  st.x = spot.x;
  st.y = spot.y;
  return addBoss(nation, data, cfg, def, spot);
}

/** 짐승 목록에 앉힌다 — 그려지는 것도 베이는 것도 여느 짐승과 **같은 길**을 탄다(코드 중복 없음). */
function addBoss(nation, data, cfg, def, spot) {
  const w = (nation.wild ||= { creatures: [], nextId: 1, respawnQueue: [], rngState: null, acc: 0 });
  const c = {
    id: `boss_${cfg.species}`,
    sp: cfg.species,
    x: spot.x, y: spot.y, tx: spot.x, ty: spot.y,
    hp: def.hp, maxHp: def.hp,
    ring: def.ring ?? 3,
    boss: true,
    state: 'wander', retarget: 0, atkCd: 0, provoked: 0, seen: false,
  };
  w.creatures.push(c);
  return c;
}

/**
 * 굴 앞에 섰는가 — 아바타가 warnRadius 안으로 들면 한 번 경고한다.
 * 「왜」 한 번인가: 경계선을 오가면 매 걸음 울린다. 본 사람의 장부(nation.dragonWarnedTick)에 적어 둔다.
 * @returns {{title,text,x,y}|null}
 */
export function dragonWarning(world, nation, data, x, y) {
  const cfg = bossCfg(data);
  const st = world?.dragon;
  if (!cfg || !st?.placed || st.slainTick != null) return null;
  if (dist(st.x, st.y, x, y) > cfg.warnRadius) return null;
  if (nation.dragonWarnedTick != null) return null;
  nation.dragonWarnedTick = world.tick;
  /* ★ 4단계 — 굴 앞에 선 날도 이 나라의 역사다. 여태 이 경고는 컷신 한 번으로 흘러가고
     아무 데도 남지 않아, 창을 닫고 나면 「무슨 골짜기였더라」가 됐다. 연대기에 한 줄 남긴다 —
     자리(x,y)는 싣지 않는다: 연대기는 지도가 아니고, 굴은 걸어가 본 사람만 아는 것이어야 한다
     (단서 규율 ① 마커·좌표 금지를 그대로 물려받는다). */
  record(world, { kind: 'discovery', title: cfg.warnTitle, text: cfg.warnText }, data);
  return { title: cfg.warnTitle, text: cfg.warnText, x: st.x, y: st.y };
}

/**
 * ★ 4단계(2026-08-10) — 「먼 잿빛 산의 소문」. 나라에 한 번, 연대기와 쪽지로 나간다.
 *
 * 「왜」 이 한 줄이 필요한가 — 용은 이미 다 만들어져 세상에 앉아 있는데(굴·경고·전리품·대장간),
 * 아무도 그런 것이 있는 줄을 모른다. 굴에서 22칸 안에 들어야 처음 알게 되는데, 그 골짜기는
 * 도읍에서 90칸 밖이라 「우연히 지나가다」가 사실상 일어나지 않는다. 유일한 문이 굴 앞이면
 * 그 문은 없는 것과 같다. 그래서 **먼저 소문이 온다** — 여는 것은 한 줄의 말뿐이다:
 * 자리도 마커도 주지 않는다(단서 규율 ①). 잿빛 산이라는 **땅 이름** 하나만 남기고,
 * 찾아가는 일은 여전히 제 발로 하는 일이다.
 *
 * 난수를 쓰지 않는 까닭 — 소문이 굴림이면 어떤 판에서는 영영 안 온다(같은 씨앗이 다른 게임이
 * 되는 것도 문제다). 조건은 **때**다: 굴이 실제로 심겼고, 첫 감정의 날이 지났을 때 딱 한 번.
 * 감정의 날 뒤인 까닭은 그날이 이 게임에서 「세상이 넓어지는 날」이라, 그 전에 던지면
 * 아직 마을도 못 세운 사람에게 90칸 밖 이야기를 하는 꼴이 된다.
 *
 * 잿땅이 없어 굴이 안 심긴 지도(옛 세이브 포함)에서는 st.placed 가 서지 않으므로 소문도 없다 —
 * 있지도 않은 것의 소문을 내면 그것은 거짓말이다.
 * @returns {{kind,nationId,data}|null} 일 틱이 그대로 events 에 실어 보낸다
 */
export function dragonRumor(world, nation, data) {
  const cfg = bossCfg(data);
  const st = world?.dragon;
  if (!cfg?.rumorText || !nation?.isPlayer) return null;
  if (!st?.placed || st.slainTick != null || st.rumorTick != null) return null;
  if (!world.emotionDayDone) return null;
  if (world.tick <= (world.emotionDayTick ?? 0)) return null;
  st.rumorTick = world.tick;
  record(world, { kind: 'discovery', title: cfg.rumorTitle, text: cfg.rumorText }, data);
  return { kind: 'dragon_rumor', nationId: nation.id,
           data: { title: cfg.rumorTitle, text: cfg.rumorText } };
}

/**
 * 잡았다 — 세상에 하나뿐인 것을 잡았으니 몫도 하나뿐이다.
 * 자재 전리품은 여느 짐승과 같은 길(def.drops)로 이미 들어갔다. 여기서는 그 위에 얹는 것만 다룬다:
 * 금화 · 사기 · 확정 유물 · **전리품 표식**(trophy) — 표식이 대장간의 용아검·용린 갑옷을 연다.
 */
export function slayDragon(world, nation, data, killerName = null, killerAvatarId = null) {
  const cfg = bossCfg(data);
  const st = world?.dragon;
  if (!cfg || !st || st.slainTick != null) return null;
  st.slainTick = world.tick;
  nation.gold = round2((nation.gold || 0) + (cfg.reward.gold || 0));
  const m = data.balance.morale;
  nation.morale = Math.min(m.max, (nation.morale || 0) + (cfg.reward.morale || 0));
  (nation.trophies ||= {})[cfg.reward.trophy] = world.tick;
  const artifact = grantArtifact(nation, cfg.reward.artifact, world.tick, data);
  /* ★ §20-R3 — 용의 몫도 방의 역사다. 연출은 제 컷신이 쥐므로 발견 사실(push)은 내지 않고
     기록만 남긴다 — 도감 3단이 「누가 용을 눕히고 얻었는가」를 말할 수 있어야 한다. */
  if (artifact) recordArtifactFound(world, nation, cfg.reward.artifact, data, { avatarId: killerAvatarId ?? null });
  record(world, { kind: 'discovery', title: cfg.slainTitle, text: cfg.slainText, data: { by: killerName } }, data);
  return { title: cfg.slainTitle, text: cfg.slainText, gold: cfg.reward.gold, trophy: cfg.reward.trophy, artifact };
}

/** 이 나라가 용을 잡았는가 — 대장간(equipment.js)이 묻는다 */
export const hasTrophy = (nation, key) => Boolean(nation?.trophies?.[key]);
