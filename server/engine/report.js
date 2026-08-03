// 치세 보고서 · 시즌 결산
import { round2 } from './economy.js';
import { nationWealth } from './ai_nation.js';
import { roleSummary } from './npc.js';

/** 재접속 보고서의 기준점 — 접속/이탈 시점의 국가 상태를 찍어 둔다. */
export function markSeen(nation, tick) {
  nation.lastSeenTick = tick;
  nation.lastSeenState = {
    tick,
    resources: { ...nation.resources },
    gold: nation.gold,
    population: nation.population,
    morale: nation.morale,
  };
  return nation.lastSeenState;
}

/** 재접속 시 lastSeenTick 이후 이벤트를 요약한다. */
export function buildRegencyReport(world, nation, data) {
  const since = nation.lastSeenTick ?? 0;
  const log = (world.log || []).filter((e) => e.tick > since && (e.nationId === nation.id || e.nationId == null));
  const lines = [];

  // PROTOCOL: report.deltas = 자원 7종 + gold, population, morale (마지막 관측 시점 대비 증감)
  const base = nation.lastSeenState || null;
  const deltas = {};
  for (const r of data.resources.order) {
    deltas[r] = round2((nation.resources[r] || 0) - (base?.resources?.[r] ?? (nation.resources[r] || 0)));
  }
  deltas.gold = round2(nation.gold - (base?.gold ?? nation.gold));
  deltas.population = Math.round(nation.population - (base?.population ?? nation.population));
  deltas.morale = round2(nation.morale - (base?.morale ?? nation.morale));

  let invasionsSeen = 0;
  let offersMissed = 0;
  let autoExportGold = 0;

  const byKind = {};
  for (const e of log) (byKind[e.kind] ||= []).push(e);

  const days = world.tick - since;
  lines.push(`${since}일차부터 ${world.tick}일차까지 ${days}일간 섭정이 나라를 맡았습니다.`);

  const exports_ = (byKind.auto_export || []).reduce((s, e) => s + (e.data?.gold || 0), 0);
  if (exports_ > 0) { lines.push(`잉여 자동 수출로 ${round2(exports_)}G가 국고에 들어왔습니다.`); autoExportGold = round2(exports_); }

  for (const e of byKind.wave_held || []) { lines.push(`${e.data.name} ${e.data.enemiesTotal}을(를) 모두 막아냈습니다.`); invasionsSeen += 1; }
  for (const e of byKind.wave_breached || []) { lines.push(`${e.data.name} ${e.data.enemiesEscaped}이(가) 곳간을 헤집었습니다.`); invasionsSeen += 1; }
  for (const e of byKind.tier_up || []) lines.push(`정착지가 ${e.data.name}이(가) 되어 국경이 ${e.data.radius}리까지 넓어졌습니다. (새 자원 ${e.data.nodesGained}곳)`);
  for (const e of byKind.resident_arrived || []) lines.push(`${e.data.name}이(가) 새로 들어왔습니다. (인구 ${e.data.population})`);
  for (const e of byKind.building_done || []) lines.push(`${e.data.name}${e.data.upgrade ? ' 개축' : ''}이 끝났습니다.`);
  for (const e of byKind.ruin_resolved || []) lines.push(`유적에서: ${e.data.text}`);
  for (const e of byKind.auto_advice || []) lines.push(`${e.data.roleName}이(가) 왕을 대신해 움직였습니다 — ${e.data.label}`);
  for (const e of byKind.camp_spotted || []) lines.push(`국경 밖에 ${e.data.name}의 진영이 보입니다.`);
  for (const e of byKind.disaster || []) lines.push(`${e.data.name} — ${e.data.text}`);
  for (const e of byKind.mid_shock || []) lines.push(`세계가 흔들렸습니다. ${e.data.name}: ${e.data.text}`);
  for (const e of byKind.starvation || []) lines.push(`굶주림으로 인구 ${e.data.lost}명을 잃었습니다.`);
  for (const e of byKind.npc_levelup || []) lines.push(`${e.data.name}이(가) ${e.data.role} 숙련 ${e.data.level}에 올랐습니다.`);

  const pending = nation.decisionQueue.length;
  if (pending) { lines.push(`판단이 필요한 안건 ${pending}건이 결정 큐에 쌓여 있습니다.`); offersMissed = pending; }

  // 타국 동향
  for (const other of Object.values(world.nations)) {
    if (other.isPlayer) continue;
    const top = Object.entries(other.market || {}).sort((a, b) => b[1].price - a[1].price)[0];
    if (top) lines.push(`${other.name}의 ${data.resources.meta[top[0]].name} 시세가 ${top[1].price}입니다.`);
  }

  // 다음 웨이브
  if (nation.wave?.arrivalTick != null) {
    const d = nation.wave.arrivalTick - world.tick;
    lines.push(nation.roles?.saint?.holder
      ? `제${nation.wave.index + 1}차 습격까지 ${d}일 남았습니다.`
      : '무언가 다가오고 있습니다. 성녀가 없어 시점이 흐립니다.');
  }

  return {
    sinceTick: since,
    toTick: world.tick,
    lines,
    deltas,
    summary: { invasions: invasionsSeen, offersMissed, autoExportGold },
  };
}

// ★ GDD3 §5 — 시즌 결산(buildSeasonResult)·랭킹은 폐기됐다. 연대기(chronicle.js)가 그 자리를 대신한다.
//   나라 간 비교가 필요할 때 쓰는 지표만 남긴다(어전 회의·조언이 참조).
export function nationScoreboard(world, data) {
  return Object.values(world.nations).map((n) => ({
    id: n.id, name: n.name, isPlayer: Boolean(n.isPlayer),
    wealth: round2(nationWealth(n, data)),
    population: Math.round(n.population),
    tier: n.tier ?? 0,
    tradeVolume: round2(n.stats?.tradeVolume || 0),
    wavesHeld: n.stats?.invasionsWon || 0,
    wavesBreached: n.stats?.invasionsLost || 0,
    roles: roleSummary(n, data),
  })).sort((a, b) => b.wealth - a.wealth);
}
