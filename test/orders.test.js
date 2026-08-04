import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import {
  parseOrder, stringifyOrder, evaluateCondition, selectActions, validateOrders,
  OrderSyntaxError, METRICS, OPS,
} from '../server/engine/orders.js';

const data = loadGameData();

const SAMPLES = [
  'IF resource.grain > 100 THEN TRANSFER(grain, surplus)',
  'IF resource.grain > 100 AND gold >= 50 THEN TRANSFER(grain, 30)',
  'IF invasion.daysUntil <= 3 THEN QUEUE_SWITCH(weapon)',
  'IF invasion.daysUntil <= 3 THEN DEFEND(0.55)',
  'IF resource.fuel < 20 THEN TRADE(buy, fuel, 30)',
  'IF tick == 7 OR population > 160 THEN CONVERT(steel)',
  'IF defense.total < 200 AND resource.steel >= 30 AND gold > 0 THEN QUEUE_SWITCH(steel)',
];

test('DSL 파서 왕복 — parse → stringify → parse 가 동일하다', () => {
  for (const src of SAMPLES) {
    const ast = parseOrder(src);
    const text = stringifyOrder(ast);
    assert.equal(text, src, `왕복 텍스트 불일치: ${text}`);
    assert.deepEqual(parseOrder(text), ast, '왕복 AST 불일치');
  }
});

test('DSL 파서 — 괄호와 대소문자 허용', () => {
  const ast = parseOrder('IF (resource.fuel < 20) OR tick == 5 THEN TRADE(buy, fuel, 30)');
  assert.equal(stringifyOrder(ast), 'IF resource.fuel < 20 OR tick == 5 THEN TRADE(buy, fuel, 30)');
  assert.deepEqual(parseOrder('if gold > 10 then CONVERT(fuel)').action, { type: 'CONVERT', args: { output: 'fuel' } });
});

test('DSL 파서 — 잘못된 구문은 OrderSyntaxError', () => {
  const bad = [
    'resource.grain > 100 THEN TRANSFER(grain, 10)',
    'IF resource.unknown > 1 THEN CONVERT(steel)',
    'IF gold !! 10 THEN CONVERT(steel)',
    'IF gold > abc THEN CONVERT(steel)',
    'IF gold > 10 THEN EXPLODE(all)',
    'IF gold > 10 THEN CONVERT(gold)',
    'IF gold > 10 THEN TRADE(steal, fuel, 3)',
  ];
  for (const src of bad) assert.throws(() => parseOrder(src), OrderSyntaxError, src);
});

test('조건 평가 — 지표·연산자 전수', () => {
  const ctx = { resources: { grain: 120, fuel: 5 }, gold: 40, tick: 7, population: 160, defenseTotal: 250, invasionDaysUntil: 2 };
  assert.equal(evaluateCondition(parseOrder('IF resource.grain > 100 THEN CONVERT(steel)').condition, ctx), true);
  assert.equal(evaluateCondition(parseOrder('IF resource.fuel >= 20 THEN CONVERT(steel)').condition, ctx), false);
  assert.equal(evaluateCondition(parseOrder('IF gold < 50 AND tick == 7 THEN CONVERT(steel)').condition, ctx), true);
  assert.equal(evaluateCondition(parseOrder('IF gold > 500 OR population > 160 THEN CONVERT(steel)').condition, ctx), false);
  assert.equal(evaluateCondition(parseOrder('IF defense.total <= 250 THEN CONVERT(steel)').condition, ctx), true);
  assert.equal(evaluateCondition(parseOrder('IF invasion.daysUntil <= 3 THEN CONVERT(steel)').condition, ctx), true);
  assert.equal(METRICS.length, 12);
  assert.deepEqual(OPS.sort(), ['<', '<=', '==', '>', '>='].sort());
});

test('평가 규칙 — priority 내림차순, 틱당 동일 자원 이동 상한', () => {
  const limit = data.balance.orders.maxResourceMovesPerTick;
  const orders = validateOrders([
    { id: 'low', priority: 1, text: 'IF gold > 0 THEN TRADE(sell, grain, 1)' },
    { id: 'high', priority: 9, text: 'IF gold > 0 THEN TRADE(sell, grain, 2)' },
    { id: 'mid', priority: 5, text: 'IF gold > 0 THEN TRADE(sell, grain, 3)' },
    { id: 'extra', priority: 3, text: 'IF gold > 0 THEN TRADE(sell, grain, 4)' },
    { id: 'off', priority: 99, enabled: false, text: 'IF gold > 0 THEN TRADE(sell, grain, 5)' },
  ], data);
  const ctx = { resources: { grain: 999 }, gold: 100, tick: 1, population: 50, defenseTotal: 0, invasionDaysUntil: 9 };
  const fired = selectActions(orders, ctx, data);
  assert.equal(fired.length, limit, `동일 자원 이동은 틱당 ${limit}회까지`);
  assert.deepEqual(fired.map((o) => o.id), ['high', 'mid', 'extra'].slice(0, limit));
});

test('validateOrders — AST 입력도 받고, 개수 상한을 강제한다', () => {
  const fromAst = validateOrders([{ priority: 2, ...parseOrder('IF gold > 10 THEN CONVERT(fuel)') }], data);
  assert.equal(fromAst[0].text, 'IF gold > 10 THEN CONVERT(fuel)');
  const many = Array.from({ length: data.balance.orders.maxOrders + 1 }, () => ({ text: 'IF gold > 1 THEN CONVERT(fuel)' }));
  assert.throws(() => validateOrders(many, data), OrderSyntaxError);
});
