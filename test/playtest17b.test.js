// §17-12 걷어내기 · §17-13 다리/매립 회귀
//
// 피드백 셋을 붙든다.
//   ① "영토 내의 나무나 땅(재배할 수 있는 곳)을 제거할 수 있어야 함 — 나무를 다량 확보"
//      → clearNode: 영토 안의 걷을 수 있는 종류(nodes.clear.refundResource)만, 환급은
//        max(minRefund, 잔량×refundRatio) 를 창고 상한대로 적립, 붙어 있던 주민은 손을 뗀다.
//   ② "후반부에는 물을 건널 수 있는 건축물" → placeBridge: 「가교」 연구 뒤, **물 위에만**,
//      사람(avatar·companions)만 건넌다 — 짐승·적은 그대로 막힌다.
//   ③ "물을 덮을 수 있는 기능(매립)" → placeFill: 메운 물 칸은 뭍으로 쳐서 그 위에 짓는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import {
  townOf, dist, addNode, nodeById, terrainIndex, terrainNameAt,
} from '../server/engine/world.js';
import { applyCommand } from '../server/engine/commands.js';
import { createRng } from '../server/engine/rng.js';
import { onBridge, onFill, researchFeature } from '../server/engine/research.js';
import { walkable } from '../server/engine/companions.js';
import { buildWorldDiff } from '../server/engine/view.js';

const data = loadGameData();
const SEED = 20260806;
const CLEAR = data.world.nodes.clear;
const cmd = (world, c) => applyCommand(world, 'player', c, data, createRng(7));

function scene(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, opts.chapter ?? 5);
  const t = townOf(world, 'player');
  // 저장 상한(티어 0 = 500) 아래에 두어야 걷어내기 환급이 실제로 들어온다(§13-A-5)
  for (const k of ['wood', 'stone', 'grain', 'steel']) nation.resources[k] = 300;
  return { world, nation, t };
}

/** 시험용 물감 — 지정한 사각형을 물로 칠한다(시드에 기대지 않는 결정론 물길) */
function paintWater(world, x0, y0, x1, y1) {
  const idx = terrainIndex(data);
  const ch = String.fromCharCode(48 + idx.water);
  const chars = world.map.terrain.split('');
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) chars[y * world.map.size + x] = ch;
  world.map.terrain = chars.join('');
}

// ────────────────────────────────────────────────────────────────
// ① §17-12 — 걷어내기
// ────────────────────────────────────────────────────────────────
test('★ §17-12 걷어내기 — 영토 안 숲을 걷으면 노드가 사라지고, 목재가 돌아오고, 주민이 손을 뗀다', () => {
  const { world, nation, t } = scene();
  const node = addNode(world, 'forest', t.x + 2, t.y + 2, data);
  nation.villagers = [{
    id: 'v1', x: node.x, y: node.y, destX: node.x, destY: node.y, job: 'lumber', targetId: node.id,
  }];
  const wood0 = nation.resources.wood;

  const res = cmd(world, { type: 'clearNode', nodeId: node.id });
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.equal(nodeById(world, node.id), null, '노드가 world.map.nodes 에서 사라졌다');
  assert.ok((world.map.removedNodes || []).some((r) => r.id === node.id), '걷어 낸 장부에 적혔다');

  // 환급 — max(minRefund, 잔량 × refundRatio). 새 숲의 잔량은 45 라 22.5 가 나온다.
  assert.equal(res.refund.res, 'wood');
  assert.ok(res.refund.amount >= (CLEAR.minRefund.forest ?? 0) - 1e-9,
    `환급이 최소치(${CLEAR.minRefund.forest}) 이상이다 (${res.refund.amount})`);
  assert.ok(nation.resources.wood > wood0, '목재가 실제로 곳간에 들어왔다');
  assert.equal(res.resources.wood, nation.resources.wood, 'ack 의 잔고가 권위값이다');

  // 그 자리를 겨누던 주민은 대기로 물러난다
  assert.equal(nation.villagers[0].job, 'idle', '주민이 손을 뗐다');
  assert.equal(nation.villagers[0].targetId, 'hall');
  assert.equal(nation.villagers[0].destX, t.x, '도읍으로 걸어간다');

  // 지워진 노드는 worldDiff.removedNodes 로 내려간다 — 클라의 유령 나무 방지
  const diff = buildWorldDiff(world, 'player', data, -1);
  assert.ok(diff.removedNodes.includes(node.id), 'worldDiff 가 지워진 것을 알린다');
});

test('★ §17-12 걷어내기 — 다 캔 그루터기(잔량 0)도 걷을 수 있고, 최소 환급이 나온다', () => {
  const { world, nation, t } = scene();
  const node = addNode(world, 'forest', t.x + 3, t.y - 2, data);
  node.amount = 0;
  const wood0 = nation.resources.wood;
  const res = cmd(world, { type: 'clearNode', nodeId: node.id });
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.equal(res.refund.amount, CLEAR.minRefund.forest, '잔량이 바닥이어도 최소치는 나온다');
  assert.equal(nation.resources.wood, wood0 + CLEAR.minRefund.forest);
});

test('★ §17-12 검증 — 영토 밖은 못 걷고, 물목(표에 없는 종류)은 NOT_CLEARABLE 이다', () => {
  const { world, nation, t } = scene();
  // 영토 밖 — 반경(티어 0 = 9) 훨씬 밖에 심는다
  const far = addNode(world, 'forest', t.x + 40, t.y, data);
  const a = cmd(world, { type: 'clearNode', nodeId: far.id });
  assert.equal(a.ok, false);
  assert.equal(a.error.code, 'OUT_OF_TERRITORY');
  assert.ok(nodeById(world, far.id), '실패한 명령은 아무것도 지우지 않는다');

  // 물목 — refundResource 표에 없는 종류는 종류 판정에서 먼저 막힌다
  const fish = addNode(world, 'water', t.x + 2, t.y - 2, data);
  const b = cmd(world, { type: 'clearNode', nodeId: fish.id });
  assert.equal(b.ok, false);
  assert.equal(b.error.code, 'NOT_CLEARABLE');

  // 없는 노드
  const c = cmd(world, { type: 'clearNode', nodeId: 'n999999' });
  assert.equal(c.ok, false);
  assert.equal(c.error.code, 'NO_NODE');
});

// ────────────────────────────────────────────────────────────────
// ② §17-13 — 다리
// ────────────────────────────────────────────────────────────────
test('★ §17-13 다리 — 문이 둘이다: 사슬(10장)이 명령을, 「가교」 연구가 알맹이를 연다', () => {
  const early = scene({ chapter: 1 });
  const line = [{ x: early.t.x + 4, y: early.t.y + 4 }, { x: early.t.x + 8, y: early.t.y + 4 }];
  assert.equal(cmd(early.world, { type: 'placeBridge', points: line }).error.code, 'CHAPTER_LOCKED',
    '사슬이 열기 전에는 명령이 아예 닿지 않는다');

  const { world } = scene({ chapter: 10 });
  const late = cmd(world, { type: 'placeBridge', points: line });
  assert.equal(late.error.code, 'NO_RESEARCH', '사슬이 열려도 가교를 모르면 놓을 수 없다');
});

test('★ §17-13 다리 — 뭍에는 안 놓이고(BAD_TERRAIN 스킵), 물 위에는 놓이며 목재가 든다', () => {
  const { world, nation, t } = scene({ chapter: 10 });
  nation.research.done.bridgeworks = 1;
  assert.equal(researchFeature(nation, 'bridges', data), true);

  // 전부 뭍인 획 — 놓을 자리가 하나도 없다
  const landLine = [{ x: t.x + 2, y: t.y + 2 }, { x: t.x + 5, y: t.y + 2 }];
  assert.equal(terrainNameAt(world.map, t.x + 2, t.y + 2, data) !== 'water', true, '전제: 뭍이다');
  const bad = cmd(world, { type: 'placeBridge', points: landLine });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'NO_VALID_TILE', '뭍 위의 칸은 전부 BAD_TERRAIN 으로 걸러진다');

  // 물길을 그리고 그 위에 놓는다
  paintWater(world, t.x + 4, t.y + 4, t.x + 9, t.y + 4);
  const wood0 = nation.resources.wood;
  const r = cmd(world, {
    type: 'placeBridge', points: [{ x: t.x + 4, y: t.y + 4 }, { x: t.x + 9, y: t.y + 4 }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null));
  assert.equal(r.placed, 6, `물길 여섯 칸이 전부 놓였다 (${r.placed})`);
  assert.equal(nation.resources.wood,
    wood0 - data.research.bridges.costPerTile.wood * r.placed, '칸마다 목재가 든다');
  assert.equal(onBridge(nation, t.x + 6, t.y + 4), true);
  assert.equal(onBridge(nation, t.x + 6, t.y + 5), false);

  // 걷어 내면 절반이 돌아온다 (철로와 같은 규칙)
  const ids = nation.bridges.map((b) => b.id);
  const back = cmd(world, { type: 'removeBridge', tileIds: ids });
  assert.equal(back.ok, true);
  assert.equal(nation.bridges.length, 0);
  assert.ok(back.refund.wood > 0, '낸 값의 절반이 돌아온다');
});

test('★ §17-13 다리 — 동료의 걸음이 다리 위의 물을 길로 본다(짐승·적의 문은 그대로 닫혀 있다)', () => {
  const { world, nation, t } = scene({ chapter: 10 });
  nation.research.done.bridgeworks = 1;
  // 두 줄짜리 물길을 그리고 윗줄에만 다리를 놓는다
  paintWater(world, t.x + 4, t.y + 4, t.x + 9, t.y + 5);
  cmd(world, { type: 'placeBridge', points: [{ x: t.x + 4, y: t.y + 4 }, { x: t.x + 9, y: t.y + 4 }] });

  assert.equal(walkable(world, data, t.x + 6, t.y + 4, nation), true, '다리 위의 물은 길이다');
  assert.equal(walkable(world, data, t.x + 6, t.y + 5, nation), false, '다리가 없는 물은 여전히 못 건넌다');
  // nation 을 모르는 호출(짐승·적 계열의 판정과 같은 형)은 다리를 모른다 — 물은 그들의 벽이다
  assert.equal(walkable(world, data, t.x + 6, t.y + 4), false, 'nation 없는 판정에는 다리가 없다');
});

// ────────────────────────────────────────────────────────────────
// ③ §17-13 — 매립
// ────────────────────────────────────────────────────────────────
test('★ §17-13 매립 — 메우기 전의 물에는 못 짓고, 메운 물 칸 위에는 건물이 선다', () => {
  const { world, nation, t } = scene({ chapter: 10 });
  nation.research.done.bridgeworks = 1;
  nation.research.done.landfill = 1;
  assert.equal(researchFeature(nation, 'landfill', data), true);

  // 영토 안(티어 0 반경 9)에 3×3 물웅덩이를 그린다
  paintWater(world, t.x + 4, t.y + 4, t.x + 6, t.y + 6);
  const spot = { x: t.x + 5, y: t.y + 5 };

  const before = cmd(world, { type: 'placeBuilding', building: 'tent', x: spot.x, y: spot.y });
  assert.equal(before.ok, false);
  assert.equal(before.error.code, 'BAD_TERRAIN', '메우기 전의 물에는 못 짓는다');

  // 뱀길 폴리라인으로 아홉 칸을 전부 메운다
  const stone0 = nation.resources.stone;
  const r = cmd(world, {
    type: 'placeFill',
    points: [
      { x: t.x + 4, y: t.y + 4 }, { x: t.x + 6, y: t.y + 4 },
      { x: t.x + 6, y: t.y + 5 }, { x: t.x + 4, y: t.y + 5 },
      { x: t.x + 4, y: t.y + 6 }, { x: t.x + 6, y: t.y + 6 },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null));
  assert.equal(r.placed, 9, `아홉 칸이 전부 메워졌다 (${r.placed})`);
  assert.equal(nation.resources.stone,
    stone0 - data.research.fill.costPerTile.stone * r.placed, '칸마다 석재가 든다');
  assert.equal(onFill(nation, spot.x, spot.y), true);

  // 메운 자리는 뭍이다 — 사람이 걷고, 건물이 선다
  assert.equal(walkable(world, data, spot.x, spot.y, nation), true, '메운 칸은 사람에게 길이다');
  const after = cmd(world, { type: 'placeBuilding', building: 'tent', x: spot.x, y: spot.y });
  assert.equal(after.ok, true, JSON.stringify(after.error ?? null));
});
