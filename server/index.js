// 갈래말래 서버 — express 정적 서빙 + socket.io + REST 디버그 API
// 서버 권위: 클라이언트는 표시와 명령 제출만 한다.
// ★ PROTOCOL v3 (엔드리스 정착지): 일 틱(경제 정산)과 실시간(스윙·전투 서브틱)을 분리한다.
//   · 일 틱      — tickRealSeconds(기본 600초 = 1게임일) 마다 step()
//   · 실시간     — actionSwing/combatSwing/lordMove 는 소켓에서 즉시 처리(ack 로 결과 반환)
//   · 서브틱     — 웨이브 전투 중에만 도는 별도 타이머(battleTick 스트림)
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { loadGameData, publicConfig } from './engine/data.js';
import { createWorld, migrateWorld } from './engine/state.js';
import { createRng, rngFromState } from './engine/rng.js';
import { step } from './engine/tick.js';
import { applyCommand } from './engine/commands.js';
import {
  buildNationView, buildWorldState, buildWorldSnapshot, buildWorldDiff, buildRevealDiff,
} from './engine/view.js';
import { buildRegencyReport, markSeen } from './engine/report.js';
import { evaluateProgress } from './engine/progression.js';
import { roleSummary } from './engine/npc.js';
import { ensurePlayer } from './engine/skills.js';
import { stepBattle, finishBattle, battleSnapshot } from './engine/battle.js';
// ★ GDD3 §13-C — 상시 생태계. 일 틱도 전투 서브틱도 아닌 제 박자로 돈다.
import { stepEcology, ensureCreatures, creatureViews } from './engine/ecology.js';
// ★ GDD3 §14-1 — 주민의 작업 사이클도 그 박자에 편승한다(즉시 크레딧 + 그 자리 수치).
import { stepResidentWork } from './engine/residents.js';
// ★ GDD3 §15-C — 동료 봇(= 각료). 같은 1초 박자에 두뇌를 굴리고 아바타 채널로 자리를 흘린다.
import { stepCompanions, syncCompanionSeats, bindCompanionRoles, isCompanionId } from './engine/companions.js';
// ★ §17-14 — 깃발 점령. 동료가 자리 잡은 다음 같은 1초 박자에 판정한다.
import { claimStep } from './engine/claims.js';
import { stampVisionDisc } from './engine/fog.js';
import { chronicleView, record as chronicleRecord } from './engine/chronicle.js';
import {
  upsertMember as upsertMemberEntry, normalizeAppearance, defaultAppearance, chatHistory,
} from './engine/social.js';
import { saveSnapshot, loadSnapshot, appendEvents, listGames, savesDir } from './persistence.js';
import { ExpressionQueue } from './expression/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', 'public');
const data = loadGameData();

// ── 환경 (배포: docs/DEPLOY.md) ────────────────────────────────
//   PORT — 플랫폼(Render 등)이 꽂아 주는 문 번호. 없으면 3000.
//   HOST — 0.0.0.0 이어야 컨테이너 바깥에서 들어올 수 있다(localhost 로 묶으면 헬스체크가 실패한다).
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
})();

/**
 * ★ 규약 판번호 (docs/PROTOCOL.md). 클라이언트(public/js/state.js 의 GM.PROTOCOL)와 반드시 같아야 한다.
 *   서버가 낡아서 새 이벤트를 못 보내는 상황을 화면이 스스로 알아채는 손잡이다.
 */
const PROTOCOL = '3.3';

/**
 * ★ 개발용 뒷문(`/api/debug/*`)의 자물쇠.
 *   · 기본 — 운영(NODE_ENV=production)에서는 통째로 404. 그 밖(개발·테스트)에서는 열려 있다.
 *   · DEBUG_API=1 을 주면 운영에서도 강제로 연다(임시 점검용 — 끝나면 반드시 되돌릴 것).
 *   · DEBUG_API=0 이면 개발에서도 닫는다.
 *   요청마다 값을 다시 읽는다 — 테스트가 NODE_ENV 를 바꿔 끼우기 때문이다.
 */
function debugApiEnabled() {
  const forced = String(process.env.DEBUG_API ?? '').trim().toLowerCase();
  if (forced === '1' || forced === 'true' || forced === 'on') return true;
  if (forced === '0' || forced === 'false' || forced === 'off') return false;
  return process.env.NODE_ENV !== 'production';
}

const app = express();
app.disable('x-powered-by');      // 서버가 무엇으로 지어졌는지 굳이 알릴 이유가 없다
// ★ Render·대부분의 PaaS 는 프록시 뒤에 둔다 — 원래 프로토콜/주소를 프록시 머리글에서 읽는다.
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
}));
const http = createServer(app);
// ★ 프록시 뒤(Render 등)에서도 그대로 돈다 — 소켓은 같은 출처(`/socket.io`)로 붙고,
//   폴링으로 먼저 손을 잡은 뒤 웹소켓으로 갈아탄다(플랫폼이 업그레이드를 통과시킨다).
//   갈아타지 못하는 망에서는 폴링으로 계속 논다 — 그래서 transports 를 좁히지 않는다.
const io = new Server(http, { cors: { origin: '*' } });

// ────────────────────────────────────────────────────────────────
// 게임 런타임
// ────────────────────────────────────────────────────────────────
class GameRuntime {
  constructor(gameId, world) {
    this.gameId = gameId;
    this.world = world;
    this.rng = rngFromState(world.seed, world.rngState);
    this.timer = null;
    this.battleTimer = null;
    this.tickRealSeconds = data.balance.time.tickRealSeconds;
    this.subtickSeconds = data.waves.battle.subtickSeconds;
    this.pendingInputs = [];
    this.expression = new ExpressionQueue({
      data,
      onText: (event) => io.to(this.gameId).emit('events', [event]),
    });
  }

  start() {
    this.stop();
    if (this.world.paused) return;
    this.timer = setInterval(() => this.advance(), this.tickRealSeconds * 1000);
    this.ensureBattleLoop();
    this.startEcologyLoop();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.stopEcologyLoop();
  }

  // ── 생태계 저빈도 루프 (GDD3 §13-C) ──────────────────────────
  /**
   * 1초에 한 번 들의 것들을 굴리고 그 자리를 방에 흘린다.
   * 일 틱(10분)에 얹으면 짐승이 10분에 한 칸씩 움직이고, 전투 서브틱(0.25초)에 얹으면
   * 아무 일도 없는 들판 때문에 초당 네 번을 방송하게 된다 — 그 사이가 여기다.
   * 화면은 받은 좌표로 튀지 않고 **그리로 다가간다**(보간). 그래서 1초 간격이 끊겨 보이지 않는다.
   */
  startEcologyLoop() {
    this.stopEcologyLoop();
    const sec = data.creatures?.sim?.stepSeconds ?? 1;
    this.ecologyTimer = setInterval(() => this.ecologyStep(sec), sec * 1000);
  }

  stopEcologyLoop() {
    if (this.ecologyTimer) { clearInterval(this.ecologyTimer); this.ecologyTimer = null; }
  }

  ecologyStep(dt) {
    for (const nation of Object.values(this.world.nations)) {
      if (!nation.isPlayer) continue;
      // 아무도 안 보고 있으면 굴리지 않는다 — 일 틱이 하루치를 몰아서 처리한다
      const watching = [...sessions.values()].some((s) => s.gameId === this.gameId && s.nationId === nation.id);
      if (!watching) continue;
      ensureCreatures(this.world, nation, data);
      const { events, shots, kills } = stepEcology(this.world, nation, data, dt);
      const painful = events.filter((e) => e.kind === 'player_down' || e.kind === 'wild_hit' || e.kind === 'player_revived');
      if (painful.length) this.emitImmediate(nation.id, painful);
      /* ★ GDD3 §15-A — 터렛이 쏜 발과 잡은 것. 짐승 좌표와 **같은 박자**로 흘려보낸다:
         화면이 두 채널을 맞물릴 필요 없이, 받은 그 순간의 좌표로 궤적을 그린다. */
      io.to(this.gameId).emit('creatures', {
        tick: this.world.tick,
        list: creatureViews(this.world, nation, data),
        shots: shots && shots.length ? shots : undefined,
      });
      /* ★ §15-A-2 — 처치 드롭은 그 자리에서 국고로 들어갔다. 화면은 같은 값을 그 자리에 띄운다.
         연대기(events)에는 싣지 않는다 — 들의 것 하나가 쓰러지는 일은 나라의 사건이 아니다. */
      if (kills && kills.length) {
        io.to(this.gameId).emit('turretKill', {
          tick: this.world.tick,
          kills,
          resources: liveResources(nation),
        });
      }
      /* ★ GDD3 §14-1 — 주민의 작업 사이클. 하나가 끝날 때마다 곳간이 그 자리에서 오르고,
         화면은 같은 값을 그 사람 머리 위에 띄운다. 일 틱은 나머지만 채운다(하루 합계 불변). */
      const work = stepResidentWork(this.world, nation, data, dt);
      if (work.credits.length) {
        io.to(this.gameId).emit('residentWork', {
          tick: this.world.tick,
          credits: work.credits,
          resources: liveResources(nation),
        });
      }
      /* ★ GDD3 §15-C — 동료의 한 걸음. 사람과 같은 함수(actionSwing·huntSwing·combatSwing)를 타므로
         화면이 받는 것도 사람의 스윙과 **같은 규약**이다: 자리는 avatars, 손맛은 swing 이 나른다. */
      const crew = stepCompanions(this.world, nation, data, dt);
      if (crew.avatars) io.to(this.gameId).emit('avatars', Object.values(nation.avatars || {}));
      for (const a of crew.actions) {
        io.to(this.gameId).emit('swing', { ...a, resources: liveResources(nation) });
      }
      /* 자동 플레이가 내 발로 걸어 들어간 자리는 그 자리에서 밝아진다(동료의 걸음은 안개를 걷지 않는다) */
      if (crew.revealed.length) {
        const reveal = buildRevealDiff(this.world, nation.id, data, crew.revealed);
        if (reveal) io.to(this.gameId).emit('worldDiff', reveal);
      }
      if (crew.events.length) this.emitImmediate(nation.id, crew.events);
      /* ★ §16-6 — 집사가 착공하거나 사람을 불렀으면(stateDirty) 화면도 그 자리에서 새 판을 받는다 */
      if (crew.actions.some((a) => a.buildingDone) || crew.stateDirty) this.broadcastState();
      /* ★ §17-14 — 깃발 점령 판정. 건축가·국방대신이 깃발 무리 곁에 서면 그 1초 안에 땅이 넓어진다.
         새 땅은 그 자리에서 밝힌다(안개) — 일 틱(최대 10분)의 recomputeFog 를 기다리지 않는다. */
      const claimed = claimStep(this.world, nation, data);
      if (claimed.length) {
        this.emitImmediate(nation.id, claimed);
        for (const e of claimed) {
          const chunks = stampVisionDisc(nation, data, this.world.tick, e.data.x, e.data.y, e.data.radius + 2);
          if (chunks.length) {
            const reveal = buildRevealDiff(this.world, nation.id, data, chunks);
            if (reveal) io.to(this.gameId).emit('worldDiff', reveal);
          }
        }
        this.broadcastState();
      }
    }
  }

  setSpeed(seconds) {
    this.tickRealSeconds = Math.max(0.2, Number(seconds) || this.tickRealSeconds);
    if (this.timer) this.start();
    return this.tickRealSeconds;
  }

  setPaused(paused) {
    this.world.paused = Boolean(paused);
    if (this.world.paused) { this.stop(); this.stopBattleLoop(); } else this.start();
    return this.world.paused;
  }

  setSeed(seed) {
    this.world.seed = Number(seed) || this.world.seed;
    this.rng = createRng(this.world.seed);
    this.world.rngState = this.rng.getState();
    return this.world.seed;
  }

  queue(nationId, cmd) { this.pendingInputs.push({ nationId, cmd }); }

  /** 즉시 실행 명령(틱을 기다리지 않는 실시간 액션) */
  apply(nationId, cmd) {
    const res = applyCommand(this.world, nationId, cmd, data, this.rng);
    if (res.ok) {
      if (res.events?.length) this.emitImmediate(nationId, res.events);
      // ★ §17-7 다같이 잠자기 — 사람이 모두 잠들면 하루를 곧장 넘기고 일 틱 시계를 새로 감는다
      if (res.advanceDay) {
        this.advance();
        if (!this.world.paused) { this.stop(); this.start(); }
      }
      this.broadcastState();
    }
    return res;
  }

  emitImmediate(nationId, raw) {
    const decorated = raw.map((e) => this.expression.express(
      { tick: this.world.tick, nationId: e.nationId ?? nationId, ...e }, { nationId: e.nationId ?? nationId },
    ));
    this.world.log = [...(this.world.log || []), ...decorated].slice(-400);
    saveSnapshot(this.world);
    appendEvents(this.gameId, decorated);
    io.to(this.gameId).emit('events', decorated);
    for (const e of decorated) this.emitTypedEvent(e);
    return decorated;
  }

  advance() {
    const inputs = this.pendingInputs;
    this.pendingInputs = [];
    // ★ liveBattle — 웨이브는 '시작만' 하고 서브틱은 아래 battle 루프가 돌린다
    const { state, events } = step(this.world, inputs, this.rng, data, { liveBattle: true });
    this.world = state;

    const decorated = events.map((e) => this.expression.express(e, { nationId: e.nationId }));
    saveSnapshot(this.world);
    appendEvents(this.gameId, decorated);

    io.to(this.gameId).emit('events', decorated);
    for (const e of decorated) this.emitTypedEvent(e);
    this.broadcastState();
    this.ensureBattleLoop();
    return { state: this.world, events: decorated };
  }

  // ── 웨이브 서브틱 루프 (GDD3 §6) ─────────────────────────────
  activeBattleNation() {
    for (const nation of Object.values(this.world.nations)) {
      if (nation.battle && !nation.battle.over) return nation;
    }
    return null;
  }

  ensureBattleLoop() {
    if (this.battleTimer) return;
    if (!this.activeBattleNation()) return;
    const nation = this.activeBattleNation();
    io.to(this.gameId).emit('battleStart', battleSnapshot(nation, data));
    this.battleTimer = setInterval(() => this.battleStep(), this.subtickSeconds * 1000);
  }

  stopBattleLoop() {
    if (this.battleTimer) { clearInterval(this.battleTimer); this.battleTimer = null; }
  }

  battleStep() {
    const nation = this.activeBattleNation();
    if (!nation) { this.stopBattleLoop(); return; }
    const { events, done } = stepBattle(this.world, nation, data, this.subtickSeconds);
    io.to(this.gameId).emit('battleTick', { ...battleSnapshot(nation, data), events });
    if (!done) return;
    this.completeBattle(nation);
  }

  /** 전투 종료 정산 — 서브틱 루프와 개발용 즉시 해결(/api/debug/battle)이 함께 쓴다 */
  completeBattle(nation) {
    if (!nation?.battle) return null;
    this.stopBattleLoop();
    const result = finishBattle(this.world, nation, data);
    chronicleRecord(this.world, {
      kind: 'wave', title: `제${result.number}차 습격 — ${result.name}`,
      text: result.text, data: { won: result.won, killed: result.enemiesKilled, total: result.enemiesTotal },
    }, data);
    const ev = {
      tick: this.world.tick, kind: result.won ? 'wave_held' : 'wave_breached',
      nationId: nation.id, data: result,
    };
    // ★ 첫 웨이브를 막아 내는 것이 7장의 마지막 칸이다 — 전투가 끝난 그 자리에서 장을 넘긴다.
    const progressed = evaluateProgress(this.world, nation, data)
      .map((e) => ({ tick: this.world.tick, ...e }));
    const decorated = [ev, ...progressed].map((x) => this.expression.express(x, { nationId: nation.id }));
    this.world.log = [...(this.world.log || []), ...decorated].slice(-400);
    saveSnapshot(this.world);
    appendEvents(this.gameId, decorated);
    io.to(this.gameId).emit('events', decorated);
    io.to(this.gameId).emit('waveResult', result);
    for (const e of decorated) if (e.kind !== ev.kind) this.emitTypedEvent(e);
    this.broadcastState();
    return result;
  }

  emitTypedEvent(e) {
    switch (e.kind) {
      case 'emotion_day': io.to(this.gameId).emit('emotionDay', e.data); break;
      case 'mandate': io.to(this.gameId).emit('mandate', e.data); break;
      // ★ GDD3 §1 — 티어업은 큰 이벤트다(팡파레 + 영토 말뚝 + 도감 카드 공개)
      case 'tier_up': io.to(this.gameId).emit('tierUp', e.data); break;
      // ★ §17-14 — 깃발 점령. 화면이 배너를 띄우고 새 원 자리를 짚는다.
      case 'territory_claimed': io.to(this.gameId).emit('territoryClaimed', e.data); break;
      // ★ GDD3 §4 · §13-D-1 — 주민 도착(이름·외형·능력치와 함께)
      case 'resident_arrived': io.to(this.gameId).emit('residentArrived', e.data); break;
      // ★ GDD3 §13-D-5 — 연구가 끝났다(석탄·석유 노두가 드러나는 순간이기도 하다)
      case 'research_done': io.to(this.gameId).emit('researchDone', e.data); break;
      case 'building_done': io.to(this.gameId).emit('buildingDone', e.data); break;
      case 'wave_incoming': io.to(this.gameId).emit('waveIncoming', e.data); break;
      case 'wave_held':
      case 'wave_breached': io.to(this.gameId).emit('waveResult', e.data); break;
      case 'council_open': {
        const council = this.world.councils.find((c) => c.councilId === e.data.councilId);
        if (council) io.to(this.gameId).emit('council', council);
        break;
      }
      // ★ GDD3 §13-C-2 — 들의 것에게 물렸다 / 쓰러져 모닥불에서 일어난다
      case 'player_down': io.to(this.gameId).emit('playerDown', e.data); break;
      /* ★ P1 (§15-C 검증에서 잡았다) — **일어남에 전용 채널이 없었다.**
         쓰러짐(playerDown)만 나가고 일어남은 events 로만 흘러, 화면을 덮은 장막이 영영 걷히지 않았다
         (실브라우저 연기 검사에서 「가려짐: down-veil」로 드러났다 — 그 뒤의 클릭이 전부 막혔다).
         옛 판에서는 다운 자체가 드물어 눈에 안 띄었을 뿐, 규약(§0-T)에는 처음부터 적혀 있던 문이다. */
      case 'player_revived': io.to(this.gameId).emit('playerRevived', e.data); break;
      case 'wild_hit': io.to(this.gameId).emit('wildHit', e.data); break;
      case 'camp_spotted': io.to(this.gameId).emit('campSpotted', e.data); break;
      case 'camp_scouted': io.to(this.gameId).emit('campScouted', e.data); break;
      case 'offer_received': io.to(this.gameId).emit('offer', e.data); break;
      case 'ruin_event': io.to(this.gameId).emit('ruinEvent', e.data); break;
      // ★ GDD3 §11-2 — 콘텐츠 사슬. 장이 넘어갈 때만 오고, 화면은 팡파레 + '새로 열린 것' 카드 1장을 띄운다.
      case 'step_done': io.to(this.gameId).emit('questStep', e.data); break;
      case 'chapter_done': io.to(this.gameId).emit('chapterDone', e.data); break;
      case 'chapter_open': io.to(this.gameId).emit('chapterOpen', e.data); break;
      default: break;
    }
  }

  broadcastState() {
    for (const [socketId, session] of sessions) {
      if (session.gameId !== this.gameId) continue;
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) continue;
      sock.emit('state', buildNationView(this.world, session.nationId, session.role, data, { avatarId: session.avatarId }));
      sock.emit('worldDiff', buildWorldDiff(this.world, session.nationId, data, session.worldTick ?? -1));
      session.worldTick = this.world.tick;
      sock.emit('worldState', buildWorldState(this.world, session.nationId, data));
    }
  }
}

function upsertMember(nation, avatarId, name, role, online, appearance) {
  if (!nation) return null;
  return upsertMemberEntry(nation, { avatarId, name, role, online, appearance }, data);
}

/** @type {Map<string, GameRuntime>} */
const games = new Map();
/** @type {Map<string, {gameId, nationId, role, playerName, avatarId, worldTick}>} */
const sessions = new Map();

function getOrCreateGame(gameId, opts = {}) {
  if (gameId && games.has(gameId)) return games.get(gameId);
  if (gameId) {
    const snap = loadSnapshot(gameId);
    const migrated = snap ? migrateWorld(snap, data) : null;
    if (migrated) {
      const rt = new GameRuntime(gameId, migrated);
      games.set(gameId, rt);
      rt.start();
      return rt;
    }
    if (snap) console.warn(`[saves] ${gameId} 는 구버전 스냅샷이라 폐기하고 새로 시작합니다.`);
  }
  const world = createWorld({
    gameId, seed: opts.seed ?? Math.floor(Math.random() * 1e9),
    data, playerName: opts.playerName ?? '플레이어',
    difficulty: opts.difficulty,
  });
  const rt = new GameRuntime(world.gameId, world);
  games.set(world.gameId, rt);
  saveSnapshot(world);
  rt.start();
  return rt;
}

function anyGame() { return games.values().next().value ?? null; }

// ────────────────────────────────────────────────────────────────
// REST
// ────────────────────────────────────────────────────────────────
/** 헬스체크 — Render 의 healthCheckPath 가 이 길을 두드린다(200 이어야 산 것으로 친다). */
app.get('/api/health', (req, res) => {
  const g = req.query.gameId ? games.get(req.query.gameId) : anyGame();
  res.json({
    ok: true, protocol: PROTOCOL, version: VERSION,
    tick: g?.world.tick ?? 0, paused: Boolean(g?.world.paused), games: games.size,
    worldSize: data.world.size, dayRealSeconds: data.balance.time.dayRealSeconds,
    // ★ 개발 패널이 이 칸을 보고 스스로 열지 말지 정한다(운영에서는 false).
    debugApi: debugApiEnabled(),
  });
});

app.get('/api/config', (req, res) => res.json({ protocol: PROTOCOL, ...publicConfig() }));

app.get('/api/games', (req, res) => res.json({ games: listGames() }));

// ────────────────────────────────────────────────────────────────
// 개발용 뒷문 — 자물쇠가 잠겨 있으면(운영 기본값) 아래 길은 통째로 없는 셈이 된다.
// ────────────────────────────────────────────────────────────────
app.use('/api/debug', (req, res, next) => {
  if (debugApiEnabled()) return next();
  // '없는 길'로 답한다 — 운영에서 뒷문의 존재 자체를 알릴 이유가 없다.
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '없는 길입니다.' } });
});

app.post('/api/debug/speed', (req, res) => {
  const g = req.body.gameId ? games.get(req.body.gameId) : anyGame();
  if (!g) return res.status(404).json({ error: { code: 'NO_GAME', message: '게임이 없습니다.' } });
  res.json({ ok: true, tickRealSeconds: g.setSpeed(req.body.tickRealSeconds) });
});

app.post('/api/debug/pause', (req, res) => {
  const g = req.body.gameId ? games.get(req.body.gameId) : anyGame();
  if (!g) return res.status(404).json({ error: { code: 'NO_GAME', message: '게임이 없습니다.' } });
  const paused = req.body.paused == null ? !g.world.paused : Boolean(req.body.paused);
  res.json({ ok: true, paused: g.setPaused(paused) });
});

app.post('/api/debug/step', (req, res) => {
  const g = req.body.gameId ? games.get(req.body.gameId) : anyGame();
  if (!g) return res.status(404).json({ error: { code: 'NO_GAME', message: '게임이 없습니다.' } });
  const out = g.advance();
  res.json({ ok: true, tick: g.world.tick, events: out?.events?.length ?? 0 });
});

/**
 * ★ 개발·QA 전용 — 진행 중인 웨이브 전투를 그 자리에서 끝까지 돌린다.
 *   실시간으로는 서브틱 0.25초씩 도는 전투를 기다릴 필요 없이 결과를 볼 수 있다(E2E·스모크용).
 */
app.post('/api/debug/battle', (req, res) => {
  const g = req.body.gameId ? games.get(req.body.gameId) : anyGame();
  if (!g) return res.status(404).json({ error: { code: 'NO_GAME', message: '게임이 없습니다.' } });
  const nation = g.activeBattleNation();
  if (!nation) return res.status(404).json({ error: { code: 'NO_BATTLE', message: '진행 중인 전투가 없습니다.' } });
  let guard = 0;
  const max = Math.ceil(data.waves.battle.maxSeconds / g.subtickSeconds) + 8;
  while (!nation.battle.over && guard++ < max) stepBattle(g.world, nation, data, g.subtickSeconds);
  io.to(g.gameId).emit('battleTick', { ...battleSnapshot(nation, data), events: [] });
  const result = g.completeBattle(nation);
  res.json({ ok: true, resolved: true, subticks: guard, won: result?.won ?? null });
});

app.post('/api/debug/seed', (req, res) => {
  const g = req.body.gameId ? games.get(req.body.gameId) : anyGame();
  if (!g) return res.status(404).json({ error: { code: 'NO_GAME', message: '게임이 없습니다.' } });
  res.json({ ok: true, seed: g.setSeed(req.body.seed) });
});

// ────────────────────────────────────────────────────────────────
// socket.io (docs/PROTOCOL.md v3)
// ────────────────────────────────────────────────────────────────
const CLIENT_COMMANDS = [
  // 실시간 (GDD3 §3)
  'actionSwing', 'combatSwing', 'lordMove',
  // 건설 (GDD3 §7)
  'placeBuilding', 'upgradeStructure', 'repairStructure', 'reclaimField',
  // ★ GDD3 §12-12 — 철거 · 이전 · 되돌리기
  'demolishStructure', 'relocateStructure', 'cancelStructureWork',
  // ★ GDD3 §12-2 — 정착지 승격(본부의 [승격] 단추)
  'promoteSettlement',
  // ★ GDD3 §13-D — RPG 계층: 모집 · 장비/강화/인첸트 · 연구 · 철로
  'recruitResident',
  // ★ GDD3 §14-5 — 레벨업 스탯 포인트 나누기(캐릭터 창)
  'allocStat',
  'craftEquipment', 'enhanceEquipment', 'enchantEquipment',
  'startResearch', 'placeRail', 'removeRail',
  // ★ §17-13 — 다리(물을 건넌다) · 매립(물을 덮는다)
  'placeBridge', 'removeBridge', 'placeFill', 'removeFill',
  // ★ §17-12 — 걷어내기: 영토 안의 자원 자리를 치워 건물 놓을 땅을 낸다
  'clearNode',
  // ★ GDD3 §11-4 — 감정의 날의 유일한 방아쇠
  'appraiseLand',
  'placeFence', 'upgradeFence', 'repairFence', 'removeFence',
  // 주민
  'commandVillagers', 'setVillagerMix', 'setLabor',
  // 경제·역할
  'setQueue', 'buyTool', 'sellWeapon', 'trade', 'respondOffer', 'decide',
  'ordersSet', 'saintBuff', 'useArtifact', 'councilAck', 'setAutoExport', 'setExportFloor',
  'pickRole', 'delegate', 'adviceAct', 'setAutoAssist',
  // ★ GDD3 §15-C — 자동 플레이(켜기·끄기, 수동 입력 시 일시 해제)
  'setAutoPlay',
  // ★ §17-11 — 동료 상호작용: 지시(이곳으로 보낸다·해제)와 꾸미기(이름·모양새).
  //   신원 명령이 아니다 — 내 아바타가 아니라 **동료**를 겨눈다(companionId 로 판정한다).
  'commandCompanion', 'customizeCompanion',
  // 왕의 하루 · 작전
  'apAction', 'harvestNode', 'setBattlePlan',
  // 멀티
  'setAppearance', 'chat',
  // ★ §17-7 — 다같이 잠자기(하루 넘기기)
  'sleepVote',
  // ★ §17-9 — 건물 손일(제련소 손제련 · 우물 두레박 · 기도 등)
  'handWork',
  // ★ §17-16 — 이웃 나라 찾아가기(도읍 앞에 서면 그 나라를 만난 것으로 적는다)
  'visitNation',
];

/** ★ 신원(누구의 아바타인가)은 서버 세션이 정한다 — 클라가 보낸 avatarId·playerName 은 신뢰하지 않는다. */
const IDENTITY_COMMANDS = new Set([
  'lordMove', 'setAppearance', 'chat', 'pickRole', 'delegate', 'actionSwing', 'combatSwing',
  // ★ GDD3 §13-D-3 — 장비는 **사람마다** 다르다. 누구의 칼인지는 세션이 정한다(클라 말을 안 믿는다).
  'craftEquipment', 'enhanceEquipment', 'enchantEquipment',
  // ★ GDD3 §14-5 — 스탯도 사람마다 다르다. 누구의 점수인지는 세션이 정한다.
  'allocStat',
  // ★ GDD3 §15-C — 자동 플레이는 **내 아바타**의 것이다. 남의 아바타를 몰라고 청할 수 없다.
  'setAutoPlay',
  // ★ §17-7 — 잠자기 표는 내 아바타의 것이다
  'sleepVote',
  // ★ §17-9 — 손일도 내 아바타의 손이다(거리·쿨다운·회복이 사람마다 따로다)
  'handWork',
  // ★ §17-16 — 찾아가는 것은 **내 발**이다. 남의 아바타가 선 자리로 방문을 청할 수 없다.
  'visitNation',
]);

/** ★ 실시간 명령 — 처리 후 곧바로 결과를 돌려주고, 전투 중이면 스냅샷도 함께 흘린다 */
const REALTIME_COMMANDS = new Set(['actionSwing', 'combatSwing']);

function readAck(payload, maybeAck) {
  if (typeof payload === 'function') return { payload: {}, ack: payload };
  return { payload: payload ?? {}, ack: typeof maybeAck === 'function' ? maybeAck : null };
}

function ackPayload(res) {
  const { events, ...rest } = res;
  return rest;
}

/** 실시간 ack 에 실어 보내는 창고 잔고(권위값) — 소수 둘째 자리까지 */
function liveResources(nation) {
  if (!nation?.resources) return null;
  return Object.fromEntries(
    Object.entries(nation.resources).map(([k, v]) => [k, Math.round(v * 100) / 100]),
  );
}

/** 역할 갱신 통지 — pickRole/delegate 로 자리 배치가 바뀌면 방 전체가 자기 역할을 다시 파생한다 */
function refreshRoles(rt, nationId, { actorSocketId = null, takenFrom = null } = {}) {
  const nation = rt.world.nations[nationId];
  if (!nation) return null;
  const roles = nation.roles ?? {};
  const actor = actorSocketId ? sessions.get(actorSocketId) : null;
  const actorId = actor ? (actor.avatarId ?? actor.playerName) : null;
  let mineForActor = null;
  for (const [socketId, session] of sessions) {
    if (session.gameId !== rt.gameId || session.nationId !== nationId) continue;
    const who = session.avatarId ?? session.playerName;
    const mine = data.roles.order
      .find((k) => roles[k]?.holder === 'player' && (roles[k].owner ?? who) === who) ?? null;
    const changed = session.role !== mine;
    const before = session.role;
    session.role = mine;
    if (socketId === actorSocketId) mineForActor = mine;
    upsertMember(nation, who, session.playerName, mine, true);
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    if (!changed && socketId !== actorSocketId) continue;
    sock.emit('you', {
      avatarId: who,
      role: mine,
      roleName: mine ? (data.roles.defs[mine]?.name ?? mine) : null,
      takenFrom: socketId === actorSocketId ? takenFrom : null,
      takenBy: socketId !== actorSocketId && before != null && mine == null ? actorId : null,
    });
    if (changed && socketId !== actorSocketId) {
      sock.emit('state', buildNationView(rt.world, nationId, mine, data, { avatarId: who }));
    }
  }
  return mineForActor;
}

/**
 * ★ P0 재발 방지 (docs/PROTOCOL.md §3-0).
 *   월드 스냅샷은 `joined` 를 보내기 전에 만든다. 만드는 데 실패하면 접속 자체를 물린다.
 */
function buildJoinPayloads(rt, nationId, role, avatarId) {
  const world = buildWorldSnapshot(rt.world, nationId, data);
  if (!world || !world.size) {
    const e = new Error('월드 스냅샷을 만들지 못했습니다 (map 없음).');
    e.code = 'NO_WORLD';
    throw e;
  }
  return {
    world,
    state: buildNationView(rt.world, nationId, role, data, { avatarId }),
    worldState: buildWorldState(rt.world, nationId, data),
  };
}

io.on('connection', (socket) => {
  socket.on('join', (rawPayload = {}, rawAck) => {
    try {
      doJoin(socket, rawPayload, rawAck);
    } catch (e) {
      sessions.delete(socket.id);
      const error = { code: e?.code ?? 'JOIN_FAILED', message: '정착지에 들어가지 못했습니다. 서버를 다시 켜 주세요.' };
      console.error('[join] 실패:', e);
      socket.emit('serverError', error);
      const { ack } = readAck(rawPayload, rawAck);
      if (ack) ack({ ok: false, error });
    }
  });

  socket.on('requestWorld', (rawPayload = {}, rawAck) => {
    const { ack } = readAck(rawPayload, rawAck);
    const s = sessions.get(socket.id);
    if (!s) {
      const error = { code: 'NOT_JOINED', message: '먼저 접속하세요.' };
      socket.emit('serverError', error);
      if (ack) ack({ ok: false, error });
      return;
    }
    const rt = games.get(s.gameId);
    if (!rt) {
      const error = { code: 'NO_GAME', message: '게임이 없습니다.' };
      socket.emit('serverError', error);
      if (ack) ack({ ok: false, error });
      return;
    }
    try {
      const p = buildJoinPayloads(rt, s.nationId, s.role, s.avatarId);
      socket.emit('world', p.world);
      s.worldTick = rt.world.tick;
      socket.emit('state', p.state);
      socket.emit('worldState', p.worldState);
      if (ack) ack({ ok: true, protocol: PROTOCOL, tick: rt.world.tick });
    } catch (e) {
      const error = { code: e?.code ?? 'NO_WORLD', message: '지도를 다시 만들지 못했습니다.' };
      socket.emit('serverError', error);
      if (ack) ack({ ok: false, error });
    }
  });

  /** 연대기 — 언제든 다시 청할 수 있다 */
  socket.on('requestChronicle', (rawPayload = {}, rawAck) => {
    const { ack } = readAck(rawPayload, rawAck);
    const s = sessions.get(socket.id);
    const rt = s ? games.get(s.gameId) : null;
    if (!rt) { if (ack) ack({ ok: false, error: { code: 'NOT_JOINED', message: '먼저 접속하세요.' } }); return; }
    const payload = chronicleView(rt.world, rt.world.nations[s.nationId], data);
    socket.emit('chronicle', payload);
    if (ack) ack({ ok: true, chronicle: payload });
  });

  function doJoin(sock, rawPayload = {}, rawAck) {
    const { payload, ack } = readAck(rawPayload, rawAck);
    const rt = getOrCreateGame(payload.gameId, {
      playerName: payload.playerName, seed: payload.seed, difficulty: payload.difficulty,
    });
    const nationId = rt.world.playerNationId;
    const nation = rt.world.nations[nationId];
    const playerName = payload.playerName ?? '개척자';
    /* ★ GDD3 §15-C — 동료의 아이디를 사람이 가로챌 수 없다. 그 자리는 서버가 세는 「정원」의
       기준이므로, 사람이 봇 아이디로 들어오면 자리 계산이 통째로 어긋난다. */
    let avatarId = payload.avatarId != null ? String(payload.avatarId).slice(0, 40) : playerName;
    if (isCompanionId(nation, avatarId)) avatarId = `${avatarId}#`;
    const role = data.roles.order
      .find((k) => nation.roles?.[k]?.holder === 'player' && (nation.roles[k].owner ?? avatarId) === avatarId) ?? null;
    const { appearance } = normalizeAppearance(payload.appearance, data, defaultAppearance(data));

    sessions.set(sock.id, { gameId: rt.gameId, nationId, role, playerName, avatarId, worldTick: -1 });
    sock.join(rt.gameId);
    nation.online = true;
    nation.autoAssistIdleTicks = 0;
    if (payload.autoAssist != null) nation.autoAssist = Boolean(payload.autoAssist);
    upsertMember(nation, avatarId, playerName, role, true, appearance);
    // ★ GDD3 §3 — 접속자마다 스킬 장부를 연다(스윙·전투가 이 장부를 쓴다)
    ensurePlayer(nation, avatarId, data, playerName);
    const town = rt.world.map?.towns?.find((t) => t.nationId === nationId) ?? null;
    const avatars = (nation.avatars ||= {});
    const back = nation.players?.[avatarId]?.lastPos ?? null;
    avatars[avatarId] = {
      id: avatarId, name: playerName,
      x: avatars[avatarId]?.x ?? back?.x ?? town?.x ?? 0,
      y: avatars[avatarId]?.y ?? back?.y ?? town?.y ?? 0,
      tick: rt.world.tick, appearance,
    };
    /* ★ GDD3 §15-C 멀티 심리스 — 사람이 들어왔으니 동료 하나가 자리를 비킨다.
       비켜난 동료가 맡고 있던 자리(각료)는 곧바로 다른 동료에게 넘어간다. */
    syncCompanionSeats(rt.world, nation, data);
    bindCompanionRoles(nation, data);

    const payloads = buildJoinPayloads(rt, nationId, role, avatarId);

    const joined = {
      protocol: PROTOCOL,
      gameId: rt.gameId, nationId, you: { role, avatarId, appearance },
      config: { protocol: PROTOCOL, ...publicConfig() },
      roleLocked: !rt.world.emotionDayDone,
      tier: nation.tier ?? 0,
    };
    sock.emit('joined', joined);
    if (ack) ack({ ok: true, ...joined });
    sock.emit('chatHistory', chatHistory(rt.world, data));
    io.to(rt.gameId).emit('avatars', Object.values(nation.avatars || {}));
    sock.emit('world', payloads.world);
    sessions.get(sock.id).worldTick = rt.world.tick;
    sock.emit('state', payloads.state);
    sock.emit('worldState', payloads.worldState);
    sock.emit('chronicle', chronicleView(rt.world, nation, data));
    if (nation.battle && !nation.battle.over) sock.emit('battleStart', battleSnapshot(nation, data));

    if (rt.world.tick > (nation.lastSeenTick ?? 0)) {
      sock.emit('report', buildRegencyReport(rt.world, nation, data));
    }
    markSeen(nation, rt.world.tick);
  }

  for (const type of CLIENT_COMMANDS) {
    socket.on(type, (rawPayload = {}, rawAck) => {
      const { payload, ack } = readAck(rawPayload, rawAck);
      const fail = (error) => {
        socket.emit('serverError', error);
        if (ack) ack({ ok: false, error });
        return undefined;
      };
      const s = sessions.get(socket.id);
      if (!s) return fail({ code: 'NOT_JOINED', message: '먼저 접속하세요.' });
      const rt = games.get(s.gameId);
      if (!rt) return fail({ code: 'NO_GAME', message: '게임이 없습니다.' });

      const prevRole = s.role;
      if (type === 'pickRole' && payload.role) s.role = payload.role;
      const identity = IDENTITY_COMMANDS.has(type)
        ? { avatarId: s.avatarId ?? s.playerName, playerName: s.playerName } : null;

      // ★ 실시간 명령은 상태 전량 브로드캐스트를 하지 않는다 — 초당 여러 번 오기 때문이다.
      //   결과는 ack 로 돌려주고, 월드에 보이는 변화만 가볍게 흘린다.
      if (REALTIME_COMMANDS.has(type)) {
        const res = applyCommand(rt.world, s.nationId, { ...payload, ...(identity || {}), type, payload }, data, rt.rng);
        if (!res.ok) { if (ack) ack({ ok: false, error: res.error }); return undefined; }
        const out = ackPayload(res);
        // ★ 창고 잔고를 ack 에 실어 보낸다 — 화면의 자원칸이 다음 일 틱(최대 10분)을 기다리지 않는다.
        //   같은 방의 동료들도 'swing' 중계로 같은 잔고를 함께 받는다(창고는 나라 공용이다).
        out.resources = liveResources(rt.world.nations[s.nationId]);
        if (ack) ack(out);
        socket.to(s.gameId).emit('swing', { avatarId: identity.avatarId, type, ...out });
        // ★ 스윙 하나로 장이 넘어갈 수 있다(「나무를 세 번」·「목재 10」). 그 순간을 일 틱까지 미루지 않는다.
        //   장이 실제로 넘어갔을 때만 상태를 다시 빚는다 — 스윙마다 NationView 를 만들면 초당 몇 번씩 돌게 된다.
        if (res.events?.length) {
          rt.emitImmediate(s.nationId, res.events);
          rt.broadcastState();
        }
        const nation = rt.world.nations[s.nationId];
        if (type === 'combatSwing' && nation.battle) {
          io.to(s.gameId).emit('battleTick', { ...battleSnapshot(nation, data), events: [] });
        }
        // ★ §13-C-8 — 사냥한 놈이 쓰러졌으면 방 전체가 그 자리에서 사라진 것을 본다
        //   (1초 뒤 저빈도 방송을 기다리면 죽은 짐승이 잠깐 더 서 있다)
        if (type === 'combatSwing' && out.hunt && out.killed) {
          io.to(s.gameId).emit('creatures', {
            tick: rt.world.tick, list: creatureViews(rt.world, nation, data),
          });
        }
        return undefined;
      }

      // ★ 아바타 이동도 실시간이다 — 걸음마다 NationView 전량을 다시 빚지 않는다.
      //   대신 ① 아바타 위치 중계 ② 방금 밝아진 안개·노드만 담은 작은 worldDiff 를 흘린다.
      //   안개 마스크는 나라 공용이라, 같이 접속한 동료들도 같은 자리를 함께 얻는다.
      if (type === 'lordMove') {
        const res = applyCommand(rt.world, s.nationId, { ...payload, ...identity, type, payload }, data, rt.rng);
        if (!res.ok) { if (ack) ack({ ok: false, error: res.error }); return undefined; }
        const nation = rt.world.nations[s.nationId];
        socket.to(s.gameId).emit('avatars', Object.values(nation.avatars || {}));
        const reveal = buildRevealDiff(rt.world, s.nationId, data, res.revealed);
        if (reveal) io.to(s.gameId).emit('worldDiff', reveal);
        if (res.events?.length) { rt.emitImmediate(s.nationId, res.events); rt.broadcastState(); }
        /* ★ GDD3 §13-B-4·5 — 걸음이 여는 것 둘을 ack 에 함께 싣는다.
           ① 방금 드러난 은닉 유적 ② 위험 띠(링)와 링2 첫 진입 여부.
           링 판정은 서버 몫이다 — 영토가 자라면 안전한 땅도 자라므로 화면이 제 셈으로 하면 어긋난다. */
        if (ack) {
          ack({
            ok: true, avatar: res.avatar, reveal,
            ring: res.ring, ringEntered: res.ringEntered, ringText: res.ringText,
            revealedNodes: res.revealedNodes,
          });
        }
        return undefined;
      }

      const res = rt.apply(s.nationId, { ...payload, ...(identity || {}), type, payload });
      if (!res.ok) { s.role = prevRole; return fail(res.error); }
      const out = ackPayload(res);
      if (type === 'pickRole' || type === 'delegate') {
        const mine = refreshRoles(rt, s.nationId, { actorSocketId: socket.id, takenFrom: res.takenFrom ?? null });
        out.role = mine;
        out.roleName = mine ? (data.roles.defs[mine]?.name ?? mine) : null;
        out.roles = roleSummary(rt.world.nations[s.nationId], data);
        out.you = { avatarId: s.avatarId ?? s.playerName, role: mine, roleName: out.roleName, takenFrom: res.takenFrom ?? null };
      }
      if (type === 'setAppearance') io.to(s.gameId).emit('avatars', Object.values(rt.world.nations[s.nationId].avatars || {}));
      /* ★ §17-11 — 동료의 새 이름·모양새도 setAppearance 처럼 그 자리에서 방 전체에 흐른다
         (다음 상태 방송을 기다리면 이름표가 잠깐 옛 사람으로 남는다). */
      if (type === 'customizeCompanion') io.to(s.gameId).emit('avatars', Object.values(rt.world.nations[s.nationId].avatars || {}));
      if (type === 'chat' && res.message) io.to(s.gameId).emit('chat', res.message);
      /* ★ §17-16 — 이웃을 만났으니 그 나라의 시세가 그 자리에서 열린다.
         세계 뷰는 하루에 한 번만 흐르므로, 이 한 줄이 없으면 문 앞에 서 있고도 최대 10분을 기다린다. */
      if (type === 'visitNation') socket.emit('worldState', buildWorldState(rt.world, s.nationId, data));
      socket.emit('state', buildNationView(rt.world, s.nationId, s.role, data, { avatarId: s.avatarId }));
      if (ack) ack(out);
      return undefined;
    });
  }

  socket.on('disconnect', () => {
    const s = sessions.get(socket.id);
    sessions.delete(socket.id);
    if (!s) return;
    const rt = games.get(s.gameId);
    if (!rt) return;
    const stillOnline = [...sessions.values()].some((x) => x.gameId === s.gameId && x.nationId === s.nationId);
    const nation = rt.world.nations[s.nationId];
    if (!nation) return;
    const who = s.avatarId ?? s.playerName;
    upsertMember(nation, who, s.playerName, s.role, false);
    /* ★ GDD3 §15-C 멀티 심리스 — 나간 사람의 아바타는 세상에서 걷는다(선 자리는 장부에 남긴다).
       그래야 정원이 다시 비고, 비운 자리로 동료가 돌아온다. 예전에는 이 아바타가 그대로 남아
       짐승이 허깨비를 쫓고 정원이 영영 차 있었다. */
    const same = [...sessions.values()].some((x) => x.gameId === s.gameId && (x.avatarId ?? x.playerName) === who);
    if (!same && nation.avatars?.[who]) {
      const p = nation.players?.[who];
      if (p) p.lastPos = { x: nation.avatars[who].x, y: nation.avatars[who].y };
      delete nation.avatars[who];
      syncCompanionSeats(rt.world, nation, data);
      bindCompanionRoles(nation, data);
      io.to(s.gameId).emit('avatars', Object.values(nation.avatars || {}));
    }
    if (!stillOnline) {
      nation.online = false;
      markSeen(nation, rt.world.tick);
    }
  });
});

// ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  http.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`\n[!] ${PORT}번 문이 이미 열려 있습니다 — 예전 서버가 아직 떠 있습니다.`);
      console.error('    그 창을 닫은 뒤 다시 켜세요. (Windows: 작업 관리자에서 node 종료 / PowerShell: Get-Process node | Stop-Process)');
      console.error('    다른 문으로 열려면: PORT=3001 npm start\n');
      process.exit(1);
    }
    console.error('[!] 서버를 열지 못했습니다:', err);
    process.exit(1);
  });
  http.listen(PORT, HOST, () => {
    const where = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
    console.log(`갈래말래 v${VERSION} · 규약 v${PROTOCOL} — ${where} (bind ${HOST}:${PORT}, ${process.env.NODE_ENV || 'development'})`);
    console.log(`  1게임일 ${data.balance.time.dayRealSeconds}s · 전투 서브틱 ${data.waves.battle.subtickSeconds}s · 월드 ${data.world.size}×${data.world.size}`);
    console.log(`  저장 ${savesDir()} · 뒷문 ${debugApiEnabled() ? '열림(/api/debug/*)' : '잠김'} · 표현 ${process.env.ANTHROPIC_API_KEY ? 'Claude API + 템플릿' : '템플릿 전용'}`);
  });
}

export { app, http, io, games, getOrCreateGame, debugApiEnabled, PROTOCOL, VERSION };
