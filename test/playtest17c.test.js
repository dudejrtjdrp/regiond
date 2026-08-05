// §17-14 깃발 점령 · §17-15 역할군 개성 회귀
//
// 설계 두 갈래를 붙든다.
//   ① "깃발을 정착지 외부에 일정 개수 이상 건설하면 해당 지역을 점령 — 스타크래프트에서 멀티를
//      하는 느낌. 건축가와 국방대신이 함께 이동하면 그 영토를 점령"
//      → claims.claimStep: 본영 밖 개척 깃발 flagsRequired개(groupRadius 군집) + 건축가·국방대신
//        호위(escortRadius) → nation.claims 에 새 원. inTerritory 가 그 원을 우리 땅으로 안다.
//   ② "모두가 건축은 할 수 있으나 특정 건물은 건축가만 — 모든 역할군이 각자 특징을 살린 요소"
//      → roles.defs[*].perk(§17-15) + buildings.requiresRole(저택·노포·화포).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, dist, terrainIndex, inTerritory } from '../server/engine/world.js';
import { applyCommand } from '../server/engine/commands.js';
import { createRng } from '../server/engine/rng.js';
import { claimStep, claimAt, claimCfg } from '../server/engine/claims.js';
import { completeStructure } from '../server/engine/structures.js';
import { creatureMayStand } from '../server/engine/ecology.js';
import { settlementGatherFactor } from '../server/engine/residents.js';
import { rolePerk } from '../server/engine/npc.js';
import { produceNation } from '../server/engine/tick.js';
import { collectHooks } from '../server/engine/artifacts.js';
import { importPrice, exportPrice } from '../server/engine/economy.js';

const data = loadGameData();
const SEED = 20260807;
const CLAIM = claimCfg(data);
const cmd = (world, c) => applyCommand(world, 'player', c, data, createRng(7));

function scene(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, opts.chapter ?? 8);
  const t = townOf(world, 'player');
  for (const k of ['wood', 'stone', 'grain', 'steel']) nation.resources[k] = 300;
  return { world, nation, t };
}

/** 시험용 물감 — 지정한 사각형을 풀밭으로 칠한다(시드에 기대지 않는 결정론 지형) */
function paintGrass(world, x0, y0, x1, y1) {
  const idx = terrainIndex(data);
  const ch = String.fromCharCode(48 + idx.grass);
  const chars = world.map.terrain.split('');
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) chars[y * world.map.size + x] = ch;
  world.map.terrain = chars.join('');
}

/** 시험용 정리 — 자리 둘레의 자원 노드를 걷어 낸다(배치 검증의 nodeClearance 가 안 걸리게) */
function clearNodesAround(world, x, y, r = 4) {
  world.map.nodes = (world.map.nodes || []).filter((n) => dist(n.x, n.y, x, y) > r);
}

/** 깃발 실체를 곧장 세운다 — 배치 검증을 거치지 않는 조립(claimStep 만 재는 시험용) */
function putFlag(world, nation, x, y) {
  return completeStructure(world, nation, { building: 'claim_flag', tier: 1, x, y, placed: true }, data);
}

/** 건축가 자리를 동료 봇으로 채우고 그 아바타를 (x,y)에 세운다 */
function architectAt(nation, x, y) {
  nation.roles.build.holder = 'npc';
  nation.roles.build.botId = 'bot~t1';
  nation.companions.list.push({ id: 'bot~t1', seat: 1, name: '시험 건축가', active: true, role: 'build', mem: {} });
  nation.avatars['bot~t1'] = { id: 'bot~t1', x, y };
}

/** 국방 자리를 사람 아바타로 채우고 그 아바타를 (x,y)에 세운다 */
function marshalAt(nation, x, y) {
  nation.roles.defense.holder = 'player';
  nation.roles.defense.owner = 'av~t9';
  nation.avatars['av~t9'] = { id: 'av~t9', x, y };
}

// ────────────────────────────────────────────────────────────────
// ① §17-14 — 깃발 점령
// ────────────────────────────────────────────────────────────────
test('★ §17-14 점령 — 깃발 셋 + 건축가·국방대신 호위 → 새 영토가 생기고 성역·영토 판정이 따라온다', () => {
  const { world, nation, t } = scene();
  const bx = t.x + 20;
  const by = t.y;
  paintGrass(world, bx - 4, by - 4, bx + 6, by + 6);
  assert.equal(inTerritory(world, nation, bx, by, data), false, '전제: 본영 밖이다');

  putFlag(world, nation, bx, by);
  putFlag(world, nation, bx + 2, by);
  putFlag(world, nation, bx + 1, by + 2);
  const cx = Math.round((bx + bx + 2 + bx + 1) / 3);
  const cy = Math.round((by + by + by + 2) / 3);
  architectAt(nation, cx, cy);
  marshalAt(nation, cx + 1, cy);

  const events = claimStep(world, nation, data);
  assert.equal(events.length, 1, '점령 이벤트가 하나 나온다');
  assert.equal(events[0].kind, 'territory_claimed');
  assert.equal(nation.claims.length, 1);
  const claim = nation.claims[0];
  assert.equal(claim.radius, CLAIM.claimRadius);
  assert.ok(dist(claim.x, claim.y, cx, cy) <= 2, '점령 중심이 깃발 무게중심 곁이다');

  // 새 원이 곧 우리 땅이다 — inTerritory · claimAt · 성역(creatureMayStand)이 한 몸으로 따라온다
  assert.equal(inTerritory(world, nation, claim.x, claim.y, data), true);
  assert.ok(claimAt(nation, claim.x, claim.y), 'claimAt 이 그 원을 짚는다');
  assert.equal(creatureMayStand(world, nation, data, { sp: 'wolf' }, claim.x, claim.y), false,
    '점령지 안은 본영과 같은 성역이다 — 짐승이 서지 못한다');

  // 같은 깃발로 두 번 점령하지 않는다 — 깃발이 이제 우리 땅 안이라 후보에서 빠진다
  assert.equal(claimStep(world, nation, data).length, 0, '재판정은 아무것도 더 만들지 않는다');
  assert.equal(nation.claims.length, 1);
});

test('★ §17-14 점령 실패 — 깃발 둘뿐 / 호위 하나가 멀리 / 상한(maxClaims) 도달이면 각각 서지 않는다', () => {
  const { world, nation, t } = scene();
  const bx = t.x + 20;
  const by = t.y;
  paintGrass(world, bx - 4, by - 4, bx + 6, by + 6);

  // ⓐ 깃발이 둘뿐 — flagsRequired(3) 미달
  putFlag(world, nation, bx, by);
  putFlag(world, nation, bx + 2, by);
  architectAt(nation, bx + 1, by);
  marshalAt(nation, bx + 1, by + 1);
  assert.equal(claimStep(world, nation, data).length, 0, '깃발 둘로는 점령하지 못한다');

  // ⓑ 셋을 채웠지만 국방대신이 멀다 — escortRadius 밖
  putFlag(world, nation, bx + 1, by + 2);
  nation.avatars['av~t9'].x = bx + CLAIM.escortRadius + 8;
  assert.equal(claimStep(world, nation, data).length, 0, '호위 하나가 멀면 서지 않는다');

  // ⓒ 국방대신이 돌아오면 선다
  nation.avatars['av~t9'].x = bx + 1;
  assert.equal(claimStep(world, nation, data).length, 1, '둘이 함께 서야 비로소 점령이다');

  // ⓓ 상한 — maxClaims 를 채우면 새 깃발 무리는 무시된다
  const far = t.x - 30;
  paintGrass(world, far - 3, by - 3, far + 4, by + 4);
  while (nation.claims.length < CLAIM.maxClaims) {
    nation.claims.push({ id: `clmX${nation.claims.length}`, x: 5 + nation.claims.length * 25, y: 5, radius: CLAIM.claimRadius, tick: 0 });
  }
  putFlag(world, nation, far, by);
  putFlag(world, nation, far + 2, by);
  putFlag(world, nation, far + 1, by + 2);
  nation.avatars['bot~t1'].x = far + 1;
  nation.avatars['bot~t1'].y = by;
  nation.avatars['av~t9'].x = far + 1;
  nation.avatars['av~t9'].y = by + 1;
  assert.equal(claimStep(world, nation, data).length, 0, '상한을 채우면 더는 서지 않는다');
  assert.equal(nation.claims.length, CLAIM.maxClaims);
});

test('★ §17-14 깃발 배치 — 영토 밖 ok(사거리 안) · 다른 건물은 여전히 거절 · 사거리 밖 깃발도 거절', () => {
  const { world, nation, t } = scene();
  const out1 = { x: t.x + 16, y: t.y };
  paintGrass(world, out1.x - 3, out1.y - 3, out1.x + 3, out1.y + 3);
  clearNodesAround(world, out1.x, out1.y);
  assert.equal(inTerritory(world, nation, out1.x, out1.y, data), false, '전제: 본영 밖이다');

  // ⓐ 개척 깃발 — 유일하게 영토 밖에 선다(allowOutsideTerritory)
  const flag = cmd(world, { type: 'placeBuilding', building: 'claim_flag', x: out1.x, y: out1.y });
  assert.equal(flag.ok, true, JSON.stringify(flag.error ?? null));
  assert.equal(flag.building, 'claim_flag');

  // ⓑ 같은 자리의 여느 건물 — 영토 밖이라 거절 (자리가 겹치지 않게 옆 칸에서 잰다)
  const out2 = { x: out1.x + 5, y: out1.y };
  paintGrass(world, out2.x - 2, out2.y - 2, out2.x + 2, out2.y + 2);
  clearNodesAround(world, out2.x, out2.y);
  const tent = cmd(world, { type: 'placeBuilding', building: 'tent', x: out2.x, y: out2.y });
  assert.equal(tent.ok, false);
  assert.equal(tent.error.code, 'OUT_OF_TERRITORY', '깃발이 아닌 건물의 문은 그대로 닫혀 있다');

  // ⓒ 본영에서 너무 먼 깃발 — claim.maxRangeFromTown 밖
  const far = { x: t.x + CLAIM.maxRangeFromTown + 6, y: t.y };
  paintGrass(world, far.x - 2, far.y - 2, far.x + 2, far.y + 2);
  clearNodesAround(world, far.x, far.y);
  const tooFar = cmd(world, { type: 'placeBuilding', building: 'claim_flag', x: far.x, y: far.y });
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.error.code, 'TOO_FAR', '지도 반대편에 깃발만 던져 둘 수는 없다');
});

// ────────────────────────────────────────────────────────────────
// ② §17-15 — 역할군 개성
// ────────────────────────────────────────────────────────────────
test('★ §17-15 perk 배수 — 자리가 채워졌을 때만 살아난다(공석이면 전부 1)', () => {
  const { nation } = scene();
  const fields = {
    farm: 'residentGatherMultiplier', factory: 'factoryCapacityMultiplier',
    build: 'siteWorkMultiplier', defense: 'militiaDpsMultiplier', saint: 'healMultiplier',
  };
  for (const [role, field] of Object.entries(fields)) {
    nation.roles[role].holder = null;
    assert.equal(rolePerk(nation, role, field, data), 1, `${role} 공석 → 무보정`);
    nation.roles[role].holder = 'npc';
    assert.equal(rolePerk(nation, role, field, data), data.roles.defs[role].perk[field],
      `${role} 재임 → perk.${field}`);
  }
});

test('★ §17-15 농정관 — 자리가 차면 주민 채집 배수가 정확히 residentGatherMultiplier 배가 된다', () => {
  const { nation } = scene();
  nation.gatherMorale = 1;                          // 사기 항을 고정해 perk 만 잰다
  nation.roles.farm.holder = null;
  const vacant = settlementGatherFactor(nation, data, 'wood');
  nation.roles.farm.holder = 'npc';
  const staffed = settlementGatherFactor(nation, data, 'wood');
  const perk = data.roles.defs.farm.perk.residentGatherMultiplier;
  assert.ok(staffed > vacant, `채워지면 커진다 (${vacant} → ${staffed})`);
  assert.ok(Math.abs(staffed / vacant - perk) < 0.01, `배율이 ${perk} 다 (${(staffed / vacant).toFixed(3)})`);
});

test('★ §17-15 공장장 — 강재 산출이 (재임 O × perk) / 공석 O 비율로 갈린다', () => {
  const make = () => {
    const world = createWorld({ seed: 99, data, assignments: npcAssignments(data) });
    const n = world.nations.player;
    n.tier = 3;
    openChapterForDebug(world, n, data, 10);
    n.population = 50; n.morale = 1; n.tags = [];
    n.resources.ironOre = 5000; n.resources.fuel = 5000;   // 입력이 병목이 안 되게
    return { world, n };
  };
  const a = make();                                  // 공장장 재임(npc) — perk 1.15
  const steelStaffed = produceNation(a.world, a.n, data, collectHooks(a.n, data)).steel;
  const b = make();
  b.n.roles.factory.holder = null;                   // 공석 — officer 0.65 · perk 없음
  const steelVacant = produceNation(b.world, b.n, data, collectHooks(b.n, data)).steel;
  assert.ok(steelStaffed > 0 && steelVacant > 0, '두 쪽 다 강재가 난다');
  const perk = data.roles.defs.factory.perk.factoryCapacityMultiplier;
  const vacantO = data.roles.officer.vacant;         // 0.65
  const expected = (1.0 * perk) / vacantO;           // perk 가 없다면 1/0.65 만 나와야 한다
  assert.ok(Math.abs(steelStaffed / steelVacant - expected) < 0.02,
    `재임/공석 비율 ${(steelStaffed / steelVacant).toFixed(3)} ≈ ${expected.toFixed(3)} (perk ${perk} 포함)`);
});

test('★ §17-15 외교관 — 자리가 차면 살 때 3% 싸고 팔 때 3% 비싸다', () => {
  const { nation } = scene();
  const bonus = data.roles.defs.trade.perk.tradeMarginBonus;
  nation.roles.trade.holder = null;
  const buyVacant = importPrice(2.0, nation, data);
  const sellVacant = exportPrice(2.0, data, nation);
  nation.roles.trade.holder = 'npc';
  const buyStaffed = importPrice(2.0, nation, data);
  const sellStaffed = exportPrice(2.0, data, nation);
  /* 외교관은 perk 밖에서도 정보손실·환스프레드를 이미 줄인다 — 그래서 수입가는 배율 비교 대신
     「(1 − bonus) 항이 정확히 곱해졌는가」를 잰다: perk 를 걷어낸 값끼리 비교한다. */
  assert.ok(buyStaffed < buyVacant, `재임이면 더 싸게 산다 (${buyVacant.toFixed(3)} → ${buyStaffed.toFixed(3)})`);
  assert.ok(Math.abs(sellStaffed / sellVacant - (1 + bonus)) < 1e-9,
    `수출가는 정확히 ${1 + bonus}배다 (${(sellStaffed / sellVacant).toFixed(4)})`);
  assert.ok(Math.abs(exportPrice(2.0, data) - sellVacant) < 1e-9, 'nation 없는 옛 호출은 그대로다');
});

test('★ §17-15 건축가 전용 — 자리가 비면 노포 착공이 ROLE_REQUIRED 로 막히고, 채우면 열린다', () => {
  const { world, nation, t } = scene();
  // 노포는 2×2 라 커서 칸에서 오른쪽·아래로 한 칸을 더 차지한다 — 반경 9 안에 온전히 들어오는 자리
  const spot = { x: t.x + 5, y: t.y + 5 };
  paintGrass(world, spot.x - 2, spot.y - 2, spot.x + 3, spot.y + 3);
  clearNodesAround(world, spot.x, spot.y);
  nation.roles.build.holder = null;

  const denied = cmd(world, { type: 'placeBuilding', building: 'ballista', x: spot.x, y: spot.y });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'ROLE_REQUIRED', '건축가 없이는 대공사 도면이 안 나온다');

  nation.roles.build.holder = 'npc';                 // 동료 봇이 자리를 채워도 (사람과 똑같이) 열린다
  const allowed = cmd(world, { type: 'placeBuilding', building: 'ballista', x: spot.x, y: spot.y });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error ?? null));
  assert.equal(allowed.building, 'ballista');
});
