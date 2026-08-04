/* codex.js — 도감 (GDD3 §13-C-3). 단축키 J · 도구줄 [도감].
   층은 넷이다. 조우 0 이면 **실루엣**뿐이고, 한 번이라도 마주치면 이름과 사는 곳이,
   다섯을 잡으면 능력치와 나오는 것이, 스물을 잡으면 이야기가 열린다.
   ★ 셈은 전부 서버가 한다 — 여기서는 서버가 준 카드를 옮겨 적기만 하고,
     잠긴 층은 필드 자체가 오지 않으므로 화면이 지어낼 수도 없다(§11-1 「잠긴 것은 부재다」). */
(function (global) {
  'use strict';
  var GM = global.GM = global.GM || {};
  var S = GM.state, U = GM.ui;

  var tab = 'life';

  function open() {
    if (!S.uiOn('panel.codex')) { U.toast('아직 도감을 펼칠 때가 아닙니다.', 'warn'); return null; }
    var body = U.el('div');
    body.id = 'codex-body';
    paint(body);
    var foot = U.el('div');
    foot.appendChild(U.btn('덮는다', 'btn-primary', function () { U.closeTopModal(); }));
    return U.openModal({ title: '도감', body: body, footer: foot, width: '720px',
                         key: 'codex', icon: GM.icons.img('book', 22) });
  }

  function paint(host) {
    U.clear(host);
    var c = S.codex();
    if (!c) { host.appendChild(U.el('p', 'empty', '아직 적을 것이 없습니다.')); return; }

    var t = c.totals || {};
    host.appendChild(U.el('p', 'hint',
      '만난 것 ' + (t.seen || 0) + ' / ' + (t.total || 0) + '종 · 잡은 것 ' + (t.killed || 0) +
      ' · 찾은 유적 ' + (t.ruinsFound || 0) + '곳(뒤진 곳 ' + (t.ruinsExplored || 0) + ')'));

    var tabs = U.el('div', 'codex-tabs');
    [['life', '들에 사는 것'], ['ruin', '옛 자취']].forEach(function (p) {
      var b = U.btn(p[1], 'btn-sm' + (tab === p[0] ? ' btn-primary' : ' btn-ghost'), function () {
        tab = p[0];
        paint(host);
      });
      tabs.appendChild(b);
    });
    host.appendChild(tabs);

    if (tab === 'ruin') { paintRuins(host, c); return; }

    var grid = U.el('div', 'codex-grid');
    (c.species || []).forEach(function (sp) { grid.appendChild(card(sp, c.thresholds || {})); });
    host.appendChild(grid);
  }

  function card(sp, th) {
    var box = U.el('div', 'codex-card' + (sp.known ? '' : ' unknown'));
    box.setAttribute('data-sp', sp.key);

    var art = U.el('div', 'codex-art');
    try {
      var img = GM.atlas.wild(sp.key, 0, { silhouette: !sp.known });
      var cv = U.el('canvas', 'codex-sprite');
      cv.width = 48; cv.height = 48;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, 48, 48);
      art.appendChild(cv);
    } catch (e) {}
    box.appendChild(art);

    box.appendChild(U.el('div', 'codex-name', sp.known ? sp.name : '？？？'));
    box.appendChild(U.el('div', 'codex-kind',
      (sp.kind === 'predator' ? '사나운 것' : '온순한 것') + ' · ' + ringName(sp.ring)));

    if (sp.known) box.appendChild(U.el('div', 'codex-habitat', sp.habitat || ''));
    else box.appendChild(U.el('div', 'codex-habitat dim', '아직 마주친 적이 없습니다.'));

    if (sp.stats) {
      var st = U.el('div', 'codex-stats');
      st.appendChild(stat('체력', U.fmt(sp.stats.hp, 0)));
      st.appendChild(stat('빠르기', U.fmt(sp.stats.speed, 1)));
      if (sp.stats.dps > 0) st.appendChild(stat('사나움', U.fmt(sp.stats.dps, 1)));
      box.appendChild(st);
    }
    if (sp.drops && sp.drops.length) {
      var dr = U.el('div', 'codex-drops');
      dr.appendChild(U.el('span', 'lbl', '나오는 것'));
      sp.drops.forEach(function (d) {
        dr.appendChild(U.el('span', 'drop', d.name + ' ' + d.amount));
      });
      box.appendChild(dr);
    }
    if (sp.lore) box.appendChild(U.el('p', 'codex-lore', sp.lore));

    var foot = U.el('div', 'codex-foot');
    foot.appendChild(U.el('span', 'cnt', '만남 ' + sp.encounters + ' · 잡음 ' + sp.kills));
    if (sp.next) {
      foot.appendChild(U.el('span', 'nxt',
        nextLabel(sp.next.what) + '까지 ' + sp.next.unit + ' ' + sp.next.have + '/' + sp.next.need));
    } else {
      foot.appendChild(U.el('span', 'nxt done', '다 알았다'));
    }
    box.appendChild(foot);
    return box;
  }

  function nextLabel(what) {
    if (what === 'name') return '이름';
    if (what === 'stats') return '능력치';
    return '이야기';
  }

  function ringName(r) {
    if (r === 0) return '정착지 근처';
    if (r === 1) return '먼 들';
    return '사나운 땅';
  }

  function stat(k, v) {
    var s = U.el('span', 'st');
    s.appendChild(U.el('b', null, k));
    s.appendChild(U.el('i', null, v));
    return s;
  }

  function paintRuins(host, c) {
    var list = c.ruins || [];
    if (!list.length) {
      host.appendChild(U.el('p', 'empty', '아직 찾은 옛 자취가 없습니다. 멀리 나가 보십시오.'));
      return;
    }
    var wrap = U.el('div', 'codex-ruins');
    list.forEach(function (r) {
      var row = U.el('div', 'codex-ruin');
      row.appendChild(U.el('span', 'sz', r.size + '×' + r.size));
      row.appendChild(U.el('span', 'nm', r.name || '옛 자취'));
      row.appendChild(U.el('span', 'pos', '(' + r.x + ', ' + r.y + ')'));
      row.appendChild(U.el('span', 'cy', (r.cycles || 0) > 0 ? '뒤진 횟수 ' + r.cycles : '아직 손대지 않음'));
      if (r.concealed) row.appendChild(U.el('span', 'hid', '숨어 있던 곳'));
      row.onclick = function () {
        U.closeTopModal();
        if (GM.camera) GM.camera.moveTo(r.x, r.y);
      };
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  }

  function refresh() {
    var m = U.modalOpen('codex');
    if (!m) return;
    var body = m.querySelector('#codex-body');
    if (body) paint(body);
  }

  GM.codex = { open: open, refresh: refresh };
})(window);
