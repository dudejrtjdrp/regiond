// §22-C 단서 사슬 회귀 — docs/유적개편기획.md §22-2 층3
//
// 고리가 닫혔는지를 붙든다: 흔적 → 유적 → (깊은 방 카드) → 단서 → 다음 유적의 안개.
// 이 파일이 지키는 문장은 여섯이다.
//   ① 깊은 방 카드의 「파헤친다」가 단서를 낸다 — 그리고 안개가 실제로 열린다.
//   ② 단서는 **좌표를 주지 않는다**. 결과에 실리는 것은 방위와 땅 이름뿐이다(마커 금지).
//   ③ 한 곳을 두 번 가리키지 않고, 이미 뒤진 자취도 가리키지 않는다.
//   ④ 가리킬 곳이 없으면 조용히 접힌다 — 빈손이어도 카드는 멀쩡히 끝난다.
//   ⑤ 단서는 월드 난수를 한 톨도 축내지 않는다.
//   ⑥ 사슬의 끝이 낳는 자취는 **방을 갖춘** 자취다(방 없는 자취는 스윙이 안 끝난다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { resolveRuinChoice } from '../server/engine/king.js';
import { dropClue } from '../server/engine/clues.js';
import { townOf, applyRuinSpec, ruinSpecOf } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';

const data = loadGameData();

function scene(seed = 2260) {
  const world = createWorld({ seed, data, playerName: '개척자' });
  const nation = world.nations.player;
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  /* 지도가 낳은 자취 198곳을 걷어 낸다 — 안 걷으면 단서가 **진짜 자취**를 가리켜
     「내가 세운 것을 가리켰는가」를 물을 수 없다. 여기서 보는 것은 고르기 규칙이다. */
  world.map.nodes = (world.map.nodes || []).filter((n) => n.type !== 'ruin');
  return { world, nation, town: t };
}

/** 자취 하나를 원하는 자리에 세운다 — 지도 뽑기에 기대지 않는다 */
function putRuin(s, id, dx, dy, extra = {}) {
  const node = {
    id, type: 'ruin', x: Math.round(s.town.x + dx), y: Math.round(s.town.y + dy),
    amount: 0, max: 0, swings: 0, roomsOpened: 0, ...extra,
  };
  applyRuinSpec(node, ruinSpecOf(data, extra.size ?? 2));
  Object.assign(node, extra);
  s.world.map.nodes.push(node);
  return node;
}

const ALWAYS = { chance: () => true, weighted: (e) => e[0].value, pick: (a) => a[0] };

// ────────────────────────────────────────────────────────────────
// ① · ② 단서가 나오고, 좌표는 안 나온다
// ────────────────────────────────────────────────────────────────

test('★ §22-C ① 깊은 방 카드가 단서를 내고 안개가 열린다', () => {
  const s = scene();
  const here = putRuin(s, 'rHere', 2, 0);
  const cfg = data.ruins.clue;
  putRuin(s, 'rFar', cfg.minDistance + 8, 0);     // 가리킬 만한 거리에 하나

  const decision = { ruin: { cardId: 'altar', nodeId: here.id, gradeBoost: 0 } };
  const r = resolveRuinChoice(s.world, s.nation, decision, 'dig', data, ALWAYS);
  assert.equal(r.ok, true);
  assert.ok(r.result.applied.includes('clue'), `단서가 안 나왔다: ${r.result.applied.join(' · ')}`);
  assert.ok(r.result.clue, '결과에 단서가 실린다');
  assert.ok(r.revealed.length > 0, '안개가 실제로 열렸다');
});

test('★ §22-C ② 단서는 좌표를 주지 않는다 (마커 금지)', () => {
  const s = scene();
  const here = putRuin(s, 'rHere', 2, 0);
  const cfg = data.ruins.clue;
  const far = putRuin(s, 'rFar', 0, -(cfg.minDistance + 10));

  const r = resolveRuinChoice(
    s.world, s.nation, { ruin: { cardId: 'altar', nodeId: here.id } }, 'dig', data, ALWAYS,
  );
  assert.deepEqual(Object.keys(r.result.clue).sort(), ['dir', 'land'], '방위와 땅뿐이다');
  const blob = JSON.stringify(r.result);
  assert.ok(!blob.includes(`"${far.id}"`), '가리킨 자취의 id 가 새 나가면 안 된다');
  assert.ok(!blob.includes(`${far.x},${far.y}`), '좌표가 새 나가면 안 된다');
  assert.equal(r.result.clue.dir, cfg.dirNames.n, '북쪽에 있으면 북쪽이라고 말한다');
});

// ────────────────────────────────────────────────────────────────
// ③ · ④ 고르는 규칙
// ────────────────────────────────────────────────────────────────

test('★ §22-C ③ 이미 가리킨 곳·이미 뒤진 곳은 다시 가리키지 않는다', () => {
  const s = scene();
  const cfg = data.ruins.clue;
  const here = putRuin(s, 'rHere', 0, 0);
  putRuin(s, 'rA', cfg.minDistance + 4, 0);
  putRuin(s, 'rB', 0, cfg.minDistance + 6);
  putRuin(s, 'rSpent', 0, -(cfg.minDistance + 6), { spent: true });
  putRuin(s, 'rTouched', -(cfg.minDistance + 6), 0, { roomsOpened: 1 });

  const first = dropClue(s.world, s.nation, data, here);
  const second = dropClue(s.world, s.nation, data, here);
  assert.ok(first, '첫 단서는 나온다');
  assert.equal(second, null, '가리킬 곳을 다 쓰면 조용히 접힌다');
  assert.equal(s.nation.clueSeen.length, 1, '한 자취가 가리키는 곳은 하나뿐이다');
  assert.ok(!s.nation.clueSeen.includes('rSpent'), '다 뒤진 자취는 가리키지 않는다');
  assert.ok(!s.nation.clueSeen.includes('rTouched'), '이미 손댄 자취는 가리키지 않는다');
});

test('★ §22-C ④ 가리킬 곳이 없어도 카드는 멀쩡히 끝난다', () => {
  const s = scene();
  const here = putRuin(s, 'rLonely', 1, 0);
  // 코앞의 자취뿐 — minDistance 안쪽은 이정표이지 단서가 아니다
  putRuin(s, 'rNear', 3, 0);
  const r = resolveRuinChoice(
    s.world, s.nation, { ruin: { cardId: 'altar', nodeId: here.id } }, 'dig', data, ALWAYS,
  );
  assert.equal(r.ok, true);
  assert.equal(r.result.clue, null);
  assert.ok(r.result.applied.includes('clue:none'));
  assert.ok(r.result.text.includes(data.ruins.clue.noneText), '빈손도 말로 알린다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 결정론
// ────────────────────────────────────────────────────────────────

test('★ §22-C ⑤ 단서는 월드 난수를 축내지 않고, 같은 자취는 같은 곳을 가리킨다', () => {
  const cfg = data.ruins.clue;
  const pick = (seed) => {
    const s = scene(seed);
    const here = putRuin(s, 'rHere', 0, 0);
    putRuin(s, 'rA', cfg.minDistance + 4, 0);
    putRuin(s, 'rB', 0, cfg.minDistance + 6);
    putRuin(s, 'rC', -(cfg.minDistance + 9), 0);
    dropClue(s.world, s.nation, data, here);
    return s.nation.clueSeen[0];
  };
  assert.equal(pick(2260), pick(2260), '같은 씨앗·같은 자취는 같은 곳을 가리킨다');

  const before = createRng(2260);
  const s = scene();
  s.world.rng = before;
  const here = putRuin(s, 'rHere', 0, 0);
  putRuin(s, 'rA', cfg.minDistance + 4, 0);
  dropClue(s.world, s.nation, data, here);
  const after = createRng(2260);
  assert.equal(before.int(0, 1e9), after.int(0, 1e9), '월드 난수 차례가 안 밀렸다');
});

// ────────────────────────────────────────────────────────────────
// ⑥ 반대 방향 — 사슬의 끝이 자취를 낳는다
// ────────────────────────────────────────────────────────────────

test('★ §22-C ⑥ 사슬이 낳는 자취는 방을 갖추고 태어난다', () => {
  const sized = [];
  for (const chain of data.trails.chains) {
    const rewards = [];
    for (const e of chain.endings || []) {
      if (e.reward) rewards.push(e.reward);
      for (const c of e.choices || []) if (c.reward) rewards.push(c.reward);
    }
    for (const r of rewards) {
      if (r.spawnNode?.type !== 'ruin') continue;
      sized.push(`${chain.id}`);
      const spec = ruinSpecOf(data, r.spawnNode.size ?? 2);
      assert.ok(spec, `${chain.id}: 크기표에 그 줄이 없다`);
      assert.ok(spec.rooms >= 1 && spec.roomSwings >= 1, `${chain.id}: 방 규격이 없다`);
      assert.ok(r.spawnNode.size, `${chain.id}: 자취를 낳으면서 크기를 안 적었다 — 한 방짜리로 내려앉는다`);
    }
  }
  assert.ok(sized.length >= 2, `사슬이 낳는 자취가 둘은 있어야 고리가 돈다 (${sized.length})`);

  // 실제로 입혀 보고 확인한다 — 규격만 맞고 코드가 안 부르면 소용없다
  const node = applyRuinSpec({ id: 'x', type: 'ruin', x: 5, y: 5 }, ruinSpecOf(data, 3));
  assert.equal(node.rooms, 3);
  assert.ok(node.swingsPerCycle >= 1);
});

test('★ §22-C 자료 온전성 — clue 표가 말이 되는가', () => {
  const cfg = data.ruins.clue;
  assert.ok(cfg, 'clue 표가 있다');
  assert.ok(cfg.minDistance > 0 && cfg.maxDistance > cfg.minDistance, '거리 띠가 말이 된다');
  assert.ok(cfg.revealRadius > 0, '열 안개가 있다');
  assert.ok((cfg.lines || []).length >= 3, '말이 여러 갈래다');
  for (const line of cfg.lines) {
    assert.ok(line.includes('{dir}') && line.includes('{land}'), `자리표가 빠졌다: ${line}`);
  }
  for (const key of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    assert.ok(cfg.dirNames[key], `방위 ${key} 가 없다`);
  }
  for (const code of data.world.terrain.codes) {
    assert.ok(cfg.landNames[code], `땅 이름이 없다: ${code}`);
  }
  // 단서를 내는 카드는 전부 깊은 방 풀에 있어야 한다 — 얕은 방이 단서를 내면 층2가 무너진다
  const deep = new Set(data.ruins.roomDepth.deep);
  for (const c of data.ruins.cards) {
    const hasClue = c.options.some((o) => (o.outcomes || []).some((x) => x.op === 'clue'));
    if (hasClue) assert.ok(deep.has(c.id), `${c.id} 는 얕은 방 카드인데 단서를 낸다`);
  }
});
