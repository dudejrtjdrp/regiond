// 저장 — saves/{gameId}/snapshot.json + events.jsonl (SPEC D9 / §14)
// 인터페이스를 좁게 유지해 나중에 SQLite/Postgres 로 교체할 수 있게 한다.
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, readdirSync, renameSync, statSync,
} from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// ★ Sprint 3 — 매직넘버 금지. 저장 다이얼도 data/world.json(simulation) 이 정본이다.
import { loadGameData } from './engine/data.js';
/* ★ §21-A3 — 안개 마스크는 런타임에서 Uint8Array 다. JSON 은 그것을 {"0":0,"1":0,…} 로 굳혀
   파일을 열 배로 부풀리므로, **파일 경계에서만** 옛 문자열 포맷으로 갈아 끼운다.
   덕분에 세이브 파일의 생김새는 이 작업 전과 한 글자도 다르지 않다(옛 세이브도 그대로 열린다). */
import { packFogMasks, toRuntimeFog } from './engine/fog.js';

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

/** ★ Sprint 3 — 서버 살림 다이얼(data/world.json simulation). 없으면 옛 기본값으로 물러선다. */
const serverCfg = () => {
  try { return loadGameData().world.simulation ?? {}; } catch { return {}; }
};

/**
 * ★ Sprint 3 — 이력 스냅샷(snapshot.t{N}.json)을 **틱 하나에 한 번만** 남긴다.
 *
 * 옛 조건(`tick % historyEveryTicks === 0`)은 「그 날인가」만 물었다. 그런데 저장은 하루에 한 번이
 * 아니라 사건마다 불렸으므로, 이력 파일에 걸리는 게임일이 오면 **그 하루 내내** 같은 파일을
 * 1.5MB 씩 몇백 번 다시 썼다. 마지막으로 남긴 틱을 적어 두는 한 줄이 그 전부를 막는다.
 * @type {Map<string, number>}
 */
const lastHistoryTick = new Map();

function historyPath(dir, state, historyEveryTicks) {
  if (!(historyEveryTicks > 0)) return null;
  if (state.tick % historyEveryTicks !== 0) return null;
  if (lastHistoryTick.get(state.gameId) === state.tick) return null;
  lastHistoryTick.set(state.gameId, state.tick);
  return join(dir, `snapshot.t${state.tick}.json`);
}

/**
 * 동기 저장 — **잃으면 안 되는 마디**만 쓴다(일 틱 정산 · 전투 종료 · 건국).
 * 사건마다 부르던 자리는 markDirty 로 옮겼다(아래 주석 참고).
 */
export function saveSnapshot(state, { historyEveryTicks = 7 } = {}) {
  const dir = ensureGameDir(state.gameId);
  const tmp = join(dir, 'snapshot.tmp.json');
  const target = join(dir, 'snapshot.json');
  const json = JSON.stringify(packFogMasks(state));
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, target);
  const hist = historyPath(dir, state, historyEveryTicks);
  if (hist) writeFileSync(hist, json, 'utf8');
  // 이미 다 썼으니 밀린 예약은 없던 일로 — 같은 내용을 한 번 더 쓸 까닭이 없다
  cancelPending(state.gameId);
  return target;
}

// ────────────────────────────────────────────────────────────────
// ★ Sprint 3 — 미룬 저장 (사건 경로에서 동기 파일쓰기를 걷어낸다)
//
// 늑대가 물면 사건이 하나 난다. 초에 한두 번이다. 그때마다 세상 전부를 JSON 으로 굳혀
// (1.5~2MB) 디스크에 **동기로** 쓰고 있었다 — 그 사이 이벤트 루프는 통째로 멎는다.
// 짐승도 주민도 동료도 그 순간에는 아무도 걷지 않는다. 그것이 "가끔 뚝뚝 끊긴다"의 정체다.
//
// 이제 사건은 「더러워졌다」고 표시만 남긴다. saveDebounceSeconds 뒤에 **비동기로 한 번** 쓴다.
// 그 사이에 사건이 백 번 나도 파일쓰기는 한 번이다. 임시 파일 → 이름 바꾸기(원자적 교체)는 그대로다.
// 임시 파일 이름을 동기 저장과 갈라 둔 까닭: 두 저장이 겹쳐도 서로의 반쪽을 덮어쓰지 않게 하기 위해서다.
// ────────────────────────────────────────────────────────────────
/** @type {Map<string, {state:object, opts:object, timer:any}>} */
const pending = new Map();

function cancelPending(gameId) {
  const e = pending.get(gameId);
  if (!e) return false;
  clearTimeout(e.timer);
  pending.delete(gameId);
  return true;
}

/** 비동기 저장 — 미룬 저장이 실제로 파일을 쓰는 문 */
export async function saveSnapshotAsync(state, { historyEveryTicks = 7 } = {}) {
  const dir = ensureGameDir(state.gameId);
  const tmp = join(dir, 'snapshot.async.tmp.json');
  const target = join(dir, 'snapshot.json');
  const json = JSON.stringify(packFogMasks(state));
  await writeFile(tmp, json, 'utf8');
  await rename(tmp, target);
  const hist = historyPath(dir, state, historyEveryTicks);
  if (hist) await writeFile(hist, json, 'utf8');
  return target;
}

/**
 * 「바뀌었다」고만 적어 둔다. 실제 쓰기는 saveDebounceSeconds 뒤에 한 번.
 * @returns {boolean} 이번에 새 예약을 걸었는가(이미 밀려 있으면 false — 상태만 최신으로 바꾼다)
 */
export function markDirty(state, opts = {}) {
  if (!state?.gameId) return false;
  const has = pending.get(state.gameId);
  if (has) { has.state = state; has.opts = opts; return false; }
  const sec = Number(serverCfg().saveDebounceSeconds ?? 5);
  const timer = setTimeout(() => {
    // 실패해도 서버를 세우지 않는다 — 다음 일 틱의 동기 저장이 어차피 같은 세상을 다시 쓴다
    flushDirty(state.gameId).catch((e) => console.error('[saves] 미룬 저장 실패:', e));
  }, Math.max(0, sec) * 1000);
  // 이 타이머 하나 때문에 프로세스가 안 꺼지는 일은 없어야 한다(테스트 하니스가 그대로 매달린다)
  if (typeof timer.unref === 'function') timer.unref();
  pending.set(state.gameId, { state, opts, timer });
  return true;
}

/** 밀린 저장을 지금 당장 — 종료·전환처럼 「여기서 확실히 남겨야 하는」 자리가 쓴다 */
export async function flushDirty(gameId) {
  const e = pending.get(gameId);
  if (!e) return null;
  clearTimeout(e.timer);
  pending.delete(gameId);
  return saveSnapshotAsync(e.state, e.opts);
}

/** 지금 저장이 밀려 있는가 (진단·시험용) */
export const isDirty = (gameId) => pending.has(gameId);

export function loadSnapshot(gameId) {
  const f = join(gameDir(gameId), 'snapshot.json');
  if (!existsSync(f)) return null;
  try { return unpackFog(JSON.parse(readFileSync(f, 'utf8'))); } catch { return null; }
}

/** ★ §21-A3 — 읽기 쪽 짝. migrateWorld 도 같은 일을 하지만, 그쪽은 migrationRev 표를 보고
 *  건너뛸 수 있다 — 파일에서 막 꺼낸 세상은 여기서 확실히 런타임 모양이 된다. */
function unpackFog(state) {
  for (const nation of Object.values(state?.nations || {})) {
    toRuntimeFog(nation.fog);
    /* 옛 세이브 청소 — 한때 research.js 가 칸 집합(Set)을 나라에 얹어 두었고, JSON 이 그것을
       `{}` 로 굳혀 파일에 실었다. 되읽으면 `.has` 없는 빈 객체라 첫 걸음에서 서버가 죽었다.
       캐시는 이제 WeakMap 에 산다(research.js TILE_SETS) — 남은 찌꺼기는 여기서 털어 낸다. */
    for (const k of ['_railSet', '_railStamp', '_bridgeSet', '_bridgeStamp', '_fillSet', '_fillStamp']) {
      delete nation[k];
    }
  }
  return state;
}

/**
 * ★ Sprint 3 — 사건 기록이 무한정 자라지 않게 한 번만 밀어 둔다.
 * 파일이 eventsLogMaxBytes 를 넘으면 events.jsonl → events.jsonl.1 로 옮기고 새로 시작한다.
 * 밀어 둔 것을 또 밀지는 않는다(.1 은 다음 회전에 그냥 덮인다) — 사건 기록은 연출·디버그용이고,
 * 판정에 쓰이는 것은 스냅샷이지 이 파일이 아니다.
 * @returns {boolean} 이번에 밀었는가
 */
function rotateEvents(file) {
  const max = Number(serverCfg().eventsLogMaxBytes ?? 5000000);
  if (!(max > 0)) return false;
  let size = 0;
  try { size = statSync(file).size; } catch { return false; }   // 아직 없는 파일
  if (size < max) return false;
  try { renameSync(file, `${file}.1`); } catch { return false; }
  return true;
}

export function appendEvents(gameId, events) {
  if (!events?.length) return 0;
  const dir = ensureGameDir(gameId);
  const file = join(dir, 'events.jsonl');
  rotateEvents(file);
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  appendFileSync(file, lines, 'utf8');
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
