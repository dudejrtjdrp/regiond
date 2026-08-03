// 결정론적 시드 RNG. 시뮬레이터가 같은 seed로 같은 결과를 재현해야 한다.

export function createRng(seed = 1) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    seed,
    next,
    float: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(entries) {
      // entries: [{ value, weight }]
      const total = entries.reduce((s, e) => s + e.weight, 0);
      if (total <= 0) return entries.length ? entries[0].value : null;
      let r = next() * total;
      for (const e of entries) {
        r -= e.weight;
        if (r <= 0) return e.value;
      }
      return entries[entries.length - 1].value;
    },
    getState: () => state,
    setState: (s) => { state = s >>> 0; },
  };
  return rng;
}

export function rngFromState(seed, state) {
  const r = createRng(seed);
  if (typeof state === 'number') r.setState(state);
  return r;
}
