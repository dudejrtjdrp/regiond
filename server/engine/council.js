// 어전 회의 — 지표 요약 + 결정 큐 + 안건 + 유물 판정
import { rollArtifactDrop, grantArtifact } from './artifacts.js';
import { round2 } from './economy.js';
import { roleSummary } from './npc.js';

export function isCouncilTick(tick, data) {
  const every = data.balance.time.councilEveryTicks;
  return tick > 0 && tick % every === 0;
}

export function openCouncil(world, nation, data, rng) {
  const councilId = `c_${nation.id}_${world.tick}`;
  const activity = Object.fromEntries(
    Object.entries(nation.roles).map(([k, r]) => [k, r.activity || 0]),
  );
  const drop = rollArtifactDrop(nation, data, rng, activity);
  let artifactDrop = null;
  if (drop.opened && drop.artifact) {
    const bound = pickBoundNation(world, rng);
    grantArtifact(nation, drop.artifact, world.tick, data, { boundNationId: bound });
    const def = data.artifactsByKey[drop.artifact];
    artifactDrop = { key: def.key, name: def.name, grade: def.grade, desc: def.desc };
  } else if (drop.opened) {
    artifactDrop = { key: null, name: null, grade: drop.grade, desc: '상자는 비어 있었습니다.' };
  }

  const council = {
    councilId,
    tick: world.tick,
    nationId: nation.id,
    summary: {
      population: Math.round(nation.population),
      populationCap: nation.populationCap,
      morale: round2(nation.morale),
      gold: round2(nation.gold),
      resources: Object.fromEntries(Object.entries(nation.resources).map(([k, v]) => [k, round2(v)])),
      defense: { permanent: round2(nation.defense.permanent), surge: round2(nation.defense.surge) },
      roles: roleSummary(nation, data),
    },
    decisions: nation.decisionQueue.map((d) => ({ ...d })),
    agenda: buildAgenda(world, nation, data),
    artifactDrop,
    acked: false,
  };
  // 역할 활동 카운터 리셋
  for (const r of Object.values(nation.roles)) r.activity = 0;
  return council;
}

function pickBoundNation(world, rng) {
  const ids = Object.values(world.nations).filter((n) => !n.isPlayer).map((n) => n.id);
  return ids.length ? rng.pick(ids) : null;
}

function buildAgenda(world, nation, data) {
  const items = [];
  const next = nation.invasion?.nextType;
  if (next) {
    const spec = data.invasions.schedule.find((s) => s.type === next);
    items.push({
      kind: 'invasion',
      text: nation.invasion.isDatePrecise
        ? `${spec.name} 침공 D-${nation.invasion.arrivalTick - world.tick}. 방어 준비를 점검합니다.`
        : `${spec.name}으로 추정되는 침공이 다가옵니다. 정확한 날짜는 알 수 없습니다.`,
    });
  }
  const lowGrain = nation.resources.grain < nation.population * data.balance.population.grainPerCapita * 3;
  if (lowGrain) items.push({ kind: 'budget', text: '곡물 비축이 3일치 미만입니다. 수입 또는 농정 증원이 필요합니다.' });
  if (nation.gold <= 0) items.push({ kind: 'budget', text: '국고가 비었습니다. 전 부처 산출에 페널티가 걸립니다.' });
  if (!items.length) items.push({ kind: 'budget', text: '특별한 안건이 없습니다. 다음 주 예산을 배분합니다.' });
  return items;
}

export function enqueueDecision(nation, decision) {
  nation.decisionQueue.push(decision);
  return decision;
}
