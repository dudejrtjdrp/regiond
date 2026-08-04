// 주민 능력치 — docs/GDD3.md §13-D-1. 사람마다 다른 네 수치: 근면·힘·손재주·용기.
//
// 설계의 뼈대 하나: **평균이 밸런스에 중립이어야 한다.**
//   능력치는 주사위 셋의 평균이라 1~10 위에 종형으로 놓이고, 그 평균은 정확히 5.5 다
//   (sum 이 16.5 를 축으로 대칭이고 round(sum/3) 이 v ↔ 11−v 로 짝지어진다).
//   산출 배수는 (능력치 − mid) 에 **선형**이고 최대 편차가 ±18% 라 상한(cap ±20%)에 걸리지 않는다.
//   따라서 사람이 여럿 모이면 배수의 평균은 정확히 1.0 이고, 시뮬 체크포인트는 흔들리지 않는다.
//   한 사람 한 사람은 눈에 띄게 다르되, 마을 전체의 곡선은 그대로다 — 그것이 이 계층의 약속이다.
import { clamp, round2, round3 } from './economy.js';

export const statsCfg = (data) => data.balance.residents.stats;
export const STAT_KEYS = (data) => statsCfg(data).order;

/**
 * 글자열 하나를 씨앗 숫자로 — 같은 사람은 언제 굴려도 같은 능력치를 얻는다.
 * ★ 이것이 있어야 **세계 난수를 축내지 않고** 사람마다 다른 값을 줄 수 있다(statRng 참고).
 */
export function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i += 1) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/**
 * 능력치 한 벌을 굴린다 — 주사위 rolls 개의 평균(가중 정규).
 * ★ 난수는 부르는 쪽이 준다. **세계 난수를 주면 안 된다** — §13-C 에서 이미 겪은 사고다:
 *   난수를 한 톨이라도 축내면 웨이브 구성·사건·이름이 통째로 밀려 같은 씨앗의 밸런스가 어긋난다
 *   (실측: 세계 난수를 쓰자 웨이브5 생존율이 60% → 45% 로 움직였다. 값이 나빠진 게 아니라
 *    **다른 게임**이 된 것이다). 그래서 spawnResident 는 statRng 로 제 씨앗을 지어 쓴다.
 */
export function rollStats(rng, data) {
  const cfg = statsCfg(data);
  const out = {};
  for (const key of cfg.order) {
    let sum = 0;
    for (let i = 0; i < cfg.rolls; i += 1) sum += rng.int(cfg.min, cfg.max);
    out[key] = Math.round(sum / cfg.rolls);
  }
  return out;
}

/** 이 사람 전용 난수 — 세계 난수를 건드리지 않는다 */
export function statRng(seedText) {
  let state = seedFrom(seedText);
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (a, b) => Math.floor(a + next() * (b - a + 1)) };
}

/** 능력치가 없는 사람(옛 세이브·손으로 만든 시험용)에게 평균치를 채워 준다 */
export function ensureStats(u, data, rng = null) {
  if (!u) return null;
  const cfg = statsCfg(data);
  if (!u.stats || cfg.order.some((k) => !Number.isFinite(u.stats[k]))) {
    u.stats = rng ? rollStats(rng, data) : Object.fromEntries(cfg.order.map((k) => [k, Math.round(cfg.mid)]));
  }
  return u.stats;
}

export const statOf = (u, key, data) => {
  const cfg = statsCfg(data);
  const v = Number(u?.stats?.[key]);
  return Number.isFinite(v) ? clamp(v, cfg.min, cfg.max) : cfg.mid;
};

/**
 * 가중치표 하나로 배수를 낸다 — 1 + perPoint × Σ(w × (능력치 − mid)), 상한 ±cap.
 * ★ 가중치 합이 1 이면 최대 편차는 perPoint × (max − mid) 다. 그 규약을 부르는 쪽이 지킨다.
 */
export function factorFrom(u, weights, data, perPoint = null) {
  const cfg = statsCfg(data);
  const per = perPoint ?? cfg.perPoint;
  let acc = 0;
  for (const [key, w] of Object.entries(weights || {})) acc += w * (statOf(u, key, data) - cfg.mid);
  return round3(clamp(1 + per * acc, 1 - cfg.cap, 1 + cfg.cap));
}

/**
 * 산출 배수 — 손재주(수확)와 근면(작업 속도)이 반, 야외에서는 용기가 근면 몫을 나눠 든다.
 * @param {boolean} outdoor 이 사람이 붙은 자리가 영토 밖인가
 */
export function yieldFactor(u, data, outdoor = false) {
  const cfg = statsCfg(data);
  const w = { ...cfg.yieldWeights };
  if (outdoor) {
    /* 야외 몫은 **근면에서 덜어 온다.** 가중치 합이 1 로 유지되어야 최대 편차가 ±18% 로 묶이고,
       평균 5.5 에서 배수가 정확히 1.0 이 된다 — 이 계층이 밸런스에 중립인 유일한 까닭이다. */
    for (const [k, v] of Object.entries(cfg.outdoorWeight || {})) {
      w.diligence = Math.max(0, (w.diligence || 0) - v);
      w[k] = (w[k] || 0) + v;
    }
  }
  return factorFrom(u, w, data);
}

/**
 * 민병 체력 배수(용기 중심) · 피해 배수(힘 중심).
 *
 * ★ 두 가지가 산출과 다르다. ① 몫이 절반이다(perPoint 0.02) ② 두 능력치를 0.7/0.3 으로 섞는다.
 *   **평균이 1.0 인 것만으로는 전투에서 중립이 되지 않기 때문이다.** 민병이 버티는 시간은 포화한다 —
 *   체력이 남아돌아도 전투가 끝나면 그만이고, 모자라면 쓰러져 한동안 통째로 빠진다. 오목한 함수 위에서
 *   평균 보존 확산은 언제나 손해라, 흩어짐이 크면 마을 전체가 조금씩 손해를 본다
 *   (실측: 각각 온전히 얹었더니 웨이브5 생존율 60% → 55%. 흩어짐을 1/4 로 줄여 되돌렸다).
 *   체력×피해의 최대 편차는 그래도 ±18.8% 라 스펙(±20%)을 넘지 않는다.
 */
function militiaWeights(main, other, cross) {
  return { [main]: 1 - cross, [other]: cross };
}
export function militiaHpFactor(u, data) {
  const m = statsCfg(data).militia;
  return factorFrom(u, militiaWeights(m.hp, m.dps, m.crossWeight ?? 0), data, m.perPoint);
}
export function militiaDpsFactor(u, data) {
  const m = statsCfg(data).militia;
  return factorFrom(u, militiaWeights(m.dps, m.hp, m.crossWeight ?? 0), data, m.perPoint);
}

/**
 * 운반 배수(힘) — **화면의 몫이다.** 힘센 사람은 한 번에 더 지고 덜 오간다.
 * 하루 산출은 건드리지 않는다(그래서 밸런스에 닿지 않는다): 나르는 횟수와 한 짐의 크기만 바뀐다.
 */
export function haulFactor(u, data) {
  const cfg = statsCfg(data);
  const span = cfg.haulSpan ?? 0.4;
  const t = (statOf(u, cfg.haulStat ?? 'strength', data) - cfg.min) / Math.max(1, cfg.max - cfg.min);
  return round2(1 - span / 2 + span * t);
}

/** 이 직업에 잘 맞는 능력치들 (주민 패널의 초록 테) */
export const jobFitStats = (job, data) => [...(statsCfg(data).jobFit?.[job] || [])];

/** 이 사람이 이 일에 적임인가 — 적합 능력치 중 하나라도 fitThreshold 이상 */
export function jobFit(u, job, data) {
  const cfg = statsCfg(data);
  const keys = jobFitStats(job, data);
  if (!keys.length) return { fit: false, keys: [], best: null };
  let best = null;
  for (const k of keys) {
    const v = statOf(u, k, data);
    if (!best || v > best.value) best = { key: k, value: v };
  }
  return { fit: (best?.value ?? 0) >= cfg.fitThreshold, keys, best };
}

/** 가장 뛰어난 능력치 — 도착 카드의 한 줄 */
export function topStat(u, data) {
  let best = null;
  for (const k of STAT_KEYS(data)) {
    const v = statOf(u, k, data);
    if (!best || v > best.value) best = { key: k, value: v, name: statsCfg(data).defs[k]?.name ?? k };
  }
  return best;
}

/** 뷰용 한 벌 — 이름·설명까지 붙여 화면이 표를 따로 들지 않게 한다 */
export function statsView(u, data) {
  const cfg = statsCfg(data);
  return {
    values: Object.fromEntries(cfg.order.map((k) => [k, statOf(u, k, data)])),
    yieldFactor: yieldFactor(u, data, false),
    outdoorFactor: yieldFactor(u, data, true),
    haulFactor: haulFactor(u, data),
    top: topStat(u, data),
  };
}

/** 공개본 — 화면이 이름·설명·눈금을 그릴 표 (수치는 사람마다 state 로 간다) */
export function publicStats(data) {
  const cfg = statsCfg(data);
  return {
    order: [...cfg.order],
    defs: Object.fromEntries(cfg.order.map((k) => [k, { ...cfg.defs[k] }])),
    min: cfg.min, max: cfg.max, mid: cfg.mid,
    perPoint: cfg.perPoint, cap: cfg.cap,
    fitThreshold: cfg.fitThreshold,
    jobFit: Object.fromEntries(Object.entries(cfg.jobFit || {})
      .filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, [...v]])),
  };
}
