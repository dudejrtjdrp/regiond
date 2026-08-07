// ★ §19-F2 (QA-F2) 세계 콘텐츠 확장 — 바이옴 · 적 · 용 · 무기/방어구
//
// 이 파일이 지키는 계약:
//   ① 바이옴은 열 종을 넘고, RLE 코드는 **뒤에만** 붙는다(옛 세이브의 지도가 어긋나지 않는다)
//   ② 바이옴 배치는 난수를 한 톨도 쓰지 않는다 — 같은 씨앗은 같은 자리에 같은 땅을 낸다
//   ③ 웨이브 구성이 갈려도 **총 파워는 그대로**다. 앞 다섯 웨이브는 적 한 마리까지 옛것과 같다
//   ④ 용은 세계에 하나뿐이다 — 잡히면 다시 태어나지 않고, 그 전리품이 대장간의 문을 연다
//   ⑤ 장비 표가 늘어도 옛 물건의 열쇠말·값은 한 톨도 바뀌지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { disableCompanions } from '../server/engine/companions.js';
import { createWorld } from '../server/engine/state.js';
import { generateTerrain, terrainIndex, terrainNameAt, townOf, dist } from '../server/engine/world.js';
import { createRng } from '../server/engine/rng.js';
import { waveSpec } from '../server/engine/waves.js';
import { ensureDragon, lairSpot, dragonWarning, slayDragon } from '../server/engine/dragon.js';
import { trophyOk, equipmentView, craftEquipment } from '../server/engine/equipment.js';
import { ensurePlayer } from '../server/engine/skills.js';

const data = loadGameData();
disableCompanions(data);
const SIZE = data.world.size;
const playerOf = (world) => Object.values(world.nations).find((n) => n.isPlayer);

// ────────────────────────────────────────────────────────────────
// ① F07-1 바이옴 — 열 종 이상, 뒤에만 붙는다, 이름·문구가 다 있다
// ────────────────────────────────────────────────────────────────
test('★ §19-F2(F07-1) 바이옴 열 종 이상 — 코드는 뒤에만 붙고 이름과 첫 발견 문구가 다 있다', () => {
  const t = data.world.terrain;
  assert.ok(t.codes.length >= 10, `지형이 열 종을 넘는다 (지금 ${t.codes.length})`);
  assert.deepEqual(t.codes.slice(0, 7), ['grass', 'forest', 'rock', 'water', 'fertile', 'snow', 'jungle'],
    'RLE 계약 — 옛 일곱의 자리는 영원히 고정이다');
  for (const code of t.codes) assert.ok(t.names[code], `${code} 에 한국어 이름이 있다`);
  for (const code of t.biomes.codes) {
    assert.ok(t.biomes.discovery.text[code], `${code} 에 첫 발견 문구가 있다 (F03-3 연출)`);
    assert.ok(t.walkable.includes(code), `${code} 은 걸을 수 있다`);
  }
});

test('★ §19-F2(F07-1) 바이옴 배치는 난수를 쓰지 않는다 — 같은 씨앗이면 같은 지도', () => {
  const a = generateTerrain(createRng(4242), data);
  const b = generateTerrain(createRng(4242), data);
  assert.equal(a, b, '같은 씨앗은 같은 지형을 낸다');
  assert.equal(a.length, SIZE * SIZE);
  const w1 = createWorld({ gameId: 'qaf2-det1', seed: 4242, data });
  const w2 = createWorld({ gameId: 'qaf2-det2', seed: 4242, data });
  assert.equal(w1.map.terrain, w2.map.terrain, '덧칠까지 끝난 지도도 같다');
});

/* ★ §19-F2(F07-1) — 덧칠이 자원 배치의 난수를 흔들지 않는가. 이 계약이 깨지면 같은 씨앗의
   경제·밸런스가 통째로 달라진다(실측: 웨이브5 생존율 67.5%→55.0%). 그래서 노드는 옛 지형 위에서
   먼저 다 뽑고, 새 땅은 그 뒤에 칠한다 — 노드가 앉은 칸은 비켜 간다. */
test('★ §19-F2(F07-1) 덧칠은 자원·길이 앉은 칸을 비켜 간다 (배치 결정론)', () => {
  const world = createWorld({ gameId: 'qaf2-paint', seed: 42, data });
  const idx = terrainIndex(data);
  const paint = new Set(data.world.terrain.biomes.rules.filter((r) => !r.legacy).map((r) => idx[r.code]));
  let on = 0;
  for (const n of world.map.nodes) {
    const v = world.map.terrain.charCodeAt(n.y * SIZE + n.x) - 48;
    if (paint.has(v)) on += 1;
  }
  assert.equal(on, 0, '새로 칠한 땅 위에 앉은 자원 노드가 한 자리도 없다');
});

test('★ §19-F2(F07-1) 새 땅이 실제로 난다 — 여덟 바이옴이 지도에 모두 앉는다', () => {
  const map = createWorld({ gameId: 'qaf2-biomes', seed: 42, data }).map.terrain;
  const idx = terrainIndex(data);
  const seen = new Set();
  for (let i = 0; i < map.length; i += 1) seen.add(map.charCodeAt(i) - 48);
  for (const code of data.world.terrain.biomes.codes) {
    assert.ok(seen.has(idx[code]), `${code} 이 지도에 있다`);
  }
});

test('★ §19-F2(F07-1) 시작 반경은 여전히 옛 다섯 지형뿐이다 (초반 밸런스 불변)', () => {
  const map = createWorld({ gameId: 'qaf2-core', seed: 42, data }).map.terrain;
  const idx = terrainIndex(data);
  const biome = new Set(data.world.terrain.biomes.codes.map((c) => idx[c]));
  const c = (SIZE - 1) / 2;
  let bad = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (Math.hypot(x - c, y - c) > data.world.terrain.biomes.protectRadius) continue;
      if (biome.has(map.charCodeAt(y * SIZE + x) - 48)) bad += 1;
    }
  }
  assert.equal(bad, 0, '한복판에는 새 땅이 한 칸도 없다');
});

test('★ §19-F2(F07-1) 땅마다 개성 — 자원 분포와 걸음이 갈린다(전부 자료 주도)', () => {
  const n = data.world.nodes.types;
  /* 새 땅은 자원이 나지 않는 땅이다 — 노드 지형 목록을 한 줄도 늘리지 않았고(배치 결정론),
     덧칠이 노드를 비켜 가므로 새 땅 안의 옛 땅 조각에만 자원이 있다. 석탄만 예외다(count 0). */
  assert.deepEqual(n.forest.terrains, ['forest', 'jungle'], '숲 노드의 지형 목록은 옛 그대로다');
  assert.deepEqual(n.berry.terrains, ['grass', 'fertile'], '딸기 노드의 지형 목록도 옛 그대로다');
  assert.deepEqual(n.iron.terrains, ['rock', 'snow'], '철광맥은 도읍에 매달린 자리라 손대지 않는다');
  assert.ok(n.coal.terrains.includes('ash') && n.coal.terrains.includes('dusk'), '잿땅 아래가 옛 불이다');

  const mv = data.world.terrain.moveMultiplier;
  assert.ok(mv.marsh < 1 && mv.salt > 1, '진창은 발을 물고 소금 판은 미끄럽다');
});

// ────────────────────────────────────────────────────────────────
// ② F07-3 적 다양화 — 총 파워 보존 · 앞 다섯 웨이브 불변
// ────────────────────────────────────────────────────────────────
test('★ §19-F2(F07-3) 새 적 넷 — hp/powerCost 비가 옛 여섯과 같은 자 위에 있다', () => {
  const types = data.waves.types;
  for (const key of ['raider', 'ironclad', 'slinger', 'sapper']) {
    const d = types[key];
    assert.ok(d, `${key} 정의가 있다`);
    const ratio = d.hp / d.powerCost;
    assert.ok(ratio > 5 && ratio < 6, `${key} 의 hp/powerCost=${ratio.toFixed(2)} 가 ≈5.5 다`);
    assert.ok(d.name && d.desc, `${key} 에 이름과 설명이 있다`);
  }
  assert.equal(types.slinger.rangeTiles > 1.2, true, '투석꾼은 붙지 않고 던진다');
  assert.ok(types.sapper.detonate > 1, '자폭형은 제 몸을 터뜨린다');
});

test('★ §19-F2(F07-3) 앞 다섯 웨이브는 한 마리도 바뀌지 않는다 (체크포인트 보존)', () => {
  for (let i = 0; i < 5; i += 1) {
    const spec = waveSpec(i, data, { biome: 'snow' });
    assert.equal(spec.escort, null, `웨이브 ${i + 1} 에는 호위대가 없다`);
    assert.equal(spec.groups.length, 1, '무리는 하나뿐이다');
    assert.equal(spec.groups[0].units, spec.units, '마릿수도 옛 셈 그대로다');
  }
});

test('★ §19-F2(F07-3) 여섯째 웨이브부터 구성이 갈린다 — 총 파워는 그대로', () => {
  const plain = waveSpec(5, data, {});
  const snow = waveSpec(5, data, { biome: 'snow' });
  const jungle = waveSpec(5, data, { biome: 'jungle' });
  assert.equal(plain.power, snow.power, '파워는 땅과 무관하다 — 구성만 갈린다');
  assert.ok(snow.escort && jungle.escort, '둘 다 호위대가 붙는다');
  assert.notEqual(snow.escort.type, jungle.escort.type, '설산 곁과 밀림 곁의 이웃이 다르다');

  // 무리별 파워의 합 = 웨이브 파워 (반올림 오차 안에서)
  const cfg = data.waves.types;
  const sum = snow.groups.reduce((a, g) => a + g.units * cfg[g.type].powerCost, 0);
  assert.ok(Math.abs(sum - snow.power) / snow.power < 0.12, `무리 파워 합(${sum.toFixed(0)})이 총 파워(${snow.power})와 같다`);
});

// ────────────────────────────────────────────────────────────────
// ③ F07-4 용 — 세계에 하나뿐
// ────────────────────────────────────────────────────────────────
test('★ §19-F2(F07-4) 용은 화산재 땅 깊은 곳에 한 마리만 앉는다', () => {
  const world = createWorld({ gameId: 'qaf2-dragon', seed: 42, data });
  const nation = playerOf(world);
  const cfg = data.creatures.worldBoss;

  const c = ensureDragon(world, nation, data);
  assert.ok(c, '용이 앉았다');
  assert.equal(terrainNameAt(world.map, c.x, c.y, data), cfg.biome, '굴은 화산재 땅이다');
  const town = townOf(world, 'player');
  assert.ok(dist(town.x, town.y, c.x, c.y) >= cfg.minDistanceFromTown, '도읍에서 한참 멀다');
  assert.equal(c.boss, true);
  assert.equal(ensureDragon(world, nation, data), null, '두 번 앉지 않는다');
  assert.equal(nation.wild.creatures.filter((x) => x.boss).length, 1, '세계에 한 마리뿐이다');

  // 자리는 난수가 아니다 — 같은 지도면 같은 굴
  assert.deepEqual(lairSpot(world, data), lairSpot(world, data));
});

test('★ §19-F2(F07-4) 굴 앞의 경고는 한 번만 · 잡으면 전리품과 유물이 남는다', () => {
  const world = createWorld({ gameId: 'qaf2-slay', seed: 7, data });
  const nation = playerOf(world);
  const c = ensureDragon(world, nation, data);
  assert.ok(c);

  const gold0 = nation.gold || 0;
  assert.equal(dragonWarning(world, nation, data, c.x + 200, c.y), null, '멀리서는 울리지 않는다');
  const warn = dragonWarning(world, nation, data, c.x + 2, c.y);
  assert.ok(warn && warn.title, '굴 앞에서 한 번 울린다');
  assert.equal(dragonWarning(world, nation, data, c.x + 2, c.y), null, '두 번 울리지 않는다');

  const got = slayDragon(world, nation, data, '개척자');
  assert.ok(got, '잡았다');
  assert.equal(nation.trophies.dragon != null, true, '전리품 표식이 남는다');
  assert.ok((nation.gold || 0) > gold0, '금화가 들어왔다');
  assert.ok((nation.artifacts || []).some((a) => a.key === data.creatures.worldBoss.reward.artifact),
    '확정 유물이 들어왔다');
  assert.equal(slayDragon(world, nation, data), null, '두 번 잡히지 않는다');
  assert.equal(ensureDragon(world, nation, data), null, '다시 태어나지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ④ F07-2 무기·방어구 확대
// ────────────────────────────────────────────────────────────────
test('★ §19-F2(F07-2) 표가 늘어도 옛 물건은 그대로다 — 열쇠말·값·순서', () => {
  const w = data.equipment.tiers.weapon;
  const a = data.equipment.tiers.armor;
  assert.ok(w.length >= 9 && a.length >= 8, `무기 ${w.length} · 방어구 ${a.length}`);
  const byKey = (list, key) => list.find((t) => t.key === key);
  assert.equal(byKey(w, 'stone_blade').damage, 1.15, '돌칼은 그대로다');
  assert.equal(byKey(w, 'master_blade').damage, 2.3, '명품검은 그대로다');
  assert.equal(byKey(a, 'master_guard').reduction, 0.3, '명품 갑옷은 그대로다');

  // 새 물건은 가죽·털을 쓴다 — 사냥·목장의 부산물이 대장간으로 이어진다
  for (const key of ['bone_spear', 'hunters_bow', 'fur_coat', 'hide_brigandine']) {
    const spec = byKey(w, key) || byKey(a, key);
    assert.ok(spec, `${key} 가 있다`);
    assert.ok((spec.cost.hide || 0) + (spec.cost.wool || 0) > 0, `${key} 는 가죽·털을 쓴다`);
  }
});

test('★ §19-F2(F07-2) 용비늘 장비는 용을 잡은 나라에게만 열린다', () => {
  const world = createWorld({ gameId: 'qaf2-equip', seed: 9, data });
  const nation = playerOf(world);
  const player = ensurePlayer(nation, 'lord', data, '군주');
  const fang = data.equipment.tiers.weapon.find((t) => t.key === 'wyrm_fang');

  assert.equal(trophyOk(nation, fang), false, '전리품이 없으면 잠겨 있다');
  const denied = craftEquipment(nation, player, { slot: 'weapon', key: 'wyrm_fang' }, data);
  assert.equal(denied.ok, false, '벼릴 수 없다');

  const view = equipmentView(nation, player, data);
  const row = view.catalog.weapon.find((t) => t.key === 'wyrm_fang');
  assert.equal(row.locked, true);
  assert.ok(row.lockReason.includes('용'), '까닭이 「용을 잡아야」다');

  nation.trophies = { dragon: 1 };
  assert.equal(trophyOk(nation, fang), true, '잡은 뒤에는 열린다');
});
