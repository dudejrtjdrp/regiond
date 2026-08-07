// QA 1차 배치 C (§19-C) — 「기능이 죽어 있던」 P1 아홉 건의 회귀.
//
// 이 파일이 지키는 계약:
//   ① 잠은 하룻밤짜리다 — 날이 바뀌면 잠자기 표가 비워진다(B04-1)
//   ② 적은 물에서 태어나지 않는다 — 뭍 + 도읍까지 길이 있는 자리에서만 선다(B05-2)
//   ③ 「알아서 나누기」는 캐는 손을 **노드**에 앉힌다 — 도읍에 뭉치지 않는다(B05-1)
//   ④ 매립한 물 칸은 뭍과 같이 건설 가능하다(B08-2, 서버 규칙의 재확인)
//   ⑤ 배포되는 텍스트에 타 게임 상표가 없다(B03-8)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf, isWaterAt } from '../server/engine/world.js';
import { step } from '../server/engine/tick.js';
import { startBattle } from '../server/engine/battle.js';
import { validatePlacement } from '../server/engine/structures.js';
import { playerProgressView, ensurePlayer } from '../server/engine/skills.js';

const data = loadGameData();

function scene(seed = 11, chapter = 8) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, chapter);
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '테스트');
  return { world, nation, town };
}

test('★ §19-C B04-1 잠듦 — 날이 바뀌면 잠자기 표가 비워진다', () => {
  const { world, nation } = scene();
  const res = applyCommand(world, 'player', { type: 'sleepVote', on: true, avatarId: 'lord' }, data, createRng(1));
  assert.equal(res.ok, true, '잠들 수 있다');
  nation.sleepVotes = { lord: true };            // 여럿이 하는 판 — 아직 하루가 안 넘어간 상태
  const next = step(world, [], createRng(2), data);
  const after = next.state.nations.player;
  assert.deepEqual(after.sleepVotes, {}, '아침이 오면 잠에서 깬다');
});

test('★ §19-C B05-2 적 스폰 — 물에서 태어나 갇히는 놈이 없다', () => {
  let total = 0;
  for (const seed of [1, 3, 5, 7, 9, 11]) {
    const { world, nation } = scene(seed);
    const battle = startBattle(world, nation, data, {});
    if (!battle) continue;
    for (const e of battle.enemies) {
      total += 1;
      if (e.flying) continue;
      assert.equal(isWaterAt(world.map, e.x, e.y, data), false,
        `씨앗 ${seed} 의 ${e.id} 가 물에서 태어났다 (${e.x},${e.y})`);
    }
  }
  assert.ok(total > 0, '적이 실제로 섰다');
});

test('★ §19-C B05-1 알아서 나누기 — 캐는 손은 도읍이 아니라 노드에 앉는다', () => {
  const { world, nation, town } = scene(7);
  nation.villagers = [];
  for (let i = 0; i < 12; i += 1) {
    nation.villagers.push({ id: `v${i}`, x: town.x, y: town.y, job: 'idle', targetId: null });
  }
  nation.population = 12;
  const res = applyCommand(world, 'player', { type: 'setLabor', recommended: true }, data, createRng(3));
  assert.equal(res.ok, true);
  const gatherers = nation.villagers.filter((u) => ['farm', 'lumber', 'quarry', 'mine'].includes(u.job));
  assert.ok(gatherers.length > 0, '캐는 손이 있다');
  for (const u of gatherers) {
    assert.notEqual(u.targetId, 'hall', `${u.id}(${u.job}) 가 도읍에 서 있다 — 캘 자리가 있는데도`);
  }
});

test('★ §19-C B08-2 매립 — 메운 물 칸은 뭍과 같이 지을 수 있다', () => {
  const { world, nation, town } = scene(4);
  const size = world.map.size;
  let cell = null;
  for (let r = 3; r < 40 && !cell; r += 1) {
    for (let dx = -r; dx <= r && !cell; dx += 1) {
      const y = town.y + r;
      if (y < size && isWaterAt(world.map, town.x + dx, y, data)) cell = { x: town.x + dx, y };
    }
  }
  if (!cell) return;                                  // 이 씨앗에는 가까운 물이 없다
  nation.fills = [{ x: cell.x, y: cell.y }];
  nation._fillSet = null; nation._fillStamp = -1;
  const v = validatePlacement(world, nation, 'tent', cell.x, cell.y, data);
  assert.notEqual(v.code, 'BAD_TERRAIN', '메운 칸은 지형 때문에 막히지 않는다');
});

test('★ §19-C B04-2 눈금 — 다섯 솜씨를 합친 진행표가 언제든 즉시 나온다', () => {
  const { nation } = scene();
  const p = nation.players.lord;
  const before = playerProgressView(p, data);
  p.skills.lumber.xp += 50;
  const after = playerProgressView(p, data);
  assert.ok(after.xp > before.xp, '한 번의 벌목이 곧바로 표에 실린다');
});

test('★ §19-C B03-8 배포 텍스트 — 타 게임 상표가 없다', () => {
  const BANNED = /스타크래프트|스타듀|워크래프트|마인크래프트|RimWorld|Manor Lords|Terraria|Minecraft|StarCraft/i;
  const roots = ['data', 'public', 'server'];
  const here = new URL('..', import.meta.url).pathname;
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(js|json|css|html|mjs)$/.test(name) ? [full] : [];
  });
  for (const root of roots) {
    for (const file of walk(join(here, root))) {
      assert.equal(BANNED.test(readFileSync(file, 'utf8')), false, `${file} 에 타 게임 이름이 있다`);
    }
  }
});
