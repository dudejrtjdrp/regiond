// §15-C 동료 봇(= 각료) 회귀 — docs/GDD3.md §15-C · docs/PROTOCOL.md §0-S-6
//
// 이 파일이 붙드는 문장은 넷이다.
//   ① 국가 정원은 5인이고, 사람이 못 채운 자리는 동료가 채운다(사람이 오면 비켜 주고, 가면 돌아온다).
//   ② 동료는 주민이 아니라 **플레이어와 같은 아바타 실체**다 — 같은 명령 함수를 타고, 같은 곳간에 넣는다.
//   ③ 자리를 맡은 각료와 들에 서 있는 동료는 **같은 인물**이다.
//   ④ 자동 플레이는 내 아바타를 같은 두뇌가 몰되, 손이 닿으면 잠시 비켜 준다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { openChapterForDebug, measure, ensureProgress } from '../server/engine/progression.js';
import { townOf, territoryRadius, dist } from '../server/engine/world.js';
import { buildNationView } from '../server/engine/view.js';
import { applyCommand } from '../server/engine/commands.js';
import { createRng } from '../server/engine/rng.js';
import { completeStructure, startBuild, startDemolish } from '../server/engine/structures.js';
import { startBattle } from '../server/engine/battle.js';
import { ensurePlayer, playerMaxHp } from '../server/engine/skills.js';
import { stepEcology } from '../server/engine/ecology.js';
import { step } from '../server/engine/tick.js';
import {
  syncCompanionSeats, bindCompanionRoles, stepCompanions, stepCompanionsDay,
  companionViews, companionById, isCompanionId, humanAvatarCount,
  setAutoPlay, autoPlayActive, companionCfg,
} from '../server/engine/companions.js';

const data = loadGameData();
const SEED = 20260806;
const SEATS = data.companions.seats;

function settlement(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(null, nation, data, opts.chapter ?? 5);
  if (opts.tier) nation.tier = opts.tier;
  return { world, nation, t: townOf(world, 'player') };
}

/** 사람 하나가 붙는다 — 서버의 doJoin 이 하는 일 중 자리에 관한 것만 */
function joinHuman(world, nation, id) {
  const t = townOf(world, nation.id);
  ensurePlayer(nation, id, data, id);
  (nation.avatars ||= {})[id] = { id, name: id, x: t.x + 2, y: t.y + 2, tick: world.tick, appearance: {} };
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
  return nation.avatars[id];
}

function leaveHuman(world, nation, id) {
  delete nation.avatars[id];
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
}

const actives = (nation) => (nation.companions?.list || []).filter((c) => c.active);
const totalRes = (nation) => Object.values(nation.resources).reduce((a, b) => a + b, 0);

// ────────────────────────────────────────────────────────────────
// ① 정원 5인 · 심리스 교대
// ────────────────────────────────────────────────────────────────
test('★ §15-C-1 정원 — 혼자 시작하면 동료가 넷 선다(사람 자리 하나는 늘 비워 둔다)', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  assert.equal(actives(nation).length, SEATS - 1, `정원 ${SEATS} 중 사람 하나를 빼고 채운다`);
  for (const c of actives(nation)) {
    assert.ok(nation.avatars[c.id], `${c.name} 의 아바타가 세상에 있다`);
    assert.ok(nation.players[c.id], `${c.name} 의 솜씨 장부가 있다`);
    assert.equal(nation.players[c.id].bot, true, '장부에 동료라고 적힌다');
  }
});

test('★ §15-C-3 심리스 — 사람이 늘면 하나씩 비켜 주고, 나가면 돌아온다', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  assert.equal(actives(nation).length, SEATS - 1);

  /* 첫 사람은 **원래 비워 둔 자리**에 앉는다 — 정원 5 = 사람 1 + 동료 4 가 솔로의 모습이다. */
  joinHuman(world, nation, '친구1');
  assert.equal(humanAvatarCount(nation), 1, '사람은 하나로 센다');
  assert.equal(actives(nation).length, SEATS - 1, '주인의 자리는 늘 비워 두었던 자리다');

  joinHuman(world, nation, '친구2');
  assert.equal(actives(nation).length, SEATS - 2, '둘째 사람부터 동료가 하나씩 비켜난다');

  joinHuman(world, nation, '친구3');
  assert.equal(actives(nation).length, SEATS - 3, '셋이면 둘만 남는다');

  leaveHuman(world, nation, '친구3');
  leaveHuman(world, nation, '친구2');
  leaveHuman(world, nation, '친구1');
  assert.equal(actives(nation).length, SEATS - 1, '다 나가면 정원이 다시 찬다');
});

test('★ §15-C-3 비켜난 동료는 사라지지 않는다 — 이름도 솜씨도 그대로 돌아온다', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  const names = actives(nation).map((c) => c.name).join(',');
  const last = actives(nation)[actives(nation).length - 1];
  nation.players[last.id].skills.lumber.xp = 42;

  joinHuman(world, nation, '친구1');
  joinHuman(world, nation, '친구2');
  assert.ok(!nation.avatars[last.id], '비켜난 동료는 세상에서 물러난다');
  leaveHuman(world, nation, '친구2');
  leaveHuman(world, nation, '친구1');
  assert.equal(actives(nation).map((c) => c.name).join(','), names, '같은 사람들이 돌아온다');
  assert.equal(nation.players[last.id].skills.lumber.xp, 42, '쌓은 솜씨가 그대로다');
});

test('★ §15-C-1 동료는 저마다 다른 얼굴과 이름표 빛깔을 갖는다', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  const list = actives(nation);
  assert.equal(new Set(list.map((c) => c.name)).size, list.length, '이름이 겹치지 않는다');
  assert.equal(new Set(list.map((c) => c.color)).size, list.length, '이름표 빛깔이 겹치지 않는다');
  const looks = list.map((c) => JSON.stringify(c.appearance));
  assert.ok(new Set(looks).size > 1, '외형이 다 같지는 않다');
  for (const c of list) {
    for (const [field, spec] of Object.entries(data.world.appearance.fields)) {
      const v = c.appearance[field];
      assert.ok(Number.isInteger(v) && v >= 0 && v < spec.count, `${field} 가 규격 안이다`);
    }
  }
});

// ────────────────────────────────────────────────────────────────
// ② 실제로 일한다 — 사람과 같은 길로
// ────────────────────────────────────────────────────────────────
test('★ §15-C-2 동료가 실제로 걸어가 캔다 — 국고가 늘고 솜씨가 오른다', () => {
  const { world, nation } = settlement();
  syncCompanionSeats(world, nation, data);
  const before = totalRes(nation);
  const start = actives(nation).map((c) => ({ x: nation.avatars[c.id].x, y: nation.avatars[c.id].y }));

  let acts = 0;
  for (let i = 0; i < 600; i += 1) acts += stepCompanions(world, nation, data, 1).actions.length;

  assert.ok(acts > 0, `하루 동안 무언가를 했다 (${acts}번)`);
  assert.ok(totalRes(nation) > before, `국고가 늘었다 (${before.toFixed(1)} → ${totalRes(nation).toFixed(1)})`);
  const moved = actives(nation).filter((c, i) =>
    dist(nation.avatars[c.id].x, nation.avatars[c.id].y, start[i].x, start[i].y) > 1).length;
  assert.ok(moved > 0, '자리를 옮겨 다녔다(제자리에서 캐지 않는다)');
  const xp = actives(nation).reduce((n, c) =>
    n + Object.values(nation.players[c.id].skills).reduce((m, s) => m + s.xp, 0), 0);
  assert.ok(xp > 0, '휘두른 만큼 솜씨가 쌓인다');
});

test('★ §15-C-5 하루 예산 — 지켜본 만큼 일 틱이 덜 준다(한 사람의 노동을 두 번 세지 않는다)', () => {
  const budget = data.companions.labor.swingsPerDay;
  const daySec = data.balance.time.dayRealSeconds;

  // ㉮ 아무도 안 볼 때 — 일 틱이 하루치를 통째로 돌린다
  const a = settlement();
  syncCompanionSeats(a.world, a.nation, data);
  const idle = stepCompanionsDay(a.world, a.nation, data);
  assert.ok(idle.swings > 0, '방치해도 동료는 일한다');
  assert.ok(idle.swings <= budget * (SEATS - 1), '하루 예산을 넘기지 않는다');

  // ㉯ 반나절을 지켜봤다면 — 일 틱은 나머지 반나절만 준다
  const b = settlement();
  syncCompanionSeats(b.world, b.nation, data);
  for (let i = 0; i < daySec / 2; i += 1) stepCompanions(b.world, b.nation, data, 1);
  const rest = stepCompanionsDay(b.world, b.nation, data);
  assert.ok(rest.swings < idle.swings, `지켜본 만큼 줄어든다 (${idle.swings} → ${rest.swings})`);

  // ㉰ 하루를 통째로 지켜봤다면 — 일 틱은 아무것도 주지 않는다
  const c = settlement();
  syncCompanionSeats(c.world, c.nation, data);
  for (let i = 0; i < daySec; i += 1) stepCompanions(c.world, c.nation, data, 1);
  assert.equal(stepCompanionsDay(c.world, c.nation, data).swings, 0, '이미 다 일했다');
});

test('★ §15-C 사슬 — 동료의 팔은 「몇 번 휘둘렀나」를 채우지 않는다', () => {
  const { world, nation } = settlement({ chapter: 1 });
  syncCompanionSeats(world, nation, data);
  for (let i = 0; i < 900; i += 1) stepCompanions(world, nation, data, 1);

  const botSwings = actives(nation)
    .reduce((n, c) => n + (nation.players[c.id].stats.swingsBySkill.lumber || 0), 0);
  assert.ok(botSwings > 0, '동료는 실제로 나무를 벴다');
  assert.equal(measure(world, nation, { type: 'swings', skill: 'lumber', count: 3 }, data).have, 0,
    '그래도 「직접 해 보세요」는 사람이 해야 채워진다');

  // 반면 곳간을 채우는 조건은 함께 센다 — 창고는 나라 공용이기 때문이다
  assert.ok(measure(world, nation, { type: 'resource', resource: 'wood', amount: 1 }, data).have > 0,
    '동료가 넣은 목재는 나라의 목재다');
});

test('★ §15-C 공사 — 짓는 데는 손을 보태고, 헐고 옮기는 데는 손대지 않는다', () => {
  const { world, nation, t } = settlement({ chapter: 5, tier: 2 });
  syncCompanionSeats(world, nation, data);
  nation.resources.wood = 400;
  nation.resources.stone = 200;

  const built = startBuild(world, nation, { building: 'hut', x: t.x + 6, y: t.y + 6 }, data);
  assert.ok(built.ok, JSON.stringify(built.error));
  const site = nation.construction.find((c) => c.id === built.siteId);
  const remain0 = site.remaining;
  for (let i = 0; i < 900 && nation.construction.includes(site); i += 1) stepCompanions(world, nation, data, 1);
  assert.ok(site.remaining < remain0, `공사가 밀렸다 (${remain0} → ${site.remaining})`);

  // 헐기 — 동료는 거들떠보지도 않는다(마음이 바뀌면 되돌릴 수 있어야 한다)
  const hut = completeStructure(world, nation, { building: 'hut', tier: 1, x: t.x - 7, y: t.y - 7, placed: true }, data);
  const dm = startDemolish(world, nation, { structureId: hut.id }, data);
  assert.ok(dm.ok, JSON.stringify(dm.error));
  const dsite = nation.construction.find((c) => c.mode === 'demolish');
  const dRemain = dsite.remaining;
  for (let i = 0; i < 600; i += 1) stepCompanions(world, nation, data, 1);
  assert.equal(dsite.remaining, dRemain, '허무는 일에는 한 번도 손대지 않았다');
});

// ────────────────────────────────────────────────────────────────
// ③ 각료 통합
// ────────────────────────────────────────────────────────────────
test('★ §15-C-2 각료 = 동료 — 자리를 맡은 이름과 들에 선 이름이 같다', () => {
  const { world, nation } = settlement({ chapter: 7 });
  world.emotionDayDone = true;
  for (const [k, v] of Object.entries(npcAssignments(data))) nation.roles[k].holder = v;
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);

  const bound = data.roles.order.filter((k) => nation.roles[k].botId);
  assert.equal(bound.length, SEATS - 1, '동료 수만큼의 자리가 사람을 얻는다');
  for (const key of bound) {
    const comp = companionById(nation, nation.roles[key].botId);
    assert.ok(comp, '자리에 적힌 이가 실제로 있다');
    assert.equal(nation.roles[key].name, comp.name, '각료의 이름 = 동료의 이름');
    assert.equal(comp.role, key, '동료도 제 자리를 안다');
  }
  const left = data.roles.order.filter((k) => !nation.roles[k].botId);
  for (const key of left) assert.ok(nation.roles[key].name, '남는 자리도 이름은 있다(나라는 멎지 않는다)');
});

test('★ §15-C-2 사람이 자리를 고르면 그 자리의 동료가 비켜난다', () => {
  const { world, nation } = settlement({ chapter: 7 });
  world.emotionDayDone = true;
  for (const [k, v] of Object.entries(npcAssignments(data))) nation.roles[k].holder = v;
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
  const key = data.roles.order.find((k) => nation.roles[k].botId);
  const comp = companionById(nation, nation.roles[key].botId);

  const res = applyCommand(world, nation.id, { type: 'pickRole', role: key, avatarId: 'lord' }, data, createRng(1));
  assert.ok(res.ok, JSON.stringify(res.error));
  assert.equal(nation.roles[key].holder, 'player', '사람이 그 자리를 쥔다');
  assert.equal(nation.roles[key].botId ?? null, null, '동료는 그 자리에서 손을 뗀다');
  assert.notEqual(comp.role, key, '비켜난 동료는 그 자리를 더 이상 제 것이라 하지 않는다');
});

test('★ §15-C-2 자리마다 선호 행동 — 공장장은 대장간 곁에서 일한다', () => {
  const { world, nation, t } = settlement({ chapter: 9, tier: 3 });
  world.emotionDayDone = true;
  for (const [k, v] of Object.entries(npcAssignments(data))) nation.roles[k].holder = v;
  const R = territoryRadius(nation, data);
  completeStructure(world, nation, { building: 'smithy', tier: 1, x: t.x - R + 3, y: t.y, placed: true }, data);
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
  const factory = companionById(nation, nation.roles.factory.botId);
  assert.ok(factory, '공장장 자리를 맡은 동료가 있다');

  for (let i = 0; i < 600; i += 1) stepCompanions(world, nation, data, 1);
  const av = nation.avatars[factory.id];
  const smithy = nation.structures.find((s) => s.key === 'smithy');
  const others = actives(nation).filter((c) => c.id !== factory.id)
    .map((c) => dist(nation.avatars[c.id].x, nation.avatars[c.id].y, smithy.x, smithy.y));
  const mine = dist(av.x, av.y, smithy.x, smithy.y);
  assert.ok(mine <= Math.max(...others) , `공장장이 대장간에서 가장 멀지는 않다 (${mine.toFixed(1)})`);
});

// ────────────────────────────────────────────────────────────────
// ④ 싸움 · 쓰러짐 — 사람과 같은 규칙
// ────────────────────────────────────────────────────────────────
test('★ §15-C-2 웨이브 — 동료도 검을 든다(같은 combatSwing 규칙)', () => {
  const { world, nation, t } = settlement({ chapter: 7, tier: 3 });
  syncCompanionSeats(world, nation, data);
  const battle = startBattle(world, nation, data);
  assert.ok(battle, '웨이브가 섰다');
  const hp0 = battle.enemies.reduce((n, e) => n + e.hp, 0);
  // 동료를 적 앞으로 데려다 놓는다(걸어가는 데 드는 시간은 여기서 재지 않는다)
  const target = battle.enemies[0];
  for (const c of actives(nation)) {
    nation.avatars[c.id].x = target.x;
    nation.avatars[c.id].y = target.y;
  }
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1);
  const hp1 = battle.enemies.reduce((n, e) => n + e.hp, 0);
  assert.ok(hp1 < hp0, `동료가 적을 깎았다 (${hp0.toFixed(1)} → ${hp1.toFixed(1)})`);
  assert.ok(Object.keys(battle.playerDamage).some((id) => isCompanionId(nation, id)),
    '전투 장부에 동료의 몫이 적힌다');
});

test('★ §15-C-2 쓰러짐·부활 — 동료도 모닥불에서 일어난다(사람과 같은 문)', () => {
  const { world, nation, t } = settlement();
  syncCompanionSeats(world, nation, data);
  const comp = actives(nation)[0];
  const p = nation.players[comp.id];
  p.hp = 0;
  p.downUntil = data.skills.combat.downSeconds;
  nation.avatars[comp.id].x = t.x + 20;

  for (let i = 0; i < data.skills.combat.downSeconds + 1; i += 1) stepEcology(world, nation, data, 1);
  assert.equal(p.downUntil, 0, '다시 일어선다');
  assert.equal(p.hp, Math.round(playerMaxHp(p, data) * data.skills.combat.reviveHpRatio * 100) / 100,
    '체력 절반으로 일어난다');
  assert.equal(nation.avatars[comp.id].x, t.x, '모닥불 자리에서 일어난다');
});

test('★ §15-C 모닥불 곁의 쉼 — 다친 사람은 본부 옆에서 기운을 되찾는다', () => {
  const { world, nation, t } = settlement();
  const p = ensurePlayer(nation, 'lord', data, '개척자');
  (nation.avatars ||= {}).lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  p.hp = 10;
  stepEcology(world, nation, data, 5);
  assert.ok(p.hp > 10, `모닥불 곁에서 기운이 돈다 (10 → ${p.hp})`);

  const far = ensurePlayer(nation, '멀리', data, '멀리');
  nation.avatars['멀리'] = { id: '멀리', name: '멀리', x: t.x + 40, y: t.y, tick: 0, appearance: {} };
  far.hp = 10;
  stepEcology(world, nation, data, 5);
  assert.equal(far.hp, 10, '들 한복판에서는 저절로 낫지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 자동 플레이
// ────────────────────────────────────────────────────────────────
test('★ §15-C-4 자동 플레이 — 켜면 내 아바타가 스스로 움직인다', () => {
  const { world, nation, t } = settlement();
  syncCompanionSeats(world, nation, data);
  ensurePlayer(nation, 'lord', data, '개척자');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x + 2, y: t.y + 2, tick: 0, appearance: {} };
  const from = { x: nation.avatars.lord.x, y: nation.avatars.lord.y };

  // 꺼져 있으면 아무 일도 없다
  for (let i = 0; i < 30; i += 1) stepCompanions(world, nation, data, 1, { now: 1000 + i * 1000 });
  assert.equal(nation.avatars.lord.x, from.x, '끈 채로는 서버가 내 몸을 끌지 않는다');

  const on = applyCommand(world, nation.id, { type: 'setAutoPlay', enabled: true, avatarId: 'lord', now: 100000 },
    data, createRng(1));
  assert.ok(on.ok && on.autoPlay, '켜졌다');
  let now = 100000;
  for (let i = 0; i < 60; i += 1) { now += 1000; stepCompanions(world, nation, data, 1, { now }); }
  assert.ok(dist(nation.avatars.lord.x, nation.avatars.lord.y, from.x, from.y) > 1, '스스로 걸어 나갔다');
});

test('★ §15-C-4 손이 닿으면 30초 물러났다가 스스로 다시 잡는다', () => {
  const { world, nation, t } = settlement();
  ensurePlayer(nation, 'lord', data, '개척자');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x + 2, y: t.y + 2, tick: 0, appearance: {} };
  const sec = data.companions.autoPlay.suspendSeconds;
  let now = 500000;

  setAutoPlay(nation, 'lord', data, { enabled: true, now });
  assert.equal(autoPlayActive(nation.players.lord, now), true, '켠 직후에는 돈다');

  const s = setAutoPlay(nation, 'lord', data, { suspend: true, now });
  assert.equal(s.autoPlay, true, '끄는 것이 아니다 — 켠 채로 물러난다');
  assert.equal(autoPlayActive(nation.players.lord, now), false, '손이 닿은 동안에는 멎는다');

  const before = { x: nation.avatars.lord.x, y: nation.avatars.lord.y };
  for (let i = 0; i < sec - 2; i += 1) { now += 1000; stepCompanions(world, nation, data, 1, { now }); }
  assert.equal(nation.avatars.lord.x, before.x, '물러난 동안에는 몸을 끌지 않는다');

  now += 3000;
  assert.equal(autoPlayActive(nation.players.lord, now), true, `${sec}초가 지나면 스스로 다시 잡는다`);
});

test('★ §15-C-4 자동 — 손이 남으면 연구를 붙든다(장 사슬의 문은 그대로 지킨다)', () => {
  const { world, nation, t } = settlement({ chapter: 10, tier: 4 });
  syncCompanionSeats(world, nation, data);
  ensurePlayer(nation, 'lord', data, '개척자');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x + 2, y: t.y + 2, tick: 0, appearance: {} };
  // 첫 연구가 요구하는 것을 갖춰 둔다(값·선행 건물은 startResearch 가 스스로 판정한다)
  nation.gold = 99999;
  for (const r of data.resources.order) nation.resources[r] = 9999;
  const first = data.research.order[0];
  for (const key of (data.research.defs[first].requires?.buildings || [])) {
    completeStructure(world, nation, { building: key, tier: 1, x: t.x + 8, y: t.y + 8, placed: true }, data);
  }

  setAutoPlay(nation, 'lord', data, { enabled: true, now: 1000 });
  let now = 1000;
  for (let i = 0; i < 40; i += 1) { now += 1000; stepCompanions(world, nation, data, 1, { now }); }
  assert.ok(nation.research.active, '스스로 붙들 것을 붙들었다');
  assert.equal(nation.research.active.key, first, '연구표의 차례가 곧 우선순위다');

  // 끄면 다시 손대지 않는다
  const busy = nation.research.active.key;
  setAutoPlay(nation, 'lord', data, { enabled: false, now });
  for (let i = 0; i < 40; i += 1) { now += 1000; stepCompanions(world, nation, data, 1, { now }); }
  assert.equal(nation.research.active.key, busy, '이미 붙든 것을 바꾸지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ⑥ 규약 — 화면이 읽는 자리
// ────────────────────────────────────────────────────────────────
test('★ §15-C 규약 — avatars 에 동료 표시·빛깔·맡은 자리·지금 하는 일이 실린다', () => {
  const { world, nation } = settlement({ chapter: 7 });
  world.emotionDayDone = true;
  for (const [k, v] of Object.entries(npcAssignments(data))) nation.roles[k].holder = v;
  syncCompanionSeats(world, nation, data);
  bindCompanionRoles(nation, data);
  for (let i = 0; i < 10; i += 1) stepCompanions(world, nation, data, 1);

  ensurePlayer(nation, 'lord', data, '개척자');
  const view = buildNationView(world, 'player', null, data, { avatarId: 'lord' });
  const bots = view.nation.avatars.filter((a) => a.bot);
  assert.equal(bots.length, SEATS - 1, '동료가 아바타 채널에 그대로 실린다');
  for (const a of bots) {
    assert.ok(a.color, '이름표 빛깔이 온다');
    assert.ok(a.state, '지금 무엇을 하는지가 온다');
    assert.ok(a.appearance && Number.isInteger(a.appearance.skin), '외형이 규격대로 온다');
    assert.ok(a.roleName, '맡은 자리의 이름이 온다');
  }
  assert.equal(view.nation.companions.length, SEATS - 1, 'companions 요약도 함께 온다');
  assert.equal(view.nation.seats, SEATS, '정원이 몇인지도 알려 준다');
  assert.ok(view.you.autoPlay && view.you.autoPlay.on === false, '자동 플레이 상태가 you 아래에 온다');

  // 각료 표에서 그 사람을 찾아갈 수 있다
  const key = data.roles.order.find((k) => nation.roles[k].botId);
  assert.equal(view.nation.roles[key].botId, nation.roles[key].botId, '각료 카드가 동료를 가리킨다');
  assert.equal(view.nation.roles[key].npcName, companionById(nation, nation.roles[key].botId).name);
});

test('★ §15-C 세이브 — 동료 명단이 없던 옛 판도 다음 걸음에 정원을 채운다', () => {
  const { world, nation } = settlement();
  delete nation.companions;
  const out = stepCompanions(world, nation, data, 1);
  assert.equal(actives(nation).length, SEATS - 1, '없으면 없는 대로 열고 채운다');
  assert.ok(Array.isArray(out.actions), '한 걸음이 정상으로 돌아온다');
});

test('★ §15-C 일 틱 — 동료가 낀 하루도 그대로 돈다(사건 흐름이 깨지지 않는다)', () => {
  const { world, nation } = settlement({ chapter: 5 });
  const before = totalRes(nation);
  const rng = createRng(SEED);
  let w = world;
  for (let d = 0; d < 3; d += 1) w = step(w, [], rng, data).state;
  const after = totalRes(w.nations.player);
  assert.ok(after > before, `사흘 동안 곳간이 늘었다 (${before.toFixed(1)} → ${after.toFixed(1)})`);
  assert.equal(actives(w.nations.player).length, SEATS - 1, '사흘 뒤에도 정원은 그대로다');
});
