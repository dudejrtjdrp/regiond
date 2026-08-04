import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import {
  cobbDouglas, clampedOfficerBuilding, localPrice, targetStock, storageCapacity,
  applySpoilage, departmentCapital, officerFactor, buildingFactor, tagFactor,
} from '../server/engine/economy.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { produceNation } from '../server/engine/tick.js';
import { collectHooks } from '../server/engine/artifacts.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const P = data.balance.production;

test('밸런스 §1 — 기준 배분에서 A값 역산이 목표 산출을 재현한다', () => {
  const a = P.laborExponent, b = P.capitalExponent;
  const A = P.technologyCoefficients;
  const L = P.baselineLabor, K = P.baselineCapital;
  assert.ok(Math.abs(cobbDouglas(A.grain, L.farm, K.farm, a, b) - 50) < 0.05, '곡물 50/일');
  assert.ok(Math.abs(cobbDouglas(A.steel, L.factory, K.factory, a, b) - 12) < 0.05, '강재 12/일');
  assert.ok(Math.abs(cobbDouglas(A.build, L.build, K.build, a, b) - 8) < 0.05, '건설포인트 8/일');
  assert.ok(Math.abs(cobbDouglas(A.defense, L.defense, K.defense, a, b) - 15) < 0.05, '방어게이지 15/일');
});

test('인구 50 · 기준 배분(농정 40%)에서 곡물 산출이 인구 수요와 정확히 일치한다', () => {
  const world = createWorld({ seed: 1, data, assignments: npcAssignments(data) });
  const nation = world.nations.player;
  // ★ GDD3 §8 — 부처(콥더글러스)는 정착지 티어 3부터 돈다. 공식 자체는 무수정이므로
  //   기준 인구·기준 배분을 명시해 옛 검증표를 그대로 재현한다.
  nation.tier = 3;
  __openChapter(nation, 10);
  nation.population = 50;
  nation.tags = [];                       // 태그 보정 제외 (기준 자급률 측정)
  nation.morale = 1;
  nation.resources.grain = 0;
  const out = produceNation(world, nation, data, collectHooks(nation, data));
  assert.ok(Math.abs(out.grain - 50) < 0.1, `곡물 산출 ${out.grain} ≈ 50`);
  assert.equal(nation.population, 50);
});

test('인구가 늘어도 자급률이 유지된다 (밸런스 §6-2)', () => {
  for (const pop of [50, 90, 160, 260]) {
    const world = createWorld({ seed: 2, data, assignments: npcAssignments(data) });
    const nation = world.nations.player;
    nation.tags = []; nation.morale = 1; nation.population = pop; nation.tier = 3;
    __openChapter(nation, 10);
    const out = produceNation(world, nation, data, collectHooks(nation, data));
    const demand = pop * data.balance.population.grainPerCapita;
    assert.ok(Math.abs(out.grain / demand - 1) < 0.01, `인구 ${pop}: 산출 ${out.grain.toFixed(1)} / 수요 ${demand}`);
  }
});

test('O × B 클램프 — 곱연산 보너스는 1.8을 넘지 않는다 (§14-⑥)', () => {
  const cap = P.officerBuildingClamp;
  assert.equal(cap, 1.8);
  assert.equal(clampedOfficerBuilding(1.0, 1.0, cap), 1.0);
  assert.ok(Math.abs(clampedOfficerBuilding(1.5, 1.15, cap) - 1.725) < 1e-9);
  assert.equal(clampedOfficerBuilding(1.5, 1.5, cap), 1.8, '1.5×1.5=2.25 → 1.8로 클램프');
  assert.ok(Math.abs(clampedOfficerBuilding(1.5, 1.2, cap) - 1.8) < 1e-9, '1.8 정확히');
  assert.ok(clampedOfficerBuilding(1.5, 4.0, cap) <= cap);
});

test('장관 보정 O — 공석 0.65, 재임 1.00+0.08×Lv, 상한 1.50', () => {
  const world = createWorld({ seed: 3, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.roles.farm.holder = null;
  assert.equal(officerFactor(n, 'farm', data, 0), 0.65);
  n.roles.farm.holder = 'npc'; n.roles.farm.level = 0;
  assert.equal(officerFactor(n, 'farm', data, 0), 1.0);
  n.roles.farm.level = 5;
  assert.ok(Math.abs(officerFactor(n, 'farm', data, 0) - 1.4) < 1e-9);
  n.roles.farm.level = 9;
  assert.equal(officerFactor(n, 'farm', data, 0), 1.5, '상한 1.50');
});

/* ★ §15-B-3 로 곡창이 2×2→2×3 이 되면서 산출도 그만큼 올랐다(+20/32/46%). 자리 값을 치른 몫이다. */
test('건물 보너스 B — 곡창 티어 +20/32/46%', () => {
  const world = createWorld({ seed: 4, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.roles.farm.level = 0;
  for (const [tier, expected] of [[0, 1.0], [1, 1.20], [2, 1.32], [3, 1.46]]) {
    n.buildings.granary = tier;
    assert.ok(Math.abs(buildingFactor(n, 'grain', data) - expected) < 1e-9, `T${tier} → ${expected}`);
  }
});

test('지역 태그 T — 비옥지 +40%, 척박지 −35%, 대삼림 목재 +50%', () => {
  const world = createWorld({ seed: 5, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.tags = ['fertile'];
  assert.ok(Math.abs(tagFactor(n, 'grain', data) - 1.4) < 1e-9);
  n.tags = ['barren'];
  assert.ok(Math.abs(tagFactor(n, 'grain', data) - 0.65) < 1e-9);
  n.tags = ['greatwood'];
  assert.ok(Math.abs(tagFactor(n, 'wood', data, 'gather') - 1.5) < 1e-9);
});

test('로컬 가격 — clamp(0.30, 4.00), 지수 0.6', () => {
  const world = createWorld({ seed: 6, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.population = 50;
  const tgt = targetStock(n, 'grain', data);
  const ref = data.resources.meta.grain.referencePrice;

  n.resources.grain = tgt;
  assert.ok(Math.abs(localPrice(n, 'grain', data) - ref) < 1e-9, '재고=목표 → 기준가');

  n.resources.grain = tgt / 2;
  assert.ok(Math.abs(localPrice(n, 'grain', data) - ref * Math.pow(2, 0.6)) < 1e-9, '재고 절반 → 약 1.5배');
  assert.ok(Math.abs(localPrice(n, 'grain', data) / ref - 1.5157) < 0.001);

  n.resources.grain = 0;
  assert.equal(localPrice(n, 'grain', data), ref * 4.0, '재고 0 → 상한 4.00배');

  n.resources.grain = tgt * 1000;
  assert.equal(localPrice(n, 'grain', data), ref * 0.30, '과잉 → 하한 0.30배');
});

test('창고 용량과 부패 — 초과분 2%/일', () => {
  const world = createWorld({ seed: 7, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.population = 50;
  n.buildings.storage = 0;
  const cap = storageCapacity(n, 'grain', data);
  assert.equal(cap, targetStock(n, 'grain', data) * data.balance.price.storageMultiplierByTier[0]);

  n.resources.grain = cap + 100;
  const spoiled = applySpoilage(n, data);
  assert.ok(Math.abs(spoiled.grain - 2) < 0.01, '초과 100의 2% = 2');
  assert.ok(Math.abs(n.resources.grain - (cap + 98)) < 0.01);

  n.buildings.storage = 3;
  assert.equal(storageCapacity(n, 'grain', data), targetStock(n, 'grain', data) * 5, '저장 T3 → 5배');
});

test('부처 자본 K는 인구에 비례한다 (§6-2)', () => {
  const world = createWorld({ seed: 8, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.population = 260;
  assert.ok(Math.abs(departmentCapital(n, 'defense', data) - 8 * (260 / 50)) < 1e-9);
});
