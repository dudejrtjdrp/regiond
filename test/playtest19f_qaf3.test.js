// ★ §19-F3 (QA-F3) 경제 콘텐츠 — 무역 동기 · 금화 사용처 · 감정소 · 주민 꾸미기
//
// 이 파일이 지키는 계약:
//   ① 나라마다 값이 다르다 — 같은 재화라도 어디서 사고 어디에 파는가가 갈린다(F07-7)
//   ② 오퍼(저쪽이 부르는 값)는 한 톨도 바뀌지 않는다 — 성정 배수는 직접 흥정에만 붙는다
//   ③ 특산품은 금화를 물건으로 되돌린다: 재고가 있고 며칠에 걸쳐 다시 찬다(F07-7)
//   ④ 금화가 흘러갈 자리가 셋 이상 있다 — 연구 가속 · 특산품 · 꾸미기(F07-5)
//   ⑤ 감정소는 한 채뿐이고 헐 수도 옮길 수도 없다. 대신 며칠에 한 번 다시 쓴다(F07-8)
//   ⑥ 주민의 이름·옷은 서버가 정본이고, 그대로 모두에게 흘러간다(F07-9)
//   ⑦ 부산물에 쓸 곳이 생겼다 — 요리(고기)와 방한(털) (F07-6)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { foreignUnitPrice, tradeFactor, specialtyList, restockSpecialties } from '../server/engine/trade.js';
import { hasteCost, ensureResearch } from '../server/engine/research.js';
import { startDemolish, startRelocate, effectValue } from '../server/engine/structures.js';
import { reappraisalState, runReappraisal } from '../server/engine/emotion_day.js';
import { buildNationView } from '../server/engine/view.js';

const data = loadGameData();
const openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

/** 교역소가 선 상태의 세계 하나 — 무역 검사들이 같은 자리에서 시작한다 */
function tradeWorld(seed) {
  const world = createWorld({ seed, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.tier = 3;
  openChapter(n, 10);
  n.gold = 5000;
  n.metNations = { ai1: 1, ai2: 1, ai3: 1 };
  return world;
}

// ────────────────────────────────────────────────────────────────
// ① F07-7 — 나라마다 값이 다르다
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-7) 나라 성정이 곧 값 — 싸게 내주는 것과 비싸게 쳐주는 것이 나라마다 다르다', () => {
  for (const def of data.aiNations.nations) {
    assert.ok(def.tradeProfile, `${def.id} 에 성정표가 있다`);
    const ex = Object.values(def.tradeProfile.exports || {});
    const de = Object.values(def.tradeProfile.demands || {});
    assert.ok(ex.length && de.length, `${def.id} 은 내줄 것도 살 것도 있다`);
    for (const v of ex) assert.ok(v < 1, `${def.id} 이 내주는 값은 헐하다 (${v})`);
    for (const v of de) assert.ok(v > 1, `${def.id} 이 쳐주는 값은 후하다 (${v})`);
  }
  // 산유국의 석유는 헐값, 엘프는 석유를 후하게 산다 → 차익이 존재한다
  assert.ok(tradeFactor('ai1', 'oil', 'buy', data) < 1);
  assert.ok(tradeFactor('ai2', 'oil', 'sell', data) > 1);
  assert.equal(tradeFactor('ai1', 'stone', 'buy', data), 1, '표에 없는 재화는 배수 1');
});

test('★ §19-F3(F07-7) 차익 거래가 성립한다 — 싼 데서 사서 비싼 데 판다', () => {
  const world = tradeWorld(11);
  const [a1, a2] = [world.nations.ai1, world.nations.ai2];
  for (const n of [a1, a2]) n.resources.oil = 200;
  const buyAt = foreignUnitPrice(a1, 'oil', 'buy', data);
  const sellAt = foreignUnitPrice(a2, 'oil', 'sell', data);
  assert.ok(sellAt > buyAt, `산유국에서 사서(${buyAt.toFixed(2)}) 엘프에 파는 값(${sellAt.toFixed(2)})이 더 크다`);
});

test('★ §19-F3(F07-7) trade 명령의 단가에 성정이 실린다 — 같은 재화, 다른 나라, 다른 값', () => {
  const world = tradeWorld(12);
  const rng = createRng(12);
  world.nations.ai1.resources.oil = 300;
  world.nations.ai3.resources.oil = 300;
  const one = applyCommand(world, 'player', { type: 'trade', nationId: 'ai1', side: 'buy', resource: 'oil', amount: 5 }, data, rng);
  const two = applyCommand(world, 'player', { type: 'trade', nationId: 'ai3', side: 'buy', resource: 'oil', amount: 5 }, data, rng);
  assert.ok(one.ok && two.ok, JSON.stringify([one, two]));
  assert.ok(one.unitPrice < two.unitPrice, '산유국의 석유가 서방 왕국보다 싸다');
});

test('★ §19-F3(F07-7) 오퍼는 한 톨도 안 바뀐다 — 성정 배수는 직접 흥정에만 붙는다', async () => {
  const { generateOffers } = await import('../server/engine/ai_nation.js');
  const { localPrice } = await import('../server/engine/economy.js');
  const world = tradeWorld(13);
  const jitter = data.aiNations.offers.priceJitter;
  const offers = generateOffers(world, data, createRng(99));
  assert.ok(offers.length, '오퍼가 하나는 나온다');
  for (const o of offers) {
    const partner = world.nations[o.nationId];
    const base = localPrice(partner, o.resource, data) * (1 + (partner.priceBias || 0));
    const ratio = o.price / base;
    assert.ok(ratio > 1 - jitter - 0.06 && ratio < 1 + jitter + 0.01,
      `${o.nationId}/${o.resource} 오퍼 값이 옛 공식(흔들림 ±${jitter}·최하위 배려 0.95)의 테두리 안이다 (배율 ${ratio.toFixed(3)})`);
  }
});

// ────────────────────────────────────────────────────────────────
// ② F07-7 특산품 — 금화가 다시 물건이 된다
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-7) 특산품 — 만나 본 나라에서만, 재고만큼만, 금화로만 산다', () => {
  const world = tradeWorld(21);
  const rng = createRng(21);
  const n = world.nations.player;
  const before = n.resources.coal || 0;
  const res = applyCommand(world, 'player', { type: 'buySpecialty', nationId: 'ai1', key: 'east_coal_bale' }, data, rng);
  assert.ok(res.ok, JSON.stringify(res));
  assert.ok(n.resources.coal > before, '석탄 채굴을 몰라도 석탄을 쥔다');
  assert.ok(n.gold < 5000, '금화를 치렀다');

  // 만나지 않은 나라의 좌판은 열리지 않는다
  n.metNations = {};
  const nope = applyCommand(world, 'player', { type: 'buySpecialty', nationId: 'ai1', key: 'east_coal_bale' }, data, rng);
  assert.equal(nope.ok, false);
  assert.equal(nope.error.code, 'NOT_MET');
});

test('★ §19-F3(F07-7) 좌판은 마르고 며칠 뒤에 다시 찬다', () => {
  const world = tradeWorld(22);
  const rng = createRng(22);
  const n = world.nations.player;
  const item = data.aiNations.nations.find((a) => a.id === 'ai3').specialties.find((s) => s.key === 'west_old_map');
  for (let i = 0; i < item.stock; i += 1) {
    const r = applyCommand(world, 'player', { type: 'buySpecialty', nationId: 'ai3', key: item.key }, data, rng);
    assert.ok(r.ok, JSON.stringify(r));
  }
  const dry = applyCommand(world, 'player', { type: 'buySpecialty', nationId: 'ai3', key: item.key }, data, rng);
  assert.equal(dry.error.code, 'SOLD_OUT');

  world.tick += item.restockDays;
  restockSpecialties(world, n, data);
  const list = specialtyList(world, n, 'ai3', data);
  assert.equal(list.find((x) => x.key === item.key).left, item.stock, '재고가 다시 찼다');
});

// ────────────────────────────────────────────────────────────────
// ③ F07-5 금화 사용처 — 셋 이상
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-5) 연구 가속 — 금화로 하루를 산다. 내일 끝날 연구는 못 산다', () => {
  const world = tradeWorld(31);
  const rng = createRng(31);
  const n = world.nations.player;
  const r = ensureResearch(n);
  r.active = { key: 'coal_mining', remainingDays: 3, totalDays: 3, startedTick: 0 };
  const gold = n.gold;
  const res = applyCommand(world, 'player', { type: 'hastenResearch' }, data, rng);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(r.active.remainingDays, 2);
  assert.equal(gold - n.gold, hasteCost('coal_mining', data));

  r.active.remainingDays = 1;
  const late = applyCommand(world, 'player', { type: 'hastenResearch' }, data, rng);
  assert.equal(late.ok, false);
  assert.equal(late.error.code, 'ALMOST_DONE');
});

test('★ §19-F3(F07-5) 「지혜의 잎」도 같은 문으로 들어온다 — 특산품이 연구를 앞당긴다', () => {
  const world = tradeWorld(32);
  const rng = createRng(32);
  const n = world.nations.player;
  ensureResearch(n).active = { key: 'bridgeworks', remainingDays: 4, totalDays: 4, startedTick: 0 };
  const res = applyCommand(world, 'player', { type: 'buySpecialty', nationId: 'ai2', key: 'elf_wisdom_leaf' }, data, rng);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.granted.researchDays, 1);
  assert.equal(n.research.active.remainingDays, 3);
});

test('★ §19-F3(F07-5) 금화가 흘러갈 자리가 셋 이상이다 (도구·연구·특산품·꾸미기)', () => {
  const sinks = [
    data.buildings.tools.hoe.tiers[0].gold > 0,
    (data.research.haste?.goldMin ?? 0) > 0,
    data.aiNations.nations.every((a) => (a.specialties || []).every((s) => s.gold > 0)),
    (data.balance.gold.customize?.resident ?? 0) > 0,
    (data.balance.emotionDay.reappraisal?.gold ?? 0) > 0,
  ];
  assert.ok(sinks.filter(Boolean).length >= 4, '금화 사용처가 넷 이상 있다');
});

// ────────────────────────────────────────────────────────────────
// ④ F07-8 감정소 — 한 채뿐, 헐 수 없음, 다시 쓸 수 있음
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-8) 감정소는 한 채뿐이고 헐 수도 옮길 수도 없다', () => {
  assert.equal(data.buildings.appraisal_post.multi, false, '한 채만 세운다');
  assert.equal(data.buildings.appraisal_post.immovable, true, '헐 수도 옮길 수도 없다');
  const world = createWorld({ seed: 41, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  const s = { id: 's_ap', key: 'appraisal_post', tier: 1, x: 4, y: 4, hp: 110, maxHp: 110 };
  (n.structures ||= []).push(s);
  assert.equal(startDemolish(world, n, { structureId: s.id }, data).ok, false);
  assert.equal(startRelocate(world, n, { structureId: s.id, x: 9, y: 9 }, data).ok, false);
});

test('★ §19-F3(F07-8) 재감정 — 주기가 차면 태그 하나를 다시 뽑고 지하를 마저 연다', () => {
  const world = createWorld({ seed: 42, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  (n.structures ||= []).push({ id: 's_ap', key: 'appraisal_post', tier: 1, x: 4, y: 4, hp: 110, maxHp: 110 });
  world.emotionDayDone = true;
  world.emotionDayTick = 0;
  n.gold = 2000;
  n.tags = ['fertile'];
  const cfg = data.balance.emotionDay.reappraisal;

  world.tick = cfg.intervalDays - 1;
  assert.equal(reappraisalState(world, n, data).open, false, '아직 기운이 안 고였다');

  world.tick = cfg.intervalDays;
  assert.equal(reappraisalState(world, n, data).open, true);
  const before = [...n.tags];
  const res = runReappraisal(world, n, data);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(n.tags.length, before.length, '태그 수는 그대로다');
  assert.notDeepEqual(n.tags, before, '한 자리가 갈렸다');
  assert.equal(world.lastAppraisalTick, world.tick);
  assert.equal(reappraisalState(world, n, data).open, false, '쓰고 나면 다시 기다린다');
});

test('★ §19-F3(F07-8) 옛 지도 조각 — 기다리지 않고 한 번 쓴다', () => {
  const world = tradeWorld(43);
  const rng = createRng(43);
  const n = world.nations.player;
  (n.structures ||= []).push({ id: 's_ap', key: 'appraisal_post', tier: 1, x: 4, y: 4, hp: 110, maxHp: 110 });
  world.emotionDayDone = true;
  world.emotionDayTick = world.tick;
  const buy = applyCommand(world, 'player', { type: 'buySpecialty', nationId: 'ai3', key: 'west_old_map' }, data, rng);
  assert.ok(buy.ok, JSON.stringify(buy));
  assert.equal(n.reappraisalCharges, 1);
  assert.equal(reappraisalState(world, n, data).open, true, '표가 있으면 곧바로 열린다');
  const res = applyCommand(world, 'player', { type: 'reappraiseLand' }, data, rng);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(n.reappraisalCharges, 0, '표를 썼다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ F07-9 주민 꾸미기
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-9) 주민의 이름·옷 — 서버가 정본이고 값(금화)을 치른다', () => {
  const world = createWorld({ seed: 51, data, assignments: npcAssignments(data) });
  const rng = createRng(51);
  const n = world.nations.player;
  n.gold = 500;
  const u = { id: 'r9', name: '옛 이름', appearance: { skin: 0, hair: 0, hairColor: 0, outfit: 0, outfitColor: 0 }, job: 'idle', x: 3, y: 3 };
  (n.villagers ||= []).push(u);
  const cost = data.balance.gold.customize.resident;

  const res = applyCommand(world, 'player', {
    type: 'customizeResident', residentId: 'r9', name: '새 이름', appearance: { outfitColor: 4 },
  }, data, rng);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(u.name, '새 이름');
  assert.equal(u.appearance.outfitColor, 4);
  assert.equal(res.cost, cost);
  assert.equal(n.gold, 500 - cost);

  const tooLong = applyCommand(world, 'player', { type: 'customizeResident', residentId: 'r9', name: 'x'.repeat(99) }, data, rng);
  assert.equal(tooLong.error.code, 'BAD_NAME');
  n.gold = 0;
  const broke = applyCommand(world, 'player', { type: 'customizeResident', residentId: 'r9', name: '또' }, data, rng);
  assert.equal(broke.error.code, 'NO_GOLD');
  assert.equal(u.name, '새 이름', '값을 못 치르면 한 글자도 안 바뀐다');
});

test('★ §19-F3(F07-9) 바뀐 이름·옷은 모두가 보는 명부에 그대로 실린다 (멀티 동기)', () => {
  const world = createWorld({ seed: 52, data, assignments: npcAssignments(data) });
  const rng = createRng(52);
  const n = world.nations.player;
  n.gold = 500;
  (n.villagers ||= []).push({ id: 'r9', name: '옛 이름', appearance: { skin: 1, hair: 1, hairColor: 1, outfit: 1, outfitColor: 1 }, job: 'idle', x: 3, y: 3 });
  applyCommand(world, 'player', { type: 'customizeResident', residentId: 'r9', name: '단이', appearance: { outfit: 3 } }, data, rng);
  const view = buildNationView(world, 'player', null, data, { avatarId: 'lord' });
  const seen = ((view.nation && view.nation.residents) || []).find((v) => v.id === 'r9');
  assert.ok(seen, '주민 목록에 실린다');
  assert.equal(seen.name, '단이');
  assert.equal(seen.appearance.outfit, 3);
});

// ────────────────────────────────────────────────────────────────
// ⑥ F07-6 부산물 — 요리와 방한
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-6) 요리 — 사냥꾼 오두막이 서면 고기 한 점이 더 멀리 간다', () => {
  const tiers = data.buildings.hunter_hut.tiers;
  for (const t of tiers) assert.ok(t.foodValueBonus > 0, '단계마다 요리 보정이 있다');
  const world = createWorld({ seed: 61, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  assert.equal(effectValue(n, 'foodValueBonus', data), 0, '오두막이 없으면 옛 규칙 그대로');
  (n.structures ||= []).push({ id: 's_h', key: 'hunter_hut', tier: 2, x: 6, y: 6, hp: 150, maxHp: 150 });
  assert.equal(effectValue(n, 'foodValueBonus', data), tiers[1].foodValueBonus);
  assert.equal(data.buildings.effectRules.stackCap.foodValueBonus, 1, '여러 채 지어도 한 채 몫이다');
});

test('★ §19-F3(F07-6) 방한 — 다이얼은 자료가 쥐고, 설산 곁이 아니면 털을 태우지 않는다', async () => {
  const { dominantBiome } = await import('../server/engine/waves.js');
  const w = data.balance.warmth;
  assert.ok(w && w.biome && w.woolPerPerson > 0 && w.moraleBonus > 0, '방한 다이얼이 자료에 있다');
  assert.ok(data.world.terrain.biomes.codes.includes(w.biome), '방한이 보는 땅은 실재하는 바이옴이다');
  const world = createWorld({ seed: 62, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  // ★ 시작 도읍 둘레는 protectRadius 안이라 바이옴이 덮이지 않는다 — 옛 세이브가 갑자기 털을 쓰지 않는다
  assert.notEqual(dominantBiome(world, n, data), w.biome);
});

// ────────────────────────────────────────────────────────────────
// ⑦ 뷰 계약 — 화면이 셈하지 않게 서버가 값을 다 빚어 보낸다
// ────────────────────────────────────────────────────────────────
test('★ §19-F3(F07-7) 뷰 — 만나 본 나라만 좌판이 실리고, 살 값·팔 값이 따로 온다', () => {
  const world = tradeWorld(71);
  const view = buildNationView(world, 'player', null, data, { avatarId: 'lord' });
  const list = view.tradePartners || [];
  assert.equal(list.length, 3, '만나 본 세 나라');
  for (const p of list) {
    assert.ok(p.buy.oil > 0 && p.sell.oil > 0);
    assert.notEqual(p.buy.oil, p.sell.oil, '사는 값과 파는 값은 다르다');
    assert.ok(Array.isArray(p.specialties));
  }
  world.nations.player.metNations = {};
  const blind = buildNationView(world, 'player', null, data, { avatarId: 'lord' });
  assert.equal((blind.tradePartners || []).length, 0, '만나지 않았으면 좌판이 없다');
});
