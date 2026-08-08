// ★ §21-C2 — 연구 조기 분기(4장)와 끝없는 장의 매듭.
//
// 이 파일이 못 박는 것 둘:
//   ① 4장에 서면 [연구]가 열려 있고, 그 자리에서 **금화 없이** 붙들 수 있는 궁리가 있다.
//      (주민을 기다리는 4~5장의 빈손을 메우는 것이 이 갈래의 존재 이유다.)
//   ② 마지막 장의 목표 카드는 비지 않는다. 칸을 다 지나면 매듭 하나를 짓고 첫 칸으로 돌아오며,
//      그 칸의 셈은 「지금까지」가 아니라 **「이 매듭에 들어와서」**다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import {
  chapterView, unlockedList, commandUnlocked, featureUnlocked,
  evaluateProgress, ensureProgress, openChapterForDebug, chapterList,
} from '../server/engine/progression.js';
import { researchStatus, researchView, startResearch } from '../server/engine/research.js';
import { settlementTier } from '../server/engine/tiers.js';

const data = loadGameData();
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });

const lastChapter = () => chapterList(data)[chapterList(data).length - 1];

// ────────────────────────────────────────────────────────────────
// ① 연구 조기 분기 — 4장
// ────────────────────────────────────────────────────────────────
test('★ §21-C2 — 4장에서 연구가 열린다 (3장까지는 부재)', () => {
  const w = newWorld(311);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 3);
  assert.equal(featureUnlocked(n, 'research', data), false, '3장까지 연구는 없는 것이다');
  assert.equal(commandUnlocked(n, 'startResearch', data), false);

  openChapterForDebug(w, n, data, 4);
  assert.equal(featureUnlocked(n, 'research', data), true, '4장에서 열린다');
  assert.equal(commandUnlocked(n, 'startResearch', data), true);
  assert.ok(unlockedList(n, data).ui.includes('panel.research'));
});

test('★ §21-C2 — 초반 가지는 금화 한 닢 없이 붙든다 (기다림을 메우는 것이 값이다)', () => {
  const w = newWorld(312);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 4);
  for (const key of ['tidy_stores', 'whetstone']) {
    const s = researchStatus(n, key, data);
    assert.equal(s.gold, 0, `${key} 는 금화를 받지 않는다`);
    assert.ok(s.days <= 1, `${key} 는 하루면 끝난다`);
    assert.ok(s.requiresTier <= 2, `${key} 는 티어 1~2 의 문이다`);
    assert.deepEqual(s.requires, [], '선행 없는 병렬 갈래다');
  }
});

test('★ §21-C2 — 개척촌(티어1)이면 곳간 정리를 그 자리에서 붙든다', () => {
  const w = newWorld(313);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 4);
  n.tier = 1;
  assert.ok(settlementTier(n) >= 1, '티어 1 이상');
  n.resources.wood = 200;
  const res = startResearch(w, n, { key: 'tidy_stores' }, data);
  assert.equal(res.ok, true, '손에 있는 목재만으로 시작된다');
  assert.equal(n.research.active.key, 'tidy_stores');
  // 한 번에 하나만 붙든다 — 숫돌은 지금 안 된다
  assert.equal(startResearch(w, n, { key: 'whetstone' }, data).ok, false);
});

test('★ §21-C2 — 새 가지는 연구표 맨 뒤다 (자동 플레이 우선순위 계약, playtest15c)', () => {
  const order = data.research.order;
  assert.equal(order[0], 'coal_mining', '산업 사슬이 여전히 먼저다');
  assert.deepEqual(order.slice(-2), ['tidy_stores', 'whetstone']);
  const view = researchView({ research: { done: {}, active: null }, resources: {}, gold: 0 }, data);
  assert.equal(view.order.slice(-2).join(','), 'tidy_stores,whetstone');
});

// ────────────────────────────────────────────────────────────────
// ② 매듭 — 끝없는 장의 순환 목표
// ────────────────────────────────────────────────────────────────
test('★ §21-C2 — 마지막 장의 목표 카드가 비어 있지 않다', () => {
  const w = newWorld(321);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, lastChapter().id);
  const v = chapterView(w, n, data);
  assert.equal(v.endless, true);
  assert.equal(v.cycle, 0, '아직 지은 매듭이 없다');
  assert.ok(v.goal, '★ 이 자리가 여태 null 이었다 — 회귀 금지');
  assert.equal(v.goal.key, 'knot_folk');
  assert.equal(v.goal.need, 6);
});

test('★ §21-C2 — 매듭의 셈은 「지금까지」가 아니라 「이 매듭에 들어와서」다', () => {
  const w = newWorld(322);
  const n = w.nations.player;
  n.population = 40;
  n.wave = { history: [{ won: true }, { won: true }, { won: true }] };
  openChapterForDebug(w, n, data, lastChapter().id);
  const v = chapterView(w, n, data);
  assert.equal(v.goal.have, 0, '들어선 순간의 인구는 눈금이지 성과가 아니다');
  const p = ensureProgress(n);
  assert.equal(p.mark.population, 40);
  assert.equal(p.mark.wavesHeld, 3);
});

test('★ §21-C2 — 칸을 다 지나면 장이 끝나지 않고 매듭이 지어진다', () => {
  const w = newWorld(323);
  const n = w.nations.player;
  n.population = 10;
  n.wave = { history: [] };
  openChapterForDebug(w, n, data, lastChapter().id);

  n.population = 16;                                   // 사람 여섯이 더
  let out = evaluateProgress(w, n, data);
  assert.ok(out.some((e) => e.kind === 'step_done'));
  assert.equal(chapterView(w, n, data).goal.key, 'knot_hold');

  n.wave.history = [{ won: true }, { won: true }];      // 무리 둘을 막았다
  out = evaluateProgress(w, n, data);
  const knot = out.find((e) => e.kind === 'chapter_done');
  assert.ok(knot, '매듭이 지어진다');
  assert.equal(knot.data.cycle, 1);
  assert.equal(knot.data.card, null, '매듭마다 모달이 뜨면 잔소리가 된다');
  assert.equal(out.some((e) => e.kind === 'chapter_open'), false, '다음 장은 없다');

  const p = ensureProgress(n);
  assert.equal(p.chapter, lastChapter().id, '장은 그대로다');
  assert.equal(p.step, 0, '첫 칸으로 돌아온다');
  assert.equal(p.mark.population, 16, '눈금을 다시 찍는다');
  assert.equal(p.mark.wavesHeld, 2);

  const v = chapterView(w, n, data);
  assert.equal(v.cycle, 1);
  assert.equal(v.goal.key, 'knot_folk');
  assert.equal(v.goal.have, 0, '두 번째 매듭은 0 에서 다시 센다');
  assert.equal(v.goal.need, 8, '매듭마다 문턱이 grow 만큼 오른다');
});

test('★ §21-C2 — 문턱은 growMax 에서 멈춘다 (아무도 못 짓는 매듭은 오지 않는다)', () => {
  const w = newWorld(324);
  const n = w.nations.player;
  n.population = 0;
  n.wave = { history: [] };
  openChapterForDebug(w, n, data, lastChapter().id);
  const p = ensureProgress(n);
  p.cycle = 50;
  const v = chapterView(w, n, data);
  assert.equal(v.goal.need, 12, '6 + growMax 6');
  p.step = 1;
  assert.equal(chapterView(w, n, data).goal.need, 6, '2 + growMax 4');
});

test('★ §21-C2 — 1~9장의 셈은 한 톨도 달라지지 않는다 (since 없는 칸은 절대값)', () => {
  const w = newWorld(325);
  const n = w.nations.player;
  n.population = 3;
  openChapterForDebug(w, n, data, 5);
  const v = chapterView(w, n, data);
  assert.equal(v.goal.key, 'pop5');
  assert.equal(v.goal.have, 3, '지금까지의 인구를 그대로 센다');
  assert.equal(v.goal.need, 5);
  assert.equal(v.cycle, 0);
});
