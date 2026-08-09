// ★ GDD3 §12 (플레이테스트 피드백 1차) 계약 회귀 — docs/PROTOCOL.md §0-Z
//   풋프린트 · 정착지 본부/승격 · 조건 가시화 · 유입 가속 · 캐러밴 게이트 · 시야 · 철거/이전
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { disableCompanions } from '../server/engine/companions.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf, territoryRadius } from '../server/engine/world.js';
import {
  footprint, footRect, rectGap, anchorFromCell, centerOf, structureAtCell,
  validatePlacement, completeStructure, structureView, buildingKeys, housingCapacity,
} from '../server/engine/structures.js';
import { visionTierBonus, fogCfg } from '../server/engine/fog.js';
import { arrivalStatus, arrivalIntervalDays, spawnResident } from '../server/engine/residents.js';
import { buildWorldSnapshot, buildNationView } from '../server/engine/view.js';

const data = loadGameData();
/* ★ GDD3 §15-C — 이 파일은 **다른 한 계층**을 잰다(주민 산출·소비·공사 자재·전체 루프).
   동료는 같은 곳간에 손을 대므로 켜 두면 「주민이 낸 몫 = 국고 증가분」 같은 등식이 흐려진다.
   동료 계층 자체의 회귀는 test/playtest15.test.js 가 따로 잰다. */
disableCompanions(data);
const newWorld = (seed = 1) => createWorld({ seed, data, playerName: '테스트' });
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

// ────────────────────────────────────────────────────────────────
// §12-1 풋프린트
// ────────────────────────────────────────────────────────────────
test('§12-1 풋프린트 — 모든 건물이 칸 수를 갖고, 표가 스펙과 같다', () => {
  for (const key of buildingKeys(data)) {
    const f = footprint(key, data);
    assert.ok(f.w >= 1 && f.h >= 1, `${key} 풋프린트`);
  }
  /* ★ §15-B-3 재조정 — 뒤에 열리는 건물일수록 넓게 자리 잡는다(그 값은 아래 단조 검사가 지킨다). */
  const want = {
    tent: [1, 1], hut: [2, 2], granary: [2, 3], well: [2, 2],
    storage: [3, 3], trading_post: [3, 3],
    sawmill: [3, 2], quarry_camp: [3, 2], smithy: [3, 3], smelter: [3, 3],
    barracks: [3, 4], shrine: [4, 4], market: [3, 4],
    house: [2, 3], manor: [3, 4], appraisal_post: [2, 2],
    arrow_tower: [1, 1], ballista: [2, 2], cannon: [2, 3],
    lamp: [1, 1], banner: [1, 1], garden: [1, 1], fountain: [1, 1],
    campfire: [4, 4], consulate: [4, 4], monument: [3, 3], woodpile: [1, 2],
  };
  for (const [key, [w, h]] of Object.entries(want)) {
    const f = footprint(key, data);
    assert.deepEqual([f.w, f.h], [w, h], `${key} 는 ${w}×${h}`);
  }
});

test('§12-1 풋프린트 — 앵커는 좌상단, 1×1 이면 옛 좌표와 완전히 같다', () => {
  assert.deepEqual(anchorFromCell('tent', 10, 20, data), { x: 10, y: 20 });
  assert.deepEqual(centerOf('tent', 10, 20, data), { x: 10, y: 20 });
  // 3×3 은 커서 칸이 한가운데가 되도록 물려 잡는다
  assert.deepEqual(anchorFromCell('monument', 10, 20, data), { x: 9, y: 19 });
  assert.deepEqual(centerOf('monument', 9, 19, data), { x: 10, y: 20 });
  // 사각형 사이 간격 — 1×1 끼리면 체비쇼프 거리와 같은 값
  const a = footRect('tent', 0, 0, data);
  const b = footRect('tent', 2, 0, data);
  assert.equal(rectGap(a, b), 2);
  // 2×2 는 제 몸만큼 더 밀어낸다
  assert.equal(rectGap(footRect('hut', 0, 0, data), footRect('hut', 2, 0, data)), 1);
});

test('§12-1 배치 — 풋프린트 전체가 영토·지형·간격을 지켜야 놓인다', () => {
  const w = newWorld(101);
  const n = w.nations.player;
  const t = townOf(w, 'player');
  // 본부가 이미 4×4 로 서 있다 — 그 사각형에 겹치면 거절
  const hq = n.structures.find((s) => data.buildings[s.key]?.hq);
  assert.ok(hq, '본부가 있다');
  assert.equal(footprint(hq.key, data).w, 4);
  const onHq = validatePlacement(w, n, 'tent', hq.x + 1, hq.y + 1, data);
  assert.equal(onHq.ok, false);
  assert.equal(onHq.code, 'TOO_CLOSE');
  // 본부는 도읍 좌표를 덮는다 (클릭 판정)
  assert.equal(structureAtCell(n, t.x, t.y, data)?.id, hq.id);
});

test('건설 위치에 서 있는 아바타나 주민이 있으면 착공할 수 없다', () => {
  const w = newWorld(102);
  const n = w.nations.player;
  const t = townOf(w, 'player');
  let spot = null;
  for (let r = 5; r < 20 && !spot; r += 1) {
    for (let dx = -r; dx <= r && !spot; dx += 1) {
      for (let dy = -r; dy <= r && !spot; dy += 1) {
        const x = t.x + dx, y = t.y + dy;
        if (validatePlacement(w, n, 'tent', x, y, data).ok) spot = { x, y };
      }
    }
  }
  assert.ok(spot, '비어 있는 건설 칸을 찾는다');
  n.avatars.lord = { id: 'lord', x: spot.x, y: spot.y };
  let v = validatePlacement(w, n, 'tent', spot.x, spot.y, data);
  assert.deepEqual({ ok: v.ok, code: v.code }, { ok: false, code: 'PERSON_OCCUPIED' }, '플레이어 아바타');

  delete n.avatars.lord;
  n.villagers.push({ id: 'v1', x: spot.x, y: spot.y, job: 'idle' });
  v = validatePlacement(w, n, 'tent', spot.x, spot.y, data);
  assert.deepEqual({ ok: v.ok, code: v.code }, { ok: false, code: 'PERSON_OCCUPIED' }, '주민');
});

test('공사 중인 건물 부지에는 플레이어가 들어갈 수 없다', () => {
  const w = newWorld(104);
  const n = w.nations.player;
  const t = townOf(w, 'player');
  let spot = null;
  for (let r = 5; r < 20 && !spot; r += 1) {
    for (let dx = -r; dx <= r && !spot; dx += 1) {
      for (let dy = -r; dy <= r && !spot; dy += 1) {
        const x = t.x + dx, y = t.y + dy;
        if (validatePlacement(w, n, 'tent', x, y, data).ok) spot = { x, y };
      }
    }
  }
  assert.ok(spot, '비어 있는 공사 부지를 찾는다');
  n.construction.push({ id: 'c-test', building: 'tent', mode: 'build', x: spot.x, y: spot.y });
  const res = applyCommand(w, 'player', { type: 'lordMove', x: spot.x, y: spot.y }, data, createRng(104));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'STRUCTURE_BLOCKED');
});

// ────────────────────────────────────────────────────────────────
// §12-2 정착지 본부 · 승격
// ────────────────────────────────────────────────────────────────
test('§12-2 본부 — 4×4 · 이전/철거 불가 · 손으로 개축 불가', () => {
  const w = newWorld(103);
  const n = w.nations.player;
  const rng = createRng(103);
  const hq = n.structures.find((s) => data.buildings[s.key]?.hq);
  const v = structureView(n, hq, data);
  assert.equal(v.hq, true);
  assert.equal(v.fw, 4);
  assert.equal(v.fh, 4);
  assert.equal(v.immovable, true);
  assert.equal(v.autoTier, true);
  assert.equal(v.nextTier, null, '손으로 올릴 다음 단계를 내주지 않는다');

  __openChapter(n, 2);
  const move = applyCommand(w, 'player', { type: 'relocateStructure', structureId: hq.id, x: hq.x + 6, y: hq.y }, data, rng);
  assert.equal(move.ok, false);
  assert.equal(move.error.code, 'IMMOVABLE');
  const kill = applyCommand(w, 'player', { type: 'demolishStructure', structureId: hq.id }, data, rng);
  assert.equal(kill.ok, false);
  assert.equal(kill.error.code, 'IMMOVABLE');
  __openChapter(n, 6);
  const up = applyCommand(w, 'player', { type: 'upgradeStructure', structureId: hq.id }, data, rng);
  assert.equal(up.ok, false);
  assert.equal(up.error.code, 'AUTO_TIER');
});

test('§12-2 승격 — 일 틱은 티어를 올리지 않는다 (버튼만)', () => {
  let w = newWorld(105);
  const rng = createRng(105);
  const n = w.nations.player;
  completeStructure(w, n, { building: 'hut', tier: 1, x: n.structures[0].x + 7, y: n.structures[0].y, placed: true }, data);
  n.resources.grain = 60;
  for (let i = 0; i < 6; i += 1) w = step(w, [], rng, data).state;
  assert.equal(w.nations.player.tier, 0, '엿새가 지나도 저절로 오르지 않는다');
  const r = applyCommand(w, 'player', { type: 'promoteSettlement' }, data, rng);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(w.nations.player.tier, 1);
  assert.equal(territoryRadius(w.nations.player, data), 12);   // ★ Sprint 4 — 초반은 조금(+3)
});

// ────────────────────────────────────────────────────────────────
// §12-3 조건 가시화
// ────────────────────────────────────────────────────────────────
test('§12-3 조건 가시화 — 티어 조건과 유입 조건이 현재값/필요값을 함께 낸다', () => {
  const w = newWorld(107);
  const n = w.nations.player;
  const view = buildNationView(w, 'player', null, data);
  for (const r of view.tier.next.reqs) {
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.need, 'number');
    assert.equal(typeof r.have, 'number');
    assert.ok(r.text && r.text.length);
  }
  const arr = view.nation.housing.arrival;
  assert.ok(Array.isArray(arr.reqs) && arr.reqs.length >= 3, '유입 조건표가 있다');
  for (const r of arr.reqs) {
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(r.text && r.text.length);
  }
  assert.equal(arr.open, false, '아직 사람이 올 때가 아니다');
  assert.equal(arr.reqs.find((r) => r.key === 'unlocked').ok, false);
});

// ────────────────────────────────────────────────────────────────
// §12-4 주민 유입 가속
// ────────────────────────────────────────────────────────────────
test('§12-4 유입 — 빈 개척지는 0.5~1일, 붐비면 느려진다', () => {
  const w = newWorld(109);
  const n = w.nations.player;
  __openChapter(n, 4);
  n.resources.grain = 400;
  completeStructure(w, n, { building: 'manor', tier: 3, x: n.structures[0].x + 7, y: n.structures[0].y, placed: true }, data);
  assert.ok(housingCapacity(n, data) > 0);

  const empty = arrivalIntervalDays(n, data);
  assert.ok(empty >= 0.5 && empty <= 1.0, `빈 자리에서 ${empty}일 — 0.5~1일이어야 한다`);

  const rng = createRng(109);
  for (let i = 0; i < 8; i += 1) spawnResident(w, n, data, rng);
  const crowded = arrivalIntervalDays(n, data);
  assert.ok(crowded > empty, `붐비면 느려진다 (${empty} → ${crowded})`);

  const st = arrivalStatus(n, data);
  assert.equal(st.open, true);
  assert.equal(typeof st.daysUntil, 'number', '다음 사람까지 남은 날수가 온다');
  assert.ok(st.daysUntil >= 0 && st.daysUntil <= crowded + 0.001);
});

// ────────────────────────────────────────────────────────────────
// §12-6 캐러밴 게이트
// ────────────────────────────────────────────────────────────────
test('§12-6 캐러밴 — 무역이 열리기 전에는 스냅샷에도 없다', () => {
  const w = newWorld(111);
  const n = w.nations.player;
  assert.ok((w.map.caravans || []).length > 0, '월드에는 상단 경로가 있다');
  assert.equal(buildWorldSnapshot(w, 'player', data).caravans.length, 0, '뷰에는 실리지 않는다');
  __openChapter(n, 9);            // 8장을 지나야 무역이 열린다
  assert.ok(buildWorldSnapshot(w, 'player', data).caravans.length > 0, '무역이 열리면 다닌다');
});

// ────────────────────────────────────────────────────────────────
// §12-8 시야
// ────────────────────────────────────────────────────────────────
test('§12-8 시야 — 기본 + 티어 × 0.5', () => {
  const w = newWorld(113);
  const n = w.nations.player;
  const per = fogCfg(data).visionPerTier;
  assert.equal(per, 0.5);
  assert.equal(visionTierBonus(n, data), 0);
  n.tier = 4;
  assert.equal(visionTierBonus(n, data), 2);
});

// ────────────────────────────────────────────────────────────────
// §12-12 철거 · 이전
// ────────────────────────────────────────────────────────────────
function withTent(seed) {
  const w = newWorld(seed);
  const n = w.nations.player;
  __openChapter(n, 6);
  const t = townOf(w, 'player');
  // 본부(4×4)에서 두 칸 떨어지고 영토(반경 6) 안에 드는 자리
  const s = completeStructure(w, n, { building: 'tent', tier: 1, x: t.x + 4, y: t.y, placed: true }, data);
  return { w, n, s, t, rng: createRng(seed) };
}

test('§12-12 철거 — 40% 일하면 자재 절반이 돌아오고, 그동안 효과가 멎는다', () => {
  const { w, n, s, rng } = withTent(115);
  const cap0 = housingCapacity(n, data);
  assert.ok(cap0 > 0);
  const wood0 = n.resources.wood;

  const r = applyCommand(w, 'player', { type: 'demolishStructure', structureId: s.id }, data, rng);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const cost = data.buildings.tent.tiers[0];
  assert.ok(Math.abs(r.buildPoints - cost.buildPoints * data.balance.structureWork.demolishPointsRatio) < 0.01);
  assert.ok(Math.abs(r.refund.wood - cost.cost.wood * data.balance.structureWork.refundRatio) < 0.01);
  assert.equal(s.inactive, true);
  assert.equal(housingCapacity(n, data), cap0 - 1, '허무는 동안 잠자리가 빠진다');
  assert.equal(structureView(n, s, data).work.mode, 'demolish');

  // 되돌리기
  const c = applyCommand(w, 'player', { type: 'cancelStructureWork', structureId: s.id }, data, rng);
  assert.equal(c.ok, true);
  assert.equal(s.inactive, false);
  assert.equal(housingCapacity(n, data), cap0, '되돌리면 잠자리가 되살아난다');

  // 다시 헐고 끝까지 (건설 인력으로 민다)
  assert.equal(applyCommand(w, 'player', { type: 'demolishStructure', structureId: s.id }, data, rng).ok, true);
  n.buildPoints = 999;
  const out = step(w, [], rng, data);
  const after = out.state.nations.player;
  assert.ok(!after.structures.some((x) => x.id === s.id), '건물이 사라졌다');
  assert.ok(after.resources.wood >= wood0 + cost.cost.wood * data.balance.structureWork.refundRatio - 0.01,
    `자재가 돌아왔다 (${wood0} → ${after.resources.wood})`);
});

test('§12-12 이전 — 해체+재건 두 마디, 자재 추가 없음, 끝나면 새 자리', () => {
  const { w, n, s, t, rng } = withTent(117);
  const wood0 = n.resources.wood;
  const to = { x: t.x + 4, y: t.y + 3 };
  const r = applyCommand(w, 'player', { type: 'relocateStructure', structureId: s.id, x: to.x, y: to.y }, data, rng);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(n.resources.wood, wood0, '자재를 더 내지 않는다');
  assert.equal(s.inactive, true, '옮기는 동안 효과가 멎는다');
  const site = n.construction.find((c) => c.mode === 'relocate');
  assert.equal(site.phase, 'takedown');
  const cost = data.buildings.tent.tiers[0].buildPoints;
  const cfg = data.balance.structureWork;
  assert.ok(Math.abs(site.takedownPoints - cost * cfg.relocateTakedownRatio) < 0.01);
  assert.ok(Math.abs(site.rebuildPoints - cost * cfg.relocateRebuildRatio) < 0.01);

  // 해체 마디를 민다 → 재건 마디로 이어진다
  n.buildPoints = 999;
  let out = step(w, [], rng, data);
  let cur = out.state.nations.player;
  let live = cur.construction.find((c) => c.mode === 'relocate');
  if (live) {
    assert.equal(live.phase, 'rebuild', '해체가 끝나면 재건 마디');
    // 재건 마디에서는 되돌릴 수 없다
    const late = applyCommand(out.state, 'player', { type: 'cancelStructureWork', structureId: s.id }, data, rng);
    assert.equal(late.ok, false);
    assert.equal(late.error.code, 'TOO_LATE');
    cur.buildPoints = 999;
    out = step(out.state, [], rng, data);
    cur = out.state.nations.player;
  }
  const moved = cur.structures.find((x) => x.id === s.id);
  assert.ok(moved, '건물은 그대로 남는다');
  assert.equal(moved.x, to.x);
  assert.equal(moved.y, to.y);
  assert.ok(!moved.inactive, '효과가 되살아난다');
  assert.equal(cur.resources.wood, wood0, '끝까지 자재를 더 내지 않았다');
});

test('§12-12 이전 — 못 놓을 자리는 거절한다 (제자리 포함)', () => {
  const { w, s, rng } = withTent(119);
  const same = applyCommand(w, 'player', { type: 'relocateStructure', structureId: s.id, x: s.x, y: s.y }, data, rng);
  assert.equal(same.ok, false);
  assert.equal(same.error.code, 'BAD_POSITION');
  const far = applyCommand(w, 'player', { type: 'relocateStructure', structureId: s.id, x: 2, y: 2 }, data, rng);
  assert.equal(far.ok, false);
  assert.equal(far.error.code, 'OUT_OF_TERRITORY');
});
