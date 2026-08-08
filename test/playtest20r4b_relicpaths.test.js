// §20-R4b 유물 경로 회귀 — docs/유물기획.md §20-3·§20-4·§20-9
//
// R4a 가 유물 21종을 정의표에 세웠지만 **가는 길**은 없었다. 이 파일이 붙드는 문장은 여섯이다.
//   ① 사슬의 끝이 유물을 낸다 — 확정 지급(전설)과 풀 뽑기(via) 두 가지가 다 산다.
//   ② 신전이 낸 유물도 같은 문(grantVia)을 지난다 — 신전 진행 자체는 temple.js 의 회귀가 본다.
//   ③ 땅이 카드를 바꾼다(설산 유적) — 그런데 **난수는 한 톨도 더 쓰지 않는다**.
//   ④ 카드가 제 풀을 적으면 그 풀에서만 나온다(봉분의 금기 → ruin:barrow).
//   ⑤ 두 번 주지 않는다 — 이미 가진 것, 이 방에서 나온 전설은 조용히 접힌다.
//   ⑥ 유물이 나오면 **발견 알림이 같은 길로** 실려 나간다(궤·유적 카드와 같은 모양).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf, terrainNameAt } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { grantVia, grantArtifact, dropPool } from '../server/engine/artifacts.js';
import { openRuinCard } from '../server/engine/king.js';
import { publicConfig } from '../server/engine/data.js';
import { codexView } from '../server/engine/codex.js';

const data = loadGameData();

function scene(seed = 4400) {
  const world = createWorld({ seed, data, playerName: '개척자' });
  const nation = world.nations.player;
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  return { world, nation, town: t, rng: createRng(seed) };
}

// ────────────────────────────────────────────────────────────────
// ① 사슬 결말
// ────────────────────────────────────────────────────────────────

test('★ §20-R4b 자료 온전성 — 사슬이 적은 유물은 전부 실재하고, via 는 후보가 있다', () => {
  const keys = new Set(data.artifacts.list.map((a) => a.key));
  let confirmed = 0;
  const vias = new Set();
  for (const chain of data.trails.chains) {
    const rewards = [];
    for (const e of chain.endings || []) {
      if (e.reward) rewards.push(e.reward);
      for (const c of e.choices || []) if (c.reward) rewards.push(c.reward);
    }
    for (const r of rewards) {
      const spec = r.artifact;
      if (!spec) continue;
      if (spec.key) { assert.ok(keys.has(spec.key), `${chain.id}: 없는 유물 ${spec.key}`); confirmed += 1; }
      if (spec.via) vias.add(spec.via);
      assert.ok(spec.key || spec.via, `${chain.id}: key 도 via 도 없다`);
    }
  }
  assert.ok(confirmed >= 6, '확정 지급이 여섯 자리는 있어야 신규가 실제로 손에 들어온다');
  for (const via of vias) {
    const pool = data.artifacts.list.filter((a) => (a.acquireVia || []).includes(via));
    assert.ok(pool.length, `${via} 를 적은 유물이 하나도 없다 — 죽은 경로다`);
  }
});

test('★ §20-R4b 확정 지급 — 얼어붙은 원정대의 끝에서 나침반이 나온다', () => {
  const s = scene(4401);
  const spec = { key: 'pathfinders_compass' };
  const def = grantVia(s.world, s.nation, data, createRng(1), spec, 0);
  assert.equal(def?.key, 'pathfinders_compass');
  assert.ok(s.nation.artifacts.some((a) => a.key === 'pathfinders_compass'));
  // 두 번은 없다
  assert.equal(grantVia(s.world, s.nation, data, createRng(1), spec, 0), null);
});

test('★ §20-R4b 풀 뽑기 — via 로 준 것은 그 태그를 적은 것뿐이다', () => {
  const s = scene(4402);
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const s2 = scene(4402 + i);
    const def = grantVia(s2.world, s2.nation, data, createRng(i), { via: 'chain:temperate' }, 0);
    if (def) seen.add(def.key);
  }
  assert.ok(seen.size >= 2, '온대 사슬 풀에서 여러 가지가 나온다');
  for (const k of seen) {
    assert.ok(data.artifactsByKey[k].acquireVia.includes('chain:temperate'), `${k} 가 남의 풀에서 샜다`);
  }
});

test('★ §20-R4b 방 유일 — 이 방에서 나온 전설은 확정 지급이라도 두 번 안 나온다', () => {
  const s = scene(4403);
  s.world.artifactRegistry = { frozen_kings_scepter: { firstFoundBy: '이웃', count: 1 } };
  assert.equal(grantVia(s.world, s.nation, data, createRng(1), { key: 'frozen_kings_scepter' }, 0), null);
});

test('★ §20-R4b 사슬 조사가 유물을 내면 발견 알림이 같은 길로 실린다', () => {
  const s = scene(4404);
  // 결말에 유물이 걸린 사슬을 손으로 세운다(배치 난수와 무관하게 계약만 본다)
  const chain = data.trails.chains.find((c) => c.id === 'frozen_party');
  assert.ok(chain, 'frozen_party 사슬이 있다');
  const last = chain.steps.length - 1;
  const t = { id: 'tX', kind: 'chain', chainId: chain.id, step: last, key: chain.steps[last].key,
    x: s.town.x + 2, y: s.town.y, hidden: false };
  (s.world.map.trails ||= []).push(t);
  s.nation.avatars.lord.x = t.x; s.nation.avatars.lord.y = t.y;
  const before = s.rng.state ?? null;
  const res = applyCommand(s.world, 'player', { type: 'investigateTrail', trailId: 'tX', avatarId: 'lord' }, data, s.rng);
  assert.equal(res.ok, true);
  if (res.artifact) {
    assert.ok(data.artifactsByKey[res.artifact.key], '실재하는 유물이다');
    assert.ok((res.events || []).some((e) => e.kind === 'artifact_found'), '발견 알림이 실린다');
    assert.ok(s.nation.artifacts.some((a) => a.key === res.artifact.key), '실제로 들어왔다');
  }
});

// ────────────────────────────────────────────────────────────────
// ② 고대 신전
// ────────────────────────────────────────────────────────────────





// ────────────────────────────────────────────────────────────────
// ③④ 유적 카드 — 땅의 변주와 제 풀
// ────────────────────────────────────────────────────────────────

test('★ §20-R4b 설산 변주 — 카드는 바뀌되 난수는 한 톨도 더 안 쓴다', () => {
  const s = scene(4409);
  const plain = openRuinCard(s.world, s.nation, data, createRng(7), null);
  assert.ok(plain.cardId, '변주가 없는 자리는 예전 그대로');
  // 지도에서 실제 눈 칸을 찾는다(지형 저장 방식에 기대지 않는다)
  let spot = null;
  for (let x = 2; x < data.world.size && !spot; x += 7) {
    for (let y = 2; y < data.world.size; y += 7) {
      if (terrainNameAt(s.world.map, x, y, data) === 'snow') { spot = { x, y }; break; }
    }
  }
  assert.ok(spot, '이 지도에 설산이 있다');
  const rngA = createRng(7);
  const rngB = createRng(7);
  openRuinCard(s.world, s.nation, data, rngA, null);
  const snowCard = openRuinCard(s.world, s.nation, data, rngB, { id: 'nSnow', ...spot });
  assert.equal(snowCard.cardId, data.ruins.biomeCards.snow.id, '땅이 카드를 바꿨다');
  // 같은 씨앗의 두 rng 가 같은 만큼 소비했는가 — 다음 뽑기가 같아야 한다
  assert.equal(rngA.int(0, 1e9), rngB.int(0, 1e9), '난수 차례가 밀리지 않았다');
});

test('★ §20-R4b 카드가 제 풀을 적으면 그 풀에서만 나온다 (봉분의 금기)', () => {
  const barrow = data.ruins.cards.find((c) => c.id === 'barrow');
  const taboo = barrow.options.find((o) => o.outcomes.some((x) => x.op === 'artifactRoll' && x.via));
  assert.ok(taboo, '봉분에 금기 선택지가 있다');
  assert.equal(barrow.options[barrow.options.length - 1].key, 'leave', 'leave 가 마지막이어야 한다(시뮬 폴백)');
  const via = taboo.outcomes.find((x) => x.op === 'artifactRoll').via;
  const pool = data.artifacts.list.filter((a) => (a.acquireVia || []).includes(via));
  assert.ok(pool.length, `${via} 풀이 비어 있다`);
  for (const card of data.ruins.cards) {
    assert.equal(card.options[card.options.length - 1].key, 'leave', `${card.id} 의 마지막 옵션이 leave 가 아니다`);
  }
  assert.equal(data.ruins.cards.length, 12, '카드 장수는 12 로 붙박이(뽑기 난수 불변)');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 규격·도감이 여는 것
// ────────────────────────────────────────────────────────────────

test('★ §20-R4b 규격 — curse 는 열고 이름·효과·이야기·힌트는 여전히 잠근다', () => {
  const cfg = publicConfig();
  const cursed = cfg.artifacts.list.filter((a) => a.curse);
  assert.ok(cursed.length >= 8, '저주는 가지기 전에도 보여야 한다(§20-6 몰래 나쁜 것 금지)');
  for (const a of cfg.artifacts.list) {
    for (const secret of ['name', 'desc', 'lore', 'hint', 'effects']) {
      assert.equal(a[secret], undefined, `${a.key}.${secret} 가 규격으로 샌다`);
    }
  }
});

test('★ §20-R4b 도감 — 세트·저주는 0층에서도 보이고, 효과는 층이 열려야 나온다', () => {
  const s = scene(4410);
  const v0 = codexView(s.nation, data, s.world).artifacts;
  const seedCard = v0.cards.find((c) => c.key === 'cornerstone_of_terra');
  assert.equal(seedCard.tier, 0);
  assert.equal(seedCard.setKey, 'genesis');
  assert.ok(seedCard.setName, '세트 이름이 실린다 — 「몇 조각짜리를 모으는 중인가」가 목표다');
  assert.equal(seedCard.name, undefined, '이름은 아직 잠겨 있다');
  const curseCard = v0.cards.find((c) => c.key === 'blood_pact');
  assert.equal(curseCard.curse, true);
  grantArtifact(s.nation, 'cornerstone_of_terra', 1, data);
  const v2 = codexView(s.nation, data, s.world).artifacts;
  const owned = v2.cards.find((c) => c.key === 'cornerstone_of_terra');
  assert.equal(owned.owned, true);
  assert.ok(owned.desc && owned.name, '가지면 열린다');
});

test('★ §20-R4b 신규 22종이 전부 「갈 수 있는 길」을 가진다', () => {
  const s = scene(4411);
  const legacy = new Set(['chest', 'ruin', 'cache']);
  const reachable = new Set();
  // ① 사슬·미시 결말이 적은 것
  for (const chain of data.trails.chains) {
    for (const e of chain.endings || []) {
      const specs = [e.reward?.artifact, ...(e.choices || []).map((c) => c.reward?.artifact)];
      for (const sp of specs.filter(Boolean)) {
        if (sp.key) reachable.add(sp.key);
        else for (const a of data.artifacts.list) if ((a.acquireVia || []).includes(sp.via)) reachable.add(a.key);
      }
    }
  }
  // ② 카드·신전이 적은 via
  const viaFromCards = new Set();
  const scan = (opts) => { for (const o of opts || []) for (const x of o.outcomes || []) if (x.op === 'artifactRoll') viaFromCards.add(x.via ?? 'ruin'); };
  for (const c of data.ruins.cards) scan(c.options);
  for (const b of Object.values(data.ruins.biomeCards || {})) scan(b.options);
  const tp = data.ruins.temple || {};
  for (const k of ['riddle', 'trial', 'vault']) scan(tp[k]?.options);
  for (const kind of Object.values(tp.kinds || {})) {
    if (kind.via) viaFromCards.add(kind.via);
    if (kind.artifact?.key) reachable.add(kind.artifact.key);
  }
  JSON.stringify(tp).replace(/"via":"([^"]+)"/g, (m, v) => { viaFromCards.add(v); return m; });
  for (const a of data.artifacts.list) {
    if ((a.acquireVia || []).some((v) => viaFromCards.has(v))) reachable.add(a.key);
  }
  // ③ 옛 세 풀 · 용 · 국가 이벤트
  for (const a of data.artifacts.list) {
    if ((a.acquireVia || []).some((v) => legacy.has(v) || v === 'dragon')) reachable.add(a.key);
  }
  for (const e of data.events.nations.pool) {
    const k = e.followUp?.artifact?.key ?? e.artifact?.key;
    if (k) reachable.add(k);
  }
  // cache3 는 링3 궤가 낸다(R4a 에서 섰다)
  for (const a of data.artifacts.list) if ((a.acquireVia || []).includes('cache3')) reachable.add(a.key);

  const orphan = data.artifacts.list.filter((a) => !reachable.has(a.key)).map((a) => a.key);
  assert.deepEqual(orphan, [], `갈 길이 없는 유물이 남았다: ${orphan.join(', ')}`);
});
