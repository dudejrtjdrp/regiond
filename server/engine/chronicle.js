// 연대기 — docs/GDD3.md §5. 시즌 결산·랭킹을 대신하는 누적 기록.
// 끝이 없는 게임에는 결산이 없다. 대신 "무슨 일이 있었는가"가 쌓인다.
import { settlementTier, tierName } from './tiers.js';
import { round2 } from './economy.js';

export const chronicleCfg = (data) => data.balance.chronicle;

/** 한 줄 기록. kind 는 클라의 아이콘·분류에 쓰인다. */
export function record(world, entry, data) {
  const log = (world.chronicle ||= []);
  const row = {
    id: `k${(world.chronicleSeq = (world.chronicleSeq || 0) + 1)}`,
    tick: world.tick,
    kind: entry.kind,
    title: entry.title ?? null,
    text: entry.text ?? null,
    data: entry.data ?? null,
  };
  log.push(row);
  const max = chronicleCfg(data).maxEntries;
  if (log.length > max) log.splice(0, log.length - max);
  return row;
}

export const MILESTONES = {
  tier_up: '성장',
  first_resident: '사람',
  wave: '침공',
  building: '건설',
  emotion_day: '감정의 날',
  skill: '숙련',
  artifact: '유물',
  disaster: '재난',
  // ★ §17-17 — 새 땅(설산·밀림)을 처음 밟은 날. 탐험도 정착지의 역사다.
  discovery: '발견',
};

/** 연대기 화면 — 최근 기록 + 누적 지표 */
export function chronicleView(world, nation, data) {
  const log = world.chronicle || [];
  const recent = log.slice(-chronicleCfg(data).recentForView).reverse();
  const counts = {};
  for (const e of log) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const waves = (nation.wave?.history || []);
  return {
    day: world.tick,
    tier: settlementTier(nation),
    tierName: tierName(settlementTier(nation), data),
    entries: recent,
    counts,
    totals: {
      days: world.tick,
      population: Math.floor(nation.population || 0),
      peakPopulation: nation.stats?.peakPopulation ?? Math.floor(nation.population || 0),
      structures: (nation.structures || []).length,
      fences: (nation.fences || []).length,
      wavesFaced: waves.length,
      wavesHeld: waves.filter((w) => w.won).length,
      gold: round2(nation.gold || 0),
      artifacts: (nation.artifacts || []).length,
      prestige: nation.prestige ?? 0,
    },
    milestones: MILESTONES,
  };
}
