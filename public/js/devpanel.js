/* devpanel.js — 개발용 뒷문. 화면에 단추를 두지 않고 Ctrl+` 로만 열린다.
   REST /api/debug/* 만 호출한다 (PROTOCOL). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var open = false;
  /* 뒷문이 열려 있는가 — null=아직 안 물어봄, true/false=확인함.
     운영 서버(NODE_ENV=production)는 /api/debug/* 를 404 로 닫아 둔다. 그럴 땐 패널을 조용히 접는다. */
  var available = null;

  function init() {
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && (e.key === '`' || e.key === '~')) { toggle(); e.preventDefault(); }
    });
  }

  /* 열기 전에 한 번만 물어본다 — 닫혀 있으면 아무 말 없이 없던 일로 한다 */
  function probe() {
    if (available !== null) return Promise.resolve(available);
    return GM.net.get('/api/health').then(function (r) {
      /* 낡은 서버는 debugApi 칸이 아예 없다 — 그럴 땐 열린 것으로 본다 */
      available = !(r && r.debugApi === false);
      return available;
    }).catch(function () { available = false; return false; });
  }

  function hide() {
    var panel = U.qs('#dev-panel');
    if (panel) panel.hidden = true;
  }

  /* 404 를 만난 순간 — 뒷문이 없는 서버다. 잔소리 없이 접는다. */
  function disable() { available = false; open = false; hide(); }

  function toggle() {
    if (open) { open = false; hide(); return; }
    probe().then(function (ok) {
      if (!ok) return;
      var panel = U.qs('#dev-panel');
      if (!panel) return;
      open = true;
      panel.hidden = false;
      render();
    });
  }

  function render() {
    if (!open) return;
    var panel = U.clear(U.qs('#dev-panel'));
    panel.appendChild(U.el('h4', null, '개발 뒷문 (Ctrl+`)'));

    var r1 = U.el('div', 'dev-row');
    var speed = document.createElement('input');
    speed.type = 'number'; speed.min = '0.2'; speed.step = '0.5';
    speed.value = '30';
    speed.setAttribute('aria-label', '하루 길이(초)');
    r1.appendChild(speed);
    r1.appendChild(U.btn('하루 길이', 'btn-sm', function () {
      GM.net.post('/api/debug/speed', { tickRealSeconds: Number(speed.value) || 30 })
        .then(function () { U.toast('하루가 ' + speed.value + '초.', 'good'); }).catch(err);
    }));
    panel.appendChild(r1);

    var presets = U.el('div', 'dev-row');
    [['0.5s', 0.5], ['3s', 3], ['30s', 30], ['600s', 600]].forEach(function (p) {
      presets.appendChild(U.btn(p[0], 'btn-sm btn-ghost', function () {
        speed.value = String(p[1]);
        GM.net.post('/api/debug/speed', { tickRealSeconds: p[1] })
          .then(function () { U.toast('하루가 ' + p[1] + '초.', 'good'); }).catch(err);
      }));
    });
    panel.appendChild(presets);

    var r2 = U.el('div', 'dev-row');
    var paused = S.S.view && S.S.view.paused;
    r2.appendChild(U.btn(paused ? '▶ 다시' : '‖ 멈춤', 'btn-sm', function () {
      GM.net.post('/api/debug/pause', {}).then(function (r) {
        U.toast(r && r.paused ? '시간을 멈췄습니다.' : '시간이 흐릅니다.', 'good');
        setTimeout(render, 120);
      }).catch(err);
    }));
    r2.appendChild(U.btn('↦ 하루', 'btn-sm', function () {
      GM.net.post('/api/debug/step', {}).then(function () { U.toast('하루 지났습니다.', 'good'); }).catch(err);
    }));
    panel.appendChild(r2);

    var r3 = U.el('div', 'dev-row');
    var seed = document.createElement('input');
    seed.type = 'number'; seed.value = '20260803';
    seed.setAttribute('aria-label', '운의 씨앗');
    r3.appendChild(seed);
    r3.appendChild(U.btn('씨앗', 'btn-sm', function () {
      GM.net.post('/api/debug/seed', { seed: Number(seed.value) || 1 })
        .then(function () { U.toast('씨앗 ' + seed.value, 'good'); }).catch(err);
    }));
    panel.appendChild(r3);

    var r4 = U.el('div', 'dev-row');
    r4.appendChild(U.btn('상태', 'btn-sm btn-ghost', function () {
      GM.net.get('/api/health').then(function (r) {
        U.toast((r.tick || 0) + '일째 / ' + (r.paused ? '멈춤' : '흐름'), 'good');
      }).catch(err);
    }));
    r4.appendChild(U.btn('설정 다시', 'btn-sm btn-ghost', function () {
      GM.net.get('/api/config').then(function (c) {
        S.set({ config: c });
        U.toast('설정을 다시 불러왔습니다.', 'good');
      }).catch(err);
    }));
    r4.appendChild(U.btn('목표 처음부터', 'btn-sm btn-ghost', function () { GM.quest.clearProgress(); GM.quest.update(); U.toast('목표 카드를 처음으로 돌렸습니다.', 'good'); }));
    panel.appendChild(r4);

    var v = S.S.view;
    var info = U.el('div', 'dev-note');
    info.textContent =
      (GM.net.isMock() ? '모드: mock' : '모드: 서버') +
      ' · 연결 ' + (S.S.connected ? 'O' : 'X') +
      (v ? (' · ' + v.day + '일') : '') +
      (S.S.gameId ? ('\n문장 번호: ' + S.S.gameId) : '');
    panel.appendChild(info);

    var link = U.el('div', 'dev-note');
    link.textContent = 'WASD 군주 · 방향키 시선 · B 건설 · T 성문 방비 · C 작전 · E 손쓰기 · Esc 물림';
    panel.appendChild(link);
  }

  function err(e) {
    /* 뒷문이 잠긴 서버(운영) — 조용히 접는다 */
    if (e && e.status === 404) { disable(); return; }
    U.toast('요청이 실패했습니다: ' + (e && e.message ? e.message : e), 'bad');
  }

  GM.devpanel = { init: init, render: render, toggle: toggle };
})(window);
