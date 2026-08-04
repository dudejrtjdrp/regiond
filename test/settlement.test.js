// 정착지 — 주민 유입 · 개별 건물 티어 · 울타리 조각 · 연대기 (docs/GDD3.md §4·§5·§7)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf } from '../server/engine/world.js';
import {
  completeStructure, effectValue, peakEffect, structuresOf, maxTier,
  syncLegacyBuildings, housingCapacity, isRuined,
} from '../server/engine/structures.js';
import {
  capacity, freeBeds, attractiveness, arrivalIntervalDays, stepArrivals, arrivalStatus, militiaList,
} from '../server/engine/residents.js';
import { fenceViews, aliveFences, segmentsFromPoints, blockingFence } from '../server/engine/fences.js';
import { chronicleView } from '../server/engine/chronicle.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });
const put = (w, n, key, tier, dx, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);

// ────────────────────────────────────────────────────────────────
// 주민 유입
// ────────────────────────────────────────────────────────────────
test('주민 유입 — 티어 1 전에는 아무도 오지 않는다', () => {
  const w = newWorld(3);
  const n = w.nations.player;
  const rng = createRng(3);
  put(w, n, 'hut', 1, 3);
  n.resources.grain = 100;
  const st = arrivalStatus(n, data);
  assert.equal(st.open, false);
  assert.equal(stepArrivals(w, n, data, rng).length, 0);
});

test('주민 유입 — 첫 사람은 조건이 서는 순간 바로 온다 (이름·외형과 함께)', () => {
  const w = newWorld(5);
  const n = w.nations.player;
  const rng = createRng(5);
  n.tier = 1;
  __openChapter(n, 5);
  put(w, n, 'hut', 1, 3);
  n.resources.grain = 100;
  const arrived = stepArrivals(w, n, data, rng);
  assert.equal(arrived.length, 1);
  assert.ok(arrived[0].name && arrived[0].name.length > 0, '이름이 붙는다');
  assert.ok(arrived[0].appearance && Number.isInteger(arrived[0].appearance.skin), '외형이 랜덤으로 붙는다');
  assert.equal(n.population, 1);
  assert.equal(n.villagers.length, 1, '주민은 실인원 — 1유닛 = 1명');
});

test('주민 유입 — 빈 자리가 없으면 오지 않는다', () => {
  const w = newWorld(7);
  const n = w.nations.player;
  const rng = createRng(7);
  n.tier = 1;
  __openChapter(n, 5);
  put(w, n, 'tent', 1, 3);
  n.resources.grain = 100;
  assert.equal(capacity(n, data), 1);
  stepArrivals(w, n, data, rng);
  assert.equal(freeBeds(n, data), 0);
  for (let i = 0; i < 10; i += 1) stepArrivals(w, n, data, rng);
  assert.equal(n.population, 1, '천막 하나에는 한 사람만');
  assert.equal(arrivalStatus(n, data).reason, '누울 자리가 없습니다.');
});

test('주민 유입 — 매력도(식량 잉여·장식·사기)가 도착 주기를 줄인다', () => {
  const w = newWorld(11);
  const n = w.nations.player;
  n.tier = 2;
  __openChapter(n, 8);
  put(w, n, 'house', 1, 3);
  n.population = 2;
  n.resources.grain = 4;                                  // 잉여 없음
  const slow = arrivalIntervalDays(n, data);
  n.resources.grain = 400;                                // 곳간이 넘친다
  const fast = arrivalIntervalDays(n, data);
  assert.ok(fast < slow, '식량 잉여가 있으면 빨리 온다');
  const before = attractiveness(n, data);
  put(w, n, 'banner', 1, -3);
  put(w, n, 'garden', 1, 6);
  assert.ok(attractiveness(n, data) > before, '장식이 매력도를 올린다');
  assert.ok(arrivalIntervalDays(n, data) >= data.balance.residents.arrival.minIntervalDays);
});

test('주민 유입 — 굶으면 사람이 떠난다(죽지 않는다)', () => {
  let w = newWorld(13);
  const rng = createRng(13);
  const n = w.nations.player;
  n.tier = 2;
  __openChapter(n, 8);
  put(w, n, 'house', 1, 3);
  for (let i = 0; i < 4; i += 1) stepArrivals(w, n, data, rng);
  n.resources.grain = 0;
  const pop0 = n.population;
  assert.ok(pop0 >= 1);
  for (let i = 0; i < data.balance.population.starvationGraceDays + 2; i += 1) {
    w = step(w, [], rng, data).state;
    w.nations.player.resources.grain = 0;
  }
  assert.ok(w.nations.player.population < pop0, '유예 기간이 지나면 사람이 준다');
  assert.equal(w.nations.player.villagers.length, w.nations.player.population);
});

// ────────────────────────────────────────────────────────────────
// 개별 건물 티어
// ────────────────────────────────────────────────────────────────
test('건물 — 같은 건물을 여러 채 짓고 각각 따로 올린다', () => {
  const w = newWorld(17);
  const n = w.nations.player;
  const rng = createRng(17);
  n.tier = 2;
  __openChapter(n, 8);
  n.resources.wood = 2000; n.resources.stone = 2000;
  const a = applyCommand(w, 'player', { type: 'placeBuilding', building: 'granary' }, data, rng);
  const b = applyCommand(w, 'player', { type: 'placeBuilding', building: 'granary' }, data, rng);
  assert.ok(a.ok && b.ok, '곡창은 여러 채 지을 수 있다');
  assert.notEqual(a.siteId, b.siteId);

  n.buildPoints = 200;
  w.nations.player.construction.forEach((c) => { c.remaining = 0; });
  const out = step(w, [], rng, data);
  const n2 = out.state.nations.player;
  assert.equal(structuresOf(n2, 'granary').length, 2);

  const target = structuresOf(n2, 'granary')[0];
  n2.resources.wood = 2000; n2.resources.stone = 2000;
  const up = applyCommand(out.state, 'player', { type: 'upgradeStructure', structureId: target.id }, data, rng);
  assert.ok(up.ok, JSON.stringify(up.error));
  assert.equal(up.tier, 2);
  assert.equal(up.structureId, target.id, '지목한 그 한 채만 올라간다');
});

test('효과 합산 — 동종은 더하되 그 건물 최고 티어 값이 상한이다 (밸런스 보호)', () => {
  const w = newWorld(19);
  const n = w.nations.player;
  const capValue = peakEffect('granary', 'output.grain', data);
  assert.equal(capValue, 0.46, 'T3 곡창의 +46% 가 상한 (★ §15-B-3 로 2×3 이 되며 올랐다)');
  put(w, n, 'granary', 1, 3);
  assert.ok(Math.abs(effectValue(n, 'output.grain', data) - 0.2) < 1e-9);
  put(w, n, 'granary', 1, 6);
  assert.ok(Math.abs(effectValue(n, 'output.grain', data) - 0.4) < 1e-9, '두 채면 합산된다');
  put(w, n, 'granary', 3, 9);
  put(w, n, 'granary', 3, 12);
  assert.ok(Math.abs(effectValue(n, 'output.grain', data) - capValue) < 1e-9, '상한을 넘지 않는다');
});

test('레거시 거울 — 검증된 매크로 공식이 읽는 nation.buildings 가 개별 건물에서 파생된다', () => {
  const w = newWorld(23);
  const n = w.nations.player;
  put(w, n, 'granary', 2, 3);
  put(w, n, 'storage', 1, 6);
  put(w, n, 'trading_post', 2, 9);
  syncLegacyBuildings(n, data);
  assert.equal(n.buildings.granary, 2);
  assert.equal(n.buildings.storage, 1);
  assert.equal(n.buildings.road, 2, '물류 티어(교역소)가 운임 공식의 도로 티어 자리에 들어간다');
  assert.equal(n.buildings.wall, 0, '성벽은 폐지됐다 — 방벽은 울타리 조각이다');
});

test('건물 — 티어 잠금과 한 채 제한을 서버가 막는다', () => {
  const w = newWorld(29);
  const n = w.nations.player;
  const rng = createRng(29);
  n.resources.wood = 5000; n.resources.stone = 5000; n.resources.steel = 500; n.gold = 500;
  const locked = applyCommand(w, 'player', { type: 'placeBuilding', building: 'arrow_tower' }, data, rng);
  assert.equal(locked.ok, false);
  assert.equal(locked.error.code, 'CHAPTER_LOCKED', '★ v3.1 — 잠금의 주체는 티어가 아니라 장이다');

  n.tier = 5;

  __openChapter(n, 10);
  const one = applyCommand(w, 'player', { type: 'placeBuilding', building: 'shrine' }, data, rng);
  assert.ok(one.ok);
  const two = applyCommand(w, 'player', { type: 'placeBuilding', building: 'shrine' }, data, rng);
  assert.equal(two.ok, false);
  assert.equal(two.error.code, 'ALREADY_BUILT');
});

test('수리 — 파손 건물은 효과가 줄고, 고치면 되돌아온다', () => {
  const w = newWorld(31);
  const n = w.nations.player;
  const rng = createRng(31);
  __openChapter(n, 8);
  const s = put(w, n, 'granary', 2, 3);
  const full = effectValue(n, 'output.grain', data);
  s.hp = s.maxHp * 0.2;
  assert.ok(effectValue(n, 'output.grain', data) < full, '반 이하로 부서지면 값을 못 한다');
  n.resources.wood = 2000; n.resources.stone = 2000;
  const r = applyCommand(w, 'player', { type: 'repairStructure', structureId: s.id }, data, rng);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(s.hp, s.maxHp);
  assert.ok(Math.abs(effectValue(n, 'output.grain', data) - full) < 1e-9);
});

// ────────────────────────────────────────────────────────────────
// 울타리 조각
// ────────────────────────────────────────────────────────────────
test('울타리 — 드래그 경로가 조각으로 쪼개진다', () => {
  const segs = segmentsFromPoints([{ x: 10, y: 10 }, { x: 14, y: 10 }], data);
  assert.equal(segs.length, 4);
  assert.deepEqual(segs[0], { x1: 10, y1: 10, x2: 11, y2: 10 });
});

test('placeFence — 자재를 내고 조각이 선다. 문 조각도 함께.', () => {
  const w = newWorld(37);
  const n = w.nations.player;
  const rng = createRng(37);
  const t = townOf(w, 'player');
  n.tier = 2;
  __openChapter(n, 8);
  n.resources.wood = 400;
  const before = n.resources.wood;
  const r = applyCommand(w, 'player', {
    type: 'placeFence',
    points: [{ x: t.x + 3, y: t.y - 2 }, { x: t.x + 3, y: t.y + 2 }],
    gates: [0],
  }, data, rng);
  assert.ok(r.ok, JSON.stringify(r.error));
  assert.equal(r.placed, 4);
  assert.ok(n.resources.wood < before, '자재를 낸다');
  const views = fenceViews(n, data);
  assert.equal(views.filter((f) => f.gate).length, 1, '문 조각 1');
  assert.equal(views[0].name, '목문');
  assert.ok(views.every((f) => f.hp === f.maxHp));
});

test('placeFence — 7장 전에는 두를 수 없고, 겹치는 조각은 걸러진다', () => {
  const w = newWorld(41);
  const n = w.nations.player;
  const rng = createRng(41);
  const t = townOf(w, 'player');
  n.resources.wood = 400;
  const locked = applyCommand(w, 'player', { type: 'placeFence', points: [{ x: t.x + 3, y: t.y }, { x: t.x + 5, y: t.y }] }, data, rng);
  assert.equal(locked.ok, false);
  assert.equal(locked.error.code, 'CHAPTER_LOCKED', '★ v3.1 — 울타리는 7장(낯선 발자국)에서 열린다');

  n.tier = 2;

  __openChapter(n, 8);
  const first = applyCommand(w, 'player', { type: 'placeFence', points: [{ x: t.x + 3, y: t.y }, { x: t.x + 5, y: t.y }] }, data, rng);
  assert.ok(first.ok);
  const again = applyCommand(w, 'player', { type: 'placeFence', points: [{ x: t.x + 3, y: t.y }, { x: t.x + 5, y: t.y }] }, data, rng);
  assert.equal(again.ok, false, '같은 자리에 두 번 세우지 않는다');
});

test('upgradeFence — 목책이 석벽이 되고 내구도가 오른다', () => {
  const w = newWorld(43);
  const n = w.nations.player;
  const rng = createRng(43);
  const t = townOf(w, 'player');
  n.tier = 2;
  __openChapter(n, 8);
  n.resources.wood = 400; n.resources.stone = 400;
  applyCommand(w, 'player', { type: 'placeFence', points: [{ x: t.x + 3, y: t.y - 1 }, { x: t.x + 3, y: t.y + 1 }] }, data, rng);
  const woodHp = n.fences[0].maxHp;
  const up = applyCommand(w, 'player', { type: 'upgradeFence' }, data, rng);
  assert.ok(up.ok, JSON.stringify(up.error));
  assert.ok(n.fences.every((f) => f.tier === 2));
  assert.ok(n.fences[0].maxHp > woodHp);
  assert.equal(fenceViews(n, data)[0].name, '석벽');
});

test('울타리 — 적이 오는 길을 막는 조각을 서버가 고른다 (자동 성곽 링 폐지)', () => {
  const w = newWorld(47);
  const n = w.nations.player;
  const rng = createRng(47);
  const t = townOf(w, 'player');
  n.tier = 2;
  __openChapter(n, 8);
  n.resources.wood = 400;
  applyCommand(w, 'player', { type: 'placeFence', points: [{ x: t.x + 4, y: t.y - 3 }, { x: t.x + 4, y: t.y + 3 }] }, data, rng);
  const blocking = blockingFence(n, { x: t.x + 12, y: t.y }, { x: t.x, y: t.y });
  assert.ok(blocking, '동쪽에서 오는 적은 동쪽 울타리에 막힌다');
  const behind = blockingFence(n, { x: t.x - 12, y: t.y }, { x: t.x, y: t.y });
  assert.equal(behind, null, '서쪽에는 울타리가 없다');
  assert.equal(aliveFences(n).length, n.fences.length);
});

// ────────────────────────────────────────────────────────────────
// 민병 · 연대기
// ────────────────────────────────────────────────────────────────
test('민병 — 수비 배치 주민이 나와 서고, 병영 정원만큼만 제대로 훈련된다', () => {
  const w = newWorld(53);
  const n = w.nations.player;
  const rng = createRng(53);
  n.tier = 4;
  __openChapter(n, 10);
  put(w, n, 'manor', 3, 3);
  put(w, n, 'manor', 3, 6);
  for (let i = 0; i < 10; i += 1) stepArrivals(w, n, data, rng);
  for (const u of n.villagers) u.job = 'defense';
  const untrained = militiaList(n, data);
  assert.equal(untrained.length, n.villagers.length);
  assert.ok(untrained.every((m) => !m.trained), '병영이 없으면 전부 쇠스랑 부대');

  put(w, n, 'barracks', 1, -4);
  const withBarracks = militiaList(n, data);
  const trained = withBarracks.filter((m) => m.trained);
  assert.ok(trained.length > 0 && trained.length <= data.buildings.barracks.tiers[0].militiaSlots);
  assert.ok(trained[0].dps > untrained[0].dps, '훈련된 민병이 더 강하다');
});

test('연대기 — 시즌 결산 대신 누적 기록이 쌓인다', () => {
  let w = newWorld(59);
  const rng = createRng(59);
  const n = w.nations.player;
  put(w, n, 'hut', 1, 3);
  n.resources.grain = 60;
  w = step(w, [], rng, data).state;
  // ★ GDD3 §12-2 — 승격은 저절로 오지 않는다. 본부의 [승격] 단추가 발동한다.
  const promoted = applyCommand(w, 'player', { type: 'promoteSettlement' }, data, rng);
  assert.equal(promoted.ok, true, JSON.stringify(promoted.error));
  const view = chronicleView(w, w.nations.player, data);
  assert.ok(view.entries.length > 0);
  assert.ok(view.entries.some((e) => e.kind === 'tier_up'));
  assert.equal(typeof view.totals.days, 'number');
  assert.equal(w.seasonEnded, undefined, '시즌 종료 플래그는 폐지됐다');
});
