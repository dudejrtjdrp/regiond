// §17-18 감정의 날 확장 회귀
//
// 유저 피드백 「감정의 날에 감정되는 요소가 너무 적다」에 대한 답을 못 박는다.
//
// 이 파일이 지키는 것 다섯:
//   ① 모든 태그는 한 줄 이야기(flavor)를 갖는다 — 이름만 던지고 끝나는 태그가 다시는 없다.
//   ② 새 태그 둘(너덜겅·삭은맥)의 효과 키는 **엔진이 실제로 읽는 키**뿐이다.
//      (tags.json 에는 아무도 읽지 않는 죽은 키가 이미 있다 — defenseTotal·populationGrowth·unlock.
//       새로 만드는 것까지 죽은 키를 쓰면 「수치가 있는데 아무 일도 안 일어나는」 태그가 늘어난다.)
//   ③ 컷신 프레임 수 = 5(옛 연출) + 태그 수 + 1(마무리). 태그가 늘면 이야기도 늘어난다.
//   ④ 마무리 한 줄은 data 가 쥔 문구 그대로, 언제나 마지막 장이다.
//   ⑤ emotion_day 변형은 6가지이고, 표현 계층 계약(이벤트별 3개 이상)도 그대로다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { completeStructure } from '../server/engine/structures.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { townOf } from '../server/engine/world.js';
import { tagFactor } from '../server/engine/economy.js';
import { templateText } from '../server/expression/templates.js';

const data = loadGameData();
const CUT = data.balance.emotionDay.cutscene;
const NEW_TAGS = ['quarry', 'rottenvein'];

/** 엔진이 태그 효과에서 실제로 읽는 키 — economy.tagFactor(output·gather)가 전부다. */
const LIVE_EFFECT_KEYS = ['output', 'gather'];
/** tagFactor 가 곱해지는 자리 — 생산은 departmentMultiplier, 채집은 나무·돌 둘뿐이다. */
const LIVE_OUTPUT = ['grain', 'ironOre', 'oil', 'steel', 'build'];
const LIVE_GATHER = ['wood', 'stone'];

/** 감정소를 세우고 [땅을 감정한다]를 눌러 감정의 날을 연다 — 유일한 문이다. */
function appraise(seed, tags) {
  const world = createWorld({ seed, data, playerName: '테스트' });
  const nation = world.nations.player;
  openChapterForDebug(world, nation, data, 6);
  nation.pendingTags = tags;
  const t = townOf(world, 'player');
  nation.resources.stone = 40;
  completeStructure(world, nation, { building: 'appraisal_post', tier: 1, x: t.x + 3, y: t.y, placed: true }, data);
  const res = applyCommand(world, 'player', { type: 'appraiseLand' }, data, createRng(seed));
  assert.equal(res.ok, true, JSON.stringify(res.error));
  return res.events.find((e) => e.kind === 'emotion_day').data;
}

test('§17-18 ① 모든 태그가 한 줄 이야기를 갖는다', () => {
  const keys = Object.keys(data.tags);
  assert.ok(keys.length >= 9, `태그 ${keys.length}종 (새 태그 둘을 더해 9종 이상)`);
  for (const [key, def] of Object.entries(data.tags)) {
    assert.equal(typeof def.flavor, 'string', `${key} 에 flavor 가 없다`);
    assert.ok(def.flavor.length >= 10, `${key} 의 이야기가 너무 짧다`);
    assert.ok(/[가-힣]/.test(def.flavor), `${key} 의 이야기는 세계관 언어여야 한다`);
    assert.ok(!def.flavor.includes(def.name), `${key} 의 이야기가 제 이름을 되풀이한다`);
  }
});

test('§17-18 ② 새 태그 둘은 엔진이 읽는 효과 키만 쓴다', () => {
  for (const key of NEW_TAGS) {
    const def = data.tags[key];
    assert.ok(def, `${key} 태그가 없다`);
    assert.ok(['strength', 'weakness', 'mixed'].includes(def.kind), `${key} 의 갈래가 이상하다`);
    for (const [group, table] of Object.entries(def.effects)) {
      assert.ok(LIVE_EFFECT_KEYS.includes(group), `${key} 의 ${group} 은 아무도 읽지 않는 키다`);
      const allow = { output: LIVE_OUTPUT, gather: LIVE_GATHER }[group];
      for (const res of Object.keys(table)) {
        assert.ok(allow.includes(res), `${key}.${group}.${res} 는 태그 보정이 닿지 않는 자리다`);
      }
    }
  }
});

test('§17-18 ② 새 태그의 수치가 실제로 채집·생산에 실린다', () => {
  const n = { tags: ['quarry'] };
  assert.ok(Math.abs(tagFactor(n, 'stone', data, 'gather') - 1.45) < 1e-9, '너덜겅은 돌을 늘린다');
  assert.ok(Math.abs(tagFactor(n, 'wood', data, 'gather') - 1) < 1e-9, '나무는 건드리지 않는다');
  const m = { tags: ['rottenvein'] };
  assert.ok(Math.abs(tagFactor(m, 'ironOre', data) - 0.7) < 1e-9, '삭은맥은 쇠를 깎는다');
  assert.ok(Math.abs(tagFactor(m, 'stone', data, 'gather') - 0.85) < 1e-9, '부스러지는 바위라 돌도 준다');
});

test('§17-18 ③ 컷신은 5 + 태그 수 + 1 장이다', () => {
  const two = appraise(9101, ['fertile', 'holy']);
  assert.equal(two.cutscene.length, 5 + 2 + 1);
  const four = appraise(9102, ['fertile', 'holy', 'quarry', 'rottenvein']);
  assert.equal(four.cutscene.length, 5 + 4 + 1, '태그가 늘면 이야기도 늘어난다');
  assert.ok(four.cutscene.every((f) => typeof f.text === 'string' && f.color), '모든 장이 글과 빛깔을 갖는다');
});

test('§17-18 ③ 태그마다 제 이름과 이야기를 읽어 주는 장이 있다', () => {
  const d = appraise(9103, ['greatwood', 'quarry']);
  const mid = d.cutscene.slice(5, 7);
  for (const key of ['greatwood', 'quarry']) {
    const def = data.tags[key];
    const found = mid.find((f) => f.text.startsWith(`${def.name} — `));
    assert.ok(found, `${def.name} 의 장이 없다`);
    assert.ok(found.text.includes(def.flavor), '자료의 이야기를 그대로 읽는다');
    assert.equal(found.color, CUT.flavorColor);
  }
  assert.deepEqual(d.tagStories.map((s) => s.key), ['greatwood', 'quarry'], '모달에서 다시 읽을 몫도 실려 온다');
  assert.ok(d.tagStories.every((s) => s.name && s.flavor));
});

test('§17-18 ④ 마무리 한 줄이 언제나 마지막 장이다', () => {
  const d = appraise(9104, ['fertile', 'barren', 'quarry']);
  const last = d.cutscene[d.cutscene.length - 1];
  assert.equal(last.text, CUT.closing.text);
  assert.equal(last.color, CUT.closing.color);
  assert.ok(CUT.closing.text.length > 0, '마무리 문구는 자료가 쥔다(매직 문구 금지)');
  const bodies = d.cutscene.slice(0, -1).map((f) => f.text);
  assert.ok(!bodies.includes(CUT.closing.text), '마무리는 한 번뿐이다');
});

test('§17-18 ⑤ emotion_day 변형 6종 + 표현 계층 계약', () => {
  const pool = data.templates.templates.emotion_day;
  assert.equal(pool.length, 6, `emotion_day 변형 ${pool.length}개 (6개여야 한다)`);
  assert.equal(new Set(pool).size, 6, '똑같은 문장을 채워 넣지 않았다');
  for (const [kind, variants] of Object.entries(data.templates.templates)) {
    assert.ok(variants.length >= 3, `${kind} 변형 ${variants.length}개 (3개 이상 필요)`);
  }
  const text = templateText('emotion_day', { tick: 3, nationId: 'player', tagLine: '비옥지 · 성지', nodesRevealed: 4 }, data);
  assert.ok(text.length > 0 && !text.includes('{{'), '자리표시자가 남지 않는다');
});
