// ★ §21-C3 — 중간 콘텐츠를 제자리로: 밀려 있던 티어 4~6 해금과 7~9장의 새 동사.
//
// 무엇을 못 박는가. 진행 감독은 티어 해금을 **마지막 장에 들어선 뒤에만** 합류시킨다(§11 새치기 봉쇄).
// 그 규칙 자체는 옳지만, 티어 4~6 건물 열두 채와 무역·이웃이 어느 장의 `opens` 에도 안 적혀 있어서
// 규칙의 그늘에 통째로 갇혀 있었다 — 티어는 5·6까지 오르는데 배치대에는 새 건물이 한 채도 안 떴다.
// 이 파일은 「그 열두 채가 티어가 오르는 그 장에서 열린다」와 「8·9장이 새 동사를 하나씩 가르친다」를 지킨다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { completeStructure } from '../server/engine/structures.js';
import { townOf } from '../server/engine/world.js';
import {
  chapterView, unlockedList, buildingUnlocked, featureUnlocked,
  evaluateProgress, ensureProgress, openChapterForDebug, chapterList,
} from '../server/engine/progression.js';

const data = loadGameData();
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });
const lastChapterId = () => chapterList(data)[chapterList(data).length - 1].id;

/** 그 칸을 지난 것으로 친다 — 조건을 흉내 내지 않고 사슬만 앞으로 민다 */
function clearStep(nation, chapterId, key) {
  const p = ensureProgress(nation);
  const mark = `${chapterId}:${key}`;
  if (!p.cleared.includes(mark)) p.cleared.push(mark);
  p.step += 1;
}

// ────────────────────────────────────────────────────────────────
// ① 밀려 있던 열두 채가 제자리로
// ────────────────────────────────────────────────────────────────
test('★ §21-C3 — 티어 4 살림 넷이 7장에서 열린다 (10장까지 기다리지 않는다)', () => {
  const w = newWorld(431);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 6);
  for (const k of ['manor', 'ranch', 'mill', 'fountain']) {
    assert.equal(buildingUnlocked(n, k, data), false, `${k} 는 6장까지 아직`);
  }
  openChapterForDebug(w, n, data, 7);
  for (const k of ['manor', 'ranch', 'mill', 'fountain']) {
    assert.equal(buildingUnlocked(n, k, data), true, `${k} 가 7장에서 열린다`);
  }
});

test('★ §21-C3 — 방어 탑 둘은 무리를 한 번 겪은 뒤에 열린다', () => {
  const w = newWorld(432);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 7);
  assert.equal(buildingUnlocked(n, 'frost_tower', data), false, '겪기 전에는 아직');
  clearStep(n, 7, 'trace_found');
  clearStep(n, 7, 'defense_ready');
  clearStep(n, 7, 'wave_held');
  for (const k of ['frost_tower', 'flame_tower']) {
    assert.equal(buildingUnlocked(n, k, data), true, `${k} 는 막아 낸 뒤에 열린다`);
  }
});

test('★ §21-C3 — 티어 5·6 건물 다섯이 9장에서 열린다', () => {
  const w = newWorld(433);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 8);
  for (const k of ['monument', 'workshop', 'station', 'library', 'academy']) {
    assert.equal(buildingUnlocked(n, k, data), false, `${k} 는 8장까지 아직`);
  }
  openChapterForDebug(w, n, data, 9);
  for (const k of ['monument', 'workshop', 'station', 'library', 'academy']) {
    assert.equal(buildingUnlocked(n, k, data), true, `${k} 가 9장에서 열린다`);
  }
});

test('★ §21-C3 — 마지막 장 전에도 배치대가 비어 있지 않다 (회귀의 핵심)', () => {
  const w = newWorld(434);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 9);
  const before = unlockedList(n, data).buildings.length;
  openChapterForDebug(w, n, data, lastChapterId());
  const after = unlockedList(n, data).buildings.length;
  assert.ok(before >= after - 1,
    `9장에서 이미 거의 다 열려 있어야 한다 (9장 ${before}채 → 마지막 장 ${after}채)`);
});

// ────────────────────────────────────────────────────────────────
// ② 8장 — 교역소를 세우면 그 자리에서 좌판이 열리고, 첫 거래가 장을 넘긴다
// ────────────────────────────────────────────────────────────────
test('★ §21-C3 — 무역은 장 보상이 아니라 「교역소를 세운 칸」이 연다', () => {
  const w = newWorld(441);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 8);
  assert.equal(featureUnlocked(n, 'trade', data), false, '세우기 전에는 좌판이 없다');

  const t = townOf(w, 'player');
  completeStructure(w, n, { building: 'trading_post', tier: 1, x: t.x + 3, y: t.y, placed: true }, data);
  evaluateProgress(w, n, data);

  assert.equal(featureUnlocked(n, 'trade', data), true, '★ 지은 그 자리에서 열린다 — 장이 끝나기 전에');
  const v = chapterView(w, n, data);
  assert.equal(v.id, 8, '아직 8장이다');
  assert.equal(v.goal.key, 'first_trade', '다음 칸은 첫 거래다');
});

test('★ §21-C3 — 첫 거래 한 번이 8장을 넘긴다 (사고파는 방향은 묻지 않는다)', () => {
  const w = newWorld(442);
  const n = w.nations.player;
  const ai = w.nations.ai1;
  openChapterForDebug(w, n, data, 8);
  n.tier = 3;
  n.gold = 3000;
  ai.resources.oil = 80;
  const t = townOf(w, 'player');
  completeStructure(w, n, { building: 'trading_post', tier: 1, x: t.x + 3, y: t.y, placed: true }, data);
  evaluateProgress(w, n, data);
  assert.equal(ensureProgress(n).flags.traded, undefined, '아직 거래 전');

  const res = applyCommand(w, 'player', { type: 'trade', nationId: 'ai1', side: 'buy', resource: 'oil', amount: 5 }, data, createRng(3));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(ensureProgress(n).flags.traded, true, '깃발이 선다');

  /* 장은 여기서 이미 넘어가 있다 — applyCommand 가 명령 끝에 진행 감독을 돌린다.
     그래서 재는 것은 「내가 부른 evaluateProgress 가 사건을 냈는가」가 아니라 **사슬이 어디에 섰는가**다. */
  evaluateProgress(w, n, data);
  assert.equal(ensureProgress(n).chapter, 9, '거래 한 번에 8장이 끝난다');
  assert.equal(buildingUnlocked(n, 'consulate', data), true, '값을 주고받고 나면 영사관이 열린다');
});

// ────────────────────────────────────────────────────────────────
// ③ 9장 — 이웃 나라를 찾아간다 (§17-16 이 여태 아무 장에도 안 걸려 있었다)
// ────────────────────────────────────────────────────────────────
test('★ §21-C3 — 9장의 새 칸은 이웃을 세지, 관계 점수를 세지 않는다', () => {
  const w = newWorld(451);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 9);
  clearStep(n, 9, 'shrine_built');

  const v = chapterView(w, n, data);
  assert.equal(v.goal.key, 'met_neighbor');
  assert.equal(v.goal.have, 0);
  assert.equal(v.goal.need, 1);

  n.metNations = { ai1: 10 };
  assert.equal(chapterView(w, n, data).goal.have, 1, '가 본 나라 하나');
  const out = evaluateProgress(w, n, data);
  assert.ok(out.some((e) => e.kind === 'chapter_done' && e.data.id === 9), '9장이 끝난다');
});

test('★ §21-C3 — 도읍 마커는 바깥 나라를 가리키고, 못 만난 나라를 먼저 준다', () => {
  const w = newWorld(452);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 9);
  clearStep(n, 9, 'shrine_built');
  n.metNations = { ai1: 5 };

  const targets = chapterView(w, n, data).goal.targets;
  assert.ok(targets.length > 0, '가리킬 도읍이 있다');
  for (const t of targets) {
    assert.equal(t.kind, 'town');
    assert.notEqual(t.id, 'player', '우리 도읍은 가리키지 않는다');
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
    assert.ok(t.name && t.name !== t.id, `이름이 자료에서 온다 (${t.name})`);
  }
  assert.notEqual(targets[0].id, 'ai1', '이미 가 본 나라는 뒤로 밀린다');
});

// ────────────────────────────────────────────────────────────────
// ④ 앞장은 한 톨도 달라지지 않는다
// ────────────────────────────────────────────────────────────────
test('★ §21-C3 — 1~6장의 문은 그대로다', () => {
  const w = newWorld(461);
  const n = w.nations.player;
  openChapterForDebug(w, n, data, 6);
  const u = unlockedList(n, data);
  for (const k of ['manor', 'ranch', 'mill', 'fountain', 'consulate', 'monument', 'academy', 'frost_tower']) {
    assert.equal(u.buildings.includes(k), false, `${k} 는 6장에 없다`);
  }
  assert.equal(featureUnlocked(n, 'trade', data), false, '무역도 아직');
  assert.equal(featureUnlocked(n, 'research', data), true, '연구는 4장에서 열렸다 (§21-C2)');
});
