// ★ GDD3 §13-A (플레이테스트 피드백 2차) 계약 회귀 — docs/PROTOCOL.md §0-Y
//   조건 수량 단일 정본 · 주민 노동 국고 반영 · 주민 도착 · 저장 상한
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { step } from '../server/engine/tick.js';
import { townOf } from '../server/engine/world.js';
import { completeStructure } from '../server/engine/structures.js';
import { nextTierStatus, requirementStatus } from '../server/engine/tiers.js';
import { arrivalStatus } from '../server/engine/residents.js';
import { chapterView } from '../server/engine/progression.js';
import { buildNationView } from '../server/engine/view.js';
import { resourceReq, structureReq, populationReq, haveResource } from '../server/engine/requirements.js';

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
