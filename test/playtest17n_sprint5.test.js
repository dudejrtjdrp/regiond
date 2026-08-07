// Sprint 5 — 대기의 앞: 상시 예고와 야영지 선제 타격. 이 파일이 붙드는 문장 여섯:
//   ① 카운트다운에 **사각지대가 없다** — 예고가 잡힌 첫날부터 남은 날이 보인다(성녀면 정확히)
//   ② 야영지는 예고와 함께 서고 **체력을 갖는다**(파워 × strike.hpPerPower)
//   ③ strikeCamp — 사거리 밖이면 거절, 곁에서 치면 깎이고 눈금이 오르고, 연달아 치면 쿨타임
//   ④ 부순 만큼 덜 온다 — 부분 파괴는 병력을 줄이고(최소 하나), 전량 파괴는 웨이브를 취소한다
//   ⑤ 결정론 — 같은 씨앗이면 경비의 종도 자리도 같다(월드·생태 난수를 축내지 않는 statRng)
//   ⑥ §19-E 의 앞당기기 계약은 한 톨도 상하지 않았다(test/playtest19e_qae.test.js 가 그대로 산다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { townOf } from '../server/engine/world.js';
import { applyCommand } from '../server/engine/commands.js';
import { openChapterForDebug, measure } from '../server/engine/progression.js';
import {
  updateWaveSchedule, waveView, ensureCamps, campViews, daysUntilWave, nextWaveSpec,
} from '../server/engine/waves.js';
import { startBattle } from '../server/engine/battle.js';

const data = loadGameData();
const W = data.waves;
const S = W.strike;

/** 7장(낯선 발자국)을 열고 웨이브 일정을 하나 잡아 둔 정착지 — playtest19e 의 chapter7 과 같은 자리 */
function chapter7(seed = 1701) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const rng = createRng(seed);
  openChapterForDebug(world, nation, data, 7);
  nation.progress.flags.traceFound = true;
  nation.progress.cleared.push('7:trace_found', '7:defense_ready');
  nation.progress.step = 2;
  nation.tier = 2;
  const t = townOf(world, nation.id);
  nation.avatars.lord = { id: 'lord', x: t.x, y: t.y };
  updateWaveSchedule(world, nation, data, rng);
  return { world, nation, rng };
}

/** 예고가 선 자리 — 야영지 하나를 세우고 아바타를 그 곁(또는 멀리)에 둔다 */
function withCamp(seed = 1701, { adjacent = true } = {}) {
  const s = chapter7(seed);
  const created = ensureCamps(s.world, s.nation, data);
  const camp = created[0] ?? (s.world.camps || [])[0];
  const av = s.nation.avatars.lord;
  if (adjacent) { av.x = camp.x + 1; av.y = camp.y; }
  return { ...s, camp };
}

const strike = (world, rng, cmd) => applyCommand(world, 'player', { type: 'strikeCamp', ...cmd }, data, rng);

// ────────────────────────────────────────────────────────────────
// ① 리드 상시화 — 기다림의 첫날부터 남은 날이 보인다
// ────────────────────────────────────────────────────────────────
test('Sprint5 ① 예고 리드는 대기 전체를 덮는다 — 다이얼이 사각지대를 남기지 않는다', () => {
  // 「사각지대 없음」은 곧 부등식 하나다: 예고 리드 ≥ 가장 긴 대기(첫 지연·간격 최대값)
  assert.ok(W.warn.hintLeadDays >= W.firstDelayDays, `hintLeadDays ${W.warn.hintLeadDays} ≥ firstDelayDays ${W.firstDelayDays}`);
  assert.ok(W.warn.hintLeadDays >= W.intervalDays[1], `hintLeadDays ${W.warn.hintLeadDays} ≥ 간격 최대 ${W.intervalDays[1]}`);
  assert.ok(W.warn.campLeadDays >= W.intervalDays[1], '야영지도 대기 내내 서 있다');
  // 성녀의 값어치는 그대로다 — 흐릿함(±jitter)의 차등이 남아 있어야 예언이 예언이다
  assert.ok(W.warn.withoutSaint.jitterDays > 0, '성녀가 없으면 날이 흐리다');
});

test('Sprint5 ① 대기 첫날부터 daysUntilMin 이 난다 — 성녀면 정확한 날짜', () => {
  const { world, nation } = chapter7(1711);
  assert.equal(daysUntilWave(world, nation), W.firstDelayDays, '갓 잡힌 일정은 가장 먼 자리다');

  const blind = waveView(world, nation, null, data, {});
  assert.equal(blind.unlocked, true);
  assert.equal(blind.precise, false, '성녀가 없으니 날은 흐리다');
  assert.notEqual(blind.daysUntilMin, null, '★ 사각지대 없음 — 첫날에도 카운트다운이 있다');
  assert.equal(blind.daysUntilMin, Math.max(0, W.firstDelayDays - W.warn.withoutSaint.jitterDays));
  assert.ok(blind.hint, '무언가 다가온다는 말도 함께 온다');

  nation.roles.saint.holder = 'npc';
  const seer = waveView(world, nation, null, data, {});
  assert.equal(seer.precise, true);
  assert.equal(seer.daysUntil, W.firstDelayDays, '성녀는 첫날부터 정확한 날짜를 준다');
  assert.equal(seer.arrivalTick, world.tick + W.firstDelayDays);
});

// ────────────────────────────────────────────────────────────────
// ② 야영지는 예고와 함께 서고 체력을 갖는다
// ────────────────────────────────────────────────────────────────
test('Sprint5 ② 야영지가 예고와 함께 서고 hp 를 갖는다', () => {
  const { world, nation } = chapter7(1721);
  const spec = nextWaveSpec(world, nation, data);
  const created = ensureCamps(world, nation, data);
  assert.equal(created.length, 1, '예고가 잡힌 그 날 바로 선다(대기 내내 그 자리에 있다)');
  const camp = created[0];
  assert.equal(camp.maxHp, Math.round(spec.power * S.hpPerPower));
  assert.equal(camp.hp, camp.maxHp, '갓 선 야영지는 성하다');
  // 체력은 정찰 전에도 보인다 — 「내가 때린 만큼」의 장부라 정보 비대칭 바깥이다
  const v = campViews(world, nation, null, data)[0];
  assert.equal(v.hp, camp.maxHp);
  assert.equal(v.maxHp, camp.maxHp);
  assert.equal(v.power, null, '파워·머릿수는 여전히 국방부의 몫이다');
  assert.equal(v.units, null);
  // 경비도 함께 선다 — 야영지 곁은 사나운 자리다
  const guards = nation.wild.creatures.filter((c) => c.camp === camp.id);
  assert.equal(guards.length, S.guards);
  assert.ok(guards.every((g) => g.sp === S.guardSpecies));
  assert.ok(guards.every((g) => data.creatures.defs[g.sp].kind === 'predator'), '지키는 것은 사나운 것이다');
});

// ────────────────────────────────────────────────────────────────
// ③ strikeCamp — 사거리 · 피해 · 쿨타임
// ────────────────────────────────────────────────────────────────
test('Sprint5 ③ 사거리 밖에서는 칠 수 없다 — 야영지 곁까지 걸어가야 한다', () => {
  const { world, rng, camp } = withCamp(1731, { adjacent: false });
  const res = strike(world, rng, { campId: camp.id, now: 1000 });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'OUT_OF_RANGE');
  assert.match(res.error.message, /걸어가야/);
  assert.equal(camp.hp, camp.maxHp, '거절당한 스윙은 아무것도 깎지 않는다');
});

test('Sprint5 ③ 곁에서 치면 깎이고 눈금이 오르며, 연달아 치면 쿨타임이 막는다', () => {
  const { world, nation, rng, camp } = withCamp(1732);
  const hp0 = camp.hp;
  const res = strike(world, rng, { campId: camp.id, now: 1000 });
  assert.equal(res.ok, true, JSON.stringify(res.error ?? {}));
  assert.ok(res.damage > 0, '검이 닿았다');
  assert.equal(res.hp, hp0 - res.damage);
  assert.equal(res.maxHp, camp.maxHp);
  assert.equal(res.destroyed, false);
  assert.equal(res.waveCancelled, false);
  assert.equal(res.xp, S.xpPerSwing, '야영지를 치는 손도 전투와 같은 눈금을 쓴다');
  assert.equal(nation.players.lord.skills.combat.xp, S.xpPerSwing);

  const again = strike(world, rng, { campId: camp.id, now: 1000 });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'COOLDOWN');
  assert.ok(again.error.waitMs > 0);
  assert.equal(camp.hp, hp0 - res.damage, '막힌 스윙은 한 번 더 깎지 않는다');

  // 쿨타임이 지나면 다시 닿는다
  const later = strike(world, rng, { campId: camp.id, now: 1000 + res.cooldownMs });
  assert.equal(later.ok, true);
  assert.equal(later.hp, hp0 - res.damage - later.damage);
});

test('Sprint5 ③ 칠 야영지가 없으면 NO_CAMP', () => {
  const { world, rng } = chapter7(1733);
  const res = strike(world, rng, { now: 1000 });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NO_CAMP');
});

// ────────────────────────────────────────────────────────────────
// ④ 부순 만큼 덜 온다
// ────────────────────────────────────────────────────────────────
test('Sprint5 ④ 부분 파괴 — 병력이 체력 비율만큼 줄어든다(최소 하나는 남는다)', () => {
  const { world, nation, camp } = withCamp(1741);
  const units0 = camp.units;
  camp.hp = camp.maxHp * 0.5;
  const expected = Math.max(1, units0 - Math.floor(0.5 * units0));
  startBattle(world, nation, data);
  assert.equal(nation.battle.total, expected, `${units0} 에서 ${expected} 로 줄어든다`);
  assert.ok(nation.battle.power < camp.power, '화면에 뜨는 파워도 같은 저울로 줄어든다');
});

test('Sprint5 ④ 성한 야영지는 아무것도 바꾸지 않는다 — 봇의 곡선이 흔들리지 않는 까닭', () => {
  const a = withCamp(1742);
  const b = withCamp(1742);
  startBattle(a.world, a.nation, data);
  // 야영지 자체를 지운 세상(옛 계약)과 견준다
  b.world.camps = [];
  startBattle(b.world, b.nation, data);
  assert.equal(a.nation.battle.total, b.nation.battle.total);
  assert.equal(a.nation.battle.power, b.nation.battle.power);
  assert.deepEqual(a.nation.battle.enemies.map((e) => [e.x, e.y, e.hp]),
    b.nation.battle.enemies.map((e) => [e.x, e.y, e.hp]), '적 하나하나의 자리와 몸까지 같다');
});

test('Sprint5 ④ 전량 파괴 — 웨이브가 취소되고 막아 낸 것으로 적힌다', () => {
  const { world, nation, rng, camp } = withCamp(1743);
  const units = camp.units;
  camp.hp = 1;                                    // 한 번이면 무너지는 자리까지 깎아 둔다
  const res = strike(world, rng, { campId: camp.id, now: 2000 });
  assert.equal(res.ok, true, JSON.stringify(res.error ?? {}));
  assert.equal(res.destroyed, true);
  assert.equal(res.waveCancelled, true);
  assert.equal(res.hp, 0);
  assert.ok(res.events.some((e) => e.kind === 'camp_destroyed'), 'camp_destroyed 가 나간다');

  assert.equal(nation.wave.index, 1, '다음 무리로 넘어간다');
  assert.equal(nation.wave.arrivalTick, null, '오기로 한 날이 지워진다');
  assert.equal(nation.wave.struckIndex, 0, '어느 무리를 먼저 쳤는지 남는다');
  const h = nation.wave.history.at(-1);
  assert.equal(h.won, true, '막아 낸 것으로 친다');
  assert.equal(h.struck, true);
  assert.equal(h.enemiesKilled, units);
  assert.equal(h.enemiesTotal, units);
  // 7장은 이 장부로 흐른다 — 잘한 사람이 갇히지 않는다
  assert.equal(measure(world, nation, { type: 'wavesHeld', count: 1 }, data).ok, true);
  assert.equal(measure(world, nation, { type: 'wavesFaced', count: 1 }, data).ok, true);
  // 야영지도 경비도 함께 걷힌다
  assert.equal((world.camps || []).filter((c) => c.waveIndex === 0).length, 0);
  assert.equal(nation.wild.creatures.filter((c) => c.camp === camp.id).length, 0, '지킬 것이 없으면 경비도 없다');
  assert.ok(world.chronicle.some((e) => e.data?.struck), '연대기에도 남는다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 결정론
// ────────────────────────────────────────────────────────────────
test('Sprint5 ⑤ 같은 씨앗이면 경비의 종도 자리도 같다 — statRng 는 세계 난수를 축내지 않는다', () => {
  const a = withCamp(1751);
  const b = withCamp(1751);
  const list = (s) => s.nation.wild.creatures
    .filter((c) => c.camp).map((c) => [c.id, c.sp, c.x, c.y]);
  assert.ok(list(a).length > 0);
  assert.deepEqual(list(a), list(b));
  assert.deepEqual([a.camp.x, a.camp.y, a.camp.maxHp], [b.camp.x, b.camp.y, b.camp.maxHp]);
  // 친 뒤에도 갈라지지 않는다 — 창발 값이 같은 자리에 머문다
  strike(a.world, a.rng, { campId: a.camp.id, now: 3000 });
  strike(b.world, b.rng, { campId: b.camp.id, now: 3000 });
  assert.equal(a.camp.hp, b.camp.hp);
  assert.deepEqual(list(a), list(b));
  assert.equal(a.world.rngState, b.world.rngState);
  assert.equal(a.nation.wild.rngState, b.nation.wild.rngState, '생태 난수도 한 톨 안 축났다');
});

// ────────────────────────────────────────────────────────────────
// ⑥ 장의 문
// ────────────────────────────────────────────────────────────────
test('Sprint5 ⑥ strikeCamp 는 7장의 문을 지난다 — 그 전에는 손이 닿지 않는다', () => {
  const world = createWorld({ seed: 1761, data, playerName: '테스트' });
  const rng = createRng(1761);
  const res = applyCommand(world, 'player', { type: 'strikeCamp', now: 1000 }, data, rng);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'CHAPTER_LOCKED');
});
