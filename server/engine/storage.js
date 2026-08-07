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

// ────────────────────────────────────────────────────────────────
// ★ Sprint 3 — 「저장 계열은 어느 것인가」 색인 (파생 캐시. 저장되지 않는다)
//
// 왜. storageLimit 은 조용한 함수처럼 생겼지만 실은 게임에서 가장 자주 지나는 문 가운데 하나다:
// deposit → spaceFor → storageLimit 이라 **자원이 한 톨 들어올 때마다** 부르고,
// companions.pickNode 는 자원 종류 열 개에 isFull 을 물어 동료 넷이 1초마다 마흔 번을 더 부른다.
// 그때마다 건물 예순 채를 통째로 훑으며 채마다 data.buildings 를 두 번씩 뒤졌다 —
// 그런데 그 예순 중 곳간은 서넛뿐이고, 나머지 쉰여섯은 언제나 0을 돌려주는 헛걸음이었다.
//
// 무효화. **건물의 열쇠말(key)은 바뀌지 않는다** — 저택이 창고가 되는 일은 없다. 그러니
// 「어느 것이 곳간인가」는 목록이 늘거나 줄 때만 다시 고르면 된다. 그 「늘거나 줆」을 길이만으로
// 재면 「하나 헐고 하나 지음」이 같은 길이라 새어 나가므로, **nextStructureId** 를 함께 본다
// (건물이 하나 서면 반드시 오른다 — structures.js `s${nation.nextStructureId++}`).
// 티어·inactive·폐허(hp)는 캐시가 아니라 structureCap 이 그때그때 읽는다 —
// 개축도 철거 예약도 웨이브가 허문 곳간도 한 박자 늦지 않는다.
/** @type {WeakMap<object, {list:Array, key:string, data:object, cands:Array}>} */
const STORAGE_CANDS = new WeakMap();

/** 저장 계열 건물들(살았는지·티어는 보지 않는다 — 그건 structureCap 이 그때그때 판정한다) */
function storageStructures(nation, data) {
  const list = nation?.structures;
  if (!Array.isArray(list) || !list.length) return [];
  const key = `${list.length}:${nation.nextStructureId ?? 0}`;
  const hit = STORAGE_CANDS.get(nation);
  if (hit && hit.list === list && hit.key === key && hit.data === data) return hit.cands;
  const cands = list.filter((s) => isStorageBuilding(s.key, data));
  STORAGE_CANDS.set(nation, { list, key, data, cands });
  return cands;
}

/** 자원 하나가 쌓일 수 있는 총량 */
export function storageLimit(nation, data) {
  const cfg = storageCfg(data);
  let total = (cfg.hqBase || 0) + (cfg.hqPerTier || 0) * settlementTier(nation);
  // 곳간이 아닌 건물은 structureCap 이 어차피 0 을 준다 — 그 0 들을 아예 훑지 않는 것뿐, 합은 같다
  for (const s of storageStructures(nation, data)) total += structureCap(s, data);
  return round2(total);
}

/**
 * ★ §19-E(QA-A 창고 되튐) — 부패가 물러설 자리.
 *
 * 왜. 단단한 상한(여기)과 무른 문턱(economy.storageCapacity — 인구 비례의 재고 목표)은 서로 다른
 * 다이얼이다. 그런데 상한이 문턱보다 높으면 그 사이는 **게임이 스스로 밀어 넣고 매일 깎는 구간**이 된다:
 * 채집은 상한에서 멎으니 재고가 499 에 눌러앉고, 다음 일 틱의 부패가 3~4 를 덜어 내고, 그날 다시 499 로
 * 찬다 — 자원칸이 496↔499 로 되튄다(실측: 상한 500 · 목재 무른 문턱 315 · 하루 −3.68).
 * 손은 이미 멎었는데 독만 새는 자리다. 그래서 「곳간 안에 든 것은 썩지 않는다」로 바꾼다.
 * 상한을 넘겨 받은 몫(교역·전리품·환급)은 그대로 서서히 덜린다 — PROTOCOL §0-Y-4 의 「넘친 재고」가 그것이다.
 */
export function spoilFloor(nation, data) {
  if (storageCfg(data).spoilRespectsLimit === false) return 0;
  return storageLimit(nation, data);
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
