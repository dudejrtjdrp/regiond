// 유물 — docs/유물기획.md §20 (R1: 등급 재편 · 50종 상향 · 소모형 스케일링 · 충전제 · 신규 op)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, npcAssignments, migrateWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import {
  collectHooks, rollArtifactDrop, grantArtifact, useArtifact, chargesOf, migrateArtifactCharges,
  // ★ §20-R4 — 상자 밖 축·세트·봉인·설치·거울
  dropPool, rollRing3Unique, sealArtifact, plantArtifact, growPlanted, auraDeptBonus,
  mirrorArtifactHooks, resetReviveCharges, consumeRevive, speciesDamageMultiplier,
} from '../server/engine/artifacts.js';
import { grantRandomArtifact } from '../server/engine/king.js';
import { storageCapacity, effectiveTariff, importPrice } from '../server/engine/economy.js';
import { buildingCost } from '../server/engine/build_cost.js';
import { battleMultipliers, finishBattle } from '../server/engine/battle.js';
import { waveView, waveSpec, scaleGradeOf } from '../server/engine/waves.js';
import { capacity } from '../server/engine/residents.js';
import { craftEquipment } from '../server/engine/equipment.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { artifactFoundEvent, expressionQualityOf, fxTierOf, recordArtifactFound, gameDate } from '../server/engine/artifacts.js';
import { artifactCodexView, codexView } from '../server/engine/codex.js';
import { publicConfig } from '../server/engine/data.js';
import { ExpressionQueue, artifactNarrative, artifactGlobalPush } from '../server/expression/index.js';
import { applyCommand } from '../server/engine/commands.js';
import { chronicleArtifact } from '../server/engine/artifacts.js';
import { completeStructure } from '../server/engine/structures.js';
import { townOf } from '../server/engine/world.js';
import { templeKindAt, templeCard, templeAnswer, resolveTempleChoice, templeNodes, enterTemple } from '../server/engine/temple.js';   // ★ §20-R4b·R4e

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

test('§20-R4 유물 71종 — 원안 50종(19/17/6/7+1)에 신규 21종이 얹혔다, acquireVia 전량 부착', () => {
  const counts = {};
  for (const a of data.artifacts.list) counts[a.grade] = (counts[a.grade] || 0) + 1;
  // ★ §20-R4 — 원안 명단은 그대로 살아 있고 그 위에 신규가 더해졌다(19+0 / 17+7 / 6+7 / 7+4).
  assert.equal(counts.common, 19, '일반은 신규가 없다 — 신규는 전부 레어 이상');
  assert.equal(counts.rare, 24);
  assert.equal(counts.unique, 16);
  assert.equal(counts.legendary, 11);
  assert.equal(counts.fixed, 1, '왕관의 조각은 상자 풀 제외');
  assert.equal(data.artifacts.list.length, 71);
  const keys = new Set(data.artifacts.list.map((a) => a.key));
  assert.equal(keys.size, 71, 'key 중복 없음');
  for (const a of data.artifacts.list) {
    assert.ok(a.name && a.desc && a.effects?.length > 0, `${a.key} 정의 누락`);
    assert.ok(['consumable', 'permanent', 'utility', 'cosmetic', 'tradeoff', 'installable'].includes(a.type), `${a.key} type`);
    assert.ok(Array.isArray(a.acquireVia) && a.acquireVia.length, `${a.key} acquireVia 누락`);
    // ★ §20-R3 — lore·hint 는 전량 있다(도감이 여는 것).
    assert.ok(a.lore && a.lore.length > 20, `${a.key} lore 누락`);
    assert.ok(a.hint && a.hint.length > 5, `${a.key} hint 누락`);
    // 게임 내 금지어(§0-6)
    for (const banned of ['마키나', '혼재']) {
      assert.ok(!`${a.name}${a.desc}${a.lore}${a.hint}`.includes(banned), `${a.key} 금지어 ${banned}`);
    }
  }
});

/* ★ §20-R4 신규 21종의 명단 — 경로로 추정하지 않고 **적어 둔다**. dragon_heart 는 옛 경로명
   (dragon)을 그대로 쓰므로 「신설 경로를 쓰면 신규」 같은 어림짐작은 그 하나를 놓친다. */
const R4_KEYS = [
  'crown_of_ignis', 'storm_cloak', 'worldtree_seed', 'reapers_scythe', 'sigil_of_aros',
  'hunters_oath', 'spear_of_levin', 'pathfinders_compass', 'stationmasters_sigil',
  'dragon_heart', 'frozen_kings_scepter', 'chalice_of_aqua', 'eye_of_aros',
  'cornerstone_of_terra', 'droplet_of_aqua', 'ember_of_ignis', 'feather_of_wind',
  'captains_journal', 'broken_pickaxe', 'starving_crown', 'blood_pact',
];

test('★ §20-R4 상자 밖 축 — 신규 21종은 상자·유적·궤 세 풀에 한 톨도 섞이지 않는다', () => {
  const fresh = data.artifacts.list.filter((a) => R4_KEYS.includes(a.key));
  assert.equal(fresh.length, 21, '신규 21종이 전부 정의표에 있다');
  for (const a of fresh) {
    for (const v of ['chest', 'ruin', 'cache']) {
      assert.ok(!a.acquireVia.includes(v), `${a.key} 가 ${v} 풀에 샌다 — 「희소는 경로로 만든다」가 깨진다`);
    }
  }
  // 전설 4종은 방 유일(§20-4 잼 규칙)
  const room = data.artifacts.list.filter((a) => a.exclusive === 'room').map((a) => a.key).sort();
  assert.deepEqual(room, ['chalice_of_aqua', 'dragon_heart', 'eye_of_aros', 'frozen_kings_scepter']);
});

test('§20-R1.5 원안 명단 — 레전더리 7종·유니크 6종이 문서 그대로다', () => {
  // ★ §20-R4 — 신규(상자 밖 경로를 쓰는 것)를 걷어 내고 원안 명단만 본다. 원안은 건드리지 않았다는
  //   약속을 이 한 줄이 지킨다: 신규가 늘어도 여기 적힌 열세 개는 영영 그대로여야 한다.
  const of = (g) => data.artifacts.list
    .filter((a) => a.grade === g && !R4_KEYS.includes(a.key)).map((a) => a.key).sort();
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

test('§20-6 저주 계열 — 기존 대가 5종 + R4 신규 3종', () => {
  const cursed = data.artifacts.list.filter((a) => a.curse === true).map((a) => a.key).sort();
  assert.deepEqual(cursed, ['blood_pact', 'broken_crown_fragment', 'cursed_map', 'devils_contract',
    'reapers_scythe', 'ring_of_greed', 'starving_crown', 'tyrants_crown']);
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

// ────────────────────────────────────────────────────────────────
// ★ §20-R2 획득 연출 — 서버는 「급과 자리」만 더한다(연출은 클라 몫)
// ────────────────────────────────────────────────────────────────
test('연출 급(fxTier) — 등급표가 정본, 유물이 제 값을 적으면 그것이 이긴다', () => {
  const g = data.artifacts.grades;
  assert.deepEqual([g.common.fxTier, g.rare.fxTier, g.unique.fxTier, g.legendary.fxTier], [1, 2, 3, 4]);
  for (const grade of Object.keys(g)) assert.ok(g[grade].name && g[grade].color && g[grade].cls, grade);
  assert.equal(fxTierOf(data.artifactsByKey.swift_boots, data), 1);
  assert.equal(fxTierOf(data.artifactsByKey.lucky_charm, data), 4, '레전더리는 4급');
  assert.equal(fxTierOf({ grade: 'common', fxTier: 3 }, data), 3, '엔트리의 값이 등급 기본값을 이긴다');
  assert.equal(fxTierOf({ grade: 'no_such' }, data), 1, '모르는 등급도 깨지지 않는다');
});

test('발견 사실 — fxTier·발견자·빛기둥 자리가 함께 온다 (더하기만 한 칸)', () => {
  const { world, n } = nationOf(81);
  n.avatars.lord = { id: 'lord', name: '개척자', x: 40, y: 41 };
  const ev = artifactFoundEvent(world, n, 'lucky_charm', 'ruin', data, { avatarId: 'lord' });
  assert.equal(ev.data.fxTier, 4);
  assert.equal(ev.data.foundBy, '개척자');
  assert.equal(ev.data.foundById, 'lord');
  assert.deepEqual(ev.data.nodePos, { x: 40, y: 41 }, '찾은 사람 자리에 빛기둥이 선다');
  // 궤는 제 자리를 안다 — 사람보다 그쪽이 이긴다
  const atCache = artifactFoundEvent(world, n, 'swift_boots', 'cache', data, { avatarId: 'lord', pos: { x: 9, y: 8 } });
  assert.deepEqual(atCache.data.nodePos, { x: 9, y: 8 });
  // 아무도 없으면 도읍으로 물러선다(어전 회의 상자)
  const chest = artifactFoundEvent(world, n, 'star_chart', 'chest', data);
  assert.ok(chest.data.nodePos && chest.data.nodePos.x != null, '자리가 비지 않는다');
  assert.equal(chest.data.foundById, null, '발견자를 모르면 나라의 일이다');
});

test('전역 알림 — 레전더리만, 발견자를 알면 이름이 들어간다', () => {
  const { world, n } = nationOf(82);
  n.avatars.lord = { id: 'lord', name: '아린', x: 40, y: 41 };
  const legend = artifactFoundEvent(world, n, 'banner_of_valor', 'ruin', data, { avatarId: 'lord' });
  const push = artifactGlobalPush(legend, '엘도린', data);
  assert.ok(push, '레전더리는 서버 전체가 안다');
  assert.deepEqual({ nationName: push.nationName, foundBy: push.foundBy, grade: push.grade },
    { nationName: '엘도린', foundBy: '아린', grade: 'legendary' });
  assert.ok(push.text.includes('아린') && push.text.includes('용맹의 깃발'), push.text);
  assert.ok(!push.text.includes('{{'), '자리표시자가 남지 않는다');
  // 발견자를 모르면 「군주가」로 적는다
  const anon = artifactGlobalPush({ data: { ...legend.data, foundBy: null } }, '엘도린', data);
  assert.ok(anon.text.includes('군주') && !anon.text.includes('null'), anon.text);
  // 레전더리가 아니면 아무 데도 가지 않는다
  for (const key of ['swift_boots', 'star_chart', 'royal_robe', 'crown_shard']) {
    const ev = artifactFoundEvent(world, n, key, 'chest', data);
    assert.equal(artifactGlobalPush(ev, '엘도린', data), null, key);
  }
});

test('연출 다이얼 — 급 1~4의 박자가 전부 데이터에 있다 (코드에 숫자가 없다)', () => {
  const fx = data.world.render.artifactFx;
  for (const tier of ['1', '2', '3', '4']) {
    assert.equal(typeof fx.cardDelayMs[tier], 'number', `cardDelayMs.${tier}`);
    assert.equal(typeof fx.sparkleCount[tier], 'number', `sparkleCount.${tier}`);
    assert.ok(fx.sfx[tier], `sfx.${tier}`);
  }
  assert.ok(fx.cardDelayMs['4'] > fx.cardDelayMs['2'], '급이 오를수록 뜸을 들인다');
  assert.ok(fx.veilAlpha['4'] > fx.veilAlpha['3'], '급이 오를수록 어둡다');
  assert.ok(fx.beam.seconds > 0 && fx.zoom.step >= 0 && fx.slowmo.scale < 1);
});

// ────────────────────────────────────────────────────────────────
// ★ §20-R3 기록·도감 (유물기획 §20-8) — 「기록이 보상이다」
// ────────────────────────────────────────────────────────────────
test('발견 기록 — 보유 엔트리에 누가·언제가 적히고, 방 등록부가 선다', () => {
  const { world, n } = nationOf(91);
  n.avatars.lord = { id: 'lord', name: '아린', x: 40, y: 41 };
  world.tick = 73;
  grantArtifact(n, 'star_chart', world.tick, data);
  artifactFoundEvent(world, n, 'star_chart', 'ruin', data, { avatarId: 'lord' });
  const owned = n.artifacts.find((a) => a.key === 'star_chart');
  assert.equal(owned.foundBy, '아린');
  assert.equal(owned.foundById, 'lord');
  assert.deepEqual(owned.foundDate, gameDate(73, data));
  assert.ok(Date.parse(owned.foundRealAt) > 0, '실제 날짜도 남는다');
  const reg = world.artifactRegistry.star_chart;
  assert.equal(reg.firstFoundBy, '아린');
  assert.equal(reg.firstFoundTick, 73);
  assert.equal(reg.count, 1);
});

test('등록부 — 최초 발견자는 덮어쓰지 않고 횟수만 쌓인다', () => {
  const { world, n } = nationOf(92);
  n.avatars.lord = { id: 'lord', name: '첫사람', x: 40, y: 41 };
  grantArtifact(n, 'swift_boots', 1, data);
  artifactFoundEvent(world, n, 'swift_boots', 'cache', data, { avatarId: 'lord' });
  n.avatars.two = { id: 'two', name: '나중사람', x: 40, y: 41 };
  recordArtifactFound(world, n, 'swift_boots', data, { avatarId: 'two' });
  const reg = world.artifactRegistry.swift_boots;
  assert.equal(reg.firstFoundBy, '첫사람', '먼저 찾은 이름은 바뀌지 않는다');
  assert.equal(reg.count, 2, '이 방에 나온 누적 횟수는 쌓인다');
  assert.equal(n.artifacts.find((a) => a.key === 'swift_boots').foundBy, '첫사람');
});

test('게임 달력 — tick 을 「N년 M일」로 옮긴다 (표시 전용)', () => {
  const per = data.balance.time.daysPerYear;
  assert.ok(per > 0);
  assert.deepEqual(gameDate(0, data), { year: 1, day: 1 });
  assert.deepEqual(gameDate(per - 1, data), { year: 1, day: per });
  assert.deepEqual(gameDate(per, data), { year: 2, day: 1 });
});

test('세이브 이관 — 옛 보유분에서 등록부를 역생성하되 이름은 지어내지 않는다', () => {
  const { world } = nationOf(93);
  const old = structuredClone(world);
  old.migrationRev = 0;
  delete old.artifactRegistry;
  old.nations.player.artifacts = [{ key: 'lucky_charm', obtainedTick: 12, consumed: false }];
  const m = migrateWorld(old, data);
  const reg = m.artifactRegistry.lucky_charm;
  assert.equal(reg.firstFoundBy, null, '전해지지 않은 이름은 빈칸으로 둔다');
  assert.equal(reg.firstFoundTick, 12, '얻은 날은 되살린다');
  assert.deepEqual(reg.firstFoundDate, gameDate(12, data));
  assert.deepEqual(m.nations.player.artifacts[0].foundDate, gameDate(12, data));
});

test('도감 유물 층 — 네 단이 서버에서 잘려 내려온다 (잠긴 단은 부재)', () => {
  const { world, n } = nationOf(94);
  const byKey = (v, k) => v.cards.find((c) => c.key === k);

  // 0단 — 아무것도 없을 때: 이름도 이야기도 없고 힌트만
  const v0 = artifactCodexView(world, n, data);
  const c0 = byKey(v0, 'banner_of_valor');
  assert.equal(c0.tier, 0);
  assert.equal(c0.name, undefined, '미발견 유물의 이름은 내려가지 않는다');
  assert.equal(c0.lore, undefined);
  assert.equal(c0.record, undefined);
  assert.ok(c0.hint && c0.color, '실루엣에 필요한 힌트와 등급색은 온다');

  // 1단 — 방에서 누가 찾았다(우리가 가진 것은 아니다)
  world.artifactRegistry = { banner_of_valor: { firstFoundBy: '이웃', firstFoundTick: 4, firstFoundDate: gameDate(4, data), count: 1 } };
  const c1 = byKey(artifactCodexView(world, n, data), 'banner_of_valor');
  assert.equal(c1.tier, 1);
  assert.equal(c1.name, '용맹의 깃발');
  assert.equal(c1.lore, undefined, '가지지 않은 것의 이야기는 아직 닫혀 있다');
  assert.equal(c1.record.firstFoundBy, '이웃');

  // 2·3단 — 우리가 가지면 효과·이야기가 열리고 기록이 붙는다
  n.avatars.lord = { id: 'lord', name: '아린', x: 40, y: 41 };
  grantArtifact(n, 'banner_of_valor', 9, data);
  artifactFoundEvent(world, n, 'banner_of_valor', 'ruin', data, { avatarId: 'lord' });
  const c3 = byKey(artifactCodexView(world, n, data), 'banner_of_valor');
  assert.equal(c3.tier, 3);
  assert.ok(c3.desc && c3.lore, '효과 전문과 이야기가 열린다');
  assert.equal(c3.owned, true);
  assert.equal(c3.record.firstFoundBy, '이웃', '최초 발견자는 그대로다');
  assert.ok(c3.record.myFoundDate && c3.record.myFoundRealAt);
});

test('도감 payload — 유물 층이 codex 에 실리고, 레전더리 단이 따로 있다', () => {
  const { world, n } = nationOf(95);
  assert.equal(codexView(n, data).artifacts, undefined, 'world 없이 부르면 칸 자체가 없다');
  const v = codexView(n, data, world).artifacts;
  assert.equal(v.cards.length, 71);
  assert.equal(v.crownGrade, 'legendary');
  assert.equal(v.cards.filter((c) => c.grade === 'legendary').length, 11, '왕가의 보물 — 원안 7 + R4 전설 4');
  assert.deepEqual(v.totals, { found: 0, owned: 0, total: 71 });
});

test('정보 비대칭 — /api/config 에는 이름도 이야기도 힌트도 없다 (도감이 여는 것)', () => {
  const cfg = publicConfig();
  assert.equal(cfg.artifacts.list.length, 71);
  for (const a of cfg.artifacts.list) {
    for (const secret of ['name', 'desc', 'lore', 'hint', 'effects']) {
      assert.equal(a[secret], undefined, `${a.key}.${secret} 가 규격으로 새어 나간다`);
    }
    assert.ok(a.key && a.grade && a.category, '화면이 그리는 데 필요한 것은 남는다');
  }
  // 등급표(이름·색·연출 급)는 화면이 그리는 규칙이라 그대로 간다
  assert.equal(cfg.artifacts.grades.legendary.name, '레전더리');
  assert.equal(cfg.artifacts.grades.legendary.fxTier, 4);
});

test('연대기 — 발견자를 알면 이름을 병기하고, 모르면 예전처럼 적는다', () => {
  const { world, n } = nationOf(96);
  n.avatars.lord = { id: 'lord', name: '아린', x: 40, y: 41 };
  const def = data.artifactsByKey.star_chart;
  grantArtifact(n, 'star_chart', 3, data);
  const found = artifactFoundEvent(world, n, 'star_chart', 'ruin', data, { avatarId: 'lord' });
  chronicleArtifact(world, found, { key: def.key, name: def.name, grade: def.grade, desc: def.desc }, data);
  const row = world.chronicle[world.chronicle.length - 1];
  assert.equal(row.kind, 'artifact');
  assert.ok(row.title.includes('아린') && row.title.includes(def.name), row.title);
  assert.equal(row.data.foundBy, '아린');

  const anon = artifactFoundEvent(world, n, 'swift_boots', 'chest', data);
  chronicleArtifact(world, anon, { key: 'swift_boots', name: '신속의 신발', desc: 'x' }, data);
  const row2 = world.chronicle[world.chronicle.length - 1];
  assert.equal(row2.title, '신속의 신발', '나라의 발견은 이름 없이 적는다');
});

// ────────────────────────────────────────────────────────────────
// ★ §20-R4 — 신규 콘텐츠 축 (유물기획 §20-3~6 · §20-9 · §20-11)
// ────────────────────────────────────────────────────────────────

test('★ §20-R4 dropPool — 세 옛 풀의 명단이 R4 이후에도 한 글자도 안 바뀐다', () => {
  const { world, n } = nationOf(4201);
  for (const via of ['chest', 'ruin', 'cache']) {
    for (const grade of ['common', 'rare', 'unique', 'legendary']) {
      const pool = dropPool(world, n, data, grade, via).map((a) => a.key).sort();
      // 옛 50종 중 그 경로를 적은 것만 — 신규는 한 톨도 없다
      const want = data.artifacts.list
        .filter((a) => a.grade === grade && (a.acquireVia || []).includes(via) && !R4_KEYS.includes(a.key))
        .map((a) => a.key).sort();
      assert.deepEqual(pool, want, `${via}/${grade} 풀이 흔들렸다`);
      for (const k of pool) assert.ok(!R4_KEYS.includes(k), `${k} 가 ${via} 로 샌다`);
    }
  }
});

test('★ §20-R4 방 유일 — 이미 나온 전설은 그 방의 어느 풀에도 다시 안 나온다', () => {
  const { world, n } = nationOf(4202);
  // 전설은 애초에 상자 밖이므로 cache3 풀로 잰다(경로가 있는 유일한 자리)
  const before = dropPool(world, n, data, 'legendary', 'temple').map((a) => a.key);
  assert.ok(before.includes('eye_of_aros'), '아직 아무도 못 찾았다');
  world.artifactRegistry = { eye_of_aros: { firstFoundBy: '이웃', count: 1 } };
  const after = dropPool(world, n, data, 'legendary', 'temple').map((a) => a.key);
  assert.ok(!after.includes('eye_of_aros'), '방에 단 하나 — 두 번은 없다');
});

test('★ §20-R4 링3 고유 굴림 — 링3 밖에서는 굴리지도 않는다', () => {
  const { world, n } = nationOf(4203);
  for (const ring of [0, 1, 2]) {
    assert.equal(rollRing3Unique(world, n, data, createRng(1), ring), null, `링${ring} 은 굴림 자체가 없다`);
  }
  // 링3 에서는 확률만큼 나오고, 나온 것은 반드시 cache3 를 적은 신규 고유다
  let hit = null;
  for (let i = 0; i < 400 && !hit; i += 1) hit = rollRing3Unique(world, n, data, createRng(i), 3);
  assert.ok(hit, '400번 안에는 한 번 나온다(5%)');
  const def = data.artifactsByKey[hit];
  assert.equal(def.grade, 'unique');
  assert.ok(def.acquireVia.includes('cache3'), '링3 궤가 낼 수 있다고 제 입으로 적은 것만');
});

test('★ §20-R4 세트 — 조각 수만큼 문턱이 **누적**된다(4개면 2개 보너스도 산다)', () => {
  const { n } = nationOf(4204);
  const pieces = data.artifacts.sets.genesis.pieces;
  grantArtifact(n, pieces[0], 1, data);
  assert.equal(collectHooks(n, data).sets.genesis.tiers.length, 0, '1개로는 아무 문턱도 못 넘는다');
  grantArtifact(n, pieces[1], 1, data);
  const h2 = collectHooks(n, data);
  assert.deepEqual(h2.sets.genesis.tiers, [2]);
  assert.ok(Math.abs((h2.outputBonus['*'] || 0) - 0.1) < 1e-9, '전 자원 +10%');
  assert.equal(h2.emotionDayMultiplier, 1, '4개 보너스는 아직');
  grantArtifact(n, pieces[2], 1, data);
  grantArtifact(n, pieces[3], 1, data);
  const h4 = collectHooks(n, data);
  assert.deepEqual(h4.sets.genesis.tiers, [2, 4], '2개 문턱이 사라지지 않는다');
  assert.ok(Math.abs((h4.outputBonus['*'] || 0) - 0.1) < 1e-9, '2개 보너스는 그대로 산다');
  assert.equal(h4.emotionDayMultiplier, 2, '감정의 날 2배');
  assert.ok(h4.surgeMultiplier < 1, '웨이브 규모가 줄어든다');
});

test('★ §20-R4 저주 봉인 — 효과는 꺼지고 기록·세트 셈은 남는다, 값은 골드로 치른다', () => {
  const { n } = nationOf(4205);
  grantArtifact(n, 'reapers_scythe', 1, data);
  assert.equal(collectHooks(n, data).attackMultiplier, 2, '들면 두 배');
  n.gold = 10;
  assert.equal(sealArtifact(n, 'reapers_scythe', data, true).ok, false, '골드가 없으면 못 봉인한다');
  n.gold = 1000;
  const r = sealArtifact(n, 'reapers_scythe', data, true);
  assert.equal(r.ok, true);
  assert.equal(n.gold, 1000 - CFG.sealCostGold);
  assert.equal(collectHooks(n, data).attackMultiplier, 1, '힘이 꺼졌다');
  assert.equal(collectHooks(n, data).moraleDelta, 0, '값도 함께 꺼진다');
  assert.ok(n.artifacts.find((a) => a.key === 'reapers_scythe'), '기록은 남는다 — 파기가 아니다');
  assert.equal(sealArtifact(n, 'horn_of_plenty', data, true).code, 'NOT_OWNED', '안 가진 것은 못 봉인한다');
  // 되돌릴 수 있다 — 「낄까 말까」가 한 번뿐이면 실험이 아니라 도박이다
  assert.equal(sealArtifact(n, 'reapers_scythe', data, false).ok, true);
  assert.equal(collectHooks(n, data).attackMultiplier, 2);
});

/* ★ 4단계(2026-08-10) — 봉인이 저주 전용에서 **모든 유물**로 넓어졌다(착용/해제의 1차 대체).
   여기서 못 박는 것은 둘이다: ① 여느 유물도 끌 수 있다 ② 그 값은 공짜다(끄는 것이 손해라
   값을 물릴 까닭이 없다). 저주만 값을 무는 옛 약속(§20-6)은 위 시험이 그대로 지킨다. */
test('★ 4단계 봉인 확장 — 저주가 아닌 유물도 봉인하면 효과가 꺼지고, 값은 들지 않는다', () => {
  const { n } = nationOf(4205.1);
  grantArtifact(n, 'lucky_charm', 1, data);
  const bonus = collectHooks(n, data).discoverChanceBonus;
  assert.ok(bonus > 0, '들면 발견 확률이 오른다');
  n.gold = 500;
  const r = sealArtifact(n, 'lucky_charm', data, true);
  assert.equal(r.ok, true, '저주가 아니어도 봉인한다');
  assert.equal(r.cost, CFG.sealCostGoldPlain, '일반 봉인 값은 balance 의 다이얼이다');
  assert.equal(n.gold, 500 - CFG.sealCostGoldPlain, '공짜면 국고가 줄지 않는다');
  assert.equal(collectHooks(n, data).discoverChanceBonus, 0, '집계에서 빠졌다');
  assert.ok(n.artifacts.find((a) => a.key === 'lucky_charm'), '기록은 남는다 — 파기가 아니다');
  assert.equal(sealArtifact(n, 'lucky_charm', data, true).code, 'ALREADY', '두 번 봉인하지 않는다');
  assert.equal(sealArtifact(n, 'lucky_charm', data, false).ok, true, '언제든 되돌린다');
  assert.equal(collectHooks(n, data).discoverChanceBonus, bonus, '풀면 옛 힘 그대로');
});

test('★ 4단계 봉인 — 잠든 유물은 손으로도 못 쓴다(효과만 끄면 약속이 반만 참이 된다)', () => {
  const { n } = nationOf(4205.2);
  grantArtifact(n, 'horn_of_plenty', 1, data);
  n.gold = 500;
  assert.equal(sealArtifact(n, 'horn_of_plenty', data, true).ok, true);
  assert.equal(useArtifact(n, 'horn_of_plenty', 2, data).code, 'SEALED', '봉인 중에는 못 쓴다');
  assert.equal(sealArtifact(n, 'horn_of_plenty', data, false).ok, true);
  assert.equal(useArtifact(n, 'horn_of_plenty', 3, data).ok, true, '풀면 다시 쓴다');
});

test('★ §20-R4 봉인해도 세트는 안 깨진다 — 봉인이 실질적 파기가 되면 §20-6 의 약속이 거짓이 된다', () => {
  const { n } = nationOf(4206);
  for (const k of data.artifacts.sets.expedition.pieces) grantArtifact(n, k, 1, data);
  assert.deepEqual(collectHooks(n, data).sets.expedition.tiers, [3]);
  n.artifacts.find((a) => a.key === 'broken_pickaxe').sealed = true;
  assert.deepEqual(collectHooks(n, data).sets.expedition.tiers, [3], '조각 수는 보유 기준');
});

test('★ §20-R4 설치형 — 심기 전에는 아무 일도 없고, 심어도 다 자라야 제 값을 낸다', () => {
  const { world, n } = nationOf(4207);
  grantArtifact(n, 'worldtree_seed', 1, data);
  assert.equal(Object.keys(auraDeptBonus(world, n, data)).length, 0, '들고만 있으면 씨앗은 씨앗이다');
  const town = townOf(world, n.id);
  assert.equal(plantArtifact(world, n, 'worldtree_seed', 9e9, 0, data).ok, false, '지도 밖에는 못 심는다');
  assert.equal(plantArtifact(world, n, 'worldtree_seed', town.x + 2, town.y, data).ok, true);
  assert.equal(plantArtifact(world, n, 'worldtree_seed', town.x, town.y, data).ok, false, '두 번은 못 심는다');
  assert.equal(auraDeptBonus(world, n, data).farm ?? 0, 0, '심은 날은 0단계');
  const eff = data.artifactsByKey.worldtree_seed.effects[0];
  growPlanted(n, 1 + eff.growthDays * eff.growthStages, data);
  assert.ok(Math.abs(auraDeptBonus(world, n, data).farm - eff.delta) < 1e-9, '다 자라면 제 값');
});

test('★ §20-R4 tyrantPick — 고른 자리가 오른다(R1 의 「최고 레벨 자동 선택」 빚을 갚는다)', () => {
  const { world, n } = nationOf(4208);
  openChapterForDebug(world, n, data, 10);
  const roles = Object.keys(n.roles).filter((k) => n.roles[k].holder);
  assert.ok(roles.length >= 2, '역할이 둘은 있어야 고르는 의미가 있다');
  const pick = roles[roles.length - 1];
  for (const k of roles) n.roles[k].level = 1;
  n.roles[roles[0]].level = 9;                       // 예전 규칙이라면 이쪽이 뽑혔을 것이다
  assert.equal(applyCommand(world, n.id, { type: 'tyrantPick', role: pick }, data, createRng(1)).ok, true);
  grantArtifact(n, 'tyrants_crown', 1, data);
  useArtifact(n, 'tyrants_crown', 1, data);
  assert.equal(n.roles[pick].level, data.roles.xp.levelCurve.length - 1, '내가 고른 자리가 올랐다');
  assert.equal(n.pendingTyrantRole, null, '고른 자리는 쓴 즉시 비운다');
});

test('★ §20-R4 명령 3종 — 서버가 다시 잰다(화면이 보낸 말은 믿지 않는다)', () => {
  const { world, n } = nationOf(4209);
  const run = (cmd) => applyCommand(world, n.id, cmd, data, createRng(1));
  assert.equal(run({ type: 'sealArtifact', key: 'reapers_scythe' }).ok, false, '없는 것은 못 봉인한다');
  assert.equal(run({ type: 'plantArtifact', key: 'worldtree_seed', x: 1, y: 1 }).ok, false, '없는 것은 못 심는다');
  assert.equal(run({ type: 'tyrantPick', role: '없는역할' }).ok, false);
  assert.equal(run({ type: 'plantArtifact', key: 'horn_of_plenty', x: 1, y: 1 }).error.code, 'NOT_INSTALLABLE');
});

test('★ §20-R4 세이브 이관 — 옛 유물에 봉인·설치 칸이 열린다(rev 8)', () => {
  const { world, n } = nationOf(4210);
  grantArtifact(n, 'horn_of_plenty', 3, data);
  delete n.artifacts[0].sealed;
  delete n.artifacts[0].planted;
  world.migrationRev = 5;
  const m = migrateWorld(world, data);
  assert.equal(m.migrationRev, 8);
  assert.equal(m.nations.player.artifacts[0].sealed, false, '없던 것을 있다고 적지 않는다');
  assert.equal(m.nations.player.artifacts[0].planted, null);
});

test('★ §20-R4 종별 누적 피해 — 도감 처치 수가 곧 전투력이 된다', () => {
  const { n } = nationOf(4211);
  assert.equal(speciesDamageMultiplier(n, 'wolf'), 1, '유물이 없으면 배수도 없다');
  grantArtifact(n, 'hunters_oath', 1, data);
  mirrorArtifactHooks(n, collectHooks(n, data));
  const e = data.artifactsByKey.hunters_oath.effects[0];
  n.codex = { species: { wolf: { kills: 5 } } };
  assert.ok(Math.abs(speciesDamageMultiplier(n, 'wolf') - (1 + e.perKill * 5)) < 1e-9);
  n.codex.species.wolf.kills = 10000;
  assert.ok(Math.abs(speciesDamageMultiplier(n, 'wolf') - (1 + e.cap)) < 1e-9, '상한이 있다');
  assert.equal(speciesDamageMultiplier(n, 'boar'), 1, '종별로 따로 쌓인다');
});

test('★ §20-R4 부활 충전 — 웨이브당 정해진 횟수만, 그리고 되감긴다', () => {
  const { n } = nationOf(4212);
  grantArtifact(n, 'sigil_of_aros', 1, data);
  mirrorArtifactHooks(n, collectHooks(n, data));
  resetReviveCharges(n);
  assert.equal(n.artifactReviveLeft, 1);
  assert.equal(consumeRevive(n), true);
  assert.equal(consumeRevive(n), false, '한 웨이브에 한 번뿐이다');
  resetReviveCharges(n);
  assert.equal(consumeRevive(n), true, '다음 웨이브에는 다시 선다');
});

// ────────────────────────────────────────────────────────────────
// ★ §20-R4b 고대 신전 (유물기획 §20-9) — 자리가 신전을 정하고, 세 단을 차례로 지난다
// ────────────────────────────────────────────────────────────────
test('★ §20-R4e 신전 — 설정된 종류는 가능한 지형마다 가장 깊은 곳 하나다', () => {
  const { world, n } = nationOf(4301);
  const t = townOf(world, n.id);
  const picked = templeNodes(world, n, data);
  const configured = data.ruins.temple.kinds.map((k) => k.id).sort();
  const selected = Object.keys(picked).sort();
  assert.equal(configured.length, 10, '신전은 정확히 10종이다');
  assert.ok(selected.length > 0 && selected.every((id) => configured.includes(id)),
    '현재 지도에서 성립하는 신전만 설정 목록 안에서 골린다');

  const ruins = (world.map.nodes || []).filter((x) => x.type === 'ruin');
  const temples = ruins.filter((r) => templeKindAt(world, n, r, data));
  assert.equal(temples.length, selected.length, `유적 ${ruins.length}곳에서 신전 노드는 겹치지 않는다`);

  for (const p of Object.values(picked)) {
    assert.equal(templeKindAt(world, n, p.node, data).id, p.kind.id);
    assert.ok(p.d > 100, '신전은 아주 먼 곳에 있다');
  }
  for (const r of ruins.filter((x) => Math.hypot(t.x - x.x, t.y - x.y) < 60)) {
    assert.equal(templeKindAt(world, n, r, data), null, '앞마당의 자취는 신전이 아니다');
  }
});

test('★ §20-R4e 신전 — 문은 발이 연다: 곁에 서야 열린다', () => {
  const { world, n } = nationOf(4304);
  const far = Object.values(templeNodes(world, n, data))[0].node;
  const t = townOf(world, n.id);
  assert.ok(Math.hypot(t.x - far.x, t.y - far.y) > 100, '어전 행동이 닿는 반경 밖이다');

  n.avatars = { lord: { x: t.x, y: t.y } };
  assert.equal(enterTemple(world, n, 'lord', far.id, data).code, 'OUT_OF_RANGE', '멀리서는 못 연다');
  n.avatars.lord = { x: far.x + 1, y: far.y };
  const r = enterTemple(world, n, 'lord', far.id, data);
  assert.ok(r.ok, '곁에 서면 열린다');
  assert.equal(r.card.temple.stage, 'riddle');
  enterTemple(world, n, 'lord', far.id, data);
  assert.equal((n.decisionQueue || []).filter((d) => d.decisionId === r.card.decisionId).length, 1,
    '두 번 두드려도 안건은 하나다');
});

test('★ §20-R4b 신전 — 수수께끼 → 시련 → 안치소를 차례로만 지난다', () => {
  const { world, n } = nationOf(4302);
  const far = Object.values(templeNodes(world, n, data))[0].node;

  const card = templeCard(world, n, far, data);
  assert.equal(card.temple.stage, 'riddle');
  assert.equal(card.kind, data.ruins.temple.decisionKind);
  assert.equal(card.optionLabels.length, card.options.length, '한국어 라벨을 서버가 들고 간다');

  const answer = templeAnswer(world, far, data);
  const wrong = data.ruins.temple.riddle.options.map((o) => o.key).find((k) => k !== answer);
  assert.equal(resolveTempleChoice(world, n, { temple: card.temple }, wrong, data).result.passed, false);
  assert.equal(templeCard(world, n, far, data), null, '재도전까지는 문이 닫힌다');
  world.tick += data.balance.artifacts.templeRetryDays;

  assert.equal(resolveTempleChoice(world, n, { temple: card.temple }, answer, data).result.passed, true);
  const trial = templeCard(world, n, far, data);
  assert.equal(trial.temple.stage, 'trial', '수수께끼를 풀어도 안치소가 바로 열리지 않는다');
  const fought = resolveTempleChoice(world, n, { temple: trial.temple }, 'fight', data);
  assert.ok(fought.result.guardianId, '지키는 것이 그 자리에 선다');
  assert.equal(templeCard(world, n, far, data).temple.stage, 'trial', '눕히기 전에는 안 열린다');

  n.wild.creatures = n.wild.creatures.filter((c) => c.id !== fought.result.guardianId);
  const vault = templeCard(world, n, far, data);
  assert.equal(vault.temple.stage, 'vault');
  const taken = resolveTempleChoice(world, n, { temple: vault.temple }, 'take', data);
  assert.equal(taken.result.passed, true);
  const got = data.artifactsByKey[taken.result.artifact];
  assert.ok(got && !got.acquireVia.includes('chest'), '상자 밖의 것이 나온다');
  assert.ok(['legendary', 'unique'].includes(got.grade), '신전은 전설이 먼저다');
  assert.equal(templeCard(world, n, far, data), null, '한 번 연 신전은 닫힌다');
});

test('★ §20-R4b 신전 — 이미 나온 전설은 다시 내어주지 않는다(방에 하나)', () => {
  const { world, n } = nationOf(4303);
  // 신전마다 내어주는 것이 다르다 — 설산은 얼어붙은 왕의 홀, 밀림은 성배, 들판은 아로스의 눈
  assert.deepEqual(dropPool(world, n, data, 'legendary', 'temple:snow').map((a) => a.key),
    ['frozen_kings_scepter']);
  assert.deepEqual(dropPool(world, n, data, 'legendary', 'temple:jungle').map((a) => a.key),
    ['chalice_of_aqua']);
  const legend = dropPool(world, n, data, 'legendary', 'temple');
  assert.ok(legend.length >= 1, '신전이 내어줄 전설이 있다');
  world.artifactRegistry = { [legend[0].key]: { firstFoundBy: '이웃', firstFoundTick: 1, count: 1 } };
  const after = dropPool(world, n, data, 'legendary', 'temple').map((a) => a.key);
  assert.ok(!after.includes(legend[0].key), '한 번 나온 전설은 후보에서 빠진다');
});
