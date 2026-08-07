// 유물 — docs/유물기획.md §20 (R1: 등급 재편 · 50종 상향 · 소모형 스케일링 · 충전제 · 신규 op)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, npcAssignments, migrateWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import {
  collectHooks, rollArtifactDrop, grantArtifact, useArtifact, chargesOf, migrateArtifactCharges,
} from '../server/engine/artifacts.js';
import { grantRandomArtifact } from '../server/engine/king.js';
import { storageCapacity, effectiveTariff, importPrice } from '../server/engine/economy.js';
import { buildingCost } from '../server/engine/build_cost.js';
import { battleMultipliers, finishBattle } from '../server/engine/battle.js';
import { waveView, waveSpec, scaleGradeOf } from '../server/engine/waves.js';
import { capacity } from '../server/engine/residents.js';
import { craftEquipment } from '../server/engine/equipment.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { artifactFoundEvent, expressionQualityOf } from '../server/engine/artifacts.js';
import { ExpressionQueue, artifactNarrative } from '../server/expression/index.js';
import { applyCommand } from '../server/engine/commands.js';
import { completeStructure } from '../server/engine/structures.js';
import { townOf } from '../server/engine/world.js';

const data = loadGameData();
const CFG = data.balance.artifacts;
const nationOf = (seed) => {
  const world = createWorld({ seed, data, assignments: npcAssignments(data) });
  return { world, n: world.nations.player };
};

// ────────────────────────────────────────────────────────────────
// §20-1 등급 재편
// ────────────────────────────────────────────────────────────────
// ★ §20-R1.5 — 등급 명단·상자 확률의 정본은 **팀 원안**이다. R1 이 상향한 수치·op 는 그대로 산다.
test('§20-R1.5 등급 체계 — 표기명 일반/레어/유니크/레전더리, 상자 가중치 55/32/8/5 (원안)', () => {
  const g = data.artifacts.grades;
  assert.equal(g.common.name, '일반');
  assert.equal(g.rare.name, '레어');
  assert.equal(g.unique.name, '유니크');
  assert.equal(g.legendary.name, '레전더리');
  const w = CFG.gradeWeights;
  assert.deepEqual(Object.keys(w), ['common', 'rare', 'unique', 'legendary'], 'gradeBoost 가 미는 차례다');
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(w.common, 0.55);
  assert.equal(w.rare, 0.32);
  assert.equal(w.unique, 0.08);
  assert.equal(w.legendary, 0.05);
  // 확률의 정본은 balance 한 곳뿐 — 등급표에는 표기명만 남는다
  for (const info of Object.values(g)) assert.equal(info.chance, undefined);
});

test('§20-R1.5 유물 50종 — 원안 명단 19/17/6/7 + 확정지급 1, acquireVia 전량 부착', () => {
  const counts = {};
  for (const a of data.artifacts.list) counts[a.grade] = (counts[a.grade] || 0) + 1;
  assert.equal(counts.common, 19);
  assert.equal(counts.rare, 17);
  assert.equal(counts.unique, 6);
  assert.equal(counts.legendary, 7);
  assert.equal(counts.fixed, 1, '왕관의 조각은 상자 풀 제외');
  assert.equal(data.artifacts.list.length, 50);
  const keys = new Set(data.artifacts.list.map((a) => a.key));
  assert.equal(keys.size, 50, 'key 중복 없음');
  for (const a of data.artifacts.list) {
    assert.ok(a.name && a.desc && a.effects?.length > 0, `${a.key} 정의 누락`);
    assert.ok(['consumable', 'permanent', 'utility', 'cosmetic', 'tradeoff'].includes(a.type), `${a.key} type`);
    assert.ok(Array.isArray(a.acquireVia) && a.acquireVia.length, `${a.key} acquireVia 누락`);
    // R3·R4 몫은 아직 넣지 않는다
    assert.equal(a.lore, undefined, `${a.key} lore 는 R3`);
    assert.equal(a.setKey, undefined, `${a.key} setKey 는 R4`);
  }
});

test('§20-R1.5 원안 명단 — 레전더리 7종·유니크 6종이 문서 그대로다', () => {
  const of = (g) => data.artifacts.list.filter((a) => a.grade === g).map((a) => a.key).sort();
  assert.deepEqual(of('legendary'), ['banner_of_valor', 'devils_contract', 'lucky_charm',
    'orb_of_prophecy', 'ring_of_greed', 'sealed_dragon_scale', 'travelers_seal']);
  // 유니크는 외형 5종 + 표현 계층 1종 — 「보기 좋은 것」의 칸이다
  assert.deepEqual(of('unique'), ['glass_craft', 'golden_banner', 'legendary_portrait',
    'old_songbook', 'royal_robe', 'stone_of_tongues']);
  // 등급은 원안이되 효과는 R1 상향판 그대로다 (한 줄로 못 박는다)
  const eff = (k, i) => data.artifactsByKey[k].effects[i];
  assert.equal(eff('sealed_dragon_scale', 0).multiplier, 0.88, '드래곤 −12% 유지');
  assert.equal(eff('lucky_charm', 0).amount, 0.05, '발견 확률 +5%p 유지');
  assert.equal(eff('ring_of_greed', 0).multiplier, 1.4, '골드 +40% 유지');
  assert.equal(data.artifactsByKey.travelers_seal.effects[0].op, 'tariffExemptAll', '3국 전면 면제 유지');
});

test('§20-6 기존 대가 계열 5종은 curse 속성을 단다', () => {
  const cursed = data.artifacts.list.filter((a) => a.curse === true).map((a) => a.key).sort();
  assert.deepEqual(cursed,
    ['broken_crown_fragment', 'cursed_map', 'devils_contract', 'ring_of_greed', 'tyrants_crown']);
});

// ────────────────────────────────────────────────────────────────
// §20-9 획득 경로
// ────────────────────────────────────────────────────────────────
test('상자 발견 확률 12%, 행운의 부적 +5%p, 상한 30%', () => {
  assert.equal(CFG.chestChancePerCouncil, 0.12);
  assert.equal(CFG.discoverChanceCap, 0.3);
  const { n } = nationOf(1);
  assert.equal(collectHooks(n, data).discoverChanceBonus, 0);
  grantArtifact(n, 'lucky_charm', 1, data);
  assert.ok(Math.abs(collectHooks(n, data).discoverChanceBonus - CFG.luckyCharmBonus) < 1e-12);
  assert.equal(CFG.luckyCharmBonus, 0.05);
  assert.ok(collectHooks(n, data).discoverChanceBonus <= CFG.discoverChanceCap);
});

test('상자 풀 — 네 등급 전부 나오되 왕관의 조각(fixed)만은 나오지 않는다', () => {
  const { n } = nationOf(2);
  const rng = createRng(7);
  const seen = new Set();
  const grades = new Set();
  for (let i = 0; i < 4000; i += 1) {
    const drop = rollArtifactDrop(n, data, rng, { defense: 3 });
    if (drop.grade) grades.add(drop.grade);
    if (drop.artifact) seen.add(drop.artifact);
  }
  assert.ok(seen.size > 10, '충분히 다양한 유물이 나온다');
  assert.deepEqual([...grades].sort(), ['common', 'legendary', 'rare', 'unique'], '네 등급 모두 열린다');
  assert.ok(!seen.has('crown_shard'), '왕관의 조각은 상자에서 나오지 않는다');
  for (const key of seen) assert.notEqual(data.artifactsByKey[key].grade, 'fixed');
});

test('유적·궤의 gradeBoost 는 등급표 차례대로 민다 (원안: common→rare→unique→legendary)', () => {
  const { n } = nationOf(3);
  const order = Object.keys(CFG.gradeWeights);
  const rng = { chance: () => true, weighted: (e) => e[0].value, pick: (a) => a[0] };
  const plain = grantRandomArtifact(n, data, rng, 1, 0);
  assert.equal(plain.grade, order[0], '보정이 없으면 뽑힌 등급 그대로');
  const boosted = grantRandomArtifact(n, data, rng, 1, 3);
  assert.equal(boosted.grade, order[3], '세 칸 밀면 레전더리까지 간다');
});

test('§20-9 탐험 궤 — 링별 드랍표(링0~1 0.30 · 링2 0.35 · 링3 0.40)가 데이터에 있다', () => {
  const t = CFG.ringDropTable;
  assert.deepEqual(t.ringRadii, [12, 60, 140], '탐험기획 §18-1 링 반경');
  assert.deepEqual(t.chanceByRing, [0.3, 0.3, 0.35, 0.4]);
  // 링 판정: 반경 표를 넘어선 개수가 곧 링 번호다
  const ringOf = (d) => t.ringRadii.filter((r) => d >= r).length;
  assert.equal(ringOf(5), 0);
  assert.equal(ringOf(30), 1);
  assert.equal(ringOf(100), 2);
  assert.equal(ringOf(300), 3);
  assert.equal(t.chanceByRing[ringOf(300)], 0.4);
});

// ────────────────────────────────────────────────────────────────
// §20-2 소모형 스케일링
// ────────────────────────────────────────────────────────────────
test('풍요의 뿔 — 곡물 저장 상한의 40%, 최소 150 (고정치가 아니다)', () => {
  const { n } = nationOf(21);
  const cap = storageCapacity(n, 'grain', data);
  const before = n.resources.grain;
  grantArtifact(n, 'horn_of_plenty', 1, data);
  const r = useArtifact(n, 'horn_of_plenty', 2, data);
  assert.ok(r.ok);
  assert.equal(Math.round(n.resources.grain - before), Math.round(Math.max(150, cap * 0.4)));
  assert.equal(collectHooks(n, data).immunities.blight, 2, '흉작 면역 2회');
});

test('스케일링 — 곳간이 크면 더 많이 준다 (저장 상한 비례)', () => {
  const a = nationOf(22).n;
  const b = nationOf(23).n;
  b.population = (b.population || 10) * 8;    // 재고 목표가 커지면 상한도 커진다
  grantArtifact(a, 'steel_essence', 1, data);
  grantArtifact(b, 'steel_essence', 1, data);
  const gotA = (useArtifact(a, 'steel_essence', 2, data), a.resources.steel);
  const gotB = (useArtifact(b, 'steel_essence', 2, data), b.resources.steel);
  assert.ok(gotB > gotA, `${gotB} > ${gotA}`);
  assert.ok(gotA >= 80, '최소치 80은 보장된다');
});

test('골드러시의 기억 — 100G × 정착지 티어 (최소 100)', () => {
  const { n } = nationOf(24);
  n.tier = 3;
  const gold0 = n.gold;
  grantArtifact(n, 'goldrush_memory', 1, data);
  useArtifact(n, 'goldrush_memory', 2, data);
  assert.equal(Math.round(n.gold - gold0), 300);
});

// ────────────────────────────────────────────────────────────────
// 충전제 일반화 · 마이그레이션
// ────────────────────────────────────────────────────────────────
test('충전제 — 시간의 모래시계 2회, 상인의 유언장 3회. 다 쓰면 그때 소진된다', () => {
  const { n } = nationOf(31);
  grantArtifact(n, 'hourglass_of_time', 1, data);
  const owned = n.artifacts.find((a) => a.key === 'hourglass_of_time');
  assert.equal(owned.chargesLeft, 2);
  assert.ok(useArtifact(n, 'hourglass_of_time', 2, data).ok);
  assert.equal(owned.consumed, false, '한 번 썼다고 사라지지 않는다');
  assert.equal(owned.chargesLeft, 1);
  assert.ok(useArtifact(n, 'hourglass_of_time', 3, data).ok);
  assert.equal(owned.consumed, true);
  assert.equal(useArtifact(n, 'hourglass_of_time', 4, data).code, 'ALREADY_USED');

  grantArtifact(n, 'merchants_will', 1, data);
  assert.equal(n.artifacts.find((a) => a.key === 'merchants_will').chargesLeft, 3);
  for (let i = 0; i < 3; i += 1) assert.ok(useArtifact(n, 'merchants_will', 5 + i, data).ok);
  assert.equal(collectHooks(n, data).tariffZeroCharges, 3, '충전마다 관세 0% 한 장씩');
});

test('1회짜리 소모형은 예전 그대로 — 한 번 쓰면 끝', () => {
  const { n } = nationOf(32);
  grantArtifact(n, 'goldrush_memory', 1, data);
  assert.ok(useArtifact(n, 'goldrush_memory', 2, data).ok);
  const again = useArtifact(n, 'goldrush_memory', 3, data);
  assert.equal(again.ok, false);
  assert.equal(again.code, 'ALREADY_USED');
});

test('세이브 이관 — chargesLeft 없는 옛 엔트리는 1회분으로 열린다', () => {
  const { world, n } = nationOf(33);
  n.artifacts = [{ key: 'hourglass_of_time', obtainedTick: 1, consumed: false },
                 { key: 'goldrush_memory', obtainedTick: 1, consumed: true }];
  assert.equal(chargesOf(n.artifacts[0], data.artifactsByKey.hourglass_of_time), 1, '2회로 소급되지 않는다');
  assert.equal(chargesOf(n.artifacts[1], data.artifactsByKey.goldrush_memory), 0);
  migrateArtifactCharges(n);
  assert.equal(n.artifacts[0].chargesLeft, 1);
  assert.equal(n.artifacts[1].chargesLeft, 0);
  // migrateWorld 도 같은 규칙을 돌린다(옛 세이브가 열리는 실제 문)
  const old = structuredClone(world);
  old.migrationRev = 0;
  old.nations.player.artifacts = [{ key: 'eye_of_storm', obtainedTick: 1, consumed: false }];
  const migrated = migrateWorld(old, data);
  assert.equal(migrated.nations.player.artifacts[0].chargesLeft, 1);
  assert.ok(migrated.nations.player.artifactState.costDiscountCategories);
});

test('다 쓴 소모형이라도 onUse 가 아닌 효과는 계속 산다 (불멸의 주춧돌)', () => {
  const { n } = nationOf(34);
  grantArtifact(n, 'immortal_cornerstone', 1, data);
  assert.ok(Math.abs(collectHooks(n, data).wallHpMultiplier - 1.1) < 1e-9);
  assert.equal(collectHooks(n, data).freeUpgrades.wall ?? 0, 0);
  useArtifact(n, 'immortal_cornerstone', 2, data);
  const after = collectHooks(n, data);
  assert.equal(after.freeUpgrades.wall, 1, '성벽 올림 1회 무료');
  assert.ok(Math.abs(after.wallHpMultiplier - 1.1) < 1e-9, '성벽 내구는 쓰고도 남는다');
});

// ────────────────────────────────────────────────────────────────
// 신규/변경 op — 소비처까지
// ────────────────────────────────────────────────────────────────
test('적 공격력 감소 유물이 실제 전투 배수에 꽂힌다 (§20-2 전투 계열 상향)', () => {
  const { n } = nationOf(41);
  const spec = { ...waveSpec(5, data), type: 'dragon' };
  const base = battleMultipliers(n, spec, data, collectHooks(n, data)).enemy;
  grantArtifact(n, 'sealed_dragon_scale', 1, data);
  const hooks = collectHooks(n, data);
  assert.ok(Math.abs((hooks.enemyPowerMultipliers.dragon ?? 1) - 0.88) < 1e-9, '드래곤 공격력 −12%');
  const armed = battleMultipliers(n, spec, data, hooks).enemy;
  assert.ok(Math.abs(armed - base * 0.88) < 1e-9, `${armed} = ${base}×0.88`);
});

test('탐욕의 반지 — 값(전 침공 +15%)이 실제로 붙는다. 저주는 몰래 좋기만 하면 안 된다', () => {
  const { n } = nationOf(42);
  grantArtifact(n, 'ring_of_greed', 1, data);
  const hooks = collectHooks(n, data);
  assert.ok(Math.abs(hooks.goldMultiplier - 1.4) < 1e-9);
  for (const type of ['wolf', 'dragon']) {
    const spec = { ...waveSpec(2, data), type };
    const plain = battleMultipliers(n, spec, data, {}).enemy;
    const cursed = battleMultipliers(n, spec, data, hooks).enemy;
    assert.ok(Math.abs(cursed - plain * 1.15) < 1e-9, `${type}: ${cursed}`);
  }
});

test('용맹의 깃발 · 노획한 투구 — 격퇴 결산에서 사기와 골드가 함께 오른다', () => {
  const { world, n } = nationOf(43);
  const cfg = data.waves.battle;
  const mk = () => ({ waveIndex: 0, type: 'wolf', name: '늑대', power: 100, won: true, t: 10,
    total: 3, killed: 3, escaped: 0, fencesBroken: 0, militiaDowned: 0, militiaHurt: 0,
    playersDowned: 0, playerDamage: {}, looted: {}, structureDamage: {}, timeline: [] });
  n.battle = mk();
  const plain = finishBattle(world, n, data);
  const moraleGain = cfg.moraleBonusOnHold;
  grantArtifact(n, 'banner_of_valor', 1, data);
  grantArtifact(n, 'captured_helm', 1, data);
  n.battle = mk();
  const armed = finishBattle(world, n, data);
  assert.ok(Math.abs(armed.moraleDelta - (moraleGain + 0.05)) < 1e-6, `사기 ${armed.moraleDelta}`);
  assert.equal(armed.gold, Math.round(plain.gold * 1.25), '격퇴 골드 +25%');
});

test('여행자의 인장 — 3국 전체 관세 영구 면제 (한 곳이 아니다)', () => {
  const { n } = nationOf(44);
  assert.ok(effectiveTariff(n, data, {}) > 0);
  grantArtifact(n, 'travelers_seal', 1, data);
  const hooks = collectHooks(n, data);
  assert.equal(hooks.tariffExemptAll, true);
  for (const id of ['ai1', 'ai2', 'ai3']) {
    assert.equal(effectiveTariff(n, data, { exemptAll: hooks.tariffExemptAll, nationId: id }), 0);
  }
});

test('오래된 조약서 — 1회성이 아니라 전국 관세 −3%p 영구', () => {
  const { n } = nationOf(45);
  assert.equal(data.artifactsByKey.old_treaty.type, 'permanent');
  const before = effectiveTariff(n, data, {});
  grantArtifact(n, 'old_treaty', 1, data);
  const after = effectiveTariff(n, data, { artifactDelta: collectHooks(n, data).tariffDelta });
  assert.ok(Math.abs(after - Math.max(data.balance.trade.minTariff, before - 0.03)) < 1e-9);
});

test('상인의 저울 — 환스프레드 −20%가 실제 수입가에 반영된다', () => {
  const { n } = nationOf(46);
  const plain = importPrice(100, n, data, {});
  grantArtifact(n, 'merchants_scale', 1, data);
  const hooks = collectHooks(n, data);
  assert.ok(Math.abs(hooks.fxSpreadMultiplier - 0.8) < 1e-9);
  const cheap = importPrice(100, n, data, { fxSpreadMultiplier: hooks.fxSpreadMultiplier });
  assert.ok(cheap < plain, `${cheap} < ${plain}`);
});

test('국경의 인장 — 무역로 거점(교역소·영사관)만 −50%, 다른 건물은 그대로', () => {
  const { n } = nationOf(47);
  const plain = buildingCost(n, 'trading_post', 1, data, {});
  const house = buildingCost(n, 'house', 1, data, {});
  grantArtifact(n, 'border_seal', 1, data);
  const hooks = collectHooks(n, data);
  const cheap = buildingCost(n, 'trading_post', 1, data, hooks);
  const sameHouse = buildingCost(n, 'house', 1, data, hooks);
  for (const [r, v] of Object.entries(plain.cost)) assert.ok(Math.abs(cheap.cost[r] - v * 0.5) < 0.02, r);
  assert.deepEqual(sameHouse.cost, house.cost, '집값은 건드리지 않는다');
});

test('여문 씨앗 주머니 — 「생산 계열 아무 것이나」 1회 −30%', () => {
  const { n } = nationOf(48);
  const plain = buildingCost(n, 'sawmill', 1, data, {});
  grantArtifact(n, 'ripe_seed_pouch', 1, data);
  useArtifact(n, 'ripe_seed_pouch', 2, data);
  const hooks = collectHooks(n, data);
  assert.equal(hooks.costDiscountCategories.production, 0.3);
  const cheap = buildingCost(n, 'sawmill', 1, data, hooks);
  for (const [r, v] of Object.entries(plain.cost)) assert.ok(Math.abs(cheap.cost[r] - v * 0.7) < 0.02, r);
  // 생산 계열이 아닌 건물에는 붙지 않는다
  assert.deepEqual(buildingCost(n, 'consulate', 1, data, hooks).cost, buildingCost(n, 'consulate', 1, data, {}).cost);
});

test('고대 용광로 설계도 — 무기 강재 −10%, 원유 요구 −3', () => {
  const { world, n } = nationOf(49);
  const spec = data.equipment.tiers.weapon.find((x) => x.cost?.steel);
  assert.ok(spec, '강재를 쓰는 무기가 표에 있다');
  n.roles.factory.holder = 'npc';
  const t = townOf(world, n.id);
  completeStructure(world, n, { building: 'smithy', tier: 1, x: t.x + 4, y: t.y + 4, placed: true }, data);
  grantArtifact(n, 'ancient_furnace_plan', 1, data);
  const hooks = collectHooks(n, data);
  assert.equal(hooks.weaponOilDelta, -3);
  assert.ok(Math.abs(hooks.weaponSteelMultiplier - 0.9) < 1e-9);
  const player = ensurePlayer(n, 'lord', data, '주군');
  for (const [r, v] of Object.entries(spec.cost)) n.resources[r] = v * 4;
  n.gold = (spec.gold || 0) + 500;
  const res = craftEquipment(n, player, { slot: 'weapon', key: spec.key }, data, hooks);
  assert.ok(res.ok, res.error?.message);
  assert.ok(Math.abs(res.cost.steel - spec.cost.steel * 0.9) < 0.02, `강재 ${res.cost.steel}`);
});

test('왕관의 조각 — 인구 상한 +30이 실제 수용력에 얹힌다', () => {
  const { n } = nationOf(50);
  const before = capacity(n, data);
  grantArtifact(n, 'crown_shard', 1, data);
  const hooks = collectHooks(n, data);
  assert.equal(hooks.populationCapDelta, 30);
  n.artifactCapDelta = hooks.populationCapDelta;      // tick.js 가 매 틱 채우는 거울
  assert.equal(capacity(n, data), before + 30);
});

test('예언의 구슬 — 성녀 없이도 침공 날짜가 정밀해진다', () => {
  const { n } = nationOf(51);
  n.roles.saint.holder = null;
  assert.equal(collectHooks(n, data).flags.prophecyAlways, undefined);
  grantArtifact(n, 'orb_of_prophecy', 1, data);
  assert.equal(collectHooks(n, data).flags.prophecyAlways, true);
});

test('별자리 지도 · 정찰병의 망원경 — 성녀 없이 종류(+규모 등급)만 열린다', () => {
  const { world, n } = nationOf(52);
  n.tier = 4;
  openChapterForDebug(null, n, data, 10);
  n.roles.saint.holder = null;
  n.wave.arrivalTick = world.tick + 1;
  const blind = waveView(world, n, null, data, {});
  assert.equal(blind.enemy.type, null, '아무것도 없으면 종류도 모른다');

  grantArtifact(n, 'scouts_telescope', 1, data);
  const scouted = waveView(world, n, null, data, collectHooks(n, data));
  assert.ok(scouted.enemy.type, '망원경은 종류를 연다');
  assert.equal(scouted.enemy.scaleGrade, undefined, '규모 칸은 아직 부재다(§11-1)');
  assert.equal(collectHooks(n, data).warnLeadDelta, 1, '예고 1일 조기');

  grantArtifact(n, 'star_chart', 1, data);
  const charted = waveView(world, n, null, data, collectHooks(n, data));
  assert.ok(['소', '중', '대'].includes(charted.enemy.scaleGrade), charted.enemy.scaleGrade);
  assert.equal(charted.enemy.units, null, '마릿수 숫자는 여전히 성녀의 몫이다');
  assert.equal(scaleGradeOf({ units: 1 }, data), '소');
});

test('악마와의 계약서 — 다음 침공 하나만 규모 +10% (쓰고 나면 지워진다)', () => {
  const { n } = nationOf(53);
  grantArtifact(n, 'devils_contract', 1, data);
  const gold0 = n.gold;
  useArtifact(n, 'devils_contract', 2, data);
  assert.equal(Math.round(n.gold - gold0), 600);
  assert.equal(n.artifactState.artifactNextInvasionMultiplier, 1.1);
  assert.equal(collectHooks(n, data).blindNextInvasion, true);
});

test('W4(국가 이벤트) 미구현 효과는 게임을 깨지 않는다 — 수집만 되고 조용히 지나간다', () => {
  const { n } = nationOf(54);
  for (const key of ['worldtree_shard', 'eastern_seal', 'oath_of_friendship']) grantArtifact(n, key, 1, data);
  const hooks = collectHooks(n, data);
  assert.ok(Math.abs(hooks.premiumTrade.ai2 - 0.35) < 1e-9, '살아 있는 축(마진)은 정본 수치로 붙는다');
  assert.ok(Math.abs(hooks.premiumTrade.ai1 - 0.35) < 1e-9);
  assert.equal(hooks.factionChoiceBonus, undefined, '아직 훅 칸이 없다 — 그래도 예외가 나지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ★ §20-R1.5 발견 서사 — 「연출·서사는 표시 전용, 판정은 서버」
// ────────────────────────────────────────────────────────────────
test('발견 사실 — 세 경로(상자·유적·궤)가 같은 모양으로 낸다', () => {
  const { world, n } = nationOf(61);
  for (const [key, src] of [['horn_of_plenty', 'chest'], ['lucky_charm', 'ruin'], ['swift_boots', 'cache']]) {
    const ev = artifactFoundEvent(world, n, key, src, data);
    assert.equal(ev.kind, 'artifact_found');
    assert.equal(ev.nationId, n.id);
    const def = data.artifactsByKey[key];
    assert.deepEqual(
      { artifact: ev.data.artifact, key: ev.data.key, grade: ev.data.grade, category: ev.data.category },
      { artifact: def.name, key, grade: def.grade, category: def.category },
    );
    assert.equal(ev.data.source, src);
    assert.ok(ev.data.role && ev.data.narrativeSeed.includes(key), '발견처 이름과 서사 씨앗이 함께 온다');
    assert.equal(ev.data.narrative, undefined, '엔진은 문장을 만들지 않는다 — 표현 계층의 몫');
  }
  assert.equal(artifactFoundEvent(world, n, 'no_such_key', 'chest', data), null);
});

test('발견 서사 — 등급 한 줄 + 계열 한 줄, 같은 씨앗이면 언제나 같은 글', () => {
  const { world, n } = nationOf(62);
  const ev = artifactFoundEvent(world, n, 'ring_of_greed', 'ruin', data);
  const a = artifactNarrative(ev.data, data);
  const b = artifactNarrative(ev.data, data);
  assert.equal(a, b, '결정론 — 같은 판의 같은 발견은 같은 서사를 낸다');
  assert.ok(a.length > 10 && a.split('. ').length >= 2, a);
  assert.ok(a.includes(data.artifactsByKey.ring_of_greed.name), '유물 이름이 들어간다');
  // 씨앗이 다르면 글도 갈린다(같은 유물이라도 다른 판·다른 날은 다르게 적힌다)
  const other = artifactNarrative({ ...ev.data, narrativeSeed: 'zzz:9' }, data);
  assert.ok(typeof other === 'string' && other.length > 10);
});

test('발견 서사 — 50종 전량이 빈손 없이 두 축 모두에서 글을 얻는다', () => {
  const { world, n } = nationOf(63);
  const cfg = data.templates.artifactNarrative;
  for (const def of data.artifacts.list) {
    assert.ok(cfg.byGrade[def.grade]?.length, `${def.grade} 등급 서사 없음`);
    assert.ok(cfg.byCategory[def.category]?.length, `${def.category} 계열 서사 없음`);
    const text = artifactNarrative(artifactFoundEvent(world, n, def.key, 'chest', data).data, data);
    assert.ok(text && !text.includes('{{'), `${def.key}: ${text}`);
  }
});

test('표현 계층 — LLM 이 꺼져 있어도 push 에 narrative 가 실린다(템플릿 폴백)', () => {
  const { world, n } = nationOf(64);
  const q = new ExpressionQueue({ data, useLlm: false });
  const out = q.express(artifactFoundEvent(world, n, 'star_chart', 'cache', data), { nationId: n.id });
  assert.ok(out.text, '토스트 한 줄(옛 계약)은 그대로다');
  assert.ok(out.data.narrative.length > 10);
  assert.equal(out.data.narrativeSource, 'template');
  assert.equal(q.pending, 0, 'LLM 이 꺼져 있으면 부름 자체가 없다');
  // 유물이 아닌 이벤트에는 서사 칸이 생기지 않는다(§11-1 부재 원칙)
  const plain = q.express({ tick: 1, kind: 'council_open', nationId: n.id, data: {} }, { nationId: n.id });
  assert.equal(plain.data.narrative, undefined);
});

test('언어의 돌 — 표현 품질이 표현 계층까지 닿는다 (수치 효과는 여전히 없다)', () => {
  const { n } = nationOf(65);
  assert.equal(expressionQualityOf(n, data), 1);
  grantArtifact(n, 'stone_of_tongues', 1, data);
  assert.equal(expressionQualityOf(n, data), 2);
  assert.equal(collectHooks(n, data).expressionQuality, 2, '훅 묶음과 값이 같다');
});

test('유적 카드 — 유물이 나오면 결정 ack 에 발견 사실이 함께 실린다', () => {
  const world = createWorld({ seed: 71, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.tier = 4;
  openChapterForDebug(null, n, data, 10);
  const always = { chance: () => true, weighted: (e) => e[0].value, pick: (a) => a[0] };
  n.decisionQueue.push({ decisionId: 'd1', kind: data.ruins.decisionKind, ruin: { cardId: 'altar' } });
  const res = applyCommand(world, 'player', { type: 'decide', decisionId: 'd1', choice: 'dig' }, data, always);
  assert.ok(res.ok, res.error?.message);
  const found = (res.events || []).find((e) => e.kind === 'artifact_found');
  assert.ok(found, '유적이 내어준 것도 상자와 같은 발견 사실을 낸다');
  assert.equal(found.data.source, 'ruin');
  assert.equal(found.data.key, res.ruin.artifact.key);
});

test('숨은 궤 — 궤가 유물을 내면 스윙 ack 에 발견 사실이 함께 실린다', () => {
  const world = createWorld({ seed: 72, data, playerName: '개척자' });
  const n = world.nations.player;
  n.tier = 4;
  openChapterForDebug(null, n, data, 10);
  const caches = (world.map.nodes || []).filter((x) => x.type === 'cache');
  let found = null;
  let now = 2e6;                       // 손의 쿨타임은 궤를 옮겨도 이어진다 — 시각을 계속 민다
  for (const node of caches.slice(0, 40)) {
    node.revealed = true;
    n.avatars.lord = { id: 'lord', name: '개척자', x: node.x, y: node.y, tick: 0 };
    let res = null;
    for (let i = 0; i < 3; i += 1) {
      now += 1e5;
      res = applyCommand(world, 'player', { type: 'actionSwing', nodeId: node.id, avatarId: 'lord', now }, data, createRng(1));
    }
    found = (res?.events || []).find((e) => e.kind === 'artifact_found');
    if (found) break;
  }
  assert.ok(found, '궤 마흔 개 안에 유물 하나는 나온다');
  assert.equal(found.data.source, 'cache');
  assert.ok(found.data.narrativeSeed.includes('artifactNarrative'));
});
