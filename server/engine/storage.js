// 저장 상한 — docs/GDD3.md §13-A-5. **서버가 정본이다.**
//
// 왜 생겼나. 예전에는 자원이 끝없이 쌓였다. 곳간을 지을 이유가 없고, 채집은 언제나 옳았다.
// 이제 자원마다 상한이 있고, 상한에 닿으면 **채집이 무효가 된다** — 궤짝을 더 짓거나 키워야 한다.
//
// 상한 = 본부 기본(hqBase + hqPerTier × 정착지 티어) + 저장 계열 건물의 몫 합.
// 건물 한 채의 몫은 base × capPerTierMultiplier^(티어-1) 이라, **새로 짓든 키우든** 둘 다 곳간이 는다.
//
// 주의: 이 상한은 **들어오는 것**만 막는다. 이미 들고 있는 재고를 강제로 깎지 않는다.
//   (교역·전리품·환급으로 넘치게 받는 일은 드물고, 그때 국고를 깎아 버리면 플레이어를 속이는 셈이다.
//    넘친 재고는 기존 부패 규칙 economy.applySpoilage 가 서서히 덜어 낸다.)
//
// economy.storageCapacity 와 헷갈리지 말 것: 그쪽은 **부패가 시작되는 무른 문턱**(인구 비례)이고,
// 여기는 **더는 들어오지 않는 단단한 상한**이다. 둘은 다른 다이얼이며 서로 간섭하지 않는다.
import { isRuined } from './structures.js';
import { settlementTier } from './tiers.js';
import { round2 } from './economy.js';

export const storageCfg = (data) => data.balance.storage ?? { hqBase: 0, hqPerTier: 0, capPerTierMultiplier: 1.6 };

/** 저장 계열인가 — data 가 storageCap 을 준 건물이 곧 저장 계열이다(같은 계열은 전부 같은 시스템) */
export const isStorageBuilding = (key, data) => Number(data.buildings?.[key]?.storageCap) > 0;

/** 이 건물 한 채가 보태는 몫. 무너졌거나 허무는 중이면 0 */
export function structureCap(s, data) {
  if (!s || s.inactive || isRuined(s)) return 0;
  const base = Number(data.buildings?.[s.key]?.storageCap);
  if (!(base > 0)) return 0;
  const mult = storageCfg(data).capPerTierMultiplier ?? 1.6;
  return base * Math.pow(mult, Math.max(0, (s.tier || 1) - 1));
}

/** 자원 하나가 쌓일 수 있는 총량 */
export function storageLimit(nation, data) {
  const cfg = storageCfg(data);
  let total = (cfg.hqBase || 0) + (cfg.hqPerTier || 0) * settlementTier(nation);
  for (const s of nation?.structures || []) total += structureCap(s, data);
  return round2(total);
}

/** 지금 이 자원을 얼마나 더 받을 수 있는가 */
export function spaceFor(nation, resource, data) {
  const have = Number(nation?.resources?.[resource]) || 0;
  return Math.max(0, round2(storageLimit(nation, data) - have));
}

/** 곳간이 찼는가 (표시용 — 여유가 한 톨도 없을 때) */
export const isFull = (nation, resource, data) => spaceFor(nation, resource, data) <= 0.005;

/** 지금 가득 찬 자원들 — HUD 가 빨간 테두리를 그릴 목록 */
export function fullResources(nation, data) {
  const limit = storageLimit(nation, data);
  const out = [];
  for (const [k, v] of Object.entries(nation?.resources || {})) {
    if ((Number(v) || 0) >= limit - 0.005) out.push(k);
  }
  return out;
}

/**
 * 국고에 넣는다. **넘치는 몫은 버려진다** — 실제로 들어간 만큼만 돌려준다.
 * 채집·주민 노동·건물 산출이 전부 이 문 하나로 들어온다.
 * @returns {number} 실제로 들어간 양
 */
export function deposit(nation, resource, amount, data) {
  const want = Number(amount) || 0;
  if (want <= 0) return 0;
  const room = spaceFor(nation, resource, data);
  const got = round2(Math.min(want, room));
  if (got <= 0) return 0;
  nation.resources[resource] = round2((nation.resources[resource] || 0) + got);
  return got;
}

/** 여러 자원을 한꺼번에 — 들어간 만큼의 표를 돌려준다 */
export function depositAll(nation, table, data) {
  const got = {};
  for (const [res, v] of Object.entries(table || {})) {
    const n = deposit(nation, res, v, data);
    if (n > 0) got[res] = n;
  }
  return got;
}

/** 곳간이 찼을 때 화면에 그대로 띄우는 말 (§13-A-5) */
export const FULL_MESSAGE = '곳간이 가득 찼습니다. 궤짝을 더 짓거나 키우세요.';
