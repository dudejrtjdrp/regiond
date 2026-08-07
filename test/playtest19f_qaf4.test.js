// ★ §19-F4 (QA-F4) 연구 체계 개편 + 기차
//
// 이 파일이 지키는 계약:
//   ① 연구소는 **여는 문을 건드리지 않는다** — 티어·선행·값은 그대로고 하루 걸음만 늘어난다(F09-1)
//   ② 연구소가 없으면 하루는 정확히 1 이다 — 옛 세이브의 진행이 한 칸도 달라지지 않는다(F09-1)
//   ③ 건물 목록에 '연구' 갈래가 있고, 그 안의 연구소가 분야별로 다르게 붙는다(F09-1)
//   ④ 정거장은 철로 연구 없이는 못 세운다(F09-2)
//   ⑤ 정거장 둘이면 기차 한 대가 서고, 정거장 사이를 왕복한다(F09-2)
//   ⑥ 정거장에서 타면 몸을 서버가 옮긴다 — 타는 동안 걷지 못하고, 다음 정거장에서 내린다(F09-2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { applyCommand } from '../server/engine/commands.js';
import { completeStructure, researchSpeedBonus, researchHasteDiscount, startBuild } from '../server/engine/structures.js';
import {
  ensureResearch, researchStatus, researchView, researchStep, stepResearch, hasteCost,
} from '../server/engine/research.js';
import { stepTrains, trainSummary, riding, stationList } from '../server/engine/train.js';

const data = loadGameData();

/** 연구를 붙들 수 있는 판 하나 — 끝없는 장 · 티어 6 · 넉넉한 곳간 */
function labWorld(seed = 42) {
  const world = createWorld({ seed, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.tier = 6;
  openChapterForDebug(null, n, data, 10);
  n.gold = 20000;
  for (const r of data.resources.order) n.resources[r] = 5000;
  return world;
}

const put = (world, n, key, x, y, tier = 1) =>
  completeStructure(world, n, { building: key, tier, x, y, placed: true }, data);

// ────────────────────────────────────────────────────────────────
// ① · ② F09-1 — 연구소는 문을 열지 않고 걸음만 늘린다
// ────────────────────────────────────────────────────────────────
test('★ §19-F4(F09-1) 연구소가 없으면 하루는 정확히 1 — 옛 판의 진행이 한 칸도 안 달라진다', () => {
  const world = labWorld();
  const n = world.nations.player;
  assert.equal(researchSpeedBonus(n, 'land', data), 0, '연구소가 없으면 배수가 0');
  assert.equal(researchStep(n, 'agronomy', data), 1, '하루가 깎는 날수는 1');
  applyCommand(world, 'player', { type: 'startResearch', key: 'agronomy' }, data);
  const before = ensureResearch(n).active.remainingDays;
  stepResearch(world, n, data, null);
  assert.equal(ensureResearch(n).active.remainingDays, before - 1, '하루에 하루씩');
});

test('★ §19-F4(F09-1) 서고는 살림 갈래만, 공방은 기관 갈래만 앞당긴다 — 분야가 갈린다', () => {
  const world = labWorld();
  const n = world.nations.player;
  put(world, n, 'library', 30, 30);
  assert.ok(researchSpeedBonus(n, 'land', data) > 0, '서고는 살림에 붙는다');
  assert.equal(researchSpeedBonus(n, 'machine', data), 0, '서고는 기관에 안 붙는다');
  put(world, n, 'workshop', 34, 30);
  assert.ok(researchSpeedBonus(n, 'machine', data) > 0, '공방은 기관에 붙는다');
  assert.equal(researchStep(n, 'agronomy', data), 1 + researchSpeedBonus(n, 'land', data));
  assert.equal(researchStep(n, 'coal_mining', data), 1 + researchSpeedBonus(n, 'machine', data));
});

test('★ §19-F4(F09-1) 대학당은 갈래를 가리지 않고, 하루를 사는 값도 깎는다', () => {
  const world = labWorld();
  const n = world.nations.player;
  const bare = hasteCost('refining', data, n);
  put(world, n, 'academy', 40, 40);
  assert.ok(researchSpeedBonus(n, 'land', data) > 0 && researchSpeedBonus(n, 'machine', data) > 0);
  assert.ok(researchHasteDiscount(n, data) > 0, '가속 값이 깎인다');
  assert.ok(hasteCost('refining', data, n) < bare, '같은 연구를 더 싸게 당긴다');
  assert.equal(hasteCost('refining', data), bare, 'nation 을 안 주면 옛 값 그대로 — 호환');
});

test('★ §19-F4(F09-1) 연구소는 여는 문을 건드리지 않는다 — 티어·선행·값이 그대로다', () => {
  const world = labWorld();
  const n = world.nations.player;
  const before = researchStatus(n, 'internal_combustion', data);
  put(world, n, 'academy', 40, 40);
  put(world, n, 'workshop', 34, 30);
  const after = researchStatus(n, 'internal_combustion', data);
  assert.equal(after.requiresTier, before.requiresTier);
  assert.deepEqual(after.requires, before.requires);
  assert.equal(after.gold, before.gold);
  assert.deepEqual(after.cost, before.cost);
  assert.equal(after.days, before.days, 'days(정본 기간)는 그대로 — 걸음만 커진다');
  assert.ok(after.step > before.step);
});

test('★ §19-F4(F09-1) 연구소가 서면 같은 연구가 더 적은 날에 끝난다', () => {
  const fast = labWorld();
  const nf = fast.nations.player;
  put(fast, nf, 'library', 30, 30, 2);
  applyCommand(fast, 'player', { type: 'startResearch', key: 'city_planning' }, data);
  let days = 0;
  while (ensureResearch(nf).active && days < 20) { stepResearch(fast, nf, data, null); days += 1; }
  assert.ok(!ensureResearch(nf).active, '끝났다');
  assert.ok(days < data.research.defs.city_planning.days, `${days}일 < 정본 ${data.research.defs.city_planning.days}일`);
});

test('★ §19-F4(F09-1) 합산에는 상한이 있다 — 연구소를 줄지어 세워도 하루가 무한히 커지지 않는다', () => {
  const world = labWorld();
  const n = world.nations.player;
  for (let i = 0; i < 8; i += 1) put(world, n, 'library', 20 + i * 4, 20, 2);
  put(world, n, 'academy', 40, 40, 2);
  assert.ok(researchSpeedBonus(n, 'land', data) <= data.research.labs.maxBonus + 1e-9, '상한에 눌린다');
});

test('★ §19-F4(F09-1) 건물 도감에 「연구」 갈래가 있고 연구소 셋이 그 안에 있다', () => {
  const cat = data.buildings.categories.research;
  assert.ok(cat, '연구 갈래가 있다');
  assert.deepEqual(cat.order, ['library', 'workshop', 'academy']);
  for (const k of cat.order) assert.equal(data.buildings[k].category, 'research', `${k} 의 갈래`);
  // 갈래 표는 연구 정본이 쥔다 — 연구마다 분야가 적혀 있다
  for (const key of data.research.order) {
    const f = data.research.defs[key].field;
    assert.ok(f === 'land' || f === 'machine', `${key} 의 분야(${f})`);
  }
});

test('★ §19-F4(F09-1) 연구 뷰가 갈래별 걸음을 실어 보낸다 — 화면이 제 셈을 하지 않는다', () => {
  const world = labWorld();
  const n = world.nations.player;
  put(world, n, 'library', 30, 30);
  const v = researchView(n, data);
  assert.ok(v.labs, 'labs 칸이 있다');
  const land = v.labs.fields.find((f) => f.key === 'land');
  assert.ok(land && land.bonus > 0);
  assert.ok(v.list.every((x) => typeof x.step === 'number'), '연구마다 걸음이 실린다');
});

// ────────────────────────────────────────────────────────────────
// ④ ~ ⑥ F09-2 — 기차
// ────────────────────────────────────────────────────────────────
test('★ §19-F4(F09-2) 정거장은 철로를 배운 뒤에만 세운다', () => {
  const world = labWorld();
  const n = world.nations.player;
  const blocked = startBuild(world, n, { building: 'station' }, data);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'RESEARCH_REQUIRED');
  ensureResearch(n).done.railway = 1;
  const okRes = startBuild(world, n, { building: 'station' }, data);
  assert.equal(okRes.ok, true, '철로를 배우면 착공된다');
});

/** 철로를 배우고 정거장 둘이 선 판 */
function railWorld() {
  const world = labWorld();
  const n = world.nations.player;
  ensureResearch(n).done.railway = 1;
  const town = world.map.towns.find((t) => t.nationId === 'player') ?? { x: 60, y: 60 };
  put(world, n, 'station', town.x - 6, town.y);
  put(world, n, 'station', town.x + 6, town.y);
  return { world, n };
}

test('★ §19-F4(F09-2) 정거장 둘이면 기차 한 대가 선다 — 하나뿐이면 서지 않는다', () => {
  const world = labWorld();
  const n = world.nations.player;
  ensureResearch(n).done.railway = 1;
  put(world, n, 'station', 50, 60);
  stepTrains(world, n, data, 1);
  assert.equal((n.trains || []).length, 0, '정거장 하나로는 못 다닌다');
  put(world, n, 'station', 62, 60);
  stepTrains(world, n, data, 1);
  assert.equal(n.trains.length, 1, '둘이 되면 한 대가 선다');
  assert.equal(stationList(n).length, 2);
  assert.equal(trainSummary(n, data).open, true);
});

test('★ §19-F4(F09-2) 기차는 정거장 사이를 왕복한다 — 끝에 닿으면 되돌아선다', () => {
  const { world, n } = railWorld();
  stepTrains(world, n, data, 1);
  const t = n.trains[0];
  const startX = t.x;
  let flips = 0;
  let dir = t.dir;
  for (let i = 0; i < 400; i += 1) {
    stepTrains(world, n, data, 0.5);
    if (n.trains[0].dir !== dir) { dir = n.trains[0].dir; flips += 1; }
  }
  assert.ok(flips >= 2, `양 끝에서 되돌아섰다 (${flips}회)`);
  assert.ok(Number.isFinite(n.trains[0].x) && Number.isFinite(n.trains[0].y));
  assert.ok(Math.abs(n.trains[0].x - startX) < 40, '노선 밖으로 달아나지 않는다');
});

test('★ §19-F4(F09-2) 정거장에서 타면 몸이 기차를 따라간다 — 그동안은 걷지 못한다', () => {
  const { world, n } = railWorld();
  stepTrains(world, n, data, 1);
  const t = n.trains[0];
  n.avatars = { lord: { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0 } };
  const res = applyCommand(world, 'player', { type: 'boardTrain', avatarId: 'lord' }, data);
  assert.equal(res.ok, true, '곁에 선 기차에 탄다');
  assert.ok(riding(n, 'lord'), '탑승 장부에 오른다');
  const walk = applyCommand(world, 'player', { type: 'lordMove', avatarId: 'lord', x: 5, y: 5 }, data);
  assert.equal(walk.ok, false);
  assert.equal(walk.error.code, 'RIDING', '타고 있는 동안에는 자리 보고를 안 받는다');
  const was = { x: n.avatars.lord.x, y: n.avatars.lord.y };
  for (let i = 0; i < 12; i += 1) stepTrains(world, n, data, 0.5);
  assert.equal(n.avatars.lord.x, n.trains[0].x, '몸이 기차 위에 있다');
  assert.notEqual(`${was.x},${was.y}`, `${n.avatars.lord.x},${n.avatars.lord.y}`, '실려 움직였다');
});

test('★ §19-F4(F09-2) 다음 정거장에 닿으면 저절로 내린다 — 그 자리는 승강장이다', () => {
  const { world, n } = railWorld();
  stepTrains(world, n, data, 1);
  n.avatars = { lord: { id: 'lord', name: '개척자', x: n.trains[0].x, y: n.trains[0].y, tick: 0 } };
  applyCommand(world, 'player', { type: 'boardTrain', avatarId: 'lord' }, data);
  let dropped = null;
  for (let i = 0; i < 200 && !dropped; i += 1) {
    const out = stepTrains(world, n, data, 0.5);
    dropped = out.arrivals.find((a) => a.dropped.includes('lord')) ?? null;
  }
  assert.ok(dropped, '어느 정거장엔가 내려 주었다');
  assert.equal(riding(n, 'lord'), null, '내린 뒤에는 장부에서 빠진다');
  const walk = applyCommand(world, 'player', { type: 'lordMove', avatarId: 'lord', x: dropped.x, y: dropped.y }, data);
  assert.equal(walk.ok, true, '내리면 다시 걷는다');
});

test('★ §19-F4(F09-2) 달리는 기차에는 못 타고, 멀리서도 못 탄다', () => {
  const { world, n } = railWorld();
  stepTrains(world, n, data, 1);
  n.avatars = { lord: { id: 'lord', name: '개척자', x: 2, y: 2, tick: 0 } };
  const far = applyCommand(world, 'player', { type: 'boardTrain', avatarId: 'lord' }, data);
  assert.equal(far.error.code, 'NO_TRAIN_NEAR', '멀리서는 못 탄다');
  for (let i = 0; i < 20; i += 1) stepTrains(world, n, data, 0.5);
  const t = n.trains[0];
  if (t.dwell <= 0) {
    n.avatars.lord.x = t.x; n.avatars.lord.y = t.y;
    const moving = applyCommand(world, 'player', { type: 'boardTrain', avatarId: 'lord' }, data);
    assert.equal(moving.ok, false, '달리는 기차에는 못 탄다');
  }
});

test('★ §19-F4(F09-2) 정거장이 사라지면 기차도 거둬진다 — 유령 기차가 남지 않는다', () => {
  const { world, n } = railWorld();
  stepTrains(world, n, data, 1);
  assert.equal(n.trains.length, 1);
  n.structures = n.structures.filter((s) => s.key !== 'station');
  stepTrains(world, n, data, 1);
  assert.equal(n.trains.length, 0);
  assert.equal(trainSummary(n, data).open, false);
});

test('★ §19-F4 옛 세이브 호환 — trains·연구소가 없던 판도 그대로 돌아간다', () => {
  const world = labWorld();
  const n = world.nations.player;
  delete n.trains;
  delete n.nextTrainId;
  const v = researchView(n, data);
  assert.equal(v.labs.fields.every((f) => f.bonus === 0), true, '연구소가 없으면 배수 0');
  assert.deepEqual(trainSummary(n, data).list, [], '기차 목록은 비어 있다');
  assert.equal(stepTrains(world, n, data, 1).moved, false);
});
