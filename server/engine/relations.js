// relations.js — ★ §세계관 W4 세 나라의 관계 결 + 살아있는 세계(국가 이벤트).
//
// 「왜」 게이지가 하나가 아니라 셋인가 — 단순 호감도의 폐지(세계관기획 §3). 같은 0~100 스칼라를
// 쓰되 오르내리는 「규칙」이 나라마다 다르다: 에르니아는 성장을 지켜보고(재회), 청명은 계약
// 이행만 세고(신의), 엘라시아는 쉽게 열리되 부족 회의에 출렁인다(세 부족). 규칙은 전부
// data/ai_nations.json relation 다이얼이다.
//
// 결정론 ★ — 이 모듈은 세계 난수를 한 톨도 축내지 않는다. 확률은 statRng, 훅은 전부
// index.js(advance)·commands.js(trade·respondOffer)에만 있어 시뮬 봇은 이 길을 지나지 않는다.
import { statRng } from './traits.js';
import { applyEventEffect } from './events.js';
import { localPrice, round2, clamp } from './economy.js';

const nationDef = (data, nid) => data.aiNations.nations.find((n) => n.id === nid);
export const relCfg = (data, nid) => nationDef(data, nid)?.relation ?? null;
const natEvCfg = (data) => data.events.nations ?? null;

/** 관계 장부 — 없으면 거래 누계에서 근사해 연다(옛 세이브가 엔딩 문턱에서 후퇴하지 않게) */
export function relationsOf(world, nation, data) {
  if (nation.relations) return nation.relations;
  nation.relations = {};
  for (const n of data.aiNations.nations) {
    const traded = (nation.stats?.tradeGoldWith || {})[n.id] || 0;
    nation.relations[n.id] = clamp(round2(traded * (n.relation?.migratePerGold ?? 0)), 0, 100);
  }
  return nation.relations;
}

export function addRel(world, nation, nid, delta, data) {
  const rel = relationsOf(world, nation, data);
  rel[nid] = clamp(round2((rel[nid] || 0) + delta), 0, 100);
  return rel[nid];
}

const meta = (nation) => ((nation.relMeta ||= { refuseStreak: {}, dealStreak: {} }));

/** 거래 성사 — 결마다 다른 셈. relBonus 는 특수 제안(도움 요청·특가)이 얹는 웃돈이다. */
export function onTradeDone(world, nation, partnerId, gold, data, relBonus = 0) {
  if (!nation.isPlayer) return;
  const cfg = relCfg(data, partnerId);
  if (!cfg) return;
  meta(nation).refuseStreak[partnerId] = 0;
  addRel(world, nation, partnerId, dealGain(cfg, gold) + relBonus, data);
}

function dealGain(cfg, gold) {
  if (cfg.style === 'reunion') return gold * (cfg.perGold ?? 0);
  return cfg.perDeal ?? 0;
}

/** 제안 거절 — 청명은 세 번 이어지면 쇄국한다. 사건이 생기면 이벤트로 돌려준다. */
export function onOfferRefused(world, nation, partnerId, data) {
  if (!nation.isPlayer) return [];
  const cfg = relCfg(data, partnerId);
  if (!cfg) return [];
  addRel(world, nation, partnerId, cfg.refuseDelta ?? 0, data);
  const m = meta(nation);
  m.refuseStreak[partnerId] = (m.refuseStreak[partnerId] || 0) + 1;
  if (!cfg.closedGate || m.refuseStreak[partnerId] < (cfg.refuseStreakLimit ?? 99)) return [];
  return closeGate(world, nation, partnerId, cfg, data);
}

function closeGate(world, nation, partnerId, cfg, data) {
  meta(nation).refuseStreak[partnerId] = 0;
  addRel(world, nation, partnerId, cfg.closedGate.delta, data);
  banOffers(world, partnerId, cfg.closedGate.banTicks);
  const def = (natEvCfg(data)?.pool || []).find((e) => e.id === 'cheongmyeong_closed_gate');
  if (!def) return [];
  return [{ kind: 'nation_event', nationId: nation.id, data: { id: def.id, name: def.name, text: def.text } }];
}

function banOffers(world, nid, ticks) {
  ((world.offerBanUntil ||= {}))[nid] = world.tick + ticks;
}

const banned = (world, nid) => (world.offerBanUntil?.[nid] ?? -1) > world.tick;

/** 위신 사건 — 에르니아(재회 결)만 성장을 지켜보고 가산한다 */
function prestigeGain(world, nation, batch, data) {
  for (const n of data.aiNations.nations) {
    const p = n.relation?.prestige;
    if (!p) continue;
    for (const e of batch || []) if (p[e.kind]) addRel(world, nation, n.id, p[e.kind], data);
  }
}

/** 호칭 — 무역·외교 화면이 부르는 이름. 결마다 단계가 다르다(세계관기획 §3-1). */
export function relationTitle(world, nation, nid, data) {
  const cfg = relCfg(data, nid);
  if (!cfg) return null;
  const score = relationsOf(world, nation, data)[nid] || 0;
  if (cfg.style === 'reunion') return reunionTitle(world, nation, cfg);
  const t = cfg.thresholds || {};
  const stage = Object.entries(t).filter(([, at]) => score >= at).sort((a, b) => b[1] - a[1])[0];
  return (stage && cfg.titles[stage[0]]) || cfg.titles.base;
}

function reunionTitle(world, nation, cfg) {
  const name = nation.name;
  if (world.endingDone != null) return cfg.titles.equal.replaceAll('{name}', name);
  if ((nation.tier ?? 0) >= 4) return cfg.titles.rising.replaceAll('{name}', name);
  return cfg.titles.early;
}

/** 외교 화면 페이로드 — 점수·호칭·다음 문턱 */
export function relationView(world, nation, data, nid) {
  const cfg = relCfg(data, nid);
  if (!cfg || !nation?.isPlayer) return null;
  const score = relationsOf(world, nation, data)[nid] || 0;
  const nexts = Object.values(cfg.thresholds || {}).filter((at) => at > score).sort((a, b) => a - b);
  return { score, title: relationTitle(world, nation, nid, data), nextAt: nexts[0] ?? null };
}

// ────────────────────────────────────────────────────────────────
// 살아있는 세계 — 매 일 틱(서버에서만) 관계·이벤트를 굴린다
// ────────────────────────────────────────────────────────────────
export function dailyRelations(world, data, batch) {
  const nation = world.nations?.[world.playerNationId];
  if (!nation) return [];
  relationsOf(world, nation, data);
  prestigeGain(world, nation, batch, data);
  world.offers = (world.offers || []).filter((o) => !banned(world, o.nationId));
  const out = [];
  out.push(...deliverContract(world, nation, data));
  out.push(...offerSteelDeal(world, nation, data));
  out.push(...pumpNationEvents(world, nation, data));
  return out;
}

/** 엘라시아 정기 계약 — 임계를 넘긴 이웃의 꾸준함. 금고가 빈 날은 조용히 쉰다. */
function deliverContract(world, nation, data) {
  const cfg = relCfg(data, 'ai2');
  const c = cfg?.contract;
  if (!c) return [];
  const score = relationsOf(world, nation, data).ai2 || 0;
  if (score < (cfg.thresholds?.contract ?? 999) || banned(world, 'ai2')) return [];
  const cost = round2(c.amount * c.goldPerUnit);
  if ((nation.gold || 0) < cost) return [];
  nation.gold = round2(nation.gold - cost);
  nation.resources[c.resource] = (nation.resources[c.resource] || 0) + c.amount;
  return [{ kind: 'nation_contract', nationId: nation.id,
    data: { nation: 'ai2', resource: c.resource, amount: c.amount, gold: cost,
      text: `엘라시아의 정기 상단이 다녀갔다 — ${c.resource === 'wood' ? '목재' : c.resource} ${c.amount} (금화 ${cost}).` } }];
}

/** 청명 독점 강재 특가 — 신의를 맺은 벗에게만, 이따금 */
function offerSteelDeal(world, nation, data) {
  const cfg = relCfg(data, 'ai1');
  const deal = cfg?.steelDeal;
  if (!deal || banned(world, 'ai1')) return [];
  const score = relationsOf(world, nation, data).ai1 || 0;
  if (score < (cfg.thresholds?.bond ?? 999)) return [];
  const st = (world.relState ||= {});
  if ((st.steelDealTick ?? -99) + deal.coolTicks > world.tick) return [];
  if (!statRng(`${world.seed}:steeldeal:${world.tick}`).chance(0.5)) return [];
  st.steelDealTick = world.tick;
  pushSpecialOffer(world, data, { nationId: 'ai1', side: 'buy', resource: deal.resource,
    amount: deal.amount, discount: deal.discount, relBonus: deal.relBonus, expiryTicks: deal.expiryTicks });
  return [{ kind: 'nation_event', nationId: nation.id,
    data: { id: 'steel_deal', name: '청명의 성의', text: '신의를 맺은 벗에게 — 청명이 독점 강재를 특가에 내놓았다. 제안을 여시오.' } }];
}

/** 특수 제안 — 기존 제안 파이프라인에 얹는다. adj 는 실행 단가 보정(할인 음수·웃돈 양수). */
function pushSpecialOffer(world, data, spec) {
  const partner = world.nations[spec.nationId];
  if (!partner) return;
  const base = localPrice(partner, spec.resource, data);
  const adj = spec.side === 'buy' ? -(spec.discount ?? 0) : (spec.premium ?? 0);
  (world.offers ||= []).push({
    offerId: `rel_${world.tick}_${spec.nationId}_${spec.resource}`,
    nationId: spec.nationId, nationName: partner.name,
    envoy: nationDef(data, spec.nationId)?.envoy ?? null,
    side: spec.side, resource: spec.resource, amount: spec.amount,
    price: round2(base * (1 + adj)),
    expiresTick: world.tick + (spec.expiryTicks ?? 2),
    special: { adj, relBonus: spec.relBonus ?? 0 },
  });
}

/** 국가 이벤트 — 예약분을 먼저 소화하고, 오늘의 새 사건을 (최대 1건) 굴린다 */
function pumpNationEvents(world, nation, data) {
  const cfg = natEvCfg(data);
  if (!cfg) return [];
  const st = (world.natEvState ||= { queue: [], fired: {} });
  const out = [];
  const due = st.queue.filter((q) => q.fireTick <= world.tick);
  st.queue = st.queue.filter((q) => q.fireTick > world.tick);
  for (const q of due) out.push(...fireNationEvent(world, nation, q.def, data));
  out.push(...rollNationEvent(world, nation, cfg, st, data));
  return out;
}

function rollNationEvent(world, nation, cfg, st, data) {
  const rng = statRng(`${world.seed}:natev:${world.tick}`);
  for (const def of cfg.pool) {
    if (!triggerOk(world, nation, def, data, st)) continue;
    if (!rng.chance(def.chance ?? 0)) continue;
    st.fired[def.id] = (st.fired[def.id] || 0) + 1;
    return dispatchOrForewarn(world, nation, def, cfg, st, data);
  }
  return [];
}

function triggerOk(world, nation, def, data, st) {
  const t = def.trigger || {};
  if (t.refuseStreak) return false;                       // 쇄국은 확률이 아니라 거절이 연다
  if (t.oncePerWorld && st.fired[def.id]) return false;
  if ((nation.progress?.chapter ?? 1) < (t.minChapter ?? 0)) return false;
  if (t.tierMin != null && (nation.tier ?? 0) < t.tierMin) return false;
  if (t.relMin != null && (relationsOf(world, nation, data)[def.nation] || 0) < t.relMin) return false;
  if (t.playerGrainAbove != null && (nation.resources.grain || 0) <= t.playerGrainAbove) return false;
  if (t.aiGrainBelow != null && (world.nations[def.nation]?.resources.grain ?? 999) >= t.aiGrainBelow) return false;
  return !banned(world, def.nation);
}

/** 성녀가 자리에 있으면 하루 전 예감이 먼저 온다 — 역할 정보 비대칭의 새 소비처(기획 §3-4) */
function dispatchOrForewarn(world, nation, def, cfg, st, data) {
  const saintOn = cfg.saintForewarn && Boolean(nation.roles?.saint?.holder);
  if (!saintOn || !def.omen) return fireNationEvent(world, nation, def, data);
  st.queue.push({ fireTick: world.tick + 1, def });
  return [{ kind: 'nation_omen', nationId: nation.id, data: { id: def.id, text: def.omen } }];
}

function fireNationEvent(world, nation, def, data) {
  for (const eff of def.effects || []) applyToTargets(world, nation, def, eff, data);
  if (def.ban) banOffers(world, def.ban.nationId, def.ban.ticks);
  if (def.specialOffer) pushSpecialOffer(world, data, def.specialOffer);
  if (def.followUp) scheduleFollowUp(world, def);
  return [{ kind: 'nation_event', nationId: nation.id, data: { id: def.id, name: def.name, text: def.text } }];
}

function applyToTargets(world, nation, def, eff, data) {
  const ev = { id: def.id, name: def.name, effect: eff };
  if (eff.target === 'player') { applyEventEffect(nation, ev, world.tick, data); return; }
  for (const n of Object.values(world.nations)) applyEventEffect(n, ev, world.tick, data);
}

function scheduleFollowUp(world, def) {
  const f = def.followUp;
  (world.natEvState ||= { queue: [], fired: {} }).queue.push({
    fireTick: world.tick + (f.afterTicks ?? 1),
    def: { id: `${def.id}_after`, name: def.name, text: f.text, effects: f.effects, specialOffer: f.specialOffer },
  });
}
