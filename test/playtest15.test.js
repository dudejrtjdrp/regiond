// §15 플레이테스트 피드백 4차 — 터렛·전투(§15-A)와 건설 UX(§15-B) 회귀
//
// 이 파일이 붙드는 것은 딱 하나다: **터렛이 실제로 때린다**.
// P0 은 "안 때린다"가 아니라 "때리는 코드가 웨이브에만 있었다"였다(ecology.js 머리말의 실측표).
// 그래서 검사도 웨이브 밖에서 잰다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { openChapterForDebug, buildingUnlocked, buildingUnlockInfo } from '../server/engine/progression.js';
import {
  completeStructure, turretList, footprint, publicBuildings, buildingKeys, effectSummary,
} from '../server/engine/structures.js';
import { townOf, territoryRadius, dist } from '../server/engine/world.js';
import {
  ensureCreatures, ensureWild, stepEcology, turretGuard, guardCfg, ranchOpenFor,
} from '../server/engine/ecology.js';
import { storageLimit } from '../server/engine/storage.js';

const data = loadGameData();
const SEED = 20260805;

/** 7장을 연 티어 3 정착지 하나 */
function town(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '터렛' });
  const nation = world.nations.player;
  openChapterForDebug(null, nation, data, opts.chapter ?? 7);
  nation.tier = opts.tier ?? 3;
  return { world, nation, t: townOf(world, 'player'), R: territoryRadius(nation, data) };
}

/** 경계 안쪽에 터렛 한 기 — §15-A 의 표준 배치(사거리 원이 가르치는 자리) */
function putTurret(world, nation, key, tier, dx, dy) {
  const t = townOf(world, nation.id);
  return completeStructure(world, nation, {
    building: key, tier, x: Math.round(t.x + dx), y: Math.round(t.y + dy), placed: true,
  }, data);
}

/** 이 자리에 짐승 하나를 손으로 놓는다(난수를 축내지 않는다) */
function placeCreature(nation, sp, x, y, extra = {}) {
  const w = ensureWild(nation);
  const def = data.creatures.defs[sp];
  const c = {
    id: `t${w.nextId++}`, sp, x, y, tx: x, ty: y,
    hp: def.hp, maxHp: def.hp, ring: 0, state: 'wander',
    retarget: 999, atkCd: 0, provoked: 0, seen: false, ...extra,
  };
  w.creatures.push(c);
  return c;
}

// ────────────────────────────────────────────────────────────────
// §15-A-1 · P0
// ────────────────────────────────────────────────────────────────
test('★ §15-A-1 P0 — 웨이브가 아닌 시간에도 터렛이 사거리 안의 것을 때린다', () => {
  const { world, nation, t, R } = town();
  putTurret(world, nation, 'arrow_tower', 1, R - 2, 0);
  const [turret] = turretList(nation, data);
  const wolf = placeCreature(nation, 'wolf', turret.x + turret.range - 1, turret.y);
  const hp0 = wolf.hp;

  const r = turretGuard(world, nation, data, 1);
  assert.equal(r.shots.length, 1, '한 걸음에 한 발');
  assert.ok(wolf.hp < hp0, `체력이 깎여야 한다 (${hp0} → ${wolf.hp})`);
  assert.equal(r.shots[0].targetId, wolf.id);
  assert.ok(dist(r.shots[0].x, r.shots[0].y, t.x, t.y) > 0);
});

test('★ §15-A-1 사거리 밖은 건드리지 않는다', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 1, R - 2, 0);
  const [turret] = turretList(nation, data);
  const far = placeCreature(nation, 'deer', turret.x + turret.range + 3, turret.y);
  const r = turretGuard(world, nation, data, 1);
  assert.equal(r.shots.length, 0);
  assert.equal(far.hp, data.creatures.defs.deer.hp);
});

test('★ §15-A-1 stepEcology 가 사격 결과를 함께 내놓는다 (1초 루프에 편승)', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 1, R - 2, 0);
  const [turret] = turretList(nation, data);
  placeCreature(nation, 'wolf', turret.x + 2, turret.y);
  const r = stepEcology(world, nation, data, 1);
  assert.ok(Array.isArray(r.shots) && r.shots.length >= 1, 'stepEcology 가 shots 를 돌려준다');
  assert.ok(Array.isArray(r.kills));
});

test('★ §15-A-1 웨이브 중에는 쉰다 — 사격을 두 번 세지 않는다', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 1, R - 2, 0);
  const [turret] = turretList(nation, data);
  const wolf = placeCreature(nation, 'wolf', turret.x + 2, turret.y);
  nation.battle = { over: false, enemies: [], t: 0 };
  const r = turretGuard(world, nation, data, 1);
  assert.equal(r.shots.length, 0);
  assert.equal(wolf.hp, data.creatures.defs.wolf.hp);
});

test('★ §15-A-1 상한 — 한 걸음에 maxShotsPerStep 발을 넘지 않는다(일 틱이 하루치를 몰아 돌려도)', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 1, R - 2, 0);
  const [turret] = turretList(nation, data);
  for (let i = 0; i < 12; i += 1) placeCreature(nation, 'chicken', turret.x + 1, turret.y + (i % 3));
  const r = turretGuard(world, nation, data, data.creatures.sim.dayStepSeconds);
  assert.ok(r.shots.length <= guardCfg(data).maxShotsPerStep,
    `${r.shots.length} ≤ ${guardCfg(data).maxShotsPerStep}`);
});

// ────────────────────────────────────────────────────────────────
// §15-A-2 드롭
// ────────────────────────────────────────────────────────────────
test('★ §15-A-2 처치 드롭이 그 자리에서 국고에 들어간다', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 3, R - 2, 0);
  const [turret] = turretList(nation, data);
  const meat0 = nation.resources.meat || 0;
  /* ★ 2단계B — 성나지 않은 온순종은 이제 표적이 아니다(turretGuard.spareAnimals).
     이 검사가 붙드는 것은 「잡으면 드롭이 국고로 간다」이지 「닭을 쏜다」가 아니므로,
     사람이 먼저 건드린 닭(provoked)으로 같은 길을 지나간다. */
  const chicken = placeCreature(nation, 'chicken', turret.x + 1, turret.y, { provoked: 60 });
  let kills = [];
  for (let i = 0; i < 6 && !kills.length; i += 1) kills = turretGuard(world, nation, data, 1).kills;
  assert.equal(kills.length, 1, '닭 한 마리는 곧 잡힌다');
  assert.equal(kills[0].species, 'chicken');
  assert.ok(nation.resources.meat > meat0, `국고 고기 ${meat0} → ${nation.resources.meat}`);
  assert.ok(kills[0].gained.meat > 0, '뜬 수치와 들어간 몫이 같은 값이다');
  assert.equal(kills[0].x, chicken.x, '뜨는 자리는 그 짐승이 쓰러진 자리');
  assert.ok(!ensureWild(nation).creatures.includes(chicken), '잡힌 것은 목록에서 빠진다');
});

test('★ §15-A-2 드롭도 저장 상한을 지킨다 — 가득 찬 곳간은 한 톨도 더 안 받는다', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 3, R - 2, 0);
  const [turret] = turretList(nation, data);
  nation.resources.meat = storageLimit(nation, data);
  const before = nation.resources.meat;
  // ★ 2단계B — 성난 닭으로 잰다(위 검사와 같은 까닭)
  placeCreature(nation, 'chicken', turret.x + 1, turret.y, { provoked: 60 });
  let kills = [];
  for (let i = 0; i < 6 && !kills.length; i += 1) kills = turretGuard(world, nation, data, 1).kills;
  assert.equal(kills.length, 1);
  assert.equal(nation.resources.meat, before, '뚜껑을 넘지 않는다');
  assert.ok(!kills[0].gained.meat, '못 들어간 것은 뜨지도 않는다');
});

test('★ §15-A-2 도감 — 터렛이 잡은 것도 조우·처치로 적힌다', () => {
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 3, R - 2, 0);
  const [turret] = turretList(nation, data);
  // ★ 2단계B — 성난 닭으로 잰다(위 검사와 같은 까닭)
  placeCreature(nation, 'chicken', turret.x + 1, turret.y, { provoked: 60 });
  for (let i = 0; i < 6; i += 1) turretGuard(world, nation, data, 1);
  const entry = nation.codex?.species?.chicken;
  assert.ok(entry, '도감에 줄이 생긴다');
  assert.ok((entry.kills || 0) >= 1, '처치가 적힌다');
});

// ────────────────────────────────────────────────────────────────
// §15-A-3 목장 보호
// ────────────────────────────────────────────────────────────────
test('★ §15-A-3 목장 반경 안의 온순한 짐승은 쏘지 않는다', () => {
  const { world, nation, t } = town({ tier: 4 });
  const ranch = completeStructure(world, nation,
    { building: 'ranch', tier: 1, x: t.x + 3, y: t.y + 3, placed: true }, data);
  assert.ok(ranch, '목장이 선다');
  putTurret(world, nation, 'arrow_tower', 3, 3, 6);
  const [turret] = turretList(nation, data);
  // 목장 한복판의 양 — 터렛 사거리 안이지만 가축이다
  const fp = footprint('ranch', data);
  const sheep = placeCreature(nation, 'sheep',
    Math.round(t.x + 3 + (fp.w - 1) / 2), Math.round(t.y + 3 + (fp.h - 1) / 2));
  assert.ok(dist(sheep.x, sheep.y, turret.x, turret.y) <= turret.range, '사거리 안에 있다');
  assert.ok(ranchOpenFor(world, nation, data, 'sheep', sheep.x, sheep.y), '목장이 연 자리다');

  const r = turretGuard(world, nation, data, 1);
  assert.equal(r.shots.length, 0, '가축은 안 쏜다');
  assert.equal(sheep.hp, data.creatures.defs.sheep.hp);
});

test('★ §15-A-3 목장 안이라도 사나운 것은 쏜다 · ★ 2단계B 목장 밖 온순한 짐승은 성나야 쏜다', () => {
  const { world, nation, t } = town({ tier: 4 });
  completeStructure(world, nation, { building: 'ranch', tier: 1, x: t.x + 3, y: t.y + 3, placed: true }, data);
  putTurret(world, nation, 'arrow_tower', 3, 3, 6);
  const [turret] = turretList(nation, data);
  const wolf = placeCreature(nation, 'wolf', Math.round(t.x + 3), Math.round(t.y + 3));
  const r1 = turretGuard(world, nation, data, 1);
  assert.equal(r1.shots.length, 1, '포식자는 목장이 있어도 표적이다');
  assert.equal(r1.shots[0].targetId, wolf.id);
  assert.ok(wolf.hp < data.creatures.defs.wolf.hp);

  /* ★ 2단계B — 목장에서 먼 자리의 양. 옛 계약은 「목장이 없으면 온순한 짐승도 표적이다」였는데,
     그 규칙은 짐승이 영토 밖에만 살던 시절의 것이다. 온순종이 마을 안까지 들어오게 된 지금
     그대로 두면 터렛이 하루 종일 양을 잡는다 — 이제는 **성이 나야** 쏜다. */
  const { world: w2, nation: n2, R } = town();
  putTurret(w2, n2, 'arrow_tower', 1, R - 2, 0);
  const [t2] = turretList(n2, data);
  const sheep = placeCreature(n2, 'sheep', t2.x + 1, t2.y);
  let quiet = 0;
  for (let i = 0; i < 6; i += 1) quiet += turretGuard(w2, n2, data, 1).shots.length;
  assert.equal(quiet, 0, '성나지 않은 온순한 짐승은 표적이 아니다');
  assert.equal(sheep.hp, data.creatures.defs.sheep.hp, '한 대도 안 맞는다');

  sheep.provoked = 60;                       // 사람이 먼저 건드렸다 — 덤비는 것에는 방어가 필요하다
  let angry = 0;
  for (let i = 0; i < 4 && !angry; i += 1) angry += turretGuard(w2, n2, data, 1).shots.length;
  assert.ok(angry >= 1, '성이 나면 쏜다');
  assert.ok(sheep.hp < data.creatures.defs.sheep.hp);
});

// ────────────────────────────────────────────────────────────────
// §15-A-4 사거리 (계약)
// ────────────────────────────────────────────────────────────────
test('★ §15-A-4 사거리 원의 재료 — 클라 도감에 터렛 제원이 실린다', () => {
  const pub = publicBuildings(data);
  for (const key of ['arrow_tower', 'ballista', 'cannon']) {
    const def = pub.defs[key];
    assert.ok(def, `${key} 가 도감에 있다`);
    for (const t of def.tiers) {
      assert.ok(t.turret && t.turret.range > 0 && t.turret.dps > 0,
        `${key} T${t.tier} 에 사거리·화력이 실린다`);
    }
  }
});

test('★ §15-A-4 터렛 좌표는 중심이다 — 두 칸을 넘는 터렛도 제자리에서 쏜다', () => {
  const { world, nation, t } = town({ tier: 5, chapter: 9 });
  const s = completeStructure(world, nation,
    { building: 'ballista', tier: 1, x: t.x + 6, y: t.y, placed: true }, data);
  const [turret] = turretList(nation, data);
  const fp = footprint('ballista', data);
  assert.equal(turret.x, s.x + (fp.w - 1) / 2);
  assert.equal(turret.y, s.y + (fp.h - 1) / 2);
  assert.equal(turret.ax, s.x, '앵커도 함께 실린다(그림이 쓰는 값)');
});

// ────────────────────────────────────────────────────────────────
// §15-A-5 3종 동시 개방
// ────────────────────────────────────────────────────────────────
test('★ §15-A-5 터렛 3종이 7장에서 함께 열린다', () => {
  const { nation } = town({ chapter: 7 });
  for (const key of ['arrow_tower', 'ballista', 'cannon']) {
    assert.ok(buildingUnlocked(nation, key, data), `${key} 가 7장에 열린다`);
  }
});

test('★ §15-A-5 6장에서는 셋 다 잠겨 있고, 조건 글이 「7장」을 가리킨다', () => {
  const { nation } = town({ chapter: 6 });
  for (const key of ['arrow_tower', 'ballista', 'cannon']) {
    assert.equal(buildingUnlocked(nation, key, data), false, `${key} 는 6장에 없다`);
    const info = buildingUnlockInfo(nation, key, data);
    assert.equal(info.kind, 'chapter');
    assert.equal(info.chapter, 7, `${key} 의 조건 글이 7장을 가리킨다`);
    assert.match(info.text, /^7장/);
  }
});

test('★ §15-A-5 셋 다 7장 살림으로 지을 수 있다 — 강철을 요구하지 않는다', () => {
  for (const key of ['arrow_tower', 'ballista', 'cannon']) {
    const cost = data.buildings[key].tiers[0].cost || {};
    assert.ok(!cost.steel, `${key} 1단계는 강철을 안 쓴다(제련소는 9장이다)`);
  }
});

test('★ §15-A-5 셋의 성격이 실제로 다르다 — 사거리·화력·상성', () => {
  const t = (k) => data.buildings[k].tiers[0].turret;
  assert.ok(t('ballista').range > t('arrow_tower').range, '노포가 가장 멀리 쏜다');
  assert.ok(t('cannon').range < t('arrow_tower').range, '화포가 가장 짧게 쏜다');
  assert.ok(t('cannon').dps > t('ballista').dps && t('ballista').dps > t('arrow_tower').dps,
    '한 방의 세기는 화포 > 노포 > 화살탑');
  // 상성에 **야생 종**이 들어 있어야 상시 사격에서 그 성격이 값어치를 낸다
  const defs = data.creatures.defs;
  for (const key of ['arrow_tower', 'ballista', 'cannon']) {
    const wild = (data.buildings[key].counters || []).filter((c) => defs[c]);
    assert.ok(wild.length > 0, `${key} 의 상성에 야생 종이 있다: ${wild.join(',')}`);
  }
});

// ────────────────────────────────────────────────────────────────
// §15-B 건설 UX
// ────────────────────────────────────────────────────────────────
test('★ §15-B-2 전 건물에 「왜 짓는가」 한 줄이 있다', () => {
  let n = 0;
  for (const key of buildingKeys(data)) {
    const def = data.buildings[key];
    assert.ok(def.purpose && def.purpose.length >= 8, `${key} 에 purpose 가 있다`);
    assert.ok(!/DPS|버프|스탯|파라미터|버전/.test(def.purpose), `${key} purpose 에 개발자 말이 없다`);
    n += 1;
  }
  assert.ok(n >= 30, `${n}채`);
});

test('★ §15-B-2 카드가 읽는 자리에 purpose 와 핵심 수치가 실린다', () => {
  const pub = publicBuildings(data);
  assert.equal(pub.defs.granary.purpose, data.buildings.granary.purpose);
  // 저장 계열의 핵심 수치는 「얼마나 더 쌓이나」다 — 예전에는 표가 통째로 비어 있었다
  const crate = effectSummary('storage_crate', 1, data);
  assert.ok(crate.some((e) => e.label === '저장 상한'), '저장 궤짝 표가 더 이상 비어 있지 않다');
  const crate2 = effectSummary('storage_crate', 2, data);
  assert.ok(Number(crate2[0].value.replace('+', '')) > Number(crate[0].value.replace('+', '')),
    '티어가 오르면 몫도 오른다');
});

test('★ §15-B-2 서버 뷰(buildable·lockedBuildings)가 purpose·keyFacts 를 함께 낸다', async () => {
  const { buildNationView } = await import('../server/engine/view.js');
  const { world, nation } = town({ chapter: 7 });
  const v = buildNationView(world, 'player', null, data, { avatarId: 'lord' });
  const cards = [...(v.nation.buildable || []), ...(v.nation.lockedBuildings || [])];
  assert.ok(cards.length > 0);
  for (const c of cards) {
    assert.ok(c.purpose, `${c.key} 카드에 purpose`);
    assert.ok(Array.isArray(c.keyFacts) && c.keyFacts.length <= 2, `${c.key} 카드에 핵심 수치 1~2개`);
  }
  const at = cards.find((c) => c.key === 'arrow_tower');
  assert.ok(at.keyFacts.some((f) => f.label === '화력'), '화살탑 카드는 화력을 먼저 보인다');
});

test('★ §15-B-3 후반에 열리는 건물일수록 넓게 자리 잡는다', () => {
  const cells = (k) => { const f = footprint(k, data); return f.w * f.h; };
  // 사슬을 따라 고른 대표 — 앞에 열리는 것이 뒤엣것보다 넓으면 안 된다
  const chain = ['tent', 'hut', 'granary', 'house', 'storage', 'market', 'shrine'];
  for (let i = 1; i < chain.length; i += 1) {
    assert.ok(cells(chain[i]) >= cells(chain[i - 1]),
      `${chain[i - 1]}(${cells(chain[i - 1])}칸) ≤ ${chain[i]}(${cells(chain[i])}칸)`);
  }
  assert.deepEqual([footprint('market', data).w, footprint('market', data).h], [3, 4], '시장 3×4 (스펙 예시)');
  assert.ok(cells('shrine') >= 16 && cells('consulate') >= 16, '가장 늦게 열리는 것은 16칸');
});

test('★ §15-B-3 넓어진 만큼 세다 — 자리 값과 이점이 함께 오른다', () => {
  const per = (k, get) => get(data.buildings[k].tiers[0]) / (footprint(k, data).w * footprint(k, data).h);
  // 가옥(2×3)이 오두막(2×2)보다 칸당 수용력이 낮지 않다
  assert.ok(per('house', (t) => t.residents) >= per('hut', (t) => t.residents),
    '가옥의 칸당 수용력이 오두막보다 낮지 않다');
  assert.ok(per('manor', (t) => t.residents) >= per('house', (t) => t.residents),
    '저택의 칸당 수용력이 가옥보다 낮지 않다');
  // 저장 계열도 칸당 몫이 줄지 않는다
  const cap = (k) => data.buildings[k].storageCap / (footprint(k, data).w * footprint(k, data).h);
  assert.ok(cap('storage') >= cap('storage_crate') * 0.5, '저장고의 칸당 몫이 궤짝의 절반 밑으로 떨어지지 않는다');
});

test('★ §15-B-3 세이브 판번호가 올랐다 — 옛 좌표를 읽지 않는다', async () => {
  const { isLegacySnapshot } = await import('../server/engine/state.js');
  const { world } = town();
  assert.equal(world.schema, 6);
  assert.equal(isLegacySnapshot({ schema: 5 }), true, 'schema 5 는 버린다(건물 자리가 바뀌었다)');
  assert.equal(isLegacySnapshot({ schema: 6 }), false);
});

test('★ §15-B 규모 보정이 터렛의 사거리를 센다', async () => {
  const { defenseIndex } = await import('../server/engine/waves.js');
  const { world, nation, R } = town();
  putTurret(world, nation, 'arrow_tower', 1, R - 2, 0);
  const short = defenseIndex(nation, data);
  // 같은 화력에 사거리만 두 배면 방어 지수도 두 배가 된다
  const s = nation.structures.find((x) => x.key === 'arrow_tower');
  const spec = data.buildings.arrow_tower.tiers[0].turret;
  const keep = spec.range;
  spec.range = keep * 2;
  const long = defenseIndex(nation, data);
  spec.range = keep;
  assert.ok(s && long > short * 1.9, `사거리가 두 배면 방어 지수도 두 배 (${short.toFixed(1)} → ${long.toFixed(1)})`);
});
