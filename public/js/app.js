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
  var lastStateTick = null;      // ★ 성능-4 — 하루 시계는 tick 이 바뀔 때만 되감는다
  var lastUnlockSig = '';
  var lastRadius = null;

  /* ══════════ ★ 성능-4 — refreshAll 코얼레싱 ══════════
     「왜」 — state 는 건설·집사·퀘스트마다 온다. 올 때마다 HUD·퀘스트·명부·패널 열두 자리를
     전부 다시 세우면, 방송이 겹치는 순간 한 프레임을 통째로 잃는다(후반 실측 30ms+).
     첫 방송은 **그 자리에서** 그린다(반응은 늦지 않는다). 그 뒤 120ms 안에 겹친 방송은
     한 번으로 접는다 — refreshAll 은 「지금 장부」를 읽으므로 마지막 한 번이 전부와 같다. */
  var refreshAt = 0, refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) return;
    var since = Date.now() - refreshAt;
    if (since >= 120) { refreshAt = Date.now(); refreshAll(); return; }
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshAt = Date.now();
      refreshAll();
    }, 120 - since);
  }

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
    GM.autoplay.init();      // ★ GDD3 §15-C — 「자동」 배지와 손이 닿은 순간의 물러남
    GM.input.init();

    window.addEventListener('resize', function () { GM.world.resize(); GM.fx.resize(); });
    setTimeout(function () { GM.world.resize(); GM.fx.resize(); GM.world.recenter(); }, 60);
    refreshAll();
  }

  /* ── 서버 이벤트 ────────────────────────────────────── */
  function wireServerEvents() {
    S.on('joined', function (p) {
      /* 재입장 응답은 역할과 외형을 각각 보낼 수 있다. 예전에는 appearance 가 있을 때만
         role 을 복원해서, 역할을 이미 가진 개척자가 기본 주민으로 다시 그려졌다. */
      if (p && p.you) {
        var before = S.S.you || {};
        S.set({ you: {
          role: p.you.role || before.role || null,
          avatarId: p.you.avatarId || before.avatarId || S.S.avatarId || null,
          appearance: p.you.appearance || before.appearance || S.defaultAppearance()
        } });
      }
      dayStartAt = Date.now();
      lastStateTick = null;      /* ★ 성능-4 — (재)입장 뒤의 첫 state 가 하루 시계를 새로 감게 */
      U.toast('여기서 시작합니다. 초대 코드 ' + (p.gameId || '') + ' 를 건네면 함께 개척합니다.', 'good', 6000);
      GM.devpanel.render();
    });

    S.on('world', function () {
      /* 지도가 서면 오프닝 — 갓 세운 야영지에서만 */
      if (openingDone) return;
      openingDone = true;
      var playOpening = GM.opening.shouldPlay();
      if (playOpening) GM.opening.prepare();
      setTimeout(function () {
        if (playOpening) {
          /* 도입 대사와 마차 연출 사이의 틈에도 몸·손을 먼저 잠근다. */
          /* ★ §세계관 W2 — 이야기의 시간 순서: 알현실(도입)이 먼저, 마차(오프닝)는 그 뒤 */
          var boot = function () { GM.opening.play(function () { GM.quest.update(); }); };
          if (GM.story) GM.story.beforeOpening(boot);
          else boot();
        } else {
          GM.avatar.reveal(true);
        }
      }, 260);
    });

    S.on('state', function (v) {
      /* ★ 성능-4 + 버그 — 하루 시계는 **날이 실제로 넘어갔을 때만** 다시 감는다.
         예전에는 state 가 올 때마다(건설·집사·퀘스트마다 온다) Date.now() 로 되감아서,
         활발히 놀수록 dayFraction 이 아침에 붙들려 밤이 오지 않았다. */
      /* ★ 시계 맞추기 — 서버가 「이 하루가 얼마나 흘렀는가」를 함께 준다. 도중에 들어오거나
         새로고침해도 아침으로 되감기지 않고 서버의 지금 시각에서 이어 흐른다. */
      if (v && v.tick !== lastStateTick) {
        lastStateTick = v.tick;
        var dspan = ((v.time && v.time.dayRealSeconds) || S.timeCfg().dayRealSeconds || 600) * 1000;
        var done = v.time && v.time.dayElapsedMs != null ? v.time.dayElapsedMs : 0;
        dayStartAt = Date.now() - Math.max(0, Math.min(done, dspan * 0.999));
      }
      trackUnlocks(v);
      trackTerritory(v);
      scheduleRefresh();
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
        if (!e) return;
        /* ★ §22 — 유적 카드의 **대답**. 여태 이 사건은 text 가 없어 아래 문지기(!e.text)에서
           통째로 걷혔다: 파헤치든 기도하든 화면에는 아무 일도 안 일어났다. 유저가 말한
           「보상이 안 온다」의 마지막 한 조각이 여기 있었다. 유물은 artifact_found 가 따로
           맡으므로 여기서는 이야기만 읽는다(같은 것을 두 번 띄우지 않는다). */
        if (e.kind === 'ruin_resolved') {
          var rr = e.data || {};
          /* ★ 2단계A — 이 사건은 이제 **갈래마다** 온다(카드가 한 번에 닫히지 않는다).
             빈손 알림창과 쪽지는 카드가 실제로 닫힐 때만 띄운다: 갈래를 누를 때마다
             「더 남은 것이 없습니다」가 펼쳐진 두루마리 위로 겹치면, 아직 살펴볼 것이
             남았는데도 끝난 줄로 읽힌다. 중간 결과는 카드 안의 결과 줄이 이미 말해 준다.
             옛 기록을 되읽을 때는 closes 칸이 없으므로 예전처럼 띄운다. */
          var ruinDone = rr.closes !== false;
          /* 유적 완료 이벤트는 항상 먼저 온다. 보상 이벤트가 네트워크 묶음에서
             누락돼도 여기의 보상 정보를 즉시 발견 대화창으로 넘긴다.
             유물은 어느 갈래에서 나오든 그 자리에서 보여 준다 — 기다릴 까닭이 없다. */
          if (rr.artifact && GM.artifacts && GM.artifacts.discovery) {
            var ra = rr.artifact;
            GM.artifacts.discovery({ key: ra.key, artifact: ra.name || ra.key, grade: ra.grade,
              effect: ra.desc || '', source: 'ruin', role: '깊은 유적의 마지막 방' });
          } else if (ruinDone) {
            var emptyLines = [
              '돌무더기 아래까지 모두 살폈지만, 이곳에는 더 남은 것이 없습니다.',
              '바랜 벽화와 부서진 제단만 남았습니다. 다음 깊은 유적을 찾아야 합니다.',
              '상자는 오래전에 비워졌습니다. 그래도 숨은 길의 흔적은 지도에 남겼습니다.',
              '먼지만 손에 남았습니다. 이 유적은 끝났지만, 탐험으로 신전의 단서는 가까워집니다.'
            ];
            var seed = String(rr.text || rr.name || 'empty');
            var sum = 0; for (var si = 0; si < seed.length; si++) sum += seed.charCodeAt(si);
            var emptyBody = U.el('div', 'ruin-result-modal');
            emptyBody.appendChild(U.el('p', 'ruin-result-lead', emptyLines[sum % emptyLines.length]));
            emptyBody.appendChild(U.el('p', 'hint', '유적에서 나온 전설과 단서는 「발견 기록」에서 다시 읽을 수 있습니다.'));
            var emptyFoot = U.el('div');
            emptyFoot.appendChild(U.btn('확인', 'btn-primary', function () { U.closeTopModal(); }));
            U.openModal({ title: rr.name || '유적 조사 결과', body: emptyBody, footer: emptyFoot,
              width: '520px', key: 'ruin-result', icon: GM.icons.img('scroll', 22) });
          }
          if (rr.text && (ruinDone || rr.artifact)) {
            GM.hud.flash({ kind: rr.artifact ? 'good' : 'decision', icon: 'scroll',
                           title: rr.name || '옛 자취', sub: rr.text,
                           open: function () { GM.chronicle.open(); } });
          }
          return;
        }
        if (e.kind !== 'artifact_found' && !e.text) return;
        if (e.kind === 'artifact_found') {
          GM.hud.flash({ kind: 'good', icon: 'gem', title: '땅이 무언가를 내어주었다', sub: e.text,
                         open: function () { GM.artifacts.open(); } });
          /* ★ §20-R1.5 — 발견 카드. 서사는 서버가 빚어 보낸 것을 그대로 읽는다(화면이 짓지 않는다).
             나중에 LLM 개선본이 같은 유물로 한 번 더 오면 이미 열린 카드의 글만 갈아 끼운다. */
          GM.artifacts.discovery(e.data);
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

    /* ★ §17-14 — 깃발 점령. 새 땅이 들어온 자리를 짚고 배너로 알린다. */
    S.on('territoryClaimed', function (p) {
      if (!inGame || !p) return;
      GM.sfx.play('unlock');
      U.banner({ icon: 'flag', kind: 'good', title: '새 영토를 얻었다!',
                 sub: '깃발 둘레가 우리 땅이 되었습니다', ms: 3600 });
      if (p.x != null) GM.world.ping(p.x, p.y, '#f6cf7a');
    });

    /* ★ 주민 도착 */
    S.on('residentArrived', function (p) {
      if (!inGame) return;
      GM.residents.arrived(p);
    });

    /* ★ GDD3 §14-6 — 쓰러짐과 일어남. 화면을 덮고 초를 세고, 첫 다운에는 규칙을 한 번 설명한다. */
    S.on('playerDown', function (p) { if (inGame) GM.down.onDown(p); });
    S.on('playerRevived', function (p) { if (inGame) GM.down.onRevived(p); });

    /* ★ GDD3 §14-3 — 들의 것들의 새 좌표. 화면은 이 값으로 튀지 않고 **한 스텝 뒤에서 등속으로** 지난다. */
    S.on('creatures', function (list) { if (inGame) GM.world.pushWild(list); });

    /* ★ §19-B — 함께 있는 사람·동료의 새 좌표도 같다. **받은 그 순간**에 지연 버퍼를 밀어야
       무거운 프레임(시작 직후·남이 들어온 직후)에도 걸음이 뭉쳐 튀지 않는다. */
    S.on('avatars', function (list) { if (inGame) GM.world.pushMates(list); });

    /* ★ GDD3 §15-A — 터렛이 쏜 발과 잡은 것.
       사격은 궤적으로, 처치는 **쓰러진 자리의 수치**로 보여 준다(§15-A-2 — 국고는 서버가 이미 채웠다). */
    S.on('turretShots', function (list) { if (inGame) GM.combat.addGuardShots(list); });
    S.on('turretKill', function (p) {
      if (!inGame || !p) return;
      var seen = {};
      (p.kills || []).forEach(function (k) {
        GM.world.turretKillFloat(k);
        Object.keys(k.gained || {}).forEach(function (r) { seen[r] = 1; });
      });
      Object.keys(seen).forEach(function (r) { GM.hud.absorb(r); });
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
    S.on('battleStart', function (p) {
      /* ★ §20-R2 — 종이 울리면 구경할 때가 아니다. 유물 연출은 그 자리에서 접고 카드만 남긴다. */
      if (GM.artifacts && GM.artifacts.endShow) GM.artifacts.endShow();
      if (inGame) GM.combat.onStart(p);
    });

    /* ★ §20-R2(유물기획 §20-7) — 레전더리 전역 알림. 문구는 서버가 빚어 보낸 것을 그대로 읽는다.
       「왜」 토스트가 아니라 금띠 배너인가 — 이것은 내 마을의 소식이 아니라 **세계의 소식**이라
       평소 알림과 결이 달라야 한다. 다른 방의 일이므로 눌러도 열리는 곳이 없다. */
    S.on('artifactGlobal', function (p) {
      if (!p || !p.text) return;
      U.banner({ icon: 'gem', kind: 'relic', title: '세계에 남은 것', sub: p.text,
                 ms: (S.artifactFxCfg().globalBannerMs) || 6000 });
      GM.sfx.play('relicLegend');
    });
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
      if (!inGame || !p) return;
      /* ★ A12 — 같은 관로로 **카드 없는 순수 알림**도 온다(신전 수호자를 눕힌 순간).
         열 것이 없으니 open 도 없다 — 알림 스택은 open 이 없는 줄을 이미 그릴 줄 안다. */
      if (!p.card) {
        if (!p.notice) return;
        GM.hud.flash({ kind: 'decision', icon: p.notice.icon || 'scroll',
                       title: p.notice.title || '자취에서 무슨 일이 있었습니다',
                       sub: p.notice.sub || '' });
        GM.hud.renderNotices();
        return;
      }
      /* ★ 2단계A(A5) — 방을 열면 이 관로로도 카드가 온다(스윙 ack 와 겹친다).
         ① 창은 여기서 열지 않는다 — 여는 것은 언제나 플레이어다. 이미 같은 카드의 두루마리가
            펼쳐져 있으면 눌러 둔 갈래가 날아가지 않게 스택만 다시 그린다.
         ② 쪽지의 열쇠를 결정 큐와 **같은 것**('dec:…')으로 둔다. 큐도 같은 카드로 줄을 세우므로
            열쇠가 다르면 한 카드에 두 줄이 선다(hud.js notices 가 앞선 것만 남긴다). */
      var did = p.card.decisionId || p.card.id;
      if (U.modalOpen && U.modalOpen('decision:' + did)) { GM.hud.renderNotices(); return; }
      GM.hud.flash({ id: 'dec:' + did,
                     kind: 'decision', icon: 'scroll', title: p.card.title || '땅속에서 무언가 나왔습니다',
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
      /* ★ Sprint 1 — 닫혀 있는 패널은 다시 열지 않는다(structure.refreshOpen 과 같은 빗장).
         새로 고침은 「열려 있는 것」의 값을 지금 값으로 맞추는 일이지, 닫은 창을 여는 일이 아니다. */
      var ctx = U.qs('#context-panel');
      if (ctx && !ctx.hidden) GM.residents.renderPanel();
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
