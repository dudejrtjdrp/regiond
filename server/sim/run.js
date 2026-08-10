#!/usr/bin/env node
// 무접속 엔드리스 시뮬레이터 — 엔진 step() 과 실제 명령 경로를 그대로 재사용한다.
// ★ GDD3 §10 신규 체크포인트
//   ① 티어3 도달 중앙값 25~40게임일  ② 웨이브5 생존율(권장 방어) 60~80%
//   ③ 식량 파산율 <5%                ④ 성녀 유무 웨이브8 격차 ≥20%p
// 사용: node server/sim/run.js --runs 120 --seed 42 [--days 60] [--json out.json] [--quiet]
import { loadGameData } from '../engine/data.js';
import { createWorld } from '../engine/state.js';
import { createRng } from '../engine/rng.js';
import { step } from '../engine/tick.js';
import { planCommands, botSwings } from './policy.js';
import { settlementTier } from '../engine/tiers.js';
import { aliveFences } from '../engine/fences.js';
import { turretList } from '../engine/structures.js';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { runs: null, seed: 42, days: null, json: null, quiet: false, saintCompare: true,
                difficultyCheck: true, difficultyRunRatio: 0.25, workers: null, shard: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--runs') out.runs = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--no-saint-compare') out.saintCompare = false;
    else if (a === '--no-difficulty-check') out.difficultyCheck = false;
    else if (a === '--workers') out.workers = Number(argv[++i]);
    else if (a === '--shard') out.shard = argv[++i];      // 내부용 — 아래 runShards 가 쓴다
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// 병렬 — 한 판은 씨앗 하나로 완결되므로 판을 코어에 나눠 담아도 결과가 같다
//
// 왜 필요한가: 20판 × 성녀 유무 = 40판이 한 코어로는 1분을 넘긴다. CI 와 검수에서
// 매번 그만큼 기다릴 이유가 없다. 판을 나눠 돌리고 부모가 합치면 **결과는 한 톨도 다르지 않다**
// (runGame 은 씨앗만 보고, 판끼리 아무것도 공유하지 않는다).
// ────────────────────────────────────────────────────────────────
/** 자식이 뱉는 결과를 감싸는 표식 — 엔진이 흘릴 수 있는 잡소리와 섞이지 않게 */
const SHARD_MARK = '\u0001SIM\u0001';

/** 자식 프로세스 한 몫 — 씨앗 목록을 받아 결과를 JSON 한 줄로 뱉는다 */
function runShardChild(spec, data) {
  const out = spec.seeds.map((seed) => runGame({ seed, data, withSaint: spec.withSaint, days: spec.days }));
  process.stdout.write(SHARD_MARK + JSON.stringify(out) + SHARD_MARK);
}

/** 부모 몫 — 씨앗을 workers 개로 나눠 자식에게 맡기고 순서대로 이어 붙인다 */
async function runShards(seeds, { data, withSaint, days, workers }) {
  if (workers <= 1 || seeds.length <= 1) {
    return seeds.map((seed) => runGame({ seed, data, withSaint, days }));
  }
  const buckets = Array.from({ length: Math.min(workers, seeds.length) }, () => []);
  seeds.forEach((s, i) => buckets[i % buckets.length].push(s));
  const parts = await Promise.all(buckets.map((bucket) => new Promise((resolve, reject) => {
    const spec = JSON.stringify({ seeds: bucket, withSaint, days });
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--shard', spec],
      { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const m = buf.split(SHARD_MARK);
      if (code !== 0 || m.length < 3) { reject(new Error(`시뮬 일꾼이 실패했습니다 (code ${code})`)); return; }
      try { resolve(JSON.parse(m[1])); } catch (e) { reject(e); }
    });
  })));
  /* 씨앗을 돌려 담았으니 되돌려 담아 원래 차례를 지킨다 — 보고서의 표본 순서가 흔들리지 않게 */
  const out = new Array(seeds.length);
  buckets.forEach((bucket, b) => bucket.forEach((_, i) => { out[i * buckets.length + b] = parts[b][i]; }));
  return out;
}

/** 감정의 날(티어 3) 직후의 관제 — 성녀 유무를 실험 변수로 둔다 */
function applyMandate(world, data, withSaint) {
  const nation = world.nations.player;
  for (const key of data.roles.order) {
    const role = nation.roles[key];
    if (key === 'saint') role.holder = withSaint ? 'npc' : null;
    else if (key === 'trade') role.holder = withSaint ? null : 'npc';
    else role.holder = 'npc';
    if (role.holder && !role.name) role.name = data.roles.defs[key].name;
  }
  nation.mandateDone = true;
  world.mandateOpen = false;
}

/**
 * 한 판을 days 게임일까지 돌린다.
 * 봇은 매일 (a) 플레이어 스윙 노동 (b) 배치·건설·울타리·수리·작전 명령을 낸다.
 */
export function runGame({ seed, data, withSaint = true, difficulty = data.difficulty.default, days = null }) {
  const total = days ?? data.balance.simulation.days;
  const rng = createRng(seed);
  let world = createWorld({ seed, data, playerName: '시뮬', difficulty });
  const sim = data.waves.simulation;
  const virtualPlayers = Array.from({ length: sim.botPlayerCount }, (_, i) => ({ id: `sim${i}`, dps: sim.botPlayerDps }));

  const m = {
    seed, withSaint, difficulty,
    tier3Day: null, tierFinal: 0,
    famine: false, famineDays: 0,
    waves: [],
    population: 0, peakPopulation: 0,
    structures: 0, fences: 0, turrets: 0,
    gold: 0, days: total,
  };
  let mandateApplied = false;

  for (let d = 0; d < total; d += 1) {
    const nation = world.nations.player;
    botSwings(world, nation, data, rng);
    const cmds = planCommands(world, data).map((cmd) => ({ nationId: 'player', cmd }));
    const { state, events } = step(world, cmds, rng, data, { virtualPlayers });
    world = state;

    for (const e of events) {
      if (e.kind === 'starvation') { m.famine = true; m.famineDays += 1; }
      if (e.kind === 'wave_held' || e.kind === 'wave_breached') {
        m.waves.push({
          index: e.data.index, number: e.data.number, type: e.data.type,
          won: e.data.won, killed: e.data.enemiesKilled, total: e.data.enemiesTotal,
          duration: e.data.duration, power: e.data.power,
        });
      }
    }
    const p = world.nations.player;
    if (m.tier3Day == null && settlementTier(p) >= 3) m.tier3Day = world.tick;
    if (!mandateApplied && world.emotionDayDone) { applyMandate(world, data, withSaint); mandateApplied = true; }
  }

  const p = world.nations.player;
  m.tierFinal = settlementTier(p);
  m.population = Math.floor(p.population);
  m.peakPopulation = p.stats.peakPopulation || m.population;
  m.structures = (p.structures || []).length;
  m.fences = aliveFences(p).length;
  m.turrets = turretList(p, data).length;
  m.gold = Math.round(p.gold);
  m.residentsArrived = p.stats.residentsArrived || 0;
  m.skills = Object.fromEntries(Object.entries(p.players?.sim?.skills || {}).map(([k, v]) => [k, v.level]));
  return m;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function median(xs) {
  const s = xs.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

/** 웨이브 번호별 생존율 (number 는 1부터) */
export function waveSurvival(runs, number) {
  const rows = runs.map((r) => r.waves.find((w) => w.number === number)).filter(Boolean);
  if (!rows.length) return { rate: null, samples: 0 };
  return { rate: rows.filter((w) => w.won).length / rows.length, samples: rows.length };
}

export function aggregate(runs, data) {
  const tier3 = runs.map((r) => r.tier3Day).filter((v) => v != null);
  const byWave = {};
  for (const r of runs) {
    for (const w of r.waves) {
      (byWave[w.number] ||= { n: 0, won: 0, type: w.type, power: [], duration: [] });
      byWave[w.number].n += 1;
      if (w.won) byWave[w.number].won += 1;
      byWave[w.number].power.push(w.power);
      byWave[w.number].duration.push(w.duration);
    }
  }
  return {
    runs: runs.length,
    tier3MedianDays: median(runs.map((r) => r.tier3Day ?? Infinity)),
    tier3Reached: tier3.length / Math.max(1, runs.length),
    tier3MeanDays: mean(tier3),
    tierFinal: mean(runs.map((r) => r.tierFinal)),
    famineRate: runs.filter((r) => r.famine).length / Math.max(1, runs.length),
    population: mean(runs.map((r) => r.population)),
    peakPopulation: mean(runs.map((r) => r.peakPopulation)),
    structures: mean(runs.map((r) => r.structures)),
    fences: mean(runs.map((r) => r.fences)),
    turrets: mean(runs.map((r) => r.turrets)),
    gold: mean(runs.map((r) => r.gold)),
    residentsArrived: mean(runs.map((r) => r.residentsArrived ?? 0)),
    wavesFaced: mean(runs.map((r) => r.waves.length)),
    waves: Object.fromEntries(Object.entries(byWave).map(([k, v]) => [k, {
      type: v.type, samples: v.n, survival: v.won / v.n,
      meanPower: mean(v.power), meanDuration: mean(v.duration),
    }])),
  };
}

export function checkpointReport(agg, aggNoSaint, data) {
  const cp = data.balance.simulation.checkpoints;
  const rows = [];
  const inRange = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

  const t3 = agg.tier3MedianDays;
  rows.push(['티어3 도달 중앙값', t3 == null || !Number.isFinite(t3) ? '미달' : `${t3}일`,
    `${cp.tier3MedianDays[0]}~${cp.tier3MedianDays[1]}일`, inRange(t3, cp.tier3MedianDays)]);

  const w5 = agg.waves['5']?.survival ?? null;
  rows.push(['웨이브5 생존율', pct(w5), `${pct(cp.wave5SurvivalRate[0])}~${pct(cp.wave5SurvivalRate[1])}`,
    inRange(w5, cp.wave5SurvivalRate)]);

  rows.push(['식량 파산율', pct(agg.famineRate), `<${pct(cp.famineRateMax)}`, agg.famineRate < cp.famineRateMax]);

  if (aggNoSaint) {
    const a = agg.waves['8']?.survival ?? null;
    const b = aggNoSaint.waves['8']?.survival ?? null;
    const gap = a != null && b != null ? a - b : null;
    rows.push(['성녀 유무 웨이브8 격차', gap == null ? '—' : `${(gap * 100).toFixed(1)}%p`,
      `≥${pct(cp.saintWave8GapMin)}p`, gap != null && gap >= cp.saintWave8GapMin]);
  }
  return rows;
}

/** 난이도 방향성 — 체크포인트는 '왕국' 기준이고, 여기서는 웨이브 생존율의 순서만 본다 */
export function difficultyDirection(data, { runs, seed, days }) {
  const out = [];
  for (const key of data.difficulty.order) {
    const games = [];
    for (let i = 0; i < runs; i += 1) games.push(runGame({ seed: seed + i, data, withSaint: true, difficulty: key, days }));
    const agg = aggregate(games, data);
    out.push({
      key, name: data.difficulty.presets[key].name,
      wave5: agg.waves['5']?.survival ?? null,
      wave8: agg.waves['8']?.survival ?? null,
      tier3: agg.tier3MedianDays,
      population: agg.population,
    });
  }
  const w = out.map((r) => r.wave5 ?? 0);
  return { rows: out, ordered: w[0] >= w[1] && w[1] >= w[2] };
}

export async function main(argv) {
  const args = parseArgs(argv);
  const data = loadGameData();

  /* 자식으로 불렸다면 제 몫만 돌리고 결과를 뱉고 끝낸다 */
  if (args.shard) { runShardChild(JSON.parse(args.shard), data); return null; }

  const runs = args.runs ?? data.balance.simulation.defaultRuns;
  const days = args.days ?? data.balance.simulation.days;
  const workers = args.workers ?? Math.max(1, Math.min(availableParallelism?.() ?? 1, 8));

  const seeds = Array.from({ length: runs }, (_, i) => args.seed + i);
  const withSaint = await runShards(seeds, { data, withSaint: true, days, workers });
  const noSaint = args.saintCompare
    ? await runShards(seeds, { data, withSaint: false, days, workers })
    : [];
  const agg = aggregate(withSaint, data);
  const aggNo = args.saintCompare ? aggregate(noSaint, data) : null;
  const rows = checkpointReport(agg, aggNo, data);
  const passed = rows.filter((r) => r[3]).length;
  const direction = args.difficultyCheck
    ? difficultyDirection(data, { runs: Math.max(1, Math.round(runs * args.difficultyRunRatio)), seed: args.seed, days })
    : null;

  if (!args.quiet) {
    console.log(`\n=== Regiond 엔드리스 시뮬레이션 (${runs}회 × ${days}게임일, seed ${args.seed}) ===\n`);
    console.log('[체크포인트]');
    const w = [24, 12, 16, 6];
    console.log(`${'항목'.padEnd(w[0])}${'측정'.padStart(w[1])}${'목표'.padStart(w[2])}${'판정'.padStart(w[3])}`);
    for (const [name, v, target, ok] of rows) {
      console.log(`${name.padEnd(w[0])}${String(v).padStart(w[1])}${String(target).padStart(w[2])}${(ok ? 'PASS' : 'MISS').padStart(w[3])}`);
    }
    console.log(`\n판정: ${passed}/${rows.length} 통과`);

    console.log('\n[웨이브 상세 — 성녀 있음]');
    for (const [num, v] of Object.entries(agg.waves)) {
      console.log(`  제${String(num).padStart(2)}차 ${String(v.type).padEnd(8)} 생존율 ${pct(v.survival)}  파워 ${v.meanPower.toFixed(0)}  전투 ${v.meanDuration.toFixed(1)}초  (n=${v.samples})`);
    }
    if (aggNo) {
      console.log('\n[웨이브 상세 — 성녀 없음]');
      for (const [num, v] of Object.entries(aggNo.waves)) {
        console.log(`  제${String(num).padStart(2)}차 ${String(v.type).padEnd(8)} 생존율 ${pct(v.survival)}  (n=${v.samples})`);
      }
    }
    if (direction) {
      console.log('\n[난이도 방향성 — 체크포인트는 왕국 기준, 여기는 방향만 본다]');
      for (const r of direction.rows) {
        console.log(`  ${r.name.padEnd(4)} 웨이브5 ${pct(r.wave5)} · 웨이브8 ${pct(r.wave8)} · 티어3 중앙 ${r.tier3 ?? '—'}일 · 인구 ${r.population.toFixed(1)}`);
      }
      console.log(`  방향성(이야기 ≥ 왕국 ≥ 시련): ${direction.ordered ? 'OK' : 'MISS'}`);
    }

    console.log('\n[정착지 지표]');
    console.log(`  티어3 도달률 ${pct(agg.tier3Reached)} · 평균 ${agg.tier3MeanDays.toFixed(1)}일 · 최종 티어 평균 ${agg.tierFinal.toFixed(2)}`);
    console.log(`  인구 평균 ${agg.population.toFixed(1)} (최고 ${agg.peakPopulation.toFixed(1)}) · 도착 주민 ${agg.residentsArrived.toFixed(1)}명`);
    console.log(`  건물 ${agg.structures.toFixed(1)}채 · 울타리 ${agg.fences.toFixed(1)}조각 · 터렛 ${agg.turrets.toFixed(1)}기 · 골드 ${agg.gold.toFixed(0)}`);
    console.log(`  겪은 웨이브 평균 ${agg.wavesFaced.toFixed(1)}회 · 식량 파산 ${pct(agg.famineRate)}\n`);
  }

  const report = {
    args: { runs, seed: args.seed, days },
    checkpoints: rows.map(([name, value, target, ok]) => ({ name, value, target, ok })),
    withSaint: agg, noSaint: aggNo, difficulty: direction,
  };
  if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
