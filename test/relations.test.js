// relations.test.js — ★ §세계관 W4 관계 결·국가 이벤트 검증.
//   지키는 것: ① 결마다 다른 셈(재회=금화·신의=계약 건수·세 부족=쉬움) ② 거절의 값과 쇄국
//   ③ 위신 가산은 에르니아만 ④ 임계 보상(정기 계약·강재 특가) ⑤ 이벤트 트리거 게이트
//   ⑥ 성녀 예고 ⑦ 세계 난수 불소비(시뮬 결정론) ⑧ 엔딩 게이트 승격 이관.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import {
  relationsOf, addRel, onTradeDone, onOfferRefused, relationTitle,
  relationView, dailyRelations, relCfg,
} from '../server/engine/relations.js';
import { endingState, endingCfg } from '../server/engine/ending.js';

const data = loadGameData();
const world0 = (seed = 42) => createWorld({ seed, data, playerName: '개척자' });
const P = (w) => w.nations.player;

test('다이얼 — 세 나라 모두 relation 결이 있고 style 이 서로 다르다', () => {
  const styles = data.aiNations.nations.map((n) => n.relation?.style);
  assert.deepEqual(styles.sort(), ['neighbors', 'reunion', 'trust']);
});

test('셈의 차이 — 청명은 건수, 엘라시아는 더 쉽게, 에르니아는 금화 비례', () => {
  const w = world0();
  onTradeDone(w, P(w), 'ai1', 500, data);
  onTradeDone(w, P(w), 'ai2', 500, data);
  onTradeDone(w, P(w), 'ai3', 500, data);
  const rel = P(w).relations;
  assert.equal(rel.ai1, relCfg(data, 'ai1').perDeal, '신의 — 금액 무관 건당');
  assert.equal(rel.ai2, relCfg(data, 'ai2').perDeal, '세 부족 — 건당, 가장 후함');
  assert.ok(rel.ai2 > rel.ai1);
  assert.equal(rel.ai3, 500 * relCfg(data, 'ai3').perGold, '재회 — 금화 비례');
});

test('클램프 — 0 아래로도 100 위로도 가지 않는다', () => {
  const w = world0();
  addRel(w, P(w), 'ai1', 999, data);
  assert.equal(P(w).relations.ai1, 100);
  addRel(w, P(w), 'ai1', -999, data);
  assert.equal(P(w).relations.ai1, 0);
});

test('거절의 값 — 청명은 세 번 이어지면 문을 닫는다(쇄국)', () => {
  const w = world0();
  addRel(w, P(w), 'ai1', 20, data);
  const before = P(w).relations.ai1;
  assert.equal(onOfferRefused(w, P(w), 'ai1', data).length, 0);
  assert.equal(onOfferRefused(w, P(w), 'ai1', data).length, 0);
  const third = onOfferRefused(w, P(w), 'ai1', data);
  assert.equal(third.length, 1, '3연속 — 쇄국 사건');
  assert.equal(third[0].data.id, 'cheongmyeong_closed_gate');
  const cfg = relCfg(data, 'ai1');
  const expected = before + cfg.refuseDelta * 3 + cfg.closedGate.delta;
  assert.equal(P(w).relations.ai1, Math.max(0, expected));
  assert.ok((w.offerBanUntil?.ai1 ?? 0) > w.tick, '제안이 끊긴다');
  assert.equal(P(w).relMeta.refuseStreak.ai1, 0, '연속 거절 장부는 비워진다');
  assert.equal(onOfferRefused(w, P(w), 'ai2', data).length, 0, '엘라시아는 쇄국이 없다');
});

test('위신 — 티어업·격퇴는 에르니아(재회)만 지켜본다', () => {
  const w = world0();
  dailyRelations(w, data, [{ kind: 'tier_up' }, { kind: 'wave_held' }]);
  const p = relCfg(data, 'ai3').prestige;
  assert.equal(P(w).relations.ai3, p.tier_up + p.wave_held);
  assert.equal(P(w).relations.ai1, 0);
  assert.equal(P(w).relations.ai2, 0);
});

test('정기 계약 — 임계를 넘긴 엘라시아가 매일 목재를 실어 온다(금고 빈 날은 쉼)', () => {
  const w = world0();
  const cfg = relCfg(data, 'ai2');
  addRel(w, P(w), 'ai2', cfg.thresholds.contract, data);
  P(w).gold = 100;
  const wood0 = P(w).resources.wood || 0;
  const evs = dailyRelations(w, data, []);
  assert.ok(evs.some((e) => e.kind === 'nation_contract'));
  assert.equal(P(w).resources.wood, wood0 + cfg.contract.amount);
  P(w).gold = 0;
  const evs2 = dailyRelations(w, data, []);
  assert.ok(!evs2.some((e) => e.kind === 'nation_contract'), '금고가 비면 조용히 쉰다');
});

test('강재 특가 — 신의를 맺은 벗에게만, 쿨타임을 지키며 온다', () => {
  const w = world0();
  addRel(w, P(w), 'ai1', relCfg(data, 'ai1').thresholds.bond, data);
  let offers = 0;
  for (let t = 1; t <= 20; t += 1) {
    w.tick = t;
    dailyRelations(w, data, []);
    offers = (w.offers || []).filter((o) => o.special && o.nationId === 'ai1').length;
    if (offers) break;
  }
  assert.ok(offers > 0, '20일 안에 한 번은 온다');
  const o = w.offers.find((x) => x.special && x.nationId === 'ai1');
  assert.equal(o.resource, 'steel');
  assert.ok(o.special.adj < 0, '할인이다');
});

test('국가 이벤트 — 7장 전에는 침묵하고, 조건이 맞으면 statRng 로 발화한다', () => {
  const w = world0();
  w.nations.ai1.resources.grain = 5;
  for (let t = 1; t <= 60; t += 1) { w.tick = t; dailyRelations(w, data, []); }
  assert.ok(!(w.natEvState?.fired && Object.keys(w.natEvState.fired).length), '1장 — 세계는 아직 조용하다');
  P(w).progress = { chapter: 10, step: 0, cleared: [], flags: {} };
  let fired = null;
  for (let t = 61; t <= 200 && !fired; t += 1) {
    w.tick = t;
    const evs = dailyRelations(w, data, []);
    fired = evs.find((e) => e.kind === 'nation_event' && e.data.id === 'cheongmyeong_famine_plea') || null;
  }
  assert.ok(fired, '청명의 기근이 140일 안에 온다(statRng 0.1)');
  const plea = (w.offers || []).find((o) => o.special && o.nationId === 'ai1' && o.side === 'sell');
  assert.ok(plea, '도움 요청은 웃돈 매입 제안으로 온다');
  assert.ok(plea.special.relBonus >= 10, '응하면 신의가 크게 오른다');
});

test('성녀 예고 — 자리가 채워져 있으면 하루 전 예감이 먼저 온다', () => {
  const w = world0(43);
  P(w).progress = { chapter: 10, step: 0, cleared: [], flags: {} };
  P(w).roles.saint.holder = 'npc';
  w.nations.ai2.resources.grain = 5;
  let omen = null;
  for (let t = 1; t <= 200 && !omen; t += 1) {
    w.tick = t;
    const evs = dailyRelations(w, data, []);
    omen = evs.find((e) => e.kind === 'nation_omen') || null;
  }
  assert.ok(omen, '예감이 먼저 온다');
  w.tick += 1;
  const evs = dailyRelations(w, data, []);
  assert.ok(evs.some((e) => e.kind === 'nation_event' && e.data.id === omen.data.id), '다음 날 그 일이 온다');
});

test('결정론 — dailyRelations 는 세계 난수를 한 톨도 축내지 않는다', () => {
  const w = world0();
  P(w).progress = { chapter: 10, step: 0, cleared: [], flags: {} };
  const rngState = w.rngState;
  for (let t = 1; t <= 30; t += 1) { w.tick = t; dailyRelations(w, data, []); }
  assert.equal(w.rngState, rngState, '세계 난수 상태 불변');
});

test('호칭 — 에르니아는 성장을, 청명·엘라시아는 게이지를 본다', () => {
  const w = world0();
  assert.equal(relationTitle(w, P(w), 'ai3', data), relCfg(data, 'ai3').titles.early);
  P(w).tier = 4;
  assert.ok(relationTitle(w, P(w), 'ai3', data).includes(P(w).name), '신흥국 {name}');
  w.endingDone = 5;
  assert.ok(relationTitle(w, P(w), 'ai3', data).includes('군주'));
  assert.equal(relationTitle(w, P(w), 'ai1', data), relCfg(data, 'ai1').titles.base);
  addRel(w, P(w), 'ai1', 40, data);
  assert.equal(relationTitle(w, P(w), 'ai1', data), relCfg(data, 'ai1').titles.bond);
});

test('엔딩 게이트 승격 — 재회 게이지가 문턱이고, 옛 세이브는 누계에서 이관된다', () => {
  const cfg = endingCfg(data);
  const w = world0();
  const p = P(w);
  p.tier = cfg.tierMin;
  p.wave = { history: [{ type: 'dragon', won: true }] };
  assert.equal(endingState(w, p, data).met, false, '게이지 0 — 아직');
  (p.relations ||= {}).ai3 = cfg.reunionScoreMin;
  assert.equal(endingState(w, p, data).met, true, '게이지 임계 — 초대장 조건');
  // 옛 세이브 이관: relations 가 없고 거래 누계만 있으면 migratePerGold 로 근사된다
  const w2 = world0(44);
  const p2 = P(w2);
  p2.tier = cfg.tierMin;
  p2.wave = { history: [{ type: 'dragon', won: true }] };
  (p2.stats ||= {}).tradeGoldWith = { ai3: cfg.tradeGoldMin };
  relationsOf(w2, p2, data);
  assert.ok(p2.relations.ai3 >= cfg.reunionScoreMin, `이관 근사 ${p2.relations.ai3} ≥ ${cfg.reunionScoreMin}`);
  assert.equal(endingState(w2, p2, data).met, true, 'W3 조건을 채운 옛 세이브는 후퇴하지 않는다');
});

test('외교 페이로드 — 점수·호칭·다음 문턱', () => {
  const w = world0();
  addRel(w, P(w), 'ai1', 20, data);
  const v = relationView(w, P(w), data, 'ai1');
  assert.equal(v.score, 20);
  assert.equal(v.title, relCfg(data, 'ai1').titles.opened);
  assert.equal(v.nextAt, relCfg(data, 'ai1').thresholds.bond);
});
