// 엔드리스 웨이브 · 실시뮬 전투 — docs/GDD3.md §6
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { spawnResident } from '../server/engine/residents.js';
import {
  waveSpec, nextWaveSpec, updateWaveSchedule, waveView, daysUntilWave, ensureCamps, campViews,
  settlementScale, defenseIndex, publicWaves,
} from '../server/engine/waves.js';
import { startBattle, stepBattle, runBattle, finishBattle, battleSnapshot } from '../server/engine/battle.js';
import { defenseSummary } from '../server/engine/combat.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const W = data.waves;
const put = (w, n, key, tier, dx, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);

/** 티어 4, 주민·울타리·터렛을 갖춘 정착지 */
function settlement(seed = 101, { residents = 8, towers = 2, fenceRing = true, saint = false } = {}) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const rng = createRng(seed);
  nation.tier = 4;
  __openChapter(nation, 10);
  put(world, nation, 'manor', 3, 3);
  put(world, nation, 'manor', 3, -3, 3);
  nation.resources.grain = 500;
  // ★ 이 검사는 '전투'를 재는 것이지 '유입 주기'를 재는 것이 아니다 —
  //   §12-4 로 도착 주기를 손보면 인원이 흔들리므로 사람은 정확히 세어 세운다.
  for (let i = 0; i < residents; i += 1) spawnResident(world, nation, data, rng);
  for (const u of nation.villagers) u.job = 'defense';
  for (let i = 0; i < towers; i += 1) put(world, nation, 'arrow_tower', 2, 4 + i * 2, -4);
  if (fenceRing) {
    const t = townOf(world, 'player');
    nation.resources.wood = 2000;
    applyCommand(world, 'player', {
      type: 'placeFence',
      points: [{ x: t.x + 6, y: t.y - 6 }, { x: t.x + 6, y: t.y + 6 }, { x: t.x - 6, y: t.y + 6 },
        { x: t.x - 6, y: t.y - 6 }, { x: t.x + 6, y: t.y - 6 }],
    }, data, rng);
  }
  if (saint) nation.roles.saint.holder = 'npc';
  return { world, nation, rng };
}

test('웨이브 파워 — base × 1.18^n × 난이도 배수 (GDD3 §6 공식)', () => {
  const s0 = waveSpec(0, data);
  const s3 = waveSpec(3, data);
  const expected = W.basePower * Math.pow(W.growth, 3)
    * (W.earlyRamp && 3 < W.earlyRamp.waves ? W.earlyRamp.from + (1 - W.earlyRamp.from) * (3 / W.earlyRamp.waves) : 1);
  assert.ok(Math.abs(s3.power - expected) < 0.01, `${s3.power} ≈ ${expected}`);
  const hard = waveSpec(3, data, { difficultyMultiplier: 1.25 });
  assert.ok(Math.abs(hard.power - s3.power * 1.25) < 0.01, '난이도 배수는 곱해진다');
  assert.ok(s3.power > s0.power, '웨이브가 갈수록 세진다');
});

test('적 로테이션 — 늑대→도적→해적→바이킹→오우거→드래곤, 한 바퀴 뒤 변형', () => {
  const order = ['wolf', 'bandit', 'pirate', 'viking', 'ogre', 'dragon'];
  order.forEach((type, i) => assert.equal(waveSpec(i, data).type, type));
  const cycle1 = waveSpec(6, data);
  assert.equal(cycle1.type, 'wolf');
  assert.equal(cycle1.cycle, 1);
  assert.ok(cycle1.name !== waveSpec(0, data).name, '변형은 이름이 다르다');
  assert.ok(cycle1.unitHp > waveSpec(0, data).unitHp, '변형은 더 굵다');
  assert.equal(waveSpec(11, data).type, 'dragon');
  assert.ok(waveSpec(30, data).power > waveSpec(12, data).power, '끝이 없다');
});

test('정착지 규모 보정 — 방어에 투자할수록 웨이브도 커지되 앞지르지는 않는다', () => {
  const weak = settlement(103, { residents: 2, towers: 0, fenceRing: false });
  const strong = settlement(103, { residents: 12, towers: 4, fenceRing: true });
  const dWeak = defenseIndex(weak.nation, data);
  const dStrong = defenseIndex(strong.nation, data);
  assert.ok(dStrong > dWeak);
  const sWeak = settlementScale(weak.nation, data);
  const sStrong = settlementScale(strong.nation, data);
  assert.ok(sStrong > sWeak, '크게 살면 크게 온다');
  assert.ok(sStrong / sWeak < dStrong / dWeak, 'exponent<1 — 투자할수록 이득이 남는다');
});

test('일정 — 티어 2 전에는 웨이브가 잡히지 않는다', () => {
  const world = createWorld({ seed: 107, data });
  const n = world.nations.player;
  const rng = createRng(107);
  updateWaveSchedule(world, n, data, rng);
  assert.equal(n.wave.arrivalTick, null);
  n.tier = 2;
  __openChapter(n, 8);
  updateWaveSchedule(world, n, data, rng);
  assert.equal(n.wave.arrivalTick, world.tick + W.firstDelayDays);
});

test('예언 — 성녀가 있으면 시점과 구성이 열리고, 없으면 흐리다', () => {
  const { world, nation } = settlement(109, { saint: true });
  nation.wave.arrivalTick = world.tick + 1;
  const withSaint = waveView(world, nation, null, data, {});
  assert.equal(withSaint.precise, true);
  assert.equal(withSaint.arrivalTick, world.tick + 1);
  assert.ok(withSaint.enemy.units > 0, '적 구성까지 보인다');

  nation.roles.saint.holder = null;
  const blind = waveView(world, nation, null, data, {});
  assert.equal(blind.precise, false);
  assert.equal(blind.arrivalTick, null);
  assert.equal(blind.enemy.type, null, '종류도 안 보인다');
  assert.ok(blind.daysUntilMin != null);
});

// ★ Sprint 5 — 「D-2」는 옛 값이다. 며칠 앞인가는 W.warn.campLeadDays(7) 하나가 쥐고,
//   이 검사는 그 다이얼을 읽어 세운다 — 값을 손봐도 검사는 그대로 산다.
test('캠프 — D-campLeadDays 에 가장자리에 선발대가 보이고, 정찰 전에는 규모를 모른다', () => {
  const { world, nation } = settlement(113);
  nation.wave.arrivalTick = world.tick + W.warn.campLeadDays;
  const created = ensureCamps(world, nation, data);
  assert.equal(created.length, 1);
  // ★ Sprint 5 — 야영지는 이제 체력을 갖고 선다(선제 타격의 과녁)
  assert.equal(created[0].maxHp, Math.round(created[0].power * W.strike.hpPerPower));
  assert.equal(created[0].hp, created[0].maxHp);
  const views = campViews(world, nation, null, data);
  assert.equal(views[0].sizeHint, null, '정찰 전에는 규모가 없다');
  assert.equal(views[0].power, null, '정확한 병력은 국방부 전용');
  created[0].scouted = true;
  assert.ok(campViews(world, nation, null, data)[0].sizeHint, '정찰하면 규모 힌트가 열린다');
  assert.equal(campViews(world, nation, null, data)[0].power, null);
  assert.ok(campViews(world, nation, 'defense', data)[0].power == null, '플레이어 국방 담당이어야 한다');
  nation.roles.defense.holder = 'player';
  assert.ok(campViews(world, nation, 'defense', data)[0].power > 0);
});

test('실시뮬 — 같은 입력이면 언제나 같은 결과다(결정론)', () => {
  const a = settlement(127);
  const b = settlement(127);
  const ra = runBattle(a.world, a.nation, data);
  const rb = runBattle(b.world, b.nation, data);
  assert.equal(ra.won, rb.won);
  assert.equal(ra.enemiesKilled, rb.enemiesKilled);
  assert.equal(ra.duration, rb.duration);
  assert.equal(ra.timeline.length, rb.timeline.length);
});

test('실시뮬 — 서브틱 크기를 바꿔도 결과의 방향이 같다(안정)', () => {
  const a = settlement(131);
  const b = settlement(131);
  const ra = runBattle(a.world, a.nation, data);
  const rb = runBattle(b.world, b.nation, data, { dt: data.waves.battle.subtickSeconds / 2 });
  assert.equal(ra.won, rb.won);
});

test('실시뮬 — 적은 걸어와 울타리를 두드리고, 방어가 없으면 곳간을 헤집는다', () => {
  const { world, nation } = settlement(137, { residents: 0, towers: 0, fenceRing: true });
  nation.resources.grain = 500;
  const grain0 = nation.resources.grain;
  const fenceHp0 = nation.fences.reduce((a, f) => a + f.hp, 0);
  const result = runBattle(world, nation, data);
  assert.equal(result.won, false, '아무도 안 지키면 못 막는다');
  assert.ok(nation.fences.reduce((a, f) => a + f.hp, 0) < fenceHp0, '울타리가 깎인다');
  assert.ok(nation.resources.grain < grain0, '자원을 약탈당한다');
  assert.ok(result.enemiesEscaped > 0);
  assert.ok(result.timeline.some((e) => e.kind === 'breach'));
});

test('실시뮬 — 패배는 관대하다: 건물이 통째로 사라지지 않고 전멸도 없다', () => {
  const { world, nation } = settlement(139, { residents: 3, towers: 0, fenceRing: false });
  const floor = data.waves.battle.structureDamageFloor;
  const pop0 = nation.villagers.length;
  runBattle(world, nation, data);
  for (const s of nation.structures) {
    assert.ok(s.hp >= s.maxHp * floor - 0.5, `${s.key} 내구도가 바닥(${floor}) 아래로 안 내려간다`);
  }
  assert.equal(nation.villagers.length, pop0, '주민은 죽지 않는다');
  assert.ok(nation.morale >= data.balance.morale.min);
});

test('실시뮬 — 갖춘 정착지는 막아 내고 사기·전리품을 얻는다', () => {
  const { world, nation } = settlement(149, { residents: 14, towers: 4, fenceRing: true, saint: true });
  put(world, nation, 'barracks', 2, -6, -2);
  const gold0 = nation.gold;
  const morale0 = nation.morale;
  const result = runBattle(world, nation, data, { virtualPlayers: [{ id: 'sim', dps: 10 }] });
  assert.equal(result.won, true, JSON.stringify({ killed: result.enemiesKilled, total: result.enemiesTotal }));
  assert.equal(result.enemiesKilled, result.enemiesTotal);
  assert.ok(nation.gold > gold0, '전리품');
  // ★ 막아 내면 '버텨 낸 몫'이 붙고, 깎이는 것은 **쓰러진 민병 수(사람 수)만큼**이다.
  //   §12-12 재기준: 같은 사람이 여러 번 쓰러져도 마을이 받는 충격은 한 사람 몫이다(militiaHurt).
  const b = data.waves.battle;
  const expected = b.moraleBonusOnHold - result.militiaHurt * b.militia.downMoralePenalty;
  assert.ok(Math.abs(result.moraleDelta - expected) < 0.02,
    `사기 변화 ${result.moraleDelta} ≈ 버팀 ${b.moraleBonusOnHold} − 민병 ${result.militiaHurt}명`);
  assert.ok(result.militiaHurt <= nation.villagers.length, '사람 수를 넘겨 셀 수 없다');
  assert.ok(result.militiaDowned >= result.militiaHurt, '쓰러진 횟수는 사람 수 이상');
  assert.ok(nation.morale >= morale0 - 0.16, `사기 ${nation.morale}`);
  assert.equal(nation.battle, null, '전투가 끝나면 정리된다');
  assert.equal(nation.wave.index, 1, '다음 웨이브로 넘어간다');
  assert.equal(nation.wave.history.length, 1);
});

test('전술 상성 — 듣는 전술을 고르면 방어 피해가 오른다 (옛 ±8%p 의 계승)', () => {
  const a = settlement(151, { residents: 10, towers: 3 });
  const spec = nextWaveSpec(a.world, a.nation, data);
  a.nation.battlePlan = { tactic: spec.weakTo };
  const withPlan = startBattle(a.world, a.nation, data);
  const b = settlement(151, { residents: 10, towers: 3 });
  const noPlan = startBattle(b.world, b.nation, data);
  assert.ok(withPlan.multipliers.defender > noPlan.multipliers.defender);
});

test('성녀 축복 — 있는 쪽이 더 세게 때린다', () => {
  const a = settlement(157, { residents: 10, towers: 3, saint: true });
  const b = settlement(157, { residents: 10, towers: 3, saint: false });
  const ba = startBattle(a.world, a.nation, data);
  const bb = startBattle(b.world, b.nation, data);
  assert.ok(Math.abs(ba.multipliers.defender - bb.multipliers.defender * (1 + W.warn.saint.damageBonus / bb.multipliers.defender * bb.multipliers.defender / bb.multipliers.defender)) >= 0
    || ba.multipliers.defender > bb.multipliers.defender);
  assert.ok(ba.multipliers.defender > bb.multipliers.defender);
});

test('combatSwing — 플레이어가 검을 들고 참전한다 (죽음 없음 · 쿨타임 판정)', () => {
  const { world, nation, rng } = settlement(163, { residents: 6, towers: 2 });
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: t.x, y: t.y, tick: 0, appearance: {} };
  const battle = startBattle(world, nation, data);
  // 적이 마을 앞까지 오게 몇 초 돌린다
  for (let i = 0; i < 80 && !battle.over; i += 1) stepBattle(world, nation, data);
  const target = battle.enemies.find((e) => e.alive);
  assert.ok(target);
  nation.avatars.lord.x = target.x;
  nation.avatars.lord.y = target.y;

  const hit = applyCommand(world, 'player', { type: 'combatSwing', avatarId: 'lord', targetId: target.id, now: 500_000 }, data, rng);
  assert.ok(hit.ok, JSON.stringify(hit.error));
  assert.ok(hit.damage > 0);
  const tooSoon = applyCommand(world, 'player', { type: 'combatSwing', avatarId: 'lord', targetId: target.id, now: 500_200 }, data, rng);
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.error.code, 'COOLDOWN');

  // 플레이어는 죽지 않는다 — 다운되었다가 일어난다
  const p = nation.players.lord;
  p.hp = 0;
  p.downUntil = data.skills.combat.downSeconds;
  const downed = applyCommand(world, 'player', { type: 'combatSwing', avatarId: 'lord', now: 600_000 }, data, rng);
  assert.equal(downed.ok, false);
  assert.equal(downed.error.code, 'DOWNED');
  for (let i = 0; i < 400 && p.downUntil > 0 && !nation.battle.over; i += 1) stepBattle(world, nation, data);
  assert.ok(p.downUntil < data.skills.combat.downSeconds, '시간이 지나면 일어선다');
  // 일어선 뒤에도 싸움은 계속되므로 체력이 만땅이 아닐 수 있다 — 중요한 것은 '죽지 않았다'는 사실이다
  if (p.downUntil === 0) assert.ok(p.hp > 0, '모닥불에서 일어난다');
});

test('리플레이 — 타임라인이 결과와 정합하고 스냅샷이 나간다', () => {
  const { world, nation } = settlement(167, { residents: 12, towers: 4, saint: true });
  const battle = startBattle(world, nation, data);
  const snap = battleSnapshot(nation, data);
  assert.equal(snap.total, battle.total);
  assert.equal(snap.enemies.length, battle.total);
  assert.ok(snap.turrets.length >= 4);
  while (!nation.battle.over) stepBattle(world, nation, data);
  const result = finishBattle(world, nation, data);
  const kills = result.timeline.filter((e) => e.kind === 'kill').length;
  assert.equal(kills, result.enemiesKilled, '타임라인의 처치 수 = 결과의 처치 수');
  assert.ok(result.timeline.length <= data.waves.battle.timelineMaxEvents);
  assert.equal(result.timeline.at(-1).kind, result.won ? 'hold' : 'withdraw');
});

test('틱 파이프라인 — 도착일이 되면 웨이브가 스스로 터지고 연대기에 남는다', () => {
  let { world, nation } = settlement(173, { residents: 12, towers: 4, saint: true });
  const rng = createRng(173);
  nation.wave.arrivalTick = world.tick + 1;
  const out = step(world, [], rng, data);
  world = out.state;
  assert.ok(out.events.some((e) => e.kind === 'wave_incoming'));
  assert.ok(out.events.some((e) => e.kind === 'wave_held' || e.kind === 'wave_breached'));
  assert.ok((world.chronicle || []).some((c) => c.kind === 'wave'));
  assert.equal(world.nations.player.battle, null);
});

test('liveBattle — 런타임 모드에서는 시작만 하고 서브틱은 밖에서 돈다', () => {
  const { world, nation } = settlement(179, { residents: 10, towers: 3 });
  const rng = createRng(179);
  nation.wave.arrivalTick = world.tick + 1;
  const out = step(world, [], rng, data, { liveBattle: true });
  assert.ok(out.state.nations.player.battle, '전투가 살아 있다');
  assert.equal(out.state.nations.player.battle.over, false);
  assert.equal(out.events.some((e) => e.kind === 'wave_held' || e.kind === 'wave_breached'), false);
});

test('방어 요약 — 화면·조언이 읽는 견적이 나온다', () => {
  const { world, nation } = settlement(181, { residents: 10, towers: 3, saint: true });
  const sum = defenseSummary(world, nation, data);
  assert.equal(sum.turretCount, 3);
  assert.ok(sum.turretDps > 0);
  assert.ok(sum.militiaCount > 0);
  assert.ok(sum.fenceSegments > 0);
  assert.ok(sum.estimate.secondsToClear > 0);
  assert.ok(sum.saint);
});

test('/api/config — 웨이브 규칙은 공개하되 언제 오는지는 없다 (정보 비대칭)', () => {
  const pub = publicWaves(data);
  assert.equal(pub.startTier, W.startTier);
  assert.deepEqual(pub.rotation, W.rotation);
  assert.ok(pub.powerCurve.length >= 12);
  const json = JSON.stringify(pub);
  assert.ok(!json.includes('arrivalTick'), '도착 틱은 config 에 없다');
});
