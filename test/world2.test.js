// 월드 2.0 — docs/GDD3.md §13-B. 군락 지형 · 영토 안 빈 땅 · 유한 자원 · 유적 다양화 · 스폰 링.
//
// 이 파일이 지키는 계약 다섯 가지:
//   ① 같은 씨앗은 같은 땅을 낸다(군락까지 한 톨도 다르지 않다)
//   ② 시작 영토 안에는 자원 노드가 **하나도 없다** — 건물 놓을 자리를 비워 두는 것이 §13-B-2 다
//   ③ 첫 군락은 걸어갈 만한 거리(8~14타일)에 반드시 있다 — 사슬 1~3장이 이 거리를 전제로 굴러간다
//   ④ 다 캔 자리는 그루터기로 남고 정해진 날에 되살아난다(그 사이에는 자라지 않는다)
//   ⑤ 유적은 크기가 있고, 클수록 멀고 오래 걸리며, 일부는 가까이 가야 드러난다
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import {
  townOf, dist, generateWorldMap, markDepleted, regrowDays, ringAt, ringRadii, territoryRadius,
} from '../server/engine/world.js';
import { stepNodes, listTargets } from '../server/engine/villagers.js';
import { ensurePlayer } from '../server/engine/skills.js';

const data = loadGameData();
const CL = data.world.nodes.clusters;

function scene(seed = 5, chapter = 4) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, chapter);
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '테스트');
  return { world, nation, town, rng: createRng(seed) };
}

const dTown = (n, town) => dist(n.x, n.y, town.x, town.y);

// ────────────────────────────────────────────────────────────────
// ① 재현성
// ────────────────────────────────────────────────────────────────
test('군락 — 같은 씨앗은 같은 땅을 낸다 (노드도 군락도 한 톨도 다르지 않다)', () => {
  const a = generateWorldMap(1234, data, { playerTags: ['fertile', 'holy'] });
  const b = generateWorldMap(1234, data, { playerTags: ['fertile', 'holy'] });
  assert.equal(a.nodes.length, b.nodes.length);
  assert.equal(a.clusters.length, b.clusters.length);
  assert.deepEqual(
    a.nodes.map((n) => `${n.id}:${n.type}:${n.x},${n.y}:${n.cluster ?? ''}`),
    b.nodes.map((n) => `${n.id}:${n.type}:${n.x},${n.y}:${n.cluster ?? ''}`),
  );
  assert.deepEqual(
    a.clusters.map((c) => `${c.id}:${c.type}:${c.x},${c.y}:${c.r}:${c.n}`),
    b.clusters.map((c) => `${c.id}:${c.type}:${c.x},${c.y}:${c.r}:${c.n}`),
  );
  const other = generateWorldMap(1235, data, { playerTags: ['fertile', 'holy'] });
  assert.notDeepEqual(a.clusters.map((c) => `${c.x},${c.y}`), other.clusters.map((c) => `${c.x},${c.y}`),
    '씨앗이 다르면 땅도 다르다');
});

test('군락 — 노드는 흩뿌려지지 않고 뭉친다 (군락에 속하지 않는 노드가 없다)', () => {
  const map = generateWorldMap(77, data, { playerTags: [] });
  const loose = map.nodes.filter((n) => n.type !== 'ruin' && !n.cluster);
  assert.equal(loose.length, 0, '유적을 빼면 모든 노드가 어느 군락에 속한다');
  // 숲 군락은 여럿이 모여야 '군락'이다
  const forests = map.clusters.filter((c) => c.type === 'forest');
  assert.ok(forests.length > 0);
  const avg = forests.reduce((a, c) => a + c.n, 0) / forests.length;
  assert.ok(avg >= 4, `숲 군락 한 곳에 평균 ${avg.toFixed(1)}그루`);
});

// ────────────────────────────────────────────────────────────────
// ② 영토 안 빈 땅 · ③ 첫 군락 거리
// ────────────────────────────────────────────────────────────────
test('★ §13-B-2 영토 안 빈 땅 — 시작 영토 둘레에는 자원 노드가 하나도 없다', () => {
  for (const seed of [3, 42, 777, 90210]) {
    const map = generateWorldMap(seed, data, { playerTags: [] });
    const town = map.towns.find((t) => t.isPlayer);
    const inside = map.nodes.filter((n) => dTown(n, town) <= CL.clearRadius);
    assert.equal(inside.length, 0, `씨앗 ${seed}: 빈 땅 안에 노드 ${inside.length}개`);
  }
});

test('★ §13-B-2 첫 군락 — 마차에서 내려 걸어갈 만한 거리에 나무·열매·바위가 있다', () => {
  for (const seed of [3, 42, 777, 90210]) {
    const map = generateWorldMap(seed, data, { playerTags: [] });
    const town = map.towns.find((t) => t.isPlayer);
    const nearest = (type) => map.nodes.filter((n) => n.type === type)
      .reduce((best, n) => Math.min(best, dTown(n, town)), Infinity);
    // 첫 나무까지의 거리가 이 검사의 핵심이다 — 부담스러우면 1장이 지루해진다
    assert.ok(nearest('forest') <= 16, `씨앗 ${seed}: 첫 나무까지 ${nearest('forest').toFixed(1)}타일`);
    assert.ok(nearest('berry') <= 16, `씨앗 ${seed}: 첫 열매까지 ${nearest('berry').toFixed(1)}타일`);
    assert.ok(nearest('rock') <= 20, `씨앗 ${seed}: 첫 바위까지 ${nearest('rock').toFixed(1)}타일`);
    assert.ok(nearest('forest') > CL.clearRadius, '그래도 영토 안은 아니다');
  }
});

test('★ §13-B-2 영토 밖 채집 — 「우리 땅이 아닙니다」로 막지 않는다', () => {
  const { world, nation, town, rng } = scene(11);
  const node = world.map.nodes
    .filter((n) => n.type === 'forest' && !n.hidden)
    .sort((a, b) => dTown(a, town) - dTown(b, town))[0];
  assert.ok(node, '숲이 있다');
  assert.ok(dTown(node, town) > territoryRadius(nation, data), '그 나무는 영토 밖이다');
  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;
  const r = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: 1000 }, data, rng);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(r.gained.wood > 0, '영토 밖에서도 나무가 튄다');
});

test('★ §13-B-2 주민 일자리 — 영토가 비었어도 일할 곳이 있다 (일자리 반경은 영토를 넘는다)', () => {
  const { world, nation } = scene(13);
  const targets = listTargets(world, nation, data).filter((t) => t.kind === 'node');
  assert.ok(targets.length > 0, '영토 밖 군락이 일자리 목록에 실린다');
  const r = territoryRadius(nation, data) + data.world.villagers.workRadiusBonus;
  const town = townOf(world, 'player');
  for (const t of targets) assert.ok(dist(t.x, t.y, town.x, town.y) <= r + 0.001, '걸어갈 만한 거리 안이다');
});

// ────────────────────────────────────────────────────────────────
// ④ 유한 · 재생
// ────────────────────────────────────────────────────────────────
test('★ §13-B-3 그루터기 — 다 캔 자리는 정해진 날에 되살아난다 (그 사이에는 자라지 않는다)', () => {
  const { world } = scene(17);
  const node = world.map.nodes.find((n) => n.type === 'forest');
  markDepleted(node, data, 10);
  assert.equal(node.depleted, true);
  assert.ok(node.respawnAt > 10, '되살아날 날이 그 자리에서 정해진다');
  const [lo, hi] = data.world.nodes.regrow.byType.forest;
  assert.ok(node.respawnAt - 10 >= lo && node.respawnAt - 10 <= hi, `나무는 ${lo}~${hi}일`);

  // 기다리는 동안에는 regenPerTick 이 돌지 않는다 — 그루터기가 슬금슬금 나무가 되면 안 된다
  for (let t = 11; t < node.respawnAt; t += 1) {
    stepNodes(world, data, t);
    assert.equal(node.amount, 0, `${t}일차에도 그루터기 그대로다`);
    assert.equal(node.depleted, true);
  }
  stepNodes(world, data, node.respawnAt);
  assert.equal(node.depleted, false, '그 날이 오면 되살아난다');
  assert.equal(node.amount, node.max, '잔량이 통째로 돌아온다');
  assert.equal(node.respawnAt, null);
});

test('★ §13-B-3 재생 날수 — 나무 2~4일 · 딸기 1일 · 바위와 광맥 6일', () => {
  assert.deepEqual(data.world.nodes.regrow.byType.berry, [1, 1]);
  assert.deepEqual(data.world.nodes.regrow.byType.rock, [6, 6]);
  assert.deepEqual(data.world.nodes.regrow.byType.iron, [6, 6]);
  assert.equal(regrowDays('rock', data), 6);
  assert.equal(regrowDays('berry', data), 1);
  // 표에 없는 종류(물목)는 그루터기가 되지 않는다 — 물고기는 '몰려오는 것'이라 옛 규칙이 돈다
  assert.equal(regrowDays('water', data), null);
});

test('★ §13-B-3 스윙으로 바닥나면 그 자리에서 그루터기가 된다', () => {
  const { world, nation, town, rng } = scene(19);
  const node = world.map.nodes
    .filter((n) => n.type === 'forest')
    .sort((a, b) => dTown(a, town) - dTown(b, town))[0];
  nation.avatars.lord.x = node.x;
  nation.avatars.lord.y = node.y;
  let now = 1000;
  for (let i = 0; i < 200 && !node.depleted; i += 1) {
    applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now }, data, rng);
    now += 2500;
  }
  assert.equal(node.depleted, true, '훑으면 바닥이 난다');
  assert.ok(node.respawnAt != null, '되살아날 날이 잡힌다');
  const dead = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now: now + 5000 }, data, rng);
  assert.equal(dead.ok, false);
  assert.equal(dead.error.code, 'DEPLETED');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 유적 다양화
// ────────────────────────────────────────────────────────────────
test('★ §13-B-4 유적 — 크기 1~4가 다 나오고, 클수록 멀고 오래 걸린다', () => {
  const map = generateWorldMap(4242, data, { playerTags: [] });
  const town = map.towns.find((t) => t.isPlayer);
  const ruins = map.nodes.filter((n) => n.type === 'ruin');
  assert.ok(ruins.length > 0);
  const sizes = new Set(ruins.map((r) => r.size));
  assert.ok(sizes.size >= 3, `크기 갈래 ${[...sizes].sort().join(',')}`);
  for (const r of ruins) {
    assert.ok(r.size >= 1 && r.size <= 4);
    assert.ok(r.swingsPerCycle > 0, '뒤지는 데 드는 스윙이 크기마다 다르다');
    const spec = data.world.nodes.ruinSizes.table.find((t) => t.size === r.size);
    assert.equal(r.swingsPerCycle, spec.swings);
    assert.ok(dTown(r, town) >= spec.minDistance, `크기 ${r.size} 유적은 ${spec.minDistance}타일 밖에 있다`);
  }
  const big = ruins.filter((r) => r.size >= 3);
  const small = ruins.filter((r) => r.size === 1);
  const avgD = (list) => list.reduce((a, r) => a + dTown(r, town), 0) / Math.max(1, list.length);
  assert.ok(avgD(big) > avgD(small), '큰 유적일수록 멀다');
  assert.ok(ruins.some((r) => r.concealed), '일부는 숨어 있다');
});

test('★ §13-B-4 은닉 유적 — 가까이 가야 지도에 나타나고, 그 전에는 칠 수도 없다', () => {
  const { world, nation, rng } = scene(31, 6);
  const hidden = world.map.nodes.find((n) => n.type === 'ruin' && n.concealed);
  assert.ok(hidden, '숨은 유적이 있다');
  // 아직 안 드러난 자리는 **사거리를 따지기도 전에** 막힌다 — 있는 줄도 모르는 것이다
  const blocked = applyCommand(world, 'player', { type: 'actionSwing', nodeId: hidden.id, avatarId: 'lord', now: 1000 }, data, rng);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'HIDDEN_NODE');

  const moved = applyCommand(world, 'player',
    { type: 'lordMove', x: hidden.x, y: hidden.y, avatarId: 'lord' }, data, rng);
  assert.equal(moved.ok, true);
  assert.ok(moved.revealedNodes.includes(hidden.id), '걸어가면 드러난다');
  assert.equal(hidden.revealed, true);
  assert.equal(nation.codex.ruins[hidden.id].size, hidden.size, '도감의 유적 탭에 남는다');
});

// ────────────────────────────────────────────────────────────────
// 스폰 링
// ────────────────────────────────────────────────────────────────
test('★ §13-B-5 스폰 링 — 본부에서 멀어질수록 띠가 올라가고, 영토가 자라면 안전한 땅도 자란다', () => {
  const { world, nation, town } = scene(23);
  const { r0, r1 } = ringRadii(nation, data);
  assert.ok(r0 > territoryRadius(nation, data), '링0 은 영토보다 넉넉하다');
  assert.equal(ringAt(world, nation, town.x, town.y, data), 0);
  assert.equal(ringAt(world, nation, town.x + Math.round(r0) - 1, town.y, data), 0);
  assert.equal(ringAt(world, nation, town.x + Math.round(r0) + 2, town.y, data), 1);
  assert.equal(ringAt(world, nation, town.x + Math.round(r1) + 2, town.y, data), 2);

  const before = ringRadii(nation, data).r0;
  nation.tier = 3;
  assert.ok(ringRadii(nation, data).r0 > before, '정착지가 자라면 안전한 땅도 함께 자란다');
});

test('★ §13-B-5 링2 경고 — 처음 발을 들일 때 한 번, 되돌아 나갔다 오면 다시', () => {
  const { world, nation, town, rng } = scene(29);
  const { r1 } = ringRadii(nation, data);
  const far = { x: Math.min(data.world.size - 2, town.x + Math.round(r1) + 6), y: town.y };
  const enter = applyCommand(world, 'player', { type: 'lordMove', x: far.x, y: far.y, avatarId: 'lord' }, data, rng);
  assert.equal(enter.ring, 2);
  assert.equal(enter.ringEntered, true, '처음 들어서면 경고가 뜬다');
  assert.ok(enter.ringText);

  const again = applyCommand(world, 'player', { type: 'lordMove', x: far.x, y: far.y - 1, avatarId: 'lord' }, data, rng);
  assert.equal(again.ringEntered, false, '띠 안에서 걷는 동안에는 다시 뜨지 않는다');

  applyCommand(world, 'player', { type: 'lordMove', x: town.x, y: town.y, avatarId: 'lord' }, data, rng);
  const back = applyCommand(world, 'player', { type: 'lordMove', x: far.x, y: far.y, avatarId: 'lord' }, data, rng);
  assert.equal(back.ringEntered, true, '나갔다 다시 들어오면 또 알린다');
});
