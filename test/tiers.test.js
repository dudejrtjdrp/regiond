// 성장 아크 — docs/GDD3.md §1. 티어 조건·해금·영토 반경·전역 속도 보너스.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { applyCommand } from '../server/engine/commands.js';
import {
  tierDef, tierRadius, nextTierStatus, evaluateTier, tierUnlockedList,
  tierSpeedBonus, settlementTier,
} from '../server/engine/tiers.js';
import {
  unlockedList, buildingUnlocked, featureUnlocked, departmentsActive,
} from '../server/engine/progression.js';
import { territoryRadius } from '../server/engine/world.js';
import { spawnResident, capacity } from '../server/engine/residents.js';
import { completeStructure } from '../server/engine/structures.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });

test('티어 0 — 마차에서 내린 자리: 주민 0, 모닥불 하나, 반경 6', () => {
  const w = newWorld();
  const n = w.nations.player;
  assert.equal(settlementTier(n), 0);
  assert.equal(n.population, 0, '인구 0에서 시작한다');
  assert.equal(n.villagers.length, 0);
  assert.deepEqual(n.structures.map((s) => s.key), ['campfire']);
  assert.equal(territoryRadius(n, data), tierRadius(0, data));
  assert.equal(tierRadius(0, data), 6);
});

test('티어 표 — 조건·반경이 GDD3 §1 표와 일치한다', () => {
  const expect = [[0, 6], [1, 9], [2, 12], [3, 16], [4, 20], [5, 25], [6, 29]];
  for (const [tier, radius] of expect) {
    assert.equal(tierDef(tier, data).radius, radius, `T${tier} 반경 ${radius}`);
  }
  assert.equal(tierDef(1, data).requires.structures.hut, 1);
  assert.equal(tierDef(1, data).requires.resources.grain, 20);
  assert.equal(tierDef(2, data).requires.population, 5);
  assert.equal(tierDef(3, data).requires.population, 12);
  assert.equal(tierDef(4, data).requires.population, 25);
  assert.equal(tierDef(5, data).requires.population, 45);
  assert.equal(tierDef(6, data).requires.population, 70);
});

test('엔드리스 — 표 밖의 티어도 규칙으로 이어진다(인구 문턱 +30, 반경 +4)', () => {
  const e = data.tiers.endless;
  const t7 = tierDef(7, data);
  const t8 = tierDef(8, data);
  assert.ok(t7.endless);
  assert.equal(t7.radius, tierDef(6, data).radius + e.radiusPerTier);
  assert.equal(t7.requires.population, tierDef(6, data).requires.population + e.populationStep);
  assert.equal(t8.radius, t7.radius + e.radiusPerTier);
});

test('티어업 — 조건이 차면 영토가 넓어진다 (개척령 폐지)', () => {
  const w = newWorld(7);
  const n = w.nations.player;
  const rng = createRng(7);
  assert.equal(nextTierStatus(n, data).ready, false);

  completeStructure(w, n, { building: 'hut', tier: 1, x: n.structures[0].x + 5, y: n.structures[0].y, placed: true }, data);
  n.resources.grain = 25;
  const st = nextTierStatus(n, data);
  assert.ok(st.ready, JSON.stringify(st.reqs));

  const leveled = evaluateTier(w, n, data);
  assert.equal(leveled.length, 1);
  assert.equal(leveled[0].tier, 1);
  assert.equal(territoryRadius(n, data), 9, '반경이 6 → 9 로 넓어진다');
  assert.equal(leveled[0].fromRadius, 6);

  // 개척령 명령은 더 이상 없다
  assert.equal(applyCommand(w, 'player', { type: 'expand' }, data, rng).ok, false);
});

test('티어업 — 조건이 여러 단계 차 있으면 (사람 손이 닿지 않는 국가는) 한 번에 오른다', () => {
  const w = newWorld(9);
  const n = w.nations.player;
  const rng = createRng(9);
  completeStructure(w, n, { building: 'hut', tier: 1, x: n.structures[0].x + 5, y: n.structures[0].y, placed: true }, data);
  n.resources.grain = 40;
  for (let i = 0; i < 13; i += 1) spawnResident(w, n, data, rng);
  const leveled = evaluateTier(w, n, data);
  assert.ok(leveled.length >= 3, `한 번에 ${leveled.length}단계`);
  assert.equal(settlementTier(n), 3);
  assert.equal(territoryRadius(n, data), 16);
});

test('해금 — ★ v3.1: 티어가 아니라 장(chapter)이 정본이다', () => {
  const w = newWorld(11);
  const n = w.nations.player;
  // 1장에서는 **아무것도 지을 수 없다**. "지을 게 없습니다" 라는 말이 나올 자리가 아예 없어야 한다.
  assert.equal(buildingUnlocked(n, 'tent', data), false, '천막은 2장부터');
  assert.equal(buildingUnlocked(n, 'hut', data), false, '오두막은 3장 첫 칸을 지나야');
  assert.equal(buildingUnlocked(n, 'granary', data), false);

  const u0 = unlockedList(n, data);
  assert.ok(u0.features.includes('swing'));
  assert.equal(u0.features.includes('residentArrival'), false);
  assert.equal(u0.features.includes('waves'), false);
  assert.deepEqual(u0.buildings, [], '1장 배치대는 비어 있다');

  // 티어만 올려서는 아무 문도 열리지 않는다 (사슬 새치기 봉쇄)
  n.tier = 4;
  const uTierOnly = unlockedList(n, data);
  assert.deepEqual(uTierOnly, u0, '티어 4가 되어도 1장이면 해금은 그대로다');
  assert.ok(tierUnlockedList(n, data).features.includes('trade'), '티어표에는 적혀 있지만 합류하지 않는다');

  // 마지막 장(엔드리스)에 들어서야 티어 해금이 합류한다
  __openChapter(n, 10);
  const u10 = unlockedList(n, data);
  for (const f of ['residentArrival', 'waves', 'roles', 'trade', 'departments', 'council']) {
    assert.ok(u10.features.includes(f), `엔드리스에서 ${f} 해금`);
  }
  assert.ok(u10.buildings.includes('arrow_tower'));
  assert.ok(featureUnlocked(n, 'emotionDay', data));
  assert.ok(departmentsActive(n, data));
});

test('전역 작업 속도 — 티어당 +5%', () => {
  const w = newWorld(13);
  const n = w.nations.player;
  assert.equal(tierSpeedBonus(n, data), 0);
  n.tier = 4;
  __openChapter(n, 10);
  assert.ok(Math.abs(tierSpeedBonus(n, data) - 0.2) < 1e-9);
});

test('감정의 날 — ★ v3.1: 티어 마일스톤 자동 발동이 폐기됐다', () => {
  const w = newWorld(17);
  const rng = createRng(17);

  // 시간만 흘려서는 오지 않는다 (예전에도 그랬다)
  let world = w;
  for (let i = 0; i < 8; i += 1) world = step(world, [], rng, data).state;
  assert.equal(world.emotionDayDone, false);

  // ★ 이제는 티어 3에 닿아도 오지 않는다 — 감정소를 세우고 손수 눌러야 한다(progression.test.js)
  const p = world.nations.player;
  completeStructure(world, p, { building: 'hut', tier: 1, x: p.structures[0].x + 5, y: p.structures[0].y, placed: true }, data);
  p.resources.grain = 60;
  for (let i = 0; i < 13; i += 1) spawnResident(world, p, data, rng);
  const out = step(world, [], rng, data);
  // ★ GDD3 §12-2 — 일 틱은 이제 티어를 올리지 않는다. 조건이 다 차 있어도 저절로는 안 오른다.
  assert.equal(out.events.some((e) => e.kind === 'tier_up'), false, '시간은 승격도 열지 않는다');
  assert.equal(settlementTier(out.state.nations.player), 0);

  // 본부의 [승격]을 누르면 그때 오른다 — 한 번에 한 단계씩
  const up = applyCommand(out.state, 'player', { type: 'promoteSettlement' }, data, rng);
  assert.equal(up.ok, true, JSON.stringify(up.error));
  assert.equal(up.tier, 1);
  assert.ok(up.events.some((e) => e.kind === 'tier_up'));
  assert.equal(out.state.emotionDayDone, false, '★ 티어가 감정의 날을 열지 않는다');
  assert.equal(out.events.some((e) => e.kind === 'emotion_day'), false);
  assert.equal(out.events.some((e) => e.kind === 'mandate'), false);
  assert.ok((out.state.chronicle || []).some((c) => c.kind === 'tier_up'), '연대기에는 남는다');
});

test('★ §12-2 승격 — 조건이 모자라면 튕기고, 차면 한 단계씩 오른다', () => {
  const w = newWorld(23);
  const n = w.nations.player;
  const rng = createRng(23);

  const early = applyCommand(w, 'player', { type: 'promoteSettlement' }, data, rng);
  assert.equal(early.ok, false);
  assert.equal(early.error.code, 'NOT_READY');
  assert.match(early.error.message, /오두막|식량/, '무엇이 모자란지 말해 준다');

  completeStructure(w, n, { building: 'hut', tier: 1, x: n.structures[0].x + 5, y: n.structures[0].y, placed: true }, data);
  n.resources.grain = 60;
  for (let i = 0; i < 13; i += 1) spawnResident(w, n, data, rng);

  // 조건이 세 단계 치 차 있어도 한 번 누르면 한 단계다
  const a = applyCommand(w, 'player', { type: 'promoteSettlement' }, data, rng);
  assert.equal(a.ok, true);
  assert.equal(settlementTier(n), 1);
  assert.equal(territoryRadius(n, data), 9);

  const b = applyCommand(w, 'player', { type: 'promoteSettlement' }, data, rng);
  assert.equal(b.ok, true);
  assert.equal(settlementTier(n), 2);

  // ★ 본부가 정착지를 따라 자란다(모닥불 → 야영 본부 → 촌락 회관)
  const hq = n.structures.find((s) => data.buildings[s.key]?.hq);
  assert.ok(hq, '본부가 있다');
  assert.equal(hq.tier, 3, '티어 2 정착지의 본부는 3단(촌락 회관)');
  assert.equal(data.buildings.campfire.tiers[hq.tier - 1].name, '촌락 회관');
});

/* ★ §15-B-3 — 가옥 2×2→2×3, 저택 3×3→3×4. 자리를 넓게 쓰는 만큼 더 많이 산다. */
test('주거 수용력 — 천막1 / 오두막2 / 가옥5 / 저택10', () => {
  const w = newWorld(19);
  const n = w.nations.player;
  const put = (key, tier, dx) => completeStructure(w, n, { building: key, tier, x: n.structures[0].x + dx, y: n.structures[0].y, placed: true }, data);
  assert.equal(capacity(n, data), 0);
  put('tent', 1, 3); assert.equal(capacity(n, data), 1);
  put('hut', 1, 6); assert.equal(capacity(n, data), 3);
  put('house', 1, 9); assert.equal(capacity(n, data), 8);
  put('manor', 1, 12); assert.equal(capacity(n, data), 18);
});
