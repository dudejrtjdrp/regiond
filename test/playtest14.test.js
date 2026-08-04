// ★ GDD3 §14 (플레이테스트 피드백 3차) 계약 회귀 — docs/PROTOCOL.md §0-T
//   1) 주민 산출 즉시 반영 (사이클 크레딧 · 하루 합계 동일성 · 저장 상한)
//   4) 동물·야생 적 영토 진입 금지 + 목장
//   5) 플레이어 HP·XP·레벨·스탯
//   6) 다운·부활
//   7) 건설 탭 잠금 표시
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { disableCompanions } from '../server/engine/companions.js';
import { openChapterForDebug, buildingUnlockInfo } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { townOf, territoryRadius, inTerritory, dist } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import {
  spawnResident, residentGather, residentSettle, stepResidentWork, workCycleSeconds,
} from '../server/engine/residents.js';
import { applyCommand } from '../server/engine/commands.js';
import { round2 } from '../server/engine/economy.js';
import { storageLimit } from '../server/engine/storage.js';
import { buildNationView } from '../server/engine/view.js';
import {
  ensurePlayer, playerLevel, playerXpTotal, statPoints, allocStat, statEffects,
  swingCooldownMs, swingDamage, maxHpOf, playerProgressView,
} from '../server/engine/skills.js';
import { ensureCreatures, stepEcology, creatureDefs, ranchOpenFor } from '../server/engine/ecology.js';

const data = loadGameData();
/* ★ GDD3 §15-C — 이 파일은 **다른 한 계층**을 잰다(주민 산출·소비·공사 자재·전체 루프).
   동료는 같은 곳간에 손을 대므로 켜 두면 「주민이 낸 몫 = 국고 증가분」 같은 등식이 흐려진다.
   동료 계층 자체의 회귀는 test/playtest15.test.js 가 따로 잰다. */
disableCompanions(data);
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);
const put = (w, n, key, tier, dx, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);

/** 주민 전원을 같은 일에 붙인다 (playtest13 과 같은 방식 — 화면이 보는 목록에서 고른다) */
function postVillagers(w, n, job, rng) {
  const v = buildNationView(w, 'player', null, data, { avatarId: Object.keys(n.players)[0] });
  const t = v.nation.workPosts.find((p) => p.kind === 'node' && (p.jobs || []).includes(job));
  assert.ok(t, `${job} 일터가 있어야 한다`);
  const r = applyCommand(w, 'player', {
    type: 'commandVillagers', ids: n.villagers.map((u) => u.id),
    order: { type: 'work', nodeId: t.id, job },
  }, data, rng);
  assert.equal(r.ok, true, `배치 실패: ${JSON.stringify(r.error)}`);
  return t;
}

// ────────────────────────────────────────────────────────────────
// §14-1 주민 산출 즉시 반영
// ────────────────────────────────────────────────────────────────
test('§14-1 작업 사이클 하나가 끝나면 그 자리에서 국고가 오른다 (일 틱을 안 기다린다)', () => {
  const w = newWorld(41);
  const n = w.nations.player;
  const rng = createRng(41);
  __openChapter(n, 5);
  for (let i = 0; i < 3; i += 1) spawnResident(w, n, data, rng);
  postVillagers(w, n, 'lumber', rng);

  const cycle = workCycleSeconds(data);
  assert.ok(cycle > 0 && cycle <= 60, `사이클은 사람이 알아볼 수 있는 길이여야 한다 (${cycle}초)`);

  const before = n.resources.wood || 0;
  // 한 사이클 길이만큼 1초씩 굴린다 — 위상 지터 때문에 사람마다 터지는 순간이 다르다
  let credits = 0;
  for (let t = 0; t < Math.ceil(cycle) + 1; t += 1) credits += stepResidentWork(w, n, data, 1).credits.length;
  assert.ok(credits >= 3, `사이클 한 바퀴에 세 사람 모두 한 번씩은 적립해야 한다 (${credits})`);
  assert.ok((n.resources.wood || 0) > before, '국고가 실시간으로 올라야 한다');
});

test('§14-1 첫 수치까지 걸리는 시간 — 옛 규칙(154초)보다 확실히 짧다', () => {
  const w = newWorld(42);
  const n = w.nations.player;
  const rng = createRng(42);
  __openChapter(n, 5);
  for (let i = 0; i < 3; i += 1) spawnResident(w, n, data, rng);
  postVillagers(w, n, 'lumber', rng);

  let firstAt = null;
  for (let t = 1; t <= 180 && firstAt == null; t += 1) {
    if (stepResidentWork(w, n, data, 1).credits.length) firstAt = t;
  }
  assert.ok(firstAt != null, '3분 안에는 반드시 첫 수치가 떠야 한다');
  assert.ok(firstAt <= 30, `첫 수치가 ${firstAt}초 — 30초를 넘으면 "안 뜬다"로 읽힌다`);
});

test('§14-1 하루 합계 동일성 — 실시간 적립을 섞어도 옛 산출식과 오차 <1%', () => {
  // 같은 씨앗·같은 배치로 두 판을 돌린다. 한쪽만 실시간 루프를 돌린다.
  const runs = [];
  for (const realtime of [false, true]) {
    let w = newWorld(43);
    let n = w.nations.player;
    const rng = createRng(43);
    __openChapter(n, 5);
    for (let i = 0; i < 4; i += 1) spawnResident(w, n, data, rng);
    postVillagers(w, n, 'lumber', rng);
    const gross = residentGather(w, n, data).resources.wood;
    const before = n.resources.wood || 0;
    if (realtime) {
      // 하루(600초)를 1초씩 굴린다 — 실제 접속 상태와 같다
      for (let t = 0; t < data.balance.time.dayRealSeconds; t += 1) stepResidentWork(w, n, data, 1);
    }
    const out = step(w, [], rng, data);
    w = out.state; n = w.nations.player;
    runs.push({ realtime, gained: round2((n.resources.wood || 0) - before), gross });
  }
  const [off, on] = runs;
  assert.ok(off.gained > 0, '실시간 없이도 하루치가 들어온다');
  assert.equal(round2(off.gained), round2(off.gross), '실시간이 없으면 옛 값 그대로');
  const err = Math.abs(on.gained - off.gained) / Math.max(1e-9, off.gained);
  assert.ok(err < 0.01,
    `하루 합계가 어긋나면 밸런스가 통째로 밀린다 — 실시간 ${on.gained} vs 일 틱 ${off.gained} (오차 ${(err * 100).toFixed(3)}%)`);
});

test('§14-1 residentSettle — 이미 준 몫은 두 번 주지 않는다', () => {
  const w = newWorld(44);
  const n = w.nations.player;
  const rng = createRng(44);
  __openChapter(n, 5);
  for (let i = 0; i < 2; i += 1) spawnResident(w, n, data, rng);
  postVillagers(w, n, 'lumber', rng);

  const gross = residentGather(w, n, data).resources.wood;
  for (let t = 0; t < Math.ceil(workCycleSeconds(data)) * 3 + 3; t += 1) stepResidentWork(w, n, data, 1);
  const settle = residentSettle(w, n, data);
  const prepaid = settle.prepaid.wood || 0;
  assert.ok(prepaid > 0, '실시간으로 얼마쯤은 이미 주었다');
  assert.equal(round2(prepaid + (settle.resources.wood || 0)), round2(gross),
    '실시간으로 준 몫 + 일 틱 나머지 = 하루 산출');
  // 정산 뒤에는 장부가 비워진다 — 이튿날에 옛 빚이 따라붙지 않는다
  const again = residentSettle(w, n, data);
  assert.equal(again.prepaid.wood ?? 0, 0);
  assert.equal(round2(again.resources.wood), round2(gross));
});

test('§14-1 저장 상한은 그대로다 — 곳간이 차면 실시간 적립도 버려진다', () => {
  const w = newWorld(45);
  const n = w.nations.player;
  const rng = createRng(45);
  __openChapter(n, 5);
  for (let i = 0; i < 3; i += 1) spawnResident(w, n, data, rng);
  postVillagers(w, n, 'lumber', rng);
  const cap = storageLimit(n, data);
  n.resources.wood = cap;
  for (let t = 0; t < Math.ceil(workCycleSeconds(data)) * 2 + 2; t += 1) stepResidentWork(w, n, data, 1);
  assert.ok(n.resources.wood <= cap + 0.01, `상한(${cap})을 넘겨 쌓이면 안 된다 (${n.resources.wood})`);
});

test('§14-1 노는 사람은 실시간 수치를 띄우지 않는다 (일 틱이 곡물을 맡는다)', () => {
  const w = newWorld(46);
  const n = w.nations.player;
  const rng = createRng(46);
  __openChapter(n, 5);
  spawnResident(w, n, data, rng);
  const out = stepResidentWork(w, n, data, workCycleSeconds(data) * 3);
  assert.equal(out.credits.length, 0, '노는 사람이 "+0.01 곡물"을 흩뿌리면 안 된다');
});

// ────────────────────────────────────────────────────────────────
// §14-4 영토 진입 금지 · 목장
// ────────────────────────────────────────────────────────────────
test('§14-4 짐승은 영토 안으로 들어오지 못한다', () => {
  const w = newWorld(47);
  const n = w.nations.player;
  __openChapter(n, 7);
  ensureCreatures(w, n, data);
  const town = townOf(w, n.id);
  const r = territoryRadius(n, data);
  // 경계 바로 밖에 한 마리를 놓고 본부를 향해 달려들게 한다
  const c = n.wild.creatures[0];
  assert.ok(c, '짐승이 하나는 있어야 한다');
  c.x = town.x + r + 1; c.y = town.y;
  c.tx = town.x; c.ty = town.y;
  c.state = 'wander';
  for (let t = 0; t < 60; t += 1) {
    c.tx = town.x; c.ty = town.y; c.retarget = 99;
    stepEcology(w, n, data, 1);
  }
  assert.equal(inTerritory(w, n, Math.round(c.x), Math.round(c.y), data), false,
    `짐승이 영토 안(${c.x},${c.y})에 들어왔다 — 반경 ${r}`);
});

test('§14-4 이미 안에 있던 것은 밀려난다', () => {
  const w = newWorld(48);
  const n = w.nations.player;
  __openChapter(n, 7);
  ensureCreatures(w, n, data);
  const town = townOf(w, n.id);
  const c = n.wild.creatures[0];
  c.x = town.x + 1; c.y = town.y + 1;         // 한복판
  for (let t = 0; t < 80; t += 1) stepEcology(w, n, data, 1);
  assert.equal(inTerritory(w, n, Math.round(c.x), Math.round(c.y), data), false,
    '영토 안에 남아 있으면 안 된다');
});

test('§14-4 목장 — 온순한 짐승만, 목장 둘레에만 들어올 수 있다', () => {
  const w = newWorld(49);
  const n = w.nations.player;
  __openChapter(n, 10);
  const ranch = put(w, n, 'ranch', 1, 2, 2);
  assert.ok(ranch, '목장이 서야 한다');
  ensureCreatures(w, n, data);
  const defs = creatureDefs(data);
  const tame = n.wild.creatures.find((c) => defs[c.sp]?.kind === 'animal');
  const wild = n.wild.creatures.find((c) => defs[c.sp]?.kind === 'predator');
  assert.ok(tame && wild);
  const cx = ranch.x + 0.5;
  const cy = ranch.y + 0.5;
  assert.equal(ranchOpenFor(w, n, data, tame.sp, cx, cy), true, '온순한 짐승은 목장 둘레에 들 수 있다');
  assert.equal(ranchOpenFor(w, n, data, wild.sp, cx, cy), false, '포식자는 목장이 있어도 못 든다');
});

test('§14-4 목장은 일 단위로 고기·털·가죽을 낸다', () => {
  let w = newWorld(50);
  let n = w.nations.player;
  const rng = createRng(50);
  __openChapter(n, 10);
  put(w, n, 'ranch', 1, 3, 3);
  const before = { meat: n.resources.meat || 0, wool: n.resources.wool || 0, hide: n.resources.hide || 0 };
  const out = step(w, [], rng, data);
  n = out.state.nations.player;
  assert.ok((n.resources.meat || 0) > before.meat, '고기가 나야 한다');
  assert.ok((n.resources.wool || 0) > before.wool, '털이 나야 한다');
  assert.ok((n.resources.hide || 0) > before.hide, '가죽이 나야 한다');
});

// ────────────────────────────────────────────────────────────────
// §14-5 플레이어 HP · XP · 레벨 · 스탯
// ────────────────────────────────────────────────────────────────
test('§14-5 레벨은 스킬 XP 총합 곡선에서 나온다 (서버 권위)', () => {
  const w = newWorld(51);
  const n = w.nations.player;
  const p = ensurePlayer(n, 'lord', data, '개척자');
  assert.equal(playerLevel(p, data), 1);
  assert.equal(playerXpTotal(p), 0);
  const curve = data.skills.player.xpCurve;
  p.skills.lumber.xp = curve[1];
  assert.equal(playerXpTotal(p), curve[1]);
  assert.equal(playerLevel(p, data), 2, '총합이 첫 문턱을 넘으면 2레벨');
  // 여러 스킬에 흩어져 있어도 **합**이 곡선을 탄다
  p.skills.lumber.xp = curve[1] / 2;
  p.skills.farm.xp = curve[1] / 2;
  assert.equal(playerLevel(p, data), 2);
});

test('§14-5 레벨업마다 스탯 포인트 1 — 쓴 만큼만 준다', () => {
  const w = newWorld(52);
  const n = w.nations.player;
  const p = ensurePlayer(n, 'lord', data, '개척자');
  const curve = data.skills.player.xpCurve;
  p.skills.combat.xp = curve[3];
  assert.equal(playerLevel(p, data), 4);
  assert.equal(statPoints(p, data), 3, '레벨 4 = 남은 포인트 3');
  assert.equal(allocStat(p, 'vitality', data).ok, true);
  assert.equal(statPoints(p, data), 2);
  assert.equal(p.stats.alloc.vitality, 1);
  allocStat(p, 'strength', data);
  allocStat(p, 'agility', data);
  assert.equal(statPoints(p, data), 0);
  const bad = allocStat(p, 'luck', data);
  assert.equal(bad.ok, false, '포인트가 없으면 못 준다');
  assert.equal(allocStat(p, '없는능력', data).ok, false);
});

test('§14-5 능력치는 실제 훅에 붙는다 (최대HP·피해·쿨타임)', () => {
  const w = newWorld(53);
  const n = w.nations.player;
  const p = ensurePlayer(n, 'lord', data, '개척자');
  const hp0 = maxHpOf(p, data);
  const dmg0 = swingDamage(n, p, data);
  const cd0 = swingCooldownMs(n, p, 'lumber', data);
  p.skills.combat.xp = data.skills.player.xpCurve[6];
  for (const k of ['vitality', 'strength', 'agility']) for (let i = 0; i < 2; i += 1) allocStat(p, k, data);
  assert.equal(maxHpOf(p, data), hp0 + 2 * data.skills.player.stats.vitality.maxHp, '체력 2점 = 최대HP +20');
  assert.ok(swingDamage(n, p, data) > dmg0, '힘이 피해를 올린다');
  assert.ok(swingCooldownMs(n, p, 'lumber', data) < cd0, '민첩이 쿨타임을 줄인다');
  const fx = statEffects(p, data);
  assert.ok(fx.moveSpeed > 1 && fx.harvest > 1 && fx.luck >= 0);
});

test('§14-5 뷰가 HP·XP·레벨·남은 포인트를 실어 보낸다', () => {
  const w = newWorld(54);
  const n = w.nations.player;
  const p = ensurePlayer(n, 'lord', data, '개척자');
  p.skills.lumber.xp = data.skills.player.xpCurve[2];
  const v = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  const prog = v.you.player.progress;
  assert.ok(prog, 'you.player.progress 가 있어야 HUD 가 바를 그린다');
  assert.equal(prog.level, 3);
  assert.equal(prog.points, 2);
  assert.ok(prog.need > prog.xp, '다음 문턱이 있어야 XP 바가 그려진다');
  assert.ok(prog.ratio >= 0 && prog.ratio <= 1);
  assert.equal(prog.stats.vitality.name, '체력');
  assert.equal(typeof v.you.player.hp, 'number');
  assert.equal(v.you.player.maxHp, maxHpOf(p, data));
});

test('§14-5 allocStat 명령 — 서버가 정본이고 리스펙은 없다', () => {
  const w = newWorld(55);
  const n = w.nations.player;
  const rng = createRng(55);
  const p = ensurePlayer(n, 'lord', data, '개척자');
  p.skills.build.xp = data.skills.player.xpCurve[2];
  const bad = applyCommand(w, 'player', { type: 'allocStat', stat: 'vitality', avatarId: 'lord', count: 99 }, data, rng);
  assert.equal(bad.ok, true, '넘치게 청해도 가진 만큼만 준다');
  assert.equal(statPoints(p, data), 0);
  assert.equal(p.stats.alloc.vitality, 2);
  const none = applyCommand(w, 'player', { type: 'allocStat', stat: 'vitality', avatarId: 'lord' }, data, rng);
  assert.equal(none.ok, false);
});

// ────────────────────────────────────────────────────────────────
// §14-6 다운 · 부활
// ────────────────────────────────────────────────────────────────
test('§14-6 다운은 10초, 부활은 HP 50% + 3초 무적', () => {
  const cfg = data.skills.combat;
  assert.equal(cfg.downSeconds, 10, '스펙이 못 박은 10초');
  assert.ok(cfg.reviveHpRatio > 0 && cfg.reviveHpRatio <= 1);
  assert.ok(cfg.invulnSeconds > 0);

  const w = newWorld(56);
  const n = w.nations.player;
  __openChapter(n, 7);
  const p = ensurePlayer(n, 'lord', data, '개척자');
  n.avatars = { lord: { id: 'lord', name: '개척자', x: 10, y: 10 } };
  p.hp = 0;
  p.downUntil = cfg.downSeconds;
  const morale0 = n.morale;
  let revived = null;
  for (let t = 0; t < cfg.downSeconds + 2 && !revived; t += 1) {
    const r = stepEcology(w, n, data, 1);
    revived = r.events.find((e) => e.kind === 'player_revived') ?? null;
  }
  assert.ok(revived, '10초가 지나면 모닥불에서 일어난다');
  assert.equal(round2(p.hp), round2(maxHpOf(p, data) * cfg.reviveHpRatio));
  assert.ok(p.invulnUntil > 0, '3초 무적이 붙는다');
  assert.ok(n.morale <= morale0, '사기가 조금 내려간다');
  const town = townOf(w, n.id);
  assert.equal(n.avatars.lord.x, town.x, '본부 자리에서 일어난다');
});

test('§14-6 무적 동안에는 물려도 깎이지 않는다', () => {
  const w = newWorld(57);
  const n = w.nations.player;
  __openChapter(n, 7);
  const p = ensurePlayer(n, 'lord', data, '개척자');
  n.avatars = { lord: { id: 'lord', name: '개척자', x: 40, y: 40 } };
  p.hp = p.maxHp = maxHpOf(p, data);
  p.invulnUntil = data.skills.combat.invulnSeconds;
  ensureCreatures(w, n, data);
  const wolf = n.wild.creatures.find((c) => creatureDefs(data)[c.sp]?.kind === 'predator');
  assert.ok(wolf);
  wolf.x = 40; wolf.y = 40; wolf.atkCd = 0;
  stepEcology(w, n, data, 1);
  assert.equal(p.hp, maxHpOf(p, data), '무적인데 깎였다');
});

// ────────────────────────────────────────────────────────────────
// §14-7 건설 탭 잠금 표시
// ────────────────────────────────────────────────────────────────
test('§14-7 열린 갈래 안의 잠긴 건물은 까닭과 함께 실린다', () => {
  const w = newWorld(58);
  const n = w.nations.player;
  __openChapter(n, 5);          // 생산 갈래는 3장부터 열려 있다
  const v = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  const locked = v.nation.lockedBuildings || [];
  assert.ok(locked.length > 0, '잠긴 것도 목록에 실려야 "없는 줄 알았다"가 안 난다');
  const open = new Set(v.nation.buildable.map((b) => b.key));
  const openCats = new Set(v.nation.buildable.map((b) => b.category));
  for (const b of locked) {
    assert.equal(open.has(b.key), false, `${b.key} 가 두 목록에 다 있으면 안 된다`);
    assert.equal(b.unlocked, false);
    assert.ok(b.lockReason && b.lockReason.length > 0, `${b.key} 에 해금 조건 글이 없다`);
    assert.ok(openCats.has(b.category), `${b.key} 의 갈래(${b.category})는 이미 열려 있어야 한다`);
  }
  const hut = locked.find((b) => b.key === 'hunter_hut');
  assert.ok(hut, '사냥꾼 오두막은 5장에서 잠겨 있어야 한다');
  assert.match(hut.lockReason, /6장/, `사냥꾼 오두막 해금 조건: ${hut.lockReason}`);
  const ranch = locked.find((b) => b.key === 'ranch');
  assert.ok(ranch, '목장도 목록에 보여야 "없는 줄 알았다"가 안 난다');
  assert.match(ranch.lockReason, /티어 4/);
});

test('§14-7 군사 갈래가 열린 뒤에도 아직 이른 건물은 까닭과 함께 보인다', () => {
  const w = newWorld(60);
  const n = w.nations.player;
  __openChapter(n, 7);          // 7장 — 울타리·초소·터렛 3종이 열린다 (★ §15-A-5)
  const v = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  const locked = v.nation.lockedBuildings || [];
  const mil = locked.filter((b) => b.category === 'military');
  assert.ok(mil.length > 0, '아직 못 짓는 군사 건물이 목록에 남아야 한다');
  const barracks = mil.find((b) => b.key === 'barracks');
  assert.ok(barracks);
  assert.match(barracks.lockReason, /9장/);
  /* ★ §15-A-5 가 §14-7 의 예시를 갈아치웠다: 화포는 이제 7장에 함께 열린다(초반 최소 3종).
     그래서 여기서는 「잠긴 목록에 없다」가 옳은 검사다. */
  assert.equal(mil.find((b) => b.key === 'cannon'), undefined, '화포는 7장에 이미 열려 있다');
  const buildable = (v.nation.buildable || []).map((b) => b.key);
  for (const key of ['arrow_tower', 'ballista', 'cannon']) {
    assert.ok(buildable.includes(key), `${key} 는 7장 배치대에 있다`);
  }
});

test('§14-7 해금 조건 글은 장 이름을 그대로 적는다 (화살탑 = 7장 「낯선 발자국」)', () => {
  const w = newWorld(61);
  const n = w.nations.player;
  __openChapter(n, 5);
  const info = buildingUnlockInfo(n, 'arrow_tower', data);
  assert.equal(info.kind, 'chapter');
  assert.equal(info.chapter, 7);
  assert.match(info.text, /7장/);
  assert.match(info.text, /낯선 발자국/);
});

test('§14-7 갈래가 통째로 안 열렸으면 그 갈래는 아예 없다 (§11-1 은 시스템 단위)', () => {
  const w = newWorld(59);
  const n = w.nations.player;
  __openChapter(n, 1);          // 1장 — 배치대 자체가 없다
  const v = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  assert.equal((v.nation.buildable || []).length, 0);
  assert.equal((v.nation.lockedBuildings || []).length, 0,
    '지을 것이 하나도 없는 장에서는 잠긴 목록도 없다 — 배치대 단추 자체가 안 그려진다');
});
