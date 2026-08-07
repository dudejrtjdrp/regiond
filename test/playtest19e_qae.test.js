// QA-E — 진행 흐름·경제 (§19-E). 이 파일이 붙드는 문장 여섯:
//   ① 침공 조건은 **늘 보인다** — 장 목표와 같은 계측기로 재고, 웨이브 뷰에 언제나 실린다(F04-4·F04-6)
//   ② 준비를 끝내면 **본인이 앞당긴다** — 서버가 다시 재고, 못 채웠으면 거절한다(F04-4)
//   ③ 첫 무리를 놓쳐도 7장에 갇히지 않는다 — 두 번째 무리를 겪으면 이야기가 흐른다(F04-5)
//   ④ 6장에 무쇠 화로가 열린다 — 제련소(8장)보다 훨씬 느린 강재 길(F04-7)
//   ⑤ 산출 건물이 하루 수급의 한 자리를 차지한다(F06-1)
//   ⑥ 곳간 상한 안의 재고는 썩지 않는다 — 496↔499 되튐이 사라진다(QA-A)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { townOf } from '../server/engine/world.js';
import { completeStructure, flatOutputs } from '../server/engine/structures.js';
import { applyCommand } from '../server/engine/commands.js';
import {
  openChapterForDebug, chapterView, evaluateProgress, buildingUnlocked, measure,
} from '../server/engine/progression.js';
import {
  waveReadiness, canRushWave, waveView, updateWaveSchedule, advanceWave, daysUntilWave,
} from '../server/engine/waves.js';
import { spoilFloor, storageLimit } from '../server/engine/storage.js';
import { applySpoilage } from '../server/engine/economy.js';

const data = loadGameData();
const put = (w, n, key, tier, dx, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);

/** 7장(낯선 발자국)을 열고 웨이브 일정을 하나 잡아 둔 정착지 */
function chapter7(seed = 701) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const rng = createRng(seed);
  openChapterForDebug(world, nation, data, 7);
  // 흔적을 살핀 뒤라야 웨이브가 잡힌다(7장 첫 칸의 opens) — 앞 두 칸을 통과한 자리에 세운다
  nation.progress.flags.traceFound = true;
  nation.progress.cleared.push('7:trace_found', '7:defense_ready');
  nation.progress.step = 2;                       // 「첫 무리를 겪어 내세요」 칸
  nation.tier = 2;
  updateWaveSchedule(world, nation, data, rng);
  return { world, nation, rng };
}

// ────────────────────────────────────────────────────────────────
// ① · ② 침공 조건과 앞당기기 (F04-4 · F04-6)
// ────────────────────────────────────────────────────────────────
test('§19-E ① 침공 조건은 웨이브 뷰에 늘 실린다 — 성녀가 없어 날이 흐려도', () => {
  const { world, nation } = chapter7(711);
  const v = waveView(world, nation, null, data);
  assert.ok(v.readiness, '조건은 정보 비대칭 바깥이다');
  assert.equal(v.readiness.rows.length, data.waves.rush.conditions.length);
  assert.equal(v.precise, false, '성녀가 없으니 도착일은 여전히 흐리다');
  assert.equal(v.readiness.ok, false, '갓 열린 정착지는 아직 채비가 없다');
  for (const r of v.readiness.rows) assert.ok(r.label.length > 0, '조건마다 사람이 읽을 말이 있다');
});

test('§19-E ② 채비 전에는 앞당길 수 없다 — 서버가 거절한다', () => {
  const { world, nation, rng } = chapter7(712);
  assert.equal(canRushWave(world, nation, data), false);
  const res = applyCommand(world, 'player', { type: 'rushWave' }, data, rng);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NOT_READY');
});

test('§19-E ② 채비를 끝내면 그날이 다음날로 당겨진다', () => {
  const { world, nation, rng } = chapter7(713);
  put(world, nation, 'arrow_tower', 1, 5, -4);
  nation.population = 6;
  nation.resources.grain = 80;
  assert.equal(waveReadiness(world, nation, data).ok, true);
  const before = daysUntilWave(world, nation);
  assert.ok(before > 1, '아직 멀리 있다');
  const res = applyCommand(world, 'player', { type: 'rushWave' }, data, rng);
  assert.equal(res.ok, true);
  assert.equal(daysUntilWave(world, nation), data.waves.rush.daysAhead);
  assert.equal(canRushWave(world, nation, data), false, '이미 당긴 뒤에는 더 당길 것이 없다');
});

test('§19-E ⑥ 목표 카드는 이 장에 남은 칸을 함께 보인다 (F04-6)', () => {
  const world = createWorld({ seed: 714, data, playerName: '테스트' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, 7);
  const v = chapterView(world, nation, data);
  assert.equal(v.stepIndex, 0);
  assert.deepEqual(v.remaining.map((r) => typeof r.title), ['string', 'string']);
  assert.equal(v.remaining.length, 2, '7장은 세 칸이고 지금 칸을 뺀 둘이 남는다');
});

// ────────────────────────────────────────────────────────────────
// ③ 웨이브 실패 구제 (F04-5)
// ────────────────────────────────────────────────────────────────
test('§19-E ③ 첫 무리를 놓쳐도 두 번째를 겪으면 7장이 넘어간다', () => {
  const { world, nation } = chapter7(731);
  const cond = { type: 'any', of: [{ type: 'wavesHeld', count: 1 }, { type: 'wavesFaced', count: 2 }] };
  advanceWave(nation, { index: 0, won: false, type: 'wolf', name: '늑대 떼', tick: 1 });
  assert.equal(measure(world, nation, cond, data).ok, false, '한 번 졌을 뿐이면 아직이다');
  assert.equal(evaluateProgress(world, nation, data).length, 0);
  advanceWave(nation, { index: 1, won: false, type: 'bandit', name: '도적', tick: 8 });
  assert.equal(measure(world, nation, cond, data).ok, true);
  const events = evaluateProgress(world, nation, data);
  assert.ok(events.some((e) => e.kind === 'chapter_done'), '장이 넘어간다 — 무한 감금은 없다');
  assert.equal(nation.progress.chapter, 8);
});

test('§19-E ③ 한 번에 막아 내면 예전처럼 그 자리에서 넘어간다 (기존 의미 유지)', () => {
  const { world, nation } = chapter7(732);
  advanceWave(nation, { index: 0, won: true, type: 'wolf', name: '늑대 떼', tick: 1 });
  const events = evaluateProgress(world, nation, data);
  assert.ok(events.some((e) => e.kind === 'chapter_done'));
  assert.equal(nation.progress.chapter, 8);
});

// ────────────────────────────────────────────────────────────────
// ④ 강재 병목 (F04-7)
// ────────────────────────────────────────────────────────────────
test('§19-E ④ 무쇠 화로는 6장에 열리고 제련소는 8장 그대로다', () => {
  const world = createWorld({ seed: 741, data, playerName: '테스트' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, 5);
  assert.equal(buildingUnlocked(nation, 'bloomery', data), false, '5장에는 아직 없다');
  openChapterForDebug(world, nation, data, 6);
  assert.equal(buildingUnlocked(nation, 'bloomery', data), true);
  assert.equal(buildingUnlocked(nation, 'smelter', data), false, '정식 제련은 여전히 8장이다');
});

test('§19-E ④ 화로의 강재는 제련소보다 훨씬 느리다 (손일 · 하루 정액 모두)', () => {
  const bl = data.buildings.bloomery;
  const sm = data.buildings.smelter;
  const perOre = (b) => b.handWork.yield.steel / b.handWork.cost.ironOre;
  assert.ok(perOre(bl) * 3 <= perOre(sm) + 1e-9, '손일 효율이 제련소의 1/3 이하다');
  assert.ok(bl.tiers[0].flatOutput.steel <= 1, '하루 정액은 한 줌이다');
  assert.ok(!('steel' in bl.tiers[0].cost), '화로를 세우는 데 강재가 들면 병목이 안 풀린다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 산출 건물 상향 (F06-1)
// ────────────────────────────────────────────────────────────────
test('§19-E ⑤ 산출 건물은 하루 수급의 한 자리를 차지한다', () => {
  const world = createWorld({ seed: 751, data, playerName: '테스트' });
  const nation = world.nations.player;
  const before = flatOutputs(nation, data).wood ?? 0;
  put(world, nation, 'sawmill', 1, 4);
  const after = flatOutputs(nation, data).wood ?? 0;
  assert.ok(after - before >= 4, `제재소 1단계가 하루 목재 4 이상을 낸다 (지금 ${after - before})`);
  // 티어를 올릴수록 폭이 커진다 — 상위 단계일수록 깊게 올렸다
  const t = data.buildings.sawmill.tiers.map((x) => x.flatOutput.wood);
  assert.ok(t[1] / t[0] > 2 && t[2] / t[1] > 1.8, '상위 단계의 값어치가 또렷하다');
});

test('§19-E ⑤ 채집 보너스(gatherBonus)는 손대지 않았다 — Sprint 4 와 중복 상향 금지', () => {
  assert.deepEqual(data.buildings.sawmill.tiers.map((t) => t.gatherBonus.wood), [0.2, 0.32, 0.46]);
  assert.deepEqual(data.buildings.quarry_camp.tiers.map((t) => t.gatherBonus.stone), [0.2, 0.32, 0.46]);
});

// ────────────────────────────────────────────────────────────────
// ⑥ 창고 상한 되튐 (QA-A)
// ────────────────────────────────────────────────────────────────
test('§19-E ⑥ 곳간 상한 안의 재고는 썩지 않는다 — 되튐이 사라진다', () => {
  const world = createWorld({ seed: 761, data, playerName: '테스트' });
  const nation = world.nations.player;
  nation.population = 8;
  const limit = storageLimit(nation, data);
  assert.equal(spoilFloor(nation, data), limit);
  nation.resources.wood = limit - 1;
  applySpoilage(nation, data, spoilFloor(nation, data));
  assert.equal(nation.resources.wood, limit - 1, '상한 코앞의 목재는 한 톨도 줄지 않는다');
});

test('§19-E ⑥ 상한을 넘겨 받은 몫(교역·전리품)은 여전히 서서히 덜린다', () => {
  const world = createWorld({ seed: 762, data, playerName: '테스트' });
  const nation = world.nations.player;
  nation.population = 8;
  const limit = storageLimit(nation, data);
  nation.resources.wood = limit + 200;
  const spoiled = applySpoilage(nation, data, spoilFloor(nation, data));
  assert.ok(spoiled.wood > 0, '넘친 몫은 덜린다');
  assert.ok(nation.resources.wood > limit, '한 번에 상한까지 깎지는 않는다 — 빼앗지 않는다');
});
