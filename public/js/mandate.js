/* mandate.js — 관제 선포(감정의 날 직후). 여기서부터 자리를 고를 수 있다.
   싱글: 하나 고르면 나머지는 각료 위임 4 + 공석 1 로 채워진다.
   멀티: 각자 다른 자리를 동시에 맡는다. 이미 남이 앉은 자리를 고르면 넘겨받는다는 안내가 뜬다. */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var shown = false;

  function open(payload) {
    payload = payload || S.S.mandate;
    if (!payload) return null;
    if (U.modalOpen('mandate')) return null;

    var picked = null;
    var body = U.el('div');
    body.appendChild(U.el('p', null,
      '땅이 정체를 밝혔으니 이제 자리를 나눕니다. 그대가 손수 맡을 자리를 한 장 고르세요.'));
    if (payload.warning) {
      var warn = U.el('div', 'bubble');
      warn.textContent = payload.warning;
      body.appendChild(warn);
    }

    var grid = U.el('div', 'role-grid');
    grid.id = 'mandate-roles';
    (payload.roles || []).forEach(function (r) {
      var meta = S.roleMeta(r.key);
      var taken = ownerOf(r.key);
      var b = U.el('button', 'role-card');
      b.type = 'button';
      b.setAttribute('data-role', r.key);
      b.appendChild(GM.icons.portraitImg(r.key, 52, 'mandate'));
      b.appendChild(U.el('span', 'rc-stars', stars(meta.stars)));
      b.appendChild(U.el('span', 'rc-name', meta.name));
      b.appendChild(U.el('span', 'rc-line', meta.line));
      b.appendChild(U.el('span', 'rc-for', taken ? taken + '님이 앉아 있습니다' : ('이 자리만 보이는 것 · ' + meta.info)));
      U.tipSet(b, meta.name + ' — ' + meta.info,
        '이 자리가 비면: ' + meta.vacancy + (taken ? '\n고르면 ' + taken + '님에게서 넘겨받습니다.' : ''));
      b.onclick = function () {
        picked = r.key;
        U.qsa('.role-card', grid).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-role') === r.key); });
        go.disabled = false;
        note.textContent = taken
          ? (taken + '님의 자리를 넘겨받습니다. 그분은 다시 고르셔야 합니다.')
          : ('그대는 ' + meta.name + '. 나머지 자리는 각료들이 맡고 한 자리는 비워 둡니다.');
        GM.sfx.play('gain');
      };
      grid.appendChild(b);
    });
    body.appendChild(grid);

    var note = U.el('p', 'hint');
    note.id = 'mandate-note';
    note.textContent = payload.vacant
      ? ('비워 둘 자리: ' + S.roleMeta(payload.vacant).name + ' — ' + S.roleMeta(payload.vacant).vacancy)
      : '';
    body.appendChild(note);

    /* 직접 꾸리기 */
    var fold = U.el('details', 'fold');
    var sum = U.el('summary', null, '직접 꾸리기 — 각료 자리를 손수 배치');
    fold.appendChild(sum);
    var seatWrap = U.el('div', 'seat-grid');
    seatWrap.id = 'mandate-seats';
    var vacant = payload.vacant || 'trade';
    function paintSeats() {
      U.clear(seatWrap);
      S.ROLES.forEach(function (r) {
        var mine = picked === r.key;
        var vac = vacant === r.key;
        var b = U.el('button', 'seat' + (mine ? ' mine' : '') + (vac ? ' vacant' : ''));
        b.type = 'button';
        b.setAttribute('data-role', r.key);
        b.disabled = mine;
        b.appendChild(U.el('span', null, r.name));
        b.appendChild(U.el('small', null, mine ? '그대가 직접' : (vac ? '★ 자리를 비움' : '각료에게 맡김')));
        b.onclick = function () { vacant = (vacant === r.key ? null : r.key); paintSeats(); };
        seatWrap.appendChild(b);
      });
      var d = U.btn('이 구성으로 선포한다', 'btn-sm btn-primary', function () {
        var assignments = {};
        S.ROLES.forEach(function (r) {
          if (r.key === vacant) return;
          assignments[r.key] = (r.key === picked) ? 'player' : 'npc';
        });
        GM.net.send('delegate', { assignments: assignments, vacant: vacant });
        finish(m);
      });
      d.id = 'mandate-delegate';
      seatWrap.appendChild(d);
    }
    paintSeats();
    fold.appendChild(seatWrap);
    body.appendChild(fold);

    var foot = U.el('div');
    var go = U.btn('이 자리를 맡는다', 'btn-primary');
    go.id = 'mandate-pick';
    go.disabled = true;
    go.onclick = function () {
      if (!picked) return;
      GM.net.send('pickRole', { role: picked });
      finish(m);
    };
    foot.appendChild(go);

    var m = U.openModal({ title: '관제 선포', body: body, footer: foot, width: '820px',
                          closable: false, key: 'mandate', icon: GM.icons.img('crown', 22) });
    GM.sfx.play('unlock');
    shown = true;
    return m;
  }

  function finish(m) {
    U.closeModal(m);
    GM.sfx.play('fanfare');
    U.toast('관제를 선포했습니다.', 'good', 4200);
    U.banner({ icon: 'crown', kind: 'tier', title: '저마다의 자리가 정해졌다',
               sub: '각료 초상이 아래에 늘어섰습니다', ms: 3600 });
    GM.app.refreshAll();
  }

  function ownerOf(key) {
    var n = S.nation();
    var r = n && n.roles && n.roles[key];
    if (!r || r.holder !== 'player') return null;
    var who = r.owner;
    if (!who || who === S.S.avatarId) return null;
    var found = null;
    S.members().forEach(function (mm) { if (mm.avatarId === who) found = mm.name; });
    return found || who;
  }

  function stars(n) {
    var s = '';
    for (var i = 1; i <= 3; i++) s += (i <= n ? '★' : '☆');
    return s;
  }

  function wasShown() { return shown; }
  function reset() { shown = false; }

  GM.mandate = { open: open, wasShown: wasShown, reset: reset };
})(window);
