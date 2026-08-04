import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { collectHooks, rollArtifactDrop, grantArtifact, useArtifact } from '../server/engine/artifacts.js';

const data = loadGameData();

test('유물 등급 확률 합 = 1 (55/32/8/5)', () => {
  const w = data.balance.artifacts.gradeWeights;
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(w.common, 0.55);
  assert.equal(w.rare, 0.32);
  assert.equal(w.unique, 0.08);
  assert.equal(w.legendary, 0.05);
  const g = data.artifacts.grades;
  assert.ok(Math.abs(Object.values(g).reduce((a, x) => a + x.chance, 0) - 1) < 1e-12);
});

test('유물 목록 — 문서 원본과 등급별 개수가 일치한다 (19/17/6/7 + 확정지급 1)', () => {
  const counts = {};
  for (const a of data.artifacts.list) counts[a.grade] = (counts[a.grade] || 0) + 1;
  assert.equal(counts.common, 19);
  assert.equal(counts.rare, 17);
  assert.equal(counts.unique, 6);
  assert.equal(counts.legendary, 7);
  assert.equal(counts.fixed, 1, '왕관의 조각은 상자 풀 제외');
  assert.equal(data.artifacts.list.length, 50);
  const keys = new Set(data.artifacts.list.map((a) => a.key));
  assert.equal(keys.size, data.artifacts.list.length, 'key 중복 없음');
  for (const a of data.artifacts.list) {
    assert.ok(a.name && a.desc && Array.isArray(a.effects) && a.effects.length > 0, `${a.key} 정의 누락`);
    assert.ok(['consumable', 'permanent', 'utility', 'cosmetic', 'tradeoff'].includes(a.type), `${a.key} type`);
  }
});

test('상자 발견 확률 12%, 행운의 부적으로 상승하되 25% 상한', () => {
  const cfg = data.balance.artifacts;
  assert.equal(cfg.chestChancePerCouncil, 0.12);
  const world = createWorld({ seed: 1, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  assert.equal(collectHooks(n, data).discoverChanceBonus, 0);
  grantArtifact(n, 'lucky_charm', 1, data);
  assert.ok(Math.abs(collectHooks(n, data).discoverChanceBonus - cfg.luckyCharmBonus) < 1e-12);
  assert.ok(collectHooks(n, data).discoverChanceBonus <= cfg.discoverChanceCap);
});

test('드랍 판정은 상자 풀에서 fixed 등급을 제외한다', () => {
  const world = createWorld({ seed: 2, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  const rng = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 4000; i += 1) {
    const drop = rollArtifactDrop(n, data, rng, { defense: 3 });
    if (drop.artifact) seen.add(drop.artifact);
  }
  assert.ok(seen.size > 10, '충분히 다양한 유물이 나온다');
  assert.ok(!seen.has('crown_shard'), '왕관의 조각은 상자에서 나오지 않는다');
});

test('effect descriptor — 적 공격력 감소 유물이 웨이브 파워에 반영된다', () => {
  // ★ GDD3 §6 — 로지스틱 일괄 판정은 폐기됐다. 유물의 '적 공격력 −5%'는 이제
  //   실시뮬의 적 능력치 배수(hooks.enemyPowerMultipliers)로 들어간다. 훅 계약을 직접 확인한다.
  const world = createWorld({ seed: 3, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  const before = collectHooks(n, data);
  assert.equal(before.enemyPowerMultipliers?.dragon ?? 1, 1);
  grantArtifact(n, 'sealed_dragon_scale', 1, data);
  const after = collectHooks(n, data);
  assert.ok(Math.abs((after.enemyPowerMultipliers.dragon ?? 1) - 0.95) < 1e-9, '드래곤 공격력 −5%');
});

test('소모형 유물 사용 — 1회성, 재사용 불가', () => {
  const world = createWorld({ seed: 4, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  grantArtifact(n, 'goldrush_memory', 1, data);
  const gold0 = n.gold;
  const r1 = useArtifact(n, 'goldrush_memory', 2, data);
  assert.ok(r1.ok);
  assert.equal(n.gold, gold0 + 100);
  const r2 = useArtifact(n, 'goldrush_memory', 3, data);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'ALREADY_USED');
});

test('예언의 구슬 — 성녀 없이도 침공 날짜가 정밀해진다', () => {
  const world = createWorld({ seed: 5, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.roles.saint.holder = null;
  assert.equal(collectHooks(n, data).flags.prophecyAlways, undefined);
  grantArtifact(n, 'orb_of_prophecy', 1, data);
  assert.equal(collectHooks(n, data).flags.prophecyAlways, true);
});

test('왕관의 조각 — 인구 상한 +20', () => {
  const world = createWorld({ seed: 6, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  grantArtifact(n, 'crown_shard', 1, data);
  assert.equal(collectHooks(n, data).populationCapDelta, 20);
});
