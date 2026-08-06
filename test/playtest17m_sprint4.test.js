// Sprint 4 — 경제·진행 재설계 회귀.
//
// 이 파일이 붙드는 문장 넷:
//   ① 주거는 규모의 경제다 — 침상이 많을수록 누적 침상당 비용이 싸진다(체인 안에서 단조 하락),
//      2침상 누적 < 1침상의 2배, 오두막 4침상 누적 = 급 기준(T1 침상당)의 3.5배
//   ② 주민 채집은 3티어 매크로(기준 배치에서 벌목공 1인당 13.5/일) **아래에서 이어진다** —
//      상향해도 절벽을 만들지 않는다(플레이어보다는 낮다는 계약 포함)
//   ③ 영토 곡선: 초반 조금 → 중반 극적 → 6티어부터 완만, 그리고 「기술이 땅을 넓힌다」(도시 계획)
//   ④ 새 연구 갈래: 농정술·석공술은 선행 없는 병렬 선택지고, 채집 보정은
//      티어 0~2(residentYield)와 3티어+(매크로)에 **같은 값**이 붙는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from '../server/engine/data.js';
import { createWorld } from '../server/engine/state.js';
import { territoryRadius } from '../server/engine/world.js';
import { settlementGatherFactor } from '../server/engine/residents.js';
import { gatherResearchBonus, productionBonus } from '../server/engine/research.js';

const data = loadGameData();

const rawSum = (cost) => Object.values(cost).reduce((a, b) => a + b, 0);
const chain = (key) => data.buildings[key].tiers;

/** 체인 누적 비용/침상 — 티어 t 까지 올린 총비용 ÷ 그 시점 침상 수 */
function cumulativePerBed(key) {
  const tiers = chain(key);
  const out = [];
  let cum = 0;
  for (const t of tiers) {
    cum += rawSum(t.cost);
    out.push({ beds: t.residents, cum, perBed: cum / t.residents });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// ① 주거 — 규모의 경제
// ────────────────────────────────────────────────────────────────
test('Sprint4 ① 주거 체인마다 누적 침상당 비용이 단조 하락한다', () => {
  for (const key of ['tent', 'hut', 'house', 'manor']) {
    const steps = cumulativePerBed(key);
    for (let i = 1; i < steps.length; i += 1) {
      assert.ok(steps[i].perBed < steps[i - 1].perBed + 1e-9,
        `${key}: 침상당 ${steps[i - 1].perBed.toFixed(1)} → ${steps[i].perBed.toFixed(1)} — 커질수록 싸져야 한다`);
    }
  }
});

test('Sprint4 ① 2침상 누적 < 1침상×2, 오두막 4침상 누적 = 급 기준의 3.5배(±3%)', () => {
  const tent = cumulativePerBed('tent');
  const oneBed = tent[0].cum;                       // 천막 T1 = 10 (나무 한 그루 계약)
  assert.ok(tent[1].cum < oneBed * 2, `2침상 누적 ${tent[1].cum} ≥ 1침상의 2배`);
  const hut = cumulativePerBed('hut');
  const classBase = hut[0].perBed;                  // 오두막 급의 침상당 기준(T1)
  const four = hut[hut.length - 1];
  assert.equal(four.beds, 4, '오두막 끝은 4침상이다(침상 수는 불변 계약)');
  const ratio = four.cum / classBase;
  assert.ok(Math.abs(ratio - 3.5) <= 3.5 * 0.03,
    `4인 건물 누적 ${four.cum} = 기준의 ${ratio.toFixed(2)}배 — 3.5배(유저 결정)여야 한다`);
});

// ────────────────────────────────────────────────────────────────
// ② 채집 — 절벽 없는 상향
// ────────────────────────────────────────────────────────────────
test('Sprint4 ② 상향된 주민 채집이 3티어 매크로 아래에서 이어진다(절벽 금지)', () => {
  const per = data.balance.residents.gather.perResidentPerDay;
  /* 기준 배치에서의 3티어+ 벌목공 1인당 산출 = gatherPerCapita ÷ referenceMix */
  const ref = data.world.laborDerivation.referenceMix;
  const perLumberT3 = data.balance.production.gatherPerCapita.wood / ref.lumber;
  const perQuarryT3 = data.balance.production.gatherPerCapita.stone / ref.quarry;
  assert.ok(per.wood < perLumberT3, `목재 ${per.wood} ≥ 매크로 ${perLumberT3.toFixed(1)} — 위로 뚫으면 3티어에 역절벽`);
  assert.ok(per.wood >= perLumberT3 * 0.6, `목재 ${per.wood} — 매크로의 60% 아래면 여전히 절벽(옛 3.2 가 그랬다)`);
  assert.ok(per.stone < perQuarryT3 && per.stone >= perQuarryT3 * 0.4,
    `석재 ${per.stone} 이 매크로 ${perQuarryT3.toFixed(1)} 아래에서 이어져야 한다`);
});

test('Sprint4 ② 주민은 여전히 플레이어보다 한참 아래다(유저 계약: 적긴 하되 지금보다 높게)', () => {
  const per = data.balance.residents.gather.perResidentPerDay;
  const forest = data.skills.nodes.forest;
  const effPerSwing = (forest.yield.wood * forest.swings + (forest.cycleBonus?.wood ?? 0)) / forest.swings;
  const humanDay = effPerSwing * (data.world.simulation?.botPlayerSwingsPerDay ?? 90);
  assert.ok(per.wood * 8 < humanDay, `주민×8(${per.wood * 8}) ≥ 현실 플레이어 하루(${humanDay}) — 너무 올렸다`);
  assert.ok(per.wood >= 3.2 * 2, '옛 값(3.2)의 2배는 넘어야 「지금보다 훨씬 높게」다');
});

// ────────────────────────────────────────────────────────────────
// ③ 영토 곡선
// ────────────────────────────────────────────────────────────────
test('Sprint4 ③ 증가폭이 초반 조금 → 중반 극적 → 후반 완만이다', () => {
  const r = data.tiers.levels.map((l) => l.radius);
  const d = r.slice(1).map((v, i) => v - r[i]);
  /* [3,5,7,9,12,4] — 5티어까지 단조 증가, 6티어에서 꺾인다 */
  for (let i = 1; i < 5; i += 1) assert.ok(d[i] > d[i - 1], `증가폭 ${d.join(',')} — 4→5까지는 계속 커져야 한다`);
  assert.ok(d[5] < d[4], '5→6부터는 완만해진다');
  assert.ok((data.tiers.endless.radiusPerTier ?? 0) < d[5] + 1, '엔드리스는 더 완만하다');
});

test('Sprint4 ③ 기술이 땅을 넓힌다 — 도시 계획 territoryBonus 가 반경에 붙는다', () => {
  const world = createWorld({ seed: 3, data, playerName: '테스트' });
  const nation = world.nations.player;
  nation.tier = 6;
  const base = territoryRadius(nation, data);
  (nation.research ||= {}).done = { city_planning: 1 };
  const after = territoryRadius(nation, data);
  assert.equal(after - base, data.research.defs.city_planning.effects.territoryBonus,
    '도시 계획을 마치면 그만큼 넓어진다');
  nation.tier = 8;                                   // 엔드리스(표 밖)에서도 붙는다
  const withTech = territoryRadius(nation, data);
  nation.research.done = {};
  const withoutTech = territoryRadius(nation, data);
  assert.equal(withTech - withoutTech, data.research.defs.city_planning.effects.territoryBonus,
    '엔드리스 반경에도 기술 보너스가 붙는다');
});

// ────────────────────────────────────────────────────────────────
// ④ 연구 갈래
// ────────────────────────────────────────────────────────────────
test('Sprint4 ④ 농정술·석공술은 선행 없는 병렬 선택지다', () => {
  assert.deepEqual(data.research.defs.agronomy.requires, []);
  assert.deepEqual(data.research.defs.masonry.requires, []);
  assert.equal(data.research.defs.agronomy.requiresTier, data.research.defs.masonry.requiresTier,
    '같은 문턱에서 갈래가 갈린다 — 어느 쪽을 먼저 붙들지는 선택이다');
});

test('Sprint4 ④ 채집 보정이 형편 배수와 매크로에 같은 값으로 붙는다', () => {
  const world = createWorld({ seed: 5, data, playerName: '테스트' });
  const nation = world.nations.player;
  const before = settlementGatherFactor(nation, data, 'grain');
  (nation.research ||= {}).done = { agronomy: 1 };
  const bonus = gatherResearchBonus(nation, data, 'grain');
  assert.equal(bonus, data.research.defs.agronomy.effects.gatherBonus.grain);
  const after = settlementGatherFactor(nation, data, 'grain');
  assert.ok(Math.abs(after / before - (1 + bonus)) < 0.01,
    `형편 배수가 ${before} → ${after} — (1+${bonus}) 배여야 한다`);
  assert.equal(gatherResearchBonus(nation, data, 'stone'), 0, '농정술은 곡물만 본다');
});

test('Sprint4 ④ 내연기관은 증기기관과 합산된다(7티어+의 목표)', () => {
  const world = createWorld({ seed: 5, data, playerName: '테스트' });
  const nation = world.nations.player;
  (nation.research ||= {}).done = { steam_engine: 1, internal_combustion: 1 };
  const sum = data.research.defs.steam_engine.effects.productionBonus
    + data.research.defs.internal_combustion.effects.productionBonus;
  assert.equal(productionBonus(nation, data), sum);
  assert.equal(data.research.defs.internal_combustion.requiresTier, 7, '엔드리스의 첫 목표다');
});
