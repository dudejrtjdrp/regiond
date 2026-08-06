// §17-16 이웃 나라 가시화 회귀
//
// 인수인계 §2-A 를 붙든다: "AI 3국은 교역 상대로만 존재한다 — 월드에 가시화한다".
//   ① 도읍은 화면이 그릴 수 있게 스냅샷에 실려 있어야 한다(preset · 이름 · known).
//   ② visitNation: 내 아바타가 도읍 중심 towns.visitRadius 안이면 그 나라를 만난 것으로 적는다
//      (nation.metNations[상대] = 그날). 밖이면 OUT_OF_RANGE.
//   ③ buildWorldState 의 가격 마스킹은 이제 `외교관 OR 만난 나라` 다 —
//      직접 가 본 나라의 시세는 자리가 비어도 계속 보인다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, dist } from '../server/engine/world.js';
import { applyCommand, hasMet, visitRadius } from '../server/engine/commands.js';
import { createRng } from '../server/engine/rng.js';
import { buildWorldState, buildWorldSnapshot } from '../server/engine/view.js';
import { revealAvatar } from '../server/engine/fog.js';
import { publicWorld } from '../server/engine/data.js';

const data = loadGameData();
const SEED = 20260808;
const AI = 'ai1';
const R = visitRadius(data);
const cmd = (world, c) => applyCommand(world, 'player', c, data, createRng(7));

function scene(opts = {}) {
  const world = createWorld({ seed: opts.seed ?? SEED, data, playerName: '개척자' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, opts.chapter ?? 8);
  const t = townOf(world, AI);
  return { world, nation, t };
}

/** 내 아바타를 그 자리에 세운다 — 찾아가기는 **발**의 판정이라 좌표 하나가 전부다 */
function standAt(nation, x, y) {
  nation.avatars.lord = { id: 'lord', name: '개척자', x, y, tick: 0 };
  return nation.avatars.lord;
}

// ────────────────────────────────────────────────────────────────
// ① 반경 판정 — 안과 밖
// ────────────────────────────────────────────────────────────────
test('★ §17-16 찾아가기 반경 — 도읍 밖이면 거절, 안이면 받아들인다', () => {
  const { world, nation, t } = scene();
  assert.ok(R > 0, `자료에 towns.visitRadius 가 있다 (${R})`);

  // ⓐ 반경 밖 — 한 걸음 모자라도 문은 열리지 않는다
  standAt(nation, t.x + R + 2, t.y);
  const far = cmd(world, { type: 'visitNation', nationId: AI });
  assert.equal(far.ok, false);
  assert.equal(far.error.code, 'OUT_OF_RANGE');
  assert.equal(hasMet(nation, AI), false, '문 밖에서 본 것은 만난 것이 아니다');

  // ⓑ 반경 안 — 이름·성정·시세가 그 자리에서 온다
  standAt(nation, t.x + R - 1, t.y);
  const near = cmd(world, { type: 'visitNation', nationId: AI });
  assert.equal(near.ok, true, JSON.stringify(near.error ?? null));
  assert.equal(near.nationId, AI);
  assert.equal(near.name, world.nations[AI].name);
  assert.equal(near.concept, data.aiNations.nations.find((a) => a.id === AI).concept);
  assert.ok(near.prices && near.prices.grain > 0, '시세표가 함께 온다');
  assert.ok(dist(t.x + R - 1, t.y, t.x, t.y) <= R, '전제: 반경 안이다');
});

// ────────────────────────────────────────────────────────────────
// ② metNations 기록
// ────────────────────────────────────────────────────────────────
test('★ §17-16 metNations — 첫 방문에 그날이 적히고, 두 번째부터는 first 가 아니다', () => {
  const { world, nation, t } = scene();
  world.tick = 12;
  standAt(nation, t.x, t.y);

  const first = cmd(world, { type: 'visitNation', nationId: AI });
  assert.equal(first.ok, true);
  assert.equal(first.first, true, '처음 만난 나라다');
  assert.equal(nation.metNations[AI], 12, '만난 날이 그대로 적힌다');
  assert.equal(hasMet(nation, AI), true);

  world.tick = 20;
  const again = cmd(world, { type: 'visitNation', nationId: AI });
  assert.equal(again.ok, true);
  assert.equal(again.first, false, '두 번째 방문은 처음이 아니다');
  assert.equal(nation.metNations[AI], 20, '마지막으로 다녀온 날로 고쳐 적는다');

  // 다른 나라는 여전히 낯설다 — 하나를 만났다고 셋이 열리지 않는다
  assert.equal(hasMet(nation, 'ai2'), false);
  assert.equal(hasMet(nation, 'ai3'), false);
});

test('★ §17-16 찾아가기 거절 — 아바타가 없거나 · 없는 나라 · 나 자신은 찾아갈 수 없다', () => {
  const { world, nation, t } = scene();

  nation.avatars = {};
  const noAvatar = cmd(world, { type: 'visitNation', nationId: AI });
  assert.equal(noAvatar.ok, false);
  assert.equal(noAvatar.error.code, 'NO_AVATAR');

  standAt(nation, t.x, t.y);
  const nobody = cmd(world, { type: 'visitNation', nationId: 'ai9' });
  assert.equal(nobody.ok, false);
  assert.equal(nobody.error.code, 'NO_NATION');

  const self = cmd(world, { type: 'visitNation', nationId: 'player' });
  assert.equal(self.ok, false);
  assert.equal(self.error.code, 'NO_NATION', '제 나라를 찾아갈 수는 없다');
  assert.equal(hasMet(nation, AI), false, '거절된 청은 아무것도 적지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ③ 가격 마스킹 완화 — 방문 전 마스킹 / 방문 후 공개
// ────────────────────────────────────────────────────────────────
test('★ §17-16 가격 마스킹 — 외교관이 없어도 다녀온 나라의 값은 열린다(안 간 나라는 그대로 가려진다)', () => {
  const { world, nation, t } = scene();
  nation.roles.trade.holder = null;                  // 외교관 공석 — 옛 규칙이면 전부 가려진다

  const before = buildWorldState(world, 'player', data);
  const beforeAi = before.nations.find((n) => n.id === AI);
  assert.equal(beforeAi.masked, true, '가 보지 않은 나라의 값은 가려져 있다');
  assert.equal(beforeAi.prices, null);

  standAt(nation, t.x, t.y);
  assert.equal(cmd(world, { type: 'visitNation', nationId: AI }).ok, true);

  const after = buildWorldState(world, 'player', data);
  const afterAi = after.nations.find((n) => n.id === AI);
  assert.equal(afterAi.masked, false, '다녀온 나라의 값은 그 뒤로 계속 보인다');
  assert.ok(afterAi.prices && afterAi.prices.grain > 0);
  assert.equal(afterAi.metTick, world.tick, '언제 다녀왔는지도 함께 간다');
  assert.ok(afterAi.tags && afterAi.tags.length, '눈으로 본 땅의 됨됨이도 열린다');

  // 안 간 나라는 그대로다 — 완화는 나라마다 따로 걸린다
  const other = after.nations.find((n) => n.id === 'ai2');
  assert.equal(other.masked, true);
  assert.equal(other.prices, null);
});

test('★ §17-16 외교관 — 자리가 차 있으면 다녀오지 않아도 셋 다 열린다(옛 계약 그대로)', () => {
  const { world, nation } = scene();
  nation.roles.trade.holder = 'npc';
  const view = buildWorldState(world, 'player', data);
  for (const id of ['ai1', 'ai2', 'ai3']) {
    const n = view.nations.find((x) => x.id === id);
    assert.equal(n.masked, false, `${id} 는 외교관의 눈으로 열려 있다`);
    assert.ok(n.prices && n.prices.grain > 0);
  }
});

// ────────────────────────────────────────────────────────────────
// ④ 화면이 그릴 재료 — 도읍 스냅샷과 반경 규격
// ────────────────────────────────────────────────────────────────
test('★ §17-16 도읍 스냅샷 — 이웃 도읍의 preset·이름이 실리고, 탐사 전에는 known 이 아니다', () => {
  const { world, nation, t } = scene();

  const dark = buildWorldSnapshot(world, 'player', data);
  const darkAi = dark.towns.find((x) => x.nationId === AI);
  assert.ok(darkAi, '이웃 도읍은 늘 목록에 있다(자리는 세상의 사실이다)');
  assert.equal(darkAi.name, world.nations[AI].name, '이름 현판의 재료가 실린다');
  assert.ok(Array.isArray(darkAi.preset) && darkAi.preset.length > 0, '프리셋 건물 목록이 실린다');
  assert.ok(darkAi.preset.every((b) => b.key && b.x != null && b.y != null), '건물마다 종류와 자리가 있다');
  assert.equal(darkAi.known, false, '아직 안개 속이라 아는 곳이 아니다');

  // 그 자리를 밝히면 known 이 선다 — 화면은 이 값으로 집을 그린다(fog≥1)
  revealAvatar(nation, data, world.tick, t.x, t.y, 'lord');
  const lit = buildWorldSnapshot(world, 'player', data);
  assert.equal(lit.towns.find((x) => x.nationId === AI).known, true);
});

test('★ §17-16 반경 규격 — 화면이 서버와 같은 자를 쓴다(config.world.towns.visitRadius)', () => {
  const pub = publicWorld(data);
  assert.equal(pub.towns.visitRadius, R, '공개 규격이 자료의 값과 같다');
  assert.equal(R, data.world.towns.visitRadius, '반경의 정본은 data/world.json 하나다');
});
