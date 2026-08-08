// 도감 — docs/GDD3.md §13-C-3. **서버가 조우·처치 수의 정본을 쥔다.**
//
// 왜 서버인가. 도감은 「무엇을 보았고 무엇을 잡았는가」의 기록이고, 그것은 곧 플레이 이력이다.
// 화면이 세면 새로고침 한 번에 사라지고, 멀티에서 동료와 어긋난다. 그래서 카운트는 nation.codex 에 살고
// 스냅샷과 함께 저장된다 — 같은 정착지에 접속한 사람은 같은 도감을 본다.
//
// 층은 넷이다(data/creatures.json codex):
//   조우 0      → 실루엣만. 이름조차 없다.
//   조우 1+     → 이름·서식이 열린다.
//   처치 statsAt(5)+  → 능력치와 드롭표가 열린다.
//   처치 loreAt(20)+  → 일화가 열린다. 이 문장은 **표현 계층**이 쓴다(자료의 lore 가 밑글이다).
//
// 유적 탭은 따로다 — 어떤 유적을 발견했고 얼마나 뒤졌는지가 남는다(§13-B-4).
// ★ 자료 접근자는 여기서 직접 만든다 — ecology.js 에서 끌어오면 두 모듈이 서로를 부르는 고리가 된다.
// ★ §17-17 — 새 땅의 첫 발견도 「무엇을 보았는가」의 장부다. 지형 이름은 월드가, 한 줄 기록은 연대기가 쥔다.
//   (world.js → chronicle.js 를 직접 잇지 않는 까닭: chronicle → tiers → world 로 고리가 생긴다.)
import { terrainNameAt } from './world.js';
import { record } from './chronicle.js';

const creatureCfg = (data) => data.creatures;
const creatureDefs = (data) => data.creatures.defs;
export const biomeCfg = (data) => data.world.terrain.biomes ?? null;

export function ensureCodex(nation) {
  const c = (nation.codex ||= {});
  c.species ||= {};
  c.ruins ||= {};
  return c;
}

function entry(nation, key) {
  const c = ensureCodex(nation);
  return (c.species[key] ||= { encounters: 0, kills: 0, firstTick: null, lastTick: null });
}

/** 처음 마주친 순간 — 같은 개체는 한 번만 센다(ecology 가 creature.seen 으로 표시한다) */
export function recordEncounter(nation, key, tick = 0) {
  const e = entry(nation, key);
  e.encounters += 1;
  if (e.firstTick == null) e.firstTick = tick;
  e.lastTick = tick;
  return e;
}

export function recordKill(nation, key, tick = 0) {
  const e = entry(nation, key);
  e.kills += 1;
  if (e.encounters === 0) e.encounters = 1;      // 잡았으면 본 것이다
  e.lastTick = tick;
  return e;
}

export const speciesStat = (nation, key) =>
  ensureCodex(nation).species[key] ?? { encounters: 0, kills: 0, firstTick: null, lastTick: null };

// ────────────────────────────────────────────────────────────────
// 유적 기록 (§13-B-4)
// ────────────────────────────────────────────────────────────────
/** 지도에 나타난 순간 */
export function recordRuinFound(nation, node, tick = 0) {
  if (!node || node.type !== 'ruin') return null;
  const c = ensureCodex(nation);
  const r = (c.ruins[node.id] ||= {
    id: node.id, size: node.size ?? 1, name: node.ruinName ?? '옛 자취',
    x: node.x, y: node.y, foundTick: tick, cycles: 0, concealed: Boolean(node.concealed),
  });
  return r;
}

/** 한 주기를 뒤졌다 */
export function recordRuin(nation, node, tick = 0) {
  const r = recordRuinFound(nation, node, tick);
  if (!r) return null;
  r.cycles = (r.cycles || 0) + 1;
  r.lastTick = tick;
  return r;
}

// ────────────────────────────────────────────────────────────────
// ★ §17-17 — 바이옴 첫 발견 (설산·밀림)
// ────────────────────────────────────────────────────────────────
/**
 * 아바타·동료가 **선 칸**이 처음 보는 지형이면 그날을 적고 한 번의 몫을 준다(지형마다 한 번뿐).
 * 안개가 걷힌 땅 전체를 훑지 않는 까닭: 발견은 '멀리서 본 것'이 아니라 '걸어 들어간 것'이기 때문이고,
 * 걸음마다 부르는 자리라 size² 를 훑으면 값이 감당되지 않는다.
 * @returns {Array<{code,name,text,morale,tick}>} 이번에 처음 밟은 지형들
 */
export function discoverBiomes(world, nation, data, tick = 0) {
  const cfg = biomeCfg(data);
  if (!cfg || !nation?.isPlayer) return [];
  const seen = (nation.biomesSeen ||= {});
  const out = [];
  for (const a of Object.values(nation.avatars || {})) {
    const code = terrainNameAt(world.map, Math.round(a.x), Math.round(a.y), data);
    if (!code || seen[code] != null) continue;
    if (!(cfg.codes || []).includes(code)) continue;
    seen[code] = tick;
    out.push(rewardBiome(world, nation, data, code, tick));
  }
  return out;
}

/** 첫 발견의 몫 — 연대기 한 줄 + 사기 한 번. 수치와 문구는 전부 자료(terrain.biomes.discovery)다. */
function rewardBiome(world, nation, data, code, tick) {
  const d = biomeCfg(data).discovery || {};
  const name = data.world.terrain.names?.[code] ?? code;
  const text = d.text?.[code] ?? name;
  const gain = d.morale ?? 0;
  const m = data.balance.morale;
  nation.morale = Math.max(m.min, Math.min(m.max, (nation.morale || 0) + gain));
  record(world, { kind: 'discovery', title: d.title ?? name, text, data: { biome: code } }, data);
  return { code, name, text, morale: gain, tick };
}

// ────────────────────────────────────────────────────────────────
// 뷰 — state.codex (PROTOCOL v3.2)
// ────────────────────────────────────────────────────────────────
/**
 * 종별 카드. **잠긴 층은 필드 자체가 없다** — 화면이 회색 글씨로라도 흘리지 못하게 한다
 * (§11-1 「잠긴 계층은 비활성이 아니라 부재다」의 도감판).
 */
/**
 * ★ §20-R3 유물 층 (유물기획 §20-8) — 4단. **잠긴 단은 필드 자체가 없다**(§11-1).
 *   0 미발견   : 실루엣 + 등급색 + hint 1줄 (「이 세계 어딘가에 있다」)
 *   1 방에서 발견: 이름·등급 (등록부에 이름이 올랐다)
 *   2 우리가 보유: 효과 전문 + lore 전문
 *   3 기록      : 최초 발견자·발견 날·획득 횟수·지금 누가 지녔나
 * 「왜」 서버가 자르나 — 규격(/api/config)에는 이름도 lore 도 없다(publicArtifacts).
 *   여기서 단을 세지 않으면 화면은 영영 그것을 알 길이 없다. 그것이 이 층의 값이다.
 */
export function artifactCodexView(world, nation, data) {
  const reg = world?.artifactRegistry || {};
  const owned = new Map((nation.artifacts || []).map((a) => [a.key, a]));
  const cards = data.artifacts.list.map((def) => artifactCard(def, reg[def.key], owned.get(def.key), data));
  return {
    cards,
    // 레전더리는 목록 맨 위 별도 단에 크게 — 미발견이어도 실루엣이 보여 목표가 된다
    crownGrade: 'legendary',
    totals: { found: cards.filter((c) => c.tier >= 1).length, owned: owned.size, total: cards.length },
  };
}

function artifactCard(def, reg, own, data) {
  const tier = own ? (own.foundDate ? 3 : 2) : (reg ? 1 : 0);
  const g = data.artifacts.grades[def.grade] ?? {};
  const card = { key: def.key, grade: def.grade, category: def.category, type: def.type,
                 color: g.color ?? null, tier };
  if (tier === 0) return { ...card, hint: def.hint ?? null };
  card.name = def.name;
  if (own) Object.assign(card, { desc: def.desc, lore: def.lore ?? null, owned: true,
    consumed: Boolean(own.consumed), chargesLeft: own.chargesLeft ?? null });
  if (reg) card.record = artifactRecord(reg, own);
  return card;
}

/** 3단 — 기록. 발견자를 모르는 옛 세이브는 이름 칸이 **없다**(지어내지 않는다) */
function artifactRecord(reg, own) {
  const rec = { firstFoundTick: reg.firstFoundTick ?? null, firstFoundDate: reg.firstFoundDate ?? null,
                count: reg.count ?? 1 };
  if (reg.firstFoundBy) rec.firstFoundBy = reg.firstFoundBy;
  if (own?.foundDate) rec.myFoundDate = own.foundDate;
  if (own?.foundRealAt) rec.myFoundRealAt = own.foundRealAt;
  return rec;
}

export function codexView(nation, data, world = null) {
  const cfg = creatureCfg(data).codex;
  const defs = creatureDefs(data);
  const order = data.creatures.order;
  const species = order.map((key) => {
    const def = defs[key];
    const st = speciesStat(nation, key);
    const card = {
      key,
      kind: def.kind,
      ring: def.ring,
      encounters: st.encounters,
      kills: st.kills,
      known: st.encounters >= (cfg.nameAt ?? 1),
      // 층 셋 중 어디까지 열렸는지 — 화면이 진행바를 그린다
      next: st.encounters < (cfg.nameAt ?? 1)
        ? { what: 'name', need: cfg.nameAt ?? 1, have: st.encounters, unit: '조우' }
        : (st.kills < (cfg.statsAt ?? 5)
          ? { what: 'stats', need: cfg.statsAt ?? 5, have: st.kills, unit: '처치' }
          : (st.kills < (cfg.loreAt ?? 20)
            ? { what: 'lore', need: cfg.loreAt ?? 20, have: st.kills, unit: '처치' }
            : null)),
    };
    if (st.encounters >= (cfg.nameAt ?? 1)) {
      card.name = def.name;
      card.habitat = def.habitatName ?? (def.habitat || []).join('·');
    }
    if (st.kills >= (cfg.statsAt ?? 5)) {
      card.stats = { hp: def.hp, speed: def.speed, dps: def.dps ?? 0, aggroRadius: def.aggroRadius ?? 0 };
      card.drops = Object.entries(def.drops || {}).map(([res, n]) => ({
        resource: res, amount: n, name: data.resources.meta[res]?.name ?? res,
      }));
    }
    if (st.kills >= (cfg.loreAt ?? 20)) card.lore = def.lore ?? null;
    return card;
  });

  const ruins = Object.values(ensureCodex(nation).ruins)
    .sort((a, b) => (b.size - a.size) || ((a.foundTick ?? 0) - (b.foundTick ?? 0)))
    .map((r) => ({ ...r }));

  return {
    thresholds: { name: cfg.nameAt ?? 1, stats: cfg.statsAt ?? 5, lore: cfg.loreAt ?? 20 },
    species,
    ruins,
    // ★ §20-R3 — 유물 탭. world 를 못 받는 옛 호출에서는 필드 자체가 없다(§11-1).
    ...(world ? { artifacts: artifactCodexView(world, nation, data) } : {}),
    totals: {
      seen: species.filter((s) => s.encounters > 0).length,
      total: species.length,
      killed: species.reduce((a, s) => a + s.kills, 0),
      ruinsFound: ruins.length,
      ruinsExplored: ruins.filter((r) => (r.cycles || 0) > 0).length,
    },
  };
}
