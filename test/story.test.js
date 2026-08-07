// story.test.js — ★ §세계관 W2 스토리 연출 엔진 검증.
//   지키는 것 다섯: ① 정본(data/story.json)의 짜임 ② 1회 보장 ③ 승/패 분기의 상호 배타
//   ④ 세라(첫 이민자 이름·성녀 화자 전환) ⑤ 옛 세이브에는 지난 이야기를 틀지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { storyEvents, gameStartedEvents } from '../server/engine/story.js';
import { spawnResident } from '../server/engine/residents.js';

const data = loadGameData();
const freshWorld = (seed = 42) => createWorld({ seed, data, playerName: '개척자' });

test('story.json — beat 는 id·on·scenes 를 갖추고 id 는 겹치지 않는다', () => {
  const beats = data.story.beats;
  assert.ok(beats.length >= 7);
  const ids = new Set();
  for (const b of beats) {
    assert.ok(b.id && b.on, `${b.id} — id·on 필수`);
    assert.ok(Array.isArray(b.scenes) && b.scenes.length > 0, `${b.id} — 장면이 비었다`);
    for (const s of b.scenes) assert.equal(typeof s.text, 'string');
    assert.ok(!ids.has(b.id), `${b.id} — id 중복`);
    ids.add(b.id);
  }
});

test('도입 — 갓 세운 세계의 첫 접속에서 한 번만 흐른다', () => {
  const world = freshWorld();
  const first = gameStartedEvents(world, data);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, 'story_beat');
  assert.equal(first[0].data.id, 'intro');
  assert.ok(first[0].data.scenes.length >= 6);
  assert.equal(gameStartedEvents(world, data).length, 0, '두 번째 접속에는 흐르지 않는다');
});

test('첫 이웃 — resident_arrived 에 한 번만 얹힌다', () => {
  const world = freshWorld();
  const batch = [{ kind: 'resident_arrived', nationId: 'player', data: { name: '세라' } }];
  const out = storyEvents(world, data, batch);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.id, 'first_neighbor');
  assert.equal(storyEvents(world, data, batch).length, 0, '1회 보장');
});

test('장 조건 — 5장 완료는 감정 제안을, 7장 열림은 낯선 바람을 연다', () => {
  const world = freshWorld();
  const wrong = storyEvents(world, data, [{ kind: 'chapter_done', nationId: 'player', data: { id: 4 } }]);
  assert.equal(wrong.length, 0, '조건이 다른 장에는 얹히지 않는다');
  const hint = storyEvents(world, data, [{ kind: 'chapter_done', nationId: 'player', data: { id: 5 } }]);
  assert.equal(hint[0]?.data.id, 'appraise_hint');
  const wind = storyEvents(world, data, [{ kind: 'chapter_open', nationId: 'player', data: { id: 7 } }]);
  assert.equal(wind[0]?.data.id, 'strange_wind');
});

test('첫 결전 분기 — 막아냈으면 무너진 이야기는 영영 나오지 않는다', () => {
  const world = freshWorld();
  const won = storyEvents(world, data, [{ kind: 'wave_held', nationId: 'player', data: {} }]);
  assert.equal(won[0]?.data.id, 'first_wave_won');
  const lost = storyEvents(world, data, [{ kind: 'wave_breached', nationId: 'player', data: {} }]);
  assert.equal(lost.length, 0, 'excludes — 반대 갈래는 본 것으로 친다');
});

test('첫 웨이브 예고 — 1번 웨이브에만 얹힌다', () => {
  const world = freshWorld();
  const later = storyEvents(world, data, [{ kind: 'wave_incoming', nationId: 'player', data: { number: 3 } }]);
  assert.equal(later.length, 0);
  const first = storyEvents(world, data, [{ kind: 'wave_incoming', nationId: 'player', data: { number: 1 } }]);
  assert.equal(first[0]?.data.id, 'first_wave_omen');
});

test('세라 화자 규칙 — 성녀 자리를 사람이 쥐면 「성녀의 직감」이 말한다', () => {
  const human = freshWorld();
  human.nations.player.roles.saint.holder = 'p-someone';
  const swapped = storyEvents(human, data, [{ kind: 'wave_incoming', nationId: 'player', data: { number: 1 } }]);
  assert.ok(swapped[0].data.scenes.some((s) => s.speaker === '성녀의 직감'));
  assert.ok(!swapped[0].data.scenes.some((s) => s.speaker === '세라'));

  const npc = freshWorld(43);
  npc.nations.player.roles.saint.holder = 'npc';
  const kept = storyEvents(npc, data, [{ kind: 'wave_incoming', nationId: 'player', data: { number: 1 } }]);
  assert.ok(kept[0].data.scenes.some((s) => s.speaker === '세라'), 'NPC 위임이면 세라 그대로');
});

test('치환 — {name} 은 나라 이름으로, 자막 화자는 빈 문자열로 나간다', () => {
  const world = freshWorld();
  const out = storyEvents(world, data, [{ kind: 'emotion_day', nationId: 'player', data: {} }]);
  assert.equal(out[0].data.id, 'appraisal_declare');
  assert.ok(out[0].data.scenes[0].text.includes(world.nations.player.name));
  assert.ok(!out[0].data.scenes[0].text.includes('{name}'));
});

test('첫 이민자는 세라다 — 플레이어 나라에서만, 두 번째부터는 여느 이름', () => {
  const world = freshWorld();
  const rng = createRng(7);
  const first = spawnResident(world, world.nations.player, data, rng);
  assert.equal(first.name, '세라');
  const second = spawnResident(world, world.nations.player, data, rng);
  assert.notEqual(second.name, '세라');
  const aiFirst = spawnResident(world, world.nations.ai1, data, rng);
  assert.notEqual(aiFirst.name, '세라');
});

test('옛 세이브 보호 — 이미 구른 세계에는 지난 이야기를 몰아서 틀지 않는다', () => {
  const world = freshWorld();
  world.tick = 12;
  const out = storyEvents(world, data, [{ kind: 'resident_arrived', nationId: 'player', data: {} }]);
  assert.equal(out.length, 0);
  assert.equal(gameStartedEvents(world, data).length, 0);
});

test('연대기 — chronicle 을 가진 beat 는 이야기 항목을 남긴다', () => {
  const world = freshWorld();
  storyEvents(world, data, [{ kind: 'resident_arrived', nationId: 'player', data: {} }]);
  const rows = (world.chronicle || []).filter((r) => r.kind === 'story');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].text.includes('세라'));
});
