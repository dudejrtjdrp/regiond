// 고대 신전 — docs/유물기획.md §20-9 (★ §20-R4b)
//
// 「왜」 새 씬을 만들지 않았나 — 유적 카드가 이미 **결정 큐 + decide 규약**이라는 문을 갖고 있다.
// 신전은 그 문을 세 번 연달아 지나는 것뿐이다: 수수께끼 → 시련 → 안치소.
// 새 씬을 지으면 화면·규약·저장이 한 벌씩 더 생기는데, 그 값을 치를 만큼 다른 놀이가 아니다.
//
// 자리가 신전을 정한다. 난수가 아니다 — 같은 씨앗의 같은 자취는 언제나 같은 신전이고,
// 「저 멀리 눈 덮인 곳에 신전이 있더라」가 사람 사이에 옮겨질 수 있어야 찾아갈 이유가 된다.
import { townOf, terrainNameAt } from './world.js';
import { statRng } from './traits.js';
import { spawnGuardian, creatureById } from './ecology.js';
import { dropPool, grantArtifact, artifactFoundEvent } from './artifacts.js';
/* ★ 3단계A — 신전 단서가 가리키던 문 앞에 실제로 섰다는 표시(장부는 도감이 쥔다). */
import { markClueTarget } from './codex.js';

export const templeCfg = (data) => data.ruins.temple ?? null;

/**
 * ★ §20-R4e — 세상에 신전은 **종류마다 하나뿐**이다: 설산 가장 깊은 곳, 밀림 가장 깊은 곳,
 * 그리고 들판에서 가장 먼 자취. 「왜」 조건만으로 흩뿌리지 않나 — 유적 198곳 가운데 백 곳이
 * 신전이면 그것은 신전이 아니라 그냥 유적이다. 셋뿐이어야 「저기 있더라」가 값을 갖는다
 * (유물기획 §20-4 설산 최심부·밀림 심장·링3). 자리가 정하므로 같은 씨앗은 언제나 같은 세 곳이다.
 */
/* 「왜」 기억해 두나 — 신전은 **지도가 태어날 때 정해진다**(유적 자리도 본영 자리도 안 움직인다).
   그런데 이 문은 탐사할 때마다·판을 그릴 때마다 불린다. 매번 노드 오천을 훑으면 시뮬이 기어간다.
   씨앗과 나라와 유적 수가 같으면 답도 같다 — 그 셋을 열쇠로 한 번만 셈한다. */
const pickCache = new Map();

export function templeNodes(world, nation, data) {
  const cfg = templeCfg(data);
  const town = townOf(world, nation.id);
  if (!cfg || !town) return {};
  const key = `${world.seed}:${nation.id}:${town.x},${town.y}:${(world.map.nodes || []).length}`;
  const hit = pickCache.get(key);
  if (hit) return hit;
  const best = computeTemples(world, data, cfg, town);
  if (pickCache.size > 64) pickCache.clear();      // 방이 오래 돌아도 표가 불어나지 않게
  pickCache.set(key, best);
  return best;
}

function computeTemples(world, data, cfg, town) {
  const best = {};
  const used = new Set();
  /* 종류마다 따로 가장 깊은 유적을 고른다. 예전처럼 지형을 처음 만난 한 종류에만
     귀속하면, 신전 설정을 열 개로 늘려도 실제 세계에는 셋만 남는다. */
  for (const kind of cfg.kinds || []) {
    const pool = (world.map.nodes || []).filter((node) => {
      if (node.type !== 'ruin' || used.has(node.id)) return false;
      const code = terrainNameAt(world.map, Math.round(node.x), Math.round(node.y), data);
      return kind.biome ? kind.biome === code : Math.hypot(town.x - node.x, town.y - node.y) >= (cfg.ringRadius ?? 140);
    }).sort((a, b) => Math.hypot(town.x - b.x, town.y - b.y) - Math.hypot(town.x - a.x, town.y - a.y) || String(a.id).localeCompare(String(b.id)));
    if (!pool.length) continue;
    const node = pool[0];
    used.add(node.id);
    best[kind.id] = { node, d: Math.hypot(town.x - node.x, town.y - node.y), kind };
  }
  return best;
}

/** 이 자취가 신전인가 — 제 종류의 **가장 깊은 곳**일 때만 그렇다 */
export function templeKindAt(world, nation, node, data) {
  if (!node || node.type !== 'ruin') return null;
  const picked = templeNodes(world, nation, data);
  const hit = Object.values(picked).find((p) => p.node.id === node.id);
  return hit ? hit.kind : null;
}

/** 이 나라가 이 신전에서 어디까지 왔는가(저장된다) */
export function templeState(nation, nodeId) {
  const all = (nation.temples ||= {});
  return (all[nodeId] ||= { stage: 'riddle', failedTick: null, guardianId: null, done: false });
}

/** 지금 세울 카드 — 없으면 null(이미 열었거나, 틀려서 며칠 물러선 중) */
export function templeCard(world, nation, node, data) {
  const kind = templeKindAt(world, nation, node, data);
  if (!kind) return null;
  const st = templeState(nation, node.id);
  if (st.done || onCooldown(st, world, data)) return null;
  return buildCard(world, nation, node, data, kind, st);
}

function onCooldown(st, world, data) {
  const days = data.balance.artifacts.templeRetryDays ?? 0;
  return st.failedTick != null && world.tick - st.failedTick < days;
}

/**
 * ★ 4단계(2026-08-10) — 단마다 **그 신전의 전설 한 조각**을 카드에 싣는다.
 * 「왜」 — 신전 카드에는 여태 kind.text + spec.text 뿐이라 열 신전이 안에서는 모두 같은 방이었다
 * (「문에 문양 셋이 새겨져 있다」). 바이옴 전설(ruins.json temple.lore.*)은 이미 자료에 있었지만
 * 읽는 자가 유적 카드뿐이었다(king.js ruinLore) — 정작 그 전설이 가리키던 신전 **안에서는**
 * 한 줄도 안 나왔다. 단이 곧 이야기의 단이다: 전실(prologue) → 회랑(trace) → 안치소(revelation).
 * 화면은 이미 lore{title,lines} 를 그릴 줄 안다(council.js openDecision) — 새 규약이 없다.
 */
const LORE_PHASE = { riddle: 'prologue', trial: 'trace', vault: 'revelation' };

function templeLore(cfg, kind, stage) {
  const phase = LORE_PHASE[stage] ?? 'prologue';
  const lines = cfg.lore?.[kind.id]?.[phase];
  if (!lines?.length) return null;
  return { id: `temple:${kind.id}:${phase}`, title: `${kind.name}의 기록`, lines };
}

function buildCard(world, nation, node, data, kind, st) {
  const cfg = templeCfg(data);
  const stage = st.stage === 'trial' && guardianDown(nation, st) ? 'vault' : st.stage;
  const spec = cfg[stage];
  return {
    decisionId: `temple_${nation.id}_${node.id}_${stage}`,
    kind: cfg.decisionKind, title: `${cfg.title} — ${kind.name}`,
    text: `${kind.text} ${spec.text}`,
    options: spec.options.map((o) => o.key),
    // 한국어는 서버가 쥔다 — 화면이 열쇠말을 제 손으로 옮기면 두 곳에 살게 되어 갈린다.
    optionLabels: spec.options.map((o) => ({ key: o.key, label: o.label })),
    lore: templeLore(cfg, kind, stage),
    temple: { nodeId: node.id, stage, kindId: kind.id, kindName: kind.name },
  };
}

/* 「눕혔다」와 「아직 세우지도 않았다」는 다르다 — 앞의 것만 안치소를 연다.
   둘을 같이 보면 시련에 발도 들이기 전에 안치소가 열려 신전이 두 단짜리가 된다. */
const guardianDown = (nation, st) => Boolean(st.guardianId) && !creatureById(nation, st.guardianId);

/** decide {choice} 로 들어온 신전 결정 — 단마다 다른 답을 낸다 */
export function resolveTempleChoice(world, nation, decision, choice, data) {
  const t = decision.temple;
  const node = (world.map.nodes || []).find((n) => n.id === t?.nodeId);
  const kind = node ? templeKindAt(world, nation, node, data) : null;
  if (!kind) return { ok: false, error: { code: 'NO_TEMPLE', message: '그 신전을 찾을 수 없습니다.' } };
  const st = templeState(nation, t.nodeId);
  return runStage(world, nation, data, { node, st, kind, stage: t.stage, choice });
}

function runStage(world, nation, data, ctx) {
  if (ctx.stage === 'riddle') return stageRiddle(world, nation, data, ctx);
  if (ctx.stage === 'trial') return stageTrial(world, nation, data, ctx);
  return stageVault(world, nation, data, ctx);
}

/** 정답은 노드 id 가 쥔다(월드 난수를 축내지 않는다). 틀리면 며칠 뒤 다시 설 수 있다. */
export function templeAnswer(world, node, data) {
  return statRng(`${world.seed}:temple:${node.id}`).pick(templeCfg(data).riddle.options).key;
}

function stageRiddle(world, nation, data, { node, st, choice }) {
  const cfg = templeCfg(data);
  if (choice !== templeAnswer(world, node, data)) {
    st.failedTick = world.tick;
    return done({ stage: 'riddle', passed: false, text: cfg.riddle.failText });
  }
  st.stage = 'trial';
  st.failedTick = null;
  return done({ stage: 'riddle', passed: true, text: cfg.riddle.successText });
}

/** 지키는 것을 그 자리에 세운다. 눕히기 전에는 안치소가 열리지 않는다. */
function stageTrial(world, nation, data, { node, st, kind, choice }) {
  const cfg = templeCfg(data);
  if (choice !== 'fight') return done({ stage: 'trial', passed: false, text: cfg.trial.leaveText });
  if (st.guardianId && creatureById(nation, st.guardianId)) {
    return done({ stage: 'trial', passed: false, text: '수호병이 이미 안쪽에서 당신을 기다리고 있습니다.' });
  }
  const c = spawnGuardian(world, nation, data, kind.guardian, { x: node.x, y: node.y }, kind.id);
  if (!c) return done({ stage: 'trial', passed: false, text: cfg.trial.leaveText });
  st.guardianId = c.id;
  /* ★ 4단계 — 수호자가 「나오는 순간」이 한 줄이라도 있어야 시련이 시련이 된다.
     문이 열리는 것은 어느 신전이나 같고(spawnText), 무엇이 걸어 나오는가는 신전마다 다르다
     (kind.guardianText) — 그래서 두 조각을 자료에서 이어 붙인다. 코드에는 문장이 없다. */
  const entry = [cfg.trial.spawnText, kind.guardianText].filter(Boolean).join(' ');
  return done({ stage: 'trial', passed: true, text: entry, guardianId: c.id });
}

/** 안치소 — 상자 밖 풀에서 한 점. 방에 하나뿐인 것은 등록부가 이미 안다(dropPool). */
function stageVault(world, nation, data, { node, st, kind, choice }) {
  const cfg = templeCfg(data);
  if (choice !== 'take') return done({ stage: 'vault', passed: false, text: cfg.vault.leaveText });
  st.done = true;
  const key = pickVaultKey(world, nation, data, node, kind);
  if (!key) return done({ stage: 'vault', passed: false, text: cfg.vault.emptyText });
  grantArtifact(nation, key, world.tick, data);
  const found = artifactFoundEvent(world, nation, key, 'temple', data, { pos: node });
  return done({ stage: 'vault', passed: true, text: cfg.vault.successText, artifact: key }, [found]);
}

/* 전설이 먼저다 — 신전 끝까지 간 나라에게 「단 하나뿐인 것」을 확정으로 내어준다(§20-4).
   이미 이 방에서 나온 전설은 dropPool 이 걸러 내므로, 그때는 고유가 대신 선다. */
function pickVaultKey(world, nation, data, node, kind) {
  const rng = statRng(`${world.seed}:templeVault:${node.id}`);
  for (const grade of ['legendary', 'unique', 'rare']) {
    const pool = dropPool(world, nation, data, grade, kind.via);
    if (pool.length) return rng.pick(pool).key;
  }
  /* 전용 풀이 모두 소진됐을 때만 공용 신전 유물로 물러난다. */
  for (const grade of ['legendary', 'unique', 'rare']) {
    const pool = dropPool(world, nation, data, grade, 'temple');
    if (pool.length) return rng.pick(pool).key;
  }
  return null;
}

const done = (result, events = []) => ({ ok: true, result, events });

/**
 * ★ §20-R4e — 신전 앞에 서서 문을 두드린다.
 * 「왜」 어전 행동(explore)으로는 안 되나 — 그 문은 **영토 안**의 자취만 고를 수 있다(반경 49+26).
 * 신전은 200타일 밖에 있다. 나라의 일이 아니라 **군주가 제 발로 가는 일**이라, 손 닿는 거리에서
 * 손잡이를 잡는다(흔적·손일과 같은 자). 다음 단은 결정 큐에 올라 여느 안건처럼 답한다.
 */
export function enterTemple(world, nation, avatarId, nodeId, data) {
  const node = (world.map.nodes || []).find((n) => n.id === nodeId);
  if (!node) return { ok: false, code: 'BAD_NODE', message: '그런 자리가 없습니다.' };
  const av = nation.avatars?.[avatarId];
  const reach = data.balance.handWork?.reachTiles ?? 3.2;
  if (av && Math.hypot(av.x - node.x, av.y - node.y) > reach + 0.6) {
    return { ok: false, code: 'OUT_OF_RANGE', message: '더 가까이 가야 합니다.' };
  }
  /* ★ 3단계A — 문 앞에 **선 순간** 그 신전을 가리키던 단서가 닫힌다. 안쪽에서 무슨 일이
     있었는지(수수께끼를 풀었는지·물러섰는지)와는 무관하다 — 단서가 시킨 일은 「찾아가라」였다. */
  if (templeKindAt(world, nation, node, data)) markClueTarget(nation, node.id, world.tick);
  const card = templeCard(world, nation, node, data);
  const st = templeState(nation, node.id);
  if (st.stage === 'trial' && st.guardianId && creatureById(nation, st.guardianId)) {
    return { ok: false, code: 'GUARDIAN_ACTIVE', message: '수호병이 안쪽에서 기다립니다. 먼저 쓰러뜨리십시오.' };
  }
  if (!card && st.failedTick != null) {
    const retryAt = st.failedTick + (data.balance.artifacts.templeRetryDays ?? 0);
    if (world.tick < retryAt) return { ok: false, code: 'TEMPLE_RETRY', retryAt,
      message: `${retryAt}일째에 봉인이 약해집니다. 그때 이 신전으로 돌아와 다시 시도하십시오.` };
  }
  if (!card) return { ok: false, code: 'NO_TEMPLE', message: '이 신전에서는 더 할 일이 없습니다.' };
  const already = (nation.decisionQueue || []).some((d) => d.decisionId === card.decisionId);
  if (!already) (nation.decisionQueue ||= []).push({ ...card, createdTick: world.tick });
  return { ok: true, card };
}
