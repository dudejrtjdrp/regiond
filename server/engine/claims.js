// ★ §17-14 — 영토 점령(깃발 멀티). "본진 밖에 제2 거점을 세우는 느낌"의 정면 구현이다.
//
// 규칙 (data/world.json territory.claim 이 정본):
//   ① 본영(과 이미 점령한 땅) **밖**에 개척 깃발(claim_flag)을 flagsRequired개,
//      서로 groupRadius 안에 모아 세운다.
//   ② 건축가(build)·국방대신(defense) 자리를 맡은 **실제 인물** — 동료 봇이든,
//      그 자리를 든 사람의 아바타든 — 이 둘 다 무리 중심 escortRadius 안에 서면
//   ③ 그 자리가 반경 claimRadius 의 새 영토(nation.claims)로 편입된다.
//
// inTerritory(world.js)가 본영 원 다음으로 이 원 목록을 보므로, 점령과 동시에
// 짐승 성역·건물 배치·주민 영토 판정·울타리가 전부 새 땅을 우리 땅으로 안다.
// §17-11 의 수동 지시(「이곳으로 보낸다」)로 두 사람을 깃발 무리로 보내면 자연히 성립한다.
//
// ★ 결정론 — 난수를 한 톨도 쓰지 않는다. 같은 상태에서는 언제나 같은 답이 나온다.
import { inTerritory, dist } from './world.js';
import { isRuined } from './structures.js';

export const claimCfg = (data) => data.world.territory.claim ?? {};

/** 이 자리를 덮은 점령지 (없으면 null) */
export function claimAt(nation, x, y) {
  for (const c of nation?.claims || []) {
    if (dist(c.x, c.y, x, y) <= c.radius + 0.001) return c;
  }
  return null;
}

/**
 * 역할(roleKey)을 맡은 **실제 인물**의 아바타 목록.
 *   · holder === 'npc'    → 그 자리에 앉은 동료 봇(role.botId). 자리만 지키는 옛 이름표(botId 없음)는
 *                           들에 서 있지 않으므로 호위가 못 된다.
 *   · holder === 'player' → 그 자리를 든 사람(role.owner). owner 가 비어 있으면(옛 위임 경로)
 *                           동료가 아닌 사람 아바타 전부를 후보로 본다.
 * 쓰러진 사람(downUntil)은 세지 않는다 — 기절한 채 실려 와서 땅을 봉할 수는 없다.
 */
function roleEscorts(nation, roleKey) {
  const role = nation.roles?.[roleKey];
  if (!role || !role.holder) return [];
  const standing = (id) => {
    if (!id) return null;
    if ((nation.players?.[id]?.downUntil || 0) > 0) return null;
    return nation.avatars?.[id] ?? null;
  };
  if (role.holder === 'npc') {
    const comp = (nation.companions?.list || []).find((c) => c.id === role.botId);
    if (!comp || !comp.active) return [];
    const av = standing(comp.id);
    return av ? [av] : [];
  }
  if (role.holder === 'player') {
    if (role.owner) {
      const av = standing(role.owner);
      return av ? [av] : [];
    }
    const botIds = new Set((nation.companions?.list || []).map((c) => c.id));
    return Object.keys(nation.avatars || {})
      .filter((id) => !botIds.has(id))
      .map((id) => standing(id))
      .filter(Boolean);
  }
  return [];
}

/**
 * 점령 판정 한 걸음 — 생태계 1초 루프(server/index.js)가 부른다. 결정론·무난수.
 * @returns {Array} territory_claimed 이벤트 목록 (없으면 빈 배열)
 */
export function claimStep(world, nation, data) {
  const events = [];
  const cfg = claimCfg(data);
  const need = cfg.flagsRequired ?? 3;
  const maxClaims = cfg.maxClaims ?? 4;
  const claims = (nation.claims ||= []);
  if (claims.length >= maxClaims) return events;

  // ① 본영(과 기존 점령지) 밖에 선 성한 깃발만 — inTerritory 가 claims 를 이미 포함하므로
  //    한 번 점령한 땅의 깃발은 저절로 빠진다(같은 자리를 두 번 세지 않는다).
  const flags = (nation.structures || []).filter((s) => s.key === 'claim_flag'
    && !isRuined(s) && !s.inactive
    && !inTerritory(world, nation, s.x, s.y, data));
  if (flags.length < need) return events;

  // ② 탐욕 군집 — 씨앗 하나에서 시작해, 무게중심 groupRadius 안의 깃발을 수렴할 때까지 끌어모은다.
  const groupR = cfg.groupRadius ?? 7;
  const escortR = cfg.escortRadius ?? 6;
  const radius = cfg.claimRadius ?? 9;
  const used = new Set();
  const centroidOf = (list) => ({
    x: list.reduce((a, f) => a + f.x, 0) / list.length,
    y: list.reduce((a, f) => a + f.y, 0) / list.length,
  });
  for (const seed of flags) {
    if (used.has(seed.id)) continue;
    let members = [seed];
    for (let pass = 0; pass < 6; pass += 1) {
      const c = centroidOf(members);
      const next = flags.filter((f) => !used.has(f.id) && dist(f.x, f.y, c.x, c.y) <= groupR);
      if (next.length === members.length || !next.length) break;
      members = next;
    }
    for (const f of members) used.add(f.id);
    if (members.length < need) continue;
    const c = centroidOf(members);

    // ③ 기존 점령지와의 최소 간격 — 중심끼리 claimRadius 는 떨어져야 한다(깃발 스팸 방지)
    if (claims.some((cl) => dist(cl.x, cl.y, c.x, c.y) < radius)) continue;

    // ④ 호위 — 건축가·국방대신이 둘 다 무리 중심 곁에 서 있는가
    const near = (roleKey) => roleEscorts(nation, roleKey)
      .some((a) => dist(a.x, a.y, c.x, c.y) <= escortR + 0.001);
    if (!near('build') || !near('defense')) continue;

    // ⑤ 점령 — 새 원이 영토 장부에 오른다
    nation.nextClaimId ||= 1;
    const claim = {
      id: `clm${nation.nextClaimId++}`,
      x: Math.round(c.x), y: Math.round(c.y),
      radius, tick: world.tick ?? 0,
    };
    claims.push(claim);
    events.push({ kind: 'territory_claimed', nationId: nation.id, data: { ...claim } });
    if (claims.length >= maxClaims) break;
  }
  return events;
}
