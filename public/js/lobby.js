/* lobby.js — 타이틀 → 건국 두 장면.
   건국은 왕국 이름 + 난이도 3택 + 보조 옵션이다. ★ 역할 카드는 없다(관제 선포로 옮겼다).
   ★ 외형 선택(그대의 모습)도 없다 — 주민 NPC 로 모습 통일. join.appearance 는 기본값으로 채워 보낸다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var pick = { difficulty: null, autoAssist: true };
  var flagT = 0, rafId = null;

  function init() {
    drawSky();
    startCrest();

    U.qs('#btn-new').onclick = function () { go('found'); };
    /* ★ 메뉴 판 두 낯 — [이어하기]는 코드 하나로 되돌아가는 판, [멀티플레이]는 동료와 함께 드는 판 */
    U.qs('#btn-load').onclick = function () { go('load', 'resume'); };
    U.qs('#btn-join').onclick = function () { go('load', 'join'); };
    U.qs('#found-back').onclick = function () { go('title'); };
    U.qs('#load-back').onclick = function () { go('title'); };
    U.qs('#found-start').onclick = startNew;
    U.qs('#load-go').onclick = resume;
    var mkRoom = U.qs('#load-create');
    if (mkRoom) mkRoom.onclick = function () { go('found'); };   /* 방 만들기 = 새 여정을 연다 */

    var nameIn = U.qs('#found-name');
    var saved = null;
    try { saved = localStorage.getItem('gm.playerName'); } catch (e) {}
    if (saved) nameIn.value = saved;
    nameIn.addEventListener('input', refresh);
    nameIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !U.qs('#found-start').disabled) startNew();
    });

    var loadName = U.qs('#load-name');
    try { loadName.value = localStorage.getItem('gm.playerName') || ''; } catch (e) {}
    var gid = new URLSearchParams(location.search).get('game');
    if (gid) U.qs('#load-gameid').value = gid;

    var assist = U.qs('#found-assist');
    if (assist) {
      assist.checked = true;
      assist.addEventListener('change', function () { pick.autoAssist = assist.checked; });
    }

    renderDifficulty();
    refresh();

    window.addEventListener('resize', drawSky);
    S.on('joined', function () {
      /* ★ [이어하기]의 밑천 — 이번 판의 초대 코드를 적어 둔다 */
      try { if (S.S.gameId) localStorage.setItem('gm.gameId', S.S.gameId); } catch (e) {}
      GM.app.enterGame();
    });
    /* 서버 설정이 늦게 오면 난이도 카드를 다시 그린다 */
    S.on('change', function () {
      if (S.S.config && !U.qs('#found-diff').getAttribute('data-ready')) renderDifficulty();
    });
  }

  function go(name, mode) {
    S.set({ screen: name });
    U.qs('#scene-title').hidden = name !== 'title';
    U.qs('#scene-found').hidden = name !== 'found';
    U.qs('#scene-load').hidden = name !== 'load';
    if (name === 'found') {
      var n = U.qs('#found-name');
      setTimeout(function () { try { n.focus(); n.select(); } catch (e) {} }, 30);
    }
    if (name === 'load') {
      setMenuMode(mode || 'join');
      setTimeout(function () { try { U.qs('#load-gameid').focus(); } catch (e) {} }, 30);
    }
    if (name === 'title') startCrest(); else stopCrest();
  }

  /* ★ 메뉴 판의 두 낯 — 판 그림·제목·부제·보이는 칸이 함께 갈린다(main.css .mode-*) */
  function setMenuMode(mode) {
    var panel = U.qs('#menu-panel');
    if (!panel) return;
    var join = mode === 'join';
    panel.classList.toggle('mode-join', join);
    panel.classList.toggle('mode-resume', !join);
    var title = U.qs('#menu-title'), sub = U.qs('#menu-sub'), goBtn = U.qs('#load-go');
    if (title) title.textContent = join ? '멀티플레이' : '이어하기';
    if (sub) sub.textContent = join ? '동료와 함께 여정을 시작하세요' : '저장된 여정을 불러옵니다';
    if (goBtn) goBtn.textContent = join ? '파티 참가' : '여정 불러오기';
    /* 이어하기에는 지난 판의 초대 코드를 미리 앉힌다 — 코드 하나면 되돌아간다 */
    if (!join) {
      var gidIn = U.qs('#load-gameid');
      if (gidIn && !gidIn.value) {
        try { gidIn.value = localStorage.getItem('gm.gameId') || ''; } catch (e) {}
      }
    }
  }

  /* ★ 작은 경고 모달 — 메시지판 에셋 위에 한 줄(오른쪽 status 텍스트 대신 화면 가운데 선다) */
  function menuAlert(msg) {
    var old = U.qs('.gm-alert-back');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var back = U.el('div', 'gm-alert-back');
    var box = U.el('div', 'gm-alert');
    box.appendChild(U.el('p', null, msg));
    var okBtn = U.el('button', 'gm-alert-ok', '확인');
    okBtn.type = 'button';
    var close = function () { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener('keydown', onEsc, true); };
    var onEsc = function (e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); } };
    okBtn.onclick = close;
    back.onclick = function (e) { if (e.target === back) close(); };
    document.addEventListener('keydown', onEsc, true);
    box.appendChild(okBtn);
    back.appendChild(box);
    document.body.appendChild(back);
    if (GM.sfx) GM.sfx.play('deny');
    setTimeout(function () { try { okBtn.focus(); } catch (e) {} }, 30);
  }

  /* ── 난이도 3택 ─────────────────────────────────────── */
  function renderDifficulty() {
    var box = U.qs('#found-diff');
    if (!box) return;
    U.clear(box);
    var list = S.difficulties();
    if (S.S.config) box.setAttribute('data-ready', '1');
    if (!pick.difficulty) pick.difficulty = S.defaultDifficulty();
    var ICON = { story: 'sprout', kingdom: 'crown', trial: 'sword' };
    list.forEach(function (d) {
      var b = U.el('button', 'diff-card' + (pick.difficulty === d.key ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('data-diff', d.key);
      b.appendChild(GM.icons.img(ICON[d.key] || 'flag', 34));
      b.appendChild(U.el('span', 'rc-name', d.name));
      b.appendChild(U.el('span', 'rc-line', d.desc));
      U.tipSet(b, d.name, d.desc);
      b.onclick = function () {
        pick.difficulty = d.key;
        U.qsa('.diff-card', box).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-diff') === d.key); });
        refresh();
        GM.sfx.play('tap');
      };
      box.appendChild(b);
    });
  }

  /* ── 모습 — 주민 NPC 로 통일이라 화면에서 고르지 않는다.
     서버 계약(join.appearance)은 그대로라 기본값으로 채워 보낸다. ── */
  function loadAppearance() {
    try {
      var raw = localStorage.getItem('gm.appearance');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return S.defaultAppearance();
  }
  function saveAppearance(a) {
    try { localStorage.setItem('gm.appearance', JSON.stringify(a)); } catch (e) {}
  }

  function refresh() {
    var name = U.qs('#found-name').value.trim();
    var kp = U.qs('#found-kingdom');
    if (kp) kp.textContent = name ? '「' + name + '의 정착지」가 세워집니다.' : '이름을 적으면 정착지의 이름이 정해집니다.';
    U.qs('#found-start').disabled = !(name.length > 0);
    var sum = U.qs('#found-summary');
    if (sum) {
      var d = null;
      S.difficulties().forEach(function (x) { if (x.key === pick.difficulty) d = x; });
      sum.textContent = (d ? d.name + ' 길로 ' : '') +
        '길을 떠납니다. 역할은 마을이 되는 날 정해집니다.';
    }
  }

  function status(id, msg) { var n = U.qs(id); if (n) n.textContent = msg || ''; }

  /* ── 건국 ──────────────────────────────────────────── */
  function startNew() {
    var name = U.qs('#found-name').value.trim();
    if (!name) return;
    try { localStorage.setItem('gm.playerName', name); } catch (e) {}
    var app = S.defaultAppearance();
    saveAppearance(app);
    S.set({ joinAppearance: app, you: { role: null, appearance: app } });
    status('#found-status', '마차가 길을 나섭니다…');
    S.set({ joining: true });
    GM.sfx.play('fanfare');
    /* ?seed=… 로 들어오면 그 씨앗으로 땅을 뜬다 — 하니스·스모크가 같은 지도를 다시 받기 위한 손잡이다
       (평소에는 없다: 서버가 알아서 새 씨앗을 고른다) */
    var seed = new URLSearchParams(location.search).get('seed');
    GM.net.send('join', {
      playerName: name,
      difficulty: pick.difficulty || S.defaultDifficulty(),
      autoAssist: pick.autoAssist,
      appearance: app,
      seed: seed ? Number(seed) : undefined
    });
  }

  function resume() {
    var name = U.qs('#load-name').value.trim() || '이름 없는 개척자';
    var gid = U.qs('#load-gameid').value.trim();
    if (!gid) { menuAlert('초대 코드를 적어 주세요.'); return; }
    try { localStorage.setItem('gm.playerName', name); } catch (e) {}
    var app = S.defaultAppearance();
    S.set({ joinAppearance: app, you: { role: null, appearance: app } });
    status('#load-status', '지난 기록을 펼치는 중…');
    S.set({ joining: true });
    GM.net.send('join', { gameId: gid, playerName: name, appearance: app });
  }

  /* ── 밤하늘 배경 ───────────────────────────────────── */
  function drawSky() {
    var cv = U.qs('#sky');
    if (!cv) return;
    var w = Math.max(320, window.innerWidth || 1024);
    var h = Math.max(320, window.innerHeight || 768);
    var ctx = U.fitCanvas(cv, w, h);
    ctx.clearRect(0, 0, w, h);
    var rnd = U.rngFrom('nightsky');
    var s = 3;
    for (var i = 0; i < 260; i++) {
      var x = Math.floor(rnd() * w / s) * s;
      var y = Math.floor(rnd() * h * 0.72 / s) * s;
      var v = rnd();
      U.px(ctx, x, y, s, s, v > 0.9 ? '#f6e6a8' : (v > 0.7 ? '#cbd0f0' : '#5a5f8a'));
      if (v > 0.96) { U.px(ctx, x - s, y, s, s, '#6a6f9a'); U.px(ctx, x + s, y, s, s, '#6a6f9a'); }
    }
    var base = h * 0.86, unit = Math.max(7, Math.round(w / 80));
    for (var c = 0; c < Math.ceil(w / unit) + 1; c++) {
      var hh = (1 + Math.floor(rnd() * 3)) * unit;
      if (c % 11 === 0) hh += 3 * unit;
      U.px(ctx, c * unit, base - hh, unit, hh + unit * 5, '#14102a');
      if (rnd() > 0.82) U.px(ctx, c * unit + unit * 0.3, base - hh + unit * 0.6, unit * 0.4, unit * 0.4, '#e8a33d');
    }
  }

  /* ── 타이틀 문장(도트 성 + 깃발) ───────────────────── */
  function startCrest() {
    if (rafId) return;
    var step = function (t) {
      flagT = t || 0;
      drawCrest();
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }
  function stopCrest() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

  function drawCrest() {
    var cv = U.qs('#crest');
    if (!cv) return;
    var CW = 240, CH2 = 180;
    var ctx = U.fitCanvas(cv, CW, CH2);
    ctx.clearRect(0, 0, CW, CH2);
    var s = 6;
    function P(x, y, w, h, col) { U.px(ctx, x * s, y * s, w * s, h * s, col); }

    P(0, 25, 40, 5, '#2a3a1e');
    P(3, 24, 34, 1, '#3d5228');
    P(11, 14, 18, 11, '#b9a37a');
    P(11, 14, 18, 1, '#dcc9a0');
    P(11, 24, 18, 1, '#8a765a');
    for (var i = 0; i < 6; i++) P(11 + i * 3, 12, 2, 2, '#b9a37a');
    P(7, 10, 5, 15, '#a8926a'); P(7, 10, 5, 1, '#d0bd94');
    P(28, 10, 5, 15, '#a8926a'); P(28, 10, 5, 1, '#d0bd94');
    P(7, 8, 5, 2, '#8a765a'); P(28, 8, 5, 2, '#8a765a');
    P(17, 18, 6, 7, '#5c3b20'); P(17, 18, 6, 1, '#7a5230');
    P(19, 21, 2, 2, '#e8a33d');
    var blink = Math.sin(flagT / 620) > -0.2;
    P(8, 14, 2, 2, blink ? '#f6cf7a' : '#8a765a');
    P(30, 16, 2, 2, blink ? '#f6cf7a' : '#8a765a');
    P(19, 1, 1, 8, '#5c3b20');
    var wave = Math.sin(flagT / 240);
    for (var r = 0; r < 4; r++) {
      var off = Math.round(Math.sin(flagT / 240 + r * 0.7) * 1.1);
      P(20, 2 + r, 7 - Math.abs(off), 1, r < 2 ? '#bc4749' : '#e8a33d');
    }
    P(19, 0, 1, 1, wave > 0 ? '#f6cf7a' : '#e8a33d');
    for (var k = 0; k < 7; k++) {
      var rr = U.rngFrom('firefly' + k);
      var fx = rr() * 38, fy = 6 + rr() * 18;
      var a = (Math.sin(flagT / (400 + k * 90) + k) + 1) / 2;
      if (a > 0.45) P(Math.round(fx), Math.round(fy + Math.sin(flagT / 700 + k) * 1.5), 1, 1, '#f6e6a8');
    }
  }

  GM.lobby = { init: init, go: go, drawSky: drawSky };
})(window);
