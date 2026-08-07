// ★ GDD3 §13-D (RPG 계층) 계약 회귀 — docs/PROTOCOL.md §0-V
//   주민 능력치 · 모집 · 장비/강화 · 인첸트(성녀 2배) · 기술 트리 · 철로
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData, publicConfig } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { townOf, ringRadii, dist } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { applyCommand } from '../server/engine/commands.js';
import { buildNationView } from '../server/engine/view.js';
import { spawnResident, militiaList, residentYield, recruitStatus } from '../server/engine/residents.js';
import { stepVillagers } from '../server/engine/villagers.js';
import {
  rollStats, statRng, yieldFactor, militiaHpFactor, militiaDpsFactor, statsCfg, jobFit,
} from '../server/engine/traits.js';
import {
  equipEffects, equipmentView, gradeOdds, rollGrade, tierByKey, ensureGear,
} from '../server/engine/equipment.js';
import {
  researchStatus, researchView, researchDone, researchFeature, onRail, productionBonus,
} from '../server/engine/research.js';
import { ensurePlayer, swingDamage } from '../server/engine/skills.js';

const data = loadGameData();
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);
const put = (w, n, key, tier = 1, dx = 3, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);
const cmd = (w, n, c) => applyCommand(w, n.id, c, data, createRng(7));

// ────────────────────────────────────────────────────────────────
// §13-D-1 주민 능력치
// ────────────────────────────────────────────────────────────────
test('§13-D-1 능력치 — 1~10 안에 들고, 평균은 정확히 한가운데다 (밸런스 중립의 조건)', () => {
  const cfg = statsCfg(data);
  const sums = {};
  const N = 40000;
  for (let i = 0; i < N; i += 1) {
    const st = rollStats(statRng(`t:${i}`), data);
    for (const k of cfg.order) {
      assert.ok(st[k] >= cfg.min && st[k] <= cfg.max, `${k}=${st[k]} 가 ${cfg.min}~${cfg.max} 밖이다`);
      sums[k] = (sums[k] || 0) + st[k];
    }
  }
  for (const k of cfg.order) {
    const mean = sums[k] / N;
    assert.ok(Math.abs(mean - cfg.mid) < 0.05, `${k} 평균 ${mean.toFixed(3)} 이 한가운데(${cfg.mid})에서 벗어났다`);
  }
});

test('§13-D-1 능력치 반영 범위 — 산출도 민병도 ±20% 를 넘지 않고, 평균은 1.0 이다', () => {
  const cfg = statsCfg(data);
  const lo = { stats: Object.fromEntries(cfg.order.map((k) => [k, cfg.min])) };
  const hi = { stats: Object.fromEntries(cfg.order.map((k) => [k, cfg.max])) };
  for (const u of [lo, hi]) {
    for (const f of [yieldFactor(u, data, false), yieldFactor(u, data, true),
      militiaHpFactor(u, data), militiaDpsFactor(u, data)]) {
      assert.ok(f >= 1 - cfg.cap && f <= 1 + cfg.cap, `배수 ${f} 가 ±${cfg.cap} 밖이다`);
    }
  }
  // 체력×피해(전투에서 실제로 듣는 양)도 상한 안이다
  const prodHi = militiaHpFactor(hi, data) * militiaDpsFactor(hi, data);
  const prodLo = militiaHpFactor(lo, data) * militiaDpsFactor(lo, data);
  assert.ok(prodHi <= 1 + cfg.cap && prodLo >= 1 - cfg.cap,
    `체력×피해 ${prodLo.toFixed(3)}~${prodHi.toFixed(3)} 가 ±${cfg.cap} 밖이다`);
  // 사람이 여럿 모이면 평균은 1.0 으로 수렴한다 — 시뮬 체크포인트가 흔들리지 않는 근거
  let acc = 0;
  const N = 20000;
  for (let i = 0; i < N; i += 1) acc += yieldFactor({ stats: rollStats(statRng(`y:${i}`), data) }, data, false);
  assert.ok(Math.abs(acc / N - 1) < 0.004, `산출 배수 평균 ${(acc / N).toFixed(4)} 이 1.0 에서 벗어났다`);
});

test('§13-D-1 능력치는 세계 난수에서 나오지 않는다 — 같은 씨앗의 같은 사람은 언제나 같다', () => {
  /* 세계 난수를 쓰면 넘겨준 난수가 다를 때 능력치도 달라진다. 갈라 두었으므로 달라지지 않는다.
     (§13-C 와 같은 규칙: 세계 난수를 한 톨 축내면 웨이브 구성·사건·이름이 통째로 밀린다.) */
  const a = newWorld(31);
  const b = newWorld(31);
  const ra = spawnResident(a, a.nations.player, data, createRng(31));
  const rb = spawnResident(b, b.nations.player, data, createRng(987654));
  assert.ok(ra.stats, '능력치는 붙는다');
  assert.deepEqual(ra.stats, rb.stats,
    '넘겨준 난수가 달라도 같은 씨앗·같은 번호의 사람은 같은 능력치여야 한다');
  // 다음 사람은 다른 사람이다
  const ra2 = spawnResident(a, a.nations.player, data, createRng(31));
  assert.notDeepEqual(ra2.stats, ra.stats);
});

test('§13-D-1 능력치가 한 사람 몫을 실제로 바꾼다 — 손재주가 좋으면 더 거둔다', () => {
  const cfg = statsCfg(data);
  const dull = { job: 'lumber', stats: Object.fromEntries(cfg.order.map((k) => [k, cfg.min])) };
  const deft = { job: 'lumber', stats: Object.fromEntries(cfg.order.map((k) => [k, cfg.max])) };
  const a = residentYield(dull, { type: 'forest' }, data, false).perDay;
  const b = residentYield(deft, { type: 'forest' }, data, false).perDay;
  assert.ok(b > a, `솜씨 좋은 사람이 더 내야 한다 (${a} → ${b})`);
  assert.ok(b / a <= (1 + cfg.cap) / (1 - cfg.cap) + 0.001, '벌어짐이 ±20% 규격을 넘었다');
});

test('§13-D-1 직업 적합 — 주민 뷰가 능력치와 적합 여부를 그대로 싣는다', () => {
  const w = newWorld(32);
  const n = w.nations.player;
  __openChapter(n, 5);
  const rng = createRng(32);
  for (let i = 0; i < 4; i += 1) spawnResident(w, n, data, rng);
  const v = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  for (const r of v.nation.residents) {
    assert.ok(r.stats, '주민 뷰에 능력치가 실려야 화면이 눈금을 그린다');
    assert.equal(Object.keys(r.stats).length, statsCfg(data).order.length);
    assert.ok(r.fit && Array.isArray(r.fit.keys));
  }
  const fit = jobFit({ stats: { courage: 10, strength: 10, dexterity: 1, diligence: 1 } }, 'defense', data);
  assert.equal(fit.fit, true, '용기 10 이면 수비가 적임이다');
});

// ────────────────────────────────────────────────────────────────
// §13-D-2 주민 모집
// ────────────────────────────────────────────────────────────────
function recruitReady(seed = 41) {
  const w = newWorld(seed);
  const n = w.nations.player;
  __openChapter(n, 5);
  put(w, n, 'hut', 1, 3, 3);
  put(w, n, 'hut', 1, -3, 3);
  n.resources.grain = 500;
  return { w, n };
}

test('§13-D-2 모집 — 식량을 치르면 그 자리에서 한 사람, 그리고 하루 쉰다', () => {
  const { w, n } = recruitReady(41);
  const cost = data.balance.residents.recruit.cost.grain;
  const before = n.resources.grain;
  const r = cmd(w, n, { type: 'recruitResident' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(n.villagers.length, 1, '즉시 한 사람이 온다');
  assert.equal(Math.round(before - n.resources.grain), cost, `식량 ${cost} 을 치른다`);
  assert.ok(r.resident.stats, '도착 카드에 실릴 능력치가 함께 온다');

  // 쿨다운 — 같은 날 두 번은 없다
  const again = cmd(w, n, { type: 'recruitResident' });
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'COOLDOWN');
  assert.equal(n.villagers.length, 1);

  // 하루가 지나면 다시 부를 수 있다
  const days = data.balance.residents.recruit.cooldownDays;
  const st0 = recruitStatus(w, n, data);
  assert.ok(st0.cooldownLeft > 0 && st0.cooldownLeft <= days);
  w.tick += days;
  assert.equal(recruitStatus(w, n, data).open, true, `${days}게임일 뒤에는 다시 부를 수 있다`);
});

test('§13-D-2 모집 — 잠자리가 없거나 식량이 모자라면 부르지 못한다 (까닭이 행으로 남는다)', () => {
  const { w, n } = recruitReady(42);
  n.resources.grain = 1;
  const poor = cmd(w, n, { type: 'recruitResident' });
  assert.equal(poor.ok, false);
  const rows = recruitStatus(w, n, data).reqs;
  const bad = rows.find((x) => !x.ok);
  assert.ok(bad, '못 부르는 까닭이 행으로 남아야 화면이 빨강으로 그린다');
  assert.equal(typeof bad.have, 'number');
  assert.equal(typeof bad.need, 'number');
});

test('§13-D-2 모집은 4장(첫 이웃) 전에는 명령 자체가 닫혀 있다', () => {
  const w = newWorld(43);
  const n = w.nations.player;
  n.resources.grain = 500;
  const r = cmd(w, n, { type: 'recruitResident' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CHAPTER_LOCKED');
});

// ────────────────────────────────────────────────────────────────
// §13-D-3 장비
// ────────────────────────────────────────────────────────────────
function smithyWorld(seed = 51) {
  const w = newWorld(seed);
  const n = w.nations.player;
  __openChapter(n, 9);
  put(w, n, 'smithy', 1, 4, 0);
  n.gold = 5000;
  for (const k of ['stone', 'wood', 'ironOre', 'steel', 'hide', 'wool']) n.resources[k] = 500;
  ensurePlayer(n, 'lord', data, '나');
  return { w, n, p: n.players.lord };
}

test('§13-D-3 장비 — 기본 세 단은 관료 없이 벼린다, 윗단과 강화는 공장장이 있어야 열린다', () => {
  const { w, n, p } = smithyWorld(51);
  const basic = cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'steel_blade', avatarId: 'lord' });
  assert.equal(basic.ok, true, JSON.stringify(basic.error));
  assert.equal(p.equipment.weapon.key, 'steel_blade');

  const elite = cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'elite_blade', avatarId: 'lord' });
  assert.equal(elite.ok, false);
  assert.equal(elite.error.code, 'NO_OFFICER');

  const plus = cmd(w, n, { type: 'enhanceEquipment', slot: 'weapon', avatarId: 'lord' });
  assert.equal(plus.ok, false);
  assert.equal(plus.error.code, 'NO_OFFICER');

  // 공장장이 앉으면 둘 다 열린다
  n.roles = { ...(n.roles || {}), factory: { holder: 'npc1', level: 1 } };
  assert.equal(cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'elite_blade', avatarId: 'lord' }).ok, true);
  const up = cmd(w, n, { type: 'enhanceEquipment', slot: 'weapon', avatarId: 'lord' });
  assert.equal(up.ok, true, JSON.stringify(up.error));
  assert.equal(p.equipment.weapon.plus, 1);
});

test('§13-D-3 장비 데미지 — 무기가 전투 스윙과 사냥에 그대로 실린다', () => {
  const { w, n, p } = smithyWorld(52);
  const bare = swingDamage(n, p, data) * equipEffects(p, data).damage;
  cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'stone_blade', avatarId: 'lord' });
  const stone = swingDamage(n, p, data) * equipEffects(p, data).damage;
  cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'steel_blade', avatarId: 'lord' });
  const steel = swingDamage(n, p, data) * equipEffects(p, data).damage;
  assert.ok(stone > bare, `돌칼이 맨손보다 세야 한다 (${bare} → ${stone})`);
  assert.ok(steel > stone, `강철검이 돌칼보다 세야 한다 (${stone} → ${steel})`);
  const spec = tierByKey('weapon', 'steel_blade', data);
  assert.equal(equipEffects(p, data).damage, spec.damage);
  assert.equal(equipEffects(p, data).huntYield, spec.huntYield, '사냥 효율도 무기가 정한다');

  // 강화 한 단이 실제로 배수를 올린다
  n.roles = { ...(n.roles || {}), factory: { holder: 'npc1', level: 1 } };
  cmd(w, n, { type: 'enhanceEquipment', slot: 'weapon', avatarId: 'lord' });
  assert.ok(equipEffects(p, data).damage > spec.damage, '+1 이 배수를 올려야 한다');
});

test('§13-D-3 방어구 — 피격 경감과 다운 저항은 절반을 넘지 않는다', () => {
  const { w, n, p } = smithyWorld(53);
  n.roles = { ...(n.roles || {}), factory: { holder: 'npc1', level: 1 } };
  cmd(w, n, { type: 'craftEquipment', slot: 'armor', key: 'master_guard', avatarId: 'lord' });
  for (let i = 0; i < 3; i += 1) cmd(w, n, { type: 'enhanceEquipment', slot: 'armor', avatarId: 'lord' });
  const fx = equipEffects(p, data);
  assert.ok(fx.reduction > 0.3, `명품 +3 이면 경감이 제법 커야 한다 (${fx.reduction})`);
  assert.ok(fx.reduction <= 0.5, '어떤 갑옷도 절반을 넘게 지우지는 못한다');
  assert.ok(fx.downResist > 0 && fx.downResist <= 0.75);
});

test('§13-D-3 장비는 사람의 것이다 — 다른 아바타의 칼은 내 칼이 아니다', () => {
  const { w, n } = smithyWorld(54);
  cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'stone_blade', avatarId: 'lord' });
  const other = ensurePlayer(n, 'friend', data, '동료');
  assert.equal(equipEffects(other, data).damage, 1, '남이 벼린 것이 내 손에 들리지 않는다');
  const view = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  assert.ok(view.you.equipment, '캐릭터 창은 내 것만 본다');
  assert.equal(view.you.equipment.gear.weapon.key, 'stone_blade');
});

// ────────────────────────────────────────────────────────────────
// §13-D-4 인첸트
// ────────────────────────────────────────────────────────────────
test('§13-D-4 인첸트 — 특성 하나가 붙고, 다시 걸면 덮어쓴다', () => {
  const { w, n, p } = smithyWorld(61);
  cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'iron_blade', avatarId: 'lord' });
  const r1 = cmd(w, n, { type: 'enchantEquipment', slot: 'weapon', avatarId: 'lord' });
  assert.equal(r1.ok, true, JSON.stringify(r1.error));
  assert.ok(r1.enchant && r1.enchant.trait, '특성이 하나 붙는다');
  assert.equal(r1.replaced, null);
  const r2 = cmd(w, n, { type: 'enchantEquipment', slot: 'weapon', avatarId: 'lord' });
  assert.equal(r2.ok, true);
  assert.ok(r2.replaced, '재부여는 앞의 것을 덮어쓴다');
  assert.equal(Object.keys(p.equipment.weapon.enchant).length, 2, '깃든 특성은 언제나 하나뿐이다');

  // 새로 벼리면 깃든 것도 함께 사라진다 (좋은 특성을 들고 티어만 갈아타지 못한다)
  cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'steel_blade', avatarId: 'lord' });
  assert.equal(p.equipment.weapon.enchant, null);
});

test('§13-D-4 인첸트 확률 — 성녀가 자리에 있으면 상위 등급이 정확히 두 배로 뽑힌다', () => {
  const { w, n } = smithyWorld(62);
  const plain = gradeOdds(n, data);
  n.roles = { ...(n.roles || {}), saint: { holder: 'npc9', level: 1 } };
  const blessed = gradeOdds(n, data);
  const mult = data.equipment.enchant.saintGradeMultiplier;
  const byKey = (list) => Object.fromEntries(list.map((g) => [g.key, g]));
  const a = byKey(plain);
  const b = byKey(blessed);
  // 무게가 두 배 — 확률은 정규화 뒤라 '무게비'로 잰다
  for (const g of data.equipment.enchant.grades) {
    const ratioA = a[g.key].chance / a.common.chance;
    const ratioB = b[g.key].chance / b.common.chance;
    const want = g.upper ? ratioA * mult : ratioA;
    assert.ok(Math.abs(ratioB - want) < 1e-6,
      `${g.name} 무게비가 어긋난다 (성녀 없이 ${ratioA} · 성녀 ${ratioB})`);
  }
  assert.ok(b.rare.chance > a.rare.chance && b.epic.chance > a.epic.chance, '성녀가 있으면 좋은 것이 더 잘 붙는다');

  // 실제 뽑기도 그렇게 나온다 (같은 난수, 다른 결과 분포)
  const count = (nation) => {
    const rng = createRng(4242);
    let upper = 0;
    for (let i = 0; i < 4000; i += 1) if (rollGrade(rng, nation, data).upper) upper += 1;
    return upper;
  };
  const noSaint = { roles: {} };
  const withSaint = { roles: { saint: { holder: 'npc9' } } };
  const c0 = count(noSaint);
  const c1 = count(withSaint);
  /* 무게가 두 배라는 것은 위에서 엄밀히 쟀다. 여기서는 실제 뽑기가 그 방향으로 크게 기우는지만 본다
     (무게 60/30/10 → 60/60/20 이면 상위 등급 확률은 0.40 → 0.571, 약 1.43배다). */
  assert.ok(c1 > c0 * 1.3, `성녀가 있을 때 상위 등급이 훨씬 자주 나와야 한다 (${c0} → ${c1})`);
});

test('§13-D-4 특성은 실제 효과로 이어진다 — 거두기·벌목·걸음·방어·밤눈', () => {
  const { w, n, p } = smithyWorld(63);
  cmd(w, n, { type: 'craftEquipment', slot: 'weapon', key: 'iron_blade', avatarId: 'lord' });
  for (const t of data.equipment.enchant.traits) {
    p.equipment.weapon.enchant = { trait: t.key, grade: 'common' };
    const fx = equipEffects(p, data);
    const got = t.effect === 'defense' ? fx.reduction : fx[t.effect];
    assert.ok(got >= t.value - 1e-9, `${t.name}(${t.effect}) 이 효과 훅에 닿지 않았다`);
  }
  // 등급이 오르면 값도 오른다
  p.equipment.weapon.enchant = { trait: 'harvest', grade: 'common' };
  const common = equipEffects(p, data).harvest;
  p.equipment.weapon.enchant = { trait: 'harvest', grade: 'epic' };
  assert.ok(equipEffects(p, data).harvest > common, '윗 등급이 더 큰 값을 낸다');
});

// ────────────────────────────────────────────────────────────────
// §13-D-5 기술 트리 · 철로
// ────────────────────────────────────────────────────────────────
function techWorld(seed = 71, tier = 4) {
  const w = newWorld(seed);
  const n = w.nations.player;
  __openChapter(n, 10);
  n.tier = tier;
  n.gold = 20000;
  for (const k of ['stone', 'ironOre', 'steel', 'coal', 'wood']) n.resources[k] = 2000;
  return { w, n };
}

test('§13-D-5 연구 게이트 — 단계와 선행 연구가 모자라면 못 붙들고, 그 까닭이 행으로 남는다', () => {
  const { w, n } = techWorld(71, 3);
  const st = researchStatus(n, 'coal_mining', data);
  assert.equal(st.ready, false);
  const tierRow = st.reqs.find((r) => r.key === 'tier');
  assert.equal(tierRow.ok, false);
  assert.equal(tierRow.have, 3);
  assert.equal(tierRow.need, 4, '잠긴 연구도 목록에서 사라지지 않는다 — 빨강으로 「3/4」를 적는다');
  assert.equal(cmd(w, n, { type: 'startResearch', key: 'coal_mining' }).ok, false);

  n.tier = 4;
  assert.equal(researchStatus(n, 'coal_mining', data).ready, true);
  // 선행이 없으면 증기기관은 여전히 잠겨 있다
  n.tier = 5;
  const steam = researchStatus(n, 'steam_engine', data);
  assert.equal(steam.ready, false);
  assert.ok(steam.reqs.some((r) => r.key === 'pre:coal_mining' && !r.ok));
});

test('§13-D-5 연구 — 값은 시작할 때 한 번, 날이 다 차야 끝난다. 한 번에 하나만', () => {
  const { w, n } = techWorld(72, 4);
  const def = data.research.defs.coal_mining;
  const gold0 = n.gold;
  const stone0 = n.resources.stone;
  const r = cmd(w, n, { type: 'startResearch', key: 'coal_mining' });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(n.gold, gold0 - def.gold);
  assert.equal(n.resources.stone, stone0 - def.cost.stone);
  assert.equal(cmd(w, n, { type: 'startResearch', key: 'refining' }).error.code, 'BUSY');

  let world = w;
  for (let i = 0; i < def.days; i += 1) world = step(world, [], createRng(72), data).state;
  const n2 = world.nations.player;
  assert.equal(researchDone(n2, 'coal_mining'), true, `${def.days}게임일이면 끝난다`);
  assert.equal(n2.research.active, null);
});

test('§13-D-5 석탄 — 연구 전에는 세상에 한 톨도 없고, 끝나는 날 링1~2 에 드러난다', () => {
  const { w, n } = techWorld(73, 4);
  assert.equal((w.map.nodes || []).filter((x) => x.type === 'coal').length, 0,
    '월드 생성에는 석탄이 나지 않는다');
  cmd(w, n, { type: 'startResearch', key: 'coal_mining' });
  let world = w;
  for (let i = 0; i < data.research.defs.coal_mining.days; i += 1) {
    world = step(world, [], createRng(73), data).state;
  }
  const coal = (world.map.nodes || []).filter((x) => x.type === 'coal');
  assert.ok(coal.length > 0, '연구가 끝나면 석탄 노두가 드러난다');
  const n2 = world.nations.player;
  const town = townOf(world, 'player');
  const { r0 } = ringRadii(n2, data);
  for (const c of coal) {
    assert.ok(dist(c.x, c.y, town.x, town.y) > r0 - 0.001, '석탄은 링1 밖(정착지 바깥 띠)에 앉는다');
    assert.equal(c.hidden, false, '캘 수 있어야 연구한 보람이 있다');
  }
  // 새 자원은 저장 상한·자원 목록에 정합한다
  assert.ok(data.resources.order.includes('coal'));
  assert.equal(publicConfig().resources.meta.coal.name, '석탄');
});

test('§13-D-5 증기기관 — 생산 건물이 내는 몫이 15% 는다', () => {
  const { w, n } = techWorld(74, 5);
  assert.equal(productionBonus(n, data), 0);
  n.research.done.coal_mining = 1;
  n.research.done.steam_engine = 2;
  assert.equal(productionBonus(n, data), data.research.defs.steam_engine.effects.productionBonus);
});

test('§13-D-5 철로 — 연구 전에는 깔 수 없고, 깐 뒤에는 그 위를 걷는 걸음이 두 배다', () => {
  const { w, n } = techWorld(75, 5);
  const town = townOf(w, 'player');
  const line = [{ x: town.x + 2, y: town.y }, { x: town.x + 10, y: town.y }];

  /* 문이 둘이다 — ① 사슬(10장)이 명령 자체를 열고 ② 연구가 그 명령의 알맹이를 연다 */
  const early = newWorld(175);
  assert.equal(cmd(early, early.nations.player, { type: 'placeRail', points: line }).error.code,
    'CHAPTER_LOCKED', '사슬이 열기 전에는 명령이 아예 닿지 않는다');
  assert.equal(cmd(w, n, { type: 'placeRail', points: line }).error.code, 'NO_RESEARCH',
    '사슬이 열려도 철로를 모르면 깔 수 없다');

  n.research.done.coal_mining = 1;
  n.research.done.steam_engine = 2;
  n.research.done.railway = 3;
  assert.equal(researchFeature(n, 'rails', data), true);

  const steel0 = n.resources.steel;
  const r = cmd(w, n, { type: 'placeRail', points: line });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(r.placed >= 7, `한 획에 여러 칸이 깔린다 (${r.placed})`);
  assert.equal(n.resources.steel, steel0 - data.research.rails.costPerTile.steel * r.placed);
  assert.equal(onRail(n, town.x + 5, town.y), true);

  // 철로 위에 선 사람은 두 배로 간다
  const base = data.world.villagers.moveTilesPerTick;
  const mult = data.research.rails.speedMultiplier;
  const rider = { id: 'ra', x: town.x + 3, y: town.y, destX: town.x + 3 + base * mult, destY: town.y, job: 'idle' };
  const walker = { id: 'wa', x: town.x + 3, y: town.y + 6, destX: town.x + 3 + base * mult, destY: town.y + 6, job: 'idle' };
  n.villagers = [rider, walker];
  stepVillagers(w, n, data, w.tick);
  const rode = rider.x - (town.x + 3);
  const walked = walker.x - (town.x + 3);
  assert.equal(rode, base * mult, `철로 위는 ${mult}배 (${rode})`);
  assert.equal(walked, base, `맨땅은 그대로 (${walked})`);
  assert.ok(rode === walked * mult);
});

test('§13-D-5 철로 — 물 위에는 깔리지 않고, 걷어 내면 절반을 돌려받는다', () => {
  const { w, n } = techWorld(76, 5);
  n.research.done.coal_mining = 1;
  n.research.done.steam_engine = 2;
  n.research.done.railway = 3;
  const town = townOf(w, 'player');
  const r = cmd(w, n, { type: 'placeRail', points: [{ x: town.x + 2, y: town.y + 2 }, { x: town.x + 6, y: town.y + 2 }] });
  assert.equal(r.ok, true);
  const ids = n.rails.map((t) => t.id);
  const steel0 = n.resources.steel;
  const back = cmd(w, n, { type: 'removeRail', tileIds: ids });
  assert.equal(back.ok, true);
  assert.equal(n.rails.length, 0);
  assert.ok(n.resources.steel > steel0, '걷어 내면 값의 절반이 돌아온다');
});

// ────────────────────────────────────────────────────────────────
// 계약 — 공개본과 뷰
// ────────────────────────────────────────────────────────────────
test('§13-D 공개본 — 규칙은 config 로, 실제 값은 state 로만 간다', () => {
  const c = publicConfig();
  assert.ok(c.residentStats && c.residentStats.order.length === 4);
  /* ★ §19-F2(F07-2) — 표가 사다리 하나에서 갈래로 늘었다(무기 9 · 방어구 8). 계약은 「몇 개인가」가
     아니라 「자료가 정본인가」라, 하드코딩 대신 자료와 맞춘다(§17-13 연구 수와 같은 손). */
  assert.ok(c.equipment && c.equipment.tiers.weapon.length === data.equipment.tiers.weapon.length);
  assert.ok(c.equipment.tiers.weapon.length >= 8 && c.equipment.tiers.armor.length >= 7);
  // ★ §17-13 — 가교·매립이 더해져 연구 수는 자료가 정본이다(하드코딩 금지)
  assert.ok(c.research && c.research.order.length === data.research.order.length);
  assert.ok(c.recruit && c.recruit.cost.grain > 0);
  // 사람마다·나라마다의 실제 값은 공개본에 없다
  assert.equal(c.equipment.gear, undefined);
  assert.equal(c.research.done, undefined);
});

test('§13-D 잠긴 계층은 뷰에 필드 자체가 없다 (§11-1)', () => {
  const w = newWorld(81);
  const n = w.nations.player;
  const v0 = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  assert.equal(v0.you.equipment, undefined, '대장간의 장이 열리기 전에는 장비 필드가 아예 없다');
  assert.equal(v0.nation.research, undefined, '연구도 마찬가지다');
  assert.equal((v0.nation.housing.recruit), undefined, '모집도 마찬가지다');

  __openChapter(n, 10);
  ensurePlayer(n, 'lord', data, '나');
  const v1 = buildNationView(w, 'player', null, data, { avatarId: 'lord' });
  assert.ok(v1.you.equipment, '장이 열리면 필드가 생긴다');
  assert.ok(v1.nation.research);
  assert.ok(v1.nation.housing.recruit);
  assert.equal(v1.nation.research.list.length, data.research.order.length,
    '잠긴 연구도 목록에는 남는다(조건 가시화)');
});
