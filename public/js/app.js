/* app.js — 부팅 · 장면 전환 · 서버 이벤트 배선 (PROTOCOL v3.0 §4)
   화면은 셋뿐이다: 타이틀 / 건국 / 게임. 게임 안에서는 월드가 늘 주인공이고,
   관리 화면은 단추 줄·각료 초상·알림에서 모달로 열린다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var booted = false;
  var inGame = false;
  var openingDone = false;
  var dayStartAt = 0;
  var lastUnlockSig = '';
  var lastRadius = null;

  function boot() {
    if (booted) return;
    booted = true;

    U.initTooltips();
    GM.sfx.init();
    GM.devpanel.init();
    GM.lobby.init();

    var q = new URLSearchParams(location.search);
    var mock = q.get('mock') === '1';
    GM.net.connect(mock);

    GM.net.get('/api/config').then(function (c) {
      if (c) S.set({ config: c });
    }).catch(function () {
      if (mock) {
        fetch('/api/config').then(function (r) { return r.ok ? r.json() : null; })
          .then(function (c) { if (c) S.set({ config: c }); })
          .catch(function () {});
      }
    });

    wireServerEvents();
    requestAnimationFrame(loop);
  }

  /* ── 게임 화면 진입 ─────────────────────────────────── */
  function enterGame() {
    if (inGame) return;
    inGame = true;
    ['#scene-title', '#scene-found', '#scene-load'].forEach(function (sel) {
      var n = U.qs(sel);
      if (n) n.hidden = true;
    });
    U.qs('#shell').hidden = false;
    S.set({ screen: 'game' });

    GM.hud.init();
    GM.world.mount();
    GM.fx.mount();
    GM.minimap.mount();
    GM.build.init();
    GM.avatar.init();
    GM.social.init();
    GM.input.init();

    window.addEventListener('resize', function () { GM.world.resize(); GM.fx.resize(); });
    setTimeout(function () { GM.world.resize(); GM.fx.resize(); GM.world.recenter(); }, 60);
    refreshAll();
  }

  /* ── 서버 이벤트 ────────────────────────────────────── */
  function wireServerEvents() {
    S.on('joined', function (p) {
      if (p && p.you && p.you.appearance) {
        S.set({ you: { role: p.you.role || null, appearance: p.you.appearance } });
      }
      dayStartAt = Date.now();
      U.toast('여기서 시작합니다. 초대 코드 ' + (p.gameId || '') + ' 를 건네면 함께 개척합니다.', 'good', 6000);
      GM.devpanel.render();
    });

    S.on('world', function () {
      /* 지도가 서면 오프닝 — 갓 세운 야영지에서만 */
      if (openingDone) return;
      openingDone = true;
      setTimeout(function () {
        if (GM.opening.shouldPlay()) {
          GM.opening.play(function () { GM.quest.update(); });
        } else {
          GM.avatar.reveal(true);
        }
      }, 260);
    });

    S.on('state', function (v) {
      dayStartAt = Date.now();
      trackUnlocks(v);
      trackTerritory(v);
      refreshAll();
    });
    S.on('worldState', function () { if (inGame) GM.hud.update(); });
    /* ★ 실시간 ack 로 장부가 바뀐 순간 — 자원칸·목표 카드·배치대가 그 자리에서 따라온다.
       (스윙은 일 틱을 기다리지 않는다. 이게 없으면 도끼질을 해도 숫자가 최대 10분 묵는다.) */
    S.on('live', function () {
      if (!inGame) return;
      GM.hud.update();
      GM.quest.update();
      /* ★ §13-A-1 — 열려 있는 정착지 패널의 조건 행도 함께 따라온다 */
      GM.structure.refreshOpen();
    });

    S.on('events', function (list) {
      (list || []).forEach(function (e) {
        if (!e || !e.text) return;
        if (e.kind === 'artifact_found') {
          GM.hud.flash({ kind: 'good', icon: 'gem', title: '땅이 무언가를 내어주었다', sub: e.text,
                         open: function () { GM.artifacts.open(); } });
        } else if (e.kind === 'disaster' || e.kind === 'starvation' || e.kind === 'famine_warning') {
          GM.hud.flash({ kind: 'danger', icon: 'warn', title: e.text.slice(0, 26), sub: '자세히 보기',
                         open: function () { GM.chronicle.open(); } });
          U.toast(e.text, 'warn', 5200);
        } else if (e.kind === 'mid_shock' || e.kind === 'ai_invasion') {
          U.toast(e.text, 'warn', 5200);
        }
      });
      if (inGame) GM.hud.renderNotices();
    });

    /* ★ 성장 아크 */
    S.on('tierUp', function (p) {
      if (!inGame) return;
      lastRadius = p.radius;
      GM.tierup.play(p);
    });

    /* ★ 주민 도착 */
    S.on('residentArrived', function (p) {
      if (!inGame) return;
      GM.residents.arrived(p);
    });

    /* ★ GDD3 §14-1 — 주민의 작업 사이클이 끝났다.
       서버는 이미 곳간에 넣었다. 화면은 ① 그 사람 자리에 수치를 띄우고 ② 자원칸이 그 값을 빨아들이게 한다. */
    S.on('residentWork', function (p) {
      if (!inGame || !p) return;
      var seen = {};
      (p.credits || []).forEach(function (c) {
        if (GM.world.creditFloat(c)) seen[c.resource] = 1;
      });
      Object.keys(seen).forEach(function (k) { GM.hud.absorb(k); });
    });

    /* ★ GDD3 §13-D-5 — 연구가 끝났다. 석탄·석유는 그 순간 땅에 드러나므로 지도를 다시 청한다. */
    S.on('researchDone', function (p) {
      if (!inGame || !p) return;
      GM.sfx.play('unlock');
      U.banner({ icon: 'research', kind: 'good', title: p.name + ' 연구가 끝났다',
                 sub: p.line || p.desc || '', ms: 3600 });
      if (p.spawnedNodes) {
        U.toast('새 노두 ' + p.spawnedNodes + '곳이 정착지 바깥에 드러났습니다.', 'good', 4600);
        GM.net.send('requestWorld', {});
      }
    });

    /* ★ 완공 · 개축 */
    S.on('buildingDone', function (p) {
      if (!inGame || !p) return;
      GM.world.bounceStructure(p.structureId);
      GM.fx.dust(p.x, p.y, 18);
      GM.fx.ring(p.x, p.y, '#f6cf7a', 0.3, 2, 0.7);
      if (p.upgrade) GM.fx.sparkle(p.x, p.y, 18, '#f6cf7a');
      GM.sfx.play(p.upgrade ? 'levelup' : 'fanfare');
      U.banner({ icon: p.upgrade ? 'up' : 'hammer', kind: 'good',
                 title: p.name + (p.upgrade ? ' ' + p.tier + '단으로 올렸다' : ' 완공'),
                 sub: p.upgrade ? '' : '사람들이 모여 구경합니다', ms: 3000 });
    });

    /* ★ 웨이브 */
    S.on('waveIncoming', function (p) { if (inGame) GM.combat.onIncoming(p); });
    S.on('battleStart', function (p) { if (inGame) GM.combat.onStart(p); });
    S.on('battleTick', function (p) { if (inGame) GM.combat.onTick(p); });
    S.on('waveResult', function (p) { if (inGame) GM.combat.onResult(p); });

    /* ★ 연대기 */
    S.on('chronicle', function () { if (inGame) GM.chronicle.update(); });

    /* ★ 남의 스윙 */
    S.on('swing', function (p) { if (inGame) GM.swing.remote(p); });

    S.on('report', function () {
      if (!inGame) return;
      GM.hud.flash({ kind: 'good', icon: 'book', title: '자리를 비운 사이의 기록',
                     sub: '무슨 일이 있었는지 봅니다', open: function () { GM.chronicle.open(); } }, 30000);
    });

    S.on('emotionDay', function (p) {
      GM.cutscene.play(p, function () {
        refreshAll();
        U.toast('저마다의 자리가 열렸습니다.', 'good', 5000);
      });
    });
    /* ★ 관제 선포는 '내가 [땅을 감정한다]를 눌러서' 열린 것이다 — 그래서 이어 붙여도 자동 팝이 아니다.
       (감정의 날이 시간으로 오는 길은 v3.1 에서 통째로 사라졌다. GDD3 §11-4) */
    S.on('mandate', function (p) {
      if (!inGame) return;
      if (GM.cutscene.busy()) return;
      setTimeout(function () { GM.mandate.open(p); }, 400);
    });
    /* ★ GDD3 §11-5 — 어전 회의는 **열리기만** 한다. 창은 뜨지 않고 오른쪽 알림에 쌓인다. */
    S.on('council', function () {
      if (!inGame) return;
      GM.sfx.play('unlock');
      GM.hud.flash({ kind: 'council', icon: 'crown', title: '어전 회의가 열렸습니다',
                     sub: '각료들이 기다립니다 — 눌러서 들어갑니다',
                     open: function () { GM.council.openCouncil(S.S.council); } });
      GM.hud.renderNotices();
    });

    /* ★ v3.1 — 콘텐츠 사슬 */
    S.on('questStep', function () { if (inGame) GM.quest.update(); });
    S.on('chapterDone', function (p) { if (inGame) GM.quest.chapterDone(p); });
    S.on('chapterOpen', function (p) { if (inGame) GM.quest.chapterOpen(p); });

    S.on('campSpotted', function (c) {
      U.toast((c.name || '적') + '이(가) ' + S.directionMeta(c.direction).name + ' 가장자리에 진을 쳤습니다.', 'warn', 6000);
      GM.sfx.play('warn');
      if (inGame && c.x != null) GM.world.ping(c.x, c.y, '#d96a5a');
      if (inGame) GM.hud.renderNotices();
    });
    S.on('campScouted', function (c) {
      var full = null;
      S.camps().forEach(function (x) { if (x.id === c.id) full = x; });
      var hint = c.sizeHint || (full && full.sizeHint) || null;
      U.toast('정찰이 돌아왔습니다 — ' + (c.name || '적') + (hint ? ' · ' + hint : ''), 'good', 5200);
      if (inGame && c.x != null) GM.world.ping(c.x, c.y, '#f6cf7a');
      if (inGame) GM.hud.renderNotices();
    });

    /* ★ 유적도 창을 띄우지 않는다 — 알림에 쌓이고, 여는 것은 언제나 플레이어다 */
    S.on('ruinEvent', function (p) {
      if (!inGame || !p || !p.card) return;
      GM.hud.flash({ kind: 'decision', icon: 'scroll', title: p.card.title || '땅속에서 무언가 나왔습니다',
                     sub: '눌러서 살펴봅니다',
                     open: function () { GM.council.openDecision(p.card); } });
      GM.hud.renderNotices();
    });
    S.on('offer', function () { if (inGame) GM.hud.renderNotices(); });
    S.on('chat', function () { if (inGame) GM.social.paintLog(); });
  }

  /** 새로 열린 UI 를 짚어 준다 (한 줄 코치마크) */
  function trackUnlocks(v) {
    if (!inGame || !v) return;
    var ui = (v.unlocked && v.unlocked.ui) || [];
    var sig = ui.join(',');
    if (sig === lastUnlockSig) return;
    var prev = lastUnlockSig ? lastUnlockSig.split(',') : [];
    lastUnlockSig = sig;
    if (!prev.length) {
      /* 첫 상태 — 이미 열려 있던 것은 안내하지 않는다 */
      ui.forEach(function (k) { S.S.seenUi[k] = 1; });
      return;
    }
    var fresh = ui.filter(function (k) { return prev.indexOf(k) < 0; });
    if (fresh.length) GM.quest.announceUnlocks(fresh);
  }

  /** tierUp 을 놓쳤을 때도 영토가 넓어진 것은 보이게 한다 */
  function trackTerritory(v) {
    var r = v && v.tier && v.tier.radius;
    if (r == null) return;
    if (lastRadius != null && r > lastRadius) GM.world.animateTerritory(lastRadius, r);
    lastRadius = r;
  }

  function refreshAll() {
    if (!inGame) return;
    GM.hud.update();
    GM.quest.update();
    GM.orders.onState();
    GM.artifacts.update();
    GM.social.paintRoster();
    GM.skills.update();
    GM.chronicle.update();
    GM.combat.updateThreat();
    GM.structure.refreshOpen();      /* ★ §13-A-1 — 조건 행은 늘 지금 값이다 */
    var sel = S.S.selection;
    if (sel && (sel.residents.length || sel.nodeId || sel.structureId || sel.siteId || sel.fenceId)) {
      GM.residents.renderPanel();
    }
    GM.devpanel.render();
  }

  /* ── 애니메이션 루프 ────────────────────────────────── */
  var drawFails = 0;
  var dayHold = null;              // ★ 하루를 그 자리에 붙잡아 둔다 (밤낮 확인용, null 이면 흐른다)
  function loop(t) {
    try {
      if (inGame) {
        /* 하루가 얼마나 지났는가 — 조명 4구간의 시계.
           ★ dayHold 가 걸려 있으면 그 값에 멈춘다 (개발 패널·연기 검사가 밤낮을 붙잡고 볼 때). */
        var span = (S.timeCfg().dayRealSeconds || 600) * 1000;
        var f = dayHold != null ? dayHold
          : (dayStartAt ? Math.min(0.999, (Date.now() - dayStartAt) / span) : 0);
        S.S.dayFraction = f;
        GM.world.tickAnim(t || 0);
      }
    } catch (e) {
      drawFails += 1;
      if (drawFails <= 3) console.error('[app] 한 프레임을 그리지 못했습니다', e);
      if (drawFails === 3) U.toast('그림이 자꾸 어긋납니다. 새로고침해 주세요.', 'warn', 8000);
    }
    requestAnimationFrame(loop);
  }

  GM.app = {
    boot: boot, enterGame: enterGame, refreshAll: refreshAll,
    inGame: function () { return inGame; },
    /** 하루의 어느 때를 붙잡아 둔다(0~1). null 을 주면 다시 흐른다. — 밤낮 확인·개발 패널용 */
    holdDay: function (v) { dayHold = (v === null || v === undefined) ? null : U.clamp(v, 0, 0.999); },
    heldDay: function () { return dayHold; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
