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

export const templeCfg = (data) => data.ruins.temple ?? null;

/**
 * 이 자취가 신전인가 — 자리 하나로 답한다.
 * 바이옴 신전(설산·밀림)이 먼저고, 둘 다 아니면 **본영에서 아주 먼 곳**만 신전이다.
 * 「왜」 가까운 자취는 아닌가 — 신전은 뒤지다 보면 나오는 것이 아니라 찾아가는 곳이다.
 */
export function templeKindAt(world, nation, node, data) {
  const cfg = templeCfg(data);
  if (!cfg || !node) return null;
  const code = terrainNameAt(world.map, Math.round(node.x), Math.round(node.y), data);
  const byBiome = (cfg.kinds || []).find((k) => k.biome && k.biome === code);
  if (byBiome) return byBiome;
  return farEnough(world, nation, node, cfg) ? (cfg.kinds || []).find((k) => !k.biome) ?? null : null;
}

function farEnough(world, nation, node, cfg) {
  const town = townOf(world, nation.id);
  if (!town) return false;
  return Math.hypot(town.x - node.x, town.y - node.y) >= (cfg.ringRadius ?? 140);
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
    temple: { nodeId: node.id, stage, kindId: kind.id },
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
  const c = spawnGuardian(world, nation, data, kind.guardian, { x: node.x, y: node.y });
  if (!c) return done({ stage: 'trial', passed: false, text: cfg.trial.leaveText });
  st.guardianId = c.id;
  return done({ stage: 'trial', passed: true, text: cfg.trial.spawnText, guardianId: c.id });
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
  for (const grade of ['legendary', 'unique']) {
    const pool = dropPool(world, nation, data, grade, kind.via);
    if (pool.length) return rng.pick(pool).key;
  }
  return null;
}

const done = (result, events = []) => ({ ok: true, result, events });
