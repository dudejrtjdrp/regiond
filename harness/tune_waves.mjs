#!/usr/bin/env node
/**
 * 웨이브 곡선 조율기 (개발 전용 · npm 스크립트에는 없다).
 *
 * ★ 왜 필요했나 — 진행 감독(GDD3 §11) 이후 웨이브는 '티어 2'가 아니라 **7장(낯선 발자국)**에서 시작한다.
 *   같은 웨이브 번호가 예전보다 훨씬 자란 정착지 위에 떨어지므로, 옛 basePower·growth 로는
 *   시뮬 체크포인트(웨이브5 생존율 60~80%)가 95% 로 새어 나간다.
 *   값을 하나씩 손으로 넣고 20회씩 돌리는 대신, 여기서 후보를 쓸어 보고 근거를 남긴다.
 *
 * 사용: node harness/tune_waves.mjs --runs 8 [--seed 42]
 *       node harness/tune_waves.mjs --set 245,1.18,5,0.5     (한 조합만)
 */
import { loadGameData } from '../server/engine/data.js';
import { runGame, aggregate } from '../server/sim/run.js';

function parse(argv) {
  const out = { runs: 8, seed: 42, days: null, set: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runs') out.runs = Number(argv[++i]);
    else if (argv[i] === '--seed') out.seed = Number(argv[++i]);
    else if (argv[i] === '--days') out.days = Number(argv[++i]);
    else if (argv[i] === '--set') out.set = argv[++i].split(',').map(Number);
  }
  return out;
}

const CANDIDATES = [
  // [basePower, growth, rampWaves, rampFrom]
  [560, 1.07, 5, 0.42],
  [700, 1.06, 5, 0.38],
];

function measure(data, runs, seed, days) {
  const withSaint = [];
  const noSaint = [];
  for (let i = 0; i < runs; i += 1) {
    withSaint.push(runGame({ seed: seed + i, data, withSaint: true, days }));
    noSaint.push(runGame({ seed: seed + i, data, withSaint: false, days }));
  }
  const a = aggregate(withSaint, data);
  const b = aggregate(noSaint, data);
  const w = (agg, n) => agg.waves[String(n)]?.survival ?? null;
  return {
    tier3: a.tier3MedianDays,
    famine: a.famineRate,
    w1: w(a, 1), w3: w(a, 3), w5: w(a, 5), w8: w(a, 8), w10: w(a, 10), w12: w(a, 12),
    gap8: w(a, 8) != null && w(b, 8) != null ? w(a, 8) - w(b, 8) : null,
    faced: a.wavesFaced,
    power5: a.waves['5']?.meanPower ?? null,
  };
}

const pct = (v) => (v == null ? '  —  ' : `${(v * 100).toFixed(0)}%`.padStart(5));

function main() {
  const args = parse(process.argv.slice(2));
  const list = args.set ? [args.set] : CANDIDATES;
  console.log(`웨이브 곡선 조율 — ${args.runs}회 × (성녀 유/무), seed ${args.seed}`);
  console.log('base  growth ramp     | 티어3  w1    w3    w5    w8    w10   w12   격차8  겪은수  w5파워');
  for (const [base, growth, rw, rf] of list) {
    const data = loadGameData({ reload: true });
    data.waves.basePower = base;
    data.waves.growth = growth;
    data.waves.earlyRamp = { waves: rw, from: rf };
    const m = measure(data, args.runs, args.seed, args.days);
    console.log(
      `${String(base).padStart(4)}  ${growth.toFixed(2)}   ${rw}@${rf.toFixed(2)} |`
      + ` ${String(m.tier3 ?? '—').padStart(4)}일`
      + ` ${pct(m.w1)} ${pct(m.w3)} ${pct(m.w5)} ${pct(m.w8)} ${pct(m.w10)} ${pct(m.w12)}`
      + ` ${m.gap8 == null ? '  —  ' : `${(m.gap8 * 100).toFixed(0)}%p`.padStart(5)}`
      + ` ${m.faced.toFixed(1)}회  ${m.power5 == null ? '—' : Math.round(m.power5)}`,
    );
  }
}

main();
