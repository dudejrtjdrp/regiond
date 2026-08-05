// 진행 감독 — docs/GDD3.md §11. 「시간은 아무것도 열지 않는다」를 못 박는 회귀.
//
// 이 파일이 지키는 것 세 가지:
//   ① 30게임일을 방치해도 화면에 뜰 것이 하나도 생기지 않는다 (모달 0건)
//   ② 시작 상태는 주민 0 · 명부 0 · 배치대 0
//   ③ 장 사슬은 순서대로만 열린다 — 티어를 손으로 올려도 새치기가 안 된다
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { applyCommand } from '../server/engine/commands.js';
import { buildNationView } from '../server/engine/view.js';
import { townOf, dist } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { spawnResident } from '../server/engine/residents.js';
import {
  chapterView, unlockedList, buildingUnlocked, featureUnlocked, commandUnlocked,
  evaluateProgress, ensureProgress, openChapterForDebug, measure, chapterList,
} from '../server/engine/progression.js';

const data = loadGameData();
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });

/**
 * ★ 화면에 '창'을 띄우는 사건들.
 *   방치 테스트는 이것들이 단 하나도 나오지 않아야 통과한다.
 *   (알림 배지로만 쌓이는 것 — events 로그·자원 변동 — 은 여기 없다.)
 */
const MODAL_EVENTS = new Set([
  'emotion_day', 'mandate', 'council_open', 'ruin_event', 'offer_received',
  'wave_incoming', 'wave_held', 'wave_breached', 'artifact_found', 'auto_advice',
  'disaster', 'mid_shock', 'camp_spotted',
]);

// ────────────────────────────────────────────────────────────────
// ① 방치 — 30게임일
// ────────────────────────────────────────────────────────────────
test('★ 방치 30게임일 — 아무 모달도 뜨지 않는다 (시간은 아무것도 열지 않는다)', () => {
  let world = newWorld(101);
  const rng = createRng(101);
  const seen = [];
  for (let day = 0; day < 30; day += 1) {
    const out = step(world, [], rng, data);
    world = out.state;
    for (const e of out.events) if (MODAL_EVENTS.has(e.kind)) seen.push(`${day + 1}일: ${e.kind}`);
  }
  assert.deepEqual(seen, [], `30일 방치 중 뜬 창: ${seen.join(', ')}`);

  const p = world.nations.player;
  assert.equal(world.emotionDayDone, false, '감정의 날은 시간으로 오지 않는다');
  assert.equal(world.mandateOpen, false, '관제 선포도 마찬가지');
  assert.equal(world.councils.length, 0, '어전 회의 주기가 와도 열리지 않는다');
  assert.equal(world.offers.length, 0, '상단 제안도 없다');
  assert.equal(p.wave.arrivalTick, null, '웨이브 일정조차 잡히지 않는다');
  assert.equal(p.population, 0, '주민도 저절로 오지 않는다 (4장 전)');
  assert.equal(ensureProgress(p).chapter, 1, '아무 행동도 안 했으니 1장 그대로');

  // 뷰에도 잠긴 계층이 '없다' — 회색 단추조차 그릴 수 없다
  const v = buildNationView(world, 'player', null, data, { avatarId: 'p1' });
  assert.equal(v.wave, null);
  assert.equal(v.battle, null);
  assert.equal(v.defense, null);
  assert.equal(v.market, undefined);
  assert.equal(v.offers, undefined);
  assert.equal(v.councils, undefined);
  assert.equal(v.mandate, undefined);
  assert.equal(v.nation.roles, undefined);
  assert.equal(v.nation.advices, undefined);
  assert.equal(v.nation.orders, undefined);
  assert.equal(v.nation.artifacts, undefined);
  assert.deepEqual(v.nation.buildable, [], '배치대가 비어 있다 — "지을 게 없습니다"가 나올 자리가 없다');
});

// ────────────────────────────────────────────────────────────────
// ② 시작 상태
// ────────────────────────────────────────────────────────────────
test('★ 시작 — 주민 0 · 명부 0 · 대표 유닛 0 · 매크로 0', () => {
  const w = newWorld(103);
  const n = w.nations.player;
  assert.equal(n.population, 0, '인구 0');
  assert.equal(n.villagers.length, 0, '대표 유닛 0');
  assert.equal(n.populationCap, 0);

  const v = buildNationView(w, 'player', null, data, { avatarId: 'p1' });
  assert.equal(v.nation.population, 0);
  assert.deepEqual(v.nation.residents, [], '명부 0');
  assert.equal(v.nation.housing.capacity, 0, '잠자리 0');
  assert.equal(v.nation.housing.arrival.open, false, '유입은 4장부터');
  assert.equal(v.nation.villagerMix, null, '배치 매크로가 없다');
  assert.equal(v.unlocked.ui.includes('hud.population'), false, '인구 칸조차 안 뜬다');
  assert.deepEqual(n.structures.map((s) => s.key), ['campfire'], '모닥불 하나로 시작');
});

test('★ 시작 — 주민 유입은 4장(오두막 완공)부터만 열린다', () => {
  const w = newWorld(105);
  const n = w.nations.player;
  const rng = createRng(105);
  // 오두막을 몰래 세우고 곡식을 쌓아도 3장까지는 아무도 오지 않는다
  completeStructure(w, n, { building: 'hut', tier: 1, x: townOf(w, 'player').x + 3, y: townOf(w, 'player').y, placed: true }, data);
  n.resources.grain = 200;
  let world = w;
  for (let i = 0; i < 10; i += 1) world = step(world, [], rng, data).state;
  assert.equal(world.nations.player.population, 0, '장이 열리기 전에는 유입이 없다');

  openChapterForDebug(world, world.nations.player, data, 4);
  const out = step(world, [], rng, data);
  assert.ok(out.state.nations.player.population >= 1, '4장이 열리면 첫 사람이 온다');
});

// ────────────────────────────────────────────────────────────────
// ③ 사슬 — 순서대로만
// ────────────────────────────────────────────────────────────────
test('사슬 — 1장에서는 지을 것도 열 것도 없다', () => {
  const w = newWorld(107);
  const n = w.nations.player;
  const u = unlockedList(n, data);
  assert.deepEqual(u.buildings, []);
  assert.ok(u.features.includes('swing'));
  for (const f of ['placeBuilding', 'residentArrival', 'waves', 'trade', 'roles', 'council']) {
    assert.equal(u.features.includes(f), false, `${f} 는 아직`);
  }
  // 선언된 문은 명령 자체가 안 통한다
  assert.equal(commandUnlocked(n, 'placeBuilding', data), false);
  assert.equal(commandUnlocked(n, 'placeFence', data), false);
  assert.equal(commandUnlocked(n, 'pickRole', data), false);
  assert.equal(commandUnlocked(n, 'appraiseLand', data), true, 'appraiseLand 는 선언되지 않은 문 — 건물이 막는다');
  assert.equal(commandUnlocked(n, 'lordMove', data), true);
});

test('사슬 — 목표 카드는 언제나 한 장이고, 통과하면 다음 칸으로 넘어간다', () => {
  const w = newWorld(109);
  const n = w.nations.player;
  const v0 = chapterView(w, n, data);
  assert.equal(v0.id, 1);
  assert.equal(v0.goal.key, 'first_swings');
  assert.equal(v0.goal.need, 3);
  assert.equal(v0.goal.have, 0);

  // 스윙 3회 — 진짜로 친 것만 센다
  n.players = { lord: { id: 'lord', stats: { swingsBySkill: { lumber: 3 } } } };
  assert.deepEqual(evaluateProgress(w, n, data).map((e) => e.kind), ['step_done']);
  assert.equal(chapterView(w, n, data).goal.key, 'wood10', '다음 칸 — 목표 카드는 여전히 한 장');
  assert.equal(chapterView(w, n, data).id, 1, '아직 1장 안이다');

  // 목재 10 — 1장 완료 → 2장(첫 지붕)이 열리고 천막이 배치대에 뜬다
  n.resources.wood = 12;
  const evs = evaluateProgress(w, n, data);
  assert.deepEqual(evs.map((e) => e.kind), ['step_done', 'chapter_done', 'chapter_open']);
  const done = evs.find((e) => e.kind === 'chapter_done');
  assert.equal(done.data.name, '불씨');
  assert.ok(done.data.card.title, '「새로 열린 것」 카드가 한 장 실린다');
  assert.equal(ensureProgress(n).chapter, 2);
  assert.deepEqual(unlockedList(n, data).buildings, ['tent'], '2장 배치대에는 천막만');
  assert.ok(buildingUnlocked(n, 'tent', data));
  assert.equal(buildingUnlocked(n, 'hut', data), false, '오두막은 3장 첫 칸을 지나야');
});

test('사슬 — 티어를 손으로 올려도 새치기가 안 된다', () => {
  const w = newWorld(111);
  const n = w.nations.player;
  n.tier = 6;                                   // 있을 수 없는 상황을 억지로 만든다
  const u = unlockedList(n, data);
  assert.deepEqual(u.buildings, [], '티어 6이어도 1장이면 배치대는 비어 있다');
  assert.equal(featureUnlocked(n, 'trade', data), false);
  assert.equal(featureUnlocked(n, 'council', data), false);
});

test('사슬 — 열 장이 순서대로 이어진다 (끊긴 고리가 없다)', () => {
  const list = chapterList(data);
  assert.equal(list.length, 10);
  list.forEach((c, i) => assert.equal(c.id, i + 1, `${i + 1}번째 장의 번호`));
  assert.ok(list.at(-1).endless, '마지막 장은 엔드리스');
  for (const c of list.slice(0, -1)) {
    assert.ok((c.steps || []).length > 0, `${c.name} 에 목표가 있다`);
    assert.ok(c.reward, `${c.name} 에 보상 연출이 있다`);
    for (const st of c.steps) {
      assert.ok(st.title && st.condition, `${c.name}/${st.key}`);
      assert.ok(st.target, `${c.name}/${st.key} 에 마커 대상이 있다`);
    }
  }
});

// ────────────────────────────────────────────────────────────────
// 감정의 날 — 능동 발동
// ────────────────────────────────────────────────────────────────
test('★ 감정의 날 — 감정소를 세우고 [땅을 감정한다]를 눌러야만 열린다', () => {
  const w = newWorld(113);
  const n = w.nations.player;
  const rng = createRng(113);
  openChapterForDebug(w, n, data, 6);

  // 감정소가 없으면 명령이 통하지 않는다
  const early = applyCommand(w, 'player', { type: 'appraiseLand' }, data, rng);
  assert.equal(early.ok, false);
  assert.equal(early.error.code, 'NO_STRUCTURE');

  // 6장 배치대에는 감정소가 있고, 값은 목재 60·석재 30 이다 (석재를 처음 요구한다)
  assert.ok(buildingUnlocked(n, 'appraisal_post', data));
  assert.deepEqual(data.buildings.appraisal_post.tiers[0].cost, { wood: 60, stone: 30 });

  const t = townOf(w, 'player');
  n.resources.stone = 40;                       // 채석으로 모은 셈 (6장 첫 칸)
  completeStructure(w, n, { building: 'appraisal_post', tier: 1, x: t.x + 3, y: t.y, placed: true }, data);

  const res = applyCommand(w, 'player', { type: 'appraiseLand' }, data, rng);
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.ok(w.emotionDayDone, '감정의 날이 그 자리에서 터진다');
  assert.ok(res.events.some((e) => e.kind === 'emotion_day'));
  assert.ok(res.events.some((e) => e.kind === 'mandate'), '관제 선포가 이어진다');
  assert.ok(res.tagNames.length >= 2, '태그가 공개된다');
  // 사슬도 함께 넘어가 역할이 열린다
  assert.equal(ensureProgress(n).chapter, 7);
  assert.ok(featureUnlocked(n, 'roles', data));
  assert.ok(featureUnlocked(n, 'departments', data));

  // 두 번은 없다
  const again = applyCommand(w, 'player', { type: 'appraiseLand' }, data, rng);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'ALREADY_DONE');
});

test('감정소 — 건물 뷰가 [땅을 감정한다] 단추를 데리고 온다', () => {
  const w = newWorld(115);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 6);
  const t = townOf(w, 'player');
  completeStructure(w, n, { building: 'appraisal_post', tier: 1, x: t.x + 3, y: t.y, placed: true }, data);
  const v = buildNationView(w, 'player', null, data, { avatarId: 'p1' });
  const post = v.nation.structures.find((s) => s.key === 'appraisal_post');
  assert.equal(post.action, 'appraiseLand');
  assert.equal(post.actionLabel, '땅을 감정한다');
  const other = v.nation.structures.find((s) => s.key === 'campfire');
  assert.equal(other.action, null, '다른 건물에는 그런 단추가 없다');
});

// ────────────────────────────────────────────────────────────────
// 7장 — 정찰이 웨이브를 연다
// ────────────────────────────────────────────────────────────────
test('★ 웨이브 — 흔적을 살피기 전에는 며칠이 지나도 오지 않는다', () => {
  const w = newWorld(119);
  const n = w.nations.player;
  const rng = createRng(119);
  openChapterForDebug(w, n, data, 7);
  n.tier = 4;                                   // 티어를 올려도 소용없다

  let world = w;
  for (let i = 0; i < 12; i += 1) world = step(world, [], rng, data).state;
  assert.equal(world.nations.player.wave.arrivalTick, null, '일정조차 잡히지 않는다');
  assert.equal(featureUnlocked(world.nations.player, 'waves', data), false);

  // 발자국이 있는 자리까지 걸어가면 그때 열린다
  const p = world.nations.player;
  const trace = ensureProgress(p).trace;
  assert.ok(trace, '7장이 열릴 때 흔적이 하나 놓인다');
  const move = applyCommand(world, 'player', { type: 'lordMove', x: trace.x, y: trace.y, avatarId: 'p1' }, data, rng);
  assert.equal(move.ok, true);
  assert.ok(ensureProgress(p).flags.traceFound, '가서 보면 열린다');
  assert.ok(featureUnlocked(p, 'waves', data));

  const out = step(world, [], rng, data);
  assert.ok(out.state.nations.player.wave.arrivalTick != null, '그제서야 일정이 잡힌다');
});

// ────────────────────────────────────────────────────────────────
// 마커 대상 힌트
// ────────────────────────────────────────────────────────────────
test('마커 — 서버가 목표의 대상 후보를 좌표와 함께 내려 준다', () => {
  const w = newWorld(119);
  const n = w.nations.player;
  const t = townOf(w, 'player');
  const v = chapterView(w, n, data);
  assert.ok(v.goal.targets.length > 0);
  /* ★ GDD3 §13-B-2 — 자원 군락은 영토 **밖**에 앉는다. 마커가 영토 안만 뒤지면 가리킬 나무가 없다.
     그래서 반경은 주민 일자리와 같은 자 — 영토 + workRadiusBonus — 를 쓴다. */
  const reach = n.territory.radius + data.world.villagers.workRadiusBonus;
  for (const tg of v.goal.targets) {
    assert.equal(tg.kind, 'node');
    assert.ok(Number.isFinite(tg.x) && Number.isFinite(tg.y));
    assert.ok(dist(tg.x, tg.y, t.x, t.y) <= reach + 0.001, '걸어갈 만한 자리만 가리킨다');
  }

  // 배치대를 가리켜야 하는 칸은 월드 좌표 대신 단추를 가리킨다
  openChapterForDebug(w, n, data, 2);
  const v2 = chapterView(w, n, data);
  assert.equal(v2.goal.key, 'tent_built');
  assert.equal(v2.goal.targets[0].kind, 'buildSlot');
  assert.equal(v2.goal.targets[0].sel, '#tb-build');
});

test('마커 — 자원 목표의 잔여량을 화면이 셀 수 있게 have/need 가 온다', () => {
  const w = newWorld(121);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 1);
  n.players = { lord: { id: 'lord', stats: { swingsBySkill: { lumber: 5 } } } };
  evaluateProgress(w, n, data);
  n.resources.wood = 4;
  const v = chapterView(w, n, data);
  assert.equal(v.goal.key, 'wood10');
  assert.equal(v.goal.have, 4);
  assert.equal(v.goal.need, 10);
  assert.equal(measure(w, n, v.goal.condition, data).ok, false);
});
