// ending.js — ★ §세계관 W3 매듭형 엔딩(세계관기획 §8). 끝이 아니라 「첫 매듭」이다.
//
// 「왜」 조건 3중인가 — 원안의 엔딩은 「드래곤 격퇴 → 본국의 초대 → 재회」다. 게임에서 그것은
//   ① 용을 이겼고(웨이브 용을 막았거나, 세상에 한 마리뿐인 용을 잡았거나 — §19-F2)
//   ② 도시(티어 5)에 이르렀고   ③ 에르니아와 금화가 오간 사이(재회의 W3 근사)일 때다.
// 셋이 다 차면 다음 일 틱에 초대장이 「알림」으로 온다 — 저절로 열리지 않는다(§11-1 결).
// 여는 것(acceptEnding)은 군주들 중 누구여도 되고, 웨이브 당일에는 성을 비울 수 없다.
import { settlementTier } from './tiers.js';
import { record as chronicle } from './chronicle.js';
import { round2 } from './economy.js';

export const endingCfg = (data) => data.balance.ending;

/** 용을 이겼는가 — 웨이브 로테이션의 용 또는 세계 보스, 무엇이든 인정한다 */
export function dragonBeaten(world, nation) {
  if (world.dragon?.slainTick != null) return true;
  return (nation.wave?.history || []).some((h) => h.type === 'dragon' && h.won);
}

function tradeGoldWith(nation, partnerId) {
  return (nation.stats?.tradeGoldWith || {})[partnerId] || 0;
}

/** 초대장 조건판 — 외교 화면·테스트가 함께 본다.
 *  ★ §세계관 W4 — 거래 누계(tradeOk)가 재회 게이지(relationOk)로 승격됐다. 게이지가 없는
 *  옛 세이브는 relations.js 이관 근사(migratePerGold)가 누계에서 채워 후퇴를 막는다. */
export function endingState(world, nation, data) {
  const cfg = endingCfg(data);
  const traded = tradeGoldWith(nation, cfg.tradePartnerId);
  const score = nation.relations?.[cfg.tradePartnerId] ?? 0;
  const s = {
    tierOk: settlementTier(nation) >= cfg.tierMin,
    dragonOk: dragonBeaten(world, nation),
    relationOk: score >= (cfg.reunionScoreMin ?? 60),
    reunionScore: round2(score),
    traded: round2(traded),
    invited: world.endingInviteTick != null,
    done: world.endingDone != null,
  };
  /* ★ 2026-08 개편 — 문은 둘이다: 용을 눕혔는가 · 정착지를 끝까지 키웠는가.
     재회 게이지는 카드에 **보이되 막지 않는다**(balance.ending.requireReunion 이 true 면 옛 3중으로 돌아간다).
     「왜」 — 용을 눕힌 사람에게 화면이 가리킬 것 하나(마지막 퀘스트)만 남기기 위해서다:
     문이 셋이면 「무엇이 모자란지」가 셋으로 흩어져, 끝을 눈앞에 두고도 뭘 해야 할지 모르게 된다. */
  s.met = s.tierOk && s.dragonOk && (cfg.requireReunion ? s.relationOk : true);
  return s;
}

/** 매 일 틱 — 조건이 갓 찼으면 초대장 사건을 한 번 만든다 */
export function checkEndingInvite(world, data) {
  const nation = world.nations?.[world.playerNationId];
  if (!nation || world.endingInviteTick != null) return [];
  const s = endingState(world, nation, data);
  if (!s.met) return [];
  world.endingInviteTick = world.tick;
  chronicle(world, {
    kind: 'story', title: '초대장',
    text: '에르니아 왕국의 초대장이 왔다 — 국왕이 군주들을 직접 뵙고 싶다 한다.',
  }, data);
  return [{ kind: 'ending_invite', nationId: nation.id, data: inviteView(nation) }];
}

export function inviteView(nation) {
  return {
    from: '에르니아 왕국',
    text: `에르니아 왕국에서 초대장이 왔습니다. 국왕께서, ${nation.name}의 군주들을 직접 뵙고 싶다 하십니다.`,
    accept: '에르니아로 간다',
    later: '아직은 때가 아니다',
  };
}

/** 웨이브 당일에는 성을 비울 수 없다 — 전투 중이거나 오늘이 도착일이면 막는다 */
function waveDay(world, nation) {
  if (nation.battle && !nation.battle.over) return true;
  return nation.wave?.arrivalTick === world.tick;
}

/**
 * 초대장을 연다 — 성공하면 ending_started 사건 하나를 돌려주고, 이야기(엔딩·크레딧·쿠키)는
 * story.js 가 그 사건을 보고 얹는다. 재회 보상(에르니아 제안 빈도·매입가 우대)은 endingDone 이 켠다.
 */
export function acceptEnding(world, nation, data, lordName) {
  if (world.endingInviteTick == null) return { ok: false, code: 'NO_INVITE', message: '아직 초대장이 오지 않았습니다.' };
  if (world.endingDone != null) return { ok: false, code: 'ALREADY', message: '이미 맺은 매듭입니다. 연대기에서 되짚을 수 있습니다.' };
  if (waveDay(world, nation)) return { ok: false, code: 'WAVE_DAY', message: '지금은 성을 비울 수 없습니다 — 무리가 오는 날입니다.' };
  world.endingDone = world.tick;
  chronicle(world, {
    kind: 'story', title: '첫 매듭',
    text: `${nation.name}의 군주들이 에르니아의 다탁에 앉았다 — 갈라섰던 두 나라가, 대등하게 다시 만났다.`,
    data: { tick: world.tick },
  }, data);
  return { ok: true, events: [{ kind: 'ending_started', nationId: nation.id, data: { by: lordName || null } }] };
}

/** 재회 보상 — 에르니아 제안 확률 배수. rng 소비 횟수는 바꾸지 않는다(결정론). */
export function reunionOfferMult(world, aiNationId, data) {
  const cfg = endingCfg(data);
  if (world.endingDone == null || aiNationId !== cfg.tradePartnerId) return 1;
  return cfg.reunion?.offerChanceMult ?? 1;
}

/** 재회 보상 — 에르니아에 팔 때 값을 더 쳐준다 */
export function reunionSellPremium(world, partnerId, data) {
  const cfg = endingCfg(data);
  if (world.endingDone == null || partnerId !== cfg.tradePartnerId) return 0;
  return cfg.reunion?.sellPremium ?? 0;
}

/** 거래 누계 — 재회의 근사 게이지. 사고팔 때 오간 금화를 상대별로 더해 둔다. */
export function countTradeGold(nation, partnerId, gold) {
  const bag = ((nation.stats ||= {}).tradeGoldWith ||= {});
  bag[partnerId] = round2((bag[partnerId] || 0) + Math.abs(gold));
}
