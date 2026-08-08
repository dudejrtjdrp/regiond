// §21-A1 worldDiff 변경분 회귀 — 「이름은 diff 인데 전량이 나가던」 자리.
//
// 옛 규칙은 방송마다 구조물·울타리·주민·야영지·아바타·군락·마을을 **전부 다시** 실었다
// (후반 정착지에서 한 장 60~150KB). 이 파일이 지키는 것 다섯:
//   ① 아무것도 안 바뀐 하루 — 일곱 컬렉션의 열쇠말이 **아예 없다**(주민은 판에만 실린다).
//   ② 바뀐 것은 반드시 닿는다 — 건물을 올리거나 울타리가 상하면 **그 줄만** 오고, 헐면 removed* 가 온다.
//   ③ 되맞춤 — worldFullEvery 장마다 전량 한 장. 장부를 비우면(입장·requestWorld) 다음 장이 전량이다.
//   ④ 화면의 판은 서버의 판과 한 글자도 다르지 않다 — 전량 직렬화 결과와 병합 결과가 같다.
//   ⑤ 판정 불변 — 변경분을 뽑든 안 뽑든 월드가 바이트 단위로 같다(여기는 전송 계층이다).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { townOf } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { spawnResident } from '../server/engine/residents.js';
import { fenceTierSpec, damageFence } from '../server/engine/fences.js';
import { ensureCamps } from '../server/engine/waves.js';
import { stampVisionDisc } from '../server/engine/fog.js';
import { buildWorldDiff, buildWorldSnapshot, worldStreamCache } from '../server/engine/view.js';

const data = loadGameData();
const FULL_EVERY = data.world.simulation.worldFullEvery;
const COLS = ['structures', 'fences', 'camps', 'clusters', 'towns'];
const bytes = (o) => JSON.stringify(o).length;

const put = (w, n, key, tier, dx, dy) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);

/** 울타리 조각을 곧바로 꽂는다 — 여기서 재는 것은 전송이지 배치 판정이 아니다 */
function addFences(nation, town, count, data2) {
  const spec = fenceTierSpec(false, 1, data2);
  const list = (nation.fences ||= []);
  nation.nextFenceId ||= 1;
  for (let i = 0; i < count; i += 1) {
    const x = town.x - 12 + (i % 24);
    const y = town.y - 12 + Math.floor(i / 24);
    list.push({ id: `f${nation.nextFenceId++}`, x1: x, y1: y, x2: x + 1, y2: y,
      gate: false, tier: 1, hp: spec.hp, maxHp: spec.hp, builtTick: 0 });
  }
  return list;
}

/** 후반 규모의 정착지 — 건물 스물넷 · 주민 스물넷 · 울타리 아흔여섯 · 야영지 · 널찍이 밝힌 땅 */
function settlement(seed = 8191) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const rng = createRng(seed);
  nation.tier = 5;
  openChapterForDebug(null, nation, data, 10);
  const town = townOf(world, nation.id);
  put(world, nation, 'manor', 3, 3, 0);
  for (let i = 0; i < 12; i += 1) put(world, nation, 'house', 2, -8 + i, -7);
  for (let i = 0; i < 11; i += 1) put(world, nation, 'arrow_tower', 2, -8 + i, 8);
  nation.resources.grain = 4000;
  for (let i = 0; i < 24; i += 1) spawnResident(world, nation, data, rng);
  addFences(nation, town, 96, data);
  stampVisionDisc(nation, data, world.tick, town.x, town.y, 70);
  ensureCamps(world, nation, data);
  /* 며칠 지난 정착지로 둔다 — 지금 막 밝힌 땅의 노드가 「오늘 바뀐 것」으로 딸려 오지 않게 한다
     (노드 변경분은 §17-12 의 stamp 계약 그대로다. 여기서 재는 것은 일곱 컬렉션이다). */
  world.tick = 30;
  return { world, nation, town };
}

/** 장부 한 채를 쥐고 변경분 한 장을 뽑는다(같은 날 안의 되방송 — 서버가 가장 자주 내는 장이다) */
const nextDiff = (world, stream, since = world.tick) =>
  buildWorldDiff(world, 'player', data, since, { stream });

/** 화면 한 채 — public/js/state.js 만 올려 병합 규칙을 그대로 꺼내 본다 */
function client() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync('public/js/state.js', 'utf8'), ctx);
  return ctx.window.GM.state;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('★ §21-A1 ① 조용한 하루 — 일곱 컬렉션의 열쇠말이 아예 없다(주민은 판에만)', () => {
  const { world } = settlement();
  const stream = worldStreamCache();
  const first = nextDiff(world, stream);
  assert.equal(first.full, true, '첫 장은 언제나 전량이다(입장 되맞춤)');
  assert.ok(first.structures.length >= 20 && first.fences.length >= 90, '전량 한 장에는 다 실린다');

  const quiet = nextDiff(world, stream);
  assert.equal(quiet.full, false);
  for (const col of COLS) assert.equal(quiet[col], undefined, `${col} — 안 바뀌었으면 열쇠말이 없다`);
  assert.equal(quiet.residents, undefined, '주민은 세계 변경분에 아예 없다(판이 정본이다)');
  assert.ok(Array.isArray(quiet.avatars), '아바타는 매번 전량 그대로다');

  const old = buildWorldDiff(world, 'player', data, world.tick);   // 장부 없이 = 옛 계약
  assert.ok(Array.isArray(old.residents) && old.residents.length > 0, '옛 계약(장부 없음)은 한 글자도 안 바뀐다');
  assert.ok(bytes(quiet) * 9 < bytes(old),
    `조용한 하루 ${bytes(quiet)}B 가 옛 한 장 ${bytes(old)}B 의 10%를 넘는다`);
});

test('★ §21-A1 ② 바뀐 줄은 반드시 닿는다 — 그 줄만 오고, 헐면 removed 가 온다', () => {
  const { world, nation } = settlement(4242);
  const stream = worldStreamCache();
  nextDiff(world, stream);                       // 전량 한 장으로 장부를 세운다

  damageFence(nation.fences[7], 20);
  const hurt = nextDiff(world, stream);
  assert.equal(hurt.fences.length, 1, '상한 한 조각만 온다 — 전량이 아니다');
  assert.equal(hurt.fences[0].id, nation.fences[7].id);
  assert.equal(hurt.structures, undefined, '건물은 그대로이므로 실리지 않는다');

  const tower = nation.structures.find((s) => s.key === 'arrow_tower');
  completeStructure(world, nation, { structureId: tower.id, tier: 3 }, data);
  const up = nextDiff(world, stream);
  assert.deepEqual(up.structures.map((s) => s.id), [tower.id], '티어가 오른 한 채만 온다');
  assert.equal(up.fences, undefined, '울타리는 다시 실리지 않는다(같은 값이므로)');

  const gone = nation.structures.pop();
  const razed = nextDiff(world, stream);
  assert.deepEqual(razed.removedStructures, [gone.id], '헐린 건물은 removedStructures 로 알린다');
  assert.equal(razed.counts.structures, nation.structures.length, 'counts 는 서버가 아는 줄 수다');
});

test('★ §21-A1 ③ 되맞춤 — 주기마다 전량 한 장, 장부를 비우면 그 다음 장이 전량이다', () => {
  const { world, nation } = settlement(1234);
  const stream = worldStreamCache();
  const ticks = [nextDiff(world, stream)];
  for (let i = 0; i < FULL_EVERY; i += 1) ticks.push(nextDiff(world, stream));
  const fulls = ticks.filter((d) => d.full === true);
  assert.equal(fulls.length, 2, `${ticks.length}장 가운데 전량은 첫 장과 되맞춤 한 장이다`);
  assert.equal(ticks.indexOf(fulls[1]), FULL_EVERY, `되맞춤은 ${FULL_EVERY}번째 장에 온다`);
  assert.equal(fulls[1].structures.length, nation.structures.length, '되맞춤 장에는 전량이 실린다');

  // 입장·requestWorld — 장부를 새로 열면 그 사람의 다음 한 장은 전량이다(잃어버린 장의 복구로)
  const fresh = nextDiff(world, worldStreamCache());
  assert.equal(fresh.full, true);
  assert.equal(fresh.fences.length, nation.fences.length);
  for (const col of COLS) assert.equal(fresh.counts[col], fresh[col].length, `${col} 의 수가 맞는다`);
});

test('★ §21-A1 ④ 화면의 판 — 병합 결과가 전량 직렬화 결과와 한 글자도 다르지 않다', () => {
  const { world, nation } = settlement(777);
  const S = client();
  S.applyWorld(plain(buildWorldSnapshot(world, 'player', data)));
  const stream = worldStreamCache();
  S.applyWorldDiff(plain(nextDiff(world, stream)));

  const truth = () => buildWorldDiff(world, 'player', data, world.tick);   // 옛 전량 계약 = 정본
  const same = (label) => {
    const t = truth();
    const seen = plain(S.S.map);
    for (const col of ['structures', 'fences', 'camps']) {
      const sort = (l) => l.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
      assert.deepEqual(sort(seen[col]), sort(t[col]), `${label} — ${col} 가 어긋났다`);
    }
    assert.equal(seen.clusters.length, t.clusters.length, `${label} — 군락 수가 어긋났다`);
  };
  same('전량 한 장 직후');

  damageFence(nation.fences[3], 30);
  put(world, nation, 'house', 1, 6, 6);
  S.applyWorldDiff(plain(nextDiff(world, stream)));
  same('변경분을 얹은 뒤');

  const gone = nation.structures.pop();
  S.applyWorldDiff(plain(nextDiff(world, stream)));
  assert.ok(!S.S.map.structures.some((s) => s.id === gone.id), '헐린 건물은 화면 장부에서도 사라진다');
  same('헐린 뒤');
});

test('★ §21-A1 ⑤ 판정 불변 — 변경분을 뽑든 안 뽑든 월드가 바이트 단위로 같다', () => {
  const a = settlement(31337);
  const b = settlement(31337);
  const stream = worldStreamCache();
  for (let i = 0; i < 5; i += 1) {
    buildWorldDiff(a.world, 'player', data, a.world.tick);           // 옛 계약(전량)
    nextDiff(b.world, stream);                                       // 새 계약(변경분)
  }
  // 방 이름과 지은 시각은 벽시계로 짓는다 — 그 둘만 빼고 통째로 견준다
  const shot = (w) => JSON.stringify({ ...w, gameId: null, createdAt: 0 });
  assert.equal(shot(b.world), shot(a.world), '전송 계층이 월드를 한 눈금도 건드리지 않는다');
});
