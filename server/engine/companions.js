// 동료 봇 = 각료 — docs/GDD3.md §15-C.
//
// 국가 정원은 5인이다. 사람이 못 채운 자리를 **동료**가 채운다.
// 동료는 주민이 아니다. 주민은 매크로 노동력(부처 산출)이고, 동료는 **플레이어와 같은 아바타 실체**다:
// 제 외형·이름·스킬 장부(nation.players)를 갖고, 사람과 **같은 명령 함수**(actionSwing·huntSwing·combatSwing)를
// 그대로 탄다. 그래서 수치가 갈릴 자리가 없다 — 쿨타임도, 도구 배수도, 저장 상한도 한 곳에서만 판정된다.
//
// ★ 왜 commands.applyCommand 를 부르지 않는가
//   ① 순환 참조(commands → companions → commands)를 만들지 않기 위해서다.
//   ② 장 사슬(evaluateProgress)은 **사람의 손**이 여는 것이다. 동료가 대신 두드려 장을 넘기면
//      "무엇을 해 보세요"라는 안내가 스스로 사라진다. 동료가 곳간에 넣은 몫은 자원 조건에 그대로
//      반영되지만(창고는 나라 공용이다), 「나무를 세 번 베어 보세요」 같은 스윙 조건은
//      사람만 센다(progression.totalSwings 가 p.bot 을 건너뛴다).
//
// ★ 두 박자 (터렛의 §0-S-4 와 같은 규율 — 한 사람의 노동을 두 번 세지 않는다)
//   · 지켜보는 동안 — server/index.js 의 생태계 1초 루프가 stepCompanions 를 부른다. 실제로 걷고 휘두른다.
//   · 아무도 없을 때 — tick.js 의 일 틱이 stepCompanionsDay 로 **안 본 만큼만** 몰아 돌린다
//     (liveSeconds 를 세어 두고 하루에서 뺀다). 그래서 방치가 이득도 손해도 되지 않는다.
import { townOf, territoryRadius, dist, terrainAt, terrainIndex } from './world.js';
// ★ Sprint 3 — 노드 조회·둘레 훑기는 파생 색인 하나로 모은다(spatial.js 머리말 참고)
import { nodeById, nodesNear } from './spatial.js';
import { rngFromState } from './rng.js';
import { normalizeAppearance, appearanceCfg, upsertMember } from './social.js';
import {
  ensurePlayer, playerMaxHp, combatSkillCfg, swingCfg, skillsCfg,
} from './skills.js';
import { creatureDefs, huntSwing, ranchOpenFor } from './ecology.js';
import { actionSwing } from './actions.js';
import { combatSwing } from './battle.js';
import { centerOf, footprint, structuresOf, isRuined, startBuild } from './structures.js';
import { isHarvestReady } from './villagers.js';
import { isFull } from './storage.js';
import { grainDays, freeBeds, recruitResident, recruitStatus } from './residents.js';
import { defaultName } from './npc.js';
import { revealAvatar } from './fog.js';
import { startResearch, RESEARCH_KEYS, onBridge, onFill } from './research.js';
import { commandUnlocked, featureUnlocked, buildingUnlocked, currentChapter, measure } from './progression.js';
import { round2 } from './economy.js';
// ★ Sprint 2 — 곧장이 막히면 길을 내서 돌아간다(주민·아바타와 같은 A*). 물가 정지 종결.
import { findPath } from './path.js';

export const companionCfg = (data) => data.companions ?? {};
const laborCfg = (data) => companionCfg(data).labor ?? {};
const brainCfg = (data) => companionCfg(data).brain ?? {};
// ★ §17-11 — 수동 지시(「이곳으로 보낸다」) 튜닝. 값은 data/companions.json 의 orders 가 정본이다.
const ordersCfg = (data) => companionCfg(data).orders ?? {};
const roleCfgOf = (data, key) => (companionCfg(data).roles ?? {})[key] ?? {};
export const autoPlayCfg = (data) => companionCfg(data).autoPlay ?? {};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ────────────────────────────────────────────────────────────────
// 상태
// ────────────────────────────────────────────────────────────────
/**
 * 이 자료판에서 동료 계층을 끈다 — **한 계층만 재는 회귀 시험**의 격리 장치다.
 * 「주민의 하루 산출 = 국고 증가분」 같은 등식은 곳간에 손을 대는 사람이 주민뿐일 때만 성립한다.
 * 동료는 창고를 나라 사람들과 함께 쓰므로, 그 등식을 재는 시험은 이 문으로 동료를 잠시 내보낸다.
 * (게임 자체의 기본값은 켬이다 — 시뮬레이터도 켠 채로 돈다.)
 */
export function disableCompanions(data) {
  data.companions = { ...(data.companions || {}), enabled: false };
  return data;
}

export function ensureCompanions(nation) {
  const st = (nation.companions ||= {});
  st.list ||= [];
  st.clock ??= 0;          // 동료 전용 단조 시계(ms) — 쿨타임 판정의 기준
  st.liveSeconds ??= 0;    // 이번 하루 중 '지켜본' 초. 일 틱이 이만큼을 하루에서 뺀다.
  st.awake ??= false;      // ★ §16-7b — 마차에서 내리기 전에는 잠들어 있다(stepCompanions 가 깨운다)
  st.rngState ??= null;
  return st;
}

/** 동료 전용 난수 — 세계 난수도 생태계 난수도 축내지 않는다(§13-C 와 같은 규율) */
function companionRng(world, nation) {
  const st = ensureCompanions(nation);
  const seed = ((world.seed >>> 0) ^ 0x2f6b1d47) >>> 0;
  const r = rngFromState(seed, st.rngState ?? undefined);
  return { r, save: () => { st.rngState = r.getState(); } };
}

export function companionById(nation, id) {
  return (nation?.companions?.list || []).find((c) => c.id === id) ?? null;
}

export function isCompanionId(nation, id) {
  return Boolean(companionById(nation, id));
}

/** 지금 이 나라에 붙어 있는 **사람**의 아바타 수 (동료는 세지 않는다) */
export function humanAvatarCount(nation) {
  let n = 0;
  for (const id of Object.keys(nation?.avatars || {})) if (!isCompanionId(nation, id)) n += 1;
  return n;
}

// ────────────────────────────────────────────────────────────────
// 자리 (정원 5인) — 사람이 들어오면 하나가 비켜 주고, 나가면 돌아온다
// ────────────────────────────────────────────────────────────────
function makeAppearance(data, r) {
  const cfg = appearanceCfg(data);
  const pick = {};
  for (const [field, spec] of Object.entries(cfg.fields)) pick[field] = r.int(0, Math.max(0, spec.count - 1));
  return normalizeAppearance(pick, data).appearance;
}

function spawnCompanion(world, nation, data, seat) {
  const cfg = companionCfg(data);
  const st = ensureCompanions(nation);
  const { r, save } = companionRng(world, nation);
  const used = new Set(st.list.map((c) => c.name));
  const pool = (cfg.names || []).filter((n) => !used.has(n));
  const name = pool.length ? r.pick(pool) : `개척자 ${seat}`;
  const appearance = makeAppearance(data, r);
  save();
  const colors = cfg.nameplateColors || ['#8fe3b4'];
  const comp = {
    id: `${cfg.idPrefix ?? 'bot~'}${seat}`,
    seat,
    name,
    appearance,
    color: colors[(seat - 1) % colors.length],
    role: null,
    active: true,
    mem: { state: 'idle', think: 0, credit: 0, target: null },
  };
  st.list.push(comp);
  return comp;
}

/** 동료를 자리에 앉힌다 — 아바타·스킬 장부·명부를 함께 연다 */
function activate(world, nation, data, comp) {
  comp.active = true;
  const town = townOf(world, nation.id);
  const avatars = (nation.avatars ||= {});
  if (!avatars[comp.id]) {
    /* ★ §16-7 — 갓 연 세상(첫날)에서는 **마차가 선 자리** 곁에 선다. 개척자와 같은 마차에서
       함께 내리는 그림(클라 오프닝이 이 자리에서 하차 연출을 잇는다). 그 뒤에는 본부 둘레에
       조금씩 흩어 세운다 — 같은 칸에 겹쳐 서면 넷이 한 사람으로 보인다. */
    const fresh = (world.tick ?? 0) === 0;
    const a = (comp.seat * 1.7) % (Math.PI * 2);
    const bx = fresh ? (town?.x ?? 0) + 3 - comp.seat * 0.5 : (town?.x ?? 0) + Math.cos(a) * 3;
    const by = fresh ? (town?.y ?? 0) + 2.6 : (town?.y ?? 0) + Math.sin(a) * 3;
    avatars[comp.id] = {
      id: comp.id, name: comp.name,
      x: clamp(Math.round(bx * 100) / 100, 1, (world.map?.size ?? 256) - 2),
      y: clamp(Math.round(by * 100) / 100, 1, (world.map?.size ?? 256) - 2),
      tick: world.tick, appearance: comp.appearance,
    };
  }
  const p = ensurePlayer(nation, comp.id, data, comp.name);
  p.bot = true;
  p.seat = comp.seat;
  /* ★ §16-7 — 첫 숨은 일할 힘이 차 있다. 갓 태어난 동료 넷이 힘이 찰 때까지(100초) 멀뚱히
     서 있던 첫인상("봇이 아무것도 안 한다")을 지운다. 하루 예산 총량은 그대로다. */
  if (comp.mem && !(comp.mem.credit > 0)) comp.mem.credit = laborCfg(data).burstMax ?? 4;
  upsertMember(nation, { avatarId: comp.id, name: comp.name, appearance: comp.appearance, online: true, bot: true }, data);
  return comp;
}

/** 자리를 비켜 준다 — 사람이 들어왔을 때. 스킬 장부와 이름은 남는다(돌아오면 그 사람 그대로다) */
function deactivate(nation, comp) {
  comp.active = false;
  comp.mem = { state: 'idle', think: 0, credit: 0, target: null };
  delete nation.avatars?.[comp.id];
  const p = nation.players?.[comp.id];
  if (p) p.downUntil = 0;
  upsertMember(nation, { avatarId: comp.id, online: false, bot: true });
  return comp;
}

/**
 * 정원 맞추기 (§15-C 멀티 심리스).
 * 자리 = seats. 사람 자리는 **최소 하나**를 늘 비워 둔다(아무도 안 붙어 있어도 그 자리는 주인의 것이다).
 * 비켜 줄 사람을 고르는 차례: 아직 자리를 안 맡은 동료 → 늦게 온 동료(자리 번호가 큰 쪽).
 */
export function syncCompanionSeats(world, nation, data) {
  const cfg = companionCfg(data);
  const st = ensureCompanions(nation);
  if (cfg.enabled === false) {
    for (const c of st.list) if (c.active) deactivate(nation, c);
    return { active: 0, want: 0 };
  }
  const seats = cfg.seats ?? 5;
  const humans = Math.max(1, humanAvatarCount(nation));
  const want = clamp(seats - humans, 0, seats);
  const active = () => st.list.filter((c) => c.active);

  while (active().length > want) {
    const list = active().sort((a, b) => (a.role ? 1 : 0) - (b.role ? 1 : 0) || b.seat - a.seat);
    deactivate(nation, list[0]);
  }
  while (active().length < want) {
    const idle = st.list.find((c) => !c.active);
    if (idle) activate(world, nation, data, idle);
    else {
      const seat = st.list.length + 1;
      if (seat > seats) break;
      activate(world, nation, data, spawnCompanion(world, nation, data, seat));
    }
  }
  // 자리에 앉은 동료의 아바타·장부가 세이브 이관 등으로 비었으면 다시 채운다
  for (const c of active()) activate(world, nation, data, c);
  return { active: active().length, want };
}

// ────────────────────────────────────────────────────────────────
// 각료 통합 (§15-C) — 「위임한 신하」와 「동료 봇」은 **같은 인물**이다
//
// 옛 구조: roles[key].holder === 'npc' 이면 이름표만 있는 유령이 그 자리를 지켰다(npc.js NPC_NAMES).
// 이제 그 유령을 지운다 — 자리를 맡은 사람은 실제로 들에 서서 일하는 동료다.
// 자리보다 동료가 적으면(솔로는 넷) 남는 자리는 옛 이름표를 그대로 쓴다: 나라는 멎지 않는다.
// ────────────────────────────────────────────────────────────────
export function bindCompanionRoles(nation, data) {
  const st = ensureCompanions(nation);
  const order = data.roles.order;
  const roles = nation.roles || {};
  const actives = st.list.filter((c) => c.active).sort((a, b) => a.seat - b.seat);

  // ① 사라진 연결을 끊는다 — 사람이 가져간 자리, 비운 자리, 물러난 동료
  for (const key of order) {
    const role = roles[key];
    if (!role) continue;
    const bound = role.botId ? companionById(nation, role.botId) : null;
    if (role.holder !== 'npc' || !bound || !bound.active) {
      if (role.botId) {
        const old = companionById(nation, role.botId);
        if (old && old.role === key) old.role = null;
        role.botId = null;
        if (role.holder === 'npc') role.name = role.name ?? defaultName(key, order.indexOf(key));
      }
    }
  }
  for (const c of actives) {
    if (c.role && (roles[c.role]?.botId !== c.id || roles[c.role]?.holder !== 'npc')) c.role = null;
  }

  // ② 빈 자리에 아직 자리 없는 동료를 앉힌다 (역할 차례대로 — 농정관부터)
  const free = actives.filter((c) => !c.role);
  for (const key of order) {
    const role = roles[key];
    if (!role || role.holder !== 'npc') continue;
    if (!role.botId && free.length) {
      const comp = free.shift();
      comp.role = key;
      role.botId = comp.id;
      role.name = comp.name;
    }
    /* 동료보다 자리가 많으면(솔로는 자리 여섯에 동료 넷) 남는 자리는 옛 이름표가 지킨다.
       그 자리가 이름 없이 비면 각료 화면에 「이름 없는 신하」가 생긴다 — 나라는 멎지 않아야 한다. */
    if (!role.name) role.name = defaultName(key, order.indexOf(key));
  }
  return roles;
}

/** 뷰·명부용 요약 */
export function companionViews(nation, data) {
  const st = nation?.companions;
  if (!st?.list?.length) return [];
  return st.list.filter((c) => c.active).map((c) => ({
    id: c.id, seat: c.seat, name: c.name, color: c.color,
    role: c.role ?? null,
    roleName: c.role ? (data.roles.defs[c.role]?.name ?? c.role) : null,
    state: c.mem?.state ?? 'idle',
    hp: round2(nation.players?.[c.id]?.hp ?? 0),
    maxHp: nation.players?.[c.id]?.maxHp ?? 0,
    down: (nation.players?.[c.id]?.downUntil ?? 0) > 0,
    /* ★ §17-11 — 동료 패널이 아바타 표를 뒤지지 않고 초상을 그리도록 외형을 함께 싣고,
       수동 지시가 걸려 있는지도 알려 준다(「지시 해제」 단추가 이 값으로 뜬다). */
    appearance: c.appearance,
    order: c.mem?.order ?? null,
  }));
}

// ────────────────────────────────────────────────────────────────
// 자동 플레이 (§15-C) — 내 아바타를 같은 두뇌가 몬다
// ────────────────────────────────────────────────────────────────
/** 켜기·끄기 / 수동 입력이 잡혔을 때의 일시 해제 */
export function setAutoPlay(nation, avatarId, data, { enabled, suspend, now = Date.now() } = {}) {
  const p = ensurePlayer(nation, avatarId, data);
  if (suspend) {
    const sec = autoPlayCfg(data).suspendSeconds ?? 30;
    p.autoPlaySuspendUntil = now + sec * 1000;
  } else if (enabled != null) {
    p.autoPlay = Boolean(enabled);
    p.autoPlaySuspendUntil = 0;
  }
  return {
    autoPlay: Boolean(p.autoPlay),
    suspendedUntil: p.autoPlaySuspendUntil || 0,
    suspendSeconds: autoPlayCfg(data).suspendSeconds ?? 30,
    active: autoPlayActive(p, now),
  };
}

export function autoPlayActive(player, now = Date.now()) {
  if (!player?.autoPlay) return false;
  return (player.autoPlaySuspendUntil || 0) <= now;
}

export function autoPlayView(nation, avatarId, data, now = Date.now()) {
  const p = nation?.players?.[avatarId];
  if (!p) return null;
  return {
    on: Boolean(p.autoPlay),
    active: autoPlayActive(p, now),
    suspendedFor: Math.max(0, Math.round(((p.autoPlaySuspendUntil || 0) - now) / 1000)),
    suspendSeconds: autoPlayCfg(data).suspendSeconds ?? 30,
  };
}

// ────────────────────────────────────────────────────────────────
// 두뇌 — 목표 고르기
// ────────────────────────────────────────────────────────────────
/* ★ Sprint 2 — 필요(need) → 노드 종류 매핑은 자료가 쥔다(data/companions.json brain.nodeKinds).
   하드코딩 시절엔 철·석탄·기름 종류가 아예 빠져 있어, 연구로 노두가 드러나도 동료는 캘 줄 몰랐다. */
const NODE_KINDS_FALLBACK = {
  wood: ['forest'],
  stone: ['rock'],
  grain: ['berry', 'fertile', 'field', 'water'],
};
const nodeKindsOf = (data) => brainCfg(data).nodeKinds ?? NODE_KINDS_FALLBACK;

export function walkable(world, data, x, y, nation = null) {
  const list = data.world.terrain.walkable || ['grass', 'forest', 'rock', 'fertile'];
  const idx = terrainIndex(data);
  const t = terrainAt(world.map, Math.round(x), Math.round(y));
  if (list.some((c) => idx[c] === t)) return true;
  /* ★ §17-13 — 다리·매립 위의 물은 **사람에게만** 길이다(avatar.walkable 과 같은 규칙).
     짐승(ecology.creatureMayStand)과 적(battle)은 이 문을 타지 않는다 — 다리를 못 쓴다. */
  return nation != null && t === idx.water && (onBridge(nation, x, y) || onFill(nation, x, y));
}

/** 이 자리의 사람이 즐겨 머무는 건물 — 공장장은 대장간 곁에서 일한다(§15-C) */
function roleAnchor(nation, data, roleKey) {
  if (!roleKey) return null;
  for (const key of roleCfgOf(data, roleKey).anchor || []) {
    const s = structuresOf(nation, key).find((x) => !isRuined(x));
    if (s) return centerOf(s.key, s.x, s.y, data);
  }
  return null;
}

function needKinds(nation, data, roleKey) {
  const out = [];
  const B = brainCfg(data);
  if (grainDays(nation, data) < (B.grainDaysUrgent ?? 6)) out.push('grain');
  for (const k of roleCfgOf(data, roleKey).prefer || []) out.push(k);
  const res = nation.resources || {};
  const stocks = ['wood', 'stone', 'grain'].sort((a, b) => (res[a] || 0) - (res[b] || 0));
  out.push(...stocks);
  /* ★ Sprint 2 — 꼬리 수요. 기본 재고를 다 본 뒤에는 광물도 캔다(노두가 드러난 뒤의 이야기 —
     skills 규격·저장 상한은 nodeUsable 이 그대로 거른다). 이게 없으면 「부족한 게 없다 → rest」였다. */
  out.push(...(B.extraKinds ?? []));
  return [...new Set(out)];
}

/**
 * 이 노드를 지금 두드릴 수 있는가 — 드러났는가 · 남았는가 · 여물었는가 · 곳간에 자리가 있는가.
 * @param {Set<string>|null} fullSet 이미 가득 찬 자원들. 후보를 훑을 때 한 번만 재고 돌려 쓴다
 *   (isFull 은 건물 효과를 훑어 상한을 내므로 노드마다 부르면 하루가 수천 번이 된다).
 */
function nodeUsable(world, nation, data, node, fullSet = null) {
  if (!node || node.hidden || node.depleted) return false;
  if (node.concealed && !node.revealed) return false;
  const spec = skillsCfg(data).nodes[node.type];
  if (!spec) return false;
  // ★ 밭 계열은 여물어야 거둔다 — 사람과 같은 판정을 그대로 쓴다(actions.swingNode)
  if (spec.requiresRipe && !isHarvestReady(node, data, world.tick)) return false;
  const wanted = [...new Set([...Object.keys(spec.yield || {}), ...Object.keys(spec.cycleBonus || {})])];
  const full = fullSet ?? new Set(data.resources.order.filter((r) => isFull(nation, r, data)));
  if (wanted.length && wanted.every((r) => full.has(r))) return false;
  return true;
}

/**
 * 캘 자리 고르기.
 * ★ 자리 번호(seat)만큼 **다른 후보**를 집는다 — 안 그러면 넷이 같은 나무 하나에 붙어 선다.
 * ★ 안개는 건드리지 않는다: 동료는 이미 드러난 자리만 캔다(정찰은 사람의 몫이다).
 */
function pickNode(world, nation, data, actor, av, roleKey) {
  const B = brainCfg(data);
  const town = townOf(world, nation.id);
  if (!town) return null;
  const reach = territoryRadius(nation, data) + (B.workRadiusBonus ?? 26);
  const anchor = roleAnchor(nation, data, roleKey) ?? { x: av.x, y: av.y };
  const seat = actor.comp?.seat ?? 0;
  const fullSet = new Set(data.resources.order.filter((r) => isFull(nation, r, data)));
  /* ★ Sprint 3 — 필요 종류마다 지도의 노드 5,000개를 통째로 훑던 자리(동료 넷 × 종류 대여섯).
     이제 본영 둘레 reach 안의 후보만 묻는다. 색인은 **원래 배열 차례**를 지켜 돌려주므로,
     아래의 거리 정렬(안정 정렬)과 자리 번호 나눔(top[seat % top.length])이 옛 값과 같은 것을 고른다. */
  const nearby = nodesNear(world, town.x, town.y, reach);
  for (const kind of needKinds(nation, data, roleKey)) {
    const types = nodeKindsOf(data)[kind] || [];
    const cands = [];
    for (const n of nearby) {
      if (!types.includes(n.type)) continue;
      if (dist(n.x, n.y, town.x, town.y) > reach) continue;
      if (!nodeUsable(world, nation, data, n, fullSet)) continue;
      cands.push({ n, d: dist(n.x, n.y, anchor.x, anchor.y) });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => a.d - b.d);
    const top = cands.slice(0, Math.max(1, B.maxNodeCandidates ?? 12));
    return top[seat % top.length].n;
  }
  return null;
}

/** 동료가 손을 보태도 되는 공사인가 — **짓는 일과 개축**뿐이다 */
function joinableSite(s) {
  if (!s || (s.remaining ?? 0) <= 0) return false;
  const mode = s.mode ?? (s.structureId ? 'upgrade' : 'build');
  /* ★ 헐기·옮기기에는 손대지 않는다. 그것은 주인의 결정이고, 마음이 바뀌면 되돌릴 수 있어야 한다
     — 동료가 함께 두드리면 「그만둔다」를 누르기도 전에 건물이 사라진다(실제로 하니스가 잡아냈다). */
  return mode === 'build' || mode === 'upgrade';
}

/**
 * @param anySeat ★ Sprint 2 — 캘 것도 없이 손이 빌 때는 자리 홀짝을 따지지 않는다.
 *   (옛 규칙: 짝수 자리는 공사를 무시 — 그 절반이 「공사장 옆에서 쉬는 봇」으로 보였다)
 */
function pickSite(nation, data, actor, roleKey, anySeat = false) {
  const sites = (nation.construction || []).filter(joinableSite);
  if (!sites.length) return null;
  const seat = actor.comp?.seat ?? 0;
  // 사람의 자동 플레이와 건축가는 언제나 망치를 든다. 나머지는 절반이 붙는다 — 살림도 굴러가야 한다.
  const always = anySeat || !actor.comp || roleCfgOf(data, roleKey).siteFirst;
  if (!always && seat % 2 === 0) return null;
  return sites[seat % sites.length];
}

function nearestPredator(world, nation, data, av) {
  const defs = creatureDefs(data);
  const B = brainCfg(data);
  let best = null;
  let bd = B.engageRadius ?? 10;
  for (const c of nation.wild?.creatures || []) {
    const def = defs[c.sp];
    if (!def || def.kind !== 'predator') continue;
    const d = dist(c.x, c.y, av.x, av.y);
    if (d <= bd) { bd = d; best = { c, d }; }
  }
  return best;
}

/**
 * ★ §16-5 — 사냥감 고르기. 곳간의 곡물이 마르면 들의 온순한 짐승을 사냥해 고기를 채운다
 * (고기 1 = 곡물 3). 목장이 거둔 가축은 건드리지 않고(§15-A-3 터렛과 같은 규칙),
 * 본부에서 너무 먼 놈은 쫓지 않는다(creatureLeash) — 사냥 갔다가 사나운 띠로 끌려가지 않게.
 */
function nearestPrey(world, nation, data, av, town) {
  const defs = creatureDefs(data);
  const B = brainCfg(data);
  const leash = B.creatureLeash ?? 26;
  let best = null;
  let bd = B.huntRadius ?? 24;
  for (const c of nation.wild?.creatures || []) {
    const def = defs[c.sp];
    if (!def || def.kind !== 'animal') continue;
    if (ranchOpenFor(world, nation, data, c.sp, c.x, c.y)) continue;   // 목장의 가축은 잡지 않는다
    if (town && dist(c.x, c.y, town.x, town.y) > leash) continue;
    const d = dist(c.x, c.y, av.x, av.y);
    if (d <= bd) { bd = d; best = { c, d }; }
  }
  return best;
}

function nearestEnemy(battle, x, y) {
  let best = null;
  let bd = Infinity;
  for (const e of battle.enemies || []) {
    if (e.alive === false) continue;
    const d = dist(e.x, e.y, x, y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function decide(world, nation, data, actor, player, av, opts = {}) {
  const B = brainCfg(data);
  const town = townOf(world, nation.id);
  const roleKey = actor.comp?.role ?? null;
  const rc = roleCfgOf(data, roleKey);

  /* ⓪ ★ §17-11 — **주인의 손가락이 가장 먼저다.** 동료를 눌러 내린 수동 지시(「이곳으로 보낸다」)는
     두뇌의 어떤 갈래(경계·도주·사냥·공사·채집)보다 앞선다 — 지시를 내렸는데 제멋대로 딴 데로 가면
     "상호작용과 지시가 되지 않음"이라는 피드백 그대로가 된다. 찍은 자리에 닿으면(arriveTiles)
     그 자리에서 **지시 대기(hold)** 로 선다 — 지시를 걷거나 새로 내릴 때까지 떠나지 않는다.
     걷는 데는 하루 예산을 쓰지 않는다(예산은 스윙에만 매인다 — driveActor 의 costly 판정). */
  const order = actor.comp?.mem?.order;
  if (order && order.kind === 'move') {
    const arrive = ordersCfg(data).arriveTiles ?? 1.2;
    if (dist(av.x, av.y, order.x, order.y) <= arrive) return { kind: 'hold', x: order.x, y: order.y };
    return { kind: 'move', x: order.x, y: order.y };
  }

  /* ★ workOnly — 일 틱(아무도 안 보는 시간)의 몫. 그 시각에는 짐승도 웨이브도 제 계층이 따로 굴린다
     (stepEcologyDay · battle). 여기서까지 싸우게 하면 한 사람의 칼이 두 번 세어진다. 일만 한다. */
  if (!opts.workOnly) {
    // ① 다쳤으면 모닥불로 물러난다 — 거기서 기운이 돈다(skills.combat.restHealPerSecond)
    const maxHp = playerMaxHp(player, data);
    const ratio = (player.hp ?? maxHp) / Math.max(1, maxHp);
    const mem = opts.mem || {};
    /* ★ Sprint 2 — 회복 이력(히스테리시스). 0.35 문턱 하나만 있으면 0.36 에서 다시 나가
       두 걸음 만에 또 쓰러진다 — returnHpRatio(0.75, 선언만 되고 아무도 안 읽던 다이얼)까지
       회복해야 다시 나간다. 전투 중에는 옛 규칙 그대로다(자리를 비우면 그만큼 뚫린다). */
    if (ratio < (B.fleeHpRatio ?? 0.35)) mem.recovering = true;
    if (mem.recovering && ratio >= (B.returnHpRatio ?? 0.75)) mem.recovering = false;

    // ② 웨이브 — 몰려온 것들과 싸운다(combatSwing 규칙 동일). 성녀는 본부를 지킨다.
    const b = nation.battle;
    if (b && !b.over) {
      if (rc.timid || ratio < (B.fleeHpRatio ?? 0.35)) {
        return town ? { kind: 'rest', x: town.x, y: town.y } : null;
      }
      const e = nearestEnemy(b, av.x, av.y);
      if (e) return { kind: 'enemy', id: e.id };
      return town ? { kind: 'rest', x: town.x, y: town.y } : null;
    }
    if (mem.recovering && town) return { kind: 'rest', x: town.x, y: town.y };

    /* ③-0 ★ §16-19 — 수비 깃발. 국방을 맡은 이는 깃발 곁을 지킨다(위협·웨이브가 없을 때). */
    if (rc.guard && nation.defenseFlag && !nearestPredator(world, nation, data, av)) {
      return { kind: 'rest', x: nation.defenseFlag.x, y: nation.defenseFlag.y };
    }

    // ③ 들의 것 — 국방을 맡은 이는 맞서고, 그 밖은 코앞까지 왔을 때만 든다
    const threat = nearestPredator(world, nation, data, av);
    if (threat) {
      const danger = B.dangerRadius ?? 8;
      if (rc.guard || threat.d <= danger * 0.6) return { kind: 'creature', id: threat.c.id };
      if (threat.d <= danger) return { kind: 'flee', x: threat.c.x, y: threat.c.y };
    }

    /* ③-b 짐을 지고 돌아간다 — 하루 예산을 다 쓴 참.
       가만히 서서 힘이 차기를 기다리게 두면 「고장 난 사람」으로 보인다.
       거둔 것을 곳간에 부리러 걸어가는 그림이 곧 쉬는 시간의 얼굴이다(§14-1 운반 연출과 같은 뜻).
       ★ 싸움보다 **뒤에** 둔다: 예산은 노동의 다이얼이지 「칼을 놓아라」가 아니다(웨이브가 먼저다). */
    if (opts.hauling && town) return { kind: 'haul', x: town.x, y: town.y };

    /* ③-c ★ §16-5 — 고기 사냥. 곡물이 며칠치 안 남았고 고기 곳간에 자리가 있으면
       들의 짐승을 사냥해 온다(고기 1 = 곡물 3 — 식량 위기의 실질적인 완충이다).
       사냥 갈래가 열린 뒤부터다(3장 '허기') — 잠긴 것은 부재다(§11-1). */
    if (featureUnlocked(nation, 'hunt', data)
      && grainDays(nation, data) < (B.huntGrainDays ?? 5)
      && !isFull(nation, 'meat', data)) {
      const prey = nearestPrey(world, nation, data, av, town);
      if (prey) return { kind: 'creature', id: prey.c.id };
    }
  }

  /* ③-d ★ Sprint 2 — 하루 예산(크레딧)이 비었다. 서서 기다리는 대신 **걷는다**:
     일터와 곳간 사이를 오간다(순찰). 스윙은 없으니 경제 총량은 크레딧이 그대로 지키고,
     「봇이 아무것도 안 한다」의 최대 체감 원인(하루의 ~90%를 노드 옆에 서 있기)이 사라진다. */
  if (opts.lowCredit && !opts.workOnly && town) {
    const nearTown = dist(av.x, av.y, town.x, town.y) <= (B.restNearTownRadius ?? 4);
    if (!nearTown) return { kind: 'patrol', x: town.x, y: town.y };
    const spot = pickNode(world, nation, data, actor, av, roleKey);
    if (spot) return { kind: 'patrol', x: spot.x, y: spot.y };
    return { kind: 'rest', x: town.x, y: town.y };
  }

  // ④ 공사장
  const site = pickSite(nation, data, actor, roleKey);
  if (site) return { kind: 'site', id: site.id };

  // ⑤ 부족한 것을 캔다
  const node = pickNode(world, nation, data, actor, av, roleKey);
  if (node) return { kind: 'node', id: node.id };

  /* ⑥ ★ Sprint 2 — rest 로 끝나던 사다리의 마지막 계단. 캘 것이 없어 손이 빌 때는
     자리 홀짝을 접고 공사라도 돕는다(RimWorld 폴백 사다리 — 유휴는 마지막 수단이다). */
  const anySite = pickSite(nation, data, actor, roleKey, true);
  if (anySite) return { kind: 'site', id: anySite.id };

  return town ? { kind: 'rest', x: town.x, y: town.y } : null;
}

function targetValid(world, nation, data, tgt) {
  if (!tgt) return false;
  switch (tgt.kind) {
    case 'node': {
      // ★ Sprint 3 — 옛 find 는 동료 넷 × 1초마다 노드 5,000개를 훑었다
      const n = nodeById(world, tgt.id);
      return nodeUsable(world, nation, data, n);
    }
    case 'site': return (nation.construction || []).some((s) => s.id === tgt.id && joinableSite(s));
    case 'creature': return (nation.wild?.creatures || []).some((c) => c.id === tgt.id);
    case 'enemy': {
      const b = nation.battle;
      if (!b || b.over) return false;
      return (b.enemies || []).some((e) => e.id === tgt.id && e.alive !== false);
    }
    case 'rest':
    case 'haul':
    case 'flee':
    /* ★ Sprint 2 — 순찰도 좌표라 늘 유효하다(닿으면 driveActor 가 비우고 다시 고른다) */
    case 'patrol':
    /* ★ §17-11 — 수동 지시 자리는 좌표라 늘 유효하다. 지시가 걷히면 commands 가 target 을
       비우고 think 를 0으로 되돌려 다음 걸음에 곧바로 다시 고른다. */
    case 'move':
    case 'hold': return true;
    default: return false;
  }
}

function aimPoint(world, nation, data, tgt) {
  switch (tgt.kind) {
    case 'node': {
      const n = nodeById(world, tgt.id);           // ★ Sprint 3 — targetValid 와 같은 색인
      return n ? { x: n.x, y: n.y } : null;
    }
    case 'site': {
      const s = (nation.construction || []).find((x) => x.id === tgt.id);
      return s ? centerOf(s.building, s.x, s.y, data) : null;
    }
    case 'creature': {
      const c = (nation.wild?.creatures || []).find((x) => x.id === tgt.id);
      return c ? { x: c.x, y: c.y } : null;
    }
    case 'enemy': {
      const e = (nation.battle?.enemies || []).find((x) => x.id === tgt.id);
      return e ? { x: e.x, y: e.y } : null;
    }
    default: return { x: tgt.x, y: tgt.y };
  }
}

function reachOf(data, nation, tgt) {
  const c = combatSkillCfg(data);
  switch (tgt.kind) {
    case 'node': return (swingCfg(data).rangeTiles ?? 3) - 0.4;
    case 'site': {
      const s = (nation.construction || []).find((x) => x.id === tgt.id);
      const fp = s ? footprint(s.building, data) : { w: 1, h: 1 };
      return (swingCfg(data).rangeTiles ?? 3) - 0.4 + Math.max(fp.w, fp.h) / 2;
    }
    case 'creature': return (c.huntRangeTiles ?? 2.8) - 0.5;
    case 'enemy': return (c.rangeTiles ?? 2.5) - 0.5;
    case 'rest': return brainCfg(data).restNearTownRadius ?? 4;
    case 'haul': return laborCfg(data).carryHomeRadius ?? 2.5;
    /* ★ Sprint 2 — 순찰 도착 판정. 닿으면 반대편(곳간↔일터)으로 되돈다 */
    case 'patrol': return brainCfg(data).patrolArriveTiles ?? 1.5;
    /* ★ §17-11 — 지시받은 자리는 코앞까지 걸어간다(쉼터의 4타일 여유를 쓰지 않는다) */
    case 'move':
    case 'hold': return ordersCfg(data).arriveTiles ?? 1.2;
    default: return 0.5;
  }
}

// ────────────────────────────────────────────────────────────────
// 한 사람의 한 걸음
// ────────────────────────────────────────────────────────────────
/* ★ Sprint 2 — 막혔을 때의 길 기억. 아바타 객체는 저장 스냅샷에 실리므로 길을 그 몸에 얹지 않고
   여기(파생 캐시)에 둔다 — 틱 복제(structuredClone)로 몸이 갈리면 캐시도 새로 낸다. */
const avPaths = new WeakMap();

function stepAvatar(world, nation, data, av, tx, ty, step) {
  const dx = tx - av.x;
  const dy = ty - av.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001 || step <= 0) return false;
  const k = Math.min(step, d);
  const size = world.map?.size ?? data.world.size;
  const nx = clamp(av.x + (dx / d) * k, 1, size - 2);
  const ny = clamp(av.y + (dy / d) * k, 1, size - 2);
  if (walkable(world, data, nx, ny, nation)) {
    avPaths.delete(av);
    av.x = round2(nx); av.y = round2(ny);
    return true;
  }
  /* ★ Sprint 1 — 미끄러짐은 **실제로 나아갈 때만** 성공이다. 목표가 축과 나란하면(ny === av.y)
     「지금 서 있는 칸이 밟을 만한가」를 되묻는 꼴이라 늘 참이 되고, 한 발짝도 못 가면서
     true 를 돌려 물가에서 영원히 제자리 걸음을 했다(아바타·주민과 같은 결함의 봇 판). */
  if (Math.abs(nx - av.x) > 1e-6 && walkable(world, data, nx, av.y, nation)) { av.x = round2(nx); return true; }
  if (Math.abs(ny - av.y) > 1e-6 && walkable(world, data, av.x, ny, nation)) { av.y = round2(ny); return true; }
  /* ★ Sprint 2 — 곧장도 미끄러짐도 막혔다: 호수가 앞을 가로막았다. 주민과 같은 A* 로 길을 내고
     (목표가 그대로면 캐시를 따라간다), 그 길의 다음 웨이포인트로 걷는다 — 물가 정지 종결. */
  const key = `${Math.round(tx)},${Math.round(ty)}`;
  let pc = avPaths.get(av);
  if (!pc || pc.key !== key) {
    pc = { key, path: findPath(world, nation, data, av.x, av.y, tx, ty), i: 1 };
    avPaths.set(av, pc);
  }
  if (!pc.path) return false;
  while (pc.i < pc.path.length
    && dist(av.x, av.y, pc.path[pc.i].x, pc.path[pc.i].y) < 0.15) pc.i += 1;
  if (pc.i >= pc.path.length) { avPaths.delete(av); return false; }
  const wp = pc.path[pc.i];
  const wd = dist(av.x, av.y, wp.x, wp.y);
  const wk = Math.min(step, wd) / Math.max(0.001, wd);
  const px = clamp(av.x + (wp.x - av.x) * wk, 1, size - 2);
  const py = clamp(av.y + (wp.y - av.y) * wk, 1, size - 2);
  if (!walkable(world, data, px, py, nation)) { avPaths.delete(av); return false; }
  av.x = round2(px);
  av.y = round2(py);
  return true;
}

/** 목표에 손이 닿았다 — 사람과 **같은 함수**를 부른다 */
function act(world, nation, data, actor, player, tgt, now, out) {
  const id = actor.id;
  let res = null;
  let type = 'actionSwing';
  if (tgt.kind === 'node') {
    res = actionSwing(world, nation, { nodeId: tgt.id, avatarId: id, playerName: player.name }, data, now);
  } else if (tgt.kind === 'site') {
    res = actionSwing(world, nation, { siteId: tgt.id, avatarId: id, playerName: player.name }, data, now);
  } else if (tgt.kind === 'creature') {
    type = 'combatSwing';
    res = huntSwing(world, nation, { targetId: tgt.id, avatarId: id, playerName: player.name }, data, now);
  } else if (tgt.kind === 'enemy') {
    type = 'combatSwing';
    res = combatSwing(world, nation, { targetId: tgt.id, avatarId: id, playerName: player.name }, data, now);
  } else return false;
  if (!res?.ok) return false;
  const { events, ...rest } = res;
  out.actions.push({ avatarId: id, type, ...rest });
  if (events?.length) out.events.push(...events);
  return true;
}

/**
 * 한 사람(동료 또는 자동 플레이 중인 사람)의 한 걸음.
 * @param {{id, comp, now, budgeted, human}} actor
 */
function driveActor(world, nation, data, actor, dt, out) {
  const player = ensurePlayer(nation, actor.id, data, actor.comp?.name ?? null);
  const av = nation.avatars?.[actor.id];
  if (!av) return;
  const mem = actor.comp ? (actor.comp.mem ||= {}) : (player.auto ||= {});
  if ((player.downUntil || 0) > 0) { mem.state = 'down'; mem.target = null; return; }

  // 하루 예산 — 동료만 매인다. 자동 플레이는 사람의 아바타라 쿨타임만이 뚜껑이다.
  const L = laborCfg(data);
  if (actor.budgeted) {
    const perSec = (L.swingsPerDay ?? 0) / Math.max(1, data.balance.time.dayRealSeconds);
    mem.credit = Math.min(L.burstMax ?? 5, (mem.credit || 0) + perSec * dt);
    /* ★ §16-7 — 리듬 개편. 옛 규칙(힘이 빌 때마다 곳간으로 돌아가 다 찰 때까지 서 있기)은
       하루 예산의 대부분을 **모닥불 곁에 멀뚱히 선 사람**으로 그렸다 — "봇이 아무것도 안 한다"의
       정체다. 이제 힘이 달리면 **일터 곁에서** 숨을 고른다(「캐는 중」 자세 그대로), 그리고
       몇 번 캘 때마다(haulEverySwings) 한 번씩 짐을 지고 곳간을 다녀온다 — 쉼의 그림은 남기되
       그 그림이 하루를 잡아먹지 않는다. 예산(swingsPerDay)은 그대로다. */
    const per = Math.max(1, L.haulEverySwings ?? 4);
    if (!mem.hauling && (mem.sinceHaul || 0) >= per) { mem.hauling = true; mem.target = null; }
  }

  mem.think = (mem.think || 0) - dt;
  if (mem.think <= 0 || !targetValid(world, nation, data, mem.target)) {
    mem.target = decide(world, nation, data, actor, player, av, {
      hauling: Boolean(mem.hauling),
      /* ★ Sprint 2 — 크레딧이 비면 두뇌가 안다: 캐기 대신 순찰(걷는 그림)을 고른다 */
      lowCredit: Boolean(actor.budgeted) && (mem.credit || 0) < 1,
      mem,
    });
    mem.think = brainCfg(data).decideEverySeconds ?? 3;
  }
  const tgt = mem.target;
  if (!tgt) { mem.state = 'idle'; return; }
  mem.state = tgt.kind;

  /* ★ 안개 — **사람의 아바타를 몰 때만** 걸음이 땅을 밝힌다(자동 플레이는 내 발걸음이다).
     동료의 발걸음은 안개를 걷지 않는다: 정찰은 사람의 몫이고, 넷이 흩어져 걸으면
     지도가 저절로 다 열려 「무엇을 아직 못 봤는가」가 사라진다. */
  const walked = (moved) => {
    if (!moved) return;
    out.moved += 1;
    av.tick = world.tick;
    if (!actor.human) return;
    const got = revealAvatar(nation, data, world.tick, Math.round(av.x), Math.round(av.y), actor.id);
    if (got?.length) out.revealed.push(...got);
  };

  const speed = (L.moveTilesPerSecond ?? 4) * dt;
  if (tgt.kind === 'flee') {
    const ax = av.x - (tgt.x - av.x);
    const ay = av.y - (tgt.y - av.y);
    walked(stepAvatar(world, nation, data, av, ax, ay, speed));
    return;
  }

  const aim = aimPoint(world, nation, data, tgt);
  if (!aim) { mem.target = null; return; }
  const reach = reachOf(data, nation, tgt);
  if (dist(av.x, av.y, aim.x, aim.y) > reach) {
    walked(stepAvatar(world, nation, data, av, aim.x, aim.y, speed));
    return;
  }
  if (tgt.kind === 'haul') {
    /* ★ §16-7 — 짐을 부렸다. 다음 결정에서 곧장 일터로 돌아간다(서 있지 않는다). */
    mem.sinceHaul = 0;
    mem.hauling = false;
    mem.target = null;
    mem.think = 0;
    return;
  }
  if (tgt.kind === 'rest') return;   // 다다랐으면 그 자리에서 숨을 고른다
  /* ★ Sprint 2 — 순찰 지점에 닿았다. 다음 결정이 반대편(곳간↔일터)을 고른다 — 걸음이 끊기지 않는다. */
  if (tgt.kind === 'patrol') { mem.target = null; mem.think = 0; return; }
  /* ★ §17-11 — 지시받은 자리에 닿았다. 다음 결정이 곧 「지시 대기(hold)」다 — think 를 비워
     명부의 상태가 한 박자 안에 갈아입게 한다. hold 는 그 자리를 지키는 것이 일이다. */
  if (tgt.kind === 'move') { mem.target = null; mem.think = 0; return; }
  if (tgt.kind === 'hold') return;
  /* ★ 하루 예산은 **노동**에만 매인다(캐기·짓기). 칼은 매이지 않는다 —
     예산은 경제를 흔들지 않으려고 둔 다이얼이지 「싸우지 말라」는 규칙이 아니다.
     웨이브 한복판에서 힘이 다해 서 있는 동료는 자리를 채운 것이 아니라 비운 것이다. */
  const costly = tgt.kind === 'node' || tgt.kind === 'site';
  if (actor.budgeted && costly && (mem.credit || 0) < 1) {
    /* ★ Sprint 2(§16-7 의 완성) — 일터 곁에서 **서서** 기다리던 시간이 「봇이 논다」의 정체였다.
       목표를 비우고 곧장 다시 고른다 — lowCredit 갈래가 순찰(걷는 그림)을 돌려준다. */
    mem.target = null;
    mem.think = 0;
    return;
  }
  if (act(world, nation, data, actor, player, tgt, actor.now, out)) {
    if (actor.budgeted && costly) {
      mem.credit = Math.max(0, (mem.credit || 0) - 1);
      mem.sinceHaul = (mem.sinceHaul || 0) + 1;
    }
  }
}

/**
 * ★ §15-C-4 — 자동 플레이의 「연구 우선순위」.
 *
 * 손이 남는 사람은 붙들 것을 붙든다. 다만 여기서 셈을 새로 하지 않는다 —
 * `startResearch` 가 선행·티어·값을 스스로 판정하고 안 되면 오류를 돌려주므로,
 * **차례대로 한 번씩 청해 보고 처음 되는 것**을 잡는다(연구표의 차례가 곧 우선순위다).
 * 장 사슬의 문(commandUnlocked)은 그대로 지킨다 — 사람이 못 여는 것을 대신 열지 않는다.
 * 동료에게는 시키지 않는다: 무엇을 연구할지는 나라의 결정이고, 그것은 사람의 몫이다.
 */
function autoResearch(world, nation, data) {
  if (autoPlayCfg(data).researchWhenIdle === false) return null;
  if (nation.research?.active) return null;
  if (!commandUnlocked(nation, 'startResearch', data)) return null;
  for (const key of RESEARCH_KEYS(data)) {
    const res = startResearch(world, nation, { key }, data);
    if (res?.ok) return res;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// ★ §16-6 — 집사(steward): 자동 플레이·동료가 나라 살림도 본다
//
// 피드백: "자동을 켜도 캐기만 하고 가만히 있는다 — 채집도 하고 **건설도 하고 사람도 모으고**
// 사냥도 하는 수준을 원한다." 손(스윙)은 이미 있으니, 여기서는 **머리**를 보탠다:
//   · 잠자리가 다 찼으면 집을 한 채 앉힌다(사람은 빈 잠자리가 있어야 걸어온다)
//   · 곳간이 넘치면 저장고를 앉힌다(가득 찬 곳간은 채집을 통째로 멈춰 세운다)
//   · 식량이 넉넉하고 모집이 열려 있으면 사람을 부른다(본부 [모집]과 같은 함수·같은 값)
//
// 규율 셋:
//   ① **사람과 같은 문을 지난다** — buildingUnlocked·commandUnlocked·startBuild(autoSpot)·
//      recruitResident 를 그대로 탄다. 여기서 셈을 새로 하지 않는다.
//   ② **동료 단독으로는 장 사슬을 앞지르지 않는다** — 동료만 있을 때는 botsFromChapter(8장,
//      첫 웨이브 뒤)부터만 살림을 본다. 튜토리얼의 「처음 세워 보세요」는 사람의 몫이다.
//      자동 플레이는 사람이 스스로 켠 손이므로 장만 열려 있으면 언제든 본다.
//   ③ **곳간을 비우지 않는다** — 값의 costReserve 배가 있을 때만 짓는다. 한 번에 한 현장만.
// ────────────────────────────────────────────────────────────────
const stewardCfg = (data) => companionCfg(data).steward ?? {};

/** 조건 나무에서 「건물 조건」만 골라낸다 — all/any 는 안으로 들어간다 */
function structureGoals(cond, out = []) {
  if (!cond) return out;
  if (cond.type === 'structure' && cond.building) out.push(cond);
  if ((cond.type === 'all' || cond.type === 'any') && Array.isArray(cond.of)) {
    for (const c of cond.of) structureGoals(c, out);
  }
  return out;
}

function stewardBuildKey(world, nation, data, { auto } = {}) {
  const S = stewardCfg(data);
  const reserve = S.costReserve ?? 1.3;
  const afford = (key) => {
    const cost = data.buildings[key]?.tiers?.[0]?.cost || {};
    return Object.entries(cost).every(([r, n]) => (nation.resources?.[r] || 0) >= n * reserve);
  };
  const usable = (key) => data.buildings[key] && buildingUnlocked(nation, key, data) && afford(key);
  /* ⓪ ★ §16-7 — **장 목표부터.** 자동 플레이는 사람이 켠 손이므로 지금 장의 목표 카드가
     「오두막을 지으세요」라면 그것을 짓는다 — 이게 없으면 자동이 3장에서 영영 멈춰 선다.
     (동료 단독에는 주지 않는다 — 튜토리얼은 사람의 몫이라는 §16-6 규율 그대로다.) */
  if (auto) {
    const ch = currentChapter(nation, data);
    for (const st of ch?.steps ?? []) {
      for (const g of structureGoals(st.condition)) {
        const m = measure(world, nation, g, data);
        if (m && m.have >= m.need) continue;
        if ((nation.construction || []).some((c) => c.building === g.building)) continue;
        if (usable(g.building)) return g.building;
      }
    }
  }
  // ① 잠자리 — 빈 자리가 없으면 사람이 더 오지 않는다. 지을 수 있는 것 중 가장 좋은 집부터.
  if (freeBeds(nation, data) < 1) {
    for (const key of S.housing ?? ['manor', 'house', 'hut', 'tent']) if (usable(key)) return key;
  }
  // ② 곳간 — 하나라도 가득 찼으면 저장고. (가득 찬 자원은 채집 대상에서 빠지므로 손이 논다)
  const full = (S.watchResources ?? ['wood', 'stone', 'grain']).some((r) => isFull(nation, r, data));
  if (full) {
    for (const key of S.storage ?? ['storage', 'storage_crate']) if (usable(key)) return key;
  }
  return null;
}

function stewardStep(world, nation, data, out, opts = {}) {
  const S = stewardCfg(data);
  if (S.enabled === false) return;
  // 사람 모으기 — 식량이 넉넉할 때만(모자란 살림에 입을 늘리지 않는다)
  if (commandUnlocked(nation, 'recruitResident', data)
    && grainDays(nation, data) >= (S.recruitGrainDays ?? 4)
    && recruitStatus(world, nation, data).open) {
    const { r, save } = companionRng(world, nation);
    const res = recruitResident(world, nation, data, r);
    save();
    if (res.ok) {
      out.stateDirty = true;
      out.events.push({
        kind: 'resident_arrived', nationId: nation.id,
        data: {
          id: res.resident.id, name: res.resident.name, x: res.resident.x, y: res.resident.y,
          stats: { ...res.resident.stats }, population: Math.floor(nation.population || 0),
          recruited: true,
        },
      });
    }
  }
  // 건설 — 이미 두드릴 현장이 있으면 손을 더 벌리지 않는다(동료들이 그리로 간다)
  const open = (nation.construction || []).filter(joinableSite).length;
  if (open >= (S.maxOpenSites ?? 1)) return;
  if (!commandUnlocked(nation, 'placeBuilding', data)) return;
  const key = stewardBuildKey(world, nation, data, opts);
  if (!key) return;
  const res = startBuild(world, nation, { building: key }, data);   // 좌표 없는 착공 — autoSpot 이 자리를 잡는다
  if (res.ok) out.stateDirty = true;
}

/**
 * 저빈도(1초) 한 걸음 — server/index.js 의 생태계 루프가 부른다.
 * @returns {{moved, actions, events, avatars}} 방에 흘릴 재료
 */
export function stepCompanions(world, nation, data, dt = 1, opts = {}) {
  const out = { moved: 0, actions: [], events: [], revealed: [], avatars: false };
  if (!nation?.isPlayer) return out;
  const cfg = companionCfg(data);
  const st = ensureCompanions(nation);
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
  if (cfg.enabled === false) return out;

  /* ★ §16-7b — **마차에서 내리기 전에는 아무도 움직이지 않는다.**
     피드백: "봇들이 마차에서 내리기 전부터 자원을 캔다 — 내리고 나서 그 자리에서부터 시작해야 한다."
     갓 연 세상(tick 0)에서는 사람의 첫 발걸음(lordMove — 하차 순간 클라가 보낸다)이 닿기 전까지
     동료도 잠들어 있다. 하루가 지나면(일 틱) 어차피 깬다 — 방치해도 세상이 영영 멎지는 않는다. */
  if (!st.awake) {
    st.awake = (world.tick ?? 0) > 0 || humanAvatarCount(nation) > 0;
    if (!st.awake) return out;
  }

  st.clock = (st.clock || 0) + dt * 1000;
  st.liveSeconds = (st.liveSeconds || 0) + dt;

  for (const comp of st.list) {
    if (!comp.active) continue;
    driveActor(world, nation, data, { id: comp.id, comp, now: st.clock, budgeted: true, human: false }, dt, out);
  }

  // ★ 자동 플레이 — 켠 사람의 아바타를 같은 두뇌가 몬다(사람의 시계로 판정한다)
  const now = opts.now ?? Date.now();
  let anyAuto = false;
  for (const p of Object.values(nation.players || {})) {
    if (p.bot) continue;
    if (!autoPlayActive(p, now)) continue;
    if (!nation.avatars?.[p.id]) continue;
    anyAuto = true;
    driveActor(world, nation, data, { id: p.id, comp: null, now, budgeted: false, human: true }, dt, out);
  }
  /* 연구는 손이 아니라 머리가 하는 일이라 걸음과 따로 센다 — 몇 초에 한 번만 들여다본다 */
  if (anyAuto) {
    st.researchAt = (st.researchAt || 0) - dt;
    if (st.researchAt <= 0) {
      st.researchAt = autoPlayCfg(data).researchEverySeconds ?? 15;
      const got = autoResearch(world, nation, data);
      if (got?.events?.length) out.events.push(...got.events);
      if (got) out.research = got.research ?? got;
    }
  }
  /* ★ §16-6 — 집사. 자동 플레이가 켜져 있으면 언제나, 동료만 있을 때는 8장(첫 웨이브 뒤)부터. */
  const botsMayManage = (currentChapter(nation, data)?.id ?? 1) >= (stewardCfg(data).botsFromChapter ?? 8);
  if (anyAuto || (botsMayManage && st.list.some((c) => c.active))) {
    st.stewardAt = (st.stewardAt || 0) - dt;
    if (st.stewardAt <= 0) {
      st.stewardAt = stewardCfg(data).everySeconds ?? 6;
      stewardStep(world, nation, data, out, { auto: anyAuto });
    }
  }
  out.avatars = out.moved > 0;
  return out;
}

/**
 * 일 틱 몰아 돌리기 — **안 본 만큼만**.
 * 걷는 데도 하루가 든다(§13-B-2 와 같은 환산): 자리를 옮기면 그만큼 예산에서 깎는다.
 * 그래서 「지켜보면 손해 / 방치하면 이득」이 생기지 않는다.
 */
export function stepCompanionsDay(world, nation, data) {
  const out = { swings: 0, byKind: {} };
  if (!nation?.isPlayer) return out;
  const cfg = companionCfg(data);
  const st = ensureCompanions(nation);
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
  st.awake = true;         // ★ §16-7b — 하루가 지났다. 방치해도 세상이 영영 멎지는 않는다
  const daySec = data.balance.time.dayRealSeconds;
  const unwatched = clamp(daySec - (st.liveSeconds || 0), 0, daySec);
  st.liveSeconds = 0;
  if (cfg.enabled === false) return out;
  const budgetPer = Math.floor(((laborCfg(data).swingsPerDay ?? 0) * unwatched) / daySec);
  if (budgetPer <= 0) return out;

  const walkPerSwing = data.world.simulation?.botWalkTilesPerSwing ?? 5.5;
  const baseCd = data.skills.swing.baseCooldownSec * 1000;
  const town = townOf(world, nation.id);
  for (const comp of st.list) {
    if (!comp.active) continue;
    const player = ensurePlayer(nation, comp.id, data, comp.name);
    if ((player.downUntil || 0) > 0) continue;
    const av = nation.avatars?.[comp.id];
    if (!av) continue;
    /* 많이 다친 사람은 그날은 모닥불 곁에서 쉰다 — 거기서만 기운이 돈다(§14-6 부활과 같은 자리) */
    const maxHp = playerMaxHp(player, data);
    if ((player.hp ?? maxHp) / Math.max(1, maxHp) < (brainCfg(data).fleeHpRatio ?? 0.35)) {
      if (town) { av.x = town.x; av.y = town.y; }
      comp.mem = { ...(comp.mem || {}), state: 'rest', target: null };
      continue;
    }
    let spent = 0;
    let misses = 0;
    let tgt = null;
    const actor = { id: comp.id, comp, now: st.clock, budgeted: false, human: false };
    while (spent < budgetPer && misses < 6) {
      /* 자리는 **쓸모가 다할 때까지** 지킨다 — 한 그루를 마저 벤다.
         스윙마다 다시 고르면 지도의 모든 노드를 매번 훑게 되어 하루가 수만 번이 된다. */
      if (!tgt || !targetValid(world, nation, data, tgt)) {
        tgt = decide(world, nation, data, actor, player, av, { workOnly: true });
        if (!tgt || (tgt.kind !== 'node' && tgt.kind !== 'site')) break;   // 일 틱에는 일만 한다
        const aim = aimPoint(world, nation, data, tgt);
        if (!aim) { tgt = null; misses += 1; continue; }
        const walk = Math.floor(dist(av.x, av.y, aim.x, aim.y) / Math.max(0.5, walkPerSwing));
        if (walk > 0) {
          spent += walk;
          st.clock += walk * (baseCd + 20);
          if (spent >= budgetPer) break;
        }
        av.x = Math.round(aim.x);
        av.y = Math.round(aim.y);
      }
      st.clock += baseCd + 20;
      actor.now = st.clock;
      const local = { moved: 0, actions: [], events: [], revealed: [] };
      if (!act(world, nation, data, actor, player, tgt, st.clock, local)) { tgt = null; misses += 1; continue; }
      spent += 1;
      out.swings += 1;
      out.byKind[tgt.kind] = (out.byKind[tgt.kind] || 0) + 1;
    }
    comp.mem = { ...(comp.mem || {}), state: tgt ? tgt.kind : 'idle', target: tgt ?? null };
  }
  return out;
}
