// 흔적 — ★ §18-D2 링0 앞마당. 설계 정본은 docs/탐험기획.md §18-2·§18-3·§18-5.
//
// 「왜」 이 파일이 따로 있나 — 첫 사흘의 앞마당이 비어 있었다. 마차에서 내리면 나무와 돌뿐이고,
// 걸어 나갈 이유가 「아직 안 가 본 곳」밖에 없었다. 흔적은 **호기심에 방향을 준다**:
// 발자국 하나가 다음 발자국을 부르고, 그 끝에 이야기가 있다.
//
// 규율 셋 — 이 파일을 고칠 때 반드시 지킨다.
//  ① 마커·화살표 금지. 조사가 여는 것은 **안개**뿐이다(§18-3). 다음 흔적의 좌표는 ack 에 싣지 않는다.
//  ② 월드 난수를 한 톨도 축내지 않는다. 배치도 결말 굴림도 statRng(`씨앗:trail:…`) 이다 —
//     실시간 명령이 월드 난수를 건드리면 같은 씨앗이 다른 게임이 된다(actions.openCache 와 같은 까닭).
//  ③ 수치·문구는 전부 data/trails.json. 여기에는 규칙만 있다.
import { statRng } from './traits.js';
import { dist, terrainAt, terrainIndex, addNode } from './world.js';
import { stampVisionDisc } from './fog.js';
import { record as chronicle } from './chronicle.js';
import { deposit } from './storage.js';
import { ensurePlayer, playerMaxHp } from './skills.js';
import { round2 } from './economy.js';

export const trailsCfg = (data) => data.trails ?? null;

const err = (code, message) => ({ ok: false, error: { code, message } });

// ────────────────────────────────────────────────────────────────
// 생성 — 월드 시드에서 결정론적으로
// ────────────────────────────────────────────────────────────────
/**
 * 링0 앞마당의 흔적을 심는다. generateWorldMap 이 지형·도읍·자원을 다 놓은 뒤 끝머리에서 한 번 부른다.
 * ★ 월드 난수(createRng)를 쓰지 않는 까닭: 이 배치가 월드 난수를 한 칸이라도 밀면 웨이브 구성·
 *   사건·이름이 통째로 어긋나 「같은 씨앗 같은 판」이 깨진다. 씨앗에서 지은 전용 난수를 쓴다.
 * @returns {Array} world.map.trails 에 그대로 들어갈 목록
 */
export function generateTrails(map, data, seed) {
  const cfg = trailsCfg(data);
  const town = (map?.towns || []).find((t) => t.isPlayer);
  if (!cfg || !town) return [];
  const ctx = makeCtx(map, data, seed, town);
  placeChains(ctx, cfg);
  placeMicro(ctx, cfg);
  return ctx.out;
}

function makeCtx(map, data, seed, town) {
  const cfg = trailsCfg(data);
  return {
    map, data, town, seed,
    rng: statRng(`${seed}:trails:ring0`),
    ring: cfg.ring0,
    tIndex: terrainIndex(data),
    taken: [],                       // 이미 자리를 잡은 점들(minGap 판정용 — 링0 안이라 목록이 짧다)
    out: [],
    nextId: 1,
  };
}

/** 흔적 하나가 앉을 수 있는 칸인가 — ① 지도 안 ② 물이 아니다 ③ 본영·기존 노드·다른 흔적과 안 겹친다 */
function spotOk(ctx, x, y) {
  const size = ctx.map.size;
  const fromTown = dist(ctx.town.x, ctx.town.y, x, y);
  if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1) return false;
  if (terrainAt(ctx.map, x, y) === ctx.tIndex.water) return false;
  if (fromTown < ctx.ring.minTownGap || fromTown > ctx.ring.radius) return false;
  if ((ctx.map.nodes || []).some((n) => n.x === x && n.y === y)) return false;
  return !ctx.taken.some((p) => dist(p.x, p.y, x, y) < ctx.ring.minGap);
}

/** 본영 둘레의 빈 칸 하나. placeTries 안에 못 찾으면 null — 월드 생성이 여기서 멎으면 안 된다. */
function pickSpot(ctx, from = null, span = null) {
  const anchor = from ?? ctx.town;
  for (let i = 0; i < ctx.ring.placeTries; i += 1) {
    const a = ctx.rng.float(0, Math.PI * 2);
    const r = span ? ctx.rng.float(span[0], span[1]) : ctx.rng.float(ctx.ring.minTownGap, ctx.ring.radius);
    const x = Math.round(anchor.x + Math.cos(a) * r);
    const y = Math.round(anchor.y + Math.sin(a) * r);
    if (spotOk(ctx, x, y)) return { x, y };
  }
  return null;
}

function push(ctx, row) {
  ctx.taken.push({ x: row.x, y: row.y });
  ctx.out.push({ id: `tr${ctx.nextId++}`, done: false, usedTick: null, pending: null, stamp: 0, ...row });
  return ctx.out[ctx.out.length - 1];
}

/**
 * 사슬 배치. ★ §18-3 「조사 순간 생성·공개」의 결정론 판본:
 * 자리는 **월드 생성 때 미리** 시드에서 정해 두고(같은 씨앗 = 같은 자리), 2단계부터는 hidden 으로
 * 덮어 둔다. 조사하는 순간 hidden 이 벗겨지고 안개가 열린다 — 플레이어가 보기에는 '그때 생긴' 것이고,
 * 서버가 보기에는 '처음부터 거기 있던' 것이다. 실시간에 자리를 뽑으면 재현이 깨진다.
 */
function placeChains(ctx, cfg) {
  const chains = (cfg.chains || []).filter((c) => (c.ring ?? 0) === 0);
  for (let k = 0; k < (ctx.ring.chainCount ?? 0) && chains.length; k += 1) {
    const chain = chains[k % chains.length];
    placeChain(ctx, chain);
  }
}

function placeChain(ctx, chain) {
  let prev = null;
  for (let i = 0; i < chain.steps.length; i += 1) {
    const step = chain.steps[i];
    const span = prev ? (chain.steps[i - 1].nextDistance ?? null) : null;
    const spot = pickSpot(ctx, prev, span) ?? pickSpot(ctx);
    if (!spot) return;                                  // 자리가 없으면 사슬을 통째로 접는다(반쪽 사슬 금지)
    prev = push(ctx, {
      kind: 'chain', chainId: chain.id, step: i, key: step.key,
      x: spot.x, y: spot.y, hidden: i > 0,
    });
  }
}

/**
 * 미시 발견 4~6개. ★ 「가중 순서 뽑기」 — 무게로 **차례**를 정하고 그 차례대로 심는다.
 * 왜 뽑을 때마다 무게를 굴리지 않나: 그러면 같은 종류가 셋씩 겹쳐 앞마당이 단조로워진다.
 * 왜 그냥 파일 차례로 안 도나: 4개만 나오는 판에서는 목록 끝(전망 바위)이 영영 안 나온다.
 * 무게 순 무작위 배열 한 번 = 「종류는 겹치지 않고, 어느 넷이 뽑히는지는 씨앗마다 다르다」.
 */
function placeMicro(ctx, cfg) {
  const order = drawOrder(ctx, cfg.micro || []);
  if (!order.length) return;
  const want = ctx.rng.int(ctx.ring.microCount[0], ctx.ring.microCount[1]);
  for (let i = 0; i < want; i += 1) {
    const spot = pickSpot(ctx);
    if (!spot) continue;
    push(ctx, { kind: 'micro', key: order[i % order.length].key, x: spot.x, y: spot.y, hidden: false });
  }
}

/** 무게를 두고 되돌리지 않고 뽑아 만든 차례 한 벌(weighted shuffle) */
function drawOrder(ctx, list) {
  const pool = [...list];
  const out = [];
  while (pool.length) {
    const key = ctx.rng.weighted(pool.map((m) => ({ value: m.key, weight: m.weight ?? 1 })));
    const i = Math.max(0, pool.findIndex((m) => m.key === key));
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// 조회
// ────────────────────────────────────────────────────────────────
export const trailsOf = (world) => world?.map?.trails || [];

export function trailById(world, id) {
  return trailsOf(world).find((t) => t.id === id) ?? null;
}

function chainOf(data, t) {
  return (trailsCfg(data)?.chains || []).find((c) => c.id === t.chainId) ?? null;
}

/** 이 흔적의 규격 한 벌 — 사슬이면 그 단계, 미시면 그 종류 */
export function trailDef(data, t) {
  if (!t) return null;
  if (t.kind === 'chain') return chainOf(data, t)?.steps?.[t.step] ?? null;
  return (trailsCfg(data)?.micro || []).find((m) => m.key === t.key) ?? null;
}

/** 오늘 손댈 수 있는가 — 소진되지 않았고, 하루 한 번짜리라면 오늘 아직 안 썼다 */
export function trailReady(world, data, t) {
  if (!t || t.done || t.hidden) return false;
  const def = trailDef(data, t);
  const days = def?.reuseDays ?? 0;
  if (!(days > 0) || t.usedTick == null) return true;
  return (world.tick ?? 0) - t.usedTick >= days;
}

/**
 * 화면에 실릴 수 있는 흔적 목록. ★ 부재 원칙 — 안 보이는 것은 **필드째** 빠진다(마스킹이 아니라 부재).
 * 흔적은 나라를 가리지 않는 플레이어 전용 콘텐츠라 소유자 구분이 없다: 안개만이 문이다.
 */
export function trailViews(world, nation, data, isExplored) {
  return trailsOf(world)
    .filter((t) => !t.hidden && !t.done && isExplored(nation, t.x, t.y))
    .map((t) => {
      const def = trailDef(data, t) ?? {};
      return {
        id: t.id, key: t.key, kind: t.kind, x: t.x, y: t.y,
        name: def.name ?? t.key, art: def.art ?? t.key, verb: def.verb ?? 'E — 살핀다',
        ready: trailReady(world, data, t),
      };
    });
}

// ────────────────────────────────────────────────────────────────
// 조사 — investigateTrail 명령의 본체
// ────────────────────────────────────────────────────────────────
/**
 * 흔적을 조사한다. 한 흔적에 두 걸음이 있을 수 있다:
 *   1차(choice 없음) — 선택지가 있는 자리면 대화창에 선택지를 펴고 pending 을 세운다.
 *   2차(choice 있음) — 그 선택의 몫을 치른다.
 * 서버가 기억하는 것은 노드의 pending 한 글자뿐이다(대화의 상태는 화면이 쥔다).
 */
export function investigateTrail(world, nation, cmd, data) {
  const t = trailById(world, String(cmd.trailId ?? cmd.payload?.trailId ?? ''));
  if (!t || t.done || t.hidden) return err('NO_TRAIL', '그런 흔적이 없습니다.');
  const who = cmd.avatarId ?? cmd.playerName ?? 'lord';
  const av = nation.avatars?.[who];
  if (!av) return err('NO_AVATAR', '아바타가 없습니다.');
  if (dist(av.x, av.y, t.x, t.y) > reachTiles(data)) return err('OUT_OF_RANGE', '더 가까이 가야 합니다.');
  if (!trailReady(world, data, t)) return err('COOLDOWN', '오늘은 이미 다녀갔습니다 — 내일 다시.');
  const choice = cmd.choice ?? cmd.payload?.choice ?? null;
  const act = { world, nation, data, who, t };
  return choice == null ? openTrail(act) : resolveChoice(act, choice);
}

/** 손이 닿는 거리 — 자료가 쥔다. 건물 손일과 같은 자여야 E 한 손잡이의 팔 길이가 하나가 된다. */
const reachTiles = (data) => trailsCfg(data)?.reachTiles ?? data.balance.handWork?.reachTiles ?? 3;

/** 1차 — 이 흔적이 무엇인지 펼친다. 선택지가 있으면 거기서 멈춘다. */
function openTrail(a) {
  const branch = a.t.kind === 'chain' ? endingFor(a.world, a.t, a.data) : trailDef(a.data, a.t);
  const def = trailDef(a.data, a.t) ?? {};
  const lines = branch && branch !== def
    ? [...(def.lines || []), ...(branch.lines || [])]
    : [...(def.lines || [])];
  if (branch?.choices?.length) {
    a.t.pending = branch.key ?? 'x';
    a.t.stamp = a.world.tick ?? 0;
    return talk(a, lines, branch.choices, { pending: true });
  }
  return talk(a, lines, [], finish(a, branch?.reward ?? null));
}

/** 2차 — 선택 하나를 확정한다. 1차에서 세운 pending 이 없으면 받지 않는다(순서 위조 금지). */
function resolveChoice(a, choiceKey) {
  if (!a.t.pending) return err('NO_CHOICE', '먼저 흔적을 살펴야 합니다.');
  const branch = a.t.kind === 'chain' ? endingFor(a.world, a.t, a.data) : trailDef(a.data, a.t);
  const picked = (branch?.choices || []).find((c) => c.key === choiceKey);
  if (!picked) return err('BAD_CHOICE', '그런 선택이 없습니다.');
  const short = lacking(a.nation, picked.cost, a.data);
  if (short) return err('NO_RESOURCES', `${short}이(가) 모자랍니다.`);
  payCost(a.nation, picked.cost);
  a.t.pending = null;
  return talk(a, picked.lines || [], [], finish(a, picked.reward ?? null));
}

/** 사슬의 마지막 단계면 결말을 굴린다 — ★ statRng 가중 굴림(월드 난수 불변) */
function endingFor(world, t, data) {
  const chain = chainOf(data, t);
  const step = chain?.steps?.[t.step] ?? null;
  if (!chain || !step?.final) return step;
  if (!t.ending) {
    const rng = statRng(`${world.seed}:trail:${t.id}`);
    t.ending = rng.weighted((chain.endings || []).map((e) => ({ value: e.key, weight: e.weight })));
  }
  return (chain.endings || []).find((e) => e.key === t.ending) ?? step;
}

// ────────────────────────────────────────────────────────────────
// 몫 치르기
// ────────────────────────────────────────────────────────────────
/** 값을 치르고, 다음 흔적을 열고, 흔적을 소진 처리한다 — 조사 한 번의 뒷정리 전부 */
function finish(a, reward) {
  const paid = applyReward(a, reward);
  const step = a.t.kind === 'chain' ? trailDef(a.data, a.t) : null;
  const opened = step ? advanceChain(a, step) : [];
  const own = reward?.revealRadius
    ? stampVisionDisc(a.nation, a.data, a.world.tick, a.t.x, a.t.y, reward.revealRadius) : [];
  consume(a.world, a.data, a.t);
  return { ...paid, revealed: [...opened, ...own] };
}

/** 다음 단계의 흔적을 드러내고 그 둘레의 안개를 연다. ★ 좌표는 돌려주지 않는다 — 마커 금지(§18-3). */
function advanceChain(a, step) {
  const next = trailsOf(a.world).find((o) => o.chainId === a.t.chainId && o.step === a.t.step + 1);
  if (!next || !step.revealRadius) return [];
  next.hidden = false;
  next.stamp = a.world.tick ?? 0;
  return stampVisionDisc(a.nation, a.data, a.world.tick, next.x, next.y, step.revealRadius);
}

/** 소진 — 하루 한 번짜리(reuseDays)는 자리에 남고 날짜만 적는다 */
function consume(world, data, t) {
  const def = trailDef(data, t) ?? {};
  t.stamp = world.tick ?? 0;
  if (def.reuseDays > 0) { t.usedTick = world.tick ?? 0; return; }
  t.done = true;
}

function applyReward(a, reward) {
  if (!reward) return { gained: {}, morale: 0, healed: 0, node: null };
  const gained = {};
  for (const [k, v] of Object.entries(reward.resources || {})) gained[k] = deposit(a.nation, k, v, a.data);
  const morale = addMorale(a.nation, a.data, reward.morale ?? 0);
  const healed = heal(a.nation, a.data, a.who, reward.heal ?? 0);
  const node = spawn(a.world, a.t, a.data, reward.spawnNode);
  if (reward.chronicle) chronicle(a.world, { ...reward.chronicle, data: { trail: a.t.key } }, a.data);
  return { gained, morale, healed, node: node ? { id: node.id, type: node.type } : null };
}

function addMorale(nation, data, delta) {
  if (!delta) return 0;
  const m = data.balance.morale;
  const before = nation.morale ?? m.default;
  nation.morale = round2(Math.max(m.min, Math.min(m.max, before + delta)));
  return round2(nation.morale - before);
}

/** ★ 우물물은 **두레박을 내린 사람**이 마신다 — 여럿이 붙어 있어도 남의 체력이 차면 안 된다 */
function heal(nation, data, who, amount) {
  if (!(amount > 0)) return 0;
  const p = ensurePlayer(nation, who, data, null);
  const before = p.hp ?? playerMaxHp(p, data);
  p.hp = round2(Math.min(playerMaxHp(p, data), before + amount));
  return round2(p.hp - before);
}

/** 결말이 땅에 남기는 것 — 그 자리에 노드 하나(§18-4 「영구 흔적 원칙」의 최소판) */
function spawn(world, t, data, spec) {
  if (!spec?.type) return null;
  return addNode(world, spec.type, t.x, t.y, data, { rich: Boolean(spec.rich), tick: world.tick ?? 0 });
}

function lacking(nation, cost, data) {
  for (const [k, v] of Object.entries(cost || {})) {
    if ((nation.resources[k] ?? 0) < v) return data.resources.meta[k]?.name ?? k;
  }
  return null;
}

function payCost(nation, cost) {
  for (const [k, v] of Object.entries(cost || {})) nation.resources[k] = round2(nation.resources[k] - v);
}

/** 대화창(§18-6)이 그대로 읽는 한 벌. 화면은 문구를 짓지 않는다 — 자료가 쓴 말을 옮길 뿐이다. */
function talk(a, lines, choices, extra = {}) {
  const d = trailsCfg(a.data)?.dialogue ?? {};
  const def = trailDef(a.data, a.t) ?? {};
  return {
    ok: true,
    trailId: a.t.id, key: a.t.key, kind: a.t.kind, name: def.name ?? a.t.key,
    dialogue: {
      speaker: d.speaker ?? '탐험', portraitKey: d.portraitKey ?? 'icon:eye',
      lines: [...lines],
      choices: (choices || []).map((c) => ({ key: c.key, label: c.label })),
    },
    done: Boolean(a.t.done),
    ready: trailReady(a.world, a.data, a.t),
    ...extra,
  };
}
