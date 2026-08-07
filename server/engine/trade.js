// ★ §19-F3(F07-7) 무역 동기 — 「무역할 까닭」을 짓는 자리.
//
// 「왜」 이 파일이 생겼는가 —
//   여태 이웃 세 나라의 값은 우리 값과 같은 공식(localPrice)에서 나왔다. 그래서 어디서 사든
//   어디에 팔든 이(利)가 같았고, 교역소를 세울 까닭도 도읍까지 걸어갈 까닭도 없었다.
//   이제 나라마다 **싸게 내주는 것**과 **비싸게 쳐주는 것**이 갈린다(data/ai_nations.json tradeProfile).
//   산유국은 검은 것을 헐값에 내주고 먹을 것을 후하게 사 준다 — 성정이 곧 값이 된다.
//   여기에 **특산품**(우리가 못 만드는 것)을 얹어 금화가 도는 고리를 닫는다:
//     부산물을 판다 → 금화 → 연구 가속 · 특산품 · 사람 꾸미기.
//
// ★ 성향 배수는 **직접 흥정(trade 명령)에만** 붙는다. 저쪽에서 보내오는 제안(offers)은
//   저쪽이 부르는 값 그대로다 — 오퍼 값을 건드리면 옛 세이브의 자동 응답과 시뮬 기준선이 함께 밀린다.
import { localPrice, round2 } from './economy.js';

export const tradeCfg = (data) => data.balance.trade;

/** 그 나라의 설정 원본(성정·특산품). 세이브가 아니라 자료에서 읽으므로 옛 세이브도 그대로 산다. */
export function nationDef(nationId, data) {
  return data.aiNations.nations.find((a) => a.id === nationId) ?? null;
}

/**
 * 그 나라에서 이 재화가 몇 배로 오가는가.
 * @param {'buy'|'sell'} side 플레이어 관점 — buy 면 그 나라가 내주는 값, sell 이면 쳐주는 값
 */
export function tradeFactor(nationId, resource, side, data) {
  const prof = nationDef(nationId, data)?.tradeProfile ?? null;
  const table = side === 'buy' ? prof?.exports : prof?.demands;
  const v = Number(table?.[resource]);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** 그 나라 시세 한 칸 — 로컬 가격 × 조작/덤핑 성향 × 성정 배수 */
export function foreignUnitPrice(partner, resource, side, data) {
  const base = localPrice(partner, resource, data) * (1 + (partner.priceBias || 0));
  return base * tradeFactor(partner.id, resource, side, data);
}

/** 화면이 「무엇을 싸게 내주고 무엇을 비싸게 사는가」를 적을 수 있게 하는 첩(帖) */
export function tradeProfileView(nationId, data) {
  const prof = nationDef(nationId, data)?.tradeProfile ?? null;
  const row = (table, dir) => Object.entries(table || {})
    .map(([key, factor]) => ({ key, name: data.resources.meta[key]?.name ?? key, factor, dir }));
  return { exports: row(prof?.exports, 'export'), demands: row(prof?.demands, 'demand') };
}

// ────────────────────────────────────────────────────────────────
// 특산품 — 우리가 못 만드는 것. 재고가 있고 며칠에 걸쳐 다시 찬다.
// ────────────────────────────────────────────────────────────────
const stockKey = (nationId, key) => `${nationId}:${key}`;

/** 그 물건의 지금 재고 칸(없으면 만든다 — 옛 세이브는 가득 찬 채로 시작한다) */
export function specialtyStock(nation, nationId, item) {
  const store = (nation.specialtyStock ||= {});
  const k = stockKey(nationId, item.key);
  store[k] ||= { left: item.stock ?? 1, restockTick: null };
  return store[k];
}

/** 하루 틱 — 다 팔린 물건이 restockDays 뒤에 다시 찬다. */
export function restockSpecialties(world, nation, data) {
  const store = nation.specialtyStock;
  if (!store) return;
  for (const [k, st] of Object.entries(store)) {
    if (st.restockTick == null || world.tick < st.restockTick) continue;
    st.left = itemByStockKey(k, data)?.stock ?? 1;
    st.restockTick = null;
  }
}

function itemByStockKey(k, data) {
  const [nationId, key] = k.split(':');
  return (nationDef(nationId, data)?.specialties || []).find((s) => s.key === key) ?? null;
}

/** 그 나라의 특산품 좌판 — 값·남은 개수·다시 차는 날까지 */
export function specialtyList(world, nation, partnerId, data) {
  const items = nationDef(partnerId, data)?.specialties || [];
  return items.map((item) => {
    const st = specialtyStock(nation, partnerId, item);
    return {
      key: item.key, name: item.name, desc: item.desc, gold: item.gold,
      left: st.left, stock: item.stock ?? 1,
      restockInDays: st.restockTick == null ? 0 : Math.max(0, st.restockTick - world.tick),
      grant: { ...(item.grant || {}) },
    };
  });
}
