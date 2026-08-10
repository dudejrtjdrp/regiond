// ★ 3단계A 탐험 저널 회귀 — docs/전면개편_분석_작업계획.md B10 「저널 축적」
//
// 이 파일이 지키는 문장은 다섯이다.
//   ① 단서가 나오면 **도감에 한 줄이 남는다**(문장·방위·땅·신전 여부·날).
//   ② 장부는 40줄에서 멎는다 — 오래된 것부터 버린다(세이브가 끝없이 불어나지 않는다).
//   ③ 그 자리에 닿으면(방을 열거나 신전 문 앞에 서면) 그 줄이 「닿았다」로 바뀐다.
//   ④ 뷰에는 **가리킨 자취의 id 도 좌표도 실리지 않는다** — 마커 금지(clues.js 규율 ①).
//   ⑤ 사슬을 밟으면 「밟아 온 길」이 이름과 걸음 수로 남는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { actionSwing } from '../server/engine/actions.js';
import { dropClue } from '../server/engine/clues.js';
import { recordClue, markClueTarget, codexView } from '../server/engine/codex.js';
import { townOf, applyRuinSpec, ruinSpecOf } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { trailsOf, trailDef } from '../server/engine/trails.js';

const data = loadGameData();

function scene(seed = 2301) {
  const world = createWorld({ seed, data, playerName: '개척자' });
  const nation = world.nations.player;
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  /* 지도가 낳은 자취를 걷어 낸다 — 단서가 **내가 세운** 자취를 가리키게 해야 겨냥을 검사할 수 있다
     (playtest22c 와 같은 손질). */
  world.map.nodes = (world.map.nodes || []).filter((n) => n.type !== 'ruin');
  return { world, nation, town: t, rng: createRng(seed) };
}

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

// ────────────────────────────────────────────────────────────────
// ① · ④ 단서 한 줄이 남고, 좌표는 안 남는다
// ────────────────────────────────────────────────────────────────
test('★ 3단계A ① 단서가 나오면 도감 장부에 한 줄이 쌓인다', () => {
  const s = scene();
  const cfg = data.ruins.clue;
  const here = putRuin(s, 'rHere', 2, 0);
  putRuin(s, 'rFar', 0, -(cfg.minDistance + 10));

  const out = dropClue(s.world, s.nation, data, here);
  assert.ok(out, '단서가 나왔다');
  assert.equal(s.nation.clueLog.length, 1, '장부에 한 줄');
  const row = s.nation.clueLog[0];
  assert.equal(row.line, out.text, '적힌 문장은 카드가 보여 준 그 문장이다');
  assert.equal(row.fromNodeId, here.id);
  assert.equal(row.targetNodeId, 'rFar', '어디를 가리켰는지는 서버가 안다');
  assert.equal(row.targetSeen, false, '아직 닿지 않았다');
  assert.equal(row.dir, out.dir);
  assert.equal(row.land, out.land);
});

test('★ 3단계A ④ 도감 뷰에는 가리킨 자취의 id 도 좌표도 실리지 않는다 (마커 금지)', () => {
  const s = scene();
  const cfg = data.ruins.clue;
  const here = putRuin(s, 'rHere', 2, 0);
  const far = putRuin(s, 'rFar', 0, -(cfg.minDistance + 10));
  dropClue(s.world, s.nation, data, here);

  const view = codexView(s.nation, data, s.world);
  assert.equal(view.clues.length, 1);
  assert.deepEqual(Object.keys(view.clues[0]).sort(),
    ['dir', 'fromName', 'fromNodeId', 'land', 'targetSeen', 'temple', 'tick', 'line'].sort());
  const blob = JSON.stringify(view.clues);
  assert.ok(!blob.includes(`"${far.id}"`), '가리킨 자취의 id 가 새 나가면 안 된다');
  assert.ok(!blob.includes(`${far.x},${far.y}`), '좌표가 새 나가면 안 된다');
  assert.equal(view.totals.cluesOpen, 1, '아직 못 찾은 단서 하나');
});

// ────────────────────────────────────────────────────────────────
// ② 상한 40 — 오래된 것부터 버린다
// ────────────────────────────────────────────────────────────────
test('★ 3단계A ② 장부는 40줄에서 멎고 오래된 줄부터 버린다', () => {
  const s = scene();
  for (let i = 0; i < 45; i += 1) {
    recordClue(s.nation, { fromNodeId: `r${i}`, line: `${i}번째 줄`, targetNodeId: `t${i}`, tick: i });
  }
  assert.equal(s.nation.clueLog.length, 40, '상한 40');
  assert.equal(s.nation.clueLog[0].line, '5번째 줄', '앞의 다섯은 밀려 나갔다');
  assert.equal(s.nation.clueLog[39].line, '44번째 줄', '가장 새것이 끝에 있다');
});

// ────────────────────────────────────────────────────────────────
// ③ 닿으면 표시가 바뀐다 — 실제 스윙으로 방을 연다
// ────────────────────────────────────────────────────────────────
test('★ 3단계A ③ 가리킨 자취의 방을 열면 그 단서가 「닿았다」가 된다', () => {
  const s = scene();
  const cfg = data.ruins.clue;
  const here = putRuin(s, 'rHere', 2, 0);
  const far = putRuin(s, 'rFar', 0, -(cfg.minDistance + 10));
  dropClue(s.world, s.nation, data, here);
  assert.equal(s.nation.clueLog[0].targetSeen, false);

  /* 그 자취 앞으로 걸어가 방 하나가 열릴 때까지 두드린다 — 쿨타임을 넘기려 시계를 넉넉히 민다. */
  s.nation.avatars.lord.x = far.x;
  s.nation.avatars.lord.y = far.y;
  let clock = 1e6;
  for (let i = 0; i < 40 && !far.roomsOpened; i += 1) {
    clock += 60_000;
    actionSwing(s.world, s.nation, { nodeId: far.id, avatarId: 'lord' }, data, clock);
  }
  assert.ok(far.roomsOpened > 0, '방이 열렸다');
  assert.equal(s.nation.clueLog[0].targetSeen, true, '단서가 닫혔다');

  const view = codexView(s.nation, data, s.world);
  assert.equal(view.totals.cluesOpen, 0, '남은 단서가 없다');
  assert.equal(view.clues[0].targetSeen, true);
});

test('★ 3단계A ③-b markClueTarget 은 엉뚱한 자리에는 반응하지 않는다', () => {
  const s = scene();
  recordClue(s.nation, { fromNodeId: 'a', line: '북쪽 눈밭', targetNodeId: 'want', tick: 1 });
  assert.equal(markClueTarget(s.nation, 'other', 2), 0, '다른 자리는 세지 않는다');
  assert.equal(s.nation.clueLog[0].targetSeen, false);
  assert.equal(markClueTarget(s.nation, 'want', 3), 1);
  assert.equal(s.nation.clueLog[0].targetSeen, true);
  assert.equal(markClueTarget(s.nation, 'want', 4), 0, '두 번 닫히지 않는다');
});

test('★ 3단계A ③-c 장부는 저장했다 열어도 그대로다 (세이브 왕복)', () => {
  const s = scene();
  const cfg = data.ruins.clue;
  const here = putRuin(s, 'rHere', 2, 0);
  putRuin(s, 'rFar', 0, -(cfg.minDistance + 10));
  dropClue(s.world, s.nation, data, here);
  s.nation.trailLog = { first_tracks: { name: '첫 발자국', step: 2, steps: 3, done: false, lastTick: 3 } };

  /* 세이브는 JSON 한 벌이다 — 장부가 평범한 배열·객체여야 한 바퀴 돌고 와도 같다. */
  const back = JSON.parse(JSON.stringify(s.nation));
  assert.deepEqual(back.clueLog, s.nation.clueLog, '단서 장부가 갈렸다');
  assert.deepEqual(back.trailLog, s.nation.trailLog, '길 장부가 갈렸다');
  assert.deepEqual(codexView(back, data, s.world).clues, codexView(s.nation, data, s.world).clues);
  assert.deepEqual(codexView(back, data, s.world).trails, codexView(s.nation, data, s.world).trails);
});

// ────────────────────────────────────────────────────────────────
// ⑤ 밟아 온 길 — 사슬 진행이 남는다
// ────────────────────────────────────────────────────────────────
test('★ 3단계A ⑤ 사슬을 조사하면 「밟아 온 길」에 이름과 걸음이 남는다', () => {
  const s = scene();
  const tr = trailsOf(s.world).find((t) => t.kind === 'chain' && !t.hidden && t.step === 0);
  assert.ok(tr, '앞마당에 사슬의 첫 걸음이 있다');
  s.nation.avatars.lord.x = tr.x;
  s.nation.avatars.lord.y = tr.y;
  const res = applyCommand(s.world, 'player',
    { type: 'investigateTrail', trailId: tr.id, avatarId: 'lord' }, data, s.rng);
  assert.equal(res.ok, true, JSON.stringify(res.error ?? {}));
  /* 선택지가 있는 첫 걸음이면 아직 끝난 것이 아니다 — 그때는 고르고 나서야 한 걸음이 된다. */
  if (res.pending) {
    const def = trailDef(data, tr) ?? {};
    const key = (def.choices || [])[0]?.key;
    assert.ok(key, '선택지가 있는데 열쇠가 없다');
    applyCommand(s.world, 'player',
      { type: 'investigateTrail', trailId: tr.id, avatarId: 'lord', choice: key }, data, s.rng);
  }
  const rec = s.nation.trailLog?.[tr.chainId];
  assert.ok(rec, '사슬 기록이 남았다');
  assert.ok(rec.name && rec.name.length > 0, '사슬 이름이 적힌다');
  assert.equal(rec.step, 1, '한 걸음');
  assert.ok(rec.steps >= 1, '몇 걸음짜리인지 함께 적힌다');
  assert.equal(rec.done, false, '아직 끝이 아니다');

  const view = codexView(s.nation, data, s.world);
  const row = (view.trails || []).find((x) => x.key === tr.chainId);
  assert.ok(row, '도감 뷰에 실린다');
  assert.equal(row.step, 1);
  assert.equal(view.totals.trailsWalked, 1);
});
