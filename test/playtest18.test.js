// §18-D2 링0 앞마당 회귀 — 단서 사슬과 미시 발견 (설계 정본 docs/탐험기획.md §18-2·§18-3·§18-5)
//
// 피드백: "초반에 할 게 없음 — 마차에서 내리면 나무와 돌뿐이고, 걸어 나갈 이유가 없다."
// 이 파일이 붙드는 문장은 여섯이다.
//   ① 같은 씨앗은 같은 앞마당을 낸다(자리도 종류도 차례도 한 톨도 다르지 않다).
//   ② 흔적은 링0(본영 12타일) 안, 물이 아닌 칸, 서로 minGap 밖, 노드와 겹치지 않는 자리에만 앉는다.
//   ③ 사슬을 조사하면 **다음 흔적이 드러나고** 그 둘레의 안개가 열린다 — 열리는 것은 안개뿐이다(마커 금지).
//   ④ 결말은 statRng 로 굴린다 — 조사가 **월드 난수를 한 톨도 축내지 않는다**(§13-C 에서 겪은 사고).
//   ⑤ 선택지가 있는 흔적은 같은 명령을 두 번 받는다(1차 = 선택지 · 2차 = choice). 순서 위조는 물린다.
//   ⑥ 옛 우물은 소진되지 않고 **하루 한 번**만 길어진다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { townOf, dist, generateWorldMap, terrainIndex, terrainAt } from '../server/engine/world.js';
import { ensurePlayer } from '../server/engine/skills.js';
import { isExplored, stampVisionDisc, bumpGen } from '../server/engine/fog.js';
import { trailsOf, trailViews, growTrailsFor, investigateTrail, trailDef } from '../server/engine/trails.js';
import { buildWorldSnapshot } from '../server/engine/view.js';

const data = loadGameData();
const CFG = data.trails;
const RING = CFG.ring0;
const SEED = 20260807;

function scene(seed = SEED) {
  const world = createWorld({ seed, data, playerName: '개척자' });
  const nation = world.nations.player;
  const t = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '개척자', x: t.x, y: t.y, tick: 0, appearance: {} };
  ensurePlayer(nation, 'lord', data, '개척자');
  return { world, nation, t, rng: createRng(seed) };
}

/** 그 흔적 앞에 서서 E 를 누른다 — 서버가 보는 것과 똑같은 길(applyCommand)로만 간다 */
function investigate(s, trail, choice = null) {
  s.nation.avatars.lord.x = trail.x;
  s.nation.avatars.lord.y = trail.y;
  const cmd = { type: 'investigateTrail', trailId: trail.id, avatarId: 'lord' };
  if (choice) cmd.choice = choice;
  return applyCommand(s.world, 'player', cmd, data, s.rng);
}

const chainOf = (world) => trailsOf(world).filter((t) => t.kind === 'chain').sort((a, b) => a.step - b.step);
const microOf = (world, key) => trailsOf(world).find((t) => t.kind === 'micro' && t.key === key) ?? null;
const fingerprint = (list) => list.map((t) => `${t.id}:${t.kind}:${t.key}:${t.x},${t.y}:${t.hidden ? 'h' : '-'}`);

/**
 * 그 미시 발견이 실제로 심긴 판 하나. ★ 씨앗을 못 박지 않는 까닭 — microCount 가 4~6 이라
 * 다섯 종류가 매 판 다 나오지는 않는다. 씨앗 하나를 적어 두면 자료(무게·종류)를 손대는 날
 * 이 시험이 「없다」로 무너진다. 몇 판만 넘겨 보고 나오는 첫 판을 쓴다.
 */
function sceneWithMicro(key) {
  for (let seed = 2; seed <= 12; seed += 1) {
    const s = scene(seed);
    if (microOf(s.world, key)) return s;
  }
  throw new Error(`${key} 가 어떤 씨앗에서도 앞마당에 안 나온다`);
}

/**
 * 그 자리 둘레의 안개를 도로 덮는다. ★ 「조사가 안개를 연다」를 재려면 먼저 **닫혀 있어야** 한다 —
 * 앞마당은 본영 시야 안이라 판이 시작될 때 이미 상당수가 밝다.
 */
function darken(nation, cx, cy, r) {
  const fog = nation.fog;
  const per = Math.ceil(fog.size / fog.chunk);
  for (let y = Math.max(0, cy - r); y <= Math.min(fog.size - 1, cy + r); y += 1) {
    for (let x = Math.max(0, cx - r); x <= Math.min(fog.size - 1, cx + r); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      fog.mask[y * fog.size + x] = 0;   // ★ §21-A3 — 마스크는 이제 Uint8Array 다(제자리 쓰기)
      // 손으로 덮었으니 청크 지문도 함께 무르게 한다(안 그러면 도로 밝혀도 「안 바뀌었다」로 읽힌다)
      fog.chunkHash[Math.floor(y / fog.chunk) * per + Math.floor(x / fog.chunk)] = -1;
    }
  }
  // ★ §21-A3 — 손으로 주물렀으니 세대도 올린다(exploredRatio 캐시가 옛 값을 붙들지 않게)
  bumpGen(fog);
}

// ────────────────────────────────────────────────────────────────
// ① 결정론 — 같은 씨앗은 같은 앞마당
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 배치 — 같은 씨앗은 같은 앞마당을 낸다(자리도 종류도 차례도)', () => {
  const a = generateWorldMap(4242, data, { playerTags: [] });
  const b = generateWorldMap(4242, data, { playerTags: [] });
  assert.ok(a.trails.length > 0, '앞마당에 흔적이 하나도 없다');
  assert.deepEqual(fingerprint(a.trails), fingerprint(b.trails));

  const other = generateWorldMap(4243, data, { playerTags: [] });
  assert.notDeepEqual(
    a.trails.map((t) => `${t.x},${t.y}`), other.trails.map((t) => `${t.x},${t.y}`),
    '씨앗이 다르면 앞마당도 달라야 한다',
  );
});

test('★ §18-D2 보장 수량 — 사슬 하나가 통째로, 미시 발견은 microCount 만큼', () => {
  for (const seed of [1, 77, 4242, 20260807]) {
    const map = generateWorldMap(seed, data, { playerTags: [] });
    const chain = map.trails.filter((t) => t.kind === 'chain');
    const micro = map.trails.filter((t) => t.kind === 'micro');
    assert.equal(chain.length, CFG.chains[0].steps.length, `씨앗 ${seed}: 반쪽 사슬이 남았다`);
    assert.ok(micro.length >= RING.microCount[0] && micro.length <= RING.microCount[1],
      `씨앗 ${seed}: 미시 발견이 ${micro.length}개다`);
    // 첫 흔적만 지도에 서 있고 나머지 단계는 덮여 있다(§18-3 「조사 순간 생성·공개」)
    assert.equal(chain.filter((t) => !t.hidden).length, 1);
  }
});

// ────────────────────────────────────────────────────────────────
// ② 자리 규칙 — 링0 안 · 물 금지 · minGap · 노드와 겹치지 않는다
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 자리 — 링0 반경 안, 물이 아닌 칸, 서로 minGap 밖, 노드와 안 겹친다', () => {
  const water = terrainIndex(data).water;
  for (const seed of [1, 77, 4242, 20260807]) {
    const map = generateWorldMap(seed, data, { playerTags: [] });
    const town = map.towns.find((t) => t.isPlayer);
    const list = map.trails;
    for (const tr of list) {
      const d = dist(town.x, town.y, tr.x, tr.y);
      assert.ok(d <= RING.radius + 0.001, `씨앗 ${seed}: 흔적이 링0(${RING.radius}) 밖이다 — ${d}`);
      assert.ok(d >= RING.minTownGap, `씨앗 ${seed}: 흔적이 본영 한복판에 앉았다 — ${d}`);
      assert.notEqual(terrainAt(map, tr.x, tr.y), water, `씨앗 ${seed}: 흔적이 물 위에 있다`);
      assert.ok(!map.nodes.some((n) => n.x === tr.x && n.y === tr.y), `씨앗 ${seed}: 흔적이 노드를 깔고 앉았다`);
    }
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const gap = dist(list[i].x, list[i].y, list[j].x, list[j].y);
        assert.ok(gap >= RING.minGap, `씨앗 ${seed}: 흔적 둘이 ${gap} 타일 붙어 있다`);
      }
    }
  }
});

// ────────────────────────────────────────────────────────────────
// ③ 사슬 — 조사하면 다음 흔적이 드러나고 안개가 열린다
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 사슬 — 조사가 다음 흔적을 드러내고 그 둘레의 안개만 연다(마커 금지)', () => {
  const s = scene();
  const [first, second] = chainOf(s.world);
  assert.equal(first.hidden, false);
  assert.equal(second.hidden, true, '다음 단계는 조사 전에는 덮여 있어야 한다');
  darken(s.nation, second.x, second.y, CFG.chains[0].steps[0].revealRadius);
  assert.equal(isExplored(s.nation, second.x, second.y), false);

  const res = investigate(s, first);
  assert.equal(res.ok, true, res.error?.message);
  assert.ok(res.dialogue.lines.length > 0, '대화창에 실릴 말이 없다');
  assert.equal(second.hidden, false, '조사했는데 다음 흔적이 안 드러났다');
  assert.equal(first.done, true, '조사한 흔적이 소진되지 않았다');
  assert.equal(isExplored(s.nation, second.x, second.y), true, '다음 흔적 둘레의 안개가 안 열렸다');
  assert.ok(res.revealed.length > 0, '안개가 열렸다는 것을 즉시분(worldDiff)이 알 길이 없다');

  /* ★ 마커 금지 — ack 는 다음 흔적이 **어디인지** 한 글자도 말하지 않는다. 안개만 열고 끝이다. */
  const text = JSON.stringify(res);
  assert.ok(!text.includes(`"x":${second.x}`) || !text.includes(`"y":${second.y}`),
    'ack 에 다음 흔적의 좌표가 실렸다 — 화살표를 그리라는 소리다');
});

test('★ §18-D2 사슬 — 끝까지 따라가면 결말이 땅이나 사람에게 자국을 남긴다', () => {
  const s = scene();
  const steps = chainOf(s.world);
  const logBefore = (s.world.chronicle || []).length;
  const nodesBefore = s.world.map.nodes.length;
  for (const step of steps) {
    const res = investigate(s, step);
    assert.equal(res.ok, true, res.error?.message);
    if (res.pending) investigate(s, step, res.dialogue.choices[0].key);
  }
  const grew = s.world.map.nodes.length > nodesBefore;
  const wrote = (s.world.chronicle || []).length > logBefore;
  assert.ok(grew || wrote, '사슬의 끝에서 아무 일도 일어나지 않았다');
});

// ────────────────────────────────────────────────────────────────
// ④ 결말 굴림 — statRng. 월드 난수를 축내지 않는다
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 결말 — statRng 로 굴린다(조사가 월드 난수를 한 톨도 축내지 않는다)', () => {
  const s = scene();
  const before = s.world.rngState;
  const rngBefore = s.rng.getState();
  for (const step of chainOf(s.world)) {
    const res = investigate(s, step);
    if (res.pending) investigate(s, step, res.dialogue.choices[0].key);
  }
  assert.equal(s.world.rngState, before, '흔적 조사가 세계의 난수를 건드렸다');
  assert.equal(s.rng.getState(), rngBefore, '흔적 조사가 명령 난수를 건드렸다');
});

test('★ §18-D2 결말 — 같은 씨앗의 같은 사슬은 언제 따라가도 같은 끝을 낸다', () => {
  const ends = [0, 1].map(() => {
    const s = scene();
    for (const step of chainOf(s.world)) {
      const res = investigate(s, step);
      if (res.pending) investigate(s, step, res.dialogue.choices[0].key);
    }
    return chainOf(s.world).map((t) => t.ending ?? '-').join('/');
  });
  assert.equal(ends[0], ends[1]);
  /* 씨앗이 다르면 굴림도 다시 굴린다 — 결말이 씨앗에 매여 있다는 것만 확인한다(값은 우연이다) */
  const seeds = [11, 22, 33, 44, 55, 66].map((seed) => {
    const s = scene(seed);
    for (const step of chainOf(s.world)) {
      const res = investigate(s, step);
      if (res.pending) investigate(s, step, res.dialogue.choices[0].key);
    }
    return chainOf(s.world).map((t) => t.ending).filter(Boolean)[0];
  });
  assert.ok(seeds.every((e) => CFG.chains[0].endings.some((x) => x.key === e)), '자료에 없는 결말이 나왔다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 두 걸음짜리 선택 — 새 둥지의 알
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 선택 — 1차는 선택지만 펴고, 2차가 몫을 치른다(순서 위조는 물린다)', () => {
  const s = sceneWithMicro('bird_nest');
  const nest = microOf(s.world, 'bird_nest');

  /* 살피기 전에 선택부터 보내면 받지 않는다 — 대화의 순서는 서버가 쥔다 */
  const forged = investigate(s, nest, 'take');
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'NO_CHOICE');

  const open = investigate(s, nest);
  assert.equal(open.ok, true, open.error?.message);
  assert.equal(open.pending, true, '1차에서 선택지가 펴지지 않았다');
  assert.equal(open.dialogue.choices.length, 2);
  assert.equal(nest.done, false, '1차에서 흔적이 소진돼 버렸다');

  const bad = investigate(s, nest, 'nope');
  assert.equal(bad.error.code, 'BAD_CHOICE');

  const grainBefore = s.nation.resources.grain;
  const moraleBefore = s.nation.morale;
  const done = investigate(s, nest, 'take');
  assert.equal(done.ok, true, done.error?.message);
  assert.equal(nest.done, true, '2차에서 흔적이 소진되지 않았다');
  assert.ok(s.nation.resources.grain > grainBefore, '알을 가져갔는데 곳간이 그대로다');
  assert.ok(s.nation.morale < moraleBefore, '알을 가져갔는데 사기가 그대로다');
  assert.equal(investigate(s, nest).error.code, 'NO_TRAIL', '소진된 흔적을 다시 살필 수 있다');
});

// ────────────────────────────────────────────────────────────────
// ⑥ 옛 우물 — 소진되지 않는 대신 하루 한 번
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 재방문 — 옛 우물은 사라지지 않고 하루 한 번만 길어진다', () => {
  const s = sceneWithMicro('old_well');
  const well = microOf(s.world, 'old_well');
  const reuse = CFG.micro.find((m) => m.key === 'old_well').reuseDays;

  const p = ensurePlayer(s.nation, 'lord', data, '개척자');
  p.hp = 1;
  const first = investigate(s, well);
  assert.equal(first.ok, true, first.error?.message);
  assert.ok(first.healed > 0, '두레박을 내렸는데 체력이 그대로다');
  assert.equal(well.done, false, '우물이 세상에서 사라졌다 — 다시 차는 것은 소진되지 않는다');

  p.hp = 1;
  const again = investigate(s, well);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'COOLDOWN');

  s.world.tick += reuse;
  const tomorrow = investigate(s, well);
  assert.equal(tomorrow.ok, true, tomorrow.error?.message);
  assert.ok(tomorrow.healed > 0, '내일이 되었는데 우물이 마른 채다');
});

// ────────────────────────────────────────────────────────────────
// ⑦ 마스킹 — 부재 원칙. 안 가 본 자리의 흔적은 목록에 **없다**
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 마스킹 — 안개 밖의 흔적은 뷰에서 필드째 빠진다', () => {
  const s = scene();
  const all = trailsOf(s.world);
  const seen = trailViews(s.world, s.nation, data, isExplored);
  assert.ok(seen.length < all.length, '조사도 안 했는데 앞마당이 전부 보인다');
  for (const v of seen) assert.equal(isExplored(s.nation, v.x, v.y), true);
  assert.ok(seen.every((v) => v.verb && v.name && v.art), '뷰가 자료의 이름·동사·그림을 안 실었다');

  /* 안개를 열면 그 자리의 흔적이 목록에 들어온다 — 문은 안개 하나뿐이다 */
  const far = all.find((t) => !t.hidden && !isExplored(s.nation, t.x, t.y));
  if (far) {
    stampVisionDisc(s.nation, data, s.world.tick, far.x, far.y, 2);
    assert.ok(trailViews(s.world, s.nation, data, isExplored).some((v) => v.id === far.id));
  }
  /* 덮여 있는 사슬 단계는 안개가 열려 있어도 목록에 없다(hidden 은 안개보다 먼저 선다) */
  const hidden = all.find((t) => t.hidden);
  stampVisionDisc(s.nation, data, s.world.tick, hidden.x, hidden.y, 2);
  assert.ok(!trailViews(s.world, s.nation, data, isExplored).some((v) => v.id === hidden.id));
});

test('★ §18-D2 스냅샷 — world 스냅샷이 흔적 목록을 나른다(화면이 그릴 근거)', () => {
  const s = scene();
  const snap = buildWorldSnapshot(s.world, 'player', data);
  assert.ok(Array.isArray(snap.trails), 'world 스냅샷에 trails 가 없다');
  assert.deepEqual(snap.trails, trailViews(s.world, s.nation, data, isExplored));
});

// ────────────────────────────────────────────────────────────────
// ⑧ 손이 닿는 거리 — 자료가 쥔다
// ────────────────────────────────────────────────────────────────
test('★ §18-D2 거리 — 멀리서 부른 조사는 물린다(팔 길이는 trails.json 이 쥔다)', () => {
  const s = scene();
  const tr = trailsOf(s.world).find((t) => !t.hidden);
  s.nation.avatars.lord.x = tr.x + Math.ceil(CFG.reachTiles) + 2;
  s.nation.avatars.lord.y = tr.y;
  const res = applyCommand(s.world, 'player',
    { type: 'investigateTrail', trailId: tr.id, avatarId: 'lord' }, data, s.rng);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'OUT_OF_RANGE');
});

// ────────────────────────────────────────────────────────────────
// ⑨ ★ §21-C1 링1~3 — 세계는 장이 열릴 때마다 한 겹 자란다
//    붙드는 문장 다섯:
//      ① 링은 openAtChapter 에 닿아야 심긴다(1일차 지도에 링3 이 앉아 있으면 안 된다).
//      ② **언제** 열리든 같은 씨앗이면 같은 자리다 — 한꺼번에 열어도, 나눠 열어도.
//      ③ 두 번 열어도 두 번 심지 않는다(멱등).
//      ④ 심긴 자리는 제 링 반경 안이고, id 는 겹치지 않는다.
//      ⑤ 링0 은 한 톨도 안 바뀐다 — 링 확장이 시드42 밴드를 건드리면 안 된다.
// ────────────────────────────────────────────────────────────────
const RINGS = CFG.rings;
const fingerprintAll = (world) =>
  trailsOf(world).map((t) => `${t.id}:${t.chainId ?? t.key}:${t.step ?? '-'}:${t.x},${t.y}`).join('|');

test('★ §21-C1 링은 장이 열려야 심긴다 — 그 전에는 앞마당뿐이다', () => {
  const s = scene();
  const before = trailsOf(s.world).length;
  const first = RINGS[0];
  assert.equal(growTrailsFor(s.world, data, first.openAtChapter - 1), 0, '아직 안 열린 장이 링을 심었다');
  assert.equal(trailsOf(s.world).length, before);
  assert.ok(growTrailsFor(s.world, data, first.openAtChapter) > 0, '장이 열렸는데 링이 안 자랐다');
  assert.deepEqual(s.world.map.trailRings, [first.ring]);
});

test('★ §21-C1 결정론 — 한꺼번에 열든 나눠 열든 같은 씨앗이면 같은 지도다', () => {
  const last = RINGS[RINGS.length - 1].openAtChapter;
  const a = scene();
  growTrailsFor(a.world, data, last);
  const b = scene();
  for (const r of RINGS) growTrailsFor(b.world, data, r.openAtChapter);
  assert.equal(fingerprintAll(a.world), fingerprintAll(b.world));
  const other = scene(SEED + 1);
  growTrailsFor(other.world, data, last);
  assert.notEqual(fingerprintAll(a.world), fingerprintAll(other.world), '씨앗이 달라도 같은 지도가 났다');
});

test('★ §21-C1 멱등 — 같은 장을 두 번 열어도 두 번 심지 않는다', () => {
  const s = scene();
  const last = RINGS[RINGS.length - 1].openAtChapter;
  growTrailsFor(s.world, data, last);
  const n = trailsOf(s.world).length;
  assert.equal(growTrailsFor(s.world, data, last), 0);
  assert.equal(trailsOf(s.world).length, n);
  assert.equal(new Set(trailsOf(s.world).map((t) => t.id)).size, n, 'id 가 겹쳤다');
});

test('★ §21-C1 자리 — 링마다 제 반경 안에 앉고, 물 위에는 앉지 않는다', () => {
  const s = scene();
  growTrailsFor(s.world, data, RINGS[RINGS.length - 1].openAtChapter);
  const idx = terrainIndex(data);
  const outer = RINGS[RINGS.length - 1].radius[1];
  for (const t of trailsOf(s.world)) {
    const r = dist(s.t.x, s.t.y, t.x, t.y);
    assert.ok(r <= outer + 1, `흔적이 바깥 링 밖에 앉았다 (${r.toFixed(1)})`);
    assert.notEqual(terrainAt(s.world.map, t.x, t.y), idx.water, '물 위에 흔적이 앉았다');
  }
});

test('★ §21-C1 링0 불변 — 링이 자라도 앞마당은 한 톨도 안 바뀐다', () => {
  const a = scene();
  const ring0 = fingerprintAll(a.world);
  growTrailsFor(a.world, data, RINGS[RINGS.length - 1].openAtChapter);
  assert.equal(fingerprintAll(a.world).slice(0, ring0.length), ring0);
});

test('★ §21-C1 상처와 합류 — damage 는 죽이지 않고, villager 는 사람을 데려온다', () => {
  const s = scene();
  growTrailsFor(s.world, data, RINGS[RINGS.length - 1].openAtChapter);
  /* 아픈 미시 발견(벌집·오소리 굴) 하나를 골라 hp 를 바닥에 두고 손을 댄다 */
  const hurtful = trailsOf(s.world).find((t) => (trailDef(data, t)?.reward?.damage ?? 0) > 0);
  assert.ok(hurtful, '아픈 발견물이 하나도 안 심겼다');
  const p = ensurePlayer(s.nation, 'lord', data, '개척자');
  p.hp = 3;
  s.nation.avatars.lord.x = hurtful.x;
  s.nation.avatars.lord.y = hurtful.y;
  const res = investigateTrail(s.world, s.nation,
    { trailId: hurtful.id, avatarId: 'lord' }, data);
  assert.equal(res.ok, true);
  assert.ok(res.healed < 0, '아픈 발견물인데 체력이 안 깎였다');
  assert.ok(p.hp >= 1, '흔적이 사람을 죽였다');       /* GDD3 §14-6 — 1 아래로는 안 내린다 */
  assert.equal(typeof res.joined, 'number');
});

test('★ §21-C1 생존자 결말 — reward.villager 가 사람을 늘린다', () => {
  const s = scene();
  const t = trailsOf(s.world).find((x) => !x.hidden);
  const before = s.nation.villagers?.length ?? 0;
  s.nation.avatars.lord.x = t.x;
  s.nation.avatars.lord.y = t.y;
  /* 자료를 건드리지 않고 그 흔적의 보상만 갈아 끼워 본다(계약 시험이지 콘텐츠 시험이 아니다) */
  const def = trailDef(data, t);
  const keep = def.reward;
  def.reward = { villager: 2 };
  const res = investigateTrail(s.world, s.nation, { trailId: t.id, avatarId: 'lord' }, data);
  def.reward = keep;
  assert.equal(res.ok, true);
  assert.equal(res.joined, 2);
  assert.equal(s.nation.villagers.length, before + 2);
});

test('★ §21-C1 자료 온전성 — 사슬은 마지막 칸에 final 이 있고 결말 무게가 선다', () => {
  const seen = new Set();
  for (const c of CFG.chains) {
    assert.ok(!seen.has(c.id), `사슬 id 가 겹친다: ${c.id}`);
    seen.add(c.id);
    assert.ok(c.steps.length >= 3, `${c.id}: 사슬이 너무 짧다`);
    assert.ok(c.steps[c.steps.length - 1].final, `${c.id}: 마지막 칸에 final 이 없다`);
    assert.ok(c.endings.length >= 1, `${c.id}: 결말이 없다`);
    assert.ok(c.endings.reduce((a, e) => a + e.weight, 0) > 0, `${c.id}: 결말 무게 합이 0`);
    for (const e of c.endings) {
      assert.ok(e.lines?.length, `${c.id}/${e.key}: 말이 없다`);
      for (const ch of e.choices || []) assert.ok(ch.label && ch.lines?.length, `${c.id}/${e.key}/${ch.key}: 선택지가 비었다`);
    }
    /* 앞 칸들은 다음 흔적을 열 반경을 들고 있어야 한다 — 없으면 사슬이 거기서 끊긴다 */
    for (const st of c.steps.slice(0, -1)) assert.ok(st.revealRadius > 0, `${c.id}/${st.key}: revealRadius 가 없다`);
  }
  for (const m of CFG.micro) assert.ok(m.lines?.length || m.choices?.length, `${m.key}: 말이 없다`);
});
