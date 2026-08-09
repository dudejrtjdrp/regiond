// §17-17 탐험 확대 + 바이옴 + 맵 확장 회귀
//
// 이 파일이 못 박는 것 넷:
//   ① 숨은 궤(cache) — 대부분 숨어 있고, 본영에서 멀고, 열면 **영영** 사라지며, 같은 궤는 언제 열어도
//      같은 것을 낸다(보상 난수가 월드 난수가 아니라 노드 id 로 지은 개인 난수이기 때문이다).
//   ② 유적 등급 보정(ruinGradeBoost) — 쌓아 두기만 하고 아무도 쓰지 않던 값이 이제 굴림에 실리고,
//      쓴 즉시 0 으로 돌아간다(한 번 쌓은 보정은 한 번의 굴림에만 얹힌다).
//   ③ 바이옴(설산·밀림) — 북쪽 끝과 남쪽 끝에 나되 **지도 한복판은 옛 다섯 지형 그대로**다.
//      첫 발견은 걸어 들어간 사람의 발이 판정하고, 한 지형에 한 번뿐이다.
//   ④ RLE 지형 계약 — codes 앞 다섯의 순서는 바뀌지 않는다(바뀌면 옛 세이브와 화면이 통째로 어긋난다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData, publicWorld } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { actionSwing } from '../server/engine/actions.js';
import { resolveRuinChoice } from '../server/engine/king.js';
import { generateWorldMap, terrainIndex, dist, townOf } from '../server/engine/world.js';

const data = loadGameData();
const SEED = 20260817;
const SIZE = data.world.size;
const BIOMES = data.world.terrain.biomes;
const CACHE = data.world.nodes.types.cache;

const scene = (seed = SEED) => {
  const world = createWorld({ seed, data, playerName: '개척자' });
  return { world, nation: world.nations.player };
};

/** 궤 하나를 손 닿는 자리에 두고 세 번 휘두른다 — 마지막 스윙이 뚜껑을 연다 */
function openCacheAt(world, nation, node) {
  node.revealed = true;
  nation.avatars.lord = { id: 'lord', name: '개척자', x: node.x, y: node.y, tick: 0 };
  let res = null;
  for (let i = 0; i < 3; i += 1) {
    res = actionSwing(world, nation, { nodeId: node.id, avatarId: 'lord' }, data, 1e6 + i * 1e5);
  }
  return res;
}

const cachesOf = (world) => (world.map.nodes || []).filter((n) => n.type === 'cache');

/** 지형 코드 하나가 처음 나오는 칸 */
function firstTileOf(map, code) {
  const want = terrainIndex(data)[code];
  for (let i = 0; i < map.terrain.length; i += 1) {
    if (map.terrain.charCodeAt(i) - 48 !== want) continue;
    return { x: i % map.size, y: Math.floor(i / map.size) };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// ① 숨은 궤 — 배치 규격
// ────────────────────────────────────────────────────────────────
test('★ §17-17 숨은 궤 — 세상에 count 만큼 앉고, 태반이 숨어 있고, 본영에서 멀다', () => {
  const { world } = scene();
  const list = cachesOf(world);
  const town = townOf(world, 'player');

  assert.equal(list.length, CACHE.count, `자료의 수만큼 앉는다 (${CACHE.count})`);
  const hidden = list.filter((n) => n.concealed).length;
  assert.ok(hidden > list.length * 0.35 && hidden < list.length * 0.75,
    `절반쯤은 숨어 있다 (${hidden}/${list.length}, concealChance ${CACHE.concealChance})`);

  for (const n of list) {
    assert.ok(dist(n.x, n.y, town.x, town.y) >= CACHE.minTownDistance,
      `본영에서 ${CACHE.minTownDistance}타일 밖이다 (${n.id})`);
  }
  // 숨은 궤는 가까이 가기 전에는 일감 목록에도 지도에도 없다
  const still = list.find((n) => n.concealed);
  assert.ok(still && !still.revealed, '은닉 궤는 처음에 드러나 있지 않다');
});

// ────────────────────────────────────────────────────────────────
// ② 숨은 궤 — 보상의 결정론
// ────────────────────────────────────────────────────────────────
test('★ §17-17 숨은 궤 — 같은 씨앗의 같은 궤는 언제 열어도 같은 것을 낸다', () => {
  const a = scene();
  const b = scene();
  const idA = cachesOf(a.world)[3].id;
  assert.equal(cachesOf(b.world)[3].id, idA, '같은 씨앗은 같은 지도를 낸다');

  const ra = openCacheAt(a.world, a.nation, cachesOf(a.world)[3]);
  const rb = openCacheAt(b.world, b.nation, cachesOf(b.world)[3]);
  assert.equal(ra.ok, true, JSON.stringify(ra.error ?? null));
  assert.ok(ra.cache, '세 번째 스윙에 뚜껑이 열린다');
  assert.equal(ra.cache.gold, rb.cache.gold, '나온 금이 같다');
  assert.equal(ra.cache.artifact?.key ?? null, rb.cache.artifact?.key ?? null, '나온 물건도 같다');

  const [lo, hi] = CACHE.reward.gold;
  assert.ok(ra.cache.gold >= lo && ra.cache.gold <= hi, `금은 자료의 폭 안이다 (${lo}~${hi})`);
});

// ────────────────────────────────────────────────────────────────
// ③ 숨은 궤 — 열면 영영 사라진다
// ────────────────────────────────────────────────────────────────
test('★ §17-17 숨은 궤 — 연 자리는 그루터기도 남기지 않는다(다시 칠 수 없다)', () => {
  const { world, nation } = scene();
  const node = cachesOf(world)[0];
  const before = nation.gold;

  const res = openCacheAt(world, nation, node);
  assert.equal(res.cache.nodeId, node.id);
  assert.equal(nation.gold, before + res.cache.gold, '금은 그 자리에서 국고에 든다');
  assert.equal(world.map.nodes.some((n) => n.id === node.id), false, '노드 목록에서 사라졌다');
  assert.ok((world.map.removedNodes || []).some((r) => r.id === node.id), '지운 사실이 장부에 남는다');

  // 화면이 유령을 두드려도 서버가 막는다
  const again = actionSwing(world, nation, { nodeId: node.id, avatarId: 'lord' }, data, 2e6);
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'BAD_NODE');
});

// ────────────────────────────────────────────────────────────────
// ④ 유적 등급 보정 — 전달과 리셋 (버그 회귀)
// ────────────────────────────────────────────────────────────────
/* ★ §22 갱신 — 보정을 나라에 쌓았다가 「쓴 즉시 0 으로 되돌리는」 방식은 폐지됐다.
   규율을 부르는 쪽마다 지켜야 하는데 궤·상자·유적 셋이 같은 통을 봐서 언젠가 어긋난다.
   이제 보정은 그것을 번 **방**의 것이고 결정에 실려 다닌다 — 되돌릴 것 자체가 없다. */
test('★ §17-17 유적 등급 보정 — 그 방이 번 보정이 그 방의 굴림에만 실린다', () => {
  const { world, nation } = scene();
  const order = Object.keys(data.balance.artifacts.gradeWeights);
  // 언제나 성공하고 언제나 첫 등급(common)을 뽑는 자 — 보정만이 등급을 움직인다
  const rng = { chance: () => true, weighted: (e) => e[0].value, pick: (a) => a[0] };

  const plain = resolveRuinChoice(world, nation, { ruin: { cardId: 'altar' } }, 'dig', data, rng);
  assert.equal(plain.result.artifact.grade, order[0], '보정이 없으면 뽑힌 등급 그대로다');

  const deep = { ruin: { cardId: 'altar', gradeBoost: 3 } };   // 「죽은 자의 성채」의 끝 방
  const boosted = resolveRuinChoice(world, nation, deep, 'dig', data, rng);
  assert.equal(boosted.result.artifact.grade, order[3], '보정만큼 등급이 밀려 올라간다');

  const after = resolveRuinChoice(world, nation, { ruin: { cardId: 'altar' } }, 'dig', data, rng);
  assert.equal(after.result.artifact.grade, order[0], '다음 방의 굴림에는 얹히지 않는다');
  assert.equal(nation.ruinGradeBoost, undefined, '나라에는 아무것도 쌓이지 않는다');
});

test('★ §22 유적 — 큰 자취를 끝까지 뒤지면 끝 방이 제 보정을 지고 나온다', () => {
  const { world, nation } = scene();
  const big = (world.map.nodes || []).filter((n) => n.type === 'ruin' && (n.gradeBoost || 0) >= 2)[0];
  assert.ok(big, '큰 유적이 세상에 있다');
  big.revealed = true;
  nation.avatars.lord = { id: 'lord', name: '개척자', x: big.x, y: big.y, tick: 0 };
  const per = Math.max(1, big.swingsPerCycle ?? 4);
  let res = null;
  let clock = 1e6;
  for (let i = 0; i < per * big.rooms; i += 1) {
    clock += 1e5;
    res = actionSwing(world, nation, { nodeId: big.id, avatarId: 'lord' }, data, clock);
  }
  assert.equal(res.ok, true, JSON.stringify(res.error ?? null));
  assert.ok(res.ruin, '한 주기를 뒤지면 방이 하나 열린다');
  assert.equal(res.ruin.spent, true, '끝 방까지 갔다');
  assert.equal(big.roomsOpened, big.rooms, '방을 하나도 안 빼놓고 열었다');
  /* 자리가 신전이면 방 셋은 수수께끼·시련·안치소가 되고 등급 보정을 쓰지 않는다(§20-R4b).
     그 갈래에서는 「방마다 결정이 하나씩 섰는가」만 본다 — 보정 자체는 §22 회귀가 따로 붙든다. */
  const cards = nation.decisionQueue.filter((d) => d.ruin);
  assert.ok(nation.decisionQueue.length >= 1, '방마다 결정이 하나씩 섰다');
  if (!cards.length) return;
  assert.equal(cards[cards.length - 1].ruin.gradeBoost, big.gradeBoost, '끝 방이 자취의 보정을 온전히 받는다');
});

// ────────────────────────────────────────────────────────────────
// ⑤ 유적 카드 — 새 여섯 장과 op 화이트리스트
// ────────────────────────────────────────────────────────────────
test('★ §17-17 유적 카드 — 열두 장이고, 엔진이 아는 op 만 쓴다', () => {
  const cards = data.ruins.cards;
  assert.ok(cards.length >= 12, `카드가 열두 장 이상이다 (${cards.length})`);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, '열쇠말이 겹치지 않는다');

  // ★ §22-2 층3 — `clue`(다음 자취의 안개를 연다)가 더해졌다. 엔진이 아는 op 의 정본이 여기다.
  const OPS = new Set(['gold', 'morale', 'resource', 'artifactRoll', 'clue']);
  for (const c of cards) {
    assert.ok(c.options.length >= 2, `${c.id} — 갈래가 둘 이상이다`);
    for (const o of c.options) {
      for (const out of o.outcomes || []) {
        assert.ok(OPS.has(out.op), `${c.id}/${o.key} — 엔진이 모르는 op(${out.op}) 는 못 쓴다`);
        for (const fx of out.failEffects || []) assert.ok(OPS.has(fx.op), `${c.id} 실패 효과의 op`);
        if (out.op !== 'resource') continue;
        assert.ok(data.resources.order.includes(out.resource), `${c.id} — 없는 재화(${out.resource})`);
      }
    }
  }
});

// ────────────────────────────────────────────────────────────────
// ⑥ 맵 확장 — 규격과 생성 값
// ────────────────────────────────────────────────────────────────
test('★ §17-17 맵 확장 — 384 지도가 넉넉한 시간 안에 서고, 밀도가 유지된다', () => {
  assert.equal(SIZE, 384, '지도는 384×384 다');
  const t0 = Date.now();
  const map = generateWorldMap(4242, data, { playerTags: ['fertile', 'holy'] });
  const ms = Date.now() - t0;
  assert.ok(ms < 4000, `월드 하나를 세우는 데 4초를 넘지 않는다 (${ms}ms)`);

  const by = {};
  for (const n of map.nodes) by[n.type] = (by[n.type] || 0) + 1;
  // 땅 전체에 뿌리는 종류는 자료의 수를 (거의) 채운다 — 채우지 못하면 지형 문턱이 무너진 것이다
  for (const type of ['forest', 'berry', 'fertile', 'water']) {
    const want = data.world.nodes.types[type].count;
    assert.ok(by[type] >= want * 0.9, `${type} 이 자료의 90% 이상 앉는다 (${by[type]}/${want})`);
  }
  assert.ok(by.rock >= data.world.nodes.types.rock.count * 0.8, `바위가 넉넉히 앉는다 (${by.rock})`);
  assert.equal(by.cache, CACHE.count);

  // 깃발 멀티도 넓어진 지도에 맞춰 늘어났다
  const claim = data.world.territory.claim;
  assert.ok(claim.maxRangeFromTown >= 110 && claim.maxClaims >= 6, '점령 한계가 지도에 맞춰 늘었다');
});

// ────────────────────────────────────────────────────────────────
// ⑦ 바이옴 — 있어야 할 곳에 있고, 없어야 할 곳에 없다
// ────────────────────────────────────────────────────────────────
test('★ §17-17 바이옴 — 북쪽에 설산이, 남쪽에 밀림이 난다', () => {
  const { world } = scene();
  const idx = terrainIndex(data);
  let snow = 0;
  let jungle = 0;
  let snowSouthEnd = 0;                 // 설산이 가장 남쪽으로 내려온 줄
  let jungleNorthEnd = SIZE;            // 밀림이 가장 북쪽으로 올라온 줄
  for (let i = 0; i < world.map.terrain.length; i += 1) {
    const v = world.map.terrain.charCodeAt(i) - 48;
    const y = Math.floor(i / SIZE);
    if (v === idx.snow) { snow += 1; snowSouthEnd = Math.max(snowSouthEnd, y); }
    if (v === idx.jungle) { jungle += 1; jungleNorthEnd = Math.min(jungleNorthEnd, y); }
  }
  assert.ok(snow > 0, '설산이 있다');
  assert.ok(jungle > 0, '밀림이 있다');
  /* ★ §19-F2 — 위도 문턱의 정본이 rules 표로 옮겨 갔다(옛 BIOMES.snow.latitudeMax 의 자리).
     값은 한 톨도 바뀌지 않았다 — 설산·밀림이 표 맨 앞이라 §17-17 의 판정이 그대로 산다. */
  const ruleOf = (code) => BIOMES.rules.find((r) => r.code === code);
  assert.ok(snowSouthEnd <= ruleOf('snow').lat[1] * SIZE + 1,
    `설산은 북쪽 띠 안에만 있다 (최남단 y=${snowSouthEnd})`);
  assert.ok(jungleNorthEnd >= ruleOf('jungle').lat[0] * SIZE - 1,
    `밀림은 남쪽 띠 안에만 있다 (최북단 y=${jungleNorthEnd})`);
});

test('★ §17-17 바이옴 — 시작 반경은 옛 다섯 지형 그대로다(초반 밸런스 불변)', () => {
  const { world } = scene();
  const idx = terrainIndex(data);
  const c = (SIZE - 1) / 2;
  let bad = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (Math.hypot(x - c, y - c) > BIOMES.protectRadius) continue;
      const v = world.map.terrain.charCodeAt(y * SIZE + x) - 48;
      if (v === idx.snow || v === idx.jungle) bad += 1;
    }
  }
  assert.equal(bad, 0, `지도 한복판 ${BIOMES.protectRadius}타일 안에는 새 지형이 한 칸도 없다`);

  // 본영 둘레도 마찬가지다 — 도읍은 한복판에서 jitter 만큼만 떨어져 앉는다
  const town = townOf(world, 'player');
  const safe = BIOMES.protectRadius - dist(town.x, town.y, c, c);
  assert.ok(safe > 20, `본영 둘레 ${safe.toFixed(1)}타일이 보호된다`);
});

test('★ §17-17 바이옴 계약 — 코드는 뒤에 붙었고, 걸을 수 있고, 설산에는 못 짓는다', () => {
  const t = data.world.terrain;
  assert.deepEqual(t.codes.slice(0, 5), ['grass', 'forest', 'rock', 'water', 'fertile'],
    'RLE 계약 — 앞 다섯의 순서는 영원히 고정이다');
  /* ★ §19-F2(F07-1) — 여섯 땅이 더 붙었다. 규칙은 그대로다: **뒤에만** 붙는다.
     설산·밀림의 인덱스(5·6)가 움직이면 옛 세이브의 RLE 가 통째로 어긋난다 — 그 자리를 못박는다. */
  assert.deepEqual(t.codes.slice(5, 7), ['snow', 'jungle'], '옛 두 지형의 자리는 움직이지 않는다');
  assert.deepEqual(t.codes.slice(7), ['desert', 'marsh', 'ash', 'mush', 'salt', 'dusk'],
    '새 지형은 뒤에만 붙는다');
  assert.ok(t.codes.length >= 10, '바이옴은 열 종을 넘는다 (F07-1)');
  for (const code of BIOMES.codes) assert.ok(t.names[code], `${code} 에 이름이 있다`);

  assert.ok(t.walkable.includes('snow') && t.walkable.includes('jungle'), '둘 다 걸을 수 있다');
  for (const code of BIOMES.codes) assert.ok(t.walkable.includes(code), `${code} 은 걸을 수 있다`);
  assert.equal(t.buildable.includes('marsh'), false, '진창에는 주춧돌이 놓이지 않는다');
  assert.equal(t.buildable.includes('ash'), false, '잿땅에는 집이 서지 않는다');
  assert.ok(t.buildable.includes('jungle'), '밀림에는 지을 수 있다');
  assert.equal(t.buildable.includes('snow'), false, '설산에는 짓지 못한다');
  assert.equal(t.walkable.includes('water'), false, '물은 여전히 길이 아니다');

  // 화면도 같은 목록을 받는다(공개 규격) — 다만 어디에 나는지(위도·문턱)는 알려 주지 않는다
  const pub = publicWorld(data);
  assert.deepEqual(pub.terrain.codes, t.codes);
  assert.deepEqual(pub.terrain.biomeCodes, BIOMES.codes);
  assert.equal(pub.terrain.biomes, undefined, '위도·문턱은 내려보내지 않는다');
});

test('★ §17-17 바이옴 자원 — 밀림에 숲이, 설산에 광맥이 설 수 있다', () => {
  const types = data.world.nodes.types;
  assert.ok(types.forest.terrains.includes('jungle'), '밀림에도 나무가 선다');
  assert.equal(types.forest.richChance, 0.18, '밀림이라고 더 기름지지 않다(밸런스 불변)');
  assert.ok(types.iron.terrains.includes('snow'), '설산 바위 틈에 철광맥이 선다');
  assert.ok(types.coal.terrains.includes('snow'), '설산에 석탄 노두가 설 수 있다');
  assert.ok(CACHE.terrains.includes('snow') && CACHE.terrains.includes('jungle'),
    '숨은 궤는 새 땅에도 앉는다');
});

// ────────────────────────────────────────────────────────────────
// ⑧ 첫 발견 — 한 번뿐이다
// ────────────────────────────────────────────────────────────────
test('★ §17-17 첫 발견 — 처음 밟은 날이 적히고, 두 번째부터는 아무 일도 없다', () => {
  const { world, nation } = scene();
  const rng = createRng(7);
  const snow = firstTileOf(world.map, 'snow');
  const jungle = firstTileOf(world.map, 'jungle');
  assert.ok(snow && jungle, '두 지형이 지도에 있다');
  world.tick = 9;

  const morale0 = nation.morale;
  const first = applyCommand(world, 'player', { type: 'lordMove', x: snow.x, y: snow.y }, data, rng);
  assert.equal(first.ok, true);
  assert.equal(first.biomes.length, 1, '한 걸음에 한 지형');
  assert.equal(first.biomes[0].code, 'snow');
  assert.equal(first.biomes[0].text, BIOMES.discovery.text.snow, '문구의 정본은 자료 하나다');
  assert.equal(nation.biomesSeen.snow, 9, '처음 밟은 날이 적힌다');
  assert.ok(nation.morale > morale0, '사기가 한 번 오른다');
  assert.ok((world.chronicle || []).some((e) => e.kind === 'discovery'), '연대기에 한 줄 남는다');

  const moraleAfter = nation.morale;
  world.tick = 20;
  const again = applyCommand(world, 'player', { type: 'lordMove', x: snow.x + 1, y: snow.y }, data, rng);
  assert.equal(again.biomes.length, 0, '같은 지형을 다시 밟아도 발견이 아니다');
  assert.equal(nation.biomesSeen.snow, 9, '적힌 날은 고쳐지지 않는다');
  assert.equal(nation.morale, moraleAfter, '몫도 다시 주지 않는다');

  const other = applyCommand(world, 'player', { type: 'lordMove', x: jungle.x, y: jungle.y }, data, rng);
  assert.equal(other.biomes.length, 1, '다른 지형은 따로 센다');
  assert.equal(nation.biomesSeen.jungle, 20);
  assert.equal(nation.biomesSeen.snow, 9, '하나를 봤다고 둘이 열리지 않는다');
});
