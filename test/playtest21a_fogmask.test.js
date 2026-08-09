// §21-A3 — 안개 마스크 Uint8Array화. 이 파일이 붙드는 문장 다섯:
//   ① 옛 세이브(문자열 마스크)는 migrateWorld 를 지나 Uint8Array 가 된다 — 걸어 둔 땅은 한 칸도 안 잃는다
//   ② stampVisionDisc 의 결과가 **종전 문자열 구현과 한 글자도 다르지 않다**(마스크도, 돌려주는 청크 목록도)
//   ③ exploredRatio 캐시는 세대(gen) 를 열쇠로 쓴다 — 안 바뀌면 같은 값, 바뀌면 반드시 따라 온다
//   ④ 세이브 파일의 생김새는 그대로다 — 여전히 '0'/'1'/'2' 문자열이고, 왕복해도 값이 같다
//   ⑤ 옛 chunkHash 눈금(문자 코드)을 그대로 쓴다 — 이관 직후 전 청크가 「바뀌었다」로 쏟아지지 않는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGameData } from '../server/engine/data.js';
import { createWorld, migrateWorld } from '../server/engine/state.js';
import { townOf } from '../server/engine/world.js';
import {
  stampVisionDisc, exploredRatio, fogValue, recomputeFog, bumpGen,
  maskToString, maskFromString, packFogMasks,
} from '../server/engine/fog.js';
import { saveSnapshot, loadSnapshot, savesDir } from '../server/persistence.js';

const data = loadGameData();
const VISION = data.world.fog.vision.lord;

function scene(seed = 4242) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  const town = townOf(world, 'player');
  nation.avatars.lord = { id: 'lord', name: '테스트', x: town.x, y: town.y, tick: 0, appearance: {} };
  return { world, nation, town };
}

/** 살아 있는 세상을 「옛 세이브」로 되돌린다 — 문자열 마스크 · gen 없음 · 옛 migrationRev */
function asLegacySave(world, rev = 2) {
  const packed = packFogMasks(world);
  const save = JSON.parse(JSON.stringify(packed));   // 진짜 파일이 그렇듯 순수 JSON 으로 굳힌다
  for (const nation of Object.values(save.nations)) {
    if (!nation.fog) continue;
    delete nation.fog.gen;
  }
  save.migrationRev = rev;
  return save;
}

// ────────────────────────────────────────────────────────────────
// ① 옛 세이브 이관
// ────────────────────────────────────────────────────────────────
test('★ §21-A3 이관 — 문자열 마스크 구세이브가 Uint8Array 로 열리고, 밝기는 한 칸도 안 바뀐다', () => {
  const { world } = scene(4242);
  const before = Array.from(world.nations.player.fog.mask);
  const save = asLegacySave(world);
  assert.equal(typeof save.nations.player.fog.mask, 'string', '옛 세이브는 문자열이어야 시험이 성립한다');
  assert.equal(save.nations.player.fog.gen, undefined);

  const migrated = migrateWorld(save, data);
  assert.ok(migrated, '구버전으로 폐기되면 안 된다(schema 6 은 그대로다)');
  const fog = migrated.nations.player.fog;
  assert.ok(fog.mask instanceof Uint8Array, '이관 뒤에는 Uint8Array 다');
  assert.deepEqual(Array.from(fog.mask), before, '이관이 밝기를 한 칸도 바꾸면 안 된다');
  assert.equal(fog.gen, 0, 'gen 이 없던 세이브는 0 부터 시작한다');
  assert.ok(migrated.migrationRev > 2, 'migrationRev 가 올라야 다음 세이브도 이 줄을 지난다');
});

test('★ §21-A3 이관 — 이관된 세상은 곧바로 읽고 쓸 수 있다(fogValue·exploredRatio·stamp)', () => {
  const { world, town } = scene(909);
  const migrated = migrateWorld(asLegacySave(world), data);
  const nation = migrated.nations.player;

  assert.equal(fogValue(nation, town.x, town.y), 2, '도읍은 시야 안이다');
  const ratio = exploredRatio(nation);
  assert.ok(ratio > 0 && ratio < 1, `탐사율이 0~1 사이여야 한다 — ${ratio}`);

  // 이관된 마스크 위에 그대로 시야를 찍을 수 있다(문자열이 남아 있으면 여기서 터진다)
  const far = { x: town.x + VISION * 3, y: town.y };
  assert.equal(fogValue(nation, far.x, far.y), 0);
  const chunks = stampVisionDisc(nation, data, 5, far.x, far.y, VISION);
  assert.ok(chunks.length > 0, '새 땅을 밝혔으면 바뀐 청크가 나와야 한다');
  assert.equal(fogValue(nation, far.x, far.y), 2);
  assert.ok(nation.fog.mask instanceof Uint8Array);
});

test('★ §21-A3 이관 — migrateWorld 를 두 번 불러도 같다(매 틱 불리는 자리다)', () => {
  const { world } = scene(31);
  const once = migrateWorld(asLegacySave(world), data);
  const snapshot = Array.from(once.nations.player.fog.mask);
  const twice = migrateWorld(once, data);
  assert.ok(twice.nations.player.fog.mask instanceof Uint8Array);
  assert.deepEqual(Array.from(twice.nations.player.fog.mask), snapshot);
});

// ────────────────────────────────────────────────────────────────
// ② 종전 문자열 구현과의 동치 — 이 시험이 이번 작업의 심장이다
// ────────────────────────────────────────────────────────────────

/** 종전(문자열) chunkHashAt 그대로 */
function oldChunkHash(mask, size, chunk, cx, cy) {
  let h = 2166136261 >>> 0;
  for (let y = cy * chunk; y < Math.min(size, (cy + 1) * chunk); y += 1) {
    for (let x = cx * chunk; x < Math.min(size, (cx + 1) * chunk); x += 1) {
      h ^= mask.charCodeAt(y * size + x);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h;
}

/** 종전 stampVisionDisc 그대로 — split('')/join('') 판본. 이 시험의 정답지다. */
function oldStamp(old, tick, cx, cy, r) {
  const { size, chunk } = old;
  const per = Math.ceil(size / chunk);
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size - 1, Math.ceil(cy + r));
  let arr = null;
  const dirty = new Set();
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const i = y * size + x;
      if (old.mask.charCodeAt(i) >= 50) continue;
      if (!arr) arr = old.mask.split('');
      arr[i] = '2';
      dirty.add(Math.floor(y / chunk) * per + Math.floor(x / chunk));
    }
  }
  if (!arr) return [];
  old.mask = arr.join('');
  const out = [];
  for (const ci of dirty) {
    const qx = ci % per;
    const qy = Math.floor(ci / per);
    const h = oldChunkHash(old.mask, size, chunk, qx, qy);
    if (old.chunkHash[ci] === h) continue;
    old.chunkHash[ci] = h;
    old.chunkStamp[ci] = tick;
    out.push([qx, qy]);
  }
  return out;
}

test('★ §21-A3 동치 — 걸음 40번을 찍어도 마스크·청크목록·해시가 종전 구현과 완전히 같다', () => {
  const { nation, town } = scene(777);
  const fog = nation.fog;
  const old = {
    size: fog.size,
    chunk: fog.chunk,
    mask: maskToString(fog.mask),
    chunkHash: [...fog.chunkHash],
    chunkStamp: [...fog.chunkStamp],
  };

  for (let step = 0; step < 40; step += 1) {
    const x = town.x + ((step * 11) % 60) - 30;
    const y = town.y + ((step * 7) % 60) - 30;
    const nu = stampVisionDisc(nation, data, step + 1, x, y, VISION);
    const ov = oldStamp(old, step + 1, x, y, VISION);
    assert.deepEqual(nu, ov, `걸음 ${step}: 돌려주는 청크 목록이 갈렸다`);
    assert.equal(maskToString(fog.mask), old.mask, `걸음 ${step}: 직렬화한 마스크가 갈렸다`);
  }
  assert.deepEqual([...fog.chunkHash], old.chunkHash, '청크 해시가 갈렸다');
  assert.deepEqual([...fog.chunkStamp], old.chunkStamp, '청크 스탬프가 갈렸다');
});

test('★ §21-A3 동치 — recomputeFog 와 코덱 왕복도 종전 문자열과 같다', () => {
  const { world, nation, town } = scene(1234);
  stampVisionDisc(nation, data, 1, town.x + 25, town.y + 25, VISION);
  recomputeFog(world, nation, data, 2);

  const text = maskToString(nation.fog.mask);
  assert.equal(text.length, nation.fog.size ** 2);
  assert.ok(/^[012]+$/.test(text), '직렬화 결과는 여전히 0/1/2 문자열이다');
  assert.deepEqual(Array.from(maskFromString(text)), Array.from(nation.fog.mask), '왕복이 값을 바꿨다');

  // 시야(2)였던 자리가 recompute 뒤 탐사(1)로 내려앉는 계약도 그대로다
  assert.equal(fogValue(nation, town.x + 25, town.y + 25), 1);
});

test('★ §21-A3 동치 — 같은 자리를 다시 두드리면 공짜다(빈 목록 · 세대 그대로)', () => {
  const { nation, town } = scene(55);
  const spot = { x: town.x + VISION * 3, y: town.y + VISION * 3 };
  assert.ok(stampVisionDisc(nation, data, 1, spot.x, spot.y, VISION).length > 0);
  const gen = nation.fog.gen;
  assert.deepEqual(stampVisionDisc(nation, data, 2, spot.x, spot.y, VISION), []);
  assert.equal(nation.fog.gen, gen, '새로 밝아진 칸이 없으면 세대도 오르지 않는다');
});

// ────────────────────────────────────────────────────────────────
// ③ exploredRatio 캐시 정합
// ────────────────────────────────────────────────────────────────
const bruteRatio = (fog) => {
  let n = 0;
  for (let i = 0; i < fog.mask.length; i += 1) if (fog.mask[i] > 0) n += 1;
  return n / fog.mask.length;
};

test('★ §21-A3 캐시 — 안 바뀌면 같은 값, 밝히면 반드시 따라 오른다(세대가 열쇠다)', () => {
  const { nation, town } = scene(2024);
  const first = exploredRatio(nation);
  assert.equal(first, bruteRatio(nation.fog), '첫 셈부터 실제 마스크와 맞아야 한다');
  assert.equal(exploredRatio(nation), first, '아무 일도 없었으면 같은 값이다');

  stampVisionDisc(nation, data, 1, town.x + VISION * 4, town.y, VISION);
  const after = exploredRatio(nation);
  assert.ok(after > first, `새 땅을 밝혔는데 탐사율이 안 올랐다 — ${first} → ${after}`);
  assert.equal(after, bruteRatio(nation.fog), '캐시가 실제 마스크와 어긋났다');
});

test('★ §21-A3 캐시 — recomputeFog 뒤에도, 손으로 주무른 뒤에도(bumpGen) 어긋나지 않는다', () => {
  const { world, nation, town } = scene(606);
  stampVisionDisc(nation, data, 1, town.x + VISION * 4, town.y, VISION);
  exploredRatio(nation);                       // 캐시를 채워 둔다
  recomputeFog(world, nation, data, 2);
  assert.equal(exploredRatio(nation), bruteRatio(nation.fog), 'recompute 뒤 캐시가 낡았다');

  // 손으로 안개를 도로 덮는다 — bumpGen 이 그 사실을 알리는 유일한 표식이다
  const before = exploredRatio(nation);
  let covered = 0;
  for (let i = 0; i < nation.fog.mask.length && covered < 500; i += 1) {
    if (!nation.fog.mask[i]) continue;          // 원래 캄캄한 자리를 덮어 봐야 아무 일도 안 난다
    nation.fog.mask[i] = 0;
    covered += 1;
  }
  assert.equal(covered, 500, '덮을 밝은 칸이 모자라면 시험이 성립하지 않는다');
  bumpGen(nation.fog);
  const after = exploredRatio(nation);
  assert.ok(after < before, `도로 덮었는데 탐사율이 안 내려갔다 — ${before} → ${after}`);
  assert.equal(after, bruteRatio(nation.fog));
});

test('★ §21-A3 캐시 — structuredClone 한 세상은 제 값을 새로 센다(일 틱이 하는 일이다)', () => {
  const { world, nation, town } = scene(88);
  stampVisionDisc(nation, data, 1, town.x + VISION * 4, town.y, VISION);
  exploredRatio(nation);
  const copy = structuredClone(world);
  assert.ok(copy.nations.player.fog.mask instanceof Uint8Array, 'structuredClone 이 형을 지켜야 한다');
  assert.equal(exploredRatio(copy.nations.player), bruteRatio(copy.nations.player.fog));
});

// ────────────────────────────────────────────────────────────────
// ④·⑤ 세이브 파일 포맷 · 청크 해시 눈금
// ────────────────────────────────────────────────────────────────
test('★ §21-A3 세이브 — 파일은 여전히 문자열이고, 살아 있는 월드는 Uint8Array 그대로다', async () => {
  const gameId = `fogmask_${Date.now()}`;
  try {
    const world = createWorld({ gameId, seed: 3131, data, playerName: '테스트' });
    saveSnapshot(world);
    const raw = JSON.parse(readFileSync(join(savesDir(), gameId, 'snapshot.json'), 'utf8'));
    assert.equal(typeof raw.nations.player.fog.mask, 'string', '세이브 포맷을 바꾸면 안 된다');
    assert.ok(/^[012]+$/.test(raw.nations.player.fog.mask));
    assert.equal(raw.nations.player.fog.mask.length, world.nations.player.fog.size ** 2);
    // 저장이 살아 있는 월드를 문자열로 되돌려 놓으면 다음 걸음이 도로 느려진다
    assert.ok(world.nations.player.fog.mask instanceof Uint8Array, '월드의 마스크가 문자열로 바뀌었다');

    const loaded = loadSnapshot(gameId);
    assert.ok(loaded.nations.player.fog.mask instanceof Uint8Array, '읽을 때 런타임 모양으로 와야 한다');
    assert.deepEqual(
      Array.from(loaded.nations.player.fog.mask),
      Array.from(world.nations.player.fog.mask),
      '왕복이 밝기를 바꿨다',
    );
  } finally {
    await rm(join(savesDir(), gameId), { recursive: true, force: true });
  }
});

test('★ §21-A3 해시 눈금 — 새 코드가 든 chunkHash 는 옛 문자열 눈금 그대로다', () => {
  const { nation, town } = scene(4545);
  stampVisionDisc(nation, data, 1, town.x + 20, town.y + 20, VISION);   // 해시를 몇 개 갈아 둔다
  const fog = nation.fog;
  const text = maskToString(fog.mask);
  const per = Math.ceil(fog.size / fog.chunk);

  /* 옛 코드가 문자 코드('0'=48)로 구웠을 해시를 문자열에서 직접 만들어 맞춰 본다.
     여기가 어긋나면 옛 세이브의 chunkHash 가 통째로 무효가 되어, 접속하자마자 전 청크가 다시 날아간다. */
  for (let ci = 0; ci < fog.chunkHash.length; ci += 1) {
    const want = oldChunkHash(text, fog.size, fog.chunk, ci % per, Math.floor(ci / per));
    assert.equal(fog.chunkHash[ci], want, `청크 ${ci} 의 해시 눈금이 옛 세이브와 갈렸다`);
  }
});

test('★ §21-A3 세이브 왕복 — 한 바퀴 돌고 온 세상과 안 돌고 온 세상이 완전히 같다', () => {
  const a = scene(4545);
  const b = scene(4545);
  migrateWorld(a.world, data);
  const migrated = migrateWorld(asLegacySave(b.world), data);   // 저장했다 다시 연 세상
  const nb = migrated.nations.player;

  for (const tick of [1, 2, 3]) {
    const x = a.town.x + tick * 9;
    const y = a.town.y - tick * 6;
    assert.deepEqual(
      stampVisionDisc(a.nation, data, tick, x, y, VISION),
      stampVisionDisc(nb, data, tick, x, y, VISION),
      `걸음 ${tick}: 바뀐 청크 목록이 갈렸다`,
    );
  }
  recomputeFog(a.world, a.nation, data, 4);
  recomputeFog(migrated, nb, data, 4);
  assert.deepEqual(Array.from(nb.fog.mask), Array.from(a.nation.fog.mask), '마스크가 갈렸다');
  assert.deepEqual([...nb.fog.chunkHash], [...a.nation.fog.chunkHash], '청크 해시가 갈렸다');
  assert.deepEqual([...nb.fog.chunkStamp], [...a.nation.fog.chunkStamp], '청크 스탬프가 갈렸다');
  assert.equal(exploredRatio(nb), exploredRatio(a.nation), '탐사율이 갈렸다');
});
