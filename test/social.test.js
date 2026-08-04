// 캐릭터 생성 + 멀티 검증 — docs/WORLD.md §12
// appearance 범위 검증 · avatars/members 반영 · chat 릴레이(길이·새니타이즈) · 공개 다이얼
import test from 'node:test';
import { openChapterForDebug } from '../server/engine/progression.js';
import assert from 'node:assert/strict';
import { loadGameData, publicConfig } from '../server/engine/data.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { buildNationView, buildWorldDiff } from '../server/engine/view.js';
import {
  normalizeAppearance, validateAppearance, sanitizeChat, pushChat, chatHistory,
  upsertMember, normalizeMembers, defaultAppearance, publicAppearance, publicChat,
} from '../server/engine/social.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const A = data.world.appearance;
const C = data.world.chat;
const mk = (opts = {}) => createWorld({ seed: 7, data, playerName: '검증', assignments: npcAssignments(data), ...opts });
const cmd = (world, c) => applyCommand(world, 'player', c, data, createRng(1));

// ────────────────────────────────────────────────────────────────
// 외형
// ────────────────────────────────────────────────────────────────
test('외형 — 다이얼이 설계(§12)와 일치한다: 피부6·머리8·머리색10·의상6·의상색10', () => {
  assert.equal(A.fields.skin.count, 6);
  assert.equal(A.fields.hair.count, 8);
  assert.equal(A.fields.hairColor.count, 10);
  assert.equal(A.fields.outfit.count, 6);
  assert.equal(A.fields.outfitColor.count, 10);
  assert.equal(A.fields.skin.palette.length, 6);
  assert.equal(A.fields.hair.styles.length, 8);
  assert.equal(A.fields.outfitColor.palette.length, 10);
  assert.deepEqual(Object.keys(defaultAppearance(data)).sort(),
    ['hair', 'hairColor', 'outfit', 'outfitColor', 'skin']);
});

test('외형 — 범위 검증: 정수 0~count-1 만 통과한다', () => {
  assert.equal(validateAppearance({ skin: 0, hair: 7 }, data).ok, true);
  assert.equal(validateAppearance({ skin: 6 }, data).ok, false);
  assert.equal(validateAppearance({ skin: -1 }, data).ok, false);
  assert.equal(validateAppearance({ skin: 1.5 }, data).ok, false);
  assert.equal(validateAppearance({ skin: '2' }, data).ok, true, '숫자 문자열은 받아준다');
  assert.equal(validateAppearance({ 없는항목: 0 }, data).error.code, 'BAD_APPEARANCE_FIELD');
  assert.equal(validateAppearance({ hairColor: 10 }, data).error.code, 'BAD_APPEARANCE_RANGE');
  assert.equal(validateAppearance(null, data).error.code, 'BAD_APPEARANCE');

  // normalize 는 잘못된 칸만 기본값으로 되돌린다(접속을 막지 않는다)
  const { appearance, invalid } = normalizeAppearance({ skin: 3, hair: 99 }, data);
  assert.equal(appearance.skin, 3);
  assert.equal(appearance.hair, A.default.hair);
  assert.deepEqual(invalid, ['hair']);
});

test('외형 — setAppearance 가 아바타·명부에 저장되고 NationView 로 나간다', () => {
  const w = mk({ seed: 61 });
  const n = w.nations.player;
  upsertMember(n, { avatarId: '왕', name: '왕', role: null, online: true }, data);

  const bad = cmd(w, { type: 'setAppearance', avatarId: '왕', playerName: '왕', appearance: { skin: 99 } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'BAD_APPEARANCE_RANGE');

  const look = { skin: 2, hair: 5, hairColor: 7, outfit: 3, outfitColor: 9 };
  const res = cmd(w, { type: 'setAppearance', avatarId: '왕', playerName: '왕', appearance: look });
  assert.ok(res.ok);
  assert.deepEqual(res.appearance, look);

  const v = buildNationView(w, 'player', null, data);
  const me = v.nation.avatars.find((a) => a.id === '왕');
  assert.ok(me, 'avatars 에 실린다');
  assert.deepEqual(me.appearance, look);
  const member = v.nation.members.find((m) => m.avatarId === '왕');
  assert.ok(member, 'members 에 실린다');
  assert.deepEqual(member.appearance, look);

  // worldDiff 로도 나간다 (다른 접속자가 내 모습을 본다)
  const diff = buildWorldDiff(w, 'player', data, -1);
  assert.deepEqual(diff.avatars.find((a) => a.id === '왕').appearance, look);
});

test('외형 — lordMove 는 위치만 바꾸고 이미 고른 외형을 유지한다', () => {
  const w = mk({ seed: 62 });
  const look = { skin: 4, hair: 1, hairColor: 2, outfit: 5, outfitColor: 6 };
  assert.ok(cmd(w, { type: 'setAppearance', avatarId: '군주', playerName: '군주', appearance: look }).ok);
  const moved = cmd(w, { type: 'lordMove', avatarId: '군주', playerName: '군주', x: 40, y: 41 });
  assert.ok(moved.ok);
  assert.equal(moved.avatar.x, 40);
  assert.deepEqual(moved.avatar.appearance, look);
});

test('명부 — 옛 문자열 배열 스냅샷도 초상과 함께 정규화된다(하위 호환)', () => {
  const n = { members: ['옛플레이어'], online: true };
  const list = normalizeMembers(n, data);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '옛플레이어');
  assert.deepEqual(list[0].appearance, defaultAppearance(data));
  upsertMember(n, { avatarId: '옛플레이어', role: 'defense', online: false, appearance: { skin: 1 } }, data);
  const after = normalizeMembers(n, data);
  assert.equal(after.length, 1, '이름이 같으면 새로 만들지 않는다');
  assert.equal(after[0].role, 'defense');
  assert.equal(after[0].appearance.skin, 1);
});

// ────────────────────────────────────────────────────────────────
// 채팅
// ────────────────────────────────────────────────────────────────
test('채팅 — 새니타이즈: 제어문자 제거 · 꺾쇠 이스케이프 · 공백 압축 · 길이 제한', () => {
  assert.equal(sanitizeChat('  안녕   하세요  ', data), '안녕 하세요');
  assert.equal(sanitizeChat('한\n줄로\t만든다', data), '한 줄로 만든다');
  assert.equal(sanitizeChat('<script>alert(1)</script>', data),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(sanitizeChat('a&b', data), 'a&amp;b');
  assert.equal(sanitizeChat('가'.repeat(C.maxLength + 50), data).length, C.maxLength);
  assert.equal(sanitizeChat(12345, data), '');
  assert.equal(sanitizeChat('   ', data), '');
});

test('채팅 — chat 릴레이: 이름+외형 요약이 함께 실리고 빈 말은 거부된다', () => {
  const w = mk({ seed: 63 });
  const look = { skin: 1, hair: 2, hairColor: 3, outfit: 4, outfitColor: 5 };
  cmd(w, { type: 'setAppearance', avatarId: '아무개', playerName: '아무개', appearance: look });

  const empty = cmd(w, { type: 'chat', avatarId: '아무개', playerName: '아무개', text: '   ' });
  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, 'EMPTY_CHAT');

  const said = cmd(w, { type: 'chat', avatarId: '아무개', playerName: '아무개', text: '성벽부터 올립시다' });
  assert.ok(said.ok);
  assert.equal(said.message.text, '성벽부터 올립시다');
  assert.equal(said.message.from.name, '아무개');
  assert.deepEqual(said.message.from.appearance, look);
  assert.equal(said.message.nationId, 'player');
  assert.equal(said.message.tick, w.tick);
  assert.equal(w.chat.length, 1);
});

test('채팅 — 로그는 historyMax 링버퍼, join 때는 joinHistory 만큼만 밀어 준다', () => {
  const w = mk({ seed: 64 });
  const n = w.nations.player;
  for (let i = 0; i < C.historyMax + 20; i += 1) {
    assert.ok(pushChat(w, n, { text: `말 ${i}`, name: '나', avatarId: '나' }, data).ok);
  }
  assert.equal(w.chat.length, C.historyMax);
  assert.equal(w.chat.at(-1).text, `말 ${C.historyMax + 19}`);
  assert.equal(chatHistory(w, data).length, C.joinHistory);
  assert.equal(new Set(w.chat.map((m) => m.id)).size, w.chat.length, 'id 는 유일하다');
});

test('채팅 — 상태(경제·전투)에는 영향이 없다', () => {
  const w = mk({ seed: 65 });
  const n = w.nations.player;
  const before = JSON.stringify({ res: n.resources, gold: n.gold, pop: n.population, def: n.defense });
  cmd(w, { type: 'chat', avatarId: '나', playerName: '나', text: '적이 온다!' });
  assert.equal(JSON.stringify({ res: n.resources, gold: n.gold, pop: n.population, def: n.defense }), before);
});

// ────────────────────────────────────────────────────────────────
// 멀티 역할 소유권 (§12) — 한 나라를 여럿이 나눠 맡는다
// ────────────────────────────────────────────────────────────────
test('멀티 — 접속자마다 다른 자리를 동시에 맡는다 (pickRole 은 자기 자리만 비운다)', () => {
  const w = mk({ seed: 66 });
  const n = w.nations.player;
  w.emotionDayDone = true;                              // 관제 선포 이후
  w.nations.player.tier = 3; // ★ GDD3 — 역할은 마을(티어 3)부터
  __openChapter(w.nations.player, 10);
  for (const k of data.roles.order) { n.roles[k].holder = null; n.roles[k].owner = null; }

  assert.ok(cmd(w, { type: 'pickRole', role: 'defense', avatarId: '가온' }).ok);
  assert.ok(cmd(w, { type: 'pickRole', role: 'farm', avatarId: '나래' }).ok);
  assert.equal(n.roles.defense.holder, 'player');
  assert.equal(n.roles.defense.owner, '가온');
  assert.equal(n.roles.farm.holder, 'player');
  assert.equal(n.roles.farm.owner, '나래', '남의 자리를 빼앗지 않는다');

  // 같은 사람이 자리를 옮기면 이전 자리는 비운다
  const moved = cmd(w, { type: 'pickRole', role: 'build', avatarId: '가온' });
  assert.ok(moved.ok);
  assert.equal(moved.takenFrom, null);
  assert.equal(n.roles.defense.holder, 'npc');
  assert.equal(n.roles.build.owner, '가온');
  assert.equal(n.roles.farm.owner, '나래', '나래는 그대로');

  // 남이 앉은 자리를 고르면 넘겨받는다(중복 시 안내 UX)
  const taken = cmd(w, { type: 'pickRole', role: 'farm', avatarId: '가온' });
  assert.ok(taken.ok);
  assert.equal(taken.takenFrom, '나래');
  assert.equal(n.roles.farm.owner, '가온');
  assert.equal(n.roles.build.holder, 'npc');

  const view = buildNationView(w, 'player', 'farm', data);
  assert.equal(view.nation.roles.farm.owner, '가온');
  assert.equal(view.nation.roles.defense.owner, null, 'NPC 자리는 주인이 없다');
});

test('프로토콜 — /api/config.world 에 외형 팔레트·채팅 제한이 실린다', () => {
  const cfg = publicConfig();
  assert.deepEqual(cfg.world.appearance, publicAppearance(data));
  assert.deepEqual(cfg.world.chat, publicChat(data));
  assert.equal(cfg.world.appearance.fields.skin.count, 6);
  assert.equal(cfg.world.appearance.fields.hair.styles.length, 8);
  assert.equal(cfg.world.chat.maxLength, C.maxLength);
  assert.equal(cfg.world.fences.maxSegments, data.world.fences.maxSegments);
});
