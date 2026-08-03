// 저장 — saves/{gameId}/snapshot.json + events.jsonl (SPEC D9 / §14)
// 인터페이스를 좁게 유지해 나중에 SQLite/Postgres 로 교체할 수 있게 한다.
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * 저장 위치. 환경변수로 바꿀 수 있다 (테스트·컨테이너 배포용).
 * ESM 임포트 순서와 무관하도록 지연 평가한다.
 *   · GALLAEMALLAE_SAVES_DIR — 테스트·하니스가 임시 폴더를 꽂을 때 쓰는 이름(우선)
 *   · SAVES_DIR              — 배포에서 쓰는 짧은 이름 (예: Render 디스크 마운트 /var/data)
 *
 * ★ Render 무료 플랜은 디스크가 휘발성이다 — 컨테이너가 다시 뜨면(배포·슬립 복귀·재시작)
 *   이 폴더는 빈 채로 시작한다. 즉 세이브가 사라진다. 세이브를 남기려면
 *   유료 플랜 + 영구 디스크(Persistent Disk)를 붙이고 SAVES_DIR 을 그 마운트 경로로 준다.
 */
export function savesDir() {
  return process.env.GALLAEMALLAE_SAVES_DIR || process.env.SAVES_DIR || join(here, '..', 'saves');
}

function gameDir(gameId) { return join(savesDir(), gameId); }

export function ensureGameDir(gameId) {
  const dir = gameDir(gameId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveSnapshot(state, { historyEveryTicks = 7 } = {}) {
  const dir = ensureGameDir(state.gameId);
  const tmp = join(dir, 'snapshot.tmp.json');
  const target = join(dir, 'snapshot.json');
  writeFileSync(tmp, JSON.stringify(state), 'utf8');
  renameSync(tmp, target);
  if (historyEveryTicks > 0 && state.tick % historyEveryTicks === 0) {
    writeFileSync(join(dir, `snapshot.t${state.tick}.json`), JSON.stringify(state), 'utf8');
  }
  return target;
}

export function loadSnapshot(gameId) {
  const f = join(gameDir(gameId), 'snapshot.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

export function appendEvents(gameId, events) {
  if (!events?.length) return 0;
  const dir = ensureGameDir(gameId);
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(join(dir, 'events.jsonl'), lines, 'utf8');
  return events.length;
}

export function readEvents(gameId, { sinceTick = -1, limit = 500 } = {}) {
  const f = join(gameDir(gameId), 'events.jsonl');
  if (!existsSync(f)) return [];
  const out = [];
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.tick > sinceTick) out.push(e);
    } catch { /* 손상 라인 무시 */ }
  }
  return out.slice(-limit);
}

export function listGames() {
  const dir = savesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const s = loadSnapshot(d.name);
      return s ? { gameId: d.name, tick: s.tick, phase: s.phase, createdAt: s.createdAt } : null;
    })
    .filter(Boolean);
}
