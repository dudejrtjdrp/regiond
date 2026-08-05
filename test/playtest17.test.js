// §17-11 동료 상호작용 회귀 — 지시(이곳으로 보낸다·해제)와 꾸미기(이름·모양새)
//
// 피드백: "일부 NPC(동료 봇)가 가만히 있으며 상호작용과 지시가 되지 않음"
//       + "NPC 캐릭터 커스텀 설정 기능(이름, 모양새)이 필요함".
// 이 파일이 붙드는 문장은 셋이다.
//   ① commandCompanion 이 적은 자리로 동료가 실제로 걸어가고, arriveTiles 안에 닿으면
//      그 자리에서 **지시 대기(hold)** 로 서서 떠나지 않는다. 걷는 데 하루 예산은 쓰지 않는다.
//   ② order: null 이 지시를 걷고, 동료는 다시 스스로 일감을 찾는다.
//   ③ customizeCompanion 이 이름·모양새를 세 장부(동료·아바타·명부)에 같이 적고,
//      명부 규격(nameMaxLength)과 없는 동료를 물린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, dist } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { applyCommand } from '../server/engine/commands.js';
import { createRng } from '../server/engine/rng.js';
import { syncCompanionSeats, stepCompanions, companionViews } from '../server/engine/companions.js';

const data = loadGameData();
const SEED = 20260806;
const ARRIVE = data.companions.orders.arriveTiles;

function scene(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(null, nation, data, opts.chapter ?? 5);
  /* ★ §16-7b — 이 파일은 「사람이 이미 내려서 세상이 도는」 판을 잰다(playtest15c 와 같은 문). */
  (nation.companions ||= {}).awake = true;
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  syncCompanionSeats(world, nation, data);
  return { world, nation, t, rng: createRng(opts.seed ?? SEED) };
}

const firstCrew = (nation) => (nation.companions.list || []).find((c) => c.active);

// ────────────────────────────────────────────────────────────────
// ① 지시 — 적고, 걸어가고, 닿으면 지킨다
// ────────────────────────────────────────────────────────────────
test('★ §17-11 지시 — commandCompanion 이 자리를 적고, 다음 걸음부터 그리로 걸어간다', () => {
  const { world, nation, t, rng } = scene();
  const comp = firstCrew(nation);
  const px = t.x + 10;
  const py = t.y;
  const res = applyCommand(world, 'player', {
    type: 'commandCompanion', companionId: comp.id, order: { kind: 'move', x: px, y: py },
  }, data, rng);
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.deepEqual(comp.mem.order, { kind: 'move', x: px, y: py }, '지시가 mem.order 에 적혔다');
  assert.deepEqual(res.order, { kind: 'move', x: px, y: py }, 'ack 에도 같은 지시가 실린다');

  const av = nation.avatars[comp.id];
  const d0 = dist(av.x, av.y, px, py);
  stepCompanions(world, nation, data, 1);
  const d1 = dist(av.x, av.y, px, py);
  stepCompanions(world, nation, data, 1);
  const d2 = dist(av.x, av.y, px, py);
  assert.ok(d1 < d0, `한 걸음에 가까워진다 (${d0.toFixed(1)} → ${d1.toFixed(1)})`);
  assert.ok(d2 <= d1, `그다음 걸음도 물러서지 않는다 (${d1.toFixed(1)} → ${d2.toFixed(1)})`);
});

test('★ §17-11 도착 — arriveTiles 안에 닿으면 지시 대기(hold)로 서고, 그 자리를 떠나지 않는다', () => {
  const { world, nation, t, rng } = scene();
  const comp = firstCrew(nation);
  const px = t.x + 10;
  const py = t.y;
  applyCommand(world, 'player', {
    type: 'commandCompanion', companionId: comp.id, order: { kind: 'move', x: px, y: py },
  }, data, rng);

  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1);
  const av = nation.avatars[comp.id];
  assert.ok(dist(av.x, av.y, px, py) <= ARRIVE + 0.01,
    `지시 자리에 닿았다 (${dist(av.x, av.y, px, py).toFixed(2)} ≤ ${ARRIVE})`);
  assert.equal(comp.mem.state, 'hold', '명부가 「지시 대기」를 읽는다');
  /* 걷는 데는 하루 예산(credit)을 쓰지 않는다 — 예산은 스윙에만 매인다 */
  assert.equal(comp.mem.credit, data.companions.labor.burstMax, '지시 이동이 예산을 축내지 않았다');

  // 몇 십 초가 더 지나도 딴 데로 새지 않는다(경계·사냥·채집 갈래가 모두 물러난다)
  for (let i = 0; i < 60; i += 1) stepCompanions(world, nation, data, 1);
  assert.ok(dist(av.x, av.y, px, py) <= ARRIVE + 0.01, '한참 뒤에도 그 자리를 지킨다');
  assert.equal(comp.mem.state, 'hold', '여전히 지시 대기다');

  // 규약 — companionViews 에 외형과 지시가 함께 실린다(동료 패널의 재료)
  const v = companionViews(nation, data).find((x) => x.id === comp.id);
  assert.deepEqual(v.order, { kind: 'move', x: px, y: py }, '뷰에 지시가 실린다');
  assert.ok(v.appearance && Number.isInteger(v.appearance.skin), '뷰에 외형이 규격대로 실린다');
});

test('★ §17-11 해제 — order: null 이 지시를 걷고, 동료가 다시 제 일을 찾는다', () => {
  const { world, nation, t, rng } = scene();
  const comp = firstCrew(nation);
  applyCommand(world, 'player', {
    type: 'commandCompanion', companionId: comp.id, order: { kind: 'move', x: t.x + 10, y: t.y },
  }, data, rng);
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1);
  assert.equal(comp.mem.state, 'hold', '전제: 지시 자리에서 대기 중이다');

  const res = applyCommand(world, 'player', {
    type: 'commandCompanion', companionId: comp.id, order: null,
  }, data, rng);
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.equal(comp.mem.order, null, '지시가 걷혔다');
  assert.equal(res.order, null, 'ack 도 걷힌 것을 알린다');

  for (let i = 0; i < 10; i += 1) stepCompanions(world, nation, data, 1);
  assert.notEqual(comp.mem.state, 'hold', '지시 대기에서 풀려나 제 일감으로 돌아갔다');
  assert.notEqual(comp.mem.state, 'move', '지시받은 걸음도 남아 있지 않다');
});

// ────────────────────────────────────────────────────────────────
// ② 꾸미기 — 세 장부가 같은 사람을 가리킨다
// ────────────────────────────────────────────────────────────────
test('★ §17-11 꾸미기 — 이름·모양새가 동료·아바타·명부에 함께 적힌다', () => {
  const { world, nation, rng } = scene();
  const comp = firstCrew(nation);
  const res = applyCommand(world, 'player', {
    type: 'customizeCompanion', companionId: comp.id, name: '  바위  ', appearance: { skin: 2, hair: 3 },
  }, data, rng);
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.equal(res.name, '바위', 'ack 에 다듬어진(trim) 이름이 실린다');
  assert.equal(comp.name, '바위', '동료 명단의 이름이 바뀐다');
  assert.equal(nation.avatars[comp.id].name, '바위', '세상에 선 아바타의 이름표가 바뀐다');
  assert.equal(comp.appearance.skin, 2, '동료의 외형이 바뀐다');
  assert.equal(comp.appearance.hair, 3);
  assert.equal(nation.avatars[comp.id].appearance.skin, 2, '아바타의 외형도 함께 바뀐다');
  const member = (nation.members || []).find((m) => m.avatarId === comp.id);
  assert.ok(member, '명부에 그 사람이 있다');
  assert.equal(member.name, '바위', '명부의 이름도 바뀐다');
  assert.equal(member.appearance.skin, 2, '명부의 초상도 바뀐다');
  assert.equal(nation.players[comp.id].name, '바위', '솜씨 장부의 이름도 같은 사람이다');
});

test('★ §17-11 꾸미기 — 명부 규격(nameMaxLength)보다 긴 이름은 물린다', () => {
  const { world, nation, rng } = scene();
  const comp = firstCrew(nation);
  const before = comp.name;
  const max = data.world.appearance.nameMaxLength;
  const res = applyCommand(world, 'player', {
    type: 'customizeCompanion', companionId: comp.id, name: '가'.repeat(max + 1),
  }, data, rng);
  assert.equal(res.ok, false, '긴 이름은 받지 않는다');
  assert.equal(res.error.code, 'BAD_NAME');
  assert.equal(comp.name, before, '이름이 그대로다');

  const empty = applyCommand(world, 'player', {
    type: 'customizeCompanion', companionId: comp.id, name: '   ',
  }, data, rng);
  assert.equal(empty.ok, false, '빈 이름도 받지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ③ 검증 — 없는 동료 · 지도 밖
// ────────────────────────────────────────────────────────────────
test('★ §17-11 검증 — 없는 동료에게는 지시도 꾸미기도 안 된다', () => {
  const { world, rng } = scene();
  const a = applyCommand(world, 'player', {
    type: 'commandCompanion', companionId: 'bot~99', order: { kind: 'move', x: 5, y: 5 },
  }, data, rng);
  assert.equal(a.ok, false);
  assert.equal(a.error.code, 'NO_COMPANION');
  const b = applyCommand(world, 'player', {
    type: 'customizeCompanion', companionId: 'bot~99', name: '유령',
  }, data, rng);
  assert.equal(b.ok, false);
  assert.equal(b.error.code, 'NO_COMPANION');
});

test('★ §17-11 검증 — 지도 밖 자리는 물린다', () => {
  const { world, nation, rng } = scene();
  const comp = firstCrew(nation);
  const res = applyCommand(world, 'player', {
    type: 'commandCompanion', companionId: comp.id, order: { kind: 'move', x: -3, y: 5 },
  }, data, rng);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'BAD_POSITION');
  assert.equal(comp.mem.order ?? null, null, '잘못된 지시는 적히지 않는다');
});
