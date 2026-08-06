// §17-18b 플레이어 태그 고정 해제 회귀
//
// 그동안 state.js 가 시작 태그를 ['fertile','holy'] 로 못 박아 두어, §17-18 에서 새로 만든
// 너덜겅·삭은맥은 물론 철광맥·유전도 실전에 한 번도 나오지 않았다. 이제 세계 시드가 뽑는다.
//
// 이 파일이 지키는 것 넷:
//   ① 결정론 — 같은 시드는 언제나 같은 땅을 준다(다시 이어 붙인 세이브도 같은 땅이다).
//   ② 구성 규칙 — 두 종, 강점 최소 하나, 약점 최대 하나, 같은 태그가 두 번 나오지 않는다.
//   ③ 다양성 — 시드를 갈아 보면 고정 시절에는 못 보던 태그도 나온다(고정이 정말 풀렸는가).
//   ④ 다이얼 — 규칙은 코드가 아니라 data/balance.json 이 쥔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { rollPlayerTags, assignTags } from '../server/engine/emotion_day.js';
import { createRng } from '../server/engine/rng.js';

const data = loadGameData();
const DIAL = data.balance.emotionDay.playerTags;
const SEEDS = [1, 42, 77, 404, 1234, 4242, 9101, 20260806];

const kindOf = (key) => data.tags[key]?.kind;
const countKind = (tags, kind) => tags.filter((t) => kindOf(t) === kind).length;

test('§17-18b ① 같은 시드는 같은 땅 — 추첨은 결정론이다', () => {
  for (const seed of SEEDS) {
    const a = rollPlayerTags(seed, data);
    const b = rollPlayerTags(seed, data);
    assert.deepEqual(a, b, `시드 ${seed} 를 두 번 굴렸더니 땅이 달라졌다`);
    const world = createWorld({ seed, data, playerName: '테스트' });
    const again = createWorld({ seed, data, playerName: '테스트' });
    assert.deepEqual(world.nations.player.pendingTags, a, `시드 ${seed} 월드가 추첨과 어긋난다`);
    assert.deepEqual(again.nations.player.pendingTags, a, `시드 ${seed} 를 다시 열었더니 땅이 달라졌다`);
  }
});

test('§17-18b ② 구성 규칙 — 두 종·강점 최소 하나·약점 최대 하나·중복 없음', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const tags = rollPlayerTags(seed, data);
    assert.equal(tags.length, DIAL.count, `시드 ${seed}: ${tags.length}종이 나왔다`);
    assert.equal(new Set(tags).size, tags.length, `시드 ${seed}: 같은 태그가 두 번 나왔다`);
    for (const key of tags) assert.ok(data.tags[key], `시드 ${seed}: 없는 태그 ${key}`);
    assert.ok(countKind(tags, 'strength') >= DIAL.minStrength, `시드 ${seed}: 강점이 모자란다`);
    assert.ok(countKind(tags, 'weakness') <= DIAL.maxWeakness, `시드 ${seed}: 약점이 너무 많다`);
  }
});

test('§17-18b ③ 고정이 풀렸다 — 시드를 갈면 여덟 태그가 골고루 나온다', () => {
  const seen = new Set();
  let withWeakness = 0;
  for (let seed = 1; seed <= 300; seed += 1) {
    const tags = rollPlayerTags(seed, data);
    tags.forEach((t) => seen.add(t));
    if (countKind(tags, 'weakness') > 0) withWeakness += 1;
  }
  assert.ok(seen.has('quarry') && seen.has('rottenvein'), '§17-18 의 새 태그가 아직 실전에 안 나온다');
  assert.ok(seen.size >= 6, `본 태그가 ${seen.size}종뿐이다 — 추첨이 한쪽으로 쏠렸다`);
  assert.ok(withWeakness > 30 && withWeakness < 270, `약점 있는 땅 ${withWeakness}/300 — 치우쳤다`);
});

test('§17-18b ④ 규칙은 다이얼이 쥔다 — 코드에 박힌 수가 없다', () => {
  for (const key of ['count', 'minStrength', 'maxWeakness', 'seedSalt']) {
    assert.equal(typeof DIAL[key], 'number', `balance.emotionDay.playerTags.${key} 가 없다`);
  }
  // 다이얼을 세 종·강점 셋으로 비틀면 추첨도 그대로 따라온다(약점 없는 땅).
  const bent = { ...data, balance: { ...data.balance, emotionDay: {
    ...data.balance.emotionDay, playerTags: { count: 3, minStrength: 3, maxWeakness: 0, seedSalt: 7 },
  } } };
  const tags = assignTags(bent, createRng(12345));
  assert.equal(tags.length, 3);
  assert.equal(countKind(tags, 'weakness'), 0, '약점 0 다이얼인데 약점이 붙었다');
  assert.equal(new Set(tags).size, 3);
});
