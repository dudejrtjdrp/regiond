// ending.test.js — ★ §세계관 W3 매듭형 엔딩 검증.
//   지키는 것: ① 조건 3중 판정 ② 초대장 1회 ③ 웨이브 당일·중복 열기 거절
//   ④ ending_started 가 엔딩·크레딧·쿠키를 순서대로 얹는다 ⑤ 재회 보상은 엔딩 뒤에만 ⑥ 거래 누계.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import { applyCommand } from '../server/engine/commands.js';
import { storyEvents } from '../server/engine/story.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import {
  endingState, checkEndingInvite, acceptEnding,
  reunionOfferMult, reunionSellPremium, countTradeGold, endingCfg,
} from '../server/engine/ending.js';

const openChapter = (nation, id) => openChapterForDebug(null, nation, loadGameData(), id);

const data = loadGameData();
const cfg = endingCfg(data);

function readyWorld(seed = 42) {
  const world = createWorld({ seed, data, playerName: '개척자' });
  const p = world.nations.player;
  p.tier = cfg.tierMin;
  p.wave = { index: 6, arrivalTick: null, scheduledTick: null, history: [{ type: 'dragon', won: true }] };
  countTradeGold(p, cfg.tradePartnerId, cfg.tradeGoldMin);
  // ★ §세계관 W4 — 게이트가 재회 게이지로 승격됐다(이관 근사와 같은 상태를 만든다)
  (p.relations ||= {})[cfg.tradePartnerId] = cfg.reunionScoreMin;
  return world;
}

test('조건 3중 — 하나라도 모자라면 초대장은 오지 않는다', () => {
  const world = readyWorld();
  const p = world.nations.player;
  assert.equal(endingState(world, p, data).met, true);
  p.tier = cfg.tierMin - 1;
  assert.equal(endingState(world, p, data).met, false, '티어');
  p.tier = cfg.tierMin;
  p.wave.history = [{ type: 'wolf', won: true }];
  assert.equal(endingState(world, p, data).met, false, '용');
  world.dragon = { slainTick: 3 };
  assert.equal(endingState(world, p, data).met, true, '세계 보스 처치도 용 격퇴로 인정한다');
  p.relations[cfg.tradePartnerId] = 0;   // ★ §세계관 W4 — 게이트는 이제 재회 게이지다
  assert.equal(endingState(world, p, data).met, false, '재회 게이지');
});

test('초대장 — 조건이 차면 한 번만 오고, 연대기에 남는다', () => {
  const world = readyWorld();
  const first = checkEndingInvite(world, data);
  assert.equal(first.length, 1);
  assert.equal(first[0].kind, 'ending_invite');
  assert.ok(first[0].data.text.includes(world.nations.player.name));
  assert.equal(checkEndingInvite(world, data).length, 0, '1회 보장');
  assert.ok((world.chronicle || []).some((r) => r.title === '초대장'));
});

test('열기 — 초대장 없이는, 그리고 웨이브 당일에는 열 수 없다', () => {
  const world = readyWorld();
  const p = world.nations.player;
  assert.equal(acceptEnding(world, p, data).ok, false, 'NO_INVITE');
  checkEndingInvite(world, data);
  p.wave.arrivalTick = world.tick;
  const r = acceptEnding(world, p, data);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'WAVE_DAY');
  p.wave.arrivalTick = null;
  assert.equal(acceptEnding(world, p, data).ok, true);
  assert.equal(acceptEnding(world, p, data).code, 'ALREADY', '엔딩은 1회');
  assert.ok((world.chronicle || []).some((r2) => r2.title === '첫 매듭'));
});

test('이야기 — ending_started 하나가 엔딩·크레딧·쿠키를 순서대로 얹는다', () => {
  const world = readyWorld();
  checkEndingInvite(world, data);
  const r = acceptEnding(world, p(world), data, '개척자');
  const beats = storyEvents(world, data, r.events);
  assert.deepEqual(beats.map((b) => b.data.id), ['ending', 'ending_credits', 'ending_cookie']);
  assert.ok(beats[0].data.scenes.some((s) => s.text.includes(world.nations.player.name)));
  assert.equal(storyEvents(world, data, r.events).length, 0, '재감상은 연대기에서 — 연출은 1회');
  function p(w) { return w.nations.player; }
});

test('용의 턴 포인트 — 용 무리에만 예고·격퇴 이야기가 얹힌다', () => {
  const world = createWorld({ seed: 42, data, playerName: '개척자' });
  const wolf = storyEvents(world, data, [{ kind: 'wave_incoming', nationId: 'player', data: { number: 6, type: 'wolf' } }]);
  assert.ok(!wolf.some((b) => b.data.id === 'dragon_omen'));
  const omen = storyEvents(world, data, [{ kind: 'wave_incoming', nationId: 'player', data: { number: 6, type: 'dragon' } }]);
  assert.ok(omen.some((b) => b.data.id === 'dragon_omen'));
  const slain = storyEvents(world, data, [{ kind: 'wave_held', nationId: 'player', data: { type: 'dragon' } }]);
  assert.ok(slain.some((b) => b.data.id === 'dragon_slain'), '떡밥 2회차');
});

test('재회 보상 — 엔딩 전에는 없고, 엔딩 뒤에는 에르니아에만 붙는다', () => {
  const world = readyWorld();
  assert.equal(reunionOfferMult(world, cfg.tradePartnerId, data), 1);
  assert.equal(reunionSellPremium(world, cfg.tradePartnerId, data), 0);
  world.endingDone = 10;
  assert.equal(reunionOfferMult(world, cfg.tradePartnerId, data), cfg.reunion.offerChanceMult);
  assert.equal(reunionSellPremium(world, cfg.tradePartnerId, data), cfg.reunion.sellPremium);
  assert.equal(reunionOfferMult(world, 'ai1', data), 1, '청명·엘라시아는 그대로');
  assert.equal(reunionSellPremium(world, 'ai2', data), 0);
});

test('거래 누계 — 사고팔 때 오간 금화가 상대별로 쌓인다 (trade 명령 경유)', () => {
  const world = createWorld({ seed: 42, data, playerName: '개척자' });
  const rng = createRng(1);
  const p = world.nations.player;
  p.tier = 4;
  openChapter(p, 10);
  p.metNations = { ai1: 1, ai2: 1, ai3: 1 };
  p.resources.wood = 500;
  const r = applyCommand(world, 'player', { type: 'trade', nationId: cfg.tradePartnerId, side: 'sell', resource: 'wood', amount: 20 }, data, rng);
  assert.equal(r.ok, true, JSON.stringify(r.error ?? null));
  const traded = p.stats.tradeGoldWith?.[cfg.tradePartnerId] || 0;
  assert.ok(traded > 0, '판 금액이 누계에 쌓인다');
  assert.equal(endingState(world, p, data).traded, traded);
});
