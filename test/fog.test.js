// 전장의 안개 — docs/WORLD.md §1 · docs/PROTOCOL.md v3.0 §안개 즉시 공개.
// ★ 회귀 방지: 예전에는 recomputeFog 가 '일 틱'에서만 돌아, 새로 걸어 들어간 땅의 노드가
//   다음 일 틱(최대 10분)까지 world/worldDiff 에 실리지 않았다. 이제 lordMove 가 그 자리에서
//   아바타 시야 원을 찍고, 방금 밝아진 청크·노드만 담은 작은 worldDiff 를 즉시 내려보낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf } from '../server/engine/world.js';
import { fogValue, isExplored, exploredRatio, recomputeFog } from '../server/engine/fog.js';
import { buildRevealDiff, buildWorldSnapshot, buildWorldDiff } from '../server/engine/view.js';

const data = loadGameData();
const VISION = data.world.fog.vision.lord;

function scene(seed = 11) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  return { world, nation, town, rng: createRng(seed) };
}

const move = (world, x, y, rng) =>
  applyCommand(world, 'player', { type: 'lordMove', avatarId: 'lord', playerName: '테스트', x, y }, data, rng);

/** 아직 아무도 가 보지 않은 캄캄한 칸 하나 */
function darkTile(world, nation, town) {
  const size = data.world.size;
  for (let r = VISION + 4; r < size / 2; r += 1) {
    for (let a = 0; a < 32; a += 1) {
      const ang = (a / 32) * Math.PI * 2;
      const x = Math.round(town.x + Math.cos(ang) * r);
      const y = Math.round(town.y + Math.sin(ang) * r);
      if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) continue;
      if (fogValue(nation, x, y) !== 0) continue;
      return { x, y };
    }
  }
  return null;
}

test('안개 즉시 공개 — lordMove 한 번이면 그 자리가 일 틱을 기다리지 않고 밝아진다', () => {
  const { world, nation, town, rng } = scene();
  const dark = darkTile(world, nation, town);
  assert.ok(dark, '캄캄한 땅이 있다');
  assert.equal(fogValue(nation, dark.x, dark.y), 0, '지금은 완전히 캄캄하다');

  const tick0 = world.tick;
  const res = move(world, dark.x, dark.y, rng);

  assert.equal(res.ok, true);
  assert.equal(world.tick, tick0, '일 틱은 돌지 않았다');
  assert.equal(res.moved, true);
  assert.ok(res.revealed.length > 0, '바뀐 청크가 돌아온다');
  assert.equal(fogValue(nation, dark.x, dark.y), 2, '선 자리는 시야다');
  assert.equal(fogValue(nation, dark.x + VISION - 1, dark.y), 2, '시야 원 안쪽도 밝다');
  assert.equal(fogValue(nation, dark.x + VISION + 3, dark.y), 0, '원 밖은 그대로 캄캄하다');
});

test('안개 즉시 공개 — 걸어 들어간 땅의 노드가 곧바로 worldDiff 에 실린다', () => {
  const { world, nation, town, rng } = scene(23);
  // 캄캄한 곳에 있는 노드를 하나 고르고, 그 자리로 걸어간다
  const target = (world.map.nodes || [])
    .find((n) => !n.hidden && !isExplored(nation, n.x, n.y)
      && Math.hypot(n.x - town.x, n.y - town.y) > VISION + 6);
  assert.ok(target, '아직 못 본 노드가 있다');

  const before = buildWorldSnapshot(world, 'player', data).nodes.map((n) => n.id);
  assert.equal(before.includes(target.id), false, '가 보기 전에는 그 자리가 안 보인다');

  const res = move(world, target.x, target.y, rng);
  assert.equal(res.ok, true);

  const diff = buildRevealDiff(world, 'player', data, res.revealed);
  assert.ok(diff, '즉시 공개분이 만들어진다');
  assert.equal(diff.reveal, true, '즉시 공개 표시가 붙는다');
  assert.ok(diff.fog.length > 0, '안개 청크가 실린다');
  assert.ok(diff.nodes.some((n) => n.id === target.id), '새로 보인 노드가 실린다');
  assert.ok(diff.nodes.every((n) => isExplored(nation, n.x, n.y)), '안 본 자리는 절대 실리지 않는다');

  const after = buildWorldSnapshot(world, 'player', data).nodes.map((n) => n.id);
  assert.ok(after.includes(target.id), '스냅샷에도 곧바로 들어온다');
});

test('안개 즉시 공개 — 같은 칸을 다시 보고하면 아무것도 하지 않는다 (이동 스로틀)', () => {
  const { world, nation, town, rng } = scene(31);
  const dark = darkTile(world, nation, town);
  const first = move(world, dark.x, dark.y, rng);
  assert.ok(first.revealed.length > 0);

  const same = move(world, dark.x, dark.y, rng);
  assert.equal(same.moved, false, '같은 칸 — 움직인 것이 아니다');
  assert.deepEqual(same.revealed, [], '다시 찍지 않는다');
  assert.equal(buildRevealDiff(world, 'player', data, same.revealed), null, '보낼 것이 없다');

  // 두 칸 사이를 오가도, 이미 본 땅에는 보낼 것이 없다 — 비용이 '메시지 수'가 아니라
  // '새로 알게 된 정보량'에 붙는다는 계약(연타로 서버를 갉을 수 없다)
  move(world, dark.x + 1, dark.y, rng);
  const back = move(world, dark.x, dark.y, rng);
  const forth = move(world, dark.x + 1, dark.y, rng);
  assert.equal(back.moved, true);
  assert.equal(forth.moved, true);
  assert.deepEqual(back.revealed, [], '되돌아온 자리는 이미 본 땅이다');
  assert.deepEqual(forth.revealed, [], '오가는 것은 공짜다');
});

test('안개 — 탐사됨(1)은 지워지지 않는다: 지나간 자리는 어둡게 남는다', () => {
  const { world, nation, town, rng } = scene(37);
  const dark = darkTile(world, nation, town);
  move(world, dark.x, dark.y, rng);
  assert.equal(fogValue(nation, dark.x, dark.y), 2);

  // 도읍으로 돌아가고 일 틱을 흉내내어 안개를 다시 계산한다
  move(world, town.x, town.y, rng);
  recomputeFog(world, nation, data, world.tick + 1);
  assert.equal(fogValue(nation, dark.x, dark.y), 1, '가 본 땅은 어둡게 기억된다');
  assert.ok(exploredRatio(nation) > 0, '탐사 진척이 쌓인다');
});

test('안개 — 일 틱 worldDiff 도 여전히 바뀐 청크만 싣는다 (기존 계약 유지)', () => {
  const { world, nation, town, rng } = scene(41);
  const dark = darkTile(world, nation, town);
  move(world, dark.x, dark.y, rng);
  const diff = buildWorldDiff(world, 'player', data, world.tick - 1);
  assert.ok(diff.fog.length > 0, '이번 틱에 바뀐 청크가 있다');
  const quiet = buildWorldDiff(world, 'player', data, world.tick);
  assert.equal(quiet.fog.length, 0, '이미 보낸 틱 이후로는 조용하다');
});
