// §22 유적 개편 회귀 — docs/유적개편기획.md
//
// 이 파일이 붙드는 문장은 일곱이다.
//   ① 방 하나를 다 뒤지면 **그 자리에서** 카드가 선다 — 나라의 게이지도 왕의 행동력도 거치지 않는다.
//   ② 나라의 누적 게이지는 사라졌다 — 자취 셋을 하나씩 뒤져도 엉뚱한 자리에서 카드가 뜨지 않는다.
//   ③ 다 뒤진 자취는 **지워지지 않고** 폐허로 남되 다시 두드려지지 않는다.
//   ④ 등급 보정은 나라가 아니라 그 방이 지고 다닌다 — 끝 방이 가장 후하다.
//   ⑤ 같은 날 방 둘을 열어도 결정이 서로를 삼키지 않는다(열쇠 충돌).
//   ⑥ 같은 지도의 같은 방은 언제 열어도 같은 카드다(월드 난수를 축내지 않는다).
//   ⑦ 왕의 행동력에서 'explore' 는 사라졌다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { actionSwing } from '../server/engine/actions.js';
import { performApAction } from '../server/engine/king.js';
import { createRng } from '../server/engine/rng.js';
import { townOf } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { codexView } from '../server/engine/codex.js';

const data = loadGameData();

function scene(seed = 2200) {
  const world = createWorld({ seed, data, playerName: '개척자' });
  const nation = world.nations.player;
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  // 시계는 장면마다 하나뿐이다 — swing() 을 두 번 부를 때 같은 밀리초를 다시 쓰면 쿨타임에 걸린다
  return { world, nation, town: t, clock: 1e6 };
}

/** 자취 하나를 본영 옆에 세운다 — 지도 뽑기에 기대지 않는다(씨앗이 바뀌어도 이 회귀는 산다) */
function putRuin(s, { id = 'ruinA', rooms = 2, roomSwings = 2, gradeBoost = 3, dx = 1 } = {}) {
  const node = {
    id, type: 'ruin', x: s.town.x + dx, y: s.town.y,
    amount: 0, max: 0, swings: 0, rooms, roomsOpened: 0,
    swingsPerCycle: roomSwings, gradeBoost, size: rooms, ruinName: '무너진 터',
  };
  s.world.map.nodes.push(node);
  return node;
}

/** 쿨타임을 건너뛰며 n 번 휘두른다 — now 를 넉넉히 밀어 준다(결정론) */
function swing(s, nodeId, n = 1) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    s.clock += 60_000;
    out.push(actionSwing(s.world, s.nation, { nodeId, avatarId: 'lord' }, data, s.clock));
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// ① · ② 그 자리에서 열린다 / 나라의 저금통은 없다
// ────────────────────────────────────────────────────────────────

test('★ §22 ① 방 하나를 다 뒤지면 그 자리에서 카드가 선다', () => {
  const s = scene();
  const node = putRuin(s, { rooms: 2, roomSwings: 2 });
  const [first, second] = swing(s, node.id, 2);
  assert.equal(first.ok, true);
  assert.equal(first.ruin, null, '주기 중간에는 방이 열리지 않는다');
  assert.ok(second.ruin, '주기를 끝내면 방이 열린다');
  assert.equal(second.ruin.room, 1);
  assert.equal(second.ruin.rooms, 2);
  assert.ok(second.ruin.card?.cardId, '카드가 함께 실려 나온다');
  assert.equal(s.nation.decisionQueue.length, 1, '결정 큐에 그 카드가 서 있다');
  assert.equal(s.nation.decisionQueue[0].ruin.cardId, second.ruin.card.cardId);
});

test('★ §22 ② 나라의 누적 게이지는 사라졌다', () => {
  const s = scene();
  assert.equal(s.nation.ruinGauge, undefined, '새 나라에 게이지 칸이 없다');
  assert.equal(data.ruins.gaugeThreshold, undefined, '자료에도 문턱이 없다');
  /* 자취 둘을 하나씩 반 주기만 뒤진다 — 옛 규칙이면 나라 게이지가 차서 언젠가 엉뚱한 자리에서
     카드가 떴다. 이제는 어느 자리도 제 주기를 못 끝냈으므로 아무 카드도 서지 않는다. */
  const a = putRuin(s, { id: 'rA', rooms: 1, roomSwings: 4, dx: 1 });
  const b = putRuin(s, { id: 'rB', rooms: 1, roomSwings: 4, dx: 2 });
  swing(s, a.id, 3);
  swing(s, b.id, 3);
  assert.equal(s.nation.decisionQueue.length, 0, '반쯤 뒤진 자취는 아무것도 내지 않는다');
  assert.equal(s.nation.ruinGauge, undefined, '나라에 아무것도 쌓이지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ③ 다 뒤진 자리
// ────────────────────────────────────────────────────────────────

test('★ §22 ③ 다 뒤진 자취는 폐허로 남되 다시 두드려지지 않는다', () => {
  const s = scene();
  const node = putRuin(s, { rooms: 2, roomSwings: 1 });
  const [r1, r2] = swing(s, node.id, 2);
  assert.equal(r1.ruin.spent, false, '첫 방은 끝이 아니다');
  assert.equal(r2.ruin.spent, true, '끝 방을 열면 자취가 닫힌다');
  assert.equal(node.spent, true);
  assert.ok(s.world.map.nodes.includes(node), '자리는 지워지지 않는다 — 궤와 갈리는 지점');
  const again = swing(s, node.id, 1)[0];
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'RUIN_SPENT');
});

test('★ §22 ③ 도감이 「몇 방 남았나」를 적는다', () => {
  const s = scene();
  const node = putRuin(s, { rooms: 3, roomSwings: 1 });
  swing(s, node.id, 1);
  const mid = codexView(s.nation, data).ruins.find((r) => r.id === node.id);
  assert.equal(mid.rooms, 3);
  assert.equal(mid.roomsOpened, 1);
  assert.equal(mid.spent, false);
  swing(s, node.id, 2);
  const done = codexView(s.nation, data).ruins.find((r) => r.id === node.id);
  assert.equal(done.roomsOpened, 3);
  assert.equal(done.spent, true);
});

// ────────────────────────────────────────────────────────────────
// ④ 등급 보정은 그 방의 것
// ────────────────────────────────────────────────────────────────

test('★ §22 ④ 끝 방이 가장 후하고, 보정은 카드가 지고 다닌다', () => {
  const s = scene();
  const node = putRuin(s, { rooms: 4, roomSwings: 1, gradeBoost: 3 });
  swing(s, node.id, 4);
  const boosts = s.nation.decisionQueue.map((d) => d.ruin.gradeBoost);
  assert.equal(boosts.length, 4, '방 넷이 카드 넷을 세웠다');
  assert.equal(boosts[0], 0, '첫 방은 보정이 없다');
  assert.equal(boosts[3], 3, '끝 방이 자취의 보정을 온전히 받는다');
  assert.ok(boosts[3] >= boosts[1], '안으로 갈수록 후해진다');
  assert.equal(s.nation.ruinGradeBoost, undefined, '나라에는 아무것도 쌓이지 않는다');
});

test('★ §22 ④ 방이 둘인 자취도 끝 방은 온전한 보정을 받는다', () => {
  const s = scene();
  const node = putRuin(s, { rooms: 2, roomSwings: 1, gradeBoost: 2 });
  swing(s, node.id, 2);
  const boosts = s.nation.decisionQueue.map((d) => d.ruin.gradeBoost);
  assert.equal(boosts[0], 0);
  assert.equal(boosts[1], 2, '표를 방 번호로 직접 인덱싱하면 여기서 1 이 나온다(회귀)');
});

// ────────────────────────────────────────────────────────────────
// ⑤ · ⑥ 열쇠 충돌 / 결정론
// ────────────────────────────────────────────────────────────────

test('★ §22 ⑤ 같은 날 방 둘을 열어도 결정이 서로를 삼키지 않는다', () => {
  const s = scene();
  const node = putRuin(s, { rooms: 3, roomSwings: 1 });
  swing(s, node.id, 3);
  const ids = s.nation.decisionQueue.map((d) => d.decisionId);
  assert.equal(new Set(ids).size, 3, `열쇠가 겹쳤다: ${ids.join(' · ')}`);
});

test('★ §22 ⑥ 같은 지도의 같은 방은 같은 카드고, 월드 난수를 축내지 않는다', () => {
  const before = createRng(2200);
  const s = scene();
  s.world.rng = before;
  const node = putRuin(s, { rooms: 2, roomSwings: 1 });
  const cards = swing(s, node.id, 2).map((r) => r.ruin.card.cardId);

  const s2 = scene();
  const node2 = putRuin(s2, { rooms: 2, roomSwings: 1 });
  const cards2 = swing(s2, node2.id, 2).map((r) => r.ruin.card.cardId);
  assert.deepEqual(cards, cards2, '같은 씨앗·같은 자리·같은 방은 같은 카드를 낸다');

  const after = createRng(2200);
  assert.equal(before.int(0, 1e9), after.int(0, 1e9), '스윙이 월드 난수를 한 톨도 안 썼다');
});

// ────────────────────────────────────────────────────────────────
// ⑦ 죽은 명령을 걷어냈다
// ────────────────────────────────────────────────────────────────

test('★ §22 ⑦ 왕의 행동력에서 유적 탐사가 사라졌다', () => {
  const s = scene();
  assert.equal(data.balance.actionPoints.actions.explore, undefined, '자료에 explore 가 없다');
  const node = putRuin(s, { rooms: 1, roomSwings: 1 });
  const res = performApAction(
    s.world, s.nation, { apType: 'explore', nodeId: node.id }, data, createRng(1),
  );
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'BAD_AP_ACTION');
});

// ────────────────────────────────────────────────────────────────
// 자료 온전성 — 크기표가 방을 제대로 적었는가
// ────────────────────────────────────────────────────────────────

test('★ §22 크기표 — 크기가 곧 방의 수고, 총 스윙은 옛 값 언저리다', () => {
  const cfg = data.world.nodes.ruinSizes;
  assert.ok(Array.isArray(cfg.roomBoostCurve) && cfg.roomBoostCurve.length, '깊이 표가 있다');
  assert.equal(cfg.roomBoostCurve[cfg.roomBoostCurve.length - 1], 1, '끝은 온전한 보정이다');
  let prev = 0;
  for (const row of cfg.table) {
    assert.equal(row.gauge, undefined, `크기 ${row.size}: 폐지된 gauge 가 남아 있다`);
    assert.equal(row.swings, undefined, `크기 ${row.size}: 폐지된 swings 가 남아 있다`);
    assert.ok(row.rooms >= 1 && row.roomSwings >= 1, `크기 ${row.size}: 방 규격이 없다`);
    assert.equal(row.rooms, row.size, '크기가 곧 방의 수다');
    const total = row.rooms * row.roomSwings;
    assert.ok(total > prev, '큰 자취가 더 오래 걸린다');
    assert.ok(total <= 26, `크기 ${row.size}: 총 ${total} 스윙은 옛 값(22)에서 너무 멀다`);
    prev = total;
  }
});

test('★ §22 카드 풀 — 깊이 명단이 실재하는 카드만 적었다', () => {
  const cfg = data.ruins.roomDepth;
  const ids = new Set(data.ruins.cards.map((c) => c.id));
  for (const id of [...(cfg.shallow || []), ...(cfg.deep || [])]) {
    assert.ok(ids.has(id), `없는 카드를 적었다: ${id}`);
  }
  assert.ok(cfg.shallow.length && cfg.deep.length, '두 명단이 다 차 있다');
});
