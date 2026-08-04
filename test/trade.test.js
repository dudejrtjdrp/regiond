import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { openChapterForDebug } from '../server/engine/progression.js';
import { createWorld, npcAssignments } from '../server/engine/state.js';
import { createRng } from '../server/engine/rng.js';
import {
  scenarioTradeMultiplier, tradeMultiplier, effectiveTariff, freightRate,
  importPrice, exportPrice, infoLossRate, fxSpreadRate, hasDiplomat,
} from '../server/engine/economy.js';
import { applyCommand } from '../server/engine/commands.js';

const data = loadGameData();
// ★ v3.1 — 해금은 티어가 아니라 '장'이 쥔다(진행 감독 progression.js).
//   티어를 손으로 올리는 검사는 그에 상응하는 장도 함께 열어 둔다(개발·테스트 전용 손잡이).
const __openChapter = (nation, id) => openChapterForDebug(null, nation, data, id);

const T = data.balance.trade;

test('무역 실효배수 — 완비 1.17 / 보통 1.46 / 열악 2.25 (밸런스 §3)', () => {
  const round = (v) => Math.round(v * 100) / 100;
  for (const [key, sc] of Object.entries(T.referenceScenarios)) {
    const m = scenarioTradeMultiplier(sc, data);
    assert.equal(round(m), sc.expected, `${key}(${sc.label}) 실효배수 ${m.toFixed(4)} → ${sc.expected}`);
  }
});

test('무역 공식 — (1+관세)(1+운임)(1+환스프레드)(1+정보손실)', () => {
  const m = tradeMultiplier({ tariff: 0.1, freight: 0.2, fxSpread: 0.05, infoLoss: 0.1 });
  assert.ok(Math.abs(m - 1.1 * 1.2 * 1.05 * 1.1) < 1e-12);
});

test('관세 — 기본 15%, 영사관 티어당 −1%p, 최저 10%, 최하위국 면제', () => {
  const world = createWorld({ seed: 1, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  assert.ok(Math.abs(effectiveTariff(n, data) - 0.15) < 1e-9);
  n.buildings.consulate = 3;
  assert.ok(Math.abs(effectiveTariff(n, data) - 0.12) < 1e-9);
  n.buildings.consulate = 5;
  assert.ok(Math.abs(effectiveTariff(n, data) - 0.10) < 1e-9, '최저 10%');
  n.buildings.consulate = 9;
  assert.ok(Math.abs(effectiveTariff(n, data) - 0.10) < 1e-9);
  assert.equal(effectiveTariff(n, data, { lastPlace: true }), 0, '최하위국 면제');
});

test('운임 — 도로 티어별 0.40 / 0.29 / 0.18 / 0.08', () => {
  const world = createWorld({ seed: 2, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  for (const [tier, expected] of [[0, 0.40], [1, 0.29], [2, 0.18], [3, 0.08]]) {
    n.buildings.road = tier;
    assert.ok(Math.abs(freightRate(n, data) - expected) < 1e-9, `T${tier} → ${expected}`);
  }
});

test('외교관 유무 — 정보손실 0 / 0.30, 환스프레드 0.03 / 0.075', () => {
  const world = createWorld({ seed: 3, data, assignments: npcAssignments(data) });
  const n = world.nations.player;
  n.roles.trade.holder = 'npc';
  assert.ok(hasDiplomat(n));
  assert.equal(infoLossRate(n, data), 0);
  assert.equal(fxSpreadRate(n, data), 0.03);
  n.roles.trade.holder = null;
  assert.equal(infoLossRate(n, data), 0.30);
  assert.equal(fxSpreadRate(n, data), 0.075);
});

test('수출가 = 로컬가 × (1 − 수출마찰 0.10)', () => {
  assert.ok(Math.abs(exportPrice(2.0, data) - 1.8) < 1e-9);
});

test('거래 명령 — 골드·재고 검증과 정산이 서버에서 이뤄진다', () => {
  const world = createWorld({ seed: 4, data, assignments: npcAssignments(data) });
  const rng = createRng(4);
  const n = world.nations.player;
  const ai = world.nations.ai1;
  // ★ GDD3 §1 — 바깥과의 거래는 교역소(티어 3)부터 열린다. 공식은 그대로다.
  n.tier = 3;
  __openChapter(n, 10);
  n.gold = 1000; ai.resources.oil = 50;

  const buy = applyCommand(world, 'player', { type: 'trade', nationId: 'ai1', side: 'buy', resource: 'oil', amount: 10 }, data, rng);
  assert.ok(buy.ok, JSON.stringify(buy));
  assert.ok(Math.abs(n.resources.oil - 10) < 1e-9);
  assert.ok(Math.abs(ai.resources.oil - 40) < 1e-9);
  assert.ok(n.gold < 1000);

  const tooMuch = applyCommand(world, 'player', { type: 'trade', nationId: 'ai1', side: 'buy', resource: 'oil', amount: 9999 }, data, rng);
  assert.equal(tooMuch.ok, false);
  assert.ok(['NO_GOLD', 'NO_STOCK'].includes(tooMuch.error.code));
});
