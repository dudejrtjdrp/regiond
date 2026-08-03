// 난이도 프리셋 조회 — docs/GAMEPLAY2.md §A-1. 순수 함수, 의존 없음(순환 임포트 방지).

/** 유효한 난이도 키인지 */
export function isDifficultyKey(key, data) {
  return Boolean(key && data.difficulty?.presets?.[key]);
}

/** join 에서 받은 값을 정규화한다. 모르는 값은 기본 난이도로 떨어뜨린다. */
export function normalizeDifficulty(key, data) {
  return isDifficultyKey(key, data) ? key : data.difficulty.default;
}

/**
 * world.difficulty → 프리셋 객체.
 * 옛 스냅샷(난이도 없음)은 기본 난이도('왕국')로 읽힌다 — 하위 호환.
 */
export function difficultyPreset(world, data) {
  const key = normalizeDifficulty(world?.difficulty, data);
  return data.difficulty.presets[key];
}

/** NationView 에 싣는 공개 요약 */
export function difficultyView(world, data) {
  const p = difficultyPreset(world, data);
  return { key: p.key, name: p.name, desc: p.desc };
}
