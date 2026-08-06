// Sprint 2 — 주민·동료 AI 재설계 회귀.
//
// 이 파일이 붙드는 문장 다섯:
//   ① 유휴는 더 이상 흡수 상태가 아니다 — 노는 손은 다음 틱에 필요도순으로 자리를 받는다
//   ② 주인의 손가락이 먼저다 — 수동 배치(manual)는 자동 배치가 절대 건드리지 않고,
//      전체 재배치(assignByMix)만 그 표를 걷는다
//   ③ 정찰꾼은 진짜로 걷는다 — 안개 경계의 미탐험 지점이 목적지가 된다
//   ④ 전투가 열리면 수비는 깃발로, 영토 밖 일꾼은 마을로 — 끝나면 제 일터로 돌아간다
//   ⑤ 동료는 크레딧이 빌 때 서 있지 않는다(순찰) — 그리고 다치면 회복될 때까지 쉰다(히스테리시스)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, dist, territoryRadius } from '../server/engine/world.js';
import { ensurePlayer, playerMaxHp } from '../server/engine/skills.js';
import { spawnResident } from '../server/engine/residents.js';
import { commandVillagers, assignByMix, listTargets } from '../server/engine/villagers.js';
import { autoPlaceIdle, needRank, stepScouts, battleStations, standDown } from '../server/engine/assign.js';
import { isExplored } from '../server/engine/fog.js';
import { walkableFor } from '../server/engine/path.js';
import { syncCompanionSeats, stepCompanions } from '../server/engine/companions.js';
import { step } from '../server/engine/tick.js';

const data = loadGameData();
const SEED = 20260806;

function settlement(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(null, nation, data, opts.chapter ?? 5);
  (nation.companions ||= {}).awake = true;
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  return { world, nation, town, rng: createRng(opts.seed ?? SEED) };
}

function people(world, nation, rng, n) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(spawnResident(world, nation, data, rng));
  return out;
}

// ────────────────────────────────────────────────────────────────
// ① 유휴 소멸
// ────────────────────────────────────────────────────────────────
test('Sprint2 ① 노는 손이 자리를 받는다 — 집결지 없이 온 사람도 다음 패스에 일한다', () => {
  const { world, nation, rng } = settlement();
  const crew = people(world, nation, rng, 6);
  assert.ok(crew.every((u) => u.job === 'idle'), '집결지가 없으면 유휴로 태어난다(전제)');
  const moved = autoPlaceIdle(world, nation, data);
  assert.equal(moved.length, 6, '여섯 모두 자리를 받았다');
  for (const u of nation.villagers) {
    assert.notEqual(u.job, 'idle', `${u.name} 이(가) 아직 논다`);
    assert.ok(u.targetId, '일터가 있다');
  }
});

test('Sprint2 ① 곡물 위기면 곡물부터 — 필요도 첫 자리가 grain 이다', () => {
  const { world, nation, rng } = settlement();
  nation.resources.grain = 0;
  assert.equal(needRank(nation, data)[0], 'grain');
  const [u] = people(world, nation, rng, 1);
  autoPlaceIdle(world, nation, data);
  assert.equal(u.job, 'farm', '굶주림 앞에서는 농사가 먼저다');
});

test('Sprint2 ① 3티어 전 죽은 직업(factory·trade)은 캐는 손으로 돌아온다', () => {
  const { world, nation, rng } = settlement();
  const [a, b] = people(world, nation, rng, 2);
  a.job = 'factory';
  b.job = 'trade';
  autoPlaceIdle(world, nation, data);
  const gather = ['farm', 'lumber', 'quarry', 'mine'];
  assert.ok(gather.includes(a.job), `공방 손이 ${a.job} — 산출 0 인 자리에 남지 않는다`);
  assert.ok(gather.includes(b.job), `장사 손이 ${b.job}`);
});

test('Sprint2 ① 일 틱 통합 — 하루가 지나면 노는 사람이 없다', () => {
  const { world, nation, rng } = settlement();
  people(world, nation, rng, 5);
  const next = step(world, [], createRng(SEED + 1), data);
  const after = next.state.nations.player.villagers;
  assert.ok(after.length >= 5);
  assert.ok(after.every((u) => u.job !== 'idle'), '하루 뒤에도 노는 사람이 있다');
});

// ────────────────────────────────────────────────────────────────
// ② 수동 소유권
// ────────────────────────────────────────────────────────────────
test('Sprint2 ② 수동 배치는 자동이 못 옮기고, 전체 재배치만 표를 걷는다', () => {
  const { world, nation, rng } = settlement();
  const [u] = people(world, nation, rng, 1);
  /* 손가락으로 세워 둔 사람 — move 지시 */
  const res = commandVillagers(world, nation, { ids: [u.id], order: { type: 'move', x: u.x, y: u.y } }, data);
  assert.equal(res.ok, true);
  assert.equal(u.manual, true, 'move 지시가 수동 표를 찍는다');
  autoPlaceIdle(world, nation, data);
  assert.equal(u.job, 'idle', '자동 배치가 수동 대기를 건드렸다');

  /* 노드에 손가락으로 앉힌 사람 */
  const node = listTargets(world, nation, data).find((t) => t.kind === 'node');
  assert.ok(node, '영토 안에 노드가 있다(전제)');
  const work = commandVillagers(world, nation, { ids: [u.id], order: { type: 'work', nodeId: node.id } }, data);
  assert.equal(work.ok, true);
  assert.equal(u.manual, true, 'work 지시도 수동 표를 찍는다');

  /* 전체 재배치는 나라 단위 명령 — 표가 걷힌다 */
  assignByMix(world, nation, { farm: 1 }, data);
  assert.equal(u.manual, false, 'assignByMix 가 수동 표를 걷는다');
});

// ────────────────────────────────────────────────────────────────
// ③ 정찰
// ────────────────────────────────────────────────────────────────
test('Sprint2 ③ 정찰꾼은 안개 경계로 걷는다 — 목적지는 미탐험·통행 가능 칸이다', () => {
  const { world, nation, town } = settlement();
  nation.villagers = [{
    id: 'r1', name: '정찰', job: 'scout', targetId: null,
    x: town.x, y: town.y, destX: town.x, destY: town.y, manual: false,
  }];
  const sent = stepScouts(world, nation, data);
  assert.equal(sent, 1, '다음 목적지를 받았다');
  const u = nation.villagers[0];
  assert.ok(u.destX !== town.x || u.destY !== town.y, '제자리가 아니다');
  assert.equal(isExplored(nation, u.destX, u.destY), false, '이미 본 땅이면 정찰이 아니다');
  assert.equal(walkableFor(world, nation, data, u.destX, u.destY), true, '설 수 있는 칸이다');
});

// ────────────────────────────────────────────────────────────────
// ④ 전투의 발
// ────────────────────────────────────────────────────────────────
test('Sprint2 ④ 전투 배치 — 수비는 깃발로, 영토 밖 일꾼은 마을로, 끝나면 제 일터로', () => {
  const { world, nation, town } = settlement();
  const radius = territoryRadius(nation, data);
  const node = listTargets(world, nation, data)
    .find((t) => t.kind === 'node' && dist(t.x, t.y, town.x, town.y) > radius);
  assert.ok(node, '영토 밖 노드가 있다(전제 — workRadiusBonus 26)');
  nation.defenseFlag = { x: town.x + 3, y: town.y };
  nation.villagers = [
    { id: 'r1', name: '수비', job: 'defense', targetId: null, x: town.x, y: town.y, destX: town.x, destY: town.y },
    { id: 'r2', name: '일꾼', job: 'lumber', targetId: node.id, x: node.x, y: node.y, destX: node.x, destY: node.y },
  ];
  battleStations(world, nation, data);
  const [guard, worker] = nation.villagers;
  assert.ok(dist(guard.destX, guard.destY, nation.defenseFlag.x, nation.defenseFlag.y) <= 4.5,
    '수비의 발이 깃발 곁이다');
  assert.ok(dist(worker.destX, worker.destY, town.x, town.y) <= 1, '영토 밖 일꾼이 마을로 피한다');
  standDown(world, nation, data);
  assert.ok(dist(worker.destX, worker.destY, node.x, node.y) <= 4.5, '전투 뒤 제 일터의 발치로 돌아간다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 동료 — 순찰과 회복
// ────────────────────────────────────────────────────────────────
test('Sprint2 ⑤ 크레딧이 비면 서 있지 않는다 — 순찰 상태가 나타나고 몸이 움직인다', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  const states = new Set();
  let patrolMoves = 0;
  const last = {};
  for (let i = 0; i < 240; i += 1) {
    stepCompanions(world, nation, data, 1);
    for (const c of nation.companions.list) {
      if (!c.active) continue;
      const st = c.mem?.state;
      states.add(st);
      const av = nation.avatars[c.id];
      if (st === 'patrol' && last[c.id] && (last[c.id].x !== av.x || last[c.id].y !== av.y)) patrolMoves += 1;
      last[c.id] = { x: av.x, y: av.y };
    }
  }
  assert.ok(states.has('patrol'), `순찰이 한 번도 없다 — 관측된 상태: ${[...states].join(',')}`);
  assert.ok(patrolMoves > 0, '순찰 중인데 몸이 움직이지 않는다');
});

test('Sprint2 ⑤ 회복 히스테리시스 — 0.35 아래로 떨어지면 0.75 까지 쉬고 나간다', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  const comp = nation.companions.list.find((c) => c.active);
  const p = nation.players[comp.id];
  const maxHp = playerMaxHp(p, data);
  p.hp = maxHp * 0.3;                       // 많이 다쳤다
  for (let i = 0; i < 8; i += 1) stepCompanions(world, nation, data, 1);
  assert.equal(comp.mem.state, 'rest', '다친 몸은 모닥불로 물러난다');
  p.hp = maxHp * 0.5;                       // 문턱(0.35)은 넘었지만 아직 성치 않다
  for (let i = 0; i < 8; i += 1) stepCompanions(world, nation, data, 1);
  assert.equal(comp.mem.state, 'rest', '반쯤 나은 몸으로 다시 나가지 않는다(떨림 방지)');
  p.hp = maxHp * 0.9;                       // 다 나았다
  for (let i = 0; i < 20; i += 1) stepCompanions(world, nation, data, 1);
  assert.notEqual(comp.mem.state, 'rest', '회복되면 다시 일하러 나간다');
});
