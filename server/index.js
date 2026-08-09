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
  // ★ Sprint 3 — 한 번의 방송 동안만 사는 파생 그릇(view.js 머리말 참고)
  newViewCache,
  // ★ §21-A1 — 세션 하나가 「지금까지 받은 것」의 장부(전송 계층. view.js §21-A1 머리말 참고)
  worldStreamCache,
  // ★ §19-A — 아바타 방송의 유일한 정본(down·bot·color·role·hp·정규화 외형). 아래 emitAvatars 참고.
  avatarViews,
} from './engine/view.js';
import { buildRegencyReport, markSeen } from './engine/report.js';
import { evaluateProgress } from './engine/progression.js';
// ★ §세계관 W2 — 스토리 연출: 이벤트 묶음을 곁눈질해 이야기를 얹는다(판정 없음·1회 보장)
import { storyEvents, gameStartedEvents } from './engine/story.js';
// ★ §세계관 W3 — 매듭형 엔딩: 조건 3중이 차면 초대장이 「알림」으로 온다
import { checkEndingInvite, inviteView } from './engine/ending.js';
// ★ §세계관 W4 — 관계 결·국가 이벤트: 세계는 플레이어 없이도 움직인다(시뮬 불간섭·statRng)
import { dailyRelations } from './engine/relations.js';
import { roleSummary } from './engine/npc.js';
import { ensurePlayer, playerProgressView } from './engine/skills.js';
// ★ §21-A2 — 서브틱 스트림은 battleStreamTick(델타)이, 되맞춤은 battleFull(풀)이 낸다
import {
  stepBattle, finishBattle, battleFull, battleStreamCache, battleStreamTick,
} from './engine/battle.js';
// ★ GDD3 §13-C — 상시 생태계. 일 틱도 전투 서브틱도 아닌 제 박자로 돈다.
import { stepEcology, ensureCreatures, creatureViews } from './engine/ecology.js';
// ★ GDD3 §14-1 — 주민의 작업 사이클도 그 박자에 편승한다(즉시 크레딧 + 그 자리 수치).
import { stepResidentWork } from './engine/residents.js';
// ★ GDD3 §15-C — 동료 봇(= 각료). 같은 1초 박자에 두뇌를 굴리고 아바타 채널로 자리를 흘린다.
import { stepCompanions, syncCompanionSeats, bindCompanionRoles, isCompanionId } from './engine/companions.js';
// ★ §17-14 — 깃발 점령. 동료가 자리 잡은 다음 같은 1초 박자에 판정한다.
import { claimStep } from './engine/claims.js';
// ★ §19-F4(F09-2) — 기차. 깃발과 같은 1초 박자에 한 걸음씩 굴린다.
import { stepTrains, trainViews } from './engine/train.js';
import { stampVisionDisc } from './engine/fog.js';
import { chronicleView, record as chronicleRecord } from './engine/chronicle.js';
import { artifactFoundEvent } from './engine/artifacts.js';
import {
  upsertMember as upsertMemberEntry, normalizeAppearance, defaultAppearance, chatHistory,
} from './engine/social.js';
// ★ Sprint 3 — markDirty: 사건 경로의 동기 저장을 걷어낸 미룬 저장(persistence.js 주석 참고)
import { saveSnapshot, markDirty, loadSnapshot, appendEvents, listGames, savesDir } from './persistence.js';
import { ExpressionQueue } from './expression/index.js';
// ★ §20-R1.5 — 언어의 돌(expressionQuality)이 표현 계층까지 닿게 하는 한 칸
import { expressionQualityOf } from './engine/artifacts.js';
import { respawnSpot } from './engine/path.js';

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

/* ══════════ ★ 배포 D-1 — 알려진 출처만 연다 (docs/DEPLOY2.md §4-3) ══════════
   GitHub Pages 사본(정적 클라)이 이 서버의 `/api/*` 와 소켓을 부른다 — 그러니 크로스 오리진이다.
   「왜 화이트리스트인가」 — 소켓은 이미 `origin:'*'` 로 열려 있었지만 express REST 에는 CORS 머리글이
   아예 없어서 Pages 에서 `/api/config` 가 막힌다(그 한 줄 때문에 화면이 부팅에서 멎는다).
   여는 김에 소켓 쪽도 같은 자로 좁힌다 — 아무나 우리 방에 붙을 이유는 없다.

   ★ 개발·검사 자리는 반드시 통과시킨다: origin 이 아예 없는 호출(도구·서버끼리·같은 출처 fetch)과
   localhost/127.0.0.1 의 **아무 포트나**. 하니스와 e2e 는 매번 다른 포트를 잡는다.
   추가 주소는 환경 변수 GALLAEMALLAE_ORIGINS 에 쉼표로 얹는다(코드를 안 고치고 늘린다). */
const ORIGIN_ALLOW = new Set([
  'https://dudejrtjdrp.github.io',
  ...String(process.env.GALLAEMALLAE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function originAllowed(origin) {
  if (!origin) return true;                       // origin 없는 호출 = 같은 출처이거나 도구다
  return ORIGIN_ALLOW.has(origin) || LOCAL_ORIGIN.test(origin);
}

const app = express();
app.disable('x-powered-by');      // 서버가 무엇으로 지어졌는지 굳이 알릴 이유가 없다
// ★ Render·대부분의 PaaS 는 프록시 뒤에 둔다 — 원래 프로토콜/주소를 프록시 머리글에서 읽는다.
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
/* ★ D-1 — Pages 사본이 /api/* 를 부를 수 있게. `cors` 꾸러미를 들이지 않는다(package.json 무변경 대원칙). */
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');              // 캐시가 한 출처의 답을 다른 출처에 주지 않게
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  setHeaders(res, path) {
    /* Images are immutable for the lifetime of a versioned URL.  Keeping
       scripts and HTML revalidated preserves fast deploys, while this avoids
       revalidating and re-downloading sprite sheets whenever a player enters
       the game again.  Assets without a version query still receive a short,
       safe cache window so replacing a file cannot leave clients stale for
       long. */
    if (/[/\\]assets[/\\]/.test(path)) {
      var versioned = /[?&]v=/.test((res.req && res.req.originalUrl) || '');
      res.setHeader('Cache-Control', versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400, stale-while-revalidate=604800');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));
const http = createServer(app);
// ★ 프록시 뒤(Render 등)에서도 그대로 돈다 — 소켓은 같은 출처(`/socket.io`)로 붙고,
//   폴링으로 먼저 손을 잡은 뒤 웹소켓으로 갈아탄다(플랫폼이 업그레이드를 통과시킨다).
//   갈아타지 못하는 망에서는 폴링으로 계속 논다 — 그래서 transports 를 좁히지 않는다.
/* ★ 배포 D-1 — 압축을 켠다 (docs/DEPLOY2.md §1). socket.io v4 는 압축이 **기본 꺼짐**이라
   world·state 가 생 JSON 으로 나갔다. 세이브 스냅샷이 게임당 1.6MB 급이니 접속 한 번에 메가가 흐른다 —
   Render 월 5GB 가 터진 진짜 원인이 플랫폼이 아니라 이 한 줄의 부재였다. JSON 은 8~10배 줄어든다.
   threshold 1024 인 까닭: 그보다 작은 쪽지(ack·스윙)는 압축해 봐야 CPU 만 쓰고 크기가 안 준다. */
const io = new Server(http, {
  cors: { origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: false },
  perMessageDeflate: { threshold: 1024 },
  /* ★ cors 는 **폴링 악수**에만 걸린다 — 웹소켓에는 브라우저가 CORS 를 걸지 않기 때문이다.
     우리 클라는 폴링으로 먼저 손을 잡으니 그것만으로도 브라우저는 막힌다. 여기서 한 겹 더 두는 까닭은
     웹소켓으로 곧장 붙는 경우까지 같은 자로 재기 위해서다(도구·서버끼리는 origin 이 없어 그대로 통과한다). */
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (originAllowed(origin)) return cb(null, true);
    console.warn(`[막음] 낯선 출처의 소켓: ${origin}`);
    return cb('origin not allowed', false);
  },
});

/* ★ 배포 D-1 — 세션당 전송량 계측 (docs/DEPLOY2.md §1-3).
   「압축만으로 충분한가, 정말 옮겨야 하는가」는 말이 아니라 숫자로 갈린다. 소켓 하나가 닫힐 때
   한 줄만 찍는다. 재는 값은 **압축 전 바이트**다 — 실제로 선을 타는 양의 상한이라 읽기 쉽고,
   압축이 켜졌는지는 이 값과 플랫폼 대역폭 지표를 견주면 그대로 드러난다.
   끄고 싶으면 GALLAEMALLAE_METER=0. 이 수치는 나중에 텔레메트리(§5-5)로 그대로 넘어간다. */
const METER = process.env.GALLAEMALLAE_METER !== '0';
function packetBytes(d) {
  if (typeof d === 'string') return Buffer.byteLength(d);
  if (d && typeof d.length === 'number') return d.length;
  if (d && typeof d.byteLength === 'number') return d.byteLength;
  return 0;
}
if (METER) {
  io.engine.on('connection', (raw) => {
    let sent = 0, got = 0;
    const t0 = Date.now();
    raw.on('packetCreate', (p) => { sent += packetBytes(p.data); });
    raw.on('packet', (p) => { got += packetBytes(p.data); });
    raw.on('close', () => {
      const kb = (n) => (n / 1024).toFixed(n > 1024 * 1024 ? 0 : 1);
      console.log(`[전송] ${raw.id} · ${Math.round((Date.now() - t0) / 1000)}초 `
        + `· 보냄 ${kb(sent)}KB · 받음 ${kb(got)}KB (압축 전)`);
    });
  });
}

/**
 * ★ §19-A — 아바타 목록 방송의 **단 하나의 문**.
 * 「왜」 함수를 따로 두나 — 여기 말고 여섯 자리에서 `Object.values(nation.avatars)` 를 날것 그대로
 * 흘려보내고 있었다. 그 날것에는 `down`·`bot`·`color`·`role`·`state`·`hp` 가 없다(PROTOCOL §0-P 표가
 * 있다고 적어 둔 칸들이다). 그런데 `worldDiff.avatars` 는 같은 목록을 avatarViews 로 빚어 보낸다 —
 * 즉 화면은 **같은 이름의 두 소스**를 번갈아 받았다: 걸으면 날것이 와서 쓰러짐·동료 표시가 사라지고,
 * 다음 방송이 오면 되살아났다. 팀원의 쓰러짐이 안 보이던 것도, 외형이 흔들리던 것도 여기서 났다.
 */
/** ★ §19-F4(F09-2) — 정거장에 닿았다는 알림 한 줄(연대기에는 싣지 않는다 — 나라의 사건이 아니다) */
function arrivalEvents(nation, arrivals) {
  return arrivals.map((a) => ({
    kind: 'train_arrived', nationId: nation.id,
    data: { trainId: a.trainId, stationId: a.stationId, x: a.x, y: a.y, dropped: a.dropped },
  }));
}

function emitAvatars(gameId, nation, exceptSocket = null) {
  if (!nation) return;
  const to = exceptSocket ? exceptSocket.to(gameId) : io.to(gameId);
  to.emit('avatars', avatarViews(nation, data));
}

/**
 * ★ §19-E(F04-9) — 방장. 이 방에 **남아 있는 사람 가운데 가장 먼저 들어온 이**다.
 *
 * 왜 저장하지 않나 — 방장은 권한이지 재산이 아니다. 세션 표(Map)는 들어온 차례를 그대로 지키므로
 * 여기서 한 줄로 파생된다. 방장이 나가면 다음 사람이 자동으로 이어받고, 다시 들어오면 맨 뒤에 선다.
 * 아무도 없으면 null 이다 — 그때는 도구(E2E·하니스)의 REST 호출만 남으므로 검사할 사람이 없다.
 */
function hostOf(gameId) {
  for (const s of sessions.values()) if (s.gameId === gameId) return s.avatarId ?? s.playerName;
  return null;
}

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

  /* ★ 시계 하나가 죽어도 서버는 죽지 않는다.
     setInterval 콜백에서 새는 예외는 잡아 줄 프레임이 없어 프로세스를 그대로 내린다 —
     실제로 세이브에 굳은 캐시 하나 때문에 생태 루프 첫 걸음에서 서버가 통째로 꺼졌다.
     한 박자를 건너뛰는 편이 방 전체를 잃는 것보다 낫다. 대신 **조용히 넘기지는 않는다**. */
  safeBeat(what, fn) {
    try { fn(); } catch (e) {
      const now = Date.now();
      if (now - (this._beatWarnAt?.[what] ?? 0) > 5000) {
        (this._beatWarnAt ||= {})[what] = now;
        console.error(`[${this.gameId}] ${what} 박자 실패 — 이 박자는 건너뜁니다:`, e);
      }
    }
  }

  start() {
    this.stop();
    if (this.world.paused) return;
    this.timer = setInterval(() => this.safeBeat('일 틱', () => this.advance()), this.tickRealSeconds * 1000);
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
    this.ecologyTimer = setInterval(() => this.safeBeat('생태', () => this.ecologyStep(sec)), sec * 1000);
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
      const { events, shots, kills, healed } = stepEcology(this.world, nation, data, dt);
      const painful = events.filter((e) => e.kind === 'player_down' || e.kind === 'wild_hit' || e.kind === 'player_revived');
      if (painful.length) this.emitImmediate(nation.id, painful);
      /* ★ §19-A — 쓰러짐·부활은 **판(state)이 바뀐 사건**이다. 예전에는 알림(playerDown/playerRevived)만
         흘리고 판은 안 다시 보냈다: 그래서 일어난 뒤에도 「그대 — 쓰러짐」이 다음 일 틱(최대 10분)까지
         남았고(뷰의 you.player.down 이 낡았다), 팀원의 쓰러짐도 아바타 목록에 실리지 못했다. */
      if (painful.some((e) => e.kind !== 'wild_hit')) this.broadcastNationState();
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
      /* ★ §19-C — 정착지에서 찬 체력도 아바타 채널로 그 자리에서 흐른다(avatars 는 hp 를 나른다).
         동료가 걸을 때만 보내던 탓에, 가만히 서서 쉬면 회복이 화면에 한 방울도 안 비쳤다. */
      if (crew.avatars || healed) emitAvatars(this.gameId, nation);
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
      /* ★ §19-F4(F09-2) — 기차 한 걸음. 짐승과 **같은 박자**(1초)로 돈다: 화면은 받은 좌표로
         튀지 않고 그리로 다가간다(§19-B 보간). 탄 사람의 몸은 서버가 옮기므로 아바타도 함께 흐른다. */
      const rail = stepTrains(this.world, nation, data, dt);
      if (rail.moved) io.to(this.gameId).emit('trains', { tick: this.world.tick, list: trainViews(nation) });
      if (rail.avatars) emitAvatars(this.gameId, nation);
      if (rail.arrivals.length) this.emitImmediate(nation.id, arrivalEvents(nation, rail.arrivals));
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

  /**
   * ★ §20-R1.5 — 나라마다 「표현 품질」을 한 번만 재서 이벤트 묶음에 나눠 준다.
   * 「왜」 묶음마다 한 번인가 — 여기는 스윙마다 도는 길목이라 이벤트 하나하나에 유물을 훑으면
   * 손맛이 상한다. LLM 이 꺼져 있으면 재지도 않는다(품질은 LLM 경로에서만 값이 된다).
   */
  #qualityOf(nationId) {
    if (!this.expression.useLlm) return 1;
    this.__quality ||= {};
    this.__quality[nationId] ??= expressionQualityOf(this.world.nations[nationId], data);
    return this.__quality[nationId];
  }

  #decorate(events, fallbackNationId = null) {
    this.__quality = {};
    return events.map((e) => {
      const id = e.nationId ?? fallbackNationId;
      return this.expression.express({ tick: this.world.tick, ...e, nationId: id },
        { nationId: id, quality: this.#qualityOf(id) });
    });
  }

  emitImmediate(nationId, raw) {
    // ★ §세계관 W2 — 실시간 사건(첫 이웃·감정의 날)에도 이야기가 끼어든다
    raw = [...raw, ...storyEvents(this.world, data, raw)];
    // ★ §20-R1.5 — 표현 품질(언어의 돌)을 태우는 유일한 문은 #decorate 다
    const decorated = this.#decorate(raw, nationId);
    this.world.log = [...(this.world.log || []), ...decorated].slice(-400);
    /* ★ Sprint 3 — 여기가 가장 뜨거운 자리였다. 늑대가 물 때마다(초에 한두 번) 세상 전부를
       JSON 으로 굳혀 동기로 디스크에 썼고, 그 사이 이벤트 루프가 통째로 멎었다.
       이제 「바뀌었다」고만 적어 두고 몇 초 뒤에 비동기로 한 번 쓴다 — 잃으면 안 되는 마디
       (일 틱 · 전투 종료 · 건국)는 아래 세 자리에서 예전처럼 그 자리에서 동기로 남긴다. */
    markDirty(this.world);
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

    // ★ §세계관 W2 — 일 틱의 사건(장 진행·웨이브 예고)에 이야기를 얹는다. 시뮬은 이 길을 지나지 않는다.
    // ★ §세계관 W4 — 관계(위신 가산·정기 계약·국가 이벤트)가 먼저, 그 위에서 초대장 조건을 본다.
    const relEvs = dailyRelations(this.world, data, events);
    // ★ §세계관 W3 — 조건 3중이 갓 찼으면 초대장(알림)이 같은 아침에 함께 온다.
    const dayBatch = [...events, ...relEvs, ...checkEndingInvite(this.world, data)];
    const withStory = [...dayBatch, ...storyEvents(this.world, data, dayBatch)];
    const decorated = this.#decorate(withStory);
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

  /* ★ §21-A2 — 이 방이 「지금까지 받은 것」의 장부. 월드가 아니라 런타임이 쥔다
     (세이브에도 결정론에도 닿지 않는 순수 전송 계층이다). 싸움이 끝나면 함께 버린다. */
  battleStreamOf() {
    if (!this.battleCache) this.battleCache = battleStreamCache();
    return this.battleCache;
  }

  ensureBattleLoop() {
    if (this.battleTimer) return;
    const nation = this.activeBattleNation();
    if (!nation) return;
    this.battleCache = battleStreamCache();
    io.to(this.gameId).emit('battleStart', battleFull(nation, data, this.battleCache));
    this.battleTimer = setInterval(() => this.safeBeat('전투', () => this.battleStep()), this.subtickSeconds * 1000);
  }

  stopBattleLoop() {
    this.battleCache = null;
    if (this.battleTimer) { clearInterval(this.battleTimer); this.battleTimer = null; }
  }

  battleStep() {
    const nation = this.activeBattleNation();
    if (!nation) { this.stopBattleLoop(); return; }
    const { events, done } = stepBattle(this.world, nation, data, this.subtickSeconds);
    const tick = battleStreamTick(nation, data, this.battleStreamOf());
    io.to(this.gameId).emit('battleTick', { ...tick, events });
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
    // ★ §세계관 W2 — 첫 결전의 승패가 이야기의 갈래(막음/무너짐)를 고른다
    const waveBatch = [ev, ...progressed];
    if (result.artifact) waveBatch.push(artifactFoundEvent(this.world, nation, result.artifact.key, 'battle', data));
    waveBatch.push(...storyEvents(this.world, data, waveBatch));
    const decorated = this.#decorate(waveBatch, nation.id);
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
      // ★ §세계관 W2 — 이야기 연출. 클라 story.js 가 대화창으로 흘린다(재접속자는 연대기로 회고)
      case 'story_beat': io.to(this.gameId).emit('storyBeat', e.data); break;
      // ★ §세계관 W3 — 초대장. 봉투(지속 단추)로 남고, 여는 것은 언제나 군주다
      case 'ending_invite': io.to(this.gameId).emit('endingInvite', e.data); break;
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

  /**
   * ★ §19-A — **판(state)만** 방 전체에 다시 보낸다. 세계(worldDiff·worldState)는 건드리지 않는다.
   * 「왜」 반쪽짜리 방송이 따로 필요한가 — 사람이 들고 나는 일, 쓰러지고 일어나는 일은 **나라의 장부**
   * (명부·동료 자리·아바타 목록·쓰러짐 표)만 바꾼다. 세계 변경분까지 함께 흘리면 그 자리에서 아무것도
   * 안 바뀐 worldDiff 가 한 장 더 끼어들어, 「다음 worldDiff 를 기다리는」 쪽의 차례를 흐트러뜨린다.
   */
  broadcastNationState() {
    const cache = newViewCache();
    for (const [socketId, session] of sessions) {
      if (session.gameId !== this.gameId) continue;
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) continue;
      sock.emit('state', buildNationView(this.world, session.nationId, session.role, data,
        { avatarId: session.avatarId, cache }));
    }
  }

  broadcastState() {
    /* ★ Sprint 3 — 한 번의 방송 안에서만 사는 그릇 하나(view.js 머리말 참고).
       한 판에 사람이 넷이면 주민 목록·울타리 목록·일자리 목록·짐승 목록·세계 뷰를
       **여덟 번**(state 넷 + worldDiff 넷) 빚고 있었다. 그 조각들은 누가 보든 값이 같다 —
       역할에 따라 갈리는 것은 농정관 작황·국방 약점처럼 몇 줄뿐이고, 그 몇 줄은 그릇에 담지 않는다.
       그릇은 이 함수를 벗어나면 버려지므로 「낡은 값이 남는」 사고가 원천적으로 없다. */
    const cache = newViewCache();
    const worldStates = new Map();       // 세계 뷰는 나라마다 하나다(보는 사람과 무관하다)
    for (const [socketId, session] of sessions) {
      if (session.gameId !== this.gameId) continue;
      const sock = io.sockets.sockets.get(socketId);
      if (!sock) continue;
      sock.emit('state', buildNationView(this.world, session.nationId, session.role, data, { avatarId: session.avatarId, cache }));
      sock.emit('worldDiff', buildWorldDiff(this.world, session.nationId, data, session.worldTick ?? -1,
        { cache, stream: worldStreamOf(session) }));
      session.worldTick = this.world.tick;
      if (!worldStates.has(session.nationId)) {
        worldStates.set(session.nationId, buildWorldState(this.world, session.nationId, data));
      }
      sock.emit('worldState', worldStates.get(session.nationId));
    }
  }
}

function upsertMember(nation, avatarId, name, role, online, appearance) {
  if (!nation) return null;
  return upsertMemberEntry(nation, { avatarId, name, role, online, appearance }, data);
}

/** @type {Map<string, GameRuntime>} */
const games = new Map();
/** @type {Map<string, {gameId, nationId, role, playerName, avatarId, worldTick, worldStream}>} */
const sessions = new Map();

/**
 * ★ §21-A1 — 이 사람이 「지금까지 받은 것」의 장부.
 * 「왜」 방이 아니라 세션인가 — battleTick(§21-A2)은 방 전체가 **같은 한 장**을 받지만,
 * worldDiff 는 사람마다 다른 sinceTick 으로 나간다(늦게 든 사람, 방금 되살아난 사람).
 * 그래서 「무엇까지 받았는가」도 사람마다 다르다. 장부를 비우면 다음 한 장이 전량이다 —
 * 입장·재요청(requestWorld)이 그 길을 쓴다. 세이브에도 결정론에도 닿지 않는다.
 */
function worldStreamOf(session) {
  if (!session.worldStream) session.worldStream = worldStreamCache();
  return session.worldStream;
}

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
  // ★ §21-A2 — 단숨에 끝까지 돌린 판이라 델타로는 못 잇는다: 방 전체에 풀 한 장을 던진다
  io.to(g.gameId).emit('battleTick', { ...battleFull(nation, data, g.battleStreamOf()), events: [] });
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
  /* ★ §19-F1(F08-4) — 잡는 대신 데려온다(목장) */
  'tameCreature',
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
  // ★ §세계관 W3 — 에르니아 초대장을 연다(매듭형 엔딩)
  'acceptEnding',
  'placeFence', 'upgradeFence', 'repairFence', 'removeFence',
  // 주민
  'commandVillagers', 'setVillagerMix', 'setLabor',
  // 경제·역할
  'setQueue', 'buyTool', 'sellWeapon', 'trade', 'respondOffer', 'decide',
  // ★ §19-F3 — 금화가 흘러갈 자리들: 특산품 좌판 · 연구 가속 · 재감정 · 주민 꾸미기
  'buySpecialty', 'hastenResearch', 'reappraiseLand', 'customizeResident',
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
  // ★ §18-D2 — 앞마당의 흔적 조사(발자국 사슬 · 돌무더기 · 둥지 · 우물 · 석상)
  'investigateTrail',
  // ★ §19-E(F04-4) — 침공 앞당기기. 준비를 끝낸 사람이 제 손으로 그날을 당긴다.
  'rushWave',
  // ★ Sprint 5 — 야영지 선제 타격. 예고와 함께 선 야영지를 걸어가서 부순다.
  'strikeCamp',
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
  // ★ §18-D2 — 흔적에 손을 대는 것도 내 손이다(거리·우물물의 회복이 사람마다 따로다)
  'investigateTrail',
  // ★ Sprint 5 — 야영지를 치는 것도 **내 손**이다. 사거리·쿨타임·눈금이 사람마다 따로라
  //   combatSwing 과 같은 문을 지나야 한다(남의 아바타 자리에서 칠 수 없다).
  'strikeCamp',
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

/** devTime 을 거절할 까닭 하나 — 없으면 null */
function devTimeDenial(session, rt) {
  if (!debugApiEnabled()) return { code: 'NOT_FOUND', message: '없는 길입니다.' };
  if (!session || !rt) return { code: 'NOT_JOINED', message: '먼저 접속하세요.' };
  const host = hostOf(rt.gameId);
  const who = session.avatarId ?? session.playerName;
  if (host && who !== host) return { code: 'NOT_HOST', message: '시간은 방장만 돌릴 수 있습니다.' };
  return null;
}

/** 하루 길이 · 멈춤 · 하루 넘기기 — 셋을 한 문으로 받는다(방 전체에 같은 시계를 돌린다) */
function applyDevTime(rt, payload) {
  if (payload.tickRealSeconds != null) rt.setSpeed(payload.tickRealSeconds);
  if (payload.paused != null) rt.setPaused(payload.paused);
  else if (payload.togglePause) rt.setPaused(!rt.world.paused);
  if (payload.step) rt.advance();
  return { tickRealSeconds: rt.tickRealSeconds, paused: Boolean(rt.world.paused), tick: rt.world.tick };
}

/** 실시간 ack 에 실어 보내는 창고 잔고(권위값) — 소수 둘째 자리까지 */
function liveResources(nation) {
  if (!nation?.resources) return null;
  return Object.fromEntries(
    Object.entries(nation.resources).map(([k, v]) => [k, Math.round(v * 100) / 100]),
  );
}

/**
 * ★ §19-C — 실시간 ack 에 실어 보내는 **내 눈금표**(권위값).
 * 「왜」 필요한가 — 스윙 ack 은 솜씨 하나의 xp 만 돌려줬다. 그런데 좌하단 눈금 바는 다섯 솜씨를
 * 합친 단계·비율(progress)을 그린다: 그 값은 다음 일 틱(최대 10분)까지 낡은 채였고, 마침 틱이
 * 끼면 오르고 아니면 안 오르는 것처럼 보였다(B04-2 「올랐다 안 올랐다」).
 */
function livePlayerProgress(nation, avatarId, data) {
  const p = nation?.players?.[avatarId ?? 'lord'];
  return p ? playerProgressView(p, data) : null;
}

/** 역할 갱신 통지 — pickRole/delegate 로 자리 배치가 바뀌면 방 전체가 자기 역할을 다시 파생한다 */
function roleForAvatar(nation, avatarId) {
  const roles = nation?.roles ?? {};
  const exact = data.roles.order.find((key) => roles[key]?.holder === 'player'
    && (roles[key].owner == null || roles[key].owner === avatarId));
  if (exact) return exact;

  /* 이전 저장본은 재입장 때 임시 avatarId가 달라질 수 있다. 명부에 남은 역할을 먼저
     되살리고, 혼자 이어 하는 나라라면 유일한 사람 역할도 안전하게 되찾는다. */
  const member = (nation?.members ?? []).find((m) => !m.bot && m.avatarId === avatarId);
  if (member?.role && roles[member.role]?.holder === 'player') return member.role;
  const playerRoles = data.roles.order.filter((key) => roles[key]?.holder === 'player');
  const humans = (nation?.members ?? []).filter((m) => !m.bot && m.avatarId);
  return playerRoles.length === 1 && humans.length === 1 ? playerRoles[0] : null;
}

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
    const mine = roleForAvatar(nation, who);
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

  /**
   * ★ §19-E(F04-9) — 멀티 시간 가속. **서버 권위 · 방장만.**
   *
   * 왜 REST 가 아니라 소켓인가 — /api/debug/speed 는 신원이 없어 gameId 를 안 주면 아무 방이나
   * 집었고(anyGame), 누가 눌렀는지도 알 수 없었다. 그래서 멀티에서는 남의 방 시계를 밀 수 있었다.
   * 소켓은 세션이 곧 신원이고 방이다 — 그 둘을 서버가 쥔 채로 판정한다.
   * 바뀐 하루 길이는 방 전체에 흘린다(timeScale) — 사람마다 다른 속도의 해가 뜨면 안 된다.
   * 운영(NODE_ENV=production)에서는 뒷문이 잠기므로 이 문도 함께 닫힌다.
   */
  socket.on('devTime', (rawPayload = {}, rawAck) => {
    const { payload, ack } = readAck(rawPayload, rawAck);
    const s = sessions.get(socket.id);
    const rt = s ? games.get(s.gameId) : null;
    const deny = devTimeDenial(s, rt);
    if (deny) { socket.emit('serverError', deny); if (ack) ack({ ok: false, error: deny }); return; }
    const out = applyDevTime(rt, payload);
    io.to(rt.gameId).emit('timeScale', out);
    if (ack) ack({ ok: true, ...out });
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
      // ★ §21-A1 — 지도를 통째로 다시 받았으니 장부도 비운다(다음 변경분 한 장은 전량이다)
      s.worldStream = null;
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
    /* 로비는 재입장 때 avatarId를 보내지 않는다. 같은 이름의 기존 명부 ID를 되살려야
       감정의 날에 맡은 역할(owner)과 플레이어 장부가 끊기지 않는다. */
    if (payload.avatarId == null) {
      const remembered = (nation.members || []).find((m) => m && !m.bot && m.name === playerName && m.avatarId);
      if (remembered) avatarId = remembered.avatarId;
      /* A continued solo settlement must retain its identity even when the
         lobby name was changed or local storage was cleared.  Do not apply
         this fallback to multiplayer saves: only reclaim the sole known human
         who owns a player role and is not currently connected. */
      if (!remembered) {
        const humans = (nation.members || []).filter((m) => m && !m.bot && m.avatarId);
        const owners = [...new Set(data.roles.order
          .map((key) => nation.roles?.[key])
          .filter((seat) => seat?.holder === 'player' && seat.owner)
          .map((seat) => seat.owner))];
        const sole = humans.length === 1 && owners.length === 1 && humans[0].avatarId === owners[0]
          ? owners[0] : null;
        const connected = sole && [...sessions.values()].some((s) => s.gameId === rt.gameId
          && s.nationId === nationId && (s.avatarId ?? s.playerName) === sole);
        if (sole && !connected) avatarId = sole;
      }
    }
    if (isCompanionId(nation, avatarId)) avatarId = `${avatarId}#`;
    const role = roleForAvatar(nation, avatarId);
    const { appearance } = normalizeAppearance(payload.appearance, data, defaultAppearance(data));

    /* ★ §19-A — 한 소켓은 한 방에만 있는다. socket.io 의 join 은 예전 방을 떠나지 않으므로,
       같은 소켓이 두 번 접속하면(재접속·코드 갈아타기) 방 둘의 `io.to(...)` 방송이 **번갈아** 꽂힌다
       — 자원칸이 널뛰고 안개·노드·아바타가 두 세상 사이에서 오갔다. 들어오기 전에 옛 방을 뗀다. */
    const before = sessions.get(sock.id);
    if (before && before.gameId !== rt.gameId) sock.leave(before.gameId);
    // ★ §21-A1 — worldStream:null 로 연다. 들어온 사람의 첫 변경분은 언제나 전량이다.
    sessions.set(sock.id, { gameId: rt.gameId, nationId, role, playerName, avatarId, worldTick: -1, worldStream: null });
    sock.join(rt.gameId);
    nation.online = true;
    nation.autoAssistIdleTicks = 0;
    if (payload.autoAssist != null) nation.autoAssist = Boolean(payload.autoAssist);
    upsertMember(nation, avatarId, playerName, role, true, appearance);
    // ★ GDD3 §3 — 접속자마다 스킬 장부를 연다(스윙·전투가 이 장부를 쓴다)
    ensurePlayer(nation, avatarId, data, playerName);
    const town = rt.world.map?.towns?.find((t) => t.nationId === nationId) ?? null;
    const avatars = (nation.avatars ||= {});
    const entrance = respawnSpot(rt.world, nation, data) ?? town ?? { x: 0, y: 0 };
    avatars[avatarId] = {
      id: avatarId, name: playerName,
      x: entrance.x,
      y: entrance.y,
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
    emitAvatars(rt.gameId, nation);
    sock.emit('world', payloads.world);
    sessions.get(sock.id).worldTick = rt.world.tick;
    sock.emit('state', payloads.state);
    sock.emit('worldState', payloads.worldState);
    sock.emit('chronicle', chronicleView(rt.world, nation, data));
    /* ★ §21-A2 — 늦게 든 사람에게는 **풀 한 장**이 간다(방의 장부는 건드리지 않는다:
       이 한 장은 이 사람만 받았고, 방의 나머지는 이미 그만큼을 알고 있다). */
    if (nation.battle && !nation.battle.over) sock.emit('battleStart', battleFull(nation, data, null));
    // ★ §세계관 W2 — 갓 세운 세계의 첫 접속에서 도입(알현실)이 흐른다. storySeen 이 1회를 보장한다.
    //   「왜」 맨 뒤인가 — 접속 절차(세계·상태·연대기)가 다 닿은 뒤에 이야기가 시작해야,
    //   접속 시점의 연대기 스냅샷이 이야기 줄에 물들지 않는다(하니스 연대기 검사와의 정합).
    const introEvs = gameStartedEvents(rt.world, data);
    if (introEvs.length) rt.emitImmediate(rt.world.playerNationId, introEvs);
    // ★ §세계관 W3 — 아직 열지 않은 초대장은 접속할 때마다 봉투로 되살아난다
    if (rt.world.endingInviteTick != null && rt.world.endingDone == null) {
      sock.emit('endingInvite', inviteView(nation));
    }

    if (rt.world.tick > (nation.lastSeenTick ?? 0)) {
      sock.emit('report', buildRegencyReport(rt.world, nation, data));
    }
    markSeen(nation, rt.world.tick);
    /* ★ §19-A — 새 사람이 들어온 사실은 **방 전체의 판**이 바뀐 것이다(명부 `nation.members`,
       비켜난 동료의 자리). 예전에는 들어온 사람에게만 판을 보내, 먼저 있던 사람의
       「함께 다스리는 이들」에는 다음 일 틱(최대 10분)까지 새 사람이 뜨지 않았다. */
    rt.broadcastNationState();
  }

  for (const type of CLIENT_COMMANDS) {
    socket.on(type, (rawPayload = {}, rawAck) => {
      const { payload, ack } = readAck(rawPayload, rawAck);
      // ★ §세계관 W4 — _로 시작하는 키는 서버 내부 전용(특가 단가 보정 등). 클라가 채워 보내도 벗긴다.
      for (const k of Object.keys(payload || {})) if (k.startsWith('_')) delete payload[k];
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
        // ★ §19-C — 눈금(경험치)도 잔고와 **같은 자리에** 싣는다(모든 행동이 이 문을 지난다)
        // Keep the construction site's numeric `progress` intact.  Player progression
        // is a separate payload; overwriting it here made site gauges receive an object
        // and remain visually stuck until the construction completed.
        out.playerProgress = livePlayerProgress(rt.world.nations[s.nationId], identity?.avatarId, data);
        if (ack) ack(out);
        socket.to(s.gameId).emit('swing', { avatarId: identity.avatarId, type, ...out });
        /* ★ §19-A — 궤를 열면 그 자리는 세상에서 **지워진다**(그루터기가 아니다). 그런데 실시간 경로는
           swing 중계만 했고, 화면의 노드 사전은 잔량만 고쳐 쓸 뿐 지우지 못한다 — 팀원이 이미 연 궤가
           내 화면에 남아 「그런 자리가 없다」를 부르던 자리다. 지운 사실만 담은 작은 worldDiff 를 방에 흘린다. */
        if (out.removedNodes?.length) {
          io.to(s.gameId).emit('worldDiff', {
            tick: rt.world.tick, sinceTick: rt.world.tick, reveal: true, removedNodes: out.removedNodes,
          });
        }
        // ★ 스윙 하나로 장이 넘어갈 수 있다(「나무를 세 번」·「목재 10」). 그 순간을 일 틱까지 미루지 않는다.
        //   장이 실제로 넘어갔을 때만 상태를 다시 빚는다 — 스윙마다 NationView 를 만들면 초당 몇 번씩 돌게 된다.
        if (res.events?.length) {
          rt.emitImmediate(s.nationId, res.events);
          rt.broadcastState();
        }
        const nation = rt.world.nations[s.nationId];
        if (type === 'combatSwing' && nation.battle) {
          // ★ §21-A2 — 검이 닿은 자리를 곧바로 보여 주는 한 장. 같은 방에 같은 델타가 가므로 장부도 함께 나아간다
          const beat = battleStreamTick(nation, data, rt.battleStreamOf());
          io.to(s.gameId).emit('battleTick', { ...beat, events: [] });
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
        emitAvatars(s.gameId, nation, socket);
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

      /* ★ Sprint 3 — 명령 하나에 상태를 **두 번** 빚던 자리.
         rt.apply() 가 성공하면 그 안에서 broadcastState() 가 이 방의 모든 세션에
         state · worldDiff · worldState 를 이미 흘려보낸다. 그런데 그 아래에서 같은 세션에게
         NationView 를 한 번 더 지어 보내고 있었다 — 노드 5,000·주민 60이 걸린 뷰를 명령마다 두 번씩
         빚은 셈이다. 이제 방송으로 나간 그 뷰를 그대로 쓰고, **방송 뒤에 자리(역할)가 실제로 바뀐
         경우에만** 한 번 더 보낸다(pickRole·delegate 는 refreshRoles 가 방송 이후에 자리를 확정한다).
         화면이 받는 내용도, ack 와의 앞뒤 차례도 예전 그대로다. */
      const roleAtBroadcast = s.role;
      const res = rt.apply(s.nationId, { ...payload, ...(identity || {}), type, payload });
      if (!res.ok) { s.role = prevRole; return fail(res.error); }
      const out = ackPayload(res);
      /* ★ §18-D2 — 흔적 조사가 연 안개는 그 자리에서 흐른다(일 틱을 기다리면 새 발자국이 최대 10분
         뒤에 나타난다). 그리고 ack 에서는 그 자리 목록을 **지운다** — 화면이 다음 흔적의 좌표를
         알아서는 안 된다(§18-3 마커 금지). 열린 것은 안개뿐이고, 찾는 것은 플레이어의 눈이다. */
      /* ★ §22-2 층3 — 유적 카드의 단서도 같은 자리를 쓴다. 안개는 그 자리에서 흐르고,
         ack 에서는 좌표 목록을 **지운다**. 화면이 다음 자취의 좌표를 알면 그 순간 마커가 된다. */
      if (type === 'investigateTrail' || type === 'decide') {
        const reveal = buildRevealDiff(rt.world, s.nationId, data, res.revealed || []);
        if (reveal) io.to(s.gameId).emit('worldDiff', reveal);
        delete out.revealed;
      }
      if (type === 'pickRole' || type === 'delegate') {
        const mine = refreshRoles(rt, s.nationId, { actorSocketId: socket.id, takenFrom: res.takenFrom ?? null });
        out.role = mine;
        out.roleName = mine ? (data.roles.defs[mine]?.name ?? mine) : null;
        out.roles = roleSummary(rt.world.nations[s.nationId], data);
        out.you = { avatarId: s.avatarId ?? s.playerName, role: mine, roleName: out.roleName, takenFrom: res.takenFrom ?? null };
      }
      /* ★ §19-F4(F09-2) — 타고 내리는 순간의 몸은 서버가 옮긴다. 그 자리에서 방에 흘려야
         같이 접속한 사람의 화면에서 그가 승강장에 붙박여 있지 않다. */
      if (type === 'boardTrain' || type === 'leaveTrain') emitAvatars(s.gameId, rt.world.nations[s.nationId]);
      if (type === 'setAppearance') emitAvatars(s.gameId, rt.world.nations[s.nationId]);
      /* ★ §17-11 — 동료의 새 이름·모양새도 setAppearance 처럼 그 자리에서 방 전체에 흐른다
         (다음 상태 방송을 기다리면 이름표가 잠깐 옛 사람으로 남는다). */
      if (type === 'customizeCompanion') emitAvatars(s.gameId, rt.world.nations[s.nationId]);
      if (type === 'chat' && res.message) io.to(s.gameId).emit('chat', res.message);
      /* ★ §17-16 — 이웃을 만났으니 그 나라의 시세가 그 자리에서 열린다.
         ★ Sprint 3 — 이 자리에 있던 `socket.emit('worldState', ...)` 는 걷어냈다:
         바로 위 rt.apply() 의 broadcastState 가 **똑같은 worldState 를 이미 보냈다**(내용도 값도 같다).
         §17-16 이 막으려던 「최대 10분 기다림」은 그 방송이 그대로 막아 준다. */
      if (s.role !== roleAtBroadcast) {
        // 방송이 나간 뒤에 자리가 바뀐 사람에게만 새 눈으로 본 판을 한 번 더 보낸다
        socket.emit('state', buildNationView(rt.world, s.nationId, s.role, data, { avatarId: s.avatarId }));
      }
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
      emitAvatars(s.gameId, nation);
    }
    if (!stillOnline) {
      nation.online = false;
      markSeen(nation, rt.world.tick);
    }
    // ★ §19-A — 나간 사실도 방 전체의 판이다(명부에서 「자리를 비웠습니다」로 바뀐다)
    if (stillOnline) rt.broadcastNationState();
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
