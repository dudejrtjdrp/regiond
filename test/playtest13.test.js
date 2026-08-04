// ★ GDD3 §13-A (플레이테스트 피드백 2차) 계약 회귀 — docs/PROTOCOL.md §0-Y
//   조건 수량 단일 정본 · 주민 노동 국고 반영 · 주민 도착 · 저장 상한
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData, publicConfig } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { townOf, territoryRadius } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { nextTierStatus, requirementStatus } from '../server/engine/tiers.js';
import { arrivalStatus, spawnResident, residentGather, residentYield } from '../server/engine/residents.js';
import { chapterView } from '../server/engine/progression.js';
import { buildNationView } from '../server/engine/view.js';
import { applyCommand } from '../server/engine/commands.js';
import { round2 } from '../server/engine/economy.js';
import { resourceReq, structureReq, populationReq, haveResource } from '../server/engine/requirements.js';
import {
  storageLimit, structureCap, deposit, isFull, fullResources, isStorageBuilding,
} from '../server/engine/storage.js';
import { actionSwing } from '../server/engine/actions.js';

const data = loadGameData();
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);
const put = (w, n, key, tier, dx, dy = 0) =>
  completeStructure(w, n, { building: key, tier, x: townOf(w, n.id).x + dx, y: townOf(w, n.id).y + dy, placed: true }, data);
const rowOf = (rows, key) => rows.find((r) => r.key === key);

// ────────────────────────────────────────────────────────────────
// §13-A-1 조건 수량 미반영 — 단일 정본
// ────────────────────────────────────────────────────────────────
test('§13-A-1 조건 행 — have 는 언제나 지금 국고다 (곡물 46이면 46, 12가 아니다)', () => {
  const w = newWorld(11);
  const n = w.nations.player;
  n.resources.grain = 12;
  assert.equal(rowOf(nextTierStatus(n, data).reqs, 'resource:grain').have, 12);
  // 스윙으로 국고가 늘면 **다시 잰 순간** 조건 행도 같이 는다 — 일 틱을 기다리지 않는다
  n.resources.grain = 46;
  const r = rowOf(nextTierStatus(n, data).reqs, 'resource:grain');
  assert.equal(r.have, 46, '조건 행의 have 가 국고와 어긋나면 안 된다');
  assert.equal(r.ok, true);
});

test('§13-A-1 조건 행 — 행은 스스로를 설명한다 (kind·resource·building·dec)', () => {
  const w = newWorld(12);
  const n = w.nations.player;
  const reqs = requirementStatus(n, { population: 3, structures: { hut: 1 }, resources: { grain: 20 } }, data);
  const pop = rowOf(reqs, 'population');
  const st = rowOf(reqs, 'structure:hut');
  const res = rowOf(reqs, 'resource:grain');
  assert.equal(pop.kind, 'population');
  assert.equal(st.kind, 'structure');
  assert.equal(st.building, 'hut');
  assert.equal(res.kind, 'resource');
  assert.equal(res.resource, 'grain');
  for (const r of reqs) {
    assert.equal(typeof r.dec, 'number', `${r.key} 에 자릿수(dec)가 있어야 화면이 같은 모양으로 그린다`);
    assert.equal(typeof r.have, 'number');
    assert.equal(typeof r.need, 'number');
  }
});

test('§13-A-1 조건 행 — ok 와 have 는 같은 값에서 나온다 (20/20 인데 잠긴 단추 금지)', () => {
  const w = newWorld(13);
  const n = w.nations.player;
  for (const [grain, wantHave, wantOk] of [[19.6, 19, false], [19.999, 19, false], [20, 20, true], [20.4, 20, true]]) {
    n.resources.grain = grain;
    const r = rowOf(nextTierStatus(n, data).reqs, 'resource:grain');
    assert.equal(r.have, wantHave, `grain=${grain}`);
    assert.equal(r.ok, wantOk, `grain=${grain}`);
    // 보여 준 값이 필요값 이상이면 반드시 ok 여야 한다
    assert.equal(r.have >= r.need, r.ok, `grain=${grain} — 표시와 판정이 어긋난다`);
  }
});

test('§13-A-1 유입 조건의 곡물 행도 같은 공장에서 나온다', () => {
  const w = newWorld(14);
  const n = w.nations.player;
  __openChapter(n, 4);
  put(w, n, 'hut', 1, 3);
  n.resources.grain = 46;
  const g = rowOf(arrivalStatus(n, data).reqs, 'grain');
  assert.equal(g.kind, 'resource');
  assert.equal(g.resource, 'grain');
  assert.equal(g.have, 46);
  assert.equal(g.ok, true);
  // 문턱과 보여 주는 need 가 같은 식이어야 한다 — 「다 찼는데 안 온다」 금지
  n.resources.grain = g.need;
  assert.equal(rowOf(arrivalStatus(n, data).reqs, 'grain').ok, true);
  assert.equal(arrivalStatus(n, data).open, true);
});

test('§13-A-1 목표 카드의 have 도 조건 행과 같은 계측기를 쓴다', () => {
  const w = newWorld(15);
  const n = w.nations.player;
  n.resources.wood = 33.9;
  assert.equal(haveResource(n, 'wood'), 33.9);
  const v = chapterView(w, n, data);
  if (v?.goal?.condition?.type === 'resource') {
    const res = v.goal.condition.resource;
    assert.equal(v.goal.have, Math.floor(haveResource(n, res)));
  }
  // 없는 자원은 0 — undefined 나 NaN 이 화면까지 새어 나가지 않는다
  assert.equal(haveResource(n, '없는자원'), 0);
  assert.equal(haveResource(null, 'wood'), 0);
});

test('§13-A-1 뷰가 실어 보내는 조건 행도 자기 설명을 갖춘다', () => {
  const w = newWorld(16);
  const n = w.nations.player;
  n.resources.grain = 46;
  const v = buildNationView(w, 'player', null, data, { avatarId: Object.keys(n.players)[0] });
  const rows = v.tier.next.reqs;
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(r.kind, `${r.key} 에 kind 가 없다 — 화면이 다시 잴 수 없다`);
  assert.equal(rowOf(rows, 'resource:grain').have, 46);
  for (const r of v.nation.housing.arrival.reqs) assert.ok(r.kind, `${r.key} 에 kind 가 없다`);
});

test('§13-A-1 조립 함수는 국고를 직접 더듬는 대신 하나의 읽기 지점을 쓴다', () => {
  const w = newWorld(17);
  const n = w.nations.player;
  n.resources.stone = 7;
  assert.deepEqual(
    { ...resourceReq(n, 'stone', 10, data) },
    { key: 'resource:stone', kind: 'resource', ok: false, need: 10, have: 7, dec: 0, text: '석재 10', resource: 'stone' },
  );
  assert.equal(structureReq(n, 'hut', 1, data).ok, false);
  put(w, n, 'hut', 1, 4);
  assert.equal(structureReq(n, 'hut', 1, data).ok, true);
  n.population = 3.9;
  assert.equal(populationReq(n, 3).have, 3);
  assert.equal(populationReq(n, 4).ok, false);
});

// ────────────────────────────────────────────────────────────────
// §13-A-3 주민 노동 — 국고 반영 · 화면 수치와 같은 정본
// ────────────────────────────────────────────────────────────────
/** 영토 안에서 그 직업이 붙을 수 있는 노드 하나 */
function workNode(w, n, job, data) {
  const v = buildNationView(w, 'player', null, data, { avatarId: Object.keys(n.players)[0] });
  return v.nation.workPosts.find((p) => p.kind === 'node' && (p.jobs || []).includes(job)) || null;
}
function postVillagers(w, n, job, data, rng) {
  const t = workNode(w, n, job, data);
  assert.ok(t, `${job} 일터가 영토 안에 있다`);
  const r = applyCommand(w, 'player', {
    type: 'commandVillagers', ids: n.villagers.map((u) => u.id),
    order: { type: 'work', nodeId: t.id, job },
  }, data, rng);
  assert.equal(r.ok, true, `배치 실패: ${JSON.stringify(r.error)}`);
  return t;
}

test('§13-A-3 주민 벌목 배치 후 1게임일 — 국고의 목재가 실제로 는다', () => {
  let w = newWorld(21);
  let n = w.nations.player;
  const rng = createRng(21);
  __openChapter(n, 5);
  for (let i = 0; i < 3; i++) spawnResident(w, n, data, rng);
  assert.equal(n.villagers.length, 3);
  postVillagers(w, n, 'lumber', data, rng);

  const before = n.resources.wood;
  const out = step(w, [], rng, data);
  w = out.state; n = w.nations.player;
  const gained = round2(n.resources.wood - before);
  assert.ok(gained > 0, `1게임일 뒤 목재가 늘어야 한다 (증가 ${gained})`);

  // 늘어난 값은 residentGather 가 낸 값과 정확히 같다 — 다른 데서 새어 들어오지 않는다
  const expect = residentGather(out.state, n, data).resources.wood;
  assert.equal(gained, round2(expect), '국고 증가분 = 주민 산출 합');

  // 한 번 더 돌려도 계속 는다 (직업이 풀리지 않는다)
  const mid = n.resources.wood;
  const out2 = step(w, [], rng, data);
  assert.ok(out2.state.nations.player.resources.wood > mid, '이튿날도 계속 는다');
});

test('§13-A-3 화면이 띄울 수치와 국고에 들어갈 수치는 같은 함수에서 나온다', () => {
  const w = newWorld(22);
  const n = w.nations.player;
  const rng = createRng(22);
  __openChapter(n, 5);
  for (let i = 0; i < 4; i++) spawnResident(w, n, data, rng);
  postVillagers(w, n, 'lumber', data, rng);

  const v = buildNationView(w, 'player', null, data, { avatarId: Object.keys(n.players)[0] });
  const rows = v.nation.residents;
  assert.equal(rows.length, 4);
  let shown = 0;
  for (const r of rows) {
    assert.ok(r.yield, `${r.name} 에게 하루 산출이 실려야 화면이 숫자를 띄운다`);
    assert.equal(r.yield.resource, 'wood');
    assert.ok(r.yield.perDay > 0);
    shown += r.yield.perDay;
  }
  // 뷰가 알려 준 값의 합 = 일 틱이 국고에 넣는 값
  assert.equal(round2(shown), round2(residentGather(w, n, data).resources.wood),
    '뜬 숫자의 합이 국고 증가분과 다르면 플레이어를 속이는 것이다');
});

test('§13-A-3 residentYield — 노드 상태가 한 사람 몫을 그대로 바꾼다', () => {
  const cfg = data.balance.residents.gather;
  const u = { job: 'lumber' };
  assert.equal(residentYield(u, { type: 'forest' }, data).perDay, cfg.perResidentPerDay.wood);
  assert.equal(residentYield(u, { type: 'forest', rich: true }, data).perDay,
    round2(cfg.perResidentPerDay.wood * cfg.richMultiplier), '기름진 자리는 더 낸다');
  assert.equal(residentYield(u, { type: 'forest', depleted: true }, data).perDay, 0, '다 캔 자리는 0');
  assert.equal(residentYield(u, null, data).perDay, round2(cfg.perResidentPerDay.wood * 0.5), '건물 일자리는 절반');
  assert.equal(residentYield({ job: 'build' }, null, data).kind, 'buildPoints');
  assert.equal(residentYield({ job: 'idle' }, null, data).idle, true);
  assert.equal(residentYield({ job: 'defense' }, null, data).kind, 'none', '수비는 캐지 않는다');
  // 산출이 0이거나 채집직이 아니면 뷰에 yield 를 싣지 않는다(화면이 헛숫자를 띄우지 않게)
  assert.equal(residentYield({ job: 'idle' }, null, data).kind, 'resource');
});

test('§13-A-3 노동 다이얼 — 자루 하나가 하루 산출의 정해진 몫이다', () => {
  const wk = data.world.villagers.work;
  assert.ok(wk, 'data/world.json villagers.work 다이얼이 있다');
  assert.ok(wk.deliveriesPerDay >= 1, '하루 하역 횟수');
  assert.ok(wk.swingSeconds > 0, '휘두르는 주기');
  // 자루 하나가 눈에 읽히는 크기여야 한다 — 벌목 기준 0.3 이상
  const sack = data.balance.residents.gather.perResidentPerDay.wood / wk.deliveriesPerDay;
  assert.ok(sack >= 0.3, `자루가 너무 잘아 숫자가 안 읽힌다 (${sack})`);
  // 설정으로 클라까지 내려가는가
  assert.ok(publicConfig().world.villagers.work, 'config.world.villagers.work 가 클라로 간다');
});

// ────────────────────────────────────────────────────────────────
// §13-A-4 주민 2명 도착 — 서버가 한 명만 만드는지 못박는다
// ────────────────────────────────────────────────────────────────
test('§13-A-4 한 명이 오면 서버에 한 명만 는다 (몸이 둘이 아니다)', () => {
  let w = newWorld(31);
  let n = w.nations.player;
  const rng = createRng(31);
  __openChapter(n, 4);
  put(w, n, 'hut', 1, 4);
  n.resources.grain = 200;

  const before = n.villagers.length;
  const out = step(w, [], rng, data);
  w = out.state; n = w.nations.player;
  const arrivals = out.events.filter((e) => e.kind === 'resident_arrived');
  assert.equal(n.villagers.length - before, arrivals.length,
    '도착 알림 수와 실제로 늘어난 사람 수가 같아야 한다');
  assert.equal(n.population, n.villagers.length, '인구는 사람 수 그대로다');

  // 알림이 가리키는 id 가 실제 주민이고, 겹치지 않는다
  const ids = arrivals.map((e) => e.data.id);
  assert.equal(new Set(ids).size, ids.length, '같은 사람이 두 번 도착하지 않는다');
  for (const id of ids) {
    assert.equal(n.villagers.filter((u) => u.id === id).length, 1, `${id} 는 딱 한 몸이다`);
  }
});

test('§13-A-4 도착 알림은 그 사람의 id 와 걸어올 자리를 함께 준다', () => {
  const w = newWorld(32);
  const n = w.nations.player;
  const rng = createRng(32);
  __openChapter(n, 4);
  put(w, n, 'hut', 1, 4);
  n.resources.grain = 200;
  const person = spawnResident(w, n, data, rng);
  assert.ok(person.id, '주민에게 id 가 있다 — 화면이 이름표를 붙일 대상');
  // 서버가 이미 영토 밖에 세워 마을로 걷게 해 둔다(그래서 화면이 유령을 또 만들 필요가 없다)
  const town = townOf(w, n.id);
  const from = Math.hypot(person.x - town.x, person.y - town.y);
  assert.ok(from > territoryRadius(n, data), '새 사람은 영토 밖에서 걸어온다');
  assert.equal(person.destX, town.x, '목표점은 마을 한복판');
  assert.equal(person.destY, town.y);
});

// ────────────────────────────────────────────────────────────────
// §13-A-5 저장 상한 — 서버 권위
// ────────────────────────────────────────────────────────────────
test('§13-A-5 상한 = 본부 기본 + 저장 건물 합, 티어는 곱으로 는다', () => {
  const w = newWorld(41);
  const n = w.nations.player;
  const cfg = data.balance.storage;
  const base = cfg.hqBase + cfg.hqPerTier * 0;
  assert.equal(storageLimit(n, data), base, '아무것도 없으면 본부 기본만');

  put(w, n, 'storage_crate', 1, 5);
  assert.equal(storageLimit(n, data), base + data.buildings.storage_crate.storageCap, '궤짝 한 채');
  put(w, n, 'storage_crate', 1, -5);
  assert.equal(storageLimit(n, data), base + data.buildings.storage_crate.storageCap * 2, '더 지으면 는다');

  // 티어를 올려도 는다 — 같은 계열 전부 같은 규칙(base × mult^(티어-1))
  const t2 = put(w, n, 'storage_crate', 2, 0, 5);
  assert.equal(structureCap(t2, data),
    data.buildings.storage_crate.storageCap * cfg.capPerTierMultiplier, '2단계 궤짝 = 기본 × 배수');

  // 정착지 티어가 오르면 본부 몫도 는다
  n.tier = 3;
  assert.ok(storageLimit(n, data) > base + data.buildings.storage_crate.storageCap * 2);
});

test('§13-A-5 무너졌거나 옮기는 중인 곳간은 세지 않는다', () => {
  const w = newWorld(42);
  const n = w.nations.player;
  const before = storageLimit(n, data);
  const s = put(w, n, 'storage', 1, 6);
  assert.ok(storageLimit(n, data) > before);
  s.inactive = true;
  assert.equal(storageLimit(n, data), before, '이전·철거 중이면 효과가 멎는다');
  s.inactive = false;
  s.hp = 0;
  assert.equal(storageLimit(n, data), before, '무너진 곳간은 아무것도 담지 못한다');
});

test('§13-A-5 상한을 넘겨 들어오지 않는다 (deposit 은 들어간 만큼만 돌려준다)', () => {
  const w = newWorld(43);
  const n = w.nations.player;
  const limit = storageLimit(n, data);
  n.resources.wood = limit - 10;
  assert.equal(deposit(n, 'wood', 4, data), 4, '자리가 있으면 그대로');
  assert.equal(n.resources.wood, limit - 6);
  assert.equal(deposit(n, 'wood', 50, data), 6, '남은 자리만큼만 들어간다');
  assert.equal(n.resources.wood, limit, '상한을 넘지 않는다');
  assert.equal(deposit(n, 'wood', 20, data), 0, '가득 차면 한 톨도 안 들어간다');
  assert.equal(n.resources.wood, limit);
  assert.equal(isFull(n, 'wood', data), true);
  assert.deepEqual(fullResources(n, data).includes('wood'), true);
  // 다른 자원은 멀쩡하다 — 상한은 자원마다 따로다
  assert.equal(isFull(n, 'stone', data), false);
  assert.equal(deposit(n, 'stone', 30, data), 30);
});

test('§13-A-5 곳간이 차면 채집이 무효다 — 쿨타임도 노드도 축나지 않는다', () => {
  const w = newWorld(44);
  const n = w.nations.player;
  const avatarId = Object.keys(n.players)[0];
  const node = (w.map?.nodes || []).find((x) => x.type === 'forest');
  const town = townOf(w, n.id);
  node.x = town.x + 1; node.y = town.y;                 // 손이 닿는 자리로
  n.avatars[avatarId] = { x: node.x, y: node.y };
  n.resources.wood = storageLimit(n, data);             // 목재만 가득

  const before = { amount: node.amount, swings: node.swings || 0, wood: n.resources.wood };
  const res = actionSwing(w, n, { avatarId, nodeId: node.id }, data, Date.now());
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'STORAGE_FULL');
  assert.match(res.error.message, /곳간이 가득/);
  assert.ok(res.error.resources.includes('wood'), '어떤 자원이 막았는지 알려 준다');
  assert.equal(node.amount, before.amount, '나무가 축나지 않는다');
  assert.equal(node.swings || 0, before.swings, '스윙으로 세지도 않는다');
  assert.equal(n.resources.wood, before.wood, '국고도 그대로');

  // 곳간을 늘리면 곧바로 다시 캘 수 있다
  put(w, n, 'storage_crate', 1, 3);
  const ok = actionSwing(w, n, { avatarId, nodeId: node.id }, data, Date.now() + 60000);
  assert.equal(ok.ok, true, '궤짝을 지으면 다시 캔다');
  assert.ok((ok.gained.wood || 0) > 0);
});

test('§13-A-5 넘치는 몫은 버려진다 — 절반만 들어갈 때', () => {
  const w = newWorld(45);
  const n = w.nations.player;
  const avatarId = Object.keys(n.players)[0];
  const node = (w.map?.nodes || []).find((x) => x.type === 'forest');
  const town = townOf(w, n.id);
  node.x = town.x + 1; node.y = town.y;
  n.avatars[avatarId] = { x: node.x, y: node.y };
  const limit = storageLimit(n, data);
  n.resources.wood = limit - 0.5;                       // 딱 0.5 만큼만 자리가 있다
  const res = actionSwing(w, n, { avatarId, nodeId: node.id }, data, Date.now());
  assert.equal(res.ok, true, '자리가 조금이라도 있으면 캘 수 있다');
  assert.equal(res.gained.wood, 0.5, '들어간 만큼만 내 것이다');
  assert.equal(n.resources.wood, limit);
});

test('§13-A-5 주민 산출도 상한을 넘기지 못한다 (일 틱)', () => {
  let w = newWorld(46);
  let n = w.nations.player;
  const rng = createRng(46);
  __openChapter(n, 5);
  for (let i = 0; i < 3; i++) spawnResident(w, n, data, rng);
  postVillagers(w, n, 'lumber', data, rng);
  n.resources.wood = storageLimit(n, data);
  const out = step(w, [], rng, data);
  n = out.state.nations.player;
  assert.ok(n.resources.wood <= storageLimit(n, data) + 0.005,
    `주민이 지고 와도 상한을 넘지 않는다 (${n.resources.wood} > ${storageLimit(n, data)})`);
});

test('§13-A-5 뷰가 상한과 「가득」 목록을 실어 보낸다', () => {
  const w = newWorld(47);
  const n = w.nations.player;
  n.resources.stone = storageLimit(n, data);
  const v = buildNationView(w, 'player', null, data, { avatarId: Object.keys(n.players)[0] });
  assert.equal(v.nation.storage.limit, storageLimit(n, data));
  assert.ok(v.nation.storage.full.includes('stone'));
  assert.equal(v.nation.storage.full.includes('wood'), false);
});

/* ★ §15-B-3 — 저장고가 2×3→3×3 이 되면서 몫도 250→420 으로 올랐다(곡창 150→200). */
test('§13-A-5 저장 계열 다이얼이 스펙대로다 (궤짝 80 · 저장고 420 · 티어 ×1.6)', () => {
  assert.equal(data.buildings.storage_crate.storageCap, 80);
  assert.equal(data.buildings.storage.storageCap, 420);
  assert.equal(data.balance.storage.capPerTierMultiplier, 1.6);
  assert.ok(data.balance.storage.hqBase > 0, '본부에도 기본 상한이 있다');
  // 같은 계열은 전부 같은 시스템을 쓴다 — storageCap 을 가진 건물이 곧 저장 계열
  for (const key of ['storage_crate', 'storage', 'granary']) {
    assert.equal(isStorageBuilding(key, data), true, `${key} 는 저장 계열이다`);
  }
  assert.equal(isStorageBuilding('hut', data), false);
});
